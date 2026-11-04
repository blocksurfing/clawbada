using System;
using System.Collections;
using UnityEngine;

/// <summary>
/// Battle lifecycle only. All sprite frames and timing are authored in the Intro
/// Animator clips, so they can be previewed and edited in Unity's Animation window.
/// </summary>
[RequireComponent(typeof(Animator))]
public sealed class Intro : MonoBehaviour
{
    private static readonly int TransitionState = Animator.StringToHash("Base Layer.Transition");
    private static readonly int LoopState = Animator.StringToHash("Base Layer.Loop");
    private static readonly int ExitState = Animator.StringToHash("Base Layer.BattleExit");
    private static readonly int ContinueTrigger = Animator.StringToHash("Continue");

    public IEnumerator Play(Func<bool> skipped, float loopHold = 0.8f)
    {
        if (skipped()) { gameObject.SetActive(false); yield break; }
        var animator = GetComponent<Animator>();
        if (animator.runtimeAnimatorController == null || !animator.HasState(0, TransitionState)
            || !animator.HasState(0, LoopState) || !animator.HasState(0, ExitState))
        {
            Debug.LogError("[Intro] Missing Intro Animator controller/states", this);
            gameObject.SetActive(false);
            yield break;
        }
        gameObject.SetActive(true);
        try
        {
            animator.Rebind();
            animator.ResetTrigger(ContinueTrigger);
            animator.Play(TransitionState, 0, 0f);
            animator.Update(0f);
            bool continued = false;
            while (!skipped())
            {
                var state = animator.GetCurrentAnimatorStateInfo(0);
                if (!continued && state.fullPathHash == LoopState
                    && state.normalizedTime * state.length >= Mathf.Max(0f, loopHold))
                {
                    animator.SetTrigger(ContinueTrigger);
                    continued = true;
                }
                if (state.fullPathHash == ExitState && state.normalizedTime >= 1f) break;
                yield return null;
            }
        }
        finally
        {
            gameObject.SetActive(false);
        }
    }
}
