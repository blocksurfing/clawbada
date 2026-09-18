using UnityEngine;

/// <summary>
/// Per-class battle sounds, indexed by LobsterClass (Bulwark 0 … Ember 9) exactly like
/// BattleVfxLibrary.specialByClass. Populated from Assets/Audio/SFX/ by BattleSfxBinder
/// ("Clawbada ▸ Audio ▸ Bind Battle SFX"), so adding a sound is a file drop plus a rebind.
///
/// Lives in Resources/ and is loaded on demand by BattleSfx rather than wired into
/// BattleScene — a scene reference would be one more thing to merge against the designer,
/// and the scene is already the file that hides shipped values (see secondsPerHexMove).
/// </summary>
[CreateAssetMenu(fileName = "BattleSfxLibrary", menuName = "Clawbada/Battle SFX Library")]
public class BattleSfxLibrary : ScriptableObject
{
    /// <summary>
    /// One sound, optionally different per tier. `shared` covers a class that ships a single
    /// clip for all three — a tier set is three purchases, and most won't warrant it.
    /// </summary>
    [System.Serializable]
    public class TierClips
    {
        [Tooltip("No tier suffix — used for any tier with no clip of its own.")]
        public AudioClip shared;
        public AudioClip evolved;
        public AudioClip elite;
        public AudioClip apex;

        public AudioClip For(int tier)
        {
            AudioClip c = tier == 2 ? elite : tier == 3 ? apex : evolved;
            // Explicit != null, never ??: an unassigned Object field deserializes as a destroyed
            // wrapper that the null-coalescing operators treat as non-null.
            if (c != null) return c;
            return shared != null ? shared : null;
        }
    }

    /// <summary>
    /// A Special has two phases, the same split as BattleVfxLibrary's windup + impact slots.
    /// `cast` starts with the windup and underscores the whole sequence; `impact` lands on the
    /// hit beat. Either may be empty — Haunt ships only a cast, Maelstrom ships both.
    /// </summary>
    [System.Serializable]
    public class SpecialClips
    {
        public TierClips cast = new TierClips();
        public TierClips impact = new TierClips();
        [Tooltip("Seconds BEFORE the hit beat to start the impact clip, so its loudest moment lands on the " +
                 "beat instead of after it. Measured from the file by the binder; edit here to override.")]
        public float impactLead;
    }

    [Tooltip("Basic attack, one per class, indexed by LobsterClass. Empty slots are silent, not an error.")]
    public AudioClip[] attackByClass = new AudioClip[10];

    [Tooltip("Special move, one entry per class, indexed by LobsterClass.")]
    public SpecialClips[] specialByClass = new SpecialClips[10];

    [Tooltip("Movement scuttle — one clip per walk, picked at random from this set and looped for exactly as long " +
             "as the lobster moves. Bound from Assets/Audio/SFX/Move/SFX_Move_*.wav in name order.")]
    public AudioClip[] move = new AudioClip[0];

    [Tooltip("Defend stance, shared by every class — one is picked at random per Defend. Bound from " +
             "Assets/Audio/SFX/Defend/SFX_Defend_*.wav (or a single SFX_Defend.wav) in name order.")]
    public AudioClip[] defend = new AudioClip[0];
    [Tooltip("Optional per-class Defend, indexed by LobsterClass: SFX/Defend/SFX_<Class>_Defend.wav. Empty slots fall back to the shared pool.")]
    public AudioClip[] defendByClass = new AudioClip[10];

    [Tooltip("Death — one is picked at random when a lobster goes down. Bound from Assets/Audio/SFX/Death/SFX_Death_*.wav " +
             "(or a single SFX_Death.wav) in name order.")]
    public AudioClip[] death = new AudioClip[0];
    [Tooltip("Optional per-class death, indexed by LobsterClass: SFX/Death/SFX_<Class>_Death.wav. Empty slots fall back to the shared pool.")]
    public AudioClip[] deathByClass = new AudioClip[10];

    [Tooltip("In-game UI opening (the options menu, confirm steps): Assets/Audio/SFX/UI/SFX_UI_Open.wav.")]
    public AudioClip uiOpen;
    [Tooltip("In-game UI closing: Assets/Audio/SFX/UI/SFX_UI_Close.wav.")]
    public AudioClip uiClose;

    /// <summary>The class's own Defend clip if one is bound, else a random pick from the shared pool, else null.</summary>
    public AudioClip DefendFor(int classId)
    {
        AudioClip c = defendByClass != null && classId >= 0 && classId < defendByClass.Length ? defendByClass[classId] : null;
        if (c != null) return c;
        return defend != null && defend.Length > 0 ? defend[Random.Range(0, defend.Length)] : null;
    }

    /// <summary>The class's own death clip if one is bound, else a random pick from the shared pool, else null.</summary>
    public AudioClip DeathFor(int classId)
    {
        AudioClip c = deathByClass != null && classId >= 0 && classId < deathByClass.Length ? deathByClass[classId] : null;
        if (c != null) return c;
        return death != null && death.Length > 0 ? death[Random.Range(0, death.Length)] : null;
    }

    /// <summary>A random movement clip, or null when none are bound.</summary>
    public AudioClip RandomMove() => move != null && move.Length > 0 ? move[Random.Range(0, move.Length)] : null;

    public AudioClip AttackFor(int classId) =>
        attackByClass != null && classId >= 0 && classId < attackByClass.Length ? attackByClass[classId] : null;

    public SpecialClips SpecialSlot(int classId) =>
        specialByClass != null && classId >= 0 && classId < specialByClass.Length ? specialByClass[classId] : null;

    public AudioClip SpecialCastFor(int classId, int tier) => SpecialSlot(classId)?.cast?.For(tier);
    public AudioClip SpecialImpactFor(int classId, int tier) => SpecialSlot(classId)?.impact?.For(tier);
    public float SpecialImpactLead(int classId) => SpecialSlot(classId)?.impactLead ?? 0f;
}
