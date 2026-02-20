# Marble Blast Multiplayer
A multiplayer fork of [Marble Blast Web](https://github.com/Vanilagy/MarbleBlast) — the clean-room TypeScript web port of Marble Blast Gold and Marble Blast Platinum.

This fork adds real-time LAN multiplayer so you and your friends can roll around the same level together, bump each other off platforms, and pick custom marble skins.

## Multiplayer Features
- **Real-time multiplayer** via [PartyKit](https://partykit.io/) WebSocket server
- **Player collision** — marbles physically bump each other with elastic collision
- **Skin picker** — choose from 16 marble skins, synced across all players
- **Player list** — see who's online in the top-right corner
- **Debug console** — toggle a live console log overlay for troubleshooting
- **Auto-start** — drops straight into the first level, no menu navigation needed
- **Mobile support** — works on phones over LAN with fast WebSocket retry

## Setup

### Prerequisites
- Node.js (v18+)
- npm
- `node-gyp` installed globally: `npm install -g node-gyp`
  - On Windows, also run `npm install --global --production windows-build-tools` in an elevated command prompt

### Install

```bash
# Clone the repo
git clone https://github.com/zalo/MarbleBlastMultiplayer.git
cd MarbleBlastMultiplayer

# Install game dependencies
npm install --legacy-peer-deps

# Install PartyKit server dependencies
cd party
npm install
cd ..
```

### Build

```bash
npm run compile
```

This compiles the TypeScript source into `src/js/bundle.js` and `server/bundle.js` using Rollup.

For development with auto-rebuild on changes:
```bash
npm run watch-fast
```

### Run

You need to start **two servers** — the game server and the PartyKit multiplayer server:

**Terminal 1 — Game server** (serves the web page and assets):
```bash
npm start
```
This starts the game server on port 1324 (configurable in `server/data/config.json`).

**Terminal 2 — PartyKit multiplayer server** (handles WebSocket connections):
```bash
cd party
npx partykit dev --port 7648
```

### Connect

1. Open `http://localhost:1324` in your browser — the game auto-starts the first level
2. To play with others on your LAN, have them open `http://<your-ip>:1324`
3. Find your IP with `ip addr` (Linux), `ipconfig` (Windows), or `ifconfig` (macOS)

The multiplayer client automatically connects to the PartyKit server on port 7648 using the same hostname as the page.

### Ports Summary

| Service | Default Port | Config |
|---------|-------------|--------|
| Game server | 1324 | `server/data/config.json` |
| PartyKit server | 7648 | `--port` flag on `npx partykit dev` |

Both ports must be accessible to other players on your network.

## Controls

Use the skin picker button (top-left) to choose your marble skin. The debug console toggle is in the bottom-left corner.

All standard Marble Blast controls apply — arrow keys or WASD to move, mouse to look, space to jump.

## Architecture

The multiplayer system consists of:

- **`party/server.js`** — PartyKit server that relays position/orientation/velocity updates between players and runs server-side sphere-sphere collision detection with elastic impulse response
- **`src/ts/multiplayer.ts`** — Client module that manages WebSocket connection, ghost marble rendering with entity interpolation, skin synchronization, and UI (player list, skin picker, console)
- **`src/css/multiplayer.css`** — Styles for the multiplayer UI overlay

Ghost marbles are pre-allocated before the scene compiles (the engine bakes meshes into VBOs at compile time), and textures are swapped at runtime for skin changes.

## Credits

- Original [Marble Blast Web](https://github.com/Vanilagy/MarbleBlast) by [Vanilagy](https://github.com/Vanilagy)
- Multiplayer fork by [zalo](https://github.com/zalo)
