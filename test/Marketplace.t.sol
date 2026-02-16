// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Marketplace} from "../contracts/Marketplace.sol";
import {LobsterNFT} from "../contracts/LobsterNFT.sol";
import {ClawToken} from "../contracts/ClawToken.sol";
import {Treasury} from "../contracts/Treasury.sol";
import {DNALib} from "../contracts/libraries/DNALib.sol";

contract MarketplaceTest is Test {
    Marketplace marketplace;
    LobsterNFT nft;
    ClawToken claw;
    Treasury treasury;

    address admin = makeAddr("admin");
    address devWallet = makeAddr("devWallet");
    address lpAddress = makeAddr("lpAddress");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    uint256 validDNA;

    function setUp() public {
        vm.startPrank(admin);

        // Deploy contracts
        nft = new LobsterNFT(admin, "https://api.clawbada.com/lobster/");
        treasury = new Treasury(admin, devWallet);
        claw = new ClawToken(admin, lpAddress, address(treasury));
        treasury.setClawToken(address(claw));

        marketplace = new Marketplace(address(claw), address(nft), address(treasury));

        // Grant roles
        nft.grantRole(nft.MINTER_ROLE(), admin);
        treasury.setAuthorized(address(marketplace), true);

        vm.stopPrank();

        // Build valid DNA
        uint8[18] memory alleles;
        for (uint256 i = 0; i < 18; i++) {
            alleles[i] = 0x37;
        }
        validDNA = DNALib.encode(3, 0, 5, alleles);
    }

    // ──────────── Helpers ────────────

    function _mintLobster(address to, bool soulbound) internal returns (uint256) {
        vm.prank(admin);
        return nft.mint(to, validDNA, soulbound);
    }

    function _giveClaw(address to, uint256 amount) internal {
        vm.prank(lpAddress);
        claw.transfer(to, amount);
    }

    function _approveNFT(address owner) internal {
        vm.prank(owner);
        nft.setApprovalForAll(address(marketplace), true);
    }

    function _approveClaw(address owner, uint256 amount) internal {
        vm.prank(owner);
        claw.approve(address(marketplace), amount);
    }

    function _listLobster(address seller, uint256 lobsterId, uint256 price) internal returns (uint256) {
        _approveNFT(seller);
        vm.prank(seller);
        return marketplace.listLobster(lobsterId, price);
    }

    // ──────────── Constructor ────────────

    function test_constructorSetsState() public view {
        assertEq(address(marketplace.clawToken()), address(claw));
        assertEq(address(marketplace.lobsterNFT()), address(nft));
        assertEq(address(marketplace.treasury()), address(treasury));
    }

    function test_constructorZeroClawReverts() public {
        vm.expectRevert(Marketplace.ZeroAddress.selector);
        new Marketplace(address(0), address(nft), address(treasury));
    }

    function test_constructorZeroNFTReverts() public {
        vm.expectRevert(Marketplace.ZeroAddress.selector);
        new Marketplace(address(claw), address(0), address(treasury));
    }

    function test_constructorZeroTreasuryReverts() public {
        vm.expectRevert(Marketplace.ZeroAddress.selector);
        new Marketplace(address(claw), address(nft), address(0));
    }

    // ──────────── listLobster() ────────────

    function test_listLobsterHappyPath() public {
        uint256 lobsterId = _mintLobster(alice, false);
        uint256 listingId = _listLobster(alice, lobsterId, 1_000e18);

        assertEq(listingId, 1);
        assertEq(marketplace.nextListingId(), 2);
        assertEq(marketplace.lobsterToListing(lobsterId), listingId);

        // NFT escrowed in marketplace
        assertEq(nft.ownerOf(lobsterId), address(marketplace));

        // Listing data
        Marketplace.Listing memory listing = marketplace.getListing(listingId);
        assertEq(listing.seller, alice);
        assertEq(listing.lobsterId, lobsterId);
        assertEq(listing.price, 1_000e18);
        assertTrue(listing.active);
    }

    function test_listLobsterEmitsEvent() public {
        uint256 lobsterId = _mintLobster(alice, false);
        _approveNFT(alice);

        vm.prank(alice);
        vm.expectEmit(true, true, true, true);
        emit Marketplace.LobsterListed(1, alice, lobsterId, 1_000e18);
        marketplace.listLobster(lobsterId, 1_000e18);
    }

    function test_listLobsterNotOwnerReverts() public {
        uint256 lobsterId = _mintLobster(bob, false);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Marketplace.NotLobsterOwner.selector, lobsterId));
        marketplace.listLobster(lobsterId, 1_000e18);
    }

    function test_listLobsterZeroPriceReverts() public {
        uint256 lobsterId = _mintLobster(alice, false);

        vm.prank(alice);
        vm.expectRevert(Marketplace.ZeroPrice.selector);
        marketplace.listLobster(lobsterId, 0);
    }

    function test_listLobsterSoulboundReverts() public {
        uint256 lobsterId = _mintLobster(alice, true); // soulbound
        _approveNFT(alice);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(LobsterNFT.LobsterIsSoulbound.selector, lobsterId));
        marketplace.listLobster(lobsterId, 1_000e18);
    }

    function test_listLobsterLockedReverts() public {
        uint256 lobsterId = _mintLobster(alice, false);

        // Lock the lobster
        vm.startPrank(admin);
        nft.grantRole(nft.LOCKER_ROLE(), admin);
        nft.setLocked(lobsterId, true);
        vm.stopPrank();

        _approveNFT(alice);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(LobsterNFT.LobsterIsLocked.selector, lobsterId));
        marketplace.listLobster(lobsterId, 1_000e18);
    }

    function test_listLobsterAlreadyListedReverts() public {
        uint256 lobsterId = _mintLobster(alice, false);
        _listLobster(alice, lobsterId, 1_000e18);

        // Try listing again
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Marketplace.LobsterAlreadyListed.selector, lobsterId));
        marketplace.listLobster(lobsterId, 1_000e18);
    }

    function test_listLobsterNotApprovedReverts() public {
        uint256 lobsterId = _mintLobster(alice, false);

        // Don't approve — should revert on safeTransferFrom
        vm.prank(alice);
        vm.expectRevert(); // ERC1155MissingApprovalForAll
        marketplace.listLobster(lobsterId, 1_000e18);
    }

    // ──────────── cancelListing() ────────────

    function test_cancelListingHappyPath() public {
        uint256 lobsterId = _mintLobster(alice, false);
        uint256 listingId = _listLobster(alice, lobsterId, 1_000e18);

        vm.prank(alice);
        marketplace.cancelListing(listingId);

        // NFT returned to seller
        assertEq(nft.ownerOf(lobsterId), alice);

        // Listing inactive
        Marketplace.Listing memory listing = marketplace.getListing(listingId);
        assertFalse(listing.active);

        // lobsterToListing cleared
        assertEq(marketplace.lobsterToListing(lobsterId), 0);
    }

    function test_cancelListingEmitsEvent() public {
        uint256 lobsterId = _mintLobster(alice, false);
        uint256 listingId = _listLobster(alice, lobsterId, 1_000e18);

        vm.prank(alice);
        vm.expectEmit(true, false, false, false);
        emit Marketplace.ListingCancelled(listingId);
        marketplace.cancelListing(listingId);
    }

    function test_cancelListingNotSellerReverts() public {
        uint256 lobsterId = _mintLobster(alice, false);
        uint256 listingId = _listLobster(alice, lobsterId, 1_000e18);

        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(Marketplace.NotListingSeller.selector, listingId));
        marketplace.cancelListing(listingId);
    }

    function test_cancelListingInactiveReverts() public {
        uint256 lobsterId = _mintLobster(alice, false);
        uint256 listingId = _listLobster(alice, lobsterId, 1_000e18);

        // Cancel once
        vm.prank(alice);
        marketplace.cancelListing(listingId);

        // Try to cancel again
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Marketplace.ListingNotActive.selector, listingId));
        marketplace.cancelListing(listingId);
    }

    // ──────────── buyLobster() ────────────

    function test_buyLobsterHappyPath() public {
        uint256 lobsterId = _mintLobster(alice, false);
        uint256 price = 10_000e18;
        uint256 listingId = _listLobster(alice, lobsterId, price);

        _giveClaw(bob, price);
        _approveClaw(bob, price);

        vm.prank(bob);
        marketplace.buyLobster(listingId);

        // Buyer gets NFT
        assertEq(nft.ownerOf(lobsterId), bob);

        // Listing inactive
        Marketplace.Listing memory listing = marketplace.getListing(listingId);
        assertFalse(listing.active);
        assertEq(marketplace.lobsterToListing(lobsterId), 0);
    }

    function test_buyLobsterEmitsEvent() public {
        uint256 lobsterId = _mintLobster(alice, false);
        uint256 price = 10_000e18;
        uint256 listingId = _listLobster(alice, lobsterId, price);
        uint256 expectedFee = (price * 250) / 10_000; // 250 $CLAW

        _giveClaw(bob, price);
        _approveClaw(bob, price);

        vm.prank(bob);
        vm.expectEmit(true, true, true, true);
        emit Marketplace.LobsterSold(listingId, alice, bob, lobsterId, price, expectedFee);
        marketplace.buyLobster(listingId);
    }

    function test_buyLobsterFeeCalculation() public {
        uint256 lobsterId = _mintLobster(alice, false);
        uint256 price = 10_000e18;
        uint256 listingId = _listLobster(alice, lobsterId, price);
        uint256 expectedFee = (price * 250) / 10_000; // 250 $CLAW
        uint256 expectedSellerProceeds = price - expectedFee; // 9,750 $CLAW

        _giveClaw(bob, price);
        _approveClaw(bob, price);

        uint256 aliceBefore = claw.balanceOf(alice);

        vm.prank(bob);
        marketplace.buyLobster(listingId);

        uint256 aliceAfter = claw.balanceOf(alice);
        assertEq(aliceAfter - aliceBefore, expectedSellerProceeds);
        assertEq(claw.balanceOf(bob), 0); // buyer spent all
    }

    function test_buyLobsterTreasuryFeeRouting() public {
        uint256 lobsterId = _mintLobster(alice, false);
        uint256 price = 10_000e18;
        uint256 listingId = _listLobster(alice, lobsterId, price);
        uint256 fee = (price * 250) / 10_000; // 250 $CLAW
        uint256 expectedDevAmount = fee - (fee * 8500) / 10_000; // 15% of fee

        _giveClaw(bob, price);
        _approveClaw(bob, price);

        uint256 devBefore = claw.balanceOf(devWallet);
        uint256 supplyBefore = claw.totalSupply();

        vm.prank(bob);
        marketplace.buyLobster(listingId);

        uint256 devAfter = claw.balanceOf(devWallet);
        uint256 supplyAfter = claw.totalSupply();

        // Dev wallet received 15% of fee
        assertEq(devAfter - devBefore, expectedDevAmount);

        // 85% of fee was burned (total supply decreased)
        uint256 burnAmount = (fee * 8500) / 10_000;
        uint256 sellerProceeds = price - fee;
        // Supply should decrease by burnAmount (seller proceeds transferred, not burned)
        assertEq(supplyBefore - supplyAfter, burnAmount);
    }

    function test_buyLobsterInactiveReverts() public {
        uint256 lobsterId = _mintLobster(alice, false);
        uint256 listingId = _listLobster(alice, lobsterId, 1_000e18);

        // Cancel listing first
        vm.prank(alice);
        marketplace.cancelListing(listingId);

        _giveClaw(bob, 1_000e18);
        _approveClaw(bob, 1_000e18);

        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(Marketplace.ListingNotActive.selector, listingId));
        marketplace.buyLobster(listingId);
    }

    function test_buyLobsterInsufficientClawReverts() public {
        uint256 lobsterId = _mintLobster(alice, false);
        uint256 listingId = _listLobster(alice, lobsterId, 1_000e18);

        _giveClaw(bob, 999e18); // not enough
        _approveClaw(bob, 999e18);

        vm.prank(bob);
        vm.expectRevert(); // ERC20 insufficient balance
        marketplace.buyLobster(listingId);
    }

    function test_buyLobsterSellerCanBuyOwn() public {
        uint256 lobsterId = _mintLobster(alice, false);
        uint256 price = 1_000e18;
        uint256 listingId = _listLobster(alice, lobsterId, price);

        _giveClaw(alice, price);
        _approveClaw(alice, price);

        vm.prank(alice);
        marketplace.buyLobster(listingId);

        // Alice gets her NFT back (and paid the fee)
        assertEq(nft.ownerOf(lobsterId), alice);
    }

    function test_buyLobsterClearsLobsterToListing() public {
        uint256 lobsterId = _mintLobster(alice, false);
        uint256 listingId = _listLobster(alice, lobsterId, 1_000e18);

        assertEq(marketplace.lobsterToListing(lobsterId), listingId);

        _giveClaw(bob, 1_000e18);
        _approveClaw(bob, 1_000e18);

        vm.prank(bob);
        marketplace.buyLobster(listingId);

        assertEq(marketplace.lobsterToListing(lobsterId), 0);
    }

    // ──────────── updatePrice() ────────────

    function test_updatePriceHappyPath() public {
        uint256 lobsterId = _mintLobster(alice, false);
        uint256 listingId = _listLobster(alice, lobsterId, 1_000e18);

        vm.prank(alice);
        marketplace.updatePrice(listingId, 2_000e18);

        Marketplace.Listing memory listing = marketplace.getListing(listingId);
        assertEq(listing.price, 2_000e18);
    }

    function test_updatePriceEmitsEvent() public {
        uint256 lobsterId = _mintLobster(alice, false);
        uint256 listingId = _listLobster(alice, lobsterId, 1_000e18);

        vm.prank(alice);
        vm.expectEmit(true, false, false, true);
        emit Marketplace.ListingPriceUpdated(listingId, 1_000e18, 2_000e18);
        marketplace.updatePrice(listingId, 2_000e18);
    }

    function test_updatePriceNotSellerReverts() public {
        uint256 lobsterId = _mintLobster(alice, false);
        uint256 listingId = _listLobster(alice, lobsterId, 1_000e18);

        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(Marketplace.NotListingSeller.selector, listingId));
        marketplace.updatePrice(listingId, 2_000e18);
    }

    function test_updatePriceZeroReverts() public {
        uint256 lobsterId = _mintLobster(alice, false);
        uint256 listingId = _listLobster(alice, lobsterId, 1_000e18);

        vm.prank(alice);
        vm.expectRevert(Marketplace.ZeroPrice.selector);
        marketplace.updatePrice(listingId, 0);
    }

    function test_updatePriceInactiveReverts() public {
        uint256 lobsterId = _mintLobster(alice, false);
        uint256 listingId = _listLobster(alice, lobsterId, 1_000e18);

        // Cancel first
        vm.prank(alice);
        marketplace.cancelListing(listingId);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Marketplace.ListingNotActive.selector, listingId));
        marketplace.updatePrice(listingId, 2_000e18);
    }

    // ──────────── Integration / E2E ────────────

    function test_listBuyCancelCycleE2E() public {
        // Alice lists, Bob buys, Bob relists, Bob cancels
        uint256 lobsterId = _mintLobster(alice, false);
        uint256 price = 5_000e18;

        // Alice lists
        uint256 listingId1 = _listLobster(alice, lobsterId, price);
        assertEq(nft.ownerOf(lobsterId), address(marketplace));

        // Bob buys
        _giveClaw(bob, price);
        _approveClaw(bob, price);
        vm.prank(bob);
        marketplace.buyLobster(listingId1);
        assertEq(nft.ownerOf(lobsterId), bob);

        // Bob relists at higher price
        uint256 listingId2 = _listLobster(bob, lobsterId, price * 2);
        assertEq(nft.ownerOf(lobsterId), address(marketplace));
        assertEq(listingId2, 2);

        // Bob cancels
        vm.prank(bob);
        marketplace.cancelListing(listingId2);
        assertEq(nft.ownerOf(lobsterId), bob);
        assertEq(marketplace.lobsterToListing(lobsterId), 0);
    }

    function test_multipleListingsFromSameSeller() public {
        uint256 lobster1 = _mintLobster(alice, false);
        uint256 lobster2 = _mintLobster(alice, false);
        uint256 lobster3 = _mintLobster(alice, false);

        _approveNFT(alice);

        vm.startPrank(alice);
        uint256 listing1 = marketplace.listLobster(lobster1, 1_000e18);
        uint256 listing2 = marketplace.listLobster(lobster2, 2_000e18);
        uint256 listing3 = marketplace.listLobster(lobster3, 3_000e18);
        vm.stopPrank();

        assertEq(listing1, 1);
        assertEq(listing2, 2);
        assertEq(listing3, 3);

        // All escrowed
        assertEq(nft.ownerOf(lobster1), address(marketplace));
        assertEq(nft.ownerOf(lobster2), address(marketplace));
        assertEq(nft.ownerOf(lobster3), address(marketplace));

        // Bob buys one, Alice cancels another
        _giveClaw(bob, 2_000e18);
        _approveClaw(bob, 2_000e18);
        vm.prank(bob);
        marketplace.buyLobster(listing2);

        vm.prank(alice);
        marketplace.cancelListing(listing1);

        // Check final state
        assertEq(nft.ownerOf(lobster1), alice); // cancelled, returned
        assertEq(nft.ownerOf(lobster2), bob); // bought
        assertEq(nft.ownerOf(lobster3), address(marketplace)); // still listed
    }

    // ──────────── Fuzz ────────────

    function testFuzz_feeCalculationCorrect(uint256 price) public pure {
        price = bound(price, 1, type(uint128).max); // reasonable range
        uint256 fee = (price * 250) / 10_000;
        uint256 sellerProceeds = price - fee;
        assertEq(fee + sellerProceeds, price);
    }

    function testFuzz_sellerReceivesCorrectAmount(uint256 price) public {
        price = bound(price, 1e18, 1_000_000e18); // 1 to 1M $CLAW

        uint256 lobsterId = _mintLobster(alice, false);
        uint256 listingId = _listLobster(alice, lobsterId, price);

        uint256 expectedFee = (price * 250) / 10_000;
        uint256 expectedSellerProceeds = price - expectedFee;

        _giveClaw(bob, price);
        _approveClaw(bob, price);

        uint256 aliceBefore = claw.balanceOf(alice);

        vm.prank(bob);
        marketplace.buyLobster(listingId);

        assertEq(claw.balanceOf(alice) - aliceBefore, expectedSellerProceeds);
    }
}
