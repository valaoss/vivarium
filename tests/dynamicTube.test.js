import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3, CatmullRomCurve3, TubeGeometry } from 'three';
import { updateTubeGeometry } from '../src/world/dynamicTube.js';

test('moving hose matches rebuilt geometry without replacing buffers', () => {
  const curve = new CatmullRomCurve3([
    new Vector3(0, 40, 0), new Vector3(0, 44, 17), new Vector3(1, 38, 22),
    new Vector3(5, -8, 24), new Vector3(10, -32, 30), new Vector3(11, -50, 33),
  ]);
  const geo = new TubeGeometry(curve, 64, 0.65, 8, false);
  const position = geo.attributes.position, normal = geo.attributes.normal, index = geo.index;
  for (let step = 0; step < 30; step++) {
    curve.points[0].x = Math.sin(step) * 20;
    curve.points[1].x = curve.points[0].x;
    curve.updateArcLengths();
    updateTubeGeometry(geo, curve);
    const reference = new TubeGeometry(curve, 64, 0.65, 8, false);
    assert.equal(geo.attributes.position, position);
    assert.equal(geo.attributes.normal, normal);
    assert.equal(geo.index, index);
    for (const key of ['position', 'normal']) {
      const a = geo.attributes[key].array, b = reference.attributes[key].array;
      for (let i = 0; i < a.length; i++) assert.ok(Math.abs(a[i] - b[i]) < 1e-5);
    }
    assert.ok(Number.isFinite(geo.boundingSphere.radius));
    reference.dispose();
  }
  geo.dispose();
});
