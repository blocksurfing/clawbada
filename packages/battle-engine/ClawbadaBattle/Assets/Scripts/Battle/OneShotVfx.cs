using UnityEngine;

/// <summary>
/// A fire-and-forget battle effect: plays its Animator's clip once and destroys
/// itself. Every VFX prefab referenced by BattleVfxLibrary should carry this —
/// the designer only needs a SpriteRenderer + Animator with a one-shot clip
/// (same setup as the Preview_Global_* clips) and this component does the rest.
/// </summary>
public class OneShotVfx : MonoBehaviour
{
    [Tooltip("Extra seconds to live after the clip ends (lets trails/fades finish).")]
    public float extraLifetime = 0.05f;

    [Tooltip("Lifetime used when there is no Animator clip to measure (e.g. particles).")]
    public float fallbackLifetime = 2f;

    void Start()
    {
        float lifetime = fallbackLifetime;
        var animator = GetComponent<Animator>();
        if (animator != null && animator.runtimeAnimatorController != null)
        {
            var clips = animator.runtimeAnimatorController.animationClips;
            if (clips != null && clips.Length > 0)
            {
                lifetime = 0f;
                foreach (var clip in clips)
                {
                    if (clip != null && clip.length > lifetime) lifetime = clip.length;
                }
            }
        }
        Destroy(gameObject, lifetime + extraLifetime);
    }
}
