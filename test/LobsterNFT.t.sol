// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {LobsterNFT} from "../contracts/LobsterNFT.sol";
import {DNALib} from "../contracts/libraries/DNALib.sol";

contract LobsterNFTTest is Test {
    LobsterNFT nft;

    address admin = makeAddr("admin");
    address minter = makeAddr("minter");
    address locker = makeAddr("locker");
    address evolver = makeAddr("evolver");
    address damager = makeAddr("damager");
    address burner = makeAddr("burner");
    address breeder = makeAddr("breeder");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    uint256 validDNA;

    function setUp() public {
        vm.startPrank(admin);
        nft = new LobsterNFT(admin, "https://api.clawbada.com/lobster/");
        nft.grantRole(nft.MINTER_ROLE(), minter);
        nft.grantRole(nft.LOCKER_ROLE(), locker);
        nft.grantRole(nft.EVOLVER_ROLE(), evolver);
        nft.grantRole(nft.DAMAGE_ROLE(), damager);
        nft.grantRole(nft.BURNER_ROLE(), burner);
        nft.grantRole(nft.BREED_ROLE(), breeder);
        vm.stopPrank();

        // Build a valid DNA: class 3, legend 0, breed type 5, all alleles affinity 3 variant 7
        uint8[18] memory alleles;
        for (uint256 i = 0; i < 18; i++) {
            alleles[i] = 0x37; // affinity=3, variant=7
        }
        validDNA = DNALib.encode(3, 0, 5, alleles);
    }

    // ──────────── Helpers ────────────

    function _mintLobster(address to, bool soulbound) internal returns (uint256) {
        vm.prank(minter);
        return nft.mint(to, validDNA, soulbound);
    }

    function _mintLobsterWithGen(address to, uint8 gen) internal returns (uint256) {
        vm.prank(minter);
        return nft.mintWithGeneration(to, validDNA, gen);
    }

    // ──────────── Minting ────────────

    function test_mintBasic() public {
        uint256 id = _mintLobster(alice, false);
        assertEq(id, 1);
        assertEq(nft.balanceOf(alice, id), 1);
        assertEq(nft.ownerOf(id), alice);
        assertEq(nft.totalMinted(), 1);
    }

    function test_mintSequentialIds() public {
        uint256 id1 = _mintLobster(alice, false);
        uint256 id2 = _mintLobster(alice, false);
        uint256 id3 = _mintLobster(bob, false);
        assertEq(id1, 1);
        assertEq(id2, 2);
        assertEq(id3, 3);
        assertEq(nft.totalMinted(), 3);
    }

    function test_mintSoulbound() public {
        uint256 id = _mintLobster(alice, true);
        assertTrue(nft.isSoulbound(id));
    }

    function test_mintNonSoulbound() public {
        uint256 id = _mintLobster(alice, false);
        assertFalse(nft.isSoulbound(id));
    }

    function test_mintInvalidDNAReverts() public {
        // DNA with class=15 is invalid
        uint256 badDNA = uint256(15) << 252;
        vm.prank(minter);
        vm.expectRevert(LobsterNFT.InvalidDNA.selector);
        nft.mint(alice, badDNA, false);
    }

    function test_mintZeroAddressReverts() public {
        vm.prank(minter);
        vm.expectRevert(LobsterNFT.ZeroAddress.selector);
        nft.mint(address(0), validDNA, false);
    }

    function test_mintWithoutRoleReverts() public {
        vm.prank(alice);
        vm.expectRevert();
        nft.mint(alice, validDNA, false);
    }

    function test_mintWithGeneration() public {
        uint256 id = _mintLobsterWithGen(alice, 3);
        assertEq(nft.getGeneration(id), 3);
        assertFalse(nft.isSoulbound(id)); // bred offspring never soulbound
    }

    function test_mintEmitsEvent() public {
        vm.prank(minter);
        vm.expectEmit(true, true, false, true);
        emit LobsterNFT.LobsterMinted(1, alice, validDNA, 0, false);
        nft.mint(alice, validDNA, false);
    }

    // ──────────── View Functions ────────────

    function test_getLobster() public {
        uint256 id = _mintLobster(alice, false);
        LobsterNFT.Lobster memory lob = nft.getLobster(id);
        assertEq(lob.dna, validDNA);
        assertEq(lob.evolutionTier, 0);
        assertEq(lob.damage, 0);
        assertEq(lob.breedCount, 0);
        assertEq(lob.generation, 0);
        assertFalse(lob.soulbound);
        assertFalse(lob.locked);
    }

    function test_getDNA() public {
        uint256 id = _mintLobster(alice, false);
        assertEq(nft.getDNA(id), validDNA);
    }

    function test_getPurity() public {
        uint256 id = _mintLobster(alice, false);
        // All alleles have affinity 3, class is 3 → purity should be 6
        assertEq(nft.getPurity(id), 6);
    }

    function test_nonexistentTokenReverts() public {
        vm.expectRevert(abi.encodeWithSelector(LobsterNFT.TokenDoesNotExist.selector, 999));
        nft.getLobster(999);
    }

    function test_uri() public {
        _mintLobster(alice, false);
        assertEq(nft.uri(1), "https://api.clawbada.com/lobster/1");
        _mintLobster(alice, false);
        assertEq(nft.uri(2), "https://api.clawbada.com/lobster/2");
    }

    // ──────────── Transfers ────────────

    function test_transferNonSoulboundUnlocked() public {
        uint256 id = _mintLobster(alice, false);
        vm.prank(alice);
        nft.safeTransferFrom(alice, bob, id, 1, "");
        assertEq(nft.ownerOf(id), bob);
        assertEq(nft.balanceOf(bob, id), 1);
        assertEq(nft.balanceOf(alice, id), 0);
    }

    function test_transferSoulboundReverts() public {
        uint256 id = _mintLobster(alice, true);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(LobsterNFT.LobsterIsSoulbound.selector, id));
        nft.safeTransferFrom(alice, bob, id, 1, "");
    }

    function test_transferLockedReverts() public {
        uint256 id = _mintLobster(alice, false);
        vm.prank(locker);
        nft.setLocked(id, true);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(LobsterNFT.LobsterIsLocked.selector, id));
        nft.safeTransferFrom(alice, bob, id, 1, "");
    }

    function test_batchTransfer() public {
        uint256 id1 = _mintLobster(alice, false);
        uint256 id2 = _mintLobster(alice, false);

        uint256[] memory ids = new uint256[](2);
        ids[0] = id1;
        ids[1] = id2;
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = 1;
        amounts[1] = 1;

        vm.prank(alice);
        nft.safeBatchTransferFrom(alice, bob, ids, amounts, "");
        assertEq(nft.ownerOf(id1), bob);
        assertEq(nft.ownerOf(id2), bob);
    }

    function test_batchTransferWithOneSoulboundReverts() public {
        uint256 id1 = _mintLobster(alice, false);
        uint256 id2 = _mintLobster(alice, true); // soulbound

        uint256[] memory ids = new uint256[](2);
        ids[0] = id1;
        ids[1] = id2;
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = 1;
        amounts[1] = 1;

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(LobsterNFT.LobsterIsSoulbound.selector, id2));
        nft.safeBatchTransferFrom(alice, bob, ids, amounts, "");
    }

    // ──────────── setLocked ────────────

    function test_setLocked() public {
        uint256 id = _mintLobster(alice, false);
        vm.prank(locker);
        nft.setLocked(id, true);
        assertTrue(nft.isLocked(id));

        vm.prank(locker);
        nft.setLocked(id, false);
        assertFalse(nft.isLocked(id));
    }

    function test_setLockedUnauthorizedReverts() public {
        uint256 id = _mintLobster(alice, false);
        vm.prank(alice);
        vm.expectRevert();
        nft.setLocked(id, true);
    }

    function test_unlockEnablesTransfer() public {
        uint256 id = _mintLobster(alice, false);
        vm.prank(locker);
        nft.setLocked(id, true);

        // Can't transfer while locked
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(LobsterNFT.LobsterIsLocked.selector, id));
        nft.safeTransferFrom(alice, bob, id, 1, "");

        // Unlock
        vm.prank(locker);
        nft.setLocked(id, false);

        // Now can transfer
        vm.prank(alice);
        nft.safeTransferFrom(alice, bob, id, 1, "");
        assertEq(nft.ownerOf(id), bob);
    }

    // ──────────── setDamage ────────────

    function test_setDamage() public {
        uint256 id = _mintLobster(alice, false);
        vm.prank(damager);
        nft.setDamage(id, 50);
        assertEq(nft.getDamage(id), 50);
    }

    function test_setDamageExceedsMaxReverts() public {
        uint256 id = _mintLobster(alice, false);
        vm.prank(damager);
        vm.expectRevert(abi.encodeWithSelector(LobsterNFT.DamageExceedsMax.selector, 101));
        nft.setDamage(id, 101);
    }

    function test_setDamageUnauthorizedReverts() public {
        uint256 id = _mintLobster(alice, false);
        vm.prank(alice);
        vm.expectRevert();
        nft.setDamage(id, 50);
    }

    function test_setDamageEmitsEvent() public {
        uint256 id = _mintLobster(alice, false);
        vm.prank(damager);
        vm.expectEmit(true, false, false, true);
        emit LobsterNFT.LobsterDamageUpdated(id, 0, 75);
        nft.setDamage(id, 75);
    }

    // ──────────── setEvolutionTier ────────────

    function test_setEvolutionTier() public {
        uint256 id = _mintLobster(alice, false);
        vm.prank(evolver);
        nft.setEvolutionTier(id, 1);
        assertEq(nft.getEvolutionTier(id), 1);
    }

    function test_setEvolutionTierInvalidReverts() public {
        uint256 id = _mintLobster(alice, false);
        vm.prank(evolver);
        vm.expectRevert(abi.encodeWithSelector(LobsterNFT.InvalidEvolutionTier.selector, 4));
        nft.setEvolutionTier(id, 4);
    }

    function test_setEvolutionTierUnauthorizedReverts() public {
        uint256 id = _mintLobster(alice, false);
        vm.prank(alice);
        vm.expectRevert();
        nft.setEvolutionTier(id, 1);
    }

    function test_setEvolutionTierEmitsEvent() public {
        uint256 id = _mintLobster(alice, false);
        vm.prank(evolver);
        vm.expectEmit(true, false, false, true);
        emit LobsterNFT.LobsterEvolved(id, 0, 2);
        nft.setEvolutionTier(id, 2);
    }

    // ──────────── incrementBreedCount ────────────

    function test_incrementBreedCount() public {
        uint256 id = _mintLobster(alice, false);
        vm.prank(breeder);
        nft.incrementBreedCount(id);
        assertEq(nft.getBreedCount(id), 1);
    }

    function test_incrementBreedCountMaxReverts() public {
        uint256 id = _mintLobster(alice, false);
        vm.startPrank(breeder);
        for (uint256 i = 0; i < 5; i++) {
            nft.incrementBreedCount(id);
        }
        vm.expectRevert(abi.encodeWithSelector(LobsterNFT.BreedCountExceeded.selector, id));
        nft.incrementBreedCount(id);
        vm.stopPrank();
    }

    function test_incrementBreedCountUnauthorizedReverts() public {
        uint256 id = _mintLobster(alice, false);
        vm.prank(alice);
        vm.expectRevert();
        nft.incrementBreedCount(id);
    }

    // ──────────── Burning ────────────

    function test_burn() public {
        uint256 id = _mintLobster(alice, false);
        vm.prank(burner);
        nft.burn(id);
        assertEq(nft.balanceOf(alice, id), 0);
        assertFalse(nft.exists(id));
    }

    function test_burnLockedReverts() public {
        uint256 id = _mintLobster(alice, false);
        vm.prank(locker);
        nft.setLocked(id, true);

        vm.prank(burner);
        vm.expectRevert(abi.encodeWithSelector(LobsterNFT.LobsterIsLocked.selector, id));
        nft.burn(id);
    }

    function test_burnUnauthorizedReverts() public {
        uint256 id = _mintLobster(alice, false);
        vm.prank(alice);
        vm.expectRevert();
        nft.burn(id);
    }

    function test_burnNonexistentReverts() public {
        vm.prank(burner);
        vm.expectRevert(abi.encodeWithSelector(LobsterNFT.TokenDoesNotExist.selector, 999));
        nft.burn(999);
    }

    function test_burnClearsStorage() public {
        uint256 id = _mintLobster(alice, false);
        vm.prank(burner);
        nft.burn(id);

        vm.expectRevert(abi.encodeWithSelector(LobsterNFT.TokenDoesNotExist.selector, id));
        nft.getLobster(id);
    }

    // ──────────── BaseURI ────────────

    function test_setBaseURI() public {
        vm.prank(admin);
        nft.setBaseURI("https://new.api/lobster/");
        _mintLobster(alice, false);
        assertEq(nft.uri(1), "https://new.api/lobster/1");
    }

    function test_setBaseURINonAdminReverts() public {
        vm.prank(alice);
        vm.expectRevert();
        nft.setBaseURI("https://evil.com/");
    }

    // ──────────── supportsInterface ────────────

    function test_supportsInterface() public view {
        // ERC1155
        assertTrue(nft.supportsInterface(0xd9b67a26));
        // ERC165
        assertTrue(nft.supportsInterface(0x01ffc9a7));
        // AccessControl
        assertTrue(nft.supportsInterface(0x7965db0b));
    }

    // ──────────── Fuzz ────────────

    function testFuzz_soulboundAlwaysBlocksTransfer(address to) public {
        vm.assume(to != address(0) && to != alice);
        uint256 id = _mintLobster(alice, true);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(LobsterNFT.LobsterIsSoulbound.selector, id));
        nft.safeTransferFrom(alice, to, id, 1, "");
    }

    function testFuzz_damageInRange(uint8 damage) public {
        damage = uint8(bound(damage, 0, 100));
        uint256 id = _mintLobster(alice, false);
        vm.prank(damager);
        nft.setDamage(id, damage);
        assertEq(nft.getDamage(id), damage);
    }
}
