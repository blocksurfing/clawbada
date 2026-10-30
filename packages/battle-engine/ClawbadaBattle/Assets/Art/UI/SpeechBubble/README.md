# Animated speech bubble — art-only UI

Prefab: `Assets/Prefabs/UI/SpeechBubble/AnimatedSpeechBubble.prefab`
Component: `Clawbada.UI.AnimatedSpeechBubble`

Place under a UGUI Canvas with referencePixelsPerUnit 100, integer scale and pixel-aligned positioning. Images do not intercept raycasts. No gameplay, tutorial or speaking animation wiring is included.

`SetText(string)` sets text and sizing. Explicit newlines determine line count; width follows the longest line with 28px padding and even-pixel snapping. Silkscreen-Regular is 8px. One and two lines use touching top/bottom bands (24px final height), with NO middle. Three or more lines add 10px of tiled middle per additional line. `SetExpandedSize` is a compatibility shim: text remains the sizing authority.

`Replay()` starts BOTH main and connector at t=0. Main has six 100ms frames; connector has FOUR 100ms frames. Serialized durations come directly from the exported JSON. Each sequence independently holds its last frame: connector reaches final at300ms, main at500ms; opening completes at600ms. Text becomes visible at600ms. Update uses unscaled time; `Evaluate(double)` supports deterministic art previews.

Strips and JSON are copied byte-for-byte from their artist-source exports. Main retains 48x64 cells (288x64 strip); the revised connector retains 158x64 cells (632x64 strip). Main bands use per-frame cel bounds and corner caps, not stretched artwork. The connector uses common Unity crop `(frame*158,2,16,11)`, preserving all authored offsets. Its lower-left stays at(-2,-12) relative to the FINAL expanded panel lower-left throughout opening, giving a 1-source-pixel gap below the final panel and avoiding sideways drift during opening. Character-relative placement is a caller responsibility; the latest fixed-tail/left-panel composition remains an isolated preview, not production scene wiring.

Point filter,64PPU, no compression or mipmaps. Tiled band Image pixelsPerUnitMultiplier=100/64. Main source bounds16/26/42/48/42/44; horizontal caps6/6/6/6/13/14; vertical caps6/6/6/6/9/12.

Evidence and isolated preview: `_workspace/verification/speech-bubble/concurrent-evidence/`. Real Unity camera preview includes the original Shifu prefab in a static neutral pose, Animator disabled; no Speak playback. Production scenes and Shifu assets are not changed.
