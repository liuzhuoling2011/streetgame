# 怎么把 ROM 放进来

Street Game 不托管你另外准备的商业 ROM，也不会把你选中的文件上传到服务器。本地选择的 ROM 只留在这台浏览器里。目录里只显示服务器上确实能读到的游戏。

## CPS1 / CPS2 / Neo Geo

1. 准备你**合法取得**的 FBNeo **非合并** zip。短名要和目录卡一致，例如 `sf2.zip`、`mslug.zip`。
2. 把 zip 放到 `public/roms/`。
3. Neo Geo 还需要合法的 `neogeo.zip`，放到 `public/bios/neogeo.zip`。
4. GBA 需要合法的 `gba_bios.bin`，放到 `public/bios/gba_bios.bin`。
5. 重新构建并部署。页面会探测文件，读得到才会出现封面。

也可以不改仓库：在页面上点「打开本地 ROM」。文件只写进浏览器的 IndexedDB。

## 超过 10 MiB 的 zip

GitHub 单文件超过 50 MB 会警告，100 MB 直接拒绝。大 ROM 不要整包提交。在放着 `public/roms/*.zip` 的那台机器上运行：

```bash
npm run roms:split
```

脚本只动这个目录里大于 10 MiB 的 `*.zip`：

- 写成 `public/roms/parts/<名字>.zip.000`、`.001`…，每片 10 MiB
- 写 `public/roms/manifest.json`：每个文件的总字节数、sha256、按顺序的分片路径
- 写 `public/roms/.gitignore`，被拆开的原 zip 留在磁盘上，不进提交
- 小于等于 10 MiB 的 zip 保持原样，可以继续提交
- `neogeo.zip` 不会被拆，也不会进提交

再跑一次是安全的。大小和 sha256 都没变、分片也完整时，不会重写文件。zip 换过、变小或者删了，旧分片会被换掉或清掉。

提交 `parts/`、`manifest.json`、`.gitignore`，以及那些小 zip。不要提交被拆开的原 zip，也不要提交 `neogeo.zip`。

页面看到 manifest 里的条目，就同时下载最多 4 个分片，用原来的进度条显示合计字节，拼成一个 zip，核对大小和 sha256，再交给模拟器。拼好的结果写进现有的 ROM 缓存，键仍是原来的 `<名字>.zip`，下次打开不再下载。某个分片失败会再试两次。manifest 里没有的文件（小 zip、还没拆的本地包、远程目录上的整包）仍按 `<名字>.zip` 这一个地址下载。

远程目录如果也拆开了，按同样的相对布局放 `manifest.json` 和 `parts/`。没有这份清单时，页面还是下整包。

Neo Geo 的 `neogeo.zip` 放到 `public/bios/`，或只放在站点的 `bios/neogeo.zip`。页面会把常见 MAME 包整理成模拟器认得的文件名和 128KB 的 `000-lo.lo`。游戏包里的 MAME 文件名（例如 `082-p1.bin`）会在浏览器里改成 FBNeo 的 `082-p1.p1`。

## 远程静态目录

编辑 `public/config.json` 的 `romBaseUrl`，或在构建时设置 `VITE_ROM_BASE_URL`。前缀会接在目录的 `rom` 路径前面，例如前缀 `https://cdn.example.com/library`、目录项 `roms/sf2.zip`，实际请求 `https://cdn.example.com/library/roms/sf2.zip`。BIOS 会先找本站 `bios/`，再找 `${romBaseUrl}/bios/`。

这个主机要允许 Pages 源站跨域 GET。网盘分享链接一般不行。不要把商业 ROM 提交进仓库。

## 家用机

NES、GB/GBC、GBA、Mega Drive 也可以用页面上的「打开本地 ROM」。扩展名用 `.nes`、`.gb`、`.gbc`、`.gba`、`.md`、`.gen`、`.bin` 或包含这些文件的 zip。
