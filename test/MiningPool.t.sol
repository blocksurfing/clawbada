// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MiningPool} from "../contracts/MiningPool.sol";
import {TeamManager} from "../contracts/TeamManager.sol";
import {LobsterNFT} from "../contracts/LobsterNFT.sol";
import {ClawToken} from "../contracts/ClawToken.sol";
import {DNALib} from "../contracts/libraries/DNALib.sol";

contract MiningPoolTest is Test {
    MiningPool pool;
    TeamManager tm;
    LobsterNFT nft;
    ClawToken claw;

    address admin = makeAddr("admin");
    address seasonAdmin = makeAddr("seasonAdmin");
    address lpAddress = makeAddr("lpAddress");
    address treasuryAddress = makeAddr("treasuryAddress");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    uint256 validDNA;
    uint256 constant S1_EMISSION = 352_500_000e18;
    uint256 constant BASE_REWARD = 1_250e18;

    function setUp() public {
        vm.startPrank(admin);
        nft = new LobsterNFT(admin, "https://api.clawbada.com/lobster/");
        claw = new ClawToken(admin, lpAddress, treasuryAddress);
        tm = new TeamManager(admin, address(nft));
        pool = new MiningPool(admin, address(claw), address(nft), address(tm));

        // Grant roles
        nft.grantRole(nft.MINTER_ROLE(), admin);
        nft.grantRole(nft.LOCKER_ROLE(), address(tm));
        nft.grantRole(nft.EVOLVER_ROLE(), admin);
        tm.grantRole(tm.ACTIVITY_ROLE(), address(pool));
        claw.grantRole(claw.MINTER_ROLE(), address(pool));
        pool.grantRole(pool.SEASON_ADMIN_ROLE(), seasonAdmin);
        vm.stopPrank();

        // Build valid DNA
        uint8[18] memory alleles;
        for (uint256 i = 0; i < 18; i++) {
            alleles[i] = 0x37;
        }
        validDNA = DNALib.encode(3, 0, 5, alleles);
    }

    // ──────────── Helpers ────────────

    function _mintLobster(address to) internal returns (uint256) {
        vm.prank(admin);
        return nft.mint(to, validDNA, false);
    }

    function _mintAndEvolve(address to, uint8 tier) internal returns (uint256) {
        uint256 id = _mintLobster(to);
        if (tier > 0) {
            vm.prank(admin);
            nft.setEvolutionTier(id, tier);
        }
        return id;
    }

    function _createTeam(address owner, uint8 tier) internal returns (uint256 teamId) {
        uint256 id1 = _mintAndEvolve(owner, tier);
        uint256 id2 = _mintAndEvolve(owner, tier);
        uint256 id3 = _mintAndEvolve(owner, tier);
        vm.prank(owner);
        teamId = tm.createTeam([id1, id2, id3]);
    }

    function _startSeason() internal {
        vm.prank(seasonAdmin);
        pool.startSeason(S1_EMISSION, BASE_REWARD);
    }

    function _startSeasonWith(uint256 emission, uint256 baseReward) internal {
        vm.prank(seasonAdmin);
        pool.startSeason(emission, baseReward);
    }

    // ──────────── Constructor ────────────

    function test_constructorSetsState() public view {
        assertEq(address(pool.clawToken()), address(claw));
        assertEq(address(pool.lobsterNFT()), address(nft));
        assertEq(address(pool.teamManager()), address(tm));
        assertTrue(pool.hasRole(pool.DEFAULT_ADMIN_ROLE(), admin));
        assertEq(pool.nextExpeditionId(), 1);
        assertEq(pool.currentSeason(), 0);
    }

    function test_constructorZeroAdminReverts() public {
        vm.expectRevert(MiningPool.ZeroAddress.selector);
        new MiningPool(address(0), address(claw), address(nft), address(tm));
    }

    function test_constructorZeroClawReverts() public {
        vm.expectRevert(MiningPool.ZeroAddress.selector);
        new MiningPool(admin, address(0), address(nft), address(tm));
    }

    function test_constructorZeroNFTReverts() public {
        vm.expectRevert(MiningPool.ZeroAddress.selector);
        new MiningPool(admin, address(claw), address(0), address(tm));
    }

    function test_constructorZeroTMReverts() public {
        vm.expectRevert(MiningPool.ZeroAddress.selector);
        new MiningPool(admin, address(claw), address(nft), address(0));
    }

    // ──────────── Season Management ────────────

    function test_startSeason() public {
        _startSeason();
        assertEq(pool.currentSeason(), 1);

        MiningPool.SeasonConfig memory config = pool.getSeasonConfig(1);
        assertEq(config.totalEmission, S1_EMISSION);
        assertEq(config.baseReward, BASE_REWARD);
        assertEq(config.startTime, block.timestamp);
        assertEq(config.totalMinted, 0);
    }

    function test_startSeasonEmitsEvent() public {
        vm.prank(seasonAdmin);
        vm.expectEmit(true, false, false, true);
        emit MiningPool.SeasonStarted(1, S1_EMISSION, BASE_REWARD, block.timestamp);
        pool.startSeason(S1_EMISSION, BASE_REWARD);
    }

    function test_startSeasonUnauthorizedReverts() public {
        vm.prank(alice);
        vm.expectRevert();
        pool.startSeason(S1_EMISSION, BASE_REWARD);
    }

    function test_startSeasonZeroEmissionReverts() public {
        vm.prank(seasonAdmin);
        vm.expectRevert(MiningPool.ZeroEmission.selector);
        pool.startSeason(0, BASE_REWARD);
    }

    function test_startSeasonZeroBaseRewardReverts() public {
        vm.prank(seasonAdmin);
        vm.expectRevert(MiningPool.ZeroBaseReward.selector);
        pool.startSeason(S1_EMISSION, 0);
    }

    function test_startSeasonWhileActiveReverts() public {
        _startSeason();

        vm.prank(seasonAdmin);
        vm.expectRevert(MiningPool.SeasonStillActive.selector);
        pool.startSeason(S1_EMISSION / 2, BASE_REWARD);
    }

    function test_startSecondSeasonAfterFirst() public {
        _startSeason();
        vm.warp(block.timestamp + 60 days);

        vm.prank(seasonAdmin);
        pool.startSeason(S1_EMISSION / 2, BASE_REWARD);
        assertEq(pool.currentSeason(), 2);
    }

    // ──────────── setBaseReward ────────────

    function test_setBaseReward() public {
        _startSeason();

        uint256 newReward = 2_000e18;
        vm.prank(seasonAdmin);
        pool.setBaseReward(newReward);

        MiningPool.SeasonConfig memory config = pool.getSeasonConfig(1);
        assertEq(config.baseReward, newReward);
    }

    function test_setBaseRewardEmitsEvent() public {
        _startSeason();

        uint256 newReward = 2_000e18;
        vm.prank(seasonAdmin);
        vm.expectEmit(true, false, false, true);
        emit MiningPool.BaseRewardUpdated(1, BASE_REWARD, newReward);
        pool.setBaseReward(newReward);
    }

    function test_setBaseRewardUnauthorizedReverts() public {
        _startSeason();

        vm.prank(alice);
        vm.expectRevert();
        pool.setBaseReward(2_000e18);
    }

    function test_setBaseRewardNoSeasonReverts() public {
        vm.prank(seasonAdmin);
        vm.expectRevert(MiningPool.SeasonNotActive.selector);
        pool.setBaseReward(2_000e18);
    }

    function test_setBaseRewardZeroReverts() public {
        _startSeason();

        vm.prank(seasonAdmin);
        vm.expectRevert(MiningPool.ZeroBaseReward.selector);
        pool.setBaseReward(0);
    }

    function test_setBaseRewardDoesNotAffectInFlight() public {
        uint256 teamId = _createTeam(alice, 0);
        _startSeason();

        // Start expedition at old baseReward
        vm.prank(alice);
        uint256 expId = pool.startExpedition(teamId, 0);

        MiningPool.Expedition memory exp = pool.getExpedition(expId);
        assertEq(exp.reward, BASE_REWARD); // 1,250 × 1

        // Change baseReward
        vm.prank(seasonAdmin);
        pool.setBaseReward(5_000e18);

        // In-flight expedition still has old reward
        MiningPool.Expedition memory expAfter = pool.getExpedition(expId);
        assertEq(expAfter.reward, BASE_REWARD);

        // New expedition gets new reward
        uint256 team2 = _createTeam(alice, 0);
        vm.prank(alice);
        uint256 expId2 = pool.startExpedition(team2, 0);

        MiningPool.Expedition memory exp2 = pool.getExpedition(expId2);
        assertEq(exp2.reward, 5_000e18);
    }

    // ──────────── startExpedition ────────────

    function test_startExpedition() public {
        uint256 teamId = _createTeam(alice, 0);
        _startSeason();

        vm.prank(alice);
        uint256 expId = pool.startExpedition(teamId, 0);
        assertEq(expId, 1);

        MiningPool.Expedition memory exp = pool.getExpedition(expId);
        assertEq(exp.teamId, teamId);
        assertEq(exp.owner, alice);
        assertEq(exp.season, 1);
        assertEq(exp.mineTier, 0);
        assertEq(exp.startTime, block.timestamp);
        assertEq(exp.reward, BASE_REWARD); // 1,250 × 1
        assertFalse(exp.claimed);

        // Team marked active
        assertTrue(tm.isTeamActive(teamId));
        assertEq(pool.getActiveExpedition(teamId), expId);
    }

    function test_startExpeditionLocksReward() public {
        // Verify reward = baseReward × tierWeight for each tier
        uint256[4] memory expectedRewards =
            [BASE_REWARD * 1, BASE_REWARD * 3, BASE_REWARD * 10, BASE_REWARD * 25];

        _startSeason();

        for (uint8 tier = 0; tier < 4; tier++) {
            uint256 teamId = _createTeam(alice, tier);

            vm.prank(alice);
            uint256 expId = pool.startExpedition(teamId, tier);

            MiningPool.Expedition memory exp = pool.getExpedition(expId);
            assertEq(exp.reward, expectedRewards[tier]);
        }
    }

    function test_startExpeditionReservesBudget() public {
        uint256 teamId = _createTeam(alice, 0);
        _startSeason();

        assertEq(pool.getSeasonMinted(1), 0);
        uint256 poolBalBefore = claw.balanceOf(address(pool));

        vm.prank(alice);
        pool.startExpedition(teamId, 0);

        assertEq(pool.getSeasonMinted(1), BASE_REWARD);
        assertEq(pool.getSeasonUnspent(1), S1_EMISSION - BASE_REWARD);
        // Reward minted into pool escrow at expedition start
        assertEq(claw.balanceOf(address(pool)), poolBalBefore + BASE_REWARD);
    }

    function test_startExpeditionEmitsEvent() public {
        uint256 teamId = _createTeam(alice, 0);
        _startSeason();

        vm.prank(alice);
        vm.expectEmit(true, true, true, true);
        emit MiningPool.ExpeditionStarted(1, teamId, alice, 0, BASE_REWARD);
        pool.startExpedition(teamId, 0);
    }

    function test_startExpeditionNoSeasonReverts() public {
        uint256 teamId = _createTeam(alice, 0);

        vm.prank(alice);
        vm.expectRevert(MiningPool.SeasonNotActive.selector);
        pool.startExpedition(teamId, 0);
    }

    function test_startExpeditionSeasonExpiredReverts() public {
        uint256 teamId = _createTeam(alice, 0);
        _startSeason();
        vm.warp(block.timestamp + 60 days);

        vm.prank(alice);
        vm.expectRevert(MiningPool.SeasonNotActive.selector);
        pool.startExpedition(teamId, 0);
    }

    function test_startExpeditionNotOwnerReverts() public {
        uint256 teamId = _createTeam(alice, 0);
        _startSeason();

        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(MiningPool.NotTeamOwner.selector, teamId));
        pool.startExpedition(teamId, 0);
    }

    function test_startExpeditionTeamDoesNotExistReverts() public {
        _startSeason();

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(MiningPool.TeamDoesNotExist.selector, 999));
        pool.startExpedition(999, 0);
    }

    function test_startExpeditionAlreadyMiningReverts() public {
        uint256 teamId = _createTeam(alice, 0);
        _startSeason();

        vm.prank(alice);
        pool.startExpedition(teamId, 0);

        // Team is now active (set by startExpedition), so TeamIsActive fires first
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(MiningPool.TeamIsActive.selector, teamId));
        pool.startExpedition(teamId, 0);
    }

    function test_startExpeditionInvalidTierReverts() public {
        uint256 teamId = _createTeam(alice, 0);
        _startSeason();

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(MiningPool.InvalidMineTier.selector, 4));
        pool.startExpedition(teamId, 4);
    }

    function test_startExpeditionTierRequirementNotMet() public {
        uint256 teamId = _createTeam(alice, 0);
        _startSeason();

        vm.prank(alice);
        vm.expectRevert(); // TierRequirementNotMet
        pool.startExpedition(teamId, 1);
    }

    function test_startExpeditionEvolvedMine() public {
        uint256 teamId = _createTeam(alice, 1); // Evolved tier
        _startSeason();

        vm.prank(alice);
        uint256 expId = pool.startExpedition(teamId, 1);

        MiningPool.Expedition memory exp = pool.getExpedition(expId);
        assertEq(exp.mineTier, 1);
        assertEq(exp.reward, BASE_REWARD * 3); // 1,250 × 3 = 3,750
    }

    function test_startExpeditionHigherTierInLowerMine() public {
        // Elite lobsters can mine in Evolved mine — reward uses mine tier weight
        uint256 teamId = _createTeam(alice, 2); // Elite tier
        _startSeason();

        vm.prank(alice);
        uint256 expId = pool.startExpedition(teamId, 1); // Evolved mine

        MiningPool.Expedition memory exp = pool.getExpedition(expId);
        assertEq(exp.reward, BASE_REWARD * 3); // Evolved mine weight, not Elite
    }

    function test_startExpeditionBudgetExhaustedReverts() public {
        // Create a tiny budget that fits exactly 1 Base expedition
        _startSeasonWith(BASE_REWARD, BASE_REWARD);

        uint256 team1 = _createTeam(alice, 0);
        uint256 team2 = _createTeam(alice, 0);

        // First expedition fits
        vm.prank(alice);
        pool.startExpedition(team1, 0);

        // Second expedition exceeds budget
        vm.prank(alice);
        vm.expectRevert(MiningPool.SeasonBudgetExhausted.selector);
        pool.startExpedition(team2, 0);
    }

    function test_startExpeditionLastFittingExpedition() public {
        // Budget exactly fits 2 Base expeditions
        _startSeasonWith(BASE_REWARD * 2, BASE_REWARD);

        uint256 team1 = _createTeam(alice, 0);
        uint256 team2 = _createTeam(alice, 0);
        uint256 team3 = _createTeam(alice, 0);

        vm.startPrank(alice);
        pool.startExpedition(team1, 0);
        pool.startExpedition(team2, 0); // exactly fills budget
        vm.stopPrank();

        assertEq(pool.getSeasonMinted(1), BASE_REWARD * 2);
        assertEq(pool.getSeasonUnspent(1), 0);

        // Third reverts
        vm.prank(alice);
        vm.expectRevert(MiningPool.SeasonBudgetExhausted.selector);
        pool.startExpedition(team3, 0);
    }

    function test_startExpeditionBudgetExhaustedHighTier() public {
        // Budget fits 1 Evolved expedition (3x) but not 2
        _startSeasonWith(BASE_REWARD * 4, BASE_REWARD);

        uint256 team1 = _createTeam(alice, 1);
        uint256 team2 = _createTeam(alice, 1);

        vm.prank(alice);
        pool.startExpedition(team1, 1); // costs 3,750 → 3,750 of 5,000 used

        // Remaining: 1,250. Evolved costs 3,750 → too much
        vm.prank(alice);
        vm.expectRevert(MiningPool.SeasonBudgetExhausted.selector);
        pool.startExpedition(team2, 1);
    }

    // ──────────── claimExpedition ────────────

    function test_claimExpedition() public {
        uint256 teamId = _createTeam(alice, 0);
        _startSeason();

        vm.prank(alice);
        uint256 expId = pool.startExpedition(teamId, 0);

        vm.warp(block.timestamp + 4 hours);

        vm.prank(alice);
        pool.claimExpedition(expId);

        // Should have received exact locked reward
        assertEq(claw.balanceOf(alice), BASE_REWARD);

        // Team deactivated
        assertFalse(tm.isTeamActive(teamId));
        assertEq(pool.getActiveExpedition(teamId), 0);
    }

    function test_claimExpeditionMintsExactReward() public {
        // Evolved expedition should mint exactly baseReward × 3
        uint256 teamId = _createTeam(alice, 1);
        _startSeason();

        vm.prank(alice);
        uint256 expId = pool.startExpedition(teamId, 1);
        vm.warp(block.timestamp + 4 hours);

        vm.prank(alice);
        pool.claimExpedition(expId);

        assertEq(claw.balanceOf(alice), BASE_REWARD * 3);
    }

    function test_claimExpeditionEmitsEvent() public {
        uint256 teamId = _createTeam(alice, 0);
        _startSeason();

        vm.prank(alice);
        uint256 expId = pool.startExpedition(teamId, 0);
        vm.warp(block.timestamp + 4 hours);

        vm.prank(alice);
        vm.expectEmit(true, true, true, true);
        emit MiningPool.ExpeditionClaimed(expId, teamId, alice, BASE_REWARD);
        pool.claimExpedition(expId);
    }

    function test_claimExpeditionBeforeCompleteReverts() public {
        uint256 teamId = _createTeam(alice, 0);
        _startSeason();

        vm.prank(alice);
        uint256 expId = pool.startExpedition(teamId, 0);

        vm.warp(block.timestamp + 4 hours - 1);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(MiningPool.ExpeditionNotComplete.selector, expId));
        pool.claimExpedition(expId);
    }

    function test_claimExpeditionAlreadyClaimedReverts() public {
        uint256 teamId = _createTeam(alice, 0);
        _startSeason();

        vm.prank(alice);
        uint256 expId = pool.startExpedition(teamId, 0);
        vm.warp(block.timestamp + 4 hours);

        vm.prank(alice);
        pool.claimExpedition(expId);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(MiningPool.ExpeditionAlreadyClaimed.selector, expId));
        pool.claimExpedition(expId);
    }

    function test_claimExpeditionNotOwnerReverts() public {
        uint256 teamId = _createTeam(alice, 0);
        _startSeason();

        vm.prank(alice);
        uint256 expId = pool.startExpedition(teamId, 0);
        vm.warp(block.timestamp + 4 hours);

        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(MiningPool.NotExpeditionOwner.selector, expId));
        pool.claimExpedition(expId);
    }

    function test_claimExpeditionDoesNotExistReverts() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(MiningPool.ExpeditionDoesNotExist.selector, 999));
        pool.claimExpedition(999);
    }

    // ──────────── Fixed Reward Verification ────────────

    function test_multipleExpeditionsFixedReward() public {
        // All same-tier expeditions get identical reward regardless of participation
        uint256 team1 = _createTeam(alice, 0);
        uint256 team2 = _createTeam(alice, 0);
        uint256 team3 = _createTeam(bob, 0);

        _startSeason();

        vm.prank(alice);
        uint256 exp1 = pool.startExpedition(team1, 0);
        vm.prank(alice);
        uint256 exp2 = pool.startExpedition(team2, 0);
        vm.prank(bob);
        uint256 exp3 = pool.startExpedition(team3, 0);

        vm.warp(block.timestamp + 4 hours);

        vm.prank(alice);
        pool.claimExpedition(exp1);
        vm.prank(alice);
        pool.claimExpedition(exp2);
        vm.prank(bob);
        pool.claimExpedition(exp3);

        // Alice got 2 × BASE_REWARD, Bob got 1 × BASE_REWARD
        assertEq(claw.balanceOf(alice), BASE_REWARD * 2);
        assertEq(claw.balanceOf(bob), BASE_REWARD);
    }

    function test_flatRewardAcrossMultipleTeams() public {
        // All teams from same wallet get identical reward (no diminishing returns)
        uint256 team1 = _createTeam(alice, 0);
        uint256 team2 = _createTeam(alice, 0);
        uint256 team3 = _createTeam(alice, 0);

        _startSeason();

        vm.startPrank(alice);
        uint256 exp1 = pool.startExpedition(team1, 0);
        uint256 exp2 = pool.startExpedition(team2, 0);
        uint256 exp3 = pool.startExpedition(team3, 0);
        vm.stopPrank();

        MiningPool.Expedition memory e1 = pool.getExpedition(exp1);
        MiningPool.Expedition memory e2 = pool.getExpedition(exp2);
        MiningPool.Expedition memory e3 = pool.getExpedition(exp3);

        // All get identical reward
        assertEq(e1.reward, BASE_REWARD);
        assertEq(e2.reward, BASE_REWARD);
        assertEq(e3.reward, BASE_REWARD);
    }

    // ──────────── View Functions ────────────

    function test_getSeasonConfig() public {
        _startSeason();
        MiningPool.SeasonConfig memory config = pool.getSeasonConfig(1);
        assertEq(config.totalEmission, S1_EMISSION);
        assertEq(config.baseReward, BASE_REWARD);
        assertEq(config.totalMinted, 0);
    }

    function test_getSeasonMinted() public {
        _startSeason();
        assertEq(pool.getSeasonMinted(1), 0);

        uint256 teamId = _createTeam(alice, 0);
        vm.prank(alice);
        pool.startExpedition(teamId, 0);

        assertEq(pool.getSeasonMinted(1), BASE_REWARD);
    }

    function test_getSeasonUnspent() public {
        _startSeason();
        assertEq(pool.getSeasonUnspent(1), S1_EMISSION);

        uint256 teamId = _createTeam(alice, 0);
        vm.prank(alice);
        pool.startExpedition(teamId, 0);

        assertEq(pool.getSeasonUnspent(1), S1_EMISSION - BASE_REWARD);
    }

    function test_getSeasonUnspentReturnsZeroWhenFullyMinted() public {
        _startSeasonWith(BASE_REWARD, BASE_REWARD);

        uint256 teamId = _createTeam(alice, 0);
        vm.prank(alice);
        pool.startExpedition(teamId, 0);

        assertEq(pool.getSeasonUnspent(1), 0);
    }

    function test_getExpeditionDoesNotExistReverts() public {
        vm.expectRevert(abi.encodeWithSelector(MiningPool.ExpeditionDoesNotExist.selector, 999));
        pool.getExpedition(999);
    }

    function test_getActiveExpeditionReturnsZeroWhenNone() public view {
        assertEq(pool.getActiveExpedition(999), 0);
    }

    // ──────────── Full Mining Cycle Integration ────────────

    function test_fullMiningCycleE2E() public {
        // Setup: create teams at different tiers
        uint256 baseTeam = _createTeam(alice, 0);
        uint256 evolvedTeam = _createTeam(bob, 1);

        _startSeason();

        // Both start expeditions
        vm.prank(alice);
        uint256 baseExp = pool.startExpedition(baseTeam, 0);

        vm.prank(bob);
        uint256 evolvedExp = pool.startExpedition(evolvedTeam, 1);

        // Both teams should be active
        assertTrue(tm.isTeamActive(baseTeam));
        assertTrue(tm.isTeamActive(evolvedTeam));

        // Budget reserved
        assertEq(pool.getSeasonMinted(1), BASE_REWARD + BASE_REWARD * 3);

        // Fast forward 4 hours
        vm.warp(block.timestamp + 4 hours);

        // Both claim
        vm.prank(alice);
        pool.claimExpedition(baseExp);

        vm.prank(bob);
        pool.claimExpedition(evolvedExp);

        // Teams deactivated
        assertFalse(tm.isTeamActive(baseTeam));
        assertFalse(tm.isTeamActive(evolvedTeam));

        // Alice got BASE_REWARD (1,250), Bob got 3x (3,750)
        assertEq(claw.balanceOf(alice), BASE_REWARD);
        assertEq(claw.balanceOf(bob), BASE_REWARD * 3);

        // Can start new expeditions
        vm.prank(alice);
        pool.startExpedition(baseTeam, 0);
        assertTrue(tm.isTeamActive(baseTeam));
    }

    function test_multiSeasonCycle() public {
        uint256 teamId = _createTeam(alice, 0);

        // Season 1
        _startSeason();
        vm.prank(alice);
        uint256 exp1 = pool.startExpedition(teamId, 0);
        vm.warp(block.timestamp + 4 hours);
        vm.prank(alice);
        pool.claimExpedition(exp1);

        // End season 1
        vm.warp(block.timestamp + 60 days);

        // Season 2 with different params
        uint256 s2Emission = S1_EMISSION / 2;
        uint256 s2BaseReward = 800e18;
        _startSeasonWith(s2Emission, s2BaseReward);

        vm.prank(alice);
        uint256 exp2 = pool.startExpedition(teamId, 0);
        vm.warp(block.timestamp + 4 hours);
        vm.prank(alice);
        pool.claimExpedition(exp2);

        // Alice earned BASE_REWARD from S1 + s2BaseReward from S2
        assertEq(claw.balanceOf(alice), BASE_REWARD + s2BaseReward);

        // Season stats independent
        assertEq(pool.getSeasonMinted(1), BASE_REWARD);
        assertEq(pool.getSeasonMinted(2), s2BaseReward);
    }

    // ──────────── Fuzz ────────────

    function testFuzz_tierWeightsCorrect(uint8 tier) public {
        tier = uint8(bound(tier, 0, 3));

        uint256 teamId = _createTeam(alice, tier);
        _startSeason();

        vm.prank(alice);
        uint256 expId = pool.startExpedition(teamId, tier);

        MiningPool.Expedition memory exp = pool.getExpedition(expId);
        uint256[4] memory expectedWeights = [uint256(1), 3, 10, 25];
        assertEq(exp.reward, BASE_REWARD * expectedWeights[tier]);
    }

    function testFuzz_totalMintedNeverExceedsTotalEmission(uint8 numExpeditions) public {
        numExpeditions = uint8(bound(numExpeditions, 1, 20));

        uint256 emission = BASE_REWARD * 100; // enough for 100 Base expeditions
        _startSeasonWith(emission, BASE_REWARD);

        uint256 started;
        for (uint256 i = 0; i < numExpeditions; i++) {
            address miner = makeAddr(string(abi.encodePacked("miner", i)));
            uint256 teamId = _createTeam(miner, 0);

            vm.prank(miner);
            pool.startExpedition(teamId, 0);
            started++;

            // Warp and claim to free team
            vm.warp(block.timestamp + 4 hours);
            vm.prank(miner);
            pool.claimExpedition(started);
        }

        // Total minted should never exceed emission
        assertLe(pool.getSeasonMinted(1), emission);
        // Should equal exactly numExpeditions × BASE_REWARD
        assertEq(pool.getSeasonMinted(1), uint256(numExpeditions) * BASE_REWARD);
    }

    function testFuzz_budgetExhaustsCleanly(uint8 numTeams) public {
        numTeams = uint8(bound(numTeams, 1, 10));

        // Budget fits exactly numTeams expeditions
        uint256 emission = BASE_REWARD * numTeams;
        _startSeasonWith(emission, BASE_REWARD);

        // Start all numTeams expeditions
        for (uint256 i = 0; i < numTeams; i++) {
            address miner = makeAddr(string(abi.encodePacked("fminer", i)));
            uint256 teamId = _createTeam(miner, 0);
            vm.prank(miner);
            pool.startExpedition(teamId, 0);
        }

        // Budget should be exactly exhausted
        assertEq(pool.getSeasonUnspent(1), 0);

        // One more should revert
        address extraMiner = makeAddr("extraMiner");
        uint256 extraTeam = _createTeam(extraMiner, 0);
        vm.prank(extraMiner);
        vm.expectRevert(MiningPool.SeasonBudgetExhausted.selector);
        pool.startExpedition(extraTeam, 0);
    }

    // ──────────── P-01 Regression: team.active check prevents cross-contract double-use ────────────

    function test_startExpeditionRevertsWhenTeamIsActive() public {
        uint256 teamId = _createTeam(alice, 0);
        _startSeason();

        // Simulate BattleArena (or another ACTIVITY_ROLE holder) marking the team active
        vm.startPrank(admin);
        tm.grantRole(tm.ACTIVITY_ROLE(), admin);
        tm.setTeamActive(teamId, true);
        vm.stopPrank();

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(MiningPool.TeamIsActive.selector, teamId));
        pool.startExpedition(teamId, 0);
    }

    function test_activeTeamCannotMineEvenWithNoExpeditionMapping() public {
        uint256 teamId = _createTeam(alice, 0);
        _startSeason();

        // Team is active (e.g., in battle) but has no expedition mapping
        vm.startPrank(admin);
        tm.grantRole(tm.ACTIVITY_ROLE(), admin);
        tm.setTeamActive(teamId, true);
        vm.stopPrank();

        // Verify no expedition exists for this team
        assertEq(pool.getActiveExpedition(teamId), 0);

        // Should still revert due to team.active check
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(MiningPool.TeamIsActive.selector, teamId));
        pool.startExpedition(teamId, 0);

        // Deactivate team, now expedition should succeed
        vm.prank(admin);
        tm.setTeamActive(teamId, false);

        vm.prank(alice);
        uint256 expId = pool.startExpedition(teamId, 0);
        assertGt(expId, 0);
    }

    // ──────────── M-02 Regression: Escrow-at-start prevents permanent team lock ────────────

    function test_startExpeditionRevertsWhenMaxSupplyInsufficient() public {
        // Arrange: consume nearly all of ClawToken's remaining mintable supply
        // Initial supply: 125M (LP) + 100M (treasury) = 225M minted at deploy
        // MAX_SUPPLY = 1B, so 775M remaining
        uint256 remaining = claw.remainingMintable();

        // Mint all but a tiny amount (less than BASE_REWARD) to exhaust supply
        uint256 leaveAvailable = BASE_REWARD / 2; // not enough for an expedition
        uint256 consumeAmount = remaining - leaveAvailable;

        // Grant admin minting power and consume supply
        vm.startPrank(admin);
        claw.grantRole(claw.MINTER_ROLE(), admin);
        claw.mint(makeAddr("sink"), consumeAmount);
        vm.stopPrank();

        // Verify headroom is insufficient
        assertLt(claw.remainingMintable(), BASE_REWARD);

        uint256 teamId = _createTeam(alice, 0);
        // Use a small season budget that would normally fit
        _startSeasonWith(BASE_REWARD * 10, BASE_REWARD);

        // Act: startExpedition should revert because mint to escrow fails
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(ClawToken.ExceedsMaxSupply.selector, BASE_REWARD, leaveAvailable));
        pool.startExpedition(teamId, 0);

        // Assert: team is NOT stuck active, no expedition mapped
        assertFalse(tm.isTeamActive(teamId));
        assertEq(pool.getActiveExpedition(teamId), 0);
        // Season budget unchanged
        assertEq(pool.getSeasonMinted(1), 0);
    }

    function test_claimSucceedsEvenWhenGlobalSupplyLaterExhausted() public {
        uint256 teamId = _createTeam(alice, 0);
        _startSeason();

        // Start expedition — reward is escrowed in pool at this point
        vm.prank(alice);
        uint256 expId = pool.startExpedition(teamId, 0);
        uint256 poolBal = claw.balanceOf(address(pool));
        assertGe(poolBal, BASE_REWARD);

        // Now exhaust remaining global supply via another minter
        uint256 remaining = claw.remainingMintable();
        if (remaining > 0) {
            vm.startPrank(admin);
            claw.grantRole(claw.MINTER_ROLE(), admin);
            claw.mint(makeAddr("sink"), remaining);
            vm.stopPrank();
        }
        assertEq(claw.remainingMintable(), 0);

        // Warp past expedition duration
        vm.warp(block.timestamp + 4 hours);

        // Claim should succeed — it transfers from escrow, no mint needed
        vm.prank(alice);
        pool.claimExpedition(expId);

        assertEq(claw.balanceOf(alice), BASE_REWARD);
        assertFalse(tm.isTeamActive(teamId));
        assertEq(pool.getActiveExpedition(teamId), 0);
    }

    function test_startExpeditionEscrowsCorrectAmount() public {
        uint256 teamId = _createTeam(alice, 1); // Evolved tier
        _startSeason();

        uint256 poolBalBefore = claw.balanceOf(address(pool));

        vm.prank(alice);
        pool.startExpedition(teamId, 1);

        uint256 expectedReward = BASE_REWARD * 3; // Evolved weight
        assertEq(claw.balanceOf(address(pool)), poolBalBefore + expectedReward);
    }

    function test_claimReducesPoolBalance() public {
        uint256 teamId = _createTeam(alice, 0);
        _startSeason();

        vm.prank(alice);
        uint256 expId = pool.startExpedition(teamId, 0);

        uint256 poolBalAfterStart = claw.balanceOf(address(pool));
        assertEq(poolBalAfterStart, BASE_REWARD);

        vm.warp(block.timestamp + 4 hours);

        vm.prank(alice);
        pool.claimExpedition(expId);

        assertEq(claw.balanceOf(address(pool)), 0);
        assertEq(claw.balanceOf(alice), BASE_REWARD);
    }

    // ──────────── F-06: Admin expedition release ────────────

    function test_adminReleaseExpeditionAfterGracePeriod() public {
        uint256 teamId = _createTeam(alice, 0);
        _startSeason();

        vm.prank(alice);
        uint256 expId = pool.startExpedition(teamId, 0);

        // Team should be active
        assertTrue(tm.isTeamActive(teamId));

        // Warp past expedition + grace period (4h + 7d)
        vm.warp(block.timestamp + 4 hours + 7 days + 1);

        // Admin releases the stuck expedition
        vm.prank(admin);
        pool.adminReleaseExpedition(expId);

        // Team should be inactive now
        assertFalse(tm.isTeamActive(teamId));

        // Expedition marked as claimed
        MiningPool.Expedition memory exp = pool.getExpedition(expId);
        assertTrue(exp.claimed);

        // Reward was burned, not sent anywhere
        assertEq(claw.balanceOf(address(pool)), 0);
    }

    function test_adminReleaseExpeditionRevertsBeforeGrace() public {
        uint256 teamId = _createTeam(alice, 0);
        _startSeason();

        vm.prank(alice);
        uint256 expId = pool.startExpedition(teamId, 0);

        // Warp past expedition but NOT past grace period
        vm.warp(block.timestamp + 4 hours + 1);

        vm.prank(admin);
        vm.expectRevert(); // AdminReleaseTooEarly
        pool.adminReleaseExpedition(expId);
    }

    function test_adminReleaseExpeditionRevertsForNonAdmin() public {
        uint256 teamId = _createTeam(alice, 0);
        _startSeason();

        vm.prank(alice);
        uint256 expId = pool.startExpedition(teamId, 0);

        vm.warp(block.timestamp + 4 hours + 7 days + 1);

        // Alice (not admin) cannot release
        vm.prank(alice);
        vm.expectRevert();
        pool.adminReleaseExpedition(expId);
    }

    function test_adminReleaseExpeditionCannotDoubleClaim() public {
        uint256 teamId = _createTeam(alice, 0);
        _startSeason();

        vm.prank(alice);
        uint256 expId = pool.startExpedition(teamId, 0);

        vm.warp(block.timestamp + 4 hours + 7 days + 1);

        vm.prank(admin);
        pool.adminReleaseExpedition(expId);

        // Second release should revert (already claimed)
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(MiningPool.ExpeditionAlreadyClaimed.selector, expId));
        pool.adminReleaseExpedition(expId);
    }
}
