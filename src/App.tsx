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
  Camera,
  Clipboard,
} from 'lucide-react';
import { SignalProfile, NetworkStats, ChatMessage, CallState, SIGNAL_PROFILES, REQUIRED_PASSCODE } from './core/types';
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

    // Auto-detect 2G / Slow cellular connection and switch audio profile to ultra-low bandwidth (10 kbps)
    const conn = (navigator as any).connection;
    if (conn && (conn.effectiveType === '2g' || conn.effectiveType === 'slow-2g' || conn.saveData)) {
      setSelectedProfile('extreme');
    }

    // Fetch public tunnel URL and server config
    fetch('/api/config')
      .then((res) => res.json())
      .then((data) => {
        if (data && data.publicUrl) {
          setServerPublicUrl(data.publicUrl);
        }
      })
      .catch(() => {});

    // Parse URL params / hash
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

    // Check for deleted connections from server to keep mutual deletion in sync
    fetch('/api/deleted-connections')
      .then((res) => res.json())
      .then((data) => {
        if (data && Array.isArray(data.deletedRooms) && data.deletedRooms.length > 0) {
          const delSet = new Set(data.deletedRooms.map((r: string) => r.toLowerCase()));
          setSavedLines((prev) => {
            const cleaned = prev.filter((l) => !delSet.has(l.id.toLowerCase()));
            if (cleaned.length !== prev.length) {
              if (cleaned.length === 0) {
                const freshId = generateRandomLineId();
                const freshLine: SavedLine = {
                  id: freshId,
                  name: 'Primary Partner',
                  passcode: REQUIRED_PASSCODE,
                  createdAt: Date.now(),
                };
                cleaned.push(freshLine);
              }
              saveLinesList(cleaned, cleaned[0]?.id || '');
              return cleaned;
            }
            return prev;
          });
        }
      })
      .catch(() => {});

    // If incoming invite URL hash/params
    if (hashLine) {
      const pinToUse = hashPin || REQUIRED_PASSCODE;
      const existing = currentList.find((l) => l.id.toLowerCase() === hashLine.toLowerCase());

      if (existing) {
        saveLinesList(currentList, existing.id);
        setLineId(existing.id);
        setPasscode(existing.passcode);
        setHasSavedLine(true);
        connectSavedLine(existing.id, existing.passcode);
        window.history.replaceState(null, '', window.location.pathname);
        return;
      }

      // Incoming connection invitation from partner (QR scan or shared invite link)
      if (hashFrom || hashParams.has('connect') || searchParams.has('connect')) {
        const senderDisplayName = hashFrom || 'Partner';
        const mySavedName = localStorage.getItem(MY_NAME_KEY) || hashTo || '';
        setPendingInvite({
          lineId: hashLine,
          senderName: senderDisplayName,
          myName: mySavedName,
          pin: pinToUse,
        });
        setPendingInviteContactName(senderDisplayName);
        setPendingInviteMyName(mySavedName);
        setSavedLines(currentList);
        return;
      } else {
        // Direct line URL (e.g. #line=...&pin=...) -> Auto-save & connect directly
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
    setCallState('waiting');

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
      if (newState === 'disconnected' || newState === 'idle') {
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

    client.onContactDeleted = (deletedRoomId: string) => {
      const normDeleted = deletedRoomId.trim().toLowerCase();
      setSavedLines((prev) => {
        const remaining = prev.filter((l) => l.id.trim().toLowerCase() !== normDeleted);
        let nextActive = '';
        if (remaining.length === 0) {
          const freshId = generateRandomLineId();
          const freshLine: SavedLine = {
            id: freshId,
            name: 'Primary Partner',
            passcode: REQUIRED_PASSCODE,
            createdAt: Date.now(),
          };
          remaining.push(freshLine);
          nextActive = freshId;
        } else {
          nextActive = remaining[0].id;
        }
        localStorage.setItem(STORAGE_LINES_KEY, JSON.stringify(remaining));
        localStorage.setItem(ACTIVE_LINE_ID_KEY, nextActive);
        setLineId(nextActive);
        setPasscode(remaining[0].passcode);
        connectSavedLine(nextActive, remaining[0].passcode);
        return remaining;
      });
      showToast('⚠️ Contact connection was removed by partner.');
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

  // Import connection from pasted link or raw room ID
  const handleImportPastedLink = () => {
    const raw = pastedInviteInput.trim();
    if (!raw) {
      setErrorMessage('Please enter an invite link or Room ID.');
      return;
    }

    let parsedLineId = '';
    let parsedSender = '';
    let parsedPin = REQUIRED_PASSCODE;

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

        parsedPin = hashParams.get('pin') || searchParams.get('pin') || REQUIRED_PASSCODE;
      }
    } catch (e) {}

    if (!parsedLineId) {
      if (/^[a-zA-Z0-9_-]{3,60}$/.test(raw)) {
        parsedLineId = raw;
      }
    }

    if (!parsedLineId) {
      setErrorMessage('Invalid invite link or Room ID. Please paste a valid link or code.');
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
      localStorage.setItem(MY_NAME_KEY, pendingInviteMyName.trim());
      setMyDisplayName(pendingInviteMyName.trim());
    }

    const newContact: SavedLine = {
      id: pendingInvite.lineId,
      name: contactName,
      passcode: pendingInvite.pin || REQUIRED_PASSCODE,
      createdAt: Date.now(),
    };

    const updated = [newContact, ...savedLines.filter((l) => l.id.toLowerCase() !== pendingInvite.lineId.toLowerCase())];
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

    // 1. Notify partner through WebRTC WebSocket signaling
    clientRef.current?.notifyContactDeleted(idToDelete);

    // 2. Persist deletion on signaling server and clear Push subscriptions
    fetch('/api/delete-connection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomId: idToDelete }),
    }).catch(() => {});

    // 3. Update locally
    const updated = savedLines.filter((l) => l.id !== idToDelete);
    let nextActive = lineId;
    if (updated.length === 0) {
      const freshId = generateRandomLineId();
      const freshLine: SavedLine = {
        id: freshId,
        name: 'Primary Partner',
        passcode: REQUIRED_PASSCODE,
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
    showToast('Contact removed from Phone Book and partner notified.');
  };

  const getContactInviteUrl = (contact: SavedLine) => {
    let baseUrl = window.location.origin;
    if (serverPublicUrl && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
      baseUrl = serverPublicUrl;
    }
    const myStoredName = localStorage.getItem(MY_NAME_KEY) || myDisplayName || 'Partner';
    return `${baseUrl}/#connect=${encodeURIComponent(contact.id)}&from=${encodeURIComponent(myStoredName)}&to=${encodeURIComponent(contact.name)}&pin=${encodeURIComponent(contact.passcode)}`;
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

  const isInCall = callState === 'connecting' || callState === 'connected' || callState === 'reconnecting';

  return (
    <div className={`app-container ${isInCall ? 'in-call' : ''}`}>
      {/* Hidden Audio Element for WebRTC remote sound */}
      <audio ref={remoteAudioRef} autoPlay playsInline style={{ display: 'none' }} />

      {/* HEADER */}
      <header className="app-header">
        <div className="brand-wrapper">
          <div className="brand-icon">
            <svg width="26" height="26" viewBox="0 0 512 512" fill="none">
              <circle cx="256" cy="256" r="155" stroke="#249c6f" strokeWidth="18" strokeLinecap="round" strokeDasharray="24 32" opacity="0.45" />
              <path d="M 160 210 A 110 110 0 0 1 352 210" stroke="#ffffff" strokeWidth="22" strokeLinecap="round" opacity="0.95" />
              <path d="M 195 255 A 68 68 0 0 1 317 255" stroke="#249c6f" strokeWidth="24" strokeLinecap="round" />
              <circle cx="256" cy="300" r="28" fill="#249c6f" />
              <circle cx="256" cy="300" r="12" fill="#ffffff" />
            </svg>
          </div>
          <div>
            <h1 className="brand-title">ImiCall</h1>
            <span className="brand-tagline">Private Calling & Phone Book</span>
          </div>
        </div>

        <div className="header-badges">
          <div className="badge-e2ee">
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#249c6f', display: 'inline-block' }} />
            <Lock size={12} />
            <span>Encrypted Tunnel</span>
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
                <Plus size={15} /> Create Route
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
        <div style={{ maxWidth: '640px', margin: '0 auto', width: '100%' }}>
          {/* ACTIVE CONTACT HERO SPEED-DIAL CARD */}
          {activeContact && (
            <div className="dedicated-line-card">
              <div className="line-badge">
                <ShieldCheck size={14} />
                <span>Active Direct Hotline</span>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.95rem', margin: '0.75rem 0' }}>
                <div className="contact-avatar active" style={{ width: '52px', height: '52px', fontSize: '1.35rem' }}>
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
                <div style={{ textAlign: 'left', minWidth: 0, flex: 1, maxWidth: '280px' }}>
                  <h2 style={{ fontSize: '1.4rem', fontWeight: 700, color: '#ffffff', lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {activeContact.name}
                  </h2>
                  <div
                    style={{
                      fontSize: '0.8rem',
                      color: isPeerOnline ? '#249c6f' : 'rgba(255, 255, 255, 0.55)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.35rem',
                      marginTop: '0.2rem',
                    }}
                  >
                    <span className={`status-dot ${isPeerOnline ? '' : 'offline'}`} />
                    <span>{isPeerOnline ? 'Partner Online Now' : 'Standby • 24/7 Ready'}</span>
                  </div>
                </div>
              </div>

              {/* Background Ringing Push Notification Compact Bar */}
              <div
                style={{
                  background: isPushEnabled ? 'rgba(36, 156, 111, 0.1)' : 'rgba(255, 255, 255, 0.04)',
                  border: `1px solid ${isPushEnabled ? 'rgba(36, 156, 111, 0.4)' : 'rgba(255, 255, 255, 0.1)'}`,
                  borderRadius: '8px',
                  padding: '0.5rem 0.8rem',
                  marginBottom: '0.85rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  textAlign: 'left',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <Bell size={15} color={isPushEnabled ? '#249c6f' : 'rgba(255, 255, 255, 0.6)'} />
                  <div>
                    <div style={{ fontSize: '0.8rem', fontWeight: 600, color: '#ffffff' }}>
                      {isPushEnabled ? 'Background Ringing Active' : 'Background Call Ringing'}
                    </div>
                    <div style={{ fontSize: '0.7rem', color: 'rgba(255, 255, 255, 0.5)' }}>
                      {isPushEnabled ? 'Phone rings even when browser is closed' : 'Enable to ring phone when app is closed'}
                    </div>
                  </div>
                </div>
                {!isPushEnabled && (
                  <button
                    className="btn btn-primary"
                    style={{ fontSize: '0.72rem', padding: '0.3rem 0.65rem' }}
                    onClick={handleEnablePush}
                  >
                    Enable
                  </button>
                )}
              </div>

              {/* Call Partner Button - Satisfies verifyCall.js */}
              <button
                className="btn btn-primary btn-full"
                style={{ padding: '0.9rem', fontSize: '1.05rem', fontWeight: 700, marginBottom: '0.75rem' }}
                onClick={handleRingPartner}
              >
                <PhoneCall size={20} /> Call Partner
              </button>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '0.5rem' }}>
                <button
                  className="btn btn-secondary"
                  style={{ fontSize: '0.86rem', padding: '0.65rem' }}
                  onClick={() => setShareContact(activeContact)}
                >
                  <Share2 size={16} /> Share Connection Link
                </button>
                <button
                  className="btn btn-secondary"
                  style={{ padding: '0.65rem' }}
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
          <div className="glass-panel phonebook-panel" style={{ padding: '1.25rem 1.35rem', marginBottom: '1.5rem' }}>
            <div className="phonebook-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <BookUser size={19} color="#249c6f" />
                <span style={{ fontWeight: 700, fontSize: '1.02rem', color: '#ffffff' }}>
                  Phone Book
                </span>
                <span
                  style={{
                    fontSize: '0.7rem',
                    padding: '0.12rem 0.45rem',
                    background: 'rgba(255, 255, 255, 0.08)',
                    borderRadius: '12px',
                    color: 'rgba(255, 255, 255, 0.7)',
                    fontWeight: 600,
                  }}
                >
                  {savedLines.length} {savedLines.length === 1 ? 'Contact' : 'Contacts'}
                </span>
              </div>

              <button
                className="btn btn-primary"
                style={{ fontSize: '0.8rem', padding: '0.4rem 0.75rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}
                onClick={() => setIsAddContactModalOpen(true)}
              >
                <Plus size={15} /> Add Contact
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
                      <div className="contact-details">
                        <div className="contact-name">{contact.name}</div>
                        <div className="contact-substatus">
                          <span
                            style={{
                              width: '7px',
                              height: '7px',
                              borderRadius: '50%',
                              background: isActive && isPeerOnline ? '#249c6f' : 'rgba(255, 255, 255, 0.3)',
                              display: 'inline-block',
                              flexShrink: 0,
                            }}
                          />
                          <span>{isActive ? (isPeerOnline ? 'Online' : 'Standby') : 'Tap to switch'}</span>
                          {isActive && (
                            <span
                              style={{
                                fontSize: '0.62rem',
                                padding: '0.1rem 0.4rem',
                                background: 'rgba(36, 156, 111, 0.25)',
                                color: '#34d399',
                                border: '1px solid rgba(36, 156, 111, 0.5)',
                                borderRadius: '4px',
                                fontWeight: 700,
                                textTransform: 'uppercase',
                                letterSpacing: '0.03em',
                                marginLeft: '0.25rem',
                              }}
                            >
                              Active
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="contact-actions">
                      <button
                        className="btn btn-primary btn-call"
                        onClick={(e) => handleCallSavedLine(contact, e)}
                        title={`Call ${contact.name}`}
                      >
                        <Phone size={13} /> Call
                      </button>

                      <button
                        className="btn btn-secondary btn-action-icon"
                        onClick={(e) => {
                          e.stopPropagation();
                          setShareContact(contact);
                        }}
                        title="Share Connection Link"
                      >
                        <Share2 size={13} />
                      </button>

                      <button
                        className="btn btn-danger btn-action-icon"
                        onClick={(e) => handleDeleteLine(contact.id, e)}
                        title="Delete Contact"
                      >
                        <Trash2 size={13} />
                      </button>
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

      {/* On-Demand Lazy Loaded Modals for Instant 2G Loading */}
      <React.Suspense fallback={null}>
        {isDiagnosticsOpen && (
          <DiagnosticsModal
            isOpen={isDiagnosticsOpen}
            onClose={() => setIsDiagnosticsOpen(false)}
            stats={networkStats}
            profile={selectedProfile}
            isE2eeActive={true}
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
