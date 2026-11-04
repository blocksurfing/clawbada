using System.Collections.Generic;
using UnityEngine;

/// <summary>
/// Where each swing strikes (smoothness campaign 2026-11-04): seconds into a rig's Attack / Special clip at which the hit
/// lands — the damage float, the flinch, the hit sound and the impact effect all fire there. Picked frame by frame from
/// contact sheets (WebSpriteExporter ▸ Export Contact Sheets) and editable here in the Inspector. An AnimationEvent named
/// "Contact" on the clip itself wins over this table (LobsterController.ContactSeconds); a swing with neither falls back to
/// half its clip, the old rule.
/// </summary>
[CreateAssetMenu(menuName = "Clawbada/Contact Times")]
public class ContactTimes : ScriptableObject
{
    [System.Serializable]
    public struct Entry
    {
        [Tooltip("1 Evolved, 2 Elite, 3 Apex.")] public int tier;
        public string className;
        [Tooltip("The Animator state: Attack or Special.")] public string state;
        [Tooltip("Seconds into the clip (at normal speed) where the swing strikes.")] public float seconds;
    }

    public List<Entry> entries = new List<Entry>();

    private static ContactTimes instance;
    private static bool loaded;

    public static ContactTimes Instance
    {
        get
        {
            if (!loaded) { instance = Resources.Load<ContactTimes>("ContactTimes"); loaded = true; }
            return instance;
        }
    }

    public bool TryGet(int tier, string className, string state, out float seconds)
    {
        foreach (var e in entries)
            if (e.tier == tier && e.state == state && e.className == className) { seconds = e.seconds; return true; }
        seconds = 0f;
        return false;
    }
}
