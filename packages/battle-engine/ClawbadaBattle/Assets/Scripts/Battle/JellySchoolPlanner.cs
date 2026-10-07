using System;
using System.Globalization;
using System.Text;

/// <summary>Jellyfish timing (seconds / arena units). Nzib (2026-10-07): "the jelly fish behaviour is, it moves
/// diagonally and just one way movement, it doesn't have turn movement. So, create a group of jellyfish
/// (3 jellyfish max) that swim diagonally from the bottom to the top."
/// Geometry: a sprite on Background/2 draws OVER the Elite floor plate (Ground, Background/0, which paints
/// from y ≈ 1.72 down), so a jellyfish cannot literally start at the frame bottom — it would float over the
/// sand beside the board. It therefore surfaces at the floor line (centre y 2.0, its 0.25 u half-height
/// just touching the plate's edge) with a one-second fade-in, and rises diagonally to leave above the frame
/// top (2.8125 + its half-height ≈ 3.1). The water band a PLAYER can see is narrower than the arena: the
/// left ruined wall covers x ≲ −2.3 and the opponent's HUD panels cover x ≳ 0.2 (the right wall sits
/// under them). So groups surface in x −1.7…−0.5 and a group whose drift would carry it out of
/// −2.0…−0.1 is turned the other way (the first probe run put one at x 0.74, straight under the HUD).</summary>
[Serializable]
public class JellySchoolConfig
{
    public int minJellies = 1;
    public int maxJellies = 3;
    /// <summary>Relative weights for a group of 1 / 2 / 3 ("3 max" — a group of two or three is the usual sight).</summary>
    public float weightOne = 1f;
    public float weightTwo = 2f;
    public float weightThree = 2f;
    /// <summary>The group's base x is drawn from spawnXCenter ± spawnXHalfWidth — the open water the player
    /// can see (left wall at ≈ −2.3, the opponent's HUD panels from ≈ +0.2).</summary>
    public float spawnXCenter = -1.1f;
    public float spawnXHalfWidth = 0.6f;
    /// <summary>Members sit this far either side of the base x (centre ± half-width ± this must stay inside the window) …</summary>
    public float memberXSpread = 0.3f;
    /// <summary>… and start up to this many seconds after the group's first member.</summary>
    public float memberDelayMax = 2.5f;
    /// <summary>Centre y where a jellyfish fades in (the floor line).</summary>
    public float spawnY = 2.0f;
    /// <summary>Centre y past which it is gone (frame top + half-height + margin).</summary>
    public float exitY = 3.1f;
    /// <summary>A group's whole path (every member, surfacing to exit) must stay inside this x range: the
    /// left wall's edge and the HUD's edge, each less a sprite half-width.</summary>
    public float visibleXMin = -2.0f;
    public float visibleXMax = -0.1f;
    public float riseSpeedMin = 0.08f;
    public float riseSpeedMax = 0.15f;
    /// <summary>Members vary from the group's rise speed by up to ± this fraction.</summary>
    public float memberSpeedJitter = 0.15f;
    /// <summary>Sideways speed as a fraction of the rise speed (the diagonal).</summary>
    public float driftRatioMin = 0.3f;
    public float driftRatioMax = 0.8f;
    public float scaleMin = 0.8f;
    public float scaleMax = 1.2f;
    public float swayAmplitude = 0.06f;
    public float swayPeriodMin = 2.5f;
    public float swayPeriodMax = 4f;
    public float fadeInSeconds = 1f;
    /// <summary>After the intro, before the first group.</summary>
    public float firstGroupDelayMin = 5f;
    public float firstGroupDelayMax = 20f;
    /// <summary>From the last member's exit to the next group.</summary>
    public float groupGapMin = 25f;
    public float groupGapMax = 60f;
}

/// <summary>One jellyfish's rise.</summary>
public struct JellyRise
{
    public int groupIndex;
    public int memberIndex;
    public float startX;
    /// <summary>Units per second upward.</summary>
    public float riseSpeed;
    /// <summary>Units per second sideways, signed (the group's heading).</summary>
    public float drift;
    public float scale;
    public float swayPeriod;
    public float swayPhase;
    /// <summary>Seconds after the group starts.</summary>
    public float delay;

    public string Key()
    {
        var ci = CultureInfo.InvariantCulture;
        return "x" + startX.ToString("0.00", ci) + " up" + riseSpeed.ToString("0.000", ci) + " dx" + drift.ToString("+0.000;-0.000", ci)
             + " s" + scale.ToString("0.00", ci) + " d" + delay.ToString("0.0", ci);
    }
}

public sealed class JellyGroup
{
    public int groupIndex;
    /// <summary>+1 drifts right while rising, −1 left.</summary>
    public int dir = 1;
    public float baseX;
    /// <summary>Seconds before the group: the first-group delay, or the gap after the previous group.</summary>
    public float delay;
    public JellyRise[] members = Array.Empty<JellyRise>();

    public string Key()
    {
        var ci = CultureInfo.InvariantCulture;
        var sb = new StringBuilder();
        sb.Append("g").Append(groupIndex.ToString(ci)).Append(" n=").Append(members.Length).Append(dir > 0 ? " →" : " ←")
          .Append(" base").Append(baseX.ToString("0.00", ci)).Append(" d").Append(delay.ToString("0.0", ci));
        foreach (var m in members) sb.Append(" [").Append(m.Key()).Append(']');
        return sb.ToString();
    }
}

/// <summary>Turns a seed and a config into deterministic jellyfish groups, one at a time from the same seed
/// (group g always replays the same way). Pure C#, so the headless smoke test can check the designer's
/// rules without a scene. Shares BirdRng with the gulls and the fish.</summary>
public static class JellySchoolPlanner
{
    public static int PickCount(ref BirdRng rng, JellySchoolConfig cfg)
    {
        int lo = Math.Max(1, Math.Min(cfg.minJellies, cfg.maxJellies));
        int hi = Math.Max(lo, cfg.maxJellies);
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

    private static float Weight(JellySchoolConfig cfg, int n)
    {
        float w = n <= 1 ? cfg.weightOne : n == 2 ? cfg.weightTwo : cfg.weightThree;
        return w < 0f ? 0f : w;
    }

    /// <summary>Group g of this battle.</summary>
    public static JellyGroup PlanGroup(uint seed, int groupIndex, JellySchoolConfig cfg)
    {
        var rng = new BirdRng(ObstacleLayoutGenerator.Fnv1a("jelly|" + seed.ToString(CultureInfo.InvariantCulture)
                                                              + "|" + groupIndex.ToString(CultureInfo.InvariantCulture)));
        var g = new JellyGroup { groupIndex = groupIndex };
        int n = PickCount(ref rng, cfg);
        float xHalf = Math.Max(0f, cfg.spawnXHalfWidth);
        g.baseX = cfg.spawnXCenter + rng.Range(-xHalf, xHalf);
        g.dir = rng.Coin() ? 1 : -1;
        float vLo = Math.Max(0.01f, Math.Min(cfg.riseSpeedMin, cfg.riseSpeedMax)), vHi = Math.Max(vLo, cfg.riseSpeedMax);
        float groupRise = rng.Range(vLo, vHi);
        float rLo = Math.Max(0f, Math.Min(cfg.driftRatioMin, cfg.driftRatioMax)), rHi = Math.Max(rLo, cfg.driftRatioMax);
        // The whole rise is (exitY − spawnY) tall and every member must stay in the player's window, so the
        // diagonal can only be as steep as the room on the chosen side allows: heading right, the farthest
        // member (base + spread) may travel up to (xMax − that); heading left, mirror. A group surfacing
        // mid-window may have too little room either way for the steepest diagonal — then it takes the side
        // with more room and a shallower diagonal (never a hidden exit under the HUD or behind the wall).
        float rise = Math.Max(0.1f, cfg.exitY - cfg.spawnY);
        float spread = Math.Max(0f, cfg.memberXSpread);
        float xMin = Math.Min(cfg.visibleXMin, cfg.visibleXMax), xMax = Math.Max(cfg.visibleXMin, cfg.visibleXMax);
        float roomRight = Math.Max(0f, xMax - (g.baseX + spread)), roomLeft = Math.Max(0f, (g.baseX - spread) - xMin);
        float room = g.dir > 0 ? roomRight : roomLeft, other = g.dir > 0 ? roomLeft : roomRight;
        if (room / rise < rLo && other > room) { g.dir = -g.dir; room = other; }
        float feasible = room / rise;
        float ratio = rng.Range(Math.Min(rLo, feasible), Math.Min(rHi, feasible));
        if (groupIndex == 0)
        {
            float dLo = Math.Max(0f, Math.Min(cfg.firstGroupDelayMin, cfg.firstGroupDelayMax));
            g.delay = rng.Range(dLo, Math.Max(dLo, cfg.firstGroupDelayMax));
        }
        else
        {
            float gLo = Math.Max(0f, Math.Min(cfg.groupGapMin, cfg.groupGapMax));
            g.delay = rng.Range(gLo, Math.Max(gLo, cfg.groupGapMax));
        }

        float jitter = Math.Max(0f, Math.Min(0.9f, cfg.memberSpeedJitter));
        float sLo = Math.Max(0.05f, Math.Min(cfg.scaleMin, cfg.scaleMax)), sHi = Math.Max(sLo, cfg.scaleMax);
        float pLo = Math.Max(0.1f, Math.Min(cfg.swayPeriodMin, cfg.swayPeriodMax)), pHi = Math.Max(pLo, cfg.swayPeriodMax);
        var members = new JellyRise[n];
        for (int i = 0; i < n; i++)
        {
            var m = new JellyRise { groupIndex = groupIndex, memberIndex = i };
            m.startX = g.baseX + rng.Range(-spread, spread);
            m.riseSpeed = groupRise * (1f + rng.Range(-jitter, jitter));
            m.drift = g.dir * ratio * m.riseSpeed;
            m.scale = rng.Range(sLo, sHi);
            m.swayPeriod = rng.Range(pLo, pHi);
            m.swayPhase = rng.NextFloat() * 6.2831853f;
            m.delay = i == 0 ? 0f : rng.Range(0f, Math.Max(0f, cfg.memberDelayMax));
            members[i] = m;
        }
        g.members = members;
        return g;
    }

    /// <summary>Inside the visible window [visibleXMin, visibleXMax].</summary>
    public static bool Fits(float x, JellySchoolConfig cfg) => x >= Math.Min(cfg.visibleXMin, cfg.visibleXMax) - 1e-3f && x <= Math.Max(cfg.visibleXMin, cfg.visibleXMax) + 1e-3f;

    /// <summary>Where member m leaves the frame (x at exitY) — for the smoke test's "stays visible" rule.</summary>
    public static float ExitX(JellyRise m, JellySchoolConfig cfg)
    {
        float rise = Math.Max(0.1f, cfg.exitY - cfg.spawnY);
        return m.startX + m.drift * (rise / Math.Max(0.001f, m.riseSpeed));
    }
}
