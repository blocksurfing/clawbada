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

    public AudioClip AttackFor(int classId) =>
        attackByClass != null && classId >= 0 && classId < attackByClass.Length ? attackByClass[classId] : null;
}
