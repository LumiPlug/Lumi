<!-- SPDX-License-Identifier: MPL-2.0 -->

# Changelog

## 0.1.1 — 2026-10-15

- Install local Skill directories into Lumi or import existing Skills from scan results, preserving the original files.
- Browse managed Skills in the new Lumi collection and load their instructions and resources through `Lumi.search_skills`, `Lumi.get_skill`, and `Lumi.read_skill_file`.
- Stop MCP discovery and reads when a managed Skill is archived; restore access when it is restored.
- Restrict installation to the desktop host, reject duplicate overwrites and unsafe package paths, and keep imports bounded and atomic.
- Synchronize desktop, Core, SDK, and workbench template versions at 0.1.1. Skill scripts remain read-only content and are not executed by these interfaces.
