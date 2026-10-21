#!/usr/bin/env bash
# Rebuild public/emulator from a pinned TatoEmu commit.
# Activate Emscripten first (source emsdk_env.sh). After this script, regenerate
# the browser catalog with: python3 scripts/extract-arcade-sets.py
#
# scripts/tatoemu-batcirj.patch adds the Japan Battle Circuit driver. That
# game is not in the library; the driver stays so a local zip can still match.
# scripts/tatoemu-pace-input.patch paces emulation to the core's native
# refresh (not the display refresh) and samples held keys once per frame.
#
# scripts/tatoemu-kawaks-boot.patch ports FBNeo's Neo Geo CMC42/CMC50, SMA,
# PCM2, and PVC decrypt, adds the mixed mslug5nd driver, and accepts a ROM
# whose name and size match even when the CRC does not. It also adds wofr1
# (CPS-B-21 default layer map, not the QS1 map of parent wof) and captcommr1.
# CPS1 QSound opcode fetches in 0xD000-0xEFFF alias onto the decrypted Z80
# window. Decrypted siblings that are already complete (kof99fd, kof2kfd,
# sengk3fd) are still preferred.
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
git -C "$WORK/tatoemu" apply "$ROOT/scripts/tatoemu-kawaks-boot.patch"
git -C "$WORK/tatoemu" apply "$ROOT/scripts/tatoemu-pace-input.patch"

SDL3_DIR="$(cd "$(dirname "$(command -v emcc)")/tools/ports/sdl3" && pwd)"
emcmake cmake -S "$WORK/tatoemu" -B "$WORK/build" \
  -DPLATFORM=wasm \
  -DCMAKE_BUILD_TYPE=Release \
  -DSDL3_DIR="$SDL3_DIR"
cmake --build "$WORK/build" --target tatoemu -j"${BUILD_JOBS:-$(nproc)}"

mkdir -p "$ROOT/public/emulator"
cp "$WORK/build/emulator/tatoemu.js" "$WORK/build/emulator/tatoemu.wasm" "$ROOT/public/emulator/"
echo "已写入 public/emulator/"
