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

    [Tooltip("Movement scuttle — one clip per hex step, picked at random from this set so a three-hex walk " +
             "doesn't repeat one sample. Bound from Assets/Audio/SFX/Move/SFX_Move_*.wav in name order.")]
    public AudioClip[] move = new AudioClip[0];

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
