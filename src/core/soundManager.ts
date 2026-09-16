/**
 * Sound & Ringtone Manager for ImiCall.
 * Uses Web Audio API to synthesize ringtones & ringback tones.
 * Tracks all active nodes to ensure immediate, complete silence upon call connect.
 */

export class SoundManager {
  private audioCtx: AudioContext | null = null;
  private ringInterval: any = null;
  private vibrateInterval: any = null;
  private isPlaying: boolean = false;
  private activeOscillators: OscillatorNode[] = [];

  private getAudioContext(): AudioContext {
    if (!this.audioCtx || this.audioCtx.state === 'closed') {
      this.audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume().catch(() => {});
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

        const notes = [
          { freq: 659.25, time: 0, dur: 0.18 },    // E5
          { freq: 783.99, time: 0.16, dur: 0.18 }, // G5
          { freq: 987.77, time: 0.32, dur: 0.22 }, // B5
          { freq: 1318.51, time: 0.48, dur: 0.35 },// E6
        ];

        notes.forEach(({ freq, time, dur }) => {
          if (!this.isPlaying) return;

          const osc = ctx.createOscillator();
          const gain = ctx.createGain();

          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, now + time);

          gain.gain.setValueAtTime(0, now + time);
          gain.gain.linearRampToValueAtTime(0.2, now + time + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.001, now + time + dur);

          osc.connect(gain);
          gain.connect(ctx.destination);

          osc.start(now + time);
          osc.stop(now + time + dur);

          this.activeOscillators.push(osc);
          osc.onended = () => {
            const idx = this.activeOscillators.indexOf(osc);
            if (idx !== -1) this.activeOscillators.splice(idx, 1);
          };
        });
      } catch (err) {
        console.warn('[Sound] Ringtone error:', err);
      }
    };

    playChimeSequence();
    this.ringInterval = setInterval(playChimeSequence, 2200);
    this.startVibration();
  }

  /**
   * Plays outgoing ringback tone for caller ("tuuut... tuuut...").
   */
  startOutgoingRingback() {
    this.stopAll();
    this.isPlaying = true;

    const playBeep = () => {
      if (!this.isPlaying) return;
      try {
        const ctx = this.getAudioContext();
        const now = ctx.currentTime;

        const osc1 = ctx.createOscillator();
        const osc2 = ctx.createOscillator();
        const gain = ctx.createGain();

        osc1.frequency.setValueAtTime(440, now);
        osc2.frequency.setValueAtTime(480, now);

        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(0.1, now + 0.04);
        gain.gain.setValueAtTime(0.1, now + 1.1);
        gain.gain.linearRampToValueAtTime(0.001, now + 1.2);

        osc1.connect(gain);
        osc2.connect(gain);
        gain.connect(ctx.destination);

        osc1.start(now);
        osc2.start(now);
        osc1.stop(now + 1.2);
        osc2.stop(now + 1.2);

        this.activeOscillators.push(osc1, osc2);
        const cleanup = () => {
          this.activeOscillators = this.activeOscillators.filter((o) => o !== osc1 && o !== osc2);
        };
        osc1.onended = cleanup;
        osc2.onended = cleanup;
      } catch (err) {
        console.warn('[Sound] Ringback error:', err);
      }
    };

    playBeep();
    this.ringInterval = setInterval(playBeep, 3200);
  }

  private startVibration() {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try {
        navigator.vibrate([400, 200, 400, 200]);
        this.vibrateInterval = setInterval(() => {
          if (this.isPlaying) {
            navigator.vibrate([400, 200, 400, 200]);
          }
        }, 2200);
      } catch (e) {}
    }
  }

  /**
   * Completely silences all ringers, terminates all oscillators, and closes audio context.
   */
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

    // Stop every playing oscillator immediately
    for (const osc of this.activeOscillators) {
      try {
        osc.stop();
        osc.disconnect();
      } catch (e) {}
    }
    this.activeOscillators = [];

    // Force close audio context to eliminate any residual sound
    if (this.audioCtx && this.audioCtx.state !== 'closed') {
      this.audioCtx.close().catch(() => {});
      this.audioCtx = null;
    }

    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try {
        navigator.vibrate(0);
      } catch (e) {}
    }
  }
}
