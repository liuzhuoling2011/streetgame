# BIOS

这里故意是空的。

- GBA：把你自己的 `gba_bios.bin`（16KB）放在这个目录。
- Neo Geo：把你自己的 FBNeo `neogeo.zip` 放在这个目录。

不要把商业 BIOS 提交进仓库。页面在需要时才会读取它们；读不到会告诉你缺哪个文件。

Neo Geo 的核心不会走 GBA 那种 bootrom 参数。它在游戏 zip 旁边找 `neogeo.zip`，默认还要里面有 `uni-bios_4_0.rom`，并且 `000-lo.lo` 必须是 128KB。站点上如果是常见的 MAME 包（64KB 的 `000-lo.lo`，文件名像 `asia-s3.rom`），页面会在浏览器里整理后再交给模拟器，并选一个包里真正有的 68K BIOS。
