class RingBuffer {
  constructor(capacity) {
    this.buffer = new Float32Array(capacity);
    this.readPos = 0;
    this.writePos = 0;
    this.count = 0;
  }
  push(data) {
    for (let i = 0; i < data.length; i++) {
      this.buffer[this.writePos] = data[i];
      this.writePos = (this.writePos + 1) % this.buffer.length;
      this.count++;
    }
  }
  pop(length) {
    const result = new Float32Array(length);
    for (let i = 0; i < length; i++) {
      result[i] = this.buffer[this.readPos];
      this.readPos = (this.readPos + 1) % this.buffer.length;
      this.count--;
    }
    return result;
  }
  available() { return this.count; }
  reset() { this.readPos = 0; this.writePos = 0; this.count = 0; }
}

class RubberBandProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ready = false;
    this.blockSize = 512;
    this.channels = 2;
    this.inputRings = null;
    this.outputRings = null;
    this.port.onmessage = (e) => this.onmessage(e);
  }

  onmessage(e) {
    const msg = e.data;
    if (msg.type === 'INIT') {
      this.blockSize = msg.blockSize || 512;
      this.channels = msg.channels || 2;
      const cap = this.blockSize * 4;
      this.inputRings = [];
      this.outputRings = [];
      for (let ch = 0; ch < this.channels; ch++) {
        this.inputRings.push(new RingBuffer(cap));
        this.outputRings.push(new RingBuffer(cap));
      }
      this.ready = true;
      this.port.postMessage({ type: 'INIT_OK' });
    } else if (msg.type === 'OUTPUT_READY') {
      const chs = msg.channels;
      for (let ch = 0; ch < this.outputRings.length; ch++) {
        if (chs[ch]) this.outputRings[ch].push(chs[ch]);
      }
    } else if (msg.type === 'RESET') {
      if (this.inputRings) this.inputRings.forEach(r => r.reset());
      if (this.outputRings) this.outputRings.forEach(r => r.reset());
    }
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];

    if (!this.ready || !input || !input[0]) {
      for (let ch = 0; ch < output.length; ch++) output[ch].fill(0);
      return true;
    }

    const framesPerBlock = 128;

    // Push per-channel samples into ring buffers (planar — no interleaving)
    for (let ch = 0; ch < this.channels; ch++) {
      this.inputRings[ch].push(input[ch] || new Float32Array(framesPerBlock));
    }

    // When enough samples accumulated, send one planar block for processing
    if (this.inputRings[0].available() >= this.blockSize) {
      const channelData = [];
      for (let ch = 0; ch < this.channels; ch++) {
        channelData.push(this.inputRings[ch].pop(this.blockSize));
      }
      this.port.postMessage({ type: 'PROCESS', channels: channelData });
    }

    // Read output from ring buffers
    if (this.outputRings[0].available() >= framesPerBlock) {
      for (let ch = 0; ch < this.channels; ch++) {
        output[ch].set(this.outputRings[ch].pop(framesPerBlock));
      }
    } else {
      for (let ch = 0; ch < output.length; ch++) output[ch].fill(0);
    }

    return true;
  }
}

registerProcessor("rubberband", RubberBandProcessor);
