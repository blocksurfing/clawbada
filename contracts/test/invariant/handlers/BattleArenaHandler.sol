// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import "../../helpers/BaseSetup.t.sol";

/// @dev Drives the BattleArena state machine end-to-end for stateful invariant testing.
///      Keeps the action surface small (2 players, 2 fixed teams) so the fuzzer explores
///      phase transitions densely instead of sparse state.
contract BattleArenaHandler is BaseSetup {
    address internal aliceH = makeAddr("arena-h-alice");
    address internal bobH   = makeAddr("arena-h-bob");

    // Track every battle the handler has created so invariants can iterate.
    uint256[] public battleIds;

    // Per-battle persistent state for the reveal path.
    mapping(uint256 => uint256) public teamIdsA;
    mapping(uint256 => uint256) public teamIdsB;

    // Ghost counters — never read by the contract, only by invariants.
    uint256 public ghostDeposits;         // total CLAW ever escrowed via deposit()
    uint256 public ghostExits;            // total CLAW ever paid out of the arena (payouts + refunds + fees)
    uint256 public ghostSettledBattles;
    uint256 public ghostCancelledBattles;

    // Deterministic salts / moves so commit hashes can be reconstructed on reveal.
    function _teamSalt(uint256 battleId, bool isA) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked("arena-h-team", battleId, isA));
    }

    function _moveSalt(uint256 battleId, uint8 round, bool isA) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked("arena-h-move", battleId, round, isA));
    }

    function _moveData(uint256 battleId, bool isA) internal pure returns (bytes memory) {
        return abi.encodePacked(battleId, isA);
    }

    // ─────────── Bootstrap ───────────

    function getBattleArena() external view returns (BattleArena) { return battleArena; }
    function getClaw()        external view returns (ClawToken)   { return claw; }
    function getTeamManager() external view returns (TeamManager) { return teamMgr; }
    function getLobsterNFT()  external view returns (LobsterNFT)  { return nft; }
    function battleIdsLength() external view returns (uint256)    { return battleIds.length; }

    constructor() {
        setUp();

        // Fund players generously so deposits rarely fail for balance reasons.
        _giveClaw(aliceH, 10_000_000e18);
        _giveClaw(bobH,   10_000_000e18);

        // Grant MATCHMAKER_ROLE + RESOLVER_ROLE to this handler so it can drive battles.
        vm.startPrank(admin);
        battleArena.grantRole(battleArena.MATCHMAKER_ROLE(), address(this));
        battleArena.grantRole(battleArena.RESOLVER_ROLE(),   address(this));
        vm.stopPrank();
    }

    // ─────────── Helpers ───────────

    function _getOrCreateEvolvedTeam(address owner, uint256 battleIdForSalt, bool isA)
        internal
        returns (uint256 teamId)
    {
        // Mint 3 fresh Evolved lobsters and form a team.
        uint256[3] memory ids;
        for (uint256 i = 0; i < 3; i++) {
            vm.prank(admin);
            uint256 id = nft.mint(owner, _pureDNA(uint8((battleIdForSalt + i + (isA ? 0 : 5)) % 10)), false);
            vm.prank(admin);
            nft.setEvolutionTier(id, 1);
            ids[i] = id;
        }
        vm.prank(owner);
        teamId = teamMgr.createTeam(ids);
    }

    function _activeBattle(uint256 battleId) internal view returns (bool) {
        if (battleId == 0) return false;
        BattleArena.Battle memory b = battleArena.getBattle(battleId);
        return b.phase != BattleArena.BattlePhase.None;
    }

    function _pickBattleId(uint256 seed) internal view returns (uint256 battleId) {
        uint256 n = battleIds.length;
        if (n == 0) return 0;
        battleId = battleIds[seed % n];
    }

    // ─────────── Handlers ───────────

    /// @dev Create a new battle, deposit both sides, and move straight into TeamCommit.
    function handler_createAndDeposit(uint8 stakeIdx) external {
        stakeIdx = uint8(stakeIdx % 3);
        uint256 stake = battleArena.STAKE_BRACKETS(stakeIdx);

        // F-04: handler fixtures use Evolved-tier teams (power=3). Tests that
        // exercise non-Evolved compositions need to pass the matching power.
        try battleArena.createBattle(aliceH, bobH, stake, 3, 3) returns (uint256 battleId) {
            battleIds.push(battleId);

            uint256 antiGrief = stake * battleArena.ANTI_GRIEF_BPS() / battleArena.BPS_DENOMINATOR();
            uint256 total = stake + antiGrief;

            _tryDeposit(battleId, aliceH, total);
            _tryDeposit(battleId, bobH,   total);
        } catch {}
    }

    function _tryDeposit(uint256 battleId, address who, uint256 total) internal {
        try this._deposit(battleId, who, total) {
            ghostDeposits += total;
        } catch {}
    }

    /// @dev External so internal try/catch works cleanly.
    function _deposit(uint256 battleId, address who, uint256 total) external {
        require(msg.sender == address(this), "handler-only");
        vm.startPrank(who);
        claw.approve(address(battleArena), total);
        battleArena.deposit(battleId);
        vm.stopPrank();
    }

    function handler_commitTeams(uint256 seed) external {
        uint256 battleId = _pickBattleId(seed);
        if (battleId == 0) return;

        // Create teams eagerly if we haven't yet; fine if one commit hash is wrong
        // since we can still detect phase behavior — but we want reveals to work too.
        if (teamIdsA[battleId] == 0) teamIdsA[battleId] = _getOrCreateEvolvedTeam(aliceH, battleId, true);
        if (teamIdsB[battleId] == 0) teamIdsB[battleId] = _getOrCreateEvolvedTeam(bobH,   battleId, false);

        bytes32 saltA = _teamSalt(battleId, true);
        bytes32 saltB = _teamSalt(battleId, false);

        bytes32 hashA = keccak256(abi.encodePacked(battleId, aliceH, teamIdsA[battleId], saltA));
        bytes32 hashB = keccak256(abi.encodePacked(battleId, bobH,   teamIdsB[battleId], saltB));

        vm.prank(aliceH);
        try battleArena.commitTeam(battleId, hashA) {} catch {}

        vm.prank(bobH);
        try battleArena.commitTeam(battleId, hashB) {} catch {}
    }

    function handler_revealTeams(uint256 seed) external {
        uint256 battleId = _pickBattleId(seed);
        if (battleId == 0) return;
        if (teamIdsA[battleId] == 0 || teamIdsB[battleId] == 0) return;

        vm.prank(aliceH);
        try battleArena.revealTeam(battleId, teamIdsA[battleId], _teamSalt(battleId, true)) {} catch {}

        vm.prank(bobH);
        try battleArena.revealTeam(battleId, teamIdsB[battleId], _teamSalt(battleId, false)) {} catch {}
    }

    function handler_commitMoves(uint256 seed) external {
        uint256 battleId = _pickBattleId(seed);
        if (battleId == 0) return;

        uint8 round;
        try battleArena.getBattle(battleId) returns (BattleArena.Battle memory b) {
            round = b.currentRound;
        } catch { return; }

        bytes32 saltA = _moveSalt(battleId, round, true);
        bytes32 saltB = _moveSalt(battleId, round, false);
        bytes memory mA = _moveData(battleId, true);
        bytes memory mB = _moveData(battleId, false);

        bytes32 hashA = keccak256(abi.encodePacked(battleId, round, aliceH, mA, saltA));
        bytes32 hashB = keccak256(abi.encodePacked(battleId, round, bobH,   mB, saltB));

        vm.prank(aliceH);
        try battleArena.commitMoves(battleId, hashA) {} catch {}
        vm.prank(bobH);
        try battleArena.commitMoves(battleId, hashB) {} catch {}
    }

    function handler_revealMoves(uint256 seed) external {
        uint256 battleId = _pickBattleId(seed);
        if (battleId == 0) return;

        uint8 round;
        try battleArena.getBattle(battleId) returns (BattleArena.Battle memory b) {
            round = b.currentRound;
        } catch { return; }

        vm.prank(aliceH);
        try battleArena.revealMoves(battleId, _moveData(battleId, true), _moveSalt(battleId, round, true)) {} catch {}
        vm.prank(bobH);
        try battleArena.revealMoves(battleId, _moveData(battleId, false), _moveSalt(battleId, round, false)) {} catch {}
    }

    function handler_advanceRound(uint256 seed) external {
        uint256 battleId = _pickBattleId(seed);
        if (battleId == 0) return;

        try battleArena.advanceRound(battleId) {} catch {}
    }

    function handler_settle(uint256 seed, bool aliceWins) external {
        uint256 battleId = _pickBattleId(seed);
        if (battleId == 0) return;

        address winner = aliceWins ? aliceH : bobH;
        try battleArena.settle(battleId, winner, [uint8(5), 5, 5], [uint8(20), 20, 20]) {} catch {}
    }

    function handler_dispute(uint256 seed, bool byAlice) external {
        uint256 battleId = _pickBattleId(seed);
        if (battleId == 0) return;

        address who = byAlice ? aliceH : bobH;

        // V3 S1: approve the dispute bond so the invariant test exercises the
        // bonded dispute path. aliceH/bobH already hold 10M $CLAW from setUp().
        // The bracket is read off the actual battle stake in case the invariant
        // tests cycle through stake brackets.
        BattleArena.Battle memory b = battleArena.getBattle(battleId);
        uint256 bond;
        if (b.stakeAmount == battleArena.STAKE_BRACKETS(0)) bond = battleArena.disputeBonds(0);
        else if (b.stakeAmount == battleArena.STAKE_BRACKETS(1)) bond = battleArena.disputeBonds(1);
        else bond = battleArena.disputeBonds(2);

        if (bond > 0) {
            vm.prank(who);
            claw.approve(address(battleArena), bond);
        }

        vm.prank(who);
        try battleArena.disputeBattle(battleId, hex"01") {} catch {}
    }

    function handler_finalize(uint256 seed) external {
        uint256 battleId = _pickBattleId(seed);
        if (battleId == 0) return;
        uint256 contractBalBefore = claw.balanceOf(address(battleArena));
        try battleArena.finalizeBattle(battleId) {
            if (claw.balanceOf(address(battleArena)) < contractBalBefore) {
                ghostExits += contractBalBefore - claw.balanceOf(address(battleArena));
                ghostSettledBattles++;
            }
        } catch {}
    }

    function handler_adminResolve(uint256 seed, bool aliceWins) external {
        uint256 battleId = _pickBattleId(seed);
        if (battleId == 0) return;

        address winner = aliceWins ? aliceH : bobH;
        uint256 contractBalBefore = claw.balanceOf(address(battleArena));
        vm.prank(admin);
        try battleArena.adminResolveDispute(battleId, winner, [uint8(5), 5, 5], [uint8(20), 20, 20]) {
            if (claw.balanceOf(address(battleArena)) < contractBalBefore) {
                ghostExits += contractBalBefore - claw.balanceOf(address(battleArena));
                ghostSettledBattles++;
            }
        } catch {}
    }

    function handler_handleTimeout(uint256 seed) external {
        uint256 battleId = _pickBattleId(seed);
        if (battleId == 0) return;

        uint256 contractBalBefore = claw.balanceOf(address(battleArena));
        try battleArena.handleTimeout(battleId) {
            if (claw.balanceOf(address(battleArena)) < contractBalBefore) {
                ghostExits += contractBalBefore - claw.balanceOf(address(battleArena));
                BattleArena.Battle memory b = battleArena.getBattle(battleId);
                if (b.phase == BattleArena.BattlePhase.Settled) ghostSettledBattles++;
                else if (b.phase == BattleArena.BattlePhase.Cancelled) ghostCancelledBattles++;
            }
        } catch {}
    }

    function handler_emergencyWithdraw(uint256 seed, bool byAlice) external {
        uint256 battleId = _pickBattleId(seed);
        if (battleId == 0) return;

        address who = byAlice ? aliceH : bobH;
        uint256 contractBalBefore = claw.balanceOf(address(battleArena));
        vm.prank(who);
        try battleArena.emergencyWithdraw(battleId) {
            if (claw.balanceOf(address(battleArena)) < contractBalBefore) {
                ghostExits += contractBalBefore - claw.balanceOf(address(battleArena));
                ghostCancelledBattles++;
            }
        } catch {}
    }

    /// @dev Move wall-clock forward so phase/dispute deadlines can pass.
    function handler_warp(uint256 delta) external {
        // Cap delta so we don't skip months in a single step.
        delta = bound(delta, 1, 6 hours);
        vm.warp(block.timestamp + delta);
    }
}
