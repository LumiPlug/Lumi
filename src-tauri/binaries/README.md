<!-- SPDX-License-Identifier: MPL-2.0 -->

# Sidecar staging

`pnpm build:sidecars` creates native Node 26 single executable applications for
Core and the stdio proxy, named for the current target triple. Windows outputs
use `.exe`, and macOS outputs receive ad-hoc signatures. The runtime and bundled
JavaScript dependencies are included. Generated binaries are ignored by Git.

`pnpm build:sidecars:dev` uses local launchers on Unix and native SEA on Windows.
Run `pnpm verify:sidecars` to test production binaries with empty PATH and a
temporary data directory. See [desktop builds](../../docs/DESKTOP_BUILDS.md).
