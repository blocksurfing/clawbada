using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;

/// <summary>
/// Fighting-game battle start (user 2026-09-28), lengthened for suspense (user 2026-09-29, ~13 s):
///   1. black → a slow fade in on the EMPTY arena (no obstacles, no lobsters, no HUD);
///   2. the obstacles all drop together and hit the board at once — one smash, dust at each, a bigger shake;
///   3. the lobsters drop in ONE AT A TIME, alternating sides (yours first), heavier landings;
///   4. a beat to take in both teams, while the arena music starts fading in (onMusicCue → React);
///   5. centre screen: "CLAWS UP!" rises in, then "BATTLE!" slams down (white flash, camera shake);
///   6. the HUD slides into place (BattleHud.SlideIn).
/// Runs on unscaled time (presentation, not playback — ?speed never stretches it). A click or tap skips to the end.
/// The type treatment and dust are placeholders for Nzib's art; sounds are optional clips (BattleSfx.PlayIntro*).
/// BattleManager holds turn traffic until this finishes, then tells React (the server is told ready).
/// </summary>
public static class BattleIntro
{
    // Every beat is a named constant so the pacing can be tuned by eye. Totals ≈ 12 s.
    // Obstacles land TOGETHER (user 2026-09-29: the smash takes are one big boom, "so long as all the obstacles fall
    // and contact the ground at the same time"); the hold after lets the boom ring out before the lobsters.
    private const float BlackHold = 0.6f, FadeIn = 2.0f, BeforeObstacles = 0.4f;
    private const float ObstacleDrop = 0.5f, ObstacleHeight = 2.4f, BeforeLobsters = 1.0f;
    // Lobster section 30 % quicker (user 2026-09-29): was 0.5 s stagger / 0.4 s fall.
    private const float LobsterStagger = 0.35f, LobsterDrop = 0.28f, LobsterHeight = 2.4f, Bounce = 0.08f;
    private const float TeamsHold = 1.0f;
    private const float ReadyIn = 0.35f, ReadyHold = 0.8f, ReadyOut = 0.15f;
    private const float FightSlam = 0.14f, FightHold = 0.75f, FightOut = 0.2f;
    private const float SlideTime = 0.7f;

    private static readonly Color Gold = new Color32(0xfb, 0xbf, 0x24, 0xff);

    /// <param name="obstacleSet">The board's obstacles (HexGrid.Obstacles); dropped in before the lobsters.</param>
    /// <param name="firstSide">The side whose lobsters land first ("A"/"B"): the player's own.</param>
    /// <param name="onMusicCue">Fired once as the music should start fading in (on skip too, if not yet).</param>
    public static IEnumerator Play(MonoBehaviour host, BattleHud hud, IEnumerable<LobsterController> lobsterSet,
        IEnumerable<GameObject> obstacleSet, string firstSide, System.Action onMusicCue)
    {
        var lobsters = new List<LobsterController>();
        foreach (var l in lobsterSet) if (l != null) lobsters.Add(l);
        var obstacles = new List<Transform>();
        if (obstacleSet != null) foreach (var o in obstacleSet) if (o != null) obstacles.Add(o.transform);

        var homes = new Dictionary<Transform, (Vector3 pos, Vector3 scale)>();
        foreach (var l in lobsters) homes[l.transform] = (l.transform.position, l.transform.localScale);
        foreach (var o in obstacles) homes[o] = (o.position, o.localScale);

        // Landing order. Obstacles: back row first (higher on screen = further back). Lobsters: alternate sides,
        // slot by slot (rigs are spawned team by team in slot order), the player's side first.
        obstacles.Sort((a, b) => b.position.y.CompareTo(a.position.y));
        var mine = new List<LobsterController>();
        var theirs = new List<LobsterController>();
        foreach (var l in lobsters) ((l.side ?? "") == firstSide ? mine : theirs).Add(l);
        if (mine.Count == 0) { mine = theirs; theirs = new List<LobsterController>(); }
        var lobsterOrder = new List<LobsterController>();
        for (int i = 0; i < Mathf.Max(mine.Count, theirs.Count); i++)
        {
            if (i < mine.Count) lobsterOrder.Add(mine[i]);
            if (i < theirs.Count) lobsterOrder.Add(theirs[i]);
        }

        // Hidden by scale, not SetActive: SyncUnits arrives right after InitBattle and must still reach the rigs.
        foreach (var t in homes.Keys) t.localScale = Vector3.zero;
        hud?.HideForIntro();

        var skin = hud != null ? hud.Skin : null;
        var canvas = HudFactory.Canvas("IntroCanvas", 400, new Vector2(960f, 540f), 0.5f, 64f);
        var root = canvas.GetComponent<RectTransform>();
        var black = HudFactory.AddImage(HudFactory.Stretch(root, "Black"), skin != null ? skin.barFill : null, Color.black);
        var flash = HudFactory.AddImage(HudFactory.Stretch(root, "Flash"), skin != null ? skin.barFill : null, new Color(1f, 1f, 1f, 0f));
        Font font = skin != null ? skin.PixelFontOrDefault() : Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
        var ready = Title(root, "ClawsUp", font, 48, Color.white, "CLAWS UP!");
        var fight = Title(root, "Battle", font, 72, Gold, "BATTLE!");

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
        bool musicCued = false;
        void CueMusic()
        {
            if (musicCued) return;
            musicCued = true;
            Debug.Log("[BattleIntro] music cue");
            onMusicCue?.Invoke();
        }
        // Drops run as their own coroutines on a stagger; this counts the ones still falling.
        int running = 0;
        IEnumerator DropAll<T>(List<T> items, System.Func<T, Transform> tf, float stagger, float time, float height,
            System.Action<T> landed)
        {
            for (int i = 0; i < items.Count && !Skipped(); i++)
            {
                var item = items[i];
                running++;
                host.StartCoroutine(Drop(tf(item), homes[tf(item)], time, height, () => Skipped(), () => { running--; if (!skip) landed(item); }));
                if (stagger > 0f) yield return Wait(stagger);
            }
            while (running > 0 && !Skipped()) yield return null;
        }

        Debug.Log("[BattleIntro] start");
        // 1. Black → the empty arena, slowly.
        yield return Wait(BlackHold);
        yield return Tween(FadeIn, k => black.color = new Color(0f, 0f, 0f, 1f - Smooth(k)));
        yield return Wait(BeforeObstacles);

        // 2. Obstacles, all at once: one smash, started a hair early so its peak lands on contact.
        Debug.Log($"[BattleIntro] obstacles ({obstacles.Count})");
        if (obstacles.Count > 0)
        {
            host.StartCoroutine(SmashOnContact(ObstacleDrop - BattleSfx.IntroObstacleLandLead, () => skip));
            bool shook = false;
            yield return DropAll(obstacles, o => o, 0f, ObstacleDrop, ObstacleHeight, o =>
            {
                var g = o.GetComponent<UnityEngine.Rendering.SortingGroup>();
                IntroDust.Burst(host, homes[o].pos, g != null ? g.sortingOrder : DepthSort.ActorOrder, 1.1f);
                if (!shook) { shook = true; CameraShake.Shake(0.07f, 0.35f); }
            });
        }
        yield return Wait(BeforeLobsters);

        // 3. Lobsters, one at a time.
        Debug.Log($"[BattleIntro] lobsters ({lobsterOrder.Count})");
        yield return DropAll(lobsterOrder, l => l.transform, LobsterStagger, LobsterDrop, LobsterHeight, l =>
        {
            IntroDust.Burst(host, homes[l.transform].pos, l.SortingOrder, 1.25f);
            CameraShake.Shake(0.05f, 0.18f);
            BattleSfx.PlayIntroLobsterLand();
        });

        // 4. Take in the teams; the music starts creeping in.
        CueMusic();
        yield return Wait(TeamsHold);

        // 5. CLAWS UP!, then BATTLE!
        if (!skip)
        {
            BattleSfx.PlayIntroReady();
            ready.gameObject.SetActive(true);
        }
        yield return Tween(ReadyIn, k => { SetAlpha(ready, k); ready.transform.localScale = Vector3.one * Mathf.Lerp(0.7f, 1f, EaseOut(k)); });
        yield return Wait(ReadyHold);
        yield return Tween(ReadyOut, k => SetAlpha(ready, 1f - k));
        ready.gameObject.SetActive(false);

        if (!skip)
        {
            fight.gameObject.SetActive(true);
            // The voice peaks 0.15 s in and the slam takes 0.14 s: start it WITH the slam so the word hits on impact.
            BattleSfx.PlayIntroFight();
        }
        yield return Tween(FightSlam, k => { SetAlpha(fight, k); fight.transform.localScale = Vector3.one * Mathf.Lerp(2.4f, 1f, k * k); });
        if (!skip)
        {
            CameraShake.Shake(0.08f, 0.3f);
            host.StartCoroutine(FadeFlash(flash));
        }
        yield return Wait(FightHold);
        yield return Tween(FightOut, k => { SetAlpha(fight, 1f - k); fight.transform.localScale = Vector3.one * Mathf.Lerp(1f, 1.3f, k); });
        fight.gameObject.SetActive(false);

        // 6. HUD slides in.
        if (hud != null && !skip) yield return hud.SlideIn(SlideTime, Skipped);

        // End state, whatever was skipped: everything home, HUD in place, overlay gone, music started.
        foreach (var kv in homes)
            if (kv.Key != null) { kv.Key.position = kv.Value.pos; kv.Key.localScale = kv.Value.scale; }
        CueMusic();
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

    private static IEnumerator SmashOnContact(float delay, System.Func<bool> skipped)
    {
        for (float t = 0f; t < delay && !skipped(); t += Time.unscaledDeltaTime) yield return null;
        if (!skipped()) BattleSfx.PlayIntroObstacleLand();
    }

    private static float Smooth(float k) => k * k * (3f - 2f * k);

    /// <summary>Falls from <paramref name="height"/> above its home, accelerating, then a small bounce. Stops
    /// where it is if the intro is skipped (the end state puts everything home).</summary>
    private static IEnumerator Drop(Transform t, (Vector3 pos, Vector3 scale) home, float time, float height,
        System.Func<bool> skipped, System.Action done)
    {
        if (t == null) { done(); yield break; }
        t.localScale = home.scale;
        var top = home.pos + Vector3.up * height;
        // A lobster's shadow waits on its landing hex and grows as the body falls onto it.
        var lob = t.GetComponent<LobsterController>();
        if (lob != null) { lob.ShadowGround = home.pos; lob.ShadowScale = 0.25f; }
        for (float e = 0f; e < time && !skipped() && t != null; e += Time.unscaledDeltaTime)
        {
            float k = e / time;
            t.position = Vector3.Lerp(top, home.pos, k * k);
            if (lob != null) lob.ShadowScale = Mathf.Lerp(0.25f, 1f, k * k);
            yield return null;
        }
        if (t != null) t.position = home.pos;
        if (lob != null) { lob.ShadowGround = null; lob.ShadowScale = 1f; }
        done();   // the landing: dust, shake, thud
        for (float e = 0f; e < 0.14f && !skipped() && t != null; e += Time.unscaledDeltaTime)
        {
            t.position = home.pos + Vector3.up * (Bounce * Mathf.Sin(Mathf.PI * e / 0.14f));
            yield return null;
        }
        if (t != null) t.position = home.pos;
    }
}
