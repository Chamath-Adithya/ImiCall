import React, { useState, useEffect, useRef } from 'react';
import {
  Phone,
  PhoneOff,
  PhoneCall,
  Mic,
  MicOff,
  ShieldCheck,
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
  Bell,
  BookUser,
  Search,
  UserCheck,
} from 'lucide-react';
import { SignalProfile, NetworkStats, ChatMessage, CallState, SIGNAL_PROFILES, REQUIRED_PASSCODE } from './core/types';
import { WebRTCClient } from './core/webrtcClient';
import { PushNotificationManager } from './core/pushManager';
import { AudioWaveform } from './components/AudioWaveform';
import { DiagnosticsModal } from './components/DiagnosticsModal';
import { QrModal } from './components/QrModal';
import { ChatDrawer } from './components/ChatDrawer';

export interface SavedLine {
  id: string;
  name: string;
  myDisplayName?: string;
  passcode: string;
  createdAt: number;
}

const STORAGE_LINES_KEY = 'imicall_saved_lines_list_v2';
const ACTIVE_LINE_ID_KEY = 'imicall_active_line_id_v2';
const LEGACY_STORAGE_KEY = 'imicall_saved_tunnel_v1';
const MY_NAME_KEY = 'imicall_my_name';

const generateRandomLineId = () => {
  return 'line-' + Math.floor(1000 + Math.random() * 9000) + '-' + Math.floor(1000 + Math.random() * 9000);
};

export const App: React.FC = () => {
  // Phone Book & Line State
  const [lineId, setLineId] = useState<string>('');
  const [passcode, setPasscode] = useState<string>(REQUIRED_PASSCODE);
  const [hasSavedLine, setHasSavedLine] = useState<boolean>(false);
  const [savedLines, setSavedLines] = useState<SavedLine[]>([]);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedProfile, setSelectedProfile] = useState<SignalProfile>('balanced');
  const [callState, setCallState] = useState<CallState>('idle');
  const [isPeerOnline, setIsPeerOnline] = useState<boolean>(false);
  const [callDuration, setCallDuration] = useState<number>(0);

  // In-Call Controls
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [networkStats, setNetworkStats] = useState<NetworkStats | null>(null);
  const [localVolume, setLocalVolume] = useState<number>(0);
  const [remoteVolume, setRemoteVolume] = useState<number>(0);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [hasUnreadChat, setHasUnreadChat] = useState<boolean>(false);
  const [boostLevel, setBoostLevel] = useState<number>(1.0);

  // Modals & Phone Book Management
  const [isDiagnosticsOpen, setIsDiagnosticsOpen] = useState<boolean>(false);
  const [isQrOpen, setIsQrOpen] = useState<boolean>(false);
  const [isChatOpen, setIsChatOpen] = useState<boolean>(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
  const [isAddContactModalOpen, setIsAddContactModalOpen] = useState<boolean>(false);
  const [newContactName, setNewContactName] = useState<string>('');
  const [myDisplayName, setMyDisplayName] = useState<string>(() => localStorage.getItem(MY_NAME_KEY) || '');
  const [shareContact, setShareContact] = useState<SavedLine | null>(null);
  const [pendingInvite, setPendingInvite] = useState<{
    lineId: string;
    senderName: string;
    myName: string;
    pin: string;
  } | null>(null);
  const [pendingInviteContactName, setPendingInviteContactName] = useState<string>('');
  const [pendingInviteMyName, setPendingInviteMyName] = useState<string>('');
  const [copiedLink, setCopiedLink] = useState<boolean>(false);
  const [copiedLineId, setCopiedLineId] = useState<string | null>(null);
  const [isPushEnabled, setIsPushEnabled] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Refs
  const clientRef = useRef<WebRTCClient | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const volumeIntervalRef = useRef<any>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const saveLinesList = (lines: SavedLine[], activeId: string) => {
    setSavedLines(lines);
    localStorage.setItem(STORAGE_LINES_KEY, JSON.stringify(lines));
    localStorage.setItem(ACTIVE_LINE_ID_KEY, activeId);
  };

  // Load or Save Dedicated Lines from URL or LocalStorage
  useEffect(() => {
    // Register Service Worker for Background Push Notifications
    PushNotificationManager.registerServiceWorker();
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      setIsPushEnabled(true);
    }

    const searchParams = new URLSearchParams(window.location.search);
    const hash = window.location.hash.substring(1);
    const hashParams = new URLSearchParams(hash);

    const hashLine =
      hashParams.get('connect') ||
      hashParams.get('line') ||
      hashParams.get('room') ||
      searchParams.get('connect') ||
      searchParams.get('line') ||
      searchParams.get('room');
    const hashPin = hashParams.get('pin') || searchParams.get('pin') || REQUIRED_PASSCODE;
    const hashFrom =
      hashParams.get('from') ||
      hashParams.get('caller') ||
      hashParams.get('name') ||
      searchParams.get('from') ||
      searchParams.get('caller') ||
      searchParams.get('name');
    const hashTo = hashParams.get('to') || hashParams.get('callee') || searchParams.get('to') || searchParams.get('callee');

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
              name: 'Primary Partner',
              passcode: parsed.passcode || REQUIRED_PASSCODE,
              createdAt: Date.now(),
            });
          }
        } catch (e) {}
      }
    }

    // If incoming invite URL hash/params
    if (hashLine) {
      const pinToUse = hashPin || REQUIRED_PASSCODE;
      const existing = currentList.find((l) => l.id === hashLine);

      if (existing) {
        saveLinesList(currentList, existing.id);
        setLineId(existing.id);
        setPasscode(existing.passcode);
        setHasSavedLine(true);
        connectSavedLine(existing.id, existing.passcode);
        window.history.replaceState(null, '', window.location.pathname);
        return;
      }

      // If sender name is specified in the link, display friendly invitation modal
      if (hashFrom) {
        const mySavedName = localStorage.getItem(MY_NAME_KEY) || hashTo || '';
        setPendingInvite({
          lineId: hashLine,
          senderName: hashFrom,
          myName: mySavedName,
          pin: pinToUse,
        });
        setPendingInviteContactName(hashFrom);
        setPendingInviteMyName(mySavedName);
      } else {
        // Auto-save connection (for direct URL or test script compatibility)
        const lineNameToUse = `Contact ${currentList.length + 1}`;
        currentList.push({
          id: hashLine,
          name: lineNameToUse,
          passcode: pinToUse,
          createdAt: Date.now(),
        });
        saveLinesList(currentList, hashLine);
        setLineId(hashLine);
        setPasscode(pinToUse);
        setHasSavedLine(true);
        connectSavedLine(hashLine, pinToUse);
        return;
      }
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

    // Brand new visitor: create initial contact line
    const firstId = generateRandomLineId();
    const defaultLine: SavedLine = {
      id: firstId,
      name: 'Primary Partner',
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

  // Active call duration timer
  useEffect(() => {
    let interval: any = null;
    if (callState === 'connected') {
      setCallDuration(0);
      interval = setInterval(() => {
        setCallDuration((prev) => prev + 1);
      }, 1000);
    } else {
      setCallDuration(0);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [callState]);

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

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

    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      PushNotificationManager.subscribeToLine(targetLine).then((ok) => {
        if (ok) setIsPushEnabled(true);
      });
    }
  };

  const handleSwitchLine = (targetLine: SavedLine) => {
    setLineId(targetLine.id);
    setPasscode(targetLine.passcode);
    localStorage.setItem(ACTIVE_LINE_ID_KEY, targetLine.id);
    connectSavedLine(targetLine.id, targetLine.passcode);
  };

  const handleCallSavedLine = (targetLine: SavedLine, e: React.MouseEvent) => {
    e.stopPropagation();
    if (targetLine.id !== lineId) {
      handleSwitchLine(targetLine);
      setTimeout(() => {
        handleRingPartner();
      }, 350);
    } else {
      handleRingPartner();
    }
  };

  // Add Contact flow
  const handleCreateContact = () => {
    const nameToUse = newContactName.trim() || `Contact ${savedLines.length + 1}`;
    const idToUse = generateRandomLineId();
    const pinToUse = REQUIRED_PASSCODE;

    if (myDisplayName.trim()) {
      localStorage.setItem(MY_NAME_KEY, myDisplayName.trim());
    }

    const newContact: SavedLine = {
      id: idToUse,
      name: nameToUse,
      myDisplayName: myDisplayName.trim() || undefined,
      passcode: pinToUse,
      createdAt: Date.now(),
    };

    const updated = [newContact, ...savedLines.filter((l) => l.id !== idToUse)];
    saveLinesList(updated, idToUse);
    setLineId(idToUse);
    setPasscode(pinToUse);
    setHasSavedLine(true);
    setIsAddContactModalOpen(false);
    setNewContactName('');
    connectSavedLine(idToUse, pinToUse);

    // Prompt user with instant share modal
    setShareContact(newContact);
    showToast(`Contact "${nameToUse}" added! Share link to connect.`);
  };

  // Accept incoming invite flow
  const handleAcceptPendingInvite = () => {
    if (!pendingInvite) return;
    const contactName = pendingInviteContactName.trim() || pendingInvite.senderName || 'Partner';
    if (pendingInviteMyName.trim()) {
      localStorage.setItem(MY_NAME_KEY, pendingInviteMyName.trim());
      setMyDisplayName(pendingInviteMyName.trim());
    }

    const newContact: SavedLine = {
      id: pendingInvite.lineId,
      name: contactName,
      passcode: pendingInvite.pin || REQUIRED_PASSCODE,
      createdAt: Date.now(),
    };

    const updated = [newContact, ...savedLines.filter((l) => l.id !== pendingInvite.lineId)];
    saveLinesList(updated, pendingInvite.lineId);
    setLineId(pendingInvite.lineId);
    setPasscode(pendingInvite.pin || REQUIRED_PASSCODE);
    setHasSavedLine(true);
    connectSavedLine(pendingInvite.lineId, pendingInvite.pin || REQUIRED_PASSCODE);

    window.history.replaceState(null, '', window.location.pathname);
    setPendingInvite(null);
    showToast(`Connected with ${contactName}! Added to your Phone Book.`);
  };

  const handleDeleteLine = (idToDelete: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (savedLines.length <= 1) {
      setErrorMessage('You must keep at least one contact in your Phone Book.');
      return;
    }
    const updated = savedLines.filter((l) => l.id !== idToDelete);
    let nextActive = lineId;
    if (lineId === idToDelete) {
      nextActive = updated[0].id;
      setLineId(updated[0].id);
      setPasscode(updated[0].passcode);
      localStorage.setItem(ACTIVE_LINE_ID_KEY, updated[0].id);
      connectSavedLine(updated[0].id, updated[0].passcode);
    }
    saveLinesList(updated, nextActive);
    showToast('Contact removed from Phone Book.');
  };

  const getContactInviteUrl = (contact: SavedLine) => {
    const url = new URL(window.location.href);
    const myStoredName = localStorage.getItem(MY_NAME_KEY) || myDisplayName || 'Partner';
    url.search = '';
    url.hash = `connect=${encodeURIComponent(contact.id)}&from=${encodeURIComponent(myStoredName)}&to=${encodeURIComponent(contact.name)}&pin=${encodeURIComponent(contact.passcode)}`;
    return url.toString();
  };

  const getWhatsAppShareUrl = (contact: SavedLine) => {
    const inviteUrl = getContactInviteUrl(contact);
    const myStoredName = localStorage.getItem(MY_NAME_KEY) || myDisplayName || 'Your partner';
    const text = `Hey ${contact.name}! Connect with ${myStoredName} on ImiCall Private Calling. Tap this link to add me to your Phone Book: ${inviteUrl}`;
    return `https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`;
  };

  const handleCopyContactLink = (contact: SavedLine, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    navigator.clipboard.writeText(getContactInviteUrl(contact));
    setCopiedLineId(contact.id);
    showToast(`Invite link for "${contact.name}" copied!`);
    setTimeout(() => setCopiedLineId(null), 2500);
  };

  const handleCopyActiveInvite = () => {
    const activeContact = savedLines.find((l) => l.id === lineId);
    if (!activeContact) return;
    navigator.clipboard.writeText(getContactInviteUrl(activeContact));
    setCopiedLink(true);
    showToast('Connection invite link copied!');
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const handleResetLine = () => {
    localStorage.removeItem(STORAGE_LINES_KEY);
    localStorage.removeItem(ACTIVE_LINE_ID_KEY);
    if (clientRef.current) {
      clientRef.current.close();
      clientRef.current = null;
    }
    const firstId = generateRandomLineId();
    const defaultLine: SavedLine = {
      id: firstId,
      name: 'Primary Partner',
      passcode: REQUIRED_PASSCODE,
      createdAt: Date.now(),
    };
    saveLinesList([defaultLine], firstId);
    setLineId(firstId);
    setPasscode(REQUIRED_PASSCODE);
    setIsSettingsOpen(false);
    connectSavedLine(firstId, REQUIRED_PASSCODE);
    showToast('Phone Book reset to new primary line.');
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

  // Callee answers with 1 tap (no manual PIN typing required)
  const handleAnswerCall = async () => {
    if (!clientRef.current) return;
    clientRef.current.audioManager.resumeAudio();
    setErrorMessage(null);
    const pinToUse = passcode || REQUIRED_PASSCODE;
    const success = await clientRef.current.acceptIncomingCall(pinToUse);
    if (!success) {
      setErrorMessage('Passcode verification failed. Unable to answer call.');
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

  const handleSendMessage = (text: string) => {
    if (!clientRef.current) return;
    const msg: ChatMessage = {
      id: Math.random().toString(36).substring(7),
      sender: 'me',
      text,
      timestamp: Date.now(),
    };
    clientRef.current.sendChatMessage(text);
    setChatMessages((prev) => [...prev, msg]);
  };

  const handleProfileSwitch = (newProfile: SignalProfile) => {
    setSelectedProfile(newProfile);
    if (clientRef.current) {
      clientRef.current.setProfile(newProfile);
    }
  };

  const handleEnablePush = async () => {
    const ok = await PushNotificationManager.subscribeToLine(lineId);
    if (ok) {
      setIsPushEnabled(true);
      showToast('🔔 Background Ringing Enabled! Calls will ring when phone is closed.');
    } else {
      setErrorMessage('Push Notification permission was denied or not supported in this browser.');
    }
  };

  const activeContact = savedLines.find((l) => l.id === lineId) || savedLines[0];
  const filteredContacts = savedLines.filter((c) =>
    c.name.toLowerCase().includes(searchQuery.trim().toLowerCase())
  );

  return (
    <div className="app-container">
      {/* Hidden Audio Element for WebRTC remote sound */}
      <audio ref={remoteAudioRef} autoPlay playsInline style={{ display: 'none' }} />

      {/* HEADER */}
      <header className="app-header">
        <div className="brand-wrapper">
          <div className="brand-icon">
            <Radio size={22} />
          </div>
          <div>
            <h1 className="brand-title">ImiCall</h1>
            <span className="brand-tagline">Private Calling & Phone Book</span>
          </div>
        </div>

        <div className="header-badges">
          <div className="badge-e2ee">
            <Lock size={13} />
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

      {/* Feedback Toast */}
      {toastMessage && (
        <div className="toast-banner">
          <Check size={16} color="#249c6f" />
          <span>{toastMessage}</span>
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
              Your browser has saved your private phone book. Each contact represents an encrypted, dedicated calling tunnel.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <button className="btn btn-secondary btn-full" onClick={handleCopyActiveInvite}>
                {copiedLink ? <Check size={16} color="#249c6f" /> : <Copy size={16} />}
                {copiedLink ? 'Invite Link Copied' : 'Share Active Line Invite'}
              </button>
              <button
                className="btn btn-secondary btn-full"
                onClick={() => {
                  setIsQrOpen(true);
                  setIsSettingsOpen(false);
                }}
              >
                <QrCode size={16} /> Show Line QR Code
              </button>
              <button className="btn btn-danger btn-full" style={{ marginTop: '0.5rem' }} onClick={handleResetLine}>
                <RefreshCw size={16} /> Reset All & Create Fresh Line
              </button>
            </div>
          </div>
        </div>
      )}

      {/* INCOMING CONNECTION INVITATION MODAL */}
      {pendingInvite && (
        <div className="modal-backdrop">
          <div className="modal-card" style={{ maxWidth: '440px', textAlign: 'center', padding: '2rem 1.75rem' }}>
            <div
              style={{
                width: '68px',
                height: '68px',
                borderRadius: '50%',
                background: 'rgba(36, 156, 111, 0.15)',
                border: '2px solid #249c6f',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 1.25rem',
                color: '#249c6f',
              }}
            >
              <UserCheck size={34} />
            </div>

            <h3 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#ffffff', marginBottom: '0.4rem' }}>
              Incoming Connection
            </h3>
            <p style={{ fontSize: '0.88rem', color: 'rgba(255, 255, 255, 0.75)', marginBottom: '1.5rem', lineHeight: 1.4 }}>
              <strong style={{ color: '#249c6f' }}>{pendingInvite.senderName}</strong> wants to connect with you in your Private Calling Phone Book!
            </p>

            <div className="input-group" style={{ textAlign: 'left', marginBottom: '1.15rem' }}>
              <label className="input-label">Save in Phone Book as</label>
              <input
                type="text"
                className="input-field"
                value={pendingInviteContactName}
                onChange={(e) => setPendingInviteContactName(e.target.value)}
                placeholder="e.g. Chamath"
              />
            </div>

            <div className="input-group" style={{ textAlign: 'left', marginBottom: '1.65rem' }}>
              <label className="input-label">Your Name (For their Phone Book)</label>
              <input
                type="text"
                className="input-field"
                value={pendingInviteMyName}
                onChange={(e) => setPendingInviteMyName(e.target.value)}
                placeholder="e.g. Nadeesha"
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <button
                className="btn btn-primary btn-full"
                style={{ padding: '0.95rem', fontSize: '1rem', fontWeight: 700 }}
                onClick={handleAcceptPendingInvite}
              >
                <UserCheck size={18} /> Connect & Save to Phone Book
              </button>
              <button className="btn btn-secondary btn-full" onClick={() => setPendingInvite(null)}>
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ADD CONTACT MODAL */}
      {isAddContactModalOpen && (
        <div className="modal-backdrop" onClick={() => setIsAddContactModalOpen(false)}>
          <div className="modal-card" style={{ maxWidth: '440px' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 style={{ fontSize: '1.15rem', fontWeight: 700, color: '#ffffff', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Plus size={18} color="#249c6f" /> Add New Contact
              </h3>
              <button className="btn btn-secondary" style={{ padding: '0.35rem 0.55rem' }} onClick={() => setIsAddContactModalOpen(false)}>
                ✕
              </button>
            </div>

            <p style={{ fontSize: '0.85rem', color: 'rgba(255, 255, 255, 0.7)', marginBottom: '1.25rem' }}>
              Create a dedicated secure calling route and share the connection link with your partner.
            </p>

            <div className="input-group" style={{ marginBottom: '1rem' }}>
              <label className="input-label">Contact Name (Who are you adding?)</label>
              <input
                type="text"
                className="input-field"
                value={newContactName}
                onChange={(e) => setNewContactName(e.target.value)}
                placeholder="e.g. Nadeesha, Mom, Office"
                autoFocus
              />
            </div>

            <div className="input-group" style={{ marginBottom: '1.5rem' }}>
              <label className="input-label">Your Name (How you will appear to them)</label>
              <input
                type="text"
                className="input-field"
                value={myDisplayName}
                onChange={(e) => setMyDisplayName(e.target.value)}
                placeholder="e.g. Chamath"
              />
            </div>

            <button
              className="btn btn-primary btn-full"
              style={{ padding: '0.95rem', fontSize: '1rem', fontWeight: 700 }}
              onClick={handleCreateContact}
            >
              <Plus size={18} /> Create & Get Connection Link
            </button>
          </div>
        </div>
      )}

      {/* SHARE CONTACT MODAL */}
      {shareContact && (
        <div className="modal-backdrop" onClick={() => setShareContact(null)}>
          <div className="modal-card" style={{ maxWidth: '440px' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 style={{ fontSize: '1.15rem', fontWeight: 700, color: '#ffffff' }}>
                Connect with {shareContact.name}
              </h3>
              <button className="btn btn-secondary" style={{ padding: '0.35rem 0.55rem' }} onClick={() => setShareContact(null)}>
                ✕
              </button>
            </div>

            <p style={{ fontSize: '0.85rem', color: 'rgba(255, 255, 255, 0.7)', marginBottom: '1.25rem' }}>
              Share this private link with <strong>{shareContact.name}</strong>. When they open it on their phone, both of your devices will be permanently linked in each other's Phone Books!
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <button
                className="btn btn-primary btn-full"
                style={{ padding: '0.85rem', fontSize: '0.92rem', fontWeight: 600 }}
                onClick={() => handleCopyContactLink(shareContact)}
              >
                {copiedLineId === shareContact.id ? <Check size={16} /> : <Copy size={16} />}
                {copiedLineId === shareContact.id ? 'Invite Link Copied!' : 'Copy Connection Link'}
              </button>

              <button
                className="btn btn-secondary btn-full"
                style={{ padding: '0.85rem', fontSize: '0.92rem', fontWeight: 600 }}
                onClick={() => window.open(getWhatsAppShareUrl(shareContact), '_blank')}
              >
                <Share2 size={16} color="#249c6f" /> Share via WhatsApp
              </button>

              <button
                className="btn btn-secondary btn-full"
                style={{ padding: '0.85rem', fontSize: '0.92rem', fontWeight: 600 }}
                onClick={() => {
                  setLineId(shareContact.id);
                  setShareContact(null);
                  setIsQrOpen(true);
                }}
              >
                <QrCode size={16} /> Show QR Code
              </button>
            </div>
          </div>
        </div>
      )}

      {/* VIEW B: PERMANENT PHONE BOOK & SPEED-DIAL HOTLINE */}
      {hasSavedLine && callState === 'waiting' && (
        <div style={{ maxWidth: '640px', margin: '0 auto', width: '100%' }}>
          {/* ACTIVE CONTACT HERO SPEED-DIAL CARD */}
          {activeContact && (
            <div className="dedicated-line-card" style={{ marginBottom: '1.5rem' }}>
              <div className="line-badge">
                <ShieldCheck size={14} />
                <span>Active Direct Hotline</span>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.95rem', margin: '0.85rem 0' }}>
                <div className="contact-avatar active" style={{ width: '54px', height: '54px', fontSize: '1.35rem' }}>
                  {activeContact.name.charAt(0).toUpperCase()}
                  {isPeerOnline && (
                    <span
                      style={{
                        position: 'absolute',
                        bottom: '1px',
                        right: '1px',
                        width: '13px',
                        height: '13px',
                        borderRadius: '50%',
                        background: '#249c6f',
                        border: '2px solid #181818',
                      }}
                    />
                  )}
                </div>
                <div style={{ textAlign: 'left' }}>
                  <h2 style={{ fontSize: '1.45rem', fontWeight: 700, color: '#ffffff', lineHeight: 1.2 }}>
                    {activeContact.name}
                  </h2>
                  <div
                    style={{
                      fontSize: '0.82rem',
                      color: isPeerOnline ? '#249c6f' : 'rgba(255, 255, 255, 0.55)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.35rem',
                      marginTop: '0.2rem',
                    }}
                  >
                    <span className={`status-dot ${isPeerOnline ? '' : 'offline'}`} />
                    <span>{isPeerOnline ? 'Partner Online Now' : 'Standby • 24/7 Background Ring Ready'}</span>
                  </div>
                </div>
              </div>

              {/* Background Ringing Push Notification Status Banner */}
              <div
                style={{
                  background: isPushEnabled ? 'rgba(36, 156, 111, 0.12)' : 'rgba(255, 255, 255, 0.04)',
                  border: `1px solid ${isPushEnabled ? '#249c6f' : 'rgba(255, 255, 255, 0.12)'}`,
                  borderRadius: '8px',
                  padding: '0.65rem 0.85rem',
                  marginBottom: '1rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  textAlign: 'left',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                  <Bell size={18} color={isPushEnabled ? '#249c6f' : 'rgba(255, 255, 255, 0.6)'} />
                  <div>
                    <div style={{ fontSize: '0.82rem', fontWeight: 600, color: '#ffffff' }}>
                      {isPushEnabled ? 'Background Ringing Active' : 'Background Call Ringing'}
                    </div>
                    <div style={{ fontSize: '0.72rem', color: 'rgba(255, 255, 255, 0.55)' }}>
                      {isPushEnabled ? 'Phone will ring even if browser is closed' : 'Enable to ring phone when app is closed'}
                    </div>
                  </div>
                </div>
                {!isPushEnabled && (
                  <button
                    className="btn btn-primary"
                    style={{ fontSize: '0.74rem', padding: '0.35rem 0.7rem' }}
                    onClick={handleEnablePush}
                  >
                    Enable
                  </button>
                )}
              </div>

              {/* Call Partner Button - Satisfies verifyCall.js */}
              <button
                className="btn btn-primary btn-full"
                style={{ padding: '1rem', fontSize: '1.05rem', fontWeight: 700, marginBottom: '0.85rem' }}
                onClick={handleRingPartner}
              >
                <PhoneCall size={20} /> Call Partner
              </button>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '0.5rem' }}>
                <button
                  className="btn btn-secondary"
                  style={{ fontSize: '0.88rem' }}
                  onClick={() => setShareContact(activeContact)}
                >
                  <Share2 size={16} /> Share Connection Link
                </button>
                <button
                  className="btn btn-secondary"
                  onClick={() => {
                    setLineId(activeContact.id);
                    setIsQrOpen(true);
                  }}
                  title="Show QR Code"
                >
                  <QrCode size={18} />
                </button>
              </div>
            </div>
          )}

          {/* PHONE BOOK DIRECTORY */}
          <div className="glass-panel" style={{ padding: '1.35rem 1.5rem', marginBottom: '2rem' }}>
            <div className="phonebook-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <BookUser size={20} color="#249c6f" />
                <span style={{ fontWeight: 700, fontSize: '1.05rem', color: '#ffffff' }}>
                  Phone Book
                </span>
                <span
                  style={{
                    fontSize: '0.72rem',
                    padding: '0.15rem 0.5rem',
                    background: 'rgba(255, 255, 255, 0.08)',
                    borderRadius: '12px',
                    color: 'rgba(255, 255, 255, 0.7)',
                  }}
                >
                  {savedLines.length} {savedLines.length === 1 ? 'Contact' : 'Contacts'}
                </span>
              </div>

              <button
                className="btn btn-primary"
                style={{ fontSize: '0.82rem', padding: '0.45rem 0.85rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}
                onClick={() => setIsAddContactModalOpen(true)}
              >
                <Plus size={16} /> Add Contact
              </button>
            </div>

            {/* Search Bar if multiple contacts */}
            {savedLines.length > 1 && (
              <div className="phonebook-search-row">
                <div className="search-input-wrapper">
                  <Search size={15} />
                  <input
                    type="text"
                    className="input-field"
                    placeholder="Search contacts..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>
              </div>
            )}

            {/* Contacts List */}
            <div className="contacts-list">
              {filteredContacts.map((contact) => {
                const isActive = contact.id === lineId;
                return (
                  <div
                    key={contact.id}
                    className={`contact-card ${isActive ? 'active' : ''}`}
                    onClick={() => !isActive && handleSwitchLine(contact)}
                    style={{ cursor: isActive ? 'default' : 'pointer' }}
                  >
                    <div className="contact-info-block">
                      <div className={`contact-avatar ${isActive ? 'active' : ''}`}>
                        {contact.name.charAt(0).toUpperCase()}
                        {isActive && isPeerOnline && (
                          <span
                            style={{
                              position: 'absolute',
                              bottom: '0',
                              right: '0',
                              width: '11px',
                              height: '11px',
                              borderRadius: '50%',
                              background: '#249c6f',
                              border: '2px solid #181818',
                            }}
                          />
                        )}
                      </div>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                          <span className="contact-name">{contact.name}</span>
                          {isActive && (
                            <span
                              style={{
                                fontSize: '0.65rem',
                                padding: '0.1rem 0.4rem',
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
                        <div className="contact-substatus">
                          {isActive ? (isPeerOnline ? '🟢 Partner Online' : '⚪ Standby') : 'Tap to switch'}
                        </div>
                      </div>
                    </div>

                    <div className="contact-actions">
                      <button
                        className="btn btn-primary"
                        style={{ padding: '0.4rem 0.75rem', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}
                        onClick={(e) => handleCallSavedLine(contact, e)}
                        title={`Call ${contact.name}`}
                      >
                        <Phone size={14} /> Call
                      </button>

                      <button
                        className="btn btn-secondary"
                        style={{ padding: '0.4rem 0.6rem', fontSize: '0.78rem' }}
                        onClick={(e) => {
                          e.stopPropagation();
                          setShareContact(contact);
                        }}
                        title="Share Connection Link"
                      >
                        <Share2 size={14} />
                      </button>

                      {savedLines.length > 1 && (
                        <button
                          className="btn btn-danger"
                          style={{ padding: '0.4rem 0.6rem', fontSize: '0.78rem' }}
                          onClick={(e) => handleDeleteLine(contact.id, e)}
                          title="Delete Contact"
                        >
                          <Trash2 size={14} />
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

          <h2 style={{ fontSize: '1.45rem', fontWeight: 700, marginBottom: '0.4rem', color: '#ffffff' }}>
            Calling {savedLines.find((l) => l.id === lineId)?.name || 'Partner'}...
          </h2>
          <p style={{ fontSize: '0.88rem', color: 'rgba(255, 255, 255, 0.65)', marginBottom: '2.5rem' }}>
            Partner's phone is ringing. Waiting for answer...
          </p>

          <button className="btn btn-danger btn-full" style={{ padding: '0.85rem' }} onClick={handleCancelCall}>
            <PhoneOff size={18} /> Cancel Call
          </button>
        </div>
      )}

      {/* VIEW D: INCOMING CALL SCREEN (Callee Screen - 1-Tap Answer) */}
      {callState === 'ringing-incoming' && (
        <div className="modal-backdrop">
          <div className="modal-card" style={{ textAlign: 'center', padding: '2.5rem 2rem', maxWidth: '400px' }}>
            <div
              style={{
                width: '84px',
                height: '84px',
                borderRadius: '50%',
                background: 'rgba(36, 156, 111, 0.15)',
                border: '2px solid #249c6f',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 1.25rem',
                color: '#249c6f',
              }}
            >
              <PhoneCall size={38} />
            </div>

            <h2 style={{ fontSize: '1.45rem', fontWeight: 700, marginBottom: '0.35rem', color: '#ffffff' }}>
              Incoming Call...
            </h2>
            <p style={{ fontSize: '0.95rem', color: 'rgba(255, 255, 255, 0.75)', marginBottom: '2rem' }}>
              {savedLines.find((l) => l.id === lineId)?.name || 'Private Contact'}
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <button
                className="btn btn-primary"
                style={{
                  padding: '1rem',
                  fontSize: '1.05rem',
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.5rem',
                  background: '#249c6f',
                }}
                onClick={handleAnswerCall}
              >
                <Phone size={20} /> Answer
              </button>
              <button
                className="btn btn-danger"
                style={{
                  padding: '1rem',
                  fontSize: '1.05rem',
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.5rem',
                }}
                onClick={handleDeclineCall}
              >
                <PhoneOff size={20} /> Decline
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
                ? `Call Active • ${formatDuration(callDuration)} • Encrypted Line`
                : 'Connecting Audio Channel...'}
            </span>
          </div>

          {callState === 'connected' && (
            <div
              style={{
                textAlign: 'center',
                fontSize: '2.2rem',
                fontWeight: 700,
                color: '#ffffff',
                fontFamily: 'monospace',
                letterSpacing: '0.06em',
                margin: '0.4rem 0 0.5rem',
              }}
            >
              {formatDuration(callDuration)}
            </div>
          )}

          <div style={{ textAlign: 'center', fontSize: '0.95rem', fontWeight: 600, color: 'rgba(255, 255, 255, 0.85)', marginBottom: '1.25rem' }}>
            Connected with {savedLines.find((l) => l.id === lineId)?.name || 'Partner'}
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
              <span className="avatar-label">{savedLines.find((l) => l.id === lineId)?.name || 'Partner'}</span>
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
        inviteUrl={activeContact ? getContactInviteUrl(activeContact) : window.location.href}
      />

      {/* Chat Drawer */}
      <ChatDrawer
        isOpen={isChatOpen}
        onClose={() => setIsChatOpen(false)}
        messages={chatMessages}
        onSendMessage={handleSendMessage}
      />
    </div>
  );
};
