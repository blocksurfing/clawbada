using UnityEngine;

/// <summary>
/// Nzib's Dojo plants and ninja (design/vfx-specials 28dc6ce, behaviour note 2026-11-08), live in the battle arena.
///
/// Each plant either hides a ninja or not, decided once per battle (owner 2026-11-08: each plant 50 %, seeded with the
/// battle id like the squirrel, so a replay shows the same plants). An empty plant plays Idle; an occupied one loops
/// NinjaPeeking until the player clicks it. Then: the plant shakes, the ninja jumps up out of it, plays the whole
/// ThrowingStar clip (its disappearance included) and, once the held star has left his sprite, a separate star spins
/// across to the other plant. When it lands both plants shake together — the target because it was hit, the source
/// because the ninja is instantly back inside — and both return to their occupancy states. He never moves to the other
/// plant and there is no visible way back down.
///
/// Owner 2026-11-08: an empty plant rustles when clicked (its Shake, no ninja), so players learn the plants are
/// interactive; after a hidden number of clicks on it (5–10, per plant, seeded per battle) a ninja suddenly jumps out
/// of it — and from then on lives there, peeking. Only one sequence ever runs: while it plays, every plant click is
/// ignored (no rustle, no count), so clicking back and forth can never start two at once.
///
/// The logic and timings are his preview's (Assets/Preview/DojoNinja/DojoNinjaPreview.cs); the anchors are his preview
/// anchors as offsets from each plant (64 px per unit, mirrored on the right). Clicks come from HexInput, only for
/// points that are not on the board or a lobster, and only once the battle's first turn has started (so the intro's
/// skip-click never counts). Clicks during a sequence are swallowed, never queued. With no battle (the loading scene,
/// the arena preview) the plants just play Idle.
/// </summary>
public class DojoNinjaPlants : MonoBehaviour
{
    public Animator leftPlant, rightPlant;
    [Tooltip("Ninja_ART and Star_ART: instantiated hidden under this object.")]
    public GameObject ninjaPrefab, starPrefab;
    public AnimationClip throwClip, shakeClip, peekClip;
    [Range(0f, 1f)] public float occupiedChance = 0.5f;
    [Tooltip("Non-empty: replaces the battle-id seed (probes).")]
    public string seedOverride;

    [Header("Timing (seconds) — his preview's")]
    public float jumpDuration = 0.4f;
    [Tooltip("Into ThrowingStar: the held star is gone from frame 8; the release waits just past that key.")]
    public float releaseTime = 0.6f;
    public float flightDuration = 0.95f;
    public float impactRest = 0.1f;

    [Header("Anchors from the LEFT plant, art px (mirrored for the right)")]
    public Vector2 peakPx = new Vector2(0f, 40f);
    public Vector2 releasePx = new Vector2(14f, 42f);
    public Vector2 impactPx = new Vector2(0f, 8f);
    private const float Ppu = 64f;

    private enum Stage { Ready, SourceShake, Jump, Throw, Flight, Impact }
    private Stage stage = Stage.Ready;
    private float elapsed, flightTime;
    private bool fromRight;
    private bool leftOccupied, rightOccupied, rolled, battleUnderway;
    [Tooltip("Clicks on an empty plant before its ninja jumps out: a random count in this range (inclusive), per plant.")]
    public int surpriseMin = 5, surpriseMax = 10;
    private readonly int[] clicks = new int[2], surpriseAt = new int[2];
    private Vector3 flightOrigin, flightTarget;
    private Animator ninja, star;
    private SpriteRenderer ninjaRenderer;
    private BattleManager manager;
    private float searchAt;

    public bool Busy => stage != Stage.Ready;

    private void Start()
    {
        if (!Application.isPlaying) return;
        ninja = Spawn(ninjaPrefab, -1);
        star = Spawn(starPrefab, 3);
        if (ninja != null) ninjaRenderer = ninja.GetComponent<SpriteRenderer>();
        HideTransients();
        ShowOccupancy(true);
    }

    /// <summary>Hidden under this object, sorted against the plants as in his preview: the ninja just behind them, the
    /// star in front.</summary>
    private Animator Spawn(GameObject prefab, int orderFromPlant)
    {
        if (prefab == null || leftPlant == null) return null;
        var go = Instantiate(prefab, transform);
        go.name = prefab.name;
        var plantRenderer = leftPlant.GetComponent<SpriteRenderer>();
        foreach (var sr in go.GetComponentsInChildren<SpriteRenderer>(true))
        {
            sr.sortingLayerID = plantRenderer.sortingLayerID;
            sr.sortingOrder = plantRenderer.sortingOrder + orderFromPlant;
        }
        go.SetActive(false);
        return go.GetComponent<Animator>();
    }

    private void OnDisable()
    {
        if (manager != null) manager.TurnStarted -= OnTurnStarted;
        manager = null;
        stage = Stage.Ready;
        HideTransients();
    }

    private void OnTurnStarted(TurnStartData _, int __)
    {
        if (!battleUnderway) LogScreenPoints();
        battleUnderway = true;
    }

    /// <summary>For probes: where each plant's centre is on screen (Unity pixels, origin bottom-left).</summary>
    private void LogScreenPoints()
    {
        var cam = Camera.main != null ? Camera.main : FindFirstObjectByType<Camera>();
        if (cam == null || leftPlant == null || rightPlant == null) return;
        Vector3 P(Animator a) => cam.WorldToScreenPoint(a.GetComponent<SpriteRenderer>().bounds.center);
        Vector3 l = P(leftPlant), r = P(rightPlant);
        Debug.Log($"[DojoNinja] plants screen L={l.x:0},{l.y:0} R={r.x:0},{r.y:0}");
    }

    private void Update()
    {
        if (!Application.isPlaying) return;
        if (manager == null && Time.unscaledTime >= searchAt)
        {
            searchAt = Time.unscaledTime + 0.5f;
            manager = FindAnyObjectByType<BattleManager>();
            if (manager != null) { battleUnderway = false; manager.TurnStarted += OnTurnStarted; }
        }
        if (!rolled && manager != null && manager.InitData != null) Roll();
        if (stage != Stage.Impact) KeepPeeking();
    }

    private void Roll()
    {
        rolled = true;
        string battleId = manager.InitData.battleId;
        string seedKey = !string.IsNullOrEmpty(seedOverride) ? seedOverride
            : !string.IsNullOrEmpty(battleId) ? battleId : "nobattle|" + System.Environment.TickCount;
        // Two independent 16-bit draws from one well-mixed hash. (System.Random's first values follow its seed closely, and
        // battle ids differ only in a few characters, so seeding it gave the same plants battle after battle.)
        uint h = Mix(ObstacleLayoutGenerator.Fnv1a("ninja|" + seedKey));
        leftOccupied = (h & 0xFFFF) / 65536f < occupiedChance;
        rightOccupied = (h >> 16) / 65536f < occupiedChance;
        uint c = Mix(ObstacleLayoutGenerator.Fnv1a("ninja-clicks|" + seedKey));
        int span = Mathf.Max(0, surpriseMax - surpriseMin) + 1;
        surpriseAt[0] = surpriseMin + (int)((c & 0xFFFF) % (uint)span);
        surpriseAt[1] = surpriseMin + (int)((c >> 16) % (uint)span);
        clicks[0] = clicks[1] = 0;
        Debug.Log($"[DojoNinja] occupancy L={(leftOccupied ? 1 : 0)} R={(rightOccupied ? 1 : 0)} surprise L={surpriseAt[0]} R={surpriseAt[1]}");
        ShowOccupancy(true);
    }

    /// <summary>MurmurHash3's finaliser: every input bit reaches every output bit.</summary>
    private static uint Mix(uint h)
    {
        unchecked { h ^= h >> 16; h *= 0x85ebca6b; h ^= h >> 13; h *= 0xc2b2ae35; h ^= h >> 16; }
        return h;
    }

    private bool Occupied(Animator plant) => plant == leftPlant ? leftOccupied : rightOccupied;

    /// <summary>Idle, or NinjaPeeking from the start. His controller's trigger transitions are not used: the state comes
    /// straight from occupancy.</summary>
    private void ShowOccupancy(bool restart)
    {
        foreach (var plant in new[] { leftPlant, rightPlant })
        {
            if (plant == null || !plant.isActiveAndEnabled) continue;
            plant.ResetTrigger("Shake");
            plant.ResetTrigger("NinjaPeeking");
            if (restart) plant.Play(Occupied(plant) ? "NinjaPeeking" : "Idle", 0, 0f);
        }
    }

    /// <summary>NinjaPeeking is not a looping clip: start it again when it ends (or if the controller left it). A rustle
    /// plays to its end first; an empty plant then settles on Idle.</summary>
    private void KeepPeeking()
    {
        foreach (var plant in new[] { leftPlant, rightPlant })
        {
            if (plant == null || !plant.isActiveAndEnabled) continue;
            if (Busy && plant == Source) continue;   // its ninja is out (or it is shaking)
            var st = plant.GetCurrentAnimatorStateInfo(0);
            if (st.IsName("Shake") && st.normalizedTime < 1f) continue;
            if (Occupied(plant)) { if (!st.IsName("NinjaPeeking") || st.normalizedTime >= 1f) plant.Play("NinjaPeeking", 0, 0f); }
            else if (!st.IsName("Idle")) plant.Play("Idle", 0, 0f);
        }
    }

    /// <summary>A click at a world point that the board did not take. True when it fell on a plant (the click is used up,
    /// even if nothing plays).</summary>
    public bool TryClick(Vector3 world)
    {
        Animator hit = null;
        foreach (var plant in new[] { leftPlant, rightPlant })
        {
            if (plant == null || !plant.isActiveAndEnabled) continue;
            var b = plant.GetComponent<SpriteRenderer>().bounds;
            if (world.x >= b.min.x && world.x <= b.max.x && world.y >= b.min.y && world.y <= b.max.y) { hit = plant; break; }
        }
        if (hit == null) return false;
        if (!rolled || !battleUnderway || Busy || ninja == null || star == null) return true;   // one sequence at a time
        int i = hit == rightPlant ? 1 : 0;
        if (!Occupied(hit))
        {
            clicks[i]++;
            if (clicks[i] < surpriseAt[i])
            {
                // A rustle; clicks during one still count but do not restart it.
                var st = hit.GetCurrentAnimatorStateInfo(0);
                if (!(st.IsName("Shake") && st.normalizedTime < 1f)) { hit.Play("Shake", 0, 0f); BattleSfx.PlayDojoBushRustle(); }
                Debug.Log($"[DojoNinja] rustle {(i == 1 ? "right" : "left")} {clicks[i]}/{surpriseAt[i]}");
                return true;
            }
            // Surprise: a ninja was in there after all, and stays.
            if (i == 1) rightOccupied = true; else leftOccupied = true;
            Debug.Log($"[DojoNinja] surprise {(i == 1 ? "right" : "left")} after {clicks[i]} clicks");
        }
        Play(i == 1);
        return true;
    }

    private void Play(bool right)
    {
        fromRight = right;
        HideTransients();
        Source.Play("Shake", 0, 0f);
        BattleSfx.PlayDojoBushShake();
        Debug.Log($"[DojoNinja] play from {(right ? "right" : "left")}");
        SetStage(Stage.SourceShake);
    }

    private void LateUpdate()
    {
        if (stage == Stage.Ready) return;
        elapsed += Time.deltaTime;
        switch (stage)
        {
            case Stage.SourceShake:
                if (elapsed < ShakeLength + 0.02f) break;
                ninja.transform.localPosition = Anchor(fromRight, Vector2.zero);
                if (ninjaRenderer != null) ninjaRenderer.flipX = fromRight;
                ninja.gameObject.SetActive(true);
                ninja.Play("Jump", 0, 0f);
                BattleSfx.PlayDojoNinjaJump();
                Source.Play("Idle", 0, 0f);   // empty while he is out
                SetStage(Stage.Jump);
                break;
            case Stage.Jump:
                float t = Mathf.Clamp01(elapsed / Mathf.Max(0.01f, jumpDuration));
                ninja.transform.localPosition = Vector3.Lerp(Anchor(fromRight, Vector2.zero), Anchor(fromRight, peakPx), 1f - (1f - t) * (1f - t));
                if (t >= 1f) { ninja.Play("ThrowingStar", 0, 0f); BattleSfx.PlayDojoNinjaVoice(); SetStage(Stage.Throw); }
                break;
            case Stage.Throw:
                var st = ninja.GetCurrentAnimatorStateInfo(0);
                if (!st.IsName("ThrowingStar")) break;
                // Past the sprite key, not on it: float rounding can still show the held star at exactly 0.6 s.
                if (st.normalizedTime * ThrowLength < Mathf.Clamp(releaseTime, 0f, ThrowLength) + 0.02f) break;
                flightOrigin = Anchor(fromRight, releasePx);
                flightTarget = Anchor(!fromRight, impactPx);
                star.transform.localPosition = flightOrigin;
                star.gameObject.SetActive(true);
                star.Play("Spinning", 0, 0f);
                BattleSfx.PlayDojoStarThrow();
                flightTime = Mathf.Max(flightDuration, ThrowLength - Mathf.Clamp(releaseTime, 0f, ThrowLength) + 0.05f);
                SetStage(Stage.Flight);
                break;
            case Stage.Flight:
                star.transform.localPosition = Vector3.Lerp(flightOrigin, flightTarget, Mathf.Clamp01(elapsed / flightTime));
                if (elapsed < flightTime || ninja.GetCurrentAnimatorStateInfo(0).normalizedTime < 1f) break;
                HideTransients();   // his clip has already shown its transparent last frame
                leftPlant.Play("Shake", 0, 0f);
                rightPlant.Play("Shake", 0, 0f);
                BattleSfx.PlayDojoStarHit();
                Debug.Log("[DojoNinja] impact");
                SetStage(Stage.Impact);
                break;
            case Stage.Impact:
                if (elapsed < ShakeLength + Mathf.Max(0.05f, impactRest)) break;
                stage = Stage.Ready;
                ShowOccupancy(true);
                break;
        }
    }

    private Animator Source => fromRight ? rightPlant : leftPlant;
    private float ShakeLength => shakeClip != null ? shakeClip.length : 1.2f;
    private float ThrowLength => throwClip != null ? throwClip.length : 1.4f;

    /// <summary>A point by a plant, in this object's space: his left-side offset, mirrored for the right.</summary>
    private Vector3 Anchor(bool right, Vector2 px)
    {
        var plant = right ? rightPlant : leftPlant;
        var p = plant.transform.localPosition;
        return new Vector3(p.x + (right ? -px.x : px.x) / Ppu, p.y + px.y / Ppu, p.z);
    }

    private void SetStage(Stage s) { stage = s; elapsed = 0f; }

    private void HideTransients()
    {
        if (ninja != null) ninja.gameObject.SetActive(false);
        if (star != null) star.gameObject.SetActive(false);
    }
}
