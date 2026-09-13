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
    [Tooltip("Basic attack, one per class, indexed by LobsterClass. Empty slots are silent, not an error.")]
    public AudioClip[] attackByClass = new AudioClip[10];

    /// <summary>
    /// A class's Special, optionally different per tier. `shared` covers classes that ship one
    /// sound for all three — a tier set is three purchases, and most Specials won't warrant it.
    /// </summary>
    [System.Serializable]
    public class SpecialClips
    {
        [Tooltip("SFX_<Class>_<Ability>.wav — used for any tier with no clip of its own.")]
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

    [Tooltip("Special move, one entry per class, indexed by LobsterClass.")]
    public SpecialClips[] specialByClass = new SpecialClips[10];

    public AudioClip AttackFor(int classId) =>
        attackByClass != null && classId >= 0 && classId < attackByClass.Length ? attackByClass[classId] : null;

    public AudioClip SpecialFor(int classId, int tier)
    {
        if (specialByClass == null || classId < 0 || classId >= specialByClass.Length) return null;
        var slot = specialByClass[classId];
        return slot != null ? slot.For(tier) : null;
    }
}
