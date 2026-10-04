// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import "../../helpers/BaseSetup.t.sol";

/// @dev Drives the BattleArena state machine end-to-end for stateful invariant testing.
///      Keeps the action surface small (2 players, a small pool of reusable teams) so the fuzzer
///      explores phase transitions densely instead of sparse state.
///
///      Every successful money-moving call is replayed against an independent MODEL of the
///      payout rules (ghost balances for both players, the dev wallet, the burn, the escrow and the
///      refund reserve). The invariants then compare the model to the real token balances, so a
///      wrong payout, a skipped slash, a wrong draw fee or a reserve leak shows up as a mismatch.
///      Liveness: a call the rules say must succeed (or must fail) but did not is counted in
///      `ghostUnexpected` (handlers swallow reverts, so this is how a wrongly-reverting path shows).
contract BattleArenaHandler is BaseSetup {
    // D-01: every test battle uses one known secret; the commitment binds it to the battle id.
    bytes32 internal constant SEED_SECRET = keccak256("clawbada-test-seed-secret");

    function _seedCommit(uint256 battleId) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(battleId, SEED_SECRET));
    }

    address internal aliceH = makeAddr("arena-h-alice");
    address internal bobH = makeAddr("arena-h-bob");
    address internal guardianH = makeAddr("arena-h-guardian");
    address internal funderH = makeAddr("arena-h-funder");
    address internal sinkH = makeAddr("arena-h-sink");

    uint256 internal constant PLAYER_FUNDS = 10_000_000e18;
    uint256 internal constant FUNDER_FUNDS = 50_000_000e18;

    // Track every battle the handler has created so invariants can iterate.
    uint256[] public battleIds;

    // Per-battle persistent state for the reveal path.
    mapping(uint256 => uint256) public teamIdsA;
    mapping(uint256 => uint256) public teamIdsB;

    // D-31: a SMALL pool of reusable teams per player, so concurrent battles contend for teams and
    // a team's Power can move between the matchmaker snapshot and the reveal.
    uint256 internal constant POOL_SIZE = 3;
    uint256[] public poolA;
    uint256[] public poolB;
    uint256 public ghostRevealRejectedPower; // revealTeams reverted TeamPowerChanged
    uint256 public ghostRevealRejectedContention; // revealTeams reverted TeamAlreadyInBattle
    uint256 public ghostReveals; // revealTeams succeeded
    uint256 public ghostPoolEvolutions;

    // ─── Model (ghost) state ───
    uint256 public ghostEscrow; // CLAW the arena owes to battles
    uint256 public ghostReserve; // refund reserve
    uint256 public ghostAlice; // expected balance of aliceH
    uint256 public ghostBob; // expected balance of bobH
    uint256 public ghostDev; // expected dev-wallet balance
    uint256 public ghostBurned; // expected totalSupply decrease
    uint256 public ghostSink; // expected balance of the reserve-withdraw sink
    uint256 public ghostFunder; // expected balance of the reserve funder
    uint256 public initialSupply;

    uint256 public ghostUnexpected; // a call the rules say must succeed reverted, or vice versa
    uint256 public ghostFreezeViolations; // freeze succeeded outside AwaitingFinalize / after the deadline

    // Coverage counters
    uint256 public ghostSettles;
    uint256 public ghostFinalizes;
    uint256 public ghostFreezes;
    uint256 public ghostResolves;
    uint256 public ghostExpiries;
    uint256 public ghostExpiryBurns;
    uint256 public ghostForfeitSlashes;
    uint256 public ghostDraws;
    uint256 public ghostCancels;

    // V3 settle commitments (any non-zero value).
    bytes32 internal constant HASH_STATE = keccak256("arena-h-final-state");
    bytes32 internal constant HASH_LOG = keccak256("arena-h-turn-log");

    // Deterministic salts so team commit hashes can be reconstructed on reveal.
    function _teamSalt(uint256 battleId, bool isA) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked("arena-h-team", battleId, isA));
    }

    // ─────────── Bootstrap ───────────

    function getBattleArena() external view returns (BattleArena) {
        return battleArena;
    }

    function getClaw() external view returns (ClawToken) {
        return claw;
    }

    function getTeamManager() external view returns (TeamManager) {
        return teamMgr;
    }

    function getLobsterNFT() external view returns (LobsterNFT) {
        return nft;
    }

    function battleIdsLength() external view returns (uint256) {
        return battleIds.length;
    }

    function actors() external view returns (address alice_, address bob_, address dev_, address sink_, address funder_) {
        return (aliceH, bobH, devWallet, sinkH, funderH);
    }

    constructor() {
        setUp();

        _giveClaw(aliceH, PLAYER_FUNDS);
        _giveClaw(bobH, PLAYER_FUNDS);
        _giveClaw(funderH, FUNDER_FUNDS);
        ghostAlice = PLAYER_FUNDS;
        ghostBob = PLAYER_FUNDS;
        ghostFunder = FUNDER_FUNDS;
        initialSupply = claw.totalSupply();

        vm.startPrank(admin);
        battleArena.grantRole(battleArena.MATCHMAKER_ROLE(), address(this));
        battleArena.grantRole(battleArena.RESOLVER_ROLE(), address(this));
        battleArena.grantRole(battleArena.GUARDIAN_ROLE(), guardianH);
        vm.stopPrank();

        vm.prank(funderH);
        claw.approve(address(battleArena), type(uint256).max);
    }

    // ─────────── Helpers ───────────

    function _getOrCreateEvolvedTeam(address owner, uint256 battleIdForSalt, bool isA)
        internal
        returns (uint256 teamId)
    {
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
        for (uint256 i = 0; i < 3; i++) {
            power += nft.getEvolutionTier(t.lobsterIds[i]);
        }
    }

    function poolLength(bool isA) external view returns (uint256) {
        return isA ? poolA.length : poolB.length;
    }

    function _pickBattleId(uint256 seed) internal view returns (uint256 battleId) {
        uint256 n = battleIds.length;
        if (n == 0) return 0;
        battleId = battleIds[seed % n];
    }

    /// @dev Half the time (high seed bit clear) pick the first battle, scanning from seed % n, that is
    ///      in `phase` — so the review / freeze / expiry handlers mostly hit a battle they can act on;
    ///      otherwise (or if none is in that phase) a uniformly random battle, to exercise wrong-phase
    ///      calls too.
    function _pickInPhase(uint256 seed, BattleArena.BattlePhase phase) internal view returns (uint256) {
        uint256 n = battleIds.length;
        if (n == 0) return 0;
        if ((seed >> 255) == 0) {
            for (uint256 k = 0; k < n; k++) {
                uint256 id = battleIds[(seed + k) % n];
                if (battleArena.getBattle(id).phase == phase) return id;
            }
        }
        return battleIds[seed % n];
    }

    function _ag(uint256 stake) internal view returns (uint256) {
        return stake * battleArena.ANTI_GRIEF_BPS() / battleArena.BPS_DENOMINATOR();
    }

    function _battleEscrow(BattleArena.Battle memory b) internal view returns (uint256 e) {
        uint256 per = b.stakeAmount + _ag(b.stakeAmount);
        if (b.depositA) e += per;
        if (b.depositB) e += per;
    }

    // ─────────── Model ───────────

    function _pay(address to, uint256 amount) internal {
        if (to == aliceH) ghostAlice += amount;
        else if (to == bobH) ghostBob += amount;
    }

    /// @dev One Treasury.processFee call: 85% burned (rounded down), the remainder to dev.
    function _fee(uint256 amount) internal {
        if (amount == 0) return;
        uint256 burn = amount * 8500 / 10_000;
        ghostBurned += burn;
        ghostDev += amount - burn;
    }

    /// @dev Cancel with optional slashes (deposit timeout, stale battle, emergency, reveal timeout).
    function _modelCancel(BattleArena.Battle memory b, bool slashA, bool slashB) internal {
        uint256 ag = _ag(b.stakeAmount);
        _fee((slashA ? ag : 0) + (slashB ? ag : 0));
        if (b.depositA) _pay(b.playerA, b.stakeAmount + (slashA ? 0 : ag));
        if (b.depositB) _pay(b.playerB, b.stakeAmount + (slashB ? 0 : ag));
        ghostEscrow -= _battleEscrow(b);
        ghostCancels++;
    }

    function _modelRevealTimeout(BattleArena.Battle memory b) internal {
        _modelCancel(b, b.accusedA && !b.openedA, b.accusedB && !b.openedB);
    }

    /// @dev finalize / handleTimeout in review / resolveFrozen with a result.
    function _modelPayout(BattleArena.Battle memory b, address winner, address forfeiter) internal {
        uint256 s = b.stakeAmount;
        uint256 ag = _ag(s);
        if (winner == address(0)) {
            uint256 side = s * 1000 / 10_000;
            _fee(side * 2);
            _pay(b.playerA, s - side + ag);
            _pay(b.playerB, s - side + ag);
            ghostDraws++;
        } else {
            address loser = winner == b.playerA ? b.playerB : b.playerA;
            uint256 pot = 2 * s;
            uint256 pfee = pot * 1000 / 10_000;
            bool slash = forfeiter == loser;
            _fee(pfee + (slash ? ag : 0));
            _pay(winner, pot - pfee + ag);
            if (!slash) _pay(loser, ag);
            else ghostForfeitSlashes++;
        }
        ghostEscrow -= 2 * (s + ag);
    }

    function _modelRefundBoth(BattleArena.Battle memory b) internal {
        uint256 back = b.stakeAmount + _ag(b.stakeAmount);
        _pay(b.playerA, back);
        _pay(b.playerB, back);
        ghostEscrow -= 2 * back;
    }

    /// @dev Long-stop expiry: if the reserve covers 2·stake, the held stakes are burned and the
    ///      reserve pays them back; otherwise the held stakes are returned. Either way both players
    ///      get stake + 5%, and the battle's whole escrow leaves.
    function _modelExpire(BattleArena.Battle memory b) internal {
        uint256 s = b.stakeAmount;
        if (ghostReserve >= 2 * s) {
            ghostReserve -= 2 * s;
            ghostBurned += 2 * s;
            ghostExpiryBurns++;
        }
        _modelRefundBoth(b);
        ghostExpiries++;
    }

    /// @dev Apply the model for whatever handleTimeout does in phase `b.phase`.
    function _modelTimeout(BattleArena.Battle memory b) internal {
        BattleArena.BattlePhase p = b.phase;
        if (p == BattleArena.BattlePhase.Deposit || p == BattleArena.BattlePhase.Active) {
            _modelCancel(b, false, false);
        } else if (p == BattleArena.BattlePhase.TeamReveal) {
            _modelRevealTimeout(b);
        } else if (p == BattleArena.BattlePhase.AwaitingFinalize) {
            _modelPayout(b, b.proposedWinner, b.proposedForfeiter);
            ghostFinalizes++;
        } else if (p == BattleArena.BattlePhase.Frozen) {
            _modelExpire(b);
        }
    }

    function _timeoutDeadline(BattleArena.Battle memory b) internal view returns (uint256) {
        if (b.phase == BattleArena.BattlePhase.AwaitingFinalize) return b.payoutDeadline;
        if (b.phase == BattleArena.BattlePhase.Frozen) return uint256(b.frozenAt) + battleArena.FREEZE_LONG_STOP();
        return b.phaseDeadline;
    }

    function _getBattle(uint256 battleId) internal view returns (BattleArena.Battle memory) {
        return battleArena.getBattle(battleId);
    }

    // ─────────── Handlers ───────────

    /// @dev Create a new battle and deposit both sides (each deposit commits its pool team).
    function handler_createAndDeposit(uint8 stakeIdx, uint256 teamSeed) external {
        stakeIdx = uint8(stakeIdx % 3);
        uint256 stake = battleArena.stakeFor(stakeIdx);

        // D-31: pick each side's team FIRST and record its Power truthfully at match time.
        uint256 teamA = _poolTeam(aliceH, true, teamSeed);
        uint256 teamB = _poolTeam(bobH, false, teamSeed >> 8);
        uint8 pA = teamPower(teamA);
        uint8 pB = teamPower(teamB);

        try battleArena.createBattle(aliceH, bobH, stakeIdx, pA, pB) returns (uint256 battleId) {
            battleIds.push(battleId);
            teamIdsA[battleId] = teamA;
            teamIdsB[battleId] = teamB;

            uint256 total = stake + _ag(stake);
            bytes32 hashA = keccak256(abi.encodePacked(battleId, aliceH, teamA, _teamSalt(battleId, true)));
            bytes32 hashB = keccak256(abi.encodePacked(battleId, bobH, teamB, _teamSalt(battleId, false)));
            // D-08: each side consents to exactly this stake and the opponent's real Power.
            _tryDeposit(battleId, aliceH, total, stake, pB, hashA);
            _tryDeposit(battleId, bobH, total, stake, pA, hashB);
        } catch {}
    }

    function _tryDeposit(uint256 battleId, address who, uint256 total, uint256 stake, uint8 oppPower, bytes32 h)
        internal
    {
        try this._deposit(battleId, who, total, stake, oppPower, h) {
            ghostEscrow += total;
            if (who == aliceH) ghostAlice -= total;
            else ghostBob -= total;
        } catch {
            ghostUnexpected++; // a fresh battle with matching consent must accept both deposits
        }
    }

    /// @dev External so internal try/catch works cleanly.
    function _deposit(uint256 battleId, address who, uint256 total, uint256 stake, uint8 oppPower, bytes32 h)
        external
    {
        require(msg.sender == address(this), "handler-only");
        vm.startPrank(who);
        claw.approve(address(battleArena), total);
        // Stop the prank on BOTH paths: a revert would otherwise leave it running into the next
        // handler call (cheatcode state is not rolled back with the reverted frame).
        try battleArena.deposit(battleId, stake, oppPower, h) {
            vm.stopPrank();
        } catch (bytes memory err) {
            vm.stopPrank();
            assembly {
                revert(add(err, 32), mload(err))
            }
        }
    }

    /// @dev D-08: a deposit whose consent does not match must revert and move nothing.
    function handler_depositMismatch(uint8 stakeIdx, uint256 seed) external {
        stakeIdx = uint8(stakeIdx % 3);
        uint256 stake = battleArena.stakeFor(stakeIdx);
        uint256 teamA = _poolTeam(aliceH, true, seed);
        uint256 teamB = _poolTeam(bobH, false, seed >> 8);
        uint8 pB = teamPower(teamB);
        try battleArena.createBattle(aliceH, bobH, stakeIdx, teamPower(teamA), pB) returns (uint256 battleId) {
            battleIds.push(battleId);
            teamIdsA[battleId] = teamA;
            teamIdsB[battleId] = teamB;
            bool wrongStake = (seed & 1) == 0;
            uint256 expectedStake = wrongStake ? stake + 1 : stake;
            uint8 maxPower = wrongStake ? pB : pB - 1; // pB >= 3, so pB - 1 is a real "weaker" ceiling
            try this._deposit(battleId, aliceH, stake + _ag(stake), expectedStake, maxPower, bytes32(uint256(1))) {
                ghostUnexpected++;
                ghostEscrow += stake + _ag(stake); // keep the model in step so the cause is visible
                ghostAlice -= stake + _ag(stake);
            } catch {}
        } catch {}
    }

    function handler_revealTeams(uint256 seed) external {
        uint256 battleId = _pickInPhase(seed, BattleArena.BattlePhase.TeamReveal);
        if (battleId == 0) return;
        if (teamIdsA[battleId] == 0 || teamIdsB[battleId] == 0) return;

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

    /// @dev D-14: the resolver accuses one side; that side may open its own commit.
    function handler_accuseRevealFailure(uint256 seed, bool sideA, bool open) external {
        uint256 battleId = _pickInPhase(seed, BattleArena.BattlePhase.TeamReveal);
        if (battleId == 0) return;
        address who = sideA ? aliceH : bobH;
        try battleArena.accuseRevealFailure(battleId, who) {} catch {}
        if (!open) return;
        uint256 teamId = sideA ? teamIdsA[battleId] : teamIdsB[battleId];
        vm.prank(who);
        try battleArena.openOwnCommit(battleId, teamId, _teamSalt(battleId, sideA)) {} catch {}
    }

    /// @dev D-31: match -> deposit (+commit) -> reveal in ONE call so several battles stay live.
    function handler_openBattle(uint8 stakeIdx, uint256 teamSeed) external {
        uint256 before = battleIds.length;
        this.handler_createAndDeposit(stakeIdx, teamSeed);
        if (battleIds.length == before) return;
        this.handler_revealTeams(battleIds.length - 1);
    }

    /// @dev D-31: evolve one lobster of a pool team that is NOT in a battle.
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

    /// @dev Stands in for RepairShop so the pool stays usable.
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

    /// @dev outcome % 3 -> alice wins / bob wins / draw (address(0)).
    function _outcomeWinner(uint8 outcome) internal view returns (address) {
        uint8 o = outcome % 3;
        if (o == 0) return aliceH;
        if (o == 1) return bobH;
        return address(0);
    }

    /// @dev A valid forfeiter for `winner`: the loser if `forfeit`, else nobody (draws never have one).
    function _forfeiterFor(address winner, bool forfeit) internal view returns (address) {
        if (!forfeit || winner == address(0)) return address(0);
        return winner == aliceH ? bobH : aliceH;
    }

    function handler_settle(uint256 seed, uint8 outcome, bool forfeit) external {
        uint256 battleId = _pickInPhase(seed, BattleArena.BattlePhase.Active);
        if (battleId == 0) return;
        address winner = _outcomeWinner(outcome);
        BattleArena.Battle memory pre = _getBattle(battleId);
        bool mustSucceed = pre.phase == BattleArena.BattlePhase.Active && block.timestamp <= pre.phaseDeadline;

        try battleArena.settle(
            battleId,
            winner,
            HASH_STATE,
            HASH_LOG,
            [uint8(5), 5, 5],
            [uint8(20), 20, 20],
            SEED_SECRET,
            _forfeiterFor(winner, forfeit)
        ) {
            ghostSettles++;
            if (!mustSucceed) ghostUnexpected++;
        } catch {
            if (mustSucceed) ghostUnexpected++;
        }
    }

    function handler_finalize(uint256 seed) external {
        uint256 battleId = _pickInPhase(seed, BattleArena.BattlePhase.AwaitingFinalize);
        if (battleId == 0) return;
        BattleArena.Battle memory pre = _getBattle(battleId);
        bool mustSucceed = pre.phase == BattleArena.BattlePhase.AwaitingFinalize && block.timestamp > pre.payoutDeadline;
        try battleArena.finalizeBattle(battleId) {
            if (!mustSucceed) {
                ghostUnexpected++;
                return;
            }
            _modelPayout(pre, pre.proposedWinner, pre.proposedForfeiter);
            ghostFinalizes++;
        } catch {
            if (mustSucceed) ghostUnexpected++;
        }
    }

    /// @dev The watchdog freezes a result under review (guardian, or the Safe when `byAdmin`).
    function handler_freeze(uint256 seed, bool byAdmin) external {
        uint256 battleId = _pickInPhase(seed, BattleArena.BattlePhase.AwaitingFinalize);
        if (battleId == 0) return;
        BattleArena.Battle memory pre = _getBattle(battleId);
        bool allowed = pre.phase == BattleArena.BattlePhase.AwaitingFinalize && block.timestamp <= pre.payoutDeadline;
        vm.prank(byAdmin ? admin : guardianH);
        try battleArena.freeze(battleId) {
            ghostFreezes++;
            if (!allowed) ghostFreezeViolations++;
        } catch {
            if (allowed) ghostUnexpected++;
        }
    }

    /// @dev A stranger can never freeze.
    function handler_freezeByStranger(uint256 seed) external {
        uint256 battleId = _pickBattleId(seed);
        if (battleId == 0) return;
        vm.prank(sinkH);
        try battleArena.freeze(battleId) {
            ghostFreezeViolations++;
        } catch {}
    }

    /// @dev The Safe resolves a frozen battle: a random valid result, or refund both.
    function handler_resolveFrozen(uint256 seed, uint8 outcome, bool forfeit, bool refundBoth) external {
        uint256 battleId = _pickInPhase(seed, BattleArena.BattlePhase.Frozen);
        if (battleId == 0) return;
        BattleArena.Battle memory pre = _getBattle(battleId);
        bool mustSucceed = pre.phase == BattleArena.BattlePhase.Frozen;
        address winner = _outcomeWinner(outcome);
        address forfeiter = _forfeiterFor(winner, forfeit);
        vm.prank(admin);
        try battleArena.resolveFrozen(battleId, winner, forfeiter, refundBoth) {
            if (!mustSucceed) {
                ghostUnexpected++;
                return;
            }
            if (refundBoth) _modelRefundBoth(pre);
            else _modelPayout(pre, winner, forfeiter);
            ghostResolves++;
        } catch {
            if (mustSucceed) ghostUnexpected++;
        }
    }

    /// @dev Past the 72 h long-stop anyone can expire a frozen battle. Warps there first.
    function handler_expireFrozen(uint256 seed) external {
        uint256 battleId = _pickInPhase(seed, BattleArena.BattlePhase.Frozen);
        if (battleId == 0) return;
        BattleArena.Battle memory pre = _getBattle(battleId);
        if (pre.phase == BattleArena.BattlePhase.Frozen) {
            uint256 at = uint256(pre.frozenAt) + battleArena.FREEZE_LONG_STOP() + 1;
            if (block.timestamp < at) vm.warp(at);
        }
        bool mustSucceed = pre.phase == BattleArena.BattlePhase.Frozen;
        vm.prank(sinkH);
        try battleArena.expireFrozen(battleId) {
            if (!mustSucceed) {
                ghostUnexpected++;
                return;
            }
            _modelExpire(pre);
        } catch {
            if (mustSucceed) ghostUnexpected++;
        }
    }

    function handler_fundReserve(uint256 amount) external {
        amount = bound(amount, 0, 150_000e18);
        if (amount > ghostFunder) return;
        vm.prank(funderH);
        try battleArena.fundReserve(amount) {
            ghostReserve += amount;
            ghostFunder -= amount;
        } catch {
            ghostUnexpected++;
        }
    }

    /// @dev The Safe withdraws from the reserve; `overdraw` aims just past it, which must revert.
    function handler_withdrawReserve(uint256 amount, bool overdraw) external {
        amount = overdraw ? ghostReserve + 1 + (amount % 1e18) : bound(amount, 0, ghostReserve);
        bool mustSucceed = amount <= ghostReserve;
        vm.prank(admin);
        try battleArena.withdrawReserve(sinkH, amount) {
            if (!mustSucceed) {
                ghostUnexpected++;
                return;
            }
            ghostReserve -= amount;
            ghostSink += amount;
        } catch {
            if (mustSucceed) ghostUnexpected++;
        }
    }

    function handler_handleTimeout(uint256 seed) external {
        uint256 battleId = _pickBattleId(seed);
        if (battleId == 0) return;
        BattleArena.Battle memory pre = _getBattle(battleId);
        bool terminal = pre.phase == BattleArena.BattlePhase.Settled || pre.phase == BattleArena.BattlePhase.Cancelled;
        bool mustSucceed = !terminal && block.timestamp > _timeoutDeadline(pre);
        try battleArena.handleTimeout(battleId) {
            if (!mustSucceed) {
                ghostUnexpected++;
                return;
            }
            _modelTimeout(pre);
        } catch {
            if (mustSucceed) ghostUnexpected++;
        }
    }

    function handler_emergencyWithdraw(uint256 seed, bool byAlice) external {
        uint256 battleId = _pickInPhase(seed, BattleArena.BattlePhase.Active);
        if (battleId == 0) return;
        BattleArena.Battle memory pre = _getBattle(battleId);
        bool mustSucceed = pre.phase == BattleArena.BattlePhase.Active
            && block.timestamp >= pre.lastProgressAt + battleArena.EMERGENCY_WITHDRAW_DELAY();
        vm.prank(byAlice ? aliceH : bobH);
        try battleArena.emergencyWithdraw(battleId) {
            if (!mustSucceed) {
                ghostUnexpected++;
                return;
            }
            _modelCancel(pre, false, false);
        } catch {
            if (mustSucceed) ghostUnexpected++;
        }
    }

    /// @dev Move wall-clock forward so phase / review / long-stop deadlines can pass.
    function handler_warp(uint256 delta) external {
        delta = bound(delta, 1, 6 hours);
        vm.warp(block.timestamp + delta);
    }
}
