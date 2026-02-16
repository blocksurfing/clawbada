// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ClawToken} from "../contracts/ClawToken.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";

contract ClawTokenTest is Test {
    ClawToken claw;

    address admin = makeAddr("admin");
    address lpAddress = makeAddr("lpAddress");
    address treasuryAddress = makeAddr("treasuryAddress");
    address minter = makeAddr("minter");
    address user = makeAddr("user");

    function setUp() public {
        vm.prank(admin);
        claw = new ClawToken(admin, lpAddress, treasuryAddress);
    }

    // ──────────── Constructor ────────────

    function test_initialMints() public view {
        assertEq(claw.balanceOf(lpAddress), 125_000_000e18);
        assertEq(claw.balanceOf(treasuryAddress), 100_000_000e18);
        assertEq(claw.totalSupply(), 225_000_000e18);
    }

    function test_nameAndSymbol() public view {
        assertEq(claw.name(), "Clawbada");
        assertEq(claw.symbol(), "CLAW");
    }

    function test_decimals() public view {
        assertEq(claw.decimals(), 18);
    }

    function test_maxSupply() public view {
        assertEq(claw.MAX_SUPPLY(), 1_000_000_000e18);
    }

    function test_adminRole() public view {
        assertTrue(claw.hasRole(claw.DEFAULT_ADMIN_ROLE(), admin));
    }

    function test_constructorZeroAdminReverts() public {
        vm.expectRevert(ClawToken.ZeroAddress.selector);
        new ClawToken(address(0), lpAddress, treasuryAddress);
    }

    function test_constructorZeroLPReverts() public {
        vm.expectRevert(ClawToken.ZeroAddress.selector);
        new ClawToken(admin, address(0), treasuryAddress);
    }

    function test_constructorZeroTreasuryReverts() public {
        vm.expectRevert(ClawToken.ZeroAddress.selector);
        new ClawToken(admin, lpAddress, address(0));
    }

    // ──────────── Minting ────────────

    function test_mintWithMinterRole() public {
        bytes32 role = claw.MINTER_ROLE();
        vm.prank(admin);
        claw.grantRole(role, minter);

        vm.prank(minter);
        claw.mint(user, 1000e18);
        assertEq(claw.balanceOf(user), 1000e18);
    }

    function test_mintWithoutMinterRoleReverts() public {
        vm.prank(user);
        vm.expectRevert();
        claw.mint(user, 1000e18);
    }

    function test_mintExceedsMaxSupplyReverts() public {
        bytes32 role = claw.MINTER_ROLE();
        vm.prank(admin);
        claw.grantRole(role, minter);

        uint256 remaining = claw.remainingMintable();
        vm.prank(minter);
        vm.expectRevert(abi.encodeWithSelector(ClawToken.ExceedsMaxSupply.selector, remaining + 1, remaining));
        claw.mint(user, remaining + 1);
    }

    function test_mintExactlyToMaxSupply() public {
        bytes32 role = claw.MINTER_ROLE();
        vm.prank(admin);
        claw.grantRole(role, minter);

        uint256 remaining = claw.remainingMintable();
        vm.prank(minter);
        claw.mint(user, remaining);
        assertEq(claw.totalSupply(), claw.MAX_SUPPLY());
        assertEq(claw.remainingMintable(), 0);
    }

    function test_mintAfterMaxSupplyReverts() public {
        bytes32 role = claw.MINTER_ROLE();
        vm.prank(admin);
        claw.grantRole(role, minter);

        uint256 remaining = claw.remainingMintable();
        vm.prank(minter);
        claw.mint(user, remaining);

        vm.prank(minter);
        vm.expectRevert(abi.encodeWithSelector(ClawToken.ExceedsMaxSupply.selector, 1, 0));
        claw.mint(user, 1);
    }

    // ──────────── remainingMintable ────────────

    function test_remainingMintable() public view {
        assertEq(claw.remainingMintable(), 775_000_000e18);
    }

    // ──────────── Burn ────────────

    function test_burn() public {
        uint256 balBefore = claw.balanceOf(lpAddress);
        uint256 supplyBefore = claw.totalSupply();

        vm.prank(lpAddress);
        claw.burn(1000e18);

        assertEq(claw.balanceOf(lpAddress), balBefore - 1000e18);
        assertEq(claw.totalSupply(), supplyBefore - 1000e18);
    }

    function test_burnFrom() public {
        vm.prank(lpAddress);
        claw.approve(user, 500e18);

        vm.prank(user);
        claw.burnFrom(lpAddress, 500e18);

        assertEq(claw.balanceOf(lpAddress), 125_000_000e18 - 500e18);
    }

    function test_burnFromInsufficientAllowanceReverts() public {
        vm.prank(user);
        vm.expectRevert();
        claw.burnFrom(lpAddress, 500e18);
    }

    // ──────────── Transfer ────────────

    function test_transfer() public {
        vm.prank(lpAddress);
        claw.transfer(user, 100e18);
        assertEq(claw.balanceOf(user), 100e18);
    }

    function test_approveAndTransferFrom() public {
        vm.prank(lpAddress);
        claw.approve(user, 200e18);

        vm.prank(user);
        claw.transferFrom(lpAddress, user, 200e18);
        assertEq(claw.balanceOf(user), 200e18);
    }

    // ──────────── Role Management ────────────

    function test_grantAndRevokeMinterRole() public {
        vm.startPrank(admin);
        claw.grantRole(claw.MINTER_ROLE(), minter);
        assertTrue(claw.hasRole(claw.MINTER_ROLE(), minter));

        claw.revokeRole(claw.MINTER_ROLE(), minter);
        assertFalse(claw.hasRole(claw.MINTER_ROLE(), minter));
        vm.stopPrank();
    }

    function test_nonAdminCannotGrantRoles() public {
        bytes32 role = claw.MINTER_ROLE();
        vm.prank(user);
        vm.expectRevert();
        claw.grantRole(role, user);
    }

    // ──────────── Fuzz ────────────

    function testFuzz_mintNeverExceedsMaxSupply(uint256 amount) public {
        amount = bound(amount, 1, 775_000_000e18);

        bytes32 role = claw.MINTER_ROLE();
        vm.prank(admin);
        claw.grantRole(role, minter);

        vm.prank(minter);
        claw.mint(user, amount);
        assertLe(claw.totalSupply(), claw.MAX_SUPPLY());
    }
}
