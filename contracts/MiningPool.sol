// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {GoldToken} from "./GoldToken.sol";
import {LobsterNFT} from "./LobsterNFT.sol";
import {TeamManager} from "./TeamManager.sol";
import {IPauseSwitch} from "./PauseSwitch.sol";

/// @title MiningPool — Glide-pegged per-expedition rewards with seasonal budget cap for Clawbada
/// @notice Manages expeditions across Base/Evolved/Elite/Apex mines. Each expedition earns
///         a fixed reward = baseReward × tierWeight, locked at start. Season has a total
///         emission cap. TOK-G1: baseReward auto-glides every hourly epoch —
///         target = remainingBudget / (remainingEpochs × demand per epoch), where demand is the
///         average of the last DEMAND_WINDOW epochs (D-C), clamped to ±30% per epoch and capped at
///         the season's launch reward — so crowding compresses per-team yield smoothly instead of
///         exhausting the budget mid-season. Demand is
///         measured on-chain as tier-weight units served per epoch. setBaseReward remains as
///         an emergency admin override on top of the glide.
///         Battle-rank mining boost (S1, locked 2026-09-02): a team's weekly battle-ladder
///         percentile grants +10%..+50% on that team's own mining income. The boost table is
///         computed off-chain and posted per weekly epoch by BOOST_ADMIN_ROLE; it is applied
///         to the base reward at expedition start and counted as glide demand, so the extra
///         spend is paid from the same season budget (no separate carve).
/// @dev Admin calls startSeason(totalEmission, baseReward) each season. Rewards are minted into
///      MiningPool escrow at expedition start and transferred to the user at claim time. This
///      ensures startExpedition() fails immediately if GoldToken.MAX_SUPPLY headroom is insufficient,
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
        uint256 baseReward; // $GOLD per Base expedition (×tierWeight for higher tiers)
        uint256 startTime;
        uint256 totalMinted; // tracks budget allocated and minted into escrow this season
        uint256 launchBaseReward; // TOK-G1: glide cap — reward never re-pegs above this
        uint256 lastRepegEpoch; // epoch index of the last glide re-peg
        uint256 epochWeightServed; // tier-weight units × BPS_DENOMINATOR served this epoch (boost-scaled)
        uint256 trailingWeightServed; // D-C: average tier-weight units per epoch over the last DEMAND_WINDOW closed epochs
        uint256 epochMinted; // $GOLD minted this epoch (reset at the re-peg) — the spend ceiling's counter
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
    // TOK-G1 glide parameters (D-19, 2026-10-02): an HOURLY re-peg, damped to ±30% per epoch, plus a
    // per-epoch spend ceiling. A daily re-peg could not track a crowd: the launch rate is sized for
    // ~800 teams, and at -30% a day it took nine days to reach the rate 20,000 teams can sustain —
    // during which they mined at 5-25x it (15,000 teams on a 7-day ramp spent 38% of the season in
    // week one; 20,000 arriving on day one drained it by day four). Hourly epochs let the rate find
    // the crowd within hours; the ceiling bounds what any single epoch can mint whatever the rate is
    // doing. Modelled in packages/game-logic/src/v3/season-glide.ts
    // (docs/audits/2026-10-02-d19-glide-simulation.md): with both, the contract tracks the ideal glide
    // within 1-2% in every scenario, including 30,000 teams arriving in one day.
    uint256 public constant REPEG_EPOCH = 1 hours;
    uint256 public constant REPEG_MAX_STEP_BPS = 3_000;
    /// @notice D-C (review 2026-10-03): the demand the glide paces against is the average of the
    ///         last DEMAND_WINDOW epochs — one expedition cycle (4 h) — not the last epoch that had
    ///         any. The single-epoch rule read a population that starts everything in one hour of
    ///         four as four times its size (and nothing between), so the rate under-paid and sawed;
    ///         a day-long window tracked a surge too slowly. Epochs nobody touched count as quiet.
    ///         Modelled in packages/game-logic/src/v3/season-glide.ts, section 4 of the D-19 report.
    uint256 public constant DEMAND_WINDOW = 4;
    /// @notice D-E: hourly epochs per season-day — the stake reference is re-sampled when `epoch / 24` changes.
    uint256 public constant EPOCHS_PER_DAY = 24;
    /// @notice D-D: a new season's launch reward may not exceed this multiple of the previous
    ///         season's, and an emergency override may not exceed it of the current season's —
    ///         a mistyped startSeason / setBaseReward (a missing e18, an extra zero) reverts instead
    ///         of paying a season out in hours.
    uint256 public constant MAX_BASE_REWARD_STEP_X = 3;
    /// @notice An epoch may mint at most this share (bps) of its fair slice of the budget left:
    ///         20,000 = twice `left / epochsLeft`.
    uint256 public constant EPOCH_SPEND_CAP_BPS = 20_000;
    // TOK-M1: hard on-chain lifetime cap on cumulative mining emissions = the 705M
    // (70.5%) fair-launch allocation. Without this, the budget is enforced only by
    // per-season admin discipline (`startSeason` totalEmission), and Treasury burns
    // reopen GoldToken's MAX_SUPPLY headroom — so mining could mint past 705M (the
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
    GoldToken public goldToken;
    LobsterNFT public lobsterNFT;
    TeamManager public teamManager;
    /// @dev PAUSE-I1: the protocol's emergency stop; gates only the money-in entry points of this contract.
    IPauseSwitch public immutable pauseSwitch;

    uint256 public currentSeason;
    mapping(uint256 => SeasonConfig) private _seasons;
    /// @dev D-C: per season, tier-weight units served in each of the last DEMAND_WINDOW closed
    ///      epochs (slot = epoch % DEMAND_WINDOW). `trailingWeightServed` publishes the average.
    // slither-disable-next-line uninitialized-state — a mapping has no initializer; it is written through the `ring` storage pointer in _repegIfNeeded, and an all-zero ring is the correct "no demand seen yet" state.
    mapping(uint256 => uint256[DEMAND_WINDOW]) private _servedRing;

    // TOK-M1: cumulative mining emissions across ALL seasons (gross minted). Mirrors
    // season.totalMinted's semantics — admin-released/burned rewards stay counted, so
    // the cap is a hard ceiling on gross mining mint, never exceeding 705M.
    uint256 public lifetimeMinted;
    /// @notice D-E (review 2026-10-03): the battle-stake reference rate — this season's base reward
    ///         sampled once per season-day (at the first re-peg after a day boundary), continuous
    ///         across seasons. BattleArena.stakeFor() pegs the stake brackets to it, damped by a
    ///         fixed share anchored to the genesis reward, so stakes follow the mining economy day by
    ///         day without the hourly jitter and without ever collapsing. 0 until a season starts.
    uint256 public stakeReference;

    uint256 public nextExpeditionId = 1;
    mapping(uint256 => Expedition) private _expeditions;
    mapping(uint256 => uint256) private _teamToExpedition; // active expedition (0 = none)

    // Battle-rank boost table, keyed by epoch then team. `currentBoostEpoch == 0` means no epoch
    // has ever been activated; entries are staged for `currentBoostEpoch + 1` and become live on
    // activateBoostEpoch.
    // D-09: one slot per team was shared by the live and the staged epoch, so staging next
    // week's ladder overwrote every re-posted team's LIVE entry and they mined with no boost
    // until activation. Per-epoch rows make staging invisible to the live epoch and an amend
    // invisible to the staged one. Old epochs are never read again and need no clearing.
    mapping(uint32 => mapping(uint256 => TeamBoost)) private _teamBoost;
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

    /// @notice I11: every epoch roll — the demand estimate the new epoch paces against and its
    ///         spend ceiling (hourly at most, ≤ 1,440 a season).
    event EpochRolled(uint256 indexed season, uint256 epoch, uint256 trailingWeight, uint256 cap);
    /// @notice D-E: the daily stake reference was re-sampled (a season start, or the first re-peg of a new season-day).
    event StakeReferenceUpdated(uint256 indexed season, uint256 epoch, uint256 oldReference, uint256 newReference);

    // ──────────── Errors ────────────
    error ZeroAddress();
    error SeasonNotActive();
    error SeasonStillActive();
    error ZeroEmission();
    error ZeroBaseReward();
    /// @dev D-D: the season's budget could not pay even one Base expedition (a missing e18?).
    error SeasonBudgetTooSmall(uint256 totalEmission, uint256 baseReward);
    /// @dev D-D: the base reward exceeds what the budget left or the step limit allows.
    error BaseRewardTooHigh(uint256 baseReward, uint256 limit);
    error SeasonBudgetExhausted();
    error MiningAllocationExhausted();
    /// @dev D-19: this epoch has minted its ceiling; the expedition can start at `nextEpochAt`.
    error EpochBudgetFull(uint256 nextEpochAt);
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

    /// @dev PAUSE-I1: money-IN entry points only — every exit always works (see PauseSwitch.sol).
    modifier whenNotPaused() {
        // Reverted HERE (not bubbled from the switch) so ProtocolPaused is in this contract's ABI.
        if (pauseSwitch.paused()) revert IPauseSwitch.ProtocolPaused();
        _;
    }

    /// @param admin The DEFAULT_ADMIN_ROLE holder
    /// @param goldToken_ The GoldToken contract
    /// @param lobsterNFT_ The LobsterNFT contract
    /// @param teamManager_ The TeamManager contract
    /// @param pauseSwitch_ The protocol PauseSwitch (gates startExpedition only)
    constructor(address admin, address goldToken_, address lobsterNFT_, address teamManager_, address pauseSwitch_) {
        if (
            admin == address(0) || goldToken_ == address(0) || lobsterNFT_ == address(0) || teamManager_ == address(0)
                || pauseSwitch_ == address(0)
        ) {
            revert ZeroAddress();
        }
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        goldToken = GoldToken(goldToken_);
        lobsterNFT = LobsterNFT(lobsterNFT_);
        teamManager = TeamManager(teamManager_);
        pauseSwitch = IPauseSwitch(pauseSwitch_);
    }

    // ──────────── Season Management ────────────

    /// @notice Start the next season with a given total emission budget and base reward.
    /// @param totalEmission Total $GOLD budget for this season
    /// @param baseReward $GOLD per Base expedition (multiplied by tier weight for higher tiers)
    function startSeason(uint256 totalEmission, uint256 baseReward) external onlyRole(SEASON_ADMIN_ROLE) {
        if (totalEmission == 0) revert ZeroEmission();
        if (baseReward == 0) revert ZeroBaseReward();
        // D-20: a season's budget is bounded by what is left of the 705M lifetime allocation. The
        // schedule's nominal figure overshoots it in the final season; clamping (the effective
        // number is in SeasonStarted) keeps the glide pacing against real budget instead of
        // stopping mid-season at the lifetime cap — the cliff TOK-G1 exists to remove.
        uint256 allocationLeft = MINING_ALLOCATION > lifetimeMinted ? MINING_ALLOCATION - lifetimeMinted : 0;
        if (allocationLeft == 0) revert MiningAllocationExhausted();
        if (totalEmission > allocationLeft) totalEmission = allocationLeft;

        // If a season is active, it must have ended
        if (currentSeason > 0) {
            SeasonConfig storage current = _seasons[currentSeason];
            if (block.timestamp < current.startTime + SEASON_DURATION) revert SeasonStillActive();
            // D-D: a launch reward more than MAX_BASE_REWARD_STEP_X the previous season's is a typo,
            // not a decision (the engine proposes min(2 × closing rate, genesis)).
            uint256 stepLimit = current.launchBaseReward * MAX_BASE_REWARD_STEP_X;
            if (baseReward > stepLimit) revert BaseRewardTooHigh(baseReward, stepLimit);
        }
        // D-D: a budget that cannot pay one Base expedition is a mistyped amount, not a season.
        if (totalEmission < baseReward) revert SeasonBudgetTooSmall(totalEmission, baseReward);

        currentSeason++;
        _seasons[currentSeason] = SeasonConfig({
            totalEmission: totalEmission,
            baseReward: baseReward,
            startTime: block.timestamp,
            totalMinted: 0,
            launchBaseReward: baseReward,
            lastRepegEpoch: 0,
            epochWeightServed: 0,
            trailingWeightServed: 0,
            epochMinted: 0
        });

        emit SeasonStarted(currentSeason, totalEmission, baseReward, block.timestamp);
        // D-E: the very first season seeds the stake reference; later seasons keep yesterday's sample
        // (continuity — a new season's launch reward must not jump the stakes on day one).
        if (stakeReference == 0) {
            emit StakeReferenceUpdated(currentSeason, 0, 0, baseReward);
            stakeReference = baseReward;
        }
    }

    /// @notice Emergency admin override of the glide-pegged base reward. Only affects future
    ///         expeditions; the hourly glide keeps re-pegging from the new value (still capped
    ///         at the season's launch reward). D-D: bounded by what the budget can still pay and
    ///         by MAX_BASE_REWARD_STEP_X the season's launch reward.
    /// @param newBaseReward New $GOLD per Base expedition
    function setBaseReward(uint256 newBaseReward) external onlyRole(SEASON_ADMIN_ROLE) {
        if (newBaseReward == 0) revert ZeroBaseReward();
        _requireActiveSeason();

        SeasonConfig storage season = _seasons[currentSeason];
        uint256 limit = season.launchBaseReward * MAX_BASE_REWARD_STEP_X;
        uint256 left = _budgetLeft(season);
        if (left < limit) limit = left;
        if (newBaseReward > limit) revert BaseRewardTooHigh(newBaseReward, limit);
        uint256 oldBaseReward = season.baseReward;
        season.baseReward = newBaseReward;

        emit BaseRewardUpdated(currentSeason, oldBaseReward, newBaseReward);
    }

    // ──────────── Expedition Management ────────────

    /// @notice Start a mining expedition with a team at a given mine tier.
    /// @param teamId The team to send mining
    /// @param mineTier The mine tier (0=Base, 1=Evolved, 2=Elite, 3=Apex)
    /// @return expeditionId The ID of the started expedition
    // slither-disable-next-line reentrancy-no-eth,divide-before-multiply — nonReentrant; goldToken.mint is to the trusted GoldToken and the expedition write follows the mint. divide-before-multiply is deliberate: the boost is applied to the base BEFORE the tier multiply so the locked reward stays an exact tier-weight multiple (invariant I-4); the truncation is < 1 wei per weight unit on 1e18-scale rewards.
    function startExpedition(uint256 teamId, uint8 mineTier)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 expeditionId)
    {
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
        uint256 reward = _boostedBase(season.baseReward, boostBps) * TIER_WEIGHTS[mineTier];

        if (season.totalMinted + reward > season.totalEmission) revert SeasonBudgetExhausted();
        // TOK-M1: enforce the 705M lifetime mining allocation on-chain.
        if (lifetimeMinted + reward > MINING_ALLOCATION) revert MiningAllocationExhausted();
        // D-19: the per-epoch spend ceiling. Whatever the rate is doing, no epoch mints more than
        // EPOCH_SPEND_CAP_BPS of its fair slice of what is left — the backstop that keeps a surge
        // the glide has not caught up with yet from draining the season. The expedition can start
        // in the next epoch, by which time the glide has seen this one's demand.
        if (season.epochMinted + reward > _epochSpendCap(season)) revert EpochBudgetFull(_nextEpochAt(season));
        season.epochMinted += reward;
        season.totalMinted += reward;
        lifetimeMinted += reward;

        // Mint reward into escrow now — reverts with ExceedsMaxSupply if global cap insufficient
        goldToken.mint(address(this), reward);

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

        // Transfer escrowed reward to claimer (I-04 SafeERC20; goldToken is
        // typed as GoldToken for the .mint() call, so cast at the boundary).
        IERC20(address(goldToken)).safeTransfer(msg.sender, expedition.reward);

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
        goldToken.burn(expedition.reward);

        emit ExpeditionAdminReleased(expeditionId, expedition.teamId, expedition.reward);
    }

    // ──────────── Battle-Rank Boost (S1) ────────────

    /// @notice Post (or amend) boost entries for a boost epoch. `epoch` must be the live epoch
    ///         (amend — e.g. after a dispute correction) or the next one (stage). Entries are
    ///         pure storage writes into that epoch's own rows: staging never touches what the
    ///         live epoch pays, and amending never touches what has been staged. A team that is
    ///         not re-posted for the next epoch drops to 0 the moment that epoch activates (the
    ///         "lapse" rule needs no clearing writes).
    /// @param epoch Boost epoch the entries belong to (>= 1)
    /// @param entries Up to MAX_BOOST_BATCH rows of (teamId, bps <= MAX_BOOST_BPS, power)
    function setTeamBoosts(uint32 epoch, BoostEntry[] calldata entries) external onlyRole(BOOST_ADMIN_ROLE) {
        uint32 current = currentBoostEpoch;
        if (epoch == 0 || (epoch != current && epoch != current + 1)) revert InvalidBoostEpoch(epoch, current);
        if (entries.length > MAX_BOOST_BATCH) revert BatchTooLarge(entries.length, MAX_BOOST_BATCH);
        for (uint256 i = 0; i < entries.length; i++) {
            BoostEntry calldata e = entries[i];
            if (e.bps > MAX_BOOST_BPS) revert BoostTooHigh(e.teamId, e.bps);
            _teamBoost[epoch][e.teamId] = TeamBoost({epoch: epoch, bps: e.bps, power: e.power});
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

    /// @notice Raw stored boost entry for a team in the LIVE epoch (epoch, bps, power) — for
    ///         indexers and ops. All-zero when the team has no entry in the live epoch.
    function getTeamBoost(uint256 teamId) external view returns (TeamBoost memory) {
        return _teamBoost[currentBoostEpoch][teamId];
    }

    /// @notice Raw stored boost entry for a team in a specific epoch — e.g. `currentBoostEpoch + 1`
    ///         to check what has been staged before activating it.
    function getTeamBoostAt(uint32 epoch, uint256 teamId) external view returns (TeamBoost memory) {
        return _teamBoost[epoch][teamId];
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

    /// @notice Get total $GOLD reserved/minted for a season.
    function getSeasonMinted(uint256 season) external view returns (uint256) {
        return _seasons[season].totalMinted;
    }

    /// @notice Get remaining unspent budget for a season.
    function getSeasonUnspent(uint256 season) external view returns (uint256) {
        SeasonConfig storage s = _seasons[season];
        if (s.totalMinted >= s.totalEmission) return 0;
        return s.totalEmission - s.totalMinted;
    }

    /// @notice Permissionless: roll the glide's re-peg forward (once per epoch) without starting an expedition.
    function repeg() external {
        _requireActiveSeason();
        _repegIfNeeded(_seasons[currentSeason]);
    }

    /// @notice Current baseReward of the latest season (last value once the season has ended).
    ///         May lag one epoch behind the pending re-peg; call repeg() to actualize.
    function currentBaseReward() external view returns (uint256) {
        return _seasons[currentSeason].baseReward;
    }

    /// @notice D-19: this epoch's spend ceiling, what has been minted against it so far, and when
    ///         the next epoch opens — so a client can say "the mine is full until HH:MM" instead of
    ///         sending a transaction that reverts `EpochBudgetFull`.
    function epochBudget() external view returns (uint256 cap, uint256 minted, uint256 nextEpochAt) {
        SeasonConfig storage season = _seasons[currentSeason];
        // L4: nothing can start without a season, or once the season's 60 days are over.
        if (currentSeason == 0 || block.timestamp >= season.startTime + SEASON_DURATION) return (0, 0, 0);
        uint256 epoch = (block.timestamp - season.startTime) / REPEG_EPOCH;
        // The counter is reset lazily at the first touch of an epoch: until then it still holds the
        // last touched epoch's figure, which no longer applies. (Epochs only move forward, so
        // "a later epoch than the last touched one" is "not the same epoch".)
        minted = epoch > season.lastRepegEpoch ? 0 : season.epochMinted;
        cap = _epochSpendCapFrom(season, epoch, minted);
        nextEpochAt = season.startTime + (epoch + 1) * REPEG_EPOCH;
    }

    // ──────────── Internal ────────────

    /// @dev What is left to pace against: the season's budget, or the 705M allocation if less of it
    ///      remains (D-20).
    function _budgetLeft(SeasonConfig storage season) internal view returns (uint256 left) {
        left = season.totalEmission > season.totalMinted ? season.totalEmission - season.totalMinted : 0;
        uint256 allocationLeft = MINING_ALLOCATION > lifetimeMinted ? MINING_ALLOCATION - lifetimeMinted : 0;
        if (allocationLeft < left) left = allocationLeft;
    }

    function _nextEpochAt(SeasonConfig storage season) internal view returns (uint256) {
        return season.startTime + ((block.timestamp - season.startTime) / REPEG_EPOCH + 1) * REPEG_EPOCH;
    }

    /// @dev D-19: the current epoch's spend ceiling (see _epochSpendCapFrom). Called after
    ///      _repegIfNeeded, so `epochMinted` is this epoch's.
    function _epochSpendCap(SeasonConfig storage season) internal view returns (uint256) {
        return _epochSpendCapFrom(season, (block.timestamp - season.startTime) / REPEG_EPOCH, season.epochMinted);
    }

    /// @dev EPOCH_SPEND_CAP_BPS of this epoch's fair slice of the budget as it stood when the epoch
    ///      began (what is left now plus what this epoch has already minted), paced over the epochs
    ///      left INCLUDING this one — but never less than one expedition of the heaviest tier at the
    ///      highest boost. That floor is what keeps the ceiling from deadlocking the glide: the rate
    ///      only moves on a demand signal, so at least one expedition must always be able to start.
    function _epochSpendCapFrom(SeasonConfig storage season, uint256 epoch, uint256 mintedThisEpoch)
        internal
        view
        returns (uint256 cap)
    {
        uint256 totalEpochs = SEASON_DURATION / REPEG_EPOCH;
        uint256 epochsLeft = epoch >= totalEpochs ? 1 : totalEpochs - epoch;
        uint256 atEpochStart = _budgetLeft(season) + mintedThisEpoch;
        cap = (atEpochStart * EPOCH_SPEND_CAP_BPS) / (BPS_DENOMINATOR * epochsLeft);
        // The same arithmetic as the reward itself, so the floor IS one real expedition.
        uint256 oneMaxExpedition = _boostedBase(season.baseReward, MAX_BOOST_BPS) * TIER_WEIGHTS[NUM_TIERS - 1];
        if (cap < oneMaxExpedition) cap = oneMaxExpedition;
    }

    /// @dev The base reward with a battle-rank boost applied. Rounded here, BEFORE the tier
    ///      weight is applied by the caller, on purpose: a reward stays an exact tier-weight
    ///      multiple (`invariant_rewardIsTierWeightMultiple`), which the boost math and the
    ///      glide's demand accounting both rely on.
    function _boostedBase(uint256 base, uint16 boostBps) internal pure returns (uint256) {
        return (base * (BPS_DENOMINATOR + boostBps)) / BPS_DENOMINATOR;
    }

    /// @dev TOK-G1 glide: once per epoch, re-peg baseReward toward
    ///      remaining / (remainingEpochs × demand per epoch), clamped to ±30% per step and
    ///      capped at launchBaseReward. Lazy single-step per touched epoch: after quiet gaps
    ///      the reward converges over subsequent epochs rather than jumping.
    ///      D-C: the demand estimate is the average over the last DEMAND_WINDOW closed epochs.
    ///      Untouched epochs are quiet ones: a gap inside the window zeroes their slots (at most
    ///      DEMAND_WINDOW − 1 of them), a gap longer than the window leaves nothing recent at all —
    ///      no demand signal → hold the current reward, as before the first expedition.
    // slither-disable-next-line divide-before-multiply,incorrect-equality — remainingEpochs is an integer epoch count by design (the glide paces over whole hourly epochs); the strict equalities compare integer epoch indices and unit counters (never balances), where exact equality is the correct test.
    function _repegIfNeeded(SeasonConfig storage season) internal {
        uint256 epoch = (block.timestamp - season.startTime) / REPEG_EPOCH;
        uint256 last = season.lastRepegEpoch;
        if (epoch == last) return;

        uint256[DEMAND_WINDOW] storage ring = _servedRing[currentSeason];
        if (epoch - last > DEMAND_WINDOW) {
            // Every slot is older than the window: the whole ring is stale.
            for (uint256 i = 0; i < DEMAND_WINDOW; i++) ring[i] = 0;
        } else {
            // epochWeightServed is boost-scaled (units × BPS_DENOMINATOR); the ring keeps plain
            // tier-weight units so the target formula and the events keep their semantics.
            ring[last % DEMAND_WINDOW] = season.epochWeightServed / BPS_DENOMINATOR;
            for (uint256 e = last + 1; e < epoch; e++) ring[e % DEMAND_WINDOW] = 0; // skipped = quiet
        }
        season.epochWeightServed = 0;
        season.epochMinted = 0; // D-19: the spend ceiling counts per epoch
        season.lastRepegEpoch = epoch;

        uint256 windowSum = 0;
        for (uint256 i = 0; i < DEMAND_WINDOW; i++) windowSum += ring[i];
        // The season's first epochs: average over the epochs that have closed so far.
        uint256 filled = epoch < DEMAND_WINDOW ? epoch : DEMAND_WINDOW;
        uint256 trailing = windowSum / filled;
        season.trailingWeightServed = trailing;
        if (windowSum > 0) _glideStep(season, epoch, windowSum, filled, trailing);
        emit EpochRolled(currentSeason, epoch, trailing, _epochSpendCapFrom(season, epoch, 0));
        // D-E: crossing a season-day boundary (24 hourly epochs) re-samples the stake reference from
        // the rate this hour opened at — after the step, so a day's stakes follow the rate the day's
        // first expedition pays. Lazy like the glide itself: the sample lands on the day's first touch.
        if (epoch / EPOCHS_PER_DAY != last / EPOCHS_PER_DAY && season.baseReward != stakeReference) {
            emit StakeReferenceUpdated(currentSeason, epoch, stakeReference, season.baseReward);
            stakeReference = season.baseReward;
        }
    }

    /// @dev One glide step for the epoch just opened. `windowSum` units over `filled` epochs is the
    ///      demand estimate; the target uses the sum (not the floored average) so a small
    ///      population still moves the rate.
    // slither-disable-next-line divide-before-multiply
    function _glideStep(SeasonConfig storage season, uint256 epoch, uint256 windowSum, uint256 filled, uint256 trailing)
        internal
    {
        // D-18: count this epoch. This runs on the first touch of epoch k, with (total - k) epochs
        // still to pay for INCLUDING this one. The old `(SEASON_DURATION - elapsed) / epoch` floored
        // one short, so a crowded season was paced over one epoch too few, ran dry early and nobody
        // could mine in the last one — and it was right only in the single boundary second, so one
        // block could pick a rate up to 30% away from the next. This is constant across the epoch
        // and matches the model the glide was validated against (season-glide.ts: epochsLeft).
        uint256 totalEpochs = SEASON_DURATION / REPEG_EPOCH;
        uint256 remainingEpochs = epoch >= totalEpochs ? 1 : totalEpochs - epoch;
        // D-20: never pace against budget that cannot be minted (the 705M allocation if less is left).
        uint256 remaining = _budgetLeft(season);
        // D-19(c): an exhausted budget is not a demand signal. Re-pegging toward a target of ~zero
        // would walk baseReward down 30% an epoch to 1 wei, and RepairShop prices — basis points of
        // baseReward — with it, so anyone could call repeg() to make repairs free for the rest of
        // the season. Expeditions are discrete, so an exhausted season normally keeps a remainder
        // smaller than one reward (the #99 fix held only at exactly zero): hold the last real rate
        // whenever less than one Base expedition is left, since nothing can be started anyway.
        if (remaining < season.baseReward) return;
        uint256 target = (remaining * filled) / (remainingEpochs * windowSum);

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
        TeamBoost storage b = _teamBoost[epoch][teamId];
        if (b.epoch != epoch || b.power != power) return 0; // b.epoch == 0 → no entry this epoch
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
