# Dojo Ninja — artist-only preview

Open `Assets/Scenes/Preview/Preview_Dojo_Ninja.unity`, then press Unity **Play**.
The left plant automatically starts the complete sequence. No setup/code is needed.
Use a landscape Game view (16:9 recommended; 4:3 also tested).

## Replay

Focus the **Game** view. After the impact Shake finishes:
- Click either plant to make it the source.
- **L** = left source, **R** = right source.
- **Space** = repeat the last direction.
- The two small bottom-left buttons also replay left/right.

Inputs during playback are ignored, not queued. Stop Play to restore edit-time state.
The controls are preview-only IMGUI events; no Input System package, battle callbacks,
production click handlers, random triggers, or animation events are introduced.

## Tune in the Inspector

Select `PREVIEW ONLY - Ninja sequence (select to tune)`:
- **Auto Start**: play left once on entering Play Mode.
- **Jump Duration**: upward travel with the original held Jump pose (default 0.4s).
- **Release Time**: seconds into the original ThrowingStar clip (default 0.6s).
  Source Star cels are present through frame 7, absent from frame 8 onward.
  Release waits just beyond that sprite-key boundary to prevent a one-frame
  duplicate held/projectile star caused by float rounding (0.62s in the 0.02s test).
- **Flight Duration**: default 0.95s; clamped to allow the complete original throw
  plus a small margin before impact. Shortening it never truncates disappearance.
- **Impact Rest**: additional wait after the original 1.2s Shake before replay unlocks.
- **Throw Clip / Shake Clip**: references to the existing editable original clips.

Expand `Preview anchors (world space; native art scale)` and move each side's
**exit**, **peak**, **hand release**, or **impact** anchor. Positions are world space;
left/right anchors are separately editable. Default release is 14px toward the target
and 2px up from the peak, at native 64 PPU (mirrored on the right).
Ninja goes only exit -> peak; it stays there through every original throw sprite,
including the transparent ending. There is no downward/return path.
Star is a separate scene root, not parented to Ninja. Flight endpoints are captured
at release. Arrival hides Star and triggers both independent plant Animators in the
same frame. Transients remain hidden during impact/reset.

## Scope / sorting

The arena is a connected instance of the real shared ArenaArt_Dojo prefab. Its
plant transform, flipX, sorting, controller and sprite data are unchanged. Ninja
is behind plants (Background order 4 vs plants 5), Star is in front (order 8).
All art uses original sprites/clips, unit transform scale, and native 64 PPU.
The unrelated nested Squirrel_Ninja is disabled **only in this preview instance**
to avoid its production battle/random behaviour; the shared prefab is untouched.
Do not Apply preview overrides to shared prefabs.

## Verification

Isolated Unity 6000.4.2f1 D3D11 Play Mode tests use normal Animator updates and a
fixed 0.02s capture step, not SampleAnimation. Evidence is external to Assets.
Keyboard and both plant-click events are dispatched through the actual preview
input handler using event data (type, key or screen position). Batch mode does not
deliver normal Game-view mouse events. This is handler/coordinate verification,
not physical OS mouse/keyboard or end-to-end IMGUI button testing. Camera renders verify art
stages; they do not capture the IMGUI controls. No temporary builder/test harness
is installed in the artist project.
