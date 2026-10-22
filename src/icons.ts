const NS = 'http://www.w3.org/2000/svg';

type IconNode = { tag: string; attrs: Record<string, string> };

const ICONS: Record<string, IconNode[]> = {
  restart: [
    { tag: 'path', attrs: { d: 'M20 12a8 8 0 1 1-2.3-5.7' } },
    { tag: 'path', attrs: { d: 'M20 4v5h-5' } },
  ],
  pause: [
    { tag: 'path', attrs: { d: 'M9 5v14' } },
    { tag: 'path', attrs: { d: 'M15 5v14' } },
  ],
  play: [
    { tag: 'path', attrs: { d: 'M8 5.5v13l11-6.5-11-6.5z' } },
  ],
  save: [
    { tag: 'path', attrs: { d: 'M12 4v9' } },
    { tag: 'path', attrs: { d: 'M8 10l4 4 4-4' } },
    { tag: 'path', attrs: { d: 'M5 19h14' } },
  ],
  load: [
    { tag: 'path', attrs: { d: 'M12 15V6' } },
    { tag: 'path', attrs: { d: 'M8 9l4-4 4 4' } },
    { tag: 'path', attrs: { d: 'M5 19h14' } },
  ],
  gamepad: [
    { tag: 'rect', attrs: { x: '3', y: '8', width: '18', height: '10', rx: '4' } },
    { tag: 'path', attrs: { d: 'M8 11v4M6 13h4' } },
    { tag: 'circle', attrs: { cx: '15.5', cy: '12', r: '0.8' } },
    { tag: 'circle', attrs: { cx: '18', cy: '14', r: '0.8' } },
  ],
  cheats: [
    { tag: 'path', attrs: { d: 'M9 7L4 12l5 5' } },
    { tag: 'path', attrs: { d: 'M15 7l5 5-5 5' } },
  ],
  storage: [
    { tag: 'ellipse', attrs: { cx: '12', cy: '6', rx: '7', ry: '3' } },
    { tag: 'path', attrs: { d: 'M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6' } },
    { tag: 'path', attrs: { d: 'M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3' } },
  ],
  volume: [
    { tag: 'path', attrs: { d: 'M4 10v4h3l4 3V7L7 10H4' } },
    { tag: 'path', attrs: { d: 'M16 9.5a3.5 3.5 0 0 1 0 5' } },
    { tag: 'path', attrs: { d: 'M16.5 7a6 6 0 0 1 0 10' } },
  ],
  muted: [
    { tag: 'path', attrs: { d: 'M4 10v4h3l4 3V7L7 10H4' } },
    { tag: 'path', attrs: { d: 'M16 10l4 4M20 10l-4 4' } },
  ],
  menu: [
    { tag: 'path', attrs: { d: 'M4 7h16' } },
    { tag: 'path', attrs: { d: 'M4 12h16' } },
    { tag: 'path', attrs: { d: 'M4 17h16' } },
  ],
  fullscreen: [
    { tag: 'path', attrs: { d: 'M4 9V4h5' } },
    { tag: 'path', attrs: { d: 'M20 9V4h-5' } },
    { tag: 'path', attrs: { d: 'M4 15v5h5' } },
    { tag: 'path', attrs: { d: 'M20 15v5h-5' } },
  ],
  fullscreenExit: [
    { tag: 'path', attrs: { d: 'M9 4v5H4' } },
    { tag: 'path', attrs: { d: 'M15 4v5h5' } },
    { tag: 'path', attrs: { d: 'M9 20v-5H4' } },
    { tag: 'path', attrs: { d: 'M15 20v-5h5' } },
  ],
  exit: [
    { tag: 'path', attrs: { d: 'M6 6l12 12' } },
    { tag: 'path', attrs: { d: 'M18 6L6 18' } },
  ],
  star: [
    { tag: 'path', attrs: { d: 'M12 3.2 14.7 8.7 20.7 9.4 16.2 13.6 17.4 19.6 12 16.6 6.6 19.6 7.8 13.6 3.3 9.4 9.3 8.7 12 3.2z' } },
  ],
};

export type IconName = keyof typeof ICONS | 'gear';

export function icon(name: IconName): SVGSVGElement {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.75');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  if (name === 'gear') {
    appendGear(svg);
    return svg;
  }
  for (const node of ICONS[name]) {
    const element = document.createElementNS(NS, node.tag);
    for (const [key, value] of Object.entries(node.attrs)) element.setAttribute(key, value);
    svg.append(element);
  }
  return svg;
}

function appendGear(svg: SVGSVGElement): void {
  const circle = document.createElementNS(NS, 'circle');
  circle.setAttribute('cx', '12');
  circle.setAttribute('cy', '12');
  circle.setAttribute('r', '3');
  svg.append(circle);
  for (let step = 0; step < 8; step += 1) {
    const angle = (step * Math.PI) / 4;
    const line = document.createElementNS(NS, 'line');
    line.setAttribute('x1', String(12 + Math.cos(angle) * 5.2));
    line.setAttribute('y1', String(12 + Math.sin(angle) * 5.2));
    line.setAttribute('x2', String(12 + Math.cos(angle) * 8.2));
    line.setAttribute('y2', String(12 + Math.sin(angle) * 8.2));
    svg.append(line);
  }
}
