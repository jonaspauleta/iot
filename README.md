# M5Stack Multi-Provider Usage Display

A tethered desk gadget: an M5Stack Core shows live coding-plan usage for four
providers, one pageable window per provider: **Claude**, **Codex**, **Cursor**,
**Grok**. Each window renders that provider's rate-limit / quota as color-coded
bars with reset countdowns. The Mac fetches everything locally from each
provider's own on-disk credentials and pushes a compact JSON frame over USB
serial. The device is a pure display.

## Buttons

- **Left (A):** previous provider window.
- **Right (C):** next provider window.
- **Middle (B):** force an immediate re-poll now (the device asks the Mac to refresh).

## Prerequisites

- [Bun](https://bun.sh) (`bun --version`, 1.3+).
- PlatformIO (`pio --version`; `pipx install platformio` or `brew install platformio`).
- An M5Stack Core (Basic) connected over USB.
- Each provider logged in on this Mac (one-time), so its local credentials are available:
  - **Claude:** Claude Code logged in with the `~/.claude-voltimum` profile (or the profile selected by `CLAUDE_CONFIG_DIR`).
  - **Codex:** `~/.codex/auth.json` present (ChatGPT/Codex login).
  - **Cursor:** `cursor-agent login` done once (token in the Keychain).
  - **Grok:** `~/.grok/auth.json` present (`grok` login).

A window whose provider is not logged in (or whose token expired) shows a dimmed
`reauth` / `stale` tag instead of bars; run that provider's CLI to refresh it.

## One-time: flash the firmware

```bash
cd firmware
pio run -t upload
```

The LCD shows `Waiting for Mac...`.

## Run the pusher

```bash
cd mac
bun start
```

Within a few seconds the Claude window appears; page to the others with the
buttons. Bars are green below 50%, amber 50 to 79%, red at 80% and above; a `--`
bar means that metric has no cap / is unknown.

### First-run Keychain prompt

The Claude provider reads the selected profile's `.credentials.json` first and
falls back to its macOS Keychain item when that file has no usable token. Cursor
still reads its token from the macOS Keychain. The first time `bun` reads a
Keychain item, macOS may pop a "confidential information" dialog. Click **Always
Allow** so the pusher keeps working unattended (e.g. after a reboot).

### Options

- `PORT=/dev/cu.usbserial-XXXX bun start` to pin the serial port.
- `CLAUDE_CONFIG_DIR=/path/to/profile bun start` to select a different Claude Code profile.
- `CLAUDE_CONFIG_DIR=/path/to/profile ./pusher.sh start` to pass that profile to the LaunchAgent.
- `POLL_MS=600000 bun start` to change the poll interval (default 300000, 5 min).
  Keep it multi-minute; the provider endpoints throttle frequent polling.
- `bun run replay` to cycle synthetic multi-window frames (no network) for a
  visual pass over paging, colors, and degraded states.
- `bun run stdout` to print one real frame to the terminal instead of serial.

## Tests

```bash
cd mac
bun run test
```

Unit tests cover the gRPC-web/protobuf scanner, JWT decode, each provider's pure
parser (against synthetic fixtures, no secrets), provider collection, and the
frame normalizer.

## How it works

```
per provider: read on-disk creds -> HTTP fetch -> parse -> bars
push.js gathers 4 windows -> buildFrame -> one JSON line over USB serial (115200)
firmware pages windows, renders bars, extrapolates reset countdowns, sends REFRESH on Btn B
```

- No Node, no `serialport`: pure Bun using built-in `fetch` and `Bun.spawn`. The
  serial line is driven directly through the tty (`stty` + `fs`), because the
  `serialport` native module crashes under Bun (libuv `uv_default_loop`).
- The data sources are the same internal endpoints CodexBar uses. They are
  undocumented / reverse-engineered, so expect occasional maintenance if a
  provider changes its response shape.
- Tokens are read only; only Codex's `auth.json` is ever written back (atomic,
  0600) when its token needs the 8-day refresh, mirroring the `codex` CLI.

## Troubleshooting

- "no usbserial port found": check the cable, or set `PORT=` explicitly.
- A window is stuck on `reauth` / `stale`: run that provider's CLI once to refresh
  its token (Claude/Grok tokens are short-lived and go stale if the CLI is idle).
  For a custom Claude profile, use the same `CLAUDE_CONFIG_DIR` value as the pusher.
- `Resource temporarily unavailable` when flashing: the pusher (or a serial
  monitor) is holding the port. Stop `bun start`, flash, then restart it.
- Do not run a PlatformIO serial monitor while `bun start` is running; they
  contend for the same port.
