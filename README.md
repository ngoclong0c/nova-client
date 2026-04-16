# Nova Client

Modern Minecraft launcher built with Electron. Clean service-based architecture, per-version mod management, and automatic updates.

## Features

- **Microsoft + Offline login** — Premium or crack, your choice
- **Fabric auto-install** — One-click Fabric Loader setup per MC version
- **Per-version mod management** — Mods separated by Minecraft version, no conflicts
- **Modrinth integration** — Search and install mods directly from Modrinth
- **Auto-update** — SHA256-verified updates from GitHub Releases
- **Java auto-download** — Downloads Adoptium JRE 21 with checksum verification
- **Crash detection** — Detects game crashes and shows error info
- **Session persistence** — Remember your login, version, and settings
- **Encrypted token storage** — AES-256-GCM with random key

## Architecture

```
main.js                      <- Entry point (thin orchestrator)
src/main/
  ipc/                       <- IPC router
  services/
    authService              <- Microsoft OAuth + offline login
    settingsService          <- Encrypted settings persistence
    javaService              <- Java detection + auto-download
    launchService            <- Game launch + crash handling
    versionService           <- Minecraft version fetching
    fabricService            <- Fabric Loader install
    modService               <- Mod management (Modrinth/GitHub)
    updateService            <- Auto-update system
  utils/
    logger                   <- Log rotation system
    network                  <- Fetch with retry + backoff
    crypto                   <- AES-256-GCM encryption
    file                     <- Atomic file operations
preload.js                   <- Secure IPC bridge
index.html                   <- Renderer UI
```

## Tech Stack

- **Electron 28** — Desktop framework
- **minecraft-launcher-core** — Game launching
- **msmc** — Microsoft authentication
- **adm-zip** — ZIP extraction (pure JS, no system deps)
- **node-fetch** — HTTP with streaming support
- **fs-extra** — File system utilities

## Installation

```bash
git clone https://github.com/ngoclong0c/nova-client.git
cd nova-client
npm install
npm start
```

## Development

```bash
npm run dev     # Start with DevTools
npm start       # Start normally
```

## Build

```bash
npm run build   # Build Windows installer (.exe)
```

Output: `dist/Nova Client Setup.exe`

## Release

```bash
python server/version_server.py 1.0.0 --notes "Release notes here"
# Automatically: bumps version, commits, tags, pushes, triggers GitHub Actions
```

## Security

| Layer | Protection |
|-------|-----------|
| Renderer | No Node.js access, CSP headers |
| Preload | contextBridge only, no direct IPC |
| Tokens | AES-256-GCM, random keyfile per machine |
| Updates | SHA256 checksum verification |
| Mods | SHA512 hash verification (Modrinth) |
| Network | Retry with backoff, timeouts on all requests |
| Java | Adoptium checksum verification |

## Notes

- First launch per version downloads ~300-500MB from Mojang
- Game data stored at: `%APPDATA%\.nova-client\`
- Mods stored per-version: `%APPDATA%\.nova-client\mods\1.21.4\`
- Logs at: `%APPDATA%\.nova-client\logs\latest.log`

## License

MIT
