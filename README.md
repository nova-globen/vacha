# Nova Globen Vacha

Vacha (VA-cha): Avestan for 'word'. Nova Globen: did a bit.

A fast, editor-only text and code editor for Windows, built by
[Nova Globen AB](https://nova-globen.se) on a heavily trimmed
[Code - OSS](https://github.com/microsoft/vscode) fork.

Vacha opens a file the way Notepad does and edits it the way a code editor
does. Measured on a desktop PC (Ryzen 9 9950X3D, Windows 11 x64), it starts
in about 0.7 s, and once Vacha is running a file opens in about 0.14 s
(medians of 5 runs on 2026-10-23; method under [Measuring startup](#measuring-startup)).

Version 1.1.2 · Windows x64 · called Tond up to 1.0.0

**Website:** <https://nova-globen.se/products/vacha> · **Issues:**
<https://nova-globen.se/products/vacha/issues>

## Install

From the **Microsoft Store**: <https://apps.microsoft.com/detail/9NSCM5WH4WF1>
(signed by Microsoft; the Store keeps it up to date).

Or download the latest release (Windows 10/11, x64) from GitHub:

- Installer: <https://github.com/nova-globen/vacha/releases/latest/download/vacha-setup-x64.exe>
- Zip: <https://github.com/nova-globen/vacha/releases/latest/download/vacha-win32-x64.zip>
- Checksums: <https://github.com/nova-globen/vacha/releases/latest/download/SHA256SUMS>
  and the SBOM <https://github.com/nova-globen/vacha/releases/latest/download/vacha-sbom.cdx.json>

Every version stays on the releases page,
<https://github.com/nova-globen/vacha/releases>. The downloaded files are not
code-signed yet, so Windows SmartScreen asks before the first run. The Store
version and a downloaded one keep separate settings.

- **Installer** — registers `Vacha.exe`, the `vacha` CLI shim on `PATH`, the
  `vacha://` URL protocol, the "Open with Vacha" entry for any file, and the
  default association for `.txt`, `.log`, `.ini`, `.cfg`, `.conf` and `.env`.
- **Zip** — unpack anywhere and run `Vacha.exe`. No associations are
  registered.

User data (settings, keybindings, session state) lives in `%APPDATA%\Vacha`.

**Upgrading from Tond 1.0.0:** run the Vacha installer over it. It quits Tond,
moves the install from `Programs\tond` to `Programs\vacha`, and takes over
Tond's file associations; on first start Vacha carries `%APPDATA%\Tond`,
`~\.tond` and `~\.tond-shared` over to its own folders, so settings, open
tabs and recent files stay.

## Resident mode

New in 1.0: Vacha stays resident so the first open of the day is instant.

- Vacha starts with Windows and sits in the background.
- Closing the window **hides** it; Vacha keeps running in the notification
  area (system tray).
- **Quit Vacha** in the tray menu is the only full exit.
- Start-at-login is on by default and can be turned off in Settings
  (`window.startAtLogin`). With it off, the resident instance starts the
  first time you open Vacha instead, and still stays in the background after
  you close the window.

## Single instance

There is only ever one Vacha window. Every launch, drag-and-drop or
"Open with" forwards the file into that window as a new tab. The forwarding
is done by a small native shim, `vacha_open.exe`, which writes the path to the
running instance's IPC pipe — that is why a warm open takes about a tenth
of a second instead of a second application start.

## What's included

- Editor with tabs
- Find and replace in the file (`Ctrl+F` / `Ctrl+H`)
- A left sidebar with Open Editors and a Search/Replace pane scoped to the
  **active file only**
- TextMate syntax highlighting for the bundled grammars
- Colour themes
- The settings editor and keybindings
- An update check (Help ▸ Check for Updates)

Session restore covers the set of open tabs and the cursor positions in
them. Nothing else is restored.

## What's deliberately excluded

Vacha has no extension host at all, so none of the following exist and none
can be added:

- Extensions and the marketplace — and therefore no IntelliSense, no
  diagnostics, no language servers
- Integrated terminal
- Git and SCM
- Debugger
- Tasks
- Notebooks
- Chat and AI features
- Accounts and settings sync
- Remote development
- Folders and workspaces — Vacha opens **files**, not projects

## Keyboard basics

| Shortcut | Action |
| --- | --- |
| `Ctrl+O` | Open file |
| `Ctrl+S` | Save |
| `Ctrl+W` | Close tab |
| `Ctrl+Tab` | Switch tab |
| `Ctrl+F` / `Ctrl+H` | Find / replace in the file |
| `Ctrl+Shift+F` | Search pane (active file) |
| `Ctrl+,` | Settings |
| `Ctrl+K Ctrl+S` | Keyboard shortcuts |
| `Ctrl+Shift+P` | Command palette |

## Settings

Settings are edited with `Ctrl+,` and stored in
`%APPDATA%\Vacha\User\settings.json`; keybindings live beside them in
`keybindings.json`.

## Building from source

Requirements: Node.js as pinned in `.nvmrc`, Python, and the usual Code - OSS
native build prerequisites for Windows. The native shim additionally needs a
Rust toolchain.

```powershell
npm ci
npm run typecheck-client                # verify the sources typecheck
npm run gulp -- vscode-win32-arm64      # package into dist\win32-arm64
.\scripts\release.ps1                   # minified package + smoke check + zip
.\scripts\release.ps1 -Arch x64 -Installer   # x64, plus the Inno Setup installer
```

Build the forwarder shim separately:

```powershell
cargo build --release --manifest-path native\vacha-open\Cargo.toml
```

Use `npm run typecheck-client` to check your work. This fork does not use
`npm run compile`, and the watch tasks inherited from upstream cover
components that no longer ship.

## Measuring startup

Speed figures for Vacha come from `scripts\measure-startup.ps1`, run against a
packaged build. The script writes a summary and every run to `docs\perf\`.
Latest results (medians of 5 runs, AMD Ryzen 9 9950X3D, Windows 11 x64, warm
file cache): cold start to an editable file 0.70 s (0.67-0.84 s); opening a
file while Vacha is running 0.14 s (0.12-0.16 s).

```powershell
.\scripts\release.ps1 -Arch x64 -NoZip     # or: npm run gulp -- vscode-win32-x64-min, plus the shim
.\scripts\measure-startup.ps1              # dist\win32-x64\Vacha.exe, 5 runs each
.\scripts\measure-startup.ps1 -Exe <path>\Vacha.exe -Runs 10 -Label "on battery"
```

Method:

- **Cold start**: wall clock from just before the process is created until
  the window is interactive. That means the file passed on the command line is
  rendered as the active tab and two `requestAnimationFrame`s have run after
  it. The start time is taken in the script and the end time in the renderer
  (`Date.now()`), both on the system clock. The `code/didStartWorkbench` perf
  mark is also reported, both on that wall clock (through
  `performance.timeOrigin`) and on the renderer's own clock. One warm-up run,
  which creates the profile, is not counted. The OS file cache is warm, so
  this is not a first-boot start.
- **Warm open**: Vacha is already resident. The clock runs from just before
  `vacha_open.exe <new file>` starts until that file's tab is active, its text
  is rendered and two animation frames have run. The shim's own start-to-exit
  time is reported separately.
- Each run gets a scratch `--user-data-dir`, and the end of a run is observed
  over the Chrome DevTools Protocol (`--remote-debugging-port`, on a port
  outside the Windows excluded ranges). The inspector is therefore always
  attached, and every record says so.
- Each JSONL record stores the CPU, OS arch and build, power source and plan,
  and the Vacha version, commit and exe architecture. The summary reports the
  median, min and max.
- The script stops only the processes it started: the PID it launched, checked
  against the exe path, and processes whose command line contains its scratch
  profile. An installed Vacha is never touched. Vacha registers itself as a
  login item (`HKCU\…\Run\Vacha`) on every start, so the script restores that
  value after each run. The scratch instances still open the per-user
  `~\.vacha-shared` storage, which any Vacha on the machine shares.

## Support and security

Vacha receives security updates until at least **31 December 2031**. Fixes
ship as new versions, free for every user; older versions are not patched
separately (see [TERMS.md](TERMS.md) §5). Report vulnerabilities privately as described in
[SECURITY.md](SECURITY.md). Every release ships a CycloneDX SBOM
(`Vacha-<version>-sbom.cdx.json`).

## License

Copyright (C) 2026 Nova Globen AB.

Vacha is free software: you can redistribute it and/or modify it under the
terms of the GNU General Public License as published by the Free Software
Foundation, either version 3 of the License, or (at your option) any later
version ([LICENSE.txt](LICENSE.txt); SPDX: `GPL-3.0-or-later`). It is
distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY;
without even the implied warranty of MERCHANTABILITY or FITNESS FOR A
PARTICULAR PURPOSE.

Vacha is free for everyone. Companies can buy a support agreement, and
anyone can donate; see [PRICING.md](PRICING.md). The names "Vacha" and
"Nova Globen" and the Vacha icon are not covered by the license (see
[TERMS.md](TERMS.md) §4).

Vacha is based on Code - OSS, Copyright (c) Microsoft Corporation, licensed
under the [MIT License](LICENSE.vscode.txt). Third-party attributions are
preserved in [ThirdPartyNotices.txt](ThirdPartyNotices.txt). Vacha is not
affiliated with or endorsed by Microsoft; "Visual Studio Code" and its icons
are trademarks of Microsoft and are not used by this product.
