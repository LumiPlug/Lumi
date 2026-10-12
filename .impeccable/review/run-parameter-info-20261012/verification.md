<!-- SPDX-License-Identifier: MPL-2.0 -->
# Runtime parameter information and value layout

- Left: actual parameter name with associated input label, shared Badge for visibility and requirement; right: shared editable Input. Nonempty description uses existing shared Tooltip.
- Normal native 760 × 680 and narrow 560 × 680 reviewed; left information and right inputs remain legible with both stage nodes visible. 288px Card viewport remains bounded. Long names/tags can wrap; content below 420px stacks the value after metadata.
- Tooltip hovered without clicking via pointer drag from blank row space to icon, and also checked by icon click. Full description visible in portal; Escape closes bubble while keeping native run window open.
- Clicking NAME label focuses its value; empty required submit focuses the same value and shows top Toast. No QA value changes or execution tasks created.
- One correction batch restored shared ui-field-row-viewport keyboard focus styling; final standard and narrow confirmation passed, including shared amber viewport outline.
- Tool definition version/SHA unchanged. Restarted only after unchanged run values and clean root guards. Native run window restored to standard size, blank NAME value focused, default inputs retained.
- pnpm check passes: 25 test files / 194 tests, typecheck, lint, home contract, Rust format/check/clippy. Frontend and native app builds pass. Impeccable layout scan and git diff --check clean.

Evidence: run-info-tooltip-dark.png, run-info-narrow-dark.png, run-info-focus-dark.png. Initial nonfocused standard capture run-info-dark.png is visually equivalent to final.
