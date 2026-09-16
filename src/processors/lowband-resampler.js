/**
 * lowband-resampler - Time-domain resampler for low-frequency band
 * 
 * Resamples audio by pitchScale ratio using cubic interpolation (Catmull-Rom spline).
 * Changes pitch without affecting tempo by adjusting playback rate.
 * 
 * Designed for low-frequency content (< 200Hz) to preserve transient punch
 * and avoid Phase Vocoder artifacts.
 * 
 * Message protocol:
 *   INIT { channels, pitchScale } → INIT_OK
 *   SET_PITCH { pitchScale } → SET_PITCH_OK
 */

class LowbandResampler extends AudioWorkletProcessor {
  constructor() {
    super();
    
    // State
    this._initialized = false;
    this._channels = 0;
    this._pitchScale = 1.0;
    
    // Fractional sample position for phase continuity across blocks
    this._fractionalOffset = 0.0;
    
    // Pre-allocated buffers (set in INIT)
    this._inputBuffers = null;
    this._outputBuffers = null;
    this._maxOutputLength = 0;
    
    // Message handler
    this.port.onmessage = (e) => this._handleMessage(e.data);
  }
  
  _handleMessage(data) {
    const { type } = data;
    
    if (type === 'INIT') {
      const { channels, pitchScale } = data;
      
      this._channels = channels || 2;
      this._pitchScale = pitchScale || 1.0;
      this._fractionalOffset = 0.0;
      
      // Pre-allocate buffers for max possible output size
      // Max output = inputFrames * maxPitchScale (assume up to 4x for safety)
      this._maxOutputLength = Math.ceil(128 * 4) + 4; // +4 for interpolation padding
      
      this._inputBuffers = [];
      this._outputBuffers = [];
      for (let ch = 0; ch < this._channels; ch++) {
        // Input buffer with padding for interpolation at boundaries
        this._inputBuffers[ch] = new Float32Array(128 + 4);
        this._outputBuffers[ch] = new Float32Array(this._maxOutputLength);
      }
      
      this._initialized = true;
      this.port.postMessage({ type: 'INIT_OK' });
      
    } else if (type === 'SET_PITCH') {
      const { pitchScale } = data;
      this._pitchScale = pitchScale || 1.0;
      this.port.postMessage({ type: 'SET_PITCH_OK' });
    }
  }
  
  process(inputs, outputs, parameters) {
    if (!this._initialized || !inputs.length || !inputs[0].length) {
      return true;
    }
    
    const input = inputs[0];
    const output = outputs[0];
    const inputFrames = input[0].length;
    const pitchScale = this._pitchScale;
    
    // Calculate output length based on pitchScale
    // pitchScale > 1 = upsample (longer output), pitchScale < 1 = downsample (shorter output)
    const outputFrames = Math.round(inputFrames * pitchScale);
    
    // Clamp to available output buffer size
    const actualOutputFrames = Math.min(outputFrames, this._maxOutputLength - 4);
    
    for (let ch = 0; ch < this._channels; ch++) {
      if (!input[ch] || !output[ch]) continue;
      
      // Copy input to pre-allocated buffer with padding for interpolation
      // Padding allows reading samples before start and after end
      const inputBuf = this._inputBuffers[ch];
      
      // Clear padding region
      inputBuf[0] = 0;
      inputBuf[1] = 0;
      inputBuf[2] = 0;
      inputBuf[3] = 0;
      
      // Copy actual input samples (offset by 2 for padding)
      for (let i = 0; i < inputFrames; i++) {
        inputBuf[i + 2] = input[ch][i];
      }
      
      // Add trailing padding (repeat last sample)
      const lastSample = input[inputFrames - 1];
      inputBuf[inputFrames + 2] = lastSample;
      inputBuf[inputFrames + 3] = lastSample;
      
      const outputBuf = this._outputBuffers[ch];
      
      // Resample using cubic interpolation
      for (let outIdx = 0; outIdx < actualOutputFrames; outIdx++) {
        // Calculate input position with fractional offset for phase continuity
        const inputPos = outIdx / pitchScale + this._fractionalOffset;
        
        // Integer and fractional parts
        const integerPos = Math.floor(inputPos);
        const fraction = inputPos - integerPos;
        
        // Sample indices (offset by 2 due to padding)
        const idx = integerPos + 2;
        
        // Catmull-Rom spline interpolation
        const p0 = inputBuf[idx - 1];
        const p1 = inputBuf[idx];
        const p2 = inputBuf[idx + 1];
        const p3 = inputBuf[idx + 2];
        
        const t2 = fraction * fraction;
        const t3 = t2 * fraction;
        
        outputBuf[outIdx] = 0.5 * (
          (2 * p1) +
          (-p0 + p2) * fraction +
          (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
          (-p0 + 3 * p1 - 3 * p2 + p3) * t3
        );
      }
      
      // Copy to actual output
      for (let i = 0; i < actualOutputFrames; i++) {
        output[ch][i] = outputBuf[i];
      }
      
      // Zero out remaining output samples if we didn't fill the whole buffer
      for (let i = actualOutputFrames; i < output[ch].length; i++) {
        output[ch][i] = 0;
      }
    }
    
    // Update fractional offset for next block
    // This maintains phase continuity across block boundaries
    this._fractionalOffset += inputFrames / pitchScale - actualOutputFrames;
    this._fractionalOffset = this._fractionalOffset % 1;
    if (this._fractionalOffset < 0) {
      this._fractionalOffset += 1;
    }
    
    return true;
  }
}

registerProcessor('lowband-resampler', LowbandResampler);
