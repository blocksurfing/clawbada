using System;
using System.Globalization;
using System.Text;

/// <summary>Jellyfish timing (seconds / arena units). Nzib (2026-10-07): "the jelly fish behaviour is, it moves
/// diagonally and just one way movement, it doesn't have turn movement. So, create a group of jellyfish
/// (3 jellyfish max) that swim diagonally from the bottom to the top."
/// Geometry: a sprite on Background/2 draws OVER the Elite floor plate (Ground, Background/0), so the plate
/// MASKS the jellyfish (a SpriteMask on Ground, VisibleOutsideMask on every jellyfish — JellySchoolInstaller /
/// JellySchool.hideBehindFloor, 2026-10-08): a jellyfish starts below the plate's painted edge (y 1.59 at
/// x −2.0 … 1.80 at x −0.4) and rises into view from behind it — "they visually don't just pop on the
/// screen, out of thin air" (user) — then leaves above the frame top (2.8125 + half-height ≈ 3.1).
/// The water band a PLAYER can see is narrower than the arena: the left ruined wall covers x ≲ −2.3 and
/// the opponent's HUD panels cover x ≳ 0.2 (the right wall sits under them), so every member's whole path
/// stays inside −2.0…−0.1 (the first probe run put one at x 0.74, straight under the HUD). A group is a
/// loose line, not a bunch (user 2026-10-08): members sit memberSpacing apart (the sprite paints 0.44 u
/// wide) and surface one after another, which also strings them out along the diagonal.</summary>
[Serializable]
public class JellySchoolConfig
{
    public int minJellies = 1;
    public int maxJellies = 3;
    /// <summary>Relative weights for a group of 1 / 2 / 3 ("3 max" — a group of two or three is the usual sight).</summary>
    public float weightOne = 1f;
    public float weightTwo = 2f;
    public float weightThree = 2f;
    /// <summary>The line's centre x is drawn from spawnXCenter ± spawnXHalfWidth — the open water the player can
    /// see (left wall at ≈ −2.3, the opponent's HUD panels from ≈ +0.2) — then clamped so the outer members start
    /// inside the visible window.</summary>
    public float spawnXCenter = -1.1f;
    public float spawnXHalfWidth = 0.6f;
    /// <summary>Centre-to-centre distance between neighbouring members. The sprite paints 28 px wide (0.44 u, 0.53
    /// at scale 1.2), so 0.65 leaves clear water between them.</summary>
    public float memberSpacing = 0.65f;
    /// <summary>Each member is nudged by up to ± this from its slot in the line (keep it under a quarter of the spacing).</summary>
    public float memberXJitter = 0.06f;
    /// <summary>Members after the first start up to this many seconds later — at these rise speeds up to ~0.7 u of
    /// vertical spread, so a trio reads as a file along the diagonal rather than a row.</summary>
    public float memberDelayMax = 4f;
    /// <summary>Centre y where a jellyfish starts: BELOW the floor plate's painted edge (1.59 at the window's left
    /// end, x −2.0). The sprite paints 13 px (0.20 u; 0.24 at scale 1.2) above its centre, so at 1.3 it is fully
    /// behind the plate and rises into view. Lower = more seconds of invisible rise.</summary>
    public float spawnY = 1.3f;
    /// <summary>Centre y past which it is gone (frame top + half-height + margin).</summary>
    public float exitY = 3.1f;
    /// <summary>A group's whole path (every member, start to exit) must stay inside this x range: the left wall's
    /// edge and the HUD's edge, each less a sprite half-width.</summary>
    public float visibleXMin = -2.0f;
    public float visibleXMax = -0.1f;
    public float riseSpeedMin = 0.10f;
    public float riseSpeedMax = 0.18f;
    /// <summary>Members vary from the group's rise speed by up to ± this fraction.</summary>
    public float memberSpeedJitter = 0.15f;
    /// <summary>Sideways speed as a fraction of the rise speed (the diagonal); capped by the room left in the window
    /// on the chosen side, so a wide line gets a gentler diagonal than a lone jellyfish.</summary>
    public float driftRatioMin = 0.3f;
    public float driftRatioMax = 0.8f;
    public float scaleMin = 0.8f;
    public float scaleMax = 1.2f;
    public float swayAmplitude = 0.06f;
    public float swayPeriodMin = 2.5f;
    public float swayPeriodMax = 4f;
    /// <summary>Alpha fade at the start. Behind the plate it is invisible anyway; it only softens a start with the
    /// floor mask turned off.</summary>
    public float fadeInSeconds = 1f;
    /// <summary>After the intro, before the first group.</summary>
    public float firstGroupDelayMin = 5f;
    public float firstGroupDelayMax = 20f;
    /// <summary>From the last member's exit to the next group.</summary>
    public float groupGapMin = 25f;
    public float groupGapMax = 60f;

    /// <summary>Half the width of a line of n members at the start: the outer slots plus their jitter.</summary>
    public float HalfSpan(int n) => (Math.Max(1, n) - 1) * 0.5f * Math.Max(0f, memberSpacing) + Math.Max(0f, memberXJitter);
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
    /// <summary>The line's centre x.</summary>
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

    /// <summary>The x of slot i in a line of n centred on baseX (before its jitter), left to right.</summary>
    public static float SlotX(float baseX, int i, int n, JellySchoolConfig cfg) =>
        baseX + (i - (n - 1) * 0.5f) * Math.Max(0f, cfg.memberSpacing);

    /// <summary>Group g of this battle.</summary>
    public static JellyGroup PlanGroup(uint seed, int groupIndex, JellySchoolConfig cfg)
    {
        var rng = new BirdRng(ObstacleLayoutGenerator.Fnv1a("jelly|" + seed.ToString(CultureInfo.InvariantCulture)
                                                              + "|" + groupIndex.ToString(CultureInfo.InvariantCulture)));
        var g = new JellyGroup { groupIndex = groupIndex };
        int n = PickCount(ref rng, cfg);
        float xMin = Math.Min(cfg.visibleXMin, cfg.visibleXMax), xMax = Math.Max(cfg.visibleXMin, cfg.visibleXMax);
        float jitter = Math.Max(0f, cfg.memberXJitter);
        float halfSpan = cfg.HalfSpan(n);
        // The line's centre: the preferred band, narrowed so the outer members start inside the window; a line too
        // wide for the window is centred in it.
        float xHalf = Math.Max(0f, cfg.spawnXHalfWidth);
        float lo = Math.Max(cfg.spawnXCenter - xHalf, xMin + halfSpan), hi = Math.Min(cfg.spawnXCenter + xHalf, xMax - halfSpan);
        g.baseX = lo <= hi ? rng.Range(lo, hi) : 0.5f * (xMin + xMax);
        g.dir = rng.Coin() ? 1 : -1;
        // Slots left to right, each nudged a little; the real extremes decide the room for the diagonal.
        var startX = new float[n];
        float minX = float.MaxValue, maxX = float.MinValue;
        for (int i = 0; i < n; i++)
        {
            startX[i] = SlotX(g.baseX, i, n, cfg) + rng.Range(-jitter, jitter);
            if (startX[i] < minX) minX = startX[i];
            if (startX[i] > maxX) maxX = startX[i];
        }
        float vLo = Math.Max(0.01f, Math.Min(cfg.riseSpeedMin, cfg.riseSpeedMax)), vHi = Math.Max(vLo, cfg.riseSpeedMax);
        float groupRise = rng.Range(vLo, vHi);
        float rLo = Math.Max(0f, Math.Min(cfg.driftRatioMin, cfg.driftRatioMax)), rHi = Math.Max(rLo, cfg.driftRatioMax);
        // The whole rise is (exitY − spawnY) tall and every member must stay in the player's window, so the
        // diagonal can only be as steep as the room on the chosen side allows: heading right, the right-most
        // member may travel up to (xMax − its x); heading left, mirror. A line with too little room either way
        // for the gentlest configured diagonal takes the side with more room and a shallower one (never a
        // hidden exit under the HUD or behind the wall).
        float rise = Math.Max(0.1f, cfg.exitY - cfg.spawnY);
        float roomRight = Math.Max(0f, xMax - maxX), roomLeft = Math.Max(0f, minX - xMin);
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

        float sJitter = Math.Max(0f, Math.Min(0.9f, cfg.memberSpeedJitter));
        float sLo = Math.Max(0.05f, Math.Min(cfg.scaleMin, cfg.scaleMax)), sHi = Math.Max(sLo, cfg.scaleMax);
        float pLo = Math.Max(0.1f, Math.Min(cfg.swayPeriodMin, cfg.swayPeriodMax)), pHi = Math.Max(pLo, cfg.swayPeriodMax);
        var members = new JellyRise[n];
        for (int i = 0; i < n; i++)
        {
            var m = new JellyRise { groupIndex = groupIndex, memberIndex = i };
            m.startX = startX[i];
            m.riseSpeed = groupRise * (1f + rng.Range(-sJitter, sJitter));
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
