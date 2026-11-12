#!/usr/bin/env bash
# Builds the engine-sim core + bindings into src/sim/wasm/engine-sim.{js,wasm}.
# Requires the Emscripten SDK (https://emscripten.org). By default looks in ~/emsdk.
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v em++ >/dev/null 2>&1; then
  # shellcheck disable=SC1091
  source "${EMSDK:-$HOME/emsdk}/emsdk_env.sh" >/dev/null 2>&1
fi

OUT=../src/sim/wasm
OBJ=.build
mkdir -p "$OUT" "$OBJ"

CXXFLAGS=(-std=c++17 -O3 -DNDEBUG -msimd128 -ffast-math -flto -include compat.h -Wno-everything)

sources=(engine-sim/src/*.cpp scs/src/*.cpp bindings/bindings.cpp)
objects=()
pids=()
for src in "${sources[@]}"; do
  obj="$OBJ/$(echo "$src" | tr '/' '_').o"
  objects+=("$obj")
  if [[ ! -f "$obj" || "$src" -nt "$obj" || compat.h -nt "$obj" || -n "$(find engine-sim/include scs/include -newer "$obj" -print -quit)" ]]; then
    em++ "${CXXFLAGS[@]}" -c "$src" -o "$obj" &
    pids+=($!)
  fi
done
for pid in "${pids[@]}"; do wait "$pid"; done

em++ "${objects[@]}" -O3 -msimd128 -flto -lembind \
  -sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=createEngineSim \
  -sENVIRONMENT=worker,web,node \
  -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=16MB \
  -sEXPORTED_FUNCTIONS=_malloc,_free \
  -sEXPORTED_RUNTIME_METHODS=HEAPU8,HEAP16,HEAPF32 \
  -o "$OUT/engine-sim.js"

echo "Built $OUT/engine-sim.js"
