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
          const src = inp[ch];
          const dst = out[ch];
          for (let i = 0; i < dst.length; i++) dst[i] = src[i];
        }
      }
    }
    return true;
  }
}

registerProcessor("passthrough", PassthroughProcessor);
