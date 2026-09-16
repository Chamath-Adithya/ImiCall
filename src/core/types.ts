export type SignalProfile = 'extreme' | 'balanced' | 'hd';

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
  extreme: {
    id: 'extreme',
    name: '1-Bar / Extreme 2G',
    badge: '⚡ 6 kbps',
    bitrate: 6000,
    ptime: 60,
    maxptime: 60,
    useFec: true,
    useDtx: true,
    description: 'Minimal packets, 66% header reduction, maximum error recovery for spotty signals.',
  },
  balanced: {
    id: 'balanced',
    name: 'Weak 3G / Low 4G',
    badge: '🛡️ 12 kbps',
    bitrate: 12000,
    ptime: 40,
    maxptime: 60,
    useFec: true,
    useDtx: true,
    description: 'Optimized voice clarity with active packet recovery.',
  },
  hd: {
    id: 'hd',
    name: 'Standard / Wi-Fi',
    badge: '💎 28 kbps',
    bitrate: 28000,
    ptime: 20,
    maxptime: 40,
    useFec: true,
    useDtx: false,
    description: 'High fidelity audio for stable networks.',
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
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected'
  | 'error';
