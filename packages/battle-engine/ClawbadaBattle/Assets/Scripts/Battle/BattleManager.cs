using UnityEngine;

/// <summary>
/// Battle state machine. Manages phases, rounds, timing, and lobster state.
/// Receives commands from BattleBridge, drives HexGrid and LobsterControllers.
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

    // Battle data
    private BattleInitData initData;

    /// <summary>Initialize battle with full data from React.</summary>
    public void Initialize(BattleInitData data)
    {
        initData = data;
        currentRound = 0;
        currentPhase = BattlePhase.WaitingForInit;
        Debug.Log($"[BattleManager] Initialized battle {data.battleId}, player side: {data.playerSide}, tier: {data.arena.tier}");

        // TODO: Spawn lobster prefabs at spawn positions
        // TODO: Set up player badge UI
        // TODO: Set up stake display
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
            // TODO: Enable hex selection for movement
            // TODO: Show "POSITIONING" indicator
        }
        else if (phase.phase == "combat")
        {
            currentPhase = BattlePhase.Combat;
            Debug.Log($"[BattleManager] Round {currentRound} — COMBAT phase, {timeRemaining}s");
            // TODO: Enable attack/defend/special buttons
            // TODO: Show "COMBAT" indicator
        }
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

        // TODO: Animate movements along hex paths (slide lobsters)
        // TODO: Then animate combat actions (attacks, specials, damage numbers)
        // TODO: Apply deaths (death animation, grayscale)
        // TODO: When done, call BattleBridge.NotifyAnimationComplete(round)
    }

    /// <summary>Battle has ended — show result.</summary>
    public void OnBattleEnd(BattleEndData data)
    {
        currentPhase = BattlePhase.BattleOver;
        Debug.Log($"[BattleManager] Battle over! Winner: Team {data.winner}, Player won: {data.playerWon}");

        // TODO: Show victory/defeat banner
        // TODO: Play celebration/defeat animation
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
