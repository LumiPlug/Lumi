<!-- SPDX-License-Identifier: MPL-2.0 -->
# Terminal run configuration verification

- Reused the editor working-directory composition and parameter-table surface in manual runs and frozen configuration.
- Normal native window: 760 × 680; all five columns and both stage headings visible. Narrow: 560 × 680; directory stacks and table supports horizontal browsing. Tab to the description reveals the right-hand required column; the native automation wheel did not move horizontally, so the right-column capture uses keyboard focus scrolling.
- Internal vertical scrolling reveals remaining parameters while directory remains in place; private values remain masked.
- Blank required NAME: top Toast and NAME value focus. Nonexistent directory: top Toast and cwd focus. Malformed TAGS JSON: top Toast and value focus inside scrolled list.
- Native directory picker selected /tmp, returned /private/tmp and resumed the form.
- Safe example executed successfully: exit code 0, directory and typed array/object defaults preserved. Frozen configuration read-only; adjust-and-run retains inputs.
- Technical info accessible from parameter section heading. Empty terminal More settings layer removed.
- Temporary QA inputs restored; tool definition version and SHA-256 unchanged; no active tasks remain.
- Final application rebuilt and restarted after clean-draft guards. Final native run window left open at default inputs.
- pnpm check: 25 files / 194 tests, typecheck, lint, home contract and Rust checks pass. Frontend and debug macOS application builds pass. git diff --check and Impeccable layout detector pass.

Final evidence: run-final-dark.png, run-final-narrow-dark.png, run-final-narrow-right.png. Before-adjustment captures retained for audit only.
