import { VoicePreset } from './voicePreset';
export class VoiceProcessor {
 private nodes: AudioNode[] = [];
 private worklet!: AudioWorkletNode;
 private lowpass!: BiquadFilterNode;
 private destination!: MediaStreamAudioDestinationNode;
 async start(context: AudioContext, input: MediaStream, preset: VoicePreset, onFailure: () => void) {
  if (!context.audioWorklet) throw new Error('Voice effects need AudioWorklet support. Update your browser. Your microphone remains muted.');
  await context.audioWorklet.addModule('/voice-worklet.js');
  const source = context.createMediaStreamSource(input);
  this.worklet = new AudioWorkletNode(context, 'imicall-voice', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
  this.worklet.addEventListener('processorerror', onFailure);
  this.lowpass = context.createBiquadFilter(); this.lowpass.type = 'lowpass';
  const highpass = context.createBiquadFilter(); highpass.type = 'highpass'; highpass.frequency.value = 160;
  const limiter = context.createDynamicsCompressor(); limiter.threshold.value = -6; limiter.ratio.value = 8;
  this.destination = context.createMediaStreamDestination();
  source.connect(highpass).connect(this.worklet).connect(this.lowpass).connect(limiter).connect(this.destination);
  this.nodes = [source, highpass, this.worklet, this.lowpass, limiter, this.destination];
  this.update(preset); return this.destination.stream;
 }
 update(preset: VoicePreset) { this.worklet.port.postMessage(preset); this.lowpass.frequency.value = preset.cutoff; }
 stop() { this.nodes.forEach(n => n.disconnect()); this.worklet?.port.close(); this.destination?.stream.getTracks().forEach(t => t.stop()); this.nodes = []; }
}
