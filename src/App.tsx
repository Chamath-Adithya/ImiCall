import React, { useState, useEffect, useRef } from 'react';
import {
  Phone,
  PhoneOff,
  PhoneCall,
  Mic,
  MicOff,
  Activity,
  MessageSquare,
  QrCode,
  Copy,
  Check,
  Lock,
  Volume2,
  BellRing,
  Settings,
  RefreshCw,
  Share2,
  Plus,
  Trash2,
  Bell,
  Search,
  UserCheck,
  Camera,
  Clipboard,
} from 'lucide-react';
import { SignalProfile, NetworkStats, ChatMessage, CallState, SIGNAL_PROFILES } from './core/types';
import { newLineId, newLineSecret, isSecureLine } from './core/privateLine';
import { useModalFocus } from './core/modalFocus';
import { runtimeConfig } from './core/runtimeConfig';
import { localStore } from './core/localStore';
import { WebRTCClient } from './core/webrtcClient';
import { PushNotificationManager } from './core/pushManager';
import { AudioWaveform } from './components/AudioWaveform';

const DiagnosticsModal = React.lazy(() =>
  import('./components/DiagnosticsModal').then((m) => ({ default: m.DiagnosticsModal }))
);
const QrModal = React.lazy(() =>
  import('./components/QrModal').then((m) => ({ default: m.QrModal }))
);
const ChatDrawer = React.lazy(() =>
  import('./components/ChatDrawer').then((m) => ({ default: m.ChatDrawer }))
);
const CameraQrScanner = React.lazy(() =>
  import('./components/CameraQrScanner').then((m) => ({ default: m.CameraQrScanner }))
);

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

const generateRandomLineId = newLineId;

export const App: React.FC = () => {
  useModalFocus();
  // Phone Book & Line State
  const [micReady, setMicReady] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const [permissionBusy, setPermissionBusy] = useState(false);
  const [permissionError, setPermissionError] = useState('');
  const [onlineLines, setOnlineLines] = useState<Record<string, boolean>>({});
  const clientsRef = useRef(new Map<string, WebRTCClient>());
  const linesRef = useRef<SavedLine[]>([]);
  const [lineId, setLineId] = useState<string>('');
  const [passcode, setPasscode] = useState<string>('');
  const [hasSavedLine, setHasSavedLine] = useState<boolean>(false);
  const [savedLines, setSavedLines] = useState<SavedLine[]>([]);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedProfile, setSelectedProfile] = useState<SignalProfile>('balanced');
  const [callState, setCallState] = useState<CallState>('waiting');
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
  const [isQrScannerOpen, setIsQrScannerOpen] = useState<boolean>(false);
  const [isChatOpen, setIsChatOpen] = useState<boolean>(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
  const [isAddContactModalOpen, setIsAddContactModalOpen] = useState<boolean>(false);
  const [addContactTab, setAddContactTab] = useState<'create' | 'paste'>('create');
  const [pastedInviteInput, setPastedInviteInput] = useState<string>('');
  const [pastedContactNickname, setPastedContactNickname] = useState<string>('');
  const [serverPublicUrl, setServerPublicUrl] = useState<string>('');
  const [newContactName, setNewContactName] = useState<string>('');
  const [myDisplayName, setMyDisplayName] = useState<string>(() => localStore.getItem(MY_NAME_KEY) || '');
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
    linesRef.current = lines;
    setSavedLines(lines);
    localStore.setItem(STORAGE_LINES_KEY, JSON.stringify(lines));
    localStore.setItem(ACTIVE_LINE_ID_KEY, activeId);
  };

  useEffect(() => {
    let cancelled = false;
    void PushNotificationManager.registerServiceWorker();
    navigator.permissions?.query({ name: 'microphone' as PermissionName }).then(status => {
      if (cancelled) return;
      setMicReady(status.state === 'granted');
      setSetupOpen(status.state !== 'granted');
      status.onchange = () => { if (!cancelled) setMicReady(status.state === 'granted'); };
    }).catch(() => { if (!cancelled) setSetupOpen(true); });
    if (!navigator.permissions) setSetupOpen(true);
    const connection = (navigator as any).connection;
    if (connection?.saveData || ['2g', 'slow-2g'].includes(connection?.effectiveType)) setSelectedProfile('extreme');
    runtimeConfig().then(data => { if (!cancelled) setServerPublicUrl(data.publicUrl || ''); }).catch(() => {});
    let list: SavedLine[] = [];
    try {
      const stored = JSON.parse(localStore.getItem(STORAGE_LINES_KEY) || '[]');
      if (Array.isArray(stored)) list = stored.filter(l => typeof l?.id === 'string' && /^[a-zA-Z0-9_-]{3,80}$/.test(l.id) && typeof l.name === 'string' && typeof l.passcode === 'string').slice(0, 100).map(l => ({ ...l, name: l.name.slice(0, 80) }));
    } catch { setErrorMessage('Saved contacts could not be read. Your browser may have cleared its storage.'); }
    const hash = new URLSearchParams(location.hash.slice(1));
    const inviteId = hash.get('connect') || hash.get('line');
    const secret = hash.get('pin') || '';
    if (location.search) {
      setErrorMessage('For privacy, invites must use the complete link with a # fragment. Ask your contact for a new link.');
      history.replaceState(null, '', location.pathname + location.hash);
    }
    if (inviteId) {
      history.replaceState(null, '', location.pathname);
      const known = list.find(l => l.id === inviteId && l.passcode === secret);
      if (!isSecureLine(inviteId, secret)) setErrorMessage('This old invite needs upgrading. Ask your contact to create a new connection.');
      else if (list.some(l => l.id === inviteId && l.passcode !== secret)) setErrorMessage('This invite conflicts with a saved connection. Ask your contact for a fresh connection link.');
      else if (!known) {
        setPendingInvite({ lineId: inviteId, pin: secret, senderName: hash.get('from')?.slice(0, 80) || 'Your contact', myName: '' });
        setPendingInviteContactName(hash.get('from')?.slice(0, 80) || 'Your contact');
        setPendingInviteMyName(localStore.getItem(MY_NAME_KEY) || '');
      } else localStore.setItem(ACTIVE_LINE_ID_KEY, known.id);
    }
    const wakeId = hash.get('wake');
    if (wakeId) { if (list.some(l => l.id === wakeId)) localStore.setItem(ACTIVE_LINE_ID_KEY, wakeId); history.replaceState(null, '', location.pathname); }
    if (!list.length) list = [{ id: newLineId(), name: 'Your first connection', passcode: newLineSecret(), createdAt: Date.now() }];
    const active = list.find(l => l.id === localStore.getItem(ACTIVE_LINE_ID_KEY)) || list[0];
    saveLinesList(list, active.id);
    setLineId(active.id); setPasscode(active.passcode); setHasSavedLine(true);
    return () => { cancelled = true; clientsRef.current.forEach(c => c.close()); clientsRef.current.clear(); clientRef.current = null; };
  }, []);

  useEffect(() => {
    linesRef.current = savedLines;
    for (const [id, client] of clientsRef.current) {
      if (!savedLines.some(l => l.id === id)) { client.close(); clientsRef.current.delete(id); }
    }
    for (const line of savedLines) if (isSecureLine(line.id, line.passcode)) ensureClient(line);
    const active = savedLines.find(l => l.id === lineId);
    if (active) void connectSavedLine(active.id, active.passcode);
  }, [savedLines, lineId]);

  const requestMicrophone = async () => {
    setPermissionBusy(true); setPermissionError('');
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Open ImiCall over HTTPS in a supported browser.');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      stream.getTracks().forEach(track => track.stop());
      setMicReady(true); setSetupOpen(false);
    } catch (error) {
      setPermissionError(error instanceof Error && error.name === 'NotAllowedError' ? 'Microphone access is required to make and answer calls. Open this site’s browser permissions, allow Microphone, then try again.' : 'Microphone unavailable. Connect a microphone and allow access in browser settings. HTTPS is required.');
      setMicReady(false);
    } finally { setPermissionBusy(false); }
  };

  // Poll volume for VU visualizer
  useEffect(() => {
    if (callState === 'connected') {
      volumeIntervalRef.current = setInterval(() => {
        if (clientRef.current && !document.hidden) {
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

  const ensureClient = (line: SavedLine) => {
    const existing = clientsRef.current.get(line.id);
    if (existing) return existing;
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const client = new WebRTCClient({ signalingUrl: `${protocol}//${location.host}/ws`, roomId: line.id, passcode: line.passcode, profile: selectedProfile });
    clientsRef.current.set(line.id, client);
    client.onStateChange = state => {
      if (state === 'ringing-incoming' && clientRef.current !== client) {
        if (clientRef.current && !['waiting', 'idle', 'error'].includes(clientRef.current.getState())) { client.declineIncomingCall(); return; }
        clientRef.current = client; setLineId(line.id); setPasscode(line.passcode);
        localStore.setItem(ACTIVE_LINE_ID_KEY, line.id);
      }
      if (clientRef.current === client) {
        setCallState(['idle', 'disconnected', 'error'].includes(state) ? 'waiting' : state);
        if (state === 'waiting') { setNetworkStats(null); setChatMessages([]); setIsMuted(false); }
      }
      if (state === 'waiting' && localStore.getItem('imicall_push_optin') === 'yes') {
        void PushNotificationManager.subscribeToLine(line.id, line.passcode).then(ok => { if (clientRef.current === client) setIsPushEnabled(ok); });
      }
    };
    client.onPeerStatusChange = online => { setOnlineLines(prev => ({ ...prev, [line.id]: online })); if (clientRef.current === client) setIsPeerOnline(online); };
    client.onStatsUpdate = stats => { if (clientRef.current === client) setNetworkStats(stats); };
    client.onRemoteStream = stream => { if (clientRef.current === client && remoteAudioRef.current) client.audioManager.setupRemoteAudio(stream, remoteAudioRef.current); };
    client.onChatMessage = message => { if (clientRef.current === client) { setChatMessages(prev => [...prev.slice(-199), message]); setHasUnreadChat(true); } };
    client.onProfileChange = profile => { if (clientRef.current === client) setSelectedProfile(profile); };
    client.onContactDeleted = () => { showToast('Your contact removed this connection. You can remove your local copy.'); };
    client.onError = error => { if (clientRef.current === client) { setErrorMessage(error); if (error.startsWith('Microphone')) { setMicReady(false); setSetupOpen(true); } } };
    void client.start();
    return client;
  };

  const connectSavedLine = async (id: string, secret: string) => {
    if (!isSecureLine(id, secret)) { clientRef.current = null; setCallState('waiting'); return; }
    const line = linesRef.current.find(l => l.id === id) || { id, name: 'Contact', passcode: secret, createdAt: Date.now() };
    const client = ensureClient(line);
    clientRef.current = client;
    setIsPeerOnline(client.isPeerPresent());
    setCallState(client.getState() === 'idle' ? 'waiting' : client.getState());
  };
  const handleSwitchLine = (line: SavedLine) => {
    setLineId(line.id); setPasscode(line.passcode);
    localStore.setItem(ACTIVE_LINE_ID_KEY, line.id);
    void connectSavedLine(line.id, line.passcode);
  };
  const handleCallSavedLine = async (line: SavedLine, e: React.MouseEvent) => {
    e.stopPropagation(); handleSwitchLine(line);
    if (!micReady) { setSetupOpen(true); return; }
    if (!isSecureLine(line.id, line.passcode)) { setErrorMessage('Upgrade this older connection before calling.'); return; }
    setErrorMessage(null);
    await ensureClient(line).ringPartner(line.passcode);
  };

  // Add Contact flow
  const handleCreateContact = () => {
    if (savedLines.length >= 100) { setErrorMessage('Your phone book supports up to 100 connections. Remove an unused contact first.'); return; }
    const nameToUse = newContactName.trim().slice(0, 80) || `Contact ${savedLines.length + 1}`;
    const idToUse = generateRandomLineId();
    const pinToUse = newLineSecret();

    if (myDisplayName.trim()) {
      localStore.setItem(MY_NAME_KEY, myDisplayName.trim());
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

  // Import connection from pasted link or raw room ID
  const handleImportPastedLink = () => {
    const raw = pastedInviteInput.trim();
    if (!raw) {
      setErrorMessage('Please enter an invite link or Room ID.');
      return;
    }

    let parsedLineId = '';
    let parsedSender = '';
    let parsedPin = '';

    try {
      if (raw.includes('#') || raw.includes('?')) {
        const dummyBase = 'http://dummy.com/';
        const urlObj = new URL(raw.startsWith('http') ? raw : dummyBase + raw);
        const hashParams = new URLSearchParams(urlObj.hash.replace(/^#/, ''));
        const searchParams = urlObj.searchParams;

        parsedLineId =
          hashParams.get('connect') ||
          hashParams.get('line') ||
          hashParams.get('room') ||
          searchParams.get('connect') ||
          searchParams.get('line') ||
          searchParams.get('room') ||
          '';

        parsedSender =
          hashParams.get('from') ||
          hashParams.get('caller') ||
          hashParams.get('name') ||
          searchParams.get('from') ||
          searchParams.get('caller') ||
          searchParams.get('name') ||
          '';

        parsedPin = hashParams.get('pin') || searchParams.get('pin') || '';
      }
    } catch (e) {}

    if (!parsedLineId) {
      if (/^[a-zA-Z0-9_-]{3,60}$/.test(raw)) {
        parsedLineId = raw;
      }
    }

    if (!isSecureLine(parsedLineId, parsedPin)) {
      setErrorMessage('Use the full private invitation link, including its secret. Older links must be upgraded.');
      return;
    }

    const contactName =
      pastedContactNickname.trim() ||
      parsedSender ||
      `Contact ${savedLines.length + 1}`;

    const newContact: SavedLine = {
      id: parsedLineId,
      name: contactName,
      passcode: parsedPin,
      createdAt: Date.now(),
    };

    const updated = [newContact, ...savedLines.filter((l) => l.id.toLowerCase() !== parsedLineId.toLowerCase())];
    saveLinesList(updated, parsedLineId);
    setLineId(parsedLineId);
    setPasscode(parsedPin);
    setHasSavedLine(true);
    setIsAddContactModalOpen(false);
    setPastedInviteInput('');
    setPastedContactNickname('');
    connectSavedLine(parsedLineId, parsedPin);
    showToast(`Added "${contactName}" to your Phone Book!`);
  };

  const handleScannedQrResult = (scannedText: string) => {
    setIsQrScannerOpen(false);
    setPastedInviteInput(scannedText);
    setAddContactTab('paste');
    setIsAddContactModalOpen(true);
    showToast('QR Code captured! Review and save to Phone Book.');
  };

  // Accept incoming invite flow
  const handleAcceptPendingInvite = () => {
    if (!pendingInvite) return;
    const contactName = pendingInviteContactName.trim() || pendingInvite.senderName || 'Partner';
    if (pendingInviteMyName.trim()) {
      localStore.setItem(MY_NAME_KEY, pendingInviteMyName.trim());
      setMyDisplayName(pendingInviteMyName.trim());
    }

    const newContact: SavedLine = {
      id: pendingInvite.lineId,
      name: contactName,
      passcode: pendingInvite.pin || '',
      createdAt: Date.now(),
    };

    const updated = [newContact, ...savedLines.filter((l) => l.id.toLowerCase() !== pendingInvite.lineId.toLowerCase())];
    saveLinesList(updated, pendingInvite.lineId);
    setLineId(pendingInvite.lineId);
    setPasscode(pendingInvite.pin || '');
    setHasSavedLine(true);
    connectSavedLine(pendingInvite.lineId, pendingInvite.pin || '');

    window.history.replaceState(null, '', window.location.pathname);
    setPendingInvite(null);
    showToast(`Connected with ${contactName}! Added to your Phone Book.`);
  };

  const handleDeleteLine = (idToDelete: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm("Remove this contact from your browser? Keep their invite if you want to reconnect later.")) return;

    const removed = savedLines.find(line => line.id === idToDelete);
    if (removed) void PushNotificationManager.unsubscribeFromLine(removed.id, removed.passcode);
    clientsRef.current.get(idToDelete)?.notifyContactDeleted(idToDelete);
    // 3. Update locally
    const updated = savedLines.filter((l) => l.id !== idToDelete);
    let nextActive = lineId;
    if (updated.length === 0) {
      const freshId = generateRandomLineId();
      const freshLine: SavedLine = {
        id: freshId,
        name: 'Your first connection',
        passcode: newLineSecret(),
        createdAt: Date.now(),
      };
      updated.push(freshLine);
      nextActive = freshId;
    } else if (lineId === idToDelete) {
      nextActive = updated[0].id;
    }

    setLineId(nextActive);
    const activeObj = updated.find((l) => l.id === nextActive) || updated[0];
    setPasscode(activeObj.passcode);
    saveLinesList(updated, nextActive);
    connectSavedLine(nextActive, activeObj.passcode);
    showToast('Contact removed from this browser.');
  };

  const getContactInviteUrl = (contact: SavedLine) => {
    let baseUrl = window.location.origin;
    if (serverPublicUrl && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
      baseUrl = serverPublicUrl;
    }
    const myStoredName = localStore.getItem(MY_NAME_KEY) || myDisplayName || 'Partner';
    return `${baseUrl}/#connect=${encodeURIComponent(contact.id)}&from=${encodeURIComponent(myStoredName)}&to=${encodeURIComponent(contact.name)}&pin=${encodeURIComponent(contact.passcode)}`;
  };

  const getWhatsAppShareUrl = (contact: SavedLine) => {
    const inviteUrl = getContactInviteUrl(contact);
    const myStoredName = localStore.getItem(MY_NAME_KEY) || myDisplayName || 'Your partner';
    const text = `Hey ${contact.name}! Connect with ${myStoredName} on ImiCall Private Calling. Tap this link to add me to your Phone Book: ${inviteUrl}`;
    return `https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`;
  };

  const handleCopyContactLink = async (contact: SavedLine, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    try { await navigator.clipboard.writeText(getContactInviteUrl(contact)); } catch { setErrorMessage('Copy failed. Use the QR code or allow clipboard access.'); return; }
    setCopiedLineId(contact.id);
    showToast(`Invite link for "${contact.name}" copied!`);
    setTimeout(() => setCopiedLineId(null), 2500);
  };

  const handleCopyActiveInvite = async () => {
    const activeContact = savedLines.find((l) => l.id === lineId);
    if (!activeContact) return;
    try { await navigator.clipboard.writeText(getContactInviteUrl(activeContact)); } catch { setErrorMessage('Copy failed. Use the QR code or allow clipboard access.'); return; }
    setCopiedLink(true);
    showToast('Connection invite link copied!');
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const handleResetLine = async () => {
    if (!window.confirm('Remove all ImiCall contacts, your saved name and notification subscriptions from this browser? You will need fresh invites to reconnect.')) return;
    await disablePush();
    clientsRef.current.forEach(client => client.close()); clientsRef.current.clear();
    [MY_NAME_KEY, LEGACY_STORAGE_KEY, 'imicall_device_v2'].forEach(key => localStore.removeItem(key));
    setMyDisplayName('');
    localStore.removeItem(STORAGE_LINES_KEY);
    localStore.removeItem(ACTIVE_LINE_ID_KEY);
    if (clientRef.current) {
      clientRef.current.close();
      clientRef.current = null;
    }
    const firstId = generateRandomLineId();
    const defaultLine: SavedLine = {
      id: firstId,
      name: 'Your first connection',
      passcode: newLineSecret(),
      createdAt: Date.now(),
    };
    saveLinesList([defaultLine], firstId);
    setLineId(firstId);
    setPasscode(defaultLine.passcode);
    setIsSettingsOpen(false);
    connectSavedLine(firstId, defaultLine.passcode);
    showToast('Phone Book reset to new primary line.');
  };

  // 1-Tap Call Partner
  const handleRingPartner = async () => {
    if (!micReady) { setSetupOpen(true); return; }
    if (!isSecureLine(lineId, passcode)) { setErrorMessage('Upgrade this older connection before calling.'); return; }
    if (!clientRef.current) {
      await connectSavedLine(lineId, passcode);
    }
    clientRef.current?.audioManager.resumeAudio();
    setErrorMessage(null);
    await clientRef.current?.ringPartner(passcode);
  };

  // Callee answers with 1 tap (no manual PIN typing required)
  const handleAnswerCall = async () => {
    if (!clientRef.current) return;
    clientRef.current.audioManager.resumeAudio();
    setErrorMessage(null);
    const pinToUse = passcode || '';
    await clientRef.current.acceptIncomingCall(pinToUse);
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
    const msg = clientRef.current.sendChatMessage(text);
    if (msg) setChatMessages(prev => [...prev.slice(-199), msg]);
    else showToast('Message not sent. Wait for the call connection and try again.');
  };

  const handleProfileSwitch = (newProfile: SignalProfile) => {
    setSelectedProfile(newProfile);
    if (clientRef.current) {
      clientRef.current.setProfile(newProfile);
    }
  };

  const handleEnablePush = async () => {
    if (!('Notification' in window) || !('PushManager' in window)) { setErrorMessage('Notifications are unavailable here. On iPhone, add ImiCall to your Home Screen and open it there.'); return; }
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') { setErrorMessage('Notifications are off. Allow them in browser settings to receive background alerts.'); return; }
    localStore.setItem('imicall_push_optin', 'yes');
    const results = await Promise.all(savedLines.filter(l => isSecureLine(l.id, l.passcode)).map(l => PushNotificationManager.subscribeToLine(l.id, l.passcode)));
    setIsPushEnabled(results.length > 0 && results.every(Boolean));
    showToast(results.every(Boolean) ? 'Call alerts enabled. Delivery depends on your browser and device.' : 'Some alerts could not be enabled. Reconnect, then try again.');
  };
  useEffect(() => {
    const renew = setInterval(() => {
      if (localStore.getItem('imicall_push_optin') === 'yes') for (const line of linesRef.current) if (isSecureLine(line.id, line.passcode)) void PushNotificationManager.subscribeToLine(line.id, line.passcode);
    }, 3600000);
    return () => clearInterval(renew);
  }, []);
  const disablePush = async () => {
    localStore.removeItem('imicall_push_optin');
    await PushNotificationManager.disable(savedLines); setIsPushEnabled(false); showToast('Background call alerts disabled.');
  };
  const upgradeLine = () => {
    if (!activeContact) return;
    const upgraded = { ...activeContact, id: newLineId(), passcode: newLineSecret(), createdAt: Date.now() };
    saveLinesList(savedLines.map(l => l.id === activeContact.id ? upgraded : l), upgraded.id);
    handleSwitchLine(upgraded); setShareContact(upgraded);
  };

  const activeContact = savedLines.find((l) => l.id === lineId) || savedLines[0];
  const filteredContacts = savedLines.filter((c) =>
    c.name.toLowerCase().includes(searchQuery.trim().toLowerCase())
  );

  const isInCall = callState === 'connecting' || callState === 'connected' || callState === 'reconnecting';

  return (
    <div className={`app-container ${isInCall ? 'in-call' : ''}`}>
      {/* Hidden Audio Element for WebRTC remote sound */}
      <audio ref={remoteAudioRef} autoPlay playsInline style={{ display: 'none' }} />

      {/* HEADER */}
      <header className="app-header">
        <div className="brand-wrapper">
          <img className="brand-icon" src="/icon.svg" alt="" width="40" height="40" />
          <div>
            <h1 className="brand-title">ImiCall</h1>
            <span className="brand-tagline">A private line to your people.</span>
          </div>
        </div>

        <div className="header-badges">
          <div className="badge-e2ee">
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#249c6f', display: 'inline-block' }} />
            <Lock size={12} />
            <span>Private by design</span>
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

      {setupOpen && <div className="modal-backdrop permission-backdrop"><section className="modal-card permission-setup" role="dialog" aria-modal="true" aria-labelledby="permission-title">
        <img src="/icon.svg" width="48" height="48" alt="" /><span className="eyebrow">ONE SMALL STEP</span>
        <h2 id="permission-title">Make room for a hello.</h2><p>ImiCall needs your microphone for voice calls. No account, phone number or contact upload needed.</p>
        <div className="permission-detail"><Mic size={22} /><div><strong>Microphone · required for calls</strong><p>We check access, then switch it off. It is only used while placing or answering a call.</p></div></div>
        {permissionError && <p className="permission-error" role="alert">{permissionError}</p>}
        <button className="btn btn-primary btn-full" onClick={requestMicrophone} disabled={permissionBusy}>{permissionBusy ? 'Waiting for browser permission…' : 'Allow microphone'}</button>
        <button className="btn btn-quiet btn-full" onClick={() => setSetupOpen(false)}>Browse contacts first</button>
        <small>Calls stay unavailable until microphone access is allowed. Notifications are optional and can be enabled separately.</small>
      </section></div>}

      {/* Error Banner */}
      {errorMessage && (
        <div
          style={{
            background: '#1f1f1f',
            border: '0',
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
        <div className="toast-banner" role="status">
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
              Names and invite secrets are saved only in this browser. Anyone using this browser profile can access them. Clearing site data removes your contacts.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <button className="btn btn-secondary btn-full" onClick={() => { setIsSettingsOpen(false); setSetupOpen(true); }}><Mic size={16} /> Microphone permissions</button>
              {isPushEnabled && <button className="btn btn-secondary btn-full" onClick={disablePush}><Bell size={16} /> Disable background alerts</button>}
              <a className="btn btn-secondary btn-full" href="/privacy.html">Read privacy & storage details</a>
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
                border: '0',
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
          <div className="modal-card" style={{ maxWidth: '460px' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 style={{ fontSize: '1.15rem', fontWeight: 700, color: '#ffffff', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Plus size={18} color="#249c6f" /> Add Connection
              </h3>
              <button className="btn btn-secondary" style={{ padding: '0.35rem 0.55rem' }} onClick={() => setIsAddContactModalOpen(false)}>
                ✕
              </button>
            </div>

            {/* Tab Navigation */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '0.4rem',
                marginBottom: '1.25rem',
                background: '#111111',
                padding: '0.3rem',
                borderRadius: '8px',
              }}
            >
              <button
                className={`btn ${addContactTab === 'create' ? 'btn-primary' : 'btn-secondary'}`}
                style={{ padding: '0.55rem', fontSize: '0.85rem', fontWeight: 600 }}
                onClick={() => setAddContactTab('create')}
              >
                <Plus size={15} /> Create connection
              </button>
              <button
                className={`btn ${addContactTab === 'paste' ? 'btn-primary' : 'btn-secondary'}`}
                style={{ padding: '0.55rem', fontSize: '0.85rem', fontWeight: 600 }}
                onClick={() => setAddContactTab('paste')}
              >
                <Clipboard size={15} /> Paste Link / Code
              </button>
            </div>

            {addContactTab === 'create' ? (
              <>
                <p style={{ fontSize: '0.84rem', color: 'rgba(255, 255, 255, 0.7)', marginBottom: '1.15rem' }}>
                  Generate an encrypted tunnel and share the connection link or QR with your partner.
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

                <div className="input-group" style={{ marginBottom: '1.35rem' }}>
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
                  style={{ padding: '0.95rem', fontSize: '1rem', fontWeight: 700, marginBottom: '0.65rem' }}
                  onClick={handleCreateContact}
                >
                  <Plus size={18} /> Create & Get Connection Link
                </button>

                <button
                  className="btn btn-secondary btn-full"
                  style={{ padding: '0.75rem', fontSize: '0.86rem' }}
                  onClick={() => {
                    setIsAddContactModalOpen(false);
                    setIsQrScannerOpen(true);
                  }}
                >
                  <Camera size={16} /> Scan Partner's QR Code
                </button>
              </>
            ) : (
              <>
                <p style={{ fontSize: '0.84rem', color: 'rgba(255, 255, 255, 0.7)', marginBottom: '1.15rem' }}>
                  Paste an invite link, URL, or room code sent by your partner to instantly link both devices.
                </p>

                <div className="input-group" style={{ marginBottom: '1rem' }}>
                  <label className="input-label">Invite Link or Room Code</label>
                  <textarea
                    className="input-field"
                    rows={3}
                    style={{ resize: 'none', fontSize: '0.86rem' }}
                    value={pastedInviteInput}
                    onChange={(e) => setPastedInviteInput(e.target.value)}
                    placeholder="Paste link (e.g. https://.../#connect=line-xxxx) or Room ID (line-xxxx-xxxx)"
                    autoFocus
                  />
                </div>

                <div className="input-group" style={{ marginBottom: '1.35rem' }}>
                  <label className="input-label">Contact Nickname (Optional)</label>
                  <input
                    type="text"
                    className="input-field"
                    value={pastedContactNickname}
                    onChange={(e) => setPastedContactNickname(e.target.value)}
                    placeholder="e.g. Alex, Home, Work"
                  />
                </div>

                <button
                  className="btn btn-primary btn-full"
                  style={{ padding: '0.95rem', fontSize: '1rem', fontWeight: 700, marginBottom: '0.65rem' }}
                  onClick={handleImportPastedLink}
                >
                  <UserCheck size={18} /> Save to Phone Book & Connect
                </button>

                <button
                  className="btn btn-secondary btn-full"
                  style={{ padding: '0.75rem', fontSize: '0.86rem' }}
                  onClick={() => {
                    setIsAddContactModalOpen(false);
                    setIsQrScannerOpen(true);
                  }}
                >
                  <Camera size={16} /> Scan QR Code with Camera
                </button>
              </>
            )}
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
      {hasSavedLine && (callState === 'waiting' || callState === 'idle') && (
        <main className="workspace">
          <div className="workspace-grid">
            <section className="phonebook-panel" aria-labelledby="phonebook-title">
              <div className="phonebook-header">
                <div><span className="eyebrow">YOUR PEOPLE</span><h2 id="phonebook-title">Phone Book <span>{savedLines.length}</span></h2></div>
                <button className="btn btn-add" onClick={() => setIsAddContactModalOpen(true)} aria-label="Add Contact"><Plus size={19} /><span>Add contact</span></button>
              </div>
              <div className="search-input-wrapper"><Search size={18} /><input className="input-field" type="search" aria-label="Search contacts" placeholder="Search your people" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} /></div>
              <div className="directory-label"><span>ALL CONNECTIONS</span><span>Saved on this device</span></div>
              <div className="contacts-list" role="list" aria-label="Your contacts">
                {filteredContacts.length === 0 && <div className="empty-search"><Search size={26} /><p>No one by that name.</p><span>Try another name or add a new connection.</span></div>}
                {filteredContacts.map(contact => <div role="listitem" className={`contact-card ${contact.id === lineId ? 'active' : ''}`} key={contact.id}>
                  <button className="contact-select" onClick={() => handleSwitchLine(contact)} aria-pressed={contact.id === lineId}>
                    <span className="contact-avatar">{contact.name.charAt(0).toUpperCase()}</span>
                    <span className="contact-details"><span className="contact-name">{contact.name}</span><span className="contact-substatus"><span className={`status-dot ${onlineLines[contact.id] ? '' : 'offline'}`} />{!isSecureLine(contact.id, contact.passcode) ? 'Upgrade connection' : onlineLines[contact.id] ? 'Available to call' : 'Offline · invite to connect'}</span></span>
                  </button>
                  <button className="btn contact-call" title={`Call ${contact.name}`} aria-label={`Call ${contact.name}`} onClick={e => handleCallSavedLine(contact, e)}><Phone size={18} /></button>
                </div>)}
              </div>
              <div className="directory-tip"><Lock size={15} /><span>No account. No address-book upload.<br /><strong>Just the people you choose.</strong></span></div>
            </section>
            {activeContact && <section className="conversation-panel" aria-label="Selected connection">
              <div className="conversation-top"><span><span className="status-dot" /> PRIVATE VOICE</span><button className="btn btn-quiet" title="Delete Contact" onClick={e => handleDeleteLine(activeContact.id, e)}><Trash2 size={17} /><span>Remove</span></button></div>
              <div className="conversation-center">
                <div className="hero-avatar">{activeContact.name.charAt(0).toUpperCase()}</div>
                <h2>{activeContact.name}</h2>
                <p>{isPeerOnline ? 'They’re here. Say hello.' : 'A familiar voice is worth making time for.'}</p>
                {!isSecureLine(activeContact.id, activeContact.passcode) ? <button className="btn btn-add" onClick={upgradeLine}><RefreshCw size={18} /> Upgrade & share new link</button> : <>
                  <button className="btn btn-primary main-call" onClick={handleRingPartner}><Phone size={21} /> Call Partner</button>
                  <span className="call-hint">{isPeerOnline ? 'Available now' : 'Share your invite to get connected'}</span>
                </>}
              </div>
              <div className="connection-tools">
                <button className="btn btn-share" onClick={() => setShareContact(activeContact)}><Share2 size={18} /> Share invite</button>
                <button className="btn btn-secondary" title="Show QR Code" onClick={() => setIsQrOpen(true)}><QrCode size={18} /> QR code</button>
              </div>
              <div className="permission-row"><Bell size={18} /><div><strong>{isPushEnabled ? 'Call alerts are on' : 'Don’t miss a hello.'}</strong><p>{isPushEnabled ? 'Temporary delivery routing · device limits apply' : 'Turn on optional background call alerts.'}</p></div><button className="btn btn-alert" onClick={isPushEnabled ? disablePush : handleEnablePush}>{isPushEnabled ? 'Turn off' : 'Enable'}</button></div>
            </section>}
          </div>
          {!micReady && <div className="mic-notice"><Mic size={17} /><span>Microphone access is required to make and answer calls.</span><button className="btn btn-secondary" onClick={() => setSetupOpen(true)}>Set up microphone</button></div>}
          {localStore.isUnavailable() && <p role="alert" className="mic-notice">Browser storage is unavailable. Contacts will be lost when you leave. Enable site storage to keep them.</p>}
          <footer className="workspace-footer"><span><Lock size={13} /> Your contacts stay in this browser.</span><nav aria-label="Learn about ImiCall"><a href="/about.html">Why ImiCall</a><a href="/privacy.html">Privacy, explained</a><button onClick={() => setIsSettingsOpen(true)}>Settings</button></nav></footer>
        </main>
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
              border: '0',
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
                border: '0',
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

          {/* Compact Telemetry Chip (Mobile friendly, tap opens diagnostics) */}
          <div
            className="call-telemetry-chip"
            onClick={() => setIsDiagnosticsOpen(true)}
            role="button"
            tabIndex={0}
            title="Tap for Signal Diagnostics & Profiles"
          >
            <span className="telemetry-dot" />
            <span>{networkStats ? `${networkStats.rtt}ms RTT` : 'Direct HD'}</span>
            <span className="telemetry-divider">•</span>
            <span>{networkStats ? `${networkStats.packetLoss}% loss` : '0% loss'}</span>
            <span className="telemetry-divider">•</span>
            <span>{SIGNAL_PROFILES[selectedProfile].badge}</span>
            <Activity size={13} style={{ opacity: 0.65, marginLeft: '3px' }} />
          </div>

          {/* Desktop Live Metrics (hidden on mobile <= 640px) */}
          <div className="metrics-strip desktop-only">
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

          {/* Desktop Profile Switcher (hidden on mobile <= 640px) */}
          <div className="profile-switcher-row desktop-only" style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
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
              border: '0',
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

      {/* On-Demand Lazy Loaded Modals for Instant 2G Loading */}
      <React.Suspense fallback={null}>
        {isDiagnosticsOpen && (
          <DiagnosticsModal
            isOpen={isDiagnosticsOpen}
            onClose={() => setIsDiagnosticsOpen(false)}
            stats={networkStats}
            profile={selectedProfile}
            isE2eeActive={callState === 'connected' && isSecureLine(lineId, passcode)}
            roomId={lineId}
          />
        )}

        {isQrOpen && (
          <QrModal
            isOpen={isQrOpen}
            onClose={() => setIsQrOpen(false)}
            inviteUrl={activeContact ? getContactInviteUrl(activeContact) : window.location.href}
          />
        )}

        {isChatOpen && (
          <ChatDrawer
            isOpen={isChatOpen}
            onClose={() => setIsChatOpen(false)}
            messages={chatMessages}
            onSendMessage={handleSendMessage}
          />
        )}

        {isQrScannerOpen && (
          <CameraQrScanner
            isOpen={isQrScannerOpen}
            onClose={() => setIsQrScannerOpen(false)}
            onScan={handleScannedQrResult}
          />
        )}
      </React.Suspense>
    </div>
  );
};
