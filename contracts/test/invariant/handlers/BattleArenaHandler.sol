// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import "../../helpers/BaseSetup.t.sol";

/// @dev Drives the BattleArena state machine end-to-end for stateful invariant testing.
///      Keeps the action surface small (2 players, 2 fixed teams) so the fuzzer explores
///      phase transitions densely instead of sparse state.
contract BattleArenaHandler is BaseSetup {
    // D-01: every test battle uses one known secret; the commitment binds it to the battle id.
    bytes32 internal constant SEED_SECRET = keccak256("clawbada-test-seed-secret");

    function _seedCommit(uint256 battleId) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(battleId, SEED_SECRET));
    }

    address internal aliceH = makeAddr("arena-h-alice");
    address internal bobH   = makeAddr("arena-h-bob");

    // Track every battle the handler has created so invariants can iterate.
    uint256[] public battleIds;

    // Per-battle persistent state for the reveal path.
    mapping(uint256 => uint256) public teamIdsA;
    mapping(uint256 => uint256) public teamIdsB;

    // D-31: a SMALL pool of reusable teams per player. The handler used to mint a fresh
    // three-Evolved team for every battle and create every battle at power 3/3, so two live
    // battles could never want the same team and a revealed team's Power could never differ
    // from the matchmaker's snapshot — TeamAlreadyInBattle and TeamPowerChanged were
    // unreachable in the whole invariant campaign.
    uint256 internal constant POOL_SIZE = 3;
    uint256[] public poolA;
    uint256[] public poolB;
    uint256 public ghostRevealRejectedPower;       // revealTeams reverted TeamPowerChanged
    uint256 public ghostRevealRejectedContention;  // revealTeams reverted TeamAlreadyInBattle
    uint256 public ghostReveals;                   // revealTeams succeeded
    uint256 public ghostPoolEvolutions;

    // Ghost counters — never read by the contract, only by invariants.
    uint256 public ghostDeposits;         // total CLAW ever escrowed via deposit()
    uint256 public ghostExits;            // total CLAW ever paid out of the arena (payouts + refunds + fees)
    uint256 public ghostSettledBattles;
    uint256 public ghostCancelledBattles;
    uint256 public ghostDraws;             // settled battles whose winner is address(0)

    // V3 settle commitments (any non-zero value).
    bytes32 internal constant HASH_STATE = keccak256("arena-h-final-state");
    bytes32 internal constant HASH_LOG = keccak256("arena-h-turn-log");

    // Deterministic salts so team commit hashes can be reconstructed on reveal.
    function _teamSalt(uint256 battleId, bool isA) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked("arena-h-team", battleId, isA));
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

    /// @dev A team from the player's pool: the pool fills with fresh teams first, then reuses.
    function _poolTeam(address owner, bool isA, uint256 seed) internal returns (uint256 teamId) {
        uint256[] storage pool = isA ? poolA : poolB;
        if (pool.length < POOL_SIZE) {
            teamId = _getOrCreateEvolvedTeam(owner, pool.length + 1, isA);
            pool.push(teamId);
            return teamId;
        }
        return pool[seed % POOL_SIZE];
    }

    /// @dev Team Power exactly as BattleArena computes it: the sum of the three tiers.
    function teamPower(uint256 teamId) public view returns (uint8 power) {
        TeamManager.Team memory t = teamMgr.getTeam(teamId);
        for (uint256 i = 0; i < 3; i++) power += nft.getEvolutionTier(t.lobsterIds[i]);
    }

    function poolLength(bool isA) external view returns (uint256) {
        return isA ? poolA.length : poolB.length;
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
    function handler_createAndDeposit(uint8 stakeIdx, uint256 teamSeed) external {
        stakeIdx = uint8(stakeIdx % 3);
        uint256 stake = battleArena.STAKE_BRACKETS(stakeIdx);

        // D-31: like the real matchmaker, pick each side's team FIRST and record its Power
        // truthfully at match time. Teams come from a small pool, so concurrent battles
        // contend for them, and handler_evolvePoolLobster can move a team's Power between
        // this snapshot and the reveal.
        uint256 teamA = _poolTeam(aliceH, true, teamSeed);
        uint256 teamB = _poolTeam(bobH, false, teamSeed >> 8);

        try battleArena.createBattle(aliceH, bobH, stake, teamPower(teamA), teamPower(teamB)) returns (uint256 battleId) {
            battleIds.push(battleId);
            teamIdsA[battleId] = teamA;
            teamIdsB[battleId] = teamB;

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

        // F5-01: atomic resolver-submitted reveal. This handler holds RESOLVER_ROLE
        // (granted to address(this) in the constructor), so it calls directly.
        try battleArena.revealTeams(
            battleId,
            teamIdsA[battleId],
            _teamSalt(battleId, true),
            teamIdsB[battleId],
            _teamSalt(battleId, false),
            _seedCommit(battleId)
        ) {
            ghostReveals++;
        } catch (bytes memory err) {
            bytes4 sel;
            if (err.length >= 4) {
                assembly {
                    sel := mload(add(err, 32))
                }
            }
            if (sel == BattleArena.TeamPowerChanged.selector) ghostRevealRejectedPower++;
            else if (sel == BattleArena.TeamAlreadyInBattle.selector) ghostRevealRejectedContention++;
        }
    }

    /// @dev D-31: match -> deposit -> commit -> reveal in ONE call. The reveal window is 20 s
    ///      and the commit window 30 s, so with the steps as separate fuzz calls a single
    ///      handler_warp in between kills the battle and a run rarely holds more than one
    ///      live battle. This keeps several alive at once, which is what makes pool teams
    ///      contend — and gives the settle / dispute / finalize handlers more to work on.
    function handler_openBattle(uint8 stakeIdx, uint256 teamSeed) external {
        uint256 before = battleIds.length;
        this.handler_createAndDeposit(stakeIdx, teamSeed);
        if (battleIds.length == before) return;
        uint256 index = battleIds.length - 1; // _pickBattleId(seed) = battleIds[seed % n]
        this.handler_commitTeams(index);
        this.handler_revealTeams(index);
    }

    /// @dev D-31: evolve one lobster of a pool team that is NOT in a battle — the same rule
    ///      EvolutionLab enforces (a locked lobster cannot evolve). Moves that team's Power, so
    ///      any battle already created with the old snapshot must refuse its reveal.
    function handler_evolvePoolLobster(uint256 seed) external {
        uint256[] storage pool = (seed & 1) == 0 ? poolA : poolB;
        if (pool.length == 0) return;
        uint256 teamId = pool[(seed >> 1) % pool.length];
        if (battleArena.teamInBattle(teamId)) return;

        uint256 lobsterId = teamMgr.getTeam(teamId).lobsterIds[(seed >> 16) % 3];
        uint8 tier = nft.getEvolutionTier(lobsterId);
        if (tier >= 3) return;
        vm.prank(admin);
        nft.setEvolutionTier(lobsterId, tier + 1);
        ghostPoolEvolutions++;
    }

    /// @dev Pool teams take repair damage every battle and would hit the 80-damage gate after
    ///      a few; this stands in for RepairShop so the pool stays usable.
    function handler_healPoolTeam(uint256 seed) external {
        uint256[] storage pool = (seed & 1) == 0 ? poolA : poolB;
        if (pool.length == 0) return;
        uint256 teamId = pool[(seed >> 1) % pool.length];
        if (battleArena.teamInBattle(teamId)) return;
        uint256[3] memory ids = teamMgr.getTeam(teamId).lobsterIds;
        for (uint256 i = 0; i < 3; i++) {
            vm.prank(admin);
            nft.setDamage(ids[i], 0);
        }
    }

    /// @dev V3: outcome % 3 -> alice wins / bob wins / draw (address(0)).
    function _outcomeWinner(uint8 outcome) internal view returns (address) {
        uint8 o = outcome % 3;
        if (o == 0) return aliceH;
        if (o == 1) return bobH;
        return address(0);
    }

    function handler_settle(uint256 seed, uint8 outcome) external {
        uint256 battleId = _pickBattleId(seed);
        if (battleId == 0) return;

        try battleArena.settle(
            battleId, _outcomeWinner(outcome), HASH_STATE, HASH_LOG, [uint8(5), 5, 5], [uint8(20), 20, 20], SEED_SECRET
        ) {} catch {}
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
                if (battleArena.getBattle(battleId).winner == address(0)) ghostDraws++;
            }
        } catch {}
    }

    function handler_adminResolve(uint256 seed, uint8 outcome, bool sameHashes) external {
        uint256 battleId = _pickBattleId(seed);
        if (battleId == 0) return;

        address winner = _outcomeWinner(outcome);
        // Exercise both bond routes: identical proposal (slash) vs. a changed hash (refund).
        bytes32 logHash = sameHashes ? HASH_LOG : keccak256(abi.encodePacked(HASH_LOG, seed));
        uint256 contractBalBefore = claw.balanceOf(address(battleArena));
        vm.prank(admin);
        try battleArena.adminResolveDispute(
            battleId, winner, HASH_STATE, logHash, [uint8(5), 5, 5], [uint8(20), 20, 20]
        ) {
            if (claw.balanceOf(address(battleArena)) < contractBalBefore) {
                ghostExits += contractBalBefore - claw.balanceOf(address(battleArena));
                ghostSettledBattles++;
                if (winner == address(0)) ghostDraws++;
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
