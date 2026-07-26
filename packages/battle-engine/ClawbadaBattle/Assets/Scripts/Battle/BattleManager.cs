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
/// then report back via BattleBridge.NotifyAnimationComplete so React advances.
/// The protocol phases (Positioning/Combat rounds today, ATB initiative later)
/// only affect who sends which JSON when — the visual vocabulary here (move,
/// attack, hit, defend, die) is protocol-agnostic.
/// </summary>
public class BattleManager : MonoBehaviour
{
    public enum BattlePhase
    {
        WaitingForInit,
        Positioning,
        Combat,
        AnimatingRound,
        BattleOver,
    }

    [Header("State")]
    public BattlePhase currentPhase = BattlePhase.WaitingForInit;
    public int currentRound = 0;
    public float timeRemaining = 60f;
    public bool opponentReady = false;

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
        currentRound = 0;
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

        // TODO: Set up player badge UI (data.playerBadge / data.opponentBadge)
        // TODO: Set up stake display (data.stakeBracket / data.stakeAmount)
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

    /// <summary>Start a new phase (positioning or combat).</summary>
    public void StartPhase(PhaseData phase)
    {
        currentRound = phase.round;
        timeRemaining = phase.timeRemaining;
        opponentReady = phase.opponentReady;

        if (phase.phase == "positioning")
        {
            currentPhase = BattlePhase.Positioning;
            Debug.Log($"[BattleManager] Round {currentRound} — POSITIONING phase, {timeRemaining}s");
        }
        else if (phase.phase == "combat")
        {
            currentPhase = BattlePhase.Combat;
            Debug.Log($"[BattleManager] Round {currentRound} — COMBAT phase, {timeRemaining}s");
        }
        // Selection highlights are driven by React via BattleBridge.ShowSelection.
        // TODO: Phase indicator UI
    }

    /// <summary>Update the countdown timer (called from React every second).</summary>
    public void UpdateTimer(float remaining)
    {
        timeRemaining = remaining;
        // TODO: Update timer bar UI
    }

    /// <summary>Opponent has committed their moves.</summary>
    public void OnOpponentReady()
    {
        opponentReady = true;
        // TODO: Show "Opponent ready" indicator
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

        currentPhase = BattlePhase.Combat;
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

    /// <summary>Battle has ended — show result.</summary>
    public void OnBattleEnd(BattleEndData data)
    {
        currentPhase = BattlePhase.BattleOver;
        Debug.Log($"[BattleManager] Battle over! Winner: Team {data.winner}, Player won: {data.playerWon}");

        // Losing team plays Die as a defeat read if the server didn't already kill them.
        foreach (var lob in lobsters.Values)
        {
            if (lob.alive && lob.side != data.winner)
            {
                StartCoroutine(lob.PlayDeath(deathDuration));
            }
        }
        // TODO: Victory/defeat banner UI
    }

    /// <summary>Look up a spawned lobster's controller (selection, HUD, tests).</summary>
    public LobsterController GetLobster(string id)
    {
        lobsters.TryGetValue(id, out var lob);
        return lob;
    }

    private void ClearLobsters()
    {
        foreach (var lob in lobsters.Values)
        {
            if (lob != null) Destroy(lob.gameObject);
        }
        lobsters.Clear();
    }

    void Update()
    {
        // Tick timer locally for smooth countdown (React also sends authoritative updates)
        if (currentPhase == BattlePhase.Positioning || currentPhase == BattlePhase.Combat)
        {
            if (timeRemaining > 0)
            {
                timeRemaining -= Time.deltaTime;
            }
        }
    }
}
