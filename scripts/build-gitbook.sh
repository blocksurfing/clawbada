#!/usr/bin/env bash
# Rebuild the Clawbada book from docs/gitbook/*.md (order = SUMMARY.md):
#   docs/gitbook/gitbook-combined.md   clean single-file Markdown (GitHub renders it)
#   docs/Clawbada-Gitbook.html         one self-contained page in Nzib's Market look (fonts + art embedded)
#   docs/Clawbada-Gitbook.pdf          the page printed by headless Chrome (A4, wooden frame on every page)
#
# Usage: bash scripts/build-gitbook.sh          (SKIP_PDF=1 for the HTML only; BOOK_DATE="October 2026" to pin the cover date)
# Requires: pandoc, bun (~/.bun/bin), Google Chrome (CHROME_BIN overrides the path). No LaTeX any more.
#
# The look is scripts/gitbook/book.css + template.html; the renderer is scripts/gitbook/build.ts. Art and type
# tokens are read from apps/web (ui/tileset, ui/market, ui/shell, ui/sidebar, src/fonts/upheaval), so the book
# follows the website. Typecheck the renderer with: bunx tsc -p scripts/gitbook/tsconfig.json

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
export PATH="$HOME/.bun/bin:$PATH"

for tool in pandoc bun; do
  command -v "$tool" >/dev/null 2>&1 || { echo "!! $tool is not installed" >&2; exit 1; }
done

cd "$REPO_ROOT"
bun scripts/gitbook/build.ts
echo ">> Done."
