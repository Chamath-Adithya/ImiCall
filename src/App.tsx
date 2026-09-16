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
  Plus,
  Trash2,
  FolderOpen,
} from 'lucide-react';
import { SignalProfile, NetworkStats, ChatMessage, CallState, SIGNAL_PROFILES, REQUIRED_PASSCODE } from './core/types';
import { WebRTCClient } from './core/webrtcClient';
import { AudioWaveform } from './components/AudioWaveform';
import { DiagnosticsModal } from './components/DiagnosticsModal';
import { QrModal } from './components/QrModal';
import { ChatDrawer } from './components/ChatDrawer';

export interface SavedLine {
  id: string;
  name: string;
  passcode: string;
  createdAt: number;
}

const STORAGE_LINES_KEY = 'imicall_saved_lines_list_v2';
const ACTIVE_LINE_ID_KEY = 'imicall_active_line_id_v2';
const LEGACY_STORAGE_KEY = 'imicall_saved_tunnel_v1';

const generateRandomLineId = () => {
  return 'line-' + Math.floor(1000 + Math.random() * 9000) + '-' + Math.floor(1000 + Math.random() * 9000);
};

export const App: React.FC = () => {
  // Line & Auth State
  const [lineId, setLineId] = useState<string>('');
  const [passcode, setPasscode] = useState<string>(REQUIRED_PASSCODE);
  const [incomingPin, setIncomingPin] = useState<string>('');
  const [hasSavedLine, setHasSavedLine] = useState<boolean>(false);
  const [savedLines, setSavedLines] = useState<SavedLine[]>([]);
  const [selectedProfile, setSelectedProfile] = useState<SignalProfile>('balanced');
  const [callState, setCallState] = useState<CallState>('idle');
  const [isPeerOnline, setIsPeerOnline] = useState<boolean>(false);

  // In-Call Controls
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [networkStats, setNetworkStats] = useState<NetworkStats | null>(null);
  const [localVolume, setLocalVolume] = useState<number>(0);
  const [remoteVolume, setRemoteVolume] = useState<number>(0);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [hasUnreadChat, setHasUnreadChat] = useState<boolean>(false);
  const [boostLevel, setBoostLevel] = useState<number>(1.0);

  // Modals & Sheets
  const [isDiagnosticsOpen, setIsDiagnosticsOpen] = useState<boolean>(false);
  const [isQrOpen, setIsQrOpen] = useState<boolean>(false);
  const [isChatOpen, setIsChatOpen] = useState<boolean>(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
  const [isAddLineModalOpen, setIsAddLineModalOpen] = useState<boolean>(false);
  const [newLineName, setNewLineName] = useState<string>('');
  const [newLineId, setNewLineId] = useState<string>('');
  const [newLinePasscode, setNewLinePasscode] = useState<string>(REQUIRED_PASSCODE);
  const [copiedLink, setCopiedLink] = useState<boolean>(false);
  const [copiedLineId, setCopiedLineId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Refs
  const clientRef = useRef<WebRTCClient | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const volumeIntervalRef = useRef<any>(null);

  const saveLinesList = (lines: SavedLine[], activeId: string) => {
    setSavedLines(lines);
    localStorage.setItem(STORAGE_LINES_KEY, JSON.stringify(lines));
    localStorage.setItem(ACTIVE_LINE_ID_KEY, activeId);
  };

  // Load or Save Dedicated Lines from URL or LocalStorage
  useEffect(() => {
    const hash = window.location.hash.substring(1);
    const params = new URLSearchParams(hash);
    const hashLine = params.get('line') || params.get('room');
    const hashPin = params.get('pin');

    let currentList: SavedLine[] = [];
    const savedListRaw = localStorage.getItem(STORAGE_LINES_KEY);
    if (savedListRaw) {
      try {
        currentList = JSON.parse(savedListRaw) || [];
      } catch (e) {}
    }

    // Migrate from legacy single-line storage if present
    if (currentList.length === 0) {
      const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
      if (legacy) {
        try {
          const parsed = JSON.parse(legacy);
          if (parsed.lineId) {
            currentList.push({
              id: parsed.lineId,
              name: 'Primary Line',
              passcode: parsed.passcode || REQUIRED_PASSCODE,
              createdAt: Date.now(),
            });
          }
        } catch (e) {}
      }
    }

    // If incoming invite URL hash
    if (hashLine) {
      const pinToUse = hashPin || REQUIRED_PASSCODE;
      const existing = currentList.find((l) => l.id === hashLine);
      if (!existing) {
        currentList.push({
          id: hashLine,
          name: `Shared Line (${currentList.length + 1})`,
          passcode: pinToUse,
          createdAt: Date.now(),
        });
      }
      saveLinesList(currentList, hashLine);
      setLineId(hashLine);
      setPasscode(pinToUse);
      setHasSavedLine(true);
      connectSavedLine(hashLine, pinToUse);
      return;
    }

    // If existing saved lines
    if (currentList.length > 0) {
      const activeId = localStorage.getItem(ACTIVE_LINE_ID_KEY);
      const activeLine = currentList.find((l) => l.id === activeId) || currentList[0];
      setSavedLines(currentList);
      setLineId(activeLine.id);
      setPasscode(activeLine.passcode);
      setHasSavedLine(true);
      connectSavedLine(activeLine.id, activeLine.passcode);
      return;
    }

    // Brand new visitor: create initial line
    const firstId = generateRandomLineId();
    const defaultLine: SavedLine = {
      id: firstId,
      name: 'Primary Hotline',
      passcode: REQUIRED_PASSCODE,
      createdAt: Date.now(),
    };
    saveLinesList([defaultLine], firstId);
    setLineId(firstId);
    setPasscode(REQUIRED_PASSCODE);
    setHasSavedLine(true);
    connectSavedLine(firstId, REQUIRED_PASSCODE);
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
      if (newState === 'disconnected') {
        setCallState('waiting');
      } else {
        setCallState(newState);
      }
      if (newState === 'waiting') {
        setNetworkStats(null);
      }
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

  const handleSwitchLine = (targetLine: SavedLine) => {
    setLineId(targetLine.id);
    setPasscode(targetLine.passcode);
    localStorage.setItem(ACTIVE_LINE_ID_KEY, targetLine.id);
    connectSavedLine(targetLine.id, targetLine.passcode);
  };

  const handleCreateNewLine = () => {
    const idToUse = newLineId.trim() || generateRandomLineId();
    const nameToUse = newLineName.trim() || `Line ${savedLines.length + 1}`;
    const pinToUse = newLinePasscode.trim() || REQUIRED_PASSCODE;

    const newLine: SavedLine = {
      id: idToUse,
      name: nameToUse,
      passcode: pinToUse,
      createdAt: Date.now(),
    };

    const updated = [...savedLines.filter((l) => l.id !== idToUse), newLine];
    saveLinesList(updated, idToUse);
    setLineId(idToUse);
    setPasscode(pinToUse);
    setHasSavedLine(true);
    setIsAddLineModalOpen(false);
    setNewLineName('');
    setNewLineId('');
    connectSavedLine(idToUse, pinToUse);
  };

  const handleDeleteLine = (idToDelete: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (savedLines.length <= 1) {
      setErrorMessage('You must keep at least one active calling line.');
      return;
    }
    const updated = savedLines.filter((l) => l.id !== idToDelete);
    let nextActive = lineId;
    if (lineId === idToDelete) {
      nextActive = updated[0].id;
      setLineId(updated[0].id);
      setPasscode(updated[0].passcode);
      connectSavedLine(updated[0].id, updated[0].passcode);
    }
    saveLinesList(updated, nextActive);
  };

  const handleCopySpecificLineInvite = (targetLine: SavedLine, e: React.MouseEvent) => {
    e.stopPropagation();
    const url = new URL(window.location.href);
    url.hash = `line=${encodeURIComponent(targetLine.id)}&pin=${encodeURIComponent(targetLine.passcode)}`;
    navigator.clipboard.writeText(url.toString());
    setCopiedLineId(targetLine.id);
    setTimeout(() => setCopiedLineId(null), 2000);
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
    const newLine: SavedLine = {
      id: lineId.trim(),
      name: 'Primary Line',
      passcode: passcode.trim(),
      createdAt: Date.now(),
    };
    saveLinesList([newLine], lineId.trim());
    setHasSavedLine(true);
    connectSavedLine(lineId.trim(), passcode.trim());
  };

  // Reset / Clear Saved Line
  const handleResetLine = () => {
    if (clientRef.current) {
      clientRef.current.close();
      clientRef.current = null;
    }
    localStorage.removeItem(STORAGE_LINES_KEY);
    localStorage.removeItem(ACTIVE_LINE_ID_KEY);
    localStorage.removeItem(LEGACY_STORAGE_KEY);
    window.location.hash = '';
    setHasSavedLine(false);
    setCallState('idle');
    setIsSettingsOpen(false);

    // Generate new fresh line ID
    const randomLine = generateRandomLineId();
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
      clientRef.current.endCall();
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
        <div style={{ maxWidth: '580px', margin: '0 auto' }}>
          <div className="dedicated-line-card" style={{ marginBottom: '1.25rem' }}>
            <div className="line-badge">
              <ShieldCheck size={14} />
              <span>Dedicated Direct Line Connected</span>
            </div>

            <h2 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.4rem', color: '#ffffff' }}>
              {savedLines.find((l) => l.id === lineId)?.name || 'Private Hotline'}
            </h2>
            <p style={{ fontSize: '0.85rem', color: 'rgba(255, 255, 255, 0.65)' }}>
              Tunnel ID: <span style={{ fontFamily: 'monospace', color: '#249c6f' }}>{lineId.substring(0, 8)}••••••••</span>
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

          {/* Saved Lines Management Panel */}
          <div className="glass-panel" style={{ padding: '1.35rem 1.5rem', marginBottom: '2rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <FolderOpen size={18} color="#249c6f" />
                <span style={{ fontWeight: 700, fontSize: '0.92rem', color: '#ffffff' }}>
                  Saved Private Lines ({savedLines.length})
                </span>
              </div>
              <button
                className="btn btn-secondary"
                style={{ fontSize: '0.78rem', padding: '0.35rem 0.75rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}
                onClick={() => {
                  setNewLineId(generateRandomLineId());
                  setNewLineName(`Line ${savedLines.length + 1}`);
                  setNewLinePasscode(REQUIRED_PASSCODE);
                  setIsAddLineModalOpen(true);
                }}
              >
                <Plus size={15} color="#249c6f" /> New Line
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
              {savedLines.map((line) => {
                const isActive = line.id === lineId;
                return (
                  <div
                    key={line.id}
                    onClick={() => !isActive && handleSwitchLine(line)}
                    style={{
                      background: isActive ? '#1e1e1e' : '#141414',
                      border: `1px solid ${isActive ? '#249c6f' : 'rgba(255, 255, 255, 0.08)'}`,
                      borderRadius: '8px',
                      padding: '0.75rem 1rem',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      cursor: isActive ? 'default' : 'pointer',
                      transition: 'border-color 0.2s',
                    }}
                  >
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span style={{ fontWeight: 600, fontSize: '0.88rem', color: '#ffffff' }}>
                          {line.name}
                        </span>
                        {isActive && (
                          <span
                            style={{
                              fontSize: '0.68rem',
                              padding: '0.12rem 0.45rem',
                              background: '#249c6f',
                              color: '#ffffff',
                              borderRadius: '4px',
                              fontWeight: 700,
                            }}
                          >
                            Active
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'rgba(255, 255, 255, 0.45)', fontFamily: 'monospace', marginTop: '0.2rem' }}>
                        {line.id.substring(0, 8)}••••••••
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      <button
                        className="btn btn-secondary"
                        style={{ padding: '0.35rem 0.6rem', fontSize: '0.75rem' }}
                        onClick={(e) => handleCopySpecificLineInvite(line, e)}
                        title="Copy Line Link"
                      >
                        {copiedLineId === line.id ? <Check size={14} color="#249c6f" /> : <Copy size={14} />}
                      </button>

                      {savedLines.length > 1 && (
                        <button
                          className="btn btn-danger"
                          style={{ padding: '0.35rem 0.6rem', fontSize: '0.75rem' }}
                          onClick={(e) => handleDeleteLine(line.id, e)}
                          title="Delete Line"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}

                      {!isActive && (
                        <button
                          className="btn btn-primary"
                          style={{ padding: '0.35rem 0.75rem', fontSize: '0.75rem' }}
                          onClick={() => handleSwitchLine(line)}
                        >
                          Switch
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
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
                { label: '1.0x HD Pure', val: 1.0 },
                { label: '1.5x Loud', val: 1.5 },
                { label: '2.0x Max', val: 2.0 },
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

      {/* ADD NEW LINE MODAL */}
      {isAddLineModalOpen && (
        <div className="modal-backdrop">
          <div className="modal-card">
            <div className="modal-header">
              <h3 className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                <Plus size={18} color="#249c6f" /> Create or Join Private Line
              </h3>
              <button
                className="btn btn-icon btn-secondary"
                style={{ width: '32px', height: '32px' }}
                onClick={() => setIsAddLineModalOpen(false)}
              >
                ✕
              </button>
            </div>

            <p style={{ fontSize: '0.85rem', color: 'rgba(255, 255, 255, 0.65)', marginBottom: '1.25rem' }}>
              Create an additional dedicated calling line or enter an existing Tunnel ID shared by your partner.
            </p>

            <div className="input-group">
              <label className="input-label">Line Name</label>
              <input
                type="text"
                className="input-field"
                value={newLineName}
                onChange={(e) => setNewLineName(e.target.value)}
                placeholder="e.g. Work Channel, Family, Partner 2"
              />
            </div>

            <div className="input-group">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
                <label className="input-label" style={{ marginBottom: 0 }}>Tunnel Identifier</label>
                <button
                  type="button"
                  style={{ background: 'none', border: 'none', color: '#249c6f', fontSize: '0.75rem', cursor: 'pointer' }}
                  onClick={() => setNewLineId(generateRandomLineId())}
                >
                  Auto-Generate
                </button>
              </div>
              <input
                type="text"
                className="input-field mono"
                value={newLineId}
                onChange={(e) => setNewLineId(e.target.value)}
                placeholder="e.g. line-8372-9182"
              />
            </div>

            <div className="input-group">
              <label className="input-label">Secret Passcode (PIN)</label>
              <input
                type="password"
                className="input-field mono"
                value={newLinePasscode}
                onChange={(e) => setNewLinePasscode(e.target.value)}
                placeholder="••••"
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginTop: '1.5rem' }}>
              <button className="btn btn-secondary" onClick={() => setIsAddLineModalOpen(false)}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={handleCreateNewLine}>
                Save & Switch
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
