import { dur, fmtDay, hhmm, litres, monthName, nf, pace, parseTime, shiftMonth, shortDate, ticksFor } from './format';

describe('format', () => {
  test('hours become clock times, rounding up across the hour', () => {
    expect(hhmm(7.5)).toBe('07:30');
    expect(hhmm(20.999)).toBe('21:00');
  });

  test('durations switch to hours at 60 minutes', () => {
    expect(dur(47)).toBe('47 min');
    expect(dur(175)).toBe('2h 55m');
  });

  test('numbers and litres', () => {
    expect(nf(15389.4)).toBe('15,389');
    expect(litres(3400)).toBe('3.40 L');
  });

  test('date keys read as local dates, not UTC', () => {
    expect(fmtDay('2026-10-27')).toBe('Tue 27 Oct');
    expect(shortDate('2026-10-01')).toBe('1 Oct');
  });

  test('months move across year ends', () => {
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(monthName('2026-10')).toEqual({ month: 'October', year: '2026' });
  });

  test('pace never shows 60 seconds', () => {
    expect(pace(47, 9)).toBe('5:13');
    expect(pace(59.99, 10)).toBe('5:59');
  });

  test('parseTime accepts real times only', () => {
    expect(parseTime('07:30')).toBe(7.5);
    expect(parseTime('7:30')).toBe(7.5);
    expect(parseTime(' 19:00 ')).toBe(19);
    expect(parseTime('24:00')).toBeNull();
    expect(parseTime('7.30')).toBeNull();
  });

  test('ticks start at zero and reach the maximum', () => {
    expect(ticksFor(1500)).toEqual([0, 500, 1000, 1500]);
    expect(ticksFor(0)[0]).toBe(0);
    expect(ticksFor(3.4 * 1000).at(-1)).toBeGreaterThanOrEqual(3400);
  });
});
