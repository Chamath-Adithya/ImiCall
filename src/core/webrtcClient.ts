import { SignalProfile, NetworkStats, ChatMessage, CallState, REQUIRED_PASSCODE, hashPasscode } from './types';
import { tuneSdpForLowBandwidth } from './sdpTuner';
import { AudioE2EE } from './e2ee';
import { StatsMonitor } from './statsMonitor';
import { AudioManager } from './audioManager';
import { SoundManager } from './soundManager';

export interface WebRTCClientOptions {
  signalingUrl: string;
  roomId: string;
  passcode: string; // Mandatory PIN (2023)
  profile: SignalProfile;
  iceServers?: RTCIceServer[];
}

export class WebRTCClient {
  private pc: RTCPeerConnection | null = null;
  private ws: WebSocket | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private e2ee: AudioE2EE = new AudioE2EE();
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

  constructor(options: WebRTCClientOptions) {
    this.options = options;
    this.currentProfile = options.profile;
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
      this.setState('connecting');

      // Initialize Passcode-based E2EE using PIN 2023
      await this.e2ee.setPassphrase(`imicall-e2ee-salt-${this.options.passcode}`);

      // Initialize local microphone with voice clarity filter
      await this.audioManager.initLocalAudio();

      // Connect to signaling server
      this.connectSignaling();
    } catch (err: any) {
      console.error('[WebRTC] Start failed:', err);
      this.setState('error');
      if (this.onError) this.onError(err.message || 'Failed to start call engine');
    }
  }

  private connectSignaling() {
    let wsUrl = this.options.signalingUrl;
    if (wsUrl.includes('/ws')) {
      wsUrl += (wsUrl.includes('?') ? '&' : '?') + `room=${encodeURIComponent(this.options.roomId)}`;
    }

    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      this.ws?.send(
        JSON.stringify({
          type: 'join',
          roomId: this.options.roomId,
        })
      );
    };

    this.ws.onmessage = async (event) => {
      try {
        const msg = JSON.parse(event.data);
        await this.handleSignalingMessage(msg);
      } catch (e) {
        console.error('[WebRTC] Signal parsing error:', e);
      }
    };

    this.ws.onerror = (err) => {
      console.warn('[WebRTC] Signaling error:', err);
    };

    this.ws.onclose = () => {
      if (this.state === 'connected') {
        this.setState('reconnecting');
      }
    };
  }

  private async handleSignalingMessage(msg: any) {
    switch (msg.type) {
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
        // Partner is calling us! Trigger incoming ring
        this.soundManager.startIncomingRing();
        this.setState('ringing-incoming');
        break;

      case 'call-accept':
        // Partner answered our call! Stop ringback and initiate WebRTC offer
        this.soundManager.stopAll();
        this.setState('connecting');
        await this.initiatePeerConnection();
        await this.createOffer();
        break;

      case 'call-decline':
        // Partner declined call
        this.soundManager.stopAll();
        this.setState('waiting');
        if (this.onError) this.onError('Call was declined by partner.');
        break;

      case 'call-cancel':
        // Caller hung up before answer
        this.soundManager.stopAll();
        this.setState('waiting');
        break;

      case 'offer':
        this.soundManager.stopAll();
        this.setState('connecting');
        await this.initiatePeerConnection();
        await this.handleOffer(msg.payload);
        break;

      case 'answer':
        await this.handleAnswer(msg.payload);
        break;

      case 'candidate':
        if (this.pc && msg.payload) {
          try {
            await this.pc.addIceCandidate(new RTCIceCandidate(msg.payload));
          } catch (e) {
            console.warn('[WebRTC] Candidate error:', e);
          }
        }
        break;

      case 'profile-change':
        if (msg.payload && msg.payload.profile) {
          this.currentProfile = msg.payload.profile;
          if (this.onProfileChange) this.onProfileChange(this.currentProfile);
        }
        break;

      case 'peer-left':
        this.peerInRoom = false;
        if (this.onPeerStatusChange) this.onPeerStatusChange(false);
        this.soundManager.stopAll();
        if (this.state === 'connected') {
          this.setState('disconnected');
        } else {
          this.setState('waiting');
        }
        break;

      case 'room-full':
        this.setState('error');
        if (this.onError) this.onError('Room is already full (maximum 2 participants).');
        break;
    }
  }

  /**
   * Caller initiates the ring to partner with PIN 2023 check.
   */
  async ringPartner(enteredPin: string): Promise<boolean> {
    if (enteredPin.trim() !== REQUIRED_PASSCODE) {
      if (this.onError) this.onError(`Invalid Passcode! Secret passcode "${REQUIRED_PASSCODE}" is required to place call.`);
      return false;
    }

    const pinHash = await hashPasscode(enteredPin);
    this.soundManager.startOutgoingRingback();
    this.setState('ringing-outgoing');

    this.ws?.send(
      JSON.stringify({
        type: 'call-ring',
        roomId: this.options.roomId,
        payload: { pinHash },
      })
    );

    return true;
  }

  /**
   * Callee accepts the incoming call by verifying PIN 2023.
   */
  async acceptIncomingCall(enteredPin: string): Promise<boolean> {
    if (enteredPin.trim() !== REQUIRED_PASSCODE) {
      if (this.onError) this.onError(`Invalid Passcode! Secret passcode "${REQUIRED_PASSCODE}" is required to answer.`);
      return false;
    }

    this.soundManager.stopAll();
    this.setState('connecting');

    this.ws?.send(
      JSON.stringify({
        type: 'call-accept',
        roomId: this.options.roomId,
      })
    );

    return true;
  }

  /**
   * Callee declines the incoming call.
   */
  declineIncomingCall() {
    this.soundManager.stopAll();
    this.setState('waiting');

    this.ws?.send(
      JSON.stringify({
        type: 'call-decline',
        roomId: this.options.roomId,
      })
    );
  }

  /**
   * Caller cancels the outgoing call while ringing.
   */
  cancelOutgoingCall() {
    this.soundManager.stopAll();
    this.setState('waiting');

    this.ws?.send(
      JSON.stringify({
        type: 'call-cancel',
        roomId: this.options.roomId,
      })
    );
  }

  private async initiatePeerConnection() {
    const defaultIceServers: RTCIceServer[] = [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun.cloudflare.com:3478' },
    ];

    const config: RTCConfiguration = {
      iceServers: this.options.iceServers || defaultIceServers,
      iceCandidatePoolSize: 2,
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require',
    };

    this.pc = new RTCPeerConnection(config);

    // Attach clean local audio track
    const localStream = this.audioManager.getLocalStream();
    if (localStream) {
      localStream.getAudioTracks().forEach((track) => {
        this.pc?.addTrack(track, localStream);
      });
    }

    // ICE Candidate handler
    this.pc.onicecandidate = (event) => {
      if (event.candidate && this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(
          JSON.stringify({
            type: 'candidate',
            roomId: this.options.roomId,
            payload: event.candidate,
          })
        );
      }
    };

    // Connection state changes
    this.pc.onconnectionstatechange = () => {
      if (!this.pc) return;
      switch (this.pc.connectionState) {
        case 'connected':
          this.setState('connected');
          this.startStatsMonitoring();
          break;
        case 'disconnected':
        case 'failed':
          this.setState('reconnecting');
          break;
        case 'closed':
          this.setState('disconnected');
          this.stopStatsMonitoring();
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
    if (this.isInitiator) {
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
    channel.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data);
        if (parsed.type === 'chat' && this.onChatMessage) {
          this.onChatMessage({
            id: parsed.id,
            sender: 'peer',
            text: parsed.text,
            timestamp: parsed.timestamp,
          });
        }
      } catch (err) {
        console.error('[WebRTC] DataChannel parse error:', err);
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

    this.ws?.send(
      JSON.stringify({
        type: 'offer',
        roomId: this.options.roomId,
        payload: tunedOffer,
      })
    );
  }

  private async handleOffer(offer: RTCSessionDescriptionInit) {
    if (!this.pc) return;

    await this.pc.setRemoteDescription(new RTCSessionDescription(offer));

    const answer = await this.pc.createAnswer();
    const tunedSdp = tuneSdpForLowBandwidth(answer.sdp || '', this.currentProfile);
    const tunedAnswer = new RTCSessionDescription({
      type: 'answer',
      sdp: tunedSdp,
    });

    await this.pc.setLocalDescription(tunedAnswer);

    this.ws?.send(
      JSON.stringify({
        type: 'answer',
        roomId: this.options.roomId,
        payload: tunedAnswer,
      })
    );
  }

  private async handleAnswer(answer: RTCSessionDescriptionInit) {
    if (!this.pc) return;
    await this.pc.setRemoteDescription(new RTCSessionDescription(answer));
  }

  public setProfile(profile: SignalProfile) {
    this.currentProfile = profile;
    if (this.onProfileChange) this.onProfileChange(profile);

    const payload = { profile };
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          type: 'profile-change',
          roomId: this.options.roomId,
          payload,
        })
      );
    }

    if (this.pc && this.isInitiator && this.pc.signalingState === 'stable') {
      this.createOffer().catch((err) => console.warn('[WebRTC] Renegotiation error:', err));
    }
  }

  public getCurrentProfile(): SignalProfile {
    return this.currentProfile;
  }

  public sendChatMessage(text: string): ChatMessage | null {
    if (!text.trim()) return null;

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
    this.statsMonitor.start(1000, (stats) => {
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

  public close() {
    this.soundManager.stopAll();
    this.stopStatsMonitoring();
    this.audioManager.cleanup();

    if (this.dataChannel) {
      this.dataChannel.close();
      this.dataChannel = null;
    }

    if (this.pc) {
      this.pc.close();
      this.pc = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.setState('idle');
  }
}
