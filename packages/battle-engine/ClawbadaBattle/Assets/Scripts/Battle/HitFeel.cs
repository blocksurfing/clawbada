using UnityEngine;

/// <summary>
/// How a hit feels (owner 2026-11-09, "Batch A" of eight hit-feel techniques): on the contact frame the attacker and the
/// target hold still for a beat (hit stop), the target flashes white, is nudged back a few pixels and springs home, crits
/// and kills shake the screen a little, the spark grows, and the damage number pops. A killing blow holds longer and the
/// fall starts in slow motion. Our rigs animate at 12 fps (one frame = 83 ms), so the holds are tuned to that, not to a
/// 60 fps game's frame counts; distances are art pixels (64 a world unit).
///
/// Everything is local to the two rigs: the battle clock (Time.timeScale) belongs to the speed tool, and Special audio is
/// scheduled on the DSP clock, so neither ever pauses. The server's playback estimate carries the extra time
/// (game-logic v3/playback.ts PLAYBACK_HITSTOP_*), so the shot clock stays fair.
///
/// <see cref="ReduceMotion"/> follows the player's OS "reduce motion" setting (pushed from the web with the audio prefs):
/// no screen shakes (Specials' included), no flash, no recoil.
/// </summary>
[System.Serializable]
public class HitFeel
{
    [Header("Hit stop: attacker and target hold on the contact frame (seconds)")]
    public float holdNormal = 0.085f, holdCrit = 0.17f, holdKill = 0.25f;
    [Tooltip("After a killing blow's hold, the fall starts at this speed for killSlowSeconds.")]
    public float killSlowSpeed = 0.5f, killSlowSeconds = 0.3f;

    [Header("White flash on the target (seconds)")]
    public float flash = 0.06f, flashKill = 0.09f;

    [Header("Recoil: pushed away from the attacker, then back (art px; seconds)")]
    public float recoilPx = 3f, recoilCritPx = 4f, recoilKillPx = 5f;
    public float recoilOut = 0.08f, recoilBack = 0.12f;

    [Header("Screen shake on crits and kills (art px; seconds)")]
    public float shakeCritPx = 1.5f, shakeCritSeconds = 0.15f, shakeKillPx = 2.5f, shakeKillSeconds = 0.25f;

    [Header("Impact spark and damage number")]
    public float sparkScaleBig = 1.5f;

    public const float ArtPx = 1f / 64f;

    /// <summary>The player's OS asked for less motion (web → BattleBridge.SetAudioPrefs).</summary>
    public static bool ReduceMotion;

    public float HoldFor(bool crit, bool kill) => kill ? holdKill : crit ? holdCrit : holdNormal;
    public float RecoilFor(bool crit, bool kill) => kill ? recoilKillPx : crit ? recoilCritPx : recoilPx;
}
