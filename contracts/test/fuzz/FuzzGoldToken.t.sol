// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {GoldToken} from "../../GoldToken.sol";

/// @dev Fuzz tests for GoldToken supply cap and minting mechanics.
contract FuzzGoldToken is Test {
    GoldToken internal gold;
    address   internal admin     = makeAddr("admin");
    address   internal lpWallet  = makeAddr("lp");
    address   internal treasury  = makeAddr("treasury");
    address   internal minter    = makeAddr("minter");
    address   internal alice     = makeAddr("alice");

    function setUp() public {
        vm.prank(admin);
        gold = new GoldToken(admin, lpWallet, treasury);

        bytes32 minterRole = gold.MINTER_ROLE(); // cache before prank (external call would consume prank)
        vm.prank(admin);
        gold.grantRole(minterRole, minter);
    }

    // ── Supply invariant ───────────────────────────────────────────

    function testFuzz_supply_plus_remaining_equals_max(uint256 mintAmt) public {
        uint256 remaining = gold.remainingMintable();
        mintAmt = bound(mintAmt, 1, remaining);

        vm.prank(minter);
        gold.mint(alice, mintAmt);

        assertEq(
            gold.totalSupply() + gold.remainingMintable(),
            gold.MAX_SUPPLY(),
            "supply + remaining must equal MAX_SUPPLY"
        );
    }

    function test_initial_supply_plus_remaining_equals_max() public view {
        assertEq(
            gold.totalSupply() + gold.remainingMintable(),
            gold.MAX_SUPPLY(),
            "invariant holds at deployment"
        );
    }

    function test_initial_supply_equals_lp_plus_treasury() public view {
        assertEq(
            gold.totalSupply(),
            gold.LP_ALLOCATION() + gold.TREASURY_ALLOCATION(),
            "initial supply = LP + treasury allocation"
        );
    }

    // ── Mint within cap ───────────────────────────────────────────

    function testFuzz_mint_within_cap_succeeds(uint256 amount) public {
        uint256 remaining = gold.remainingMintable();
        amount = bound(amount, 1, remaining);

        vm.prank(minter);
        gold.mint(alice, amount);

        assertEq(gold.balanceOf(alice), amount);
    }

    // ── Mint exceeds cap reverts ───────────────────────────────────

    function testFuzz_mint_exceeds_cap_reverts(uint256 excess) public {
        uint256 remaining = gold.remainingMintable();
        excess = bound(excess, 1, type(uint128).max);
        uint256 toMint = remaining + excess;

        vm.prank(minter);
        vm.expectRevert(abi.encodeWithSelector(GoldToken.ExceedsMaxSupply.selector, toMint, remaining));
        gold.mint(alice, toMint);
    }

    // ── Access control ────────────────────────────────────────────

    function testFuzz_non_minter_cannot_mint(address caller, uint256 amount) public {
        vm.assume(caller != admin && caller != minter);
        amount = bound(amount, 1, 1e18);

        vm.prank(caller);
        vm.expectRevert();
        gold.mint(alice, amount);
    }

    // ── Burn reduces supply ───────────────────────────────────────

    function testFuzz_burn_reduces_supply(uint256 burnAmt) public {
        uint256 lpBalance = gold.balanceOf(lpWallet);
        burnAmt = bound(burnAmt, 1, lpBalance);

        uint256 supplyBefore = gold.totalSupply();

        vm.prank(lpWallet);
        gold.burn(burnAmt);

        assertEq(gold.totalSupply(), supplyBefore - burnAmt, "burn reduces totalSupply");
        // remainingMintable increases after burn
        assertEq(gold.remainingMintable(), gold.MAX_SUPPLY() - gold.totalSupply());
    }

    // ── Zero address reverts ──────────────────────────────────────

    function test_constructor_zero_admin_reverts() public {
        vm.expectRevert(GoldToken.ZeroAddress.selector);
        new GoldToken(address(0), lpWallet, treasury);
    }

    function test_constructor_zero_lp_reverts() public {
        vm.expectRevert(GoldToken.ZeroAddress.selector);
        new GoldToken(admin, address(0), treasury);
    }

    function test_constructor_zero_treasury_reverts() public {
        vm.expectRevert(GoldToken.ZeroAddress.selector);
        new GoldToken(admin, lpWallet, address(0));
    }

    // ── Minting exactly remaining succeeds ────────────────────────

    function test_mint_exactly_remaining_succeeds() public {
        uint256 remaining = gold.remainingMintable();
        vm.prank(minter);
        gold.mint(alice, remaining);
        assertEq(gold.totalSupply(), gold.MAX_SUPPLY());
        assertEq(gold.remainingMintable(), 0);
    }
}
