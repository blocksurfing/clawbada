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
        CameraCenter,    // full-screen layer: the camera's centre, above arena and lobsters (never mirrored)
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
        [Tooltip("Specials only: seconds after this effect starts when the hit beat lands (damage, hit reads, per-target " +
                 "impact effects). 0 = use the attacker's swing timing.")]
        public float impactAt = 0f;
        [Tooltip("Children whose name starts with this prefix are disabled at spawn (designer timing guides such as Hit_A/B/C).")]
        public string hideChildrenPrefix = "";
        [Tooltip("Sort above full-screen effects and front decor — for per-target Special impacts that must read over a storm layer.")]
        public bool onTop = false;

        [Header("Projectile Specials (Inferno)")]
        [Tooltip("Looping projectile prefab. When set, the Special is a projectile: this prefab flies from the caster's AttackFX " +
                 "to the target's ImpactFX after `launchAt`, looping for exactly the flight time, and the hit beat lands on arrival.")]
        public GameObject travelPrefab;
        [Tooltip("Flight speed in world units per second (hex centres are ~1.73 units apart). Flight time = distance / speed.")]
        public float travelSpeed = 7f;
        [Tooltip("Seconds after this effect starts when the projectile leaves the caster (≈ the formation clip's length).")]
        public float launchAt = 0f;
        [Tooltip("Seconds after the projectile arrives before the hit beat (the burst frame of the per-target impact effect).")]
        public float impactLead = 0f;

        public bool IsProjectile => travelPrefab != null;
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

    [System.Serializable]
    public class StatusVfx
    {
        [Tooltip("Engine status type this visual tracks: haunt, bleed, stun, slow, fortify, shield…")]
        public string status;
        [Tooltip("One-shot played when the status lands (OneShotVfx). Optional.")]
        public GameObject spawn;
        [Tooltip("Looping prefab (NO OneShotVfx) shown while the status is active; parented to the lobster so it follows hex moves.")]
        public GameObject loop;
        [Tooltip("One-shot played when the status ends (expires or is cleansed). Optional.")]
        public GameObject end;
        [Tooltip("Local Y offset from the lobster's root (hex centre). Sigils sit at 0; overhead marks go up.")]
        public float yOffset = 0f;
    }

    [Header("Status visuals (persistent marks driven by status apply/remove events)")]
    [Tooltip("Sprite sortingOrder inside the prefab decides depth against the rig: negative = under the body (sigils), >15 = over it.")]
    public StatusVfx[] statusVisuals = new StatusVfx[0];

    /// <summary>Status visual bound to an engine status type, or null.</summary>
    public StatusVfx StatusFor(string status)
    {
        if (statusVisuals == null || string.IsNullOrEmpty(status)) return null;
        foreach (var s in statusVisuals) if (s != null && string.Equals(s.status, status, System.StringComparison.OrdinalIgnoreCase)) return s;
        return null;
    }

    [Header("Special impacts (index = classId; falls back to Attack Impact)")]
    [Tooltip("Spawned on EVERY target hit by the class Special at its impact beat (e.g. Maelstrom's electric hit).")]
    public VfxSlot[] specialImpactByClass = new VfxSlot[10];

    /// <summary>Per-target impact effect for a class Special, falling back to the generic impact.</summary>
    public VfxSlot SpecialImpactFor(int classId)
    {
        if (specialImpactByClass != null && classId >= 0 && classId < specialImpactByClass.Length)
        {
            var slot = specialImpactByClass[classId];
            if (slot != null && slot.prefab != null) return slot;
        }
        return attackImpact;
    }

    /// <summary>Length of the longest clip on a prefab's Animator (0 when none) — how long a one-shot effect plays.</summary>
    public static float ClipLength(GameObject prefab)
    {
        if (prefab == null) return 0f;
        var animator = prefab.GetComponent<Animator>();
        if (animator == null || animator.runtimeAnimatorController == null) return 0f;
        float len = 0f;
        foreach (var c in animator.runtimeAnimatorController.animationClips) if (c != null && c.length > len) len = c.length;
        return len;
    }

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

        if (slot.anchor == AnchorPoint.CameraCenter)
        {
            // Full-screen layer (e.g. Maelstrom's storm): centred on the camera, never mirrored,
            // sorted above the arena's front decor and every lobster; HUD is a separate overlay canvas.
            var cam = Camera.main;
            Vector3 centre = cam != null ? new Vector3(cam.transform.position.x, cam.transform.position.y, 0f) : Vector3.zero;
            if (slot.delay > 0f) host.StartCoroutine(SpawnScreenAfterDelay(slot, centre));
            else SpawnScreen(slot, centre);
            return;
        }

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

    private static IEnumerator SpawnScreenAfterDelay(VfxSlot slot, Vector3 centre)
    {
        yield return new WaitForSeconds(slot.delay);
        SpawnScreen(slot, centre);
    }

    /// <summary>Fly a projectile slot's travel prefab from <paramref name="from"/> to <paramref name="to"/> at
    /// <c>slot.travelSpeed</c>. The prefab's looping clip plays for exactly the flight time (the loop's
    /// duration equals the caster→target distance), the sprite is mirrored for leftward flight and pitched
    /// along the path, and the projectile is destroyed on arrival. Yields until arrival.</summary>
    public static IEnumerator Fly(VfxSlot slot, Vector3 from, Vector3 to)
    {
        if (slot == null || slot.travelPrefab == null) yield break;
        Vector3 dir = to - from;
        float dist = dir.magnitude;
        float duration = Mathf.Max(0.12f, dist / Mathf.Max(0.5f, slot.travelSpeed));

        var fx = Instantiate(slot.travelPrefab, from, Quaternion.identity);
        // The sheet is authored flying right: mirror for leftward flight, then pitch along the path.
        float angle = dist > 0.001f ? Mathf.Atan2(dir.y, dir.x) * Mathf.Rad2Deg : 0f;
        if (dir.x < 0f)
        {
            var s = fx.transform.localScale;
            s.x = -s.x;
            fx.transform.localScale = s;
            angle -= 180f;
        }
        fx.transform.rotation = Quaternion.Euler(0f, 0f, angle);

        var group = fx.GetComponent<SortingGroup>();
        if (group == null) group = fx.AddComponent<SortingGroup>();
        group.sortingLayerName = DepthSort.Layer;
        group.sortingOrder = DepthSort.ArenaFrontOrderBase + 60; // crosses the board above lobsters and decor
        var oneShot = fx.GetComponent<OneShotVfx>();
        if (oneShot != null) Destroy(oneShot);   // lifetime is the flight, not the loop clip
        Destroy(fx, duration + 1f);               // safety net if the host coroutine dies mid-flight

        float t = 0f;
        while (t < duration)
        {
            t += Time.deltaTime;
            if (fx == null) yield break;
            fx.transform.position = Vector3.Lerp(from, to, Mathf.Clamp01(t / duration));
            yield return null;
        }
        if (fx != null) Destroy(fx);
    }

    private static GameObject SpawnScreen(VfxSlot slot, Vector3 centre)
    {
        var fx = Instantiate(slot.prefab, centre, Quaternion.identity);
        HideGuideChildren(fx, slot.hideChildrenPrefix);
        var group = fx.GetComponent<SortingGroup>();
        if (group == null) group = fx.AddComponent<SortingGroup>();
        group.sortingLayerName = DepthSort.Layer;
        group.sortingOrder = DepthSort.ArenaFrontOrderBase + 60;
        if (fx.GetComponent<OneShotVfx>() == null) fx.AddComponent<OneShotVfx>();
        return fx;
    }

    private static void HideGuideChildren(GameObject fx, string prefix)
    {
        if (string.IsNullOrEmpty(prefix)) return;
        foreach (var t in fx.GetComponentsInChildren<Transform>(true))
            if (t != fx.transform && t.name.StartsWith(prefix)) t.gameObject.SetActive(false);
    }

    private static void SpawnNow(VfxSlot slot, LobsterController owner, Vector3 position)
    {
        var fx = Instantiate(slot.prefab, position, Quaternion.identity);
        HideGuideChildren(fx, slot.hideChildrenPrefix);

        if (slot.mirrorWithFacing && owner.IsFacingLeft)
        {
            var s = fx.transform.localScale;
            s.x = -s.x;
            fx.transform.localScale = s;
        }

        // Sort just above the owner so effects never vanish behind their lobster; `onTop`
        // effects (per-target Special impacts) go above full-screen layers and front decor.
        var group = fx.GetComponent<SortingGroup>();
        if (group == null) group = fx.AddComponent<SortingGroup>();
        group.sortingLayerName = DepthSort.Layer;
        group.sortingOrder = slot.onTop ? DepthSort.ArenaFrontOrderBase + 61 : owner.SortingOrder + 1;

        if (fx.GetComponent<OneShotVfx>() == null) fx.AddComponent<OneShotVfx>();
    }
}
