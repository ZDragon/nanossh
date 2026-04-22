# SSH Client

A Windows desktop SSH/SFTP client built on Electron + React + TypeScript. Single window combines a multi-tab terminal, a dual-pane file explorer for drag-and-drop transfers, and edit-in-place for remote files.

## Features

- **Multi-session tabs** — open several SSH connections at once, each with its own terminal and file panes.
- **Terminal** — xterm.js (UTF-8, 256-color, 10k scrollback), `Ctrl+F` search, `Ctrl+Shift+C/V` copy/paste, `Ctrl+= / - / 0` zoom. Right-click opens a context menu with copy selection, copy the entire scrollback buffer, paste, select all, clear, and export the full session log to a file (plain text or raw ANSI). Theme follows the app (light/dark).
- **SFTP explorer** — navigate, `mkdir`, rename, delete (recursive for folders). Drag files from Windows Explorer or between panes to upload/download. Transfer queue with progress and cancel.
- **Edit-in-place** — click the pencil icon on a remote file to open it in your editor (VS Code, Notepad++, Sublime, Notepad, …). Every save is auto-uploaded back; close via the Active edits panel.
- **Port forwarding** — local (`-L`), remote (`-R`) and dynamic SOCKS5 (`-D`) tunnels per session. Live connections / bytes counters in the Forwards dialog.
- **Saved connections** — password / private-key / SSH-agent auth. Passwords and key passphrases encrypted with Windows DPAPI (`safeStorage`), never stored in plaintext.
- **ProxyJump / keepalive / theme toggle** — basic knobs exposed in the connection dialog.

## Requirements

- Windows 10/11
- Node.js 18+ (developed on 25.x)
- For packaging: default Electron-builder toolchain (no extra setup needed)

## Setup

```bash
npm install
```

## Run in dev mode

```bash
npm run dev
```

This starts `electron-vite dev` with HMR for the renderer and reload for main/preload. First launch downloads the Electron binary (~100 MB).

## Build a production bundle

```bash
npm run build            # transpile only; output in out/
npm run package          # bundle + installers for the current OS
npm run package:win      # Windows NSIS + portable (x64)
npm run package:mac      # macOS DMG + ZIP (x64 + arm64)
npm run package:linux    # Linux AppImage + deb + rpm + tar.gz (x64 + arm64 where applicable)
npm run package:all      # -mwl (all three; only meaningful on macOS / with CI)
```

**Cross-compilation caveats:**

- Building `.dmg` / signing `.app` requires running on macOS. You can only cross-compile unsigned `.zip`/`.tar.gz` bundles from Windows/Linux.
- Building `.rpm` from a non-RPM host needs the `rpm` / `rpmbuild` binary in PATH (install via `rpmbuild` on Ubuntu/Debian).
- For hassle-free multi-platform releases use GitHub Actions — a matrix across `windows-latest` / `macos-latest` / `ubuntu-latest` with `npm ci && npm run package` is the standard approach.

## Copying & exporting terminal output

Right-click inside the terminal for a context menu:

| Action | What it does |
| --- | --- |
| **Copy selection** (`Ctrl+Shift+C`) | Copies the current mouse selection to the clipboard. |
| **Paste** (`Ctrl+Shift+V`) | Pastes clipboard text into the terminal. |
| **Select all** | Selects the entire visible buffer + scrollback (up to 10k lines). |
| **Copy entire buffer** | Copies the full scrollback as plain text (all lines concatenated with `\n`). |
| **Export session log (plain text)** | Saves the *entire* session output so far, with ANSI escapes stripped, to a file of your choice. |
| **Export session log (raw, with ANSI)** | Saves the raw byte stream as received from the server — colors and control codes are preserved. View with `less -R` / any ANSI-aware viewer, or `cat` in a terminal. |
| **Clear screen** | Clears the visible area (buffer retained). |
| **Find** (`Ctrl+F`) | Opens the search panel. |

The session log is captured on the main process side into a private file under the OS temp dir from the moment the session opens — nothing is lost even if the scrollback is full. Temp logs are removed when the session closes (and orphan files from previous crashes are purged on startup).

## Port forwarding

Click the **Forwards** button in the tab bar of the active session. For each session you can add any number of tunnels:

| Kind | Description | Fields |
| --- | --- | --- |
| **Local (-L)** | Listen on *your* machine; every connection is tunneled through SSH to a destination reachable from the server. | `bindHost:bindPort` → `destHost:destPort` (as the server sees it) |
| **Remote (-R)** | Ask the server to listen; connections the server accepts are tunneled back to you. | `bindHost:bindPort` (server) → `destHost:destPort` (local) |
| **Dynamic (-D)** | Local SOCKS5 proxy — every request is tunneled to the address the client asks for. Point browsers / curl / apt here. | `bindHost:bindPort` (CONNECT-only, IPv4/domain) |

Notes:

- Bind port `0` = OS-assigned. The actual port appears in the list after the tunnel goes active.
- Remote forwards require `GatewayPorts yes` in `sshd_config` if you want a non-loopback `bindHost`.
- Tunnels die with their SSH session (and are cleaned up on app quit).

## Configure an external editor

Click the gear icon in the sidebar → `Settings`. Examples:

| Editor | Command |
| --- | --- |
| System default | *(empty)* |
| VS Code | `code {file}` |
| VS Code, wait for close | `code --wait {file}` |
| Notepad++ | `"C:\Program Files\Notepad++\notepad++.exe" {file}` |
| Notepad | `notepad {file}` |

Use `{file}` as the placeholder for the downloaded temp path; it is appended automatically if absent. Wrap paths with spaces in double quotes.

## Project layout

```
src/
├── main/                 # Electron main process (Node)
│   ├── index.ts          # BrowserWindow, lifecycle
│   ├── ipc.ts            # IPC handlers
│   ├── editor.ts         # Edit-in-place manager (watch + upload)
│   ├── ssh/
│   │   ├── SshSession.ts         # ssh2 Client wrapper (shell + sftp)
│   │   ├── SessionManager.ts     # multi-session registry
│   │   └── TransferQueue.ts      # SFTP transfer progress
│   └── storage/
│       ├── connections.ts        # JSON CRUD
│       └── secrets.ts            # DPAPI via safeStorage
├── preload/
│   └── index.ts                  # contextBridge API
├── renderer/             # React app
│   ├── App.tsx
│   ├── state/            # zustand stores (connections, sessions, fs, editors, theme)
│   └── components/       # Sidebar, ConnectionDialog, Terminal, FilePane, …
└── shared/
    └── types.ts          # shared IPC types
```

Secrets live in `%APPDATA%/<app>/connections.json` and are encrypted per-user via Windows DPAPI. Edit-in-place temp files live under `%TEMP%/ssh-client-edit/<uuid>/` and are removed when the edit is closed.

## Troubleshooting

- **`sftp:list` → "administratively prohibited"** — the server has SFTP subsystem disabled. Enable `Subsystem sftp /usr/lib/openssh/sftp-server` (or `internal-sftp`) in `/etc/ssh/sshd_config` and reload sshd. The terminal will still work even if SFTP does not.
- **Editor doesn't launch** — verify the command runs from a cmd.exe window. Paths with spaces must be quoted. Empty command falls back to `shell.openPath` (the system default).
- **Changes in the editor don't upload** — the watcher polls `mtime` every 1 s. Some editors save via an atomic rename; if the mtime doesn't move, save again to nudge it. Error details appear in the Active edits panel.

## Security notes

- `contextIsolation: true`, `nodeIntegration: false` in the renderer.
- Passwords / key passphrases encrypted with DPAPI. Never logged.
- Host-key verification currently trusts-on-first-use silently — see the plan for a TODO to surface fingerprint changes.
- Anything under `keys/`, `*.pem`, `*.ppk`, `id_rsa*`, `connections.json`, `.env*` is git-ignored. Do not commit these.

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Dev server with HMR |
| `npm run build` | Compile main + preload + renderer to `out/` |
| `npm run package` | Full production build + `.exe` via electron-builder |
| `npm run typecheck` | `tsc --noEmit` for both sides |
| `npm run lint` | ESLint |
| `npm run format` | Prettier |

## License

MIT © Alexander Kozlov (Silver Dragon). See [LICENSE](./LICENSE).
