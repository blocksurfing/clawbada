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

    [MenuItem("Clawbada/Build WebGL (web app)")]
    public static void BuildWebGL()
    {
        string buildPath = ArgValue("-buildPath") ?? DefaultBuildPath;
        string fullPath = Path.GetFullPath(Path.Combine(Application.dataPath, "..", buildPath));
        Directory.CreateDirectory(fullPath);

        // Brotli + decompression fallback: works on hosts that don't set Content-Encoding.
        PlayerSettings.WebGL.compressionFormat = WebGLCompressionFormat.Brotli;
        PlayerSettings.WebGL.decompressionFallback = true;
        PlayerSettings.WebGL.dataCaching = true;
        PlayerSettings.WebGL.initialMemorySize = 256;
        PlayerSettings.WebGL.exceptionSupport = WebGLExceptionSupport.ExplicitlyThrownExceptionsOnly;

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
