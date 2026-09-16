#!/bin/zsh
# Headless Chrome leaks WebGL contexts across Unity runs — restart before EVERY harness run
# or later runs die with "Cannot read properties of undefined (reading 'GLctx')".
SP="$(cd "$(dirname "$0")" && pwd)"
pkill -f "remote-debugging-port=9222" 2>/dev/null
sleep 1
rm -rf "$SP/chrome-profile"
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --remote-debugging-port=9222 --window-size=1600,1000 \
  --user-data-dir="$SP/chrome-profile" \
  --use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist \
  about:blank > "$SP/chrome.log" 2>&1 &
for i in {1..40}; do
  curl -sf http://127.0.0.1:9222/json/version >/dev/null 2>&1 && { echo "chrome ready"; exit 0; }
  sleep 0.5
done
echo "chrome FAILED to start"; exit 1
