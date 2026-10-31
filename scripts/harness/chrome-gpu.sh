#!/bin/zsh
# Headless Chrome on the REAL GPU (Metal through ANGLE) on :9222 — for timing and smoothness measurements.
# chrome-restart.sh uses SwiftShader (software WebGL), which is fine for correctness probes but inflates every frame
# time; perf-battle.ts and frame-gap checks need this one. Fresh profile each run. WINDOW=1280,720 for clip-battle.ts
# (fullscreen in headless Chrome takes the window size, not the emulated viewport).
SP="$(cd "$(dirname "$0")" && pwd)"
pkill -f "remote-debugging-port=9222" 2>/dev/null
sleep 1
rm -rf "$SP/chrome-gpu-profile"
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --remote-debugging-port=9222 --window-size=${WINDOW:-1600,1000} \
  --user-data-dir="$SP/chrome-gpu-profile" \
  --use-angle=metal --enable-gpu-rasterization --ignore-gpu-blocklist \
  about:blank > "$SP/chrome-gpu.log" 2>&1 &
for i in {1..40}; do
  curl -sf http://127.0.0.1:9222/json/version >/dev/null 2>&1 && { echo "chrome (gpu) ready"; exit 0; }
  sleep 0.5
done
echo "chrome FAILED to start"; exit 1
