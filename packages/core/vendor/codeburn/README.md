<!-- SPDX-License-Identifier: MPL-2.0 -->

# Lumi CodeBurn reader embedding

Upstream: https://github.com/getagentseal/codeburn
Pinned version: 0.9.27; commit: `9a40cc603fcd194caca9daa8c5134a61ea7e0e2b`.

`src/`, `tests/`, and `provider-docs/` are verbatim MIT upstream snapshots; their SHA-256 digests are in `snapshot.json`. Preserve `LICENSE` and `THIRD_PARTY_NOTICES.md`. `providers.json` is the complete runtime registry: 42 tools and one aggregate-only gateway.

`entry.ts` exposes only provider discovery and accounting parsers. `scripts/build-codeburn-reader.mjs` generates ignored `reader.cjs`; `reader.d.cts` is Lumi's narrow type boundary. Core builds regenerate the bundle before TypeScript compilation. Production sidecars embed the bundle and its license notices.

Embedding adjustments are documented in `snapshot.json`: Lumi cache namespace; removal of user messages/commands/behavioral data from auxiliary cache serialization; CommonJS/SEA module URL support; upstream serial parsing rather than loose worker files; gateway HTTP failures retain the last good snapshot.

Lumi uses `parseProviderSources` for its provider reconciliation and `parseClaudeFileFull` for Claude's regular transcript directories, matching upstream's separate Claude pipeline. The generic cache is stored in Lumi's database with message/command fields removed; source transcripts remain read-only. Only counters, safe display metadata and hashed identities enter business records. Codex's display-name overlay still reads its optional index and thread-title table independently of token accounting. Explicit `UsageRoot[]` injection keeps the old restricted-root reader for compatibility tests; desktop production defaults to the full registry.

Run `pnpm verify:usage` to reproduce the upstream regressions, complete Lumi checks, local snapshot comparisons and HTML report. Unknown/uninstalled tools receive fixture coverage, not a claim of live verification. Gateway totals are excluded from All because they can overlap local clients; its UTC daily aggregates are not presented as hourly sessions.
