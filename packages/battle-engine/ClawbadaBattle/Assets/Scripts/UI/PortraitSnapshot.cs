using UnityEngine;

/// <summary>
/// Still portraits of the battle's lobsters, rendered from their own rigs ONCE, when the battle loads (user
/// 2026-09-27: "a portrait should be still"; "not a snapshot every turn — just once, normal idle, eyes open").
/// Each rig is cloned off-stage (inside an inactive holder, so none of its scripts wake up), stripped to its
/// body-part sprites with every part shown in its own colours (so a heal blink, a stun or the corpse tint never
/// leak in), frozen on the first frame of Idle, and rendered by a private camera on the board's own pixel grid
/// (64 px per unit, point-filtered) into two textures per lobster, kept for the whole battle:
///   Full — every body part (shown inside the avatar's disc);
///   Pop  — only the claws and antennae (shown outside the disc, over the ring: the break-out, as in Nzib's mock).
/// The camera frames the lobster's front half (shell, claws, eyes). Nothing renders per frame.
/// </summary>
public class PortraitSnapshot
{
    /// <summary>A layer nothing else uses; the main camera never draws it.</summary>
    public const int Layer = 31;
    private const float Ppu = 64f;
    private static int count;

    public class Portrait { public RenderTexture Full, Pop; }
    private readonly System.Collections.Generic.Dictionary<string, Portrait> cache = new();

    private readonly int w, h;
    /// <summary>Where the front half's centre lands in the texture, in texture pixels from its centre.</summary>
    private readonly Vector2 focus;
    private readonly Vector3 stage;
    private readonly GameObject holder;
    private readonly Camera cam;
    private GameObject clone;

    /// <param name="widthPx">Texture width in world pixels (the area the camera sees, at the board's 64 px/u).</param>
    /// <param name="heightPx">Texture height in world pixels.</param>
    /// <param name="focusPx">Where the lobster's front half should sit, in texture pixels from the texture centre
    /// (the avatar frame's portrait aperture is left of centre).</param>
    public PortraitSnapshot(int widthPx, int heightPx, Vector2 focusPx)
    {
        w = widthPx; h = heightPx; focus = focusPx;
        stage = new Vector3(1000f + 50f * count, 1000f, 0f);
        count++;
        holder = new GameObject("PortraitStage");
        holder.transform.position = stage;
        holder.SetActive(false);

        var camGo = new GameObject("PortraitCamera");
        camGo.transform.position = stage + new Vector3(0f, 0f, -10f);
        cam = camGo.AddComponent<Camera>();
        cam.enabled = false;
        cam.orthographic = true;
        cam.orthographicSize = h / 2f / Ppu;
        cam.aspect = (float)w / h;
        cam.clearFlags = CameraClearFlags.SolidColor;
        cam.backgroundColor = new Color(0f, 0f, 0f, 0f);
        cam.cullingMask = 1 << Layer;
        cam.nearClipPlane = 0.01f;
        cam.farClipPlane = 50f;
        cam.allowHDR = false;
        cam.allowMSAA = false;
    }

    private RenderTexture NewTexture(string name)
    {
        var rt = new RenderTexture(w, h, 16, RenderTextureFormat.ARGB32) { name = name, filterMode = FilterMode.Point, antiAliasing = 1 };
        rt.Create();
        return rt;
    }

    public static bool BreaksOut(string part) => part == "Antennae" || part.StartsWith("Claw_") || part.StartsWith("UpperArm_");
    private static bool FrontHalf(string part) => part == "Carapace" || part == "Eyes" || part.StartsWith("Claw_") || part.StartsWith("UpperArm_");

    /// <summary>The lobster's portrait, rendering it now only if it was not taken at battle load.</summary>
    public Portrait Get(LobsterController lob, float drop)
    {
        if (lob == null) return null;
        if (!cache.TryGetValue(lob.lobsterId, out var p)) p = Capture(lob, drop);
        return p;
    }

    /// <summary>New battle: drop every portrait (the lobster ids are reused across battles).</summary>
    public void Clear()
    {
        foreach (var p in cache.Values) { p.Full.Release(); Object.Destroy(p.Full); p.Pop.Release(); Object.Destroy(p.Pop); }
        cache.Clear();
    }

    /// <param name="drop">Share of the view to sit the body below centre (room for antennae to break out on top).</param>
    public Portrait Capture(LobsterController lob, float drop)
    {
        if (lob == null) return null;
        if (!cache.TryGetValue(lob.lobsterId, out var portrait))
        {
            portrait = new Portrait { Full = NewTexture("PortraitFull_" + lob.lobsterId), Pop = NewTexture("PortraitPop_" + lob.lobsterId) };
            cache[lob.lobsterId] = portrait;
        }
        // Destroy is deferred to the end of the frame: hide the previous portrait NOW, or this frame's render
        // photographs both (the last actor, often facing the other way, showed up mirrored over the new one).
        if (clone != null) { clone.SetActive(false); Object.Destroy(clone); }

        // Clone under the INACTIVE holder: no Awake/OnEnable on the copy's scripts, which are removed next.
        clone = Object.Instantiate(lob.gameObject, holder.transform);
        clone.name = "Portrait_" + lob.lobsterId;
        var t = clone.transform;
        t.localPosition = Vector3.zero;
        // Every portrait faces right (Nzib 2026-09-28): enemy rigs face left on the board, and a left-facing portrait
        // put its antennae over the turn-order number at the panel's top-left. Facing is a Y turn (SetFacing).
        t.rotation = Quaternion.Euler(0f, LobsterController.FaceRightY, 0f);
        t.localScale = lob.transform.lossyScale;
        // Scripts can require each other, so a single pass may refuse some: repeat until none are left.
        for (int pass = 0; pass < 4; pass++)
        {
            var mbs = clone.GetComponentsInChildren<MonoBehaviour>(true);
            if (mbs.Length == 0) break;
            for (int i = mbs.Length - 1; i >= 0; i--) if (mbs[i] != null) Object.DestroyImmediate(mbs[i]);
        }
        foreach (var a in clone.GetComponentsInChildren<AudioSource>(true)) Object.DestroyImmediate(a);
        foreach (var r in clone.GetComponentsInChildren<Renderer>(true))
        {
            bool part = r is SpriteRenderer sr && sr.sprite != null && LobsterController.IsBodyPart(r.gameObject.name);
            r.enabled = part;
            if (!part) continue;
            // Rest state regardless of what the live rig is doing: every part visible, in its own colours.
            ((SpriteRenderer)r).color = Color.white;
        }
        foreach (var tr in clone.GetComponentsInChildren<Transform>(true)) tr.gameObject.layer = Layer;

        holder.SetActive(true);
        var anim = clone.GetComponentInChildren<Animator>();
        if (anim != null && anim.enabled && anim.runtimeAnimatorController != null)
        {
            // Frozen on Idle's first frame: a still portrait, the rig's rest pose. (A corpse's animator is already off.)
            anim.Play("Idle", 0, 0f);
            anim.Update(0f);
            anim.enabled = false;
        }

        // Frame the front half on its painted pixels (tight sprite meshes; every part is a padded 64 px layer).
        bool any = false;
        var bounds = new Bounds();
        foreach (var sr in clone.GetComponentsInChildren<SpriteRenderer>())
        {
            if (!sr.enabled || !FrontHalf(sr.gameObject.name)) continue;
            var m = sr.transform.localToWorldMatrix;
            foreach (var v in sr.sprite.vertices)
            {
                var w = m.MultiplyPoint3x4(v);
                if (!any) { bounds = new Bounds(w, Vector3.zero); any = true; } else bounds.Encapsulate(w);
            }
        }
        var c = any ? bounds.center : stage;
        c.y += drop * (h / Ppu);
        // Put the front half on the aperture, not the texture centre.
        c.x -= focus.x / Ppu;
        c.y -= focus.y / Ppu;
        // Snap to the pixel grid so the copy is as crisp as the board.
        c.x = Mathf.Round(c.x * Ppu) / Ppu;
        c.y = Mathf.Round(c.y * Ppu) / Ppu;
        cam.transform.position = new Vector3(c.x, c.y, stage.z - 10f);

        if (SystemInfo.graphicsDeviceType != UnityEngine.Rendering.GraphicsDeviceType.Null)
        {
            cam.targetTexture = portrait.Full;
            cam.Render();
            var hidden = new System.Collections.Generic.List<SpriteRenderer>();
            foreach (var sr in clone.GetComponentsInChildren<SpriteRenderer>())
                if (sr.enabled && !BreaksOut(sr.gameObject.name)) { sr.enabled = false; hidden.Add(sr); }
            cam.targetTexture = portrait.Pop;
            cam.Render();
            foreach (var sr in hidden) sr.enabled = true;
            cam.targetTexture = null;
        }
        holder.SetActive(false);
        clone.SetActive(false);
        Debug.Log($"[BattleHud] portrait {lob.lobsterId} ({lob.className}) front half {bounds.size.x * Ppu:F0}x{bounds.size.y * Ppu:F0} px in a {w}x{h} px view");
        return portrait;
    }
}
