using UnityEngine;

/// <summary>
/// Tier-scoped obstacle sprite library for blocked arena cells.
/// HexGrid picks from the matching tier deterministically per battle/layout/cell.
/// </summary>
[CreateAssetMenu(fileName = "ObstacleLibrary", menuName = "Clawbada/Obstacle Library")]
public class ObstacleLibrary : ScriptableObject
{
    public ObstacleTierSprites[] tiers;

    public Sprite[] GetSpritesForTier(string tier)
    {
        if (tiers == null || string.IsNullOrEmpty(tier)) return null;

        for (int i = 0; i < tiers.Length; i++)
        {
            ObstacleTierSprites entry = tiers[i];
            if (entry != null && string.Equals(entry.tier, tier, System.StringComparison.OrdinalIgnoreCase))
            {
                return entry.sprites;
            }
        }

        return null;
    }
}

[System.Serializable]
public class ObstacleTierSprites
{
    public string tier;
    public Sprite[] sprites;
}
