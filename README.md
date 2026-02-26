# rubberband-wasm

Standalone browser pitch-shifting demo using Rubber Band compiled to WebAssembly.

## Project layout

- `rubberband/` - git submodule (upstream Rubber Band source)
- `rubberband_wasm.cpp` - C ABI bridge used by the WASM worker
- `index.html`, `main.js`, `worker.js` - UI and processing flow
- `opus_encoder.js` - optional Opus export helper using `ffmpeg.wasm`
- `build.sh` - compiles Rubber Band WASM and runs web build
- `serve.sh` - local static server for `dist/`
- `rubberband-wasm.js/.wasm` - generated WASM runtime assets
- `dist/` - deployable build output

## Setup

```bash
git submodule update --init --recursive
npm install
```

## Commands

```bash
npm run dev        # compile WASM then run Vite dev server
npm run build      # compile WASM and build production dist/
npm run preview    # preview dist/ on port 8080
```

## Notes

- Input decode uses browser `decodeAudioData`, so supported formats depend on browser codec support.
- Default output download is 16-bit PCM WAV.
- `ffmpeg.wasm` is used for optional Opus export flows.
- Processing uses Rubber Band offline mode with R3 engine (`OptionEngineFiner`) for best quality.
- This project is distributed under GNU GPL v2 or later (`GPL-2.0-or-later`).
- This app includes GPL components (Rubber Band and `@ffmpeg/core`), so distributed builds must comply with GPL v2 or later, including providing corresponding source.
- ffmpeg licensing note:
  - `@ffmpeg/core` is `GPL-2.0-or-later`.
  - `@ffmpeg/ffmpeg` and `@ffmpeg/util` are `MIT`.
