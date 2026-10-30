// The Gauge logo in 1024 units, the same numbers scripts/make_icons.py uses for the app icons and splash image.
const CENTER = 512;
const SWEEP = 270;
const START = 135; // degrees clockwise from 3 o'clock, so the dial is open at the bottom
const GAP = 8;
const SEGMENTS = 5;

export const RING_RADIUS = 340;
export const RING_WIDTH = 78;
export const LOGO_VIEW_BOX = '130 130 764 764'; // the mark without the icon's margin, same crop as splash-icon.png
export const LOGO_Z = 'M362 368H662V437.6L466.4 586.4H662V656H362V586.4L557.6 437.6H362Z';

function point(degrees: number): string {
  const radians = (degrees * Math.PI) / 180;
  const x = CENTER + RING_RADIUS * Math.cos(radians);
  const y = CENTER + RING_RADIUS * Math.sin(radians);
  return `${x.toFixed(1)} ${y.toFixed(1)}`;
}

export function gaugeArcs(): string[] {
  const each = (SWEEP - GAP * (SEGMENTS - 1)) / SEGMENTS;
  return Array.from({ length: SEGMENTS }, (_, i) => {
    const from = START + i * (each + GAP);
    return `M${point(from)}A${RING_RADIUS} ${RING_RADIUS} 0 0 1 ${point(from + each)}`;
  });
}
