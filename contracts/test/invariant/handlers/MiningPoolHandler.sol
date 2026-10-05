// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import "../../helpers/BaseSetup.t.sol";

/// @dev Drives the MiningPool state machine for stateful invariant testing.
///      Narrow action surface (3 actors, pre-minted lobsters, fixed season
///      config) so the fuzzer explores start/claim/adminRelease interleavings
///      densely rather than fighting setup complexity.
contract MiningPoolHandler is BaseSetup {
    address internal alice_h = makeAddr("mp-h-alice");
    address internal bob_h   = makeAddr("mp-h-bob");
    address internal carol_h = makeAddr("mp-h-carol");

    address[3] internal actors;
    uint256[] public teamIds;
    uint256[] public expeditionIds;

    uint256 internal initialEmission_;
    uint256 internal constant INITIAL_BASE_REWARD = 1_250e18;

    // Ghosts — never read by the contract, only by invariants.
    uint256 public ghostExpeditionsStarted;
    uint256 public ghostExpeditionsClaimed;
    uint256 public ghostExpeditionsAdminReleased;
    uint256 public ghostMintedSum;         // GOLD minted into escrow across all starts
    uint256 public ghostTransferredSum;    // GOLD paid out to claimers
    uint256 public ghostBurnedSum;         // GOLD burned by admin release
    uint256 public ghostMaxBaseRewardAtStart; // highest baseReward in force at any successful start

    // D-30: the glide's step bound, observed across every call that can re-peg. fail_on_revert
    // is false, so an assert inside a handler would be swallowed; the first breach is recorded
    // here and invariant_glideStepBound reads it.
    string public glideViolation;
    uint256 public ghostGlideSteps;  // re-pegs that actually moved the rate
    uint256 public ghostRepegCalls;  // successful permissionless repeg() calls

    // D-19 ceiling (review 2026-10-03 F-7): the highest ceiling observed in each (season, epoch) at
    // the moment of a start — read after the epoch's lazy re-peg, so with the rate the epoch opened
    // at — and how many starts the ceiling refused (reachability).
    mapping(uint256 => mapping(uint256 => uint256)) public ghostEpochCapHigh;
    uint256 public ghostCeilingRefusals;

    // ─────────── Public accessors ───────────
    function getMiningPool()  external view returns (MiningPool)  { return miningPool; }
    function getGold()        external view returns (GoldToken)   { return gold; }
    function getTeamManager() external view returns (TeamManager) { return teamMgr; }
    function teamIdsLength()       external view returns (uint256) { return teamIds.length; }
    function expeditionIdsLength() external view returns (uint256) { return expeditionIds.length; }

    // ─────────── Bootstrap ───────────

    /// @param initialEmission Season 1's budget: the S1 figure for the general harness, a small one
    ///        for the ceiling harness (InvariantMiningPoolCeiling) so the epoch ceiling binds.
    constructor(uint256 initialEmission) {
        setUp();
        initialEmission_ = initialEmission;

        actors[0] = alice_h;
        actors[1] = bob_h;
        actors[2] = carol_h;

        // Pre-create a few teams per actor at varied evolution tiers (0-3).
        // Teams must not be active, so lobsters stay freshly minted + team-locked only.
        for (uint256 a = 0; a < 3; a++) {
            // Each actor gets 4 teams (one at each tier 0..3)
            for (uint8 tier = 0; tier < 4; tier++) {
                uint256[3] memory ids;
                for (uint256 i = 0; i < 3; i++) {
                    vm.prank(admin);
                    uint256 id = nft.mint(actors[a], _pureDNA(uint8((a + tier + i) % 10)), false);
                    if (tier > 0) {
                        vm.prank(admin);
                        nft.setEvolutionTier(id, tier);
                    }
                    ids[i] = id;
                }
                vm.prank(actors[a]);
                uint256 teamId = teamMgr.createTeam(ids);
                teamIds.push(teamId);
            }
        }

        // Start season 1 so expeditions can be created.
        vm.prank(admin);
        miningPool.startSeason(initialEmission_, INITIAL_BASE_REWARD);
    }

    // ─────────── Helpers ───────────

    function _getTeamTier(uint256 teamId) internal view returns (uint8 minTier) {
        TeamManager.Team memory team = teamMgr.getTeam(teamId);
        uint8 lo = nft.getEvolutionTier(team.lobsterIds[0]);
        for (uint256 i = 1; i < 3; i++) {
            uint8 t = nft.getEvolutionTier(team.lobsterIds[i]);
            if (t < lo) lo = t;
        }
        return lo;
    }

    function _ownerOf(uint256 teamId) internal view returns (address) {
        TeamManager.Team memory team = teamMgr.getTeam(teamId);
        return team.owner;
    }

    // ─────────── Handlers ───────────

    function handler_startExpedition(uint256 teamSeed, uint8 mineTier) external {
        if (teamIds.length == 0) return;
        uint256 teamId = teamIds[teamSeed % teamIds.length];
        mineTier = uint8(mineTier % 4);

        address owner = _ownerOf(teamId);
        uint256 balBefore = gold.balanceOf(address(miningPool));

        uint256 seasonBefore = miningPool.currentSeason();
        uint256 baseBefore = miningPool.currentBaseReward();
        _noteEpochCap();

        vm.prank(owner);
        try miningPool.startExpedition(teamId, mineTier) returns (uint256 expId) {
            _checkGlideStep(seasonBefore, baseBefore);
            expeditionIds.push(expId);
            ghostExpeditionsStarted++;
            ghostMintedSum += gold.balanceOf(address(miningPool)) - balBefore;
            // The lazy re-peg inside startExpedition has run by now, so this is the exact
            // base the reward was locked at.
            uint256 base = miningPool.currentBaseReward();
            if (base > ghostMaxBaseRewardAtStart) ghostMaxBaseRewardAtStart = base;
        } catch (bytes memory err) {
            if (err.length >= 4 && bytes4(err) == MiningPool.EpochBudgetFull.selector) ghostCeilingRefusals++;
        }
    }

    /// @dev The ceiling this epoch opened with: roll the lazy re-peg first (exactly what the
    ///      start about to run would do), then read the view. Keeps the highest value seen.
    function _noteEpochCap() internal {
        if (miningPool.currentSeason() == 0) return;
        try miningPool.repeg() {} catch { return; } // no active season: nothing to note
        (uint256 cap,,) = miningPool.epochBudget();
        (uint256 season, uint256 epoch) = currentEpoch();
        if (cap > ghostEpochCapHigh[season][epoch]) ghostEpochCapHigh[season][epoch] = cap;
    }

    /// @dev (season, epoch index) of the current block.
    function currentEpoch() public view returns (uint256 season, uint256 epoch) {
        season = miningPool.currentSeason();
        if (season == 0) return (0, 0);
        uint256 start = miningPool.getSeasonConfig(season).startTime;
        epoch = (block.timestamp - start) / miningPool.REPEG_EPOCH();
    }

    /// @dev Post a boost for a random team at either its true power or a wrong one, for the
    ///      live epoch or the next; some bps values exceed the cap on purpose.
    function handler_setTeamBoosts(uint256 teamSeed, uint16 bps, bool wrongPower, bool nextEpoch) external {
        if (teamIds.length == 0) return;
        uint256 teamId = teamIds[teamSeed % teamIds.length];
        bps = uint16(bound(bps, 0, 6_000));
        TeamManager.Team memory team = teamMgr.getTeam(teamId);
        uint8 power = 0;
        for (uint256 i = 0; i < 3; i++) {
            power += nft.getEvolutionTier(team.lobsterIds[i]);
        }
        if (wrongPower) power += 1;
        uint32 epoch = miningPool.currentBoostEpoch() + (nextEpoch ? 1 : 0);
        MiningPool.BoostEntry[] memory entries = new MiningPool.BoostEntry[](1);
        entries[0] = MiningPool.BoostEntry({teamId: teamId, bps: bps, power: power});
        vm.prank(admin);
        try miningPool.setTeamBoosts(epoch, entries) {} catch {}
    }

    function handler_activateBoostEpoch() external {
        uint32 next = miningPool.currentBoostEpoch() + 1;
        vm.prank(admin);
        try miningPool.activateBoostEpoch(next) {} catch {}
    }

    function handler_claimExpedition(uint256 expSeed) external {
        if (expeditionIds.length == 0) return;
        uint256 expId = expeditionIds[expSeed % expeditionIds.length];
        uint256 balBefore = gold.balanceOf(address(miningPool));

        MiningPool.Expedition memory exp;
        try miningPool.getExpedition(expId) returns (MiningPool.Expedition memory e) {
            exp = e;
        } catch { return; }

        vm.prank(exp.owner);
        try miningPool.claimExpedition(expId) {
            ghostExpeditionsClaimed++;
            ghostTransferredSum += balBefore - gold.balanceOf(address(miningPool));
        } catch {}
    }

    function handler_adminReleaseExpedition(uint256 expSeed) external {
        if (expeditionIds.length == 0) return;
        uint256 expId = expeditionIds[expSeed % expeditionIds.length];
        uint256 balBefore = gold.balanceOf(address(miningPool));

        vm.prank(admin);
        try miningPool.adminReleaseExpedition(expId) {
            ghostExpeditionsAdminReleased++;
            ghostBurnedSum += balBefore - gold.balanceOf(address(miningPool));
        } catch {}
    }

    /// @dev D-30: the permissionless (hourly, since D-19) re-peg. The handler only ever reached the glide
    ///      lazily through startExpedition; repeg() itself was never called.
    function handler_repeg() external {
        uint256 seasonBefore = miningPool.currentSeason();
        uint256 baseBefore = miningPool.currentBaseReward();
        try miningPool.repeg() {
            ghostRepegCalls++;
            _checkGlideStep(seasonBefore, baseBefore);
        } catch {}
    }

    /// @dev One glide step may move the rate by at most 30%, never above the season's launch
    ///      reward and never to zero. The one exception is by design: after an admin override
    ///      ABOVE launch, the next re-peg pulls the rate back down to launch in one step.
    function _checkGlideStep(uint256 seasonBefore, uint256 baseBefore) internal {
        if (miningPool.currentSeason() != seasonBefore) return;
        uint256 base = miningPool.currentBaseReward();
        if (base == baseBefore) return;
        ghostGlideSteps++;

        uint256 launch = miningPool.getSeasonConfig(seasonBefore).launchBaseReward;
        if (base == 0) return _flagGlide("glide reached zero");
        if (baseBefore > launch) {
            if (base > baseBefore) _flagGlide("an override above launch grew");
            return;
        }
        uint256 hi = (baseBefore * 13_000) / 10_000;
        if (hi == 0) hi = 1;
        if (base > launch) _flagGlide("glide above the launch reward");
        if (base < (baseBefore * 7_000) / 10_000) _flagGlide("one step fell by more than 30%");
        if (base > hi) _flagGlide("one step rose by more than 30%");
    }

    function _flagGlide(string memory what) internal {
        if (bytes(glideViolation).length == 0) glideViolation = what;
    }

    function handler_setBaseReward(uint256 newReward) external {
        newReward = bound(newReward, 1, 100_000e18);
        vm.prank(admin);
        try miningPool.setBaseReward(newReward) {} catch {}
    }

    function handler_startNewSeason(uint256 emission, uint256 baseReward) external {
        emission   = bound(emission, 1e18, 1_000_000_000e18);
        baseReward = bound(baseReward, 1, 10_000e18);
        vm.prank(admin);
        try miningPool.startSeason(emission, baseReward) {} catch {}
    }

    /// @dev Move time forward so expeditions can complete, seasons can end,
    ///      and admin-release grace can elapse. Capped to keep the sequence
    ///      within cache/tx-simulation-friendly ranges.
    function handler_warp(uint256 delta) external {
        delta = bound(delta, 1, 10 days);
        vm.warp(block.timestamp + delta);
    }
}
