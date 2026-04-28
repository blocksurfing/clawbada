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
        marketplace.buyLobster(listingId, type(uint256).max);
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
        marketplace.buyLobster(listingId, type(uint256).max);
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
        marketplace.buyLobster(listingId, type(uint256).max);
        vm.stopPrank();

        assertEq(marketplace.lobsterToListing(lobsterId), 0, "mapping cleared after sale");
    }

    // ─────────────────────────────────────────────────────────────
    // Phase 2 Marketplace pass — gap coverage
    // ─────────────────────────────────────────────────────────────

    // I-01 closed by SelfPurchase guard — see test_I01_selfPurchase_reverts
    // and test_I01_thirdPartyPurchase_stillWorks below for the post-fix
    // assertions. Pre-fix behavior (wash trade cost 2.5% fee, returned NFT
    // to seller) is no longer reachable.

    // After listLobster, `ownerOf` returns the Marketplace contract (NFT is
    // escrowed). Verifies the L-01 fix didn't break escrow accounting.
    function test_listLobster_escrowsTokenToMarketplace() public {
        uint256 lobsterId = _mintLobster(alice, 0);
        assertEq(nft.ownerOf(lobsterId), alice, "initial owner");

        _list(alice, lobsterId, 500_000e18);

        assertEq(nft.ownerOf(lobsterId), address(marketplace), "escrowed to marketplace");
        assertEq(nft.balanceOf(address(marketplace), lobsterId), 1, "marketplace holds balance");
        assertEq(nft.balanceOf(alice, lobsterId), 0, "seller balance cleared");
    }

    // Cancel returns NFT to seller and clears the listing, leaving it
    // relistable at a new price.
    function test_cancel_thenRelist_succeeds() public {
        uint256 lobsterId = _mintLobster(alice, 0);
        uint256 firstListing = _list(alice, lobsterId, 500_000e18);

        vm.prank(alice);
        marketplace.cancelListing(firstListing);

        assertEq(nft.ownerOf(lobsterId), alice, "returned to seller");
        assertEq(marketplace.lobsterToListing(lobsterId), 0, "link cleared");

        // Re-list at a different price.
        uint256 newListing = _list(alice, lobsterId, 2_000_000e18);
        assertTrue(newListing != firstListing, "new listing id");

        Marketplace.Listing memory l = marketplace.getListing(newListing);
        assertTrue(l.active);
        assertEq(l.price, 2_000_000e18);
    }

    // Double-cancel reverts ListingNotActive.
    function test_doubleCancel_reverts() public {
        uint256 lobsterId = _mintLobster(alice, 0);
        uint256 listingId = _list(alice, lobsterId, 500_000e18);

        vm.prank(alice);
        marketplace.cancelListing(listingId);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Marketplace.ListingNotActive.selector, listingId));
        marketplace.cancelListing(listingId);
    }

    // After a successful buy, cancel reverts ListingNotActive.
    function test_cancel_afterBuy_reverts() public {
        uint256 lobsterId = _mintLobster(alice, 0);
        uint256 price = 500_000e18;
        uint256 listingId = _list(alice, lobsterId, price);
        _giveClaw(bob, price);

        vm.startPrank(bob);
        claw.approve(address(marketplace), price);
        marketplace.buyLobster(listingId, type(uint256).max);
        vm.stopPrank();

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Marketplace.ListingNotActive.selector, listingId));
        marketplace.cancelListing(listingId);
    }

    // Non-seller cannot update price.
    function test_updatePrice_nonSeller_reverts() public {
        uint256 lobsterId = _mintLobster(alice, 0);
        uint256 listingId = _list(alice, lobsterId, 500_000e18);

        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(Marketplace.NotListingSeller.selector, listingId));
        marketplace.updatePrice(listingId, 1_000_000e18);
    }

    // updatePrice on inactive listing reverts.
    function test_updatePrice_inactiveListing_reverts() public {
        uint256 lobsterId = _mintLobster(alice, 0);
        uint256 listingId = _list(alice, lobsterId, 500_000e18);

        vm.prank(alice);
        marketplace.cancelListing(listingId);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Marketplace.ListingNotActive.selector, listingId));
        marketplace.updatePrice(listingId, 1_000_000e18);
    }

    // Buy with insufficient approval reverts (ERC20 bubble).
    function test_buy_insufficientApproval_reverts() public {
        uint256 lobsterId = _mintLobster(alice, 0);
        uint256 price = 500_000e18;
        uint256 listingId = _list(alice, lobsterId, price);
        _giveClaw(bob, price);

        // Bob approves less than price
        vm.startPrank(bob);
        claw.approve(address(marketplace), price - 1);
        vm.expectRevert();
        marketplace.buyLobster(listingId, type(uint256).max);
        vm.stopPrank();
    }

    // M-04: seller front-run with updatePrice cannot extract more CLAW from
    // a buyer holding a standing allowance. buyLobster now requires a
    // maxPrice parameter; if the listing's current price exceeds maxPrice
    // at execution time, the tx reverts PriceExceedsMaximum.
    function test_M04_sellerFrontRun_maxPrice_protectsBuyer() public {
        uint256 lobsterId = _mintLobster(alice, 0);
        uint256 initialPrice = 500_000e18;
        uint256 listingId = _list(alice, lobsterId, initialPrice);

        // Bob holds a standing infinite allowance + enough CLAW to cover a
        // raised price. He submits buyLobster with maxPrice = initialPrice.
        _giveClaw(bob, 2_000_000e18);
        vm.prank(bob);
        claw.approve(address(marketplace), type(uint256).max);

        // Seller front-runs with updatePrice to a higher value.
        uint256 raisedPrice = 1_500_000e18;
        vm.prank(alice);
        marketplace.updatePrice(listingId, raisedPrice);

        // Bob's buy reverts — his maxPrice guard kicks in.
        vm.prank(bob);
        vm.expectRevert(
            abi.encodeWithSelector(Marketplace.PriceExceedsMaximum.selector, raisedPrice, initialPrice)
        );
        marketplace.buyLobster(listingId, initialPrice);

        // NFT still escrowed, listing still active — Bob's CLAW not spent.
        assertEq(nft.ownerOf(lobsterId), address(marketplace));
        assertTrue(marketplace.getListing(listingId).active);
        assertEq(claw.balanceOf(bob), 2_000_000e18, "buyer CLAW untouched");
    }

    // M-04: passing type(uint256).max as maxPrice opts out of slippage
    // protection — buyer explicitly accepts any price (legacy pre-fix
    // behavior). Documents the opt-out semantics.
    function test_M04_maxPriceMax_acceptsAnyPrice() public {
        uint256 lobsterId = _mintLobster(alice, 0);
        uint256 initialPrice = 500_000e18;
        uint256 listingId = _list(alice, lobsterId, initialPrice);

        // Seller raises price; buyer accepts any price.
        vm.prank(alice);
        marketplace.updatePrice(listingId, 2_000_000e18);

        _giveClaw(bob, 2_000_000e18);
        vm.startPrank(bob);
        claw.approve(address(marketplace), type(uint256).max);
        marketplace.buyLobster(listingId, type(uint256).max);
        vm.stopPrank();

        assertEq(nft.ownerOf(lobsterId), bob, "buyer accepted raised price");
    }

    // M-04: maxPrice at exactly the listing price is allowed (boundary).
    function test_M04_maxPriceExact_allowed() public {
        uint256 lobsterId = _mintLobster(alice, 0);
        uint256 price = 500_000e18;
        uint256 listingId = _list(alice, lobsterId, price);

        _giveClaw(bob, price);
        vm.startPrank(bob);
        claw.approve(address(marketplace), price);
        marketplace.buyLobster(listingId, price);
        vm.stopPrank();

        assertEq(nft.ownerOf(lobsterId), bob);
    }

    // M-05: direct ERC-1155 transfers to Marketplace are rejected — the
    // Marketplace only accepts NFT deposits initiated by its own
    // listLobster flow. Prevents users from accidentally blackholing
    // lobsters by sending them directly to the contract.
    function test_M05_directTransfer_rejected() public {
        uint256 lobsterId = _mintLobster(alice, 0);

        vm.startPrank(alice);
        nft.setApprovalForAll(address(marketplace), true);
        // Pre-M-05 this succeeded silently, stranding the NFT. Post-fix
        // the onERC1155Received hook rejects non-Marketplace-initiated
        // transfers.
        vm.expectRevert();
        nft.safeTransferFrom(alice, address(marketplace), lobsterId, 1, "");
        vm.stopPrank();

        // Alice still owns the NFT; nothing stranded.
        assertEq(nft.ownerOf(lobsterId), alice, "alice retained NFT after rejected direct transfer");
    }

    // M-05: batch transfers to Marketplace are also rejected outright
    // (Marketplace only handles single-token listings).
    function test_M05_directBatchTransfer_rejected() public {
        uint256 t1 = _mintLobster(alice, 0);
        uint256 t2 = _mintLobster(alice, 1);

        uint256[] memory ids = new uint256[](2);
        ids[0] = t1;
        ids[1] = t2;
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = 1;
        amounts[1] = 1;

        vm.startPrank(alice);
        nft.setApprovalForAll(address(marketplace), true);
        vm.expectRevert();
        nft.safeBatchTransferFrom(alice, address(marketplace), ids, amounts, "");
        vm.stopPrank();
    }

    // M-05: listLobster's internal safeTransferFrom still works (operator
    // equals Marketplace, so the hook passes). Re-verifies the happy path
    // isn't broken by the new guard.
    function test_M05_listLobster_stillWorks() public {
        uint256 lobsterId = _mintLobster(alice, 0);
        uint256 listingId = _list(alice, lobsterId, 500_000e18);

        assertEq(nft.ownerOf(lobsterId), address(marketplace));
        Marketplace.Listing memory l = marketplace.getListing(listingId);
        assertTrue(l.active);
    }

    // A buyer contract with a reverting onERC1155Received can't force
    // the Marketplace to leave an NFT stranded — the whole tx reverts.
    function test_buy_receiverRevert_wholeTxReverts() public {
        RejectingReceiver evilBuyer = new RejectingReceiver();
        uint256 lobsterId = _mintLobster(alice, 0);
        uint256 price = 500_000e18;
        uint256 listingId = _list(alice, lobsterId, price);

        _giveClaw(address(evilBuyer), price);
        evilBuyer.approve(claw, address(marketplace), price);

        vm.expectRevert();
        evilBuyer.buy(marketplace, listingId);

        // Listing still active; NFT still in marketplace escrow; no partial state.
        Marketplace.Listing memory l = marketplace.getListing(listingId);
        assertTrue(l.active, "listing still active");
        assertEq(nft.ownerOf(lobsterId), address(marketplace), "NFT still escrowed");
    }

    // I-01: seller cannot buy their own listing — closes the wash-trading
    // vector (artificial volume / fake social proof at cost of 2.5% fee).
    function test_I01_selfPurchase_reverts() public {
        uint256 lobsterId = _mintLobster(alice, 0);
        uint256 price = 500_000e18;
        uint256 listingId = _list(alice, lobsterId, price);

        _giveClaw(alice, price);

        vm.startPrank(alice);
        claw.approve(address(marketplace), price);
        vm.expectRevert(abi.encodeWithSelector(Marketplace.SelfPurchase.selector, alice));
        marketplace.buyLobster(listingId, price);
        vm.stopPrank();

        // Listing remains active; nothing changed.
        Marketplace.Listing memory l = marketplace.getListing(listingId);
        assertTrue(l.active, "listing still active after self-purchase revert");
        assertEq(nft.ownerOf(lobsterId), address(marketplace));
    }

    // I-01: a third party can still buy the listing (negative control —
    // verifies the seller-only check doesn't accidentally block legitimate buyers).
    function test_I01_thirdPartyPurchase_stillWorks() public {
        uint256 lobsterId = _mintLobster(alice, 0);
        uint256 price = 500_000e18;
        uint256 listingId = _list(alice, lobsterId, price);

        _giveClaw(bob, price);
        vm.startPrank(bob);
        claw.approve(address(marketplace), price);
        marketplace.buyLobster(listingId, price);
        vm.stopPrank();

        assertEq(nft.ownerOf(lobsterId), bob);
    }
}

/// @dev Contract buyer that rejects ERC-1155 receipts — used to verify
///      Marketplace's buy path reverts atomically on hook rejection.
contract RejectingReceiver {
    function approve(ClawToken claw, address spender, uint256 amount) external {
        claw.approve(spender, amount);
    }

    function buy(Marketplace market, uint256 listingId) external {
        market.buyLobster(listingId, type(uint256).max);
    }

    function onERC1155Received(address, address, uint256, uint256, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        revert("RejectingReceiver: no thanks");
    }

    function onERC1155BatchReceived(address, address, uint256[] calldata, uint256[] calldata, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        revert("RejectingReceiver: no batch");
    }

    function supportsInterface(bytes4) external pure returns (bool) {
        return true;
    }
}
