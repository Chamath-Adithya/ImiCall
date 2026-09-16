export class AudioManager {
  private localStream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private localAnalyser: AnalyserNode | null = null;
  private remoteAnalyser: AnalyserNode | null = null;
  private remoteGainNode: GainNode | null = null;
  private remoteLimiter: DynamicsCompressorNode | null = null;
  private wakeLockSentinel: any = null;
  private isMuted: boolean = false;
  private boostLevel: number = 1.0; // Default to 1.0 (100% natural studio HD clarity)

  async initLocalAudio(): Promise<MediaStream> {
    const constraints: MediaStreamConstraints = {
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
      },
      video: false,
    };

    this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
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

  /**
   * Sets the volume boost level (e.g., 1.0 = HD Pure, 1.5 = Loud, 2.0 = Max).
   */
  setBoostLevel(multiplier: number) {
    this.boostLevel = multiplier;
    if (this.remoteGainNode && this.audioContext && this.audioContext.state !== 'closed') {
      try {
        this.remoteGainNode.gain.setValueAtTime(multiplier, this.audioContext.currentTime);
      } catch (e) {
        this.remoteGainNode.gain.value = multiplier;
      }
    }
  }

  getBoostLevel(): number {
    return this.boostLevel;
  }

  resumeAudio() {
    if (this.audioContext && this.audioContext.state === 'suspended') {
      this.audioContext.resume().catch(() => {});
    }
  }

  /**
   * High-Fidelity Remote Audio Pipeline:
   * 1. Direct Web Audio MediaStream source (routed to loudspeaker)
   * 2. Pure Hardware Gain Booster (1.0x HD default, undistorted)
   * 3. Transparent Peak Limiter (prevents digital clipping only without squashing voice)
   * 4. Direct destination to phone loudspeaker
   */
  setupRemoteAudio(remoteStream: MediaStream, audioElement: HTMLAudioElement) {
    try {
      if (!this.audioContext || this.audioContext.state === 'closed') {
        this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      if (this.audioContext.state === 'suspended') {
        this.audioContext.resume().catch(() => {});
      }

      const source = this.audioContext.createMediaStreamSource(remoteStream);

      // 1. Live VU meter analyser
      this.remoteAnalyser = this.audioContext.createAnalyser();
      this.remoteAnalyser.fftSize = 64;
      source.connect(this.remoteAnalyser);

      // 2. Hardware Loudness Booster (GainNode: 1.0x HD default)
      this.remoteGainNode = this.audioContext.createGain();
      this.remoteGainNode.gain.setValueAtTime(this.boostLevel, this.audioContext.currentTime);

      // 3. Transparent Peak Limiter (only engages on loud peaks to prevent digital clipping)
      this.remoteLimiter = this.audioContext.createDynamicsCompressor();
      this.remoteLimiter.threshold.setValueAtTime(-1.0, this.audioContext.currentTime);
      this.remoteLimiter.knee.setValueAtTime(10, this.audioContext.currentTime);
      this.remoteLimiter.ratio.setValueAtTime(4.0, this.audioContext.currentTime);
      this.remoteLimiter.attack.setValueAtTime(0.003, this.audioContext.currentTime);
      this.remoteLimiter.release.setValueAtTime(0.05, this.audioContext.currentTime);

      // Clean signal path: source -> gainNode -> transparentLimiter -> destination (Loudspeaker)
      source.connect(this.remoteGainNode);
      this.remoteGainNode.connect(this.remoteLimiter);
      this.remoteLimiter.connect(this.audioContext.destination);

      // Silent keepalive on native element
      audioElement.srcObject = remoteStream;
      audioElement.muted = true;
      if ('setSinkId' in audioElement && typeof (audioElement as any).setSinkId === 'function') {
        (audioElement as any).setSinkId('default').catch(() => {});
      }
      audioElement.play().catch(() => {});
    } catch (err) {
      console.warn('[Audio] Web Audio amplification fallback to native audioElement:', err);
      audioElement.srcObject = remoteStream;
      audioElement.muted = false;
      audioElement.volume = 1.0;
      audioElement.play().catch(() => {});
    }
  }

  private setupLocalAnalyser(stream: MediaStream) {
    try {
      if (!this.audioContext || this.audioContext.state === 'closed') {
        this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      if (this.audioContext.state === 'suspended') {
        this.audioContext.resume().catch(() => {});
      }
      const source = this.audioContext.createMediaStreamSource(stream);
      this.localAnalyser = this.audioContext.createAnalyser();
      this.localAnalyser.fftSize = 64;
      source.connect(this.localAnalyser);
    } catch (err) {
      console.warn('[Audio] Could not attach local analyser:', err);
    }
  }

  getLocalVolume(): number {
    if (this.isMuted || !this.localAnalyser) return 0;
    return this.calculateVolume(this.localAnalyser);
  }

  getRemoteVolume(): number {
    if (!this.remoteAnalyser) return 0;
    return this.calculateVolume(this.remoteAnalyser);
  }

  private calculateVolume(analyser: AnalyserNode): number {
    try {
      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteFrequencyData(dataArray);
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i];
      }
      const average = sum / dataArray.length;
      return Math.min(100, Math.round((average / 255) * 100));
    } catch (e) {
      return 0;
    }
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
    this.remoteGainNode = null;
    this.remoteLimiter = null;
  }
}
