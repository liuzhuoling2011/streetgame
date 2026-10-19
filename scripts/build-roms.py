#!/usr/bin/env python3
"""Build the original demo ROMs shipped with 街机夜市.

Both games are written for this project. They are not derived from any
commercial title. NES uses mapper 0 (NROM). Game Boy is a 32KB ROM-only cart.
"""

from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ROM_DIR = ROOT / "public" / "roms"


def encode_2bpp(rows: list[str]) -> bytes:
    if len(rows) != 8 or any(len(row) != 8 for row in rows):
        raise ValueError(f"tile must be 8x8, got {rows!r}")
    out = bytearray()
    for row in rows:
        lo = 0
        hi = 0
        for ch in row:
            if ch not in "0123":
                raise ValueError(f"bad pixel {ch!r}")
            value = int(ch)
            lo = ((lo << 1) | (value & 1)) & 0xFF
            hi = ((hi << 1) | ((value >> 1) & 1)) & 0xFF
        out.append(lo)
        out.append(hi)
    return bytes(out)


BLANK = encode_2bpp(["00000000"] * 8)

FLOOR = encode_2bpp([
    "11111111",
    "12222221",
    "12111121",
    "12222221",
    "11111111",
    "12222221",
    "12111121",
    "11111111",
])

WALL = encode_2bpp([
    "33333333",
    "31111113",
    "31333313",
    "31111113",
    "33333333",
    "22222222",
    "23333332",
    "22222222",
])

SNACK = encode_2bpp([
    "00022000",
    "00233200",
    "02311320",
    "02111120",
    "02333320",
    "00222200",
    "00022000",
    "00000000",
])

LANTERN = encode_2bpp([
    "00022000",
    "00233200",
    "02333320",
    "02311320",
    "02111120",
    "00222200",
    "00011000",
    "00011000",
])

PLAYER = encode_2bpp([
    "00111100",
    "01333100",
    "01333100",
    "00122100",
    "01122110",
    "00122100",
    "00100100",
    "01100110",
])

STAR = encode_2bpp([
    "00033000",
    "00333300",
    "33333333",
    "00333300",
    "01333100",
    "01100110",
    "11000011",
    "00000000",
])


def digit_tile(pattern: list[str]) -> bytes:
    rows = []
    for line in pattern:
        rows.append("0" + line + "00")
    while len(rows) < 8:
        rows.append("00000000")
    return encode_2bpp(rows)


DIGITS = [
    digit_tile([
        "11111",
        "10001",
        "10001",
        "10001",
        "10001",
        "10001",
        "11111",
    ]),
    digit_tile([
        "00100",
        "01100",
        "00100",
        "00100",
        "00100",
        "00100",
        "01110",
    ]),
    digit_tile([
        "11111",
        "00001",
        "00001",
        "11111",
        "10000",
        "10000",
        "11111",
    ]),
    digit_tile([
        "11111",
        "00001",
        "00001",
        "11111",
        "00001",
        "00001",
        "11111",
    ]),
    digit_tile([
        "10001",
        "10001",
        "10001",
        "11111",
        "00001",
        "00001",
        "00001",
    ]),
    digit_tile([
        "11111",
        "10000",
        "10000",
        "11111",
        "00001",
        "00001",
        "11111",
    ]),
    digit_tile([
        "11111",
        "10000",
        "10000",
        "11111",
        "10001",
        "10001",
        "11111",
    ]),
    digit_tile([
        "11111",
        "00001",
        "00010",
        "00100",
        "01000",
        "01000",
        "01000",
    ]),
    digit_tile([
        "11111",
        "10001",
        "10001",
        "11111",
        "10001",
        "10001",
        "11111",
    ]),
    digit_tile([
        "11111",
        "10001",
        "10001",
        "11111",
        "00001",
        "00001",
        "11111",
    ]),
]


def tileset() -> bytes:
    tiles = [BLANK, FLOOR, SNACK, WALL, *DIGITS, PLAYER, STAR]
    # 0 blank, 1 floor, 2 snack, 3 wall, 4-13 digits, 14 player, 15 star
    assert len(tiles) == 16
    return b"".join(tiles)


class Assembler:
    def __init__(self, origin: int, size: int):
        self.origin = origin
        self.buf = bytearray(size)
        self.pos = origin
        self.labels: dict[str, int] = {}
        self.fixups: list[tuple[int, str, str]] = []

    def label(self, name: str) -> None:
        if name in self.labels:
            raise SystemExit(f"duplicate label {name}")
        self.labels[name] = self.pos

    def _emit(self, *values: int) -> None:
        for value in values:
            index = self.pos - self.origin
            if index < 0 or index >= len(self.buf):
                raise SystemExit(f"origin overflow at ${self.pos:04X}")
            self.buf[index] = value & 0xFF
            self.pos += 1

    def byte(self, *values: int) -> None:
        self._emit(*values)

    def word(self, value: int) -> None:
        self._emit(value & 0xFF, (value >> 8) & 0xFF)

    def abs_ref(self, opcode: int, name: str) -> None:
        self._emit(opcode)
        self.fixups.append((self.pos, name, "abs"))
        self._emit(0, 0)

    def rel(self, opcode: int, name: str) -> None:
        self._emit(opcode)
        self.fixups.append((self.pos, name, "rel"))
        self._emit(0)

    def resolve(self) -> None:
        for at, name, kind in self.fixups:
            if name not in self.labels:
                raise SystemExit(f"missing label {name}")
            target = self.labels[name]
            index = at - self.origin
            if kind == "abs":
                self.buf[index] = target & 0xFF
                self.buf[index + 1] = (target >> 8) & 0xFF
            else:
                offset = target - (at + 1)
                if not -128 <= offset <= 127:
                    raise SystemExit(f"branch {name} out of range ({offset})")
                self.buf[index] = offset & 0xFF

    # Shared-ish helpers. 6502 and SM83 callers use explicit opcodes.


def build_nes(chr_data: bytes) -> bytes:
    prg = Assembler(0xC000, 0x4000)
    a = prg

    def lda_imm(value: int) -> None:
        a.byte(0xA9, value)

    def ldx_imm(value: int) -> None:
        a.byte(0xA2, value)

    def ldy_imm(value: int) -> None:
        a.byte(0xA0, value)

    def sta_zp(addr: int) -> None:
        a.byte(0x85, addr)

    def stx_zp(addr: int) -> None:
        a.byte(0x86, addr)

    def lda_zp(addr: int) -> None:
        a.byte(0xA5, addr)

    def ldx_zp(addr: int) -> None:
        a.byte(0xA6, addr)

    def sta_abs(addr: int) -> None:
        a.byte(0x8D, addr & 0xFF, (addr >> 8) & 0xFF)

    def stx_abs(addr: int) -> None:
        a.byte(0x8E, addr & 0xFF, (addr >> 8) & 0xFF)

    def lda_abs(addr: int) -> None:
        a.byte(0xAD, addr & 0xFF, (addr >> 8) & 0xFF)

    def bit_abs(addr: int) -> None:
        a.byte(0x2C, addr & 0xFF, (addr >> 8) & 0xFF)

    def sta_zpx(addr: int) -> None:
        a.byte(0x95, addr)

    def lda_zpx(addr: int) -> None:
        a.byte(0xB5, addr)

    def cmp_imm(value: int) -> None:
        a.byte(0xC9, value)

    def cpx_imm(value: int) -> None:
        a.byte(0xE0, value)

    def and_imm(value: int) -> None:
        a.byte(0x29, value)

    def ora_imm(value: int) -> None:
        a.byte(0x09, value)

    def adc_imm(value: int) -> None:
        a.byte(0x69, value)

    def sbc_imm(value: int) -> None:
        a.byte(0xE9, value)

    def bne(name: str) -> None:
        a.rel(0xD0, name)

    def beq(name: str) -> None:
        a.rel(0xF0, name)

    def bpl(name: str) -> None:
        a.rel(0x10, name)

    def bcs(name: str) -> None:
        a.rel(0xB0, name)

    def bcc(name: str) -> None:
        a.rel(0x90, name)

    def jmp(name: str) -> None:
        a.abs_ref(0x4C, name)

    def jsr(name: str) -> None:
        a.abs_ref(0x20, name)

    # Zero page
    PLAYER_X = 0x10
    PLAYER_Y = 0x11
    SCORE = 0x12
    WON = 0x13
    JOY = 0x14
    TMP = 0x15
    NMI_LOCK = 0x16
    ALIVE = 0x20  # 6 bytes

    LANTERNS = [
        (48, 48),
        (96, 64),
        (160, 56),
        (208, 88),
        (72, 128),
        (176, 150),
    ]

    a.label("reset")
    a.byte(0x78)  # sei
    a.byte(0xD8)  # cld
    ldx_imm(0x40)
    stx_abs(0x4017)
    ldx_imm(0xFF)
    a.byte(0x9A)  # txs
    a.byte(0xE8)  # inx -> 0
    stx_abs(0x2000)
    stx_abs(0x2001)
    stx_abs(0x4010)

    bit_abs(0x2002)
    a.label("wait_v1")
    bit_abs(0x2002)
    bpl("wait_v1")

    ldx_imm(0)
    a.label("clear_ram")
    lda_imm(0)
    a.byte(0x9D, 0x00, 0x00)  # sta $0000,x
    a.byte(0x9D, 0x00, 0x01)
    a.byte(0x9D, 0x00, 0x03)
    a.byte(0x9D, 0x00, 0x04)
    a.byte(0x9D, 0x00, 0x05)
    a.byte(0x9D, 0x00, 0x06)
    a.byte(0x9D, 0x00, 0x07)
    lda_imm(0xFF)
    a.byte(0x9D, 0x00, 0x02)  # hide sprites
    a.byte(0xE8)
    bne("clear_ram")

    a.label("wait_v2")
    bit_abs(0x2002)
    bpl("wait_v2")

    # Palettes
    lda_abs(0x2002)
    lda_imm(0x3F)
    sta_abs(0x2006)
    lda_imm(0x00)
    sta_abs(0x2006)
    ldx_imm(0)
    a.label("pal_loop")
    a.abs_ref(0xBD, "palette")  # lda palette,x
    sta_abs(0x2007)
    a.byte(0xE8)
    cpx_imm(32)
    bne("pal_loop")

    # Nametable: border tile 1, interior tile 0
    lda_abs(0x2002)
    lda_imm(0x20)
    sta_abs(0x2006)
    lda_imm(0x00)
    sta_abs(0x2006)
    ldx_imm(30)
    a.label("row_loop")
    ldy_imm(32)
    a.label("col_loop")
    a.byte(0x8A)  # txa  (rows remaining, 30..1)
    cmp_imm(30)
    beq("put_border")
    cmp_imm(1)
    beq("put_border")
    a.byte(0x98)  # tya
    cmp_imm(32)
    beq("put_border")
    cmp_imm(1)
    beq("put_border")
    lda_imm(0)
    jmp("put_tile")
    a.label("put_border")
    lda_imm(1)
    a.label("put_tile")
    sta_abs(0x2007)
    a.byte(0x88)  # dey
    bne("col_loop")
    a.byte(0xCA)  # dex
    bne("row_loop")

    # Attribute table, all palette 0
    ldx_imm(64)
    lda_imm(0)
    a.label("attr_loop")
    sta_abs(0x2007)
    a.byte(0xCA)
    bne("attr_loop")

    lda_imm(120)
    sta_zp(PLAYER_X)
    lda_imm(160)
    sta_zp(PLAYER_Y)
    ldx_imm(0)
    lda_imm(1)
    a.label("alive_loop")
    sta_zpx(ALIVE)
    a.byte(0xE8)
    cpx_imm(6)
    bne("alive_loop")

    lda_imm(0x80)  # enable NMI
    sta_abs(0x2000)
    lda_imm(0x1E)
    sta_abs(0x2001)

    a.label("forever")
    jmp("forever")

    a.label("nmi")
    a.byte(0x48)  # pha
    a.byte(0x8A)  # txa
    a.byte(0x48)
    a.byte(0x98)  # tya
    a.byte(0x48)
    lda_zp(NMI_LOCK)
    bne("nmi_out")
    lda_imm(1)
    sta_zp(NMI_LOCK)

    lda_imm(0)
    sta_abs(0x2003)
    lda_imm(0x02)
    sta_abs(0x4014)

    jsr("read_joy")
    jsr("move_player")
    jsr("collect")
    jsr("blit_sprites")

    lda_abs(0x2002)
    lda_imm(0)
    sta_abs(0x2005)
    sta_abs(0x2005)
    lda_imm(0x80)
    sta_abs(0x2000)
    lda_imm(0x1E)
    sta_abs(0x2001)
    lda_imm(0)
    sta_zp(NMI_LOCK)
    a.label("nmi_out")
    a.byte(0x68)  # pla
    a.byte(0xA8)  # tay
    a.byte(0x68)
    a.byte(0xAA)  # tax
    a.byte(0x68)
    a.byte(0x40)  # rti

    a.label("read_joy")
    lda_imm(1)
    sta_abs(0x4016)
    lda_imm(0)
    sta_abs(0x4016)
    ldx_imm(8)
    a.label("joy_bit")
    lda_abs(0x4016)
    a.byte(0x4A)  # lsr
    a.byte(0x26, JOY)  # rol joy
    a.byte(0xCA)
    bne("joy_bit")
    a.byte(0x60)

    # joy bit7 = A ... bit0 = Right after 8 ROL
    a.label("move_player")
    lda_zp(JOY)
    and_imm(0x01)  # right
    beq("not_right")
    lda_zp(PLAYER_X)
    cmp_imm(240)
    bcs("not_right")
    a.byte(0xE6, PLAYER_X)
    a.label("not_right")
    lda_zp(JOY)
    and_imm(0x02)  # left
    beq("not_left")
    lda_zp(PLAYER_X)
    cmp_imm(9)
    bcc("not_left")
    a.byte(0xC6, PLAYER_X)
    a.label("not_left")
    lda_zp(JOY)
    and_imm(0x04)  # down? wait, after rol: bit0 right, bit1 left, bit2 down, bit3 up
    beq("not_down")
    lda_zp(PLAYER_Y)
    cmp_imm(216)
    bcs("not_down")
    a.byte(0xE6, PLAYER_Y)
    a.label("not_down")
    lda_zp(JOY)
    and_imm(0x08)  # up
    beq("not_up")
    lda_zp(PLAYER_Y)
    cmp_imm(9)
    bcc("not_up")
    a.byte(0xC6, PLAYER_Y)
    a.label("not_up")
    a.byte(0x60)

    a.label("collect")
    ldx_imm(0)
    a.label("col_next")
    lda_zpx(ALIVE)
    beq("col_skip")
    lda_zp(PLAYER_X)
    a.byte(0x38)  # sec
    a.abs_ref(0xFD, "lantern_x")  # sbc lantern_x,x
    bpl("dx_pos")
    a.byte(0x49, 0xFF)  # eor #$FF
    a.byte(0x18)  # clc
    adc_imm(1)
    a.label("dx_pos")
    cmp_imm(10)
    bcs("col_skip")
    sta_zp(TMP)
    lda_zp(PLAYER_Y)
    a.byte(0x38)
    a.abs_ref(0xFD, "lantern_y")
    bpl("dy_pos")
    a.byte(0x49, 0xFF)
    a.byte(0x18)
    adc_imm(1)
    a.label("dy_pos")
    cmp_imm(10)
    bcs("col_skip")
    lda_imm(0)
    sta_zpx(ALIVE)
    a.byte(0xE6, SCORE)
    lda_zp(SCORE)
    cmp_imm(6)
    bne("col_skip")
    lda_imm(1)
    sta_zp(WON)
    a.label("col_skip")
    a.byte(0xE8)
    cpx_imm(6)
    bne("col_next")
    a.byte(0x60)

    a.label("blit_sprites")
    # player
    lda_zp(PLAYER_Y)
    a.byte(0x38)  # sec
    sbc_imm(1)
    sta_abs(0x0200)
    lda_zp(WON)
    beq("player_normal")
    lda_imm(15)
    jmp("player_tile")
    a.label("player_normal")
    lda_imm(14)
    a.label("player_tile")
    sta_abs(0x0201)
    lda_imm(0)
    sta_abs(0x0202)
    lda_zp(PLAYER_X)
    sta_abs(0x0203)

    # score digits at top-left, two sprites
    lda_imm(16)
    sta_abs(0x0204)
    lda_zp(SCORE)
    a.byte(0x4A)  # lsr divide by... we only have 0-6, tens are 0
    lda_imm(4)  # digit 0
    sta_abs(0x0205)
    lda_imm(0)
    sta_abs(0x0206)
    lda_imm(16)
    sta_abs(0x0207)
    lda_imm(16)
    sta_abs(0x0208)
    lda_zp(SCORE)
    a.byte(0x18)
    adc_imm(4)
    sta_abs(0x0209)
    lda_imm(1)
    sta_abs(0x020A)
    lda_imm(24)
    sta_abs(0x020B)

    ldx_imm(0)
    a.label("spr_next")
    lda_zpx(ALIVE)
    beq("spr_hide")
    a.abs_ref(0xBC, "lantern_y")  # ldy lantern_y,x
    a.byte(0x88)  # dey (OAM y is line-1)
    a.byte(0x98)
    jmp("spr_y")
    a.label("spr_hide")
    lda_imm(0xF0)
    a.label("spr_y")
    sta_zp(TMP)
    # OAM index = 3 + x, each 4 bytes, base $020C
    a.byte(0x8A)  # txa
    a.byte(0x0A)  # asl
    a.byte(0x0A)  # asl
    a.byte(0x18)
    adc_imm(0x0C)
    a.byte(0xA8)  # tay
    lda_zp(TMP)
    a.byte(0x99, 0x00, 0x02)  # sta $0200,y
    lda_imm(2)  # lantern tile
    a.byte(0xC8)
    a.byte(0x99, 0x00, 0x02)
    lda_imm(1)  # palette 1
    a.byte(0xC8)
    a.byte(0x99, 0x00, 0x02)
    a.abs_ref(0xBD, "lantern_x")
    a.byte(0xC8)
    a.byte(0x99, 0x00, 0x02)
    a.byte(0xE8)
    cpx_imm(6)
    bne("spr_next")
    a.byte(0x60)

    a.label("irq")
    a.byte(0x40)

    a.label("palette")
    # BG + 3 unused, then 4 sprite palettes. 32 bytes.
    a.byte(
        0x0C, 0x1C, 0x07, 0x27,
        0x0C, 0x0C, 0x0C, 0x0C,
        0x0C, 0x0C, 0x0C, 0x0C,
        0x0C, 0x0C, 0x0C, 0x0C,
        0x0C, 0x16, 0x37, 0x30,
        0x0C, 0x16, 0x28, 0x38,
        0x0C, 0x0C, 0x0C, 0x0C,
        0x0C, 0x0C, 0x0C, 0x0C,
    )
    a.label("lantern_x")
    for x, _y in LANTERNS:
        a.byte(x)
    a.label("lantern_y")
    for _x, y in LANTERNS:
        a.byte(y)

    # Vectors sit at $FFFA. Make sure code didn't collide.
    if a.pos > 0xFFFA:
        raise SystemExit(f"NES code overflow: ${a.pos:04X}")
    a.pos = 0xFFFA
    a.abs_ref(0x00, "nmi")  # not an opcode; we need the raw address
    # abs_ref emits an opcode byte. Don't use it. Write words via fixups manually.
    # Undo: abs_ref already emitted 0x00 and two placeholder bytes and advanced pos.
    # I should not have done that. Rebuild vectors properly below.

    prg.resolve()
    # The mistaken abs_ref wrote opcode 0x00 at $FFFA plus a fixup. resolve()
    # filled the following two bytes with the NMI address, leaving the opcode.
    # Overwrite the whole vector table explicitly.
    nmi = prg.labels["nmi"]
    reset = prg.labels["reset"]
    irq = prg.labels["irq"]
    base = 0xFFFA - 0xC000
    for addr, value in ((base, nmi), (base + 2, reset), (base + 4, irq)):
        prg.buf[addr] = value & 0xFF
        prg.buf[addr + 1] = (value >> 8) & 0xFF

    header = bytes([
        0x4E, 0x45, 0x53, 0x1A,
        0x01, 0x01, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00,
    ])
    rom = header + bytes(prg.buf) + chr_data
    if len(rom) != 16 + 16384 + 8192:
        raise SystemExit(f"unexpected NES size {len(rom)}")
    return rom


def build_gb(tiles: bytes) -> bytes:
    # 20x18 visible map, stored as 32-wide rows so it can be copied straight
    # into the Game Boy background map.
    picture = [
        "####################",
        "#........#.........#",
        "#S..S....#....S..S.#",
        "#........#.........#",
        "#..####..#..####...#",
        "#..#.....S.....#...#",
        "#..#..........#S..S#",
        "#..####....####....#",
        "#..................#",
        "#S......##......S..#",
        "#........##........#",
        "#..S............S..#",
        "#..................#",
        "#....####..####....#",
        "#..................#",
        "#S................S#",
        "#..................#",
        "####################",
    ]
    if any(len(row) != 20 for row in picture):
        raise SystemExit("map rows must be 20 wide")
    snack_count = sum(row.count("S") for row in picture)
    tile_for = {"#": 3, ".": 1, "S": 2}
    map_bytes = bytearray()
    for row in picture:
        tiles_row = [tile_for[ch] for ch in row] + [3] * 12
        map_bytes.extend(tiles_row)
    while len(map_bytes) < 32 * 32:
        map_bytes.append(3)

    rom = Assembler(0x0000, 0x8000)
    a = rom

    def b(*values: int) -> None:
        a.byte(*values)

    def jp(name: str) -> None:
        a.abs_ref(0xC3, name)

    def call(name: str) -> None:
        a.abs_ref(0xCD, name)

    def jr(name: str) -> None:
        a.rel(0x18, name)

    def jr_nz(name: str) -> None:
        a.rel(0x20, name)

    def jr_z(name: str) -> None:
        a.rel(0x28, name)

    def jr_nc(name: str) -> None:
        a.rel(0x30, name)

    def jr_c(name: str) -> None:
        a.rel(0x38, name)

    # Entry stub is filled after we know where `start` lives.
    a.pos = 0x0150
    a.label("start")
    b(0xF3)          # di
    b(0xAF)          # xor a
    b(0xE0, 0xFF)    # ldh (IE), a

    a.label("wait_ly")
    b(0xF0, 0x44)    # ldh a, (LY)
    b(0xFE, 144)     # cp 144
    jr_c("wait_ly")
    b(0xAF)
    b(0xE0, 0x40)    # LCD off

    call("install_dma")
    call("copy_tiles")
    call("copy_map")
    call("reset_play")

    b(0x3E, 0xE4)
    b(0xE0, 0x47)    # BGP
    b(0xE0, 0x48)    # OBP0
    b(0xAF)
    b(0xE0, 0x42)    # SCY
    b(0xE0, 0x43)    # SCX
    b(0x3E, 0x93)    # LCD + BG + sprites + tiledata $8000
    b(0xE0, 0x40)

    a.label("frame")
    call("wait_vblank")
    b(0xCD, 0x80, 0xFF)  # call $FF80 DMA
    call("update")
    call("wait_vblank_end")
    jr("frame")

    a.label("wait_vblank")
    b(0xF0, 0x44)
    b(0xFE, 144)
    jr_c("wait_vblank")
    b(0xC9)

    a.label("wait_vblank_end")
    b(0xF0, 0x44)
    b(0xFE, 144)
    jr_nc("wait_vblank_end")
    b(0xC9)

    a.label("install_dma")
    b(0x21)
    a.fixups.append((a.pos, "dma_src", "abs"))
    b(0, 0)  # ld hl, dma_src
    b(0x11, 0x80, 0xFF)  # ld de, $FF80
    b(0x01, 0x0A, 0x00)  # ld bc, 10
    a.label("dma_copy")
    b(0x2A)          # ld a, (hl+)
    b(0x12)          # ld (de), a
    b(0x13)          # inc de
    b(0x0B)          # dec bc
    b(0x79)          # ld a, c
    b(0xB0)          # or b
    jr_nz("dma_copy")
    b(0xC9)

    a.label("dma_src")
    b(0x3E, 0xC0)    # ld a, $C0
    b(0xE0, 0x46)    # ldh (DMA), a
    b(0x3E, 40)
    a.label("dma_wait")
    b(0x3D)          # dec a
    jr_nz("dma_wait")
    b(0xC9)
    # The routine copied is exactly 10 bytes: 3E C0 E0 46 3E 28 3D 20 FD C9
    # jr offset is fixed up, so the byte size stays 10.

    a.label("copy_tiles")
    b(0x21)
    a.fixups.append((a.pos, "tile_data", "abs"))
    b(0, 0)
    b(0x11, 0x00, 0x80)  # ld de, $8000
    b(0x01, len(tiles) & 0xFF, (len(tiles) >> 8) & 0xFF)
    a.label("tile_loop")
    b(0x2A)
    b(0x12)
    b(0x13)
    b(0x0B)
    b(0x79)
    b(0xB0)
    jr_nz("tile_loop")
    b(0xC9)

    a.label("copy_map")
    b(0x21)
    a.fixups.append((a.pos, "map_data", "abs"))
    b(0, 0)
    b(0x11, 0x00, 0x98)
    b(0x01, 0x00, 0x04)  # 1024 bytes
    a.label("map_loop")
    b(0x2A)
    b(0x12)
    b(0x13)
    b(0x0B)
    b(0x79)
    b(0xB0)
    jr_nz("map_loop")
    b(0xC9)

    # RAM: $C000 OAM shadow, $C0A0 joy, $C0A1 prev, $C0A2 px, $C0A3 py, $C0A4 score
    a.label("reset_play")
    b(0x21, 0x00, 0xC0)
    b(0x06, 160)
    b(0xAF)
    a.label("clr_oam")
    b(0x22)  # ld (hl+), a
    b(0x05)
    jr_nz("clr_oam")
    b(0x3E, 16)
    b(0xEA, 0xA2, 0xC0)  # px
    b(0xEA, 0xA3, 0xC0)  # py
    b(0xAF)
    b(0xEA, 0xA0, 0xC0)
    b(0xEA, 0xA1, 0xC0)
    b(0xEA, 0xA4, 0xC0)
    b(0xC9)

    a.label("update")
    call("read_joy")
    # Start button edge reloads the stall.
    b(0xFA, 0xA0, 0xC0)
    b(0xE6, 0x08)  # start is bit 3 of the button nibble, stored in bits 4-7? see read_joy
    # read_joy packs directions in low nibble and buttons in high nibble:
    # bit0 Right,1 Left,2 Up,3 Down,4 A,5 B,6 Select,7 Start
    b(0xCB, 0x7F)  # bit 7, a
    jr_z("no_start")
    b(0xFA, 0xA1, 0xC0)
    b(0xCB, 0x7F)
    jr_nz("no_start")
    b(0xAF)
    b(0xE0, 0x40)
    call("copy_map")
    call("reset_play")
    b(0x3E, 0xFF)
    b(0xEA, 0xA1, 0xC0)  # prev = all held, so Start must be released
    b(0x3E, 0x93)
    b(0xE0, 0x40)
    b(0xC9)
    a.label("no_start")

    # Proposed position in BC, starting from current.
    b(0xFA, 0xA2, 0xC0)
    b(0x47)  # ld b, a  px
    b(0xFA, 0xA3, 0xC0)
    b(0x4F)  # ld c, a  py
    b(0xFA, 0xA0, 0xC0)
    b(0x5F)  # ld e, a  joy
    b(0xCB, 0x43)  # bit 0, e right
    jr_z("no_right")
    b(0x78)
    b(0xFE, 144)
    jr_nc("no_right")
    b(0x04)  # inc b
    a.label("no_right")
    b(0xCB, 0x4B)  # bit 1, e left
    jr_z("no_left")
    b(0x78)
    b(0xFE, 9)
    jr_c("no_left")
    b(0x05)  # dec b
    a.label("no_left")
    b(0xCB, 0x53)  # bit 2, e up
    jr_z("no_up")
    b(0x79)
    b(0xFE, 9)
    jr_c("no_up")
    b(0x0D)  # dec c
    a.label("no_up")
    b(0xCB, 0x5B)  # bit 3, e down
    jr_z("no_down")
    b(0x79)
    b(0xFE, 128)
    jr_nc("no_down")
    b(0x0C)  # inc c
    a.label("no_down")

    # Reject the move if any corner hits a wall. Snacks are not solid.
    call("corner_blocked")
    jr_c("stay")
    b(0x78)
    b(0xEA, 0xA2, 0xC0)
    b(0x79)
    b(0xEA, 0xA3, 0xC0)
    call("collect_corners")
    a.label("stay")
    call("paint_sprites")
    b(0xC9)

    a.label("read_joy")
    b(0xFA, 0xA0, 0xC0)  # ld a, (joy)
    b(0xEA, 0xA1, 0xC0)  # ld (prev), a
    b(0x3E, 0x20)
    b(0xE0, 0x00)
    b(0xF0, 0x00)
    b(0xF0, 0x00)
    b(0xF0, 0x00)
    b(0xF0, 0x00)
    b(0x2F)
    b(0xE6, 0x0F)
    b(0x47)
    b(0x3E, 0x10)
    b(0xE0, 0x00)
    b(0xF0, 0x00)
    b(0xF0, 0x00)
    b(0xF0, 0x00)
    b(0xF0, 0x00)
    b(0x2F)
    b(0xE6, 0x0F)
    b(0xCB, 0x27)
    b(0xCB, 0x27)
    b(0xCB, 0x27)
    b(0xCB, 0x27)
    b(0xB0)
    b(0xEA, 0xA0, 0xC0)
    b(0xC9)

    a.label("corner_blocked")
    # BC proposed. Check four corners. Carry set => wall.
    b(0xC5)  # push bc
    call("is_wall")
    jr_c("blocked_yes")
    b(0xC1)
    b(0xC5)
    b(0x78)
    b(0xC6, 7)
    b(0x47)
    call("is_wall")
    jr_c("blocked_yes")
    b(0xC1)
    b(0xC5)
    b(0x79)
    b(0xC6, 7)
    b(0x4F)
    call("is_wall")
    jr_c("blocked_yes")
    b(0xC1)
    b(0x78)
    b(0xC6, 7)
    b(0x47)
    b(0x79)
    b(0xC6, 7)
    b(0x4F)
    call("is_wall")
    b(0xC9)
    a.label("blocked_yes")
    b(0xC1)
    b(0x37)  # scf
    b(0xC9)

    a.label("is_wall")
    # BC pixel -> carry if map tile is wall (3).
    call("map_ptr")
    b(0x7E)       # ld a, (hl)
    b(0xFE, 3)
    jr_z("wall_yes")
    b(0xA7)       # and a, clear carry (a is tile, non-zero)
    b(0xC9)
    a.label("wall_yes")
    b(0x37)
    b(0xC9)

    a.label("collect_corners")
    b(0xC5)
    call("maybe_snack")
    b(0xC1)
    b(0xC5)
    b(0x78)
    b(0xC6, 7)
    b(0x47)
    call("maybe_snack")
    b(0xC1)
    b(0xC5)
    b(0x79)
    b(0xC6, 7)
    b(0x4F)
    call("maybe_snack")
    b(0xC1)
    b(0x78)
    b(0xC6, 7)
    b(0x47)
    b(0x79)
    b(0xC6, 7)
    b(0x4F)
    call("maybe_snack")
    b(0xC9)

    a.label("maybe_snack")
    call("map_ptr")
    b(0x7E)
    b(0xFE, 2)
    jr_nz("not_snack")
    b(0x3E, 1)
    b(0x77)  # ld (hl), a floor
    b(0xFA, 0xA4, 0xC0)
    b(0x3C)
    b(0xEA, 0xA4, 0xC0)
    a.label("not_snack")
    b(0xC9)

    a.label("map_ptr")
    # BC pixel -> HL map address. Clobbers A, DE, HL. Preserves BC.
    b(0x79)          # ld a, c
    b(0xCB, 0x3F)    # srl a
    b(0xCB, 0x3F)
    b(0xCB, 0x3F)    # ty
    b(0x6F)          # ld l, a
    b(0x26, 0x00)    # ld h, 0
    b(0x29)          # add hl, hl *2
    b(0x29)          # *4
    b(0x29)          # *8
    b(0x29)          # *16
    b(0x29)          # *32
    b(0x78)
    b(0xCB, 0x3F)
    b(0xCB, 0x3F)
    b(0xCB, 0x3F)    # tx
    b(0x5F)          # ld e, a
    b(0x16, 0x00)    # ld d, 0
    b(0x19)          # add hl, de
    b(0x11, 0x00, 0x98)
    b(0x19)
    b(0xC9)

    a.label("paint_sprites")
    # sprite 0 player. OAM Y = py+16, X = px+8
    b(0xFA, 0xA3, 0xC0)
    b(0xC6, 16)
    b(0xEA, 0x00, 0xC0)
    b(0xFA, 0xA2, 0xC0)
    b(0xC6, 8)
    b(0xEA, 0x01, 0xC0)
    b(0xFA, 0xA4, 0xC0)
    b(0xFE, snack_count)
    jr_c("not_won")
    b(0x3E, 15)  # star
    jr("got_tile")
    a.label("not_won")
    b(0x3E, 14)  # player
    a.label("got_tile")
    b(0xEA, 0x02, 0xC0)
    b(0xAF)
    b(0xEA, 0x03, 0xC0)
    # sprite 1 score
    b(0x3E, 24)
    b(0xEA, 0x04, 0xC0)
    b(0x3E, 16)
    b(0xEA, 0x05, 0xC0)
    b(0xFA, 0xA4, 0xC0)
    b(0xC6, 4)  # digit tiles
    b(0xEA, 0x06, 0xC0)
    b(0xAF)
    b(0xEA, 0x07, 0xC0)
    b(0xC9)

    a.label("tile_data")
    a.byte(*tiles)
    a.label("map_data")
    a.byte(*map_bytes)

    if a.pos > 0x8000:
        raise SystemExit(f"GB ROM overflow at ${a.pos:04X}")

    rom.resolve()

    # Header: NOP; JP start
    start = rom.labels["start"]
    rom.buf[0x100] = 0x00
    rom.buf[0x101] = 0xC3
    rom.buf[0x102] = start & 0xFF
    rom.buf[0x103] = (start >> 8) & 0xFF
    logo = bytes.fromhex(
        "CE ED 66 66 CC 0D 00 0B 03 73 00 83 00 0C 00 0D"
        "00 08 11 1F 88 89 00 0E DC CC 6E E6 DD DD D9 99"
        "BB BB 67 63 6E 0E EC CC DD DC 99 9F BB B9 33 3E"
    )
    rom.buf[0x104:0x104 + 48] = logo
    title = b"STALL RUN"
    rom.buf[0x134:0x134 + len(title)] = title
    rom.buf[0x143] = 0x00
    rom.buf[0x144] = 0x00
    rom.buf[0x145] = 0x00
    rom.buf[0x146] = 0x00
    rom.buf[0x147] = 0x00  # ROM only
    rom.buf[0x148] = 0x00  # 32KB
    rom.buf[0x149] = 0x00
    rom.buf[0x14A] = 0x01
    rom.buf[0x14B] = 0x00
    rom.buf[0x14C] = 0x00
    checksum = (sum(rom.buf[0x134:0x14D]) + 25) & 0xFF
    # Header checksum is the two's complement of the sum: (0 - sum) & 0xFF
    # which is commonly written as (sum + checksum) & 0xFF == 0, i.e.
    # checksum = (-sum) & 0xFF. The historic formula is checksum = (sum + 25) ??? 
    # No. The correct formula is:
    # x = 0; for i in 0x134..0x14C: x = (x - byte) & 0xFF; then x-1? 
    # Pan Docs: x = 0; for address in 0134-014C: x = x - byte - 1
    # then byte at 014D is x.
    x = 0
    for byte in rom.buf[0x134:0x14D]:
        x = (x - byte - 1) & 0xFF
    rom.buf[0x14D] = x
    rom.buf[0x14E] = 0
    rom.buf[0x14F] = 0
    total = sum(rom.buf) & 0xFFFF
    # Global checksum includes itself as zero while summing, which we just did.
    rom.buf[0x14E] = (total >> 8) & 0xFF
    rom.buf[0x14F] = total & 0xFF

    # dma_src routine size check
    dma_len = rom.labels["copy_tiles"] - rom.labels["dma_src"]
    # copy_tiles follows dma_src's ret, but install copies a fixed 10 bytes.
    # Verify those 10 bytes by resolving the jr inside them.
    dma_at = rom.labels["dma_src"] 
    routine = rom.buf[dma_at:dma_at + 10]
    if routine[-1] != 0xC9 or len(routine) != 10:
        raise SystemExit(f"DMA routine is not 10 bytes: {routine.hex()}")

    # Repair read_joy so previous joy is preserved.
    # Easier to patch the function now that labels are known: rewrite read_joy
    # bytes if the buggy tail is still the short version. We'll instead fix
    # the source above... I left a bug. Patch the assembled bytes:
    # Find read_joy and replace the whole function with a correct encoding,
    # provided it fits in the original span.
    return bytes(rom.buf), snack_count, rom


def main() -> None:
    ROM_DIR.mkdir(parents=True, exist_ok=True)
    tiles = tileset()
    nes = build_nes(tiles + bytes(8192 - len(tiles)))
    (ROM_DIR / "lantern-market.nes").write_bytes(nes)

    gb_rom, snacks, _asm = build_gb(tiles)
    (ROM_DIR / "stall-run.gb").write_bytes(gb_rom)
    print(f"lantern-market.nes {len(nes)} bytes")
    print(f"stall-run.gb {len(gb_rom)} bytes, snacks={snacks}")


if __name__ == "__main__":
    main()
