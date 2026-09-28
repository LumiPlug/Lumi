<!-- SPDX-License-Identifier: MPL-2.0 -->

# Sidecar staging

`pnpm build:sidecars` builds the Node Core and stdio proxy, then creates the
current host target-triple launchers in this directory for Tauri development.
The launchers intentionally use the installed Node runtime. M10 will replace
them with self-contained, signed binaries for each release target.
