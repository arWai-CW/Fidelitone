// Offscreen audio engine — RubberBand LiveShifter, Signalsmith Stretch, and
// multiband accompaniment processing.

import { createSignalsmithEngine, setSignalsmithPitch, setSignalsmithPitchWithFormants, type SignalsmithEngine } from "../lib/dsp/signalsmith-fallback";
import { postWorkletMessage } from "../lib/dsp/worklet-message";

type Engine = "rubberband" | "signalsmith";

interface EngineAvailability {
  signalsmith: boolean;
  rubberband: boolean;
}

interface CaptureState {
  ready: boolean;
  connected: boolean;
  pitch: number;
  bypass: boolean;
  preserveFormants: boolean;
  accompanimentMode: boolean;
  engine: Engine;
  selectedEngine: Engine;
  route: string;
  captureLost: boolean;
  engineAvailability: EngineAvailability;
}

let wasmExports: any = null;
let wasmLoaded = false;
let rubberbandModuleLoaded = false;
let passthroughModuleLoaded = false;
let state = 0;
let rbBlockSize = 512;
let rbChannels = 2;
let wasmF32: Float32Array = new Float32Array(0);

let inputChPtrs = 0;
let outputChPtrs = 0;
let inputBufs: number[] = [];
let outputBufs: number[] = [];

function refreshViews() {
  if (!wasmExports?.memory) return;
  wasmF32 = new Float32Array(wasmExports.memory.buffer);
}

async function loadWasm(): Promise<boolean> {
  try {
    const wasmUrl = new URL("../wasm/rubberband.wasm", import.meta.url);
    const { instance } = await WebAssembly.instantiateStreaming(fetch(wasmUrl), {
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
    });
    wasmExports = instance.exports;
    wasmLoaded = true;
    refreshViews();
    console.log("[offscreen] WASM loaded");
    return true;
  } catch (err) {
    console.error("[offscreen] WASM load failed:", err);
    wasmLoaded = false;
    return false;
  }
}

function initLiveShifter(sampleRate: number, ch: number, pitchScale: number) {
  if (!wasmExports?.rb_live_new) return null;

  try {
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
      const inputPtr = wasmExports.wasm_malloc(chBufBytes);
      const outputPtr = wasmExports.wasm_malloc(chBufBytes);
      if (!inputPtr || !outputPtr) throw new Error("RubberBand WASM buffer allocation failed");
      inputBufs.push(inputPtr);
      outputBufs.push(outputPtr);
    }
    inputChPtrs = wasmExports.wasm_malloc(rbChannels * 4);
    outputChPtrs = wasmExports.wasm_malloc(rbChannels * 4);
    if (!inputChPtrs || !outputChPtrs) throw new Error("RubberBand WASM pointer allocation failed");

    refreshViews();
    const iu32 = new Uint32Array(wasmExports.memory.buffer);
    for (let i = 0; i < rbChannels; i++) {
      iu32[(inputChPtrs >> 2) + i] = inputBufs[i];
      iu32[(outputChPtrs >> 2) + i] = outputBufs[i];
    }

    return { blockSize: rbBlockSize, startDelay };
  } catch (err) {
    console.error("[offscreen] LiveShifter initialization failed:", err);
    deleteLiveShifter();
    return null;
  }
}

function setPitchScale(pitchScale: number) {
  if (state !== 0 && wasmExports?.rb_live_set_pitch_scale) {
    wasmExports.rb_live_set_pitch_scale(state, pitchScale);
  }
}

function setFormantOption(preserve: boolean) {
  if (state === 0) {
    console.warn("[offscreen] setFormantOption: state is 0, skipping");
    return;
  }
  const option = preserve ? OPTION_FORMANT_PRESERVED : OPTION_FORMANT_SHIFTED;
  console.log("[offscreen] setFormantOption: preserve=", preserve, "option=0x" + option.toString(16), "rb_live_set_formant_option exists:", !!wasmExports?.rb_live_set_formant_option);
  if (wasmExports?.rb_live_set_formant_option) {
    wasmExports.rb_live_set_formant_option(state, option);
    console.log("[offscreen] setFormantOption: called successfully");
  } else {
    console.warn("[offscreen] setFormantOption: WASM function not available");
  }
}

function shiftBlock(channels: Float32Array[], outputChannels: Float32Array[]) {
  if (!wasmExports || state === 0 || inputBufs.length < rbChannels || outputBufs.length < rbChannels) return;
  refreshViews();
  for (let ch = 0; ch < rbChannels; ch++) {
    const base = inputBufs[ch] >> 2;
    const input = channels[ch];
    for (let i = 0; i < rbBlockSize; i++) wasmF32[base + i] = input?.[i] ?? 0;
  }
  wasmExports.rb_live_shift(state, inputChPtrs, outputChPtrs);
  refreshViews();
  for (let ch = 0; ch < rbChannels; ch++) {
    const base = outputBufs[ch] >> 2;
    for (let i = 0; i < rbBlockSize; i++) outputChannels[ch][i] = wasmF32[base + i];
  }
}

function deleteLiveShifter() {
  if (state !== 0 && wasmExports?.rb_live_delete) {
    wasmExports.rb_live_delete(state);
    state = 0;
  }
  for (const ptr of [...inputBufs, ...outputBufs, inputChPtrs, outputChPtrs]) {
    if (ptr !== 0 && wasmExports?.wasm_free) wasmExports.wasm_free(ptr);
  }
  inputBufs = [];
  outputBufs = [];
  inputChPtrs = 0;
  outputChPtrs = 0;
  rbBlockSize = 512;
}

let ctx: AudioContext | null = null;
let passthrough: AudioWorkletNode | null = null;
let rbNode: AudioWorkletNode | null = null;
let mediaStreamSource: MediaStreamAudioSourceNode | null = null;
let activeStream: MediaStream | null = null;
let currentSemitones = 0;
let isBypass = false;
let engineReady = false;
let graphReady = false;
let preserveFormants = false;
let pendingConnect = false;
let captureLost = false;

const OPTION_FORMANT_SHIFTED = 0x00000000;
const OPTION_FORMANT_PRESERVED = 0x01000000;

let activeEngine: "rubberband" | "signalsmith" = "rubberband";
let signalsmithNode: AudioWorkletNode | null = null;
let signalsmithReady = false;
let signalsmithInitPromise: Promise<boolean> | null = null;
let gainA: GainNode | null = null;
let gainB: GainNode | null = null;
const CROSSFADE_SEC = 0.05;
// AudioWorklet startup can stall briefly while RubberBand or Signalsmith is active.
const WORKLET_INIT_TIMEOUT_MS = 10000;
const WORKLET_INIT_RETRIES = 1;
const WORKLET_INIT_RETRY_DELAY_MS = 250;

// Accompaniment mode (multiband processing)
let isAccompanimentMode = false;
let crossoverNode: AudioWorkletNode | null = null;
let lowbandResamplerNode: AudioWorkletNode | null = null;
let limiterNode: DynamicsCompressorNode | null = null;
let accompanimentDelay: DelayNode | null = null;
let accompanimentMixBus: GainNode | null = null;
let crossoverReady = false;
const CROSSOVER_FREQ = 175;
const ACCOMPANIMENT_ALIGN_DELAY_S = 0.09;

let graphInitializationPromise: Promise<void> | null = null;
let graphGeneration = 0;
let transitionQueue: Promise<void> = Promise.resolve();

function currentPitchScale(): number {
  return 2 ** (currentSemitones / 12);
}

function requireCtx(): AudioContext {
  if (!ctx) throw new Error("Audio graph is not ready");
  return ctx;
}

function requirePassthrough(): AudioWorkletNode {
  if (!passthrough) throw new Error("Passthrough worklet is not ready");
  return passthrough;
}

function runTransition<T>(operation: () => Promise<T>): Promise<T> {
  const result = transitionQueue.then(operation, operation);
  transitionQueue = result.then(() => undefined, () => undefined);
  return result;
}

function stopStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => track.stop());
}

function handleCaptureEnded(stream: MediaStream): void {
  if (activeStream !== stream) return;
  captureLost = true;
  mediaStreamSource?.disconnect();
  mediaStreamSource = null;
  stopStream(activeStream);
  activeStream = null;
  pendingConnect = false;
  void runTransition(() => teardownGraph()).catch((err) => {
    console.error("[offscreen] Capture-ended teardown failed:", err);
  });
}

function disconnectNode(node: AudioNode | null | undefined): void {
  if (!node) return;
  try {
    node.disconnect();
  } catch {
    // A node may already be disconnected during graph teardown.
  }
}

function resetGain(gain: GainNode | null, value: number): void {
  if (!gain || !ctx) return;
  gain.gain.cancelScheduledValues(ctx.currentTime);
  gain.gain.setValueAtTime(value, ctx.currentTime);
}

function effectiveEngine(): "rubberband" | "signalsmith" {
  if (activeEngine === "signalsmith" && signalsmithReady && signalsmithNode) {
    return "signalsmith";
  }
  if (activeEngine === "rubberband" && engineReady && rbNode) {
    return "rubberband";
  }
  if (signalsmithReady && signalsmithNode) return "signalsmith";
  if (engineReady && rbNode) return "rubberband";
  return activeEngine;
}

function setEngineGains(engine: "rubberband" | "signalsmith"): void {
  resetGain(gainA, engine === "signalsmith" ? 1 : 0);
  resetGain(gainB, engine === "rubberband" ? 1 : 0);
}

function crossfade(from: "rubberband" | "signalsmith", to: "rubberband" | "signalsmith"): void {
  if (!gainA || !gainB || !ctx || from === to) return;
  const outGain = from === "rubberband" ? gainB : gainA;
  const inGain = to === "rubberband" ? gainB : gainA;
  const now = ctx.currentTime;

  outGain.gain.cancelScheduledValues(now);
  outGain.gain.setValueAtTime(outGain.gain.value, now);
  outGain.gain.linearRampToValueAtTime(0, now + CROSSFADE_SEC);
  inGain.gain.cancelScheduledValues(now);
  inGain.gain.setValueAtTime(inGain.gain.value, now);
  inGain.gain.linearRampToValueAtTime(1, now + CROSSFADE_SEC);

  const elapsed = performance.now() / 1000;
  console.log(`[A/B] Switched from ${from} to ${to} at T+${elapsed.toFixed(3)}s`);
}

async function resetWorklet(node: AudioWorkletNode | null, timeoutMs = 750): Promise<void> {
  if (!node) return;
  try {
    await postWorkletMessage(node, { type: "RESET" }, "RESET_OK", {
      label: "audio worklet",
      timeoutMs,
    });
  } catch (err) {
    console.warn("[offscreen] Worklet reset acknowledgement failed:", err);
  }
}

async function ensureGraphReady(): Promise<void> {
  if (graphReady) return;

  let initialization = graphInitializationPromise;
  if (!initialization) {
    initialization = initializeGraph().catch((err) => {
      graphReady = false;
      throw err;
    });
    graphInitializationPromise = initialization;
  }

  try {
    await initialization;
  } finally {
    if (graphInitializationPromise === initialization) {
      graphInitializationPromise = null;
    }
  }
}

async function initializeGraph(): Promise<void> {
  const generation = ++graphGeneration;
  try {
    if (!ctx) ctx = new AudioContext();
    if (ctx.state === "suspended") await ctx.resume();
    console.log("[offscreen] AudioContext created, sampleRate:", ctx.sampleRate);

    const wasmOk = await loadWasm();

    if (!rubberbandModuleLoaded) {
      await ctx.audioWorklet.addModule(chrome.runtime.getURL("processors/rubberband-processor.js"));
      rubberbandModuleLoaded = true;
    }
    if (!passthroughModuleLoaded) {
      await ctx.audioWorklet.addModule(chrome.runtime.getURL("processors/passthrough-processor.js"));
      passthroughModuleLoaded = true;
    }

    passthrough = new AudioWorkletNode(ctx, "passthrough");

    gainA = ctx.createGain();
    gainB = ctx.createGain();
    setEngineGains(effectiveEngine());

    if (wasmOk) {
      const rbInit = initLiveShifter(ctx.sampleRate, 2, currentPitchScale());
      if (rbInit) {
        rbBlockSize = rbInit.blockSize;
        const node = new AudioWorkletNode(ctx, "rubberband", {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          channelCount: 2,
          channelCountMode: "explicit",
          outputChannelCount: [2],
        });
        rbNode = node;
        node.port.onmessage = (e: MessageEvent) => {
          const msg = e.data;
          if (msg.type === "PROCESS") {
            if (state === 0) return;
            const channels: Float32Array[] = msg.channels;
            if (!channels || channels.length !== rbChannels) return;
            const outChannels: Float32Array[] = channels.map(() => new Float32Array(rbBlockSize));
            shiftBlock(channels, outChannels);
            node.port.postMessage({ type: "OUTPUT_READY", channels: outChannels });
          }
        };
        node.connect(gainB);
        await postWorkletMessage(node, { type: "INIT", blockSize: rbBlockSize, channels: rbChannels }, "INIT_OK", {
          label: "rubberband",
          timeoutMs: 3000,
        });
        engineReady = true;
        setEngineGains(effectiveEngine());
        console.log("[offscreen] RubberBand ready, blockSize:", rbBlockSize, "startDelay:", rbInit.startDelay);
      } else {
        console.warn("[offscreen] LiveShifter initialization failed; passthrough fallback enabled");
      }
    } else {
      console.warn("[offscreen] WASM not loaded, passthrough only");
    }

    if (generation !== graphGeneration) throw new Error("Graph initialization was superseded");
    graphReady = true;
    console.log("[offscreen] Audio graph ready");
  } catch (err) {
    await teardownGraph();
    throw err;
  }
}

async function initSignalsmith(): Promise<boolean> {
  if (signalsmithReady && signalsmithNode) return true;
  if (signalsmithInitPromise) return signalsmithInitPromise;

  signalsmithInitPromise = (async () => {
    const previousNode = signalsmithNode;
    try {
      await ensureGraphReady();
      const engine = await createSignalsmithEngine(requireCtx(), currentSemitones);
      if (!engine?.node) return false;
      signalsmithNode = engine.node as unknown as AudioWorkletNode;
      signalsmithReady = true;
      console.log("[A/B] Signalsmith engine initialized");

      // Apply current pitch and formant settings to the newly initialized engine
      await setSignalsmithPitchWithFormants(
        { node: signalsmithNode as unknown as SignalsmithEngine["node"], ready: true },
        currentSemitones,
        preserveFormants,
        requireCtx(),
      ).catch((err) => console.error("[offscreen] Signalsmith initial pitch/formant update failed:", err));

      return true;
    } catch (err) {
      console.error("[A/B] Signalsmith init failed:", err);
      if (signalsmithNode && signalsmithNode !== previousNode) disconnectNode(signalsmithNode);
      signalsmithNode = previousNode;
      signalsmithReady = !!previousNode;
      return false;
    } finally {
      signalsmithInitPromise = null;
    }
  })();

  return signalsmithInitPromise;
}

let accompanimentInitPromise: Promise<boolean> | null = null;
let crossoverModuleLoaded = false;
let resamplerModuleLoaded = false;

function resetAccompanimentNodes(): void {
  disconnectNode(crossoverNode);
  disconnectNode(lowbandResamplerNode);
  disconnectNode(limiterNode);
  disconnectNode(accompanimentDelay);
  disconnectNode(accompanimentMixBus);

  crossoverNode = null;
  lowbandResamplerNode = null;
  limiterNode = null;
  accompanimentDelay = null;
  accompanimentMixBus = null;
  crossoverReady = false;
}

async function applyPitchToAccompanimentNodes(
  lowband: AudioWorkletNode,
  signalsmith: AudioWorkletNode,
): Promise<void> {
  lowband.port.postMessage({ type: "SET_PITCH", pitchScale: currentPitchScale() });
  await setSignalsmithPitch(
    { node: signalsmith as unknown as SignalsmithEngine["node"], ready: true },
    currentSemitones,
    requireCtx(),
  );
}

async function initAccompanimentMode(): Promise<boolean> {
  if (crossoverReady && lowbandResamplerNode && limiterNode && signalsmithReady && signalsmithNode) {
    return true;
  }
  if (accompanimentInitPromise) return accompanimentInitPromise;

  const ownsSignalsmith = !signalsmithReady;
  accompanimentInitPromise = (async () => {
    let newCrossover: AudioWorkletNode | null = null;
    let newLowbandResampler: AudioWorkletNode | null = null;
    let newLimiter: DynamicsCompressorNode | null = null;
    let newDelay: DelayNode | null = null;
    let newMixBus: GainNode | null = null;

    try {
      await ensureGraphReady();

      if (!crossoverModuleLoaded) {
        await requireCtx().audioWorklet.addModule(chrome.runtime.getURL("processors/crossover-processor.js"));
        crossoverModuleLoaded = true;
      }
      if (!resamplerModuleLoaded) {
        await requireCtx().audioWorklet.addModule(chrome.runtime.getURL("processors/lowband-resampler.js"));
        resamplerModuleLoaded = true;
      }

      newCrossover = new AudioWorkletNode(requireCtx(), "crossover", {
        numberOfInputs: 1,
        numberOfOutputs: 2,
        channelCount: 2,
        channelCountMode: "explicit",
        outputChannelCount: [2, 2],
      });
      newLowbandResampler = new AudioWorkletNode(requireCtx(), "lowband-resampler", {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        channelCount: 2,
        channelCountMode: "explicit",
        outputChannelCount: [2],
      });
      newLimiter = requireCtx().createDynamicsCompressor();
      newLimiter.threshold.value = -3;
      newLimiter.knee.value = 4;
      newLimiter.ratio.value = 8;
      newLimiter.attack.value = 0.003;
      newLimiter.release.value = 0.25;
      newDelay = requireCtx().createDelay(ACCOMPANIMENT_ALIGN_DELAY_S);
      newDelay.delayTime.value = ACCOMPANIMENT_ALIGN_DELAY_S;
      newMixBus = requireCtx().createGain();

      await postWorkletMessage(newCrossover, {
        type: "INIT",
        crossoverFreq: CROSSOVER_FREQ,
        channels: 2,
      }, "INIT_OK", {
        label: "crossover",
        retries: WORKLET_INIT_RETRIES,
        retryDelayMs: WORKLET_INIT_RETRY_DELAY_MS,
        timeoutMs: WORKLET_INIT_TIMEOUT_MS,
      });
      await postWorkletMessage(newLowbandResampler, {
        type: "INIT",
        channels: 2,
        pitchScale: currentPitchScale(),
        sampleRate: requireCtx().sampleRate,
      }, "INIT_OK", {
        label: "lowband-resampler",
        retries: WORKLET_INIT_RETRIES,
        retryDelayMs: WORKLET_INIT_RETRY_DELAY_MS,
        timeoutMs: WORKLET_INIT_TIMEOUT_MS,
      });

      if (!(await initSignalsmith()) || !signalsmithNode) {
        throw new Error("Signalsmith Stretch could not be initialized");
      }
      await applyPitchToAccompanimentNodes(newLowbandResampler, signalsmithNode);

      crossoverNode = newCrossover;
      lowbandResamplerNode = newLowbandResampler;
      limiterNode = newLimiter;
      accompanimentDelay = newDelay;
      accompanimentMixBus = newMixBus;
      crossoverReady = true;
      console.log("[offscreen] Accompaniment mode initialized");
      return true;
    } catch (err) {
      console.error("[offscreen] Accompaniment mode init failed:", err);
      disconnectNode(newCrossover);
      disconnectNode(newLowbandResampler);
      disconnectNode(newLimiter);
      disconnectNode(newDelay);
      disconnectNode(newMixBus);
      if (ownsSignalsmith && signalsmithNode) {
        disconnectNode(signalsmithNode);
        signalsmithNode = null;
        signalsmithReady = false;
      }
      resetAccompanimentNodes();
      return false;
    } finally {
      accompanimentInitPromise = null;
    }
  })();

  return accompanimentInitPromise;
}

function applyAccompanimentPitch(): void {
  lowbandResamplerNode?.port.postMessage({ type: "SET_PITCH", pitchScale: currentPitchScale() });
  if (signalsmithReady && signalsmithNode) {
    void setSignalsmithPitch(
      { node: signalsmithNode as unknown as SignalsmithEngine["node"], ready: true },
      currentSemitones,
      requireCtx(),
    ).catch((err) => console.error("[offscreen] Signalsmith pitch update failed:", err));
  }
}

function rewireGraph(resetGains = true): void {
  mediaStreamSource?.disconnect();
  rbNode?.disconnect();
  crossoverNode?.disconnect();
  lowbandResamplerNode?.disconnect();
  signalsmithNode?.disconnect();
  passthrough?.disconnect();
  gainA?.disconnect();
  gainB?.disconnect();
  accompanimentDelay?.disconnect();
  accompanimentMixBus?.disconnect();
  limiterNode?.disconnect();

  if (resetGains) {
    setEngineGains(effectiveEngine());
  }
  // Keep the accompaniment node references owned by initAccompanimentMode();
  // resetAccompanimentNodes() is the only path that releases them.
}

function connectSourceAccompaniment(): boolean {
  if (!mediaStreamSource || !crossoverNode || !lowbandResamplerNode || !limiterNode || !signalsmithNode || !accompanimentDelay || !accompanimentMixBus) {
    console.log("[offscreen] connectSourceAccompaniment: skipped - missing nodes");
    return false;
  }

  rewireGraph();
  if (isBypass) {
    requirePassthrough().connect(requireCtx().destination);
    mediaStreamSource.connect(requirePassthrough());
    console.log("[offscreen] Source → passthrough (bypass)");
    return true;
  }

  mediaStreamSource.connect(crossoverNode);
  crossoverNode.connect(lowbandResamplerNode, 0);
  lowbandResamplerNode.connect(accompanimentDelay);
  accompanimentDelay.connect(accompanimentMixBus);

  crossoverNode.connect(signalsmithNode, 1);
  signalsmithNode.connect(accompanimentMixBus);
  accompanimentMixBus.connect(limiterNode);
  limiterNode.connect(requireCtx().destination);

  console.log("[offscreen] Source → stereo sum (crossover → lowband resampler + Signalsmith → mixBus → limiter)");
  return true;
}

function connectSource(preserveGains = false): boolean {
  if (!mediaStreamSource || !graphReady) {
    console.log("[offscreen] connectSource: skipped - mediaStreamSource:", !!mediaStreamSource, "graphReady:", graphReady);
    return false;
  }

  if (isBypass) {
    rewireGraph();
    requirePassthrough().connect(requireCtx().destination);
    mediaStreamSource.connect(requirePassthrough());
    console.log("[offscreen] Source → passthrough (bypass)");
    return true;
  }

  if (isAccompanimentMode && crossoverReady) {
    return connectSourceAccompaniment();
  }

  rewireGraph(!preserveGains);
  let connected = false;
  if (rbNode && engineReady && gainB) {
    rbNode.connect(gainB);
    gainB.connect(requireCtx().destination);
    mediaStreamSource.connect(rbNode);
    connected = true;
    console.log("[offscreen] Source → rbNode → gainB → destination (RubberBand)");
  }
  if (signalsmithNode && signalsmithReady && gainA) {
    signalsmithNode.connect(gainA);
    gainA.connect(requireCtx().destination);
    mediaStreamSource.connect(signalsmithNode);
    connected = true;
    console.log("[offscreen] Source → signalsmithNode → gainA → destination (Signalsmith)");
  }
  if (!connected) {
    requirePassthrough().connect(requireCtx().destination);
    mediaStreamSource.connect(requirePassthrough());
    console.log("[offscreen] Source → passthrough (fallback)");
  } else {
    console.log("[offscreen] Source → engines (active:", effectiveEngine(), ")");
  }
  return true;
}

function getCaptureState(): CaptureState {
  const engine = effectiveEngine();
  const route = isBypass
    ? "bypass"
    : isAccompanimentMode && crossoverReady
      ? "accompaniment"
      : engine;
  return {
    ready: graphReady,
    connected: !!mediaStreamSource,
    pitch: currentSemitones,
    bypass: isBypass,
    preserveFormants,
    accompanimentMode: isAccompanimentMode,
    engine,
    selectedEngine: activeEngine,
    route,
    captureLost,
    engineAvailability: {
      signalsmith: signalsmithReady && !!signalsmithNode,
      rubberband: engineReady && !!rbNode,
    },
  };
}

async function handleStartCapture(streamId: string): Promise<void> {
  await ensureGraphReady();
  const oldSource = mediaStreamSource;
  const oldStream = activeStream;
  const modeBefore = isAccompanimentMode;

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: "tab",
        chromeMediaSourceId: streamId,
      },
    },
  } as MediaStreamConstraints);
  stream.getTracks().forEach((track) => {
    track.addEventListener("ended", () => handleCaptureEnded(stream));
  });

  let replacementSource: MediaStreamAudioSourceNode | null = null;
  try {
    replacementSource = requireCtx().createMediaStreamSource(stream);
    if (modeBefore && !(await initAccompanimentMode())) {
      isAccompanimentMode = false;
      resetAccompanimentNodes();
      throw new Error("Accompaniment mode initialization failed");
    }

    mediaStreamSource = replacementSource;
    activeStream = stream;
    captureLost = false;
    if (!connectSource()) throw new Error("Unable to connect replacement capture");

    oldSource?.disconnect();
    stopStream(oldStream);
    pendingConnect = false;
    applyCurrentPitch();
    console.log("[offscreen] Tab capture connected");
  } catch (err) {
    replacementSource?.disconnect();
    stopStream(stream);
    mediaStreamSource = oldSource;
    activeStream = oldStream;
    captureLost = false;
    if (modeBefore && !crossoverReady) {
      isAccompanimentMode = false;
      resetAccompanimentNodes();
    }
    if (oldSource && graphReady) connectSource();
    throw err;
  }
}

async function handleStopCapture(): Promise<void> {
  mediaStreamSource?.disconnect();
  mediaStreamSource = null;
  stopStream(activeStream);
  activeStream = null;
  pendingConnect = false;
  captureLost = false;
  await teardownGraph();
  console.log("[offscreen] Tab capture disconnected");
}

function applyCurrentPitch(): void {
  const pitchScale = currentPitchScale();
  if (rbNode && engineReady) {
    setPitchScale(pitchScale);
    rbNode.port.postMessage({ type: "SET_PITCH", pitchScale });
  }
  if (lowbandResamplerNode) {
    lowbandResamplerNode.port.postMessage({ type: "SET_PITCH", pitchScale });
  }
  if (signalsmithReady && signalsmithNode) {
    void setSignalsmithPitchWithFormants(
      { node: signalsmithNode as unknown as SignalsmithEngine["node"], ready: true },
      currentSemitones,
      preserveFormants,
      requireCtx(),
    ).catch((err) => console.error("[offscreen] Signalsmith pitch update failed:", err));
  }
}

async function handleSetPitch(value: { semitones: number }): Promise<boolean> {
  const semitones = value?.semitones;
  if (!Number.isFinite(semitones)) return false;

  currentSemitones = semitones;
  applyCurrentPitch();
  if (!mediaStreamSource) {
    pendingConnect = true;
    console.log("[offscreen] Pitch queued (waiting for capture)");
  }
  console.log("[offscreen] Pitch →", currentSemitones, "semitones");
  return true;
}

async function handleSetBypass(value: { active: boolean }): Promise<boolean> {
  if (typeof value?.active !== "boolean") return false;

  const previous = isBypass;
  isBypass = value.active;
  if (mediaStreamSource && graphReady) {
    try {
      if (!connectSource()) throw new Error("Unable to apply bypass routing");
    } catch (err) {
      isBypass = previous;
      if (mediaStreamSource && graphReady) connectSource();
      throw err;
    }
  }

  applyCurrentPitch();
  console.log("[offscreen] Bypass →", isBypass ? "ON" : "OFF");
  return true;
}

async function handleSetFormants(value: { preserve: boolean }): Promise<boolean> {
  if (typeof value?.preserve !== "boolean") return false;
  preserveFormants = value.preserve;
  setFormantOption(preserveFormants);

  // Also update Signalsmith if it's initialized (regardless of whether it's currently active)
  // This ensures the setting persists when user later switches to Signalsmith
  if (signalsmithReady && signalsmithNode) {
    void setSignalsmithPitchWithFormants(
      { node: signalsmithNode as unknown as SignalsmithEngine["node"], ready: true },
      currentSemitones,
      preserveFormants,
      requireCtx(),
    ).catch((err) => console.error("[offscreen] Signalsmith formant update failed:", err));
  }

  console.log("[offscreen] Formant preservation →", preserveFormants ? "ON" : "OFF");
  return true;
}

async function handleSetAccompaniment(value: { enabled: boolean }): Promise<boolean> {
  if (typeof value?.enabled !== "boolean") return false;

  if (value.enabled) {
    if (!(await initAccompanimentMode())) {
      isAccompanimentMode = false;
      resetAccompanimentNodes();
      if (mediaStreamSource && graphReady) connectSource();
      return false;
    }

    const previous = isAccompanimentMode;
    isAccompanimentMode = true;
    if (mediaStreamSource && graphReady && !connectSource()) {
      isAccompanimentMode = previous;
      resetAccompanimentNodes();
      if (mediaStreamSource && graphReady) connectSource();
      return false;
    }
  } else {
    const previous = isAccompanimentMode;
    isAccompanimentMode = false;
    resetAccompanimentNodes();
    if (mediaStreamSource && graphReady && !connectSource()) {
      isAccompanimentMode = previous;
      if (mediaStreamSource && graphReady) connectSource();
      return false;
    }
  }

  console.log("[offscreen] Accompaniment mode →", isAccompanimentMode ? "ON" : "OFF");
  return true;
}

async function handleSetEngine(engine: "rubberband" | "signalsmith"): Promise<boolean> {
  await ensureGraphReady();
  let available = engine === "rubberband" ? engineReady && !!rbNode : signalsmithReady && !!signalsmithNode;
  if (!available && engine === "signalsmith") {
    await initSignalsmith();
    available = signalsmithReady && !!signalsmithNode;
  }
  if (!available) return false;

  const previousEngine = activeEngine;
  if (previousEngine === engine) {
    if (mediaStreamSource && graphReady && !isBypass && !isAccompanimentMode && !connectSource(true)) {
      return false;
    }
    return true;
  }

  activeEngine = engine;
  if (mediaStreamSource && graphReady && !isBypass && !isAccompanimentMode) {
    if (!connectSource(true)) {
      activeEngine = previousEngine;
      setEngineGains(previousEngine);
      if (mediaStreamSource && graphReady) connectSource();
      return false;
    }
    crossfade(previousEngine, engine);
    
    // Apply current pitch and formant settings to the newly activated engine
    applyCurrentPitch();
  } else {
    setEngineGains(engine);
  }

  console.log("[offscreen] Engine →", engine);
  return true;
}

async function teardownGraph(): Promise<void> {
  graphGeneration += 1;
  mediaStreamSource?.disconnect();
  mediaStreamSource = null;
  stopStream(activeStream);
  activeStream = null;

  await resetWorklet(rbNode);
  await resetWorklet(crossoverNode);
  await resetWorklet(lowbandResamplerNode);

  rewireGraph();
  disconnectNode(passthrough);
  disconnectNode(rbNode);
  disconnectNode(signalsmithNode);
  deleteLiveShifter();

  passthrough = null;
  rbNode = null;
  signalsmithNode = null;
  signalsmithReady = false;
  signalsmithInitPromise = null;
  resetAccompanimentNodes();
  gainA = null;
  gainB = null;
  engineReady = false;
  graphReady = false;
  graphInitializationPromise = null;
  pendingConnect = false;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "SET_PITCH") {
    runTransition(() => handleSetPitch(msg.value))
      .then((ok) => sendResponse({ ok }))
      .catch((err) => sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }));
    return true;
  }
  if (msg.type === "SET_BYPASS") {
    runTransition(() => handleSetBypass(msg.value))
      .then((ok) => sendResponse({ ok }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }
  if (msg.type === "SET_FORMANTS") {
    runTransition(() => handleSetFormants(msg.value))
      .then((ok) => sendResponse({ ok }))
      .catch((err) => sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }));
    return true;
  }
  if (msg.type === "SET_ENGINE") {
    runTransition(() => handleSetEngine(msg.engine))
      .then((ok) => sendResponse({ ok }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }
  if (msg.type === "SET_ACCOMPANIMENT") {
    runTransition(() => handleSetAccompaniment(msg.value))
      .then((ok) => sendResponse({ ok }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }
  if (msg.type === "START_CAPTURE") {
    runTransition(() => handleStartCapture(msg.streamId))
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: err.message ?? String(err) }));
    return true;
  }
  if (msg.type === "STOP_CAPTURE") {
    runTransition(() => handleStopCapture())
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: err.message ?? String(err) }));
    return true;
  }
  if (msg.type === "GET_STATE") {
    sendResponse({ ok: true, ready: graphReady, state: getCaptureState() });
    return false;
  }
  return false;
});

console.log("[offscreen] Message listener registered");
void ensureGraphReady().catch((err) => console.error("[offscreen] Initial graph setup failed:", err));
