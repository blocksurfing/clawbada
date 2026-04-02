// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ClawToken} from "../../ClawToken.sol";

/// @dev Fuzz tests for ClawToken supply cap and minting mechanics.
contract FuzzClawToken is Test {
    ClawToken internal claw;
    address   internal admin     = makeAddr("admin");
    address   internal lpWallet  = makeAddr("lp");
    address   internal treasury  = makeAddr("treasury");
    address   internal minter    = makeAddr("minter");
    address   internal alice     = makeAddr("alice");

    function setUp() public {
        vm.prank(admin);
        claw = new ClawToken(admin, lpWallet, treasury);

        bytes32 minterRole = claw.MINTER_ROLE(); // cache before prank (external call would consume prank)
        vm.prank(admin);
        claw.grantRole(minterRole, minter);
    }

    // ── Supply invariant ───────────────────────────────────────────

    function testFuzz_supply_plus_remaining_equals_max(uint256 mintAmt) public {
        uint256 remaining = claw.remainingMintable();
        mintAmt = bound(mintAmt, 1, remaining);

        vm.prank(minter);
        claw.mint(alice, mintAmt);

        assertEq(
            claw.totalSupply() + claw.remainingMintable(),
            claw.MAX_SUPPLY(),
            "supply + remaining must equal MAX_SUPPLY"
        );
    }

    function test_initial_supply_plus_remaining_equals_max() public view {
        assertEq(
            claw.totalSupply() + claw.remainingMintable(),
            claw.MAX_SUPPLY(),
            "invariant holds at deployment"
        );
    }

    function test_initial_supply_equals_lp_plus_treasury() public view {
        assertEq(
            claw.totalSupply(),
            claw.LP_ALLOCATION() + claw.TREASURY_ALLOCATION(),
            "initial supply = LP + treasury allocation"
        );
    }

    // ── Mint within cap ───────────────────────────────────────────

    function testFuzz_mint_within_cap_succeeds(uint256 amount) public {
        uint256 remaining = claw.remainingMintable();
        amount = bound(amount, 1, remaining);

        vm.prank(minter);
        claw.mint(alice, amount);

        assertEq(claw.balanceOf(alice), amount);
    }

    // ── Mint exceeds cap reverts ───────────────────────────────────

    function testFuzz_mint_exceeds_cap_reverts(uint256 excess) public {
        uint256 remaining = claw.remainingMintable();
        excess = bound(excess, 1, type(uint128).max);
        uint256 toMint = remaining + excess;

        vm.prank(minter);
        vm.expectRevert(abi.encodeWithSelector(ClawToken.ExceedsMaxSupply.selector, toMint, remaining));
        claw.mint(alice, toMint);
    }

    // ── Access control ────────────────────────────────────────────

    function testFuzz_non_minter_cannot_mint(address caller, uint256 amount) public {
        vm.assume(caller != admin && caller != minter);
        amount = bound(amount, 1, 1e18);

        vm.prank(caller);
        vm.expectRevert();
        claw.mint(alice, amount);
    }

    // ── Burn reduces supply ───────────────────────────────────────

    function testFuzz_burn_reduces_supply(uint256 burnAmt) public {
        uint256 lpBalance = claw.balanceOf(lpWallet);
        burnAmt = bound(burnAmt, 1, lpBalance);

        uint256 supplyBefore = claw.totalSupply();

        vm.prank(lpWallet);
        claw.burn(burnAmt);

        assertEq(claw.totalSupply(), supplyBefore - burnAmt, "burn reduces totalSupply");
        // remainingMintable increases after burn
        assertEq(claw.remainingMintable(), claw.MAX_SUPPLY() - claw.totalSupply());
    }

    // ── Zero address reverts ──────────────────────────────────────

    function test_constructor_zero_admin_reverts() public {
        vm.expectRevert(ClawToken.ZeroAddress.selector);
        new ClawToken(address(0), lpWallet, treasury);
    }

    function test_constructor_zero_lp_reverts() public {
        vm.expectRevert(ClawToken.ZeroAddress.selector);
        new ClawToken(admin, address(0), treasury);
    }

    function test_constructor_zero_treasury_reverts() public {
        vm.expectRevert(ClawToken.ZeroAddress.selector);
        new ClawToken(admin, lpWallet, address(0));
    }

    // ── Minting exactly remaining succeeds ────────────────────────

    function test_mint_exactly_remaining_succeeds() public {
        uint256 remaining = claw.remainingMintable();
        vm.prank(minter);
        claw.mint(alice, remaining);
        assertEq(claw.totalSupply(), claw.MAX_SUPPLY());
        assertEq(claw.remainingMintable(), 0);
    }
}
