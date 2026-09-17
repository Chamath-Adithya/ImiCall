export type SignalProfile = 'survival' | 'extreme' | 'balanced' | 'hd';

export interface ProfileConfig {
  id: SignalProfile;
  name: string;
  badge: string;
  bitrate: number; // in bps (e.g. 6000 for 6 kbps)
  ptime: number; // in ms (e.g. 60 for 60ms frames)
  maxptime: number;
  useFec: boolean;
  useDtx: boolean;
  description: string;
}

export const SIGNAL_PROFILES: Record<SignalProfile, ProfileConfig> = {
  survival: { id: 'survival', name: 'Very weak / 2G', badge: '6 kbps', bitrate: 6000, ptime: 60, maxptime: 60, useFec: true, useDtx: true, description: 'Speech first; reduced quality and fewer packets. Network overhead is additional.' },
  extreme: {
    id: 'extreme',
    name: 'Low Signal / 2G',
    badge: '⚡ 10 kbps',
    bitrate: 10000,
    ptime: 60,
    maxptime: 60,
    useFec: true,
    useDtx: true,
    description: 'Header reduction & FEC packet recovery for weak signal areas.',
  },
  balanced: {
    id: 'balanced',
    name: 'Clear Voice / 3G-4G',
    badge: '🛡️ 18 kbps',
    bitrate: 18000,
    ptime: 20,
    maxptime: 40,
    useFec: true,
    useDtx: true,
    description: 'Warm, natural vocal clarity with real-time error recovery.',
  },
  hd: {
    id: 'hd',
    name: 'Studio HD / Wi-Fi',
    badge: '💎 32 kbps',
    bitrate: 32000,
    ptime: 20,
    maxptime: 40,
    useFec: true,
    useDtx: false,
    description: 'Full studio audio quality for strong Wi-Fi or 5G connections.',
  },
};

export interface NetworkStats {
  rtt: number; // round-trip time in ms
  packetLoss: number; // percentage 0-100%
  jitter: number; // jitter in ms
  bitrateReceived: number; // kbps
  bitrateSent: number; // kbps
  qualityRating: 'excellent' | 'good' | 'fair' | 'poor' | 'critical';
  candidateType: string; // 'host' (direct P2P), 'srflx' (STUN), 'relay' (TURN)
}

export interface ChatMessage {
  id: string;
  sender: 'me' | 'peer';
  text: string;
  timestamp: number;
}

export type CallState =
  | 'idle'
  | 'creating'
  | 'waiting'
  | 'ringing-outgoing'
  | 'ringing-incoming'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected'
  | 'error';

