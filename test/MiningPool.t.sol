// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, Vm, stdStorage, StdStorage} from "forge-std/Test.sol";
import {MiningPool} from "../contracts/MiningPool.sol";
import {PauseSwitch} from "../contracts/PauseSwitch.sol";
import {TeamManager} from "../contracts/TeamManager.sol";
import {LobsterNFT} from "../contracts/LobsterNFT.sol";
import {GoldToken} from "../contracts/GoldToken.sol";
import {DNALib} from "../contracts/libraries/DNALib.sol";

contract MiningPoolTest is Test {
    using stdStorage for StdStorage;

    MiningPool pool;
    PauseSwitch ps;
    TeamManager tm;
    LobsterNFT nft;
    GoldToken gold;

    address admin = makeAddr("admin");
    address seasonAdmin = makeAddr("seasonAdmin");
    address boostAdmin = makeAddr("boostAdmin");
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
        gold = new GoldToken(admin, lpAddress, treasuryAddress);
        tm = new TeamManager(admin, address(nft));
        ps = new PauseSwitch(admin);
        pool = new MiningPool(admin, address(gold), address(nft), address(tm), address(ps));

        // Grant roles
        nft.grantRole(nft.MINTER_ROLE(), admin);
        nft.grantRole(nft.LOCKER_ROLE(), address(tm));
        nft.grantRole(nft.EVOLVER_ROLE(), admin);
        tm.grantRole(tm.ACTIVITY_ROLE(), address(pool));
        gold.grantRole(gold.MINTER_ROLE(), address(pool));
        pool.grantRole(pool.SEASON_ADMIN_ROLE(), seasonAdmin);
        pool.grantRole(pool.BOOST_ADMIN_ROLE(), boostAdmin);
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
        assertEq(address(pool.goldToken()), address(gold));
        assertEq(address(pool.lobsterNFT()), address(nft));
        assertEq(address(pool.teamManager()), address(tm));
        assertTrue(pool.hasRole(pool.DEFAULT_ADMIN_ROLE(), admin));
        assertEq(pool.nextExpeditionId(), 1);
        assertEq(pool.currentSeason(), 0);
    }

    function test_constructorZeroAdminReverts() public {
        vm.expectRevert(MiningPool.ZeroAddress.selector);
        new MiningPool(address(0), address(gold), address(nft), address(tm), address(ps));
    }

    function test_constructorZeroGoldReverts() public {
        vm.expectRevert(MiningPool.ZeroAddress.selector);
        new MiningPool(admin, address(0), address(nft), address(tm), address(ps));
    }

    function test_constructorZeroNFTReverts() public {
        vm.expectRevert(MiningPool.ZeroAddress.selector);
        new MiningPool(admin, address(gold), address(0), address(tm), address(ps));
    }

    function test_constructorZeroTMReverts() public {
        vm.expectRevert(MiningPool.ZeroAddress.selector);
        new MiningPool(admin, address(gold), address(nft), address(0), address(ps));
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

        // Change baseReward (D-D: at most 3x the launch reward)
        vm.prank(seasonAdmin);
        pool.setBaseReward(3_000e18);

        // In-flight expedition still has old reward
        MiningPool.Expedition memory expAfter = pool.getExpedition(expId);
        assertEq(expAfter.reward, BASE_REWARD);

        // New expedition gets new reward
        uint256 team2 = _createTeam(alice, 0);
        vm.prank(alice);
        uint256 expId2 = pool.startExpedition(team2, 0);

        MiningPool.Expedition memory exp2 = pool.getExpedition(expId2);
        assertEq(exp2.reward, 3_000e18);
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
        uint256 poolBalBefore = gold.balanceOf(address(pool));

        vm.prank(alice);
        pool.startExpedition(teamId, 0);

        assertEq(pool.getSeasonMinted(1), BASE_REWARD);
        assertEq(pool.getSeasonUnspent(1), S1_EMISSION - BASE_REWARD);
        // Reward minted into pool escrow at expedition start
        assertEq(gold.balanceOf(address(pool)), poolBalBefore + BASE_REWARD);
    }

    function test_startExpeditionEmitsEvent() public {
        uint256 teamId = _createTeam(alice, 0);
        _startSeason();

        vm.prank(alice);
        vm.expectEmit(true, true, true, true);
        emit MiningPool.ExpeditionStarted(1, teamId, alice, 0, BASE_REWARD, 0);
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
        assertEq(gold.balanceOf(alice), BASE_REWARD);

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

        assertEq(gold.balanceOf(alice), BASE_REWARD * 3);
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
        assertEq(gold.balanceOf(alice), BASE_REWARD * 2);
        assertEq(gold.balanceOf(bob), BASE_REWARD);
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
        assertEq(gold.balanceOf(alice), BASE_REWARD);
        assertEq(gold.balanceOf(bob), BASE_REWARD * 3);

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
        assertEq(gold.balanceOf(alice), BASE_REWARD + s2BaseReward);

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
        // TOK-G1: rewards glide once expeditions cross epoch boundaries, so minted is
        // bounded by numExpeditions x launch reward rather than pinned to it.
        assertLe(pool.getSeasonMinted(1), uint256(numExpeditions) * BASE_REWARD);
        assertGt(pool.getSeasonMinted(1), 0);
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
        // Arrange: consume nearly all of GoldToken's remaining mintable supply
        // Initial supply: 125M (LP) + 100M (treasury) = 225M minted at deploy
        // MAX_SUPPLY = 1B, so 775M remaining
        uint256 remaining = gold.remainingMintable();

        // Mint all but a tiny amount (less than BASE_REWARD) to exhaust supply
        uint256 leaveAvailable = BASE_REWARD / 2; // not enough for an expedition
        uint256 consumeAmount = remaining - leaveAvailable;

        // Grant admin minting power and consume supply
        vm.startPrank(admin);
        gold.grantRole(gold.MINTER_ROLE(), admin);
        gold.mint(makeAddr("sink"), consumeAmount);
        vm.stopPrank();

        // Verify headroom is insufficient
        assertLt(gold.remainingMintable(), BASE_REWARD);

        uint256 teamId = _createTeam(alice, 0);
        // Use a small season budget that would normally fit
        _startSeasonWith(BASE_REWARD * 10, BASE_REWARD);

        // Act: startExpedition should revert because mint to escrow fails
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(GoldToken.ExceedsMaxSupply.selector, BASE_REWARD, leaveAvailable));
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
        uint256 poolBal = gold.balanceOf(address(pool));
        assertGe(poolBal, BASE_REWARD);

        // Now exhaust remaining global supply via another minter
        uint256 remaining = gold.remainingMintable();
        if (remaining > 0) {
            vm.startPrank(admin);
            gold.grantRole(gold.MINTER_ROLE(), admin);
            gold.mint(makeAddr("sink"), remaining);
            vm.stopPrank();
        }
        assertEq(gold.remainingMintable(), 0);

        // Warp past expedition duration
        vm.warp(block.timestamp + 4 hours);

        // Claim should succeed — it transfers from escrow, no mint needed
        vm.prank(alice);
        pool.claimExpedition(expId);

        assertEq(gold.balanceOf(alice), BASE_REWARD);
        assertFalse(tm.isTeamActive(teamId));
        assertEq(pool.getActiveExpedition(teamId), 0);
    }

    function test_startExpeditionEscrowsCorrectAmount() public {
        uint256 teamId = _createTeam(alice, 1); // Evolved tier
        _startSeason();

        uint256 poolBalBefore = gold.balanceOf(address(pool));

        vm.prank(alice);
        pool.startExpedition(teamId, 1);

        uint256 expectedReward = BASE_REWARD * 3; // Evolved weight
        assertEq(gold.balanceOf(address(pool)), poolBalBefore + expectedReward);
    }

    function test_claimReducesPoolBalance() public {
        uint256 teamId = _createTeam(alice, 0);
        _startSeason();

        vm.prank(alice);
        uint256 expId = pool.startExpedition(teamId, 0);

        uint256 poolBalAfterStart = gold.balanceOf(address(pool));
        assertEq(poolBalAfterStart, BASE_REWARD);

        vm.warp(block.timestamp + 4 hours);

        vm.prank(alice);
        pool.claimExpedition(expId);

        assertEq(gold.balanceOf(address(pool)), 0);
        assertEq(gold.balanceOf(alice), BASE_REWARD);
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
        assertEq(gold.balanceOf(address(pool)), 0);
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

    // ──────────── TOK-M1: 705M lifetime mining cap ────────────

    function test_TOK_M1_lifetimeCap_blocksMintPast705M() public {
        uint256 teamA = _createTeam(alice, 0);
        uint256 teamB = _createTeam(alice, 0);

        // Huge season budget so the SEASON cap isn't the binding constraint; baseReward
        // sized so two Base expeditions (weight 1) would mint 800M > the 705M lifetime cap.
        _startSeasonWith(2_000_000_000e18, 400_000_000e18);

        vm.prank(alice);
        pool.startExpedition(teamA, 0);
        assertEq(pool.lifetimeMinted(), 400_000_000e18, "first expedition counted toward lifetime");

        // 400M + 400M = 800M > 705M → blocked. Since D-20 the 2B season budget is clamped to the
        // 705M allocation at startSeason, so the season check is the one that fires; the lifetime
        // check behind it is exercised directly in test_D20_lifetimeCheckStillGuardsStartExpedition.
        assertEq(pool.getSeasonConfig(1).totalEmission, pool.MINING_ALLOCATION(), "season budget clamped to the allocation");
        vm.prank(alice);
        vm.expectRevert(MiningPool.SeasonBudgetExhausted.selector);
        pool.startExpedition(teamB, 0);

        assertLe(pool.lifetimeMinted(), pool.MINING_ALLOCATION(), "lifetimeMinted never exceeds 705M");
    }

    function test_TOK_M1_lifetimeMinted_persistsAcrossSeasonReset() public {
        uint256 teamA = _createTeam(alice, 0);

        _startSeasonWith(2_000_000_000e18, 100_000_000e18);
        vm.prank(alice);
        pool.startExpedition(teamA, 0);
        assertEq(pool.lifetimeMinted(), 100_000_000e18, "minted in season 1");

        // New season resets season.totalMinted to 0 — but lifetimeMinted must persist,
        // which is the whole point of TOK-M1 (per-season caps don't bound the lifetime total).
        vm.warp(block.timestamp + pool.SEASON_DURATION());
        _startSeasonWith(2_000_000_000e18, 100_000_000e18);
        assertEq(pool.lifetimeMinted(), 100_000_000e18, "lifetimeMinted persists across season reset");
    }

    // ──────────── D-20: a season cannot promise more than the lifetime allocation has left ────────────

    function test_D20_seasonBudgetIsClampedToTheAllocationLeft() public {
        _startSeasonWith(2_000_000_000e18, BASE_REWARD);
        assertEq(pool.getSeasonConfig(1).totalEmission, pool.MINING_ALLOCATION());
    }

    /// @dev The final season: the schedule's nominal 7.05M overshoots the ~3.97M actually left.
    function test_D20_finalSeasonPacesAgainstWhatIsLeft() public {
        stdstore.target(address(pool)).sig("lifetimeMinted()").checked_write(701_030_000e18);
        _startSeasonWith(7_050_000e18, BASE_REWARD);
        assertEq(pool.getSeasonConfig(1).totalEmission, 3_970_000e18, "budget = what the 705M cap still allows");
        assertEq(pool.getSeasonUnspent(1), 3_970_000e18);
    }

    function test_D20_startSeasonRevertsWhenNothingIsLeft() public {
        stdstore.target(address(pool)).sig("lifetimeMinted()").checked_write(pool.MINING_ALLOCATION());
        vm.prank(seasonAdmin);
        vm.expectRevert(MiningPool.MiningAllocationExhausted.selector);
        pool.startSeason(7_050_000e18, BASE_REWARD);
    }

    /// @dev Defence in depth: with the season clamp the lifetime check in startExpedition can no
    ///      longer be reached through normal play, so force the state it guards against.
    function test_D20_lifetimeCheckStillGuardsStartExpedition() public {
        _startSeasonWith(705_000_000e18, 100_000_000e18);
        uint256 teamId = _createTeam(alice, 0);
        stdstore.target(address(pool)).sig("lifetimeMinted()").checked_write(650_000_000e18);
        vm.prank(alice);
        vm.expectRevert(MiningPool.MiningAllocationExhausted.selector);
        pool.startExpedition(teamId, 0);
    }

    // ──────────── TOK-G1 glide (hourly epochs + spend ceiling since D-19) ────────────

    /// @dev Six Base teams, one expedition each, all inside the current epoch. Six teams rather
    ///      than one team six times: a 4 h expedition cadence crosses hourly epochs, and these
    ///      vectors need all six units of demand inside ONE epoch. Returns the first team.
    function _sixBaseExpeditionsInThisEpoch() internal returns (uint256 firstTeam, uint256[6] memory eids) {
        for (uint256 i = 0; i < 6; i++) {
            uint256 t = _createTeam(alice, 0);
            if (i == 0) firstTeam = t;
            vm.prank(alice);
            eids[i] = pool.startExpedition(t, 0);
        }
    }

    /// @dev Tight budget (100 Base-expedition units over the season): six Base expeditions in
    ///      hour 0, then across the epoch boundary. The first re-peg targets far below launch,
    ///      so the -30% damping clamp binds -> reward 1,250 -> 875.
    function _runSixThenCrossEpoch() internal returns (uint256 teamId) {
        _startSeasonWith(BASE_REWARD * 100, BASE_REWARD);
        uint256[6] memory eids;
        (teamId, eids) = _sixBaseExpeditionsInThisEpoch();
        vm.warp(block.timestamp + 4 hours); // epoch 4; the six expeditions have matured
        for (uint256 i = 0; i < 6; i++) {
            vm.prank(alice);
            pool.claimExpedition(eids[i]); // claims never touch the glide
        }
    }

    function test_glideRepegsDownWithDampingClamp() public {
        uint256 teamId = _runSixThenCrossEpoch();
        // 7th expedition is in a later epoch: re-peg fires, clamped to 70% of 1,250.
        vm.prank(alice);
        pool.startExpedition(teamId, 0);
        assertEq(pool.currentBaseReward(), (BASE_REWARD * 7_000) / 10_000);
        assertEq(pool.getSeasonMinted(1), 6 * BASE_REWARD + (BASE_REWARD * 7_000) / 10_000);
    }

    function test_D19_glideConstants() public view {
        assertEq(pool.REPEG_EPOCH(), 1 hours, "the glide re-pegs hourly");
        assertEq(pool.SEASON_DURATION() / pool.REPEG_EPOCH(), 1_440, "1,440 epochs a season");
        assertEq(pool.EPOCH_SPEND_CAP_BPS(), 20_000, "an epoch may mint twice its fair share");
    }

    // ── D-18: the epoch count includes this one ──

    /// @dev One hour in, 1,439 epochs remain INCLUDING this one. Budget chosen so the target
    ///      lands inside the ±30% band (otherwise the clamp hides the count): 1,000 GOLD per unit
    ///      over 1,439 epochs x 6 units, plus the 7,500 served in hour 0. Warped past the
    ///      boundary second, where the old formula happened to be right.
    function test_D18_epochCountIncludesThisOne() public {
        uint256 remaining = 1_000e18 * 1_439 * 6;
        _startSeasonWith(remaining + 6 * BASE_REWARD, BASE_REWARD);
        _sixBaseExpeditionsInThisEpoch();
        vm.warp(block.timestamp + 1 hours + 5 minutes); // epoch 1, not on the boundary second
        pool.repeg();
        assertEq(pool.currentBaseReward(), 1_000e18, "paced over the 1,439 epochs left including this one");
        assertTrue(pool.currentBaseReward() != remaining / (1_438 * 6), "not the old off-by-one pace");
    }

    /// @dev The consequence the audit named: a crowded season paced one epoch short ran dry
    ///      early and nobody could mine at the end. Demand in every hour (four teams on a 4 h
    ///      cadence, one starting each hour) against a budget tight enough that the glide binds
    ///      all season — mining must still work in the last epoch.
    function test_D18_crowdedSeasonStillPaysInTheLastEpoch() public {
        _startSeasonWith(BASE_REWARD * 200, BASE_REWARD);
        uint256[4] memory teams;
        uint256[4] memory eids;
        for (uint256 i = 0; i < 4; i++) teams[i] = _createTeam(alice, 0);
        uint256 start = block.timestamp;
        for (uint256 h = 0; h < 1_440; h++) {
            // Five minutes past the hour: on the exact boundary second the old formula happened
            // to be right, which is how an earlier version of this test passed against the bug.
            vm.warp(start + h * 1 hours + 5 minutes);
            uint256 slot = h % 4;
            if (eids[slot] != 0) {
                vm.prank(alice);
                pool.claimExpedition(eids[slot]); // started 4 h ago, matured
            }
            vm.prank(alice);
            eids[slot] = pool.startExpedition(teams[slot], 0); // reverted SeasonBudgetExhausted at the end before the fix
        }
        assertLe(pool.getSeasonMinted(1), BASE_REWARD * 200, "never over budget");
        assertGe(pool.getSeasonMinted(1), (BASE_REWARD * 200 * 95) / 100, "and the budget is actually distributed, not stranded");
    }

    // ── D-19(c): an exhausted budget is not a demand signal ──

    /// @dev Before the fix a target of zero walked baseReward down 30% per repeg() toward
    ///      1 wei — and RepairShop prices, which are basis points of it, toward free.
    function test_D19_exhaustedBudgetHoldsTheRate() public {
        _startSeasonWith(BASE_REWARD * 6, BASE_REWARD);
        _sixBaseExpeditionsInThisEpoch();
        assertEq(pool.getSeasonUnspent(1), 0, "budget spent in hour one");
        for (uint256 h = 0; h < 10; h++) {
            vm.warp(block.timestamp + 1 hours);
            pool.repeg(); // anyone, every hour
        }
        assertEq(pool.currentBaseReward(), BASE_REWARD, "rate held: repair prices cannot be ground to zero");
    }

    /// @dev The gap the D-19 simulation found in that fix (#99 held only at EXACTLY zero):
    ///      expeditions are discrete, so an exhausted season normally keeps a remainder smaller
    ///      than one reward — and with it the decay went on, 1,250 -> 875 -> 612 -> 429 on
    ///      consecutive re-pegs, until the depressed rate fitted the remainder and a cut-price
    ///      expedition could start. Anything under one Base reward now holds.
    function test_D19_dustRemainderHoldsTheRate() public {
        _startSeasonWith(BASE_REWARD * 6 + BASE_REWARD / 2, BASE_REWARD);
        _sixBaseExpeditionsInThisEpoch();
        assertEq(pool.getSeasonUnspent(1), BASE_REWARD / 2, "half a reward left: nothing can start");
        uint256 spare = _createTeam(alice, 0);
        for (uint256 h = 0; h < 10; h++) {
            vm.warp(block.timestamp + 1 hours);
            pool.repeg();
            assertEq(pool.currentBaseReward(), BASE_REWARD, "rate held on a dust remainder");
            vm.prank(alice);
            vm.expectRevert(MiningPool.SeasonBudgetExhausted.selector);
            pool.startExpedition(spare, 0);
        }
    }

    // ── D-19: the per-epoch spend ceiling ──

    /// @dev S1 budget: hour 0's ceiling is 2 x 352.5M / 1,440 = 489,583.3 GOLD. Fifteen Apex
    ///      expeditions at launch (468,750) fit; the sixteenth (500,000) does not, and the revert
    ///      names when the next epoch opens. There it starts — against a fresh counter, at the
    ///      rate the fifteen pulled down.
    function test_D19_epochSpendCeilingBindsThenOpensNextEpoch() public {
        _startSeason();
        uint256 start = block.timestamp;
        uint256 cap = (S1_EMISSION * 20_000) / (10_000 * 1_440);
        uint256 apex = BASE_REWARD * 25;
        uint256[16] memory teams;
        for (uint256 i = 0; i < 16; i++) teams[i] = _createTeam(alice, 3);
        for (uint256 i = 0; i < 15; i++) {
            vm.prank(alice);
            pool.startExpedition(teams[i], 3);
        }
        (uint256 viewCap, uint256 viewMinted, uint256 viewNext) = pool.epochBudget();
        assertEq(viewCap, cap, "epochBudget(): the ceiling");
        assertEq(viewMinted, 15 * apex, "epochBudget(): minted against it");
        assertEq(viewNext, start + 1 hours, "epochBudget(): when the next epoch opens");
        assertGt(viewMinted + apex, cap, "a sixteenth would cross the ceiling");

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(MiningPool.EpochBudgetFull.selector, start + 1 hours));
        pool.startExpedition(teams[15], 3);
        assertEq(pool.getSeasonMinted(1), 15 * apex, "the refused expedition minted nothing");

        vm.warp(start + 1 hours);
        (, viewMinted,) = pool.epochBudget();
        assertEq(viewMinted, 0, "a new epoch starts with an empty counter, before anyone touches it");
        vm.prank(alice);
        uint256 eid = pool.startExpedition(teams[15], 3);
        // The re-peg saw 375 units of demand: target far below launch -> the clamp -> 875 x 25.
        assertEq(pool.getExpedition(eid).reward, ((BASE_REWARD * 7_000) / 10_000) * 25, "started at the glided rate");
    }

    /// @dev The ceiling never falls below one expedition of the heaviest tier at the highest
    ///      boost: the rate only moves on a demand signal, so an epoch that could admit nothing
    ///      would never re-peg — a deadlock. A tiny season (2 x 125,000 / 1,440 = 174 GOLD an
    ///      hour) therefore still admits one +50% Apex expedition (46,875) per hour, and no more.
    function test_D19_ceilingFloorsAtOneMaxExpedition() public {
        _startSeasonWith(BASE_REWARD * 100, BASE_REWARD);
        uint256[] memory pair = new uint256[](2);
        pair[0] = _createTeam(alice, 3);
        pair[1] = _createTeam(alice, 3);
        _postAndActivateAll(pair, 5_000);
        uint256 oneMax = _boosted(BASE_REWARD, 5_000) * 25;
        (uint256 cap,,) = pool.epochBudget();
        assertEq(cap, oneMax, "floor: one Apex expedition at +50%");
        vm.prank(alice);
        uint256 eid = pool.startExpedition(pair[0], 3);
        assertEq(pool.getExpedition(eid).reward, oneMax);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(MiningPool.EpochBudgetFull.selector, block.timestamp + 1 hours));
        pool.startExpedition(pair[1], 3);
    }

    /// @dev In the last epoch the ceiling is twice what is left, so it never binds: whatever the
    ///      budget can still pay, it pays. The same three Apex expeditions in hour 0 would have
    ///      been held to one an hour by the floor.
    function test_D19_ceilingNeverBindsInTheLastEpoch() public {
        uint256 apex = BASE_REWARD * 25;
        _startSeasonWith(apex * 3, BASE_REWARD);
        uint256[4] memory teams;
        for (uint256 i = 0; i < 4; i++) teams[i] = _createTeam(alice, 3);
        vm.warp(block.timestamp + 1_439 hours + 5 minutes); // the last epoch
        (uint256 cap,,) = pool.epochBudget();
        assertEq(cap, apex * 6, "twice what is left, paced over the one epoch left");
        for (uint256 i = 0; i < 3; i++) {
            vm.prank(alice);
            pool.startExpedition(teams[i], 3);
        }
        assertEq(pool.getSeasonUnspent(1), 0, "the whole remaining budget went out in the last epoch");
        vm.prank(alice);
        vm.expectRevert(MiningPool.SeasonBudgetExhausted.selector);
        pool.startExpedition(teams[3], 3);
    }

    /// @dev D-20 inside the ceiling: when less of the 705M allocation is left than the season's
    ///      nominal budget, the ceiling paces what can actually be minted. Pinned after the
    ///      season started (startSeason itself clamps the budget), 1M GOLD left: 2 x 1M / 1,440
    ///      is under the floor, so one Apex expedition an hour — where the nominal 352.5M budget
    ///      would have admitted fifteen.
    function test_D19_ceilingPacesTheAllocationLeft() public {
        _startSeason();
        stdstore.target(address(pool)).sig("lifetimeMinted()").checked_write(pool.MINING_ALLOCATION() - 1_000_000e18);
        uint256 a = _createTeam(alice, 3);
        uint256 b = _createTeam(alice, 3);
        (uint256 cap,,) = pool.epochBudget();
        assertEq(cap, _boosted(BASE_REWARD, 5_000) * 25, "paced on the allocation left: the floor");
        vm.prank(alice);
        pool.startExpedition(a, 3);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(MiningPool.EpochBudgetFull.selector, block.timestamp + 1 hours));
        pool.startExpedition(b, 3);
    }

    function test_D19_epochBudgetViewIsZeroWithoutASeason() public view {
        (uint256 cap, uint256 minted, uint256 nextEpochAt) = pool.epochBudget();
        assertEq(cap, 0);
        assertEq(minted, 0);
        assertEq(nextEpochAt, 0);
    }

    // ── D-C (review 2026-10-03): the demand window ──

    function test_DC_windowConstants() public view {
        assertEq(pool.DEMAND_WINDOW(), 4, "one expedition cycle of hourly epochs");
        assertEq(pool.MAX_BASE_REWARD_STEP_X(), 3, "D-D: a launch or override may not exceed 3x");
    }

    /// @dev A population that starts everything in one hour of four (the 4 h cadence) is paced as
    ///      the average over those hours. The single-epoch rule read six units in hour 0 as six
    ///      units EVERY hour and pinned the rate at 1,000 for good; the window averages them.
    function test_DC_phaseLockedPopulationIsPacedAsItsAverage() public {
        uint256 remaining = 1_000e18 * 1_439 * 6; // the D-18 vector: 6 units an hour is the design rate
        _startSeasonWith(remaining + 6 * BASE_REWARD, BASE_REWARD);
        _sixBaseExpeditionsInThisEpoch(); // hour 0 only
        vm.warp(block.timestamp + 1 hours + 5 minutes);
        pool.repeg();
        assertEq(pool.currentBaseReward(), 1_000e18, "hour 1: one closed epoch of six units, paced as the design rate");
        assertEq(pool.getSeasonConfig(1).trailingWeightServed, 6);
        for (uint256 h = 2; h <= 4; h++) {
            vm.warp(block.timestamp + 1 hours);
            pool.repeg();
            assertEq(pool.getSeasonConfig(1).trailingWeightServed, 6 / h, "six units over h closed epochs");
        }
        // Six units over four epochs is a quarter of the design demand: the target is far above
        // launch, so the rate climbs +30% a step and sits at the launch cap.
        assertEq(pool.currentBaseReward(), BASE_REWARD, "a quarter of the design demand: the launch cap");
    }

    /// @dev The same vector touched three hours later instead of one: the two skipped epochs were
    ///      quiet, and the lazy re-peg reads them that way (one step, from the window's average).
    function test_DC_lazyGapInsideTheWindowCountsSkippedEpochsAsQuiet() public {
        uint256 remaining = 1_000e18 * 1_439 * 6;
        _startSeasonWith(remaining + 6 * BASE_REWARD, BASE_REWARD);
        _sixBaseExpeditionsInThisEpoch();
        vm.warp(block.timestamp + 3 hours + 5 minutes); // epoch 3: epochs 1 and 2 untouched
        pool.repeg();
        assertEq(pool.getSeasonConfig(1).trailingWeightServed, 2, "six units over three closed epochs");
        // target = left x 3 / (1,437 x 6) = 3,004: above the +30% bound and above launch -> launch
        assertEq(pool.currentBaseReward(), BASE_REWARD);
    }

    /// @dev The epoch just closed is exactly the window's age after a gap of DEMAND_WINDOW
    ///      epochs: it is still inside the window and still counts (a gap of one more clears it).
    function test_DC_gapOfExactlyTheWindowKeepsTheClosedEpoch() public {
        _startSeasonWith(BASE_REWARD * 100, BASE_REWARD);
        _sixBaseExpeditionsInThisEpoch();
        vm.warp(block.timestamp + 4 hours + 5 minutes); // epoch 4: epochs 1-3 quiet, epoch 0 is the window's oldest slot
        pool.repeg();
        assertEq(pool.getSeasonConfig(1).trailingWeightServed, 1, "six units over four closed epochs, floored");
        // target = 117,500 x 4 / (1,436 x 6) = 54: far below -> the clamp. A hold would be 1,250.
        assertEq(pool.currentBaseReward(), (BASE_REWARD * 7_000) / 10_000, "the burst still paces the rate");
    }

    /// @dev A gap longer than the window leaves nothing recent: the rate holds (no demand
    ///      signal), it does not keep stepping on a five-hour-old burst.
    function test_DC_gapLongerThanTheWindowHoldsTheRate() public {
        _startSeasonWith(BASE_REWARD * 100, BASE_REWARD);
        _sixBaseExpeditionsInThisEpoch();
        vm.warp(block.timestamp + 1 hours + 5 minutes);
        pool.repeg();
        uint256 glided = (BASE_REWARD * 7_000) / 10_000;
        assertEq(pool.currentBaseReward(), glided, "hour 1: the clamp");
        vm.warp(block.timestamp + 5 hours); // epoch 6: five untouched epochs, longer than the window
        pool.repeg();
        assertEq(pool.currentBaseReward(), glided, "no recent demand: hold");
        assertEq(pool.getSeasonConfig(1).trailingWeightServed, 0, "nothing in the window");
    }

    /// @dev I11: every epoch roll is an event — the estimate and the ceiling the new epoch opens
    ///      with — including a quiet roll that moved nothing.
    function test_I11_epochRolledEmittedOnEveryRoll() public {
        _startSeason();
        uint256 team = _createTeam(alice, 0);
        vm.prank(alice);
        pool.startExpedition(team, 0); // one unit in epoch 0
        uint256 cap = ((S1_EMISSION - BASE_REWARD) * 20_000) / (10_000 * 1_439);
        vm.warp(block.timestamp + 1 hours);
        vm.expectEmit(true, false, false, true);
        emit MiningPool.EpochRolled(1, 1, 1, cap);
        pool.repeg();
        uint256 cap2 = ((S1_EMISSION - BASE_REWARD) * 20_000) / (10_000 * 1_438);
        vm.warp(block.timestamp + 1 hours);
        vm.expectEmit(true, false, false, true);
        emit MiningPool.EpochRolled(1, 2, 0, cap2); // one unit over two closed epochs floors to 0
        pool.repeg();
    }

    // ── D-D (review 2026-10-03): guards against a mistyped season or override ──

    function test_DD_startSeasonBudgetBelowOneRewardReverts() public {
        vm.prank(seasonAdmin);
        vm.expectRevert(abi.encodeWithSelector(MiningPool.SeasonBudgetTooSmall.selector, 352_500_000, BASE_REWARD));
        pool.startSeason(352_500_000, BASE_REWARD); // the missing-e18 typo
    }

    function test_DD_startSeasonExactlyOneRewardIsAllowed() public {
        vm.prank(seasonAdmin);
        pool.startSeason(BASE_REWARD, BASE_REWARD);
        assertEq(pool.currentSeason(), 1);
    }

    function test_DD_nextSeasonLaunchAboveThreeTimesPreviousReverts() public {
        _startSeason();
        vm.warp(block.timestamp + 60 days);
        vm.prank(seasonAdmin);
        vm.expectRevert(abi.encodeWithSelector(MiningPool.BaseRewardTooHigh.selector, BASE_REWARD * 3 + 1, BASE_REWARD * 3));
        pool.startSeason(S1_EMISSION / 2, BASE_REWARD * 3 + 1);
        vm.prank(seasonAdmin);
        pool.startSeason(S1_EMISSION / 2, BASE_REWARD * 3); // exactly 3x is allowed
        assertEq(pool.getSeasonConfig(2).launchBaseReward, BASE_REWARD * 3);
    }

    /// @dev The limit follows the previous season's LAUNCH reward, not its glided closing rate:
    ///      a season that glided down to 875 may still launch the next at up to 3 x 1,250 (the
    ///      engine proposes min(2 x closing, 1,250) — well inside).
    function test_DD_nextSeasonLimitFollowsThePreviousLaunchNotItsGlidedRate() public {
        _startSeasonWith(BASE_REWARD * 100, BASE_REWARD);
        _sixBaseExpeditionsInThisEpoch();
        vm.warp(block.timestamp + 1 hours + 5 minutes);
        pool.repeg();
        assertEq(pool.currentBaseReward(), (BASE_REWARD * 7_000) / 10_000);
        vm.warp(block.timestamp + 60 days);
        vm.prank(seasonAdmin);
        pool.startSeason(BASE_REWARD * 100, BASE_REWARD * 3);
        assertEq(pool.currentSeason(), 2);
    }

    function test_DD_setBaseRewardAboveThreeTimesLaunchReverts() public {
        _startSeason();
        vm.prank(seasonAdmin);
        vm.expectRevert(abi.encodeWithSelector(MiningPool.BaseRewardTooHigh.selector, BASE_REWARD * 3 + 1, BASE_REWARD * 3));
        pool.setBaseReward(BASE_REWARD * 3 + 1);
        vm.prank(seasonAdmin);
        pool.setBaseReward(BASE_REWARD * 3);
        assertEq(pool.currentBaseReward(), BASE_REWARD * 3);
    }

    function test_DD_setBaseRewardAboveBudgetLeftReverts() public {
        _startSeasonWith(BASE_REWARD * 7, BASE_REWARD);
        _sixBaseExpeditionsInThisEpoch(); // one Base reward left
        vm.prank(seasonAdmin);
        vm.expectRevert(abi.encodeWithSelector(MiningPool.BaseRewardTooHigh.selector, BASE_REWARD + 1, BASE_REWARD));
        pool.setBaseReward(BASE_REWARD + 1);
        vm.prank(seasonAdmin);
        pool.setBaseReward(BASE_REWARD); // exactly what is left is allowed
        assertEq(pool.currentBaseReward(), BASE_REWARD);
    }

    // ── L4 / D-19 gaps (review 2026-10-03) ──

    function test_L4_epochBudgetViewIsZeroAfterTheSeasonEnds() public {
        _startSeason();
        vm.warp(block.timestamp + 60 days);
        (uint256 cap, uint256 minted, uint256 nextEpochAt) = pool.epochBudget();
        assertEq(cap, 0);
        assertEq(minted, 0);
        assertEq(nextEpochAt, 0);
    }

    /// @dev The hold is for LESS than one reward left; exactly one is still a demand signal.
    function test_D19_remainingEqualToOneRewardStillRepegs() public {
        _startSeasonWith(BASE_REWARD * 7, BASE_REWARD);
        _sixBaseExpeditionsInThisEpoch();
        assertEq(pool.getSeasonUnspent(1), BASE_REWARD);
        vm.warp(block.timestamp + 1 hours + 5 minutes);
        pool.repeg();
        assertEq(pool.currentBaseReward(), (BASE_REWARD * 7_000) / 10_000, "exactly one reward left still re-pegs");
    }

    /// @dev Boosted expeditions count against the ceiling at their BOOSTED amount. 365M: the
    ///      hour-0 ceiling is 506,944; ten +50% Apex expeditions (468,750) fit, an eleventh
    ///      (515,625) does not — where an unboosted one (500,000) still would.
    function test_D19_boostedRewardCountsAgainstTheCeilingAtItsBoostedAmount() public {
        uint256 emission = 365_000_000e18;
        _startSeasonWith(emission, BASE_REWARD);
        uint256 cap = (emission * 20_000) / (10_000 * 1_440);
        uint256[] memory teams = new uint256[](11);
        for (uint256 i = 0; i < 11; i++) teams[i] = _createTeam(alice, 3);
        _postAndActivateAll(teams, 5_000);
        uint256 boosted = _boosted(BASE_REWARD, 5_000) * 25;
        for (uint256 i = 0; i < 10; i++) {
            vm.prank(alice);
            pool.startExpedition(teams[i], 3);
        }
        (, uint256 minted,) = pool.epochBudget();
        assertEq(minted, 10 * boosted, "the boosted amounts are what count");
        assertGt(minted + boosted, cap, "an eleventh boosted one crosses");
        assertLe(minted + BASE_REWARD * 25, cap, "where an unboosted one would still fit");
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(MiningPool.EpochBudgetFull.selector, block.timestamp + 1 hours));
        pool.startExpedition(teams[10], 3);
    }

    /// @dev An override mid-epoch moves the ceiling's floor with the rate; the epoch's counter
    ///      stays. (An override above what is left now reverts: test_DD_setBaseRewardAboveBudgetLeftReverts.)
    function test_D19_overrideMovesTheCeilingFloorMidEpoch() public {
        _startSeasonWith(BASE_REWARD * 100, BASE_REWARD); // tiny: the floor IS the ceiling
        uint256[] memory pair = new uint256[](2);
        pair[0] = _createTeam(alice, 3);
        pair[1] = _createTeam(alice, 3);
        _postAndActivateAll(pair, 5_000);
        vm.prank(alice);
        pool.startExpedition(pair[0], 3); // 46,875: the whole floor at 1,250
        vm.prank(seasonAdmin);
        pool.setBaseReward(2_000e18); // within 3x launch and within what is left
        (uint256 cap, uint256 minted,) = pool.epochBudget();
        assertEq(cap, _boosted(2_000e18, 5_000) * 25, "the floor follows the rate: 75,000");
        assertEq(minted, _boosted(BASE_REWARD, 5_000) * 25, "the counter does not");
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(MiningPool.EpochBudgetFull.selector, block.timestamp + 1 hours));
        pool.startExpedition(pair[1], 3); // 46,875 + 75,000 > 75,000: next epoch
    }

    function test_repegIsPermissionless() public {
        _runSixThenCrossEpoch();
        address nobody = makeAddr("nobody");
        vm.prank(nobody);
        pool.repeg();
        assertEq(pool.currentBaseReward(), (BASE_REWARD * 7_000) / 10_000);
    }

    function test_glideHoldsAtLaunchCapUnderLightDemand() public {
        // Full S1 budget with one team's demand: target far above launch -> capped, no rise.
        _startSeason();
        uint256 teamId = _createTeam(alice, 0);
        vm.prank(alice);
        pool.startExpedition(teamId, 0);
        vm.warp(block.timestamp + 1 hours);
        pool.repeg();
        assertEq(pool.currentBaseReward(), BASE_REWARD);
    }

    function test_inFlightRewardLockedAcrossRepeg() public {
        uint256 teamId = _runSixThenCrossEpoch();
        // Start one more (at the clamped rate), then cross an epoch and re-peg before claiming.
        vm.prank(alice);
        uint256 expeditionId = pool.startExpedition(teamId, 0);
        uint256 mintedBefore = pool.getSeasonMinted(1);
        vm.warp(block.timestamp + 1 hours);
        pool.repeg();
        assertEq(pool.getSeasonMinted(1), mintedBefore); // repeg reserves nothing
        assertLt(pool.currentBaseReward(), (BASE_REWARD * 7_000) / 10_000, "the rate moved again");
        uint256 balBefore = gold.balanceOf(alice);
        vm.warp(block.timestamp + 4 hours);
        vm.prank(alice);
        pool.claimExpedition(expeditionId);
        // Reward was locked at start (the post-clamp rate), unaffected by the later re-peg.
        assertEq(gold.balanceOf(alice) - balBefore, (BASE_REWARD * 7_000) / 10_000);
    }

    function test_glideNeverExceedsLaunchAfterAdminOverride() public {
        _startSeason();
        vm.prank(seasonAdmin);
        pool.setBaseReward(BASE_REWARD * 2);
        assertEq(pool.currentBaseReward(), BASE_REWARD * 2);
        uint256 teamId = _createTeam(alice, 0);
        vm.prank(alice);
        pool.startExpedition(teamId, 0);
        vm.warp(block.timestamp + 1 hours);
        pool.repeg();
        // The launch cap is absolute: an above-launch override snaps back to launch at the
        // next re-peg (the cap applies after the damping clamp).
        assertEq(pool.currentBaseReward(), BASE_REWARD);
    }

    // ──────────── Battle-rank mining boost (S1) ────────────

    uint16 constant BOOST_BPS = 2_500; // +25%

    function _teamPower(uint256 teamId) internal view returns (uint8 power) {
        TeamManager.Team memory team = tm.getTeam(teamId);
        for (uint256 i = 0; i < 3; i++) {
            power += nft.getEvolutionTier(team.lobsterIds[i]);
        }
    }

    function _entry(uint256 teamId, uint16 bps, uint8 power) internal pure returns (MiningPool.BoostEntry[] memory e) {
        e = new MiningPool.BoostEntry[](1);
        e[0] = MiningPool.BoostEntry({teamId: teamId, bps: bps, power: power});
    }

    /// @dev Stage `bps` for the team at its current power in the next epoch, then activate it.
    function _postAndActivate(uint256 teamId, uint16 bps) internal returns (uint32 epoch) {
        // Resolve every view call BEFORE pranking: vm.prank is consumed by the next external
        // call, and _teamPower() makes several (TOK-G1 prank-consumption gotcha).
        uint8 power = _teamPower(teamId);
        MiningPool.BoostEntry[] memory entries = _entry(teamId, bps, power);
        epoch = pool.currentBoostEpoch() + 1;
        vm.prank(boostAdmin);
        pool.setTeamBoosts(epoch, entries);
        vm.prank(boostAdmin);
        pool.activateBoostEpoch(epoch);
    }

    /// @dev The same for several teams in one table (one staging + one activation).
    function _postAndActivateAll(uint256[] memory teamIds, uint16 bps) internal returns (uint32 epoch) {
        MiningPool.BoostEntry[] memory entries = new MiningPool.BoostEntry[](teamIds.length);
        for (uint256 i = 0; i < teamIds.length; i++) {
            entries[i] = MiningPool.BoostEntry({teamId: teamIds[i], bps: bps, power: _teamPower(teamIds[i])});
        }
        epoch = pool.currentBoostEpoch() + 1;
        vm.prank(boostAdmin);
        pool.setTeamBoosts(epoch, entries);
        vm.prank(boostAdmin);
        pool.activateBoostEpoch(epoch);
    }

    function _boosted(uint256 base, uint16 bps) internal pure returns (uint256) {
        return (base * (10_000 + bps)) / 10_000;
    }

    function test_boostedRewardIsBaseTimesBoostTimesWeight() public {
        _startSeason();
        uint256 teamId = _createTeam(alice, 1); // Evolved ×3 → power 3, tier weight 3
        _postAndActivate(teamId, BOOST_BPS);
        assertEq(pool.teamBoostBps(teamId, 3), BOOST_BPS);

        uint256 expected = _boosted(BASE_REWARD, BOOST_BPS) * 3;
        vm.expectEmit(true, true, true, true);
        emit MiningPool.ExpeditionStarted(1, teamId, alice, 1, expected, BOOST_BPS);
        vm.prank(alice);
        uint256 eid = pool.startExpedition(teamId, 1);

        assertEq(pool.getExpedition(eid).reward, expected, "reward = boosted base x weight");
        assertEq(pool.getSeasonMinted(1), expected, "budget accounts the boosted amount");
        assertEq(gold.balanceOf(address(pool)), expected, "escrow holds the boosted amount");

        vm.warp(block.timestamp + 4 hours);
        vm.prank(alice);
        pool.claimExpedition(eid);
        assertEq(gold.balanceOf(alice), expected, "claim pays the boosted reward");
    }

    function test_boostZeroBeforeAnyEpochActivated() public {
        _startSeason();
        uint256 teamId = _createTeam(alice, 1);
        // Staged but not activated: nothing pays yet.
        vm.prank(boostAdmin);
        pool.setTeamBoosts(1, _entry(teamId, BOOST_BPS, 3));
        assertEq(pool.currentBoostEpoch(), 0);
        assertEq(pool.teamBoostBps(teamId, 3), 0);
        vm.prank(alice);
        uint256 eid = pool.startExpedition(teamId, 1);
        assertEq(pool.getExpedition(eid).reward, BASE_REWARD * 3, "unboosted while nothing is live");
    }

    function test_boostLapsesWhenNotRepostedForNextEpoch() public {
        _startSeason();
        uint256 teamId = _createTeam(alice, 1);
        _postAndActivate(teamId, BOOST_BPS); // epoch 1
        assertEq(pool.teamBoostBps(teamId, 3), BOOST_BPS);
        // Epoch 2 activates with an empty table: the team's epoch-1 entry is stale → 0.
        vm.prank(boostAdmin);
        pool.activateBoostEpoch(2);
        assertEq(pool.teamBoostBps(teamId, 3), 0, "lapse: not re-posted -> no boost");
        vm.prank(alice);
        uint256 eid = pool.startExpedition(teamId, 1);
        assertEq(pool.getExpedition(eid).reward, BASE_REWARD * 3);
    }

    function test_boostExpiresAfterTtlWhenServerStopsPosting() public {
        _startSeason();
        uint256 teamId = _createTeam(alice, 1);
        _postAndActivate(teamId, BOOST_BPS);
        vm.warp(block.timestamp + pool.BOOST_EPOCH_TTL() - 1);
        assertEq(pool.teamBoostBps(teamId, 3), BOOST_BPS, "still fresh one second before the TTL");
        vm.warp(block.timestamp + 1);
        assertEq(pool.teamBoostBps(teamId, 3), 0, "stale epoch pays nothing");
        vm.prank(alice);
        uint256 eid = pool.startExpedition(teamId, 1);
        assertEq(pool.getExpedition(eid).reward, BASE_REWARD * 3);
    }

    function test_boostDropsWhenTeamPowerChanges() public {
        _startSeason();
        uint256 teamId = _createTeam(alice, 1); // power 3
        _postAndActivate(teamId, BOOST_BPS);
        // Evolve one lobster Evolved → Elite: power 3 → 4. The rank was earned at power 3.
        TeamManager.Team memory team = tm.getTeam(teamId);
        vm.prank(admin);
        nft.setEvolutionTier(team.lobsterIds[0], 2);
        assertEq(_teamPower(teamId), 4);
        assertEq(pool.teamBoostBps(teamId, 4), 0, "power mismatch -> no boost");
        assertEq(pool.teamBoostBps(teamId, 3), BOOST_BPS, "entry itself is intact");
        vm.prank(alice);
        uint256 eid = pool.startExpedition(teamId, 1);
        assertEq(pool.getExpedition(eid).reward, BASE_REWARD * 3, "expedition at the new power is unboosted");
    }

    function test_amendLiveEpochOverwritesEntry() public {
        _startSeason();
        uint256 teamId = _createTeam(alice, 1);
        uint32 epoch = _postAndActivate(teamId, 1_000);
        vm.prank(boostAdmin);
        pool.setTeamBoosts(epoch, _entry(teamId, 3_000, 3)); // dispute correction
        assertEq(pool.teamBoostBps(teamId, 3), 3_000);
        MiningPool.TeamBoost memory raw = pool.getTeamBoost(teamId);
        assertEq(raw.epoch, epoch);
        assertEq(raw.bps, 3_000);
        assertEq(raw.power, 3);
    }

    /// @dev D-09. This test used to assert the defect: it expected the live boost to read 0 the
    ///      moment next week's table was staged ("staging overwrote the team's live entry").
    function test_stagedNextEpochDoesNotAffectLiveUntilActivated() public {
        _startSeason();
        uint256 teamId = _createTeam(alice, 1);
        _postAndActivate(teamId, 1_000); // epoch 1 live
        vm.prank(boostAdmin);
        pool.setTeamBoosts(2, _entry(teamId, 5_000, 3)); // staged for epoch 2
        assertEq(pool.teamBoostBps(teamId, 3), 1_000, "D-09: the live epoch keeps paying while the next one is staged");
        assertEq(pool.getTeamBoost(teamId).bps, 1_000, "getTeamBoost reads the live epoch");
        assertEq(pool.getTeamBoostAt(2, teamId).bps, 5_000, "the staged row is readable before activation");
        vm.prank(boostAdmin);
        pool.activateBoostEpoch(2);
        assertEq(pool.teamBoostBps(teamId, 3), 5_000);
    }

    /// @dev D-09: the money version. An expedition started between staging and activation is
    ///      paid the live boost — before the fix it silently lost its whole boost for 4 hours.
    function test_D09_expeditionStartedWhileNextEpochIsStagedKeepsItsBoost() public {
        _startSeason();
        uint256 teamId = _createTeam(alice, 1);
        _postAndActivate(teamId, 5_000); // +50% live
        vm.prank(boostAdmin);
        pool.setTeamBoosts(2, _entry(teamId, 1_000, 3)); // next week's ladder staged, not active

        vm.prank(alice);
        uint256 expId = pool.startExpedition(teamId, 0);
        assertEq(pool.getExpedition(expId).reward, (BASE_REWARD * 15_000) / 10_000, "paid at the live +50%, not 0% and not the staged +10%");
    }

    /// @dev D-09: amending the live epoch (a dispute correction) must not disturb the staged one.
    function test_D09_amendingTheLiveEpochLeavesTheStagedRowAlone() public {
        _startSeason();
        uint256 teamId = _createTeam(alice, 1);
        _postAndActivate(teamId, 1_000);
        vm.startPrank(boostAdmin);
        pool.setTeamBoosts(2, _entry(teamId, 5_000, 3));
        pool.setTeamBoosts(1, _entry(teamId, 2_000, 3)); // amend live
        vm.stopPrank();
        assertEq(pool.teamBoostBps(teamId, 3), 2_000);
        assertEq(pool.getTeamBoostAt(2, teamId).bps, 5_000);
    }

    /// @dev The lapse rule still needs no clearing writes: not re-posted → 0 on activation.
    function test_D09_lapseStillWorksWithPerEpochRows() public {
        _startSeason();
        uint256 teamId = _createTeam(alice, 1);
        _postAndActivate(teamId, 3_000);
        vm.prank(boostAdmin);
        pool.activateBoostEpoch(2); // epoch 2 activated with no row for this team
        assertEq(pool.teamBoostBps(teamId, 3), 0);
        assertEq(pool.getTeamBoost(teamId).epoch, 0, "no entry in the live epoch");
    }

    function test_activateMustBeExactlyNextEpoch() public {
        vm.startPrank(boostAdmin);
        vm.expectRevert(abi.encodeWithSelector(MiningPool.InvalidBoostEpoch.selector, uint32(2), uint32(0)));
        pool.activateBoostEpoch(2);
        vm.expectRevert(abi.encodeWithSelector(MiningPool.InvalidBoostEpoch.selector, uint32(0), uint32(0)));
        pool.activateBoostEpoch(0);
        pool.activateBoostEpoch(1);
        assertEq(pool.currentBoostEpoch(), 1);
        assertEq(pool.boostEpochActivatedAt(), uint64(block.timestamp));
        vm.expectRevert(abi.encodeWithSelector(MiningPool.InvalidBoostEpoch.selector, uint32(1), uint32(1)));
        pool.activateBoostEpoch(1);
        vm.stopPrank();
    }

    function test_setTeamBoostsRejectsEpochZeroAndFarEpochs() public {
        uint256 teamId = 1;
        vm.startPrank(boostAdmin);
        vm.expectRevert(abi.encodeWithSelector(MiningPool.InvalidBoostEpoch.selector, uint32(0), uint32(0)));
        pool.setTeamBoosts(0, _entry(teamId, 1_000, 3));
        vm.expectRevert(abi.encodeWithSelector(MiningPool.InvalidBoostEpoch.selector, uint32(2), uint32(0)));
        pool.setTeamBoosts(2, _entry(teamId, 1_000, 3));
        pool.setTeamBoosts(1, _entry(teamId, 1_000, 3)); // next epoch: ok
        vm.stopPrank();
    }

    function test_boostAboveCapReverts() public {
        vm.prank(boostAdmin);
        vm.expectRevert(abi.encodeWithSelector(MiningPool.BoostTooHigh.selector, uint256(7), uint16(5_001)));
        pool.setTeamBoosts(1, _entry(7, 5_001, 3));
        // The cap itself is accepted.
        vm.prank(boostAdmin);
        pool.setTeamBoosts(1, _entry(7, 5_000, 3));
    }

    function test_boostBatchTooLargeReverts() public {
        uint256 n = pool.MAX_BOOST_BATCH() + 1;
        MiningPool.BoostEntry[] memory entries = new MiningPool.BoostEntry[](n);
        for (uint256 i = 0; i < n; i++) {
            entries[i] = MiningPool.BoostEntry({teamId: i + 1, bps: 1_000, power: 3});
        }
        vm.prank(boostAdmin);
        vm.expectRevert(abi.encodeWithSelector(MiningPool.BatchTooLarge.selector, n, n - 1));
        pool.setTeamBoosts(1, entries);
    }

    function test_boostSetterAndActivateRequireRole() public {
        vm.prank(alice);
        vm.expectRevert();
        pool.setTeamBoosts(1, _entry(1, 1_000, 3));
        vm.prank(seasonAdmin); // SEASON_ADMIN is deliberately NOT enough
        vm.expectRevert();
        pool.activateBoostEpoch(1);
    }

    function test_boostEventsEmitted() public {
        vm.expectEmit(true, true, true, true);
        emit MiningPool.TeamBoostSet(1, 42, 1_234, 5);
        vm.prank(boostAdmin);
        pool.setTeamBoosts(1, _entry(42, 1_234, 5));
        vm.expectEmit(true, true, true, true);
        emit MiningPool.BoostEpochActivated(1, block.timestamp);
        vm.prank(boostAdmin);
        pool.activateBoostEpoch(1);
    }

    /// @dev Six +50% expeditions in one epoch must register as 9 tier-weight units of trailing
    ///      demand (6 × 1.5), not 6 — the boost is paid from the same budget, so the glide has
    ///      to see it in its denominator as well as in the remaining-budget numerator.
    function test_boostedExpeditionsCountAsScaledGlideDemand() public {
        _startSeasonWith(BASE_REWARD * 100, BASE_REWARD);
        uint256[] memory six = new uint256[](6);
        for (uint256 i = 0; i < 6; i++) six[i] = _createTeam(alice, 0);
        _postAndActivateAll(six, 5_000);
        for (uint256 i = 0; i < 6; i++) {
            vm.prank(alice);
            uint256 eid = pool.startExpedition(six[i], 0);
            assertEq(pool.getExpedition(eid).reward, _boosted(BASE_REWARD, 5_000));
        }
        vm.warp(block.timestamp + 1 hours);
        pool.repeg(); // crosses into epoch 1
        assertEq(pool.getSeasonConfig(1).trailingWeightServed, 9, "6 x (1 + 0.5) = 9 units");
        assertEq(pool.getSeasonMinted(1), 6 * _boosted(BASE_REWARD, 5_000));
    }

    function test_unboostedControlCountsPlainGlideDemand() public {
        _runSixThenCrossEpoch(); // six units in epoch 0, now in epoch 4
        pool.repeg();
        // D-C: six units over the four closed epochs of the window, floored (the boosted test
        // above crosses one hour later, where the window is that one epoch: 9 units).
        assertEq(pool.getSeasonConfig(1).trailingWeightServed, 1);
    }

    /// @dev Budget and lifetime caps bind on the BOOSTED amount: a reward that fits unboosted
    ///      can be refused once the boost is applied.
    function test_boostedRewardStillBoundedBySeasonBudget() public {
        _startSeasonWith(BASE_REWARD * 3, BASE_REWARD); // exactly one unboosted Evolved expedition
        uint256 teamId = _createTeam(alice, 1);
        _postAndActivate(teamId, 1_000);
        vm.prank(alice);
        vm.expectRevert(MiningPool.SeasonBudgetExhausted.selector);
        pool.startExpedition(teamId, 1);
    }

    function test_boostedRewardStillBoundedByLifetimeAllocation() public {
        // 600M unboosted fits under the 705M lifetime cap; ×1.5 = 900M does not.
        _startSeasonWith(2_000_000_000e18, 600_000_000e18);
        uint256 teamId = _createTeam(alice, 0);
        _postAndActivate(teamId, 5_000);
        // D-20: the season budget is clamped to the 705M allocation, so that check fires first.
        vm.prank(alice);
        vm.expectRevert(MiningPool.SeasonBudgetExhausted.selector);
        pool.startExpedition(teamId, 0);
        assertEq(pool.lifetimeMinted(), 0);
    }

    function test_boostedRewardRemainsTierWeightMultiple() public {
        _startSeason();
        uint256 teamId = _createTeam(alice, 3); // Apex ×3 → weight 25
        _postAndActivate(teamId, 3_333);
        vm.prank(alice);
        uint256 eid = pool.startExpedition(teamId, 3);
        uint256 reward = pool.getExpedition(eid).reward;
        assertEq(reward % 25, 0, "boost applied to base before the tier multiply");
        assertEq(reward, _boosted(BASE_REWARD, 3_333) * 25);
    }

    // ── D-E (owner decision 2026-10-03): the stake reference the arena pegs its brackets to ──

    function test_DE_firstSeasonSeedsTheStakeReference() public {
        assertEq(pool.stakeReference(), 0, "nothing before the first season");
        assertEq(pool.EPOCHS_PER_DAY(), 24);
        vm.prank(seasonAdmin);
        vm.expectEmit(true, false, false, true);
        emit MiningPool.StakeReferenceUpdated(1, 0, 0, BASE_REWARD);
        pool.startSeason(S1_EMISSION, BASE_REWARD);
        assertEq(pool.stakeReference(), BASE_REWARD);
    }

    function test_DE_referenceResamplesOnlyAtTheDayBoundary() public {
        _startSeason();
        vm.prank(seasonAdmin);
        pool.setBaseReward(1_000e18); // the rate moves at hour 0
        vm.warp(block.timestamp + 1 hours);
        pool.repeg();
        assertEq(pool.stakeReference(), BASE_REWARD, "hour 1: same day");
        vm.warp(block.timestamp + 22 hours);
        pool.repeg();
        assertEq(pool.stakeReference(), BASE_REWARD, "hour 23: same day");
        vm.warp(block.timestamp + 1 hours);
        vm.expectEmit(true, false, false, true);
        emit MiningPool.StakeReferenceUpdated(1, 24, BASE_REWARD, 1_000e18);
        pool.repeg();
        assertEq(pool.stakeReference(), 1_000e18, "hour 24: the day's first touch samples");
        vm.prank(seasonAdmin);
        pool.setBaseReward(900e18);
        vm.warp(block.timestamp + 23 hours);
        pool.repeg();
        assertEq(pool.stakeReference(), 1_000e18, "hour 47: still day 2's sample");
        vm.warp(block.timestamp + 1 hours);
        pool.repeg();
        assertEq(pool.stakeReference(), 900e18, "hour 48: day 3's sample");
    }

    function test_DE_noEventWhenTheRateIsUnchangedAtTheBoundary() public {
        _startSeason();
        vm.warp(block.timestamp + 24 hours);
        vm.recordLogs();
        pool.repeg();
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i = 0; i < logs.length; i++) {
            assertTrue(logs[i].topics[0] != MiningPool.StakeReferenceUpdated.selector, "no update when equal");
        }
        assertEq(pool.stakeReference(), BASE_REWARD);
    }

    /// @dev The sample is taken AFTER the glide step of the boundary epoch: the day's stakes follow
    ///      the rate the day's first expedition pays.
    function test_DE_sampleTakesTheRateAfterTheBoundaryStep() public {
        _startSeasonWith(BASE_REWARD * 100, BASE_REWARD); // tight budget: demand pushes the rate down
        vm.warp(block.timestamp + 23 hours);
        pool.repeg(); // touch epoch 23 so its demand is inside the window at the boundary
        _sixBaseExpeditionsInThisEpoch();
        vm.warp(block.timestamp + 1 hours);
        vm.expectEmit(true, false, false, true);
        emit MiningPool.StakeReferenceUpdated(1, 24, BASE_REWARD, (BASE_REWARD * 7_000) / 10_000);
        pool.repeg();
        assertEq(pool.currentBaseReward(), (BASE_REWARD * 7_000) / 10_000, "stepped down by the clamp");
        assertEq(pool.stakeReference(), (BASE_REWARD * 7_000) / 10_000, "sampled after the step");
    }

    function test_DE_longGapSamplesOnceAtTheFirstTouch() public {
        _startSeason();
        vm.prank(seasonAdmin);
        pool.setBaseReward(1_000e18);
        vm.warp(block.timestamp + 5 days + 30 minutes);
        vm.expectEmit(true, false, false, true);
        emit MiningPool.StakeReferenceUpdated(1, 120, BASE_REWARD, 1_000e18);
        pool.repeg();
        assertEq(pool.stakeReference(), 1_000e18);
    }

    /// @dev Continuity across seasons: a new season's launch reward must not jump the stakes on
    ///      day one; the previous day's sample carries until the new season's first day boundary.
    function test_DE_referenceIsContinuousAcrossSeasons() public {
        _startSeason();
        vm.prank(seasonAdmin);
        pool.setBaseReward(1_000e18);
        vm.warp(block.timestamp + 24 hours);
        pool.repeg();
        assertEq(pool.stakeReference(), 1_000e18);

        vm.warp(block.timestamp + 60 days);
        vm.recordLogs();
        vm.prank(seasonAdmin);
        pool.startSeason(S1_EMISSION / 2, BASE_REWARD);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i = 0; i < logs.length; i++) {
            assertTrue(logs[i].topics[0] != MiningPool.StakeReferenceUpdated.selector, "no re-seed");
        }
        assertEq(pool.stakeReference(), 1_000e18, "yesterday's sample carries into S2");
        assertEq(pool.currentBaseReward(), BASE_REWARD, "S2 launched at 1,250");

        // S2's first day boundary samples S2's rate.
        vm.warp(block.timestamp + 24 hours);
        vm.expectEmit(true, false, false, true);
        emit MiningPool.StakeReferenceUpdated(2, 24, 1_000e18, BASE_REWARD);
        pool.repeg();
        assertEq(pool.stakeReference(), BASE_REWARD);
    }
}
