<!-- SPDX-License-Identifier: MPL-2.0 -->

---
name: Obsidian & Solar Amber
colors:
  surface: '#131316'
  surface-dim: '#131316'
  surface-bright: '#39393c'
  surface-container-lowest: '#0e0e11'
  surface-container-low: '#1b1b1e'
  surface-container: '#1f1f22'
  surface-container-high: '#2a2a2d'
  surface-container-highest: '#353438'
  on-surface: '#e4e1e6'
  on-surface-variant: '#d8c3ad'
  inverse-surface: '#e4e1e6'
  inverse-on-surface: '#303033'
  outline: '#a08e7a'
  outline-variant: '#534434'
  surface-tint: '#ffb95f'
  primary: '#ffc174'
  on-primary: '#472a00'
  primary-container: '#f59e0b'
  on-primary-container: '#613b00'
  inverse-primary: '#855300'
  secondary: '#4edea3'
  on-secondary: '#003824'
  secondary-container: '#00a572'
  on-secondary-container: '#00311f'
  tertiary: '#8ed5ff'
  on-tertiary: '#00354a'
  tertiary-container: '#38bdf8'
  on-tertiary-container: '#004965'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#ffddb8'
  primary-fixed-dim: '#ffb95f'
  on-primary-fixed: '#2a1700'
  on-primary-fixed-variant: '#653e00'
  secondary-fixed: '#6ffbbe'
  secondary-fixed-dim: '#4edea3'
  on-secondary-fixed: '#002113'
  on-secondary-fixed-variant: '#005236'
  tertiary-fixed: '#c4e7ff'
  tertiary-fixed-dim: '#7bd0ff'
  on-tertiary-fixed: '#001e2c'
  on-tertiary-fixed-variant: '#004c69'
  background: '#131316'
  on-background: '#e4e1e6'
  surface-variant: '#353438'
typography:
  display:
    fontFamily: Geist
    fontSize: 32px
    fontWeight: '600'
    lineHeight: 40px
    letterSpacing: -0.025em
  headline-lg:
    fontFamily: Geist
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Geist
    fontSize: 18px
    fontWeight: '600'
    lineHeight: 24px
    letterSpacing: -0.015em
  headline-sm:
    fontFamily: Geist
    fontSize: 15px
    fontWeight: '600'
    lineHeight: 20px
    letterSpacing: -0.01em
  body-lg:
    fontFamily: Geist
    fontSize: 15px
    fontWeight: '400'
    lineHeight: 22px
    letterSpacing: -0.005em
  body-md:
    fontFamily: Geist
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 18px
    letterSpacing: 0em
  body-sm:
    fontFamily: Geist
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16px
    letterSpacing: 0em
  mono-lg:
    fontFamily: JetBrains Mono
    fontSize: 13px
    fontWeight: '500'
    lineHeight: 18px
    letterSpacing: -0.01em
  mono-md:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16px
    letterSpacing: 0em
  mono-sm:
    fontFamily: JetBrains Mono
    fontSize: 11px
    fontWeight: '400'
    lineHeight: 14px
    letterSpacing: 0.02em
  label-md:
    fontFamily: Geist
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
    letterSpacing: 0.01em
  label-sm:
    fontFamily: JetBrains Mono
    fontSize: 10px
    fontWeight: '600'
    lineHeight: 12px
    letterSpacing: 0.04em
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  gutter: 0.75rem
  gutter-mobile: 0.5rem
  margin: 1rem
  margin-mobile: 0.75rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 0.75rem
  space-lg: 1rem
  space-xl: 1.5rem
---

## Brand & Style

This design system embodies the focus, precision, and low-latency tactility of elite developer environments. Drawing direct influence from productivity powerhouses like Raycast, modern AI-native IDEs, and premium hardware calibration suites, it treats software as a precision instrument rather than a casual destination.

### Aesthetic Foundation
- **Obsidian Density:** Grounded in deep charcoal blacks and tiered graphite surfaces, the interface eliminates cognitive glare and visual fatigue during protracted deep-work sessions.
- **Solar Energy Accents:** Restrained strikes of radiant amber, sunburst transitions, and subtle incandescent glows cut through the matte structure. These accents designate active execution states, high-priority diffs, and focal entry points without overwhelming ambient space.
- **Instrument Precision:** Crisp 1px geometric delineations, razor-sharp alignment boundaries, micro-status telemetry badges, and monospaced diagnostic elements lend an architectural discipline to every panel and input bar.
- **Tactile Utility:** Micro-interactions reflect physical microswitches: snappy 120ms transitions, subtle inner-specular highlight ridges, and disciplined backdrop blurs that establish immediate command hierarchy.

## Colors

The system uses a strictly orchestrated dark palette engineered for maximum information density, low optical fatigue, and clear semantic priority.

### Surface System
- **Canvas Base (`#0E0E11`):** The primary void. Used for outer window canvases, command backdrop voids, and full-bleed utility backgrounds.
- **Surface Tier 1 (`#16161B`):** Docked sidebars, terminal utility panels, structural toolbars.
- **Surface Tier 2 (`#1C1C23`):** Canvas containers, command bar modal bodies, inactive input wells.
- **Surface Tier 3 / Cards (`#1E1E26`):** Floating overlay panels, elevated popovers, inspection cards, active tabs.
- **Surface Tier 4 (`#24242D`):** Active row hover fills, dropdown menus, focused input surfaces.

### Border & Division Lines
- **Subtle Outline (`#2C2C37`):** Standard structural border separating panes, dividers, and card outlines.
- **Strong / Active Outline (`#373746`):** Focused states, elevated modal perimeters, and active container splits.

### Functional Accents
- **Primary / Solar Amber (`#F59E0B`):** Active command selection, system prompts, key focus states. Glow transitions subtly pass through Warm Orange (`#FB923C`) into Sunburst Rose (`#F43F5E`) on dynamic runtime events.
- **Active Fill Highlight (`rgba(245, 158, 11, 0.12)` to `rgba(245, 158, 11, 0.18)`): Backing fill for selected command list items and active menu nodes.
- **Daemon / Operational Emerald (`#10B981`):** Live connections, healthy daemons, local runtime heartbeats.
- **CLI / Protocol Sky (`#38BDF8` with `#64748B` neutral pairing):** Endpoint markers, port indicators, parameter tags, and protocol chips.
- **Text & Glyph Hierarchy:** High-contrast pure zinc (`#F8FAFC`) for primaries, muted slate (`#94A3B8`) for labels and descriptions, and dark graphite slate (`#64748B`) for disabled states, hotkey hints, and telemetry metadata.

## Typography

The typographic hierarchy relies on a strict bifurcation between systematic interface UI and dense technical telemetry.

- **Geist** drives all natural language interactions: navigational nodes, modal titles, menu selections, and general documentation. It delivers razor-sharp legibility at micro-scales while remaining completely neutral.
- **JetBrains Mono** is reserved for computational artifacts: CLI commands, hotkeys, status tags, memory addresses, port bindings, git hashes, and inline code strings.

### Typographic Discipline
- **Tabular Figures:** Always apply tabular figure styling (`tnum`) to monospaced numbers and telemetry gauges to prevent visual jitter during real-time data streaming.
- **Vertical Alignment:** Ensure badges, hotkey boxes (`Kbd`), and micro-tags share an aligned baseline with accompanying natural language strings.
- **Dense Proportions:** Line heights are calibrated tight (1.25x - 1.4x) to maintain dense command paletting and vertical scannability without visual clipping.

## Layout & Spacing

Layouts conform to a compact, dockable modular frame rather than expansive marketing-style layouts. Interfaces prioritize immediate tool accessibility and high density.

### Spacing Philosophy
- **Base 4px Unit Grid:** All gaps, internal padding, row heights, and layout splits derive strictly from multiples of 4px (`0.25rem`).
- **Dense Ergonomics:** Row heights in command palettes and tree views lock to standard increments: `28px` (compact item), `36px` (standard command entry), and `44px` (master action input).
- **Docked Canvas Architecture:** Multi-pane IDE layouts use zero-margin border-docking: panels meet at a clean 1px hairline (`#2C2C37`), eliminating redundant nested canvas margins. Floating palettes (e.g., Raycast-style command bars) sit centered at 640px to 720px fixed widths with dynamic vertical expansion capped at 60vh.

## Elevation & Depth

Visual hierarchy is maintained through disciplined surface tiering, subtle optical backdrops, and laser-precise specular borders rather than diffuse, muddy drop shadows.

### Elevation Architecture
- **Level 0 (Base Canvas):** Background `#0E0E11`. Completely flat with zero elevation.
- **Level 1 (Docked Panels):** Surface `#16161B` or `#1C1C23`. Delineated via 1px outer borders (`#2C2C37`) without shadows.
- **Level 2 (Cards & Tooltips):** Surface `#1E1E26`. Outlined with `#2C2C37` and illuminated by a crisp, deep shadow: `0 4px 16px -2px rgba(0, 0, 0, 0.60)`.
- **Level 3 (Modal Command Bars & Floating Overlays):** Surface `#1C1C23` with 94% opacity backed by an ultra-dense backdrop blur (`backdrop-filter: blur(16px)`). Bound by an outer rim of `#373746` and an elevated drop shadow: `0 24px 48px -8px rgba(0, 0, 0, 0.85), 0 0 1px 1px rgba(255, 255, 255, 0.05) inset`.

### Amber Luminescence
For active runtimes, critical focus items, or active palette selections:
- Specular Top Rim: A hairline highlight `inset 0 1px 0 0 rgba(245, 158, 11, 0.25)` gives the component an extruded, physical presence.
- Ambient Solar Bloom: Used sparingly for high-impact notifications or active agents: `0 0 24px -4px rgba(245, 158, 11, 0.15)`.

## Shapes

The design language uses a controlled, structural radius profile (Soft - Level 1) that communicates precision tooling and computational hardware aesthetics.

### Corner Radii Guidelines
- **Micro UI (`2px`):** Status indicator dots, code line highlight markers, slider thumbs, scrollbar tracks.
- **Components (`4px` / `0.25rem`):** Buttons, chips, text inputs, kbd badges, dropdown list items.
- **Containers & Popovers (`8px` / `0.5rem`):** Modal command bars, flyout menus, diagnostic cards, code inspector panes.
- **Panels & Viewports (`12px` / `0.75rem`):** Outer desktop application window frames.

## Components

### Buttons
- **Primary Action:** Background `#F59E0B`, text `#0E0E11` (`font-weight: 600`), hover background `#FB923C`, active scale `0.985`. Box-shadow: `0 1px 2px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.2)`.
- **Secondary (Obsidian Tool):** Background `#1E1E26`, border `1px solid #2C2C37`, text `#F8FAFC`. Hover brings border to `#373746` and background to `#24242D`.
- **Ghost / Utility:** Transparent fill, text `#94A3B8`, hover fill `rgba(255, 255, 255, 0.04)`, hover text `#F8FAFC`.

### Command Palette Item (Raycast Pattern)
- Fixed height of 36px, internal padding `0 10px`, border radius `4px`.
- **Resting:** Transparent background, primary icon `#94A3B8`, label `#F8FAFC`, right-aligned hotkey hints `#64748B`.
- **Selected:** Background `rgba(245, 158, 11, 0.12)`, border-left `2px solid #F59E0B`, label `#FFFFFF`, primary icon `#F59E0B`, hotkey tags bordered in `#373746`.

### Inputs & Command Bars
- **Main Search Bar:** Height 48px, background transparent or `#16161B`, text `#F8FAFC` (`font-size: 16px`), placeholder `#64748B`. Zero outer border; relies on the container's perimeter outline.
- **Form Inputs:** Height 32px, background `#16161B`, border `1px solid #2C2C37`, text `#F8FAFC`. Focused state triggers border `#F59E0B` with an ambient glow: `0 0 0 1px #F59E0B, 0 0 8px rgba(245, 158, 11, 0.20)`.

### Badges, Status Chips & Keyboard Hints
- **Keyboard Shortcuts (`<kbd>`):** Background `#16161B`, border `1px solid #2C2C37`, border-bottom `2px solid #24242D`, text `#94A3B8`, font family JetBrains Mono, padding `1px 5px`, font size 10px.
- **Daemon / Status Node:** Flex alignment with a 6px circular indicator. Active uses `#10B981` with pulse `rgba(16, 185, 129, 0.3)`. Memory/Review uses `#F59E0B`. CLI/Target uses `#38BDF8`.
- **Protocol Tags:** Background `#16161B`, border `1px solid #2C2C37`, monospaced text colored dynamically based on context (e.g., `#38BDF8` for GET/REST, `#10B981` for WebSocket).

### Checkboxes & Segmented Toggles
- **Checkbox:** 14px square, radius 3px, border `1px solid #373746`, background `#16161B`. Checked state transitions to `#F59E0B` fill with `#0E0E11` check glyph.
- **Segmented Control:** Enclosed in `#16161B` with 1px border `#2C2C37`. Active item sits on `#24242D` with top specular highlight and text `#F8FAFC`.
