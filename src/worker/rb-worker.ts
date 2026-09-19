/**
 * Rubber Band WASM Worker — LiveShifter for offline file export
 *
 * Handles INIT → PROCESS → DELETE lifecycle.
 * All buffers are owned by the shared LiveShifter implementation.
 */

import {
  loadRubberBandWasm,
  RubberBandLiveShifter,
  RUBBERBAND_WORKER_OPTIONS,
} from "../lib/dsp/rubberband-live-shifter";

interface InitMsg {
  type: "INIT";
  sampleRate: number;
  channels: number;
  pitchScale: number;
  preserveFormants?: boolean;
}

interface ProcessMsg {
  type: "PROCESS";
  channels: Float32Array[];
}

interface SetPitchMsg {
  type: "SET_PITCH";
  pitchScale: number;
}

interface DeleteMsg {
  type: "DELETE";
}

type WorkerMsg = InitMsg | ProcessMsg | SetPitchMsg | DeleteMsg;

let liveShifter: RubberBandLiveShifter | null = null;

async function loadWasm(): Promise<void> {
  const exports = await loadRubberBandWasm();
  if (!exports) {
    self.postMessage({ type: "WASM_ERROR", error: "Failed to load RubberBand WASM" });
    return;
  }
  liveShifter = new RubberBandLiveShifter(exports, RUBBERBAND_WORKER_OPTIONS);
  self.postMessage({ type: "WASM_READY" });
}

function handleInit(
  sampleRate: number,
  channels: number,
  pitchScale: number,
  preserveFormants = false,
): void {
  if (!liveShifter) {
    self.postMessage({ type: "INIT_ERROR", error: "LiveShifter is not loaded" });
    return;
  }

  try {
    const initialized = liveShifter.init(sampleRate, channels, pitchScale, preserveFormants);
    if (!initialized) {
      self.postMessage({ type: "INIT_ERROR", error: "Failed to create LiveShifter" });
      return;
    }
    self.postMessage({
      type: "INIT_OK",
      blockSize: initialized.blockSize,
      startDelay: initialized.startDelay,
      channels: initialized.channels,
      sampleRate: initialized.sampleRate,
    });
  } catch (error) {
    self.postMessage({
      type: "INIT_ERROR",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function handleProcess(channelsData: Float32Array[]): void {
  if (!liveShifter?.isInitialized) {
    self.postMessage({ type: "PROCESS_ERROR", error: "Not initialized" });
    return;
  }
  if (!channelsData.length) {
    self.postMessage({ type: "PROCESS_ERROR", error: "No input channels" });
    return;
  }

  const totalSamples = channelsData[0].length;
  const blockSize = liveShifter.currentBlockSize;
  const numBlocks = Math.ceil(totalSamples / blockSize);
  const output = Array.from({ length: liveShifter.currentChannels }, () =>
    new Float32Array(numBlocks * blockSize),
  );

  for (let blockIndex = 0; blockIndex < numBlocks; blockIndex++) {
    const offset = blockIndex * blockSize;
    const chunkLength = Math.min(blockSize, totalSamples - offset);
    const chunk = channelsData.map((channel) => channel.subarray(offset, offset + chunkLength));
    liveShifter.shift(
      chunk,
      output.map((channel) => channel.subarray(offset, offset + blockSize)),
    );
  }

  const outputLength = numBlocks * blockSize;
  const outputInterleaved = new Float32Array(outputLength * liveShifter.currentChannels);
  for (let sample = 0; sample < outputLength; sample++) {
    for (let channel = 0; channel < liveShifter.currentChannels; channel++) {
      outputInterleaved[sample * liveShifter.currentChannels + channel] = output[channel][sample];
    }
  }

  self.postMessage({ type: "PROCESS_OK", output: outputInterleaved });
}

function handleSetPitch(pitchScale: number): void {
  liveShifter?.setPitchScale(pitchScale);
}

function handleDelete(): void {
  liveShifter?.delete();
}

self.onmessage = (event: MessageEvent<WorkerMsg>) => {
  const message = event.data;
  switch (message.type) {
    case "INIT":
      handleInit(message.sampleRate, message.channels, message.pitchScale, message.preserveFormants);
      break;
    case "PROCESS":
      handleProcess(message.channels);
      break;
    case "SET_PITCH":
      handleSetPitch(message.pitchScale);
      break;
    case "DELETE":
      handleDelete();
      break;
  }
};

void loadWasm();
