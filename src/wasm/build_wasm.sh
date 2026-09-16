#!/bin/bash
set -e

# Rubber Band v4.0.0 → WASM build script
# Single-threaded, no RTTI, no SharedArrayBuffer

cd "${0%/*}"

RUBBERBAND_DIR="/tmp/rubberband-v4.0.0"
PROJECT_DIR="/Volumes/MP44L/Git/Fidelitone"

if [ ! -d "$RUBBERBAND_DIR" ]; then
  echo "Error: Rubber Band source not found at $RUBBERBAND_DIR"
  echo "Clone: git clone --branch v4.0.0 --depth 1 https://github.com/breakfastquay/rubberband.git $RUBBERBAND_DIR"
  exit 1
fi

if ! command -v emcc &> /dev/null; then
  if [ -f "$HOME/emsdk/emsdk_env.sh" ]; then
    source "$HOME/emsdk/emsdk_env.sh"
  else
    echo "Error: emcc not found. Install Emscripten: git clone https://github.com/emscripten-core/emsdk.git ~/emsdk && ~/emsdk/emsdk install latest && ~/emsdk/emsdk activate latest"
    exit 1
  fi
fi

echo "=== Rubber Band WASM Build ==="
echo "Source: $RUBBERBAND_DIR"
echo "Compiler: $(which emcc)"

CFLAGS="-I${RUBBERBAND_DIR}/rubberband -O0 -fno-rtti"
CXXFLAGS="${CFLAGS}"

rm -rf build
mkdir -p build

echo "=== Compiling RubberBandSingle.cpp ==="
emcc ${CXXFLAGS} -c "${RUBBERBAND_DIR}/single/RubberBandSingle.cpp" -o build/librubberband.o

echo "=== Compiling wasm_wrapper.c ==="
emcc ${CFLAGS} -c "${RUBBERBAND_DIR}/wasm_wrapper.c" -o build/wasm_wrapper.o

EMCC_FLAGS="-sENVIRONMENT=web,worker -sALLOW_MEMORY_GROWTH=1 -sMODULARIZE=1 -sSTANDALONE_WASM=1 -sEXPORT_ALL -sERROR_ON_UNDEFINED_SYMBOLS=1 -sAUTO_JS_LIBRARIES=0 -sFILESYSTEM=0 -sASSERTIONS=0 --no-entry"

echo "=== Linking WASM ==="
em++ ${EMCC_FLAGS} \
  build/librubberband.o \
  build/wasm_wrapper.o \
  -o build/rubberband.js

cp build/rubberband.wasm "${PROJECT_DIR}/src/wasm/rubberband.wasm"

WASM_SIZE=$(wc -c < "${PROJECT_DIR}/src/wasm/rubberband.wasm" | tr -d ' ')
echo "=== Build complete ==="
echo "Output: src/wasm/rubberband.wasm (${WASM_SIZE} bytes)"

if [ "$WASM_SIZE" -lt 512000 ]; then
  echo "WARNING: WASM file is smaller than 500KB"
  exit 1
fi

echo "=== Done ==="
