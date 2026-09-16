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
            <Activity size={20} color="#10b981" />
            <h3 style={{ fontSize: '1.1rem', fontWeight: 700 }}>Signal & WebRTC Diagnostics</h3>
          </div>
          <button className="btn btn-secondary" style={{ padding: '0.4rem' }} onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {/* Security & Room */}
          <div style={{ background: 'rgba(255,255,255,0.03)', padding: '0.85rem', borderRadius: '8px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.4rem' }}>
              <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>Room ID</span>
              <span style={{ fontSize: '0.85rem', fontFamily: 'monospace', color: '#f8fafc' }}>{roomId}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>End-to-End Encryption</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.8rem', color: '#10b981' }}>
                <ShieldCheck size={15} /> {isE2eeActive ? 'AES-GCM (Active)' : 'DTLS-SRTP'}
              </span>
            </div>
          </div>

          {/* Signal Tuning */}
          <div style={{ background: 'rgba(255,255,255,0.03)', padding: '0.85rem', borderRadius: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '0.5rem' }}>
              <Zap size={16} color="#06b6d4" />
              <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>Active Opus SDP Tuning</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', fontSize: '0.78rem' }}>
              <div>Target Bitrate: <strong style={{ color: '#10b981' }}>{currentProfile.bitrate / 1000} kbps</strong></div>
              <div>Packet Frame: <strong style={{ color: '#06b6d4' }}>{currentProfile.ptime} ms</strong></div>
              <div>In-band FEC: <strong style={{ color: '#10b981' }}>Enforced (1)</strong></div>
              <div>DTX (Silence Sup): <strong style={{ color: '#10b981' }}>{currentProfile.useDtx ? 'Active' : 'Off'}</strong></div>
            </div>
          </div>

          {/* Real-Time Network Quality */}
          <div style={{ background: 'rgba(255,255,255,0.03)', padding: '0.85rem', borderRadius: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '0.5rem' }}>
              <Radio size={16} color="#f59e0b" />
              <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>Live Telemetry</span>
            </div>
            {stats ? (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', fontSize: '0.78rem' }}>
                <div>Round Trip (RTT): <strong>{stats.rtt} ms</strong></div>
                <div>Packet Loss: <strong style={{ color: stats.packetLoss > 10 ? '#ef4444' : '#10b981' }}>{stats.packetLoss}%</strong></div>
                <div>Jitter: <strong>{stats.jitter} ms</strong></div>
                <div>Relay Type: <strong style={{ textTransform: 'uppercase' }}>{stats.candidateType}</strong></div>
                <div>Recv Bandwidth: <strong>{stats.bitrateReceived} kbps</strong></div>
                <div>Sent Bandwidth: <strong>{stats.bitrateSent} kbps</strong></div>
              </div>
            ) : (
              <div style={{ fontSize: '0.78rem', color: '#64748b' }}>Waiting for media stream handshake...</div>
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
