using UnityEngine;

public enum HexHighlight
{
    None             = 0, // hidden / fade out
    InRange          = 1, // stone pulse — movement range (phase 1) or attack max range (phase 2)
    SelectedLobster  = 2, // blue pulse — the currently selected character's own hex
    EnemyTarget      = 3, // red pulse — enemy in attack / defend / special range (phase 2)
    AllyTarget       = 4, // green pulse — friendly target for heal/buff specials (Sentinel Rally)
}

/// <summary>
/// LKR-style hex tile overlay. These are spawned on demand by HexGrid when a lobster
/// is selected, animate into one of the HexHighlight states, and fade out on action
/// commit or deselect. There are no persistent hex tiles between selection events.
///
/// Visuals are driven by the designer's Animator: SetHighlight drives an int parameter
/// (default name "State") whose value matches HexHighlight. The designer creates one
/// Animator state per enum value and authors the pulse/glow clip for each. Falls back
/// to a plain SpriteRenderer color swap if no Animator is present, so gameplay code
/// works before the art prefab is ready.
/// </summary>
public class HexTile : MonoBehaviour
{
    [Header("Animator Integration (optional)")]
    [Tooltip("If assigned, SetHighlight() drives the int parameter below instead of tinting the sprite.")]
    public Animator animator;
    [Tooltip("Int parameter on the Animator that receives HexHighlight values.")]
    public string stateParameter = "State";

    public int Col { get; private set; }
    public int Row { get; private set; }
    public bool IsBlocked { get; private set; }
    public HexHighlight CurrentHighlight { get; private set; }

    private SpriteRenderer spriteRenderer;
    private int stateHash;

    void Awake()
    {
        spriteRenderer = GetComponent<SpriteRenderer>();
        if (animator == null) animator = GetComponent<Animator>();
        stateHash = Animator.StringToHash(stateParameter);
    }

    public void Initialize(int col, int row, bool blocked)
    {
        Col = col;
        Row = row;
        IsBlocked = blocked;
        gameObject.name = $"Hex_{col}_{row}{(blocked ? "_blocked" : "")}";
        SetHighlight(HexHighlight.None);
    }

    public void SetHighlight(HexHighlight highlight)
    {
        CurrentHighlight = highlight;

        if (animator != null && animator.runtimeAnimatorController != null)
        {
            animator.SetInteger(stateHash, (int)highlight);
        }
        else
        {
            ApplyFallbackColor(highlight);
        }
    }

    /// <summary>Set highlight to None (triggers the fade-out animator state) then destroy
    /// after the given duration so the fade clip has time to play. Called by HexGrid
    /// during ClearHighlights().</summary>
    public void FadeOutAndDestroy(float duration)
    {
        SetHighlight(HexHighlight.None);
        if (Application.isPlaying)
        {
            Destroy(gameObject, Mathf.Max(0f, duration));
        }
        else
        {
            DestroyImmediate(gameObject);
        }
    }

    private void ApplyFallbackColor(HexHighlight highlight)
    {
        if (spriteRenderer == null) return;

        if (IsBlocked)
        {
            spriteRenderer.color = new Color(0.1f, 0.1f, 0.1f, 0.8f);
            return;
        }

        spriteRenderer.color = highlight switch
        {
            HexHighlight.None            => new Color(1f, 1f, 1f, 0f),
            HexHighlight.InRange         => new Color(0.60f, 0.62f, 0.68f, 0.55f), // stone
            HexHighlight.SelectedLobster => new Color(0.35f, 0.65f, 1.00f, 0.75f), // blue
            HexHighlight.EnemyTarget     => new Color(0.97f, 0.25f, 0.25f, 0.75f), // red
            HexHighlight.AllyTarget      => new Color(0.30f, 0.85f, 0.40f, 0.70f), // green
            _                            => new Color(1f, 1f, 1f, 0f),
        };
    }
}
