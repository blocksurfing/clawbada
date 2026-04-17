// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import "../helpers/BaseSetup.t.sol";

/// @dev Fuzz tests for MiningPool: reward calculation, season budget cap, expedition lifecycle.
contract FuzzMiningPool is BaseSetup {
    address internal alice = makeAddr("alice");

    uint256 internal constant EMISSION = 387_500_000e18;
    uint256 internal constant BASE_REWARD = 1_250e18;

    function setUp() public override {
        super.setUp();
        // Start season 1
        vm.prank(admin);
        miningPool.startSeason(EMISSION, BASE_REWARD);
    }

    function _createEvolvedTeam(address owner) internal returns (uint256 teamId) {
        uint256[3] memory ids = _mint3(owner);
        for (uint256 i = 0; i < 3; i++) {
            vm.prank(admin);
            nft.setEvolutionTier(ids[i], 1); // Evolved
        }
        vm.prank(owner);
        teamId = teamMgr.createTeam(ids);
    }

    // ── Reward calculation ────────────────────────────────────────

    function testFuzz_reward_equals_base_times_weight(uint8 tier) public {
        tier = uint8(bound(tier, 0, 3));
        uint256[4] memory weights = [uint256(1), 3, 10, 25];
        uint256 expectedReward = BASE_REWARD * weights[tier];

        // Create a team matching the tier
        uint256[3] memory ids = _mint3(alice);
        for (uint256 i = 0; i < 3; i++) {
            vm.prank(admin);
            nft.setEvolutionTier(ids[i], tier);
        }
        vm.prank(alice);
        uint256 teamId = teamMgr.createTeam(ids);

        vm.prank(alice);
        uint256 expId = miningPool.startExpedition(teamId, tier);

        MiningPool.Expedition memory exp = miningPool.getExpedition(expId);
        assertEq(exp.reward, expectedReward, "reward = baseReward * tierWeight");
    }

    // ── Season budget cap ─────────────────────────────────────────

    function test_season_budget_cap_enforced() public {
        // Start a fresh season with tiny budget (exactly 1 base reward)
        vm.prank(admin);
        // new season must wait for SEASON_DURATION
        // We'll just verify with the current season that totalMinted <= totalEmission

        MiningPool.SeasonConfig memory cfg = miningPool.getSeasonConfig(1);
        assertLe(cfg.totalMinted, cfg.totalEmission);

        // Fill the budget with one expedition worth
        // Use a Base mine (weight 1)
        uint256[3] memory ids = _mint3(alice);
        vm.prank(alice);
        uint256 teamId = teamMgr.createTeam(ids);

        vm.prank(alice);
        miningPool.startExpedition(teamId, 0);

        cfg = miningPool.getSeasonConfig(1);
        assertLe(cfg.totalMinted, cfg.totalEmission, "totalMinted never exceeds totalEmission");
    }

    function test_exceeds_budget_reverts() public {
        // Start a tiny season with budget = BASE_REWARD (exactly 1 expedition)
        // We need to wait for current season to end first
        vm.warp(block.timestamp + 60 days + 1);

        vm.prank(admin);
        miningPool.startSeason(BASE_REWARD, BASE_REWARD); // budget = exactly 1 expedition

        uint256[3] memory ids1 = _mint3(alice);
        vm.prank(alice);
        uint256 team1 = teamMgr.createTeam(ids1);
        vm.prank(alice);
        miningPool.startExpedition(team1, 0); // uses up entire budget

        // Second team tries to start
        uint256[3] memory ids2 = _mint3(alice);
        vm.prank(alice);
        uint256 team2 = teamMgr.createTeam(ids2);

        vm.prank(alice);
        vm.expectRevert(MiningPool.SeasonBudgetExhausted.selector);
        miningPool.startExpedition(team2, 0);
    }

    // ── Tier gate enforcement ─────────────────────────────────────

    function testFuzz_tier_gate(uint8 lobsterTier, uint8 mineTier) public {
        lobsterTier = uint8(bound(lobsterTier, 0, 3));
        mineTier    = uint8(bound(mineTier, 0, 3));
        vm.assume(lobsterTier < mineTier); // lobster doesn't meet requirement

        uint256[3] memory ids = _mint3(alice);
        for (uint256 i = 0; i < 3; i++) {
            vm.prank(admin);
            nft.setEvolutionTier(ids[i], lobsterTier);
        }
        vm.prank(alice);
        uint256 teamId = teamMgr.createTeam(ids);

        vm.prank(alice);
        vm.expectRevert(); // TierRequirementNotMet
        miningPool.startExpedition(teamId, mineTier);
    }

    // ── Claim before complete reverts ─────────────────────────────

    function test_claim_before_complete_reverts() public {
        uint256[3] memory ids = _mint3(alice);
        vm.prank(alice);
        uint256 teamId = teamMgr.createTeam(ids);

        vm.prank(alice);
        uint256 expId = miningPool.startExpedition(teamId, 0);

        // Claiming immediately should fail
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(MiningPool.ExpeditionNotComplete.selector, expId));
        miningPool.claimExpedition(expId);
    }

    // ── Double claim reverts ──────────────────────────────────────

    function test_double_claim_reverts() public {
        uint256[3] memory ids = _mint3(alice);
        vm.prank(alice);
        uint256 teamId = teamMgr.createTeam(ids);

        vm.prank(alice);
        uint256 expId = miningPool.startExpedition(teamId, 0);

        vm.warp(block.timestamp + 4 hours + 1);

        vm.prank(alice);
        miningPool.claimExpedition(expId);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(MiningPool.ExpeditionAlreadyClaimed.selector, expId));
        miningPool.claimExpedition(expId);
    }

    // ── Claim mints correct reward ────────────────────────────────

    function test_claim_mints_reward() public {
        uint256[3] memory ids = _mint3(alice);
        vm.prank(alice);
        uint256 teamId = teamMgr.createTeam(ids);

        vm.prank(alice);
        uint256 expId = miningPool.startExpedition(teamId, 0);

        uint256 balBefore = claw.balanceOf(alice);

        vm.warp(block.timestamp + 4 hours + 1);
        vm.prank(alice);
        miningPool.claimExpedition(expId);

        assertEq(claw.balanceOf(alice) - balBefore, BASE_REWARD, "should receive base reward");
    }

    // ── Team already mining reverts ───────────────────────────────

    function test_team_already_mining_reverts() public {
        uint256[3] memory ids = _mint3(alice);
        vm.prank(alice);
        uint256 teamId = teamMgr.createTeam(ids);

        vm.prank(alice);
        miningPool.startExpedition(teamId, 0);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(MiningPool.TeamIsActive.selector, teamId));
        miningPool.startExpedition(teamId, 0);
    }

    // ── No active season reverts ──────────────────────────────────

    function test_no_season_reverts() public {
        // Warp past season end
        vm.warp(block.timestamp + 60 days + 1);

        uint256[3] memory ids = _mint3(alice);
        vm.prank(alice);
        uint256 teamId = teamMgr.createTeam(ids);

        vm.prank(alice);
        vm.expectRevert(MiningPool.SeasonNotActive.selector);
        miningPool.startExpedition(teamId, 0);
    }

    // ── setBaseReward changes future expeditions only ─────────────

    function test_set_base_reward_only_affects_new() public {
        uint256[3] memory ids1 = _mint3(alice);
        vm.prank(alice);
        uint256 team1 = teamMgr.createTeam(ids1);

        vm.prank(alice);
        uint256 expId1 = miningPool.startExpedition(team1, 0);

        MiningPool.Expedition memory exp1 = miningPool.getExpedition(expId1);
        uint256 oldReward = exp1.reward;

        // Change base reward
        uint256 newBaseReward = 2_500e18;
        vm.prank(admin);
        miningPool.setBaseReward(newBaseReward);

        // Old expedition keeps its reward
        assertEq(miningPool.getExpedition(expId1).reward, oldReward, "old expedition unchanged");

        // New expedition uses new base reward
        vm.warp(block.timestamp + 4 hours + 1);
        vm.prank(alice);
        miningPool.claimExpedition(expId1);

        uint256[3] memory ids2 = _mint3(alice);
        vm.prank(alice);
        uint256 team2 = teamMgr.createTeam(ids2);
        vm.prank(alice);
        uint256 expId2 = miningPool.startExpedition(team2, 0);

        assertEq(miningPool.getExpedition(expId2).reward, newBaseReward, "new reward applied");
    }
}
