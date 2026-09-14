using System;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEditor.Build.Reporting;
using UnityEngine;

/// <summary>
/// Headless WebGL build for the web app:
///
///   Unity -batchmode -nographics -quit -projectPath packages/battle-engine/ClawbadaBattle \
///         -executeMethod BuildScript.BuildWebGL [-buildPath ../../../apps/web/public/unity-build] -logFile build.log
///
/// Unity names the artifacts after the output folder. With the decompression fallback on,
/// compressed files carry the .unityweb suffix (the loader inflates them itself, so the host
/// needs no Content-Encoding header), so the web app loads
///   /unity-build/Build/unity-build.loader.js, .data.unityweb, .framework.js.unityweb, .wasm.unityweb
/// The folder is gitignored; build locally and deploy with the Vercel CLI.
/// </summary>
public static class BuildScript
{
    // Relative to the project folder (ClawbadaBattle) → battle-engine → packages → repo root.
    private const string DefaultBuildPath = "../../../apps/web/public/unity-build";
    private const string Scene = "Assets/Scenes/BattleScene.unity";
    private const string PlaceholderMarker = "PLACEHOLDER_AUDIO.txt";

    [MenuItem("Clawbada/Build WebGL (web app)")]
    public static void BuildWebGL()
    {
        string buildPath = ArgValue("-buildPath") ?? DefaultBuildPath;
        string fullPath = Path.GetFullPath(Path.Combine(Application.dataPath, "..", buildPath));
        Directory.CreateDirectory(fullPath);
        string[] placeholders = RefuseUnlicensedPlaceholders();
        // A -allowPlaceholderAudio build leaves a marker beside the bundle so the deploy wrapper
        // (scripts/deploy-web.sh) refuses to ship it; a clean build removes the marker again.
        string marker = Path.Combine(fullPath, PlaceholderMarker);
        if (placeholders.Length > 0)
            File.WriteAllText(marker, "LOCAL TEST BUILD — contains unlicensed placeholder audio. Do NOT deploy.\n" +
                                      "Rebuild without -allowPlaceholderAudio first.\n" + string.Join("\n", placeholders) + "\n");
        else if (File.Exists(marker))
            File.Delete(marker);

        // Brotli + decompression fallback: works on hosts that don't set Content-Encoding.
        PlayerSettings.WebGL.compressionFormat = WebGLCompressionFormat.Brotli;
        PlayerSettings.WebGL.decompressionFallback = true;
        PlayerSettings.WebGL.dataCaching = true;
        PlayerSettings.WebGL.initialMemorySize = 256;
        // Full exceptions (no stack traces): a NullReference inside a HUD/animation callback must
        // surface in the browser console instead of silently killing the WebGL runtime.
        PlayerSettings.WebGL.exceptionSupport = WebGLExceptionSupport.FullWithoutStacktrace;

        var options = new BuildPlayerOptions
        {
            scenes = new[] { Scene },
            locationPathName = fullPath,
            target = BuildTarget.WebGL,
            options = BuildOptions.None,
        };

        Debug.Log($"[BuildScript] Building WebGL → {fullPath}");
        BuildReport report = BuildPipeline.BuildPlayer(options);
        var summary = report.summary;
        Debug.Log($"[BuildScript] {summary.result} in {summary.totalTime.TotalSeconds:F0}s, {summary.totalSize / (1024 * 1024)} MB, errors={summary.totalErrors}");
        if (summary.result != BuildResult.Succeeded)
        {
            throw new Exception($"WebGL build failed: {summary.result} ({summary.totalErrors} errors)");
        }
    }

    /// <summary>
    /// Placeholder audio (Assets/Audio/**/Resources/Placeholders/) is unlicensed material for local
    /// auditioning. It is gitignored, but a Resources folder is always compiled into the bundle —
    /// so without this guard it would ride the next `vercel deploy --prod` onto a public site.
    /// A local test build passes -allowPlaceholderAudio explicitly; a production build never does.
    /// </summary>
    private static string[] RefuseUnlicensedPlaceholders()
    {
        string audioRoot = Path.Combine(Application.dataPath, "Audio");
        if (!Directory.Exists(audioRoot)) return Array.Empty<string>();
        var found = Directory.GetDirectories(audioRoot, "Placeholders", SearchOption.AllDirectories)
            .SelectMany(d => Directory.GetFiles(d, "*.*", SearchOption.AllDirectories))
            .Where(f => !f.EndsWith(".meta", StringComparison.OrdinalIgnoreCase))
            .Select(f => f.Substring(Application.dataPath.Length - "Assets".Length))
            .ToArray();
        if (found.Length == 0) return found;

        bool allowed = Array.Exists(Environment.GetCommandLineArgs(),
            a => string.Equals(a, "-allowPlaceholderAudio", StringComparison.OrdinalIgnoreCase));
        string list = string.Join("\n  ", found);
        if (!allowed)
            throw new Exception($"[BuildScript] REFUSING to build: {found.Length} unlicensed PLACEHOLDER audio file(s) would ship:\n  {list}\n" +
                                "Remove them, or pass -allowPlaceholderAudio for a LOCAL test build that must not be deployed.");
        Debug.LogWarning($"[BuildScript] -allowPlaceholderAudio: building WITH {found.Length} unlicensed placeholder(s) — LOCAL TEST ONLY, do not deploy:\n  {list}");
        return found;
    }

    private static string ArgValue(string flag)
    {
        var args = Environment.GetCommandLineArgs();
        for (int i = 0; i < args.Length - 1; i++)
        {
            if (string.Equals(args[i], flag, StringComparison.OrdinalIgnoreCase)) return args[i + 1];
        }
        return null;
    }
}
