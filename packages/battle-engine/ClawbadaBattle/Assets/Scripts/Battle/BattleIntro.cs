using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;

/// <summary>
/// Fighting-game battle start (user 2026-09-28): instead of dropping the player into a running battle —
///   1. black → fade in on the EMPTY arena (no lobsters, no HUD);
///   2. centre screen: "READY" rises in, then "FIGHT!" slams down (white flash, camera shake);
///   3. the lobsters drop onto their hexes, slot by slot, both teams at once;
///   4. the HUD slides into place (BattleHud.SlideIn).
/// Runs on unscaled time (presentation, not playback — ?speed never stretches it). A click or tap skips to the end.
/// The type treatment is a placeholder for Nzib's art; sounds are optional clips (BattleSfx.PlayIntroReady/Fight).
/// BattleManager holds turn traffic until this finishes, then tells React (music starts, the server is told ready).
/// </summary>
public static class BattleIntro
{
    // ~5 s in all. User 2026-09-28: the first cut (~3.5 s) felt rushed → +1.5 s, spread over every beat.
    private const float BlackHold = 0.4f, FadeIn = 0.9f;
    private const float ReadyIn = 0.35f, ReadyHold = 0.8f, ReadyOut = 0.15f;
    private const float FightSlam = 0.14f, FightHold = 0.75f, FightOut = 0.2f;
    private const float DropHeight = 1.6f, DropTime = 0.32f, DropStagger = 0.14f, Bounce = 0.06f;
    private const float SlideTime = 0.7f;

    private static readonly Color Gold = new Color32(0xfb, 0xbf, 0x24, 0xff);

    public static IEnumerator Play(MonoBehaviour host, BattleHud hud, IEnumerable<LobsterController> lobsterSet)
    {
        var lobsters = new List<LobsterController>();
        foreach (var l in lobsterSet) if (l != null) lobsters.Add(l);
        var homes = new Dictionary<LobsterController, (Vector3 pos, Vector3 scale)>();
        foreach (var l in lobsters) homes[l] = (l.transform.position, l.transform.localScale);
        // Slot = order within its team (rigs are spawned team by team in slot order).
        var slot = new Dictionary<LobsterController, int>();
        var perSide = new Dictionary<string, int>();
        foreach (var l in lobsters)
        {
            string side = l.side ?? "";
            perSide.TryGetValue(side, out int n);
            slot[l] = n;
            perSide[side] = n + 1;
        }

        // Hidden by scale, not SetActive: SyncUnits arrives right after InitBattle and must still reach the rigs.
        foreach (var l in lobsters) l.transform.localScale = Vector3.zero;
        hud?.HideForIntro();

        var skin = hud != null ? hud.Skin : null;
        var canvas = HudFactory.Canvas("IntroCanvas", 400, new Vector2(960f, 540f), 0.5f, 64f);
        var root = canvas.GetComponent<RectTransform>();
        var black = HudFactory.AddImage(HudFactory.Stretch(root, "Black"), skin != null ? skin.barFill : null, Color.black);
        var flash = HudFactory.AddImage(HudFactory.Stretch(root, "Flash"), skin != null ? skin.barFill : null, new Color(1f, 1f, 1f, 0f));
        Font font = skin != null ? skin.PixelFontOrDefault() : Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
        var ready = Title(root, "Ready", font, 48, Color.white, "READY");
        var fight = Title(root, "Fight", font, 72, Gold, "FIGHT!");

        bool skip = false;
        bool Skipped()
        {
            if (!skip && (Input.GetMouseButtonDown(0) || Input.touchCount > 0)) { skip = true; Debug.Log("[BattleIntro] skipped"); }
            return skip;
        }
        IEnumerator Wait(float s)
        {
            for (float t = 0f; t < s && !Skipped(); t += Time.unscaledDeltaTime) yield return null;
        }
        IEnumerator Tween(float s, System.Action<float> step)
        {
            for (float t = 0f; t < s && !Skipped(); t += Time.unscaledDeltaTime) { step(Mathf.Clamp01(t / s)); yield return null; }
            if (!skip) step(1f);
        }

        Debug.Log("[BattleIntro] start");
        // 1. Black → the empty arena.
        yield return Wait(BlackHold);
        yield return Tween(FadeIn, k => black.color = new Color(0f, 0f, 0f, 1f - k));

        // 2. READY, then FIGHT!
        BattleSfx.PlayIntroReady();
        ready.gameObject.SetActive(true);
        yield return Tween(ReadyIn, k => { SetAlpha(ready, k); ready.transform.localScale = Vector3.one * Mathf.Lerp(0.7f, 1f, EaseOut(k)); });
        yield return Wait(ReadyHold);
        yield return Tween(ReadyOut, k => SetAlpha(ready, 1f - k));
        ready.gameObject.SetActive(false);

        fight.gameObject.SetActive(true);
        yield return Tween(FightSlam, k => { SetAlpha(fight, k); fight.transform.localScale = Vector3.one * Mathf.Lerp(2.4f, 1f, k * k); });
        if (!skip)
        {
            BattleSfx.PlayIntroFight();
            CameraShake.Shake(0.08f, 0.3f);
            host.StartCoroutine(FadeFlash(flash));
        }
        yield return Wait(FightHold);
        yield return Tween(FightOut, k => { SetAlpha(fight, 1f - k); fight.transform.localScale = Vector3.one * Mathf.Lerp(1f, 1.3f, k); });
        fight.gameObject.SetActive(false);

        // 3. Lobsters drop onto their hexes, slot by slot (both teams together).
        if (!skip)
        {
            var bySlot = new List<LobsterController>(lobsters);
            bySlot.Sort((a, b) => slot[a].CompareTo(slot[b]));
            int running = 0;
            foreach (var l in bySlot)
            {
                float delay = slot[l] * DropStagger;
                running++;
                host.StartCoroutine(Drop(l, homes[l], delay, () => running--));
            }
            while (running > 0 && !Skipped()) yield return null;
            if (!skip) CameraShake.Shake(0.04f, 0.15f);
        }

        // 4. HUD slides in.
        if (hud != null && !skip) yield return hud.SlideIn(SlideTime, Skipped);

        // End state, whatever was skipped: rigs home, HUD in place, overlay gone.
        foreach (var l in lobsters)
            if (l != null) { l.transform.position = homes[l].pos; l.transform.localScale = homes[l].scale; }
        hud?.EndIntro();
        Object.Destroy(canvas.gameObject);
        Debug.Log($"[BattleIntro] done{(skip ? " (skipped)" : "")}");
    }

    private static Text Title(RectTransform root, string name, Font font, int size, Color color, string text)
    {
        var t = HudFactory.Text(root, name, font, size, color, TextAnchor.MiddleCenter, new Vector2(900f, 120f));
        t.text = text;
        var shadow = t.gameObject.AddComponent<Shadow>();
        shadow.effectColor = new Color(0f, 0f, 0f, 0.7f);
        shadow.effectDistance = new Vector2(4f, -4f);
        SetAlpha(t, 0f);
        t.gameObject.SetActive(false);
        return t;
    }

    private static void SetAlpha(Graphic g, float a)
    {
        var c = g.color;
        c.a = a;
        g.color = c;
    }

    private static float EaseOut(float k) => 1f - (1f - k) * (1f - k);

    private static IEnumerator FadeFlash(Image flash)
    {
        for (float t = 0f; t < 0.3f; t += Time.unscaledDeltaTime) { flash.color = new Color(1f, 1f, 1f, 0.7f * (1f - t / 0.3f)); yield return null; }
        flash.color = new Color(1f, 1f, 1f, 0f);
    }

    private static IEnumerator Drop(LobsterController l, (Vector3 pos, Vector3 scale) home, float delay, System.Action done)
    {
        for (float t = 0f; t < delay; t += Time.unscaledDeltaTime) yield return null;
        if (l == null) { done(); yield break; }
        l.transform.localScale = home.scale;
        var top = home.pos + Vector3.up * DropHeight;
        for (float t = 0f; t < DropTime; t += Time.unscaledDeltaTime)
        {
            float k = t / DropTime;
            l.transform.position = Vector3.Lerp(top, home.pos, k * k);   // falls, accelerating
            yield return null;
        }
        // A small bounce on landing.
        for (float t = 0f; t < 0.12f; t += Time.unscaledDeltaTime)
        {
            l.transform.position = home.pos + Vector3.up * (Bounce * Mathf.Sin(Mathf.PI * t / 0.12f));
            yield return null;
        }
        l.transform.position = home.pos;
        done();
    }
}
