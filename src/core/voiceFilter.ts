/**
 * Voice Clarity & Intelligibility Filter Engine.
 * Enhances human speech and suppresses low-frequency noise (wind, road noise, handling thumps)
 * using Web Audio API nodes prior to Opus compression and WebRTC transmission.
 */

export class VoiceFilterEngine {
  private audioCtx: AudioContext | null = null;
  private highpassFilter: BiquadFilterNode | null = null;
  private vocalPresenceFilter: BiquadFilterNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;

  /**
   * Processes a raw microphone stream and returns an enhanced, intelligibility-boosted stream.
   */
  processStream(inputStream: MediaStream): MediaStream {
    try {
      this.audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      if (this.audioCtx.state === 'suspended') {
        this.audioCtx.resume();
      }

      const source = this.audioCtx.createMediaStreamSource(inputStream);
      const destination = this.audioCtx.createMediaStreamDestination();

      // 1. High-Pass Filter (Cut below 120 Hz)
      // Removes deep rumble, vehicle engine vibrations, and wind noise
      this.highpassFilter = this.audioCtx.createBiquadFilter();
      this.highpassFilter.type = 'highpass';
      this.highpassFilter.frequency.setValueAtTime(120, this.audioCtx.currentTime);
      this.highpassFilter.Q.setValueAtTime(0.7, this.audioCtx.currentTime);

      // 2. Vocal Formant Peaking Filter (Boost 2.8 kHz - 3.2 kHz by +3.5 dB)
      // Boosts human speech presence and consonant intelligibility (t, s, k, p)
      this.vocalPresenceFilter = this.audioCtx.createBiquadFilter();
      this.vocalPresenceFilter.type = 'peaking';
      this.vocalPresenceFilter.frequency.setValueAtTime(3000, this.audioCtx.currentTime);
      this.vocalPresenceFilter.Q.setValueAtTime(1.2, this.audioCtx.currentTime);
      this.vocalPresenceFilter.gain.setValueAtTime(3.5, this.audioCtx.currentTime);

      // 3. Dynamics Compressor (Normalizes volume)
      // Amplifies soft whispers and prevents clipping / distortion on loud speech
      this.compressor = this.audioCtx.createDynamicsCompressor();
      this.compressor.threshold.setValueAtTime(-24, this.audioCtx.currentTime);
      this.compressor.knee.setValueAtTime(10, this.audioCtx.currentTime);
      this.compressor.ratio.setValueAtTime(4, this.audioCtx.currentTime);
      this.compressor.attack.setValueAtTime(0.003, this.audioCtx.currentTime);
      this.compressor.release.setValueAtTime(0.25, this.audioCtx.currentTime);

      // Chain: Source -> Highpass -> Vocal Boost -> Compressor -> Destination
      source.connect(this.highpassFilter);
      this.highpassFilter.connect(this.vocalPresenceFilter);
      this.vocalPresenceFilter.connect(this.compressor);
      this.compressor.connect(destination);

      return destination.stream;
    } catch (err) {
      console.warn('[VoiceFilter] Web Audio processing fallback to raw stream:', err);
      return inputStream;
    }
  }

  cleanup() {
    if (this.audioCtx && this.audioCtx.state !== 'closed') {
      this.audioCtx.close().catch(() => {});
      this.audioCtx = null;
    }
  }
}
