import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';
import ffmpegWorkerURL from '@ffmpeg/ffmpeg/worker?url';
import ffmpegCoreURL from '/node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.js?url';
import ffmpegWasmURL from '/node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.wasm?url';

let ffmpeg = null;
let ffmpegLoaded = false;

function makeFfmpeg() {
  const instance = new FFmpeg();
  instance.on('log', ({ message }) => {
    const text = typeof message === 'string' ? message.trim() : '';
    if (!text) return;
    if (instance.__onLog) instance.__onLog(text);
  });
  return instance;
}

async function resetFfmpeg(onLog) {
  if (ffmpeg) {
    ffmpeg.terminate();
  }
  ffmpeg = makeFfmpeg();
  ffmpeg.__onLog = onLog;
  ffmpegLoaded = false;
  await ffmpeg.load({
    classWorkerURL: ffmpegWorkerURL,
    coreURL: ffmpegCoreURL,
    wasmURL: ffmpegWasmURL,
  });
  ffmpegLoaded = true;
}

async function ensureFfmpegLoaded(onLog) {
  if (!ffmpeg || !ffmpegLoaded) {
    await resetFfmpeg(onLog);
    return;
  }
  ffmpeg.__onLog = onLog;
}

export async function encodeWavBlobToOpus(wavBlob, options = {}) {
  const bitrate = options.bitrate ?? '128k';
  const inputName = 'input.wav';
  const logTail = [];

  const onLog = (line) => {
    logTail.push(line);
    if (logTail.length > 14) logTail.shift();
    if (options.onLog) options.onLog(line);
  };

  const attempts = [
    {
      label: 'ogg/stereo/libopus',
      outputName: 'output.ogg',
      extension: 'ogg',
      mimeType: 'audio/ogg; codecs=opus',
      args: ['-i', inputName, '-vn', '-ar', '48000', '-threads', '1', '-ac', '2', '-c:a', 'libopus', '-b:a', bitrate, '-vbr', 'on', '-f', 'ogg', 'output.ogg'],
    },
    {
      label: 'ogg/mono/libopus',
      outputName: 'output.ogg',
      extension: 'ogg',
      mimeType: 'audio/ogg; codecs=opus',
      args: ['-i', inputName, '-vn', '-ar', '48000', '-threads', '1', '-ac', '1', '-c:a', 'libopus', '-b:a', bitrate, '-vbr', 'on', '-f', 'ogg', 'output.ogg'],
    },
    {
      label: 'webm/stereo/libopus',
      outputName: 'output.webm',
      extension: 'webm',
      mimeType: 'audio/webm; codecs=opus',
      args: ['-i', inputName, '-vn', '-ar', '48000', '-threads', '1', '-ac', '2', '-c:a', 'libopus', '-b:a', bitrate, '-vbr', 'on', '-f', 'webm', 'output.webm'],
    },
    {
      label: 'webm/mono/libopus',
      outputName: 'output.webm',
      extension: 'webm',
      mimeType: 'audio/webm; codecs=opus',
      args: ['-i', inputName, '-vn', '-ar', '48000', '-threads', '1', '-ac', '1', '-c:a', 'libopus', '-b:a', bitrate, '-vbr', 'on', '-f', 'webm', 'output.webm'],
    },
  ];

  let lastError = null;

  for (const attempt of attempts) {
    try {
      onLog(`ffmpeg attempt: ${attempt.label}`);
      await ensureFfmpegLoaded(onLog);
      await ffmpeg.writeFile(inputName, await fetchFile(wavBlob));
      await ffmpeg.deleteFile(attempt.outputName).catch(() => {});

      const code = await ffmpeg.exec(attempt.args);
      if (code !== 0) throw new Error(`ffmpeg exited with code ${code}`);

      const out = await ffmpeg.readFile(attempt.outputName);
      await Promise.all([
        ffmpeg.deleteFile(inputName).catch(() => {}),
        ffmpeg.deleteFile(attempt.outputName).catch(() => {}),
      ]);
      return { blob: new Blob([out], { type: attempt.mimeType }), extension: attempt.extension, mimeType: attempt.mimeType };
    } catch (err) {
      console.log(`${err}`)
      lastError = err;
      ffmpegLoaded = false;
      if (ffmpeg) ffmpeg.terminate();
      ffmpeg = null;
    }
  }

  const details = logTail.length ? ` | ffmpeg: ${logTail.join(' || ')}` : '';
  throw new Error(`${String(lastError)}${details}`);
}
