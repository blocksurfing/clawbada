using System.Collections;
using UnityEngine;
using UnityEngine.Rendering;

/// <summary>
/// Designer-facing VFX bindings for battle playback. Each slot maps a gameplay
/// moment to an effect prefab (SpriteRenderer + Animator + OneShotVfx), an anchor
/// on the rigs, and an optional delay. The playback layer spawns these at the
/// exact animation moments (impact fires at the melee contact frame), so timing
/// is guaranteed by the system — the designer just fills slots in the Inspector.
///
/// Rebuild prefabs for the generic FX sheets + this asset via
/// "Clawbada/Rebuild Generic VFX Prefabs".
/// </summary>
[CreateAssetMenu(fileName = "BattleVfxLibrary", menuName = "Clawbada/Battle VFX Library")]
public class BattleVfxLibrary : ScriptableObject
{
    public enum AnchorPoint
    {
        ActorAttackFx,   // the attacker's authored AttackFX transform
        TargetImpactFx,  // the target's authored ImpactFX transform
        ActorFeet,       // the attacker's root (hex center)
        TargetFeet,      // the target's root (hex center)
    }

    [System.Serializable]
    public class VfxSlot
    {
        public GameObject prefab;
        public AnchorPoint anchor = AnchorPoint.ActorFeet;
        [Tooltip("Seconds after the gameplay moment before the effect appears.")]
        public float delay = 0f;
        [Tooltip("Mirror the effect horizontally when its owner faces left.")]
        public bool mirrorWithFacing = true;
    }

    [Header("Attack (all classes)")]
    [Tooltip("Spawned on the attacker when the attack starts.")]
    public VfxSlot attackWindup = new() { anchor = AnchorPoint.ActorAttackFx };
    [Tooltip("Spawned on the target at the contact frame of every damaging attack.")]
    public VfxSlot attackImpact = new() { anchor = AnchorPoint.TargetImpactFx };

    [Header("Other moments")]
    [Tooltip("Spawned on a lobster when it takes the Defense stance.")]
    public VfxSlot defend = new() { anchor = AnchorPoint.ActorFeet };
    [Tooltip("Spawned on a lobster when its death animation starts.")]
    public VfxSlot death = new() { anchor = AnchorPoint.ActorFeet };
    [Tooltip("Spawned at a lobster's feet on every hex hop while moving.")]
    public VfxSlot moveStep = new() { anchor = AnchorPoint.ActorFeet };
    [Tooltip("Spawned on the target of heals/buffs/debuffs.")]
    public VfxSlot status = new() { anchor = AnchorPoint.TargetFeet };

    [Header("Special windups (index = classId; falls back to Attack Windup)")]
    [Tooltip("0 Bulwark, 1 Mantis, 2 Leviathan, 3 Tempest, 4 Specter, 5 Sentinel, 6 Reaver, 7 Abyss, 8 Kraken, 9 Ember")]
    public VfxSlot[] specialByClass = new VfxSlot[10];

    /// <summary>Special windup for a class, falling back to the generic windup.</summary>
    public VfxSlot SpecialFor(int classId)
    {
        if (specialByClass != null && classId >= 0 && classId < specialByClass.Length)
        {
            var slot = specialByClass[classId];
            if (slot != null && slot.prefab != null) return slot;
        }
        return attackWindup;
    }

    // ─── Spawning ───

    /// <summary>Spawn a slot's effect for an actor/target pair. Null-safe: missing
    /// slot, prefab, or lobsters simply spawn nothing. The effect is spawned in
    /// world space (not parented, so rig mirroring and corpse tints don't distort
    /// it) and sorted just above its owner so it always reads on top.</summary>
    public static void Spawn(VfxSlot slot, LobsterController actor, LobsterController target, MonoBehaviour host)
    {
        if (slot == null || slot.prefab == null || host == null) return;

        LobsterController owner = slot.anchor switch
        {
            AnchorPoint.TargetImpactFx => target != null ? target : actor,
            AnchorPoint.TargetFeet => target != null ? target : actor,
            _ => actor,
        };
        if (owner == null) return;

        Transform anchorT = slot.anchor switch
        {
            AnchorPoint.ActorAttackFx => owner.AttackFxAnchor,
            AnchorPoint.TargetImpactFx => owner.ImpactFxAnchor,
            _ => owner.transform,
        };

        if (slot.delay > 0f)
        {
            host.StartCoroutine(SpawnAfterDelay(slot, owner, anchorT.position, host));
        }
        else
        {
            SpawnNow(slot, owner, anchorT.position);
        }
    }

    private static IEnumerator SpawnAfterDelay(VfxSlot slot, LobsterController owner, Vector3 position, MonoBehaviour host)
    {
        yield return new WaitForSeconds(slot.delay);
        if (owner != null) SpawnNow(slot, owner, position);
    }

    private static void SpawnNow(VfxSlot slot, LobsterController owner, Vector3 position)
    {
        var fx = Instantiate(slot.prefab, position, Quaternion.identity);

        if (slot.mirrorWithFacing && owner.IsFacingLeft)
        {
            var s = fx.transform.localScale;
            s.x = -s.x;
            fx.transform.localScale = s;
        }

        // Sort just above the owner so effects never vanish behind their lobster.
        var group = fx.GetComponent<SortingGroup>();
        if (group == null) group = fx.AddComponent<SortingGroup>();
        group.sortingLayerName = "Foreground";
        group.sortingOrder = owner.SortingOrder + 1;

        if (fx.GetComponent<OneShotVfx>() == null) fx.AddComponent<OneShotVfx>();
    }
}
