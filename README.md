# M5Stack Claude Code Usage Display

A tethered desk gadget: an M5Stack Core shows live Claude Code plan usage
(current 5h session, current week, current week Fable) as three color-coded
bars. The Mac runs `claude -p "/usage"` on a timer and pushes the parsed
percentages to the device over USB serial. The device is a pure display.

## Prerequisites

- Node 18+ (`node --version`)
- PlatformIO (`pio --version`; install with `pipx install platformio` or `brew install platformio`)
- Claude Code logged in (`claude -p "/usage"` prints the three bars)
- An M5Stack Core (Basic) connected over USB

## One-time: flash the firmware

```bash
cd firmware
pio run -t upload
```

The LCD should show `Waiting for Mac...`.

## Run the pusher

```bash
cd mac
npm install
npm start
```

Within a few seconds the three bars appear. Bars are green below 60%, amber
60 to 84%, red at 85% and above.

### Options

- `PORT=/dev/cu.usbserial-XXXX npm start` to pin the serial port.
- `POLL_MS=120000 npm start` to change the poll interval (default 90000).
- `npm run replay` to cycle synthetic frames (no CLI calls) for a visual check.
- `npm run stdout` to print one frame to the terminal instead of serial.

## Tests

```bash
cd mac
npm test
```

## Troubleshooting

- "no usbserial port found": check the cable, or set `PORT=` explicitly.
- Bars never appear but the pusher logs `ok:0`: the `/usage` wording changed;
  update the regexes in `mac/usage-parser.js`.
- Do not run `pio device monitor` while `npm start` is running. They contend
  for the same serial port.
- Each poll runs `claude -p "/usage"` (~2s, counts as ~1 request in your
  stats). Negligible plan impact; raise `POLL_MS` to reduce it further.
