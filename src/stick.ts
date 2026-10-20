/** 8-way arcade stick. Screen Y grows downward. Sector 0 is right, then clockwise. */

export interface StickAxes {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
}

export interface StickState {
  engaged: boolean;
  sector: number;
  axes: StickAxes;
  knobX: number;
  knobY: number;
}

const SECTORS = 8;
const SECTOR_ARC = (Math.PI * 2) / SECTORS;
const HALF = SECTOR_ARC / 2;
const HYSTERESIS = (12 * Math.PI) / 180;
const ENGAGE = 0.28;
const RELEASE = 0.18;

const SECTOR_AXES: StickAxes[] = [
  { up: false, down: false, left: false, right: true },
  { up: false, down: true, left: false, right: true },
  { up: false, down: true, left: false, right: false },
  { up: false, down: true, left: true, right: false },
  { up: false, down: false, left: true, right: false },
  { up: true, down: false, left: true, right: false },
  { up: true, down: false, left: false, right: false },
  { up: true, down: false, left: false, right: true },
];

export function neutralStick(): StickState {
  return {
    engaged: false,
    sector: -1,
    axes: { up: false, down: false, left: false, right: false },
    knobX: 0,
    knobY: 0,
  };
}

function wrap(angle: number): number {
  let value = angle;
  while (value > Math.PI) value -= Math.PI * 2;
  while (value < -Math.PI) value += Math.PI * 2;
  return value;
}

function angularDistance(a: number, b: number): number {
  return Math.abs(wrap(a - b));
}

export function sectorCenter(sector: number): number {
  const angle = sector * SECTOR_ARC;
  return angle > Math.PI ? angle - Math.PI * 2 : angle;
}

function nearestSector(angle: number): number {
  let best = 0;
  let bestDistance = Infinity;
  for (let sector = 0; sector < SECTORS; sector += 1) {
    const distance = angularDistance(angle, sectorCenter(sector));
    if (distance < bestDistance) {
      best = sector;
      bestDistance = distance;
    }
  }
  return best;
}

function pickSector(angle: number, previous: number): number {
  if (previous >= 0 && angularDistance(angle, sectorCenter(previous)) <= HALF + HYSTERESIS) {
    return previous;
  }
  return nearestSector(angle);
}

export function stepStick(dx: number, dy: number, radius: number, previous: StickState): StickState {
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || !Number.isFinite(radius) || radius <= 0) {
    return neutralStick();
  }
  const magnitude = Math.hypot(dx, dy) / radius;
  const engaged = previous.engaged ? magnitude > RELEASE : magnitude >= ENGAGE;
  if (!engaged) return neutralStick();

  const angle = Math.atan2(dy, dx);
  const sector = pickSector(angle, previous.sector);
  const center = sectorCenter(sector);
  const reach = Math.min(1, magnitude);
  return {
    engaged: true,
    sector,
    axes: SECTOR_AXES[sector],
    knobX: Math.cos(center) * reach,
    knobY: Math.sin(center) * reach,
  };
}

export function axesConflict(axes: StickAxes): boolean {
  return (axes.left && axes.right) || (axes.up && axes.down);
}

export function runStickChecks(): void {
  const radius = 100;
  const neutral = neutralStick();
  const still = stepStick(0, 0, radius, neutral);
  assert(!still.engaged, 'center is neutral');

  const nudge = stepStick(10, 0, radius, neutral);
  assert(!nudge.engaged, 'inside the dead zone stays neutral');

  const almost = stepStick(20, 0, radius, neutral);
  assert(!almost.engaged, 'engage threshold is not the release threshold');

  const right = stepStick(40, 0, radius, neutral);
  assert(right.engaged && right.axes.right && !right.axes.left && !right.axes.up && !right.axes.down, 'cardinal right');
  assert(!axesConflict(right.axes), 'right has no opposite');

  const held = stepStick(22, 0, radius, right);
  assert(held.engaged && held.axes.right, 'radial hysteresis keeps a direction');

  const dropped = stepStick(10, 0, radius, right);
  assert(!dropped.engaged && dropped.knobX === 0 && dropped.knobY === 0, 'release resets');

  const shallow = stepStick(40, 8, radius, neutral);
  assert(shallow.sector === 0 && shallow.axes.right && !shallow.axes.down, 'shallow angle stays right');

  const diagonal = stepStick(40, 40, radius, neutral);
  assert(diagonal.sector === 1 && diagonal.axes.right && diagonal.axes.down, 'down-right diagonal');

  const up = stepStick(0, -50, radius, neutral);
  assert(up.sector === 6 && up.axes.up && !up.axes.down, 'up');

  const left = stepStick(-50, 0, radius, neutral);
  assert(left.sector === 4 && left.axes.left && !left.axes.right, 'left');

  const stay = stepStick(40 * Math.cos((30 * Math.PI) / 180), 40 * Math.sin((30 * Math.PI) / 180), radius, right);
  assert(stay.sector === 0, 'hysteresis holds the previous sector');

  const leave = stepStick(40 * Math.cos((40 * Math.PI) / 180), 40 * Math.sin((40 * Math.PI) / 180), radius, right);
  assert(leave.sector === 1 && leave.axes.down && leave.axes.right, 'past the gate it changes sector');

  let state = neutral;
  const samples = [0, 20, 40, 70, 100, 130, 160, 200, 250, 300, 340];
  for (const deg of samples) {
    const rad = (deg * Math.PI) / 180;
    state = stepStick(Math.cos(rad) * 50, Math.sin(rad) * 50, radius, state);
    assert(state.engaged && !axesConflict(state.axes), `no jitter opposites at ${deg}`);
  }

  const again = stepStick(0, 0, radius, state);
  assert(!again.engaged && !again.axes.up && !again.axes.down && !again.axes.left && !again.axes.right, 'full release clears every direction');
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}
