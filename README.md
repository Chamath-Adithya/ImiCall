# ImiCall

A lightweight, account-free, two-person browser calling app with a local phone book.

## Run

`npm install`, `npm run build`, then `npm start`. Open http://localhost:8080. Production requires HTTPS for microphone access and notifications. Use the Node server in `server/signaling.js`; the legacy Cloudflare worker is unsupported by protocol v2.

## Privacy and security model

- New connections use a cryptographically random 128-bit room identifier and 256-bit invite secret. Old shared-PIN connections require an explicit upgrade and a fresh shared invite.
- Invite secrets stay in URL fragments and browser storage. Join-verification tokens are domain-separated SHA-256 hashes. Tokens do not reveal the random secret.
- Call-control messages, SDP certificate fingerprints and ICE candidates use AES-GCM authenticated encryption with a separately derived key, random IVs, session identifiers, sequence checks and a two-minute freshness limit. This is custom signaling protection, not a claim of a formally audited protocol. Devices should keep clocks synchronized.
- WebRTC provides DTLS-SRTP media encryption and DTLS data-channel encryption. The legacy `AudioE2EE` helper is not used for media and is not advertised as an extra encryption layer.
- No application writes of contacts, recordings, chats, call logs, subscriptions or room history to server disk. The connection service necessarily sees network addresses, random routing IDs and timing. Hosting-provider logs are outside application control.
- Push addresses and keys are opt-in, memory-only, expire after 24 hours without renewal, and disappear on restart. Open clients renew hourly. This tradeoff preserves no durable application-side user storage at the cost of long-term background delivery. Browser/OS restrictions also apply.
- Participants can record externally; compromised devices, leaked invitations and malicious application delivery remain threats. An independent security audit is needed before high-assurance use.
- Browser-local storage is accessible to anyone with that browser profile. There is no cloud backup or recovery. Settings can clear ImiCall local data.

## Deployment configuration

- `PORT`: defaults to 8080.
- `PUBLIC_URL`: real HTTPS deployment origin. Enables the sitemap and HSTS. Do not use a guessed domain.
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`: configure a fresh stable Web Push key pair and operator contact. Without keys, the server generates a memory-only pair for local use; restarts invalidate previous subscriptions. Generate keys with `npx web-push generate-vapid-keys`. Never commit private keys. The previously hardcoded key pair must be treated as compromised and replaced.
- `TURN_URLS`, `TURN_SECRET`: optional comma-separated relay URLs and a coturn-compatible shared secret. The server issues ten-minute HMAC credentials; the secret never reaches clients. Configure relay quotas and rate limits before launch. No relay credentials are included by default, so restrictive networks may not connect.

Single-instance server only: memory-only routing does not coordinate multiple replicas. Put behind a WebSocket-capable HTTPS reverse proxy. Review provider access logs/retention, monitoring and abuse controls before public launch. No analytics or external fonts are included. Compression of static assets is cached in memory; immutable caching is limited to hashed assets. Service-worker HTML is network-first.

Older `server/subscriptions.json` and `server/deleted_rooms.json` files may exist from previous runs. This version never reads or writes them. Operators should remove existing copies/backups according to their retention obligations. A code change cannot remove hosting logs or copies already elsewhere.

## Discovery

`/about.html` and `/privacy.html` provide crawlable, readable product facts and FAQ content without JavaScript. Metadata and WebApplication structured data describe the product without fabricated ratings. `/robots.txt`, `/sitemap.xml` (needs `PUBLIC_URL`) and `/llms.txt` support discovery. No ranking or AI-answer inclusion is guaranteed. Public deployment, Search Console registration and domain-specific canonical URLs remain deployment tasks.

## Verify

`npm run build` and `npm test`. `node scripts/verifyPrivateV2.mjs` runs browser checks against the updated local server (use `IMICALL_TEST_URL` to select another port). Fake microphone devices verify call setup, packet flow and teardown, not real mobile hardware or production push delivery.
