using UnityEngine;

/// <summary>
/// Screen shake for a Special's big beat — Maelstrom's lightning hitting the ground, Inferno's
/// fireball bursting. Lives on the main camera (attached on first use) and nudges it by a decaying
/// random offset around wherever it was, then puts it back exactly. Runs on the battle's scaled
/// clock, so ?speed=N shortens it like everything else. With the pixel-perfect camera the offset
/// snaps to whole art pixels, which reads as a proper retro judder rather than a smear. The HUD is
/// screen-space and does not move; the field bars follow their units and so shake with the world.
/// </summary>
public class CameraShake : MonoBehaviour
{
    private static CameraShake instance;

    private Vector3 basePosition;
    private float amplitude;
    private float duration;
    private float elapsed;
    private bool active;

    /// <summary>Kick a shake of `amplitude` world units that decays to nothing over `seconds`.
    /// A stronger shake replaces a weaker one in progress; a weaker one is ignored.</summary>
    public static void Shake(float amplitude, float seconds)
    {
        if (amplitude <= 0f || seconds <= 0f) return;
        var cam = Camera.main;
        if (cam == null) return;
        if (instance == null) instance = cam.GetComponent<CameraShake>() ?? cam.gameObject.AddComponent<CameraShake>();
        instance.Begin(amplitude, seconds);
    }

    private void Begin(float amp, float seconds)
    {
        if (active && amp < amplitude * (1f - elapsed / duration)) return;
        if (!active) basePosition = transform.position;
        amplitude = amp;
        duration = seconds;
        elapsed = 0f;
        active = true;
        Debug.Log($"[CameraShake] amp={amp:F2}u for {seconds:F2}s");
    }

    void LateUpdate()
    {
        if (!active) return;
        elapsed += Time.deltaTime;
        float k = 1f - Mathf.Clamp01(elapsed / duration);
        if (k <= 0f)
        {
            transform.position = basePosition;
            active = false;
            return;
        }
        Vector2 o = Random.insideUnitCircle * amplitude * k;
        transform.position = basePosition + new Vector3(o.x, o.y, 0f);
    }
}
