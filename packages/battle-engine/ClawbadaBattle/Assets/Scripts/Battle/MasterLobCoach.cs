using System.Collections;
using System.Collections.Generic;
using System.Text;
using Clawbada.UI;
using UnityEngine;
using UnityEngine.Rendering;

/// <summary>
/// Master Lob, the Dojo's coach (owner 2026-10-31). When the player has switched his guidance on, the web asks him to
/// speak at the start of some of the player's turns (BattleBridge.CoachSay — the web decides when and what, from its tip
/// curriculum). He poofs in on a free hex near the player's team, says the tip in Nzib's animated speech bubble while
/// his Speak loop plays, and poofs out when the reading time is up or the player acts.
///
/// Nzib's assets (design/vfx-specials, 2026-10-31): the MasterLobTutorial prefab (rig + shadow + smoke; its Appear and
/// Disappear clips carry the poof) and the AnimatedSpeechBubble (sizes itself from explicit newlines, 8 px Silkscreen,
/// opens in 0.6 s). The bubble lives on its own screen-space canvas at the art's 640×360, under the HUD.
///
/// Where he stands: never on a lobster (dead ones included — their corpses stay) or an obstacle, and preferably not
/// next to the active lobster or an enemy; on the player's side of the board, beside their team. No free hex → he skips.
/// </summary>
public class MasterLobCoach : MonoBehaviour
{
    /// <summary>Nzib's clip lengths (AC_Apex_MasterLob): Appear 1.0 s, Disappear 1.3 s; the Speak loop starts a little
    /// before Appear ends so he is already talking as the bubble opens.</summary>
    public const float AppearSeconds = 1.0f, SpeakFromSeconds = 0.8f, DisappearSeconds = 1.3f, DisappearSmokeAt = 0.45f;
    /// <summary>Reading time per page: a base plus per character, clamped (an 8-px pixel font reads slower than body text).</summary>
    public const float ReadBase = 2.2f, ReadPerChar = 0.05f, ReadMin = 3.5f, ReadMax = 9f;
    /// <summary>Bubble text: at most this many characters per line and lines per page. Upheaval at 20 px since 2026-11-09
    /// (Nzib: one in-game face; owner: the bubble grows to fit) — ~11 px a character, so 18 keeps a bubble near a third
    /// of the screen; it grows AnimatedSpeechBubble.LinePitch a line.</summary>
    public const int LineChars = 18, PageLines = 4;
    private const float CharPx = 11.2f;
    /// <summary>His mouth, from the rig root, in world units: up, and forward in the direction he faces. The bubble's tail
    /// lands here and the bubble opens on that side (owner 2026-11-01: lined up with his face, never over his back).</summary>
    public const float MouthHeight = 0.2f, MouthForward = 0.38f;   // owner 2026-11-01: the tail starts at his face, the bubble just above
    private const int CanvasOrder = 90;   // under the HUD (100)

    private BattleManager manager;
    private BattleVfxLibrary library;
    private GameObject actor;
    private Animator animator;
    private SortingGroup sorting;
    private Canvas canvas;
    private AnimatedSpeechBubble bubble;
    private Coroutine routine;
    private Vector2Int hex;
    private int shownOnTurn = -1;
    private string tipId = "";
    private bool leaving;
    /// <summary>He faces the way the player's team faces (toward the enemy side): side A faces right.</summary>
    private bool faceRight;
    private RectTransform connector;
    /// <summary>The rig as the prefab made it (what his clips' write-defaults must return to), restored before each visit.</summary>
    private Renderer[] rigRenderers;
    private bool[] rigRendererOn;
    private Transform[] rigParts;
    private bool[] rigPartOn;
    private Vector3[] rigPartPos;

    /// <summary>True from his first puff of smoke until the last.</summary>
    public bool Busy => routine != null;

    public void Bind(BattleManager battle)
    {
        manager = battle;
        library = battle.vfxLibrary;
        manager.TurnPlayStarted += _ => Dismiss("turn played");
        manager.TurnStarted += (data, _) => { if (Busy && data != null && data.turn != shownOnTurn) Dismiss("turn changed"); };
        manager.PreviewMoved += (_, col, row) => { if (Busy && HexCoord.Distance(col, row, hex.x, hex.y) <= 1) Dismiss("player moved next to him"); };
        manager.BattleEnded += _ => Dismiss("battle over");
    }

    /// <summary>Say a tip now, if the moment allows it (the player's turn, after the intro, not already talking).</summary>
    public void Say(string id, string text)
    {
        if (manager == null || library == null || library.masterLobTutorial == null || library.speechBubble == null) { Report(id, "skipped", "no assets"); return; }
        if (Busy) { Report(id, "skipped", "already talking"); return; }
        if (manager.IntroPlaying || !manager.isPlayerTurn) { Report(id, "skipped", "not the player's moment"); return; }
        var pages = Pages(text ?? "");
        faceRight = PlayerSide() == "A";
        if (!PickHex(BubbleSizeEstimate(pages), out hex)) { Report(id, "skipped", "no free hex"); return; }
        tipId = id ?? "";
        shownOnTurn = manager.CurrentTurn;
        routine = StartCoroutine(Show(pages));
    }

    /// <summary>Leave now (his Disappear and poof), if he is out.</summary>
    public void Dismiss(string why)
    {
        if (!Busy || leaving) return;
        StopCoroutine(routine);
        routine = StartCoroutine(Leave(why));
    }

    private IEnumerator Show(List<string> pages)
    {
        Ensure();
        leaving = false;
        var grid = manager.Grid;
        Vector3 pos = grid.GetWorldPosition(hex.x, hex.y);
        actor.transform.position = pos;
        // Facing the same way as the player's team. Nzib's prefab turns its inner Actor 180°, so at rotation 0 Master Lob
        // already faces RIGHT — the opposite of the battle rigs (LobsterController: 0 faces left).
        actor.transform.rotation = Quaternion.Euler(0f, faceRight ? 0f : 180f, 0f);
        sorting.sortingLayerName = DepthSort.Layer;
        sorting.sortingOrder = grid.SortingOrderAtY(pos.y, DepthSort.RowActor);
        RestoreRig();
        actor.SetActive(true);
        animator.Play("Appear", 0, 0f);
        animator.Update(0f);
        BattleSfx.PlayMasterLobPoofIn();   // the Appear clip's smoke starts at once
        Debug.Log($"[MasterLobCoach] appears at ({hex.x},{hex.y}) on turn {shownOnTurn}: {tipId}");
        Report(tipId, "shown", $"{hex.x},{hex.y}");
        yield return new WaitForSeconds(SpeakFromSeconds);
        animator.Play("Speak", 0, 0f);
        yield return new WaitForSeconds(AppearSeconds - SpeakFromSeconds);
        foreach (var page in pages)
        {
            bubble.gameObject.SetActive(true);
            bubble.SetText(page);
            PlaceBubble(pos);
            bubble.Replay();
            if (page == pages[0]) Debug.Log($"[MasterLobCoach] speaking with {VisibleParts()} parts visible");
            yield return new WaitForSeconds(Mathf.Clamp(ReadBase + ReadPerChar * page.Replace("\n", " ").Length, ReadMin, ReadMax));
        }
        routine = StartCoroutine(Leave("read"));
    }

    private IEnumerator Leave(string why)
    {
        leaving = true;
        if (bubble != null) bubble.gameObject.SetActive(false);
        if (actor != null && actor.activeSelf)
        {
            animator.Play("Disappear", 0, 0f);
            Debug.Log($"[MasterLobCoach] leaves ({why})");
            // Nzib's Disappear: a short wind-up, the smoke from 0.45 s (he is gone inside it at 0.55 s), clear by 1.25 s.
            yield return new WaitForSeconds(DisappearSmokeAt);
            BattleSfx.PlayMasterLobPoofOut();
            yield return new WaitForSeconds(DisappearSeconds - DisappearSmokeAt);
            actor.SetActive(false);
        }
        Report(tipId, "done", why);
        routine = null;
        leaving = false;
    }

    /// <summary>The tail's tip at his mouth, the bubble opening on the side he faces; kept inside the 640×360 view, clear
    /// of the HUD's top band.</summary>
    private void PlaceBubble(Vector3 actorPos)
    {
        var cam = Camera.main;
        var rt = (RectTransform)bubble.transform;
        var root = (RectTransform)canvas.transform;
        if (cam == null) return;
        Vector2 screen = cam.WorldToScreenPoint(Mouth(actorPos));
        RectTransformUtility.ScreenPointToLocalPointInRectangle(root, screen, null, out var mouth);
        Vector2 size = bubble.ExpandedSize;
        // AnimatedSpeechBubble puts the connector's lower-left at (−w/2 − 2, −h/2 − 12) from the bubble's centre; facing
        // left, LateUpdate mirrors it to the lower-right, so the bubble opens to his left instead.
        float dir = faceRight ? 1f : -1f;
        Vector2 centre = mouth + new Vector2(dir * (size.x / 2f + 2f), size.y / 2f + 12f);
        Vector2 half = root.rect.size / 2f;
        centre.x = Mathf.Clamp(centre.x, -half.x + size.x / 2f + 4f, half.x - size.x / 2f - 4f);
        centre.y = Mathf.Clamp(centre.y, -half.y + size.y / 2f + 16f, half.y - size.y / 2f - 44f);
        rt.anchoredPosition = new Vector2(Mathf.Round(centre.x), Mathf.Round(centre.y));
    }

    private Vector3 Mouth(Vector3 actorPos) => actorPos + new Vector3((faceRight ? 1f : -1f) * MouthForward, MouthHeight, 0f);

    /// <summary>
    /// Nzib's MasterLobTutorial prefab (2026-10-31) keeps its Animator on the root, but the rig's parts live under the
    /// "Actor" child while his Appear / Speak / Disappear clips address them as direct children ("Antennae", "Carapace",
    /// …) — the paths only resolve from Actor. From the root only "Smoke" bound: he stood fully visible before the smoke
    /// and after it cleared, and never moved his mouth. Here the Smoke goes under Actor and the Animator moves onto
    /// Actor, so every path binds: he appears behind the smoke, vanishes inside it, and talks. (Raised with Nzib to fix in
    /// the prefab; this keeps working either way.)
    /// </summary>
    private static Animator BindAnimatorToRig(GameObject root)
    {
        var rootAnimator = root.GetComponent<Animator>();
        var rig = root.transform.Find("Actor");
        if (rootAnimator == null || rig == null || rig.Find("Carapace") == null || root.transform.Find("Carapace") != null)
            return rootAnimator != null ? rootAnimator : root.GetComponentInChildren<Animator>();
        var smoke = root.transform.Find("Smoke");
        if (smoke != null) smoke.SetParent(rig, true);
        var controller = rootAnimator.runtimeAnimatorController;
        Object.DestroyImmediate(rootAnimator);
        var animator = rig.gameObject.GetComponent<Animator>() ?? rig.gameObject.AddComponent<Animator>();
        animator.runtimeAnimatorController = controller;
        return animator;
    }

    /// <summary>
    /// His states write defaults, and Speak keys no visibility, so while he talks every part shows as the Animator's
    /// default. Those defaults are re-read from the rig each time he is switched on — and his Disappear leaves every part
    /// hidden. So from his SECOND visit on he came out of the smoke and vanished the moment he began to speak, leaving
    /// the bubble alone (owner 2026-11-01). Putting the rig back as the prefab made it before each visit keeps the
    /// defaults right.
    /// </summary>
    private void SnapshotRig()
    {
        var root = animator != null ? animator.gameObject : actor;
        rigRenderers = root.GetComponentsInChildren<Renderer>(true);
        rigRendererOn = new bool[rigRenderers.Length];
        for (int i = 0; i < rigRenderers.Length; i++) rigRendererOn[i] = rigRenderers[i].enabled;
        rigParts = root.GetComponentsInChildren<Transform>(true);
        rigPartOn = new bool[rigParts.Length];
        rigPartPos = new Vector3[rigParts.Length];
        for (int i = 0; i < rigParts.Length; i++) { rigPartOn[i] = rigParts[i].gameObject.activeSelf; rigPartPos[i] = rigParts[i].localPosition; }
    }

    /// <summary>Harness signal: rig parts drawing right now (0 while he talks = the bug above).</summary>
    private int VisibleParts()
    {
        int n = 0;
        if (rigRenderers != null) foreach (var r in rigRenderers) if (r != null && r.enabled && r.gameObject.activeInHierarchy && r.name != "Smoke" && !(r.transform.parent != null && r.transform.parent.name == "Smoke")) n++;
        return n;
    }

        private void RestoreRig()
    {
        if (rigRenderers == null) return;
        for (int i = 0; i < rigRenderers.Length; i++) if (rigRenderers[i] != null) rigRenderers[i].enabled = rigRendererOn[i];
        for (int i = 0; i < rigParts.Length; i++)
        {
            if (rigParts[i] == null || rigParts[i].gameObject == actor) continue;
            rigParts[i].localPosition = rigPartPos[i];
            rigParts[i].gameObject.SetActive(rigPartOn[i]);
        }
    }

    private string PlayerSide()
    {
        foreach (var l in manager.AllLobsters) if (l != null && l.lobsterId == manager.activeLobsterId) return l.side;
        return "A";
    }

    void LateUpdate()
    {
        // His bubble's tail is drawn for a speaker on its left. Facing left he speaks from its right: mirror the tail
        // to the bubble's lower-right corner (after AnimatedSpeechBubble.Evaluate has placed it, every frame it plays).
        if (connector == null || bubble == null || !bubble.gameObject.activeSelf) return;
        Vector2 size = bubble.ExpandedSize;
        if (faceRight) { connector.localScale = Vector3.one; return; }
        connector.localScale = new Vector3(-1f, 1f, 1f);
        connector.anchoredPosition = new Vector2(size.x / 2f + 2f, -size.y / 2f - 12f);
    }

    private void Ensure()
    {
        if (actor == null)
        {
            actor = Instantiate(library.masterLobTutorial, manager.transform.parent);
            actor.name = "MasterLobCoach";
            animator = BindAnimatorToRig(actor);
            SnapshotRig();
            sorting = actor.GetComponent<SortingGroup>() ?? actor.AddComponent<SortingGroup>();
            actor.SetActive(false);
        }
        if (canvas == null)
        {
            // 640×360 reference: one canvas unit is one art pixel, as Nzib's bubble expects.
            canvas = HudFactory.Canvas("MasterLobCoachCanvas", CanvasOrder, new Vector2(640f, 360f), 0.5f, 100f);
            var raycaster = canvas.GetComponent<UnityEngine.UI.GraphicRaycaster>();
            if (raycaster != null) raycaster.enabled = false;   // never takes a click meant for the board
            var go = Instantiate(library.speechBubble, canvas.transform, false);
            bubble = go.GetComponent<AnimatedSpeechBubble>();
            foreach (var t in go.GetComponentsInChildren<RectTransform>(true)) if (t.name == "Connector") connector = t;
            var rt = (RectTransform)go.transform;
            rt.anchorMin = rt.anchorMax = new Vector2(0.5f, 0.5f);
            rt.pivot = new Vector2(0.5f, 0.5f);
            foreach (var g in go.GetComponentsInChildren<UnityEngine.UI.Graphic>(true)) g.raycastTarget = false;
            go.SetActive(false);
        }
    }

    // ─── Where to stand ───

    /// <summary>His bubble's size for these pages, in art px, before it exists (20 px Upheaval ≈ 11.2 px a character; his
    /// component pads 28 px; the height follows AnimatedSpeechBubble.HeightFor).</summary>
    public static Vector2 BubbleSizeEstimate(List<string> pages)
    {
        int chars = 0, lines = 1;
        foreach (var p in pages)
        {
            var ls = p.Split('\n');
            lines = Mathf.Max(lines, ls.Length);
            foreach (var l in ls) chars = Mathf.Max(chars, l.Length);
        }
        return new Vector2(Mathf.Max(44f, chars * CharPx + 28f), Clawbada.UI.AnimatedSpeechBubble.HeightFor(lines));
    }

    private bool PickHex(Vector2 bubbleSize, out Vector2Int best)
    {
        best = default;
        var grid = manager.Grid;
        if (grid == null) return false;
        LobsterController active = null;
        var taken = new HashSet<Vector2Int>();
        var mine = new List<LobsterController>();
        var enemies = new List<LobsterController>();
        foreach (var l in manager.AllLobsters)
        {
            if (l == null) continue;
            if (!l.CorpseGone) taken.Add(new Vector2Int(l.col, l.row));
            if (l.lobsterId == manager.activeLobsterId) active = l;
        }
        if (active == null) return false;
        foreach (var l in manager.AllLobsters)
            if (l != null && l.alive) (l.side == active.side ? mine : enemies).Add(l);

        // Which way is "home": the player's lobsters sit on one side of the board, the enemy's on the other.
        float myCol = 0f, theirCol = 0f;
        foreach (var m in mine) myCol += m.col;
        foreach (var e in enemies) theirCol += e.col;
        myCol = mine.Count > 0 ? myCol / mine.Count : 0f;
        theirCol = enemies.Count > 0 ? theirCol / enemies.Count : myCol + 1f;
        float home = Mathf.Sign(myCol - theirCol);   // +1: home is the higher columns
        if (home == 0f) home = active.side == "A" ? -1f : 1f;

        // Strict first (not next to the active lobster or an enemy); then allowing enemies close; then anything free.
        // He blocks no click: a player who moves onto or next to him just sends him off (PreviewMoved → Dismiss).
        for (int pass = 0; pass < 3; pass++)
        {
            var options = new List<(Vector2Int cell, float score)>();
            for (int c = 0; c < 12; c++)
                for (int r = 0; r < 12; r++)
                {
                    if (!grid.InBounds(c, r) || grid.IsBlocked(c, r)) continue;
                    var cell = new Vector2Int(c, r);
                    if (taken.Contains(cell)) continue;
                    if (pass == 0 && HexCoord.Distance(c, r, active.col, active.row) <= 1) continue;
                    if (pass <= 1 && enemies.Exists(e => HexCoord.Distance(c, r, e.col, e.row) <= 1)) continue;
                    float nearMine = float.MaxValue, nearEnemy = float.MaxValue;
                    foreach (var m in mine) nearMine = Mathf.Min(nearMine, HexCoord.Distance(c, r, m.col, m.row));
                    foreach (var e in enemies) nearEnemy = Mathf.Min(nearEnemy, HexCoord.Distance(c, r, e.col, e.row));
                    // On the player's side of the board, beside their team; mildly away from where the active lobster
                    // might want to step; never toward the enemy.
                    float sideOfMine = (c - myCol) * home;                  // > 0: behind the team, < 0: in front
                    float score = Mathf.Abs(nearMine - 1.5f)
                                + (sideOfMine < -0.5f ? 2.5f + (-sideOfMine) : 0f)
                                + (HexCoord.Distance(c, r, active.col, active.row) <= active.moveRange ? 0.6f : 0f)
                                - 0.25f * Mathf.Min(nearEnemy, 4f)
                                + 3f * BubbleCovers(grid.GetWorldPosition(c, r), bubbleSize)
                                + 4f * BubbleOffLimits(grid.GetWorldPosition(c, r), bubbleSize)
                                + Random.value * 0.5f;
                    options.Add((cell, score));
                }
            if (options.Count == 0) continue;
            options.Sort((a, b) => a.score.CompareTo(b.score));
            best = options[0].cell;
            return true;
        }
        return false;
    }

    /// <summary>The art frame (640×360 px centred on the origin, 64 px a unit) less the HUD's turn-order strip along the
    /// top (~54 px): his bubble, twice as tall since Upheaval (2026-11-09), must stay inside it.</summary>
    private const float FrameHalfW = 5f, FrameTopY = 2.8125f - 54f / 64f;
    /// <summary>How far his bubble would poke out of that area, in bubble heights (0 = inside).</summary>
    private float BubbleOffLimits(Vector3 actorPos, Vector2 size)
    {
        Vector2 mouth = Mouth(actorPos);
        float w = size.x / 64f, h = size.y / 64f, x = faceRight ? mouth.x + 2f / 64f : mouth.x - 2f / 64f - w;
        float top = mouth.y + 12f / 64f + h;
        float over = Mathf.Max(0f, top - FrameTopY) + Mathf.Max(0f, x + w - FrameHalfW) + Mathf.Max(0f, -FrameHalfW - x);
        return over / Mathf.Max(0.1f, h);
    }

    /// <summary>How many living lobsters his bubble would cover if he stood at <paramref name="actorPos"/> (world units;
    /// 64 art px a unit). Mirrors PlaceBubble: the tail at his mouth, the bubble up and to the side he faces.</summary>
    private float BubbleCovers(Vector3 actorPos, Vector2 size)
    {
        Vector2 mouth = Mouth(actorPos);
        float w = size.x / 64f, x = faceRight ? mouth.x + 2f / 64f : mouth.x - 2f / 64f - w;
        var bubble = new Rect(x, mouth.y + 12f / 64f, w, size.y / 64f);
        float covered = 0f;
        foreach (var l in manager.AllLobsters)
        {
            if (l == null || !l.alive) continue;
            Vector2 p = l.transform.position;
            var body = new Rect(p.x - 0.45f, p.y - 0.1f, 0.9f, 0.75f);   // roughly a lobster's sprite
            if (bubble.Overlaps(body)) covered += 1f;
        }
        return covered;
    }

    // ─── Text ───

    /// <summary>Word-wrap to LineChars per line (his bubble sizes from explicit newlines) and split into pages of
    /// PageLines lines. Public for the editor smoke test.</summary>
    public static List<string> Pages(string text)
    {
        var lines = new List<string>();
        var line = new StringBuilder();
        foreach (var word in text.Replace("\n", " ").Split(' '))
        {
            if (word.Length == 0) continue;
            if (line.Length > 0 && line.Length + 1 + word.Length > LineChars) { lines.Add(line.ToString()); line.Clear(); }
            if (line.Length > 0) line.Append(' ');
            line.Append(word);
        }
        if (line.Length > 0) lines.Add(line.ToString());
        var pages = new List<string>();
        for (int i = 0; i < lines.Count; i += PageLines)
            pages.Add(string.Join("\n", lines.GetRange(i, Mathf.Min(PageLines, lines.Count - i))));
        if (pages.Count == 0) pages.Add("");
        return pages;
    }

    private void Report(string id, string state, string detail)
    {
        if (state == "skipped") Debug.Log($"[MasterLobCoach] skipped {id}: {detail}");
        FindAnyObjectByType<BattleBridge>()?.NotifyCoachState(id ?? "", state, detail ?? "");
    }
}
