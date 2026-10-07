using System;
using System.Globalization;
using System.Text;

/// <summary>Drift-cloud timing (seconds / arena units). Nzib (2026-10-07): "I haven't placed it in the
/// arena yet, you can make it appear randomly using a script since I've created multiple cloud variations,
/// and please make the movement slow." The sky of the Evolved arena is the band between the sea's wavy
/// horizon (BG_2 is opaque from y ≈ 2.03; the animated Sea band reaches 2.125) and the frame top (2.8125);
/// the painted Static_Clouds sit in the same band. A drift cloud is 7–27 px tall (0.11–0.42 u), so lane
/// centres 2.35–2.62 keep even the biggest one above the Sea band and inside the frame — the planner also
/// clamps each lane by its variant's half-height.</summary>
[Serializable]
public class CloudDriftConfig
{
    /// <summary>Clouds in the air at once (slots). Each slot keeps re-entering from the upwind edge.</summary>
    public int minClouds = 2;
    public int maxClouds = 3;
    public float laneYMin = 2.35f;
    public float laneYMax = 2.62f;
    /// <summary>Nothing of a cloud may dip below this (the Sea band's top) …</summary>
    public float horizonY = 2.13f;
    /// <summary>… or rise above this (the frame top).</summary>
    public float frameTopY = 2.8125f;
    /// <summary>Units per second. 10 u of sky at 0.04–0.09 takes 110–250 s: "make the movement slow".</summary>
    public float speedMin = 0.04f;
    public float speedMax = 0.09f;
    /// <summary>Off-screen pause before a slot's next cloud enters.</summary>
    public float respawnGapMin = 6f;
    public float respawnGapMax = 40f;
    /// <summary>A barely-there vertical ease so a cloud is not a ruler-straight slide.</summary>
    public float bobAmplitude = 0.02f;
    public float bobPeriodMin = 20f;
    public float bobPeriodMax = 40f;
    /// <summary>The first cloud of each slot starts IN VIEW, at this fraction of the visible half-width
    /// (so the sky is never empty at battle start); later passes enter from off-screen.</summary>
    public float firstPassViewFraction = 0.9f;
}

/// <summary>One pass of one cloud slot across the sky.</summary>
public struct CloudPass
{
    public int cloudIndex;
    public int passIndex;
    /// <summary>0-based index into CloudDrift.cloudPrefabs (Drift_Cloud_01 … _06).</summary>
    public int variant;
    public float laneY;
    public float speed;
    public float bobPeriod;
    public float bobPhase;
    /// <summary>First pass only: start x as a fraction [-f, f] of the visible half-width. NaN = off-screen upwind.</summary>
    public float startFraction;
    /// <summary>Seconds before it enters (0 for a first pass; the respawn gap afterwards).</summary>
    public float delay;

    public bool StartsInView => !float.IsNaN(startFraction);

    public string Key()
    {
        var ci = CultureInfo.InvariantCulture;
        return "v" + (variant + 1).ToString(ci) + "@y" + laneY.ToString("0.00", ci) + " s" + speed.ToString("0.000", ci)
             + (StartsInView ? " x" + startFraction.ToString("0.00", ci) : " edge") + " d" + delay.ToString("0.0", ci);
    }
}

public sealed class CloudDriftPlan
{
    public uint seed;
    /// <summary>+1: the wind blows left→right (clouds enter from the left edge); −1: right→left.</summary>
    public int windDir = 1;
    public CloudPass[] first = Array.Empty<CloudPass>();

    public string Key()
    {
        var sb = new StringBuilder();
        sb.Append("wind=").Append(windDir > 0 ? "L→R" : "R→L").Append(" n=").Append(first.Length);
        foreach (var c in first) sb.Append(" [").Append(c.Key()).Append(']');
        return sb.ToString();
    }
}

/// <summary>Turns a seed and a config into a deterministic sky: the wind, how many clouds, and each slot's
/// passes (the first up front, the rest on demand from the same seed). Pure C#, so the headless smoke test
/// can check the designer's rules without a scene. Shares BirdRng with the gulls and the fish.</summary>
public static class CloudDriftPlanner
{
    public const int VariantCount = 6;
    /// <summary>Half-heights of Drift_Cloud_01 … _06 in arena units (27, 27, 16, 11, 8, 7 px at 64 px/u), the
    /// lane clamp. CloudDriftSmokeTest checks the prefabs are no taller than this.</summary>
    public static readonly float[] VariantHalfHeight = { 27f / 128f, 27f / 128f, 16f / 128f, 11f / 128f, 8f / 128f, 7f / 128f };

    public static float HalfHeight(int variant) => variant >= 0 && variant < VariantHalfHeight.Length ? VariantHalfHeight[variant] : VariantHalfHeight[0];

    public static CloudDriftPlan Plan(uint seed, CloudDriftConfig cfg)
    {
        var plan = new CloudDriftPlan { seed = seed };
        if (cfg == null) return plan;
        var rng = new BirdRng(seed);
        plan.windDir = rng.Coin() ? 1 : -1;
        int lo = Math.Max(1, Math.Min(cfg.minClouds, cfg.maxClouds));
        int hi = Math.Max(lo, cfg.maxClouds);
        int n = rng.Range(lo, hi + 1);
        var first = new CloudPass[n];
        for (int i = 0; i < n; i++) first[i] = PlanPass(seed, i, 0, cfg);
        plan.first = first;
        return plan;
    }

    /// <summary>Pass k of slot i, from its own stream — the same (seed, i, k) always replays the same pass.</summary>
    public static CloudPass PlanPass(uint seed, int cloudIndex, int passIndex, CloudDriftConfig cfg)
    {
        var rng = new BirdRng(ObstacleLayoutGenerator.Fnv1a("cloud|" + seed.ToString(CultureInfo.InvariantCulture)
                                                              + "|" + cloudIndex.ToString(CultureInfo.InvariantCulture)
                                                              + "|" + passIndex.ToString(CultureInfo.InvariantCulture)));
        var c = new CloudPass { cloudIndex = cloudIndex, passIndex = passIndex };
        c.variant = rng.Range(0, VariantCount);
        float half = HalfHeight(c.variant);
        float yLo = Math.Max(Math.Min(cfg.laneYMin, cfg.laneYMax), cfg.horizonY + half);
        float yHi = Math.Min(Math.Max(cfg.laneYMin, cfg.laneYMax), cfg.frameTopY - half);
        if (yHi < yLo) yHi = yLo;
        c.laneY = rng.Range(yLo, yHi);
        float vLo = Math.Max(0.005f, Math.Min(cfg.speedMin, cfg.speedMax)), vHi = Math.Max(vLo, cfg.speedMax);
        c.speed = rng.Range(vLo, vHi);
        float pLo = Math.Max(1f, Math.Min(cfg.bobPeriodMin, cfg.bobPeriodMax)), pHi = Math.Max(pLo, cfg.bobPeriodMax);
        c.bobPeriod = rng.Range(pLo, pHi);
        c.bobPhase = rng.NextFloat() * 6.2831853f;
        if (passIndex == 0)
        {
            float f = Math.Max(0f, Math.Min(1f, cfg.firstPassViewFraction));
            c.startFraction = rng.Range(-f, f);
            c.delay = 0f;
        }
        else
        {
            c.startFraction = float.NaN;
            float gLo = Math.Max(0f, Math.Min(cfg.respawnGapMin, cfg.respawnGapMax)), gHi = Math.Max(gLo, cfg.respawnGapMax);
            c.delay = rng.Range(gLo, gHi);
        }
        return c;
    }
}
