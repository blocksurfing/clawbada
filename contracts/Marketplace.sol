// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC1155Holder} from "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";
import {LobsterNFT} from "./LobsterNFT.sol";
import {Treasury} from "./Treasury.sol";

/// @title Marketplace — Escrow-based lobster marketplace for Clawbada
/// @notice Sellers list lobsters (NFT escrowed in contract), buyers pay in $CLAW.
///         2.5% protocol fee on each sale routed through Treasury (85% burn / 15% dev).
/// @dev Escrow model: NFT transferred to contract on listing, returned on cancel.
///      LobsterNFT._update() automatically rejects soulbound and locked transfers.
contract Marketplace is ReentrancyGuard, ERC1155Holder {
    // ──────────── Constants ────────────
    uint256 public constant FEE_BPS = 250; // 2.5%
    uint256 public constant BPS_DENOMINATOR = 10_000;

    // T-05 (knock-on from Treasury T-03, 2026-04-20): minimum listing price
    // such that the computed protocol fee clears Treasury's `BPS_DENOMINATOR`
    // floor. Without this, dust listings would pass our own price check but
    // the subsequent `treasury.processFee(fee)` call would revert
    // `AmountBelowMinimum`, leaving the listing un-buyable.
    //
    //   fee = price * FEE_BPS / BPS_DENOMINATOR >= Treasury.BPS_DENOMINATOR
    //   price >= Treasury.BPS_DENOMINATOR * BPS_DENOMINATOR / FEE_BPS
    //   price >= 10_000 * 10_000 / 250 = 400_000 wei
    //
    // At 18-decimal CLAW this is 4 × 10^-13 CLAW — well below any realistic
    // listing, so in practice no honest flow is affected.
    uint256 public constant MIN_LISTING_PRICE = 400_000;

    // ──────────── Types ────────────
    struct Listing {
        address seller;
        uint256 lobsterId;
        uint256 price; // in $CLAW (full price buyer pays)
        bool active;
    }

    // ──────────── State ────────────
    IERC20 public clawToken;
    LobsterNFT public lobsterNFT;
    Treasury public treasury;

    uint256 public nextListingId = 1;
    mapping(uint256 => Listing) private _listings; // listingId → Listing
    mapping(uint256 => uint256) public lobsterToListing; // lobsterId → active listingId (0 = none)

    // ──────────── Events ────────────
    event LobsterListed(uint256 indexed listingId, address indexed seller, uint256 indexed lobsterId, uint256 price);
    event ListingCancelled(uint256 indexed listingId);
    event LobsterSold(
        uint256 indexed listingId,
        address indexed seller,
        address indexed buyer,
        uint256 lobsterId,
        uint256 price,
        uint256 fee
    );
    event ListingPriceUpdated(uint256 indexed listingId, uint256 oldPrice, uint256 newPrice);

    // ──────────── Errors ────────────
    error ZeroAddress();
    error ZeroPrice();
    error PriceBelowMinimum(uint256 price, uint256 minimum);
    error NotListingSeller(uint256 listingId);
    error ListingNotActive(uint256 listingId);
    error LobsterAlreadyListed(uint256 lobsterId);
    error NotLobsterOwner(uint256 lobsterId);
    /// @notice The listing's current price exceeds the buyer's `maxPrice`.
    ///         M-04: prevents a seller from front-running a buyer's `buyLobster`
    ///         with `updatePrice` to extract more CLAW than the buyer intended.
    error PriceExceedsMaximum(uint256 currentPrice, uint256 maxPrice);

    // ──────────── Constructor ────────────

    /// @param clawToken_ The $CLAW ERC-20 token
    /// @param lobsterNFT_ The LobsterNFT contract
    /// @param treasury_ The Treasury fee splitter
    constructor(address clawToken_, address lobsterNFT_, address treasury_) {
        if (clawToken_ == address(0) || lobsterNFT_ == address(0) || treasury_ == address(0)) {
            revert ZeroAddress();
        }
        clawToken = IERC20(clawToken_);
        lobsterNFT = LobsterNFT(lobsterNFT_);
        treasury = Treasury(treasury_);
    }

    // ──────────── Core ────────────

    /// @notice List a lobster for sale. NFT is escrowed in this contract.
    /// @dev Caller must have called nft.setApprovalForAll(marketplace, true) first.
    ///      LobsterNFT._update() rejects soulbound and locked lobsters automatically.
    /// @param lobsterId The lobster to list
    /// @param price The sale price in $CLAW (full amount buyer pays)
    /// @return listingId The newly created listing ID
    function listLobster(uint256 lobsterId, uint256 price) external nonReentrant returns (uint256 listingId) {
        if (price == 0) revert ZeroPrice();
        if (price < MIN_LISTING_PRICE) revert PriceBelowMinimum(price, MIN_LISTING_PRICE);
        if (lobsterToListing[lobsterId] != 0) revert LobsterAlreadyListed(lobsterId);
        if (lobsterNFT.ownerOf(lobsterId) != msg.sender) revert NotLobsterOwner(lobsterId);

        // Escrow NFT — will revert if soulbound, locked, or not approved
        lobsterNFT.safeTransferFrom(msg.sender, address(this), lobsterId, 1, "");

        listingId = nextListingId++;
        _listings[listingId] = Listing({seller: msg.sender, lobsterId: lobsterId, price: price, active: true});
        lobsterToListing[lobsterId] = listingId;

        emit LobsterListed(listingId, msg.sender, lobsterId, price);
    }

    /// @notice Cancel an active listing. NFT returned to seller.
    /// @param listingId The listing to cancel
    function cancelListing(uint256 listingId) external nonReentrant {
        Listing storage listing = _listings[listingId];
        if (!listing.active) revert ListingNotActive(listingId);
        if (listing.seller != msg.sender) revert NotListingSeller(listingId);

        listing.active = false;
        lobsterToListing[listing.lobsterId] = 0;

        lobsterNFT.safeTransferFrom(address(this), msg.sender, listing.lobsterId, 1, "");

        emit ListingCancelled(listingId);
    }

    /// @notice Buy a listed lobster. Pays full price in $CLAW; 2.5% fee to Treasury.
    /// @dev CEI pattern: state changes before external calls.
    /// @param listingId The listing to buy
    /// @param maxPrice The maximum price the buyer is willing to pay. M-04 slippage
    ///        guard: if the seller front-runs with `updatePrice` to raise the price
    ///        before the buyer's tx lands, this reverts `PriceExceedsMaximum` instead
    ///        of pulling the higher amount from the buyer's standing allowance.
    ///        Callers should pass the price they saw in the UI (or
    ///        `type(uint256).max` to explicitly accept any price).
    function buyLobster(uint256 listingId, uint256 maxPrice) external nonReentrant {
        Listing storage listing = _listings[listingId];
        if (!listing.active) revert ListingNotActive(listingId);
        if (listing.price > maxPrice) revert PriceExceedsMaximum(listing.price, maxPrice);

        // CEI: update state before external calls
        listing.active = false;
        uint256 lobsterId = listing.lobsterId;
        lobsterToListing[lobsterId] = 0;

        uint256 price = listing.price;
        address seller = listing.seller;
        uint256 fee = (price * FEE_BPS) / BPS_DENOMINATOR;
        uint256 sellerProceeds = price - fee;

        // Pull full price from buyer
        clawToken.transferFrom(msg.sender, address(this), price);

        // Route fee through Treasury (skip if fee rounds to zero)
        if (fee > 0) {
            clawToken.approve(address(treasury), fee);
            treasury.processFee(fee);
        }

        // Pay seller
        clawToken.transfer(seller, sellerProceeds);

        // Transfer NFT to buyer
        lobsterNFT.safeTransferFrom(address(this), msg.sender, lobsterId, 1, "");

        emit LobsterSold(listingId, seller, msg.sender, lobsterId, price, fee);
    }

    /// @notice Update the price of an active listing.
    /// @param listingId The listing to update
    /// @param newPrice The new price in $CLAW
    function updatePrice(uint256 listingId, uint256 newPrice) external {
        if (newPrice == 0) revert ZeroPrice();
        if (newPrice < MIN_LISTING_PRICE) revert PriceBelowMinimum(newPrice, MIN_LISTING_PRICE);
        Listing storage listing = _listings[listingId];
        if (!listing.active) revert ListingNotActive(listingId);
        if (listing.seller != msg.sender) revert NotListingSeller(listingId);

        uint256 oldPrice = listing.price;
        listing.price = newPrice;

        emit ListingPriceUpdated(listingId, oldPrice, newPrice);
    }

    // ──────────── View ────────────

    /// @notice Get listing details.
    function getListing(uint256 listingId) external view returns (Listing memory) {
        return _listings[listingId];
    }

    // ──────────── ERC-1155 Receiver (M-05 hardening) ────────────

    /// @dev Accept only ERC-1155 transfers initiated by Marketplace itself
    ///      (via `listLobster`'s internal `safeTransferFrom`). Direct transfers
    ///      from arbitrary callers — including approved operators of the token
    ///      owner — are rejected to prevent NFTs from being blackholed in
    ///      Marketplace escrow without a corresponding listing. Also enforces
    ///      the supply=1 invariant and rejects non-LobsterNFT token contracts.
    ///      M-05 (Codex red-team, 2026-04-22).
    function onERC1155Received(address operator, address, uint256, uint256 value, bytes memory)
        public
        view
        override
        returns (bytes4)
    {
        if (msg.sender != address(lobsterNFT)) revert ZeroAddress(); // foreign token
        if (operator != address(this)) revert NotLobsterOwner(0);    // not via listLobster
        if (value != 1) revert ZeroPrice();                           // supply=1 invariant
        return this.onERC1155Received.selector;
    }

    /// @dev Always reject batch transfers — Marketplace only handles single-
    ///      token listings. M-05 hardening.
    function onERC1155BatchReceived(address, address, uint256[] memory, uint256[] memory, bytes memory)
        public
        pure
        override
        returns (bytes4)
    {
        revert ZeroAddress();
    }
}
