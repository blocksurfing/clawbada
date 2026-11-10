using UnityEngine;

/// <summary>
/// How a hit feels (owner 2026-11-09, trimmed 2026-11-10 on Nzib's note): the struck lobster flashes white, crits and
/// kills shake the screen a little and grow the spark, and the damage number pops (DamageFloat). Hit stop and knockback
/// are NOT done here — Nzib draws them into the attack and hit frames themselves, and the code versions doubled them.
/// Distances are art pixels (64 a world unit).
///
/// <see cref="ReduceMotion"/> follows the player's OS "reduce motion" setting (pushed from the web with the audio prefs):
/// no screen shakes (Specials' included) and no flash.
/// </summary>
[System.Serializable]
public class HitFeel
{
    [Header("White flash on the target (seconds)")]
    public float flash = 0.06f, flashKill = 0.09f;

    [Header("Screen shake on crits and kills (art px; seconds)")]
    public float shakeCritPx = 1.5f, shakeCritSeconds = 0.15f, shakeKillPx = 2.5f, shakeKillSeconds = 0.25f;

    [Header("Impact spark and damage number")]
    public float sparkScaleBig = 1.5f;

    public const float ArtPx = 1f / 64f;

    /// <summary>The player's OS asked for less motion (web → BattleBridge.SetAudioPrefs).</summary>
    public static bool ReduceMotion;

}
