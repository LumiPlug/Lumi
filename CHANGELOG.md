<!-- SPDX-License-Identifier: MPL-2.0 -->

# Changelog

## 0.1.6 (preview) — 2026-10-20

- Collect Qoder CN JSONL from `~/.qoder-cn/projects` alongside the international source, with isolated request identities and evidence-based copy reconciliation.
- Show actual scan stages and file coverage, preserve bounded reading budgets, and refresh usage after committed results and scan completion.
- Preserve English/Simplified Chinese switching, shared UI components, existing history and explicit partial-coverage feedback.
- Company-machine live collection and native WebView acceptance remain pending; automated fixtures do not establish client-version coverage.

## 0.1.5 (preview) — 2026-10-20

- Add instant English and Simplified Chinese switching in Settings, with persisted preferences and synchronized tool windows.
- Localize application pages, shared components, prompts, validation feedback, accessibility labels, and app-owned native menu text and titles.
- Preserve input, running tasks, and original user content; retain the current language and restore keyboard focus when saving fails.
- Synchronize desktop, Core, shared packages, stdio proxy, SDK, and template versions while keeping homepage format 2 and bridge protocol 1.

## 0.1.4 (preview)

- Add Qoder desktop JSONL token collection with request-level reconciliation and explicit mixed-identity warnings.
- Add grouped native tray navigation, macOS Dock visibility management, and recoverable owned-Core controls with confirmation and authenticated cleanup.
- Keep Qoder company-machine counts and native tray/Dock multi-window behavior explicitly pending real-machine acceptance; publish these limitations with preview assets.

## 0.1.1 — 2026-10-15

- Install local Skill directories into Lumi or import existing Skills from scan results, preserving the original files.
- Browse managed Skills in the new Lumi collection and load their instructions and resources through `Lumi.search_skills`, `Lumi.get_skill`, and `Lumi.read_skill_file`.
- Stop MCP discovery and reads when a managed Skill is archived; restore access when it is restored.
- Restrict installation to the desktop host, reject duplicate overwrites and unsafe package paths, and keep imports bounded and atomic.
- Synchronize desktop, Core, SDK, and workbench template versions at 0.1.1. Skill scripts remain read-only content and are not executed by these interfaces.
