/**
 * Sound & Ringtone Manager for ImiCall.
 * Uses Web Audio API to synthesize crystal-clear ringtones & ringback tones
 * with zero external MP3/audio file dependencies. Also triggers device vibration.
 */

export class SoundManager {
  private audioCtx: AudioContext | null = null;
  private ringInterval: any = null;
  private vibrateInterval: any = null;
  private isPlaying: boolean = false;

  private getAudioContext(): AudioContext {
    if (!this.audioCtx || this.audioCtx.state === 'closed') {
      this.audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
    return this.audioCtx;
  }

  /**
   * Plays an incoming call ringtone (melodic chime) and vibrates phone.
   */
  startIncomingRing() {
    this.stopAll();
    this.isPlaying = true;

    const playChimeSequence = () => {
      if (!this.isPlaying) return;
      try {
        const ctx = this.getAudioContext();
        const now = ctx.currentTime;

        // Sequence of pleasant chime tones (Pentatonic notes for pleasant alert)
        const notes = [
          { freq: 659.25, time: 0, dur: 0.2 },     // E5
          { freq: 783.99, time: 0.18, dur: 0.2 },  // G5
          { freq: 987.77, time: 0.36, dur: 0.25 }, // B5
          { freq: 1318.51, time: 0.54, dur: 0.4 }, // E6
          { freq: 987.77, time: 1.1, dur: 0.2 },   // B5
          { freq: 1318.51, time: 1.3, dur: 0.5 },  // E6
        ];

        notes.forEach(({ freq, time, dur }) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();

          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, now + time);

          // Smooth envelope
          gain.gain.setValueAtTime(0, now + time);
          gain.gain.linearRampToValueAtTime(0.25, now + time + 0.03);
          gain.gain.exponentialRampToValueAtTime(0.001, now + time + dur);

          osc.connect(gain);
          gain.connect(ctx.destination);

          osc.start(now + time);
          osc.stop(now + time + dur);
        });
      } catch (err) {
        console.warn('[Sound] Ringtone error:', err);
      }
    };

    // Initial chime
    playChimeSequence();
    // Repeat every 2.4 seconds
    this.ringInterval = setInterval(playChimeSequence, 2400);

    // Mobile vibration pattern (500ms vibrate, 300ms pause)
    this.startVibration();
  }

  /**
   * Plays an outgoing ringback tone for caller ("tuuut... tuuut...").
   */
  startOutgoingRingback() {
    this.stopAll();
    this.isPlaying = true;

    const playBeep = () => {
      if (!this.isPlaying) return;
      try {
        const ctx = this.getAudioContext();
        const now = ctx.currentTime;

        // Dual frequencies (440Hz + 480Hz) for authentic telephone ringback
        const osc1 = ctx.createOscillator();
        const osc2 = ctx.createOscillator();
        const gain = ctx.createGain();

        osc1.frequency.setValueAtTime(440, now);
        osc2.frequency.setValueAtTime(480, now);

        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(0.12, now + 0.05);
        gain.gain.setValueAtTime(0.12, now + 1.2);
        gain.gain.linearRampToValueAtTime(0.001, now + 1.3);

        osc1.connect(gain);
        osc2.connect(gain);
        gain.connect(ctx.destination);

        osc1.start(now);
        osc2.start(now);
        osc1.stop(now + 1.3);
        osc2.stop(now + 1.3);
      } catch (err) {
        console.warn('[Sound] Ringback error:', err);
      }
    };

    playBeep();
    // Repeat every 3.5 seconds
    this.ringInterval = setInterval(playBeep, 3500);
  }

  private startVibration() {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try {
        navigator.vibrate([500, 300, 500, 300]);
        this.vibrateInterval = setInterval(() => {
          if (this.isPlaying) {
            navigator.vibrate([500, 300, 500, 300]);
          }
        }, 2400);
      } catch (e) {
        // Vibration not permitted or available
      }
    }
  }

  stopAll() {
    this.isPlaying = false;
    if (this.ringInterval) {
      clearInterval(this.ringInterval);
      this.ringInterval = null;
    }
    if (this.vibrateInterval) {
      clearInterval(this.vibrateInterval);
      this.vibrateInterval = null;
    }
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try {
        navigator.vibrate(0);
      } catch (e) {}
    }
  }
}
