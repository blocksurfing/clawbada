// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../helpers/BaseSetup.t.sol";
import {stdStorage, StdStorage} from "forge-std/Test.sol";

/// @title FuzzMiningGlideTest
/// @notice Audit 2026-09 D-30. The daily glide (TOK-G1) sets every miner's reward AND, through
///         the peg, every repair price — and it was tested by five hand-picked examples that
///         covered only the -30% clamp and the launch cap. Never executed by any test: the
///         upward step, the in-band step (next == target), the last day of the season, the
///         dust floor, several quiet epochs in a row (stale trailing demand carried forward),
///         and the floor division of boost-scaled demand.
///
///         This drives the REAL contract through fuzzed multi-day scenarios — demand that
///         rises and falls, boosted teams, admin overrides, quiet gaps, the season's end —
///         and after every action compares it with an independently written reference model,
///         plus the properties that must hold whatever the model says.
contract FuzzMiningGlideTest is BaseSetup {
    using stdStorage for StdStorage;

    uint256 internal constant TEAMS = 8;
    uint256 internal constant STEPS = 7;
    uint256 internal constant BPS = 10_000;

    uint256[] internal teams;
    uint256[] internal openExpeditions;
    mapping(uint256 => uint16) internal boostOf; // teamId => bps posted in boost epoch 1
    uint256 internal boostActivatedAt;

    /// @dev The reference model's whole state — nothing is read back from the contract.
    struct Model {
        uint256 emission;
        uint256 minted;
        uint256 base;
        uint256 launch;
        uint256 start;
        uint256 lastEpoch;
        uint256 servedBps; // this epoch's demand, in tier-weight units x 10_000 (boost-scaled)
        uint256 trailing; // last completed epoch WITH demand, in whole tier-weight units
    }

    Model internal m;

    // Branch coverage, asserted by the reachability tests at the bottom.
    uint256 internal sawUp;
    uint256 internal sawDown;
    uint256 internal sawInBand;
    uint256 internal sawCap;
    uint256 internal sawHoldNoDemand;
    uint256 internal sawLastDay;

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

    /// @dev One lazy re-peg, as specified: at most once per day-epoch; yesterday's demand (if
    ///      there was any) becomes the trailing signal; pace what is left over the days left
    ///      INCLUDING today; move at most 30% a step; never above launch; never to zero.
    function _modelRepeg(uint256 nowTs) internal {
        uint256 epoch = (nowTs - m.start) / 1 days;
        if (epoch == m.lastEpoch) return;
        if (m.servedBps > 0) m.trailing = m.servedBps / BPS;
        m.servedBps = 0;
        m.lastEpoch = epoch;
        if (m.trailing == 0) {
            sawHoldNoDemand++;
            return;
        }

        uint256 daysLeft = epoch >= 60 ? 1 : 60 - epoch;
        if (daysLeft == 1) sawLastDay++;
        uint256 left = m.emission > m.minted ? m.emission - m.minted : 0;
        left = _min(left, miningPool.MINING_ALLOCATION() - miningPool.lifetimeMinted());
        if (left == 0) return; // D-19(c): an exhausted budget holds the last real rate

        uint256 target = left / (daysLeft * m.trailing);
        uint256 lo = (m.base * 7_000) / BPS;
        uint256 hi = (m.base * 13_000) / BPS;
        uint256 next = _max(1, _min(m.launch, _min(hi, _max(lo, target))));

        if (next > m.base) sawUp++;
        if (next < m.base) sawDown++;
        if (next == target && next != m.base) sawInBand++;
        if (next == m.launch && target > m.launch) sawCap++;
        m.base = next;
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
    ///      the model says the budget cannot cover it (and asserts the contract agrees).
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

        vm.prank(owner);
        uint256 expeditionId = miningPool.startExpedition(teamId, tier);
        openExpeditions.push(expeditionId);
        m.servedBps += _weight(tier) * (BPS + bps);
        m.minted += reward;

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
        assertEq(miningPool.getSeasonConfig(1).totalMinted, m.minted, "season totalMinted != model");
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
            trailing: 0
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
            // 1..12 days on, plus a few hours so visits do not sit on epoch boundaries.
            vm.warp(block.timestamp + ((seed & 0xff) % 12 + 1) * 1 days + ((seed >> 8) % 20) * 1 hours);

            if (block.timestamp >= m.start + 60 days) {
                vm.expectRevert(MiningPool.SeasonNotActive.selector);
                miningPool.repeg();
                assertEq(miningPool.currentBaseReward(), m.base, "rate frozen once the season ends");
                return;
            }
            _claimMatured();

            // Sometimes an admin override, up to 3x launch (an "emergency" value).
            if ((seed >> 16) % 7 == 0) {
                uint256 forced = bound(seed >> 24, 1, m.launch * 3);
                vm.prank(admin);
                miningPool.setBaseReward(forced);
                m.base = forced;
            }

            // Sometimes the permissionless re-peg arrives before any expedition.
            if ((seed >> 32) % 3 == 0) {
                uint256 old = m.base;
                _modelRepeg(block.timestamp);
                miningPool.repeg();
                _checkStep(old);
            }

            uint256 demand = (seed >> 40) % (TEAMS + 1); // 0 = a quiet day
            for (uint256 k = 0; k < demand; k++) {
                if (!_start(k, uint8((seed >> (48 + k * 2)) % 4))) break;
            }
        }
    }

    // ───────────────────────── fuzz ─────────────────────────

    /// @dev A budget small enough that eight teams' demand moves the glide: 10K .. ~330M CLAW,
    ///      log-spread (a uniform draw would almost always pin the rate to its cap).
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
    ///      This is where the target floors to 0 (the dust floor must lift it back to 1) and
    ///      where a budget gets spent EXACTLY (the rate must then hold, D-19c).
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
            vm.warp(block.timestamp + 1 days + 1 hours);
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

    function _day(uint256 n) internal {
        vm.warp(m.start + n * 1 days + 1 hours);
        _claimMatured();
    }

    /// @dev Demand collapses after a crowded day: the rate must climb back, +30% a day, and
    ///      stop exactly at the launch reward.
    function test_glide_steps_up_after_demand_falls_and_stops_at_launch() public {
        _begin(400_000e18, 1_000e18);
        for (uint256 k = 0; k < TEAMS; k++) _start(k, 3); // day 0: 8 Apex expeditions = 200 units
        _day(1);
        _start(0, 0); // re-peg: target 200K/(59*200) ~ 16.9 -> clamped to 700
        assertEq(m.base, 700e18, "day 1: -30%");
        assertEq(sawDown, 1);

        _day(2);
        _start(0, 0); // trailing is now 1 unit: target is huge -> +30%
        assertEq(m.base, 910e18, "day 2: +30%");
        _day(3);
        _start(0, 0);
        assertEq(m.base, 1_000e18, "day 3: 1,183 would overshoot - capped at launch");
        assertEq(sawUp, 2);
        assertEq(sawCap, 1);
    }

    /// @dev The in-band step: the target lies inside [0.7, 1.3] x old, so next == target exactly.
    function test_glide_in_band_lands_exactly_on_target() public {
        _begin(5_900_000e18, 1_000e18);
        for (uint256 k = 0; k < 4; k++) _start(k, 3); // 100 units, 100,000 CLAW
        _day(1);
        _start(4, 0);
        // left 5.8M over 59 days x 100 units = 983.05...; inside [700, 1300]
        assertEq(m.base, uint256(5_800_000e18) / (59 * 100), "next == target");
        assertEq(sawInBand, 1);
    }

    /// @dev D-18: on the last day there is exactly one day left to pay for — not zero.
    function test_glide_last_day_paces_over_one_day() public {
        _begin(3_000_000e18, 1_000e18);
        _day(58);
        for (uint256 k = 0; k < 2; k++) _start(k, 3); // day 58: 50 units (no trailing yet -> hold)
        _day(59);
        _start(2, 0);
        // left = 3M - 50,000 = 2.95M; days left 1; trailing 50 -> 59,000 -> capped +30% -> launch cap
        assertEq(m.base, 1_000e18);
        assertEq(sawLastDay, 1, "the last-day branch ran");
    }

    /// @dev Quiet epochs carry the last REAL demand forward; they are not read as zero demand.
    function test_glide_quiet_gap_keeps_the_last_demand_signal() public {
        _begin(400_000e18, 1_000e18);
        for (uint256 k = 0; k < TEAMS; k++) _start(k, 3); // 200 units
        _day(1);
        miningPool.repeg();
        _modelRepeg(block.timestamp);
        assertEq(miningPool.currentBaseReward(), 700e18);

        _day(6); // five days nobody touched the pool
        uint256 old = m.base;
        _modelRepeg(block.timestamp);
        miningPool.repeg();
        _checkStep(old);
        assertEq(m.trailing, 200, "trailing demand is still the last day that had any");
        assertEq(m.base, 490e18, "one lazy step per touched epoch, not five");
    }

    /// @dev No demand has ever been seen: hold. (Before any expedition the target is undefined.)
    function test_glide_holds_until_there_is_a_demand_signal() public {
        _begin(400_000e18, 1_000e18);
        _day(3);
        miningPool.repeg();
        _modelRepeg(block.timestamp);
        assertEq(miningPool.currentBaseReward(), 1_000e18);
        assertEq(sawHoldNoDemand, 1);
    }

    /// @dev The dust floor: at a rate of 1 wei the -30% bound floors to 0, and a target of 0
    ///      would set the reward to zero — which would also zero every repair price.
    function test_glide_dust_floor_never_reaches_zero() public {
        _begin(1_000, 1); // 1,000 wei season, 1 wei per Base expedition
        for (uint256 k = 0; k < TEAMS; k++) _start(k, 3); // 200 units -> 200 wei
        _day(1);
        uint256 old = m.base;
        _modelRepeg(block.timestamp); // target = 800 / (59 * 200) = 0
        miningPool.repeg();
        _checkStep(old);
        assertEq(miningPool.currentBaseReward(), 1, "floored at 1 wei, never 0");
    }

    /// @dev D-19(c): a budget spent to the last wei is not a demand signal. The rate holds, so
    ///      repair prices (basis points of it) do not walk down 30% a day to nothing.
    function test_glide_holds_the_rate_once_the_budget_is_gone() public {
        _begin(50_000e18, 1_000e18); // exactly two Apex expeditions
        assertTrue(_start(0, 3));
        assertTrue(_start(1, 3));
        assertEq(m.minted, m.emission, "spent exactly");

        for (uint256 d = 1; d <= 5; d++) {
            _day(d);
            uint256 old = m.base;
            _modelRepeg(block.timestamp);
            miningPool.repeg();
            _checkStep(old);
        }
        assertEq(miningPool.currentBaseReward(), 1_000e18, "rate held for five days at zero budget");
        assertFalse(_start(2, 0), "and nothing more can be started");
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
        _day(1);
        _start(1, 0);
        assertEq(m.trailing, 1, "14,999 / 10,000 floors to 1 unit");
    }
}
