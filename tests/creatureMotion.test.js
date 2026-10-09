import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Heightfield } from '../src/terra/heightfield.js';
import { Newt } from '../src/terra/Newt.js';
import { encounterTime, turnVelocity } from '../src/creatures/motion.js';

// Keep the shipped skeleton, geometry and skin weights; omit textures in Node.
async function newtTemplate() {
  const bytes = await readFile(new URL('../public/models/terra/newt.glb', import.meta.url));
  const jsonLength = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString());
  delete json.images; delete json.textures; delete json.materials;
  for (const m of json.meshes) for (const p of m.primitives) delete p.material;
  const binStart = 20 + jsonLength;
  const raw = Buffer.from(JSON.stringify(json));
  const padded = Buffer.alloc(Math.ceil(raw.length / 4) * 4, 32); raw.copy(padded);
  const buffer = Buffer.alloc(20 + padded.length + bytes.length - binStart);
  bytes.copy(buffer, 0, 0, 12); buffer.writeUInt32LE(buffer.length, 8);
  buffer.writeUInt32LE(padded.length, 12); buffer.writeUInt32LE(0x4e4f534a, 16);
  padded.copy(buffer, 20); bytes.copy(buffer, 20 + padded.length, binStart);
  return (await new GLTFLoader().parseAsync(buffer.buffer, '')).scene;
}

test('relative motion anticipates crossing paths but ignores receding animals', () => {
  assert.equal(encounterTime(-4, 0, 0, 8, 0, 0), 0.5);
  assert.equal(encounterTime(-4, 0, 0, -8, 0, 0), 0);
  assert.equal(encounterTime(0, 0, 0, 0, 0, 0), 0);
  assert.equal(encounterTime(-100, 0, 0, 1, 0, 0), 0.65);
});

test('turns preserve angular acceleration limits through direction reversals', () => {
  let velocity = 0;
  for (let frame = 0; frame < 240; frame++) {
    const next = turnVelocity(frame < 120 ? 2 : -2, velocity, 0.9, 2, 1 / 60);
    assert.ok(Math.abs(next - velocity) <= 2 / 60 + 1e-10);
    assert.ok(Math.abs(next) <= 0.9);
    velocity = next;
  }
});

test('actual newt skin stays above sloped and uneven terrain throughout gait and shore transition', async (t) => {
  const template = await newtTemplate();
  const samples = new Float32Array(160 * 160);
  for (let z = 0; z < 160; z++) for (let x = 0; x < 160; x++) samples[z * 160 + x] = 0.3 * Math.sin(x * 0.1) * Math.cos(z * 0.12);
  const hf = new Heightfield(samples, 160, 160, 20, 20, 0.125);
  const terrains = [(x, z) => hf.at(x, z),() => 0, (x, z) => 0.15 * x + 0.2 * z, (x, z) => 0.3 * Math.sin(x * 1.8) + 0.2 * Math.cos(z * 2)];
  const point = new THREE.Vector3();
  let ms = 0, count = 0, maxLift = 0;
  for (const ground of terrains) {
    const world = { ground, depthAt: () => 0, obstacles: [], w: 60, d: 45, waterY: -5, blocked: () => false };
    world.eco = { world, time: 0 };
    const n = new Newt(world, { seed: 42, pos: [0, 0, 0], size: 0.8 }, template);
    n.root.scale.setScalar(n.data.size);
    n.state = 'walk'; n.speed = 1.1; n.yawRate = 0.25;
    for (let frame = 0; frame < 60; frame++) {
      n.heading += 0.013; n.pos.z += 0.018;
      n.pos.y = ground(n.pos.x, n.pos.z);
      n.swimBlend = frame > 40 ? (frame - 40) / 20 : 0;
      n.animate(1 / 60); n.clearanceOffset = 0; n.place(); n.legIK(1 / 60);
      const before = performance.now(); n.enforceSurfaceClearance(); ms += performance.now() - before; count++;
      maxLift = Math.max(maxLift, n.clearanceOffset);
      for (let i = 0; i < n.mesh.geometry.attributes.position.count; i++) {
        n.mesh.getVertexPosition(i, point).applyMatrix4(n.mesh.matrixWorld);
        assert.ok(point.y >= ground(point.x, point.z) + 0.0149, `penetration at vertex ${i}, frame ${frame}`);
      }
    }
  }
  t.diagnostic(`Full skin clearance: ${(ms / count).toFixed(2)} ms/pose on this host; maximum correction ${maxLift.toFixed(3)} cm`);
});
