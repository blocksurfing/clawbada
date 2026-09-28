using UnityEngine;

/// <summary>
/// A still portrait of a lobster, rendered from its own rig (user 2026-09-27: "a portrait should be still", and it
/// must look exactly like the lobster on the board). On Capture, the rig is cloned off-stage (inside an inactive
/// holder, so none of its scripts wake up), stripped to its body-part sprites, frozen on the first frame of Idle,
/// and rendered ONCE by a private camera on the board's own pixel grid (64 px per unit, point-filtered) into
/// two textures:
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

    public RenderTexture Full { get; }
    public RenderTexture Pop { get; }

    private readonly int px;
    private readonly Vector3 stage;
    private readonly GameObject holder;
    private readonly Camera cam;
    private GameObject clone;

    /// <param name="texturePx">Side of the square textures in art pixels (the area the camera sees).</param>
    public PortraitSnapshot(int texturePx)
    {
        px = texturePx;
        stage = new Vector3(1000f + 50f * count, 1000f, 0f);
        count++;
        Full = NewTexture("PortraitFull");
        Pop = NewTexture("PortraitPop");
        holder = new GameObject("PortraitStage");
        holder.transform.position = stage;
        holder.SetActive(false);

        var camGo = new GameObject("PortraitCamera");
        camGo.transform.position = stage + new Vector3(0f, 0f, -10f);
        cam = camGo.AddComponent<Camera>();
        cam.enabled = false;
        cam.orthographic = true;
        cam.orthographicSize = px / 2f / Ppu;
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
        var rt = new RenderTexture(px, px, 16, RenderTextureFormat.ARGB32) { name = name, filterMode = FilterMode.Point, antiAliasing = 1 };
        rt.Create();
        return rt;
    }

    public static bool BreaksOut(string part) => part == "Antennae" || part.StartsWith("Claw_") || part.StartsWith("UpperArm_");
    private static bool FrontHalf(string part) => part == "Carapace" || part == "Eyes" || part.StartsWith("Claw_") || part.StartsWith("UpperArm_");

    /// <param name="drop">Share of the view to sit the body below centre (room for antennae to break out on top).</param>
    public void Capture(LobsterController lob, float drop)
    {
        if (lob == null) return;
        if (clone != null) Object.Destroy(clone);

        // Clone under the INACTIVE holder: no Awake/OnEnable on the copy's scripts, which are removed next.
        clone = Object.Instantiate(lob.gameObject, holder.transform);
        clone.name = "Portrait_" + lob.lobsterId;
        var t = clone.transform;
        t.localPosition = Vector3.zero;
        t.rotation = lob.transform.rotation;         // facing is a 0/180° turn about Y (LobsterController.SetFacing)
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
            if (!(r is SpriteRenderer sr && sr.sprite != null && LobsterController.IsBodyPart(r.gameObject.name))) r.enabled = false;
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
        c.y += drop * (px / Ppu);
        // Snap to the pixel grid so the copy is as crisp as the board.
        c.x = Mathf.Round(c.x * Ppu) / Ppu;
        c.y = Mathf.Round(c.y * Ppu) / Ppu;
        cam.transform.position = new Vector3(c.x, c.y, stage.z - 10f);

        if (SystemInfo.graphicsDeviceType != UnityEngine.Rendering.GraphicsDeviceType.Null)
        {
            cam.targetTexture = Full;
            cam.Render();
            var hidden = new System.Collections.Generic.List<SpriteRenderer>();
            foreach (var sr in clone.GetComponentsInChildren<SpriteRenderer>())
                if (sr.enabled && !BreaksOut(sr.gameObject.name)) { sr.enabled = false; hidden.Add(sr); }
            cam.targetTexture = Pop;
            cam.Render();
            foreach (var sr in hidden) sr.enabled = true;
            cam.targetTexture = null;
        }
        holder.SetActive(false);
        Debug.Log($"[BattleHud] portrait {lob.lobsterId} ({lob.className}) front half {bounds.size.x * Ppu:F0}x{bounds.size.y * Ppu:F0} px in a {px} px view");
    }
}
