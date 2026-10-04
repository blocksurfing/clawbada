// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../helpers/BaseSetup.t.sol";
import {stdStorage, StdStorage} from "forge-std/Test.sol";

/// @title FuzzMiningGlideTest
/// @notice Audit 2026-09 D-30, extended for D-19 (2026-10-02). The glide (TOK-G1) sets every
///         miner's reward AND, through the peg, every repair price — and it was tested by five
///         hand-picked examples that covered only the -30% clamp and the launch cap. Never
///         executed by any test: the upward step, the in-band step (next == target), the last
///         epoch of the season, the dust floor, several quiet epochs in a row (stale trailing
///         demand carried forward), and the floor division of boost-scaled demand.
///
///         D-19 made the epoch hourly and added a per-epoch spend ceiling (no epoch mints more
///         than twice its fair share of what is left, never less than one expedition of the
///         heaviest tier at the highest boost) and a hold whenever less than one Base reward is
///         left. All three are in the model below.
///
///         This drives the REAL contract through fuzzed multi-day scenarios — demand that
///         rises and falls, boosted teams, admin overrides, quiet gaps, the ceiling, the
///         season's end — and after every action compares it with an independently written
///         reference model, plus the properties that must hold whatever the model says.
contract FuzzMiningGlideTest is BaseSetup {
    using stdStorage for StdStorage;

    uint256 internal constant TEAMS = 8;
    uint256 internal constant STEPS = 7;
    uint256 internal constant BPS = 10_000;

    uint256[] internal teams;
    uint256[] internal openExpeditions;
    mapping(uint256 => uint16) internal boostOf; // teamId => bps posted in boost epoch 1
    uint256 internal boostActivatedAt;

    uint256 internal constant WINDOW = 4; // MiningPool.DEMAND_WINDOW

    /// @dev The reference model's whole state — nothing is read back from the contract.
    struct Model {
        uint256 emission;
        uint256 minted;
        uint256 base;
        uint256 launch;
        uint256 start;
        uint256 lastEpoch;
        uint256 servedBps; // this epoch's demand, in tier-weight units x 10_000 (boost-scaled)
        uint256 trailing; // D-C: average units per epoch over the window (floored) — what the event reports
        uint256 epochMinted; // minted this epoch, against the ceiling
        uint256[WINDOW] ring; // D-C: units served in each of the last WINDOW closed epochs (slot = epoch % WINDOW)
    }

    Model internal m;

    // Branch coverage, asserted by the reachability tests at the bottom.
    uint256 internal sawUp;
    uint256 internal sawDown;
    uint256 internal sawInBand;
    uint256 internal sawCap;
    uint256 internal sawHoldNoDemand;
    uint256 internal sawHoldExhausted;
    uint256 internal sawLastEpoch;
    uint256 internal sawCeiling;

    function setUp() public override {
        super.setUp();
        // 8 all-Apex teams for one miner: any mine tier is open, so demand per expedition
        // spans the full 1 / 3 / 10 / 25 weight range.
        address miner = makeAddr("glideMiner");
        for (uint256 t = 0; t < TEAMS; t++) {
            uint256[3] memory ids;
            for (uint256 i = 0; i < 3; i++) {
                ids[i] = _mintLobster(miner, uint8((t + i) % 10));
                vm.prank(admin);
                nft.setEvolutionTier(ids[i], 3);
            }
            vm.prank(miner);
            teams.push(teamMgr.createTeam(ids));
        }
    }

    // ───────────────────────── the reference model ─────────────────────────

    function _weight(uint8 tier) internal pure returns (uint256) {
        return tier == 0 ? 1 : tier == 1 ? 3 : tier == 2 ? 10 : 25;
    }

    function _min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a < b ? a : b;
    }

    function _max(uint256 a, uint256 b) internal pure returns (uint256) {
        return a > b ? a : b;
    }

    function _epochLen() internal view returns (uint256) {
        return miningPool.REPEG_EPOCH();
    }

    function _epochsLeft(uint256 epoch) internal view returns (uint256) {
        uint256 total = miningPool.SEASON_DURATION() / _epochLen();
        return epoch >= total ? 1 : total - epoch;
    }

    /// @dev What is left to pace against: the season's budget, or the 705M allocation if less
    ///      of it remains (D-20).
    function _left() internal view returns (uint256 left) {
        left = m.emission > m.minted ? m.emission - m.minted : 0;
        left = _min(left, miningPool.MINING_ALLOCATION() - miningPool.lifetimeMinted());
    }

    /// @dev One lazy re-peg, as specified: at most once per epoch; the epoch just closed goes into
    ///      the demand ring, epochs nobody touched count as quiet (a gap longer than the window
    ///      leaves nothing recent: hold); pace what is left over the epochs left INCLUDING this one
    ///      against the window's average demand; move at most 30% a step; never above launch;
    ///      never to zero; hold whenever less than one Base reward is left (D-19c).
    function _modelRepeg(uint256 nowTs) internal {
        uint256 epoch = (nowTs - m.start) / _epochLen();
        if (epoch == m.lastEpoch) return;
        if (epoch - m.lastEpoch > WINDOW) {
            for (uint256 i = 0; i < WINDOW; i++) m.ring[i] = 0;
        } else {
            m.ring[m.lastEpoch % WINDOW] = m.servedBps / BPS;
            for (uint256 e = m.lastEpoch + 1; e < epoch; e++) m.ring[e % WINDOW] = 0;
        }
        m.servedBps = 0;
        m.epochMinted = 0;
        m.lastEpoch = epoch;
        uint256 windowSum;
        for (uint256 i = 0; i < WINDOW; i++) windowSum += m.ring[i];
        uint256 filled = epoch < WINDOW ? epoch : WINDOW;
        m.trailing = windowSum / filled;
        if (windowSum == 0) {
            sawHoldNoDemand++;
            return;
        }

        uint256 epochsLeft = _epochsLeft(epoch);
        if (epochsLeft == 1) sawLastEpoch++;
        uint256 left = _left();
        if (left < m.base) {
            sawHoldExhausted++;
            return;
        }

        uint256 target = (left * filled) / (epochsLeft * windowSum);
        uint256 lo = (m.base * 7_000) / BPS;
        uint256 hi = (m.base * 13_000) / BPS;
        uint256 next = _max(1, _min(m.launch, _min(hi, _max(lo, target))));

        if (next > m.base) sawUp++;
        if (next < m.base) sawDown++;
        if (next == target && next != m.base) sawInBand++;
        if (next == m.launch && target > m.launch) sawCap++;
        m.base = next;
    }

    /// @dev D-19: this epoch's spend ceiling — twice the fair share of the budget as it stood
    ///      when the epoch began, over the epochs left including this one, but never less than
    ///      one Apex expedition at +50%. Valid after _modelRepeg (m.lastEpoch is this epoch).
    function _modelCap() internal view returns (uint256 cap) {
        cap = ((_left() + m.epochMinted) * 20_000) / (BPS * _epochsLeft(m.lastEpoch));
        uint256 oneMax = ((m.base * (BPS + 5_000)) / BPS) * 25;
        if (cap < oneMax) cap = oneMax;
    }

    function _boostNow(uint256 teamId) internal view returns (uint256) {
        if (boostActivatedAt == 0 || block.timestamp >= boostActivatedAt + 10 days) return 0;
        return boostOf[teamId];
    }

    // ───────────────────────── driving the contract ─────────────────────────

    function _claimMatured() internal {
        uint256 i = 0;
        while (i < openExpeditions.length) {
            MiningPool.Expedition memory e = miningPool.getExpedition(openExpeditions[i]);
            if (block.timestamp >= e.startTime + 4 hours) {
                vm.prank(e.owner);
                miningPool.claimExpedition(openExpeditions[i]);
                openExpeditions[i] = openExpeditions[openExpeditions.length - 1];
                openExpeditions.pop();
            } else {
                i++;
            }
        }
    }

    /// @dev Start one expedition and check reward + base against the model. Returns false when
    ///      the model says the budget or this epoch's ceiling cannot cover it (and asserts the
    ///      contract agrees, with the same error).
    function _start(uint256 teamIdx, uint8 tier) internal returns (bool) {
        uint256 teamId = teams[teamIdx];
        if (teamMgr.isTeamActive(teamId)) return true;
        address owner = teamMgr.getTeam(teamId).owner;

        uint256 oldBase = m.base;
        Model memory before = m;
        _modelRepeg(block.timestamp);
        uint256 bps = _boostNow(teamId);
        uint256 reward = ((m.base * (BPS + bps)) / BPS) * _weight(tier);

        if (m.minted + reward > m.emission) {
            vm.prank(owner);
            vm.expectRevert(MiningPool.SeasonBudgetExhausted.selector);
            miningPool.startExpedition(teamId, tier);
            // The lazy re-peg ran INSIDE the reverted call, so the contract rolled it back: the
            // epoch is still un-pegged and the next touch will do it. The model must agree.
            m = before;
            return false;
        }
        if (m.epochMinted + reward > _modelCap()) {
            uint256 nextEpochAt = m.start + (m.lastEpoch + 1) * _epochLen();
            vm.prank(owner);
            vm.expectRevert(abi.encodeWithSelector(MiningPool.EpochBudgetFull.selector, nextEpochAt));
            miningPool.startExpedition(teamId, tier);
            m = before; // same rollback: the refused call re-pegged nothing
            sawCeiling++;
            return false;
        }

        vm.prank(owner);
        uint256 expeditionId = miningPool.startExpedition(teamId, tier);
        openExpeditions.push(expeditionId);
        m.servedBps += _weight(tier) * (BPS + bps);
        m.minted += reward;
        m.epochMinted += reward;

        assertEq(miningPool.getExpedition(expeditionId).reward, reward, "locked reward != model");
        _checkStep(oldBase);
        return true;
    }

    /// @dev Contract == model, and the properties that must hold regardless of any model.
    function _checkStep(uint256 oldBase) internal view {
        uint256 base = miningPool.currentBaseReward();
        assertEq(base, m.base, "baseReward != reference model");
        assertGe(base, 1, "glide must never reach zero (dust floor)");
        if (oldBase <= m.launch) {
            assertLe(base, m.launch, "glide must never exceed the launch reward");
            assertGe(base, (oldBase * 7_000) / BPS, "one step fell by more than 30%");
            assertLe(base, _max(1, (oldBase * 13_000) / BPS), "one step rose by more than 30%");
        } else {
            // An admin override above launch is pulled back to launch by the next re-peg.
            assertLe(base, oldBase, "override above launch must not grow");
        }
        MiningPool.SeasonConfig memory cfg = miningPool.getSeasonConfig(1);
        assertEq(cfg.totalMinted, m.minted, "season totalMinted != model");
        assertEq(cfg.epochMinted, m.epochMinted, "epochMinted != model");
    }

    function _begin(uint256 emission, uint256 base) internal {
        vm.prank(admin);
        miningPool.startSeason(emission, base);
        m = Model({
            emission: emission,
            minted: 0,
            base: base,
            launch: base,
            start: block.timestamp,
            lastEpoch: 0,
            servedBps: 0,
            trailing: 0,
            epochMinted: 0,
            ring: [uint256(0), 0, 0, 0]
        });
    }

    function _postBoosts(uint256 seed) internal {
        MiningPool.BoostEntry[] memory entries = new MiningPool.BoostEntry[](TEAMS);
        for (uint256 t = 0; t < TEAMS; t++) {
            // Odd, non-round bps on purpose: (weight x (10_000 + bps)) / 10_000 must FLOOR.
            uint16 bps = uint16((seed >> (t * 16)) % 5_001);
            boostOf[teams[t]] = bps;
            entries[t] = MiningPool.BoostEntry({teamId: teams[t], bps: bps, power: 9});
        }
        vm.startPrank(admin); // BaseSetup: admin holds BOOST_ADMIN_ROLE
        miningPool.setTeamBoosts(1, entries);
        miningPool.activateBoostEpoch(1);
        vm.stopPrank();
        boostActivatedAt = block.timestamp;
    }

    /// @dev One scenario: STEPS visits, each some days apart, each with its own demand.
    function _run(uint256 emission, uint256 base, uint256[STEPS] memory seeds, bool withBoosts) internal {
        _begin(emission, base);
        if (withBoosts) _postBoosts(seeds[0]);

        for (uint256 s = 0; s < STEPS; s++) {
            uint256 seed = seeds[s];
            // 1..12 days on, plus a few hours and minutes so visits do not sit on epoch boundaries.
            vm.warp(
                block.timestamp + ((seed & 0xff) % 12 + 1) * 1 days + ((seed >> 8) % 20) * 1 hours
                    + ((seed >> 4) % 50 + 1) * 1 minutes
            );

            if (block.timestamp >= m.start + miningPool.SEASON_DURATION()) {
                vm.expectRevert(MiningPool.SeasonNotActive.selector);
                miningPool.repeg();
                assertEq(miningPool.currentBaseReward(), m.base, "rate frozen once the season ends");
                return;
            }
            _claimMatured();

            // Sometimes an admin override, up to 3x launch (an "emergency" value). D-D: the
            // contract refuses anything above 3x launch or above what the budget can still pay.
            if ((seed >> 16) % 7 == 0) {
                uint256 forced = bound(seed >> 24, 1, m.launch * 3 + m.launch / 2);
                uint256 limit = _min(m.launch * 3, _left());
                vm.prank(admin);
                if (forced > limit) {
                    vm.expectRevert(abi.encodeWithSelector(MiningPool.BaseRewardTooHigh.selector, forced, limit));
                    miningPool.setBaseReward(forced);
                } else {
                    miningPool.setBaseReward(forced);
                    m.base = forced;
                }
            }

            // Sometimes the permissionless re-peg arrives before any expedition.
            if ((seed >> 32) % 3 == 0) {
                uint256 old = m.base;
                _modelRepeg(block.timestamp);
                miningPool.repeg();
                _checkStep(old);
            }

            uint256 demand = (seed >> 40) % (TEAMS + 1); // 0 = a quiet visit
            for (uint256 k = 0; k < demand; k++) {
                if (!_start(k, uint8((seed >> (48 + k * 2)) % 4))) break;
            }
        }
    }

    // ───────────────────────── fuzz ─────────────────────────

    /// @dev A budget small enough that eight teams' demand moves the glide: 10K .. ~330M CLAW,
    ///      log-spread (a uniform draw would almost always pin the rate to its cap). At the
    ///      small end the hourly ceiling binds on most visits; at the large end it never does.
    function testFuzz_glide_matches_reference_model(uint256 emissionSeed, uint256 baseSeed, uint256[STEPS] memory seeds)
        public
    {
        uint256 emission = 1e22 * (2 ** bound(emissionSeed, 0, 15));
        uint256 base = bound(baseSeed, 1e18, 5_000e18);
        _run(emission, base, seeds, false);
    }

    function testFuzz_glide_with_boosted_demand(uint256 emissionSeed, uint256 baseSeed, uint256[STEPS] memory seeds)
        public
    {
        uint256 emission = 1e22 * (2 ** bound(emissionSeed, 0, 15));
        uint256 base = bound(baseSeed, 1e18, 5_000e18);
        _run(emission, base, seeds, true);
    }

    /// @dev Dust: a launch reward of a few wei. The floor divisions in lo / hi / target all
    ///      collapse here; the rate must stay >= 1 and the model must still match.
    function testFuzz_glide_at_dust_scale(uint256 baseSeed, uint256[STEPS] memory seeds) public {
        _run(1e22, bound(baseSeed, 1, 1_000), seeds, false);
    }

    /// @dev Dust budget AND dust rate: a season of a few thousand wei with a rate of 1..50 wei.
    ///      This is where the target floors to 0 (the dust floor must lift it back to 1), where
    ///      the ceiling's fair share floors to 0 (the one-expedition floor must carry it), and
    ///      where a budget gets spent to a remainder under one reward (the rate must then hold).
    function testFuzz_glide_with_a_dust_budget(uint256 emissionSeed, uint256 baseSeed, uint256[STEPS] memory seeds)
        public
    {
        _run(bound(emissionSeed, 100, 20_000), bound(baseSeed, 1, 50), seeds, false);
    }

    /// @dev D-20: near the end of the 705M allocation the lifetime cap, not the season budget,
    ///      is what is left to pace. Pin lifetimeMinted so only `left` CLAW can ever be minted.
    function testFuzz_glide_paces_against_the_lifetime_cap(uint256 leftSeed, uint256[STEPS] memory seeds) public {
        uint256 left = bound(leftSeed, 5_000e18, 2_000_000e18);
        stdstore.target(address(miningPool)).sig("lifetimeMinted()").checked_write(miningPool.MINING_ALLOCATION() - left);

        _begin(100_000_000e18, 1_250e18); // startSeason clamps the season to `left`
        m.emission = left;
        assertEq(miningPool.getSeasonConfig(1).totalEmission, left, "D-20: season clamped to the allocation left");

        for (uint256 s = 0; s < STEPS; s++) {
            vm.warp(block.timestamp + 1 days + 1 hours + 7 minutes);
            _claimMatured();
            uint256 demand = (seeds[s] >> 40) % (TEAMS + 1);
            for (uint256 k = 0; k < demand; k++) {
                if (!_start(k, uint8((seeds[s] >> (48 + k * 2)) % 4))) break;
            }
        }
        assertLe(miningPool.lifetimeMinted(), miningPool.MINING_ALLOCATION(), "lifetime cap holds");
    }

    // ───────────────────────── the branches, by name ─────────────────────────
    // Deterministic, so a regression names the branch it broke instead of a fuzz counterexample.
    // Budgets are sized so hour 0's ceiling (2 x budget / 1,440) admits the demand the test
    // needs, except where the ceiling is the point.

    function _hour(uint256 n) internal {
        vm.warp(m.start + n * 1 hours + 5 minutes);
        _claimMatured();
    }

    /// @dev Demand collapses after a crowded hour: the rate must climb back, +30% an epoch, and
    ///      stop exactly at the launch reward. D-C: the crowd leaves the window four epochs
    ///      later, so the first touch after it holds (no recent demand) and the climb starts
    ///      from the next real start. Visits four hours apart so the one team reused has matured.
    function test_glide_steps_up_after_demand_falls_and_stops_at_launch() public {
        _begin(150_000_000e18, 1_000e18);
        for (uint256 k = 0; k < TEAMS; k++) _start(k, 3); // hour 0: 8 Apex expeditions = 200 units
        _hour(1);
        miningPool.repeg(); // re-peg: 200 units over the one closed epoch: target ~521 -> clamped to 700
        _modelRepeg(block.timestamp);
        assertEq(m.base, 700e18, "hour 1: -30%");
        assertEq(sawDown, 1);

        _hour(5);
        _start(0, 0); // epochs 2-4 were quiet and epoch 0 left the window: nothing recent -> hold
        assertEq(m.base, 700e18, "hour 5: no demand signal in the window, hold");
        assertEq(sawHoldNoDemand, 1);
        _hour(9);
        _start(0, 0); // the window now holds hour 5's one unit: target is huge -> +30%
        assertEq(m.base, 910e18, "hour 9: +30%");
        _hour(13);
        _start(0, 0);
        assertEq(m.base, 1_000e18, "hour 13: 1,183 would overshoot - capped at launch");
        assertEq(sawUp, 2);
        assertEq(sawCap, 1);
    }

    /// @dev The in-band step: the target lies inside [0.7, 1.3] x old, so next == target exactly.
    function test_glide_in_band_lands_exactly_on_target() public {
        _begin(130_000_000e18, 1_000e18);
        for (uint256 k = 0; k < 4; k++) _start(k, 3); // 100 units, 100,000 CLAW
        _hour(1);
        _start(4, 0);
        // left 129.9M over 1,439 epochs x 100 units = 902.7...; inside [700, 1300] and under launch
        assertEq(m.base, uint256(129_900_000e18) / (1_439 * 100), "next == target");
        assertEq(sawInBand, 1);
    }

    /// @dev D-18: in the last epoch there is exactly one epoch left to pay for — not zero.
    function test_glide_last_epoch_paces_over_one_epoch() public {
        _begin(3_000_000e18, 1_000e18);
        _hour(1_438);
        for (uint256 k = 0; k < 2; k++) _start(k, 3); // epoch 1,438: 50 units (no trailing yet -> hold)
        _hour(1_439);
        _start(2, 0);
        // left = 3M - 50,000 = 2.95M; one epoch left; trailing 50 -> 59,000 -> capped +30% -> launch cap
        assertEq(m.base, 1_000e18);
        assertEq(sawLastEpoch, 1, "the last-epoch branch ran");
    }

    /// @dev D-C: a gap LONGER than the window leaves no recent demand at all — the rate holds
    ///      (as before the first expedition), it does not keep stepping on a stale signal.
    function test_glide_gap_longer_than_the_window_has_no_signal() public {
        _begin(150_000_000e18, 1_000e18);
        for (uint256 k = 0; k < TEAMS; k++) _start(k, 3); // 200 units
        _hour(1);
        miningPool.repeg();
        _modelRepeg(block.timestamp);
        assertEq(miningPool.currentBaseReward(), 700e18);

        _hour(6); // five hours nobody touched the pool: longer than the 4-epoch window
        uint256 old = m.base;
        _modelRepeg(block.timestamp);
        miningPool.repeg();
        _checkStep(old);
        assertEq(m.trailing, 0, "nothing in the window");
        assertEq(m.base, 700e18, "hold: no demand signal");
        assertEq(sawHoldNoDemand, 1);
        assertEq(miningPool.getSeasonConfig(1).trailingWeightServed, 0, "the contract publishes the same estimate");
    }

    /// @dev D-C: a gap INSIDE the window reads the skipped epochs as quiet ones, so a burst is
    ///      averaged over the epochs since — one lazy step, from the window's average.
    function test_glide_gap_inside_the_window_reads_skipped_epochs_as_quiet() public {
        _begin(150_000_000e18, 1_000e18);
        for (uint256 k = 0; k < TEAMS; k++) _start(k, 3); // 200 units in epoch 0
        _hour(1);
        miningPool.repeg();
        _modelRepeg(block.timestamp);
        assertEq(miningPool.currentBaseReward(), 700e18, "epoch 1: 200 units over one closed epoch");

        _hour(3); // epochs 1 and 2 untouched: quiet
        uint256 old = m.base;
        _modelRepeg(block.timestamp);
        miningPool.repeg();
        _checkStep(old);
        assertEq(m.trailing, 66, "200 units over the three closed epochs, floored");
        // 149.8M x 3 / (1,437 epochs x 200 units) = 1,563: above the +30% bound -> 910.
        assertEq(m.base, 910e18, "one step up from the window's average, not a jump");
        assertEq(miningPool.getSeasonConfig(1).trailingWeightServed, 66);
    }

    /// @dev No demand has ever been seen: hold. (Before any expedition the target is undefined.)
    function test_glide_holds_until_there_is_a_demand_signal() public {
        _begin(400_000e18, 1_000e18);
        _hour(3);
        miningPool.repeg();
        _modelRepeg(block.timestamp);
        assertEq(miningPool.currentBaseReward(), 1_000e18);
        assertEq(sawHoldNoDemand, 1);
    }

    /// @dev The dust floor: at a rate of 1 wei the -30% bound floors to 0, and a target of 0
    ///      would set the reward to zero — which would also zero every repair price.
    function test_glide_dust_floor_never_reaches_zero() public {
        _begin(1_000, 1); // 1,000 wei season, 1 wei per Base expedition
        assertTrue(_start(0, 3), "25 units -> 25 wei: exactly the ceiling's one-expedition floor");
        _hour(1);
        uint256 old = m.base;
        _modelRepeg(block.timestamp); // target = 975 / (1,439 * 25) = 0
        miningPool.repeg();
        _checkStep(old);
        assertEq(miningPool.currentBaseReward(), 1, "floored at 1 wei, never 0");
    }

    /// @dev D-19(c): a budget spent to the last wei is not a demand signal. The rate holds, so
    ///      repair prices (basis points of it) do not walk down 30% an epoch to nothing.
    function test_glide_holds_the_rate_once_the_budget_is_gone() public {
        _begin(25_000e18, 1_000e18); // exactly one Apex expedition
        assertTrue(_start(0, 3));
        assertEq(m.minted, m.emission, "spent exactly");

        for (uint256 h = 1; h <= 5; h++) {
            _hour(h);
            uint256 old = m.base;
            _modelRepeg(block.timestamp);
            miningPool.repeg();
            _checkStep(old);
        }
        assertEq(miningPool.currentBaseReward(), 1_000e18, "rate held for five hours at zero budget");
        // D-C: hours 1-4 hold on the exhausted budget; by hour 5 the one start has left the
        // 4-epoch window, so that hold is for no demand. Either way the rate did not move.
        assertEq(sawHoldExhausted, 4);
        assertEq(sawHoldNoDemand, 1);
        assertFalse(_start(1, 0), "and nothing more can be started");
    }

    /// @dev The gap the D-19 simulation found in that fix: it held only at EXACTLY zero, and a
    ///      season normally ends with a remainder smaller than one reward — with which the decay
    ///      went on (1,000 -> 700 -> 490 ...) until a cut-price expedition fitted. Anything under
    ///      one Base reward now holds, since nothing can start anyway.
    function test_glide_holds_the_rate_on_a_dust_remainder() public {
        _begin(25_500e18, 1_000e18); // one Apex expedition and half a Base reward over
        assertTrue(_start(0, 3));
        assertEq(m.emission - m.minted, 500e18, "half a reward left");

        for (uint256 h = 1; h <= 5; h++) {
            _hour(h);
            uint256 old = m.base;
            _modelRepeg(block.timestamp);
            miningPool.repeg();
            _checkStep(old);
        }
        assertEq(miningPool.currentBaseReward(), 1_000e18, "rate held on a dust remainder");
        assertEq(sawHoldExhausted, 4); // and one no-demand hold once the start leaves the window
        assertEq(sawHoldNoDemand, 1);
        assertFalse(_start(1, 0), "a Base expedition does not fit in half a reward");
    }

    /// @dev D-19: the ceiling. 100M over 1,440 epochs, twice the fair share = 138,888 CLAW an
    ///      hour: five Apex expeditions at launch (125,000) fit, the sixth (150,000) is refused
    ///      and names the next epoch — where it starts, at the rate the five pulled down.
    function test_glide_ceiling_binds_then_opens_next_epoch() public {
        _begin(100_000_000e18, 1_000e18);
        for (uint256 k = 0; k < 5; k++) assertTrue(_start(k, 3));
        assertFalse(_start(5, 3), "the sixth crosses the ceiling");
        assertEq(sawCeiling, 1);
        assertEq(m.epochMinted, 125_000e18, "the refused expedition minted nothing");

        _hour(1);
        assertTrue(_start(5, 3), "a new epoch, a fresh counter");
        assertEq(m.base, 700e18, "the re-peg saw 125 units: target ~555 -> clamped to 700");
        assertEq(m.epochMinted, 17_500e18);
    }

    /// @dev Boost-scaled demand is FLOORED to whole tier-weight units: 1 unit at +49.99% is
    ///      14,999 bps-units -> trailing 1, not 2 and not 1.4999.
    function test_glide_boosted_demand_floors_to_whole_units() public {
        _begin(400_000e18, 1_000e18);
        MiningPool.BoostEntry[] memory e = new MiningPool.BoostEntry[](1);
        e[0] = MiningPool.BoostEntry({teamId: teams[0], bps: 4_999, power: 9});
        vm.startPrank(admin);
        miningPool.setTeamBoosts(1, e);
        miningPool.activateBoostEpoch(1);
        vm.stopPrank();
        boostOf[teams[0]] = 4_999;
        boostActivatedAt = block.timestamp;

        _start(0, 0);
        assertEq(m.servedBps, 14_999);
        _hour(1);
        _start(1, 0);
        assertEq(m.trailing, 1, "14,999 / 10,000 floors to 1 unit");
    }
}
