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

    function testFuzz_boostedReward_bounded(uint16 bps, uint8 tier) public {
        bps = uint16(bound(bps, 0, 5_000));
        tier = uint8(bound(tier, 1, 3)); // battle-eligible tiers only
        uint256[4] memory weights = [uint256(1), 3, 10, 25];

        uint256[3] memory ids = _mint3(alice);
        for (uint256 i = 0; i < 3; i++) {
            vm.prank(admin);
            nft.setEvolutionTier(ids[i], tier);
        }
        vm.prank(alice);
        uint256 teamId = teamMgr.createTeam(ids);

        MiningPool.BoostEntry[] memory entries = new MiningPool.BoostEntry[](1);
        entries[0] = MiningPool.BoostEntry({teamId: teamId, bps: bps, power: uint8(3 * tier)});
        vm.prank(admin);
        miningPool.setTeamBoosts(1, entries);
        vm.prank(admin);
        miningPool.activateBoostEpoch(1);

        vm.prank(alice);
        uint256 expId = miningPool.startExpedition(teamId, tier);
        uint256 reward = miningPool.getExpedition(expId).reward;

        uint256 unboosted = BASE_REWARD * weights[tier];
        assertGe(reward, unboosted, "boost never lowers the reward");
        assertLe(reward, (unboosted * 15_000) / 10_000, "boost never exceeds +50%");
        assertEq(reward % weights[tier], 0, "reward stays a tier-weight multiple");
        assertEq(reward, ((BASE_REWARD * (10_000 + bps)) / 10_000) * weights[tier], "exact boosted formula");
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

    // ─────────────────────────────────────────────────────────────
    // Phase 1 MiningPool pass — adversarial fuzz + F-06 coverage
    // ─────────────────────────────────────────────────────────────

    // F-06: adminReleaseExpedition happy path — burns reward after grace,
    // unlocks the team, prevents permanent lock from key loss.
    function test_adminRelease_happyPath() public {
        uint256[3] memory ids = _mint3(alice);
        vm.prank(alice);
        uint256 teamId = teamMgr.createTeam(ids);

        vm.prank(alice);
        uint256 expId = miningPool.startExpedition(teamId, 0);

        uint256 supplyBefore = claw.totalSupply();
        uint256 escrowBefore = claw.balanceOf(address(miningPool));

        // Warp past expedition + grace period
        vm.warp(block.timestamp + 4 hours + 7 days + 1);
        vm.prank(admin);
        miningPool.adminReleaseExpedition(expId);

        // Reward burned (not sent to admin, not sent to user)
        assertEq(claw.totalSupply(), supplyBefore - BASE_REWARD, "reward burned from supply");
        assertEq(claw.balanceOf(address(miningPool)), escrowBefore - BASE_REWARD, "escrow drained");

        // Expedition marked claimed, team unlocked
        MiningPool.Expedition memory exp = miningPool.getExpedition(expId);
        assertTrue(exp.claimed, "expedition marked claimed");
        assertEq(miningPool.getActiveExpedition(teamId), 0, "team-expedition link cleared");
        assertFalse(teamMgr.isTeamActive(teamId), "team unlocked");
    }

    // F-06: admin release before grace reverts with AdminReleaseTooEarly.
    function testFuzz_adminRelease_beforeGrace_reverts(uint256 earlyWarp) public {
        uint256[3] memory ids = _mint3(alice);
        vm.prank(alice);
        uint256 teamId = teamMgr.createTeam(ids);

        vm.prank(alice);
        uint256 expId = miningPool.startExpedition(teamId, 0);

        uint256 totalDelay = 4 hours + 7 days;
        // Any warp strictly less than expedition duration + grace must revert.
        // At exactly totalDelay, block.timestamp == availableAt and release succeeds.
        earlyWarp = bound(earlyWarp, 0, totalDelay - 1);
        vm.warp(block.timestamp + earlyWarp);

        vm.prank(admin);
        vm.expectRevert();
        miningPool.adminReleaseExpedition(expId);
    }

    // F-06: user can claim normally inside the grace window, and a
    // subsequent admin release must revert with ExpeditionAlreadyClaimed.
    function test_adminRelease_afterUserClaim_reverts() public {
        uint256[3] memory ids = _mint3(alice);
        vm.prank(alice);
        uint256 teamId = teamMgr.createTeam(ids);

        vm.prank(alice);
        uint256 expId = miningPool.startExpedition(teamId, 0);

        // User claims right at completion (well within grace)
        vm.warp(block.timestamp + 4 hours + 1);
        vm.prank(alice);
        miningPool.claimExpedition(expId);

        // Now warp past grace — admin release must revert
        vm.warp(block.timestamp + 7 days + 1);
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(MiningPool.ExpeditionAlreadyClaimed.selector, expId));
        miningPool.adminReleaseExpedition(expId);
    }

    // F-06 inverse: after admin release, user claim must revert with
    // ExpeditionAlreadyClaimed (reward was burned, can't double-spend).
    function test_claim_afterAdminRelease_reverts() public {
        uint256[3] memory ids = _mint3(alice);
        vm.prank(alice);
        uint256 teamId = teamMgr.createTeam(ids);

        vm.prank(alice);
        uint256 expId = miningPool.startExpedition(teamId, 0);

        // Admin releases after grace
        vm.warp(block.timestamp + 4 hours + 7 days + 1);
        vm.prank(admin);
        miningPool.adminReleaseExpedition(expId);

        // User can no longer claim
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(MiningPool.ExpeditionAlreadyClaimed.selector, expId));
        miningPool.claimExpedition(expId);
    }

    // Admin release requires DEFAULT_ADMIN_ROLE — not SEASON_ADMIN, not resolver.
    function test_adminRelease_onlyDefaultAdmin() public {
        uint256[3] memory ids = _mint3(alice);
        vm.prank(alice);
        uint256 teamId = teamMgr.createTeam(ids);
        vm.prank(alice);
        uint256 expId = miningPool.startExpedition(teamId, 0);

        vm.warp(block.timestamp + 4 hours + 7 days + 1);

        // Alice is not admin — must revert
        vm.prank(alice);
        vm.expectRevert();
        miningPool.adminReleaseExpedition(expId);

        // But admin succeeds
        vm.prank(admin);
        miningPool.adminReleaseExpedition(expId);
    }

    // Season rollover: an unclaimed expedition from season N is still
    // claimable in season N+1. Season accounting is per-season; escrow
    // is a cumulative pool.
    function test_season_rollover_preservesUnclaimedExpeditions() public {
        uint256[3] memory ids = _mint3(alice);
        vm.prank(alice);
        uint256 teamId = teamMgr.createTeam(ids);

        // Start expedition in season 1
        vm.prank(alice);
        uint256 expId = miningPool.startExpedition(teamId, 0);

        // Warp past season end WITHOUT claiming; expedition has long since completed
        vm.warp(block.timestamp + 60 days + 1);

        // Start season 2
        vm.prank(admin);
        miningPool.startSeason(EMISSION, BASE_REWARD);
        assertEq(miningPool.currentSeason(), 2);

        // Unclaimed season-1 expedition should still be claimable
        uint256 balBefore = claw.balanceOf(alice);
        vm.prank(alice);
        miningPool.claimExpedition(expId);
        assertEq(claw.balanceOf(alice) - balBefore, BASE_REWARD, "rolled-over expedition still claims full reward");
    }

    // Each season's totalMinted starts at 0 — no leakage from prior season.
    function test_season_budgetIsolation() public {
        uint256[3] memory ids1 = _mint3(alice);
        vm.prank(alice);
        uint256 team1 = teamMgr.createTeam(ids1);
        vm.prank(alice);
        miningPool.startExpedition(team1, 0);

        MiningPool.SeasonConfig memory s1 = miningPool.getSeasonConfig(1);
        assertEq(s1.totalMinted, BASE_REWARD, "s1 minted 1 reward");

        // Roll to season 2
        vm.warp(block.timestamp + 60 days + 1);
        vm.prank(admin);
        miningPool.startSeason(EMISSION, BASE_REWARD);

        MiningPool.SeasonConfig memory s2 = miningPool.getSeasonConfig(2);
        assertEq(s2.totalMinted, 0, "s2 minted starts at 0");

        // s1 is unchanged
        s1 = miningPool.getSeasonConfig(1);
        assertEq(s1.totalMinted, BASE_REWARD, "s1 accounting unchanged by rollover");
    }

    // startSeason before the current one ends reverts with SeasonStillActive.
    // At exactly startTime + SEASON_DURATION, the prior season has ended and
    // startSeason succeeds; strictly less is the revert regime.
    function testFuzz_startSeason_beforePriorEnds_reverts(uint256 earlyWarp) public {
        earlyWarp = bound(earlyWarp, 0, 60 days - 1);
        vm.warp(block.timestamp + earlyWarp);

        vm.prank(admin);
        vm.expectRevert(MiningPool.SeasonStillActive.selector);
        miningPool.startSeason(EMISSION, BASE_REWARD);
    }

    // M-01: if ACTIVITY_ROLE force-unlocks a team and the owner disbands
    // it mid-expedition, the claim path must still terminate — the reward
    // must flow to the claimer and the expedition must mark claimed, even
    // though the team record is gone from TeamManager.
    //
    // Pre-fix: teamManager.setTeamActive on a deleted team reverted
    // TeamDoesNotExist, rolling back the whole claim and leaving the
    // expedition + escrow permanently stuck.
    // Post-fix: MiningPool guards the setTeamActive call with teamExists().
    function test_M01_claim_toleratesDeletedTeam() public {
        // Grant alice ACTIVITY_ROLE so she can impersonate the compromised role.
        bytes32 ACTIVITY_ROLE = teamMgr.ACTIVITY_ROLE();
        vm.prank(admin);
        teamMgr.grantRole(ACTIVITY_ROLE, alice);

        uint256[3] memory ids = _mint3(alice);
        vm.prank(alice);
        uint256 teamId = teamMgr.createTeam(ids);

        vm.prank(alice);
        uint256 expId = miningPool.startExpedition(teamId, 0);

        // Compromised-role attack: force-unlock the team, then disband it.
        vm.prank(alice);
        teamMgr.setTeamActive(teamId, false);
        vm.prank(alice);
        teamMgr.disbandTeam(teamId);
        assertFalse(teamMgr.teamExists(teamId), "setup: team record gone");

        // Normal claim path must still terminate after expedition completes.
        vm.warp(block.timestamp + 4 hours + 1);
        uint256 balBefore = claw.balanceOf(alice);
        vm.prank(alice);
        miningPool.claimExpedition(expId);

        assertEq(claw.balanceOf(alice) - balBefore, BASE_REWARD, "reward delivered despite deleted team");
        MiningPool.Expedition memory exp = miningPool.getExpedition(expId);
        assertTrue(exp.claimed, "expedition marked claimed");
        assertEq(miningPool.getActiveExpedition(teamId), 0, "team-expedition link cleared");
    }

    // M-01: admin release path must also tolerate a deleted team, otherwise
    // the key-loss emergency path gets bricked by a compromised ACTIVITY_ROLE.
    function test_M01_adminRelease_toleratesDeletedTeam() public {
        bytes32 ACTIVITY_ROLE = teamMgr.ACTIVITY_ROLE();
        vm.prank(admin);
        teamMgr.grantRole(ACTIVITY_ROLE, alice);

        uint256[3] memory ids = _mint3(alice);
        vm.prank(alice);
        uint256 teamId = teamMgr.createTeam(ids);

        vm.prank(alice);
        uint256 expId = miningPool.startExpedition(teamId, 0);

        vm.prank(alice);
        teamMgr.setTeamActive(teamId, false);
        vm.prank(alice);
        teamMgr.disbandTeam(teamId);

        vm.warp(block.timestamp + 4 hours + 7 days + 1);
        uint256 supplyBefore = claw.totalSupply();

        vm.prank(admin);
        miningPool.adminReleaseExpedition(expId);

        // Reward burned, expedition terminal.
        assertEq(claw.totalSupply(), supplyBefore - BASE_REWARD, "reward burned despite deleted team");
        MiningPool.Expedition memory exp = miningPool.getExpedition(expId);
        assertTrue(exp.claimed, "expedition terminated");
        assertEq(miningPool.getActiveExpedition(teamId), 0, "team-expedition link cleared");
    }

    // setBaseReward doesn't affect in-flight expeditions even when
    // fuzz-sweeping a wide range of new reward values.
    function testFuzz_setBaseReward_doesNotAffectInflight(uint256 newReward) public {
        newReward = bound(newReward, 1, 100_000e18);

        uint256[3] memory ids = _mint3(alice);
        vm.prank(alice);
        uint256 teamId = teamMgr.createTeam(ids);
        vm.prank(alice);
        uint256 expId = miningPool.startExpedition(teamId, 0);
        uint256 originalReward = miningPool.getExpedition(expId).reward;

        vm.prank(admin);
        miningPool.setBaseReward(newReward);

        assertEq(miningPool.getExpedition(expId).reward, originalReward, "in-flight reward locked");

        vm.warp(block.timestamp + 4 hours + 1);
        uint256 balBefore = claw.balanceOf(alice);
        vm.prank(alice);
        miningPool.claimExpedition(expId);
        assertEq(claw.balanceOf(alice) - balBefore, originalReward, "claim pays locked reward");
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
