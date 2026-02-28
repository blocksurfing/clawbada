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
    error NotListingSeller(uint256 listingId);
    error ListingNotActive(uint256 listingId);
    error LobsterAlreadyListed(uint256 lobsterId);
    error NotLobsterOwner(uint256 lobsterId);

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
    function buyLobster(uint256 listingId) external nonReentrant {
        Listing storage listing = _listings[listingId];
        if (!listing.active) revert ListingNotActive(listingId);

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
}
