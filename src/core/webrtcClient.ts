import { SignalProfile, NetworkStats, ChatMessage, CallState } from './types';
import { tuneSdpForLowBandwidth } from './sdpTuner';
import { AudioE2EE } from './e2ee';
import { StatsMonitor } from './statsMonitor';
import { AudioManager } from './audioManager';

export interface WebRTCClientOptions {
  signalingUrl: string;
  roomId: string;
  passphrase?: string;
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

  private options: WebRTCClientOptions;
  private isInitiator: boolean = false;
  private currentProfile: SignalProfile;
  private state: CallState = 'idle';

  // Event callbacks
  public onStateChange: ((state: CallState) => void) | null = null;
  public onStatsUpdate: ((stats: NetworkStats) => void) | null = null;
  public onRemoteStream: ((stream: MediaStream) => void) | null = null;
  public onChatMessage: ((msg: ChatMessage) => void) | null = null;
  public onProfileChange: ((profile: SignalProfile) => void) | null = null;
  public onError: ((error: string) => void) | null = null;

  constructor(options: WebRTCClientOptions) {
    this.options = options;
    this.currentProfile = options.profile;
  }

  getState(): CallState {
    return this.state;
  }

  private setState(newState: CallState) {
    this.state = newState;
    if (this.onStateChange) this.onStateChange(newState);
  }

  async start(): Promise<void> {
    try {
      this.setState('connecting');

      // Initialize Passphrase E2EE if provided
      if (this.options.passphrase) {
        await this.e2ee.setPassphrase(this.options.passphrase);
      }

      // Initialize local microphone
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
    // Append room query if using Cloudflare Worker endpoint
    if (wsUrl.includes('/ws')) {
      wsUrl += (wsUrl.includes('?') ? '&' : '?') + `room=${encodeURIComponent(this.options.roomId)}`;
    }

    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      // Send join event
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
        if (this.isInitiator) {
          this.setState('waiting');
        }
        break;

      case 'peer-joined':
        // Second peer arrived; initiator starts WebRTC offer
        if (this.isInitiator) {
          this.setState('connecting');
          await this.initiatePeerConnection();
          await this.createOffer();
        }
        break;

      case 'offer':
        if (!this.isInitiator) {
          this.setState('connecting');
          await this.initiatePeerConnection();
          await this.handleOffer(msg.payload);
        }
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
        this.setState('disconnected');
        break;

      case 'room-full':
        this.setState('error');
        if (this.onError) this.onError('Room is already full (maximum 2 participants).');
        break;
    }
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

    // Attach local audio track
    const localStream = this.audioManager.getLocalStream();
    if (localStream) {
      localStream.getAudioTracks().forEach((track) => {
        const sender = this.pc?.addTrack(track, localStream);
        if (sender) {
          // Setup E2EE sender frame transform
          this.e2ee.setupSenderTransform(sender);
        }
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

    // Remote track arrival
    this.pc.ontrack = (event) => {
      const remoteStream = event.streams[0] || new MediaStream([event.track]);
      const receiver = event.receiver;
      // Setup E2EE receiver frame transform
      this.e2ee.setupReceiverTransform(receiver);

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

    // Deep Opus SDP tuning for low bandwidth / high packet loss
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

    // Notify peer via signaling and data channel
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

    // Renegotiate SDP if connected
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
