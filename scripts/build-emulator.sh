#!/usr/bin/env bash
# Rebuild public/emulator from a pinned TatoEmu commit.
# Activate Emscripten first (source emsdk_env.sh). After this script, regenerate
# the browser catalog with: python3 scripts/extract-arcade-sets.py
#
# scripts/tatoemu-batcirj.patch adds the Japan Battle Circuit driver. The
# frontend merges graphics and sound from batcir.zip; batcirj.zip is program
# ROMs only. The Japan key is injected in the browser.
#
# Neo Geo CMC42 / CMC50 / SMA / encrypted M1 are still rejected in
# Cartridge::load ("Encrypted NeoGeo games are not supported yet").
# protections.cpp only decrypts the kof98 program ROM, and this pin is also
# upstream HEAD, so there is no newer TatoEmu to take. mslug4.zip has no
# decrypted C/S (no mslug4fd), so that set stays blocked. Decrypted siblings
# already complete in the zip (kof99fd, kof2kfd, sengk3fd) boot instead.
# Stock mslug3 is still missing 256-s1d.s1.
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
git -C "$WORK/tatoemu" apply "$ROOT/scripts/tatoemu-batcirj.patch"
git -C "$WORK/tatoemu" apply "$ROOT/scripts/tatoemu-idbfs.patch"

SDL3_DIR="$(cd "$(dirname "$(command -v emcc)")/tools/ports/sdl3" && pwd)"
emcmake cmake -S "$WORK/tatoemu" -B "$WORK/build" \
  -DPLATFORM=wasm \
  -DCMAKE_BUILD_TYPE=Release \
  -DSDL3_DIR="$SDL3_DIR"
cmake --build "$WORK/build" --target tatoemu -j"${BUILD_JOBS:-$(nproc)}"

mkdir -p "$ROOT/public/emulator"
cp "$WORK/build/emulator/tatoemu.js" "$WORK/build/emulator/tatoemu.wasm" "$ROOT/public/emulator/"
echo "已写入 public/emulator/"
