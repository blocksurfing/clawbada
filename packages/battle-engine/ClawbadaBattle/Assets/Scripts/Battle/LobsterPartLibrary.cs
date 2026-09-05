using System.Collections.Generic;
using UnityEngine;

/// <summary>
/// Maps (tier, class, part sprite name) → body-part Sprite for DNA-driven visual
/// composition. A lobster's rig spawns from its own class's prefab (host skeleton),
/// then each part slot whose dominant gene points at another class gets that class's
/// sprite swapped in — same-named parts across classes (the rigs share one skeleton
/// per tier, so sprite names align 1:1).
/// Rebuilt from Art/Characters/{Tier}/{Class}/**.png via
/// "Clawbada/Rebuild Lobster Part Library".
/// </summary>
[CreateAssetMenu(fileName = "LobsterPartLibrary", menuName = "Clawbada/Lobster Part Library")]
public class LobsterPartLibrary : ScriptableObject
{
    [System.Serializable]
    public class Entry
    {
        public string tier;      // "Evolved" | "Elite" | "Apex"
        public string className; // "Bulwark" ... "Ember"
        public string partName;  // sprite name, e.g. "Claw_L", "Leg_R_2", "Carapace"
        public Sprite sprite;
    }

    public Entry[] entries;

    private Dictionary<(string, string, string), Sprite> lookup;

    public Sprite Get(int tier, string className, string partName)
    {
        if (lookup == null)
        {
            lookup = new Dictionary<(string, string, string), Sprite>();
            if (entries != null)
            {
                foreach (var e in entries)
                {
                    lookup[(e.tier.ToLowerInvariant(), e.className.ToLowerInvariant(), e.partName)] = e.sprite;
                }
            }
        }
        string tierName = LobsterPrefabLibrary.TierName(tier).ToLowerInvariant();
        lookup.TryGetValue((tierName, className.ToLowerInvariant(), partName), out var sprite);
        return sprite;
    }
}
