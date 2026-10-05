// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {GoldToken} from "../contracts/GoldToken.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";

contract GoldTokenTest is Test {
    GoldToken gold;

    address admin = makeAddr("admin");
    address lpAddress = makeAddr("lpAddress");
    address treasuryAddress = makeAddr("treasuryAddress");
    address minter = makeAddr("minter");
    address user = makeAddr("user");

    function setUp() public {
        vm.prank(admin);
        gold = new GoldToken(admin, lpAddress, treasuryAddress);
    }

    // ──────────── Constructor ────────────

    function test_initialMints() public view {
        assertEq(gold.balanceOf(lpAddress), 125_000_000e18);
        assertEq(gold.balanceOf(treasuryAddress), 100_000_000e18);
        assertEq(gold.totalSupply(), 225_000_000e18);
    }

    function test_nameAndSymbol() public view {
        assertEq(gold.name(), "Grubby Old Lost Doubloons");
        assertEq(gold.symbol(), "GOLD");
    }

    function test_decimals() public view {
        assertEq(gold.decimals(), 18);
    }

    function test_maxSupply() public view {
        assertEq(gold.MAX_SUPPLY(), 1_000_000_000e18);
    }

    function test_adminRole() public view {
        assertTrue(gold.hasRole(gold.DEFAULT_ADMIN_ROLE(), admin));
    }

    function test_constructorZeroAdminReverts() public {
        vm.expectRevert(GoldToken.ZeroAddress.selector);
        new GoldToken(address(0), lpAddress, treasuryAddress);
    }

    function test_constructorZeroLPReverts() public {
        vm.expectRevert(GoldToken.ZeroAddress.selector);
        new GoldToken(admin, address(0), treasuryAddress);
    }

    function test_constructorZeroTreasuryReverts() public {
        vm.expectRevert(GoldToken.ZeroAddress.selector);
        new GoldToken(admin, lpAddress, address(0));
    }

    // ──────────── Minting ────────────

    function test_mintWithMinterRole() public {
        bytes32 role = gold.MINTER_ROLE();
        vm.prank(admin);
        gold.grantRole(role, minter);

        vm.prank(minter);
        gold.mint(user, 1000e18);
        assertEq(gold.balanceOf(user), 1000e18);
    }

    function test_mintWithoutMinterRoleReverts() public {
        vm.prank(user);
        vm.expectRevert();
        gold.mint(user, 1000e18);
    }

    function test_mintExceedsMaxSupplyReverts() public {
        bytes32 role = gold.MINTER_ROLE();
        vm.prank(admin);
        gold.grantRole(role, minter);

        uint256 remaining = gold.remainingMintable();
        vm.prank(minter);
        vm.expectRevert(abi.encodeWithSelector(GoldToken.ExceedsMaxSupply.selector, remaining + 1, remaining));
        gold.mint(user, remaining + 1);
    }

    function test_mintExactlyToMaxSupply() public {
        bytes32 role = gold.MINTER_ROLE();
        vm.prank(admin);
        gold.grantRole(role, minter);

        uint256 remaining = gold.remainingMintable();
        vm.prank(minter);
        gold.mint(user, remaining);
        assertEq(gold.totalSupply(), gold.MAX_SUPPLY());
        assertEq(gold.remainingMintable(), 0);
    }

    function test_mintAfterMaxSupplyReverts() public {
        bytes32 role = gold.MINTER_ROLE();
        vm.prank(admin);
        gold.grantRole(role, minter);

        uint256 remaining = gold.remainingMintable();
        vm.prank(minter);
        gold.mint(user, remaining);

        vm.prank(minter);
        vm.expectRevert(abi.encodeWithSelector(GoldToken.ExceedsMaxSupply.selector, 1, 0));
        gold.mint(user, 1);
    }

    // ──────────── remainingMintable ────────────

    function test_remainingMintable() public view {
        assertEq(gold.remainingMintable(), 775_000_000e18);
    }

    // ──────────── Burn ────────────

    function test_burn() public {
        uint256 balBefore = gold.balanceOf(lpAddress);
        uint256 supplyBefore = gold.totalSupply();

        vm.prank(lpAddress);
        gold.burn(1000e18);

        assertEq(gold.balanceOf(lpAddress), balBefore - 1000e18);
        assertEq(gold.totalSupply(), supplyBefore - 1000e18);
    }

    function test_burnFrom() public {
        vm.prank(lpAddress);
        gold.approve(user, 500e18);

        vm.prank(user);
        gold.burnFrom(lpAddress, 500e18);

        assertEq(gold.balanceOf(lpAddress), 125_000_000e18 - 500e18);
    }

    function test_burnFromInsufficientAllowanceReverts() public {
        vm.prank(user);
        vm.expectRevert();
        gold.burnFrom(lpAddress, 500e18);
    }

    // ──────────── Transfer ────────────

    function test_transfer() public {
        vm.prank(lpAddress);
        gold.transfer(user, 100e18);
        assertEq(gold.balanceOf(user), 100e18);
    }

    function test_approveAndTransferFrom() public {
        vm.prank(lpAddress);
        gold.approve(user, 200e18);

        vm.prank(user);
        gold.transferFrom(lpAddress, user, 200e18);
        assertEq(gold.balanceOf(user), 200e18);
    }

    // ──────────── Role Management ────────────

    function test_grantAndRevokeMinterRole() public {
        vm.startPrank(admin);
        gold.grantRole(gold.MINTER_ROLE(), minter);
        assertTrue(gold.hasRole(gold.MINTER_ROLE(), minter));

        gold.revokeRole(gold.MINTER_ROLE(), minter);
        assertFalse(gold.hasRole(gold.MINTER_ROLE(), minter));
        vm.stopPrank();
    }

    function test_nonAdminCannotGrantRoles() public {
        bytes32 role = gold.MINTER_ROLE();
        vm.prank(user);
        vm.expectRevert();
        gold.grantRole(role, user);
    }

    // ──────────── Fuzz ────────────

    function testFuzz_mintNeverExceedsMaxSupply(uint256 amount) public {
        amount = bound(amount, 1, 775_000_000e18);

        bytes32 role = gold.MINTER_ROLE();
        vm.prank(admin);
        gold.grantRole(role, minter);

        vm.prank(minter);
        gold.mint(user, amount);
        assertLe(gold.totalSupply(), gold.MAX_SUPPLY());
    }
}
