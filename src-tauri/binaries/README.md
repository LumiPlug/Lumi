<!-- SPDX-License-Identifier: MPL-2.0 -->

# Sidecar staging

`pnpm build:sidecars` builds the Node Core and stdio proxy, then creates the
current host target-triple launchers in this directory for Tauri development.
The launchers use absolute paths to the current project's Node runtime and
built entry files. Regenerate them after moving the project. M10 will replace
them with self-contained, signed binaries for each release target.
