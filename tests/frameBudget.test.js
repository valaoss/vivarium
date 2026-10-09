import test from 'node:test';
import assert from 'node:assert/strict';
import { FrameBudget } from '../src/render/frameBudget.js';

const run = (budget, fps, seconds) => {
  const changes = [];
  for (let i = 0; i < fps * seconds; i++) {
    const ratio = budget.sample(1 / fps);
    if (ratio !== null) changes.push(ratio);
  }
  return changes;
};
test('sustained load reduces resolution, within device limits', () => {
  const b = new FrameBudget(2);
  assert.deepEqual(run(b, 30, 2), []);
  assert.deepEqual(run(b, 30, 2), [1.8]);
  run(b, 30, 30);
  assert.equal(b.ratio, 0.75);
  assert.ok(run(b, 30, 6).includes('degrade'));
});
test('healthy rendering recovers slowly without exceeding native cap', () => {
  const b = new FrameBudget(1.5);
  run(b, 30, 20);
  assert.equal(b.ratio, 0.75);
  assert.deepEqual(run(b, 60, 6), []);
  run(b, 60, 90);
  assert.equal(b.ratio, 1.5);
});
test('tab suspension and invalid deltas do not reduce quality', () => {
  const b = new FrameBudget(1);
  for (const dt of [0, -1, NaN, Infinity, 4, 0.2]) assert.equal(b.sample(dt), null);
  assert.deepEqual(run(b, 60, 4), []);
  assert.equal(b.ratio, 1);
});
test('brief load spikes do not trigger a resolution change', () => {
  const b = new FrameBudget(2);
  run(b, 30, 0.5);
  assert.deepEqual(run(b, 60, 3), []);
});
test('a device on the edge does not pump resolution up and down', () => {
  const b = new FrameBudget(1.5);
  let changes = 0;
  // en yüksek çözünürlükte yavaş, bir kademe aşağıda hızlı
  for (let i = 0; i < 60 * 300; i++) {
    const fps = b.ratio >= 1.4 ? 38 : 60;
    if (b.sample(1 / fps) !== null) changes++;
  }
  assert.ok(changes <= 10, `changes ${changes}`);
});
