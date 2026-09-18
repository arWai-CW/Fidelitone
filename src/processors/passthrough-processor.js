class PassthroughProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
  }

  process(input, output) {
    const inp = input[0];
    const out = output[0];
    if (inp && out) {
      for (let ch = 0; ch < out.length; ch++) {
        if (inp[ch]) {
          out[ch].set(inp[ch]);
        } else {
          out[ch].fill(0);
        }
      }
    } else if (out) {
      for (const channel of out) channel.fill(0);
    }
    return true;
  }
}

registerProcessor("passthrough", PassthroughProcessor);
