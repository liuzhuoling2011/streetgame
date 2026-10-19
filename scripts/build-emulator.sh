#!/usr/bin/env bash
# Rebuild public/emulator from a pinned TatoEmu commit.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PIN="dc757e73d2f3a40060a3697fe74047b74831b5b9"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

if ! command -v emcmake >/dev/null 2>&1; then
  echo "先安装并激活 Emscripten，例如 source emsdk_env.sh" >&2
  exit 1
fi

git clone --depth 1 https://github.com/zyc9012/tatoemu.git "$WORK/tatoemu"
git -C "$WORK/tatoemu" fetch --depth 1 origin "$PIN"
git -C "$WORK/tatoemu" checkout "$PIN"
git -C "$WORK/tatoemu" apply "$ROOT/scripts/tatoemu-browser-slots.patch"

SDL3_DIR="$(cd "$(dirname "$(command -v emcc)")/tools/ports/sdl3" && pwd)"
emcmake cmake -S "$WORK/tatoemu" -B "$WORK/build" \
  -DPLATFORM=wasm \
  -DCMAKE_BUILD_TYPE=Release \
  -DSDL3_DIR="$SDL3_DIR"
cmake --build "$WORK/build" --target tatoemu -j"$(nproc)"

mkdir -p "$ROOT/public/emulator"
cp "$WORK/build/emulator/tatoemu.js" "$WORK/build/emulator/tatoemu.wasm" "$ROOT/public/emulator/"
echo "已写入 public/emulator/"
