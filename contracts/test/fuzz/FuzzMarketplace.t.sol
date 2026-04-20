// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import "../helpers/BaseSetup.t.sol";

/// @dev Fuzz tests for Marketplace: fee calculation, escrow correctness, listing lifecycle.
contract FuzzMarketplace is BaseSetup {
    address internal alice = makeAddr("alice");
    address internal bob   = makeAddr("bob");

    function _list(address seller, uint256 lobsterId, uint256 price) internal returns (uint256 listingId) {
        vm.startPrank(seller);
        nft.setApprovalForAll(address(marketplace), true);
        listingId = marketplace.listLobster(lobsterId, price);
        vm.stopPrank();
    }

    // ── Fee calculation ───────────────────────────────────────────

    function testFuzz_fee_calculation(uint256 price) public view {
        price = bound(price, 1, type(uint128).max);
        uint256 fee = (price * marketplace.FEE_BPS()) / marketplace.BPS_DENOMINATOR();
        uint256 sellerProceeds = price - fee;
        assertEq(fee + sellerProceeds, price, "fee + seller proceeds must equal price");
    }

    // ── Buy: seller and buyer balances correct ────────────────────

    function testFuzz_buy_balances(uint256 price) public {
        // T-03 (2026-04-20): Treasury requires fee >= BPS_DENOMINATOR
        // (10_000 wei). Marketplace fee = price × FEE_BPS / BPS_DENOMINATOR;
        // at 2.5% fee, minimum price that yields fee >= 10_000 is 400_000.
        price = bound(price, 400_000, 1_000_000e18);

        uint256 lobsterId = _mintLobster(alice, 0);
        _giveClaw(bob, price);

        uint256 listingId = _list(alice, lobsterId, price);

        // Escrow: NFT is now in marketplace
        assertEq(nft.ownerOf(lobsterId), address(marketplace));

        uint256 aliceBefore = claw.balanceOf(alice);
        uint256 bobBefore   = claw.balanceOf(bob);
        uint256 supplyBefore = claw.totalSupply();

        vm.startPrank(bob);
        claw.approve(address(marketplace), price);
        marketplace.buyLobster(listingId);
        vm.stopPrank();

        uint256 fee           = (price * marketplace.FEE_BPS()) / marketplace.BPS_DENOMINATOR();
        uint256 sellerProceeds = price - fee;

        assertEq(claw.balanceOf(alice) - aliceBefore, sellerProceeds, "seller receives proceeds");
        assertEq(bobBefore - claw.balanceOf(bob), price, "buyer pays full price");
        assertEq(nft.ownerOf(lobsterId), bob, "buyer owns NFT");

        // Protocol fee was burned (85% of fee)
        uint256 burned = supplyBefore - claw.totalSupply();
        uint256 burnedFee = (fee * treasury.BURN_BPS()) / treasury.BPS_DENOMINATOR();
        assertEq(burned, burnedFee, "burned portion of fee");
    }

    // ── Soulbound cannot be listed ────────────────────────────────

    function test_soulbound_cannot_be_listed() public {
        uint256 lobsterId = _mintSoulbound(alice, 0);
        _giveClaw(alice, 1);

        vm.startPrank(alice);
        nft.setApprovalForAll(address(marketplace), true);
        vm.expectRevert(); // LobsterIsSoulbound
        marketplace.listLobster(lobsterId, 100e18);
        vm.stopPrank();
    }

    // ── Locked cannot be listed ───────────────────────────────────

    function test_locked_cannot_be_listed() public {
        uint256 lobsterId = _mintLobster(alice, 0);
        uint256 extra1    = _mintLobster(alice, 1);
        uint256 extra2    = _mintLobster(alice, 2);

        vm.prank(alice);
        teamMgr.createTeam([lobsterId, extra1, extra2]);

        assertTrue(nft.isLocked(lobsterId));

        vm.startPrank(alice);
        nft.setApprovalForAll(address(marketplace), true);
        vm.expectRevert(); // LobsterIsLocked
        marketplace.listLobster(lobsterId, 100e18);
        vm.stopPrank();
    }

    // ── Zero price reverts ────────────────────────────────────────

    function test_zero_price_reverts() public {
        uint256 lobsterId = _mintLobster(alice, 0);
        vm.startPrank(alice);
        nft.setApprovalForAll(address(marketplace), true);
        vm.expectRevert(Marketplace.ZeroPrice.selector);
        marketplace.listLobster(lobsterId, 0);
        vm.stopPrank();
    }

    // ── Already listed reverts ────────────────────────────────────

    function test_already_listed_reverts() public {
        uint256 lobsterId = _mintLobster(alice, 0);
        _list(alice, lobsterId, 100e18);

        vm.startPrank(alice);
        nft.setApprovalForAll(address(marketplace), true);
        vm.expectRevert(abi.encodeWithSelector(Marketplace.LobsterAlreadyListed.selector, lobsterId));
        marketplace.listLobster(lobsterId, 200e18);
        vm.stopPrank();
    }

    // ── Cancel returns NFT ────────────────────────────────────────

    function test_cancel_returns_nft() public {
        uint256 lobsterId = _mintLobster(alice, 0);
        uint256 listingId = _list(alice, lobsterId, 100e18);

        assertEq(nft.ownerOf(lobsterId), address(marketplace));

        vm.prank(alice);
        marketplace.cancelListing(listingId);

        assertEq(nft.ownerOf(lobsterId), alice, "NFT returned to seller");
    }

    // ── Non-seller cannot cancel ──────────────────────────────────

    function test_non_seller_cannot_cancel() public {
        uint256 lobsterId = _mintLobster(alice, 0);
        uint256 listingId = _list(alice, lobsterId, 100e18);

        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(Marketplace.NotListingSeller.selector, listingId));
        marketplace.cancelListing(listingId);
    }

    // ── Cannot buy cancelled listing ─────────────────────────────

    function test_buy_cancelled_reverts() public {
        uint256 lobsterId = _mintLobster(alice, 0);
        uint256 listingId = _list(alice, lobsterId, 100e18);
        _giveClaw(bob, 100e18);

        vm.prank(alice);
        marketplace.cancelListing(listingId);

        vm.startPrank(bob);
        claw.approve(address(marketplace), 100e18);
        vm.expectRevert(abi.encodeWithSelector(Marketplace.ListingNotActive.selector, listingId));
        marketplace.buyLobster(listingId);
        vm.stopPrank();
    }

    // ── Price update ──────────────────────────────────────────────

    function testFuzz_price_update(uint256 newPrice) public {
        // T-05: updatePrice also enforces MIN_LISTING_PRICE (400_000 wei).
        newPrice = bound(newPrice, marketplace.MIN_LISTING_PRICE(), type(uint128).max);
        uint256 lobsterId = _mintLobster(alice, 0);
        uint256 listingId = _list(alice, lobsterId, 100e18);

        vm.prank(alice);
        marketplace.updatePrice(listingId, newPrice);

        Marketplace.Listing memory l = marketplace.getListing(listingId);
        assertEq(l.price, newPrice);
    }

    // T-05 regression: updatePrice rejects sub-minimum prices.
    function testFuzz_price_update_belowMin_reverts(uint256 dustPrice) public {
        dustPrice = bound(dustPrice, 1, marketplace.MIN_LISTING_PRICE() - 1);
        uint256 lobsterId = _mintLobster(alice, 0);
        uint256 listingId = _list(alice, lobsterId, 100e18);

        vm.expectRevert(
            abi.encodeWithSelector(Marketplace.PriceBelowMinimum.selector, dustPrice, marketplace.MIN_LISTING_PRICE())
        );
        vm.prank(alice);
        marketplace.updatePrice(listingId, dustPrice);
    }

    function test_update_price_zero_reverts() public {
        uint256 lobsterId = _mintLobster(alice, 0);
        uint256 listingId = _list(alice, lobsterId, 100e18);

        vm.prank(alice);
        vm.expectRevert(Marketplace.ZeroPrice.selector);
        marketplace.updatePrice(listingId, 0);
    }

    // ── lobsterToListing mapping cleared after sale ───────────────

    function test_lobster_to_listing_cleared_after_sale() public {
        uint256 lobsterId = _mintLobster(alice, 0);
        uint256 listingId = _list(alice, lobsterId, 100e18);
        _giveClaw(bob, 100e18);

        assertEq(marketplace.lobsterToListing(lobsterId), listingId);

        vm.startPrank(bob);
        claw.approve(address(marketplace), 100e18);
        marketplace.buyLobster(listingId);
        vm.stopPrank();

        assertEq(marketplace.lobsterToListing(lobsterId), 0, "mapping cleared after sale");
    }
}
