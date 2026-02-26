import createRubberBandModule from './rubberband-wasm.js';

let wasm = null;

function semitonesToScale(semitones) {
  return 2 ** (semitones / 12);
}

function concatFloat32(parts, total) {
  const out = new Float32Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

async function ensureWasm() {
  if (!wasm) {
    postMessage({ type: 'status', text: 'Loading WASM in worker...' });
    wasm = await createRubberBandModule();
  }
  return wasm;
}

function getHeapF32(mod) {
  if (!mod.HEAPF32) {
    throw new Error('WASM heap not exported. Rebuild with updated build.sh settings.');
  }
  return mod.HEAPF32;
}

async function processPayload(payload) {
  const mod = await ensureWasm();
  const heap = getHeapF32(mod);

  const channels = payload.channels;
  const sampleRate = payload.sampleRate;
  const totalFrames = payload.totalFrames;
  const scale = semitonesToScale(payload.semitones);
  const inChannels = payload.channelData;

  const ctxPtr = mod._rb_create(sampleRate, channels);
  if (!ctxPtr) throw new Error('rb_create failed');

  try {
    mod._rb_reset(ctxPtr);
    mod._rb_set_pitch_scale(ctxPtr, scale);
    mod._rb_set_expected_input_duration(ctxPtr, totalFrames);

    const chunkSize = mod._rb_get_chunk_size(ctxPtr);
    const maxOut = mod._rb_get_max_output_size(ctxPtr);
    if (!chunkSize || !maxOut) throw new Error('invalid chunk/output sizing from WASM');

    const inPtrs = [];
    const outPtrs = [];
    for (let c = 0; c < channels; c += 1) {
      const inPtr = mod._rb_get_input_channel_ptr(ctxPtr, c);
      const outPtr = mod._rb_get_output_channel_ptr(ctxPtr, c);
      if (!inPtr || !outPtr) throw new Error('channel pointer acquisition failed');
      inPtrs.push(inPtr >> 2);
      outPtrs.push(outPtr >> 2);
    }

    const outParts = [];
    for (let c = 0; c < channels; c += 1) outParts.push([]);

    let read = 0;
    while (read < totalFrames) {
      const frames = Math.min(chunkSize, totalFrames - read);

      for (let c = 0; c < channels; c += 1) {
        const scratch = new Float32Array(chunkSize);
        scratch.set(inChannels[c].subarray(read, read + frames));
        heap.set(scratch, inPtrs[c]);
      }

      mod._rb_study(ctxPtr, frames, read + frames >= totalFrames ? 1 : 0);
      read += frames;
      if (read % (chunkSize * 32) === 0 || read === totalFrames) {
        const pct = Math.round((read / totalFrames) * 50);
        postMessage({ type: 'status', text: `Studying... ${pct}%` });
      }
    }

    postMessage({ type: 'status', text: 'Calculating stretch profile...' });
    mod._rb_calculate_stretch(ctxPtr);

    read = 0;
    while (read < totalFrames) {
      const frames = Math.min(chunkSize, totalFrames - read);

      for (let c = 0; c < channels; c += 1) {
        const scratch = new Float32Array(chunkSize);
        scratch.set(inChannels[c].subarray(read, read + frames));
        heap.set(scratch, inPtrs[c]);
      }

      const produced = mod._rb_process(ctxPtr, frames, read + frames >= totalFrames ? 1 : 0);
      if (produced > 0) {
        for (let c = 0; c < channels; c += 1) {
          const data = heap.slice(outPtrs[c], outPtrs[c] + produced);
          outParts[c].push(data);
        }
      }

      read += frames;
      if (read % (chunkSize * 32) === 0 || read === totalFrames) {
        const pct = 50 + Math.round((read / totalFrames) * 50);
        postMessage({ type: 'status', text: `Processing... ${pct}%` });
      }
    }

    while (true) {
      const produced = mod._rb_process(ctxPtr, 0, 1);
      if (produced <= 0) break;
      if (produced > maxOut) throw new Error('output overrun');

      for (let c = 0; c < channels; c += 1) {
        const data = heap.slice(outPtrs[c], outPtrs[c] + produced);
        outParts[c].push(data);
      }
    }

    const startDelay = mod._rb_get_start_delay(ctxPtr);
    const channelData = [];

    for (let c = 0; c < channels; c += 1) {
      const totalOut = outParts[c].reduce((n, part) => n + part.length, 0);
      const merged = concatFloat32(outParts[c], totalOut);
      const from = Math.min(startDelay, merged.length);
      const remaining = merged.subarray(from, Math.min(from + totalFrames, merged.length));

      const out = new Float32Array(totalFrames);
      out.set(remaining);
      channelData.push(out);
    }

    return {
      channels,
      sampleRate,
      totalFrames,
      channelData,
    };
  } finally {
    mod._rb_destroy(ctxPtr);
  }
}

self.addEventListener('message', async (event) => {
  const msg = event.data;
  if (!msg || msg.type !== 'process') return;

  try {
    const result = await processPayload(msg.payload);
    const transfer = result.channelData.map((d) => d.buffer);
    postMessage({ type: 'result', id: msg.id, payload: result }, transfer);
  } catch (err) {
    postMessage({ type: 'error', id: msg.id, error: String(err) });
  }
});
