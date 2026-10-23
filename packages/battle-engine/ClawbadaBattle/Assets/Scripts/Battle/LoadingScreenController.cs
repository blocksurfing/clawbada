using System;
using System.Collections;
using UnityEngine;
using UnityEngine.SceneManagement;
using UnityEngine.UI;

/// <summary>
/// The Unity half of the battle entry sequence (owner spec 2026-10-21): while the arena is built, the player sees
/// Nzib's training scene — the three lobsters sparring with Shifu in the Dojo — with a gameplay tip, for at least
/// MinHoldSeconds, then a fade to black into the arena intro.
///
/// How it fits:
///   • BattleScene stays scene 0 and the active scene (it owns everything the battle spawns). This component is
///     attached at runtime by BattleManager.Awake and loads Assets/Scenes/LoadingScreen.unity ADDITIVELY on top;
///     the training scene is unloaded again once the hold is over.
///   • Two cameras exist meanwhile. The loading camera is untagged (never Camera.main — framing, the HUD and the
///     input router all read it), drawn after the battle camera, clears to a solid colour, and both cameras cull by
///     the `Loading` GameObject layer every root of the loaded scene is moved to. The HUD canvas is Screen Space
///     Overlay and would draw over the training scene, so BattleManager hides it (HideForIntro) until the intro.
///   • Contract with React (BattleBridge): the first rendered frame of the training scene sends `onLoadingShown`;
///     React lifts its own web loading loop and answers `ShowLoading {tip}`, which puts the tip on the scene's
///     GameplayTip text and RESTARTS the hold clock (so the player gets the full hold from the moment they can see
///     it). A page that never sends ShowLoading (an older web build) still releases MinHoldSeconds after the first
///     frame. InitBattle → BattleManager.Initialize → ArenaBuilt(); release = hold elapsed AND arena built.
///   • Release: fade to black (an Overlay canvas above the intro's own IntroCanvas), unload the training scene,
///     clear Holding so BattleManager's IntroRoutine proceeds (BattleIntro starts from its own black, so no
///     cross-fade of cameras is needed), then fade the black out — invisible under the intro, and the reveal of the
///     arena when there is no intro (a reconnect).
/// Everything timed uses unscaled time: SetSpeed changes Time.timeScale.
/// </summary>
public class LoadingScreenController : MonoBehaviour
{
    public const string SceneName = "LoadingScreen";
    public const string LayerName = "Loading";
    public const float MinHoldSeconds = 9f;   // owner 2026-10-23: "about 9 seconds" (was 4.5)
    public const float FadeSeconds = 0.4f;
    private const float RevealDelaySeconds = 0.25f;
    private const int FadeCanvasOrder = 500;   // above BattleIntro's IntroCanvas (400) and the HUD (100)

    [Serializable] public class LoadingData { public string tip; }

    /// <summary>The controller while the training scene is up; null once released (or never shown).</summary>
    public static LoadingScreenController Holding { get; private set; }

    public bool IsHolding { get; private set; }
    public event Action Released;

    private Scene scene;
    private Text tipText;
    private string pendingTip;
    private float shownAt = -1f;
    private bool built;
    private Canvas fadeCanvas;
    private Image black;

    void Awake()
    {
        if (!Application.isPlaying) return;   // the edit-mode smoke test adds the component and drives it by hand
        IsHolding = true;
        Holding = this;
        StartCoroutine(Run());
    }

    void OnDestroy()
    {
        if (Holding == this) Holding = null;
    }

    private IEnumerator Run()
    {
        SceneManager.sceneLoaded += OnSceneLoaded;   // camera/layer handover before anything can see two MainCameras
        AsyncOperation load = null;
        try
        {
            load = SceneManager.LoadSceneAsync(SceneName, LoadSceneMode.Additive);
        }
        catch (Exception err)
        {
            Debug.LogWarning($"[LoadingScreen] could not load {SceneName}: {err.Message} — going straight to the battle");
        }
        if (load == null)
        {
            SceneManager.sceneLoaded -= OnSceneLoaded;
            ReleaseNow();
            Destroy(this);
            yield break;
        }
        yield return load;
        SceneManager.sceneLoaded -= OnSceneLoaded;
        Bind(SceneManager.GetSceneByName(SceneName));
        yield return new WaitForEndOfFrame();       // the training scene's first frame is on screen
        shownAt = Time.unscaledTime;
        Debug.Log("[LoadingScreen] training scene shown");
        var bridge = FindAnyObjectByType<BattleBridge>();
        if (bridge != null) bridge.NotifyLoadingShown();

        while (!built || Time.unscaledTime - shownAt < MinHoldSeconds) yield return null;
        yield return new WaitForEndOfFrame();       // SyncUnits / SetSpeed / SetAudioPrefs of the same JS tick have applied

        // Fade to black above everything, then hand over.
        fadeCanvas = HudFactory.Canvas("LoadingFade", FadeCanvasOrder, new Vector2(960f, 540f), 0.5f, 64f);
        black = HudFactory.AddImage(HudFactory.Stretch(fadeCanvas.transform, "Black"), null, new Color(0f, 0f, 0f, 0f));
        yield return Tween(FadeSeconds, k => black.color = new Color(0f, 0f, 0f, k));
        if (scene.IsValid() && scene.isLoaded) yield return SceneManager.UnloadSceneAsync(scene);
        Resources.UnloadUnusedAssets();
        Debug.Log($"[LoadingScreen] released after {Time.unscaledTime - shownAt:F1} s on screen");
        ReleaseNow();                                 // BattleManager.IntroRoutine continues this frame
        yield return Wait(RevealDelaySeconds);        // the intro's own black is underneath by now
        yield return Tween(FadeSeconds, k => black.color = new Color(0f, 0f, 0f, 1f - k));
        if (fadeCanvas != null) Destroy(fadeCanvas.gameObject);
        Destroy(this);
    }

    private void OnSceneLoaded(Scene loaded, LoadSceneMode mode)
    {
        if (loaded.name != SceneName) return;
        var battleCam = Camera.main;
        int layer = LayerMask.NameToLayer(LayerName);
        foreach (var root in loaded.GetRootGameObjects())
        {
            if (layer >= 0) SetLayerRecursively(root, layer);
            foreach (var cam in root.GetComponentsInChildren<Camera>(true))
            {
                cam.tag = "Untagged";                 // Camera.main must stay the battle camera
                cam.depth = (battleCam != null ? battleCam.depth : 0f) + 1f;   // drawn after it → covers it
                cam.clearFlags = CameraClearFlags.SolidColor;
                if (layer >= 0) cam.cullingMask = 1 << layer;
                var listener = cam.GetComponent<AudioListener>();
                if (listener != null) listener.enabled = false;
            }
        }
        if (battleCam != null && layer >= 0) battleCam.cullingMask &= ~(1 << layer);
    }

    private static void SetLayerRecursively(GameObject go, int layer)
    {
        go.layer = layer;
        foreach (Transform child in go.transform) SetLayerRecursively(child.gameObject, layer);
    }

    /// <summary>Find the scene's tip text. Public for the edit-mode smoke test.</summary>
    public void Bind(Scene s)
    {
        scene = s;
        tipText = null;
        if (!s.IsValid()) return;
        foreach (var root in s.GetRootGameObjects())
        {
            foreach (var t in root.GetComponentsInChildren<Text>(true))
            {
                if (t.gameObject.name == "GameplayTip") { tipText = t; break; }
            }
            if (tipText != null) break;
        }
        if (tipText == null) Debug.LogWarning("[LoadingScreen] no GameplayTip text in the training scene — the tip has nowhere to go");
        else if (pendingTip != null) tipText.text = pendingTip;
    }

    /// <summary>React's `ShowLoading {tip}`: put the tip up and restart the hold clock (the player can see the scene now).</summary>
    public void ShowLoading(string json)
    {
        // Released already (play mode): the training scene is gone, nothing to set. Edit mode never holds (Awake is
        // a no-op there) — the smoke test drives Bind/ShowLoading/ReleaseNow by hand.
        if (!IsHolding && Application.isPlaying)
        {
            Debug.Log("[LoadingScreen] ShowLoading after release — ignored");
            return;
        }
        LoadingData d = null;
        try { d = JsonUtility.FromJson<LoadingData>(json); } catch { /* malformed: keep the scene's own text */ }
        pendingTip = d?.tip ?? "";
        if (tipText != null && pendingTip.Length > 0) tipText.text = pendingTip;
        if (shownAt >= 0f) shownAt = Time.unscaledTime;   // not yet shown: the first frame sets it
        Debug.Log($"[LoadingScreen] tip set ({pendingTip.Length} chars); hold restarted");
    }

    /// <summary>BattleManager.Initialize is done spawning the arena.</summary>
    public void ArenaBuilt() => built = true;

    /// <summary>Clear the hold without any fade (the normal path calls it from Run; the smoke test directly).</summary>
    public void ReleaseNow()
    {
        if (!IsHolding && Holding != this) return;
        IsHolding = false;
        if (Holding == this) Holding = null;
        Released?.Invoke();
    }

    private static IEnumerator Wait(float seconds)
    {
        float end = Time.unscaledTime + seconds;
        while (Time.unscaledTime < end) yield return null;
    }

    private static IEnumerator Tween(float seconds, Action<float> apply)
    {
        float start = Time.unscaledTime;
        float k = 0f;
        while (k < 1f)
        {
            k = seconds <= 0f ? 1f : Mathf.Clamp01((Time.unscaledTime - start) / seconds);
            apply(k);
            yield return null;
        }
    }
}
