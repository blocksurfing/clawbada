// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {MiningPoolHandler} from "./handlers/MiningPoolHandler.sol";
import {MiningPool} from "../../MiningPool.sol";

/// @dev D-19 (review 2026-10-03 F-7): the per-epoch spend ceiling, on a budget where it BINDS.
///      20M GOLD: hour 0's fair-share ceiling is 27,777 GOLD, under one Apex expedition (31,250),
///      so the one-expedition floor is the ceiling and a second Apex start in the same hour is
///      refused. The general harness (InvariantMiningPool, S1 budget) never gets near it.
contract InvariantMiningPoolCeiling is Test {
    MiningPoolHandler internal handler;

    function setUp() public {
        handler = new MiningPoolHandler(20_000_000e18);
        targetContract(address(handler));
        bytes4[] memory selectors = new bytes4[](7);
        selectors[0] = MiningPoolHandler.handler_startExpedition.selector;
        selectors[1] = MiningPoolHandler.handler_claimExpedition.selector;
        selectors[2] = MiningPoolHandler.handler_setBaseReward.selector;
        selectors[3] = MiningPoolHandler.handler_warp.selector;
        selectors[4] = MiningPoolHandler.handler_setTeamBoosts.selector;
        selectors[5] = MiningPoolHandler.handler_activateBoostEpoch.selector;
        selectors[6] = MiningPoolHandler.handler_repeg.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
    }

    /// @dev Reachability: in this configuration the ceiling actually refuses starts. Three Apex
    ///      teams in hour 0: the first takes the whole floor, the second is refused.
    function test_ceilingBindsInThisConfiguration() public {
        for (uint256 i = 0; i < handler.teamIdsLength(); i++) handler.handler_startExpedition(i, 3);
        assertGt(handler.ghostCeilingRefusals(), 0, "the ceiling never bound: the harness is not testing it");
        assertGt(handler.ghostExpeditionsStarted(), 0, "and something still started");
    }

    function invariant_epochMintedWithinCap() public view {
        MiningPool pool = handler.getMiningPool();
        if (pool.currentSeason() == 0) return;
        (uint256 season, uint256 epoch) = handler.currentEpoch();
        (, uint256 minted,) = pool.epochBudget();
        uint256 high = handler.ghostEpochCapHigh(season, epoch);
        if (high == 0) {
            assertEq(minted, 0, "minted in an epoch no start ever touched");
            return;
        }
        assertLe(minted, high, "an epoch minted past the ceiling it opened with");
    }

    function invariant_glideStepBound() public view {
        assertEq(handler.glideViolation(), "", "a glide step broke its bound");
    }

    function invariant_seasonBudgetCap() public view {
        MiningPool pool = handler.getMiningPool();
        for (uint256 s = 1; s <= pool.currentSeason(); s++) {
            MiningPool.SeasonConfig memory cfg = pool.getSeasonConfig(s);
            assertLe(cfg.totalMinted, cfg.totalEmission, "season budget cap violated");
        }
    }
}
