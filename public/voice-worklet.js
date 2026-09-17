// Dual-delay pitch shift and ring modulation. Voice effect, not identity protection.
class ImiVoice extends AudioWorkletProcessor {
  constructor() {
    super(); this.buffer = new Float32Array(16384); this.position = 0; this.phase = 0; this.carrierPhase = 0;
    this.settings = { pitch: 0, carrier: 0, mix: 0 };
    this.port.onmessage = e => { this.settings = e.data; };
  }
  sample(delay) {
    const index = (this.position - delay + this.buffer.length) % this.buffer.length;
    const base = Math.floor(index), fraction = index - base;
    return this.buffer[base] * (1 - fraction) + this.buffer[(base + 1) % this.buffer.length] * fraction;
  }
  process(inputs, outputs) {
    const source = inputs[0]?.[0], output = outputs[0]?.[0];
    if (!output) return true;
    const { pitch, carrier, mix } = this.settings;
    const ratio = Math.pow(2, pitch / 12), windowSize = Math.min(4096, sampleRate * .06);
    for (let i = 0; i < output.length; i++) {
      const dry = source?.[i] || 0; this.buffer[this.position] = dry;
      this.phase = (this.phase + (1 - ratio) / windowSize + 1) % 1;
      const second = (this.phase + .5) % 1;
      const weight = Math.pow(Math.sin(Math.PI * this.phase), 2);
      let wet = pitch === 0 ? dry : this.sample(128 + this.phase * windowSize) * weight + this.sample(128 + second * windowSize) * (1 - weight);
      this.carrierPhase = (this.carrierPhase + carrier / sampleRate) % 1;
      if (carrier > 0) wet *= Math.sin(2 * Math.PI * this.carrierPhase);
      output[i] = Math.max(-.95, Math.min(.95, dry * (1 - mix) + wet * mix));
      this.position = (this.position + 1) % this.buffer.length;
    }
    return true;
  }
}
registerProcessor('imicall-voice', ImiVoice);
