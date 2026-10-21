# Street Game

浏览器里的街机。封面墙可以搜索、按机种筛选，点开就玩。模拟器是 [TatoEmu](https://github.com/zyc9012/tatoemu) 的 WebAssembly 版本，页面负责选游戏、按键和存档。

**在线地址：** https://liuzhuoling2011.github.io/streetgame/

## 能做什么

- 只列出这台站点上真的有 ROM 的游戏
- 画面按原始比例放进窗口，多出来的地方留黑边，不裁画面
- 鼠标停在画面上时，底部出现一排图标：重开、暂停、按键、存档数据、音量、菜单、设置、全屏、退出。金手指在设置里，不占这一排
- 1P / 2P 键盘分开保存。街机还可以把 A+B、A+C、A+D、B+C、B+D、C+D、A+B+C+D 绑到一个键，手机上也能当按钮
- 四个存档槽写在这台浏览器里，不上传。悬停条不再放快速存读档，存档数据里还能存、读、清除
- 手机触控是单人：摇杆在左，圆形按键在右，同一条水平线上。Neo Geo 菱形是 D 上、C 左、B 右、A 下。投币、选择、开始在下一排中间，连招在右下。竖屏按键在画面下方，横屏摇杆和按键分在画面两侧，尽量不压住画面
- 「打开本地 ROM」只在本地读取文件，不会送到服务器

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

短名要和 `public/games.json` 里的 `fbneo` 字段一致，例如 `public/roms/sf2.zip`。文件放好以后重新构建，目录里才会出现这张卡。Neo Geo 还要把你自己的 `neogeo.zip` 放到 `public/bios/`。GBA 要把你自己的 `gba_bios.bin` 放到 `public/bios/`。

大于 10 MiB 的 zip 不要整包推进 GitHub（50 MB 起警告，100 MB 会被拒绝）。在放着这些 zip 的机器上运行：

```bash
npm run roms:split
```

大包会变成 `public/roms/parts/<短名>.zip.000` 这种 10 MiB 分片，并记入 `public/roms/manifest.json`。原 zip 写进 `public/roms/.gitignore`，留在本机。小于等于 10 MiB 的 zip 仍以整包提交。`neogeo.zip` 仍然不要提交。页面会把分片拼回去再开台。细节在 [public/roms/README.md](public/roms/README.md)。

不想改仓库的话，用「打开本地 ROM」。

Neo Geo 还要一份 `neogeo.zip`。可以放在 `public/bios/neogeo.zip`，也可以只放在已经部署的 Pages 上，不要把商业 BIOS 再提交进这个仓库。模拟器默认要 FBNeo 的文件名，并且 `000-lo.lo` 是 128KB。页面会在浏览器里整理常见的 MAME 包：把 64KB 的 `000-lo.lo` 拼成两份，并按公开的 CRC 对照表把 `asia-s3.rom`、`uni-bios.rom` 这类名字对上模拟器的 BIOS 槽。包里如果同时有街机原版 BIOS（`sp-s2.sp1`）和 UniBIOS，页面会用原版，投币和开始才能用；UniBIOS 2.0 的设置菜单不读这两个键。游戏 zip 会按模拟器目录里的大小和 CRC 对上 FBNeo 文件名：`082-p1.bin` 变成 `082-p1.p1`，拳皇 98 的 `242-p2.bin` 变成 `242-p2.sp2`，合金弹头 3 的 `256-p2.bin` 则变成 `256-pg2.p2`。WinKawaks 的 `mslug_c1.rom` 若是 MAME 0.80 以前那种前半在高地址的 C ROM，页面对调两半后再对 CRC。短一截、后面是空片的 M1（合金弹头 4 的 64KB `263-m1.bin`、战国传 3 的 128KB `261-m1.bin`）会补 `0xFF` 再对 CRC。战国传 3 若带有 `sen3n` 解密 C/S，并且 2MB 的 `261-p1.bin` 前半、后半分别是解密 P2、P1，就改按 `sengk3fd` 开。名字和大小已经对上、只是 CRC 不同的文件会原样交给核心（合金弹头 X 的 `250-c2`、1941 的 `41e_*`），不再改字节去凑 CRC。上尉密令包里的 `cce_23d` / `cc_*d` 是 911014 版，按 `captcommr1` 开；三国志 II 包里的 `tk2e_*b` 是 921002 版，按 `wofr1` 开（CPS-B-21 默认层控制，不是父集的 QS1）。对不上时页面写出缺的文件名，以及包里同大小文件的 CRC。

## 远程 ROM 目录

`public/config.json` 里的 `romBaseUrl` 默认是空字符串，目录里的 `rom` 路径就从本站读，例如 `roms/sf2.zip`。若写成一个 HTTPS 前缀，没有随站发布的 ROM 会拼成：

`https://cdn.example.com/library` + `roms/sf2.zip`

构建时如果设置了 `VITE_ROM_BASE_URL`，它覆盖配置文件。样例见 `.env.example`。

主机必须允许从 Pages 源站跨域 `GET`（`Access-Control-Allow-Origin` 至少包含 `https://liuzhuoling2011.github.io`）。`Content-Length` 会被用来画进度；没有长度时只显示已传输的大小。

Quark、百度网盘这类消费级分享链接通常不能被浏览器跨域读取，不要填那种地址。无论目录放在哪，都不要把商业 ROM 或 BIOS 提交进这个公开仓库。

## 模拟器

`public/emulator/tatoemu.js` 和 `tatoemu.wasm` 由 TatoEmu 提交 `dc757e73d2f3a40060a3697fe74047b74831b5b9` 编译而来，并打了五份补丁：`scripts/tatoemu-browser-slots.patch`（暂停、存档、读档）、`scripts/tatoemu-batcirj.patch`（CPS2 日本版修订，库里不再带这套 ROM）、`scripts/tatoemu-idbfs.patch`（让新版 Emscripten 仍链上 IDBFS）、`scripts/tatoemu-kawaks-boot.patch`（FBNeo 的 CMC42 / CMC50、SMA、PCM2、PVC，以及名字和大小相符但 CRC 不同时仍加载）、`scripts/tatoemu-pace-input.patch`（按核心刷新推进，并在每一帧采样当前按住的键）。包里已经带齐解密片的 `kof99`、`kof2000` 和 `sengoku3` 仍改走 `kof99fd`、`kof2kfd`、`sengk3fd`。加密的 `kof2001` / `kof2002` / `kof2003` / `mslug3` / `mslug4` 由核心解密后开。`mslug5nd` 是加密程序加解密画面的混合集，单独一个驱动。`wofr1` 用 CPS-B-21 默认层寄存器，`captcommr1` 是 911014 程序片，页面在 CRC 对得上时改走这两个驱动。模拟按核心自己的刷新走（Neo Geo 约 59.185 Hz，CPS 约 59.63 Hz），不跟显示器的 120 Hz 或 144 Hz 跑。1P 的 A+B 连招默认是 Q。

重新编译要先激活 Emscripten（`source emsdk_env.sh`），再跑：

```bash
bash scripts/build-emulator.sh
python3 scripts/extract-arcade-sets.py
```

TatoEmu 的作者是 zyc9012。在线原版在 https://emu.tatoz.net 。本仓库只做门户，不修改各主机的模拟逻辑。

## 封面

`public/covers/` 里的图是卡带封面。能对上 [ArcadeGameBox](https://arcadegamebox.com/zh/) 的游戏用那边的宣传图。战国传 3 用 libretro 的 Neo Geo Named_Boxarts。其余对不上的保留亮色标题板。重新生成：`node scripts/placeholder-covers.mjs`。吸引画面仍可用 `scripts/capture-cover.mjs` 和 `scripts/crisp-cover.mjs`。

## 缓存

构建会生成 `sw.js`。再次打开时，页面、模拟器、BIOS 和已经下过的 ROM 从 Cache Storage 读，断网也能开已经玩过的游戏。大文件中断后会按字节区间接着下。GitHub Pages 自己的 `Cache-Control` 大约是 10 分钟，不能改响应头，所以长期缓存靠这个 Service Worker。带哈希的脚本和样式可以一直留在缓存里；模拟器文件更新后会换一组缓存。

拆开的分片和 `roms/manifest.json` 不进 Service Worker，也不进预缓存，避免一份 ROM 存两遍。拼好并校验过的 zip 仍写进 `streetgame-media`，键是原来的 `roms/<名字>.zip`。清单每次从网络读，拆分更新后不会一直用旧列表。

## 部署

推到 `main` 会跑 `.github/workflows/pages.yml`：安装依赖、`npm run build`、用 GitHub Pages 发布 `dist/`。站点根路径是 `/streetgame/`，Vite 的 `base` 也是这个。

Pages 的 Source 需要是 **GitHub Actions**。仓库管理员打开一次：

[Settings → Pages](https://github.com/liuzhuoling2011/streetgame/settings/pages) → Build and deployment → Source → **GitHub Actions**。

选好之后，推到 `main` 会发布到 https://liuzhuoling2011.github.io/streetgame/ 。
