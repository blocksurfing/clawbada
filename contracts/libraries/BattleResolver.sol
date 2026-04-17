// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title BattleResolver — Pure combat math library for Clawbada
/// @notice Provides damage formulas, class stats, advantage graph, and purity mechanics.
/// @dev All functions internal pure. Used on-chain (verification) and off-chain (simulation).
library BattleResolver {
    // ──────────── Damage Formula Constants ────────────
    uint256 internal constant ATTACK_BASE_POWER = 100;
    uint256 internal constant DEFEND_COUNTER_BASE = 30;
    uint256 internal constant DEFEND_REDUCTION_BPS = 5000; // 50%
    uint256 internal constant STAT_RATIO_CAP = 2200; // 2.2 × 1000
    uint256 internal constant MULT_DENOM = 1000;

    // ──────────── Class Advantage Multipliers (×1000) ────────────
    uint256 internal constant CLASS_ADV_MULT = 1250; // 1.25×
    uint256 internal constant CLASS_DISADV_MULT = 800; // 0.80×
    uint256 internal constant CLASS_NEUTRAL_MULT = 1000; // 1.0×

    // ──────────── Crit ────────────
    uint256 internal constant CRIT_DENOM = 200;
    uint256 internal constant CRIT_MULT = 1500; // 1.5×

    // ──────────── VRF Range (×1000) ────────────
    uint256 internal constant VRF_MIN = 850; // 0.85
    uint256 internal constant VRF_MAX = 1150; // 1.15
    uint256 internal constant VRF_RANGE = 300;

    // ──────────── HP Scaling ────────────
    uint256 internal constant HP_BATTLE_SCALE = 5;

    // ──────────── Evolution Tier Multipliers (×1000) ────────────
    uint256 internal constant TIER_MULT_BASE = 1000;
    uint256 internal constant TIER_MULT_EVOLVED = 1200;
    uint256 internal constant TIER_MULT_ELITE = 1400;
    uint256 internal constant TIER_MULT_APEX = 1600;
    uint256 internal constant LEGEND_MULT = 1100; // 1.1×

    // ──────────── Purity ────────────
    uint256 internal constant PURITY_POTENCY_PER = 100; // +10% per match (×1000)
    uint256 internal constant PURITY_ENHANCED_BASE_BPS = 500; // 5% (×10000)
    uint256 internal constant PURITY_ENHANCED_PER_BPS = 500; // +5% per match (×10000)

    // ──────────── Game Constants ────────────
    uint256 internal constant NUM_CLASSES = 10;
    uint256 internal constant MAX_ROUNDS = 7;
    uint256 internal constant SPECIAL_CHARGE_COST = 3;

    // ──────────── Types ────────────
    struct Stats {
        uint256 hp;
        uint256 attack;
        uint256 armor;
        uint256 speed;
        uint256 critical;
    }

    // ──────────── Errors ────────────
    error InvalidClassId(uint8 classId);

    // ──────────── Base Stats ────────────

    /// @notice Returns the base stats for a class (before evolution, legend, body part modifiers).
    /// @param classId 0-9
    function getBaseStats(uint8 classId) internal pure returns (Stats memory) {
        if (classId >= NUM_CLASSES) revert InvalidClassId(classId);

        // Bulwark, Mantis, Leviathan, Tempest, Specter, Sentinel, Reaver, Abyss, Kraken, Ember
        if (classId == 0) return Stats(700, 70, 120, 80, 90); // Bulwark
        if (classId == 1) return Stats(375, 100, 70, 130, 125); // Mantis
        if (classId == 2) return Stats(600, 130, 100, 70, 80); // Leviathan
        if (classId == 3) return Stats(450, 110, 80, 105, 115); // Tempest
        if (classId == 4) return Stats(425, 85, 85, 125, 120); // Specter
        if (classId == 5) return Stats(650, 70, 110, 90, 100); // Sentinel
        if (classId == 6) return Stats(475, 120, 80, 110, 95); // Reaver
        if (classId == 7) return Stats(525, 110, 90, 95, 100); // Abyss
        if (classId == 8) return Stats(550, 90, 100, 105, 95); // Kraken
        return Stats(350, 140, 60, 100, 130); // Ember (classId == 9)
    }

    // ──────────── Stat Scaling ────────────

    /// @notice Apply evolution tier multiplier, legend bonus, and HP battle scaling.
    /// @param base The base stats from getBaseStats
    /// @param tier 0=Base, 1=Evolved, 2=Elite, 3=Apex
    /// @param legend Whether this lobster is a legend
    function scaleStats(Stats memory base, uint8 tier, bool legend) internal pure returns (Stats memory) {
        uint256 tierMult;
        if (tier == 0) tierMult = TIER_MULT_BASE;
        else if (tier == 1) tierMult = TIER_MULT_EVOLVED;
        else if (tier == 2) tierMult = TIER_MULT_ELITE;
        else tierMult = TIER_MULT_APEX;

        uint256 legendMult = legend ? LEGEND_MULT : MULT_DENOM;

        return Stats({
            hp: base.hp * tierMult * legendMult * HP_BATTLE_SCALE / (MULT_DENOM * MULT_DENOM),
            attack: base.attack * tierMult * legendMult / (MULT_DENOM * MULT_DENOM),
            armor: base.armor * tierMult * legendMult / (MULT_DENOM * MULT_DENOM),
            speed: base.speed * tierMult * legendMult / (MULT_DENOM * MULT_DENOM),
            critical: base.critical * tierMult * legendMult / (MULT_DENOM * MULT_DENOM)
        });
    }

    // ──────────── Class Advantage ────────────

    /// @notice Returns the class advantage multiplier (×1000).
    /// @dev Circulant graph: class i beats (i+1..i+4)%10, neutral with (i+5)%10, loses to rest.
    function getClassAdvantage(uint8 atkClass, uint8 defClass) internal pure returns (uint256) {
        if (atkClass >= NUM_CLASSES) revert InvalidClassId(atkClass);
        if (defClass >= NUM_CLASSES) revert InvalidClassId(defClass);

        if (atkClass == defClass) return CLASS_NEUTRAL_MULT;

        uint256 diff = (uint256(defClass) + NUM_CLASSES - uint256(atkClass)) % NUM_CLASSES;
        // diff 1-4: attacker beats defender
        if (diff >= 1 && diff <= 4) return CLASS_ADV_MULT;
        // diff 5: neutral (opposite in 10-class ring)
        if (diff == 5) return CLASS_NEUTRAL_MULT;
        // diff 6-9: attacker loses to defender
        return CLASS_DISADV_MULT;
    }

    // ──────────── Damage Formulas ────────────

    /// @notice Calculate attack move damage.
    /// @param atk Attacker's attack stat (scaled)
    /// @param armor Defender's armor stat (scaled)
    /// @param classMult Class advantage multiplier (×1000)
    /// @param isCrit Whether this is a critical hit
    /// @param vrfRoll VRF variance value (×1000, range 850-1150)
    function calculateAttackDamage(
        uint256 atk,
        uint256 armor,
        uint256 classMult,
        bool isCrit,
        uint256 vrfRoll
    ) internal pure returns (uint256) {
        uint256 ratio = _cappedRatio(atk, armor);
        uint256 critMult = isCrit ? CRIT_MULT : MULT_DENOM;

        // ATTACK_BASE_POWER × ratio × classMult × critMult × vrfRoll / (MULT_DENOM^4)
        return ATTACK_BASE_POWER * ratio * classMult * critMult * vrfRoll
            / (MULT_DENOM * MULT_DENOM * MULT_DENOM * MULT_DENOM);
    }

    /// @notice Calculate defend counter damage (no crit possible).
    /// @param atk Defender's (counter-attacker's) attack stat
    /// @param armor Attacker's (target's) armor stat
    /// @param classMult Class advantage multiplier (×1000)
    /// @param vrfRoll VRF variance value (×1000)
    function calculateDefendCounter(
        uint256 atk,
        uint256 armor,
        uint256 classMult,
        uint256 vrfRoll
    ) internal pure returns (uint256) {
        uint256 ratio = _cappedRatio(atk, armor);

        // DEFEND_COUNTER_BASE × ratio × classMult × vrfRoll / (MULT_DENOM^3)
        return DEFEND_COUNTER_BASE * ratio * classMult * vrfRoll
            / (MULT_DENOM * MULT_DENOM * MULT_DENOM);
    }

    /// @notice Calculate special move damage.
    /// @param basePower The special's base power (class-specific)
    /// @param atk Attacker's attack stat
    /// @param armor Defender's armor stat
    /// @param classMult Class advantage multiplier (×1000)
    /// @param purity Purity score 0-6
    /// @param vrfRoll VRF variance value (×1000)
    function calculateSpecialDamage(
        uint256 basePower,
        uint256 atk,
        uint256 armor,
        uint256 classMult,
        uint8 purity,
        uint256 vrfRoll
    ) internal pure returns (uint256) {
        uint256 ratio = _cappedRatio(atk, armor);
        uint256 purityMult = MULT_DENOM + uint256(purity) * PURITY_POTENCY_PER;

        // basePower × ratio × classMult × purityMult × vrfRoll / (MULT_DENOM^4)
        return basePower * ratio * classMult * purityMult * vrfRoll
            / (MULT_DENOM * MULT_DENOM * MULT_DENOM * MULT_DENOM);
    }

    // ──────────── Crit Chance ────────────

    /// @notice Returns the critical hit chance in BPS (×10000).
    /// @param critStat The lobster's critical stat
    function critChance(uint256 critStat) internal pure returns (uint256) {
        return critStat * 10_000 / (critStat + CRIT_DENOM);
    }

    // ──────────── Special Powers ────────────

    /// @notice Returns the base power of a class's Special move.
    /// @dev Returns 0 for utility-type specials (Bulwark Fortify, Sentinel Rally).
    function getSpecialBasePower(uint8 classId) internal pure returns (uint256) {
        if (classId >= NUM_CLASSES) revert InvalidClassId(classId);

        // [Bulwark=0, Mantis=150, Leviathan=180, Tempest=90, Specter=60,
        //  Sentinel=0, Reaver=70, Abyss=120, Kraken=60, Ember=200]
        if (classId == 0) return 0; // Bulwark (Fortify — utility)
        if (classId == 1) return 150; // Mantis (Ambush)
        if (classId == 2) return 180; // Leviathan (Crush)
        if (classId == 3) return 90; // Tempest (Maelstrom — AoE)
        if (classId == 4) return 60; // Specter (Haunt — debuff)
        if (classId == 5) return 0; // Sentinel (Rally — heal)
        if (classId == 6) return 70; // Reaver (Rend — DoT)
        if (classId == 7) return 120; // Abyss (Devour — drain)
        if (classId == 8) return 60; // Kraken (Bind — CC)
        return 200; // Ember (Inferno — nuke)
    }

    // ──────────── Purity ────────────

    /// @notice Returns the enhanced Special proc chance in BPS.
    /// @param purity Purity score 0-6
    function enhancedProcChance(uint8 purity) internal pure returns (uint256) {
        return PURITY_ENHANCED_BASE_BPS + uint256(purity) * PURITY_ENHANCED_PER_BPS;
    }

    // ──────────── Randomness ────────────

    /// @notice Derive a pseudo-random value from a seed and salt.
    function deriveRandom(uint256 seed, bytes32 salt) internal pure returns (uint256) {
        return uint256(keccak256(abi.encodePacked(seed, salt)));
    }

    // ──────────── Internal ────────────

    /// @dev Calculate atk/armor ratio capped at STAT_RATIO_CAP (2.2×), scaled ×1000.
    ///      Returns cap if armor is 0 (defensive hardening for future on-chain use).
    function _cappedRatio(uint256 atk, uint256 armor) private pure returns (uint256) {
        if (armor == 0) return STAT_RATIO_CAP;
        uint256 ratio = atk * MULT_DENOM / armor;
        return ratio > STAT_RATIO_CAP ? STAT_RATIO_CAP : ratio;
    }
}
