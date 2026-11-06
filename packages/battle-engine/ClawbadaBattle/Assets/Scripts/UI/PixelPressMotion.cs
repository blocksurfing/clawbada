using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.UI;

namespace Clawbada.UI
{
    /// <summary>Offsets only the assigned visuals by one UI pixel while held.</summary>
    [DisallowMultipleComponent]
    [RequireComponent(typeof(Selectable))]
    public sealed class PixelPressMotion : MonoBehaviour, IPointerDownHandler, IPointerUpHandler, ICancelHandler
    {
        [SerializeField] private RectTransform[] visuals;
        private Vector2[] restingPositions;
        private Selectable selectable;
        private bool pressed;
        private int pointerId;

        public void OnPointerDown(PointerEventData eventData)
        {
            if (!isActiveAndEnabled || pressed || eventData.button != PointerEventData.InputButton.Left)
                return;
            if (!selectable) selectable = GetComponent<Selectable>();
            if (!selectable.IsActive() || !selectable.IsInteractable() || visuals == null) return;

            if (restingPositions == null || restingPositions.Length != visuals.Length)
                restingPositions = new Vector2[visuals.Length];
            pointerId = eventData.pointerId;
            pressed = true;
            for (int i = 0; i < visuals.Length; i++)
            {
                if (!visuals[i]) continue;
                restingPositions[i] = visuals[i].anchoredPosition;
                visuals[i].anchoredPosition = restingPositions[i] + Vector2.down;
            }
        }

        public void OnPointerUp(PointerEventData eventData)
        {
            if (eventData.button == PointerEventData.InputButton.Left && eventData.pointerId == pointerId)
                Restore();
        }

        public void OnCancel(BaseEventData eventData) => Restore();
        private void OnDisable() => Restore();
        private void OnApplicationFocus(bool focused) { if (!focused) Restore(); }
        private void OnApplicationPause(bool paused) { if (paused) Restore(); }

        private void Update()
        {
            if (pressed && (!selectable || !selectable.IsActive() || !selectable.IsInteractable())) Restore();
        }

        private void Restore()
        {
            if (!pressed) return;
            for (int i = 0; i < visuals.Length; i++)
                if (visuals[i]) visuals[i].anchoredPosition = restingPositions[i];
            pressed = false;
        }
    }
}
