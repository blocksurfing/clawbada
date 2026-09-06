using UnityEngine;
using System.Runtime.InteropServices;

/// <summary>
/// Main bridge between React and Unity — V3 per-turn contract.
/// Attach this script to a GameObject named "BattleBridge" in the scene.
///
/// React → Unity: React calls SendMessage("BattleBridge", "MethodName", jsonString)
///   InitBattle(BattleInitData)  StartTurn(TurnStartData)  PlayTurn(TurnPlayData)
///   UpdateBar(BarData)  SetClock(ClockData)  BattleEnd(BattleEndData)
///   SyncUnits(UnitsSyncData)  ShowSelection(HexListData)  ClearHighlights()
///   PlayRound(RoundResult) is kept for the editor demo loop only.
/// Unity → React: Unity calls JS functions via DllImport (JSBridge.jslib) → window.__clawbada.*
///   onUnityReady  onLobsterSelected {lobsterId}  onHexClicked {col,row}
///   onTurnAnimationComplete {turn}  (onAnimationComplete {round} — demo loop only)
///
/// Unity renders; it never decides. Every number here was resolved by the server.
/// </summary>
public class BattleBridge : MonoBehaviour
{
    // ─── JS function imports (Unity → React) ───
    [DllImport("__Internal")] private static extern void SendLobsterSelected(string json);
    [DllImport("__Internal")] private static extern void SendHexClicked(string json);
    [DllImport("__Internal")] private static extern void SendUnityReady();
    [DllImport("__Internal")] private static extern void SendAnimationComplete(string json);
    [DllImport("__Internal")] private static extern void SendTurnAnimationComplete(string json);

    private BattleManager battleManager;
    private HexGrid hexGrid;

    void Awake()
    {
        battleManager = FindFirstObjectByType<BattleManager>();
        hexGrid = FindFirstObjectByType<HexGrid>();
    }

    void Start()
    {
        #if UNITY_WEBGL && !UNITY_EDITOR
        SendUnityReady();
        #else
        Debug.Log("[BattleBridge] Unity ready (editor mode — skipping JS callback)");
        #endif
    }

    // ─── React → Unity (called via SendMessage) ───

    /// <summary>Initialize the battle with arena layout, teams, and player info.</summary>
    public void InitBattle(string json)
    {
        Debug.Log($"[BattleBridge] InitBattle: {json.Substring(0, Mathf.Min(json.Length, 200))}...");
        var data = JsonUtility.FromJson<BattleInitData>(json);
        // Grid must be built (and re-centered) before Initialize spawns lobsters at
        // grid-derived world positions.
        if (hexGrid != null) hexGrid.BuildGrid(data.arena, data.battleId);
        if (battleManager != null) battleManager.Initialize(data);
    }

    /// <summary>A lobster's turn began (server). Faces it toward the enemy; HUD is React's.</summary>
    public void StartTurn(string json)
    {
        var data = JsonUtility.FromJson<TurnStartData>(json);
        if (battleManager != null) battleManager.StartTurn(data);
    }

    /// <summary>Animate one resolved turn (move path, action, hits, deaths), then notify React.</summary>
    public void PlayTurn(string json)
    {
        Debug.Log($"[BattleBridge] PlayTurn: {json.Substring(0, Mathf.Min(json.Length, 200))}...");
        var data = JsonUtility.FromJson<TurnPlayData>(json);
        if (battleManager != null) battleManager.PlayTurn(data);
    }

    /// <summary>Upcoming turn order (HUD bar lives in React; Unity may use it for cues).</summary>
    public void UpdateBar(string json)
    {
        var data = JsonUtility.FromJson<BarData>(json);
        if (battleManager != null) battleManager.UpdateBar(data);
    }

    /// <summary>Remaining shot-clock milliseconds (optional visual pulse).</summary>
    public void SetClock(string json)
    {
        var data = JsonUtility.FromJson<ClockData>(json);
        if (battleManager != null) battleManager.SetClock(data.remainingMs);
    }

    /// <summary>Server truth for every unit (hp, alive, charge, defending, statuses, cell),
    /// sent right after InitBattle and after each animated turn. Feeds the in-canvas HUD.</summary>
    public void SyncUnits(string json)
    {
        var data = JsonUtility.FromJson<UnitsSyncData>(json);
        if (battleManager != null) battleManager.SyncUnits(data);
    }

    /// <summary>Editor demo loop only (V2 round shape). Real battles use PlayTurn.</summary>
    public void PlayRound(string json)
    {
        var result = JsonUtility.FromJson<RoundResult>(json);
        if (battleManager != null) battleManager.PlayRound(result);
    }

    /// <summary>Battle has ended — show victory / defeat / draw read.</summary>
    public void BattleEnd(string json)
    {
        Debug.Log($"[BattleBridge] BattleEnd: {json}");
        var data = JsonUtility.FromJson<BattleEndData>(json);
        if (battleManager != null) battleManager.OnBattleEnd(data);
    }

    /// <summary>Show the hex highlight state for the currently selected character.
    /// Atomic: stone in-range hexes, blue origin hex, red enemy targets, green ally
    /// targets. See HexGrid.ShowSelection for precedence and payload shape.</summary>
    public void ShowSelection(string json)
    {
        if (hexGrid != null) hexGrid.ShowSelection(json);
    }

    /// <summary>Clear all hex highlights.</summary>
    public void ClearHighlights()
    {
        if (hexGrid != null) hexGrid.ClearHighlights();
    }

    // ─── Unity → React helpers (called by game scripts) ───

    public void NotifyLobsterSelected(string lobsterId)
    {
        string json = $"{{\"lobsterId\":\"{lobsterId}\"}}";
        #if UNITY_WEBGL && !UNITY_EDITOR
        SendLobsterSelected(json);
        #else
        Debug.Log($"[BattleBridge] LobsterSelected: {lobsterId}");
        #endif
    }

    public void NotifyHexClicked(int col, int row)
    {
        string json = $"{{\"col\":{col},\"row\":{row}}}";
        #if UNITY_WEBGL && !UNITY_EDITOR
        SendHexClicked(json);
        #else
        Debug.Log($"[BattleBridge] HexClicked: ({col},{row})");
        #endif
    }

    public void NotifyTurnAnimationComplete(int turn)
    {
        string json = $"{{\"turn\":{turn}}}";
        #if UNITY_WEBGL && !UNITY_EDITOR
        SendTurnAnimationComplete(json);
        #else
        Debug.Log($"[BattleBridge] TurnAnimationComplete: turn {turn}");
        #endif
    }

    /// <summary>Editor demo loop only.</summary>
    public void NotifyAnimationComplete(int round)
    {
        string json = $"{{\"round\":{round}}}";
        #if UNITY_WEBGL && !UNITY_EDITOR
        SendAnimationComplete(json);
        #else
        Debug.Log($"[BattleBridge] AnimationComplete: round {round}");
        #endif
    }
}

// ─── JSON data classes (must match apps/web/src/components/battle/unity-bridge.ts) ───

[System.Serializable]
public class HexPosition
{
    public int col;
    public int row;
}

[System.Serializable]
public class ArenaLayout
{
    public string layoutId;
    public int cols;
    public int rows;
    public HexPosition[] blockedHexes;
    public HexPosition[] teamASpawns;
    public HexPosition[] teamBSpawns;
    public string tier;
}

[System.Serializable]
public class BattleLobsterData
{
    public string id;
    public int classId;
    public string className;
    public int tier;
    public string side;      // "A" | "B"
    public int slot;
    public int maxHp;
    public int currentHp;
    public HexPosition position;
    public int charge;
    public int damage;
    public int moveRange;
    public bool alive;

    /// <summary>Optional DNA visual composition: dominant-gene class id (0-9) per body
    /// part slot, in DNA order [Carapace, Claws, Tail, Antennae, Eyes, Legs]. Empty or
    /// missing → pure-class visuals (all parts from className's rig).</summary>
    public int[] partClassIds;
}

[System.Serializable]
public class BattleInitData
{
    public string battleId;
    public ArenaLayout arena;
    public BattleLobsterData[] teamA;
    public BattleLobsterData[] teamB;
    public string playerSide;    // "A" | "B" | "spectator"
    public string playerBadge;
    public string opponentBadge;
    public string stakeBracket;
    public int stakeAmount;
}

// ─── V3 per-turn payloads ───

[System.Serializable]
public class TurnStartData
{
    public int turn;
    public string lobsterId;
    public string side;          // "A" | "B"
    public long deadlineMs;      // epoch ms; 0 when the bot acts
    public bool isPlayer;        // true when the local player controls this lobster
}

[System.Serializable]
public class DamageEventData
{
    public string targetId;
    public int amount;
    public string kind;          // attack | special | counter | bleed | reflect | self
    public bool isCrit;
    public bool killed;
}

[System.Serializable]
public class HealEventData
{
    public string targetId;
    public int amount;
}

[System.Serializable]
public class StatusEventData
{
    public string targetId;
    public string status;        // bleed | stun | haunt | fortify | reflect | shield | slow | taunt
    public bool applied;
    public int turns;
}

[System.Serializable]
public class TurnPlayData
{
    public int turn;
    public string lobsterId;
    public HexPosition[] path;   // waypoints after the start hex (empty = no move)
    public string action;        // attack | defend | special | none | "" when skipped
    public string skipped;       // "stun" or ""
    public string targetId;      // "" when none
    public DamageEventData[] damage;
    public HealEventData[] heals;
    public StatusEventData[] statuses;
    public string[] deaths;
    public bool isEnhanced;
}

[System.Serializable]
public class BarEntryData
{
    public string lobsterId;
    public string tick;
}

[System.Serializable]
public class BarData
{
    public int turn;
    public BarEntryData[] entries;
}

[System.Serializable]
public class ClockData
{
    public int remainingMs;
}

[System.Serializable]
public class StatusData
{
    public string type;          // bleed | stun | haunt | fortify | reflect | shield | slow | taunt
    public int turns;
}

[System.Serializable]
public class UnitSyncData
{
    public string lobsterId;
    public int hp;
    public int maxHp;
    public bool alive;
    public int charge;
    public bool defending;
    public int col;
    public int row;
    public StatusData[] statuses;
}

[System.Serializable]
public class UnitsSyncData
{
    public int turn;
    public UnitSyncData[] units;
}

// ─── Editor demo loop (V2 round shape) ───

[System.Serializable]
public class MovementResult
{
    public string lobsterId;
    public HexPosition from;
    public HexPosition to;
}

[System.Serializable]
public class ActionResult
{
    public string actorId;
    public string actionType;
    public string targetId;
    public int damage;
    public int healed;
    public bool crit;
    public int distance;
    public float distanceModifier;
    public string moveType;
    public bool enhanced;
}

[System.Serializable]
public class RoundResult
{
    public int round;
    public MovementResult[] movements;
    public ActionResult[] actions;
    public string[] deaths;
}

[System.Serializable]
public class BattleEndData
{
    public string winner;        // "A" | "B" | "draw"
    public bool playerWon;
    public string reason;        // wipeout | turn_cap | forfeit | ""
}
