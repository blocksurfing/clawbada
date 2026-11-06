using System.Collections;
using UnityEngine;
using UnityEngine.UI;

namespace Clawbada.UI
{
    /// <summary>Standalone artist scene only. Never attached to the production OptionsPanel prefab.</summary>
    public sealed class OptionsArtistPreview : MonoBehaviour
    {
        [SerializeField] private PanelSlideMotion panel;
        [SerializeField] private Button closeArrow;
        private IEnumerator Start()
        {
            closeArrow.onClick.AddListener(Close);
            yield return new WaitForSecondsRealtime(0.2f);
            Open();
        }
        public void Open() => panel.Open();
        public void Close() => panel.Close();
        private void Update()
        {
#if ENABLE_LEGACY_INPUT_MANAGER
            if (Input.GetKeyDown(KeyCode.R) || Input.GetKeyDown(KeyCode.Space)) Open();
#endif
        }
        private void LateUpdate()
        {
            // Preview-only framing: keep Canvas x=0 at the viewport's left edge at any aspect.
            var camera = panel.GetComponentInParent<Canvas>(true).worldCamera;
            if (camera && camera.orthographic)
            {
                var position = camera.transform.position;
                position.x = camera.orthographicSize * camera.aspect;
                camera.transform.position = position;
            }
        }
        private void OnGUI()
        {
            if (GUI.Button(new Rect(12f, 12f, 180f, 30f), "Open Options  [Space / R]")) Open();
        }
        private void OnDestroy()
        {
            if (closeArrow) closeArrow.onClick.RemoveListener(Close);
        }
    }
}
