#!/usr/bin/env node
/**
 * verify.mjs - Verify rubberband.wasm loads and exports work
 * Usage: node src/wasm/verify.mjs
 */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const wasmPath = join(__dirname, 'rubberband.wasm');

async function main() {
  try {
    const wasmBuffer = readFileSync(wasmPath);
    console.log(`Loaded WASM: ${wasmBuffer.length} bytes`);

    const { instance } = await WebAssembly.instantiate(wasmBuffer, {
      env: {
        emscripten_notify_memory_growth: () => {}
      },
      wasi_snapshot_preview1: {
        environ_get: () => 0,
        environ_sizes_get: () => 0,
        fd_seek: () => 0,
        fd_close: () => 0,
        fd_write: () => 0,
        fd_read: () => 0,
        clock_time_get: () => 0
      }
    });

    const { exports } = instance;

    // Check required exports exist
    const requiredExports = [
      'rb_live_new',
      'rb_live_delete',
      'rb_live_get_block_size',
      'rb_live_set_pitch_scale',
      'rb_live_shift',
      'rb_live_get_channel_count',
      'rb_live_get_start_delay',
      'wasm_malloc',
      'wasm_free',
      'memory'
    ];

    const missing = requiredExports.filter(name => !exports[name]);
    if (missing.length > 0) {
      console.error(`Missing exports: ${missing.join(', ')}`);
      process.exit(1);
    }

    console.log('All required exports found');

    // Test: create a live shifter instance
    // RubberBandLiveOptions: OptionWindowShort=0, OptionFormantShifted=0, OptionChannelsApart=0
    const sampleRate = 44100;
    const channels = 1;
    const options = 0; // DefaultOptions

    const state = exports.rb_live_new(sampleRate, channels, options);
    console.log(`Created live shifter: state=${state}`);

    if (state === 0) {
      console.error('Failed to create live shifter (null state)');
      process.exit(1);
    }

    // Get block size - this should return a positive integer
    const blockSize = exports.rb_live_get_block_size(state);
    console.log(`Block size: ${blockSize}`);

    if (blockSize <= 0) {
      console.error(`Invalid block size: ${blockSize}`);
      process.exit(1);
    }

    // Get other info
    const channels2 = exports.rb_live_get_channel_count(state);
    const startDelay = exports.rb_live_get_start_delay(state);
    console.log(`Channels: ${channels2}`);
    console.log(`Start delay: ${startDelay}`);

    // Cleanup
    exports.rb_live_delete(state);
    console.log('Cleanup complete');

    console.log('\n✅ Verification passed');
    process.exit(0);
  } catch (err) {
    console.error('Verification failed:', err);
    process.exit(1);
  }
}

main();
