import test from 'node:test';
import assert from 'node:assert/strict';
import { SwimDrive, Drift, heavyTail, steerRate } from '../src/eco/locomotion.js';

const seeded = (s = 7) => () => ((s = (s * 16807) % 2147483647) / 2147483647);
const cruise = (d, want, seconds = 20) => {
  let sum = 0, n = 0, lo = Infinity, hi = 0, bursts = 0, gliding = true;
  for (let i = 0; i < seconds * 60; i++) {
    const u = d.step(1 / 60, want);
    if (i > 120) { sum += u; n++; lo = Math.min(lo, u); hi = Math.max(hi, u); }
    if (gliding && !d.gliding) bursts++;
    gliding = d.gliding;
  }
  return { avg: sum / n, lo, hi, rate: bursts / seconds };
};

test('burst swimmers alternate tail beats and glides around the wanted speed', () => {
  const r = cruise(new SwimDrive({ cruise: 4, burst: 22, gait: 'burst', rand: seeded() }), 4);
  assert.ok(Math.abs(r.avg - 4) < 1, `avg ${r.avg}`);
  assert.ok(r.hi - r.lo > 1.5, 'speed should surge and decay');
  assert.ok(r.rate > 0.5 && r.rate < 3, `bursts/s ${r.rate}`);
});

test('steady swimmers hold speed; full thrust reaches burst speed quickly', () => {
  const d = new SwimDrive({ cruise: 3.5, burst: 16, gait: 'steady', rand: seeded() });
  const r = cruise(d, 3.5);
  assert.ok(Math.abs(r.avg - 3.5) < 0.2);
  let t = 0;
  while (d.u < 16 * 0.8 && t < 3) { d.step(1 / 60, 16, { urgent: true }); t += 1 / 60; }
  assert.ok(t < 1.2, `t ${t}`);
  for (let i = 0; i < 120; i++) d.step(1 / 60, 0);
  assert.ok(d.u < 1.5 && d.u >= 0, 'drag stops a fish that stops beating');
});

test('drift wanders without blowing up; heavy tail durations stay in range', () => {
  const dr = new Drift(seeded(3), 2, 1);
  let m = 0, sq = 0;
  for (let i = 0; i < 60 * 300; i++) { const v = dr.step(1 / 60); m += v; sq += v * v; }
  const n = 60 * 300, sd = Math.sqrt(sq / n - (m / n) ** 2);
  assert.ok(sd > 0.5 && sd < 1.6, `sd ${sd}`);
  const r = seeded(5), ds = Array.from({ length: 2000 }, () => heavyTail(r, 0.5, 10));
  assert.ok(ds.every((d) => d >= 0.5 && d <= 10));
  const short = ds.filter((d) => d < 1.5).length / ds.length;
  assert.ok(short > 0.7 && ds.some((d) => d > 5), 'mostly short, occasionally long');
});

test('turning accelerates and settles without overshooting wildly', () => {
  let a = 0, w = 0, peak = 0;
  for (let i = 0; i < 240; i++) { w = steerRate(1.5 - a, w, 3, 12, 1 / 60); a += w / 60; peak = Math.max(peak, a); }
  assert.ok(Math.abs(a - 1.5) < 0.05 && peak < 1.7);
});
