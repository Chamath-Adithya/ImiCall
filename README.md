# 📡 ImiCall — Ultra-Low Bandwidth Private Calling Room

> **Zero-Trust E2EE WebRTC Audio Calling for Extreme Low-Signal (1-Bar / 2G / Rural) Networks.**

[![Tests](https://img.shields.io/badge/tests-passing-brightgreen.svg)]()
[![WebRTC](https://img.shields.io/badge/WebRTC-Insertable%20Streams-blue.svg)]()
[![Opus](https://img.shields.io/badge/Opus-6--8%20kbps%20Tuned-orange.svg)]()
[![Cloudflare](https://img.shields.io/badge/Cloudflare-Edge%20Signaling-F38020.svg)]()
[![License](https://img.shields.io/badge/license-MIT-green.svg)]()

---

## 🎯 The Problem

Mainstream calling apps like **WhatsApp, Messenger, and Telegram** fail in low-signal and rural environments because their audio engines are tuned for standard 3G/4G/Wi-Fi:
1. **High Bandwidth Usage**: WhatsApp typically consumes **24 kbps to 36 kbps** for audio.
2. **Aggressive Packet Frequency (20ms frames)**: Sends 50 packets every second, causing massive IP/UDP/RTP packet header overhead.
3. **Sensitive Timeouts**: When packet loss exceeds 20-30%, WhatsApp aggressively drops or stays stuck in `"Reconnecting..."`.

## 💡 The Solution: ImiCall

**ImiCall** is engineered from the ground up to maintain intelligible, unbroken voice calls in **1-bar signal conditions, 2G/EDGE networks, and heavy packet loss**:

- 🔔 **Synthesized Phone Ringing & Vibration**: When a partner dials, the receiver's phone rings with pleasant synthesized chime notes and vibrates (`navigator.vibrate`), while the caller hears realistic telephone ringback.
- 🔑 **Mandatory Secret Passcode (PIN `2023`)**: Both dialing and answering require PIN `2023`. Unlocks zero-trust AES-GCM encryption key derivation.
- 🎙️ **Voice Intelligibility Boost Filter**: 120Hz high-pass filter cuts wind/engine rumble, while a 3kHz vocal presence filter and dynamics compressor ensure quiet whispers are heard clearly.
- ⚡ **Opus Codec Deep Tuning (6 - 8 kbps)**: Drastically slashes audio data rates by up to 75% compared to standard VoIP.
- 📦 **60ms Packet Framing (`ptime=60`)**: Cuts packet count from 50 packets/sec to only **16.6 packets/sec**, eliminating over 60% of packet header network overhead and preventing cellular bufferbloat.
- 🛡️ **In-band Forward Error Correction (FEC)**: Automatically reconstructs dropped audio packets on-the-fly even with **30% - 40% packet loss**.
- 🤫 **Discontinuous Transmission (DTX)**: Halts transmission when nobody is speaking, saving cellular bandwidth and battery.
- 🔒 **Zero-Trust Client-Side E2EE**: Audio frames are encrypted directly inside the browser using **WebRTC Insertable Streams** and **AES-GCM-128**. Even the signaling server and Cloudflare Edge cannot listen in.
- 🚀 **Cloudflare Edge Low-Latency Signaling**: Ready to deploy onto Cloudflare Workers / Colombo PoP (`CMB`) for near-zero latency in Sri Lanka and globally.
- 💬 **Emergency RTCDataChannel Chat**: Instant text fallback over P2P DataChannel if voice quality drops temporarily.

---

## 📊 Signal Profile Matrix

| Profile | Target Bitrate | Frame Size (`ptime`) | FEC | DTX | Best For |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **⚡ 1-Bar / Extreme 2G** | **6 kbps** (Narrowband 8kHz) | **60 ms** (16 pkts/sec) | ✅ Forced | ✅ Active | Rural areas, 1-bar signal, high packet loss |
| **🛡️ Weak 3G / Low 4G** | **12 kbps** (Wideband 16kHz) | **40 ms** (25 pkts/sec) | ✅ Forced | ✅ Active | Fluctuating 3G/4G mobile connections |
| **💎 Standard / Wi-Fi** | **28 kbps** (Fullband 48kHz) | **20 ms** (50 pkts/sec) | ✅ Forced | ❌ Off | High fidelity audio on stable Wi-Fi / LTE |

---

## 🏗️ Architecture

```
[User A (Weak Signal Mobile)]
        │
        │ Opus (6-8 kbps + FEC + 60ms frames)
        │ AES-GCM Encrypted Media Frames (E2EE)
        ▼
[Cloudflare Edge / Colombo PoP]
   ├── WebSocket Signaling (Room Pairing)
   └── STUN / Cloudflare TURN Relay (NAT Traversal)
        ▲
        │ Decrypted locally via client-side passphrase (#key)
[User B (Calling Partner)]
```

> **Client-Side Secret Passing**: The room key is appended to the URL fragment `#room=...&key=...`. As per standard HTTP specifications, the fragment `#` is **never transmitted to the server**, ensuring absolute zero-knowledge encryption.

---

## 🔬 Scientific Foundations & Research Papers

1. **RFC 6716**: *Definition of the Opus Audio Codec* (Valin, Vos, Terriberry, IETF).
2. **RFC 7587**: *RTP Payload Format for the Opus Speech and Audio Codec* (Spittka, Vos, Valin).
3. **RFC 2198 / RFC 5109**: *RTP Payload for Redundant Audio Data (RED) & Generic Forward Error Correction*.
4. **Google Congestion Control (GCC)**: *A Google Congestion Control Algorithm for Real-Time Communication* (draft-alvestrand-rmcat-congestion).
5. **RFC 9605 (SFrame)**: *Secure Frame Protocol for End-to-End Media Encryption*.
6. **Neural Audio Compression**:
   - *Lyra: A New Very Low-Bitrate Speech Codec* (Kleijn et al., Google Research, 2021).
   - *High Fidelity Neural Audio Compression* (Défossez et al., Meta AI Research, 2022).

---

## 🚀 Quick Start (Local Development)

### 1. Prerequisites
- Node.js >= 18.x
- npm >= 9.x

### 2. Installation
```bash
git clone https://github.com/Chamath-Adithya/ImiCall.git
cd ImiCall
npm install
```

### 3. Run Automated Tests
```bash
npm test
```

### 4. Start Local Development
Start the local signaling server:
```bash
npm run server
```

In a second terminal, launch the Vite dev server:
```bash
npm run dev
```

Open `http://localhost:3000` in your mobile browser or desktop.

---

## 🌐 Deploying to Cloudflare (Production)

### Deploy Signaling to Cloudflare Workers (Global Edge):
1. Install Wrangler CLI:
   ```bash
   npm install -g wrangler
   ```
2. Login to your Cloudflare account:
   ```bash
   wrangler login
   ```
3. Deploy the Edge Signaling Worker:
   ```bash
   wrangler deploy
   ```

### Deploy Frontend:
Build the production assets:
```bash
npm run build
```
Deploy the `dist/` folder directly to **Cloudflare Pages**, **Vercel**, or any static web host.

---

## 🔒 Security Model

- **Signal Encryption**: Standard DTLS-SRTP (RFC 3711) is applied to all WebRTC peer connections.
- **Application-Layer E2EE**: WebRTC Insertable Streams encrypt raw Opus payloads with **AES-GCM (128-bit key)** derived via SHA-256 from your passphrase.
- **Zero-Trust**: Neither the signaling server nor intermediate TURN relays possess keys to decrypt the media stream.

---

## 📄 License
MIT License. Created by [Chamath Adithya](https://github.com/Chamath-Adithya).
