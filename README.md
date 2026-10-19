# 街机夜市

浏览器里的街机门户。封面墙可以搜索、按机种筛选，点开就玩。模拟器是 [TatoEmu](https://github.com/zyc9012/tatoemu) 的 WebAssembly 版本，页面负责摊位、按键和存档。

**在线地址：** https://liuzhuoling2011.github.io/streetgame/

## 能做什么

- 按名字搜索，或按 NES、Game Boy、CPS1、CPS2、Neo Geo 筛选
- 点封面进入游戏。暂停会把画面冻住
- 四个存档槽写在这台浏览器里，不上传
- 可以改键盘映射
- 全屏
- 手机上有虚拟摇杆和按键
- 「打开本地 ROM」只在本地读取文件，不会送到服务器

仓库里自带两个原创试玩：`灯笼夜市`（NES）和 `摊位快跑`（Game Boy）。CPS1、CPS2、Neo Geo 只有目录卡，告诉你把合法的 FBNeo 非合并 zip 放到 `public/roms/`。这里没有商业 ROM，也没有商业 BIOS。

## 本地运行

```bash
npm ci
npm run dev
```

开发服务器的路径已经带 `/streetgame/`。构建：

```bash
npm run build
npm run preview
```

## 怎么加 ROM

看 [public/roms/README.md](public/roms/README.md)。

短名要和 `public/games.json` 里的 `fbneo` 字段一致，例如 `public/roms/sf2.zip`。Neo Geo 还要把你自己的 `neogeo.zip` 放到 `public/bios/`。GBA 要把你自己的 `gba_bios.bin` 放到 `public/bios/`。放好以后重新构建。

不想改仓库的话，在目录卡上选「选择本地 ROM」。

原创 ROM 可以用 `python3 scripts/build-roms.py` 再生成一次。

## 模拟器

`public/emulator/tatoemu.js` 和 `tatoemu.wasm` 由 TatoEmu 提交 `dc757e73d2f3a40060a3697fe74047b74831b5b9` 编译而来，并打了 `scripts/tatoemu-browser-slots.patch`，好让页面上的暂停、存档、读档直接叫进模拟器。

重新编译需要 Emscripten 和这个补丁：

```bash
bash scripts/build-emulator.sh
```

TatoEmu 的作者是 zyc9012。在线原版在 https://emu.tatoz.net 。本仓库只做门户，不修改各主机的模拟逻辑。

## 部署

推到 `main` 会跑 `.github/workflows/pages.yml`：安装依赖、`npm run build`、用 GitHub Pages 发布 `dist/`。站点根路径是 `/streetgame/`，Vite 的 `base` 也是这个。

Pages 的 Source 需要是 **GitHub Actions**。仓库设置里如果还没打开，到 Settings → Pages → Build and deployment → Source，选 GitHub Actions。只要选这一次，之后的推送会自己发布。
