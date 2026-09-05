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

    [Header("Animation Timing")]
    public float secondsPerHexMove = 0.35f;
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

    void Awake()
    {
        hexGrid = FindAnyObjectByType<HexGrid>();
        bridge = FindAnyObjectByType<BattleBridge>();
    }

    /// <summary>Initialize battle with full data from React.</summary>
    public void Initialize(BattleInitData data)
    {
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
        currentPhase = BattlePhase.Idle;
        // Badges / stake / HUD are rendered by React over the canvas.
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

        if (arenaArtInstance != null) Destroy(arenaArtInstance);
        if (initialArenaArt != null) { Destroy(initialArenaArt); initialArenaArt = null; }
        arenaArtInstance = Instantiate(prefab);
        arenaArtInstance.name = prefab.name;

        // Frame art authored on the Foreground layer (FG_1, FG_2, …) always renders in
        // front of lobsters and obstacles, whatever order the prefab shipped with.
        foreach (var r in arenaArtInstance.GetComponentsInChildren<SpriteRenderer>(true))
        {
            if (r.sortingLayerName == DepthSort.Layer && r.sortingOrder < DepthSort.ArenaFrontOrderBase)
                r.sortingOrder += DepthSort.ArenaFrontOrderBase;
        }

        // The arena prefabs aren't authored around a common origin (Evolved bakes in
        // the camera's y=1 offset, Apex is centered at zero). Center the combined
        // sprite bounds on the camera so every arena fills the frame.
        var cam = Camera.main;
        if (cam != null)
        {
            var renderers = arenaArtInstance.GetComponentsInChildren<SpriteRenderer>();
            if (renderers.Length > 0)
            {
                var bounds = renderers[0].bounds;
                foreach (var r in renderers) bounds.Encapsulate(r.bounds);
                Vector3 shift = new Vector3(cam.transform.position.x, cam.transform.position.y, 0f)
                                - new Vector3(bounds.center.x, bounds.center.y, 0f);
                arenaArtInstance.transform.position += shift;
            }
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

    /// <summary>A lobster's turn started (server-authoritative). Purely a visual cue:
    /// face the actor toward the enemy side. Highlights come from React via ShowSelection.</summary>
    public void StartTurn(TurnStartData data)
    {
        currentTurn = data.turn;
        activeLobsterId = data.lobsterId ?? "";
        if (lobsters.TryGetValue(activeLobsterId, out var lob) && lob.alive) lob.FaceEnemySide();
        if (currentPhase != BattlePhase.AnimatingTurn && currentPhase != BattlePhase.BattleOver) currentPhase = BattlePhase.Idle;
    }

    public void UpdateBar(BarData data)
    {
        upcoming = data?.entries ?? new BarEntryData[0];
    }

    public void SetClock(int remainingMs)
    {
        clockRemainingMs = remainingMs;
    }

    /// <summary>Animate one resolved turn, then tell React so it can send the next.</summary>
    public void PlayTurn(TurnPlayData data)
    {
        currentPhase = BattlePhase.AnimatingTurn;
        currentTurn = data.turn;
        StartCoroutine(PlayTurnRoutine(data));
    }

    private IEnumerator PlayTurnRoutine(TurnPlayData data)
    {
        hexGrid?.ClearHighlights();
        lobsters.TryGetValue(data.lobsterId ?? "", out var actor);

        // 1. Movement along the server's path (cell-by-cell hops).
        if (actor != null && data.path != null && data.path.Length > 0)
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
                    yield return new WaitForSeconds(hitDuration);
                    break;

                case "attack":
                case "special":
                    {
                        lobsters.TryGetValue(data.targetId ?? "", out var target);
                        Vector3 targetPos = target != null ? target.transform.position : actor.transform.position;
                        Vector3 actorPos = actor.transform.position;
                        bool melee = target == null || HexCoord.Distance(actor.col, actor.row, target.col, target.row) <= 1;
                        var windup = data.action == "special"
                            ? vfxLibrary != null ? vfxLibrary.SpecialFor(actor.classId) : null
                            : vfxLibrary != null ? vfxLibrary.attackWindup : null;
                        BattleVfxLibrary.Spawn(windup, actor, target, this);

                        yield return actor.PlayAttack(targetPos, attackDuration, melee, () =>
                        {
                            ApplyTurnEvents(data, actor, actorPos, primaryOnly: true);
                        });
                        // Secondary events (counter hits on the actor, reflects, bleed ticks).
                        ApplyTurnEvents(data, actor, actorPos, primaryOnly: false);
                        yield return new WaitForSeconds(hitDuration * 0.5f);
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
            yield return new WaitForSeconds(hitDuration);
        }

        // 3. Deaths (server-authoritative list).
        if (data.deaths != null && data.deaths.Length > 0)
        {
            foreach (var deadId in data.deaths)
            {
                if (lobsters.TryGetValue(deadId, out var lob) && lob.alive)
                {
                    StartCoroutine(lob.PlayDeath(deathDuration));
                }
            }
            yield return new WaitForSeconds(deathDuration);
        }

        if (currentPhase != BattlePhase.BattleOver) currentPhase = BattlePhase.Idle;
        bridge?.NotifyTurnAnimationComplete(data.turn);
    }

    /// <summary>Apply a turn's damage/heal events to the affected controllers with hit reads.
    /// Primary = the actor's own attack/special hits (played at the impact frame);
    /// secondary = counter/reflect/bleed/self events (played right after).</summary>
    private void ApplyTurnEvents(TurnPlayData data, LobsterController actor, Vector3 actorPos, bool primaryOnly, bool includePrimary = false)
    {
        if (data.heals != null && (primaryOnly || includePrimary))
        {
            foreach (var h in data.heals)
            {
                if (h == null || !lobsters.TryGetValue(h.targetId ?? "", out var t)) continue;
                t.ApplyHeal(h.amount);
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
            BattleVfxLibrary.Spawn(vfxLibrary?.attackImpact, actor, t, this);
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
                            BattleVfxLibrary.Spawn(vfxLibrary?.status, actor, target, this);
                            // TODO: floating heal number
                        }
                        else
                        {
                            target.ApplyDamage(action.damage);
                            BattleVfxLibrary.Spawn(vfxLibrary?.attackImpact, actor, target, this);
                            StartCoroutine(target.PlayHit(hitDuration, actorPos));
                            // TODO: damage number popup (crit/enhanced styling from action.crit / action.enhanced)
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
        if (data.winner == "draw") return;

        // Losing team plays Die as a defeat read if the server didn't already kill them.
        foreach (var lob in lobsters.Values)
        {
            if (lob.alive && lob.side != data.winner)
            {
                StartCoroutine(lob.PlayDeath(deathDuration));
            }
        }
        // Result banner is React's.
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
            if (lob != null) Destroy(lob.gameObject);
        }
        lobsters.Clear();
    }
}
