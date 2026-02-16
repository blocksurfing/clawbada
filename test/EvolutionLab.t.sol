// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {EvolutionLab} from "../contracts/EvolutionLab.sol";
import {LobsterNFT} from "../contracts/LobsterNFT.sol";
import {ClawToken} from "../contracts/ClawToken.sol";
import {Treasury} from "../contracts/Treasury.sol";
import {DNALib} from "../contracts/libraries/DNALib.sol";

contract EvolutionLabTest is Test {
    EvolutionLab lab;
    LobsterNFT nft;
    ClawToken claw;
    Treasury treasury;

    address admin = makeAddr("admin");
    address devWallet = makeAddr("devWallet");
    address lpAddress = makeAddr("lpAddress");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    uint256 validDNA;

    function setUp() public {
        vm.startPrank(admin);

        // Deploy contracts
        nft = new LobsterNFT(admin, "https://api.clawbada.com/lobster/");
        treasury = new Treasury(admin, devWallet);
        claw = new ClawToken(admin, lpAddress, address(treasury));
        treasury.setClawToken(address(claw));

        lab = new EvolutionLab(address(claw), address(nft), address(treasury));

        // Grant roles
        nft.grantRole(nft.MINTER_ROLE(), admin);
        nft.grantRole(nft.EVOLVER_ROLE(), address(lab));
        nft.grantRole(nft.BURNER_ROLE(), address(lab));
        treasury.setAuthorized(address(lab), true);

        vm.stopPrank();

        // Build valid DNA
        uint8[18] memory alleles;
        for (uint256 i = 0; i < 18; i++) {
            alleles[i] = 0x37;
        }
        validDNA = DNALib.encode(3, 0, 5, alleles);
    }

    // ──────────── Helpers ────────────

    function _mintLobster(address to, bool soulbound) internal returns (uint256) {
        vm.prank(admin);
        return nft.mint(to, validDNA, soulbound);
    }

    function _mintLobsterAtTier(address to, uint8 tier) internal returns (uint256) {
        uint256 id = _mintLobster(to, false);
        if (tier > 0) {
            vm.startPrank(admin);
            nft.grantRole(nft.EVOLVER_ROLE(), admin);
            nft.setEvolutionTier(id, tier);
            vm.stopPrank();
        }
        return id;
    }

    function _giveClaw(address to, uint256 amount) internal {
        vm.prank(lpAddress);
        claw.transfer(to, amount);
    }

    function _approveClaw(address owner, uint256 amount) internal {
        vm.prank(owner);
        claw.approve(address(lab), amount);
    }

    // ──────────── Constructor ────────────

    function test_constructorSetsState() public view {
        assertEq(address(lab.clawToken()), address(claw));
        assertEq(address(lab.lobsterNFT()), address(nft));
        assertEq(address(lab.treasury()), address(treasury));
    }

    function test_constructorZeroClawReverts() public {
        vm.expectRevert(EvolutionLab.ZeroAddress.selector);
        new EvolutionLab(address(0), address(nft), address(treasury));
    }

    function test_constructorZeroNFTReverts() public {
        vm.expectRevert(EvolutionLab.ZeroAddress.selector);
        new EvolutionLab(address(claw), address(0), address(treasury));
    }

    function test_constructorZeroTreasuryReverts() public {
        vm.expectRevert(EvolutionLab.ZeroAddress.selector);
        new EvolutionLab(address(claw), address(nft), address(0));
    }

    // ──────────── evolve() — Happy Paths ────────────

    function test_evolveBaseToEvolved() public {
        uint256 target = _mintLobster(alice, false);
        uint256 fuel1 = _mintLobster(alice, false);
        uint256 fuel2 = _mintLobster(alice, false);

        _giveClaw(alice, 2_000e18);
        _approveClaw(alice, 2_000e18);

        vm.prank(alice);
        lab.evolve(target, fuel1, fuel2);

        assertEq(nft.getEvolutionTier(target), 1);
    }

    function test_evolveEvolvedToElite() public {
        uint256 target = _mintLobsterAtTier(alice, 1);
        uint256 fuel1 = _mintLobsterAtTier(alice, 1);
        uint256 fuel2 = _mintLobsterAtTier(alice, 1);

        _giveClaw(alice, 10_000e18);
        _approveClaw(alice, 10_000e18);

        vm.prank(alice);
        lab.evolve(target, fuel1, fuel2);

        assertEq(nft.getEvolutionTier(target), 2);
    }

    function test_evolveEliteToApex() public {
        uint256 target = _mintLobsterAtTier(alice, 2);
        uint256 fuel1 = _mintLobsterAtTier(alice, 2);
        uint256 fuel2 = _mintLobsterAtTier(alice, 2);

        _giveClaw(alice, 50_000e18);
        _approveClaw(alice, 50_000e18);

        vm.prank(alice);
        lab.evolve(target, fuel1, fuel2);

        assertEq(nft.getEvolutionTier(target), 3);
    }

    function test_evolveEmitsEvent() public {
        uint256 target = _mintLobster(alice, false);
        uint256 fuel1 = _mintLobster(alice, false);
        uint256 fuel2 = _mintLobster(alice, false);

        _giveClaw(alice, 2_000e18);
        _approveClaw(alice, 2_000e18);

        vm.prank(alice);
        vm.expectEmit(true, false, false, true);
        emit EvolutionLab.LobsterEvolved(target, fuel1, fuel2, 1, 2_000e18);
        lab.evolve(target, fuel1, fuel2);
    }

    // ──────────── evolve() — Reverts ────────────

    function test_evolveAlreadyApexReverts() public {
        uint256 target = _mintLobsterAtTier(alice, 3);
        uint256 fuel1 = _mintLobsterAtTier(alice, 3);
        uint256 fuel2 = _mintLobsterAtTier(alice, 3);

        _giveClaw(alice, 50_000e18);
        _approveClaw(alice, 50_000e18);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(EvolutionLab.AlreadyMaxTier.selector, target));
        lab.evolve(target, fuel1, fuel2);
    }

    function test_evolveNotOwnerReverts() public {
        uint256 target = _mintLobster(bob, false);
        uint256 fuel1 = _mintLobster(alice, false);
        uint256 fuel2 = _mintLobster(alice, false);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(EvolutionLab.NotLobsterOwner.selector, target));
        lab.evolve(target, fuel1, fuel2);
    }

    function test_evolveLobsterLockedReverts() public {
        uint256 target = _mintLobster(alice, false);
        uint256 fuel1 = _mintLobster(alice, false);
        uint256 fuel2 = _mintLobster(alice, false);

        // Lock the target
        vm.startPrank(admin);
        nft.grantRole(nft.LOCKER_ROLE(), admin);
        nft.setLocked(target, true);
        vm.stopPrank();

        _giveClaw(alice, 2_000e18);
        _approveClaw(alice, 2_000e18);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(EvolutionLab.LobsterIsLocked.selector, target));
        lab.evolve(target, fuel1, fuel2);
    }

    function test_evolveFuelWrongTierReverts() public {
        uint256 target = _mintLobsterAtTier(alice, 1); // Evolved
        uint256 fuel1 = _mintLobster(alice, false); // Base (wrong tier)
        uint256 fuel2 = _mintLobsterAtTier(alice, 1); // Evolved

        _giveClaw(alice, 10_000e18);
        _approveClaw(alice, 10_000e18);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(EvolutionLab.InvalidFuelTier.selector, fuel1, 1, 0));
        lab.evolve(target, fuel1, fuel2);
    }

    function test_evolveFuelLockedReverts() public {
        uint256 target = _mintLobster(alice, false);
        uint256 fuel1 = _mintLobster(alice, false);
        uint256 fuel2 = _mintLobster(alice, false);

        // Lock fuel1
        vm.startPrank(admin);
        nft.grantRole(nft.LOCKER_ROLE(), admin);
        nft.setLocked(fuel1, true);
        vm.stopPrank();

        _giveClaw(alice, 2_000e18);
        _approveClaw(alice, 2_000e18);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(EvolutionLab.LobsterIsLocked.selector, fuel1));
        lab.evolve(target, fuel1, fuel2);
    }

    function test_evolveFuelNotOwnedReverts() public {
        uint256 target = _mintLobster(alice, false);
        uint256 fuel1 = _mintLobster(bob, false); // owned by bob
        uint256 fuel2 = _mintLobster(alice, false);

        _giveClaw(alice, 2_000e18);
        _approveClaw(alice, 2_000e18);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(EvolutionLab.NotLobsterOwner.selector, fuel1));
        lab.evolve(target, fuel1, fuel2);
    }

    function test_evolveDuplicateFuelReverts() public {
        uint256 target = _mintLobster(alice, false);
        uint256 fuel1 = _mintLobster(alice, false);

        _giveClaw(alice, 2_000e18);
        _approveClaw(alice, 2_000e18);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(EvolutionLab.DuplicateId.selector, fuel1));
        lab.evolve(target, fuel1, fuel1);
    }

    function test_evolveSameLobsterAsFuelReverts() public {
        uint256 target = _mintLobster(alice, false);
        uint256 fuel2 = _mintLobster(alice, false);

        _giveClaw(alice, 2_000e18);
        _approveClaw(alice, 2_000e18);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(EvolutionLab.DuplicateId.selector, target));
        lab.evolve(target, target, fuel2);
    }

    // ──────────── evolve() — Soulbound ────────────

    function test_evolveSoulboundFuelAllowed() public {
        uint256 target = _mintLobster(alice, false);
        uint256 fuel1 = _mintLobster(alice, true); // soulbound
        uint256 fuel2 = _mintLobster(alice, true); // soulbound

        _giveClaw(alice, 2_000e18);
        _approveClaw(alice, 2_000e18);

        vm.prank(alice);
        lab.evolve(target, fuel1, fuel2);

        assertEq(nft.getEvolutionTier(target), 1);
    }

    function test_evolveSoulboundLobsterAllowed() public {
        uint256 target = _mintLobster(alice, true); // soulbound
        uint256 fuel1 = _mintLobster(alice, false);
        uint256 fuel2 = _mintLobster(alice, false);

        _giveClaw(alice, 2_000e18);
        _approveClaw(alice, 2_000e18);

        vm.prank(alice);
        lab.evolve(target, fuel1, fuel2);

        assertEq(nft.getEvolutionTier(target), 1);
    }

    // ──────────── evolve() — Effects ────────────

    function test_evolveBurnsFuel() public {
        uint256 target = _mintLobster(alice, false);
        uint256 fuel1 = _mintLobster(alice, false);
        uint256 fuel2 = _mintLobster(alice, false);

        _giveClaw(alice, 2_000e18);
        _approveClaw(alice, 2_000e18);

        vm.prank(alice);
        lab.evolve(target, fuel1, fuel2);

        // Fuel lobsters should no longer exist
        assertFalse(nft.exists(fuel1));
        assertFalse(nft.exists(fuel2));
        // Target still exists
        assertTrue(nft.exists(target));
    }

    function test_evolveDeductsCorrectClaw() public {
        uint256 target = _mintLobster(alice, false);
        uint256 fuel1 = _mintLobster(alice, false);
        uint256 fuel2 = _mintLobster(alice, false);

        uint256 initialAmount = 10_000e18;
        _giveClaw(alice, initialAmount);
        _approveClaw(alice, initialAmount);

        uint256 balBefore = claw.balanceOf(alice);

        vm.prank(alice);
        lab.evolve(target, fuel1, fuel2);

        uint256 balAfter = claw.balanceOf(alice);
        assertEq(balBefore - balAfter, 2_000e18);
    }

    function test_evolveInsufficientClawReverts() public {
        uint256 target = _mintLobster(alice, false);
        uint256 fuel1 = _mintLobster(alice, false);
        uint256 fuel2 = _mintLobster(alice, false);

        // Give less than required
        _giveClaw(alice, 1_999e18);
        _approveClaw(alice, 1_999e18);

        vm.prank(alice);
        vm.expectRevert(); // ERC20 insufficient balance
        lab.evolve(target, fuel1, fuel2);
    }

    // ──────────── Fuzz ────────────

    function testFuzz_evolutionCostsCorrect(uint8 tier) public {
        tier = uint8(bound(tier, 0, 2)); // 0, 1, or 2 — can't evolve Apex

        uint256 target = _mintLobsterAtTier(alice, tier);
        uint256 fuel1 = _mintLobsterAtTier(alice, tier);
        uint256 fuel2 = _mintLobsterAtTier(alice, tier);

        uint256[3] memory costs = [uint256(2_000e18), 10_000e18, 50_000e18];
        uint256 expectedCost = costs[tier];

        _giveClaw(alice, expectedCost);
        _approveClaw(alice, expectedCost);

        uint256 balBefore = claw.balanceOf(alice);

        vm.prank(alice);
        lab.evolve(target, fuel1, fuel2);

        assertEq(balBefore - claw.balanceOf(alice), expectedCost);
        assertEq(nft.getEvolutionTier(target), tier + 1);
    }
}
