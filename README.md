# ImiCall

A lightweight, account-free, two-person browser calling app with a local phone book.

## Run

Use Node 24 (see `.nvmrc`; minimum 22.12). Run `npm install`, then `npm start`. Open http://localhost:8080. Production requires HTTPS for microphone access and notifications. Use the Node server in `server/signaling.js`; the legacy Cloudflare worker is unsupported by protocol v2.

## Privacy and security model

- New connections use a cryptographically random 128-bit room identifier and 256-bit invite secret. Old shared-PIN connections require an explicit upgrade and a fresh shared invite.
- Invite secrets stay in URL fragments and browser storage. Join-verification tokens are domain-separated SHA-256 hashes. Tokens do not reveal the random secret.
- Call-control messages, SDP certificate fingerprints and ICE candidates use AES-GCM authenticated encryption with a separately derived key, random IVs, session identifiers, sequence checks and a two-minute freshness limit. This is custom signaling protection, not a claim of a formally audited protocol. Devices should keep clocks synchronized.
- WebRTC provides DTLS-SRTP media encryption and DTLS data-channel encryption. The legacy `AudioE2EE` helper is not used for media and is not advertised as an extra encryption layer.
- No application writes of contacts, recordings, chats, call logs, subscriptions or room history to server disk. The connection service necessarily sees network addresses, random routing IDs and timing. Hosting-provider logs are outside application control.
- Push addresses and keys are opt-in, memory-only, expire after 24 hours without renewal, and disappear on restart. Open clients renew hourly. This tradeoff preserves no durable application-side user storage at the cost of long-term background delivery. Browser/OS restrictions also apply.
- Participants can record externally; compromised devices, leaked invitations and malicious application delivery remain threats. An independent security audit is needed before high-assurance use.
- Browser-local storage is accessible to anyone with that browser profile. There is no cloud recovery. Settings exports password-encrypted backups (AES-GCM, PBKDF2-SHA-256 with 310,000 iterations), previews and merges imports, and clears local contacts, presets, subscriptions and offline caches. Forgotten backup passwords cannot be recovered.

## Deployment configuration

- `PORT`: defaults to 8080.
- `PUBLIC_URL`: real HTTPS deployment origin. Enables the sitemap and HSTS, and authorizes its Host/Origin. Set `ALLOWED_ORIGINS` to comma-separated additional exact origins when needed. Public tunnels must be explicitly configured; arbitrary Host headers are rejected.
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`: configure a fresh stable Web Push key pair and operator contact. Without keys, the server generates a memory-only pair for local use; restarts invalidate previous subscriptions. Generate keys with `npx web-push generate-vapid-keys`. Never commit private keys. The previously hardcoded key pair must be treated as compromised and replaced.
- `TURN_URLS`, `TURN_SECRET`: optional comma-separated relay URLs and a coturn-compatible shared secret. The server issues ten-minute HMAC credentials; the secret never reaches clients. Configure relay quotas and rate limits before launch. No relay credentials are included by default, so restrictive networks may not connect.

Single-instance server only: memory-only routing does not coordinate multiple replicas. Put behind a WebSocket-capable HTTPS reverse proxy. Review provider access logs/retention, monitoring and abuse controls before public launch. No analytics or external fonts are included. Compression of static assets is cached in memory; immutable caching is limited to hashed assets. The versioned service-worker shell is cache-first after installation, including offline navigation. Updates activate only after the user chooses Update now. Optional features load on demand and prefetch only outside slow/save-data connections. Preact compatibility keeps the initial runtime small.

Older `server/subscriptions.json` and `server/deleted_rooms.json` files may exist from previous runs. This version never reads or writes them. Operators should remove existing copies/backups according to their retention obligations. A code change cannot remove hosting logs or copies already elsewhere.

## Discovery

`/about.html` and `/privacy.html` provide crawlable, readable product facts and FAQ content without JavaScript. Metadata and WebApplication structured data describe the product without fabricated ratings. `/robots.txt`, `/sitemap.xml` (needs `PUBLIC_URL`) and `/llms.txt` support discovery. No ranking or AI-answer inclusion is guaranteed. Public deployment, Search Console registration and domain-specific canonical URLs remain deployment tasks.

## Verify

`npm run build` and `npm test`. `node scripts/verifyPrivateV2.mjs` runs browser checks against the updated local server (use `IMICALL_TEST_URL` to select another port). Fake microphone devices verify call setup, packet flow and teardown, not real mobile hardware or production push delivery.

## Mobile and voice effects

Phones use separate Phone Book and connection views; tablets use two panes. Microphone access begins from a user action, and remote audio uses native playback with a tap-to-resume action if blocked. A valid HTTPS origin is required; browser and OS permission denial cannot be overridden.

Voice effects are off on each new app session. Settings or the live call panel can apply bounded, local AudioWorklet effects and import/export JSON presets. Changing a preset replaces the outgoing track without renegotiating. Effects cannot guarantee anonymity or prevent recognition/reconstruction. There is no remote processing or downloaded AI model.

Run `node scripts/verifyMobile.mjs` for responsive navigation, encrypted backup export/import, offline reload and clearing data. These are desktop browser simulations, not certification on physical Apple/Pixel devices. Cold-load speed and real-time call quality depend on network conditions, including available TURN relays.

## Portable data workflow

Data & backup separates Create backup from Restore backup. Export supports selecting contacts and confirming a password; restore unlocks locally and previews new, existing and conflicting entries before merge. Removing a local contact never erases a peer or revokes downloaded copies. Restoring matching invitations on both sides restores access. For a leaked invitation, create and share a new connection and stop using the old one.

Voice settings support explicit Save preset, JSON export, import preview and Use in editor. Saving/importing does not activate effects; Apply is explicit. The embedded guide explains each control and natural-voice mixing.

`node scripts/verifyRestoreCall.mjs` verifies encrypted export, cross-browser restore, deletion on both sides, reimport and a connected call. `node scripts/verifyPresetTransfer.mjs` verifies cross-browser preset transfer and no implicit activation. Set `IMICALL_ARTIFACTS` to choose test download storage.

## Relay-only privacy and temporary sessions

Calls default to `iceTransportPolicy: relay`, with STUN entries removed and candidate pre-gathering disabled. The client checks for TURN before microphone capture and stops if unavailable; it never silently falls back to direct transport. Settings allows an explicit Direct calls choice, with an IP exposure confirmation. Configure `TURN_URLS` and `TURN_SECRET` on the Node server and the corresponding coturn deployment before protected calling. This environment has no configured relay and successful relay-to-relay media has not been verified. A TURN URL alone is not evidence of a functioning relay.

Settings → Open temporary session creates a separate tab. Its contact/preset store is memory-only, background push is disabled, and reload, connected-call termination or End & forget drops its in-memory data. A sessionStorage flag contains only the temporary-mode marker. Existing regular contacts, browser visit history, downloaded backups, clipboard, OS memory and other endpoints are not erased. This is data minimization, not a forensic secure-erasure claim.

Recent interval packet loss now drives quality reporting; three poor samples lower the profile to 10 kbps, then 6 kbps if poor conditions continue. The sender bitrate is capped on connection and profile changes. Real network overhead, loss, latency and relay capacity can still make a 2G call fail.

`node scripts/verifyPrivacyModes.mjs` verifies no-relay fail-closed behavior before peer connection or mic acquisition and temporary-storage isolation. Existing local call tests explicitly opt into Direct mode because loopback tests have no TURN service.

## Weak-network communication

Choose **Next call quality → Very weak / 2G** before calling: Opus is capped at 6 kbps, with 60 ms packets and narrowband playback preference. The 10 kbps profile also requests 60 ms packets. DTX and FEC are negotiated preferences; actual encoder behavior depends on the browser. Profile changes during a call cap bitrate but do not renegotiate packet duration. Packet, encryption and relay overhead mean total bandwidth exceeds the codec bitrate. More packet duration reduces overhead but increases delay and the audio lost with each dropped packet.

If voice is unusable, open a contact and choose **Tiny messages**. Both people must keep the app open. Messages use the encrypted signaling connection without microphone permission, WebRTC or TURN. Each message is limited to 500 characters / 2,000 UTF-8 bytes. Delivery means receipt by the device, not that a person read it. A missing receipt triggers retries at ten-second intervals, up to three attempts. Duplicates are suppressed. Messages expire from app memory after 90 seconds; closing the panel clears its local messages. There is no durable offline mailbox or message history. Device compromise, screenshots and recipient copies remain possible.

Static responses use cached Brotli compression where accepted, with gzip fallback. Optional features remain lazy-loaded; no neural model is downloaded. The service worker reuses the installed interface, while communication requires a live network.

`node scripts/verifyTinyMessages.mjs` checks encrypted two-browser delivery with 6 kbps application-message pacing, added latency and a deliberately dropped first receipt. This is not a real cellular network test. `node scripts/verifySpeed.mjs` measures a separate 150 kbps cold-load simulation.

## Server hardening

The server validates Host and WebSocket Origin, bounds HTTP bodies, signaling frames, queues and rates, and constrains push endpoints and subscription keys. Public configuration contains no TURN credentials. `/api/ice` issues short-lived credentials only for a room-authenticated device with an active socket, subject to issuance limits. Anonymous room creation still requires operator-level relay quotas and abuse protection. TLS, infrastructure logs and denial-of-service protection remain deployment responsibilities.
