using UnityEngine;

/// <summary>
/// Everything the in-canvas battle HUD draws with: sprites, font, colours, sizes.
/// Lives at Assets/Resources/UI/HudSkin.asset so BattleHud can Resources.Load it at
/// runtime without any scene wiring. Placeholder art is produced by
/// "Clawbada/Generate HUD Placeholder Art"; the designer re-skins by swapping sprites
/// here (only null slots are re-seeded by the generator, so swaps survive).
/// </summary>
[CreateAssetMenu(fileName = "HudSkin", menuName = "Clawbada/HUD Skin")]
public class HudSkin : ScriptableObject
{
    [System.Serializable]
    public class StatusIcon
    {
        public string status; // bleed | stun | haunt | fortify | reflect | shield | slow | taunt
        public Sprite sprite;
    }

    [Header("Frames (pointy-top hexes)")]
    public Sprite hexFrame56;   // outline, tinted per team
    public Sprite hexMask56;    // filled, used as the portrait mask
    public Sprite hexFrame96;
    public Sprite hexMask96;
    public Sprite hexButton64;  // filled + border, action buttons

    [Header("Bars & panels")]
    public Sprite barBg;        // 9-sliced
    public Sprite barFill;      // white, tinted
    public Sprite panelBg;      // 9-sliced
    public Sprite pip;          // charge pip
    public Sprite ring;         // active-unit ring (circle outline)

    [Header("Icons")]
    public Sprite iconAttack;
    public Sprite iconSpecial;
    public Sprite iconDefend;
    public Sprite iconWait;
    public Sprite iconUndo;
    public Sprite iconClock;
    public Sprite iconKo;
    public Sprite iconShield;   // defending marker over a unit
    public Sprite badgeHuman;
    public Sprite badgeAgent;
    public Sprite badgeBot;
    public StatusIcon[] statusIcons;

    [Header("Camera")]
    [Tooltip("Disable the PixelPerfectCamera's integer zoom while the HUD is up so the 10x5.625-unit arena fills any 16:9 canvas (LOKR-style full bleed).")]
    public bool fillCanvas = true;
    public float fillOrthographicSize = 2.8125f;

    [Header("Font (null → built-in LegacyRuntime)")]
    public Font font;

    [Header("Active-unit marker (world space, under the actor)")]
    public RuntimeAnimatorController selectorController;
    public Sprite selectorSprite;
    public Vector3 selectorOffset = new Vector3(0f, -0.02f, 0f);

    [Header("Colours")]
    public Color teamA = C("#f97066");
    public Color teamB = C("#58a6ff");
    public Color hpHigh = C("#3fb9a0");
    public Color hpMid = C("#fbbf24");
    public Color hpLow = C("#f85149");
    public Color gold = C("#fbbf24");
    public Color activeRing = C("#ffd280");
    public Color clockDanger = C("#f85149");
    public Color textPrimary = Color.white;
    public Color textSecondary = C("#b8c4d4");
    public Color floatNormal = Color.white;
    public Color floatCrit = C("#fbbf24");
    public Color floatSelf = C("#f85149");
    public Color floatHeal = C("#3fb9a0");
    public Color buttonNormal = Color.white;
    public Color buttonArmed = C("#ffd280");
    public Color buttonDisabled = new Color(1f, 1f, 1f, 0.35f);

    [Header("Sizes (canvas units at the 960x540 reference)")]
    public float stripPortrait = 56f;
    public float activePortrait = 96f;
    public float buttonSize = 64f;
    public Vector2 overlayBar = new Vector2(40f, 4f);
    public float overlayWorldYOffset = 0.72f;
    public float floatRise = 40f;
    public float floatSeconds = 1.2f;
    public int clockDangerMs = 10000;
    [Tooltip("Body-part sprites are 64px; scale them up so the carapace fills the hex.")]
    public float portraitPartScale = 1.6f;
    public Vector2 portraitPartOffset = new Vector2(0f, -3f);

    public Font FontOrDefault()
    {
        if (font != null) return font;
        return Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
    }

    public Sprite StatusSprite(string status)
    {
        if (statusIcons == null || string.IsNullOrEmpty(status)) return null;
        foreach (var s in statusIcons)
        {
            if (s != null && s.status == status) return s.sprite;
        }
        return null;
    }

    public Sprite BadgeSprite(string badge)
    {
        switch ((badge ?? "").ToLowerInvariant())
        {
            case "human":
            case "player": return badgeHuman;
            case "agent": return badgeAgent;
            case "bot": return badgeBot;
        }
        return null;
    }

    public Color TeamColor(string side) => side == "A" ? teamA : teamB;

    public Color HpColor(int hp, int max)
    {
        float pct = max > 0 ? (float)hp / max : 0f;
        if (pct > 0.5f) return hpHigh;
        if (pct > 0.25f) return hpMid;
        return hpLow;
    }

    private static Color C(string hex)
    {
        return ColorUtility.TryParseHtmlString(hex, out var c) ? c : Color.magenta;
    }
}
