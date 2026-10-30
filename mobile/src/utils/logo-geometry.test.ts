import { RING_RADIUS, gaugeArcs } from './logo-geometry';

const ends = (arc: string): number[][] => {
  const numbers = arc.match(/-?\d+(\.\d+)?/g)!.map(Number);
  return [numbers.slice(0, 2), numbers.slice(-2)];
};
const onRing = ([x, y]: number[]): number => Math.hypot(x - 512, y - 512);

describe('gaugeArcs', () => {
  test('draws one arc per training zone', () => {
    expect(gaugeArcs()).toHaveLength(5);
  });

  test('every arc starts and ends on the ring', () => {
    for (const arc of gaugeArcs()) {
      for (const end of ends(arc)) expect(onRing(end)).toBeCloseTo(RING_RADIUS, 0);
    }
  });

  test('the dial opens symmetrically at the bottom', () => {
    const arcs = gaugeArcs();
    const [startX, startY] = ends(arcs[0])[0];
    const [endX, endY] = ends(arcs[4])[1];
    expect(startX + endX).toBeCloseTo(1024, 0);
    expect(startY).toBeCloseTo(endY, 0);
    expect(startY).toBeGreaterThan(512);
  });
});
