using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

/// <summary>One landing spot, ARENA-LOCAL, where a bird's feet sit (the sheets are pivoted at the
/// feet: (0.5, 0.21875) of a 32 px frame). Designer-owned numbers: edit them on the "Birds" child of
/// ArenaArt_Evolved.prefab in the Inspector (gizmos show the boxes), never in the scripts.</summary>
[Serializable]
public struct BirdPerch
{
    public string id;
    public float x;
    public float y;
    /// <summary>Half of the flat crest the bird may Walk across, in units. 0 = no walking here.</summary>
    public float walkHalfWidth;
    /// <summary>Named "disabled" so an Inspector "+" (an all-zero entry) yields an ACTIVE perch.</summary>
    public bool disabled;

    public int Side => x < 0f ? -1 : 1;
}

/// <summary>Flock timing (seconds / units). Nzib (2026-10-04): 3–5 birds, 3 is enough; land on the
/// rocks with sides balanced; idle at random; Jump then Fly, one after another.</summary>
[Serializable]
public class BirdFlockConfig
{
    public int minBirds = 3;
    public int maxBirds = 3;
    public float arrivalGapMin = 0.6f;
    public float arrivalGapMax = 1.4f;
    /// <summary>From the last landing to the first Jump.</summary>
    public float dwellMin = 18f;
    public float dwellMax = 35f;
    /// <summary>Between one bird's Jump and the next one's ("they fly in sequence").</summary>
    public float departGapMin = 0.8f;
    public float departGapMax = 1.6f;
    /// <summary>Cruise height = perch.y + lift, capped at cruiseMaxY (arena-local; the frame top is 2.8125
    /// and the head is 0.39 above the feet).</summary>
    public float cruiseLiftMin = 0.3f;
    public float cruiseLiftMax = 0.5f;
    public float cruiseMaxY = 2.4f;
    /// <summary>false: the whole flock leaves toward one random edge; true: each bird leaves by its nearest edge.</summary>
    public bool exitNearestEdge = false;
}

/// <summary>One bird's part in a flock plan.</summary>
public sealed class BirdPlan
{
    /// <summary>-1 enters from the left edge, +1 from the right.</summary>
    public int entrySide;
    public int perch;
    public string perchId;
    /// <summary>Seconds after the flock starts (cumulative, arrival order).</summary>
    public float arrivalDelay;
    public float cruiseY;
    public int departOrder;
    /// <summary>Seconds after the flock's departure starts (cumulative in departOrder).</summary>
    public float departDelay;
    public int exitSide;
    /// <summary>Per-bird RNG seed for its idle/walk choices, so a plan replays identically.</summary>
    public uint idleSeed;
}

public sealed class BirdFlockPlan
{
    public uint seed;
    public int exitSide;
    public float dwellSeconds;
    /// <summary>Arrival order.</summary>
    public BirdPlan[] birds = Array.Empty<BirdPlan>();

    /// <summary>Compact, culture-invariant description — the flock log line and the determinism assert.
    /// e.g. "n=3 R:RightBig@0.0 L:LeftA@1.1 R:RightSmall@2.3 exit=L order=1,0,2".</summary>
    public string Key()
    {
        var sb = new StringBuilder();
        sb.Append("n=").Append(birds.Length);
        foreach (var b in birds)
            sb.Append(' ').Append(b.entrySide > 0 ? 'R' : 'L').Append(':').Append(b.perchId)
              .Append('@').Append(b.arrivalDelay.ToString("0.0", CultureInfo.InvariantCulture));
        sb.Append(" exit=").Append(exitSide > 0 ? 'R' : 'L');
        sb.Append(" order=");
        for (int i = 0; i < birds.Length; i++) { if (i > 0) sb.Append(','); sb.Append(birds[i].departOrder); }
        return sb.ToString();
    }
}

/// <summary>XorShift32, the same generator ObstacleLayoutGenerator keeps private: platform-independent,
/// unlike System.Random.</summary>
public struct BirdRng
{
    private uint state;
    public BirdRng(uint seed) { state = seed == 0 ? 0x9E3779B9u : seed; }
    public uint Next()
    {
        uint x = state;
        x ^= x << 13; x ^= x >> 17; x ^= x << 5;
        state = x;
        return x;
    }
    /// <summary>Uniform int in [minInclusive, maxExclusive).</summary>
    public int Range(int minInclusive, int maxExclusive)
    {
        int span = maxExclusive - minInclusive;
        return span <= 0 ? minInclusive : minInclusive + (int)(Next() % (uint)span);
    }
    /// <summary>Uniform float in [0, 1) with 24 bits of precision (exact in a float).</summary>
    public float NextFloat() => (Next() >> 8) * (1f / 16777216f);
    public float Range(float a, float b) => a + (b - a) * NextFloat();
    public bool Coin() => (Next() & 1u) == 1u;
}

/// <summary>Turns a seed, the perch table and a config into a deterministic flock plan. Pure C#, so the
/// headless smoke test can check it without a scene.</summary>
public static class BirdFlockPlanner
{
    /// <summary>n entry sides with |right − left| ≤ 1 (3 → 2:1 or 1:2, 4 → 2:2, 5 → 3:2 or 2:3), in a
    /// shuffled arrival order.</summary>
    public static int[] SplitSides(int n, bool majorityRight, ref BirdRng rng)
    {
        if (n <= 0) return Array.Empty<int>();
        int right = majorityRight ? (n + 1) / 2 : n / 2;
        var sides = new int[n];
        for (int i = 0; i < n; i++) sides[i] = i < right ? 1 : -1;
        for (int i = n - 1; i > 0; i--)
        {
            int j = rng.Range(0, i + 1);
            (sides[i], sides[j]) = (sides[j], sides[i]);
        }
        return sides;
    }

    public static BirdFlockPlan Plan(uint seed, IReadOnlyList<BirdPerch> perches, BirdFlockConfig cfg)
    {
        var plan = new BirdFlockPlan { seed = seed };
        if (perches == null || cfg == null) return plan;
        var rng = new BirdRng(seed);

        var free = new List<int>();
        for (int i = 0; i < perches.Count; i++) if (!perches[i].disabled) free.Add(i);

        int minBirds = Math.Max(0, Math.Min(cfg.minBirds, cfg.maxBirds));
        int maxBirds = Math.Max(minBirds, cfg.maxBirds);
        int n = rng.Range(minBirds, maxBirds + 1);
        if (n > free.Count) n = free.Count;
        if (n <= 0) return plan;

        int[] sides = SplitSides(n, rng.Coin(), ref rng);
        var birds = new BirdPlan[n];
        float arrival = 0f;
        var sameSide = new List<int>();
        for (int k = 0; k < n; k++)
        {
            int side = sides[k];
            sameSide.Clear();
            foreach (int i in free) if (perches[i].Side == side) sameSide.Add(i);
            int chosen;
            if (sameSide.Count > 0) chosen = sameSide[rng.Range(0, sameSide.Count)];
            else
            {
                // Nothing free on the entry side: cross to the free perch nearest the entry edge.
                chosen = free[0];
                foreach (int i in free) if (side * perches[i].x > side * perches[chosen].x) chosen = i;
            }
            free.Remove(chosen);
            if (k > 0) arrival += rng.Range(cfg.arrivalGapMin, cfg.arrivalGapMax);
            float cruise = perches[chosen].y + rng.Range(cfg.cruiseLiftMin, cfg.cruiseLiftMax);
            if (cruise > cfg.cruiseMaxY) cruise = cfg.cruiseMaxY;
            birds[k] = new BirdPlan
            {
                entrySide = side, perch = chosen, perchId = perches[chosen].id ?? chosen.ToString(CultureInfo.InvariantCulture),
                arrivalDelay = arrival, cruiseY = cruise, idleSeed = rng.Next(),
            };
        }

        plan.exitSide = rng.Coin() ? 1 : -1;
        var order = new int[n];
        for (int i = 0; i < n; i++) order[i] = i;
        for (int i = n - 1; i > 0; i--)
        {
            int j = rng.Range(0, i + 1);
            (order[i], order[j]) = (order[j], order[i]);
        }
        float depart = 0f;
        for (int j = 0; j < n; j++)
        {
            var b = birds[order[j]];
            b.departOrder = j;
            if (j > 0) depart += rng.Range(cfg.departGapMin, cfg.departGapMax);
            b.departDelay = depart;
            b.exitSide = cfg.exitNearestEdge ? perches[b.perch].Side : plan.exitSide;
        }
        plan.dwellSeconds = rng.Range(cfg.dwellMin, cfg.dwellMax);
        plan.birds = birds;
        return plan;
    }
}
