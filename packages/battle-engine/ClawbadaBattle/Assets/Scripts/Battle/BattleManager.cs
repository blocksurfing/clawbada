using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;

/// <summary>
/// Battle state machine. Manages phases, rounds, timing, and lobster state.
/// Receives commands from BattleBridge, drives HexGrid and LobsterControllers.
///
/// Playback layer only: the server is authoritative for all combat math. This
/// class consumes already-resolved results (spawn data, round results, deaths)
/// and renders them — spawn prefabs, tween movement, CrossFade animation states,
/// then report back via BattleBridge.NotifyTurnAnimationComplete so React advances.
/// V3: one lobster acts per turn (ATB). PlayTurn animates a resolved turn — move
/// path, action with every damage/heal event at the impact frame, then deaths.
/// The V2 PlayRound path is kept only for the editor demo loop (BattleDemoLoop).
/// </summary>
public class BattleManager : MonoBehaviour
{
    public enum BattlePhase
    {
        WaitingForInit,
        Idle,            // waiting for the next turn payload
        AnimatingTurn,   // PlayTurn in progress
        AnimatingRound,  // editor demo loop only
        BattleOver,
    }

    [Header("State")]
    public BattlePhase currentPhase = BattlePhase.WaitingForInit;
    public int currentTurn = 0;
    public string activeLobsterId = "";
    /// <summary>Remaining shot clock in ms, mirrored from React's SetClock (visual cues only).</summary>
    public int clockRemainingMs = 0;
    public BarEntryData[] upcoming = new BarEntryData[0];
    /// <summary>The turn most recently announced by StartTurn (null before the first).</summary>
    public TurnStartData activeTurn;
    public bool isPlayerTurn;
    public string PlayerSide => initData?.playerSide ?? "";
    public BattleInitData InitData => initData;
    public IEnumerable<LobsterController> Lobsters => lobsters.Values;
    /// <summary>In-canvas HUD, attached in Awake when a HudSkin exists (see BattleHud.Attach).</summary>
    public BattleHud hud;

    // HUD hooks. BattleHud subscribes; every invocation is null-safe so a build without
    // generated HUD art still plays (React's fallback HUD covers it).
    public event Action<BattleInitData> Initialized;
    /// <summary>(turn data, fallback remaining ms computed from deadlineMs — 0 when unknown).</summary>
    public event Action<TurnStartData, int> TurnStarted;
    public event Action<BarData> BarUpdated;
    public event Action<int> ClockSet;
    public event Action<UnitsSyncData> UnitsSynced;
    /// <summary>(target, amount, kind, isCrit) at the impact frame.</summary>
    public event Action<LobsterController, int, string, bool> DamageApplied;
    public event Action<LobsterController, int> HealApplied;
    /// <summary>(target, status, applied, turns).</summary>
    public event Action<LobsterController, string, bool, int> StatusChanged;
    public event Action<LobsterController> Died;
    public event Action<BattleEndData> BattleEnded;
    public event Action<SelectionData> SelectionChanged;
    /// <summary>(lobster, col, row) after a tentative move (or the return to origin).</summary>
    public event Action<LobsterController, int, int> PreviewMoved;

    /// <summary>React's current turn-building state (null outside a player turn).</summary>
    public SelectionData selection;
    private string previewActorId;
    private int previewOriginCol, previewOriginRow;
    private Coroutine previewRoutine;

    [Header("Prefabs")]
    [Tooltip("Tier+class → rigged lobster prefab. Rebuild via Clawbada/Rebuild Lobster Prefab Library.")]
    public LobsterPrefabLibrary prefabLibrary;
    [Tooltip("Tier+class+part → sprite, for DNA-driven part composition. Rebuild via Clawbada/Rebuild Lobster Part Library.")]
    public LobsterPartLibrary partLibrary;

    [Header("VFX")]
    [Tooltip("Designer VFX bindings. Rebuild prefabs + asset via Clawbada/Rebuild Generic VFX Prefabs.")]
    public BattleVfxLibrary vfxLibrary;

    [Header("Arena Art (designer prefabs, swapped by arena.tier)")]
    public GameObject arenaArtEvolved;
    public GameObject arenaArtElite;
    public GameObject arenaArtApex;
    [Tooltip("The arena art instance already placed in the scene (edit-mode preview). Replaced at battle init by the tier's prefab.")]
    public GameObject initialArenaArt;

    private GameObject arenaArtInstance;

    [Tooltip("Uniform shrink applied to the arena's decorative Foreground-layer art, so the boards read less " +
             "crowded. Each layer is scaled about the frame edge its painted content is welded to (see " +
             "ArenaDecorAnchors), never about the camera centre — centre-scaling a full-frame layer pulls the art " +
             "off the edges and leaves it floating. A layer whose content spans an axis is not scaled on that axis.")]
    public float decorScale = 0.8f;

    [Header("Animation Timing")]
    [Tooltip("Seconds to cross one hex. Playtest 2026-09-11: halved from the original 0.35 (→ 0.467 → 0.7); " +
             "the Move state speed in every rig controller is scaled to match (now 0.5), so the walk cycle " +
             "does not skate. The value that ships is the one serialized in BattleScene, not this default.")]
    public float secondsPerHexMove = 0.7f;
    public float attackDuration = 0.55f;
    public float hitDuration = 0.45f;
    public float deathDuration = 0.9f;
    public float delayBetweenActions = 0.2f;

    // Battle data
    private BattleInitData initData;
    private HexGrid hexGrid;
    private BattleBridge bridge;
    private readonly Dictionary<string, LobsterController> lobsters = new();
    private Transform lobsterRoot;
    private Coroutine turnRoutine;

    void Awake()
    {
        hexGrid = FindAnyObjectByType<HexGrid>();
        bridge = FindAnyObjectByType<BattleBridge>();
        // Live input: the click router lives on the HexGrid object. Attach it at runtime so a
        // scene edit (designer's unity-setup port, prefab rebuild) can never drop it silently —
        // without it, board clicks never reach React and the HUD cannot pick moves or targets.
        if (hexGrid != null && hexGrid.GetComponent<HexInput>() == null)
        {
            hexGrid.gameObject.AddComponent<HexInput>();
        }
        // In-canvas HUD, same runtime-attach pattern (no scene wiring to lose).
        if (hud == null) hud = GetComponent<BattleHud>();
        if (hud == null) hud = BattleHud.Attach(this);
    }

    /// <summary>Initialize battle with full data from React.</summary>
    public void Initialize(BattleInitData data)
    {
        // Awake does not run in edit mode (HUD smoke test): resolve scene refs lazily.
        if (hexGrid == null) hexGrid = FindAnyObjectByType<HexGrid>();
        if (bridge == null) bridge = FindAnyObjectByType<BattleBridge>();
        initData = data;
        currentPhase = BattlePhase.WaitingForInit;
        Debug.Log($"[BattleManager] Initialized battle {data.battleId}, player side: {data.playerSide}, tier: {data.arena.tier}");

        SwapArenaArt(data.arena.tier);
        ClearLobsters();
        if (lobsterRoot == null)
        {
            lobsterRoot = new GameObject("Lobsters").transform;
            lobsterRoot.SetParent(transform, false);
        }

        SpawnTeam(data.teamA);
        SpawnTeam(data.teamB);
        currentTurn = 0;
        activeLobsterId = "";
        activeTurn = null;
        isPlayerTurn = false;
        ClearPreview();
        currentPhase = BattlePhase.Idle;
        Initialized?.Invoke(data);
    }

    /// <summary>Replace the arena backdrop with the tier's designer prefab
    /// (Evolved: beach, Elite: deep-sea, Apex: volcanic). Unknown/missing tier art
    /// keeps whatever is currently showing.</summary>
    private void SwapArenaArt(string tier)
    {
        GameObject prefab = (tier ?? "").ToLowerInvariant() switch
        {
            "evolved" => arenaArtEvolved,
            "elite" => arenaArtElite,
            "apex" => arenaArtApex,
            _ => null,
        };
        if (prefab == null)
        {
            Debug.LogWarning($"[BattleManager] No arena art prefab for tier '{tier}' — keeping current backdrop.");
            return;
        }

        if (arenaArtInstance != null) SafeDestroy(arenaArtInstance);
        if (initialArenaArt != null) { SafeDestroy(initialArenaArt); initialArenaArt = null; }
        arenaArtInstance = Instantiate(prefab);
        arenaArtInstance.name = prefab.name;

        LiftFrameArt(arenaArtInstance.GetComponentsInChildren<SpriteRenderer>(true), tier);

        // The arena prefabs aren't authored around a common origin (Evolved bakes in
        // the camera's y=1 offset, Apex is centered at zero). Center the combined
        // sprite bounds on the camera so every arena fills the frame.
        var cam = Camera.main;
        if (cam != null)
        {
            // Centre on the backdrop (Background sorting layer) only: foreground frame art
            // hangs below the frame and would pull the whole arena down.
            var renderers = arenaArtInstance.GetComponentsInChildren<SpriteRenderer>();
            var frame = new List<SpriteRenderer>();
            foreach (var r in renderers) if (r.sortingLayerName == "Background") frame.Add(r);
            if (frame.Count == 0) frame.AddRange(renderers);
            var dbg = new System.Text.StringBuilder();
            foreach (var r in renderers) dbg.Append($" {r.name}[{r.sortingLayerName}/{r.sortingOrder}] c=({r.bounds.center.x:F2},{r.bounds.center.y:F2}) s=({r.bounds.size.x:F2},{r.bounds.size.y:F2});");
            Debug.Log($"[BattleManager] arena '{prefab.name}' cam=({cam.transform.position.x:F2},{cam.transform.position.y:F2}) ortho={cam.orthographicSize:F3} aspect={cam.aspect:F3} renderers:{dbg}");
            if (frame.Count > 0)
            {
                var bounds = frame[0].bounds;
                foreach (var r in frame) bounds.Encapsulate(r.bounds);
                Vector3 shift = new Vector3(cam.transform.position.x, cam.transform.position.y, 0f)
                                - new Vector3(bounds.center.x, bounds.center.y, 0f);
                arenaArtInstance.transform.position += shift;
            }

            ShrinkDecor(renderers, tier);
        }
    }

    /// <summary>Decide which Foreground arena layers draw in front of the lobsters.
    ///
    /// Only the bottom lip of the frame belongs in front: the plants and rocks a lobster on the
    /// front row should stand behind. Art that climbs the sides — Apex's cliff walls, Evolved's
    /// rock columns — must stay behind the actors, or it clips the lobsters spawned in the
    /// outer columns (visible on Apex: the right-hand team disappeared into the cliff).
    ///
    /// A layer is "bottom lip" when its painted content stops below FrontBandTop of the frame,
    /// measured from the baked content boxes — the sprites are all full-frame canvases, so
    /// there is nothing else to go on. Layers with no baked box keep the old behaviour (in
    /// front), which is the safe default for a designer's new bottom-edge art.</summary>
    private void LiftFrameArt(SpriteRenderer[] renderers, string tier)
    {
        const float FrontBandTop = 0.6f;
        var anchors = Resources.Load<ArenaDecorAnchors>(ArenaDecorAnchors.ResourcePath);
        var front = new List<string>();
        var behind = new List<string>();
        foreach (var r in renderers)
        {
            if (r.sortingLayerName != DepthSort.Layer || r.sortingOrder >= DepthSort.ArenaFrontOrderBase) continue;
            var box = r.sprite != null && anchors != null ? anchors.For(tier, r.sprite.name) : null;
            bool bottomLip = box == null || box.Value.w <= FrontBandTop;
            if (bottomLip)
            {
                r.sortingOrder += DepthSort.ArenaFrontOrderBase;
                front.Add(r.name);
            }
            else
            {
                behind.Add($"{r.name}(top {box.Value.w:F2})");
            }
        }
        Debug.Log($"[BattleManager] arena '{tier}' frame art in front: [{string.Join(", ", front)}] behind actors: [{string.Join(", ", behind)}]");
    }

    /// <summary>Shrink the arena's decorative Foreground art so the board reads less crowded.
    ///
    /// Every layer is a full-frame canvas, so the sprite's bounds say nothing about what is
    /// painted in it — the content box comes from ArenaDecorAnchors. Each layer is scaled about
    /// the edge its content is welded to: a rock ledge along the bottom shrinks downward and
    /// stays glued to the bottom of the frame, a clam at the left shrinks toward the left. An
    /// axis whose content spans the whole canvas is left at full size, because shrinking it
    /// would pull the art in from both edges — that is the "floating decor" this replaces.
    /// Backdrop and ground (Background / Default layers) are never touched: the hex grid is
    /// aligned to them.</summary>
    private void ShrinkDecor(SpriteRenderer[] renderers, string tier)
    {
        if (Mathf.Approximately(decorScale, 1f) || decorScale <= 0f) return;
        var anchors = Resources.Load<ArenaDecorAnchors>(ArenaDecorAnchors.ResourcePath);
        if (anchors == null)
        {
            Debug.LogWarning("[BattleManager] no Resources/ArenaDecorAnchors — decor left at full size. " +
                             "Run Clawbada/Arena/Bake Decor Anchors.");
            return;
        }

        const float Tol = 0.01f;   // content within 1 % of an edge counts as touching it
        foreach (var r in renderers)
        {
            if (r.sortingLayerName != "Foreground" || r.sprite == null) continue;
            var box = anchors.For(tier, r.sprite.name);
            if (box == null) { Debug.LogWarning($"[BattleManager] no baked content box for '{tier}/{r.sprite.name}' — left at full size."); continue; }

            Vector4 c = box.Value;                       // fractions of the canvas, y up
            bool spansX = c.x <= Tol && c.z >= 1f - Tol;
            bool spansY = c.y <= Tol && c.w >= 1f - Tol;
            float sx = spansX ? 1f : decorScale;
            float sy = spansY ? 1f : decorScale;
            if (Mathf.Approximately(sx, 1f) && Mathf.Approximately(sy, 1f)) continue;

            // Anchor on the touched edge; fall back to the content's own centre (x) or its
            // base (y), so a free-standing prop shrinks in place instead of drifting upward.
            float nx = (c.x <= Tol && c.z < 1f - Tol) ? c.x : (c.z >= 1f - Tol && c.x > Tol) ? c.z : (c.x + c.z) * 0.5f;
            float ny = (c.y <= Tol && c.w < 1f - Tol) ? c.y : (c.w >= 1f - Tol && c.y > Tol) ? c.w : c.y;

            var b = r.bounds;                            // the whole canvas, in world units
            float ax = b.min.x + nx * b.size.x;
            float ay = b.min.y + ny * b.size.y;
            var t = r.transform;
            Vector3 p = t.position;
            t.position = new Vector3(ax + (p.x - ax) * sx, ay + (p.y - ay) * sy, p.z);
            t.localScale = new Vector3(t.localScale.x * sx, t.localScale.y * sy, t.localScale.z);
        }
    }

    private void SpawnTeam(BattleLobsterData[] team)
    {
        if (team == null) return;
        foreach (var lob in team)
        {
            if (lob == null || string.IsNullOrEmpty(lob.id)) continue;
            if (prefabLibrary == null)
            {
                Debug.LogError("[BattleManager] prefabLibrary not assigned — cannot spawn lobsters.");
                return;
            }

            var prefab = prefabLibrary.Get(lob.tier, lob.className);
            if (prefab == null)
            {
                Debug.LogError($"[BattleManager] No prefab for tier={lob.tier} class={lob.className} (lobster {lob.id})");
                continue;
            }

            var go = Instantiate(prefab, lobsterRoot);
            go.name = $"Lobster_{lob.side}{lob.slot}_{lob.className}_{lob.id}";
            var controller = go.AddComponent<LobsterController>();
            controller.Setup(lob, hexGrid);
            controller.vfx = vfxLibrary;
            if (lob.partClassIds != null && lob.partClassIds.Length == 6)
            {
                controller.ApplyGenetics(lob.partClassIds, lob.tier, partLibrary);
            }
            lobsters[lob.id] = controller;

            Debug.Log($"[BattleManager] Spawned {go.name} at ({lob.position.col},{lob.position.row})");
        }
    }

    /// <summary>A lobster's turn started (server-authoritative). Faces the actor toward the
    /// enemy side and raises TurnStarted for the HUD (marker, active panel, clock).
    /// Highlights come from React via ShowSelection.</summary>
    public void StartTurn(TurnStartData data)
    {
        currentTurn = data.turn;
        activeLobsterId = data.lobsterId ?? "";
        activeTurn = data;
        isPlayerTurn = data.isPlayer;
        if (previewActorId != null && previewActorId != activeLobsterId) UndoPreview();
        if (lobsters.TryGetValue(activeLobsterId, out var lob) && lob.alive) lob.FaceEnemySide();
        if (currentPhase != BattlePhase.AnimatingTurn && currentPhase != BattlePhase.BattleOver) currentPhase = BattlePhase.Idle;

        // Fallback clock from the epoch deadline; React normally follows up with SetClock.
        int fallbackMs = 0;
        if (data.isPlayer && data.deadlineMs > 0 && PlayerSide != "spectator")
        {
            long now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            fallbackMs = (int)Math.Max(0, Math.Min(int.MaxValue, data.deadlineMs - now));
        }
        TurnStarted?.Invoke(data, fallbackMs);
    }

    public void UpdateBar(BarData data)
    {
        upcoming = data?.entries ?? new BarEntryData[0];
        BarUpdated?.Invoke(data);
    }

    public void SetClock(int remainingMs)
    {
        clockRemainingMs = remainingMs;
        ClockSet?.Invoke(remainingMs);
    }

    public void SetSelection(SelectionData data)
    {
        selection = data;
        SelectionChanged?.Invoke(data);
    }

    /// <summary>Tentative move for the acting lobster: walk to the cell (half speed); a
    /// cell equal to the origin walks back and clears the preview. The server's resolved
    /// turn (PlayTurn) reconciles: same destination → no extra walk, otherwise snap home
    /// first.</summary>
    public void PreviewMove(PreviewMoveData data)
    {
        if (data == null || !lobsters.TryGetValue(data.lobsterId ?? "", out var lob) || !lob.alive) return;
        if (currentPhase == BattlePhase.AnimatingTurn) return;
        if (previewActorId != data.lobsterId)
        {
            if (previewActorId != null) UndoPreview();
            previewActorId = data.lobsterId;
            previewOriginCol = lob.col;
            previewOriginRow = lob.row;
        }
        bool toOrigin = data.col == previewOriginCol && data.row == previewOriginRow;
        if (lob.col == data.col && lob.row == data.row)
        {
            if (toOrigin) previewActorId = null;
            return;
        }
        if (previewRoutine != null) StopCoroutine(previewRoutine);
        Debug.Log($"[BattleManager] PreviewMove {data.lobsterId} → ({data.col},{data.row}){(toOrigin ? " (origin)" : "")}");
        previewRoutine = StartCoroutine(PreviewRoutine(lob, data.col, data.row, toOrigin));
    }

    private IEnumerator PreviewRoutine(LobsterController lob, int col, int row, bool toOrigin)
    {
        yield return lob.MoveTo(col, row, secondsPerHexMove * 0.5f);
        previewRoutine = null;
        if (toOrigin) previewActorId = null;
        PreviewMoved?.Invoke(lob, col, row);
    }

    /// <summary>Snap a previewed lobster back to where the server thinks it stands.</summary>
    private void UndoPreview()
    {
        if (previewActorId == null) return;
        if (previewRoutine != null) { StopCoroutine(previewRoutine); previewRoutine = null; }
        if (lobsters.TryGetValue(previewActorId, out var lob) && lob.alive) lob.SnapTo(previewOriginCol, previewOriginRow);
        previewActorId = null;
    }

    private void ClearPreview()
    {
        if (previewRoutine != null) { StopCoroutine(previewRoutine); previewRoutine = null; }
        previewActorId = null;
    }

    /// <summary>Server truth for every unit, applied after React has consumed the animated
    /// turn. If React's watchdog already released the HUD while an animation is still
    /// running, stop it and snap to the synced state.</summary>
    public void SyncUnits(UnitsSyncData data)
    {
        if (data == null) return;
        if (currentPhase == BattlePhase.AnimatingTurn && turnRoutine != null)
        {
            StopCoroutine(turnRoutine);
            turnRoutine = null;
            currentPhase = BattlePhase.Idle;
        }
        if (data.units != null)
        {
            foreach (var u in data.units)
            {
                if (u != null && lobsters.TryGetValue(u.lobsterId ?? "", out var lob)) lob.ApplySync(u, snapPosition: u.lobsterId != previewActorId);
            }
        }
        UnitsSynced?.Invoke(data);
    }

    /// <summary>Animate one resolved turn, then tell React so it can send the next.</summary>
    public void PlayTurn(TurnPlayData data)
    {
        currentPhase = BattlePhase.AnimatingTurn;
        currentTurn = data.turn;
        turnRoutine = StartCoroutine(PlayTurnRoutine(data));
    }

    private IEnumerator PlayTurnRoutine(TurnPlayData data)
    {
        // React holds every later turn until NotifyTurnAnimationComplete arrives, so this
        // callback must fire even if a prefab/animation step throws — otherwise the HUD
        // locks for the rest of the battle. C# allows yields inside try/finally.
        try
        {
            yield return PlayTurnBody(data);
        }
        finally
        {
            turnRoutine = null;
            if (currentPhase != BattlePhase.BattleOver) currentPhase = BattlePhase.Idle;
            bridge?.NotifyTurnAnimationComplete(data.turn);
        }
    }

    private IEnumerator PlayTurnBody(TurnPlayData data)
    {
        hexGrid?.ClearHighlights();
        lobsters.TryGetValue(data.lobsterId ?? "", out var actor);

        // Reconcile a tentative move with the server's resolved one: already standing on
        // the resolved destination → skip the walk; anything else → snap home first.
        bool skipMove = false;
        if (actor != null && previewActorId == actor.lobsterId)
        {
            bool endsHere = data.path != null && data.path.Length > 0
                && data.path[data.path.Length - 1].col == actor.col && data.path[data.path.Length - 1].row == actor.row;
            if (endsHere) { if (previewRoutine != null) { StopCoroutine(previewRoutine); previewRoutine = null; } previewActorId = null; skipMove = true; }
            else UndoPreview();
        }
        else if (previewActorId != null)
        {
            UndoPreview();
        }

        // 1. Movement along the server's path (cell-by-cell hops).
        if (!skipMove && actor != null && data.path != null && data.path.Length > 0)
        {
            var last = data.path[data.path.Length - 1];
            yield return actor.MoveTo(last.col, last.row, secondsPerHexMove);
            yield return new WaitForSeconds(delayBetweenActions * 0.5f);
        }

        // 2. Action. Every damage/heal event lands at the impact frame; secondary kinds
        //    (counter / reflect / bleed / self) play as hit reads after the primary.
        bool isSkip = !string.IsNullOrEmpty(data.skipped) || string.IsNullOrEmpty(data.action) || data.action == "none";
        if (actor != null && !isSkip)
        {
            switch (data.action)
            {
                case "defend":
                    actor.PlayDefend();
                    actor.defending = true;
                    ApplyTurnEvents(data, actor, actor.transform.position, primaryOnly: false, includePrimary: true);
                    ApplyStatusEvents(data);
                    yield return new WaitForSeconds(hitDuration);
                    break;

                case "attack":
                case "special":
                    {
                        lobsters.TryGetValue(data.targetId ?? "", out var target);
                        Vector3 targetPos = target != null ? target.transform.position : actor.transform.position;
                        Vector3 actorPos = actor.transform.position;
                        bool melee = target == null || HexCoord.Distance(actor.col, actor.row, target.col, target.row) <= 1;
                        bool special = data.action == "special";
                        var windup = special
                            ? vfxLibrary != null ? vfxLibrary.SpecialFor(actor.classId) : null
                            : vfxLibrary != null ? vfxLibrary.attackWindup : null;
                        var impactSlot = special && vfxLibrary != null ? vfxLibrary.SpecialImpactFor(actor.classId) : null;
                        if (target != null && target != actor) actor.FaceToward(targetPos); // so a mirrored windup faces the target
                        BattleVfxLibrary.Spawn(windup, actor, target, this);

                        if (special && windup != null && windup.IsProjectile)
                        {
                            // Projectile Special (Inferno): the formation effect plays at the caster's claws
                            // while it casts; at `launchAt` the projectile flies to the target at a fixed
                            // speed (its travel loop lasts exactly the flight); the per-target impact spawns
                            // on arrival and damage / hit reads land on its burst frame (`impactLead`).
                            float t0 = Time.time;
                            Vector3 from = actor.AttackFxAnchor.position;
                            // Land on the impact's own anchor, so a spirit bound to TargetBody is
                            // absorbed into the body instead of stopping at the target's feet.
                            Vector3 to = target != null
                                ? BattleVfxLibrary.AnchorPosition(impactSlot, actor, target, target.ImpactFxAnchor.position)
                                : from + (actor.IsFacingLeft ? Vector3.left : Vector3.right) * 2f;
                            float flight = Vector3.Distance(from, to) / Mathf.Max(0.5f, windup.travelSpeed);
                            Debug.Log($"[BattleManager] special {actor.className} projectile launchAt={windup.launchAt:F2}s dist={Vector3.Distance(from, to):F2} flight={flight:F2}s impactLead={windup.impactLead:F2}s");
                            StartCoroutine(actor.PlayAttack(targetPos, attackDuration, false, null));
                            float untilLaunch = windup.launchAt - (Time.time - t0);
                            if (untilLaunch > 0f) yield return new WaitForSeconds(untilLaunch);
                            yield return BattleVfxLibrary.Fly(windup, from, to);
                            if (target != null) BattleVfxLibrary.Spawn(impactSlot, actor, target, this);
                            if (windup.impactLead > 0f) yield return new WaitForSeconds(windup.impactLead);
                            ApplyTurnEvents(data, actor, actorPos, primaryOnly: true, includePrimary: false, impactSlot: impactSlot, spawnImpactFx: false);
                            ApplyTurnEvents(data, actor, actorPos, primaryOnly: false);
                            ApplyStatusEvents(data);
                            float impactClip = impactSlot != null ? BattleVfxLibrary.ClipLength(impactSlot.prefab) : 0f;
                            yield return new WaitForSeconds(Mathf.Max(hitDuration * 0.5f, impactClip - windup.impactLead - 0.15f));
                        }
                        else if (special && windup != null && windup.prefab != null && windup.impactAt > 0f)
                        {
                            // Cinematic Special (e.g. Maelstrom): the effect owns the timing. The caster
                            // plays its cast swing now; damage, hit reads and per-target impacts land at
                            // the effect's impact beat; the turn holds until the effect is nearly done.
                            float clip = BattleVfxLibrary.ClipLength(windup.prefab);
                            float t0 = Time.time;
                            Debug.Log($"[BattleManager] special {actor.className} effect clip={clip:F2}s impactAt={windup.impactAt:F2}s");
                            yield return actor.PlayAttack(actorPos, attackDuration, false, null);
                            float untilImpact = windup.impactAt - (Time.time - t0);
                            if (untilImpact > 0f) yield return new WaitForSeconds(untilImpact);
                            ApplyTurnEvents(data, actor, actorPos, primaryOnly: true, includePrimary: false, impactSlot: impactSlot);
                            ApplyTurnEvents(data, actor, actorPos, primaryOnly: false);
                            ApplyStatusEvents(data);
                            float untilEnd = Mathf.Max(hitDuration * 0.5f, clip - 0.8f - (Time.time - t0));
                            yield return new WaitForSeconds(untilEnd);
                        }
                        else
                        {
                            yield return actor.PlayAttack(targetPos, attackDuration, melee, () =>
                            {
                                // Basic attacks only: a Special's cast swing runs through PlayAttack too,
                                // and it gets its own sound once those land rather than the attack one.
                                if (!special) BattleSfx.PlayAttack(actor.classId);
                                ApplyTurnEvents(data, actor, actorPos, primaryOnly: true, includePrimary: false, impactSlot: impactSlot);
                            });
                            // Secondary events (counter hits on the actor, reflects, bleed ticks).
                            ApplyTurnEvents(data, actor, actorPos, primaryOnly: false);
                            ApplyStatusEvents(data);
                            yield return new WaitForSeconds(hitDuration * 0.5f);
                        }
                    }
                    break;

                default:
                    Debug.LogWarning($"[BattleManager] Unknown action '{data.action}' from {data.lobsterId}");
                    break;
            }
        }
        else if (actor != null && data.damage != null && data.damage.Length > 0)
        {
            // Skipped turn that still carried events (bleed tick on a stunned/dying lobster).
            ApplyTurnEvents(data, actor, actor.transform.position, primaryOnly: false, includePrimary: true);
            ApplyStatusEvents(data);
            yield return new WaitForSeconds(hitDuration);
        }
        else
        {
            ApplyStatusEvents(data);
        }

        // 3. Deaths (server-authoritative list).
        if (data.deaths != null && data.deaths.Length > 0)
        {
            foreach (var deadId in data.deaths)
            {
                if (lobsters.TryGetValue(deadId, out var lob) && lob.alive)
                {
                    StartCoroutine(lob.PlayDeath(deathDuration));
                    Died?.Invoke(lob);
                }
            }
            yield return new WaitForSeconds(deathDuration);
        }
    }

    /// <summary>Status effects applied/expired by this turn (optimistic; SyncUnits corrects).</summary>
    private void ApplyStatusEvents(TurnPlayData data)
    {
        if (data.statuses == null) return;
        foreach (var s in data.statuses)
        {
            if (s == null || !lobsters.TryGetValue(s.targetId ?? "", out var t)) continue;
            t.SetStatus(s.status, s.applied, s.turns);
            StatusChanged?.Invoke(t, s.status, s.applied, s.turns);
        }
    }

    /// <summary>Apply a turn's damage/heal events to the affected controllers with hit reads.
    /// Primary = the actor's own attack/special hits (played at the impact frame);
    /// secondary = counter/reflect/bleed/self events (played right after).</summary>
    private void ApplyTurnEvents(TurnPlayData data, LobsterController actor, Vector3 actorPos, bool primaryOnly, bool includePrimary = false, BattleVfxLibrary.VfxSlot impactSlot = null, bool spawnImpactFx = true)
    {
        if (data.heals != null && (primaryOnly || includePrimary))
        {
            foreach (var h in data.heals)
            {
                if (h == null || !lobsters.TryGetValue(h.targetId ?? "", out var t)) continue;
                t.ApplyHeal(h.amount);
                HealApplied?.Invoke(t, h.amount);
                BattleVfxLibrary.Spawn(vfxLibrary?.status, actor, t, this);
            }
        }
        if (data.damage == null) return;
        foreach (var d in data.damage)
        {
            if (d == null || !lobsters.TryGetValue(d.targetId ?? "", out var t)) continue;
            bool primary = d.kind == "attack" || d.kind == "special";
            if (primaryOnly && !primary) continue;
            if (!primaryOnly && primary && !includePrimary) continue;
            t.ApplyDamage(d.amount);
            DamageApplied?.Invoke(t, d.amount, d.kind, d.isCrit);
            if (spawnImpactFx || !primary) BattleVfxLibrary.Spawn(primary && impactSlot != null ? impactSlot : vfxLibrary?.attackImpact, actor, t, this);
            Vector3 from = t == actor ? t.transform.position + Vector3.right : actorPos;
            StartCoroutine(t.PlayHit(hitDuration, from));
        }
    }

    /// <summary>Play a round's results — animate movements then combat.</summary>
    public void PlayRound(RoundResult result)
    {
        currentPhase = BattlePhase.AnimatingRound;
        Debug.Log($"[BattleManager] Playing round {result.round}: {result.movements?.Length ?? 0} moves, {result.actions?.Length ?? 0} actions");
        StartCoroutine(PlayRoundRoutine(result));
    }

    private IEnumerator PlayRoundRoutine(RoundResult result)
    {
        hexGrid?.ClearHighlights();

        // 1. Movements, one at a time (turn-based reads clearer than simultaneous).
        if (result.movements != null)
        {
            foreach (var move in result.movements)
            {
                if (move == null || !lobsters.TryGetValue(move.lobsterId, out var lob)) continue;
                yield return lob.MoveTo(move.to.col, move.to.row, secondsPerHexMove);
                yield return new WaitForSeconds(delayBetweenActions * 0.5f);
            }
        }

        // 2. Combat actions in server order.
        if (result.actions != null)
        {
            foreach (var action in result.actions)
            {
                if (action == null) continue;
                yield return PlayActionRoutine(action);
                yield return new WaitForSeconds(delayBetweenActions);
            }
        }

        // 3. Deaths (server-authoritative list; HP application already happened per action).
        if (result.deaths != null && result.deaths.Length > 0)
        {
            foreach (var deadId in result.deaths)
            {
                if (lobsters.TryGetValue(deadId, out var lob) && lob.alive)
                {
                    StartCoroutine(lob.PlayDeath(deathDuration));
                }
            }
            yield return new WaitForSeconds(deathDuration);
        }

        currentPhase = BattlePhase.Idle;
        bridge?.NotifyAnimationComplete(result.round);
    }

    private IEnumerator PlayActionRoutine(ActionResult action)
    {
        lobsters.TryGetValue(action.actorId ?? "", out var actor);
        lobsters.TryGetValue(action.targetId ?? "", out var target);
        if (actor == null) yield break;

        switch (action.actionType)
        {
            case "defend":
                actor.PlayDefend();
                yield return new WaitForSeconds(hitDuration);
                break;

            case "attack":
            case "special":
                {
                    Vector3 targetPos = target != null ? target.transform.position
                                                       : actor.transform.position;
                    Vector3 actorPos = actor.transform.position;
                    // Adjacent per the hex board = melee contact read; anything
                    // farther is ranged. Server-reported distance wins when present.
                    bool melee = action.distance > 0
                        ? action.distance <= 1
                        : (target != null && HexCoord.Distance(actor.col, actor.row, target.col, target.row) <= 1);
                    var windup = action.actionType == "special"
                        ? vfxLibrary != null ? vfxLibrary.SpecialFor(actor.classId) : null
                        : vfxLibrary != null ? vfxLibrary.attackWindup : null;
                    BattleVfxLibrary.Spawn(windup, actor, target, this);

                    bool impactFired = false;
                    yield return actor.PlayAttack(targetPos, attackDuration, melee, () =>
                    {
                        impactFired = true;
                        if (target == null) return;
                        if (action.healed > 0)
                        {
                            target.ApplyHeal(action.healed);
                            HealApplied?.Invoke(target, action.healed);
                            BattleVfxLibrary.Spawn(vfxLibrary?.status, actor, target, this);
                        }
                        else
                        {
                            target.ApplyDamage(action.damage);
                            DamageApplied?.Invoke(target, action.damage, action.actionType, action.crit);
                            BattleVfxLibrary.Spawn(vfxLibrary?.attackImpact, actor, target, this);
                            StartCoroutine(target.PlayHit(hitDuration, actorPos));
                        }
                    });
                    if (!impactFired && target != null && action.damage > 0)
                    {
                        target.ApplyDamage(action.damage);
                    }
                }
                break;

            default:
                Debug.LogWarning($"[BattleManager] Unknown actionType '{action.actionType}' from {action.actorId}");
                break;
        }
    }

    /// <summary>Battle has ended — defeat read for the losing side (none on a draw).</summary>
    public void OnBattleEnd(BattleEndData data)
    {
        currentPhase = BattlePhase.BattleOver;
        Debug.Log($"[BattleManager] Battle over! Winner: {data.winner}, Player won: {data.playerWon}");
        hexGrid?.ClearHighlights();
        ClearPreview();
        BattleEnded?.Invoke(data);
        if (data.winner == "draw") return;

        // Losing team plays Die as a defeat read if the server didn't already kill them.
        foreach (var lob in lobsters.Values)
        {
            if (lob.alive && lob.side != data.winner)
            {
                StartCoroutine(lob.PlayDeath(deathDuration));
            }
        }
    }

    /// <summary>Look up a spawned lobster's controller (selection, HUD, tests).</summary>
    public LobsterController GetLobster(string id)
    {
        lobsters.TryGetValue(id, out var lob);
        return lob;
    }

    /// <summary>The living lobster standing on a hex, or null (HexInput click routing).</summary>
    public LobsterController GetLobsterAt(int col, int row)
    {
        foreach (var lob in lobsters.Values)
        {
            if (lob != null && lob.alive && lob.col == col && lob.row == row) return lob;
        }
        return null;
    }

    private void ClearLobsters()
    {
        foreach (var lob in lobsters.Values)
        {
            if (lob != null) SafeDestroy(lob.gameObject);
        }
        lobsters.Clear();
    }

    /// <summary>Destroy that also works in edit mode (the HUD smoke test runs Initialize there).</summary>
    private static void SafeDestroy(UnityEngine.Object o)
    {
        if (o == null) return;
        if (Application.isPlaying) Destroy(o);
        else DestroyImmediate(o);
    }
}
