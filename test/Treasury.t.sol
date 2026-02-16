// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Treasury, IClawBurnable} from "../contracts/Treasury.sol";
import {ClawToken} from "../contracts/ClawToken.sol";

contract TreasuryTest is Test {
    Treasury treasury;
    ClawToken claw;

    address admin = makeAddr("admin");
    address devWallet = makeAddr("devWallet");
    address lpAddress = makeAddr("lpAddress");
    address authorizedCaller = makeAddr("authorizedCaller");
    address unauthorized = makeAddr("unauthorized");

    function setUp() public {
        vm.startPrank(admin);

        treasury = new Treasury(admin, devWallet);
        claw = new ClawToken(admin, lpAddress, address(treasury));
        treasury.setClawToken(address(claw));
        treasury.setAuthorized(authorizedCaller, true);

        vm.stopPrank();

        // Give the authorized caller some CLAW to pay fees with
        vm.prank(lpAddress);
        claw.transfer(authorizedCaller, 1_000_000e18);
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

    // ──────────── setClawToken ────────────

    function test_setClawTokenOnce() public view {
        assertEq(address(treasury.clawToken()), address(claw));
    }

    function test_setClawTokenTwiceReverts() public {
        vm.prank(admin);
        vm.expectRevert(Treasury.TokenAlreadySet.selector);
        treasury.setClawToken(address(claw));
    }

    function test_setClawTokenNonOwnerReverts() public {
        Treasury newTreasury = new Treasury(admin, devWallet);
        vm.prank(unauthorized);
        vm.expectRevert();
        newTreasury.setClawToken(address(claw));
    }

    function test_setClawTokenZeroAddressReverts() public {
        Treasury newTreasury = new Treasury(admin, devWallet);
        vm.prank(admin);
        vm.expectRevert(Treasury.ZeroAddress.selector);
        newTreasury.setClawToken(address(0));
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

        uint256 totalSupplyBefore = claw.totalSupply();
        uint256 devBalBefore = claw.balanceOf(devWallet);
        uint256 treasuryBalBefore = claw.balanceOf(address(treasury));

        vm.startPrank(authorizedCaller);
        claw.approve(address(treasury), feeAmount);
        treasury.processFee(feeAmount);
        vm.stopPrank();

        // 85% burned
        assertEq(claw.totalSupply(), totalSupplyBefore - expectedBurn);
        // 15% to dev
        assertEq(claw.balanceOf(devWallet), devBalBefore + expectedDev);
        // Treasury balance unchanged (fees pass through, don't accumulate)
        assertEq(claw.balanceOf(address(treasury)), treasuryBalBefore);
    }

    function test_processFeeSmallAmount() public {
        // 1 wei — burn = 0, dev = 1
        uint256 feeAmount = 1;
        uint256 expectedBurn = 0; // (1 * 8500) / 10000 = 0
        uint256 expectedDev = 1;

        vm.startPrank(authorizedCaller);
        claw.approve(address(treasury), feeAmount);
        treasury.processFee(feeAmount);
        vm.stopPrank();

        assertEq(claw.balanceOf(devWallet), expectedDev);
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
        claw.approve(address(treasury), feeAmount);

        vm.expectEmit(true, false, false, true);
        emit Treasury.FeeProcessed(authorizedCaller, feeAmount, expectedBurn, expectedDev);
        treasury.processFee(feeAmount);
        vm.stopPrank();
    }

    function test_processFeeMultipleCalls() public {
        vm.startPrank(authorizedCaller);
        claw.approve(address(treasury), 100_000e18);

        treasury.processFee(10_000e18);
        treasury.processFee(20_000e18);
        treasury.processFee(30_000e18);
        vm.stopPrank();

        uint256 totalFees = 60_000e18;
        uint256 expectedDev = totalFees - (totalFees * 8500) / 10_000;
        assertEq(claw.balanceOf(devWallet), expectedDev);
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
        amount = bound(amount, 1, 1_000_000e18);

        // Ensure caller has enough
        vm.prank(lpAddress);
        claw.transfer(authorizedCaller, amount);

        uint256 totalSupplyBefore = claw.totalSupply();
        uint256 devBalBefore = claw.balanceOf(devWallet);

        vm.startPrank(authorizedCaller);
        claw.approve(address(treasury), amount);
        treasury.processFee(amount);
        vm.stopPrank();

        uint256 burned = totalSupplyBefore - claw.totalSupply();
        uint256 devReceived = claw.balanceOf(devWallet) - devBalBefore;

        // burned + devReceived must equal the fee amount exactly
        assertEq(burned + devReceived, amount);
    }
}
