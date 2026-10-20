# 怎么把 ROM 放进来

街机夜市不托管商业 ROM，也不会把你选中的文件上传到服务器。本地选择的 ROM 只留在这台浏览器里。

## 原创试玩

这两个文件是本仓库自己写的，可以直接玩：

- `lantern-market.nes`：NES，收集六盏灯笼
- `stall-run.gb`：Game Boy，在摊位里吃掉点心

重新生成：

```bash
python3 scripts/build-roms.py
```

## CPS1 / CPS2 / Neo Geo

1. 准备你**合法取得**的 FBNeo **非合并** zip。短名要和目录卡一致，例如 `sf2.zip`、`mslug.zip`。
2. 把 zip 放到 `public/roms/`。
3. Neo Geo 还需要合法的 `neogeo.zip`，放到 `public/bios/neogeo.zip`。
4. GBA 需要合法的 `gba_bios.bin`，放到 `public/bios/gba_bios.bin`。
5. 重新构建并部署。

也可以不改仓库：在页面上点目录卡，选「选择本地 ROM」。文件只写进浏览器的 IndexedDB。

Neo Geo 的 `neogeo.zip` 放到 `public/bios/`，或只放在站点的 `bios/neogeo.zip`。页面会把常见 MAME 包整理成模拟器认得的文件名和 128KB 的 `000-lo.lo`。游戏包本身仍要是 FBNeo 非合并 zip。

## 远程静态目录

编辑 `public/config.json` 的 `romBaseUrl`，或在构建时设置 `VITE_ROM_BASE_URL`。前缀会接在目录的 `rom` 路径前面，例如前缀 `https://cdn.example.com/library`、目录项 `roms/sf2.zip`，实际请求 `https://cdn.example.com/library/roms/sf2.zip`。BIOS 会先找本站 `bios/`，再找 `${romBaseUrl}/bios/`。

这个主机要允许 Pages 源站跨域 GET。网盘分享链接一般不行。不要把商业 ROM 提交进仓库。

## 家用机

NES、GB/GBC、GBA、Mega Drive 也可以用页面上的「打开本地 ROM」。扩展名用 `.nes`、`.gb`、`.gbc`、`.gba`、`.md`、`.gen`、`.bin` 或包含这些文件的 zip。
