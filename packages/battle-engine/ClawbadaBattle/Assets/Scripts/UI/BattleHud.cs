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
/// Layout (960x540 reference): turn strip top-centre, badges top corners, unit
/// overlays following the rigs, active portrait + clock bottom-left, floats and the
/// result banner over everything. The action bar (bottom-centre) arrives in PR B.
/// </summary>
public class BattleHud : MonoBehaviour
{
    public HudSkin Skin { get; private set; }
    public Canvas Canvas { get; private set; }
    public TurnStrip Strip { get; private set; }
    public ActivePanel Panel { get; private set; }
    public ResultBanner Banner { get; private set; }
    public ActiveMarker Marker { get; private set; }
    public IReadOnlyDictionary<string, UnitOverlay> Overlays => overlays;

    private BattleManager manager;
    private RectTransform canvasRect;
    private RectTransform overlayLayer;
    private RectTransform floatLayer;
    private BadgeView badgeA, badgeB;
    private readonly Dictionary<string, UnitOverlay> overlays = new();
    private Camera cam;
    private string activeId = "";
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

    public void Build(HudSkin skin)
    {
        if (built) return;
        built = true;
        Skin = skin;
        cam = Camera.main != null ? Camera.main : FindFirstObjectByType<Camera>();
        if (cam != null && skin.fillCanvas)
        {
            // The pixel-perfect camera snaps to integer zoom and letterboxes the 640x360 arena
            // inside larger canvases; the HUD wants the arena full-bleed.
            if (cam.GetComponent("PixelPerfectCamera") is Behaviour ppc && ppc.enabled) ppc.enabled = false;
            cam.orthographic = true;
            cam.orthographicSize = skin.fillOrthographicSize;
        }

        HudFactory.EnsureEventSystem();
        Canvas = HudFactory.Canvas("BattleHudCanvas", 100, new Vector2(960f, 540f), 0.5f, 64f);
        canvasRect = Canvas.GetComponent<RectTransform>();

        overlayLayer = HudFactory.Stretch(canvasRect, "Overlays");
        Strip = TurnStrip.Create(canvasRect, skin, manager != null ? manager.partLibrary : null);
        badgeA = BadgeView.Create(canvasRect, "BadgeA", skin, left: true);
        badgeB = BadgeView.Create(canvasRect, "BadgeB", skin, left: false);
        Panel = ActivePanel.Create(canvasRect, skin, manager != null ? manager.partLibrary : null);
        floatLayer = HudFactory.Stretch(canvasRect, "Floats");
        Banner = ResultBanner.Create(canvasRect, skin);
        Marker = ActiveMarker.Create(skin);

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
        m.BattleEnded += OnBattleEnded;
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
        manager.BattleEnded -= OnBattleEnded;
    }

    // ─── Binding ───

    public void Bind(BattleInitData init)
    {
        foreach (var o in overlays.Values) if (o != null) Destroy(o.gameObject);
        overlays.Clear();
        var ids = new StringBuilder();
        foreach (var lob in manager.Lobsters)
        {
            if (lob == null) continue;
            var overlay = UnitOverlay.Create(overlayLayer, Skin);
            overlay.Bind(lob);
            overlays[lob.lobsterId] = overlay;
            if (ids.Length > 0) ids.Append(',');
            ids.Append(lob.lobsterId);
        }
        Strip.Bind(manager.Lobsters);
        Strip.SetEntries("", null);

        string playerSide = init?.playerSide ?? "";
        string kindA = playerSide == "A" ? init.playerBadge : playerSide == "B" ? init.opponentBadge : "";
        string kindB = playerSide == "B" ? init.playerBadge : init?.opponentBadge ?? "";
        badgeA.Set("TEAM A" + (playerSide == "A" ? " · YOU" : ""), kindA, Skin.teamA);
        badgeB.Set("TEAM B" + (playerSide == "B" ? " · YOU" : ""), kindB, Skin.teamB);

        activeId = "";
        Panel.Hide();
        Banner.Hide();
        Marker.Hide();
        Debug.Log($"[BattleHud] bind n={overlays.Count} ids={ids}");
    }

    // ─── Manager events ───

    private void OnTurnStarted(TurnStartData data, int fallbackRemainingMs)
    {
        activeId = data.lobsterId ?? "";
        foreach (var kv in overlays) kv.Value.SetActive(kv.Key == activeId);
        var lob = manager.GetLobster(activeId);
        Marker.Follow(lob);
        Panel.Show(lob, data.isPlayer);
        if (data.isPlayer && fallbackRemainingMs > 0) Panel.Clock.StartClock(fallbackRemainingMs);
        else Panel.Clock.StopClock();
        Strip.SetEntries(activeId, manager.upcoming);
        Debug.Log($"[BattleHud] turn {data.turn} active={activeId} strip={Strip.DescribeIds()}");
        if (data.turn <= 2) DumpLayout();
    }

    /// <summary>One-off geometry dump (harness diagnostics): every top-level HUD child with its
    /// active state and screen-space rect.</summary>
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
    }

    private void OnBarUpdated(BarData data)
    {
        Strip.SetEntries(activeId, data?.entries);
        Debug.Log($"[BattleHud] bar turn={data?.turn} strip={Strip.DescribeIds()}");
    }

    private void OnClockSet(int remainingMs)
    {
        if (manager.isPlayerTurn && remainingMs > 0) Panel.Clock.StartClock(remainingMs);
        else Panel.Clock.StopClock();
        Debug.Log($"[BattleHud] clock {remainingMs}");
    }

    private void OnUnitsSynced(UnitsSyncData data)
    {
        // Truth may have killed or revived someone: rebuild the strip, not just its bars.
        Strip.SetEntries(activeId, manager.upcoming);
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
        SpawnFloatFor(target, text, c, isCrit ? 22 : 16);
        Debug.Log($"[BattleHud] float {target.lobsterId} {text} {kind}");
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
        Strip.Refresh();
        if (lob.lobsterId == activeId) Marker.Hide();
    }

    private void OnBattleEnded(BattleEndData data)
    {
        Panel.Hide();
        Marker.Hide();
        foreach (var o in overlays.Values) o.SetActive(false);
        ShowBanner(data.winner, data.playerWon, data.reason, manager.PlayerSide);
    }

    // ─── Public helpers (tests / demo loop) ───

    public void Refresh()
    {
        foreach (var o in overlays.Values) o.Refresh();
        Strip.Refresh();
        Panel.Refresh();
    }

    public void ShowBanner(string winner, bool playerWon, string reason, string playerSide)
    {
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
            if (lob == null) continue;
            o.Rect.anchoredPosition = CanvasPointFor(lob.transform.position + Vector3.up * Skin.overlayWorldYOffset);
            o.Refresh();
        }
        Strip.Refresh();
        Panel.Refresh();
    }
}
