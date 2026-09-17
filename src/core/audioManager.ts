import type { VoicePreset } from './voicePreset';
import type { VoiceProcessor } from './voiceProcessor';
export class AudioManager {
 private rawStream: MediaStream | null = null;
 private localStream: MediaStream | null = null;
 private audioContext: AudioContext | null = null;
 private analyser: AnalyserNode | null = null;
 private analysisSource: MediaStreamAudioSourceNode | null = null;
 private processor: VoiceProcessor | null = null;
 private wakeLock: any = null;
 private muted = false;
 private filterFailed = false;
 private generation = 0;
 private audioElement: HTMLAudioElement | null = null;
 public onPlaybackBlocked: (() => void) | null = null;
 public onFilterFailure: (() => void) | null = null;
 prepareAudio() {
  if (!this.audioContext || this.audioContext.state === 'closed') this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
  void this.audioContext.resume().catch(() => {});
 }
 async initLocalAudio() {
  // Create/resume synchronously in the tap handler, before getUserMedia resolves.
  this.prepareAudio(); const generation = this.generation;
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone needs a secure HTTPS address. Local network HTTP addresses cannot request permission.');
  let stream: MediaStream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 }, video: false }); }
  catch (error) {
   if (error instanceof DOMException && error.name === 'OverconstrainedError') stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
   else throw error;
  }
  if (generation !== this.generation) { stream.getTracks().forEach(t => t.stop()); throw new Error('Call cancelled'); }
  this.rawStream = stream; this.localStream = stream; this.attachAnalyser(stream); void this.requestWakeLock(); return stream;
 }
 private attachAnalyser(stream: MediaStream) {
  this.analysisSource?.disconnect();
  if (!this.audioContext) return;
  this.analysisSource = this.audioContext.createMediaStreamSource(stream);
  this.analyser = this.audioContext.createAnalyser(); this.analyser.fftSize = 64; this.analysisSource.connect(this.analyser);
 }
 getLocalStream() { return this.localStream; }
 getIsMuted() { return this.muted; }
 setMuted(muted: boolean) { this.muted = muted; for (const stream of [this.rawStream, this.localStream]) stream?.getAudioTracks().forEach(t => { t.enabled = !muted; }); }
 toggleMute() { if (this.filterFailed) return true; this.setMuted(!this.muted); return this.muted; }
 async applyVoice(preset: VoicePreset, replace: (track: MediaStreamTrack) => Promise<void>) {
  if (!this.rawStream || !this.audioContext) return;
  const generation = this.generation;
  const wasMuted = this.muted;
  // Mute while switching. Failure must not silently expose the natural voice.
  this.setMuted(true);
  try {
   if (preset.mix === 0) {
    await replace(this.rawStream.getAudioTracks()[0]);
    this.processor?.stop(); this.processor = null; this.localStream = this.rawStream;
   } else {
    if (!this.processor) {
     const { VoiceProcessor } = await import('./voiceProcessor');
     if (generation !== this.generation) throw new Error('Call ended');
     const processor = new VoiceProcessor();
     const output = await processor.start(this.audioContext, this.rawStream, preset, () => {
      if (generation !== this.generation) return;
      this.filterFailed = true; this.setMuted(true); this.processor?.stop(); this.processor = null; this.onFilterFailure?.();
     });
     if (generation !== this.generation) { processor.stop(); throw new Error('Call ended'); }
     output.getTracks().forEach(t => { t.enabled = false; });
     this.processor = processor;
     await replace(output.getAudioTracks()[0]);
     this.localStream = output;
    } else this.processor.update(preset);
   }
   if (generation !== this.generation) return;
   this.filterFailed = false; this.attachAnalyser(this.localStream!); this.setMuted(wasMuted);
  } catch (error) { if (generation !== this.generation) throw error; this.processor?.stop(); this.processor = null; this.filterFailed = true; this.setMuted(true); this.onFilterFailure?.(); throw error; }
 }
 setupRemoteAudio(stream: MediaStream, element: HTMLAudioElement) {
  this.audioElement = element; element.srcObject = stream; element.muted = false; element.volume = 1;
  element.autoplay = true; element.setAttribute('playsinline', '');
  // Native media playback is more reliable on Safari than a muted element + Web Audio graph.
  void element.play().catch(() => this.onPlaybackBlocked?.());
 }
 async resumeAudio() {
  if (this.audioContext?.state === 'suspended') await this.audioContext.resume().catch(() => {});
  if (this.audioElement) await this.audioElement.play().catch(() => this.onPlaybackBlocked?.());
 }
 getLocalVolume() {
  if (this.muted || !this.analyser) return 0;
  const buffer = new Uint8Array(this.analyser.frequencyBinCount); this.analyser.getByteFrequencyData(buffer);
  return Math.round(buffer.reduce((a,b) => a+b,0) / buffer.length / 255 * 100);
 }
 getRemoteVolume() { return 0; } // Native playback avoids a second audio graph on mobile.
 async requestWakeLock() { try { if ('wakeLock' in navigator) this.wakeLock = await (navigator as any).wakeLock.request('screen'); } catch {} }
 cleanup() {
  this.generation++; this.muted = false; this.filterFailed = false;
  void this.wakeLock?.release().catch(() => {}); this.wakeLock = null;
  this.processor?.stop(); this.processor = null;
  for (const stream of [this.rawStream, this.localStream]) stream?.getTracks().forEach(t => t.stop());
  this.localStream = this.rawStream = null;
  this.analysisSource?.disconnect(); this.analysisSource = null; this.analyser = null;
  if (this.audioContext && this.audioContext.state !== 'closed') void this.audioContext.close().catch(() => {});
  this.audioContext = null;
  if (this.audioElement) { this.audioElement.pause(); this.audioElement.srcObject = null; this.audioElement = null; }
 }
}
