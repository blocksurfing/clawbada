// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ClawToken} from "./ClawToken.sol";
import {LobsterNFT} from "./LobsterNFT.sol";
import {TeamManager} from "./TeamManager.sol";

/// @title MiningPool — Glide-pegged per-expedition rewards with seasonal budget cap for Clawbada
/// @notice Manages expeditions across Base/Evolved/Elite/Apex mines. Each expedition earns
///         a fixed reward = baseReward × tierWeight, locked at start. Season has a total
///         emission cap. TOK-G1: baseReward auto-glides daily —
///         target = remainingBudget / (remainingDays × trailing epoch demand), clamped to
///         ±30% per epoch and capped at the season's launch reward — so crowding compresses
///         per-team yield smoothly instead of exhausting the budget mid-season. Demand is
///         measured on-chain as tier-weight units served per epoch. setBaseReward remains as
///         an emergency admin override on top of the glide.
///         Battle-rank mining boost (S1, locked 2026-09-02): a team's weekly battle-ladder
///         percentile grants +10%..+50% on that team's own mining income. The boost table is
///         computed off-chain and posted per weekly epoch by BOOST_ADMIN_ROLE; it is applied
///         to the base reward at expedition start and counted as glide demand, so the extra
///         spend is paid from the same season budget (no separate carve).
/// @dev Admin calls startSeason(totalEmission, baseReward) each season. Rewards are minted into
///      MiningPool escrow at expedition start and transferred to the user at claim time. This
///      ensures startExpedition() fails immediately if ClawToken.MAX_SUPPLY headroom is insufficient,
///      preventing teams from becoming permanently locked by a later mint failure.
/// @custom:security-contact security@clawbada.com
contract MiningPool is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ──────────── Roles ────────────
    bytes32 public constant SEASON_ADMIN_ROLE = keccak256("SEASON_ADMIN_ROLE");
    /// @dev Hot service key that posts the weekly battle-rank boost table. Deliberately separate
    ///      from SEASON_ADMIN_ROLE (which Handoff.s.sol moves to the governance Safe): the post is
    ///      a routine weekly server action, bounded to MAX_BOOST_BPS per team and to the season
    ///      budget through the glide, not a governance decision.
    bytes32 public constant BOOST_ADMIN_ROLE = keccak256("BOOST_ADMIN_ROLE");

    // ──────────── Types ────────────
    struct Expedition {
        uint256 teamId;
        address owner;
        uint256 season;
        uint8 mineTier; // 0=Base, 1=Evolved, 2=Elite, 3=Apex
        uint256 startTime;
        uint256 reward; // locked at start: baseReward × tierWeight
        bool claimed;
    }

    struct SeasonConfig {
        uint256 totalEmission; // season budget cap
        uint256 baseReward; // $CLAW per Base expedition (×tierWeight for higher tiers)
        uint256 startTime;
        uint256 totalMinted; // tracks budget allocated and minted into escrow this season
        uint256 launchBaseReward; // TOK-G1: glide cap — reward never re-pegs above this
        uint256 lastRepegEpoch; // epoch index of the last glide re-peg
        uint256 epochWeightServed; // tier-weight units × BPS_DENOMINATOR served this epoch (boost-scaled)
        uint256 trailingWeightServed; // tier-weight units served in the last completed epoch with demand
    }

    /// @dev Battle-rank boost entry for one team. Packed into one slot. `epoch` stamps the boost
    ///      epoch the entry was posted for; `power` is the Team Power (sum of the three lobsters'
    ///      evolution tiers, 3..9) the rank was earned at — the boost only applies while the team
    ///      still has that power, which closes rank laundering (earn a rank in a cheap band, then
    ///      evolve and cash it against a higher mine tier).
    struct TeamBoost {
        uint32 epoch;
        uint16 bps;
        uint8 power;
    }

    /// @dev Calldata row for setTeamBoosts.
    struct BoostEntry {
        uint256 teamId;
        uint16 bps;
        uint8 power;
    }

    // ──────────── Constants ────────────
    uint256 public constant EXPEDITION_DURATION = 4 hours;
    uint256 public constant SEASON_DURATION = 60 days;
    uint256 public constant NUM_TIERS = 4;
    uint256 public constant ADMIN_RELEASE_GRACE = 7 days;
    // TOK-G1 glide parameters: daily re-peg, damped to ±30% per epoch.
    uint256 public constant REPEG_EPOCH = 1 days;
    uint256 public constant REPEG_MAX_STEP_BPS = 3_000;
    // TOK-M1: hard on-chain lifetime cap on cumulative mining emissions = the 705M
    // (70.5%) fair-launch allocation. Without this, the budget is enforced only by
    // per-season admin discipline (`startSeason` totalEmission), and Treasury burns
    // reopen ClawToken's MAX_SUPPLY headroom — so mining could mint past 705M (the
    // documented perpetual floor crosses it by ~S8). This makes 705M a true cap.
    uint256 public constant MINING_ALLOCATION = 705_000_000e18;
    // Battle-rank mining boost (S1): +10%..+50% of a team's own mining income, linear in the
    // team's weekly ELO percentile. The curve lives off-chain; the chain enforces the cap.
    uint256 public constant BPS_DENOMINATOR = 10_000;
    uint16 public constant MAX_BOOST_BPS = 5_000;
    // A posted epoch only pays while it is fresh: a 7-day epoch plus 3 days of grace. If the
    // server stops posting, every boost falls to 0 instead of paying a stale ladder forever.
    uint256 public constant BOOST_EPOCH_TTL = 10 days;
    // Bounded calldata batch so a full ladder is posted in a handful of predictable-gas txs.
    uint256 public constant MAX_BOOST_BATCH = 200;

    // ──────────── Immutable Config ────────────
    uint256[4] public TIER_WEIGHTS = [uint256(1), 3, 10, 25];

    // ──────────── State ────────────
    ClawToken public clawToken;
    LobsterNFT public lobsterNFT;
    TeamManager public teamManager;

    uint256 public currentSeason;
    mapping(uint256 => SeasonConfig) private _seasons;

    // TOK-M1: cumulative mining emissions across ALL seasons (gross minted). Mirrors
    // season.totalMinted's semantics — admin-released/burned rewards stay counted, so
    // the cap is a hard ceiling on gross mining mint, never exceeding 705M.
    uint256 public lifetimeMinted;

    uint256 public nextExpeditionId = 1;
    mapping(uint256 => Expedition) private _expeditions;
    mapping(uint256 => uint256) private _teamToExpedition; // active expedition (0 = none)

    // Battle-rank boost table. `currentBoostEpoch == 0` means no epoch has ever been activated;
    // entries are staged for `currentBoostEpoch + 1` and become live on activateBoostEpoch.
    mapping(uint256 => TeamBoost) private _teamBoost;
    uint32 public currentBoostEpoch;
    uint64 public boostEpochActivatedAt;

    // ──────────── Events ────────────
    event SeasonStarted(uint256 indexed season, uint256 totalEmission, uint256 baseReward, uint256 startTime);
    event ExpeditionStarted(
        uint256 indexed expeditionId,
        uint256 indexed teamId,
        address indexed owner,
        uint8 mineTier,
        uint256 reward,
        uint16 boostBps
    );
    event TeamBoostSet(uint32 indexed epoch, uint256 indexed teamId, uint16 bps, uint8 power);
    event BoostEpochActivated(uint32 indexed epoch, uint256 activatedAt);
    event ExpeditionClaimed(uint256 indexed expeditionId, uint256 indexed teamId, address indexed owner, uint256 reward);
    event BaseRewardUpdated(uint256 indexed season, uint256 oldBaseReward, uint256 newBaseReward);
    event BaseRewardRepegged(
        uint256 indexed season, uint256 epoch, uint256 oldBaseReward, uint256 newBaseReward, uint256 trailingWeight
    );

    // ──────────── Errors ────────────
    error ZeroAddress();
    error SeasonNotActive();
    error SeasonStillActive();
    error ZeroEmission();
    error ZeroBaseReward();
    error SeasonBudgetExhausted();
    error MiningAllocationExhausted();
    error TeamDoesNotExist(uint256 teamId);
    error NotTeamOwner(uint256 teamId);
    error TeamAlreadyMining(uint256 teamId);
    error TeamIsActive(uint256 teamId);
    error TierRequirementNotMet(uint256 lobsterId, uint8 requiredTier, uint8 actualTier);
    error InvalidMineTier(uint8 tier);
    error ExpeditionDoesNotExist(uint256 expeditionId);
    error ExpeditionNotComplete(uint256 expeditionId);
    error ExpeditionAlreadyClaimed(uint256 expeditionId);
    error NotExpeditionOwner(uint256 expeditionId);
    error AdminReleaseTooEarly(uint256 expeditionId, uint256 availableAt);
    error BoostTooHigh(uint256 teamId, uint16 bps);
    error InvalidBoostEpoch(uint32 requested, uint32 current);
    error BatchTooLarge(uint256 provided, uint256 max);

    // ──────────── Events (admin) ────────────
    event ExpeditionAdminReleased(uint256 indexed expeditionId, uint256 indexed teamId, uint256 rewardReturned);

    // ──────────── Constructor ────────────

    /// @param admin The DEFAULT_ADMIN_ROLE holder
    /// @param clawToken_ The ClawToken contract
    /// @param lobsterNFT_ The LobsterNFT contract
    /// @param teamManager_ The TeamManager contract
    constructor(address admin, address clawToken_, address lobsterNFT_, address teamManager_) {
        if (admin == address(0) || clawToken_ == address(0) || lobsterNFT_ == address(0) || teamManager_ == address(0))
        {
            revert ZeroAddress();
        }
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        clawToken = ClawToken(clawToken_);
        lobsterNFT = LobsterNFT(lobsterNFT_);
        teamManager = TeamManager(teamManager_);
    }

    // ──────────── Season Management ────────────

    /// @notice Start the next season with a given total emission budget and base reward.
    /// @param totalEmission Total $CLAW budget for this season
    /// @param baseReward $CLAW per Base expedition (multiplied by tier weight for higher tiers)
    function startSeason(uint256 totalEmission, uint256 baseReward) external onlyRole(SEASON_ADMIN_ROLE) {
        if (totalEmission == 0) revert ZeroEmission();
        if (baseReward == 0) revert ZeroBaseReward();

        // If a season is active, it must have ended
        if (currentSeason > 0) {
            SeasonConfig storage current = _seasons[currentSeason];
            if (block.timestamp < current.startTime + SEASON_DURATION) revert SeasonStillActive();
        }

        currentSeason++;
        _seasons[currentSeason] = SeasonConfig({
            totalEmission: totalEmission,
            baseReward: baseReward,
            startTime: block.timestamp,
            totalMinted: 0,
            launchBaseReward: baseReward,
            lastRepegEpoch: 0,
            epochWeightServed: 0,
            trailingWeightServed: 0
        });

        emit SeasonStarted(currentSeason, totalEmission, baseReward, block.timestamp);
    }

    /// @notice Emergency admin override of the glide-pegged base reward. Only affects future
    ///         expeditions; the daily glide keeps re-pegging from the new value (still capped
    ///         at the season's launch reward).
    /// @param newBaseReward New $CLAW per Base expedition
    function setBaseReward(uint256 newBaseReward) external onlyRole(SEASON_ADMIN_ROLE) {
        if (newBaseReward == 0) revert ZeroBaseReward();
        _requireActiveSeason();

        SeasonConfig storage season = _seasons[currentSeason];
        uint256 oldBaseReward = season.baseReward;
        season.baseReward = newBaseReward;

        emit BaseRewardUpdated(currentSeason, oldBaseReward, newBaseReward);
    }

    // ──────────── Expedition Management ────────────

    /// @notice Start a mining expedition with a team at a given mine tier.
    /// @param teamId The team to send mining
    /// @param mineTier The mine tier (0=Base, 1=Evolved, 2=Elite, 3=Apex)
    /// @return expeditionId The ID of the started expedition
    // slither-disable-next-line reentrancy-no-eth,divide-before-multiply — nonReentrant; clawToken.mint is to the trusted ClawToken and the expedition write follows the mint. divide-before-multiply is deliberate: the boost is applied to the base BEFORE the tier multiply so the locked reward stays an exact tier-weight multiple (invariant I-4); the truncation is < 1 wei per weight unit on 1e18-scale rewards.
    function startExpedition(uint256 teamId, uint8 mineTier) external nonReentrant returns (uint256 expeditionId) {
        if (mineTier >= NUM_TIERS) revert InvalidMineTier(mineTier);
        _requireActiveSeason();

        // Validate team
        if (!teamManager.teamExists(teamId)) revert TeamDoesNotExist(teamId);
        TeamManager.Team memory team = teamManager.getTeam(teamId);
        if (team.owner != msg.sender) revert NotTeamOwner(teamId);
        if (team.active) revert TeamIsActive(teamId);
        if (_teamToExpedition[teamId] != 0) revert TeamAlreadyMining(teamId);

        // Validate tier gate: all 3 lobsters must meet minimum tier. The same reads give the
        // team's current Power (sum of tiers), which the boost is bound to.
        uint8 power = 0;
        for (uint256 i = 0; i < 3; i++) {
            uint8 lobTier = lobsterNFT.getEvolutionTier(team.lobsterIds[i]);
            if (lobTier < mineTier) {
                revert TierRequirementNotMet(team.lobsterIds[i], mineTier, lobTier);
            }
            power += lobTier;
        }

        // TOK-G1: glide re-peg (lazy, at most once per epoch), then lock this
        // expedition's reward at the current rate. The battle-rank boost multiplies the base
        // reward BEFORE the tier weight (keeps reward an exact tier-weight multiple) and the
        // boosted weight is credited as demand, so the glide sees the extra spend in both its
        // numerator (remaining budget) and denominator (trailing demand).
        SeasonConfig storage season = _seasons[currentSeason];
        _repegIfNeeded(season);
        uint16 boostBps = _effectiveBoost(teamId, power);
        season.epochWeightServed += TIER_WEIGHTS[mineTier] * (BPS_DENOMINATOR + boostBps);
        uint256 boostedBase = (season.baseReward * (BPS_DENOMINATOR + boostBps)) / BPS_DENOMINATOR;
        uint256 reward = boostedBase * TIER_WEIGHTS[mineTier];

        if (season.totalMinted + reward > season.totalEmission) revert SeasonBudgetExhausted();
        // TOK-M1: enforce the 705M lifetime mining allocation on-chain.
        if (lifetimeMinted + reward > MINING_ALLOCATION) revert MiningAllocationExhausted();
        season.totalMinted += reward;
        lifetimeMinted += reward;

        // Mint reward into escrow now — reverts with ExceedsMaxSupply if global cap insufficient
        clawToken.mint(address(this), reward);

        expeditionId = nextExpeditionId++;
        _expeditions[expeditionId] = Expedition({
            teamId: teamId,
            owner: msg.sender,
            season: currentSeason,
            mineTier: mineTier,
            startTime: block.timestamp,
            reward: reward,
            claimed: false
        });

        _teamToExpedition[teamId] = expeditionId;

        // Mark team as active
        teamManager.setTeamActive(teamId, true);

        emit ExpeditionStarted(expeditionId, teamId, msg.sender, mineTier, reward, boostBps);
    }

    /// @notice Claim rewards from a completed expedition.
    /// @param expeditionId The expedition to claim
    function claimExpedition(uint256 expeditionId) external nonReentrant {
        Expedition storage expedition = _expeditions[expeditionId];
        if (expedition.owner == address(0)) revert ExpeditionDoesNotExist(expeditionId);
        if (expedition.owner != msg.sender) revert NotExpeditionOwner(expeditionId);
        if (expedition.claimed) revert ExpeditionAlreadyClaimed(expeditionId);
        if (block.timestamp < expedition.startTime + EXPEDITION_DURATION) {
            revert ExpeditionNotComplete(expeditionId);
        }

        expedition.claimed = true;

        // Clear active expedition tracking
        _teamToExpedition[expedition.teamId] = 0;

        // Mark team as inactive — but tolerate a deleted team record.
        // M-01 (2026-04-20): under compromised ACTIVITY_ROLE, an attacker could
        // force-unlock the team mid-expedition and the owner could disband it,
        // leaving the expedition permanently stuck because setTeamActive on a
        // non-existent team reverts. Guarding with teamExists keeps the payout
        // path terminal even if the team record is gone.
        if (teamManager.teamExists(expedition.teamId)) {
            teamManager.setTeamActive(expedition.teamId, false);
        }

        // Transfer escrowed reward to claimer (I-04 SafeERC20; clawToken is
        // typed as ClawToken for the .mint() call, so cast at the boundary).
        IERC20(address(clawToken)).safeTransfer(msg.sender, expedition.reward);

        emit ExpeditionClaimed(expeditionId, expedition.teamId, msg.sender, expedition.reward);
    }

    // ──────────── Admin Emergency ────────────

    /// @notice Emergency release a stuck expedition (e.g., owner lost keys).
    /// @dev Only callable by DEFAULT_ADMIN_ROLE after expedition completes + ADMIN_RELEASE_GRACE (7 days).
    ///      Releases the team and burns the escrowed reward (returns to protocol, not claimable).
    ///      This prevents permanent team/lobster lock from key loss.
    /// @param expeditionId The stuck expedition to release
    function adminReleaseExpedition(uint256 expeditionId) external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant {
        Expedition storage expedition = _expeditions[expeditionId];
        if (expedition.owner == address(0)) revert ExpeditionDoesNotExist(expeditionId);
        if (expedition.claimed) revert ExpeditionAlreadyClaimed(expeditionId);

        // Must be well past completion: expedition duration + grace period
        uint256 availableAt = expedition.startTime + EXPEDITION_DURATION + ADMIN_RELEASE_GRACE;
        if (block.timestamp < availableAt) {
            revert AdminReleaseTooEarly(expeditionId, availableAt);
        }

        expedition.claimed = true;
        _teamToExpedition[expedition.teamId] = 0;
        // M-01: same deleted-team tolerance as claimExpedition. Admin release
        // must always terminate even if the team record has been disbanded
        // under a compromised-role path, otherwise the escrowed reward is
        // permanently stuck.
        if (teamManager.teamExists(expedition.teamId)) {
            teamManager.setTeamActive(expedition.teamId, false);
        }

        // Burn the escrowed reward rather than sending to admin
        clawToken.burn(expedition.reward);

        emit ExpeditionAdminReleased(expeditionId, expedition.teamId, expedition.reward);
    }

    // ──────────── Battle-Rank Boost (S1) ────────────

    /// @notice Post (or amend) boost entries for a boost epoch. `epoch` must be the live epoch
    ///         (amend — e.g. after a dispute correction) or the next one (stage). Entries are
    ///         pure storage writes; a team that is not re-posted for the next epoch drops to 0
    ///         the moment that epoch activates (the "lapse" rule needs no clearing writes).
    /// @param epoch Boost epoch the entries belong to (>= 1)
    /// @param entries Up to MAX_BOOST_BATCH rows of (teamId, bps <= MAX_BOOST_BPS, power)
    function setTeamBoosts(uint32 epoch, BoostEntry[] calldata entries) external onlyRole(BOOST_ADMIN_ROLE) {
        uint32 current = currentBoostEpoch;
        if (epoch == 0 || (epoch != current && epoch != current + 1)) revert InvalidBoostEpoch(epoch, current);
        if (entries.length > MAX_BOOST_BATCH) revert BatchTooLarge(entries.length, MAX_BOOST_BATCH);
        for (uint256 i = 0; i < entries.length; i++) {
            BoostEntry calldata e = entries[i];
            if (e.bps > MAX_BOOST_BPS) revert BoostTooHigh(e.teamId, e.bps);
            _teamBoost[e.teamId] = TeamBoost({epoch: epoch, bps: e.bps, power: e.power});
            emit TeamBoostSet(epoch, e.teamId, e.bps, e.power);
        }
    }

    /// @notice Activate the staged boost epoch (must be exactly currentBoostEpoch + 1). Flips the
    ///         whole table in one tx so no team ever sees a half-written epoch, and restarts the
    ///         BOOST_EPOCH_TTL freshness window.
    function activateBoostEpoch(uint32 epoch) external onlyRole(BOOST_ADMIN_ROLE) {
        uint32 current = currentBoostEpoch;
        if (epoch != current + 1) revert InvalidBoostEpoch(epoch, current);
        currentBoostEpoch = epoch;
        boostEpochActivatedAt = uint64(block.timestamp);
        emit BoostEpochActivated(epoch, block.timestamp);
    }

    /// @notice Boost (bps) a team would receive on an expedition started now at Team Power `power`.
    ///         0 when no epoch is live, the live epoch is older than BOOST_EPOCH_TTL, the team's
    ///         entry is for another epoch, or the team's power no longer matches its entry.
    function teamBoostBps(uint256 teamId, uint8 power) external view returns (uint16) {
        return _effectiveBoost(teamId, power);
    }

    /// @notice Raw stored boost entry for a team (epoch, bps, power) — for indexers and ops.
    function getTeamBoost(uint256 teamId) external view returns (TeamBoost memory) {
        return _teamBoost[teamId];
    }

    // ──────────── View Functions ────────────

    /// @notice Get an expedition by ID.
    function getExpedition(uint256 expeditionId) external view returns (Expedition memory) {
        if (_expeditions[expeditionId].owner == address(0)) revert ExpeditionDoesNotExist(expeditionId);
        return _expeditions[expeditionId];
    }

    /// @notice Get the active expedition for a team (0 = none).
    function getActiveExpedition(uint256 teamId) external view returns (uint256) {
        return _teamToExpedition[teamId];
    }

    /// @notice Get the full config for a season.
    function getSeasonConfig(uint256 season) external view returns (SeasonConfig memory) {
        return _seasons[season];
    }

    /// @notice Get total $CLAW reserved/minted for a season.
    function getSeasonMinted(uint256 season) external view returns (uint256) {
        return _seasons[season].totalMinted;
    }

    /// @notice Get remaining unspent budget for a season.
    function getSeasonUnspent(uint256 season) external view returns (uint256) {
        SeasonConfig storage s = _seasons[season];
        if (s.totalMinted >= s.totalEmission) return 0;
        return s.totalEmission - s.totalMinted;
    }

    /// @notice Permissionless: roll the daily glide re-peg forward without starting an expedition.
    function repeg() external {
        _requireActiveSeason();
        _repegIfNeeded(_seasons[currentSeason]);
    }

    /// @notice Current baseReward of the latest season (last value once the season has ended).
    ///         May lag one epoch behind the pending re-peg; call repeg() to actualize.
    function currentBaseReward() external view returns (uint256) {
        return _seasons[currentSeason].baseReward;
    }

    // ──────────── Internal ────────────

    /// @dev TOK-G1 glide: once per epoch, re-peg baseReward toward
    ///      remaining / (remainingDays × trailingWeightServed), clamped to ±30% per step and
    ///      capped at launchBaseReward. Lazy single-step per touched epoch: after quiet gaps
    ///      the reward converges over subsequent epochs rather than jumping. No demand signal
    ///      yet (trailing == 0) → hold the current reward.
    // slither-disable-next-line divide-before-multiply,incorrect-equality — remainingDays is an integer day count by design (the glide is a daily re-peg, so pacing over whole days is the intended semantics); the strict equalities compare integer epoch indices and unit counters (never balances), where exact equality is the correct test.
    function _repegIfNeeded(SeasonConfig storage season) internal {
        uint256 epoch = (block.timestamp - season.startTime) / REPEG_EPOCH;
        if (epoch == season.lastRepegEpoch) return;
        // epochWeightServed is boost-scaled (units × BPS_DENOMINATOR); trailing stays in
        // plain tier-weight units so the target formula and the event keep their semantics.
        if (season.epochWeightServed > 0) season.trailingWeightServed = season.epochWeightServed / BPS_DENOMINATOR;
        season.epochWeightServed = 0;
        season.lastRepegEpoch = epoch;
        uint256 trailing = season.trailingWeightServed;
        if (trailing == 0) return;

        uint256 elapsed = block.timestamp - season.startTime;
        uint256 remainingDays = (SEASON_DURATION - elapsed) / 1 days;
        if (remainingDays == 0) remainingDays = 1;
        uint256 remaining =
            season.totalEmission > season.totalMinted ? season.totalEmission - season.totalMinted : 0;
        uint256 target = remaining / (remainingDays * trailing);

        uint256 old = season.baseReward;
        uint256 lo = (old * (10_000 - REPEG_MAX_STEP_BPS)) / 10_000;
        uint256 hi = (old * (10_000 + REPEG_MAX_STEP_BPS)) / 10_000;
        uint256 next = target < lo ? lo : (target > hi ? hi : target);
        if (next > season.launchBaseReward) next = season.launchBaseReward;
        if (next == 0) next = 1; // dust floor preserves the nonzero-reward invariant
        if (next != old) {
            season.baseReward = next;
            emit BaseRewardRepegged(currentSeason, epoch, old, next, trailing);
        }
    }

    /// @dev Effective boost for a team at its current Power. Pure read; no external calls.
    function _effectiveBoost(uint256 teamId, uint8 power) internal view returns (uint16) {
        uint32 epoch = currentBoostEpoch;
        if (epoch == 0) return 0;
        if (block.timestamp >= uint256(boostEpochActivatedAt) + BOOST_EPOCH_TTL) return 0;
        TeamBoost storage b = _teamBoost[teamId];
        if (b.epoch != epoch || b.power != power) return 0;
        return b.bps;
    }

    function _requireActiveSeason() internal view {
        if (currentSeason == 0) revert SeasonNotActive();
        SeasonConfig storage season = _seasons[currentSeason];
        if (block.timestamp >= season.startTime + SEASON_DURATION) revert SeasonNotActive();
    }

    // ──────────── Overrides ────────────

    function supportsInterface(bytes4 interfaceId) public view override(AccessControl) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
