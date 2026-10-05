using System;
using System.Globalization;
using System.Text;

/// <summary>Angler fish timing (seconds / arena units). Nzib (2026-10-05): "just swimming around in the
/// background, nothing complex — randomize the quantity and the direction, keep it on the background."
/// The lane band is the open water above the arena floor: the Elite Ground layer paints up to 82 % of
/// the canvas (y ≈ +1.81) and the frame top is +2.81; a fish is ~0.56 u tall, so 2.1–2.5 keeps it whole.
/// A turn is only planned inside |x| &lt; turnHalfWidth, between the ruined walls, where it can be seen.</summary>
[Serializable]
public class AnglerSchoolConfig
{
    public int minFish = 1;
    public int maxFish = 3;
    /// <summary>Relative weights for a school of 1 / 2 / 3 (a lone fish as common as a pair; three is rarer).</summary>
    public float weightOne = 2f;
    public float weightTwo = 2f;
    public float weightThree = 1f;
    public float laneYMin = 2.1f;
    public float laneYMax = 2.5f;
    public float speedMin = 0.42f;
    public float speedMax = 0.84f;
    /// <summary>Smaller fish read as farther away.</summary>
    public float scaleMin = 0.7f;
    public float scaleMax = 1f;
    /// <summary>The first crossing of each fish starts after a random delay up to this, so a school trickles in.</summary>
    public float startDelayMax = 16f;
    public float turnChance = 0.45f;
    public float turnHalfWidth = 1.8f;
    /// <summary>Off-screen pause between one crossing and the next.</summary>
    public float respawnGapMin = 6.4f;
    public float respawnGapMax = 20f;
    public float bobAmplitude = 0.08f;
    public float bobPeriodMin = 3f;
    public float bobPeriodMax = 5f;
}

/// <summary>One pass of one fish across the water band.</summary>
public struct FishCrossing
{
    public int fishIndex;
    public int crossingIndex;
    /// <summary>-1 enters from the left edge (swims right), +1 from the right edge (swims left).</summary>
    public int entrySide;
    public float laneY;
    public float speed;
    public float scale;
    /// <summary>Arena-local x where it turns back the way it came; NaN = straight across.</summary>
    public float turnAtX;
    public float bobPeriod;
    public float bobPhase;
    /// <summary>Seconds before it enters: the stagger for a first crossing, the respawn gap afterwards.</summary>
    public float delay;

    public bool Turns => !float.IsNaN(turnAtX);

    public string Key()
    {
        var ci = CultureInfo.InvariantCulture;
        return (entrySide > 0 ? "R" : "L") + "@y" + laneY.ToString("0.00", ci) + " v" + speed.ToString("0.00", ci)
             + " s" + scale.ToString("0.00", ci) + (Turns ? " turn@" + turnAtX.ToString("0.00", ci) : " straight")
             + " d" + delay.ToString("0.0", ci);
    }
}

public sealed class AnglerSchoolPlan
{
    public uint seed;
    /// <summary>The first crossing of every fish in the school (index = fish).</summary>
    public FishCrossing[] first = Array.Empty<FishCrossing>();

    /// <summary>Compact, culture-invariant description — the log line and the determinism assert,
    /// e.g. "n=2 [L@y2.31 v0.52 s0.80 turn@0.90 d4.2] [R@y2.44 v0.41 s0.73 straight d13.7]".</summary>
    public string Key()
    {
        var sb = new StringBuilder();
        sb.Append("n=").Append(first.Length);
        foreach (var c in first) sb.Append(" [").Append(c.Key()).Append(']');
        return sb.ToString();
    }
}

/// <summary>Turns a seed and a config into a deterministic school: how many fish, and each fish's crossings
/// (the first one up front, every later one on demand from the same seed). Pure C#, so the headless smoke
/// test can check the designer's rules without a scene. Shares BirdRng with the gulls.</summary>
public static class AnglerSchoolPlanner
{
    /// <summary>Weighted pick in [minFish, maxFish]: the weights apply to 1, 2 and 3 fish; any larger count
    /// (if the designer raises maxFish) shares the weight of three.</summary>
    public static int PickCount(ref BirdRng rng, AnglerSchoolConfig cfg)
    {
        int lo = Math.Max(1, Math.Min(cfg.minFish, cfg.maxFish));
        int hi = Math.Max(lo, cfg.maxFish);
        if (hi == lo) return lo;
        float total = 0f;
        for (int n = lo; n <= hi; n++) total += Weight(cfg, n);
        if (total <= 0f) return lo;
        float r = rng.NextFloat() * total;
        for (int n = lo; n <= hi; n++)
        {
            r -= Weight(cfg, n);
            if (r < 0f) return n;
        }
        return hi;
    }

    private static float Weight(AnglerSchoolConfig cfg, int n)
    {
        float w = n <= 1 ? cfg.weightOne : n == 2 ? cfg.weightTwo : cfg.weightThree;
        return w < 0f ? 0f : w;
    }

    public static AnglerSchoolPlan Plan(uint seed, AnglerSchoolConfig cfg)
    {
        var plan = new AnglerSchoolPlan { seed = seed };
        if (cfg == null) return plan;
        var rng = new BirdRng(seed);
        int n = PickCount(ref rng, cfg);
        var first = new FishCrossing[n];
        for (int i = 0; i < n; i++) first[i] = PlanCrossing(seed, i, 0, cfg);
        plan.first = first;
        return plan;
    }

    /// <summary>Crossing k of fish i, from its own stream — the same (seed, i, k) always replays the same pass.</summary>
    public static FishCrossing PlanCrossing(uint seed, int fishIndex, int crossingIndex, AnglerSchoolConfig cfg)
    {
        var rng = new BirdRng(ObstacleLayoutGenerator.Fnv1a("fish|" + seed.ToString(CultureInfo.InvariantCulture)
                                                             + "|" + fishIndex.ToString(CultureInfo.InvariantCulture)
                                                             + "|" + crossingIndex.ToString(CultureInfo.InvariantCulture)));
        float yLo = Math.Min(cfg.laneYMin, cfg.laneYMax), yHi = Math.Max(cfg.laneYMin, cfg.laneYMax);
        float vLo = Math.Max(0.01f, Math.Min(cfg.speedMin, cfg.speedMax)), vHi = Math.Max(vLo, cfg.speedMax);
        float sLo = Math.Max(0.05f, Math.Min(cfg.scaleMin, cfg.scaleMax)), sHi = Math.Max(sLo, cfg.scaleMax);
        float half = Math.Max(0f, cfg.turnHalfWidth);
        float gLo = Math.Max(0f, Math.Min(cfg.respawnGapMin, cfg.respawnGapMax)), gHi = Math.Max(gLo, cfg.respawnGapMax);
        float pLo = Math.Max(0.1f, Math.Min(cfg.bobPeriodMin, cfg.bobPeriodMax)), pHi = Math.Max(pLo, cfg.bobPeriodMax);

        var c = new FishCrossing { fishIndex = fishIndex, crossingIndex = crossingIndex };
        c.entrySide = rng.Coin() ? 1 : -1;
        c.laneY = rng.Range(yLo, yHi);
        c.speed = rng.Range(vLo, vHi);
        c.scale = rng.Range(sLo, sHi);
        c.turnAtX = half > 0f && rng.NextFloat() < cfg.turnChance ? rng.Range(-half, half) : float.NaN;
        c.bobPeriod = rng.Range(pLo, pHi);
        c.bobPhase = rng.NextFloat() * 6.2831853f;
        c.delay = crossingIndex == 0 ? rng.Range(0f, Math.Max(0f, cfg.startDelayMax)) : rng.Range(gLo, gHi);
        return c;
    }
}
