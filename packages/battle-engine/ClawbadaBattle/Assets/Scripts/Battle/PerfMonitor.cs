using System.Collections.Generic;
using System.Globalization;
using System.Text;
using UnityEngine;

/// <summary>
/// Frame-time recorder for the smoothness campaign (2026-10-29). Off unless the page asks for it (BattleBridge.SetPerf,
/// sent by the web only with ?perf=1): players never pay for it. While on, every frame's unscaled delta goes into a
/// preallocated buffer (no allocation per frame) and named marks split the run into segments — "turn:12:special:Tempest",
/// "idle", … — so a probe can read p50/p95/p99, the worst frame, hitch counts and GC collections per turn and per Special.
/// The report is one JSON string, built only when asked (BattleBridge.RequestPerf → SendPerfReport).
/// </summary>
public class PerfMonitor : MonoBehaviour
{
    public static PerfMonitor Instance { get; private set; }
    public static bool Enabled => Instance != null && Instance.recording;

    private const int Capacity = 60 * 60 * 15;   // 15 minutes at 60 fps
    private const int MarkCapacity = 4096;

    private readonly float[] frameMs = new float[Capacity];
    private readonly int[] gcAt = new int[Capacity];
    private int count;
    private bool recording;
    private int gcBase;

    private struct Mark { public int frame; public string label; }
    private readonly List<Mark> marks = new List<Mark>(MarkCapacity);

    public static void Ensure()
    {
        if (Instance != null) return;
        var go = new GameObject("PerfMonitor");
        DontDestroyOnLoad(go);
        Instance = go.AddComponent<PerfMonitor>();
    }

    /// <summary>Start (or restart) recording from zero.</summary>
    public void Begin()
    {
        count = 0;
        marks.Clear();
        gcBase = System.GC.CollectionCount(0);
        recording = true;
        AddMark("start");
    }

    public void End() { recording = false; }

    /// <summary>Split the recording here. A no-op (and allocation-free) when recording is off.</summary>
    public static void MarkSegment(string label)
    {
        if (Instance != null && Instance.recording) Instance.AddMark(label);
    }

    private void AddMark(string label)
    {
        if (marks.Count >= MarkCapacity) return;
        marks.Add(new Mark { frame = count, label = label });
    }

    private void Update()
    {
        if (!recording || count >= Capacity) return;
        frameMs[count] = Time.unscaledDeltaTime * 1000f;
        gcAt[count] = System.GC.CollectionCount(0) - gcBase;
        count++;
    }

    /// <summary>The summary as JSON: overall stats, then one entry per segment (between consecutive marks).</summary>
    public string Report()
    {
        var sb = new StringBuilder(8192);
        var inv = CultureInfo.InvariantCulture;
        sb.Append("{\"frames\":").Append(count);
        sb.Append(",\"recording\":").Append(recording ? "true" : "false");
        sb.Append(",\"heapBytes\":").Append(System.GC.GetTotalMemory(false));
        sb.Append(",\"screen\":\"").Append(Screen.width).Append('x').Append(Screen.height).Append('"');
        sb.Append(",\"all\":");
        AppendStats(sb, 0, count, inv);
        sb.Append(",\"segments\":[");
        for (int i = 0; i < marks.Count; i++)
        {
            int from = marks[i].frame, to = i + 1 < marks.Count ? marks[i + 1].frame : count;
            if (i > 0) sb.Append(',');
            sb.Append("{\"label\":\"").Append(marks[i].label.Replace("\"", "'")).Append("\",\"stats\":");
            AppendStats(sb, from, to, inv);
            sb.Append('}');
        }
        sb.Append("]}");
        return sb.ToString();
    }

    private void AppendStats(StringBuilder sb, int from, int to, CultureInfo inv)
    {
        int n = Mathf.Max(0, to - from);
        if (n == 0) { sb.Append("{\"n\":0}"); return; }
        var sorted = new float[n];
        System.Array.Copy(frameMs, from, sorted, 0, n);
        System.Array.Sort(sorted);
        float sum = 0f; int h25 = 0, h50 = 0, h100 = 0;
        for (int i = 0; i < n; i++)
        {
            float v = sorted[i]; sum += v;
            if (v > 25f) h25++;
            if (v > 50f) h50++;
            if (v > 100f) h100++;
        }
        float P(float q) => sorted[Mathf.Clamp(Mathf.CeilToInt(q * n) - 1, 0, n - 1)];
        int gc = gcAt[to - 1] - (from > 0 ? gcAt[from - 1] : 0);
        sb.Append("{\"n\":").Append(n)
          .Append(",\"ms\":").Append(sum.ToString("0", inv))
          .Append(",\"mean\":").Append((sum / n).ToString("0.00", inv))
          .Append(",\"p50\":").Append(P(0.50f).ToString("0.00", inv))
          .Append(",\"p95\":").Append(P(0.95f).ToString("0.00", inv))
          .Append(",\"p99\":").Append(P(0.99f).ToString("0.00", inv))
          .Append(",\"max\":").Append(sorted[n - 1].ToString("0.00", inv))
          .Append(",\"over25\":").Append(h25)
          .Append(",\"over50\":").Append(h50)
          .Append(",\"over100\":").Append(h100)
          .Append(",\"gc\":").Append(gc)
          .Append('}');
    }
}
