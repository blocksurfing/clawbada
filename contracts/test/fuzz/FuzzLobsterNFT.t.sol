// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {LobsterNFT} from "../../LobsterNFT.sol";
import {DNALib} from "../../libraries/DNALib.sol";

/// @dev Fuzz tests for LobsterNFT transfer restrictions, state bounds, and role enforcement.
contract FuzzLobsterNFT is Test {
    LobsterNFT internal nft;
    address    internal admin   = makeAddr("admin");
    address    internal alice   = makeAddr("alice");
    address    internal bob     = makeAddr("bob");

    function setUp() public {
        vm.startPrank(admin);
        nft = new LobsterNFT(admin, "https://api.clawbada.xyz/lobster/");
        nft.grantRole(nft.MINTER_ROLE(),  admin);
        nft.grantRole(nft.LOCKER_ROLE(),  admin);
        nft.grantRole(nft.EVOLVER_ROLE(), admin);
        nft.grantRole(nft.DAMAGE_ROLE(),  admin);
        nft.grantRole(nft.BURNER_ROLE(),  admin);
        nft.grantRole(nft.BREED_ROLE(),   admin);
        vm.stopPrank();
    }

    function _dna(uint8 class_) internal pure returns (uint256) {
        uint8[18] memory alleles;
        for (uint256 i = 0; i < 18; i++) {
            alleles[i] = (class_ << 4);
        }
        return DNALib.encode(class_, 0, 0, alleles);
    }

    function _mint(address to, uint8 class_) internal returns (uint256 tokenId) {
        vm.prank(admin);
        tokenId = nft.mint(to, _dna(class_), false);
    }

    // ── Soulbound cannot be transferred ───────────────────────────

    function testFuzz_soulbound_transfer_reverts(address to) public {
        vm.assume(to != address(0) && to != alice);

        vm.prank(admin);
        uint256 tokenId = nft.mint(alice, _dna(0), true);

        vm.prank(alice);
        nft.setApprovalForAll(address(this), true);

        vm.expectRevert(abi.encodeWithSelector(LobsterNFT.LobsterIsSoulbound.selector, tokenId));
        vm.prank(alice);
        nft.safeTransferFrom(alice, to, tokenId, 1, "");
    }

    // ── Locked cannot be transferred ──────────────────────────────

    function testFuzz_locked_transfer_reverts(address to) public {
        vm.assume(to != address(0) && to != alice);

        uint256 tokenId = _mint(alice, 1);

        vm.prank(admin);
        nft.setLocked(tokenId, true);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(LobsterNFT.LobsterIsLocked.selector, tokenId));
        nft.safeTransferFrom(alice, to, tokenId, 1, "");
    }

    // ── Non-soulbound, non-locked can be transferred ──────────────

    function test_unlocked_transfer_succeeds() public {
        uint256 tokenId = _mint(alice, 2);

        vm.prank(alice);
        nft.safeTransferFrom(alice, bob, tokenId, 1, "");

        assertEq(nft.ownerOf(tokenId), bob);
    }

    // ── Damage bounds ─────────────────────────────────────────────

    function testFuzz_damage_bounded(uint8 damage) public {
        uint256 tokenId = _mint(alice, 0);

        if (damage > nft.MAX_DAMAGE()) {
            vm.prank(admin);
            vm.expectRevert(abi.encodeWithSelector(LobsterNFT.DamageExceedsMax.selector, damage));
            nft.setDamage(tokenId, damage);
        } else {
            vm.prank(admin);
            nft.setDamage(tokenId, damage);
            assertEq(nft.getDamage(tokenId), damage);
        }
    }

    // ── Evolution tier bounds ─────────────────────────────────────

    function testFuzz_evolution_tier_bounded(uint8 tier) public {
        uint256 tokenId = _mint(alice, 0);

        if (tier > nft.MAX_EVOLUTION_TIER()) {
            vm.prank(admin);
            vm.expectRevert(abi.encodeWithSelector(LobsterNFT.InvalidEvolutionTier.selector, tier));
            nft.setEvolutionTier(tokenId, tier);
        } else {
            vm.prank(admin);
            nft.setEvolutionTier(tokenId, tier);
            assertEq(nft.getEvolutionTier(tokenId), tier);
        }
    }

    // ── Breed count bounded ───────────────────────────────────────

    function test_breed_count_max() public {
        uint256 tokenId = _mint(alice, 0);

        // Increment 5 times successfully
        for (uint256 i = 0; i < 5; i++) {
            vm.prank(admin);
            nft.incrementBreedCount(tokenId);
        }
        assertEq(nft.getBreedCount(tokenId), 5);

        // 6th increment reverts
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(LobsterNFT.BreedCountExceeded.selector, tokenId));
        nft.incrementBreedCount(tokenId);
    }

    function testFuzz_breed_count_never_exceeds_max(uint8 increments) public {
        increments = uint8(bound(increments, 0, 10));
        uint256 tokenId = _mint(alice, 0);

        uint256 actualIncrements = 0;
        for (uint256 i = 0; i < increments; i++) {
            if (actualIncrements < nft.MAX_BREED_COUNT()) {
                vm.prank(admin);
                nft.incrementBreedCount(tokenId);
                actualIncrements++;
            } else {
                vm.prank(admin);
                vm.expectRevert();
                nft.incrementBreedCount(tokenId);
            }
        }

        assertLe(nft.getBreedCount(tokenId), nft.MAX_BREED_COUNT());
    }

    // ── Burn removes lobster ──────────────────────────────────────

    function test_burn_removes_lobster() public {
        uint256 tokenId = _mint(alice, 0);
        assertTrue(nft.exists(tokenId));

        vm.prank(admin);
        nft.burn(tokenId);

        assertFalse(nft.exists(tokenId));
    }

    function test_burn_locked_reverts() public {
        uint256 tokenId = _mint(alice, 0);

        vm.prank(admin);
        nft.setLocked(tokenId, true);

        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(LobsterNFT.LobsterIsLocked.selector, tokenId));
        nft.burn(tokenId);
    }

    // ── Token ID increments ───────────────────────────────────────

    function testFuzz_token_ids_increment(uint8 n) public {
        n = uint8(bound(n, 1, 10));
        uint256 startId = nft.nextTokenId();
        for (uint256 i = 0; i < n; i++) {
            _mint(alice, 0);
        }
        assertEq(nft.nextTokenId(), startId + n);
    }

    // ── Role enforcement ──────────────────────────────────────────

    function testFuzz_unauthorized_mint_reverts(address caller) public {
        vm.assume(caller != admin);
        vm.prank(caller);
        vm.expectRevert();
        nft.mint(alice, _dna(0), false);
    }

    function testFuzz_unauthorized_setLocked_reverts(address caller) public {
        vm.assume(caller != admin);
        uint256 tokenId = _mint(alice, 0);
        vm.prank(caller);
        vm.expectRevert();
        nft.setLocked(tokenId, true);
    }

    function testFuzz_unauthorized_setDamage_reverts(address caller) public {
        vm.assume(caller != admin);
        uint256 tokenId = _mint(alice, 0);
        vm.prank(caller);
        vm.expectRevert();
        nft.setDamage(tokenId, 10);
    }

    // ── Nonexistent token reverts ─────────────────────────────────

    function testFuzz_nonexistent_getLobster_reverts(uint256 tokenId) public {
        vm.assume(!nft.exists(tokenId));
        vm.expectRevert();
        nft.getLobster(tokenId);
    }

    // ── mintWithGeneration offspring not soulbound ────────────────

    function testFuzz_mint_with_generation_not_soulbound(uint8 gen) public {
        vm.prank(admin);
        uint256 tokenId = nft.mintWithGeneration(alice, _dna(0), gen);
        assertFalse(nft.isSoulbound(tokenId));
        assertEq(nft.getGeneration(tokenId), gen);
    }

    // ── Invalid DNA reverts ───────────────────────────────────────

    function test_mint_invalid_dna_reverts() public {
        // DNA with class=10 (invalid)
        uint256 badDna = uint256(10) << 252;
        vm.prank(admin);
        vm.expectRevert(LobsterNFT.InvalidDNA.selector);
        nft.mint(alice, badDna, false);
    }

    // ── ownerOf tracks correctly ──────────────────────────────────

    function test_ownerOf_after_transfer() public {
        uint256 tokenId = _mint(alice, 0);
        assertEq(nft.ownerOf(tokenId), alice);

        vm.prank(alice);
        nft.safeTransferFrom(alice, bob, tokenId, 1, "");
        assertEq(nft.ownerOf(tokenId), bob);
    }
}
