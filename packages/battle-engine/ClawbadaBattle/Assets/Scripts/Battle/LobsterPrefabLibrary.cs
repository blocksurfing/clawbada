using UnityEngine;

/// <summary>
/// Maps (evolution tier, class name) → rigged lobster prefab.
/// Populated by the "Clawbada/Rebuild Lobster Prefab Library" editor menu from
/// Assets/Prefabs/Lobsters/{Tier}/Lobster_{Tier}_{Class}.prefab.
/// Battle entry requires Evolved+, so only Evolved/Elite/Apex entries exist.
/// </summary>
[CreateAssetMenu(fileName = "LobsterPrefabLibrary", menuName = "Clawbada/Lobster Prefab Library")]
public class LobsterPrefabLibrary : ScriptableObject
{
    [System.Serializable]
    public class Entry
    {
        public string tier;      // "Evolved" | "Elite" | "Apex"
        public string className; // "Bulwark" ... "Ember"
        public GameObject prefab;
    }

    public Entry[] entries;

    /// <summary>Tier index uses the on-chain EvolutionTier enum (0=Base, 1=Evolved, 2=Elite, 3=Apex).</summary>
    public static string TierName(int tier)
    {
        switch (tier)
        {
            case 1: return "Evolved";
            case 2: return "Elite";
            case 3: return "Apex";
            default: return "Evolved"; // Base can't battle; fall back visually
        }
    }

    public GameObject Get(int tier, string className)
    {
        string tierName = TierName(tier);
        if (entries == null) return null;
        foreach (var e in entries)
        {
            if (string.Equals(e.tier, tierName, System.StringComparison.OrdinalIgnoreCase) &&
                string.Equals(e.className, className, System.StringComparison.OrdinalIgnoreCase))
            {
                return e.prefab;
            }
        }
        return null;
    }
}
