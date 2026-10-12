<!-- SPDX-License-Identifier: MPL-2.0 -->
# Runtime parameter text columns

- Parameter name, description, external visibility and required are plain semantic table cells. Boolean metadata uses 是／否 and stays centered under its header.
- Description wraps and rows align vertically to the value control. Only parameter value cells contain editable shared Input; private values remain masked. Boolean and enum parameter values also use Input and retain schema validation through the unchanged run preparation pipeline.
- Native standard 760 × 680 and narrow 560 × 680 reviewed in one batch. Shared Card surface and bounded internal scroll preserved. Both configuration and execution stages remain visible. Ten editable parameter values in AX; no checkbox or switch in the run table.
- Tool editor unchanged; saved definition version/hash unchanged. No QA input changes or task executions in this refinement.
- Rebuilt and safely restarted after unchanged-input and clean-root guards; standard run window left open with defaults.
- pnpm check: 25 files / 194 tests passed, along with typecheck, lint, home contract, Rust formatting/check/clippy. Frontend and native debug app builds passed. git diff --check and Impeccable layout scan clean.

Evidence: run-text-dark.png, run-text-narrow-dark.png.
