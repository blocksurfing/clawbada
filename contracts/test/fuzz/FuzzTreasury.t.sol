// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Treasury} from "../../Treasury.sol";
import {ClawToken} from "../../ClawToken.sol";

/// @dev Fuzz tests for Treasury fee-split math and access control.
contract FuzzTreasury is Test {
    Treasury   internal treasury;
    ClawToken  internal claw;
    address    internal admin     = makeAddr("admin");
    address    internal devWallet = makeAddr("dev");
    address    internal lpWallet  = makeAddr("lp");
    address    internal authorized = makeAddr("authorized");

    function setUp() public {
        vm.startPrank(admin);
        treasury = new Treasury(admin, devWallet);
        claw     = new ClawToken(admin, lpWallet, address(treasury));
        treasury.setClawToken(address(claw));
        treasury.setAuthorized(authorized, true);
        claw.grantRole(claw.MINTER_ROLE(), authorized);
        vm.stopPrank();
    }

    // ── Fee split: no token loss ───────────────────────────────────

    function testFuzz_fee_split_no_loss(uint256 amount) public {
        // Cap to realistic amounts
        amount = bound(amount, 1, claw.balanceOf(lpWallet));

        // Give authorized some CLAW
        vm.prank(lpWallet);
        claw.transfer(authorized, amount);

        uint256 devBefore    = claw.balanceOf(devWallet);
        uint256 supplyBefore = claw.totalSupply();

        // Approve treasury then process fee
        vm.startPrank(authorized);
        claw.approve(address(treasury), amount);
        treasury.processFee(amount);
        vm.stopPrank();

        uint256 burned  = supplyBefore - claw.totalSupply();
        uint256 devGot  = claw.balanceOf(devWallet) - devBefore;

        // No dust: burned + devGot == amount
        assertEq(burned + devGot, amount, "burn+dev must equal amount");
    }

    // ── Fee split proportions ─────────────────────────────────────

    function testFuzz_fee_split_proportions(uint256 amount) public {
        amount = bound(amount, 100, claw.balanceOf(lpWallet)); // min 100 to avoid rounding issues

        vm.prank(lpWallet);
        claw.transfer(authorized, amount);

        uint256 supplyBefore = claw.totalSupply();
        uint256 devBefore    = claw.balanceOf(devWallet);

        vm.startPrank(authorized);
        claw.approve(address(treasury), amount);
        treasury.processFee(amount);
        vm.stopPrank();

        uint256 burned = supplyBefore - claw.totalSupply();
        uint256 devGot = claw.balanceOf(devWallet) - devBefore;

        uint256 expectedBurn = (amount * treasury.BURN_BPS()) / treasury.BPS_DENOMINATOR();
        uint256 expectedDev  = amount - expectedBurn; // remainder avoids rounding dust

        assertEq(burned, expectedBurn, "burn amount");
        assertEq(devGot,  expectedDev,  "dev amount");
    }

    // ── Access control ────────────────────────────────────────────

    function testFuzz_unauthorized_reverts(address caller) public {
        vm.assume(caller != authorized && caller != address(0));

        vm.prank(lpWallet);
        claw.transfer(caller, 1000e18);

        vm.startPrank(caller);
        claw.approve(address(treasury), 1000e18);
        vm.expectRevert(Treasury.NotAuthorized.selector);
        treasury.processFee(1000e18);
        vm.stopPrank();
    }

    function test_zero_amount_reverts() public {
        vm.startPrank(authorized);
        claw.approve(address(treasury), 0);
        vm.expectRevert(Treasury.ZeroAmount.selector);
        treasury.processFee(0);
        vm.stopPrank();
    }

    // ── Token not set ─────────────────────────────────────────────

    function test_claw_token_already_set_reverts() public {
        vm.prank(admin);
        vm.expectRevert(Treasury.TokenAlreadySet.selector);
        treasury.setClawToken(address(claw));
    }

    // ── Dev wallet update ─────────────────────────────────────────

    function test_set_dev_wallet_zero_reverts() public {
        vm.prank(admin);
        vm.expectRevert(Treasury.ZeroAddress.selector);
        treasury.setDevWallet(address(0));
    }

    function testFuzz_set_authorized_zero_reverts() public {
        vm.prank(admin);
        vm.expectRevert(Treasury.ZeroAddress.selector);
        treasury.setAuthorized(address(0), true);
    }

    // ── BPS constants ─────────────────────────────────────────────

    function test_bps_sum_to_10000() public view {
        assertEq(
            treasury.BURN_BPS() + treasury.DEV_BPS(),
            treasury.BPS_DENOMINATOR(),
            "BURN_BPS + DEV_BPS must equal 10000"
        );
    }
}
