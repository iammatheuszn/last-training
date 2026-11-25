const root = document.documentElement;
const body = document.body;

function apply(config) {
  if (!config || config.ok === false) return;
  const state = config.data || config;
  const size = Number(state.size);
  const gap = Number(state.gap);
  const thickness = Number(state.thickness);
  const opacity = Number(state.opacity);

  root.style.setProperty('--cross-size', `${Number.isFinite(size) ? size : 34}px`);
  root.style.setProperty('--cross-half-gap', `${Number.isFinite(gap) ? gap / 2 : 4}px`);
  root.style.setProperty('--cross-thickness', `${Number.isFinite(thickness) ? thickness : 2}px`);
  root.style.setProperty('--cross-opacity', String(Number.isFinite(opacity) ? opacity : 0.8));
  body.dataset.visible = state.visible ? 'true' : 'false';
}

const bridge = window.lastTrainingOverlay;
if (bridge) {
  bridge.state().then(apply).catch(() => {
    body.dataset.visible = 'false';
  });
  bridge.onConfig(apply);
}
