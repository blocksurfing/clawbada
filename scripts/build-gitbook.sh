#!/usr/bin/env bash
# Rebuild docs/gitbook/gitbook-combined.md from the individual section files,
# then regenerate docs/Clawbada-Gitbook.pdf via pandoc + xelatex.
#
# Usage: bash scripts/build-gitbook.sh
# Requires: pandoc, xelatex (from MacTeX).
#
# Section order matches docs/gitbook/SUMMARY.md. During concat we:
#   - Escape literal "$" to "\$" so pandoc's tex_math_dollars doesn't treat
#     $CLAW etc. as inline math mode.
#   - Replace "→" with "$\to$" because Helvetica Neue's xelatex mapping doesn't
#     ship a glyph for U+2192; LaTeX math mode has one built in.
#
# The pandoc YAML frontmatter is preserved from the current gitbook-combined.md,
# so edit that block in place when you need to change title-page settings,
# fonts, or header-includes. We use pandoc's default template (not Eisvogel) so
# no LaTeX template install is required — the Eisvogel-specific keys in the
# YAML (titlepage-color, titlepage-rule-*) are silently ignored.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
GITBOOK_DIR="$REPO_ROOT/docs/gitbook"
DOCS_DIR="$REPO_ROOT/docs"
OUT_MD="$GITBOOK_DIR/gitbook-combined.md"
OUT_PDF="$DOCS_DIR/Clawbada-Gitbook.pdf"

SECTIONS=(
  README.md
  getting-started.md
  lobsters.md
  mining.md
  battle.md
  breeding.md
  evolution.md
  marketplace.md
  tokenomics.md
  agents.md
)

cd "$GITBOOK_DIR"

# --- Step 1: rebuild the combined markdown file ---
echo ">> Rebuilding $OUT_MD"
TMP_OUT="${OUT_MD}.tmp"

# Preserve the existing pandoc YAML frontmatter (everything up to and including the second '---').
awk '/^---$/{c++} {print} c==2{exit}' "$OUT_MD" > "$TMP_OUT"
echo "" >> "$TMP_OUT"

# Concatenate each section with a \newpage separator. Two sed passes per file:
#   1. $ -> \$  (escape literal dollars)
#   2. → -> $\to$  (swap to LaTeX math arrow; safe after step 1 since the new $s are intended)
for section in "${SECTIONS[@]}"; do
  if [[ ! -f "$section" ]]; then
    echo "!! Missing section file: $section" >&2
    exit 1
  fi
  printf '\\newpage\n\n' >> "$TMP_OUT"
  sed -e 's/\$/\\$/g' -e 's/→/$\\to$/g' "$section" >> "$TMP_OUT"
  echo "" >> "$TMP_OUT"
done

mv "$TMP_OUT" "$OUT_MD"
echo "   Combined markdown written: $(wc -l < "$OUT_MD") lines"

# --- Step 2: regenerate the PDF ---
echo ">> Rebuilding $OUT_PDF"
pandoc "$OUT_MD" \
  --pdf-engine=xelatex \
  -o "$OUT_PDF"

echo "   PDF written: $(ls -lh "$OUT_PDF" | awk '{print $5, $NF}')"
echo ">> Done."
