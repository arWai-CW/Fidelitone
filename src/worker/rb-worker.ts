/**
 * Rubber Band WASM Worker — LiveShifter for offline file export
 *
 * Handles INIT → PROCESS → DELETE lifecycle.
 * All buffers pre-allocated in INIT, reused in PROCESS (zero hot-path alloc).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface InitMsg {
  type: 'INIT';
  sampleRate: number;
  channels: number;
  pitchScale: number;
  preserveFormants?: boolean;
}

interface ProcessMsg {
  type: 'PROCESS';
  channels: Float32Array[];
}

interface SetPitchMsg {
  type: 'SET_PITCH';
  pitchScale: number;
}

interface DeleteMsg {
  type: 'DELETE';
}

type WorkerMsg = InitMsg | ProcessMsg | SetPitchMsg | DeleteMsg;

// ---------------------------------------------------------------------------
// WASM bindings (filled after load)
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let exports: any = null;

let state = 0;
let blockSize = 0;
let channels = 0;
let inputChPtrs = 0;
let outputChPtrs = 0;
let inputBufs: number[] = [];
let outputBufs: number[] = [];

let wasmF32: Float32Array = new Float32Array(0);

function refreshViews() {
  wasmF32 = new Float32Array(exports.memory.buffer);
}

// ---------------------------------------------------------------------------
// WASM loading
// ---------------------------------------------------------------------------

async function loadWasm() {
  const wasmUrl = new URL('../wasm/rubberband.wasm', import.meta.url);
  const { instance } = await WebAssembly.instantiateStreaming(fetch(wasmUrl), {
    env: {
      emscripten_notify_memory_growth: () => {},
    },
    wasi_snapshot_preview1: {
      environ_get: () => 0,
      environ_sizes_get: () => 0,
      fd_seek: () => 0,
      fd_close: () => 0,
      fd_write: () => 0,
      fd_read: () => 0,
      clock_time_get: () => 0,
    },
  });

  exports = instance.exports;
  refreshViews();
  self.postMessage({ type: 'WASM_READY' });
}

// ---------------------------------------------------------------------------
// Message handling
// ---------------------------------------------------------------------------

function handleInit(sampleRate: number, ch: number, pitchScale: number, preserveFormants: boolean = false) {
  channels = ch;

  state = exports.rb_live_new(sampleRate, channels, 0);
  if (state === 0) {
    self.postMessage({ type: 'INIT_ERROR', error: 'Failed to create LiveShifter' });
    return;
  }

  exports.rb_live_set_pitch_scale(state, pitchScale);

  if (preserveFormants && exports.rb_live_set_formant_option) {
    exports.rb_live_set_formant_option(state, 0x01000000); // OptionFormantPreserved
  }

  blockSize = exports.rb_live_get_block_size(state);
  const startDelay = exports.rb_live_get_start_delay(state);

  const chBufBytes = blockSize * 4;
  inputBufs = [];
  outputBufs = [];
  for (let i = 0; i < channels; i++) {
    inputBufs.push(exports.wasm_malloc(chBufBytes));
    outputBufs.push(exports.wasm_malloc(chBufBytes));
  }
  inputChPtrs = exports.wasm_malloc(channels * 4);
  outputChPtrs = exports.wasm_malloc(channels * 4);

  refreshViews();
  const u32 = new Uint32Array(exports.memory.buffer);
  for (let i = 0; i < channels; i++) {
    u32[(inputChPtrs >> 2) + i] = inputBufs[i];
    u32[(outputChPtrs >> 2) + i] = outputBufs[i];
  }

  self.postMessage({
    type: 'INIT_OK',
    blockSize,
    startDelay,
    channels,
    sampleRate,
  });
}

function handleProcess(channelsData: Float32Array[]) {
  if (state === 0) {
    self.postMessage({ type: 'PROCESS_ERROR', error: 'Not initialized' });
    return;
  }

  const totalSamples = channelsData[0].length;
  const numBlocks = Math.ceil(totalSamples / blockSize);
  const output: Float32Array[] = [];
  for (let ch = 0; ch < channels; ch++) {
    output.push(new Float32Array(numBlocks * blockSize));
  }

  for (let blockIdx = 0; blockIdx < numBlocks; blockIdx++) {
    const offset = blockIdx * blockSize;
    const chunkLen = Math.min(blockSize, totalSamples - offset);

    refreshViews();
    for (let ch = 0; ch < channels; ch++) {
      const base = inputBufs[ch] >> 2;
      for (let i = 0; i < chunkLen; i++) wasmF32[base + i] = channelsData[ch][offset + i];
      for (let i = chunkLen; i < blockSize; i++) wasmF32[base + i] = 0;
    }

    exports.rb_live_shift(state, inputChPtrs, outputChPtrs);

    refreshViews();
    for (let ch = 0; ch < channels; ch++) {
      const base = outputBufs[ch] >> 2;
      for (let i = 0; i < blockSize; i++) output[ch][offset + i] = wasmF32[base + i];
    }
  }

  const outLen = numBlocks * blockSize;
  const outputInterleaved = new Float32Array(outLen * channels);
  for (let i = 0; i < outLen; i++) {
    for (let ch = 0; ch < channels; ch++) {
      outputInterleaved[i * channels + ch] = output[ch][i];
    }
  }

  self.postMessage({ type: 'PROCESS_OK', output: outputInterleaved });
}

function handleSetPitch(pitchScale: number) {
  if (state === 0) return;
  exports.rb_live_set_pitch_scale(state, pitchScale);
}

function handleDelete() {
  if (state !== 0) {
    exports.rb_live_delete(state);
    state = 0;
  }
  for (const ptr of [...inputBufs, ...outputBufs, inputChPtrs, outputChPtrs]) {
    if (ptr !== 0) exports.wasm_free(ptr);
  }
  inputBufs = [];
  outputBufs = [];
  inputChPtrs = 0;
  outputChPtrs = 0;
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

self.onmessage = (e: MessageEvent<WorkerMsg>) => {
  const msg = e.data;
  switch (msg.type) {
    case 'INIT':
      handleInit(msg.sampleRate, msg.channels, msg.pitchScale, msg.preserveFormants);
      break;
    case 'PROCESS':
      handleProcess(msg.channels);
      break;
    case 'SET_PITCH':
      handleSetPitch(msg.pitchScale);
      break;
    case 'DELETE':
      handleDelete();
      break;
  }
};

loadWasm();
