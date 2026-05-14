# tdarts stream

Staff-only web app for **tdarts.hu** tournaments: create **rooms** with join codes, stream phones as **WebRTC** publishers, monitor from an **admin dashboard**, and open **clean viewer pages** for **OBS Browser Source**.

## Stack

- Next.js 16 (App Router) + TypeScript + Tailwind v4 + shadcn/ui (Base UI)
- Custom **Node** entry [`server.ts`](server.ts): Next HTTP handler + **Socket.IO** signaling on the same port
- **Rooms + camera presence**: **Redis** if `REDIS_URL` is set; otherwise an **in-memory** store in the Node process (no extra infra; see below).
- **WebRTC** mesh: one `RTCPeerConnection` per viewer (admin tile or `/view/[cameraSessionId]`)

## Quick start (local)

1. Copy env and edit secrets:

   ```bash
   cp .env.example .env.local
   ```

2. **Redis (optional):** leave `REDIS_URL` unset to use the built-in in-memory store (good for one machine and quick tournaments). Set `REDIS_URL` when you need data to survive app restarts or multiple app instances.

3. Install and run (uses [`server.ts`](server.ts), not `next dev` alone):

   ```bash
   npm install
   npm run dev
   ```

4. Open `http://localhost:3000/login`, sign in with `SESSION_PASSWORD`.

5. In **Dashboard**, create a room and **Copy join URL** for phones.

6. On each phone: **Camera** page → enter code (or use URL query `?code=`) → **Start** (preview can use **Black** / **Dim**; outgoing video stays full quality).

7. For OBS: open **Open viewer (OBS)** from the dashboard, or `/view/<cameraSessionId>` in a Browser Source (toggle HUD if you want a chromeless capture).

## Environment variables

- **`SESSION_PASSWORD`** (required): Shared staff password used at login.
- **`SESSION_SECRET`** (required in production): At least 16 characters; signs the httpOnly session JWT.
- **`REDIS_URL`** (optional): Example `redis://localhost:6379`. If unset, rooms and camera presence are stored **in memory** in the Node process (lost on restart; use a single app instance).
- **`NEXT_PUBLIC_APP_URL`** (recommended): Public site URL (`https://…`) for join links when behind a reverse proxy.
- **`ICE_SERVERS_JSON`** (optional): JSON array of `RTCIceServer` objects. If omitted, a public Google STUN server is used.

Without **TURN**, some phone networks will not connect across NAT; use **coturn** (or a hosted TURN) for production venues. See comments in [`docker-compose.yml`](docker-compose.yml).

## Docker Compose

```bash
export SESSION_PASSWORD='your-password'
export SESSION_SECRET='at-least-16-characters-here'
docker compose up --build
```

Then open `http://localhost:3000`.

## Production notes

- Terminate TLS at your reverse proxy; set `NEXT_PUBLIC_APP_URL` to the public `https://` origin so join links are correct.
- Set `Secure` cookies: app uses `secure: true` on cookies when `NODE_ENV=production` — your proxy must send `X-Forwarded-Proto: https` (standard for Caddy/Traefik/nginx).
- **Mesh** limits: each admin preview and each OBS viewer adds a separate decode path; keep concurrent previews modest, or rely on dedicated `/view/...` pages for full quality.
- **Redis vs memory:** with **no** `REDIS_URL`, you avoid deploying Redis; tradeoff is no persistence across process restarts and no shared state across multiple Node replicas. Add Redis when you outgrow that.

## CI / GHCR

On every push to **`main`**, [`.github/workflows/docker-publish.yml`](.github/workflows/docker-publish.yml) builds a **multi-arch** image (`linux/amd64`, `linux/arm64`) and pushes to:

`ghcr.io/<github_owner>/<repo_name>:latest` and `:sha-<commit>`

Use a lowercase repository path (GitHub enforces this for packages).

## Project layout

- [`src/app/`](src/app/) — routes: `login`, `admin`, `camera`, `view/[cameraSessionId]`, `api/*`
- [`src/server/io.ts`](src/server/io.ts) — Socket.IO signaling (`v1:*` events) + room/camera presence (Redis or in-memory)
- [`src/hooks/`](src/hooks/) — `useSignalingSocket`, `usePublisher`, `useSubscriber`
- [`src/lib/`](src/lib/) — auth, redis, rooms, media helpers

## Signaling protocol (v1)

- `v1:admin:join` — admin receives `v1:admin:snapshot` and `v1:roster` updates.
- `v1:camera:join` `{ joinCode, cameraSessionId, label }` — registers camera (requires active `MediaStream` from client before join).
- `v1:viewer:subscribe` `{ cameraSessionId, viewerPeerId }` — triggers `v1:control:subscriber-add` to the camera.
- `v1:webrtc:offer` / `answer` / `candidate` — relayed between matching camera and viewer sockets.
- `v1:control:mute-audio` `{ cameraSessionId, muted }` — admin forces camera mic track off (and presence flag in the store).

## License

Private / internal for tdarts.hu — adjust as needed.
