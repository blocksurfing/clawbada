using UnityEngine;
using UnityEngine.SceneManagement;

/// <summary>Scene-owned death visual. Spawn/idle are authored Animator states;
/// unlike other death effects it survives the corpse and the results screen.</summary>
public sealed class PersistentDeathGhost : MonoBehaviour
{
    public static void ClearForScene(Scene scene)
    {
        foreach (var ghost in Object.FindObjectsByType<PersistentDeathGhost>(FindObjectsInactive.Include, FindObjectsSortMode.None))
        {
            if (ghost.gameObject.scene != scene) continue;
            if (Application.isPlaying) Object.Destroy(ghost.gameObject);
            else Object.DestroyImmediate(ghost.gameObject);
        }
    }
}
