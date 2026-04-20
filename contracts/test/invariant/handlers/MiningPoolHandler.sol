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

    uint256 internal constant INITIAL_EMISSION   = 387_500_000e18;
    uint256 internal constant INITIAL_BASE_REWARD = 1_250e18;

    // Ghosts — never read by the contract, only by invariants.
    uint256 public ghostExpeditionsStarted;
    uint256 public ghostExpeditionsClaimed;
    uint256 public ghostExpeditionsAdminReleased;
    uint256 public ghostMintedSum;         // CLAW minted into escrow across all starts
    uint256 public ghostTransferredSum;    // CLAW paid out to claimers
    uint256 public ghostBurnedSum;         // CLAW burned by admin release

    // ─────────── Public accessors ───────────
    function getMiningPool()  external view returns (MiningPool)  { return miningPool; }
    function getClaw()        external view returns (ClawToken)   { return claw; }
    function getTeamManager() external view returns (TeamManager) { return teamMgr; }
    function teamIdsLength()       external view returns (uint256) { return teamIds.length; }
    function expeditionIdsLength() external view returns (uint256) { return expeditionIds.length; }

    // ─────────── Bootstrap ───────────

    constructor() {
        setUp();

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
        miningPool.startSeason(INITIAL_EMISSION, INITIAL_BASE_REWARD);
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
        uint256 balBefore = claw.balanceOf(address(miningPool));

        vm.prank(owner);
        try miningPool.startExpedition(teamId, mineTier) returns (uint256 expId) {
            expeditionIds.push(expId);
            ghostExpeditionsStarted++;
            ghostMintedSum += claw.balanceOf(address(miningPool)) - balBefore;
        } catch {}
    }

    function handler_claimExpedition(uint256 expSeed) external {
        if (expeditionIds.length == 0) return;
        uint256 expId = expeditionIds[expSeed % expeditionIds.length];
        uint256 balBefore = claw.balanceOf(address(miningPool));

        MiningPool.Expedition memory exp;
        try miningPool.getExpedition(expId) returns (MiningPool.Expedition memory e) {
            exp = e;
        } catch { return; }

        vm.prank(exp.owner);
        try miningPool.claimExpedition(expId) {
            ghostExpeditionsClaimed++;
            ghostTransferredSum += balBefore - claw.balanceOf(address(miningPool));
        } catch {}
    }

    function handler_adminReleaseExpedition(uint256 expSeed) external {
        if (expeditionIds.length == 0) return;
        uint256 expId = expeditionIds[expSeed % expeditionIds.length];
        uint256 balBefore = claw.balanceOf(address(miningPool));

        vm.prank(admin);
        try miningPool.adminReleaseExpedition(expId) {
            ghostExpeditionsAdminReleased++;
            ghostBurnedSum += balBefore - claw.balanceOf(address(miningPool));
        } catch {}
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
