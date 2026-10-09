import test from 'node:test';
import assert from 'node:assert/strict';
import { PerspectiveCamera } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { configureCameraInput } from '../src/render/cameraInput.js';

function fixture() {
  const doc = new EventTarget();
  doc.defaultView = new EventTarget();
  const canvas = new EventTarget();
  Object.assign(canvas, {
    ownerDocument: doc, style: {}, clientWidth: 1000, clientHeight: 800,
    getRootNode: () => doc,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 800 }),
    setPointerCapture() {}, releasePointerCapture() {},
  });
  const camera = new PerspectiveCamera(38, 1.25, 1, 1200);
  camera.position.set(0, 0, 100);
  const controls = new OrbitControls(camera, canvas);
  configureCameraInput(controls, canvas);
  controls.minDistance = 30;
  controls.maxDistance = 190;
  controls.update();
  return { canvas, doc, camera, controls };
}
function pointer(target, type, id, x, y) {
  const event = new Event(type, { cancelable: true });
  Object.assign(event, { pointerId: id, pointerType: 'touch', clientX: x, clientY: y, pageX: x, pageY: y });
  target.dispatchEvent(event);
}

test('off-center pinch zooms toward the finger midpoint and preserves focus', () => {
  const { canvas, doc, camera, controls } = fixture();
  pointer(canvas, 'pointerdown', 1, 650, 300);
  pointer(canvas, 'pointerdown', 2, 750, 300);
  pointer(doc, 'pointermove', 1, 600, 300);
  pointer(doc, 'pointermove', 2, 800, 300);
  assert.ok(camera.position.distanceTo(controls.target) < 100);
  assert.ok(controls.target.x > 0, 'focus moves toward the right-side pinch');
  assert.ok(controls.target.y > 0, 'focus moves toward the upper pinch');
  pointer(doc, 'pointerup', 1, 600, 300);
  pointer(doc, 'pointerup', 2, 800, 300);
  const focus = controls.target.clone();
  for (let i = 0; i < 120; i++) controls.update();
  assert.ok(controls.target.distanceTo(focus) < 1e-6);
  assert.equal(controls.touchGesture.multiple, true, 'pinch release is not a tap');
  pointer(canvas, 'pointerdown', 3, 500, 400);
  assert.equal(controls.touchGesture.multiple, false, 'new single touch can select');
  pointer(doc, 'pointerup', 3, 500, 400);
  controls.dispose();
});

test('touch cancellation clears tracked fingers for the next gesture', () => {
  const { canvas, doc, controls } = fixture();
  pointer(canvas, 'pointerdown', 1, 300, 300);
  pointer(canvas, 'pointerdown', 2, 400, 300);
  pointer(canvas, 'pointercancel', 1, 300, 300);
  pointer(doc, 'pointercancel', 1, 300, 300);
  pointer(canvas, 'pointercancel', 2, 400, 300);
  pointer(doc, 'pointercancel', 2, 400, 300);
  pointer(canvas, 'pointerdown', 3, 350, 300);
  assert.equal(controls.touchGesture.multiple, false);
  pointer(doc, 'pointerup', 3, 350, 300);
  controls.dispose();
});
