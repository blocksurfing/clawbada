using UnityEngine;

public enum HexHighlight
{
    None,
    MoveRange,       // Blue — reachable hex for movement
    AttackFull,      // Green — adjacent, 100% damage
    AttackReduced,   // Yellow — 2 hex, 75% damage
    AttackWeak,      // Red — 3 hex, 50% damage
    Selected,        // Gold — currently selected
    TeamA,           // Teal — Team A spawn/position
    TeamB,           // Coral — Team B spawn/position
}

/// <summary>
/// Individual hex tile on the battle grid.
/// </summary>
public class HexTile : MonoBehaviour
{
    public int Col { get; private set; }
    public int Row { get; private set; }
    public bool IsBlocked { get; private set; }
    public HexHighlight CurrentHighlight { get; private set; }

    private SpriteRenderer spriteRenderer;

    public void Initialize(int col, int row, bool blocked)
    {
        Col = col;
        Row = row;
        IsBlocked = blocked;
        gameObject.name = $"Hex_{col}_{row}{(blocked ? "_blocked" : "")}";

        spriteRenderer = GetComponent<SpriteRenderer>();
        if (spriteRenderer == null) spriteRenderer = gameObject.AddComponent<SpriteRenderer>();

        UpdateVisual();
    }

    public void SetHighlight(HexHighlight highlight)
    {
        CurrentHighlight = highlight;
        UpdateVisual();
    }

    private void UpdateVisual()
    {
        if (spriteRenderer == null) return;

        if (IsBlocked)
        {
            spriteRenderer.color = new Color(0.1f, 0.1f, 0.1f, 0.8f);
            return;
        }

        spriteRenderer.color = CurrentHighlight switch
        {
            HexHighlight.MoveRange => new Color(0.35f, 0.65f, 1f, 0.4f),
            HexHighlight.AttackFull => new Color(0.25f, 0.85f, 0.4f, 0.4f),
            HexHighlight.AttackReduced => new Color(0.98f, 0.75f, 0.14f, 0.4f),
            HexHighlight.AttackWeak => new Color(0.97f, 0.44f, 0.4f, 0.4f),
            HexHighlight.Selected => new Color(0.98f, 0.75f, 0.14f, 0.6f),
            HexHighlight.TeamA => new Color(0.25f, 0.73f, 0.63f, 0.5f),
            HexHighlight.TeamB => new Color(0.97f, 0.44f, 0.4f, 0.5f),
            _ => new Color(0.35f, 0.65f, 1f, 0.15f), // default playable
        };
    }
}
