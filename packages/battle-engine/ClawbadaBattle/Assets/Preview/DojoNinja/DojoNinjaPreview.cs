using UnityEngine;

namespace Clawbada.Preview
{
    /// <summary>Artist-only scene playback. No battle, random, or production event wiring.</summary>
    public sealed class DojoNinjaPreview : MonoBehaviour
    {
        [Header("Scene references (existing art / clips)")]
        public Camera previewCamera;
        public Animator leftPlant, rightPlant, ninja, star;
        public AnimationClip throwClip, shakeClip;
        [Header("Anchors: left / right are independently editable world positions")]
        public Transform leftExit, leftPeak, leftRelease, leftTarget;
        public Transform rightExit, rightPeak, rightRelease, rightTarget;
        [Header("Timing (seconds)")]
        public bool autoStart = true;
        [Min(0.01f)] public float jumpDuration = .4f;
        [Tooltip("Source frame 8: held Star layer ends after frames 2-7.")]
        [Min(0)] public float releaseTime = .6f;
        [Tooltip("Automatically clamped so impact cannot truncate the original throw disappearance.")]
        [Min(.01f)] public float flightDuration = .95f;
        [Min(0)] public float impactRest = .1f;
        public enum Stage { Ready, SourceShake, Jump, Throw, Flight, Impact }
        public Stage CurrentStage { get; private set; }
        public bool FromRight { get; private set; }
        public bool Busy => CurrentStage != Stage.Ready;
        float elapsed, flightTime;
        bool lastRight;
        Vector3 flightOrigin, flightTarget;
        SpriteRenderer ninjaRenderer;
        void Awake() { ninjaRenderer = ninja.GetComponent<SpriteRenderer>(); ResetTransient(); }
        void Start() { if (autoStart) Play(false); }
        public bool Play(bool fromRight)
        {
            if (Busy || !isActiveAndEnabled) return false;
            FromRight = lastRight = fromRight;
            ResetTransient();
            (fromRight ? rightPlant : leftPlant).SetTrigger("Shake");
            CurrentStage = Stage.SourceShake;
            elapsed = 0;
            return true;
        }
        void LateUpdate()
        {
            elapsed += Time.deltaTime;
            switch (CurrentStage)
            {
                case Stage.SourceShake:
                    if (elapsed < shakeClip.length + .02f) break;
                    ninja.transform.position = Exit.position;
                    ninjaRenderer.flipX = FromRight;
                    ninja.gameObject.SetActive(true);
                    ninja.Play("Jump", 0, 0);
                    SetStage(Stage.Jump);
                    break;
                case Stage.Jump:
                    float t = Mathf.Clamp01(elapsed / Mathf.Max(.01f, jumpDuration));
                    ninja.transform.position = Vector3.Lerp(Exit.position, Peak.position, 1 - (1-t)*(1-t));
                    if (t >= 1) { ninja.Play("ThrowingStar", 0, 0); SetStage(Stage.Throw); }
                    break;
                case Stage.Throw:
                    if (!ninja.GetCurrentAnimatorStateInfo(0).IsName("ThrowingStar")) break;
                    // Cross the sprite-key boundary before releasing: float rounding can still show the held star at exactly 0.6s.
                    if (ninja.GetCurrentAnimatorStateInfo(0).normalizedTime * throwClip.length < Mathf.Clamp(releaseTime, 0, throwClip.length) + .001f) break;
                    flightOrigin = Release.position;
                    flightTarget = Target.position;
                    star.transform.position = flightOrigin;
                    star.gameObject.SetActive(true);
                    star.Play("Spinning", 0, 0);
                    flightTime = Mathf.Max(flightDuration, throwClip.length - Mathf.Clamp(releaseTime, 0, throwClip.length) + .05f);
                    SetStage(Stage.Flight);
                    break;
                case Stage.Flight:
                    star.transform.position = Vector3.Lerp(flightOrigin, flightTarget, Mathf.Clamp01(elapsed / flightTime));
                    if (elapsed < flightTime || ninja.GetCurrentAnimatorStateInfo(0).normalizedTime < 1) break;
                    star.gameObject.SetActive(false);
                    // The original clip has already displayed its transparent final frame.
                    ninja.gameObject.SetActive(false);
                    leftPlant.SetTrigger("Shake");
                    rightPlant.SetTrigger("Shake");
                    SetStage(Stage.Impact);
                    break;
                case Stage.Impact:
                    if (elapsed >= shakeClip.length + Mathf.Max(.05f, impactRest)) { ResetTransient(); SetStage(Stage.Ready); }
                    break;
            }
        }
        Transform Exit => FromRight ? rightExit : leftExit;
        Transform Peak => FromRight ? rightPeak : leftPeak;
        Transform Release => FromRight ? rightRelease : leftRelease;
        Transform Target => FromRight ? leftTarget : rightTarget;
        void SetStage(Stage stage) { CurrentStage = stage; elapsed = 0; }
        void ResetTransient()
        {
            if (ninja) { ninja.gameObject.SetActive(false); if (leftExit) ninja.transform.position = leftExit.position; }
            if (star) { star.gameObject.SetActive(false); if (leftRelease) star.transform.position = leftRelease.position; }
        }
        void OnDisable()
        {
            ResetTransient();
            foreach (var plant in new[] { leftPlant, rightPlant }) if (plant && plant.isActiveAndEnabled) { plant.ResetTrigger("Shake"); plant.ResetTrigger("NinjaPeeking"); plant.Play("Idle", 0, 0); }
            CurrentStage = Stage.Ready;
        }
        // Shared event route for Game-view input; public for isolated editor input-dispatch verification.
        public bool ProcessPreviewInput(EventType type, KeyCode key = KeyCode.None, Vector2 mousePosition = default, int button = 0, bool hasModifiers = false)
        {
            if (type == EventType.KeyDown && !hasModifiers)
            {
                if (key == KeyCode.L) return Play(false);
                if (key == KeyCode.R) return Play(true);
                if (key == KeyCode.Space) return Play(lastRight);
            }
            if (type == EventType.MouseDown && button == 0)
            {
                Vector3 screen = new Vector3(mousePosition.x, Screen.height - mousePosition.y, -previewCamera.transform.position.z);
                Vector3 world = previewCamera.ScreenToWorldPoint(screen);
                foreach (var plant in new[] { leftPlant, rightPlant })
                {
                    var bounds = plant.GetComponent<SpriteRenderer>().bounds;
                    if (world.x >= bounds.min.x && world.x <= bounds.max.x && world.y >= bounds.min.y && world.y <= bounds.max.y) return Play(plant == rightPlant);
                }
            }
            return false;
        }
        void OnGUI()
        {
            var e = Event.current;
            if (ProcessPreviewInput(e.type, e.keyCode, e.mousePosition, e.button, e.alt || e.control || e.command)) e.Use();
            GUI.enabled = !Busy;
            if (GUI.Button(new Rect(12, Screen.height - 38, 115, 26), "Left  [L]")) Play(false);
            if (GUI.Button(new Rect(133, Screen.height - 38, 115, 26), "Right  [R]")) Play(true);
            GUI.enabled = true;
            GUI.Label(new Rect(260, Screen.height - 36, 330, 26), Busy ? "Playing (replay waits for impact)" : "Click a plant / Space: repeat");
        }
    }
}
