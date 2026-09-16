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
  Volume2,
  BellRing,
  Settings,
  RefreshCw,
  Share2,
} from 'lucide-react';
import { SignalProfile, NetworkStats, ChatMessage, CallState, SIGNAL_PROFILES, REQUIRED_PASSCODE } from './core/types';
import { WebRTCClient } from './core/webrtcClient';
import { AudioWaveform } from './components/AudioWaveform';
import { DiagnosticsModal } from './components/DiagnosticsModal';
import { QrModal } from './components/QrModal';
import { ChatDrawer } from './components/ChatDrawer';

const STORAGE_KEY = 'imicall_saved_tunnel_v1';

export const App: React.FC = () => {
  // Line & Auth State
  const [lineId, setLineId] = useState<string>('');
  const [passcode, setPasscode] = useState<string>(REQUIRED_PASSCODE);
  const [incomingPin, setIncomingPin] = useState<string>('');
  const [hasSavedLine, setHasSavedLine] = useState<boolean>(false);
  const [selectedProfile, setSelectedProfile] = useState<SignalProfile>('extreme');
  const [callState, setCallState] = useState<CallState>('idle');
  const [isPeerOnline, setIsPeerOnline] = useState<boolean>(false);

  // In-Call Controls
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [networkStats, setNetworkStats] = useState<NetworkStats | null>(null);
  const [localVolume, setLocalVolume] = useState<number>(0);
  const [remoteVolume, setRemoteVolume] = useState<number>(0);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [hasUnreadChat, setHasUnreadChat] = useState<boolean>(false);
  const [boostLevel, setBoostLevel] = useState<number>(2.2);

  // Modals & Sheets
  const [isDiagnosticsOpen, setIsDiagnosticsOpen] = useState<boolean>(false);
  const [isQrOpen, setIsQrOpen] = useState<boolean>(false);
  const [isChatOpen, setIsChatOpen] = useState<boolean>(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
  const [copiedLink, setCopiedLink] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Refs
  const clientRef = useRef<WebRTCClient | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const volumeIntervalRef = useRef<any>(null);

  // Load or Save Dedicated Line from URL or LocalStorage
  useEffect(() => {
    const hash = window.location.hash.substring(1);
    const params = new URLSearchParams(hash);
    const hashLine = params.get('line') || params.get('room');
    const hashPin = params.get('pin');

    if (hashLine) {
      const pinToUse = hashPin || REQUIRED_PASSCODE;
      setLineId(hashLine);
      setPasscode(pinToUse);
      // Save line to localStorage for permanent future access
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ lineId: hashLine, passcode: pinToUse }));
      setHasSavedLine(true);
      connectSavedLine(hashLine, pinToUse);
      return;
    }

    // Check LocalStorage
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed.lineId) {
          setLineId(parsed.lineId);
          setPasscode(parsed.passcode || REQUIRED_PASSCODE);
          setHasSavedLine(true);
          connectSavedLine(parsed.lineId, parsed.passcode || REQUIRED_PASSCODE);
          return;
        }
      } catch (e) {}
    }

    // First time visitor without saved line: create a default unique line ID
    const randomLine = 'line-' + Math.floor(1000 + Math.random() * 9000) + '-' + Math.floor(1000 + Math.random() * 9000);
    setLineId(randomLine);
    setPasscode(REQUIRED_PASSCODE);
  }, []);

  // Poll volume for VU visualizer
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

  // Connect to the saved line channel in background
  const connectSavedLine = async (targetLine: string, targetPin: string) => {
    if (clientRef.current) {
      clientRef.current.close();
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    let signalingUrl: string;
    if (window.location.port === '3000') {
      signalingUrl = `${protocol}//${window.location.hostname || 'localhost'}:8080`;
    } else {
      signalingUrl = `${protocol}//${window.location.host}/ws`;
    }

    const client = new WebRTCClient({
      signalingUrl,
      roomId: targetLine.trim().toLowerCase(),
      passcode: targetPin.trim(),
      profile: selectedProfile,
    });

    client.onStateChange = (newState) => {
      setCallState(newState);
      if (newState === 'error') {
        setErrorMessage('Failed to connect to line.');
      }
    };

    client.onPeerStatusChange = (isOnline) => {
      setIsPeerOnline(isOnline);
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

  // Initial Setup Save Button
  const handleSaveAndConnectLine = () => {
    if (!lineId.trim()) {
      setErrorMessage('Please enter a valid line identifier');
      return;
    }

    if (!passcode.trim()) {
      setErrorMessage('Please enter your secret passcode');
      return;
    }

    setErrorMessage(null);
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ lineId: lineId.trim(), passcode: passcode.trim() }));
    setHasSavedLine(true);
    connectSavedLine(lineId.trim(), passcode.trim());
  };

  // Reset / Clear Saved Line
  const handleResetLine = () => {
    if (clientRef.current) {
      clientRef.current.close();
      clientRef.current = null;
    }
    localStorage.removeItem(STORAGE_KEY);
    window.location.hash = '';
    setHasSavedLine(false);
    setCallState('idle');
    setIsSettingsOpen(false);

    // Generate new fresh line ID
    const randomLine = 'line-' + Math.floor(1000 + Math.random() * 9000) + '-' + Math.floor(1000 + Math.random() * 9000);
    setLineId(randomLine);
    setPasscode(REQUIRED_PASSCODE);
  };

  const getInviteUrl = () => {
    const url = new URL(window.location.href);
    url.hash = `line=${encodeURIComponent(lineId)}&pin=${encodeURIComponent(passcode)}`;
    return url.toString();
  };

  const handleCopyInvite = () => {
    navigator.clipboard.writeText(getInviteUrl());
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  // 1-Tap Call Partner
  const handleRingPartner = async () => {
    if (!clientRef.current) {
      await connectSavedLine(lineId, passcode);
    }
    clientRef.current?.audioManager.resumeAudio();
    setErrorMessage(null);
    const success = await clientRef.current?.ringPartner(passcode);
    if (!success) {
      setErrorMessage('Passcode verification failed.');
    }
  };

  // Callee answers
  const handleAnswerCall = async () => {
    if (!clientRef.current) return;
    clientRef.current.audioManager.resumeAudio();
    setErrorMessage(null);
    const entered = incomingPin.trim() || passcode;
    const success = await clientRef.current.acceptIncomingCall(entered);
    if (!success) {
      setErrorMessage('Incorrect Passcode! Access denied.');
    }
  };

  const handleDeclineCall = () => {
    if (clientRef.current) {
      clientRef.current.declineIncomingCall();
    }
  };

  const handleCancelCall = () => {
    if (clientRef.current) {
      clientRef.current.cancelOutgoingCall();
    }
  };

  const handleEndCall = () => {
    if (clientRef.current) {
      clientRef.current.soundManager.stopAll();
      clientRef.current.close();
      connectSavedLine(lineId, passcode);
    }
    setCallState('waiting');
    setNetworkStats(null);
    setChatMessages([]);
  };

  const handleToggleMute = () => {
    if (clientRef.current) {
      const muted = clientRef.current.audioManager.toggleMute();
      setIsMuted(muted);
    }
  };

  const handleBoostChange = (multiplier: number) => {
    setBoostLevel(multiplier);
    if (clientRef.current) {
      clientRef.current.audioManager.setBoostLevel(multiplier);
      clientRef.current.audioManager.resumeAudio();
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
            <Radio size={22} />
          </div>
          <div>
            <h1 className="brand-title">ImiCall</h1>
            <p className="brand-tagline">Encrypted Private Calling Channel</p>
          </div>
        </div>

        <div className="header-badges">
          <div className="badge-e2ee">
            <ShieldCheck size={14} color="#249c6f" />
            <span>Secure Tunnel</span>
          </div>
          {hasSavedLine && (
            <button
              className="btn btn-secondary"
              style={{ padding: '0.4rem 0.65rem' }}
              onClick={() => setIsSettingsOpen(!isSettingsOpen)}
              title="Line Settings"
            >
              <Settings size={15} />
            </button>
          )}
        </div>
      </header>

      {/* Error Banner */}
      {errorMessage && (
        <div
          style={{
            background: '#1f1f1f',
            border: '1px solid rgba(255, 255, 255, 0.25)',
            borderRadius: '8px',
            padding: '0.85rem 1rem',
            color: '#ffffff',
            fontSize: '0.85rem',
            marginBottom: '1.25rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <span>{errorMessage}</span>
          <button
            style={{ background: 'none', border: 'none', color: '#ffffff', cursor: 'pointer', fontWeight: 700 }}
            onClick={() => setErrorMessage(null)}
          >
            ✕
          </button>
        </div>
      )}

      {/* Settings Modal (Reset Line / Share Options) */}
      {isSettingsOpen && (
        <div className="modal-backdrop" onClick={() => setIsSettingsOpen(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#ffffff' }}>Private Line Settings</h3>
              <button className="btn btn-secondary" style={{ padding: '0.4rem' }} onClick={() => setIsSettingsOpen(false)}>
                ✕
              </button>
            </div>
            <p style={{ fontSize: '0.85rem', color: 'rgba(255, 255, 255, 0.7)', marginBottom: '1.25rem' }}>
              Your browser has saved this private calling line. Every time you open this page, you are directly connected to this line.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <button className="btn btn-secondary btn-full" onClick={handleCopyInvite}>
                {copiedLink ? <Check size={16} color="#249c6f" /> : <Copy size={16} />}
                {copiedLink ? 'Invite Link Copied' : 'Share Line Invite Link'}
              </button>
              <button className="btn btn-secondary btn-full" onClick={() => { setIsQrOpen(true); setIsSettingsOpen(false); }}>
                <QrCode size={16} /> Show Line QR Code
              </button>
              <button className="btn btn-danger btn-full" style={{ marginTop: '0.5rem' }} onClick={handleResetLine}>
                <RefreshCw size={16} /> Disconnect & Create New Line
              </button>
            </div>
          </div>
        </div>
      )}

      {/* VIEW A: FIRST-TIME SETUP (Only shown if no line is saved yet) */}
      {!hasSavedLine && (callState === 'idle' || callState === 'error') && (
        <div className="setup-grid">
          <div className="glass-panel">
            <h2 className="panel-title">
              <Lock size={18} color="#249c6f" /> Set Up Dedicated Line
            </h2>
            <p className="panel-subtitle">
              Set up your permanent direct calling channel. Once saved, you can call with a single tap whenever you visit.
            </p>

            <div className="input-group">
              <label className="input-label">Tunnel Identifier</label>
              <input
                type="text"
                className="input-field mono"
                value={lineId}
                onChange={(e) => setLineId(e.target.value)}
                placeholder="e.g. line-8372-9182"
              />
            </div>

            <div className="input-group">
              <label className="input-label">Secret Passcode (PIN)</label>
              <input
                type="password"
                className="input-field mono"
                value={passcode}
                onChange={(e) => setPasscode(e.target.value)}
                placeholder="••••"
              />
            </div>

            <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.75rem' }}>
              <button className="btn btn-primary btn-full" onClick={handleSaveAndConnectLine}>
                <Phone size={18} /> Save & Open Line
              </button>
            </div>
          </div>

          <div className="glass-panel">
            <h2 className="panel-title">
              <Zap size={18} color="#249c6f" /> Audio & Signal Profile
            </h2>
            <p className="panel-subtitle">
              Select your network condition. Opus audio engine will maintain voice clarity under low reception.
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
          </div>
        </div>
      )}

      {/* VIEW B: PERMANENT SAVED DEDICATED HOTLINE (1-Tap Call Partner) */}
      {hasSavedLine && callState === 'waiting' && (
        <div className="dedicated-line-card">
          <div className="line-badge">
            <ShieldCheck size={14} />
            <span>Dedicated Direct Line Connected</span>
          </div>

          <h2 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.4rem', color: '#ffffff' }}>
            Private Hotline
          </h2>
          <p style={{ fontSize: '0.85rem', color: 'rgba(255, 255, 255, 0.65)' }}>
            This channel is saved in your browser. Tap below to ring your partner's phone directly.
          </p>

          <div className="line-status-box">
            <span style={{ fontSize: '0.85rem', color: 'rgba(255, 255, 255, 0.6)' }}>Partner Line Status:</span>
            <div className="partner-status-pill">
              <span className={`status-dot ${isPeerOnline ? '' : 'offline'}`} />
              <span style={{ color: isPeerOnline ? '#249c6f' : 'rgba(255, 255, 255, 0.7)' }}>
                {isPeerOnline ? 'Partner Online' : 'Partner Standby'}
              </span>
            </div>
          </div>

          <button
            className="btn btn-primary btn-full"
            style={{ padding: '1rem', fontSize: '1.05rem', fontWeight: 700, marginBottom: '1rem' }}
            onClick={handleRingPartner}
          >
            <PhoneCall size={20} /> Call Partner
          </button>

          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button className="btn btn-secondary btn-full" onClick={handleCopyInvite}>
              {copiedLink ? <Check size={16} color="#249c6f" /> : <Share2 size={16} />}
              {copiedLink ? 'Invite Link Copied' : 'Share Line with Partner'}
            </button>
            <button className="btn btn-secondary" onClick={() => setIsQrOpen(true)} title="Scan Line QR">
              <QrCode size={18} />
            </button>
          </div>
        </div>
      )}

      {/* VIEW C: OUTGOING CALLING (Caller Screen) */}
      {callState === 'ringing-outgoing' && (
        <div className="glass-panel" style={{ textAlign: 'center', padding: '3.5rem 1.5rem', maxWidth: '480px', margin: '1.5rem auto' }}>
          <div
            style={{
              width: '80px',
              height: '80px',
              borderRadius: '50%',
              background: '#181818',
              border: '2px solid #249c6f',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 1.5rem',
              color: '#249c6f',
            }}
          >
            <BellRing size={36} />
          </div>

          <h2 style={{ fontSize: '1.35rem', fontWeight: 700, marginBottom: '0.4rem', color: '#ffffff' }}>
            Calling Partner...
          </h2>
          <p style={{ fontSize: '0.85rem', color: 'rgba(255, 255, 255, 0.65)', marginBottom: '2.5rem' }}>
            Partner's phone is ringing. Waiting for answer...
          </p>

          <button className="btn btn-danger btn-full" style={{ padding: '0.85rem' }} onClick={handleCancelCall}>
            <PhoneOff size={18} /> Cancel Call
          </button>
        </div>
      )}

      {/* VIEW D: INCOMING CALL SCREEN (Callee Screen) */}
      {callState === 'ringing-incoming' && (
        <div className="modal-backdrop">
          <div className="modal-card" style={{ textAlign: 'center', padding: '2.5rem 2rem' }}>
            <div
              style={{
                width: '80px',
                height: '80px',
                borderRadius: '50%',
                background: '#181818',
                border: '2px solid #249c6f',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 1.25rem',
                color: '#249c6f',
              }}
            >
              <PhoneCall size={36} />
            </div>

            <h2 style={{ fontSize: '1.35rem', fontWeight: 700, marginBottom: '0.35rem', color: '#ffffff' }}>
              Incoming Call
            </h2>
            <p style={{ fontSize: '0.85rem', color: 'rgba(255, 255, 255, 0.7)', marginBottom: '1.5rem' }}>
              Your partner is calling on your dedicated direct line.
            </p>

            <div className="input-group" style={{ marginBottom: '1.5rem' }}>
              <label className="input-label" style={{ textAlign: 'left' }}>Passcode (PIN)</label>
              <input
                type="password"
                className="input-field mono"
                style={{ textAlign: 'center', fontSize: '1.25rem', letterSpacing: '0.3em' }}
                value={incomingPin}
                onChange={(e) => setIncomingPin(e.target.value)}
                placeholder="••••"
                autoFocus
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <button className="btn btn-primary" style={{ padding: '0.85rem' }} onClick={handleAnswerCall}>
                <Phone size={18} /> Answer
              </button>
              <button className="btn btn-danger" style={{ padding: '0.85rem' }} onClick={handleDeclineCall}>
                <PhoneOff size={18} /> Decline
              </button>
            </div>
          </div>
        </div>
      )}

      {/* VIEW E: ACTIVE CALL SCREEN */}
      {(callState === 'connecting' || callState === 'connected' || callState === 'reconnecting') && (
        <div className="glass-panel call-active-container">
          <div className="call-status-pill status-connected">
            <span className="pulse-dot" />
            <span>
              {callState === 'connected'
                ? 'Call Active • Encrypted Line'
                : 'Connecting Audio Channel...'}
            </span>
          </div>

          {/* Audio Avatars */}
          <div className="audio-avatars-container">
            <div className="avatar-wrapper">
              <div className={`avatar-disc ${localVolume > 5 && !isMuted ? 'speaking' : ''}`}>
                {isMuted ? <MicOff size={32} color="rgba(255, 255, 255, 0.4)" /> : <Mic size={32} color="#249c6f" />}
              </div>
              <span className="avatar-label">You {isMuted && '(Muted)'}</span>
              <AudioWaveform volume={localVolume} isActive={!isMuted} color="#249c6f" />
            </div>

            <div className="avatar-wrapper">
              <div className={`avatar-disc ${remoteVolume > 5 ? 'speaking' : ''}`}>
                <Volume2 size={32} color={callState === 'connected' ? '#249c6f' : 'rgba(255, 255, 255, 0.4)'} />
              </div>
              <span className="avatar-label">Partner</span>
              <AudioWaveform volume={remoteVolume} isActive={callState === 'connected'} color="#249c6f" />
            </div>
          </div>

          {/* Live Metrics */}
          <div className="metrics-strip">
            <div className="metric-box">
              <div className="metric-label">Latency (RTT)</div>
              <div className="metric-value good">
                {networkStats ? `${networkStats.rtt}ms` : '--'}
              </div>
            </div>
            <div className="metric-box">
              <div className="metric-label">Packet Loss</div>
              <div className="metric-value good">
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
              <div className="metric-value good" style={{ fontSize: '0.85rem' }}>
                {SIGNAL_PROFILES[selectedProfile].badge}
              </div>
            </div>
          </div>

          {/* Profile Switcher */}
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
            {(Object.keys(SIGNAL_PROFILES) as SignalProfile[]).map((key) => (
              <button
                key={key}
                onClick={() => handleProfileSwitch(key)}
                className={`btn btn-secondary ${selectedProfile === key ? 'active' : ''}`}
                style={{
                  fontSize: '0.78rem',
                  padding: '0.4rem 0.8rem',
                  borderColor: selectedProfile === key ? '#249c6f' : undefined,
                  background: selectedProfile === key ? '#1f1f1f' : undefined,
                  color: selectedProfile === key ? '#249c6f' : '#ffffff',
                }}
              >
                {SIGNAL_PROFILES[key].badge}
              </button>
            ))}
          </div>

          {/* Voice Loudness Booster */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              background: '#181818',
              border: '1px solid #282828',
              borderRadius: '10px',
              padding: '0.6rem 0.85rem',
              marginBottom: '1.25rem',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#ffffff', fontSize: '0.82rem' }}>
              <Volume2 size={16} color="#249c6f" />
              <span>Voice Loudness:</span>
            </div>
            <div style={{ display: 'flex', gap: '0.35rem' }}>
              {[
                { label: '1x Normal', val: 1.0 },
                { label: '2.2x Loud', val: 2.2 },
                { label: '3.2x Max', val: 3.2 },
              ].map((b) => (
                <button
                  key={b.val}
                  onClick={() => handleBoostChange(b.val)}
                  className={`btn btn-secondary ${boostLevel === b.val ? 'active' : ''}`}
                  style={{
                    fontSize: '0.74rem',
                    padding: '0.3rem 0.6rem',
                    borderColor: boostLevel === b.val ? '#249c6f' : undefined,
                    background: boostLevel === b.val ? '#1f1f1f' : undefined,
                    color: boostLevel === b.val ? '#249c6f' : 'rgba(255, 255, 255, 0.7)',
                  }}
                >
                  {b.label}
                </button>
              ))}
            </div>
          </div>

          {/* In-Call Controls Bar */}
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
                    background: '#249c6f',
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
              title="Line QR"
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
        isE2eeActive={true}
        roomId={lineId}
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
