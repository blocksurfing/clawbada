// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Treasury, IGoldBurnable} from "../contracts/Treasury.sol";
import {GoldToken} from "../contracts/GoldToken.sol";

contract TreasuryTest is Test {
    Treasury treasury;
    GoldToken gold;

    address admin = makeAddr("admin");
    address devWallet = makeAddr("devWallet");
    address lpAddress = makeAddr("lpAddress");
    address authorizedCaller = makeAddr("authorizedCaller");
    address unauthorized = makeAddr("unauthorized");

    function setUp() public {
        vm.startPrank(admin);

        treasury = new Treasury(admin, devWallet);
        gold = new GoldToken(admin, lpAddress, address(treasury));
        treasury.setGoldToken(address(gold));
        treasury.setAuthorized(authorizedCaller, true);

        vm.stopPrank();

        // Give the authorized caller some GOLD to pay fees with
        vm.prank(lpAddress);
        gold.transfer(authorizedCaller, 1_000_000e18);
    }

    // ──────────── Constructor ────────────

    function test_constructor() public view {
        assertEq(treasury.owner(), admin);
        assertEq(treasury.devWallet(), devWallet);
    }

    function test_constructorZeroDevWalletReverts() public {
        vm.expectRevert(Treasury.ZeroAddress.selector);
        new Treasury(admin, address(0));
    }

    // ──────────── setGoldToken ────────────

    function test_setGoldTokenOnce() public view {
        assertEq(address(treasury.goldToken()), address(gold));
    }

    function test_setGoldTokenTwiceReverts() public {
        vm.prank(admin);
        vm.expectRevert(Treasury.TokenAlreadySet.selector);
        treasury.setGoldToken(address(gold));
    }

    function test_setGoldTokenNonOwnerReverts() public {
        Treasury newTreasury = new Treasury(admin, devWallet);
        vm.prank(unauthorized);
        vm.expectRevert();
        newTreasury.setGoldToken(address(gold));
    }

    function test_setGoldTokenZeroAddressReverts() public {
        Treasury newTreasury = new Treasury(admin, devWallet);
        vm.prank(admin);
        vm.expectRevert(Treasury.ZeroAddress.selector);
        newTreasury.setGoldToken(address(0));
    }

    // ──────────── setDevWallet ────────────

    function test_setDevWallet() public {
        address newDev = makeAddr("newDev");
        vm.prank(admin);
        vm.expectEmit(true, true, false, false);
        emit Treasury.DevWalletUpdated(devWallet, newDev);
        treasury.setDevWallet(newDev);
        assertEq(treasury.devWallet(), newDev);
    }

    function test_setDevWalletNonOwnerReverts() public {
        vm.prank(unauthorized);
        vm.expectRevert();
        treasury.setDevWallet(makeAddr("newDev"));
    }

    function test_setDevWalletZeroAddressReverts() public {
        vm.prank(admin);
        vm.expectRevert(Treasury.ZeroAddress.selector);
        treasury.setDevWallet(address(0));
    }

    // ──────────── setAuthorized ────────────

    function test_setAuthorized() public {
        address newContract = makeAddr("newContract");
        vm.prank(admin);
        vm.expectEmit(true, false, false, true);
        emit Treasury.AuthorizationUpdated(newContract, true);
        treasury.setAuthorized(newContract, true);
        assertTrue(treasury.authorized(newContract));
    }

    function test_revokeAuthorized() public {
        vm.prank(admin);
        treasury.setAuthorized(authorizedCaller, false);
        assertFalse(treasury.authorized(authorizedCaller));
    }

    function test_setAuthorizedNonOwnerReverts() public {
        vm.prank(unauthorized);
        vm.expectRevert();
        treasury.setAuthorized(makeAddr("x"), true);
    }

    // ──────────── processFee ────────────

    function test_processFeeSplit() public {
        uint256 feeAmount = 10_000e18;
        uint256 expectedBurn = (feeAmount * 8500) / 10_000;
        uint256 expectedDev = feeAmount - expectedBurn;

        uint256 totalSupplyBefore = gold.totalSupply();
        uint256 devBalBefore = gold.balanceOf(devWallet);
        uint256 treasuryBalBefore = gold.balanceOf(address(treasury));

        vm.startPrank(authorizedCaller);
        gold.approve(address(treasury), feeAmount);
        treasury.processFee(feeAmount);
        vm.stopPrank();

        // 85% burned
        assertEq(gold.totalSupply(), totalSupplyBefore - expectedBurn);
        // 15% to dev
        assertEq(gold.balanceOf(devWallet), devBalBefore + expectedDev);
        // Treasury balance unchanged (fees pass through, don't accumulate)
        assertEq(gold.balanceOf(address(treasury)), treasuryBalBefore);
    }

    function test_processFeeSmallAmount_reverts() public {
        // T-03 (2026-04-20): processFee now rejects amount < BPS_DENOMINATOR.
        // Previously 1 wei would split as burn=0, dev=1 — sending 100% to
        // dev instead of the advertised 85/15. Rejection restores the
        // contract.
        uint256 feeAmount = 1;

        vm.startPrank(authorizedCaller);
        gold.approve(address(treasury), feeAmount);
        vm.expectRevert(
            abi.encodeWithSelector(Treasury.AmountBelowMinimum.selector, feeAmount, treasury.BPS_DENOMINATOR())
        );
        treasury.processFee(feeAmount);
        vm.stopPrank();
    }

    function test_processFeeUnauthorizedReverts() public {
        vm.prank(unauthorized);
        vm.expectRevert(Treasury.NotAuthorized.selector);
        treasury.processFee(1000e18);
    }

    function test_processFeeZeroAmountReverts() public {
        vm.prank(authorizedCaller);
        vm.expectRevert(Treasury.ZeroAmount.selector);
        treasury.processFee(0);
    }

    function test_processFeeInsufficientAllowanceReverts() public {
        vm.prank(authorizedCaller);
        // No approve
        vm.expectRevert();
        treasury.processFee(1000e18);
    }

    function test_processFeeEmitsEvent() public {
        uint256 feeAmount = 5000e18;
        uint256 expectedBurn = (feeAmount * 8500) / 10_000;
        uint256 expectedDev = feeAmount - expectedBurn;

        vm.startPrank(authorizedCaller);
        gold.approve(address(treasury), feeAmount);

        vm.expectEmit(true, false, false, true);
        emit Treasury.FeeProcessed(authorizedCaller, feeAmount, expectedBurn, expectedDev);
        treasury.processFee(feeAmount);
        vm.stopPrank();
    }

    function test_processFeeMultipleCalls() public {
        vm.startPrank(authorizedCaller);
        gold.approve(address(treasury), 100_000e18);

        treasury.processFee(10_000e18);
        treasury.processFee(20_000e18);
        treasury.processFee(30_000e18);
        vm.stopPrank();

        uint256 totalFees = 60_000e18;
        uint256 expectedDev = totalFees - (totalFees * 8500) / 10_000;
        assertEq(gold.balanceOf(devWallet), expectedDev);
    }

    // ──────────── Ownership ────────────

    function test_ownershipTransfer() public {
        address newOwner = makeAddr("newOwner");
        vm.prank(admin);
        treasury.transferOwnership(newOwner);
        // Still admin until accepted
        assertEq(treasury.owner(), admin);

        vm.prank(newOwner);
        treasury.acceptOwnership();
        assertEq(treasury.owner(), newOwner);
    }

    // ──────────── Fuzz ────────────

    function testFuzz_processFeeSplitIsExact(uint256 amount) public {
        // T-03: min amount is BPS_DENOMINATOR (10_000 wei).
        amount = bound(amount, treasury.BPS_DENOMINATOR(), 1_000_000e18);

        // Ensure caller has enough
        vm.prank(lpAddress);
        gold.transfer(authorizedCaller, amount);

        uint256 totalSupplyBefore = gold.totalSupply();
        uint256 devBalBefore = gold.balanceOf(devWallet);

        vm.startPrank(authorizedCaller);
        gold.approve(address(treasury), amount);
        treasury.processFee(amount);
        vm.stopPrank();

        uint256 burned = totalSupplyBefore - gold.totalSupply();
        uint256 devReceived = gold.balanceOf(devWallet) - devBalBefore;

        // burned + devReceived must equal the fee amount exactly
        assertEq(burned + devReceived, amount);
    }
}
