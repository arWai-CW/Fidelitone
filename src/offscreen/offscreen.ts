// Offscreen audio engine — RubberBandLiveShifter for real-time pitch shifting
//
// Architecture:
// - Processor (AudioWorklet thread): ring buffers, interleave/deinterleave, message I/O
// - Main thread: WASM LiveShifter processing, chrome.runtime message handling
// - 128-frame Web Audio blocks → 512-sample RubberBand blocks via ring buffers
// - Signalsmith fallback in src/lib/dsp/signalsmith-fallback.ts for A/B comparison

let wasmExports: any = null;
let state = 0;
let rbBlockSize = 2048; // increased for better low-frequency resolution
let rbChannels = 2;
let wasmF32: Float32Array = new Float32Array(0);

let inputChPtrs = 0;
let outputChPtrs = 0;
let inputBufs: number[] = [];
let outputBufs: number[] = [];

function refreshViews() {
  wasmF32 = new Float32Array(wasmExports.memory.buffer);
}

async function loadWasm(): Promise<boolean> {
  try {
    const wasmUrl = new URL("../wasm/rubberband.wasm", import.meta.url);
    const { instance } = await WebAssembly.instantiateStreaming(
      fetch(wasmUrl),
      {
        env: { emscripten_notify_memory_growth: () => {} },
        wasi_snapshot_preview1: {
          environ_get: () => 0,
          environ_sizes_get: () => 0,
          fd_seek: () => 0,
          fd_close: () => 0,
          fd_write: () => 0,
          fd_read: () => 0,
          clock_time_get: () => 0,
        },
      }
    );
    wasmExports = instance.exports;
    refreshViews();
    console.log("[offscreen] WASM loaded");
    return true;
  } catch (err) {
    console.error("[offscreen] WASM load failed:", err);
    return false;
  }
}

function initLiveShifter(sampleRate: number, ch: number, pitchScale: number) {
  rbChannels = ch;
  const options = 0x00000121; // OptionProcessRealTime | OptionEngineFiner | OptionPitchShift
  state = wasmExports.rb_live_new(sampleRate, rbChannels, options);
  if (state === 0) return null;

  wasmExports.rb_live_set_pitch_scale(state, pitchScale);
  setFormantOption(preserveFormants);
  rbBlockSize = wasmExports.rb_live_get_block_size(state);
  const startDelay = wasmExports.rb_live_get_start_delay(state);

  const chBufBytes = rbBlockSize * 4;
  inputBufs = [];
  outputBufs = [];
  for (let i = 0; i < rbChannels; i++) {
    inputBufs.push(wasmExports.wasm_malloc(chBufBytes));
    outputBufs.push(wasmExports.wasm_malloc(chBufBytes));
  }
  inputChPtrs = wasmExports.wasm_malloc(rbChannels * 4);
  outputChPtrs = wasmExports.wasm_malloc(rbChannels * 4);

  refreshViews();
  const iu32 = new Uint32Array(wasmExports.memory.buffer);
  for (let i = 0; i < rbChannels; i++) {
    iu32[(inputChPtrs >> 2) + i] = inputBufs[i];
    iu32[(outputChPtrs >> 2) + i] = outputBufs[i];
  }

  return { blockSize: rbBlockSize, startDelay };
}

function setPitchScale(pitchScale: number) {
  if (state !== 0) wasmExports.rb_live_set_pitch_scale(state, pitchScale);
}

function setFormantOption(preserve: boolean) {
  if (state === 0) {
    console.warn("[offscreen] setFormantOption: state is 0, skipping");
    return;
  }
  const option = preserve ? OPTION_FORMANT_PRESERVED : OPTION_FORMANT_SHIFTED;
  console.log("[offscreen] setFormantOption: preserve=", preserve, "option=0x" + option.toString(16), "rb_live_set_formant_option exists:", !!wasmExports.rb_live_set_formant_option);
  if (wasmExports.rb_live_set_formant_option) {
    wasmExports.rb_live_set_formant_option(state, option);
    console.log("[offscreen] setFormantOption: called successfully");
  } else {
    console.warn("[offscreen] setFormantOption: WASM function not available");
  }
}

function shiftBlock(channels: Float32Array[], outputChannels: Float32Array[]) {
  refreshViews();
  for (let ch = 0; ch < rbChannels; ch++) {
    const base = inputBufs[ch] >> 2;
    for (let i = 0; i < rbBlockSize; i++) wasmF32[base + i] = channels[ch][i];
  }
  wasmExports.rb_live_shift(state, inputChPtrs, outputChPtrs);
  refreshViews();
  for (let ch = 0; ch < rbChannels; ch++) {
    const base = outputBufs[ch] >> 2;
    for (let i = 0; i < rbBlockSize; i++) outputChannels[ch][i] = wasmF32[base + i];
  }
}

function deleteLiveShifter() {
  if (state !== 0) { wasmExports.rb_live_delete(state); state = 0; }
  for (const ptr of [...inputBufs, ...outputBufs, inputChPtrs, outputChPtrs]) {
    if (ptr !== 0) wasmExports.wasm_free(ptr);
  }
  inputBufs = [];
  outputBufs = [];
  inputChPtrs = 0;
  outputChPtrs = 0;
}

function crossfade(to: "rubberband" | "signalsmith") {
  if (!gainA || !gainB || !ctx) return;
  const now = ctx.currentTime;
  const from = activeEngine;
  const outGain = from === "rubberband" ? gainB : gainA;
  const inGain = to === "rubberband" ? gainB : gainA;

  outGain.gain.setValueAtTime(outGain.gain.value, now);
  outGain.gain.linearRampToValueAtTime(0, now + CROSSFADE_SEC);
  inGain.gain.setValueAtTime(inGain.gain.value, now);
  inGain.gain.linearRampToValueAtTime(1, now + CROSSFADE_SEC);

  activeEngine = to;
  const elapsed = performance.now() / 1000;
  console.log(`[A/B] Switched to ${to} at T+${elapsed.toFixed(3)}s`);
}

async function initSignalsmith(): Promise<boolean> {
  if (signalsmithReady) return true;
  try {
    const { createSignalsmithEngine } = await import("../lib/dsp/signalsmith-fallback");
    const engine = await createSignalsmithEngine(ctx);
    if (!engine) return false;
    signalsmithNode = engine.node;
    signalsmithNode.disconnect();
    if (gainA) {
      signalsmithNode.connect(gainA);
    }
    signalsmithReady = true;
    console.log("[A/B] Signalsmith engine initialized");
    return true;
  } catch (err) {
    console.error("[A/B] Signalsmith init failed:", err);
    return false;
  }
}

function handleSetEngine(engine: "rubberband" | "signalsmith") {
  if (engine === activeEngine) return;
  if (engine === "signalsmith" && !signalsmithReady) {
    initSignalsmith().then((ok) => {
      if (ok) crossfade("signalsmith");
    });
    return;
  }
  crossfade(engine);
}

async function initAccompanimentMode(): Promise<boolean> {
  if (crossoverReady) return true;
  try {
    const crossoverUrl = chrome.runtime.getURL("processors/crossover-processor.js");
    await ctx.audioWorklet.addModule(crossoverUrl);

    const resamplerUrl = chrome.runtime.getURL("processors/lowband-resampler.js");
    await ctx.audioWorklet.addModule(resamplerUrl);

    crossoverNode = new AudioWorkletNode(ctx, "crossover", {
      numberOfInputs: 1,
      numberOfOutputs: 2,
      channelCount: 2,
      channelCountMode: "explicit",
    });

    lowbandResamplerNode = new AudioWorkletNode(ctx, "lowband-resampler", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      channelCount: 2,
      channelCountMode: "explicit",
    });

    gainLow = ctx.createGain();
    gainLow.gain.value = 1.0;

    gainHigh = ctx.createGain();
    gainHigh.gain.value = 1.0;

    mergerNode = ctx.createChannelMerger(2);

    limiterNode = ctx.createDynamicsCompressor();
    limiterNode.threshold.value = -1.0;
    limiterNode.knee.value = 0.0;
    limiterNode.ratio.value = 20;
    limiterNode.attack.value = 0.001;
    limiterNode.release.value = 0.05;

    crossoverNode.port.postMessage({
      type: "INIT",
      crossoverFreq: CROSSOVER_FREQ,
      channels: 2,
    });

    lowbandResamplerNode.port.postMessage({
      type: "INIT",
      channels: 2,
      pitchScale: 1.0,
    });

    crossoverReady = true;
    console.log("[offscreen] Accompaniment mode initialized");
    return true;
  } catch (err) {
    console.error("[offscreen] Accompaniment mode init failed:", err);
    return false;
  }
}

function handleSetAccompaniment(value: { enabled: boolean }) {
  isAccompanimentMode = value.enabled;
  if (isAccompanimentMode) {
    initAccompanimentMode().then((ok) => {
      if (ok && mediaStreamSource) {
        connectSourceAccompaniment();
      }
    });
  } else if (mediaStreamSource) {
    connectSource();
  }
  console.log("[offscreen] Accompaniment mode →", isAccompanimentMode ? "ON" : "OFF");
}

function connectSourceAccompaniment() {
  if (!mediaStreamSource || !crossoverNode || !lowbandResamplerNode || !mergerNode || !limiterNode) {
    console.log("[offscreen] connectSourceAccompaniment: skipped - missing nodes");
    return;
  }

  mediaStreamSource.disconnect();

  if (isBypass) {
    mediaStreamSource.connect(passthrough);
    console.log("[offscreen] Source → passthrough (bypass)");
    return;
  }

  mediaStreamSource.connect(crossoverNode);

  crossoverNode.connect(lowbandResamplerNode, 0);

  lowbandResamplerNode.connect(gainLow!);
  gainLow!.connect(mergerNode!, 0, 0);

  if (rbNode && engineReady) {
    crossoverNode.connect(rbNode, 1);
    rbNode.connect(gainHigh!);
    gainHigh!.connect(mergerNode!, 0, 1);
  }

  mergerNode!.connect(limiterNode!);
  limiterNode!.connect(ctx.destination);

  console.log("[offscreen] Source → multiband pipeline (crossover → resampler + pitch shifter → merger → limiter)");
}

let ctx: AudioContext;
let passthrough: AudioWorkletNode;
let rbNode: AudioWorkletNode | null = null;
let mediaStreamSource: MediaStreamAudioSourceNode | null = null;
let activeStream: MediaStream | null = null;
let currentSemitones = 0;
let isBypass = false;
let engineReady = false;
let graphReady = false;
let preserveFormants = false;
let pendingConnect = false;

const OPTION_FORMANT_SHIFTED = 0x00000000;
const OPTION_FORMANT_PRESERVED = 0x01000000;

let activeEngine: "rubberband" | "signalsmith" = "rubberband";
let signalsmithNode: any = null;
let signalsmithReady = false;
let gainA: GainNode | null = null;
let gainB: GainNode | null = null;
const CROSSFADE_SEC = 0.05;

// Accompaniment mode (multiband processing)
let isAccompanimentMode = false;
let crossoverNode: AudioWorkletNode | null = null;
let lowbandResamplerNode: AudioWorkletNode | null = null;
let mergerNode: ChannelMergerNode | null = null;
let limiterNode: DynamicsCompressorNode | null = null;
let gainLow: GainNode | null = null;
let gainHigh: GainNode | null = null;
let crossoverReady = false;
const CROSSOVER_FREQ = 150;

function connectSource() {
  if (!mediaStreamSource || !graphReady) {
    console.log("[offscreen] connectSource: skipped - mediaStreamSource:", !!mediaStreamSource, "graphReady:", graphReady);
    return;
  }

  if (isAccompanimentMode && crossoverReady) {
    connectSourceAccompaniment();
    return;
  }

  mediaStreamSource.disconnect();

  if (isBypass) {
    mediaStreamSource.connect(passthrough);
    console.log("[offscreen] Source → passthrough (bypass)");
  } else {
    let connected = false;
    if (rbNode && engineReady) {
      mediaStreamSource.connect(rbNode);
      connected = true;
      console.log("[offscreen] Source → rbNode (RubberBand)");
    }
    if (signalsmithNode && signalsmithReady) {
      mediaStreamSource.connect(signalsmithNode);
      connected = true;
      console.log("[offscreen] Source → signalsmithNode");
    }
    if (!connected) {
      mediaStreamSource.connect(passthrough);
      console.log("[offscreen] Source → passthrough (fallback)");
    } else {
      console.log("[offscreen] Source → engines (active:", activeEngine, ")");
    }
  }
}

async function main() {
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === "SET_PITCH") {
      handleSetPitch(msg.value);
      sendResponse({ ok: true });
      return;
    }
    if (msg.type === "SET_BYPASS") {
      handleSetBypass(msg.value);
      sendResponse({ ok: true });
      return;
    }
    if (msg.type === "SET_FORMANTS") {
      console.log("[offscreen] SET_FORMANTS message received:", msg);
      handleSetFormants(msg.value);
      sendResponse({ ok: true });
      return;
    }
    if (msg.type === "SET_ENGINE") {
      handleSetEngine(msg.engine);
      sendResponse({ ok: true });
      return;
    }
    if (msg.type === "SET_ACCOMPANIMENT") {
      handleSetAccompaniment(msg.value);
      sendResponse({ ok: true });
      return;
    }
    if (msg.type === "START_CAPTURE") {
      handleStartCapture(msg.streamId)
        .then(() => sendResponse({ ok: true }))
        .catch((err) => sendResponse({ error: err.message ?? String(err) }));
      return true;
    }
  });

  console.log("[offscreen] Message listener registered");

  ctx = new AudioContext({ sampleRate: 48000 });
  if (ctx.state === "suspended") await ctx.resume();
  console.log("[offscreen] AudioContext created, sampleRate:", ctx.sampleRate);

  const wasmOk = await loadWasm();

  const rbUrl = chrome.runtime.getURL("processors/rubberband-processor.js");
  await ctx.audioWorklet.addModule(rbUrl);

  const passthroughUrl = chrome.runtime.getURL("processors/passthrough-processor.js");
  await ctx.audioWorklet.addModule(passthroughUrl);

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  gain.gain.value = 0;
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start();

  passthrough = new AudioWorkletNode(ctx, "passthrough");
  passthrough.connect(ctx.destination);

  gainA = ctx.createGain();
  gainA.gain.value = 0;
  gainA.connect(ctx.destination);

  gainB = ctx.createGain();
  gainB.gain.value = 1;
  gainB.connect(ctx.destination);

  if (wasmOk) {
    rbNode = new AudioWorkletNode(ctx, "rubberband", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      channelCount: 2,
      channelCountMode: "explicit",
    });

    rbNode.port.onmessage = (e: MessageEvent) => {
      const msg = e.data;
      if (msg.type === "PROCESS") {
        if (state === 0) return;
        const channels: Float32Array[] = msg.channels;
        if (!channels || channels.length !== rbChannels) return;
        const outChannels: Float32Array[] = channels.map(() => new Float32Array(rbBlockSize));
        shiftBlock(channels, outChannels);
        rbNode!.port.postMessage({ type: "OUTPUT_READY", channels: outChannels });
      } else if (msg.type === "INIT_OK") {
        console.log("[offscreen] INIT_OK received from AudioWorklet");
        engineReady = true;
        const result = initLiveShifter(ctx.sampleRate, 2, 1.0);
        if (result) {
          rbBlockSize = result.blockSize;
          console.log("[offscreen] RubberBand ready, blockSize:", rbBlockSize, "startDelay:", result.startDelay);
        } else {
          console.error("[offscreen] initLiveShifter failed");
        }
      }
    };

    rbNode.connect(gainB);
    rbNode.port.postMessage({ type: "INIT", blockSize: 512, channels: 2 });
    console.log("[offscreen] RubberBand node created, waiting for INIT_OK");
  } else {
    console.warn("[offscreen] WASM not loaded, passthrough only");
  }

  console.log("[offscreen] Audio graph ready — ready");
  graphReady = true;
}

function handleSetPitch(value: { semitones: number }) {
  console.log("[offscreen] SET_PITCH received:", value, "rbNode:", !!rbNode, "engineReady:", engineReady, "isBypass:", isBypass, "state:", state);
  currentSemitones = value.semitones;
  if (rbNode && engineReady && !isBypass) {
    const pitchScale = 2 ** (currentSemitones / 12);
    console.log("[offscreen] Setting pitchScale:", pitchScale);
    setPitchScale(pitchScale);
    rbNode.port.postMessage({ type: "SET_PITCH", pitchScale });
    console.log("[offscreen] Pitch →", currentSemitones, "semitones");
  } else if (!mediaStreamSource) {
    pendingConnect = true;
    console.log("[offscreen] Pitch queued (waiting for capture)");
  }
}

function handleSetBypass(value: { active: boolean }) {
  isBypass = value.active;
  if (mediaStreamSource) {
    connectSource();
  }
  if (!isBypass && rbNode && engineReady) {
    const pitchScale = 2 ** (currentSemitones / 12);
    setPitchScale(pitchScale);
    rbNode.port.postMessage({ type: "SET_PITCH", pitchScale });
  }
  console.log("[offscreen] Bypass →", isBypass ? "ON" : "OFF");
}

function handleSetFormants(value: { preserve: boolean }) {
  console.log("[offscreen] handleSetFormants received:", value);
  preserveFormants = value.preserve;
  setFormantOption(preserveFormants);
  console.log("[offscreen] Formant preservation →", preserveFormants ? "ON" : "OFF");
}

async function handleStartCapture(streamId: string): Promise<void> {
  if (mediaStreamSource) {
    mediaStreamSource.disconnect();
    mediaStreamSource = null;
  }
  if (activeStream) {
    activeStream.getTracks().forEach((t) => t.stop());
    activeStream = null;
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: "tab",
        chromeMediaSourceId: streamId,
      },
    },
  } as MediaStreamConstraints);

  activeStream = stream;
  mediaStreamSource = ctx.createMediaStreamSource(stream);
  connectSource();
  console.log("[offscreen] Tab capture connected");

  if (pendingConnect && engineReady) {
    pendingConnect = false;
    const pitchScale = 2 ** (currentSemitones / 12);
    setPitchScale(pitchScale);
    if (rbNode) rbNode.port.postMessage({ type: "SET_PITCH", pitchScale });
    console.log("[offscreen] Pending pitch applied:", currentSemitones, "semitones");
  }
}

main();
