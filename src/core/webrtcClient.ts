import { SignalProfile, SIGNAL_PROFILES, NetworkStats, ChatMessage, CallState } from './types';
import { tuneSdpForLowBandwidth } from './sdpTuner';
import { PrivateSignaling, lineAuth } from './privateLine';
import { TinyMessages } from './tinyMessages';
import { StatsMonitor } from './statsMonitor';
import { AudioManager } from './audioManager';
import { SoundManager } from './soundManager';
import { NATURAL, VoicePreset } from './voicePreset';
import { microphoneError } from './permissions';
import { privateIceConfig } from './transportPrivacy';
import { runtimeConfig } from './runtimeConfig';
import { deviceId } from './pushManager';

export interface WebRTCClientOptions {
  signalingUrl: string;
  roomId: string;
  passcode: string; // Random 256-bit invitation secret
  profile: SignalProfile;
  iceServers?: RTCIceServer[];
  relayOnly?: boolean;
}

export class WebRTCClient {
  private pc: RTCPeerConnection | null = null;
  private ws: WebSocket | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private secure: PrivateSignaling;
  private auth = '';
  private closed = false;
  private retry = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private connectTimer: ReturnType<typeof setTimeout> | null = null;
  private hasRelay = false;
  private iceCache: { servers: RTCIceServer[]; expires: number } | null = null;
  private queuedMessages = 0;
  private tiny: TinyMessages | null = null;
  public onTinyMessage: (()=>void) | null = null;
  public tinyMessages() { return this.tiny ||= new TinyMessages((type,payload)=>this.sendSignal(type,payload),()=>!this.closed && this.peerInRoom && this.ws?.readyState===WebSocket.OPEN); }
  private ringTimer: ReturnType<typeof setTimeout> | null = null;
  private sendQueue = Promise.resolve();
  private receiveQueue = Promise.resolve();
  private candidates: RTCIceCandidateInit[] = [];
  private microphonePending = false;
  private voicePreset: VoicePreset = NATURAL;
  private callGeneration = 0;
  private statsMonitor: StatsMonitor | null = null;
  public audioManager: AudioManager = new AudioManager();
  public soundManager: SoundManager = new SoundManager();

  private options: WebRTCClientOptions;
  private isInitiator: boolean = false;
  private currentProfile: SignalProfile;
  private state: CallState = 'idle';
  private peerInRoom: boolean = false;

  // Event callbacks
  public onStateChange: ((state: CallState) => void) | null = null;
  public onStatsUpdate: ((stats: NetworkStats) => void) | null = null;
  public onRemoteStream: ((stream: MediaStream) => void) | null = null;
  public onChatMessage: ((msg: ChatMessage) => void) | null = null;
  public onProfileChange: ((profile: SignalProfile) => void) | null = null;
  public onError: ((error: string) => void) | null = null;
  public onPeerStatusChange: ((inRoom: boolean) => void) | null = null;
  public onContactDeleted: ((roomId: string) => void) | null = null;

  constructor(options: WebRTCClientOptions) {
    this.options = options;
    this.secure = new PrivateSignaling(options.roomId);
    this.currentProfile = options.profile;
  }

  setRelayOnly(value: boolean) { if (!['idle','waiting','error','disconnected'].includes(this.state)) throw new Error('End the call before changing IP protection.'); this.options.relayOnly = value; }

  private async relayServers(): Promise<RTCIceServer[]> {
    if (this.options.iceServers) return this.options.iceServers;
    if (this.iceCache && this.iceCache.expires > Date.now()) return this.iceCache.servers;
    const runtime = await runtimeConfig();
    if (!runtime.relayConfigured) return [];
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch('/api/ice', { method: 'POST', cache: 'no-store', signal: controller.signal, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.auth}` }, body: JSON.stringify({ roomId: this.options.roomId, deviceId: deviceId() }) });
      if (!response.ok) throw new Error('Private relay access is unavailable. Reconnect and try again.');
      const { iceServers } = await response.json();
      if (!Array.isArray(iceServers)) throw new Error('Invalid relay configuration');
      this.iceCache = { servers: iceServers, expires: Date.now() + 300000 }; return iceServers;
    } finally { clearTimeout(timeout); }
  }
  private async checkRelay() {
    if (this.options.relayOnly === false) return;
    privateIceConfig(await this.relayServers(), true);
  }

  getState(): CallState {
    return this.state;
  }

  isPeerPresent(): boolean {
    return this.peerInRoom;
  }

  private setState(newState: CallState) {
    this.state = newState;
    if (this.onStateChange) this.onStateChange(newState);
  }

  async start(): Promise<void> {
    try {
      this.state = 'waiting';

      await this.secure.init(this.options.passcode);
      this.auth = await lineAuth(this.options.roomId, this.options.passcode);
      if (this.closed) return;

      // Connect to signaling server in standby mode
      this.connectSignaling();
    } catch (err: any) {
      console.error('[WebRTC] Start failed:', err);
      this.setState('error');
      if (this.onError) this.onError(err.message || 'Failed to start call engine');
    }
  }

  private connectSignaling() {
    this.ws = new WebSocket(this.options.signalingUrl);
    this.ws.onopen = () => {
      this.retry = 0;
      this.ws?.send(JSON.stringify({ type: 'join', roomId: this.options.roomId, auth: this.auth, deviceId: deviceId() }));
    };
    this.ws.onmessage = (event) => {
      if (typeof event.data !== 'string' || event.data.length > 131072 || this.queuedMessages >= 32) { this.close(); this.setState('error'); this.onError?.('Connection stopped: incoming message limit exceeded.'); return; }
      this.queuedMessages++;
      this.receiveQueue = this.receiveQueue.then(async () => {
        if (this.closed) return;
        const msg = JSON.parse(event.data);
        if (!['joined', 'peer-joined', 'peer-left', 'room-full', 'error'].includes(msg.type)) {
          msg.payload = await this.secure.open(msg.type, msg.payload);
        }
        await this.handleSignalingMessage(msg);
      }).catch(() => { this.onError?.('A connection message could not be verified. Please reconnect if the call does not continue.'); }).finally(() => { this.queuedMessages--; });
    };

    this.ws.onerror = (err) => {
      console.warn('[WebRTC] Signaling error:', err);
    };

    this.ws.onclose = (event) => {
      if (this.closed) return;
      this.peerInRoom = false;
      this.onPeerStatusChange?.(false);
      this.soundManager.stopAll();
      this.cleanupCallSession();
      this.setState('waiting');
      if (event.code === 1008) { this.onError?.('This connection is unavailable or already open on two devices. Close the other tab and reload.'); return; }
      this.retryTimer = setTimeout(() => this.connectSignaling(), Math.min(30000, 1000 * 2 ** this.retry++) + Math.random() * 500);
    };
  }

  private sendSignal(type: string, payload: unknown = null) {
    this.sendQueue = this.sendQueue.then(async () => {
      const envelope = await this.secure.seal(type, payload);
      if (this.ws?.readyState !== WebSocket.OPEN) throw new Error('Connection unavailable. Please wait and try again.');
      if(this.closed || this.ws.bufferedAmount > 65536) throw new Error('Connection is congested. Wait before retrying.');
      this.ws.send(JSON.stringify({ type, payload: envelope }));
    }).catch((error) => { this.onError?.(error.message); });
    return this.sendQueue;
  }

  private async handleSignalingMessage(msg: any) {
    switch (msg.type) {
      case 'tiny-message':
      case 'tiny-ack':
        if(this.tinyMessages().receive(msg.type,msg.payload))this.onTinyMessage?.();
        break;
      case 'joined':
        this.isInitiator = msg.isInitiator;
        this.peerInRoom = msg.peersCount > 1;
        if (this.onPeerStatusChange) this.onPeerStatusChange(this.peerInRoom);
        this.setState('waiting');
        break;

      case 'peer-joined':
        this.peerInRoom = true;
        if (this.onPeerStatusChange) this.onPeerStatusChange(true);
        break;

      case 'call-ring':
        if (this.state !== 'waiting') { await this.sendSignal('call-decline'); break; }
        this.armRingTimeout();
        // Partner is calling us! Trigger incoming ring
        this.soundManager.startIncomingRing();
        this.setState('ringing-incoming');
        break;

      case 'call-accept':
        if (this.state !== 'ringing-outgoing') break;
        this.clearRingTimeout();
        // Partner answered our call! Stop ringback and initiate WebRTC offer
        this.soundManager.stopAll();
        this.setState('connecting');
        this.isInitiator = true;
        await this.initiatePeerConnection();
        await this.createOffer();
        break;

      case 'call-decline':
        this.cleanupCallSession();
        // Partner declined call
        this.soundManager.stopAll();
        this.setState('waiting');
        if (this.onError) this.onError('Call was declined by partner.');
        break;

      case 'call-cancel':
        this.cleanupCallSession();
        // Caller hung up before answer
        this.soundManager.stopAll();
        this.setState('waiting');
        break;

      case 'offer':
        if (this.state !== 'connecting') break;
        this.soundManager.stopAll();
        this.setState('connecting');
        this.isInitiator = false;
        await this.initiatePeerConnection();
        await this.handleOffer(msg.payload);
        break;

      case 'answer':
        if (this.state !== 'connecting') break;
        await this.handleAnswer(msg.payload);
        break;

      case 'candidate':
        if (msg.payload && ['connecting', 'connected'].includes(this.state)) {
          if (this.pc?.remoteDescription) await this.pc.addIceCandidate(msg.payload);
          else if (this.candidates.length < 100) this.candidates.push(msg.payload);
        }
        break;

      case 'profile-change':
        if (msg.payload && ['balanced', 'extreme', 'survival', 'hd'].includes(msg.payload.profile)) {
          const requested = msg.payload.profile as SignalProfile;
          if (SIGNAL_PROFILES[requested].bitrate < SIGNAL_PROFILES[this.currentProfile].bitrate) {
            this.currentProfile = requested; this.limitSenderBitrate();
            this.onProfileChange?.(this.currentProfile);
          }
        }
        break;

      case 'call-ended':
        // Partner ended active call: stop sounds, teardown WebRTC session, return to standby
        this.soundManager.stopAll();
        this.cleanupCallSession();
        this.setState('waiting');
        break;

      case 'peer-left':
        this.peerInRoom = false;
        if (this.onPeerStatusChange) this.onPeerStatusChange(false);
        this.soundManager.stopAll();
        this.cleanupCallSession();
        this.setState('waiting');
        break;

      case 'contact-deleted':
        this.soundManager.stopAll();
        this.cleanupCallSession();
        if (this.onContactDeleted) {
          const target = msg.roomId || msg.payload?.roomId || this.options.roomId;
          this.onContactDeleted(target);
        }
        break;

      case 'error':
        this.soundManager.stopAll();
        this.cleanupCallSession();
        this.onError?.(msg.message || 'Connection unavailable.');
        this.setState('waiting');
        break;

      case 'room-full':
        this.setState('error');
        if (this.onError) this.onError('Room is already full (maximum 2 participants).');
        break;
    }
  }

  private clearRingTimeout() {
    if (this.ringTimer) clearTimeout(this.ringTimer);
    this.ringTimer = null;
  }
  private armRingTimeout() {
    this.clearRingTimeout();
    this.ringTimer = setTimeout(() => { this.cancelOutgoingCall(); this.onError?.('No answer. Your partner may be offline. Try again later.'); }, 90000);
  }
  notifyContactDeleted(_roomId: string) { void this.sendSignal('contact-deleted'); }

  async ringPartner(enteredPin: string): Promise<boolean> {
    if (this.microphonePending || enteredPin !== this.options.passcode || this.ws?.readyState !== WebSocket.OPEN || this.state !== 'waiting') {
      this.onError?.('Connection is not ready. Wait a moment and try again.');
      return false;
    }
    const generation = this.callGeneration;
    this.microphonePending = true;
    try { this.audioManager.prepareAudio(); await this.checkRelay(); } catch (error) { this.microphonePending = false; this.audioManager.cleanup(); this.onError?.(error instanceof Error ? error.message : 'IP protection unavailable. Call stopped.'); return false; }
    if (generation !== this.callGeneration || this.closed) { this.microphonePending = false; this.audioManager.cleanup(); return false; }
    try {
      if (!this.audioManager.getLocalStream()) {
        await this.audioManager.initLocalAudio();
        if (this.voicePreset.mix > 0) await this.audioManager.applyVoice(this.voicePreset, async () => {});
      }
    } catch (e: any) {
      this.microphonePending = false;
      this.audioManager.cleanup();
      console.error('[WebRTC] Microphone init error:', e);
      if (this.onError) this.onError(microphoneError(e));
      return false;
    }

    this.microphonePending = false;
    if (generation !== this.callGeneration || this.closed) { this.audioManager.cleanup(); return false; }
    this.soundManager.startOutgoingRingback();
    this.setState('ringing-outgoing');
    this.armRingTimeout();
    await this.sendSignal('call-ring');

    return true;
  }

  /**
   * Callee accepts the incoming call using the saved invitation secret.
   */
  async acceptIncomingCall(enteredPin: string): Promise<boolean> {
    if (this.microphonePending || enteredPin !== this.options.passcode || this.state !== 'ringing-incoming' || this.ws?.readyState !== WebSocket.OPEN) return false;
    const generation = this.callGeneration;
    this.microphonePending = true;
    try { this.audioManager.prepareAudio(); await this.checkRelay(); } catch (error) { this.microphonePending = false; this.audioManager.cleanup(); if (this.state === 'ringing-incoming') this.declineIncomingCall(); this.onError?.(error instanceof Error ? error.message : 'IP protection unavailable. Call stopped.'); return false; }
    if (generation !== this.callGeneration || this.closed) { this.microphonePending = false; this.audioManager.cleanup(); return false; }
    try {
      if (!this.audioManager.getLocalStream()) {
        await this.audioManager.initLocalAudio();
        if (this.voicePreset.mix > 0) await this.audioManager.applyVoice(this.voicePreset, async () => {});
      }
    } catch (e: any) {
      this.microphonePending = false;
      this.audioManager.cleanup();
      console.error('[WebRTC] Microphone init error on answer:', e);
      if (this.onError) this.onError(microphoneError(e));
      return false;
    }

    this.microphonePending = false;
    if (generation !== this.callGeneration || this.closed) { this.audioManager.cleanup(); return false; }
    this.soundManager.stopAll();
    this.setState('connecting');

    this.clearRingTimeout();
    await this.sendSignal('call-accept');

    return true;
  }

  /**
   * Callee declines the incoming call.
   */
  declineIncomingCall() {
    this.soundManager.stopAll();
    this.setState('waiting');

    this.cleanupCallSession();
    void this.sendSignal('call-decline');
  }

  /**
   * Caller cancels the outgoing call while ringing.
   */
  cancelOutgoingCall() {
    this.soundManager.stopAll();
    this.setState('waiting');

    this.cleanupCallSession();
    void this.sendSignal('call-cancel');
  }

  private async initiatePeerConnection() {
    const defaultIceServers: RTCIceServer[] = [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun.cloudflare.com:3478' },
    ];

    const servers = await this.relayServers().catch(error => { if (this.options.relayOnly !== false) { this.endCall(); throw error; } return []; });
    let config: RTCConfiguration;
    try { config = privateIceConfig(servers.length ? servers : defaultIceServers, this.options.relayOnly !== false); } catch (error) { this.endCall(); throw error; }

    if (this.pc) return;
    this.hasRelay = !!config.iceServers?.some(server => [server.urls].flat().some(url => /^turns?:/.test(url)));
    this.pc = new RTCPeerConnection(config);
    this.connectTimer = setTimeout(() => { this.endCall(); this.onError?.('Call could not connect. Try another network; a TURN relay may be needed for this connection.'); }, 30000);

    // Attach clean local audio track
    if (!this.audioManager.getLocalStream()) {
      try {
        await this.audioManager.initLocalAudio();
        if (this.voicePreset.mix > 0) await this.audioManager.applyVoice(this.voicePreset, async () => {});
      } catch {
        this.cleanupCallSession();
        this.setState('waiting');
        throw new Error('Microphone access is required to call.');
      }
    }

    const localStream = this.audioManager.getLocalStream();
    if (localStream) {
      localStream.getAudioTracks().forEach((track) => {
        this.pc?.addTrack(track, localStream);
      });
    }

    // ICE Candidate handler
    this.pc.onicecandidate = (event) => {
      if (event.candidate && this.ws?.readyState === WebSocket.OPEN) {
        void this.sendSignal('candidate', event.candidate.toJSON());
      }
    };

    // Connection state changes
    this.pc.onconnectionstatechange = () => {
      if (!this.pc) return;
      switch (this.pc.connectionState) {
        case 'connected':
          if (this.connectTimer) clearTimeout(this.connectTimer);
          this.setState('connected');
          this.startStatsMonitoring();
          this.limitSenderBitrate();
          break;
        case 'disconnected':
        case 'failed':
          this.onError?.(this.hasRelay ? 'Network connection lost. Reconnect and try again.' : 'This network could not connect directly. Try Wi-Fi; a TURN relay needs to be configured for restricted networks.');
          // If peer disconnected or left, tear down call and return cleanly to standby
          this.cleanupCallSession();
          this.setState('waiting');
          break;
        case 'closed':
          this.cleanupCallSession();
          this.setState('waiting');
          break;
      }
    };

    // Remote track arrival (low-latency jitter buffer target)
    this.pc.ontrack = (event) => {
      const remoteStream = event.streams[0] || new MediaStream([event.track]);
      const receiver = event.receiver;

      if (receiver && 'playoutDelayHint' in receiver) {
        try {
          // @ts-ignore
          receiver.playoutDelayHint = 0.04;
        } catch (e) {}
      }

      if (this.onRemoteStream) {
        this.onRemoteStream(remoteStream);
      }
    };

    // Setup DataChannel for text fallback & protocol sync
    if (this.state === 'connecting' && this.isInitiator) {
      this.dataChannel = this.pc.createDataChannel('imicall-data', {
        ordered: true,
      });
      this.setupDataChannel(this.dataChannel);
    } else {
      this.pc.ondatachannel = (event) => {
        this.dataChannel = event.channel;
        this.setupDataChannel(this.dataChannel);
      };
    }
  }

  private setupDataChannel(channel: RTCDataChannel) {
    let chatCount = 0, chatWindow = Date.now();
    channel.onmessage = (event) => {
      if (Date.now() - chatWindow > 10000) { chatCount = 0; chatWindow = Date.now(); }
      if (typeof event.data !== 'string' || event.data.length > 8192 || ++chatCount > 30) { channel.close(); this.onError?.('Messaging stopped because the peer exceeded message limits.'); return; }
      try {
        const parsed = JSON.parse(event.data);
        if (parsed?.type === 'chat' && typeof parsed.id === 'string' && parsed.id.length <= 80 && Number.isFinite(parsed.timestamp) && typeof parsed.text === 'string' && parsed.text.length <= 4000 && this.onChatMessage) {
          this.onChatMessage({
            id: parsed.id,
            sender: 'peer',
            text: parsed.text,
            timestamp: parsed.timestamp,
          });
        }
      } catch (err) {
        channel.close(); this.onError?.('Messaging stopped: invalid peer data.');
      }
    };
  }

  private async createOffer() {
    if (!this.pc) return;

    const offer = await this.pc.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: false,
    });

    const tunedSdp = tuneSdpForLowBandwidth(offer.sdp || '', this.currentProfile);
    const tunedOffer = new RTCSessionDescription({
      type: 'offer',
      sdp: tunedSdp,
    });

    await this.pc.setLocalDescription(tunedOffer);

    await this.sendSignal('offer', tunedOffer);
  }

  private async handleOffer(offer: RTCSessionDescriptionInit) {
    if (!this.pc) return;

    await this.pc.setRemoteDescription(new RTCSessionDescription(offer));
    await this.flushCandidates();

    const answer = await this.pc.createAnswer();
    const tunedSdp = tuneSdpForLowBandwidth(answer.sdp || '', this.currentProfile);
    const tunedAnswer = new RTCSessionDescription({
      type: 'answer',
      sdp: tunedSdp,
    });

    await this.pc.setLocalDescription(tunedAnswer);

    await this.sendSignal('answer', tunedAnswer);
  }

  private async handleAnswer(answer: RTCSessionDescriptionInit) {
    if (!this.pc) return;
    await this.pc.setRemoteDescription(new RTCSessionDescription(answer));
    await this.flushCandidates();
  }

  public setProfile(profile: SignalProfile) {
    this.currentProfile = profile;
    if (this.onProfileChange) this.onProfileChange(profile);

    void this.sendSignal('profile-change', { profile });
    this.limitSenderBitrate();
  }

  private limitSenderBitrate() {
    // Apply bitrate without replacing the live peer connection.
    for (const sender of this.pc?.getSenders() || []) {
      const parameters = sender.getParameters();
      if (parameters.encodings?.length) {
        parameters.encodings[0].maxBitrate = SIGNAL_PROFILES[this.currentProfile].bitrate;
        void sender.setParameters(parameters).catch(() => {});
      }
    }
  }

  private async flushCandidates() {
    for (const candidate of this.candidates.splice(0)) await this.pc?.addIceCandidate(candidate);
  }

  public async setVoicePreset(preset: VoicePreset) {
    await this.audioManager.applyVoice(preset, async track => {
      const sender = this.pc?.getSenders().find(s => s.track?.kind === 'audio');
      if (sender) await sender.replaceTrack(track);
    });
    this.voicePreset = preset;
  }

  public getCurrentProfile(): SignalProfile {
    return this.currentProfile;
  }

  public sendChatMessage(text: string): ChatMessage | null {
    if (!text.trim() || text.length > 4000 || this.dataChannel?.readyState !== 'open') return null;

    const chatMsg: ChatMessage = {
      id: Math.random().toString(36).substring(2, 9),
      sender: 'me',
      text: text.trim(),
      timestamp: Date.now(),
    };

    if (this.dataChannel && this.dataChannel.readyState === 'open') {
      this.dataChannel.send(
        JSON.stringify({
          type: 'chat',
          ...chatMsg,
        })
      );
    }

    return chatMsg;
  }

  private startStatsMonitoring() {
    if (!this.pc) return;
    this.statsMonitor = new StatsMonitor(this.pc);
    let poorSamples = 0;
    this.statsMonitor.start(1000, (stats) => {
      poorSamples = ['poor','critical'].includes(stats.qualityRating) ? poorSamples + 1 : 0;
      if (poorSamples >= 3 && this.currentProfile !== 'survival') { this.setProfile(this.currentProfile==='extreme'?'survival':'extreme'); poorSamples = 0; }
      if (this.onStatsUpdate) {
        this.onStatsUpdate(stats);
      }
    });
  }

  private stopStatsMonitoring() {
    if (this.statsMonitor) {
      this.statsMonitor.stop();
      this.statsMonitor = null;
    }
  }

  /**
   * Resets active WebRTC media session without dropping the WebSocket room connection.
   */
  public cleanupCallSession() {
    this.callGeneration++;
    if (this.connectTimer) clearTimeout(this.connectTimer);
    this.connectTimer = null;
    this.clearRingTimeout();
    this.candidates = [];
    this.stopStatsMonitoring();
    this.audioManager.cleanup();
    if (this.dataChannel) {
      try {
        this.dataChannel.close();
      } catch (e) {}
      this.dataChannel = null;
    }
    if (this.pc) {
      try {
        this.pc.ontrack = null;
        this.pc.onicecandidate = null;
        this.pc.onconnectionstatechange = null;
        this.pc.close();
      } catch (e) {}
      this.pc = null;
    }
  }

  /**
   * Gracefully ends the call: notifies remote partner, resets call session, and returns to standby.
   */
  public endCall() {
    this.soundManager.stopAll();
    void this.sendSignal('call-ended');
    this.cleanupCallSession();
    this.setState('waiting');
  }

  public close() {
    this.tiny?.close(); this.tiny=null;
    this.closed = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.soundManager.stopAll();
    this.cleanupCallSession();
    this.ws?.close();
    this.ws = null;
  }
}
