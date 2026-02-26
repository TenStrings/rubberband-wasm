#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
RB_DIR="$ROOT_DIR/rubberband"
OUT_DIR="$ROOT_DIR"
WASM_ONLY=0

if [ "${1:-}" = "--wasm-only" ]; then
  WASM_ONLY=1
fi

if ! command -v emcc >/dev/null 2>&1; then
  echo "error: emcc not found. Install Emscripten first: https://emscripten.org/docs/getting_started/downloads.html" >&2
  exit 1
fi

if [ ! -f "$RB_DIR/single/RubberBandSingle.cpp" ]; then
  echo "error: rubberband submodule not initialized" >&2
  echo "run: git submodule update --init --recursive" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"

emcc \
  "$ROOT_DIR/rubberband_wasm.cpp" \
  "$RB_DIR/single/RubberBandSingle.cpp" \
  -I"$RB_DIR" \
  -std=c++17 \
  -O3 \
  -msimd128 \
  -sWASM=1 \
  -sALLOW_MEMORY_GROWTH=1 \
  -sINITIAL_MEMORY=33554432 \
  -sFILESYSTEM=0 \
  -sNO_EXIT_RUNTIME=1 \
  -sENVIRONMENT='web' \
  -sMODULARIZE=1 \
  -sEXPORT_ES6=1 \
  -sEXPORTED_RUNTIME_METHODS='["HEAPF32"]' \
  -sEXPORTED_FUNCTIONS='["_malloc","_free","_rb_create","_rb_destroy","_rb_get_chunk_size","_rb_get_max_output_size","_rb_reset","_rb_set_pitch_scale","_rb_set_expected_input_duration","_rb_get_start_delay","_rb_get_input_channel_ptr","_rb_get_output_channel_ptr","_rb_study","_rb_calculate_stretch","_rb_process"]' \
  -o "$OUT_DIR/rubberband-wasm.js"

echo "Built Rubber Band WASM loader + binary into: $OUT_DIR"

if [ "$WASM_ONLY" -eq 0 ]; then
  npm run build:web
fi
