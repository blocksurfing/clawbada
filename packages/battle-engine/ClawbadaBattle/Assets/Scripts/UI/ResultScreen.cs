using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;

/// <summary>
/// Nzib's Victory / Defeat screens (drop 93e213e, Prefabs/UI/VictoryScreen + DefeatScreen) with the player's own three lobsters
/// from the battle standing under the banner (user 2026-10-24):
///   Victory — each lobster plays Attack then Jump, looping until the page leaves. Only the Mantis rigs have a Jump state; the
///             others hop in code (anticipation squash, arc with stretch, landing squash). A Jump clip added later is used as is.
///   Defeat  — each lobster plays Die once and stays down; small skulls drift up from the bodies on a slow loop ("z z Z"),
///             drawn from HudSkin.floatingSkull — empty until Nzib draws it, so the bodies lie still until then.
/// The prefab is a Screen Space Overlay canvas and world sprites cannot draw over one, so the team stands on a stage of its
/// own off the board (layer <see cref="StageLayer"/>, which the main camera never draws) and a private camera renders it, at
/// the board's 64 px per unit and point-filtered, into a texture shown under the banner. The copies are the battle rigs
/// cloned the way PortraitSnapshot clones them (scripts and audio stripped, body parts only, own colours), so tier, class
/// and part genetics match exactly — whatever state the rig ended in (corpse, faded away). Nothing here plays a sound.
/// The web's "Back to the arena in 6s · Back now · Stay" row stays over the canvas; this screen loops until the page closes.
/// </summary>
public class ResultScreen : MonoBehaviour
{
    /// <summary>A layer nothing else uses (PortraitSnapshot owns 31); the main camera never draws it.</summary>
    public const int StageLayer = 30;
    /// <summary>Above the HUD canvas (100), which is hidden anyway while this screen is up.</summary>
    public const int SortingOrder = 110;
    private const float Ppu = 64f;
    /// <summary>The team strip in canvas units (= world pixels: the prefab's 640×360 reference is the board's pixel grid).</summary>
    private const int StripW = 256, StripH = 112;
    /// <summary>Where the strip's centre sits: under the banner group (which spans y −54…74 in Nzib's prefab).</summary>
    private static readonly Vector2 StripPos = new Vector2(0f, -90f);
    /// <summary>Feet line, in pixels up from the strip's bottom edge (room for the shadow and the landing squash).</summary>
    private const float FeetPx = 18f;
    private const float SpacingPx = 80f;
    /// <summary>The result takes centre stage (owner 2026-10-24): Nzib's DimOverlay (black at 35 %) is deepened to this, so the
    /// frozen board behind — and the other side's lobsters on it — recede. Faded in over <see cref="DimFadeSeconds"/>.</summary>
    public const float DimAlpha = 0.8f;
    public const float DimFadeSeconds = 0.25f;
    /// <summary>A defeated body: greyed but readable over the dim (the battle's CorpseTint is nearly invisible here).</summary>
    private static readonly Color BodyTint = new Color(0.58f, 0.58f, 0.66f, 1f);

    /// <summary>The team's feet line in canvas units (the strip's top is transparent headroom for the hop).</summary>
    public static float FeetY => StripPos.y - StripH * 0.5f + FeetPx;
    /// <summary>Headroom a standing lobster needs above its feet (the tallest rigs are ~60 px).</summary>
    public const float BodyPx = 64f;
    public bool Won { get; private set; }
    /// <summary>The display copies, left to right (tests).</summary>
    public IReadOnlyList<Animator> Rigs => rigs;
    /// <summary>Copies currently mid code-hop (tests).</summary>
    public int Hopping { get; private set; }
    /// <summary>Skulls drifting right now (tests).</summary>
    public int SkullsInFlight { get; private set; }
    public RenderTexture Texture => texture;
    public Camera StageCamera => cam;

    private static int count;
    private readonly List<Animator> rigs = new();
    private readonly List<Transform> roots = new();
    private GameObject holder;
    private Camera cam;
    private RenderTexture texture;
    private RawImage strip;
    private RectTransform skullLayer;
    private Sprite skull;

    private static readonly int IdleHash = Animator.StringToHash("Idle");
    private static readonly int AttackHash = Animator.StringToHash("Attack");
    private static readonly int JumpHash = Animator.StringToHash("Jump");
    private static readonly int DieHash = Animator.StringToHash("Die");

    /// <summary>Raise the screen. <paramref name="team"/> is the player's lobsters in slot order. Returns null when the
    /// skin has no prefab for this result (the caller falls back to the plain ResultBanner).</summary>
    public static ResultScreen Show(bool won, IReadOnlyList<LobsterController> team, HudSkin skin, BattleVfxLibrary vfx)
    {
        var prefab = skin != null ? (won ? skin.victoryScreenPrefab : skin.defeatScreenPrefab) : null;
        if (prefab == null) return null;
        var go = Instantiate(prefab);
        go.name = won ? "VictoryScreen" : "DefeatScreen";
        var canvas = go.GetComponent<Canvas>();
        if (canvas != null) canvas.sortingOrder = SortingOrder;
        var screen = go.AddComponent<ResultScreen>();
        screen.Won = won;
        screen.skull = skin.floatingSkull;
        screen.DeepenDim();
        screen.BuildStage(team, vfx != null ? vfx.characterShadow : null);
        Debug.Log($"[ResultScreen] {go.name} with {screen.rigs.Count} lobster(s){(won ? "" : screen.skull != null ? ", skulls on" : ", no floating-skull sprite yet")}");
        return screen;
    }

    private void BuildStage(IReadOnlyList<LobsterController> team, GameObject shadowPrefab)
    {
        // The stage: far off the board, its own spot per screen (a quick rematch can overlap the old one's teardown).
        var stage = new Vector3(-1000f - 60f * (count % 8), 1000f, 0f);
        count++;
        holder = new GameObject("ResultStage");
        holder.transform.position = stage;
        holder.SetActive(false);   // clones go in inactive, so none of their scripts wake before they are stripped

        int n = team?.Count ?? 0;
        for (int i = 0; i < n; i++)
        {
            var lob = team[i];
            if (lob == null) continue;
            float x = (i - (n - 1) * 0.5f) * SpacingPx / Ppu;
            var feet = stage + new Vector3(x, 0f, 0f);
            // The rig stands on a pivot of its own, and the code hop moves the pivot: an Animator that drives the rig's
            // root transform would overwrite a hop applied to the rig itself.
            var pivot = new GameObject("Pivot_" + lob.lobsterId).transform;
            pivot.gameObject.layer = StageLayer;
            pivot.SetParent(holder.transform, false);
            pivot.position = feet;
            var root = CloneRig(lob, pivot);
            if (root == null) { DestroyImmediate(pivot.gameObject); continue; }
            if (shadowPrefab != null) AddShadow(shadowPrefab, feet, root.lossyScale);
            roots.Add(pivot);
            rigs.Add(root.GetComponentInChildren<Animator>());
        }
        holder.SetActive(true);

        texture = new RenderTexture(StripW, StripH, 16, RenderTextureFormat.ARGB32) { name = "ResultStage", filterMode = FilterMode.Point, antiAliasing = 1 };
        texture.Create();
        var camGo = new GameObject("ResultStageCamera");
        camGo.transform.SetParent(holder.transform, false);
        camGo.layer = StageLayer;
        // Feet FeetPx above the strip's bottom edge, snapped to the pixel grid like the portraits.
        float cy = Mathf.Round((stage.y + (StripH * 0.5f - FeetPx) / Ppu) * Ppu) / Ppu;
        camGo.transform.position = new Vector3(stage.x, cy, stage.z - 10f);
        cam = camGo.AddComponent<Camera>();
        cam.orthographic = true;
        cam.orthographicSize = StripH * 0.5f / Ppu;
        cam.aspect = (float)StripW / StripH;
        cam.clearFlags = CameraClearFlags.SolidColor;
        cam.backgroundColor = new Color(0f, 0f, 0f, 0f);
        cam.cullingMask = 1 << StageLayer;
        cam.nearClipPlane = 0.01f;
        cam.farClipPlane = 50f;
        cam.allowHDR = false;
        cam.allowMSAA = false;
        cam.depth = -10f;
        cam.targetTexture = texture;

        var stripGo = new GameObject("TeamStrip", typeof(RectTransform), typeof(RawImage));
        var rt = stripGo.GetComponent<RectTransform>();
        rt.SetParent(transform, false);
        rt.anchorMin = rt.anchorMax = rt.pivot = new Vector2(0.5f, 0.5f);
        rt.sizeDelta = new Vector2(StripW, StripH);
        rt.anchoredPosition = StripPos;
        strip = stripGo.GetComponent<RawImage>();
        strip.texture = texture;
        strip.raycastTarget = false;

        var skullGo = new GameObject("FloatingSkulls", typeof(RectTransform));
        skullLayer = skullGo.GetComponent<RectTransform>();
        skullLayer.SetParent(rt, false);
        skullLayer.anchorMin = skullLayer.anchorMax = skullLayer.pivot = new Vector2(0.5f, 0.5f);
        skullLayer.sizeDelta = rt.sizeDelta;

        for (int i = 0; i < rigs.Count; i++)
        {
            float x = (i - (rigs.Count - 1) * 0.5f) * SpacingPx;
            if (Won) StartCoroutine(VictoryLoop(i, i * 0.25f));
            else StartCoroutine(Defeat(i, x, i * 0.15f));
        }
    }

    /// <summary>The dim layer Nzib authored (null if the prefab lost it).</summary>
    public Image Dim { get; private set; }

    private void DeepenDim()
    {
        Dim = transform.Find("DimOverlay")?.GetComponent<Image>();
        if (Dim == null) { Debug.LogWarning("[ResultScreen] no DimOverlay in the prefab — board not dimmed"); return; }
        var c = Dim.color;
        Dim.color = new Color(c.r, c.g, c.b, Application.isPlaying ? c.a : DimAlpha);
        if (Application.isPlaying) StartCoroutine(FadeDim(c.a));
    }

    private IEnumerator FadeDim(float from)
    {
        var c = Dim.color;
        for (float t = 0f; t < DimFadeSeconds; t += Time.deltaTime)
        {
            Dim.color = new Color(c.r, c.g, c.b, Mathf.Lerp(from, DimAlpha, t / DimFadeSeconds));
            yield return null;
        }
        Dim.color = new Color(c.r, c.g, c.b, DimAlpha);
    }

    /// <summary>The battle rig, cloned and stripped to its body parts in their own colours, standing on
    /// <paramref name="pivot"/> facing right, its Animator live on Idle.</summary>
    private Transform CloneRig(LobsterController lob, Transform pivot)
    {
        var clone = Instantiate(lob.gameObject, pivot);
        clone.name = "Result_" + lob.lobsterId;
        var t = clone.transform;
        t.localPosition = Vector3.zero;
        t.rotation = Quaternion.Euler(0f, LobsterController.FaceRightY, 0f);
        t.localScale = lob.transform.lossyScale;
        // Scripts can require each other, so a single pass may refuse some: repeat until none are left.
        for (int pass = 0; pass < 4; pass++)
        {
            var mbs = clone.GetComponentsInChildren<MonoBehaviour>(true);
            if (mbs.Length == 0) break;
            for (int i = mbs.Length - 1; i >= 0; i--) if (mbs[i] != null) DestroyImmediate(mbs[i]);
        }
        foreach (var a in clone.GetComponentsInChildren<AudioSource>(true)) DestroyImmediate(a);
        foreach (var r in clone.GetComponentsInChildren<Renderer>(true))
        {
            bool part = r is SpriteRenderer sr && sr.sprite != null && LobsterController.IsBodyPart(r.gameObject.name);
            r.enabled = part;
            if (part) ((SpriteRenderer)r).color = Color.white;   // no hit blink, stun or corpse tint carried over
        }
        foreach (var tr in clone.GetComponentsInChildren<Transform>(true)) tr.gameObject.layer = StageLayer;
        var anim = clone.GetComponentInChildren<Animator>();
        if (anim != null && anim.runtimeAnimatorController != null)
        {
            anim.enabled = true;   // a corpse's Animator was switched off by FreezeAsCorpse
            anim.speed = 1f;
            anim.Play(IdleHash, 0, 0f);
        }
        return t;
    }

    private void AddShadow(GameObject prefab, Vector3 feet, Vector3 scale)
    {
        var go = Instantiate(prefab, holder.transform, false);
        go.name = "ResultShadow";
        go.transform.position = new Vector3(feet.x, feet.y + CharacterShadow.Offset.y * Mathf.Abs(scale.y), feet.z);
        go.transform.localScale = new Vector3(Mathf.Abs(scale.x), Mathf.Abs(scale.y), 1f);
        foreach (var mb in go.GetComponentsInChildren<MonoBehaviour>(true)) DestroyImmediate(mb);
        foreach (var tr in go.GetComponentsInChildren<Transform>(true)) tr.gameObject.layer = StageLayer;
        var group = go.GetComponent<UnityEngine.Rendering.SortingGroup>();
        if (group == null) group = go.AddComponent<UnityEngine.Rendering.SortingGroup>();
        group.sortingLayerName = CharacterShadow.Layer;
        group.sortingOrder = CharacterShadow.Order;
    }

    // ─── Victory: Attack → Jump (or a code hop), looping ───

    private IEnumerator VictoryLoop(int i, float delay)
    {
        var anim = rigs[i];
        var root = roots[i];
        if (anim == null) yield break;
        if (delay > 0f) yield return new WaitForSeconds(delay);
        bool hasJump = anim.HasState(0, JumpHash);
        bool first = true;
        while (true)
        {
            if (first) Debug.Log($"[ResultScreen] {anim.gameObject.name} celebrates: Attack then {(hasJump ? "its Jump clip" : "a code hop (no Jump clip)")}");
            yield return PlayOnce(anim, AttackHash, 0.6f);
            if (hasJump) yield return PlayOnce(anim, JumpHash, 0.5f);
            else
            {
                Cross(anim, IdleHash);
                yield return Hop(root);
                if (first) Debug.Log($"[ResultScreen] {anim.gameObject.name} hop landed");
            }
            first = false;
            Cross(anim, IdleHash);
            yield return new WaitForSeconds(0.35f);
        }
    }

    private static void Cross(Animator anim, int hash)
    {
        if (anim.HasState(0, hash)) anim.CrossFade(hash, 0.08f);
        else if (anim.HasState(0, IdleHash)) anim.CrossFade(IdleHash, 0.08f);
    }

    /// <summary>Cross-fade into a one-shot state and wait out its clip (fallback seconds when the state is missing).</summary>
    private static IEnumerator PlayOnce(Animator anim, int hash, float fallback)
    {
        if (!anim.HasState(0, hash)) { yield return new WaitForSeconds(fallback); yield break; }
        anim.CrossFade(hash, 0.08f);
        yield return null;   // let the cross-fade start so the state info is this clip
        var info = anim.IsInTransition(0) ? anim.GetNextAnimatorStateInfo(0) : anim.GetCurrentAnimatorStateInfo(0);
        float len = info.shortNameHash == hash && info.length > 0f && !float.IsInfinity(info.length)
            ? info.length / Mathf.Max(0.01f, Mathf.Abs(info.speed * anim.speed)) : fallback;
        yield return new WaitForSeconds(Mathf.Max(0.1f, len - Time.deltaTime));
    }

    /// <summary>A celebratory hop on the rig's pivot: anticipation squash, an eased arc of about half a body with a stretch
    /// on the way up, a squash on landing. The shadow is its own object and stays on the ground.</summary>
    private IEnumerator Hop(Transform root)
    {
        if (root == null) yield break;
        Hopping++;
        Vector3 basePos = root.position, baseScale = root.localScale;
        float height = 0.28f * Mathf.Abs(baseScale.y);
        void Set(float lift, float sx, float sy)
        {
            root.position = basePos + new Vector3(0f, Mathf.Round(lift * Ppu) / Ppu, 0f);
            root.localScale = new Vector3(baseScale.x * sx, baseScale.y * sy, baseScale.z);
        }
        const float squash = 0.08f, air = 0.36f, land = 0.1f;
        for (float t = 0f; t < squash; t += Time.deltaTime)
        {
            float k = Mathf.Sin(Mathf.Clamp01(t / squash) * Mathf.PI * 0.5f);
            Set(0f, 1f + 0.12f * k, 1f - 0.12f * k);
            yield return null;
        }
        for (float t = 0f; t < air; t += Time.deltaTime)
        {
            float k = Mathf.Clamp01(t / air);
            float stretch = 0.08f * (Mathf.Abs(2f * k - 1f) * 2f - 1f);   // stretched leaving and landing, a touch squashed at the apex
            Set(height * 4f * k * (1f - k), 1f - stretch * 0.6f, 1f + stretch);
            yield return null;
        }
        for (float t = 0f; t < land; t += Time.deltaTime)
        {
            float k = Mathf.Sin(Mathf.Clamp01(t / land) * Mathf.PI);
            Set(0f, 1f + 0.1f * k, 1f - 0.1f * k);
            yield return null;
        }
        Set(0f, 1f, 1f);
        Hopping--;
    }

    // ─── Defeat: Die once, then skulls drift up ───

    private IEnumerator Defeat(int i, float xPx, float delay)
    {
        var anim = rigs[i];
        var root = roots[i];
        if (delay > 0f) yield return new WaitForSeconds(delay);
        if (anim != null)
        {
            yield return PlayOnce(anim, DieHash, 0.8f);
            // Hold the last Die frame with the Animator off, as FreezeAsCorpse does on the board.
            if (anim.HasState(0, DieHash)) { anim.Play(DieHash, 0, 0.999f); anim.Update(0f); }
            anim.enabled = false;
        }
        if (root != null)
            foreach (var sr in root.GetComponentsInChildren<SpriteRenderer>()) if (sr.enabled) sr.color = BodyTint;
        if (skull == null) yield break;
        yield return new WaitForSeconds(0.4f + 0.35f * i);
        int n = 0;
        while (true)
        {
            StartCoroutine(Skull(xPx, n++));
            yield return new WaitForSeconds(1.2f);
        }
    }

    /// <summary>One skull: appears just above the body, drifts up ~40 px with a gentle sway, grows a little, fades out.
    /// Successive skulls alternate small / medium / large, like a sleeper's z z Z.</summary>
    private IEnumerator Skull(float xPx, int n)
    {
        var go = new GameObject("Skull", typeof(RectTransform), typeof(Image));
        var rt = go.GetComponent<RectTransform>();
        rt.SetParent(skullLayer, false);
        var img = go.GetComponent<Image>();
        img.sprite = skull;
        img.raycastTarget = false;
        img.SetNativeSize();
        float size = 0.7f + 0.15f * (n % 3);
        float startY = -StripH * 0.5f + FeetPx + 22f;
        float side = (n % 2 == 0) ? 1f : -1f;
        SkullsInFlight++;
        const float life = 2.2f;
        for (float t = 0f; t < life; t += Time.deltaTime)
        {
            float k = t / life;
            rt.anchoredPosition = new Vector2(Mathf.Round(xPx + side * 4f * Mathf.Sin(k * Mathf.PI * 2f)), Mathf.Round(startY + 40f * k));
            float s = size * (0.85f + 0.25f * k);
            rt.localScale = new Vector3(s, s, 1f);
            img.color = new Color(1f, 1f, 1f, Mathf.Clamp01(k / 0.15f) * (1f - Mathf.Clamp01((k - 0.6f) / 0.4f)));
            yield return null;
        }
        SkullsInFlight--;
        Drop(go);
    }

    // ─── Teardown ───

    public void Dismiss()
    {
        Release();
        Drop(gameObject);
    }

    void OnDestroy() => Release();   // play mode only (edit mode skips OnDestroy — hence Dismiss releases first)

    private void Release()
    {
        if (cam != null) cam.targetTexture = null;
        if (holder != null) { Drop(holder); holder = null; }
        if (texture != null) { texture.Release(); Drop(texture); texture = null; }
    }

    /// <summary>Destroy that also works in edit mode (the smoke tests raise this screen outside play mode).</summary>
    private static void Drop(Object o)
    {
        if (Application.isPlaying) Destroy(o);
        else DestroyImmediate(o);
    }
}
