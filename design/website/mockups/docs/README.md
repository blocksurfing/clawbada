# Clawbada docs — local redesign source

Captured from https://docs.clawbada.com. See `manifest.json` for capture time, source hash and coverage.

- `index.html`: editable local working copy; currently identical to live HTML. Open directly in a browser. This is the docs mockup starting point, not a new design.
- `snapshot/index.html`: untouched original response; preserve as the baseline.
- `content.html`: full main content with original markup, tables and anchors.
- `content.md`: Markdown conversion for copy editing; HTML is authoritative for layout and fidelity.
- `outline.json`: ordered headings and original anchor IDs.
- `manifest.json`: inventory and provenance.

The live document is one self-contained HTML page with ten chapters. Images/fonts/styles are embedded; no external runtime assets are required. External outbound links remain unchanged. No game rules or wording were deliberately changed, and nothing was published. The existing game workbench/router is unchanged.

Redesign `index.html` or derive new components from `content.html`; do not edit the snapshot. Validate tables, headings, IDs and text against the snapshot after redesign.
