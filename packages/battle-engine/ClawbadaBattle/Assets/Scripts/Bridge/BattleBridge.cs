using UnityEngine;
using System.Runtime.InteropServices;

/// <summary>
/// Main bridge between React and Unity.
/// Attach this script to a GameObject named "BattleBridge" in the scene.
///
/// React → Unity: React calls SendMessage("BattleBridge", "MethodName", jsonString)
/// Unity → React: Unity calls JS functions via DllImport (JSBridge.jslib)
/// </summary>
public class BattleBridge : MonoBehaviour
{
    // ─── JS function imports (Unity → React) ───
    [DllImport("__Internal")] private static extern void SendPositioningCommit(string json);
    [DllImport("__Internal")] private static extern void SendCombatCommit(string json);
    [DllImport("__Internal")] private static extern void SendLobsterSelected(string json);
    [DllImport("__Internal")] private static extern void SendUnityReady();
    [DllImport("__Internal")] private static extern void SendAnimationComplete(string json);

    // ─── References (set in Inspector or found at runtime) ───
    private BattleManager battleManager;
    private HexGrid hexGrid;

    void Awake()
    {
        battleManager = FindFirstObjectByType<BattleManager>();
        hexGrid = FindFirstObjectByType<HexGrid>();
    }

    void Start()
    {
        // Notify React that Unity is loaded and ready
        #if UNITY_WEBGL && !UNITY_EDITOR
        SendUnityReady();
        #else
        Debug.Log("[BattleBridge] Unity ready (editor mode — skipping JS callback)");
        #endif
    }

    // ─── React → Unity methods (called via SendMessage) ───

    /// <summary>Initialize the battle with arena layout, teams, and player info.</summary>
    public void InitBattle(string json)
    {
        Debug.Log($"[BattleBridge] InitBattle: {json.Substring(0, Mathf.Min(json.Length, 200))}...");
        var data = JsonUtility.FromJson<BattleInitData>(json);
        if (battleManager != null) battleManager.Initialize(data);
        if (hexGrid != null) hexGrid.BuildGrid(data.arena);
    }

    /// <summary>Start a new phase (positioning or combat).</summary>
    public void StartPhase(string json)
    {
        Debug.Log($"[BattleBridge] StartPhase: {json}");
        var phase = JsonUtility.FromJson<PhaseData>(json);
        if (battleManager != null) battleManager.StartPhase(phase);
    }

    /// <summary>Update the countdown timer.</summary>
    public void UpdateTimer(string json)
    {
        var data = JsonUtility.FromJson<TimerData>(json);
        if (battleManager != null) battleManager.UpdateTimer(data.timeRemaining);
    }

    /// <summary>Opponent has committed their moves.</summary>
    public void OpponentReady()
    {
        Debug.Log("[BattleBridge] OpponentReady");
        if (battleManager != null) battleManager.OnOpponentReady();
    }

    /// <summary>Play a round's results (movements + combat animations).</summary>
    public void PlayRound(string json)
    {
        Debug.Log($"[BattleBridge] PlayRound: {json.Substring(0, Mathf.Min(json.Length, 200))}...");
        var result = JsonUtility.FromJson<RoundResult>(json);
        if (battleManager != null) battleManager.PlayRound(result);
    }

    /// <summary>Battle has ended — show victory/defeat.</summary>
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

    /// <summary>Clear all hex highlights (fades them out and destroys).</summary>
    public void ClearHighlights()
    {
        if (hexGrid != null) hexGrid.ClearHighlights();
    }

    // ─── Unity → React helper methods (called by game scripts) ───

    public void CommitPositioning(string json)
    {
        #if UNITY_WEBGL && !UNITY_EDITOR
        SendPositioningCommit(json);
        #else
        Debug.Log($"[BattleBridge] PositioningCommit (editor): {json}");
        #endif
    }

    public void CommitCombat(string json)
    {
        #if UNITY_WEBGL && !UNITY_EDITOR
        SendCombatCommit(json);
        #else
        Debug.Log($"[BattleBridge] CombatCommit (editor): {json}");
        #endif
    }

    public void NotifyLobsterSelected(string lobsterId)
    {
        string json = $"{{\"lobsterId\":\"{lobsterId}\"}}";
        #if UNITY_WEBGL && !UNITY_EDITOR
        SendLobsterSelected(json);
        #else
        Debug.Log($"[BattleBridge] LobsterSelected: {lobsterId}");
        #endif
    }

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

// ─── JSON data classes (must match React TypeScript types) ───

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
    public string side;
    public int slot;
    public int maxHp;
    public int currentHp;
    public HexPosition position;
    public int charge;
    public int damage;
    public int moveRange;
    public bool alive;
}

[System.Serializable]
public class BattleInitData
{
    public string battleId;
    public ArenaLayout arena;
    public BattleLobsterData[] teamA;
    public BattleLobsterData[] teamB;
    public string playerSide;
    public string playerBadge;
    public string opponentBadge;
    public string stakeBracket;
    public int stakeAmount;
}

[System.Serializable]
public class PhaseData
{
    public int round;
    public string phase; // "positioning" or "combat"
    public float timeRemaining;
    public bool opponentReady;
}

[System.Serializable]
public class TimerData
{
    public float timeRemaining;
}

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
    public string winner;
    public bool playerWon;
}
