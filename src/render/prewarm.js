// Shader ön derleme: ilk kez görünen nesne (yem, iz, kova...) o karede derlenip oyunu dondurmasın.
// Gizli nesneler de derlensin diye görünürlük geçici olarak açılır, derleme bitince geri alınır.
export function prewarm(renderer, scene, camera) {
  const hidden = [];
  scene.traverse((o) => { if (!o.visible) { hidden.push(o); o.visible = true; } });
  const restore = () => { for (const o of hidden) o.visible = false; };
  try {
    const p = renderer.compileAsync ? renderer.compileAsync(scene, camera) : (renderer.compile(scene, camera), null);
    restore();
    return p ?? Promise.resolve();
  } catch (e) {
    restore();
    return Promise.resolve();
  }
}
