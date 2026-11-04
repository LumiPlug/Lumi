<!-- SPDX-License-Identifier: MPL-2.0 -->

# Browser 0.1.8 release validation — 2026-11-05

This release pairs Lumi 0.1.8 with LumiBrowserMCP 0.6.0 and exposes 39 tools.

The exact staged source was exported separately for verification because the
working directory also contains unrelated in-progress UI/storage/skills changes.
Those changes are not included in this release. All code changes and commits
were made on the existing working branches.

- Home contract check, TypeScript, ESLint: passed.
- Vitest: 64 files, 506 tests passed, including actual encrypted loopback MCP
  integration, common-tool schemas and file/artifact validation.
- Rust fmt, check and clippy with warnings denied: passed after staging the
  development sidecar launchers required by Tauri.
- Extension: static checks, 130 Node tests and deterministic ZIP build passed.
- Real Chrome + Lumi MCP local fixtures: common controls; cross-origin iframe;
  open and closed Shadow DOM through DOM/AX references; file selection;
  direct and page-triggered downloads; table extraction; full/element PNG and
  PDF saved by Core; console/network diagnostics and credential redaction;
  confirm read/dismiss; new-tab association/close; drag, touch, viewport and
  network emulation/reset.

The first full workspace test encountered an unrelated usage UI assertion.
The isolated release test first encountered the running development Core's
reserved browser port; stopping that process allowed the integration test to
pass. No product policy or tests were weakened to bypass these failures.

Browser evidence used only local fixtures and test files, without submitting
external business forms. Cross-platform browser UI, multi-monitor scaling,
Chrome Web Store publishing and every site's framework compatibility are not
claimed. GitHub CI/build outcomes belong to the final release commits, not
older passing builds. Details and action limitations are in BROWSER_USER.md
and the extension repository's docs/TEST_REPORT.md.
