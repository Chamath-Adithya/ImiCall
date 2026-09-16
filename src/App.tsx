import React, { useState, useEffect, useRef } from 'react';
import {
  Phone,
  PhoneOff,
  Mic,
  MicOff,
  ShieldCheck,
  Zap,
  Activity,
  MessageSquare,
  QrCode,
  Copy,
  Check,
  Radio,
  Lock,
  Wifi,
  Sparkles,
  Volume2,
} from 'lucide-react';
import { SignalProfile, NetworkStats, ChatMessage, CallState, SIGNAL_PROFILES } from './core/types';
import { WebRTCClient } from './core/webrtcClient';
import { AudioWaveform } from './components/AudioWaveform';
import { DiagnosticsModal } from './components/DiagnosticsModal';
import { QrModal } from './components/QrModal';
import { ChatDrawer } from './components/ChatDrawer';

export const App: React.FC = () => {
  // State
  const [roomId, setRoomId] = useState<string>('');
  const [passphrase, setPassphrase] = useState<string>('');
  const [selectedProfile, setSelectedProfile] = useState<SignalProfile>('extreme');
  const [callState, setCallState] = useState<CallState>('idle');
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [networkStats, setNetworkStats] = useState<NetworkStats | null>(null);
  const [localVolume, setLocalVolume] = useState<number>(0);
  const [remoteVolume, setRemoteVolume] = useState<number>(0);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [hasUnreadChat, setHasUnreadChat] = useState<boolean>(false);

  // Modals & Panels
  const [isDiagnosticsOpen, setIsDiagnosticsOpen] = useState<boolean>(false);
  const [isQrOpen, setIsQrOpen] = useState<boolean>(false);
  const [isChatOpen, setIsChatOpen] = useState<boolean>(false);
  const [copiedLink, setCopiedLink] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // References
  const clientRef = useRef<WebRTCClient | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const volumeIntervalRef = useRef<any>(null);

  // Parse URL Hash on load (#room=...&key=...)
  useEffect(() => {
    const hash = window.location.hash.substring(1);
    const params = new URLSearchParams(hash);
    const roomParam = params.get('room');
    const keyParam = params.get('key');

    if (roomParam) {
      setRoomId(roomParam);
    } else {
      // Generate standard random room code
      const rand = Math.floor(100000 + Math.random() * 900000);
      setRoomId(`imi-${rand}`);
    }

    if (keyParam) {
      setPassphrase(keyParam);
    } else {
      // Default generated room secret
      const randomKey = Math.random().toString(36).substring(2, 10);
      setPassphrase(randomKey);
    }
  }, []);

  // Poll audio volume for live visualizer
  useEffect(() => {
    if (callState === 'connected') {
      volumeIntervalRef.current = setInterval(() => {
        if (clientRef.current) {
          setLocalVolume(clientRef.current.audioManager.getLocalVolume());
          setRemoteVolume(clientRef.current.audioManager.getRemoteVolume());
        }
      }, 80);
    } else {
      if (volumeIntervalRef.current) {
        clearInterval(volumeIntervalRef.current);
        volumeIntervalRef.current = null;
      }
      setLocalVolume(0);
      setRemoteVolume(0);
    }

    return () => {
      if (volumeIntervalRef.current) {
        clearInterval(volumeIntervalRef.current);
      }
    };
  }, [callState]);

  // Construct invite link
  const getInviteUrl = () => {
    const url = new URL(window.location.href);
    url.hash = `room=${encodeURIComponent(roomId)}&key=${encodeURIComponent(passphrase)}`;
    return url.toString();
  };

  const handleCopyInvite = () => {
    navigator.clipboard.writeText(getInviteUrl());
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const handleStartCall = async () => {
    if (!roomId.trim()) {
      setErrorMessage('Please enter a valid room ID');
      return;
    }

    setErrorMessage(null);

    // Determine signaling server URL
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const signalingHost = window.location.hostname || 'localhost';
    const signalingPort = '8080';
    const signalingUrl = `${protocol}//${signalingHost}:${signalingPort}`;

    const client = new WebRTCClient({
      signalingUrl,
      roomId: roomId.trim().toLowerCase(),
      passphrase: passphrase.trim(),
      profile: selectedProfile,
    });

    client.onStateChange = (newState) => {
      setCallState(newState);
      if (newState === 'error') {
        setErrorMessage('Failed to connect to calling room.');
      }
    };

    client.onStatsUpdate = (stats) => {
      setNetworkStats(stats);
    };

    client.onRemoteStream = (stream) => {
      if (remoteAudioRef.current) {
        client.audioManager.setupRemoteAudio(stream, remoteAudioRef.current);
      }
    };

    client.onChatMessage = (msg) => {
      setChatMessages((prev) => [...prev, msg]);
      if (!isChatOpen) {
        setHasUnreadChat(true);
      }
    };

    client.onProfileChange = (newProfile) => {
      setSelectedProfile(newProfile);
    };

    client.onError = (err) => {
      setErrorMessage(err);
      setCallState('error');
    };

    clientRef.current = client;
    await client.start();
  };

  const handleEndCall = () => {
    if (clientRef.current) {
      clientRef.current.close();
      clientRef.current = null;
    }
    setCallState('idle');
    setNetworkStats(null);
    setChatMessages([]);
  };

  const handleToggleMute = () => {
    if (clientRef.current) {
      const muted = clientRef.current.audioManager.toggleMute();
      setIsMuted(muted);
    }
  };

  const handleProfileSwitch = (profileKey: SignalProfile) => {
    setSelectedProfile(profileKey);
    if (clientRef.current) {
      clientRef.current.setProfile(profileKey);
    }
  };

  const handleSendMessage = (text: string) => {
    if (clientRef.current) {
      const msg = clientRef.current.sendChatMessage(text);
      if (msg) {
        setChatMessages((prev) => [...prev, msg]);
      }
    }
  };

  return (
    <div className="app-container">
      {/* Hidden remote audio element */}
      <audio ref={remoteAudioRef} autoPlay playsInline />

      {/* Header */}
      <header className="app-header">
        <div className="brand-wrapper">
          <div className="brand-icon">
            <Radio size={24} />
          </div>
          <div>
            <h1 className="brand-title">ImiCall</h1>
            <p className="brand-tagline">Resilient Rural WebRTC Calling • 6kbps Ultra-Low Bandwidth</p>
          </div>
        </div>

        <div className="header-badges">
          <div className="badge-e2ee">
            <ShieldCheck size={14} />
            <span>Zero-Trust E2EE</span>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      {callState === 'idle' || callState === 'error' ? (
        <div className="setup-grid">
          {/* Room Configuration Panel */}
          <div className="glass-panel">
            <h2 className="panel-title">
              <Sparkles size={18} color="#10b981" /> Private Calling Room
            </h2>
            <p className="panel-subtitle">
              Engineered for extreme 1-bar cellular signals, rural connections, and high packet loss networks where WhatsApp fails.
            </p>

            {errorMessage && (
              <div
                style={{
                  background: 'rgba(239, 68, 68, 0.15)',
                  border: '1px solid rgba(239, 68, 68, 0.4)',
                  borderRadius: '8px',
                  padding: '0.75rem',
                  color: '#ef4444',
                  fontSize: '0.85rem',
                  marginBottom: '1rem',
                }}
              >
                {errorMessage}
              </div>
            )}

            <div className="input-group">
              <label className="input-label">Room Identifier</label>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <input
                  type="text"
                  className="input-field mono"
                  value={roomId}
                  onChange={(e) => setRoomId(e.target.value)}
                  placeholder="e.g. imi-384-912"
                />
              </div>
            </div>

            <div className="input-group">
              <label className="input-label" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <Lock size={14} /> Secret Passphrase (E2EE Client Key)
              </label>
              <input
                type="text"
                className="input-field mono"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                placeholder="Private Encryption Passphrase"
              />
              <span style={{ fontSize: '0.7rem', color: '#64748b', marginTop: '0.3rem', display: 'block' }}>
                This key never leaves your browser. Audio frames are encrypted locally with AES-GCM.
              </span>
            </div>

            <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.5rem' }}>
              <button className="btn btn-primary btn-full" onClick={handleStartCall}>
                <Phone size={18} /> Enter Calling Room
              </button>
              <button
                className="btn btn-secondary"
                title="Share QR Code"
                onClick={() => setIsQrOpen(true)}
              >
                <QrCode size={18} />
              </button>
              <button
                className="btn btn-secondary"
                title="Copy Invite Link"
                onClick={handleCopyInvite}
              >
                {copiedLink ? <Check size={18} color="#10b981" /> : <Copy size={18} />}
              </button>
            </div>
          </div>

          {/* Low Bandwidth Profiles Panel */}
          <div className="glass-panel">
            <h2 className="panel-title">
              <Zap size={18} color="#06b6d4" /> Signal & Codec Profile
            </h2>
            <p className="panel-subtitle">
              Select your network condition. Opus SDP parameters will dynamically tune bitrate, ptime frames, and forward error correction.
            </p>

            <div className="profile-cards">
              {(Object.keys(SIGNAL_PROFILES) as SignalProfile[]).map((key) => {
                const p = SIGNAL_PROFILES[key];
                const isSelected = selectedProfile === key;
                return (
                  <div
                    key={key}
                    className={`profile-card ${isSelected ? 'active' : ''}`}
                    onClick={() => handleProfileSwitch(key)}
                  >
                    <div>
                      <div className="profile-title">{p.name}</div>
                      <div className="profile-desc">{p.description}</div>
                    </div>
                    <div className="profile-badge">{p.badge}</div>
                  </div>
                );
              })}
            </div>

            <div style={{ background: 'rgba(255,255,255,0.02)', padding: '0.85rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.78rem', color: '#94a3b8' }}>
                <Wifi size={14} color="#10b981" />
                <span><strong>Recommended:</strong> Choose <strong>1-Bar / Extreme 2G</strong> when calling someone with weak reception.</span>
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* Active In-Call Room Screen */
        <div className="glass-panel call-active-container">
          {/* Status Badge */}
          <div
            className={`call-status-pill ${
              callState === 'connected'
                ? 'status-connected'
                : callState === 'waiting'
                ? 'status-waiting'
                : 'status-connecting'
            }`}
          >
            <span className="pulse-dot" />
            <span>
              {callState === 'connected'
                ? 'Call Active • End-to-End Encrypted'
                : callState === 'waiting'
                ? 'Waiting for Partner to Join Room...'
                : callState === 'connecting'
                ? 'Negotiating WebRTC Connection...'
                : 'Reconnecting Signal...'}
            </span>
          </div>

          <div style={{ marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ fontSize: '0.85rem', color: '#94a3b8' }}>Room:</span>
            <span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#f8fafc', background: 'rgba(255,255,255,0.06)', padding: '0.2rem 0.6rem', borderRadius: '4px' }}>
              {roomId}
            </span>
            <button className="btn btn-secondary" style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }} onClick={handleCopyInvite}>
              {copiedLink ? <Check size={14} color="#10b981" /> : <Copy size={14} />}
              {copiedLink ? 'Copied' : 'Invite'}
            </button>
          </div>

          {/* Dynamic Audio Waves & Avatars */}
          <div className="audio-avatars-container">
            {/* You */}
            <div className="avatar-wrapper">
              <div className={`avatar-disc ${localVolume > 5 && !isMuted ? 'speaking' : ''}`}>
                {isMuted ? <MicOff size={36} color="#ef4444" /> : <Mic size={36} color="#10b981" />}
              </div>
              <span className="avatar-label">You {isMuted && '(Muted)'}</span>
              <AudioWaveform volume={localVolume} isActive={!isMuted} color="#10b981" />
            </div>

            {/* Partner */}
            <div className="avatar-wrapper">
              <div className={`avatar-disc ${remoteVolume > 5 ? 'speaking' : ''}`}>
                <Volume2 size={36} color={callState === 'connected' ? '#06b6d4' : '#64748b'} />
              </div>
              <span className="avatar-label">
                {callState === 'connected' ? 'Partner' : 'Waiting...'}
              </span>
              <AudioWaveform volume={remoteVolume} isActive={callState === 'connected'} color="#06b6d4" />
            </div>
          </div>

          {/* Network Real-Time Metrics Strip */}
          <div className="metrics-strip">
            <div className="metric-box">
              <div className="metric-label">Latency (RTT)</div>
              <div className={`metric-value ${networkStats && networkStats.rtt > 300 ? 'poor' : 'good'}`}>
                {networkStats ? `${networkStats.rtt}ms` : '--'}
              </div>
            </div>
            <div className="metric-box">
              <div className="metric-label">Packet Loss</div>
              <div className={`metric-value ${networkStats && networkStats.packetLoss > 10 ? 'poor' : 'good'}`}>
                {networkStats ? `${networkStats.packetLoss}%` : '0%'}
              </div>
            </div>
            <div className="metric-box">
              <div className="metric-label">Jitter</div>
              <div className="metric-value">
                {networkStats ? `${networkStats.jitter}ms` : '--'}
              </div>
            </div>
            <div className="metric-box">
              <div className="metric-label">Signal Profile</div>
              <div className="metric-value good" style={{ fontSize: '0.9rem' }}>
                {SIGNAL_PROFILES[selectedProfile].badge}
              </div>
            </div>
          </div>

          {/* Live In-Call Profile Selector */}
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem' }}>
            {(Object.keys(SIGNAL_PROFILES) as SignalProfile[]).map((key) => (
              <button
                key={key}
                onClick={() => handleProfileSwitch(key)}
                className={`btn btn-secondary ${selectedProfile === key ? 'active' : ''}`}
                style={{
                  fontSize: '0.78rem',
                  padding: '0.4rem 0.8rem',
                  borderColor: selectedProfile === key ? '#10b981' : undefined,
                  background: selectedProfile === key ? 'rgba(16, 185, 129, 0.15)' : undefined,
                  color: selectedProfile === key ? '#10b981' : undefined,
                }}
              >
                {SIGNAL_PROFILES[key].badge}
              </button>
            ))}
          </div>

          {/* Bottom Action Bar */}
          <div className="call-actions-bar">
            <button
              className={`btn btn-icon ${isMuted ? 'btn-danger' : 'btn-secondary'}`}
              onClick={handleToggleMute}
              title={isMuted ? 'Unmute Microphone' : 'Mute Microphone'}
            >
              {isMuted ? <MicOff size={22} /> : <Mic size={22} />}
            </button>

            <button
              className="btn btn-icon btn-secondary"
              onClick={() => {
                setIsChatOpen(!isChatOpen);
                setHasUnreadChat(false);
              }}
              style={{ position: 'relative' }}
              title="Emergency Text Channel"
            >
              <MessageSquare size={22} />
              {hasUnreadChat && (
                <span
                  style={{
                    position: 'absolute',
                    top: '8px',
                    right: '8px',
                    width: '8px',
                    height: '8px',
                    borderRadius: '50%',
                    background: '#ef4444',
                  }}
                />
              )}
            </button>

            <button
              className="btn btn-icon btn-secondary"
              onClick={() => setIsDiagnosticsOpen(true)}
              title="Signal Diagnostics"
            >
              <Activity size={22} />
            </button>

            <button
              className="btn btn-icon btn-secondary"
              onClick={() => setIsQrOpen(true)}
              title="Share Room QR"
            >
              <QrCode size={22} />
            </button>

            <button
              className="btn btn-icon btn-danger"
              onClick={handleEndCall}
              title="End Call"
            >
              <PhoneOff size={22} />
            </button>
          </div>
        </div>
      )}

      {/* Diagnostics Modal */}
      <DiagnosticsModal
        isOpen={isDiagnosticsOpen}
        onClose={() => setIsDiagnosticsOpen(false)}
        stats={networkStats}
        profile={selectedProfile}
        isE2eeActive={Boolean(passphrase.trim())}
        roomId={roomId}
      />

      {/* QR Code Modal */}
      <QrModal
        isOpen={isQrOpen}
        onClose={() => setIsQrOpen(false)}
        inviteUrl={getInviteUrl()}
      />

      {/* Emergency Fallback Chat Drawer */}
      <ChatDrawer
        isOpen={isChatOpen}
        onClose={() => setIsChatOpen(false)}
        messages={chatMessages}
        onSendMessage={handleSendMessage}
      />
    </div>
  );
};
