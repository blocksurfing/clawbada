using UnityEngine;
using UnityEngine.UI;

/// <summary>
/// Late-battle pressure (rules 2026-11-02: from turn 40, direct damage +3 % per battle turn past 40) on Nzib's pressure
/// tube (PressureIndicatorUI.prefab, drop 2cc98d1). Owner 2026-11-03: left edge, always visible — cold until pressure
/// starts — and FULL at +90 %; Warm up to +30 %, Hot up to +60 %, Boiling beyond.
///
/// His Animator plays the stage (int PreviewState: 0 Normal, 1 Warm, 2 Hot, 3 Boiling — fill colour, bubbles, fire); its
/// clips also key the fill height to preview values, so LateUpdate puts the real height back after the Animator every
/// frame (Fill grows up from the tube's floor; the bubble rides the surface exactly as in his clips: bubble y = fill y +
/// bubble height − 1). His "15%" Text bitmap is a placeholder, so it is hidden and a readout in the HUD's pixel font takes
/// its place. Battles without the rule (persisted before it) hide the tube.
/// </summary>
public class PressureGauge : MonoBehaviour
{
    /// <summary>Bonus (percent) at which the tube is full.</summary>
    public const int FullAtPercent = 90;
    /// <summary>Stage ceilings, percent: Warm ≤ 30, Hot ≤ 60, Boiling beyond.</summary>
    public const int WarmMax = 30, HotMax = 60;
    /// <summary>His FillArea is 145 px tall; the fill runs from his Normal 22 px up to his full 141 px.</summary>
    private const float AreaHeight = 145f, FillMin = 22f, FillMax = 141f;
    private static readonly int PreviewState = Animator.StringToHash("PreviewState");

    private Animator animator;
    private RectTransform fill, bubble;
    private Text label;
    private int fromTurn, bpsPerTurn;
    private float fillHeight = FillMin;
    private int lastBonus = -1;

    public RectTransform Rect { get; private set; }
    public bool Active => fromTurn > 0 && gameObject.activeSelf;

    /// <summary>Instantiate the tube on the HUD canvas (hidden until Configure says the battle has pressure).</summary>
    public static PressureGauge Create(RectTransform canvas, HudSkin skin)
    {
        if (skin == null || skin.pressurePrefab == null) { Debug.LogWarning("[BattleHud] no pressure prefab on the HudSkin"); return null; }
        var go = Instantiate(skin.pressurePrefab, canvas, false);
        go.name = "PressureGauge";
        var g = go.AddComponent<PressureGauge>();
        g.Rect = (RectTransform)go.transform;
        g.Rect.anchorMin = g.Rect.anchorMax = new Vector2(0f, 0.5f);
        g.Rect.pivot = new Vector2(0f, 0.5f);
        g.Rect.localScale = new Vector3(ActionBar.ArtScale, ActionBar.ArtScale, 1f);
        g.animator = go.GetComponent<Animator>();
        g.fill = go.transform.Find("FillArea/Fill") as RectTransform;
        g.bubble = go.transform.Find("FillArea/Bubble") as RectTransform;
        var art = go.transform.Find("Text") as RectTransform;
        if (art != null)
        {
            var bitmap = art.GetComponent<Image>();
            if (bitmap != null) bitmap.enabled = false;   // his static "15%" — a placeholder, not a readout
            // The readout: the HUD pixel font at 8 art px, centred over the tube where his bitmap sat (wider values
            // centre and may spill past his 19 px slot).
            g.label = HudFactory.Text(art, "Readout", skin.PixelFontOrDefault(), 8, Color.white, TextAnchor.MiddleCenter, new Vector2(40f, 10f));
            g.label.horizontalOverflow = HorizontalWrapMode.Overflow;
            g.label.rectTransform.anchoredPosition = Vector2.zero;
            var outline = g.label.gameObject.AddComponent<Outline>();
            outline.effectColor = new Color(0f, 0f, 0f, 0.85f);
            outline.effectDistance = new Vector2(0.5f, -0.5f);
        }
        if (g.fill == null || g.animator == null) Debug.LogError("[BattleHud] PressureIndicatorUI is missing FillArea/Fill or its Animator");
        go.SetActive(false);
        return g;
    }

    /// <summary>The battle's rule (from BattleInitData); fromTurn 0 = no pressure in this battle → hidden.</summary>
    public void Configure(int fromTurn, int bpsPerTurn, float centreY)
    {
        this.fromTurn = fromTurn;
        this.bpsPerTurn = bpsPerTurn;
        lastBonus = -1;
        Rect.anchoredPosition = new Vector2(TeamPanels.Edge, centreY);
        gameObject.SetActive(fromTurn > 0 && bpsPerTurn > 0);
        if (gameObject.activeSelf) OnTurn(0);
    }

    /// <summary>Bonus in whole percent at a battle turn: +bps/100 per turn past fromTurn.</summary>
    public static int BonusAt(int turn, int fromTurn, int bpsPerTurn) => turn > fromTurn ? (turn - fromTurn) * bpsPerTurn / 100 : 0;

    /// <summary>0 Normal (cold), 1 Warm, 2 Hot, 3 Boiling.</summary>
    public static int StageFor(int bonus) => bonus <= 0 ? 0 : bonus <= WarmMax ? 1 : bonus <= HotMax ? 2 : 3;

    public void OnTurn(int turn)
    {
        if (!Active) return;
        int bonus = BonusAt(turn, fromTurn, bpsPerTurn);
        if (bonus == lastBonus) return;
        lastBonus = bonus;
        int stage = StageFor(bonus);
        float frac = Mathf.Clamp01(bonus / (float)FullAtPercent);
        fillHeight = Mathf.Round(Mathf.Lerp(FillMin, FillMax, frac));
        if (animator != null) animator.SetInteger(PreviewState, stage);
        if (label != null) label.text = bonus > 0 ? $"{bonus}%" : "";
        Debug.Log($"[BattleHud] pressure turn={turn} bonus={bonus}% stage={stage} fill={frac:F2}");
    }

    void LateUpdate()
    {
        if (fill == null) return;
        float y = -(AreaHeight - fillHeight);
        fill.sizeDelta = new Vector2(fill.sizeDelta.x, fillHeight);
        fill.anchoredPosition = new Vector2(fill.anchoredPosition.x, y);
        if (bubble != null) bubble.anchoredPosition = new Vector2(bubble.anchoredPosition.x, y + bubble.sizeDelta.y - 1f);
    }
}
