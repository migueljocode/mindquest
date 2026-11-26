# MindQuest

MindQuest is a self-hosted educational quiz app with solo play and real-time LAN multiplayer. It includes a React/TypeScript browser UI and a self-contained .NET 10 server, so release installs do not require a separate .NET runtime.

## Install

**macOS (Apple Silicon) and Linux (x64)** — in a terminal:

```bash
curl -fsSL https://raw.githubusercontent.com/migueljocode/mindquest/main/scripts/install.sh | bash
```

**Windows (x64)** — in PowerShell:

```powershell
irm https://raw.githubusercontent.com/migueljocode/mindquest/main/scripts/install.ps1 | iex
```

The installers download the matching self-contained release and verify its SHA-256 checksum. They install for the current user without administrator access. The Unix installer places the `mindquest` command in `~/.local/bin`; add that directory to `PATH` if the installer says it is missing. The Windows installer adds its per-user install directory to `PATH`; open a new terminal if necessary.

Start the server with an unprivileged HTTP port:

```sh
mindquest --port 8080 --no-https
```

Open [http://localhost:8080](http://localhost:8080). By default, the server listens on all network interfaces; use `--bind localhost` to restrict it to this computer, or share the machine's LAN address with other players. Stop the server with **Ctrl+C**.

Installers currently support **Linux x64**, **Windows x64**, and **macOS Apple Silicon (arm64)**. To install another release, set `MINDQUEST_VERSION` before running the installer (for example, `v0.0.0`). The current release is [v0.0.0](https://github.com/migueljocode/mindquest/releases/tag/v0.0.0).

## Server options

```text
MindQuest [options]
  -h, --help                 Show help
  -v, --version              Show version
  -p, --port N               HTTP port (default: 80; env: PORT or HTTP_PORT)
  -s, --https-port N         HTTPS port (default: 443; env: HTTPS_PORT)
      --no-https             Disable HTTPS
  -b, --bind ADDR            Bind address (default: 0.0.0.0)
  -l, --log-level LEVEL      trace, debug, info, warn, error, critical, none
  -c, --cert PATH            PKCS#12 certificate (.pfx)
      --cert-password PASS   Certificate password
  -q, --quiet                Reduce startup logging
```

HTTPS is enabled by default on port 443 and uses a generated local certificate unless a certificate is supplied. For local use, `--port 8080 --no-https` avoids privileged ports and browser certificate warnings. For a LAN game, make the chosen port reachable through the host firewall.

Environment variables `PORT`, `HTTP_PORT`, `HTTPS_PORT`, `LOG_LEVEL`, `HTTPS_CERT_PATH`, and `HTTPS_CERT_PASSWORD` can configure the server. Command-line options take precedence. Avoid putting certificate passwords in shell history.

## Features

- Solo quizzes with category and difficulty selection, timed questions, streak scoring, lifelines, answer review, and locally saved records.
- Real-time multiplayer rooms over WebSockets, with room codes, reconnect support, live rankings, classic and knockout modes, and a final podium.
- Responsive, animated interface, theme options, sound effects, and question-specific visuals.
- A self-contained server with embedded quiz data and bundled static web assets.

## Run from source

Requirements: Node.js 24 or later, Bun, and the .NET 10 SDK.

```sh
bun install --frozen-lockfile
bun run dev
```

The development server is available at [http://localhost:3000](http://localhost:3000).

Useful commands:

```sh
bun run test          # Quiz logic tests
bun run lint          # TypeScript type check
bun run build         # Browser production build
bun run build:portable
```

To publish a .NET build locally, first generate the web assets and question data, then publish for a supported runtime:

```sh
node scripts/sync-dotnet.mjs
dotnet publish MindQuest.csproj -c Release -r linux-x64 --self-contained true -o publish/linux-x64
./publish/linux-x64/MindQuest --port 8080 --no-https
```

Use `win-x64` or `osx-arm64` for the other release targets. The published output includes `wwwroot`; keep it beside the executable.

## Releases

Pushing a `v*` tag starts [the release workflow](.github/workflows/release.yml). It runs tests and type checking, builds self-contained release archives for Linux x64, Windows x64, and macOS arm64, then publishes those archives and a `SHA256SUMS` manifest to GitHub Releases. To create a release from a local checkout:

```sh
git tag v0.0.1
git push origin v0.0.1
```

Release assets are named `mindquest-linux-x64.tar.gz`, `mindquest-windows-x64.zip`, and `mindquest-osx-arm64.tar.gz`.
