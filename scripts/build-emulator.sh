#!/usr/bin/env bash
# Rebuild public/emulator from a pinned TatoEmu commit.
# This environment has no Emscripten, so the WASM is not rebuilt here.
# Follow-ups that need that rebuild:
#   - batcirj is not in emulators/cps/db_cps2.cpp (only batcir). Add the driver
#     before a Japan Battle Circuit set can boot. The parent gfx/sound still
#     have to be in the zip; batcirj.zip in this repo is program ROMs only.
#   - Neo Geo CMC42 / CMC50 / SMA / encrypted M1 are rejected in
#     Cartridge::load ("Encrypted NeoGeo games are not supported yet").
#     mslug4, encrypted mslug5, encrypted sengoku3, and encrypted mslug3 need
#     that check replaced with real protection code, or a decrypted *fd set.
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
