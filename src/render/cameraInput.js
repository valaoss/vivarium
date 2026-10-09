// OrbitControls anchors pinch zoom at the midpoint of the two fingers, and
// wheel/trackpad zoom at the cursor. Two-finger dragging moves that focus.
export function configureCameraInput(controls, canvas) {
  controls.zoomToCursor = true;
  controls.enablePan = true;
  controls.screenSpacePanning = true;
  const touches = new Set();
  const gesture = { multiple: false };
  const start = (event) => {
    if (event.pointerType !== 'touch') return;
    if (touches.size === 0) gesture.multiple = false;
    touches.add(event.pointerId);
    if (touches.size > 1) gesture.multiple = true;
  };
  const end = (event) => touches.delete(event.pointerId);
  // Keep `multiple` until the next gesture: lifting either finger must not
  // turn the end of a pinch into a feed, selection, planting or glass tap.
  canvas.addEventListener('pointerdown', start, true);
  const doc = canvas.ownerDocument;
  doc.addEventListener('pointerup', end, true);
  doc.addEventListener('pointercancel', end, true);
  const reset = () => { touches.clear(); gesture.multiple = true; };
  doc.defaultView?.addEventListener('blur', reset);
  controls.touchGesture = gesture;
  const dispose = controls.dispose.bind(controls);
  controls.dispose = () => {
    canvas.removeEventListener('pointerdown', start, true);
    doc.removeEventListener('pointerup', end, true);
    doc.removeEventListener('pointercancel', end, true);
    doc.defaultView?.removeEventListener('blur', reset);
    dispose();
  };
}
