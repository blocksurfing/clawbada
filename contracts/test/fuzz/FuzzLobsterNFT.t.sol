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

    // ─────────────────────────────────────────────────────────────
    // Phase 2 LobsterNFT pass — additional coverage
    // ─────────────────────────────────────────────────────────────

    // MED-04 regression (prior audit): _owners must be updated BEFORE
    // super._update, so a transfer-recipient callback reading ownerOf
    // sees the new owner rather than stale state.
    function test_MED04_ownerOf_consistentInCallback() public {
        uint256 tokenId = _mint(alice, 0);

        CallbackProbe probe = new CallbackProbe(address(nft), tokenId);
        vm.prank(alice);
        nft.safeTransferFrom(alice, address(probe), tokenId, 1, "");

        // Probe recorded the ownerOf result during its onERC1155Received.
        assertEq(probe.observedOwner(), address(probe), "callback saw new owner (MED-04)");
        assertEq(probe.observedBalance(), 1, "callback saw new balance");
    }

    // Soulbound lobsters CAN be burned (by design — evolution fuel).
    // Only unlocked soulbound lobsters; locked still reverts.
    function test_soulbound_canBeBurned() public {
        vm.prank(admin);
        uint256 tokenId = nft.mint(alice, _dna(0), true);
        assertTrue(nft.isSoulbound(tokenId));

        vm.prank(admin);
        nft.burn(tokenId);

        assertFalse(nft.exists(tokenId), "soulbound burn succeeds");
    }

    // Soulbound + locked: burn reverts LobsterIsLocked (lock check first).
    function test_soulbound_locked_burnReverts() public {
        vm.prank(admin);
        uint256 tokenId = nft.mint(alice, _dna(0), true);

        vm.prank(admin);
        nft.setLocked(tokenId, true);

        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(LobsterNFT.LobsterIsLocked.selector, tokenId));
        nft.burn(tokenId);
    }

    // decrementBreedCount reverts at 0.
    function test_decrementBreedCount_atZero_reverts() public {
        uint256 tokenId = _mint(alice, 0);
        assertEq(nft.getBreedCount(tokenId), 0);

        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(LobsterNFT.BreedCountExceeded.selector, tokenId));
        nft.decrementBreedCount(tokenId);
    }

    // decrementBreedCount after increment reduces count correctly.
    function test_decrementBreedCount_reducesCount() public {
        uint256 tokenId = _mint(alice, 0);

        vm.prank(admin);
        nft.incrementBreedCount(tokenId);
        vm.prank(admin);
        nft.incrementBreedCount(tokenId);
        assertEq(nft.getBreedCount(tokenId), 2);

        vm.prank(admin);
        nft.decrementBreedCount(tokenId);
        assertEq(nft.getBreedCount(tokenId), 1);
    }

    // Batch transfer: if any token in the batch is soulbound or locked,
    // the whole batch reverts. Can't smuggle a restricted token inside
    // a mixed batch.
    function test_batchTransfer_mixedSoulbound_reverts() public {
        uint256 normal = _mint(alice, 0);
        vm.prank(admin);
        uint256 soulbound = nft.mint(alice, _dna(1), true);

        uint256[] memory ids = new uint256[](2);
        ids[0] = normal;
        ids[1] = soulbound;
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = 1;
        amounts[1] = 1;

        vm.expectRevert(abi.encodeWithSelector(LobsterNFT.LobsterIsSoulbound.selector, soulbound));
        vm.prank(alice);
        nft.safeBatchTransferFrom(alice, bob, ids, amounts, "");
    }

    function test_batchTransfer_mixedLocked_reverts() public {
        uint256 normal = _mint(alice, 0);
        uint256 locked = _mint(alice, 1);
        vm.prank(admin);
        nft.setLocked(locked, true);

        uint256[] memory ids = new uint256[](2);
        ids[0] = normal;
        ids[1] = locked;
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = 1;
        amounts[1] = 1;

        vm.expectRevert(abi.encodeWithSelector(LobsterNFT.LobsterIsLocked.selector, locked));
        vm.prank(alice);
        nft.safeBatchTransferFrom(alice, bob, ids, amounts, "");
    }

    // Unauthorized setEvolutionTier / burn / BREED_ROLE paths.
    function testFuzz_unauthorized_setEvolutionTier_reverts(address caller) public {
        vm.assume(caller != admin);
        uint256 tokenId = _mint(alice, 0);
        vm.prank(caller);
        vm.expectRevert();
        nft.setEvolutionTier(tokenId, 1);
    }

    function testFuzz_unauthorized_burn_reverts(address caller) public {
        vm.assume(caller != admin);
        uint256 tokenId = _mint(alice, 0);
        vm.prank(caller);
        vm.expectRevert();
        nft.burn(tokenId);
    }

    function testFuzz_unauthorized_incrementBreed_reverts(address caller) public {
        vm.assume(caller != admin);
        uint256 tokenId = _mint(alice, 0);
        vm.prank(caller);
        vm.expectRevert();
        nft.incrementBreedCount(tokenId);
    }

    function testFuzz_unauthorized_decrementBreed_reverts(address caller) public {
        vm.assume(caller != admin);
        uint256 tokenId = _mint(alice, 0);
        vm.prank(caller);
        vm.expectRevert();
        nft.decrementBreedCount(tokenId);
    }

    // After burn, _owners mapping is cleared. ownerOf() reverts TokenDoesNotExist.
    function test_ownerOf_afterBurn_reverts() public {
        uint256 tokenId = _mint(alice, 0);
        vm.prank(admin);
        nft.burn(tokenId);

        vm.expectRevert(abi.encodeWithSelector(LobsterNFT.TokenDoesNotExist.selector, tokenId));
        nft.ownerOf(tokenId);
    }

    // Transfer to zero-address is blocked by ERC-1155 base (not the
    // soulbound/locked branch, since `to == address(0)` skips our check).
    // Verify the base standard still rejects.
    function test_transferTo_zeroAddress_reverts() public {
        uint256 tokenId = _mint(alice, 0);

        vm.prank(alice);
        vm.expectRevert();
        nft.safeTransferFrom(alice, address(0), tokenId, 1, "");
    }

    // L-01: pre-fix, a zero-value transfer passed the soulbound/locked
    // checks and wrote `_owners[id] = attacker` while moving no balance.
    // Any unlocked, non-soulbound lobster could have its convenience owner
    // hijacked by anyone. Downstream contracts (TeamManager, BreedingLab,
    // BattleArena) trust ownerOf for gameplay authority, so the attacker
    // could lock victim lobsters into attacker teams, breed them, or enter
    // them into battles. Post-fix, `_update` rejects any value != 1.
    function test_L01_zeroValueTransfer_cannotHijackOwnerOf() public {
        uint256 tokenId = _mint(alice, 0);
        address attacker = makeAddr("L01-attacker");

        // Pre-fix this call would have updated `_owners[tokenId] = attacker`
        // while leaving balanceOf(alice, tokenId) == 1.
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(LobsterNFT.InvalidTransferAmount.selector, tokenId, 0));
        nft.safeTransferFrom(attacker, attacker, tokenId, 0, "");

        // Alice retains both balance and ownerOf.
        assertEq(nft.balanceOf(alice, tokenId), 1, "alice balance unchanged");
        assertEq(nft.ownerOf(tokenId), alice, "alice still recorded owner");
    }

    // L-01: even the victim themselves can't zero-transfer their own lobster
    // (would be pointless but also rejected, uniformly enforcing supply=1).
    function test_L01_zeroValueSelfTransfer_reverts() public {
        uint256 tokenId = _mint(alice, 0);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(LobsterNFT.InvalidTransferAmount.selector, tokenId, 0));
        nft.safeTransferFrom(alice, alice, tokenId, 0, "");
    }

    // L-01: fuzz values > 1 — all rejected. The value=0 case is covered
    // by the explicit test above; here we verify the supply=1 guard
    // catches arbitrary overflow attempts from 2 upward.
    function testFuzz_L01_nonUnitTransfer_reverts(uint256 amount) public {
        amount = bound(amount, 2, 100);
        uint256 tokenId = _mint(alice, 0);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(LobsterNFT.InvalidTransferAmount.selector, tokenId, amount));
        nft.safeTransferFrom(alice, bob, tokenId, amount, "");
    }

    // L-01 regression also blocks zero-value batch transfers.
    function test_L01_zeroValueBatchTransfer_reverts() public {
        uint256 t1 = _mint(alice, 0);
        uint256 t2 = _mint(alice, 1);

        uint256[] memory ids = new uint256[](2);
        ids[0] = t1;
        ids[1] = t2;
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = 1;
        amounts[1] = 0; // <-- the invalid one

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(LobsterNFT.InvalidTransferAmount.selector, t2, 0));
        nft.safeBatchTransferFrom(alice, bob, ids, amounts, "");
    }
}

/// @dev ERC-1155 receiver that snapshots ownerOf + balanceOf during the
///      acceptance callback. Used to verify MED-04: the overridden _update
///      writes `_owners[id] = to` BEFORE super._update, so a callback
///      reading ownerOf during the post-_update hook sees the new owner.
contract CallbackProbe {
    LobsterNFT internal immutable nft;
    uint256 internal immutable tokenId;
    address public observedOwner;
    uint256 public observedBalance;

    constructor(address nft_, uint256 tokenId_) {
        nft = LobsterNFT(nft_);
        tokenId = tokenId_;
    }

    function onERC1155Received(address, address, uint256 id, uint256, bytes calldata)
        external
        returns (bytes4)
    {
        observedOwner = nft.ownerOf(id);
        observedBalance = nft.balanceOf(address(this), id);
        return this.onERC1155Received.selector;
    }

    function onERC1155BatchReceived(address, address, uint256[] calldata, uint256[] calldata, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        return this.onERC1155BatchReceived.selector;
    }

    function supportsInterface(bytes4) external pure returns (bool) {
        return true;
    }
}
