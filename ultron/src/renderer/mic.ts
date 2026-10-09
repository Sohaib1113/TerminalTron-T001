/**
 * Offline microphone capture for environments where the Web Speech API can't
 * transcribe (the desktop app): records raw PCM with silence auto-stop and
 * encodes a 16 kHz mono WAV for the backend's Windows recogniser.
 */

const TARGET_RATE = 16000;

/** Linear-interpolate downsample of concatenated float chunks to 16-bit PCM. */
const downsampleToInt16 = (chunks: Float32Array[], srcRate: number): Int16Array => {
  const total = chunks.reduce((n, chunk) => n + chunk.length, 0);
  if (total === 0) {
    return new Int16Array(0);
  }
  const merged = new Float32Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }

  const ratio = srcRate / TARGET_RATE;
  const outLength = Math.max(1, Math.floor(total / ratio));
  const out = new Int16Array(outLength);
  // Anti-alias box filter: average every `ratio` source samples into one
  // output sample instead of point-sampling. Point-sampling 48 kHz mic audio
  // down to 16 kHz folds high-frequency hiss straight into the speech band
  // and measurably hurts recogniser accuracy.
  for (let i = 0; i < outLength; i += 1) {
    const start = Math.floor(i * ratio);
    const end = Math.min(total, Math.max(start + 1, Math.floor((i + 1) * ratio)));
    let sum = 0;
    for (let j = start; j < end; j += 1) {
      sum += merged[j];
    }
    const sample = sum / (end - start);
    const clamped = Math.max(-1, Math.min(1, sample));
    out[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
  }
  return out;
};

/** Minimal canonical 44-byte-header PCM WAV encoder. */
const encodeWav = (pcm: Int16Array, sampleRate: number): Uint8Array => {
  const dataBytes = pcm.length * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  const writeAscii = (start: number, value: string) => {
    for (let i = 0; i < value.length; i += 1) {
      view.setUint8(start + i, value.charCodeAt(i));
    }
  };

  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeAscii(36, 'data');
  view.setUint32(40, dataBytes, true);
  new Int16Array(buffer, 44, pcm.length).set(pcm);
  return new Uint8Array(buffer);
};

/** Encode recorded chunks as a 16 kHz mono 16-bit WAV. */
export const encodeWav16k = (chunks: Float32Array[], srcRate: number): Uint8Array =>
  encodeWav(downsampleToInt16(chunks, srcRate), TARGET_RATE);

export const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  const STEP = 0x8000;
  for (let i = 0; i < bytes.length; i += STEP) {
    binary += String.fromCharCode(...bytes.subarray(i, i + STEP));
  }
  return btoa(binary);
};

export interface PcmCapture {
  /** Finish the utterance and hand the audio to onComplete. */
  stop: () => void;
  /** Discard the audio silently (unmount / mode switch). */
  cancel: () => void;
}

export interface PcmCaptureCallbacks {
  /**
   * Invoked once with the recorded float chunks and whether any speech-level
   * energy was detected (lets callers skip pointless transcription).
   */
  onComplete: (chunks: Float32Array[], speechHeard: boolean) => void;
}

/**
 * Record `source` until ~2s of silence after speech, ~9s of pure silence, or
 * a 30s hard cap. The context/source are owned by the caller; this only
 * attaches a processing node and detaches it on completion.
 */
export const startPcmCapture = (
  ctx: AudioContext,
  source: MediaStreamAudioSourceNode,
  callbacks: PcmCaptureCallbacks,
): PcmCapture => {
  const processor = ctx.createScriptProcessor(4096, 1, 1);
  const chunks: Float32Array[] = [];
  const startedAt = Date.now();
  let speechHeard = false;
  let lastLoudAt = Date.now();
  let finished = false;

  const teardown = (notify: boolean) => {
    if (finished) {
      return;
    }
    finished = true;
    try {
      processor.disconnect();
    } catch {
      /* already detached */
    }
    processor.onaudioprocess = null;
    if (notify) {
      callbacks.onComplete(chunks, speechHeard);
    }
  };

  processor.onaudioprocess = (event) => {
    const input = event.inputBuffer.getChannelData(0);
    chunks.push(input.slice()); // copy — the buffer is reused by the runtime

    let sum = 0;
    for (let i = 0; i < input.length; i += 1) {
      sum += input[i] * input[i];
    }
    const now = Date.now();
    if (Math.sqrt(sum / input.length) > 0.035) {
      speechHeard = true;
      lastLoudAt = now;
    }

    if (speechHeard && now - lastLoudAt > 2000) {
      teardown(true); // settled: pause after speech → utterance done
    } else if (!speechHeard && now - startedAt > 9000) {
      teardown(true); // nothing heard — let the caller show a hint
    } else if (now - startedAt > 30000) {
      teardown(true); // hard cap
    }
  };

  source.connect(processor);
  // A ScriptProcessor must reach the destination to run; output stays silent
  // because we never write into the output buffer.
  processor.connect(ctx.destination);

  return {
    stop: () => teardown(true),
    cancel: () => teardown(false),
  };
};
