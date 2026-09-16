import React, { useState, useEffect, useRef } from 'react';
import {
  Phone,
  PhoneOff,
  PhoneCall,
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
  BellRing,
  CheckCircle2,
} from 'lucide-react';
import { SignalProfile, NetworkStats, ChatMessage, CallState, SIGNAL_PROFILES, REQUIRED_PASSCODE } from './core/types';
import { WebRTCClient } from './core/webrtcClient';
import { AudioWaveform } from './components/AudioWaveform';
import { DiagnosticsModal } from './components/DiagnosticsModal';
import { QrModal } from './components/QrModal';
import { ChatDrawer } from './components/ChatDrawer';

export const App: React.FC = () => {
  // Room & Auth State
  const [roomId, setRoomId] = useState<string>('');
  const [passcode, setPasscode] = useState<string>(REQUIRED_PASSCODE);
  const [incomingPin, setIncomingPin] = useState<string>(REQUIRED_PASSCODE);
  const [selectedProfile, setSelectedProfile] = useState<SignalProfile>('extreme');
  const [callState, setCallState] = useState<CallState>('idle');
  const [isPeerInRoom, setIsPeerInRoom] = useState<boolean>(false);

  // In-Call Controls
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [networkStats, setNetworkStats] = useState<NetworkStats | null>(null);
  const [localVolume, setLocalVolume] = useState<number>(0);
  const [remoteVolume, setRemoteVolume] = useState<number>(0);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [hasUnreadChat, setHasUnreadChat] = useState<boolean>(false);

  // Modals
  const [isDiagnosticsOpen, setIsDiagnosticsOpen] = useState<boolean>(false);
  const [isQrOpen, setIsQrOpen] = useState<boolean>(false);
  const [isChatOpen, setIsChatOpen] = useState<boolean>(false);
  const [copiedLink, setCopiedLink] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Refs
  const clientRef = useRef<WebRTCClient | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const volumeIntervalRef = useRef<any>(null);

  // Parse URL Hash on mount
  useEffect(() => {
    const hash = window.location.hash.substring(1);
    const params = new URLSearchParams(hash);
    const roomParam = params.get('room');
    const pinParam = params.get('pin');

    if (roomParam) {
      setRoomId(roomParam);
    } else {
      const rand = Math.floor(100000 + Math.random() * 900000);
      setRoomId(`imi-${rand}`);
    }

    if (pinParam) {
      setPasscode(pinParam);
      setIncomingPin(pinParam);
    } else {
      setPasscode(REQUIRED_PASSCODE);
      setIncomingPin(REQUIRED_PASSCODE);
    }
  }, []);

  // Poll volume for VU meter
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

  const getInviteUrl = () => {
    const url = new URL(window.location.href);
    url.hash = `room=${encodeURIComponent(roomId)}&pin=${encodeURIComponent(passcode)}`;
    return url.toString();
  };

  const handleCopyInvite = () => {
    navigator.clipboard.writeText(getInviteUrl());
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  // Join Room & Initialize Audio Engine
  const handleJoinRoom = async () => {
    if (!roomId.trim()) {
      setErrorMessage('Please provide a room ID');
      return;
    }

    if (passcode.trim() !== REQUIRED_PASSCODE) {
      setErrorMessage(`Mandatory passcode "${REQUIRED_PASSCODE}" is required to enter room.`);
      return;
    }

    setErrorMessage(null);

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const signalingHost = window.location.hostname || 'localhost';
    const signalingPort = '8080';
    const signalingUrl = `${protocol}//${signalingHost}:${signalingPort}`;

    const client = new WebRTCClient({
      signalingUrl,
      roomId: roomId.trim().toLowerCase(),
      passcode: passcode.trim(),
      profile: selectedProfile,
    });

    client.onStateChange = (newState) => {
      setCallState(newState);
      if (newState === 'error') {
        setErrorMessage('Failed to connect to room.');
      }
    };

    client.onPeerStatusChange = (inRoom) => {
      setIsPeerInRoom(inRoom);
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
      if (!isChatOpen) setHasUnreadChat(true);
    };

    client.onProfileChange = (newProfile) => {
      setSelectedProfile(newProfile);
    };

    client.onError = (err) => {
      setErrorMessage(err);
    };

    clientRef.current = client;
    await client.start();
  };

  // Caller dials partner
  const handleRingPartner = async () => {
    if (!clientRef.current) return;
    setErrorMessage(null);
    const success = await clientRef.current.ringPartner(passcode);
    if (!success) {
      setErrorMessage(`Passcode must be ${REQUIRED_PASSCODE}`);
    }
  };

  // Callee answers
  const handleAnswerCall = async () => {
    if (!clientRef.current) return;
    setErrorMessage(null);
    const success = await clientRef.current.acceptIncomingCall(incomingPin);
    if (!success) {
      setErrorMessage(`Incorrect Passcode! Must enter "${REQUIRED_PASSCODE}" to answer.`);
    }
  };

  // Callee declines
  const handleDeclineCall = () => {
    if (clientRef.current) {
      clientRef.current.declineIncomingCall();
    }
  };

  // Caller cancels ringing
  const handleCancelCall = () => {
    if (clientRef.current) {
      clientRef.current.cancelOutgoingCall();
    }
  };

  // Hangup active call
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
      <audio ref={remoteAudioRef} autoPlay playsInline />

      {/* Header */}
      <header className="app-header">
        <div className="brand-wrapper">
          <div className="brand-icon">
            <Radio size={24} />
          </div>
          <div>
            <h1 className="brand-title">ImiCall</h1>
            <p className="brand-tagline">Low-Bandwidth WebRTC Calling • Voice Filter & Ringing Engine</p>
          </div>
        </div>

        <div className="header-badges">
          <div className="badge-e2ee">
            <ShieldCheck size={14} />
            <span>Passcode PIN ({passcode})</span>
          </div>
        </div>
      </header>

      {/* Error Alert */}
      {errorMessage && (
        <div
          style={{
            background: 'rgba(239, 68, 68, 0.15)',
            border: '1px solid rgba(239, 68, 68, 0.4)',
            borderRadius: '10px',
            padding: '0.85rem 1rem',
            color: '#ef4444',
            fontSize: '0.85rem',
            marginBottom: '1.25rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <span>{errorMessage}</span>
          <button
            style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontWeight: 700 }}
            onClick={() => setErrorMessage(null)}
          >
            ✕
          </button>
        </div>
      )}

      {/* VIEW 1: INITIAL SETUP & PASSCODE ENTRY */}
      {callState === 'idle' || callState === 'error' ? (
        <div className="setup-grid">
          <div className="glass-panel">
            <h2 className="panel-title">
              <Sparkles size={18} color="#10b981" /> Private Calling Room
            </h2>
            <p className="panel-subtitle">
              Low-signal private room with synthesized ringing and mandatory Passcode protection.
            </p>

            <div className="input-group">
              <label className="input-label">Room Identifier</label>
              <input
                type="text"
                className="input-field mono"
                value={roomId}
                onChange={(e) => setRoomId(e.target.value)}
                placeholder="e.g. imi-948-219"
              />
            </div>

            <div className="input-group">
              <label className="input-label" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <Lock size={14} /> Passcode (PIN 2023 Required)
              </label>
              <input
                type="text"
                className="input-field mono"
                value={passcode}
                onChange={(e) => setPasscode(e.target.value)}
                placeholder="2023"
              />
              <span style={{ fontSize: '0.72rem', color: '#10b981', marginTop: '0.35rem', display: 'flex', alignItems: 'center', gap: '4px' }}>
                <CheckCircle2 size={12} /> Mandatory secret passcode {REQUIRED_PASSCODE} enforced for dialing and answering.
              </span>
            </div>

            <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.5rem' }}>
              <button className="btn btn-primary btn-full" onClick={handleJoinRoom}>
                <Phone size={18} /> Join Room
              </button>
              <button className="btn btn-secondary" title="Scan QR" onClick={() => setIsQrOpen(true)}>
                <QrCode size={18} />
              </button>
              <button className="btn btn-secondary" title="Copy Link" onClick={handleCopyInvite}>
                {copiedLink ? <Check size={18} color="#10b981" /> : <Copy size={18} />}
              </button>
            </div>
          </div>

          <div className="glass-panel">
            <h2 className="panel-title">
              <Zap size={18} color="#06b6d4" /> Signal & Codec Profile
            </h2>
            <p className="panel-subtitle">
              Opus audio engine is tuned to operate reliably down to 6 kbps with 60ms frames.
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
                <span><strong>Speech Clarity Filter:</strong> Active (120Hz Low-Cut + 3kHz Vocal Peaking + Dynamics Compressor).</span>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* VIEW 2: ROOM STANDBY / WAITING TO RING */}
      {callState === 'waiting' && (
        <div className="glass-panel" style={{ textAlign: 'center', padding: '3rem 1.5rem', maxWidth: '560px', margin: '0 auto' }}>
          <div style={{ width: '64px', height: '64px', borderRadius: '50%', background: 'rgba(16, 185, 129, 0.15)', border: '2px solid #10b981', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.5rem', color: '#10b981' }}>
            <Radio size={30} />
          </div>

          <h2 style={{ fontSize: '1.35rem', fontWeight: 800, marginBottom: '0.5rem' }}>Calling Room Ready</h2>
          <p style={{ fontSize: '0.88rem', color: '#94a3b8', marginBottom: '1.75rem' }}>
            Room <strong style={{ color: '#f8fafc', fontFamily: 'monospace' }}>{roomId}</strong> • Passcode Protected (<strong style={{ color: '#10b981' }}>{passcode}</strong>)
          </p>

          <div style={{ background: 'rgba(10, 14, 23, 0.6)', border: '1px solid var(--border-card)', borderRadius: '12px', padding: '1rem', marginBottom: '2rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '0.85rem', color: '#94a3b8' }}>Partner Status:</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem', fontWeight: 600, color: isPeerInRoom ? '#10b981' : '#f59e0b' }}>
                <span className="pulse-dot" />
                {isPeerInRoom ? 'Partner is in Room' : 'Waiting for Partner to open link...'}
              </span>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
            <button
              className="btn btn-primary btn-full"
              style={{ padding: '0.95rem', fontSize: '1rem' }}
              onClick={handleRingPartner}
            >
              <PhoneCall size={20} /> Ring Partner Phone
            </button>

            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button className="btn btn-secondary btn-full" onClick={handleCopyInvite}>
                {copiedLink ? <Check size={16} color="#10b981" /> : <Copy size={16} />}
                {copiedLink ? 'Link Copied!' : 'Copy Invite Link'}
              </button>
              <button className="btn btn-secondary" onClick={() => setIsQrOpen(true)}>
                <QrCode size={18} />
              </button>
            </div>

            <button className="btn btn-secondary btn-full" style={{ marginTop: '0.5rem', color: '#94a3b8' }} onClick={handleEndCall}>
              Leave Room
            </button>
          </div>
        </div>
      )}

      {/* VIEW 3: OUTGOING CALLING (CALLER SCREEN) */}
      {callState === 'ringing-outgoing' && (
        <div className="glass-panel" style={{ textAlign: 'center', padding: '3.5rem 1.5rem', maxWidth: '480px', margin: '0 auto' }}>
          <div
            style={{
              width: '88px',
              height: '88px',
              borderRadius: '50%',
              background: 'rgba(6, 182, 212, 0.15)',
              border: '2px solid #06b6d4',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 1.5rem',
              color: '#06b6d4',
              boxShadow: '0 0 30px rgba(6, 182, 212, 0.4)',
              animation: 'pulse 1.8s infinite',
            }}
          >
            <BellRing size={40} />
          </div>

          <h2 style={{ fontSize: '1.4rem', fontWeight: 800, marginBottom: '0.5rem' }}>Calling Partner...</h2>
          <p style={{ fontSize: '0.88rem', color: '#94a3b8', marginBottom: '2.5rem' }}>
            Phone is ringing. Waiting for partner to enter PIN {REQUIRED_PASSCODE} and answer.
          </p>

          <button className="btn btn-danger btn-full" style={{ padding: '0.9rem', fontSize: '1rem' }} onClick={handleCancelCall}>
            <PhoneOff size={18} /> Cancel Call
          </button>
        </div>
      )}

      {/* VIEW 4: INCOMING CALL ALERT (CALLEE SCREEN) */}
      {callState === 'ringing-incoming' && (
        <div className="modal-backdrop">
          <div className="modal-card" style={{ textAlign: 'center', padding: '2.5rem 1.75rem' }}>
            <div
              style={{
                width: '88px',
                height: '88px',
                borderRadius: '50%',
                background: 'rgba(16, 185, 129, 0.2)',
                border: '2px solid #10b981',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 1.25rem',
                color: '#10b981',
                boxShadow: '0 0 35px rgba(16, 185, 129, 0.5)',
                animation: 'pulse 1.2s infinite',
              }}
            >
              <PhoneCall size={42} />
            </div>

            <h2 style={{ fontSize: '1.4rem', fontWeight: 800, marginBottom: '0.4rem' }}>Incoming Private Call!</h2>
            <p style={{ fontSize: '0.85rem', color: '#94a3b8', marginBottom: '1.5rem' }}>
              Partner is calling you in room <strong style={{ color: '#fff' }}>{roomId}</strong>. Enter secret Passcode to unlock and answer:
            </p>

            <div className="input-group" style={{ marginBottom: '1.5rem' }}>
              <label className="input-label" style={{ textAlign: 'left' }}>Passcode (PIN 2023 Required)</label>
              <input
                type="text"
                className="input-field mono"
                style={{ textAlign: 'center', fontSize: '1.2rem', letterSpacing: '0.2em' }}
                value={incomingPin}
                onChange={(e) => setIncomingPin(e.target.value)}
                placeholder="2023"
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <button className="btn btn-primary" style={{ padding: '0.85rem' }} onClick={handleAnswerCall}>
                <Phone size={18} /> Answer Call
              </button>
              <button className="btn btn-danger" style={{ padding: '0.85rem' }} onClick={handleDeclineCall}>
                <PhoneOff size={18} /> Decline
              </button>
            </div>
          </div>
        </div>
      )}

      {/* VIEW 5: ACTIVE CALL SCREEN */}
      {(callState === 'connecting' || callState === 'connected' || callState === 'reconnecting') && (
        <div className="glass-panel call-active-container">
          <div
            className={`call-status-pill ${
              callState === 'connected'
                ? 'status-connected'
                : 'status-connecting'
            }`}
          >
            <span className="pulse-dot" />
            <span>
              {callState === 'connected'
                ? 'Call Active • PIN 2023 Encrypted'
                : 'Establishing Low-Latency PeerConnection...'}
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
            <div className="avatar-wrapper">
              <div className={`avatar-disc ${localVolume > 5 && !isMuted ? 'speaking' : ''}`}>
                {isMuted ? <MicOff size={36} color="#ef4444" /> : <Mic size={36} color="#10b981" />}
              </div>
              <span className="avatar-label">You {isMuted && '(Muted)'}</span>
              <AudioWaveform volume={localVolume} isActive={!isMuted} color="#10b981" />
            </div>

            <div className="avatar-wrapper">
              <div className={`avatar-disc ${remoteVolume > 5 ? 'speaking' : ''}`}>
                <Volume2 size={36} color={callState === 'connected' ? '#06b6d4' : '#64748b'} />
              </div>
              <span className="avatar-label">Partner</span>
              <AudioWaveform volume={remoteVolume} isActive={callState === 'connected'} color="#06b6d4" />
            </div>
          </div>

          {/* Live Metrics */}
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
              <div className="metric-label">Jitter Target</div>
              <div className="metric-value good">
                {networkStats ? `${networkStats.jitter}ms` : '40ms'}
              </div>
            </div>
            <div className="metric-box">
              <div className="metric-label">Profile</div>
              <div className="metric-value good" style={{ fontSize: '0.9rem' }}>
                {SIGNAL_PROFILES[selectedProfile].badge}
              </div>
            </div>
          </div>

          {/* Profile Switcher */}
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

          {/* Actions */}
          <div className="call-actions-bar">
            <button
              className={`btn btn-icon ${isMuted ? 'btn-danger' : 'btn-secondary'}`}
              onClick={handleToggleMute}
              title={isMuted ? 'Unmute Mic' : 'Mute Mic'}
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
              title="Emergency Text"
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
              title="Diagnostics"
            >
              <Activity size={22} />
            </button>

            <button
              className="btn btn-icon btn-secondary"
              onClick={() => setIsQrOpen(true)}
              title="QR Code"
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

      {/* Modals */}
      <DiagnosticsModal
        isOpen={isDiagnosticsOpen}
        onClose={() => setIsDiagnosticsOpen(false)}
        stats={networkStats}
        profile={selectedProfile}
        isE2eeActive={true}
        roomId={roomId}
      />

      <QrModal
        isOpen={isQrOpen}
        onClose={() => setIsQrOpen(false)}
        inviteUrl={getInviteUrl()}
      />

      <ChatDrawer
        isOpen={isChatOpen}
        onClose={() => setIsChatOpen(false)}
        messages={chatMessages}
        onSendMessage={handleSendMessage}
      />
    </div>
  );
};
