// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseSetup} from "../contracts/test/helpers/BaseSetup.t.sol";
import {PauseSwitch, IPauseSwitch} from "../contracts/PauseSwitch.sol";
import {BattleArena} from "../contracts/BattleArena.sol";
import {MiningPool} from "../contracts/MiningPool.sol";
import {BreedingLab} from "../contracts/BreedingLab.sol";
import {EvolutionLab} from "../contracts/EvolutionLab.sol";
import {Marketplace} from "../contracts/Marketplace.sol";
import {RepairShop} from "../contracts/RepairShop.sol";
import {Faucet} from "../contracts/Faucet.sol";

/// @dev PAUSE-I1 across the protocol: while paused, every money-IN entry point reverts
///      `ProtocolPaused()` and every exit still works — so a pause can never trap funds.
///      One test per gate, one per exit, each starting the flow BEFORE the pause.
contract PauseGatesTest is BaseSetup {
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address guardian = makeAddr("guardian");

    bytes32 constant SEED_SECRET = keccak256("seed");
    bytes32 constant SALT_A = bytes32("saltA");
    bytes32 constant SALT_B = bytes32("saltB");

    function setUp() public override {
        super.setUp();
        vm.startPrank(admin);
        pauseSwitch.grantRole(pauseSwitch.PAUSER_ROLE(), guardian);
        miningPool.startSeason(352_500_000e18, 1_250e18);
        vm.stopPrank();
        _giveGold(alice, 1_000_000e18);
        _giveGold(bob, 1_000_000e18);
        _giveGold(address(faucet), 100_000e18); // the drip is a transfer, not a mint
        vm.deal(alice, 1 ether);
    }

    function _pause() internal {
        vm.prank(guardian);
        pauseSwitch.pause();
    }

    function _expectPaused() internal {
        vm.expectRevert(IPauseSwitch.ProtocolPaused.selector);
    }

    // ───────────────────────── constructors ─────────────────────────

    function test_constructors_rejectZeroPauseSwitch() public {
        vm.expectRevert(MiningPool.ZeroAddress.selector);
        new MiningPool(admin, address(gold), address(nft), address(teamMgr), address(0));
        vm.expectRevert(BreedingLab.ZeroAddress.selector);
        new BreedingLab(address(gold), address(nft), address(treasury), address(0));
        vm.expectRevert(EvolutionLab.ZeroAddress.selector);
        new EvolutionLab(address(gold), address(nft), address(treasury), address(0));
        vm.expectRevert(Marketplace.ZeroAddress.selector);
        new Marketplace(address(gold), address(nft), address(treasury), address(0));
        vm.expectRevert(RepairShop.ZeroAddress.selector);
        new RepairShop(address(gold), address(nft), address(treasury), address(miningPool), address(0));
        vm.expectRevert(Faucet.ZeroAddress.selector);
        new Faucet(admin, address(nft), address(gold), block.timestamp + 7 days, address(0));
        vm.expectRevert(BattleArena.ZeroAddress.selector);
        new BattleArena(
            admin, address(gold), address(nft), address(teamMgr), address(treasury), address(battleVRF), address(miningPool), address(0)
        );
    }

    function test_everyGatedContractPointsAtTheSwitch() public view {
        assertEq(address(miningPool.pauseSwitch()), address(pauseSwitch));
        assertEq(address(breedingLab.pauseSwitch()), address(pauseSwitch));
        assertEq(address(evolutionLab.pauseSwitch()), address(pauseSwitch));
        assertEq(address(marketplace.pauseSwitch()), address(pauseSwitch));
        assertEq(address(repairShop.pauseSwitch()), address(pauseSwitch));
        assertEq(address(faucet.pauseSwitch()), address(pauseSwitch));
        assertEq(address(battleArena.pauseSwitch()), address(pauseSwitch));
    }

    // ───────────────────────── MiningPool ─────────────────────────

    function test_mining_startExpedition_revertsWhenPaused_claimStillWorks() public {
        uint256 teamA = _createTeam(alice);
        uint256 teamB = _createTeam(bob);
        vm.prank(alice);
        uint256 expedition = miningPool.startExpedition(teamA, 0);

        _pause();
        vm.prank(bob);
        _expectPaused();
        miningPool.startExpedition(teamB, 0);

        // The expedition started before the pause pays out while paused.
        vm.warp(block.timestamp + 4 hours + 1);
        uint256 before = gold.balanceOf(alice);
        vm.prank(alice);
        miningPool.claimExpedition(expedition);
        assertGt(gold.balanceOf(alice), before, "claim paid while paused");

        // Reopened: the gate lifts.
        vm.prank(admin);
        pauseSwitch.unpause();
        vm.prank(bob);
        miningPool.startExpedition(teamB, 0);
    }

    // ───────────────────────── BreedingLab ─────────────────────────

    function test_breeding_request_revertsWhenPaused_finalizeStillWorks() public {
        uint256 a = _mintLobster(alice, 0);
        uint256 b = _mintLobster(alice, 1);
        uint256 c = _mintLobster(alice, 2);
        vm.startPrank(alice);
        gold.approve(address(breedingLab), type(uint256).max);
        uint256 requestId = breedingLab.requestBreed(a, b);
        vm.stopPrank();

        _pause();
        vm.prank(alice);
        _expectPaused();
        breedingLab.requestBreed(b, c);

        vm.roll(block.number + breedingLab.FINALIZE_MIN_BLOCKS() + 1);
        uint256 offspring = breedingLab.finalizeBreed(requestId);
        assertEq(nft.ownerOf(offspring), alice, "offspring delivered while paused");
    }

    // ───────────────────────── EvolutionLab ─────────────────────────

    function test_evolution_revertsWhenPaused() public {
        uint256[3] memory ids = _mint3(alice);
        vm.startPrank(alice);
        gold.approve(address(evolutionLab), type(uint256).max);
        vm.stopPrank();
        _pause();
        vm.prank(alice);
        _expectPaused();
        evolutionLab.evolve(ids[0], ids[1], ids[2]);

        vm.prank(admin);
        pauseSwitch.unpause();
        vm.prank(alice);
        evolutionLab.evolve(ids[0], ids[1], ids[2]);
        assertEq(nft.getEvolutionTier(ids[0]), 1);
    }

    // ───────────────────────── Marketplace ─────────────────────────

    function test_market_listAndBuy_revertWhenPaused_cancelStillWorks() public {
        uint256 listed = _mintLobster(alice, 3);
        uint256 other = _mintLobster(alice, 4);
        vm.startPrank(alice);
        nft.setApprovalForAll(address(marketplace), true);
        uint256 listingId = marketplace.listLobster(listed, 1_000e18);
        vm.stopPrank();

        _pause();
        vm.prank(alice);
        _expectPaused();
        marketplace.listLobster(other, 1_000e18);

        vm.startPrank(bob);
        gold.approve(address(marketplace), type(uint256).max);
        _expectPaused();
        marketplace.buyLobster(listingId, 1_000e18);
        vm.stopPrank();

        // The seller gets their lobster back while paused.
        vm.prank(alice);
        marketplace.cancelListing(listingId);
        assertEq(nft.ownerOf(listed), alice, "escrow returned while paused");
    }

    // ───────────────────────── RepairShop ─────────────────────────

    function test_repair_revertsWhenPaused() public {
        uint256 id = _mintLobster(alice, 5);
        vm.startPrank(admin);
        nft.setEvolutionTier(id, 1);
        nft.setDamage(id, 30);
        vm.stopPrank();
        vm.prank(alice);
        gold.approve(address(repairShop), type(uint256).max);

        _pause();
        vm.prank(alice);
        _expectPaused();
        repairShop.repair(id, 10);

        vm.prank(admin);
        pauseSwitch.unpause();
        vm.prank(alice);
        repairShop.repair(id, 10);
        assertEq(nft.getDamage(id), 20);
    }

    // ───────────────────────── Faucet ─────────────────────────

    function test_faucet_claims_revertWhenPaused_finalizeStillWorks() public {
        vm.prank(admin);
        faucet.setEligible(alice, true);
        vm.prank(alice);
        uint256 claimId = faucet.claimLobsters();

        _pause();
        vm.deal(bob, 1 ether);
        vm.prank(admin);
        faucet.setEligible(bob, true);
        vm.prank(bob);
        _expectPaused();
        faucet.claimLobsters();

        // The claim made before the pause still finalizes (it mints what was already promised)…
        vm.roll(block.number + faucet.FINALIZE_MIN_BLOCKS() + 1);
        uint256[5] memory minted = faucet.finalizeClaim(claimId);
        for (uint256 i = 0; i < 5; i++) assertEq(nft.ownerOf(minted[i]), alice, "promised lobsters delivered while paused");
        // …but the GOLD drip is new money in, so it waits for the reopen.
        vm.prank(alice);
        _expectPaused();
        faucet.claimGold();
        vm.prank(admin);
        pauseSwitch.unpause();
        vm.prank(alice);
        faucet.claimGold();
    }

    // ───────────────────────── BattleArena ─────────────────────────

    function _evolvedTeam(address owner) internal returns (uint256 teamId) {
        uint256[3] memory ids = _mint3(owner);
        vm.startPrank(admin);
        for (uint256 i = 0; i < 3; i++) nft.setEvolutionTier(ids[i], 1);
        vm.stopPrank();
        vm.prank(owner);
        teamId = teamMgr.createTeam(ids);
    }

    function _deposit(uint256 battleId, address player, uint256 teamId, bytes32 salt) internal {
        uint256 stake = battleArena.getBattle(battleId).stakeAmount;
        uint256 total = stake + stake * battleArena.ANTI_GRIEF_BPS() / battleArena.BPS_DENOMINATOR();
        bytes32 commit = battleArena.teamCommitHash(battleId, player, teamId, salt);
        vm.startPrank(player);
        gold.approve(address(battleArena), total);
        battleArena.deposit(battleId, stake, 9, commit);
        vm.stopPrank();
    }

    function test_arena_createBattle_revertsWhenPaused() public {
        _pause();
        vm.prank(admin); // MATCHMAKER_ROLE in BaseSetup
        _expectPaused();
        battleArena.createBattle(alice, bob, 0, 3, 3);
    }

    function test_arena_deposit_revertsWhenPaused_timeoutRefundsWhilePaused() public {
        vm.prank(admin);
        uint256 battleId = battleArena.createBattle(alice, bob, 0, 3, 3);
        uint256 teamA = _evolvedTeam(alice);
        _deposit(battleId, alice, teamA, SALT_A);
        uint256 aliceAfterDeposit = gold.balanceOf(alice);

        _pause();
        uint256 teamB = _evolvedTeam(bob);
        uint256 stake = battleArena.getBattle(battleId).stakeAmount;
        bytes32 commitB = battleArena.teamCommitHash(battleId, bob, teamB, SALT_B);
        vm.startPrank(bob);
        gold.approve(address(battleArena), type(uint256).max);
        _expectPaused();
        battleArena.deposit(battleId, stake, 9, commitB);
        vm.stopPrank();

        // Alice's money is not trapped: the deposit window lapses and the refund path is open.
        vm.warp(block.timestamp + battleArena.DEPOSIT_WINDOW() + 1);
        battleArena.handleTimeout(battleId);
        assertGt(gold.balanceOf(alice), aliceAfterDeposit, "alice refunded while paused");
    }

    /// @dev The whole post-deposit life of a battle — reveal, settle, review, payout — runs while paused.
    function test_arena_revealSettleFinalize_workWhilePaused() public {
        uint256 teamA = _evolvedTeam(alice);
        uint256 teamB = _evolvedTeam(bob);
        vm.prank(admin);
        uint256 battleId = battleArena.createBattle(alice, bob, 0, 3, 3);
        _deposit(battleId, alice, teamA, SALT_A);
        _deposit(battleId, bob, teamB, SALT_B);
        uint256 aliceBefore = gold.balanceOf(alice);

        _pause();

        vm.prank(admin); // RESOLVER_ROLE in BaseSetup
        battleArena.revealTeams(battleId, teamA, SALT_A, teamB, SALT_B, keccak256(abi.encodePacked(battleId, SEED_SECRET)));
        vm.prank(admin);
        battleArena.settle(
            battleId, alice, keccak256("state"), keccak256("log"), [10, 5, 8], [30, 25, 35], SEED_SECRET, address(0)
        );
        assertFalse(teamMgr.getTeam(teamA).active, "teams released at settle, paused or not");

        vm.warp(battleArena.getBattle(battleId).payoutDeadline + 1);
        battleArena.finalizeBattle(battleId);
        assertGt(gold.balanceOf(alice), aliceBefore, "the winner was paid while paused");
        assertTrue(pauseSwitch.paused(), "still paused the whole way through");
    }
}
