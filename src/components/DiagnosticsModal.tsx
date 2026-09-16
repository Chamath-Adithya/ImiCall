import React from 'react';
import { X, Activity, ShieldCheck, Zap, Radio } from 'lucide-react';
import { NetworkStats, SignalProfile, SIGNAL_PROFILES } from '../core/types';

interface DiagnosticsModalProps {
  isOpen: boolean;
  onClose: () => void;
  stats: NetworkStats | null;
  profile: SignalProfile;
  isE2eeActive: boolean;
  roomId: string;
}

export const DiagnosticsModal: React.FC<DiagnosticsModalProps> = ({
  isOpen,
  onClose,
  stats,
  profile,
  isE2eeActive,
  roomId,
}) => {
  if (!isOpen) return null;

  const currentProfile = SIGNAL_PROFILES[profile];

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <Activity size={20} color="#249c6f" />
            <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#ffffff' }}>Signal & WebRTC Diagnostics</h3>
          </div>
          <button className="btn btn-secondary" style={{ padding: '0.4rem' }} onClick={onClose}>
            <X size={18} color="#ffffff" />
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {/* Security & Room */}
          <div style={{ background: '#181818', border: '0', padding: '0.85rem', borderRadius: '8px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.4rem' }}>
              <span style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.7)' }}>Room ID</span>
              <span style={{ fontSize: '0.85rem', fontFamily: 'monospace', color: '#ffffff', overflowWrap: 'anywhere', maxWidth: '65%' }}>{roomId}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.7)' }}>End-to-End Encryption</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.8rem', color: '#249c6f' }}>
                <ShieldCheck size={15} /> {isE2eeActive ? 'DTLS-SRTP · verified setup' : 'Not connected'}
              </span>
            </div>
          </div>

          {/* Signal Tuning */}
          <div style={{ background: '#181818', border: '0', padding: '0.85rem', borderRadius: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '0.5rem' }}>
              <Zap size={16} color="#249c6f" />
              <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#ffffff' }}>Active Opus SDP Tuning</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', fontSize: '0.78rem', color: 'rgba(255,255,255,0.85)' }}>
              <div>Target Bitrate: <strong style={{ color: '#249c6f' }}>{currentProfile.bitrate / 1000} kbps</strong></div>
              <div>Packet Frame: <strong style={{ color: '#ffffff' }}>{currentProfile.ptime} ms</strong></div>
              <div>In-band FEC: <strong style={{ color: '#249c6f' }}>Enforced (1)</strong></div>
              <div>DTX: <strong style={{ color: '#249c6f' }}>{currentProfile.useDtx ? 'Active' : 'Off'}</strong></div>
            </div>
          </div>

          {/* Real-Time Network Quality */}
          <div style={{ background: '#181818', border: '0', padding: '0.85rem', borderRadius: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '0.5rem' }}>
              <Radio size={16} color="#249c6f" />
              <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#ffffff' }}>Live Telemetry</span>
            </div>
            {stats ? (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', fontSize: '0.78rem', color: 'rgba(255,255,255,0.85)' }}>
                <div>Round Trip (RTT): <strong>{stats.rtt} ms</strong></div>
                <div>Packet Loss: <strong style={{ color: stats.packetLoss > 10 ? '#ffffff' : '#249c6f' }}>{stats.packetLoss}%</strong></div>
                <div>Jitter: <strong>{stats.jitter} ms</strong></div>
                <div>Relay Type: <strong style={{ textTransform: 'uppercase' }}>{stats.candidateType}</strong></div>
                <div>Recv Bandwidth: <strong>{stats.bitrateReceived} kbps</strong></div>
                <div>Sent Bandwidth: <strong>{stats.bitrateSent} kbps</strong></div>
              </div>
            ) : (
              <div style={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.45)' }}>Waiting for media stream handshake...</div>
            )}
          </div>
        </div>

        <button className="btn btn-secondary btn-full" style={{ marginTop: '1.25rem' }} onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
};
