using UnityEngine;
#if UNITY_EDITOR
using UnityEditor;
#endif

namespace Clawbada.UI
{
    /// <summary>Animator owns timing/easing. This adapter maps its progress to the current Canvas left edge.</summary>
    [ExecuteAlways, DisallowMultipleComponent]
    [RequireComponent(typeof(RectTransform), typeof(CanvasGroup), typeof(Animator))]
    public sealed class PanelSlideMotion : MonoBehaviour
    {
        [SerializeField, Range(0f, 1f), Tooltip("Animated by Open / Close. Edit their curves in the Animation window.")]
        private float progress = 1f;
        private RectTransform rect;
        private CanvasGroup group;
        private Animator animator;
        private Vector2 rest, hidden;
        private bool initialized, moving, opening, isOpen;
        private readonly Vector3[] corners = new Vector3[4];
        public bool IsOpen => isOpen;
        public float Progress => progress;

        private void Awake()
        {
            if (!Application.isPlaying) return;
            Initialize();
            animator.enabled = false;
            progress = 0f;
            group.alpha = 0f;
            group.interactable = group.blocksRaycasts = false;
        }
        private void Initialize()
        {
            if (initialized) return;
            rect = (RectTransform)transform;
            group = GetComponent<CanvasGroup>();
            animator = GetComponent<Animator>();
            animator.updateMode = AnimatorUpdateMode.UnscaledTime;
            rest = rect.anchoredPosition;
            hidden = HiddenPosition(rest);
            initialized = true;
        }
        public void Open() => Begin(true);
        public void Close() => Begin(false);
        private void Begin(bool show)
        {
            Initialize();
            if (moving && opening == show || !moving && isOpen == show) return;
            // The supplied curves are time-reversed pairs, so reversals retain their exact pose.
            float time = moving ? 1f - Mathf.Clamp01(animator.GetCurrentAnimatorStateInfo(0).normalizedTime) : 0f;
            if (!moving && isOpen) rest = rect.anchoredPosition;
            hidden = HiddenPosition(rest);
            opening = show;
            moving = true;
            gameObject.SetActive(true);
            group.alpha = 1f;
            group.interactable = false;
            group.blocksRaycasts = true;
            animator.enabled = true;
            animator.Play(show ? "Open" : "Close", 0, time);
            animator.Update(0f);
            Apply();
        }
        private Vector2 HiddenPosition(Vector2 baseline)
        {
            var r = (RectTransform)transform;
            var canvas = GetComponentInParent<Canvas>(true);
            if (!canvas) return baseline - new Vector2(r.rect.width + 1f, 0f);
            var canvasRect = (RectTransform)canvas.rootCanvas.transform;
            // Measure current bounds without moving transforms (safe in Animation Window).
            float right = float.NegativeInfinity;
            foreach (var child in GetComponentsInChildren<RectTransform>(true))
            {
                child.GetWorldCorners(corners);
                foreach (var corner in corners)
                    right = Mathf.Max(right, canvasRect.InverseTransformPoint(corner).x);
            }
            float clearance = 1f / Mathf.Max(canvas.rootCanvas.scaleFactor, 0.0001f);
            var offset = canvasRect.TransformVector(new Vector3(canvasRect.rect.xMin - right - clearance, 0f, 0f));
            var local = r.parent ? r.parent.InverseTransformVector(offset) : offset;
            return r.anchoredPosition + (Vector2)local;
        }
        private void Apply() => rect.anchoredPosition = Vector2.LerpUnclamped(hidden, rest, Mathf.Clamp01(progress));
        private void OnDidApplyAnimationProperties()
        {
            if (Application.isPlaying)
            {
                Initialize();
                Apply();
                return;
            }
#if UNITY_EDITOR
            // Register the derived transform with AnimationMode before changing it, so Stop restores
            // the artist's exact saved pose. No edit-time tween loop or serialized baseline drift.
            if (!AnimationMode.InAnimationMode()) return;
            var r = (RectTransform)transform;
            var binding = EditorCurveBinding.FloatCurve("", typeof(RectTransform), "m_AnchoredPosition.x");
            if (!AnimationMode.IsPropertyAnimated(r, "m_AnchoredPosition.x"))
                rest = r.anchoredPosition;
            AnimationMode.AddPropertyModification(binding, new PropertyModification {
                target = r, propertyPath = "m_AnchoredPosition.x", value = rest.x.ToString(System.Globalization.CultureInfo.InvariantCulture)
            }, true);
            hidden = HiddenPosition(rest);
            r.anchoredPosition = Vector2.LerpUnclamped(hidden, rest, Mathf.Clamp01(progress));
#endif
        }
        private void LateUpdate()
        {
            if (!moving) return;
            Apply();
            if (animator.GetCurrentAnimatorStateInfo(0).normalizedTime < 1f) return;
            moving = false;
            animator.enabled = false;
            isOpen = opening;
            progress = isOpen ? 1f : 0f;
            Apply();
            group.interactable = group.blocksRaycasts = isOpen;
            group.alpha = isOpen ? 1f : 0f;
            if (!isOpen) gameObject.SetActive(false);
        }
        private void OnDisable()
        {
            if (!Application.isPlaying || !initialized) return;
            moving = isOpen = false;
            group.alpha = 0f;
            group.interactable = group.blocksRaycasts = false;
        }
    }
}
