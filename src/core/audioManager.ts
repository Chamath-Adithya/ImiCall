import { VoiceFilterEngine } from './voiceFilter';

export class AudioManager {
  private rawStream: MediaStream | null = null;
  private localStream: MediaStream | null = null;
  private voiceFilter: VoiceFilterEngine = new VoiceFilterEngine();
  private audioContext: AudioContext | null = null;
  private localAnalyser: AnalyserNode | null = null;
  private remoteAnalyser: AnalyserNode | null = null;
  private wakeLockSentinel: any = null;
  private isMuted: boolean = false;

  async initLocalAudio(): Promise<MediaStream> {
    // Ultra-optimized audio constraints for low bandwidth & voice isolation
    const constraints: MediaStreamConstraints = {
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1, // Mono strictly saves 50% bandwidth
        sampleRate: 16000, // 16kHz voice wideband
      },
      video: false, // Pure audio, zero video packet overhead
    };

    this.rawStream = await navigator.mediaDevices.getUserMedia(constraints);
    // Apply voice filter (120Hz highpass + 3kHz vocal boost + compressor)
    this.localStream = this.voiceFilter.processStream(this.rawStream);
    this.setupLocalAnalyser(this.localStream);
    await this.requestWakeLock();
    return this.localStream;
  }

  getLocalStream(): MediaStream | null {
    return this.localStream;
  }

  toggleMute(): boolean {
    if (!this.localStream) return false;
    this.isMuted = !this.isMuted;
    this.localStream.getAudioTracks().forEach((track) => {
      track.enabled = !this.isMuted;
    });
    return this.isMuted;
  }

  getIsMuted(): boolean {
    return this.isMuted;
  }

  setupRemoteAudio(remoteStream: MediaStream, audioElement: HTMLAudioElement) {
    audioElement.srcObject = remoteStream;
    audioElement.play().catch((e) => {
      console.warn('[Audio] Remote audio autoplay blocked:', e);
    });

    try {
      if (!this.audioContext) {
        this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      if (this.audioContext.state === 'suspended') {
        this.audioContext.resume();
      }

      const source = this.audioContext.createMediaStreamSource(remoteStream);
      this.remoteAnalyser = this.audioContext.createAnalyser();
      this.remoteAnalyser.fftSize = 64;
      source.connect(this.remoteAnalyser);
    } catch (err) {
      console.warn('[Audio] Could not attach remote analyser:', err);
    }
  }

  private setupLocalAnalyser(stream: MediaStream) {
    try {
      if (!this.audioContext) {
        this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      const source = this.audioContext.createMediaStreamSource(stream);
      this.localAnalyser = this.audioContext.createAnalyser();
      this.localAnalyser.fftSize = 64;
      source.connect(this.localAnalyser);
    } catch (err) {
      console.warn('[Audio] Could not attach local analyser:', err);
    }
  }

  /**
   * Returns current audio volume (0 - 100) for visualizer.
   */
  getLocalVolume(): number {
    if (this.isMuted || !this.localAnalyser) return 0;
    return this.calculateVolume(this.localAnalyser);
  }

  getRemoteVolume(): number {
    if (!this.remoteAnalyser) return 0;
    return this.calculateVolume(this.remoteAnalyser);
  }

  private calculateVolume(analyser: AnalyserNode): number {
    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(dataArray);
    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) {
      sum += dataArray[i];
    }
    const average = sum / dataArray.length;
    return Math.min(100, Math.round((average / 255) * 100));
  }

  async requestWakeLock() {
    try {
      if ('wakeLock' in navigator && !this.wakeLockSentinel) {
        this.wakeLockSentinel = await (navigator as any).wakeLock.request('screen');
        this.wakeLockSentinel.addEventListener('release', () => {
          this.wakeLockSentinel = null;
        });
      }
    } catch (err) {
      console.info('[Audio] Screen wake lock not supported or denied');
    }
  }

  releaseWakeLock() {
    if (this.wakeLockSentinel) {
      this.wakeLockSentinel.release().catch(() => {});
      this.wakeLockSentinel = null;
    }
  }

  cleanup() {
    this.releaseWakeLock();
    this.voiceFilter.cleanup();
    if (this.rawStream) {
      this.rawStream.getTracks().forEach((track) => track.stop());
      this.rawStream = null;
    }
    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => track.stop());
      this.localStream = null;
    }
    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }
    this.localAnalyser = null;
    this.remoteAnalyser = null;
  }
}
