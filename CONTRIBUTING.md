# Contributing to ImiCall

Help make the first conversation easier, especially on modest devices and weak networks. The maintainer must finalize the license before accepting community contributions for public release.

## Local setup

Use Node 24 (minimum 22.12). Run `npm ci`, then `npm start`. The app and signaling server are available at `http://localhost:8080`.

Run `npm test` and `npm run build`. Browser scripts in `scripts/` use Chrome and fake microphones for reproducible local checks. They do not replace physical iPhone, Pixel or real-network testing. Existing call tests explicitly select Direct mode because no local TURN relay is provided.

## Useful contributions

- Reproduce a permission or audio issue on a named browser/device version.
- Improve keyboard, screen-reader, touch or narrow-screen usability.
- Review signaling validation, bounds, encrypted backups and relay behavior.
- Measure packet loss, latency and load performance without overclaiming results.
- Improve an explanation or add a focused regression test for a real bug.

Keep changes scoped. Explain the problem, resulting behavior and validation in the pull request. Avoid large dependencies for small features. Preserve default-off voice effects, explicit permissions and relay-only fail-closed behavior.

## Protect private data

Never include complete invitation links, contact exports, recordings, credentials, push addresses or personal data in public issues. Use fresh synthetic examples. Security vulnerabilities belong in a private report; see SECURITY.md.

Read the README privacy model before changing claims. Encryption is not total anonymity, local deletion is not revocation, and a desktop browser simulation is not a real 2G or mobile-device certification.
