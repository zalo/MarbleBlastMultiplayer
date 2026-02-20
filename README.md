# Marble Blast Multiplayer

**[Play Online](https://zalo.github.io/MarbleBlastMultiplayer/)**

A multiplayer fork of [Marble Blast Web](https://github.com/Vanilagy/MarbleBlast) — roll around levels with friends over LAN, bump each other off platforms, and pick custom marble skins.

## Quick Start

```bash
git clone https://github.com/zalo/MarbleBlastMultiplayer.git
cd MarbleBlastMultiplayer
npm install
npm run multiplayer
```

Open `http://localhost:1324` and you're in.

Friends on the same network join at `http://YOUR-IP:1324`.

## Features

- Real-time LAN multiplayer via WebSockets
- Player collision with elastic physics
- 16 choosable marble skins, synced across players
- Live player list and debug console
- Auto-starts into the first level
- Mobile support over LAN

## Controls

Arrow keys / WASD to move, mouse to look, space to jump. Skin picker is top-left.

## Deploying the PartyKit Server

The multiplayer WebSocket server runs on [PartyKit](https://partykit.io/) (Cloudflare). The current instance is at `marble-blast-party.zalo.partykit.dev`.

To deploy your own or update the existing one:

```bash
cd party
npx partykit login    # opens browser for Cloudflare auth
npx partykit deploy   # deploys server.js to Cloudflare
```

The deploy prints a URL like `https://marble-blast-party.ACCOUNT.partykit.dev`. Update the host in `src/ts/index.ts` to match:

```typescript
let partyHost = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? window.location.hostname + ':7648'
    : 'marble-blast-party.ACCOUNT.partykit.dev';
```

The room name is set in the same file (`marble-blast-room`). To support multiple concurrent groups, generate unique room names per group — PartyKit creates a separate Durable Object for each room automatically.

For local development, `npx partykit dev --port 7648` runs the server locally.

## Credits

- [Marble Blast Web](https://github.com/Vanilagy/MarbleBlast) by [Vanilagy](https://github.com/Vanilagy)
- Multiplayer fork by [zalo](https://github.com/zalo)
