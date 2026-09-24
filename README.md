# Toy Snake

Multiplayer grid snake-and-apples, battle-royale style. Installable on Android and iOS. Play solo against computer snakes, or against friends over a shared Wi-Fi/hotspot with no backend server and no accounts — pairing is done with a 4-digit code (or by scanning QR codes between phones).

## Why no Bluetooth?

Same reason as its sibling project, [Toy Racers](../toy-racers): an installed PWA on iOS runs on WebKit, which has never implemented the Web Bluetooth API. So multiplayer here uses **WebRTC data channels** with **no signaling server** — the host's WebRTC offer is handed off through a short-lived room code (via a tiny public key/value relay, or by scanning a QR code) and every device only ever needs to be reachable on the same local network. `iceServers` is intentionally left empty so nothing but that initial handshake ever leaves the LAN.

## How the game works

- Every player controls a snake on a shared 30x18 grid. Turn with arrow keys/WASD, or the on-screen D-pad on touch devices.
- Eating an apple grows your snake by one segment and scores 10 points; the board keeps 3-6 apples on it at all times depending on player count, and the whole game gradually speeds up as more apples get eaten.
- Hitting a wall, your own body, or *any* snake's body — including a dead snake's frozen corpse, which stays on the board as an obstacle — kills you instantly.
- Last snake alive wins. If a 3-minute clock runs out with more than one snake still alive, or everyone dies at once, standings are ranked by who survived longest, then by score.
- "Play vs Computer" adds 1-7 bot snakes (greedy-for-the-nearest-apple, with a simple flood-fill check so they don't happily trap themselves in a dead end) — no connection needed.

## Host-authoritative networking (different from Toy Racers)

Toy Racers has each car simulate its own physics locally and just broadcasts position, because being a few pixels off doesn't matter. Snake can't work that way — if two clients' boards ever disagree about which cell an apple is on, or whether a collision happened, the game state permanently diverges. So here **the host runs the entire simulation**: every guest just sends direction changes (`{ type: "input" }`, over the reliable channel, since it's a rare event rather than a continuous stream), and the host ticks the whole board and broadcasts the authoritative result (`{ type: "state" }`, over the unreliable channel, at a steadily increasing tick rate) to everyone, itself included conceptually. Guests never simulate — they just interpolate smoothly between the last two ticks they received.

## Running it

```bash
npm install
npm run dev
```

This starts an HTTPS dev server (self-signed cert) on your machine and prints a `Network:` URL like `https://192.168.1.23:5173`. HTTPS is required in dev because:
- Camera access (`getUserMedia`, used for QR scanning) only works in a secure context.
- Service worker registration (needed to test "Add to Home Screen") only works in a secure context.

To test on a phone:
1. Make sure the phone and your dev machine are on the **same Wi-Fi network**.
2. Open the `Network:` HTTPS URL on the phone's browser.
3. Accept the self-signed certificate warning (Chrome/Safari will warn once — proceed anyway; this is only for local testing).
4. To test the full multiplayer flow, repeat on a second phone.

If your OS firewall blocks incoming connections to the dev server, allow Node.js/vite through it, or disable SSL for a same-machine test with `NO_SSL=1 npm run dev`.

## Building & deploying for real use

```bash
npm run build
npm run preview   # sanity-check the production build locally
```

`dist/` is a static site — deploy it to any static HTTPS host (Vercel, Netlify, GitHub Pages, S3+CloudFront, etc.). A real (non-self-signed) HTTPS certificate is required for camera access and installability outside of local dev.

### Installing on a phone

- **Android (Chrome)**: visit the site, tap the "Install app" prompt or menu → "Add to Home screen".
- **iOS (Safari)**: visit the site, tap Share → "Add to Home Screen".

## Project structure

- `src/game/` — grid math (`grid.ts`), the snake entity (`snake.ts`), bot steering (`ai.ts`), the host-authoritative tick simulation and guest state interpolation (`session.ts`), rendering (`renderer.ts`), input (`input.ts`), sound (`sound.ts`), and the fixed-timestep render loop (`loop.ts`).
- `src/net/` — WebRTC plumbing with no signaling server (`webrtc.ts`), QR encode/scan (`qr.ts`), the host/guest lobby state machines (`lobby.ts`), and the wire protocol (`protocol.ts`). These four files are close to line-for-line identical to Toy Racers' — the net layer doesn't care what game is being played.
- `src/ui/` — small DOM helper (`dom.ts`) and the single `App` class (`screens.ts`) that owns all screens (menu, host/join lobby, HUD, results) and wires game + net together.
- `scripts/` — one-off icon generation from SVG source.

## Known limitations / good next steps

- A snake's own about-to-vacate tail cell is treated as free (so you can legally turn into where your tail just was); another snake's about-to-vacate tail is not, which can very occasionally cause a "phantom" collision on a close pass between two snakes instead of a clean miss.
- No mid-game reconnect if a guest's connection drops.
- No track/board selection — one fixed 30x18 board.
- Bot AI looks one flood-fill deep for open space; it can still occasionally trap itself against a wall of other snakes' bodies in a crowded endgame.
