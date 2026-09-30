using System.Collections.Generic;
using System.Text;
using UnityEngine;
using UnityEngine.UI;

/// <summary>
/// The in-canvas battle HUD (LOKR-style). Built entirely in code at runtime from a
/// HudSkin (Resources/UI/HudSkin.asset) and attached by BattleManager.Awake, so no
/// scene or prefab wiring is needed. React still owns the rules: it sends the turn,
/// bar, clock and unit truth; Unity draws them and reports clicks.
///
/// Layout (960x540 reference, Nzib's layout 2026-09-28): settings + timer hexes top-left, the opponents'
/// three team panels top-right, yours bottom-left (turn-order numbers, pulsing outline on the lobster acting
/// now), the 2×2 action buttons bottom-right with the hint line above them, unit overlays following the rigs,
/// floats and the result banner over everything.
/// </summary>
public class BattleHud : MonoBehaviour
{
    public HudSkin Skin { get; private set; }
    public Canvas Canvas { get; private set; }
    /// <summary>The six team panels (Nzib's layout, 2026-09-28): yours bottom-left, theirs top-right, turn-order numbers.</summary>
    public TeamPanels Teams { get; private set; }
    /// <summary>The acting lobster's panel.</summary>
    public ActivePanel Panel => Teams != null ? Teams.PanelFor(activeId) : null;
    /// <summary>The selected-but-unconfirmed target's panel (two-step targeting), or null.</summary>
    public ActivePanel TargetPanel => Teams != null && !string.IsNullOrEmpty(targetedId) ? Teams.PanelFor(targetedId) : null;
    /// <summary>Shot clock: a hex top-left beside the settings hex, always shown, counting on the player's turn.</summary>
    public ClockView Clock { get; private set; }
    /// <summary>Top-left hexes (settings, timer) — design px 48 at 1.25.</summary>
    private const float HexSize = 60f;

    /// <summary>Run the shot clock on the player's turn; otherwise the hex stays, dimmed and empty.</summary>
    private void SetClock(int remainingMs)
    {
        if (remainingMs > 0) Clock.StartClock(remainingMs);
        else Clock.StopClock();
    }
    public ResultBanner Banner { get; private set; }
    public ActiveMarker Marker { get; private set; }
    public ActionBar Bar { get; private set; }
    /// <summary>Every lobster's avatar portrait, taken once when the battle binds.</summary>
    public PortraitSnapshot Portraits { get; private set; }
    /// <summary>Settings hex menu, top-left. Participants only; carries the forfeit.</summary>
    public OptionsMenu Options { get; private set; }
    public IReadOnlyDictionary<string, UnitOverlay> Overlays => overlays;

    private BattleManager manager;
    private RectTransform canvasRect;
    private RectTransform overlayLayer;
    private RectTransform floatLayer;
    private readonly Dictionary<string, UnitOverlay> overlays = new();
    private Camera cam;
    private string activeId = "";
    /// <summary>Field bars (LOKR): the enemy the player's team hit last, and the unit being targeted.</summary>
    private string lastHitEnemyId = "";
    private string targetedId = "";
    private string sideOfPlayer = "";
    private string lastFieldBarDesc = "";
    private bool built;

    /// <summary>Attach a HUD to the manager if a skin asset exists; otherwise stay silent
    /// so a build without generated art still plays (React's fallback HUD covers it).</summary>
    public static BattleHud Attach(BattleManager manager)
    {
        var skin = Resources.Load<HudSkin>("UI/HudSkin");
        if (skin == null)
        {
            Debug.LogWarning("[BattleHud] No Resources/UI/HudSkin.asset — in-canvas HUD disabled. Run Clawbada/Generate HUD Placeholder Art.");
            return null;
        }
        var hud = manager.gameObject.AddComponent<BattleHud>();
        hud.manager = manager;
        hud.Build(skin);
        hud.Subscribe(manager);
        return hud;
    }

    private Behaviour ppc;
    private int lastScreenW = -1, lastScreenH = -1;

    /// <summary>
    /// Two camera modes, chosen from the canvas size alone so React and Unity can never disagree:
    ///  • pixel-perfect — the canvas is an exact 640k×360k (k ≥ 2), which React only produces on
    ///    purpose (BattleStage snaps the canvas on retina/tablet screens). The PixelPerfectCamera
    ///    is enabled and lands on integer zoom k with no letterbox: every art pixel is k device
    ///    pixels, and the framing is the authored 10×5.625 units exactly as before.
    ///  • fill — any other size (phones, non-retina desktops, k = 1). The PPC would letterbox the
    ///    arena inside the canvas, so it is disabled and the camera fills the canvas as it always
    ///    has (fractional scale, the pre-2026-09-15 behaviour).
    /// Re-evaluated whenever the screen size changes (fullscreen toggle, window resize).
    /// </summary>
    private void ApplyCameraMode()
    {
        if (cam == null) return;
        lastScreenW = Screen.width;
        lastScreenH = Screen.height;
        int kw = Screen.width / 640, kh = Screen.height / 360;
        bool exact = Skin != null && Skin.fillCanvas
            && Screen.width % 640 == 0 && Screen.height % 360 == 0 && kw == kh && kw >= 2;
        cam.orthographic = true;
        if (exact && ppc != null)
        {
            ppc.enabled = true;   // the PPC sets the orthographic size itself: 360 / (2 × 64) = 2.8125 at integer zoom
            StartCoroutine(LogCameraAfterFrame($"pixel-perfect k={kw}"));
        }
        else
        {
            if (ppc != null && ppc.enabled) ppc.enabled = false;
            if (Skin != null && Skin.fillCanvas) cam.orthographicSize = Skin.fillOrthographicSize;
            StartCoroutine(LogCameraAfterFrame("fill"));
        }
    }

    /// <summary>The PPC applies its orthographic size during rendering, so read it a frame later.
    /// Pixels per world unit = Screen.height / (2 × orthographicSize): 192.0 is integer zoom 3.</summary>
    private System.Collections.IEnumerator LogCameraAfterFrame(string mode)
    {
        yield return null;
        yield return null;
        if (cam == null) yield break;
        float ppu = Screen.height / (2f * cam.orthographicSize);
        Debug.Log($"[BattleHud] camera mode {mode} ({Screen.width}x{Screen.height}) ortho={cam.orthographicSize:F4} px/unit={ppu:F2} zoom={ppu / 64f:F3}x");
    }

    void Update()
    {
        if (built && (Screen.width != lastScreenW || Screen.height != lastScreenH)) ApplyCameraMode();
    }

    public void Build(HudSkin skin)
    {
        if (built) return;
        built = true;
        Skin = skin;
        cam = Camera.main != null ? Camera.main : FindFirstObjectByType<Camera>();
        ppc = cam != null ? cam.GetComponent("PixelPerfectCamera") as Behaviour : null;
        if (cam != null) cam.cullingMask &= ~(1 << PortraitSnapshot.Layer);   // avatar portraits render on their own
        ApplyCameraMode();

        HudFactory.EnsureEventSystem();
        Canvas = HudFactory.Canvas("BattleHudCanvas", 100, new Vector2(960f, 540f), 0.5f, 64f);
        canvasRect = Canvas.GetComponent<RectTransform>();

        overlayLayer = HudFactory.Stretch(canvasRect, "Overlays");
        Portraits = ActivePanel.NewPortraits();
        Teams = TeamPanels.Create(canvasRect, skin, Portraits);
        // Top-left: the settings hex (Options, below) then the timer hex beside it.
        Clock = ClockView.Create(canvasRect, "Clock", skin, HexSize, 24);
        Clock.Rect.anchorMin = Clock.Rect.anchorMax = Clock.Rect.pivot = new Vector2(0f, 1f);
        Clock.Rect.anchoredPosition = new Vector2(TeamPanels.Edge + HexSize + 6f, -TeamPanels.Edge);
        // LOKR-style: the selected target carries a small copy of the armed action's button above it.
        // Clickable (user 2026-09-27): tapping the badge confirms the selected target, exactly like pressing
        // the armed action again — so it is raycast-on and forwards the armed action to React.
        bool nzibButtons = skin.actionFrame != null;
        targetBadge = HudFactory.Image(canvasRect, "TargetBadge", nzibButtons ? skin.actionAttack : skin.btnAttack, Color.white,
            nzibButtons ? new Vector2(BadgeSize, BadgeSize) : new Vector2(BadgeSize, BadgeSize * 1.143f), raycast: true);
        targetBadgeIcon = HudFactory.Image(targetBadge.transform, "Icon", skin.iconAttack, Color.white, new Vector2(BadgeSize * 0.55f, BadgeSize * 0.55f));
        if (nzibButtons)
        {
            targetBadgeIcon.enabled = false;   // Nzib's buttons carry their own glyphs
            HudFactory.AddImage(HudFactory.Stretch(targetBadge.transform, "Frame"), skin.actionFrame, skin.buttonArmed);
        }
        var badgeButton = targetBadge.gameObject.AddComponent<Button>();
        badgeButton.targetGraphic = targetBadge;
        var bc = badgeButton.colors;
        bc.highlightedColor = new Color(1f, 1f, 0.85f, 1f);
        bc.pressedColor = new Color(0.8f, 0.8f, 0.8f, 1f);
        badgeButton.colors = bc;
        badgeButton.onClick.AddListener(() =>
        {
            if (string.IsNullOrEmpty(targetAction)) return;
            Debug.Log($"[BattleHud] badge press {targetAction} → confirm {targetedId}");
            bridge?.NotifyActionSelected(targetAction);
        });
        targetBadge.gameObject.SetActive(false);
        // 2×2 button cluster bottom-right; the hint line right-aligned just above it.
        Bar = ActionBar.Create(canvasRect, skin, new Vector2(-TeamPanels.Edge, TeamPanels.Edge), Vector2.zero);
        Bar.PlaceHint(new Vector2(-TeamPanels.Edge, TeamPanels.Edge + Bar.Height + 4f));
        bridge = FindFirstObjectByType<BattleBridge>();
        Bar.ActionPressed += a => bridge?.NotifyActionSelected(a);
        Options = OptionsMenu.Create(canvasRect, skin, new Vector2(TeamPanels.Edge, -TeamPanels.Edge), HexSize);
        Options.ForfeitConfirmed += () => bridge?.NotifyForfeit();
        Options.MusicToggled += on => bridge?.NotifyAudioPref("music", on);
        Options.SfxToggled += on => bridge?.NotifyAudioPref("sfx", on);
        Options.MusicVolumeChanged += v => bridge?.NotifyAudioVolume("musicVol", v);
        Options.SfxVolumeChanged += v => bridge?.NotifyAudioVolume("sfxVol", v);
        Options.HintsToggled += _ => Bar.RefreshHint();
        floatLayer = HudFactory.Stretch(canvasRect, "Floats");
        Banner = ResultBanner.Create(canvasRect, skin);
        Marker = ActiveMarker.Create(skin);
        TargetMarker = ActiveMarker.Create(skin, "TargetMarker", new Color(1f, 0.42f, 0.12f, 1f), new Color(1f, 0.9f, 0.45f, 1f), pulse: true);

        Debug.Log($"[BattleHud] ready {Screen.width}x{Screen.height} scale={Canvas.scaleFactor:F2}");
    }

    public void Subscribe(BattleManager m)
    {
        manager = m;
        m.Initialized += Bind;
        m.TurnStarted += OnTurnStarted;
        m.BarUpdated += OnBarUpdated;
        m.ClockSet += OnClockSet;
        m.UnitsSynced += OnUnitsSynced;
        m.DamageApplied += OnDamageApplied;
        m.HealApplied += OnHealApplied;
        m.StatusChanged += OnStatusChanged;
        m.Died += OnDied;
        m.TurnSkipped += OnTurnSkipped;
        m.BattleEnded += OnBattleEnded;
        m.SelectionChanged += OnSelectionChanged;
    }

    private void OnTurnSkipped(LobsterController lob, string reason)
    {
        SpawnFloatFor(lob, reason == "stun" ? "STUNNED" : reason.ToUpperInvariant(), Skin.textSecondary, 14);
        Debug.Log($"[BattleHud] float {lob.lobsterId} {reason} skip");
    }

    private void OnSelectionChanged(SelectionData data)
    {
        Bar.Apply(data);
        // The unit under consideration as a target carries a field bar while the player chooses.
        targetedId = data != null && data.isPlayerTurn ? (data.targetId ?? "") : "";
        targetAction = data != null ? (data.action ?? "") : "";
        RefreshFieldBars();
        ShowTargetPanel();
        ShowTargetBadge();
    }

    private string shownTargetId = "";
    private string targetAction = "";
    /// <summary>Hot-orange pulsing ring under the selected target (the acting lobster's ring is white).</summary>
    public ActiveMarker TargetMarker { get; private set; }
    private LobsterController targetLob;
    private Image targetBadge;
    private BattleBridge bridge;
    private Image targetBadgeIcon;
    private const float BadgeSize = 48f;      // reference px (canvas 960x540): Nzib's 48 px button at 2/3 of the bar's size
    private const float BadgeLift = 0.40f;    // world units above the field bar's anchor: just clear of the bar, low enough not to sit over the row behind
    private const float BadgeBobPx = 3f;

    private bool badgeLogPending;

    /// <summary>Badge rect in the action-bar log's convention, for the harness / agents to click.</summary>
    private void LogBadgeRect()
    {
        var sb = new System.Text.StringBuilder("[BattleHud] badge");
        ActionBar.AppendRect(sb, "badge", targetBadge.rectTransform);
        Debug.Log(sb.ToString());
    }

    private void ShowTargetBadge()
    {
        targetLob = null;
        if (!string.IsNullOrEmpty(targetedId) && manager != null && (targetAction == "attack" || targetAction == "special"))
            foreach (var lob in manager.Lobsters) if (lob != null && lob.lobsterId == targetedId && lob.alive) { targetLob = lob; break; }
        if (targetLob == null) { targetBadge.gameObject.SetActive(false); TargetMarker.Hide(); return; }
        TargetMarker.Follow(targetLob);
        bool special = targetAction == "special";
        if (Skin.actionFrame != null)
        {
            var actor = manager.GetLobster(activeId);
            var own = special && actor != null ? Skin.SpecialButton(actor.classId) : null;
            targetBadge.sprite = special ? (own != null ? own : Skin.btnSpecial) : Skin.actionAttack;
        }
        else
        {
            var plate = special ? Skin.btnSpecial : Skin.btnAttack;
            targetBadge.sprite = plate != null ? plate : Skin.hexButton64;
            targetBadgeIcon.sprite = special ? Skin.iconSpecial : Skin.iconAttack;
            targetBadgeIcon.enabled = targetBadgeIcon.sprite != null;
        }
        targetBadge.gameObject.SetActive(true);
        Debug.Log($"[BattleHud] target badge {targetAction} over {targetLob.lobsterId}");
        badgeLogPending = true;
    }

    /// <summary>The selected target's own team panel pulses orange (it replaces the separate target avatar).</summary>
    private void ShowTargetPanel()
    {
        LobsterController target = null;
        if (!string.IsNullOrEmpty(targetedId) && manager != null)
            foreach (var lob in manager.Lobsters) if (lob != null && lob.lobsterId == targetedId) { target = lob; break; }
        Teams.SetTarget(target != null ? target.lobsterId : "");
        if (target == null) { shownTargetId = ""; return; }
        if (target.lobsterId != shownTargetId)
        {
            shownTargetId = target.lobsterId;
            Debug.Log($"[BattleHud] target panel {target.lobsterId} ({target.className}) HP {target.currentHp}/{target.maxHp} charge {target.charge}");
        }
    }

    /// <summary>Field bars, LOKR-style: only the enemy hit last and the unit being targeted carry
    /// one; everyone else stays bare (health is in the strip and the active panel).</summary>
    private void RefreshFieldBars()
    {
        var shown = new StringBuilder();
        foreach (var kv in overlays)
        {
            bool on = kv.Key == lastHitEnemyId || kv.Key == targetedId;
            kv.Value.SetShown(on);
            if (kv.Value.gameObject.activeSelf) { if (shown.Length > 0) shown.Append(','); shown.Append(kv.Key); }
        }
        string desc = $"last={lastHitEnemyId} target={targetedId} shown=[{shown}]";
        if (desc != lastFieldBarDesc) { lastFieldBarDesc = desc; Debug.Log($"[BattleHud] fieldbar {desc}"); }
    }

    void OnDestroy()
    {
        if (manager == null) return;
        manager.Initialized -= Bind;
        manager.TurnStarted -= OnTurnStarted;
        manager.BarUpdated -= OnBarUpdated;
        manager.ClockSet -= OnClockSet;
        manager.UnitsSynced -= OnUnitsSynced;
        manager.DamageApplied -= OnDamageApplied;
        manager.HealApplied -= OnHealApplied;
        manager.StatusChanged -= OnStatusChanged;
        manager.Died -= OnDied;
        manager.TurnSkipped -= OnTurnSkipped;
        manager.BattleEnded -= OnBattleEnded;
        manager.SelectionChanged -= OnSelectionChanged;
    }

    // ─── Binding ───

    public void Bind(BattleInitData init)
    {
        foreach (var o in overlays.Values) if (o != null) Destroy(o.gameObject);
        overlays.Clear();
        sideOfPlayer = init?.playerSide ?? "";
        var ids = new StringBuilder();
        foreach (var lob in manager.Lobsters)
        {
            if (lob == null) continue;
            var overlay = UnitOverlay.Create(overlayLayer, Skin);
            overlay.Bind(lob, friendly: !string.IsNullOrEmpty(sideOfPlayer) && lob.side == sideOfPlayer);
            overlays[lob.lobsterId] = overlay;
            if (ids.Length > 0) ids.Append(',');
            ids.Append(lob.lobsterId);
        }
        // Avatar portraits: once per lobster, now, while every rig stands at rest (user: not every turn).
        Portraits.Clear();
        foreach (var lob in manager.Lobsters) if (lob != null) Portraits.Capture(lob, ActivePanel.PortraitDrop);
        Teams.Bind(manager.Lobsters, sideOfPlayer == "B" ? "B" : "A");

        // Team corners used to carry TEAM A · YOU / TEAM B · BOT plates. Sides read from
        // facing, the move prompt and the active-lobster card, so the corners stay clear —
        // which is also where the gear now lives.
        string playerSide = init?.playerSide ?? "";
        Options.SetAvailable(playerSide == "A" || playerSide == "B");
        lastHitEnemyId = "";
        targetedId = "";
        lastFieldBarDesc = "";
        RefreshFieldBars();

        activeId = "";
        Teams.ClearMarks();
        shownTargetId = "";
        targetLob = null;
        if (targetBadge != null) targetBadge.gameObject.SetActive(false);
        TargetMarker?.Hide();
        SetClock(0);
        Banner.Hide();
        Marker.Hide();
        Bar.Apply(null);
        Debug.Log($"[BattleHud] bind n={overlays.Count} ids={ids}");
    }

    // ─── Manager events ───

    private void OnTurnStarted(TurnStartData data, int fallbackRemainingMs)
    {
        activeId = data.lobsterId ?? "";
        RefreshFieldBars();
        // The bar belongs to the player's own turn; React re-sends the real state right after.
        if (!data.isPlayer) Bar.Apply(null);
        var lob = manager.GetLobster(activeId);
        if (lob != null) Bar.SetActorClass(lob.classId);
        Marker.Follow(lob);
        SetClock(data.isPlayer ? fallbackRemainingMs : 0);
        Teams.SetTurn(activeId, manager.upcoming);
        Debug.Log($"[BattleHud] turn {data.turn} active={activeId} order=[{string.Join(",", Teams.CurrentOrder)}]");
        // Layout dump for the harness: the first two turns, plus the player's first two own
        // turns (the bots may act first, so turn <= 2 alone can miss the player entirely).
        if (data.turn <= 2 || (data.isPlayer && playerTurnsDumped++ < 2)) DumpLayout();
    }

    /// <summary>One-off geometry dump (harness diagnostics): every top-level HUD child with its
    /// active state and screen-space rect.</summary>
    private int playerTurnsDumped;

    public void DumpLayout()
    {
        var sb = new StringBuilder();
        sb.Append($"[BattleHud] layout screen={Screen.width}x{Screen.height} canvas={canvasRect.rect.size} scale={Canvas.scaleFactor:F2} cam={(cam != null ? cam.pixelRect.ToString() : "none")} ortho={(cam != null ? cam.orthographicSize : 0f):F2}");
        var corners = new Vector3[4];
        for (int i = 0; i < canvasRect.childCount; i++)
        {
            var child = canvasRect.GetChild(i) as RectTransform;
            if (child == null) continue;
            child.GetWorldCorners(corners);
            sb.Append($" | {child.name}:{(child.gameObject.activeSelf ? "on" : "off")} [{corners[0].x:F0},{corners[0].y:F0}→{corners[2].x:F0},{corners[2].y:F0}]");
        }
        Debug.Log(sb.ToString());

        // Screen position of every in-bounds cell (pixels, y up) — the browser harness
        // clicks cells and units through this instead of probing.
        var grid = FindFirstObjectByType<HexGrid>();
        var arena = manager?.InitData?.arena;
        if (grid != null && arena != null && cam != null)
        {
            var cells = new StringBuilder("[BattleHud] cells");
            for (int r = 0; r < arena.rows; r++)
            for (int c = 0; c < arena.cols; c++)
            {
                var sp = cam.WorldToScreenPoint(grid.GetWorldPosition(c, r));
                cells.Append($" ({c},{r})=({sp.x:F0},{sp.y:F0})");
            }
            Debug.Log(cells.ToString());
        }
    }

    private void OnBarUpdated(BarData data)
    {
        Teams.SetTurn(activeId, data?.entries);
        Debug.Log($"[BattleHud] bar turn={data?.turn} order=[{string.Join(",", Teams.CurrentOrder)}]");
    }

    private void OnClockSet(int remainingMs)
    {
        SetClock(manager.isPlayerTurn ? remainingMs : 0);
        Debug.Log($"[BattleHud] clock {remainingMs}");
    }

    private void OnUnitsSynced(UnitsSyncData data)
    {
        // Truth may have killed or revived someone: renumber the order, not just the bars.
        Teams.SetTurn(activeId, manager.upcoming);
        Refresh();
        var sb = new StringBuilder();
        foreach (var lob in manager.Lobsters)
        {
            if (sb.Length > 0) sb.Append(' ');
            sb.Append(lob.lobsterId).Append('=').Append(lob.currentHp).Append('/').Append(lob.maxHp);
        }
        Debug.Log($"[BattleHud] sync turn={data?.turn} {sb}");
    }

    private void OnDamageApplied(LobsterController target, int amount, string kind, bool isCrit)
    {
        Color c = kind == "self" ? Skin.floatSelf : isCrit ? Skin.floatCrit : Skin.floatNormal;
        string text = "-" + amount + (isCrit ? "!" : "");
        SpawnFloatFor(target, text, c, isCrit ? 24 : 16);   // Silkscreen sits on an 8 px grid: 16 / 24, never 22
        Debug.Log($"[BattleHud] float {target.lobsterId} {text} {kind}");
        // LOKR: the enemy the player's team hit last keeps a tight bar until another is hit.
        bool primary = kind == "attack" || kind == "special";
        var actor = manager.GetLobster(activeId);
        bool byPlayer = actor != null && (string.IsNullOrEmpty(sideOfPlayer) || actor.side == sideOfPlayer);
        if (primary && byPlayer && target.side != actor.side)
        {
            lastHitEnemyId = target.lobsterId;
            RefreshFieldBars();
        }
    }

    private void OnHealApplied(LobsterController target, int amount)
    {
        SpawnFloatFor(target, "+" + amount, Skin.floatHeal, 16);
        Debug.Log($"[BattleHud] float {target.lobsterId} +{amount} heal");
    }

    private void OnStatusChanged(LobsterController target, string status, bool applied, int turns)
    {
        if (overlays.TryGetValue(target.lobsterId, out var o)) o.Refresh();
    }

    private void OnDied(LobsterController lob)
    {
        if (overlays.TryGetValue(lob.lobsterId, out var o)) o.Refresh();
        if (lob.lobsterId == lastHitEnemyId) lastHitEnemyId = "";
        RefreshFieldBars();
        Teams.SetTurn(activeId, manager.upcoming);   // the dead lose their number and outline
        Teams.Refresh();
        if (lob.lobsterId == activeId) Marker.Hide();
    }

    private void OnBattleEnded(BattleEndData data)
    {
        Options.SetAvailable(false);
        Teams.ClearMarks();
        shownTargetId = "";
        targetLob = null;
        if (targetBadge != null) targetBadge.gameObject.SetActive(false);
        TargetMarker?.Hide();
        SetClock(0);
        Marker.Hide();
        Bar.Apply(null);
        foreach (var o in overlays.Values) o.SetActive(false);
        ShowBanner(data.winner, data.playerWon, data.reason, manager.PlayerSide);
    }

    // ─── Battle-start intro (BattleIntro) ───

    /// <summary>The intro opens on the empty arena: the whole HUD is off until it slides in.</summary>
    public void HideForIntro()
    {
        if (Canvas != null) Canvas.enabled = false;
    }

    /// <summary>
    /// Slide the HUD into place: your panels up from the bottom, the opponents' down from the top, the button cluster
    /// in from the right, the settings + timer hexes down from the top. Ease-out-back, unscaled time.
    /// </summary>
    public System.Collections.IEnumerator SlideIn(float seconds, System.Func<bool> skipped)
    {
        var moves = new List<(RectTransform rt, Vector2 home, Vector2 from, float delay)>();
        void Add(RectTransform rt, Vector2 offset, float delay)
        {
            if (rt == null) return;
            moves.Add((rt, rt.anchoredPosition, rt.anchoredPosition + offset, delay));
        }
        foreach (var p in Teams.Panels) Add(p.Rect, p.Rect.anchorMin == Vector2.zero ? new Vector2(0f, -140f) : new Vector2(0f, 140f), 0f);
        Add(Bar != null ? Bar.GetComponent<RectTransform>() : null, new Vector2(260f, 0f), 0.08f);
        Add(Options != null ? Options.GetComponent<RectTransform>() : null, new Vector2(0f, 120f), 0.12f);
        Add(Clock != null ? Clock.Rect : null, new Vector2(0f, 120f), 0.16f);
        foreach (var m in moves) m.rt.anchoredPosition = m.from;
        if (Canvas != null) Canvas.enabled = true;

        float total = seconds + 0.16f;
        for (float t = 0f; t < total && !skipped(); t += Time.unscaledDeltaTime)
        {
            foreach (var m in moves)
            {
                float k = Mathf.Clamp01((t - m.delay) / seconds);
                m.rt.anchoredPosition = Vector2.LerpUnclamped(m.from, m.home, EaseOutBack(k));
            }
            yield return null;
        }
        foreach (var m in moves) m.rt.anchoredPosition = m.home;
    }

    /// <summary>End of the intro (or a skip): HUD visible, everything home.</summary>
    public void EndIntro()
    {
        if (Canvas != null) Canvas.enabled = true;
        Debug.Log("[BattleHud] intro over — HUD in place");
    }

    private static float EaseOutBack(float k)
    {
        const float c1 = 1.70158f, c3 = c1 + 1f;
        float x = k - 1f;
        return 1f + c3 * x * x * x + c1 * x * x;
    }

    // ─── Public helpers (tests / demo loop) ───

    public void Refresh()
    {
        foreach (var o in overlays.Values) o.Refresh();
        Teams.Refresh();
    }

    public void ShowBanner(string winner, bool playerWon, string reason, string playerSide)
    {
        // The banner means the battle is decided, whoever raised it (live end, demo loop, test):
        // there is nothing left to forfeit.
        Options.SetAvailable(false);
        Banner.Show(winner, playerWon, reason, playerSide);
    }

    public void SpawnFloatFor(LobsterController lob, string text, Color color, int fontSize)
    {
        if (lob == null) return;
        var pos = CanvasPointFor(lob.transform.position + Vector3.up * (Skin.overlayWorldYOffset * 0.7f));
        DamageFloat.Spawn(floatLayer, Skin, pos, text, color, fontSize);
    }

    private Vector2 CanvasPointFor(Vector3 world)
    {
        if (cam == null) cam = Camera.main;
        if (cam == null) return Vector2.zero;
        Vector3 sp = cam.WorldToScreenPoint(world);
        RectTransformUtility.ScreenPointToLocalPointInRectangle(canvasRect, sp, null, out Vector2 local);
        return local;
    }

    void LateUpdate()
    {
        if (overlays.Count == 0) return;
        foreach (var kv in overlays)
        {
            var o = kv.Value;
            var lob = o.Lobster;
            if (lob == null) { if (o.gameObject.activeSelf) o.gameObject.SetActive(false); continue; } // its rig was despawned
            if (!o.Shown) continue;
            o.Rect.anchoredPosition = CanvasPointFor(lob.transform.position + Vector3.up * Skin.overlayWorldYOffset);
            o.Refresh();
        }
        Teams.Refresh();
        if (targetBadge != null && targetBadge.gameObject.activeSelf)
        {
            if (targetLob == null || !targetLob.alive) targetBadge.gameObject.SetActive(false);
            else
            {
                float bob = Mathf.Sin(Time.time * 3f) * BadgeBobPx;
                targetBadge.rectTransform.anchoredPosition = CanvasPointFor(targetLob.transform.position + Vector3.up * (Skin.overlayWorldYOffset + BadgeLift)) + new Vector2(0f, bob);
                if (badgeLogPending) { badgeLogPending = false; LogBadgeRect(); }
            }
        }
    }
}
