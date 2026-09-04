// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {MiningPoolHandler} from "./handlers/MiningPoolHandler.sol";
import {MiningPool} from "../../MiningPool.sol";
import {ClawToken} from "../../ClawToken.sol";
import {TeamManager} from "../../TeamManager.sol";

/// @dev Stateful invariant harness for MiningPool. The handler drives the
///      start/claim/adminRelease cycles across multiple seasons; this contract
///      only reads state and asserts the cross-cutting properties.
contract InvariantMiningPool is Test {
    MiningPoolHandler internal handler;

    function setUp() public {
        handler = new MiningPoolHandler();
        targetContract(address(handler));

        // Restrict the fuzzer to handler_* entrypoints so it can't re-invoke
        // the inherited BaseSetup.setUp() mid-run and orphan ghost state.
        bytes4[] memory selectors = new bytes4[](8);
        selectors[0] = MiningPoolHandler.handler_startExpedition.selector;
        selectors[1] = MiningPoolHandler.handler_claimExpedition.selector;
        selectors[2] = MiningPoolHandler.handler_adminReleaseExpedition.selector;
        selectors[3] = MiningPoolHandler.handler_setBaseReward.selector;
        selectors[4] = MiningPoolHandler.handler_startNewSeason.selector;
        selectors[5] = MiningPoolHandler.handler_warp.selector;
        selectors[6] = MiningPoolHandler.handler_setTeamBoosts.selector;
        selectors[7] = MiningPoolHandler.handler_activateBoostEpoch.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
    }

    // ─── I-1: season budget cap holds ──────────────────────────────
    //
    // For every season ever started, totalMinted must never exceed
    // totalEmission. The SeasonBudgetExhausted revert in startExpedition
    // enforces this at write time; invariant confirms it holds after
    // arbitrary sequences.
    function invariant_seasonBudgetCap() public view {
        MiningPool pool = handler.getMiningPool();
        uint256 maxSeason = pool.currentSeason();
        for (uint256 s = 1; s <= maxSeason; s++) {
            MiningPool.SeasonConfig memory cfg = pool.getSeasonConfig(s);
            assertLe(cfg.totalMinted, cfg.totalEmission, "season budget cap violated");
        }
    }

    // ─── I-2: escrow balance matches unclaimed reward sum ──────────
    //
    // CLAW held by MiningPool == sum(expedition.reward) over every
    // unclaimed expedition ever started. Catches: lost escrow (balance
    // drained outside the claim/adminRelease paths), double-mint, or
    // accidental burn-before-set in adminReleaseExpedition.
    function invariant_escrowMatchesUnclaimedRewards() public view {
        MiningPool pool = handler.getMiningPool();
        ClawToken claw = handler.getClaw();
        uint256 n = handler.expeditionIdsLength();

        uint256 expectedEscrow = 0;
        for (uint256 i = 0; i < n; i++) {
            uint256 expId = handler.expeditionIds(i);
            MiningPool.Expedition memory e = pool.getExpedition(expId);
            if (!e.claimed) expectedEscrow += e.reward;
        }
        assertEq(
            claw.balanceOf(address(pool)),
            expectedEscrow,
            "MiningPool CLAW balance != sum of unclaimed expedition rewards"
        );
    }

    // ─── I-3: season counter is monotonic ──────────────────────────
    //
    // currentSeason only ever increases. Catches any future code path
    // that accidentally resets or decrements the counter.
    //
    // This invariant is trivially true against the current contract
    // (only startSeason writes currentSeason, and only via ++) but is a
    // cheap guard against regressions when new admin functions land.
    uint256 private _prevSeason;
    function invariant_seasonMonotonic() public {
        MiningPool pool = handler.getMiningPool();
        uint256 current = pool.currentSeason();
        assertGe(current, _prevSeason, "currentSeason must be monotonic non-decreasing");
        _prevSeason = current;
    }

    // ─── I-4: expedition reward = baseReward(at start) × tierWeight ─
    //
    // Once started, the reward is locked. We can't reconstruct the
    // baseReward that was active at expedition start without extra
    // tracking, so this invariant instead asserts the weaker property:
    // reward must be a multiple of one of the tier weights {1, 3, 10,
    // 25}. If reward math ever drifts to fractional logic, this breaks.
    function invariant_rewardIsTierWeightMultiple() public view {
        MiningPool pool = handler.getMiningPool();
        uint256 n = handler.expeditionIdsLength();

        for (uint256 i = 0; i < n; i++) {
            uint256 expId = handler.expeditionIds(i);
            MiningPool.Expedition memory e = pool.getExpedition(expId);
            uint256 weight = pool.TIER_WEIGHTS(e.mineTier);
            // reward = baseRewardAtStart × weight, so reward % weight == 0
            assertEq(e.reward % weight, 0, "reward not a multiple of tier weight");
            assertGt(e.reward, 0, "reward must be positive");
        }
    }

    // ─── I-6: battle-rank boost is bounded ──────────────────────────
    //
    // No expedition may ever lock more than +50% over the un-boosted
    // reward at the base in force when it started. The handler records the
    // highest base seen at any successful start, so every reward must sit
    // at or below ghostMax × 1.5 × tierWeight. Catches a boost that leaks
    // past MAX_BOOST_BPS, is applied twice, or is applied after the tier
    // multiply with a rounding escape.
    function invariant_rewardWithinBoostBound() public view {
        MiningPool pool = handler.getMiningPool();
        uint256 n = handler.expeditionIdsLength();
        uint256 maxBase = handler.ghostMaxBaseRewardAtStart();

        for (uint256 i = 0; i < n; i++) {
            uint256 expId = handler.expeditionIds(i);
            MiningPool.Expedition memory e = pool.getExpedition(expId);
            uint256 weight = pool.TIER_WEIGHTS(e.mineTier);
            assertLe(e.reward, ((maxBase * 15_000) / 10_000) * weight, "reward exceeds the +50% boost bound");
        }
    }

    // ─── I-7: live boost epoch is fresh or pays nothing ─────────────
    //
    // Either no epoch was ever activated, or the activation stamp is set.
    // (The TTL fail-safe is exercised through handler_warp: once the stamp
    // is older than BOOST_EPOCH_TTL, teamBoostBps must be 0 for every team.)
    function invariant_staleBoostEpochPaysNothing() public view {
        MiningPool pool = handler.getMiningPool();
        uint32 epoch = pool.currentBoostEpoch();
        if (epoch == 0) return;
        uint256 activatedAt = pool.boostEpochActivatedAt();
        assertGt(activatedAt, 0, "activated epoch must carry a timestamp");
        if (block.timestamp < activatedAt + pool.BOOST_EPOCH_TTL()) return;
        uint256 n = handler.teamIdsLength();
        for (uint256 i = 0; i < n; i++) {
            uint256 teamId = handler.teamIds(i);
            MiningPool.TeamBoost memory b = pool.getTeamBoost(teamId);
            assertEq(pool.teamBoostBps(teamId, b.power), 0, "expired epoch must pay 0");
        }
    }

    // ─── I-5: team-expedition link consistency ─────────────────────
    //
    // For every unclaimed expedition, the team's "active" flag must be
    // true AND _teamToExpedition[teamId] == expId. For claimed expeditions,
    // the link is cleared back to 0 (but the team could be in a new
    // expedition, so only assert the "unclaimed -> linked" direction here).
    function invariant_teamExpeditionLinkConsistent() public view {
        MiningPool pool = handler.getMiningPool();
        TeamManager teamMgr = handler.getTeamManager();
        uint256 n = handler.expeditionIdsLength();

        for (uint256 i = 0; i < n; i++) {
            uint256 expId = handler.expeditionIds(i);
            MiningPool.Expedition memory e = pool.getExpedition(expId);
            if (e.claimed) continue;

            assertEq(pool.getActiveExpedition(e.teamId), expId, "team-expedition link mismatch");
            assertTrue(teamMgr.isTeamActive(e.teamId), "active expedition team must be marked active");
        }
    }
}
