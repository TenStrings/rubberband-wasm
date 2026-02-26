import { encodeWavBlobToOpus } from './opus_encoder.js';

const fileInput = document.getElementById('fileInput');
const processBtn = document.getElementById('processBtn');
const downloadBtn = document.getElementById('downloadBtn');
const downloadOpusBtn = document.getElementById('downloadOpusBtn');
const pitchDownBtn = document.getElementById('pitchDownBtn');
const pitchUpBtn = document.getElementById('pitchUpBtn');
const pitchValueEl = document.getElementById('pitchValue');
const statusEl = document.getElementById('status');
const originalPlayer = document.getElementById('originalPlayer');
const processedPlayer = document.getElementById('processedPlayer');

let sourceBuffer = null;
let renderedBuffer = null;
let renderedWavBlob = null;
let renderedOpusBlob = null;
let renderedOpusExtension = 'ogg';
let sourceObjectUrl = null;
let renderedObjectUrl = null;
let sourceFileName = null;
let semitones = 0;
let isProcessing = false;
let isOpusEncoding = false;
let renderedSemitones = 0;
let sourceToken = 0;
let lastProcessedSourceToken = null;
let lastProcessedSemitones = null;

let worker = null;
let requestId = 0;
const pendingRequests = new Map();

function setStatus(text) {
  statusEl.textContent = text;
}

function updateDownloadButtonsState() {
  const hasOutput = Boolean(renderedWavBlob);
  downloadBtn.disabled = !hasOutput || isOpusEncoding;
  downloadOpusBtn.disabled = !hasOutput || isOpusEncoding;
}

function updateProcessButtonState() {
  const sameAsLastProcess =
    sourceBuffer &&
    lastProcessedSourceToken === sourceToken &&
    lastProcessedSemitones === semitones;
  processBtn.disabled = !sourceBuffer || semitones === 0 || isProcessing || sameAsLastProcess;
}

function clearObjectUrl(url) {
  if (url) URL.revokeObjectURL(url);
}

function setSemitones(next) {
  semitones = Math.max(-12, Math.min(12, Math.round(next)));
  const text = semitones > 0 ? `+${semitones}` : `${semitones}`;
  pitchValueEl.textContent = text;
  pitchDownBtn.disabled = semitones <= -12;
  pitchUpBtn.disabled = semitones >= 12;
  updateProcessButtonState();
}

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

function audioBufferToWavBlob(buffer) {
  const channels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const frames = buffer.length;
  const bytesPerSample = 2;
  const blockAlign = channels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = frames * blockAlign;
  const wavSize = 44 + dataSize;

  const ab = new ArrayBuffer(wavSize);
  const view = new DataView(ab);

  let o = 0;
  const writeStr = (s) => {
    for (let i = 0; i < s.length; i += 1) view.setUint8(o + i, s.charCodeAt(i));
    o += s.length;
  };

  writeStr('RIFF');
  view.setUint32(o, wavSize - 8, true); o += 4;
  writeStr('WAVE');
  writeStr('fmt ');
  view.setUint32(o, 16, true); o += 4;
  view.setUint16(o, 1, true); o += 2;
  view.setUint16(o, channels, true); o += 2;
  view.setUint32(o, sampleRate, true); o += 4;
  view.setUint32(o, byteRate, true); o += 4;
  view.setUint16(o, blockAlign, true); o += 2;
  view.setUint16(o, 16, true); o += 2;
  writeStr('data');
  view.setUint32(o, dataSize, true); o += 4;

  const channelData = [];
  for (let c = 0; c < channels; c += 1) channelData.push(buffer.getChannelData(c));

  for (let i = 0; i < frames; i += 1) {
    for (let c = 0; c < channels; c += 1) {
      const s = clamp(channelData[c][i], -1, 1);
      view.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      o += 2;
    }
  }

  return new Blob([ab], { type: 'audio/wav' });
}

async function decodeFile(file) {
  const bytes = await file.arrayBuffer();
  const ctx = new AudioContext();
  try {
    const decoded = await ctx.decodeAudioData(bytes.slice(0));
    return decoded;
  } finally {
    await ctx.close();
  }
}

function rejectAllPending(reason) {
  for (const [id, p] of pendingRequests.entries()) {
    p.reject(reason);
    pendingRequests.delete(id);
  }
}

function ensureWorker() {
  if (worker) return worker;

  worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });

  worker.addEventListener('message', (event) => {
    const msg = event.data;
    if (!msg || typeof msg !== 'object') return;

    if (msg.type === 'status') {
      setStatus(msg.text || 'Working...');
      return;
    }

    const pending = pendingRequests.get(msg.id);
    if (!pending) return;
    pendingRequests.delete(msg.id);

    if (msg.type === 'result') {
      pending.resolve(msg.payload);
      return;
    }

    if (msg.type === 'error') {
      pending.reject(new Error(msg.error || 'Worker processing failed'));
    }
  });

  worker.addEventListener('error', (event) => {
    const message = event.message || 'Unknown worker error';
    rejectAllPending(new Error(message));
    setStatus(`Worker error: ${message}`);
  });

  return worker;
}

async function processWithWorker(inputBuffer, pitchSemitones) {
  const w = ensureWorker();

  const channels = inputBuffer.numberOfChannels;
  const sampleRate = inputBuffer.sampleRate;
  const totalFrames = inputBuffer.length;

  const channelData = [];
  for (let c = 0; c < channels; c += 1) {
    // Use cloned channel buffers and avoid transfer-list detachment edge cases.
    const data = new Float32Array(inputBuffer.getChannelData(c));
    channelData.push(data);
  }

  const id = ++requestId;

  return new Promise((resolve, reject) => {
    pendingRequests.set(id, { resolve, reject });
    w.postMessage({
      type: 'process',
      id,
      payload: {
        channels,
        sampleRate,
        totalFrames,
        semitones: pitchSemitones,
        channelData,
      },
    });
  });
}

function createOutputBuffer(result) {
  const output = new AudioBuffer({
    numberOfChannels: result.channels,
    sampleRate: result.sampleRate,
    length: result.totalFrames,
  });

  for (let c = 0; c < result.channels; c += 1) {
    output.getChannelData(c).set(result.channelData[c]);
  }

  return output;
}

fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0];
  renderedBuffer = null;
  renderedWavBlob = null;
  renderedOpusBlob = null;
  updateDownloadButtonsState();
  processedPlayer.removeAttribute('src');
  processedPlayer.load();
  clearObjectUrl(renderedObjectUrl);
  renderedObjectUrl = null;

  if (!file) {
    sourceBuffer = null;
    sourceFileName = null;
    updateProcessButtonState();
    originalPlayer.removeAttribute('src');
    originalPlayer.load();
    clearObjectUrl(sourceObjectUrl);
    sourceObjectUrl = null;
    setStatus('idle');
    return;
  }

  isProcessing = true;
  updateProcessButtonState();
  setStatus('Decoding audio file...');

  try {
    sourceBuffer = await decodeFile(file);
    sourceFileName = file.name;
    sourceToken += 1;
    clearObjectUrl(sourceObjectUrl);
    sourceObjectUrl = URL.createObjectURL(file);
    originalPlayer.src = sourceObjectUrl;
    setStatus(`Loaded: ${file.name} | ${sourceBuffer.numberOfChannels}ch @ ${sourceBuffer.sampleRate} Hz | ${(sourceBuffer.duration).toFixed(2)}s`);
  } catch (err) {
    sourceBuffer = null;
    setStatus(`Decode failed: ${String(err)}`);
  } finally {
    isProcessing = false;
    updateProcessButtonState();
  }
});

processBtn.addEventListener('click', async () => {
  if (!sourceBuffer || semitones === 0) return;

  isProcessing = true;
  updateProcessButtonState();
  renderedOpusBlob = null;
  updateDownloadButtonsState();
  processedPlayer.removeAttribute('src');
  processedPlayer.load();
  clearObjectUrl(renderedObjectUrl);
  renderedObjectUrl = null;

  try {
    setStatus('Sending audio to worker...');
    const result = await processWithWorker(sourceBuffer, semitones);
    renderedBuffer = createOutputBuffer(result);
    renderedWavBlob = audioBufferToWavBlob(renderedBuffer);
    renderedSemitones = semitones;
    lastProcessedSourceToken = sourceToken;
    lastProcessedSemitones = semitones;
    renderedObjectUrl = URL.createObjectURL(renderedWavBlob);
    processedPlayer.src = renderedObjectUrl;

    updateDownloadButtonsState();
    setStatus(`Done. Output length: ${renderedBuffer.duration.toFixed(2)}s`);
  } catch (err) {
    setStatus(`Process failed: ${String(err)}`);
  } finally {
    isProcessing = false;
    updateProcessButtonState();
    updateDownloadButtonsState();
  }
});

downloadBtn.addEventListener('click', async () => {
  if (!renderedWavBlob) return;

  try {
    updateDownloadButtonsState();
    const baseName = sourceFileName ? sourceFileName.replace(/\.[^/.]+$/, '') : 'pitch-shifted';
    const semitoneTag = renderedSemitones > 0 ? `plus${renderedSemitones}` : `minus${Math.abs(renderedSemitones)}`;
    const filename = `${baseName}-pitch-${semitoneTag}.wav`;
    const url = URL.createObjectURL(renderedWavBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setStatus(`Downloaded: ${filename}`);
  } catch (err) {
    setStatus(`Download failed: ${String(err)}`);
  } finally {
    updateDownloadButtonsState();
  }
});

downloadOpusBtn.addEventListener('click', async () => {
  if (!renderedWavBlob) return;

  try {
    isOpusEncoding = true;
    updateDownloadButtonsState();
    if (!renderedOpusBlob) {
      setStatus('Encoding Opus...');
      renderedOpusBlob = await encodeWavBlobToOpus(renderedWavBlob, {
        onLog: (line) => {
          if (line) setStatus(`Encoding Opus... ${line}`);
        },
      });
      renderedOpusExtension = renderedOpusBlob.extension || 'ogg';
      renderedOpusBlob = renderedOpusBlob.blob || renderedOpusBlob;
    }

    const baseName = sourceFileName ? sourceFileName.replace(/\.[^/.]+$/, '') : 'pitch-shifted';
    const semitoneTag = renderedSemitones > 0 ? `plus${renderedSemitones}` : `minus${Math.abs(renderedSemitones)}`;
    const filename = `${baseName}-pitch-${semitoneTag}.${renderedOpusExtension}`;
    const url = URL.createObjectURL(renderedOpusBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setStatus(`Downloaded: ${filename}`);
  } catch (err) {
    setStatus(`Opus export failed: ${String(err)}`);
  } finally {
    isOpusEncoding = false;
    updateDownloadButtonsState();
  }
});

setStatus('Select a file to begin.');
setSemitones(0);
updateProcessButtonState();
updateDownloadButtonsState();

pitchDownBtn.addEventListener('click', () => {
  setSemitones(semitones - 1);
});

pitchUpBtn.addEventListener('click', () => {
  setSemitones(semitones + 1);
});

window.addEventListener('beforeunload', () => {
  clearObjectUrl(sourceObjectUrl);
  clearObjectUrl(renderedObjectUrl);
  if (worker) worker.terminate();
});
