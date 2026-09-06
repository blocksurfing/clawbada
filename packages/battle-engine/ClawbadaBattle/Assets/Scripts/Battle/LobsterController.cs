using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;

/// <summary>
/// Runtime driver for one spawned lobster rig. Owns hex position, facing, HP,
/// and animation playback. Controllers are added by BattleManager at spawn time.
///
/// Animation model: the per-class AnimatorControllers (AC_{Tier}_{Class}) contain
/// bare named states (Idle/Move/Die/Hit/Attack/Defense) with no parameters or
/// transitions — playback is driven entirely by CrossFade to state names.
/// Missing states (Evolved has no Defense; its Attack state has no motion yet)
/// degrade gracefully to Idle.
/// </summary>
public class LobsterController : MonoBehaviour
{
    // The rigs are authored facing screen-LEFT at identity; Y=180 mirrors them to
    // face right (user-confirmed live in play mode, 2026-07-17 — do not re-derive
    // this from screenshots). Team A spawns left and faces right (Y=180).
    private const float FaceRightY = 180f;
    private const float FaceLeftY = 0f;

    public string lobsterId;
    public string side; // "A" | "B"
    public int classId;
    public int col;
    public int row;
    public int maxHp;
    public int currentHp;
    public int moveRange;
    public bool alive = true;
    // HUD-facing state (set at spawn, kept in step by BattleManager.SyncUnits).
    public string className;
    public int tier;
    public int charge;
    public bool defending;
    public int[] partClassIds;
    public readonly List<StatusData> statuses = new();

    /// <summary>VFX bindings, assigned by BattleManager at spawn. May be null.</summary>
    [System.NonSerialized] public BattleVfxLibrary vfx;

    private Animator animator;
    private SortingGroup sortingGroup;
    private HexGrid grid;
    private Coroutine activeRoutine;
    private Transform attackFxAnchor;
    private Transform impactFxAnchor;

    /// <summary>Designer-authored FX anchors on the rig; fall back to the root.</summary>
    public Transform AttackFxAnchor => attackFxAnchor != null ? attackFxAnchor : transform;
    public Transform ImpactFxAnchor => impactFxAnchor != null ? impactFxAnchor : transform;

    /// <summary>Rigs face left at identity; Y=180 mirrors to face right.</summary>
    public bool IsFacingLeft => Mathf.Abs(Mathf.DeltaAngle(transform.localEulerAngles.y, FaceRightY)) > 90f;

    public int SortingOrder => sortingGroup != null ? sortingGroup.sortingOrder : 0;

    private static readonly int IdleHash = Animator.StringToHash("Idle");

    public void Setup(BattleLobsterData data, HexGrid hexGrid)
    {
        lobsterId = data.id;
        side = data.side;
        classId = data.classId;
        col = data.position.col;
        row = data.position.row;
        maxHp = data.maxHp;
        currentHp = data.currentHp;
        moveRange = data.moveRange;
        alive = data.alive;
        className = string.IsNullOrEmpty(data.className) ? LobsterClasses.Name(data.classId) : data.className;
        tier = data.tier;
        charge = data.charge;
        defending = false;
        partClassIds = data.partClassIds;
        statuses.Clear();
        grid = hexGrid;

        animator = GetComponent<Animator>();
        sortingGroup = GetComponent<SortingGroup>();
        if (sortingGroup == null) sortingGroup = gameObject.AddComponent<SortingGroup>();

        attackFxAnchor = FindDeep(transform, "AttackFX");
        impactFxAnchor = FindDeep(transform, "ImpactFX");

        transform.position = grid.GetWorldPosition(col, row);
        FaceEnemySide();
        UpdateSortingOrder();
        PlayState("Idle");
    }

    private static Transform FindDeep(Transform root, string name)
    {
        foreach (var t in root.GetComponentsInChildren<Transform>(true))
        {
            if (t.name == name) return t;
        }
        return null;
    }

    // ─── DNA visual composition ───

    // DNA body-part slot order (CLAUDE.md): 0 Carapace, 1 Claws, 2 Tail, 3 Antennae, 4 Eyes, 5 Legs.
    // Class names live in LobsterClasses (shared with the HUD and the demo loop).

    /// <summary>Swap body-part sprites to match dominant-gene class affinities.
    /// partClassIds has 6 entries in DNA slot order; parts whose class matches the
    /// host rig are left alone. Sprites keep the host skeleton's transforms, so
    /// cross-class parts inherit this rig's attachment points.</summary>
    public void ApplyGenetics(int[] partClassIds, int tier, LobsterPartLibrary partLibrary)
    {
        if (partClassIds == null || partClassIds.Length != 6 || partLibrary == null) return;

        foreach (var sr in GetComponentsInChildren<SpriteRenderer>(true))
        {
            if (sr.sprite == null) continue;
            int slot = PartSlotForName(sr.gameObject.name);
            if (slot < 0) continue;

            int classId = partClassIds[slot];
            if (classId < 0 || classId >= LobsterClasses.Names.Length) continue;

            var replacement = partLibrary.Get(tier, LobsterClasses.Names[classId], sr.sprite.name);
            if (replacement != null) sr.sprite = replacement;
        }
    }

    private static int PartSlotForName(string name)
    {
        switch (name)
        {
            case "Carapace": return 0;
            case "Claw_L":
            case "Claw_R":
            case "UpperArm_L":
            case "UpperArm_R": return 1;
            case "Tail": return 2;
            case "Antennae": return 3;
            case "Eyes": return 4;
        }
        if (name.StartsWith("Leg_")) return 5;
        return -1; // AttackFX / ImpactFX / unknown — not a DNA slot
    }

    // ─── Animation ───

    /// <summary>CrossFade to a named state if the controller has it; otherwise fall
    /// back to Idle. Returns true if the requested state existed.</summary>
    public bool PlayState(string stateName, float fade = 0.08f)
    {
        if (animator == null) return false;
        int hash = Animator.StringToHash(stateName);
        if (animator.HasState(0, hash))
        {
            animator.CrossFade(hash, fade);
            return true;
        }
        animator.CrossFade(IdleHash, fade);
        return false;
    }

    // ─── Facing & sorting ───

    /// <summary>Face toward the opposing team's side of the board.</summary>
    public void FaceEnemySide()
    {
        SetFacing(side == "A");
    }

    public void SetFacing(bool faceRight)
    {
        var e = transform.localEulerAngles;
        e.y = faceRight ? FaceRightY : FaceLeftY;
        transform.localEulerAngles = e;
    }

    /// <summary>Face toward a world position (only the horizontal component matters).</summary>
    public void FaceToward(Vector3 worldPos)
    {
        float dx = worldPos.x - transform.position.x;
        if (Mathf.Abs(dx) > 0.01f) SetFacing(dx > 0f);
    }

    private void UpdateSortingOrder()
    {
        // Depth is resolved per pixel by the camera's +Y transparency sort axis (see
        // DepthSort): every board actor — lobsters and obstacles — shares one layer and
        // order, and whoever's feet are lower on screen draws in front. The rig root
        // sits at the hex centre, so the SortingGroup sorts by the feet. Arena frame art
        // on the Foreground layer is lifted above actors by BattleManager.SwapArenaArt.
        if (sortingGroup != null)
        {
            sortingGroup.sortingLayerName = DepthSort.Layer;
            sortingGroup.sortingOrder = DepthSort.ActorOrder;
        }
    }

    // ─── Movement ───

    /// <summary>Walk to a hex cell-by-cell along a BFS path from HexGrid, playing the
    /// Move state during transit. Hopping through cell centers (instead of one straight
    /// world lerp) keeps the movement visibly locked to the board.</summary>
    public IEnumerator MoveTo(int toCol, int toRow, float secondsPerHex)
    {
        var path = grid.FindPath(col, row, toCol, toRow);
        if (path.Count == 0 && (col != toCol || row != toRow))
        {
            // Unreachable per the visual board — trust the server and hop directly.
            path.Add(new Vector2Int(toCol, toRow));
        }

        PlayState("Move");

        foreach (var step in path)
        {
            Vector3 start = transform.position;
            Vector3 end = grid.GetWorldPosition(step.x, step.y);
            FaceToward(end);
            BattleVfxLibrary.Spawn(vfx?.moveStep, this, null, this);

            float t = 0f;
            while (t < secondsPerHex)
            {
                t += Time.deltaTime;
                transform.position = Vector3.Lerp(start, end, Mathf.Clamp01(t / secondsPerHex));
                yield return null;
            }

            transform.position = end;
            col = step.x;
            row = step.y;
            UpdateSortingOrder();
        }

        FaceEnemySide();
        PlayState("Idle");
    }

    // ─── Combat visuals ───

    /// <summary>Attack read: face the target, play Attack (or Special-as-Attack),
    /// lunge toward it, and snap back. onImpact fires at the lunge apex so the
    /// target's hit reaction lines up with the swing. Melee (adjacent) attacks lunge
    /// most of the way into the target's hex so the exchange reads as contact;
    /// ranged attacks stay home with a short telegraph hop.</summary>
    public IEnumerator PlayAttack(Vector3 targetWorldPos, float duration, bool melee, System.Action onImpact)
    {
        FaceToward(targetWorldPos);
        PlayState("Attack");

        Vector3 start = transform.position;
        Vector3 apex = Vector3.Lerp(start, targetWorldPos, melee ? 0.7f : 0.12f);
        float half = duration * 0.5f;

        float t = 0f;
        while (t < half)
        {
            t += Time.deltaTime;
            transform.position = Vector3.Lerp(start, apex, Mathf.Clamp01(t / half));
            yield return null;
        }

        onImpact?.Invoke();

        t = 0f;
        while (t < half)
        {
            t += Time.deltaTime;
            transform.position = Vector3.Lerp(apex, start, Mathf.Clamp01(t / half));
            yield return null;
        }

        transform.position = start;
        FaceEnemySide();
        PlayState("Idle");
    }

    /// <summary>Defend read: play the Defense stance (falls back to Idle on Evolved,
    /// which has no Defense state yet).</summary>
    public void PlayDefend()
    {
        PlayState("Defense");
        BattleVfxLibrary.Spawn(vfx?.defend, this, null, this);
    }

    /// <summary>Hit reaction: turn to face the attacker, flinch, then back to Idle
    /// (unless dead by then) and re-face the enemy side.</summary>
    public IEnumerator PlayHit(float duration, Vector3 attackerWorldPos)
    {
        FaceToward(attackerWorldPos);
        PlayState("Hit");
        yield return new WaitForSeconds(duration);
        if (alive)
        {
            FaceEnemySide();
            PlayState("Idle");
        }
    }

    public void ApplyDamage(int amount)
    {
        currentHp = Mathf.Max(0, currentHp - amount);
    }

    public void ApplyHeal(int amount)
    {
        currentHp = Mathf.Min(maxHp, currentHp + amount);
    }

    /// <summary>Server truth for this unit (hp/alive/charge/defending/statuses/cell) after a
    /// turn has been animated. Position snaps only when asked (a previewed move keeps its
    /// tentative cell). A unit the server says is dead is dimmed immediately.</summary>
    public void ApplySync(UnitSyncData u, bool snapPosition)
    {
        if (u == null) return;
        if (u.maxHp > 0) maxHp = u.maxHp;
        currentHp = Mathf.Clamp(u.hp, 0, maxHp);
        charge = u.charge;
        defending = u.defending;
        statuses.Clear();
        if (u.statuses != null)
        {
            foreach (var s in u.statuses) if (s != null && !string.IsNullOrEmpty(s.type)) statuses.Add(s);
        }
        if (snapPosition && grid != null && (col != u.col || row != u.row))
        {
            col = u.col;
            row = u.row;
            transform.position = grid.GetWorldPosition(col, row);
            UpdateSortingOrder();
        }
        if (!u.alive && alive)
        {
            alive = false;
            Dim();
        }
    }

    /// <summary>Optimistic status update from a turn's status events (SyncUnits corrects it).</summary>
    public void SetStatus(string type, bool applied, int turns)
    {
        statuses.RemoveAll(s => s.type == type);
        if (applied) statuses.Add(new StatusData { type = type, turns = turns });
    }

    private void Dim()
    {
        foreach (var sr in GetComponentsInChildren<SpriteRenderer>())
        {
            sr.color = new Color(0.55f, 0.55f, 0.55f, 0.9f);
        }
    }

    /// <summary>Death: play Die and stay on its final frame as a corpse.</summary>
    public IEnumerator PlayDeath(float duration)
    {
        alive = false;
        PlayState("Die");
        BattleVfxLibrary.Spawn(vfx?.death, this, null, this);
        yield return new WaitForSeconds(duration);
        // Corpse stays visible; dim it so live lobsters read clearly.
        Dim();
    }

    // ─── Coroutine ownership (one visual routine at a time per lobster) ───

    public void RunRoutine(MonoBehaviour host, IEnumerator routine)
    {
        if (activeRoutine != null) host.StopCoroutine(activeRoutine);
        activeRoutine = host.StartCoroutine(routine);
    }
}
