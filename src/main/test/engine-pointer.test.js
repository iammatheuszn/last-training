'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const engineUrl = pathToFileURL(path.join(__dirname, '..', '..', 'renderer', 'engine', 'Engine.js')).href;
const modesUrl = pathToFileURL(path.join(__dirname, '..', '..', 'renderer', 'engine', 'modes.js')).href;

const rect = { left: 500, top: 100, width: 900, height: 480 };

function fakeCanvas() {
  const ctx = {
    setTransform() {},
    fillRect() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    stroke() {},
    arc() {},
    fill() {},
    fillText() {}
  };
  return {
    width: 0,
    height: 0,
    getContext: () => ctx,
    getBoundingClientRect: () => rect,
    addEventListener() {},
    removeEventListener() {}
  };
}

const listeners = new Map();
globalThis.window = {
  devicePixelRatio: 1,
  addEventListener(type, listener) {
    const set = listeners.get(type) || new Set();
    set.add(listener);
    listeners.set(type, set);
  },
  removeEventListener(type, listener) {
    listeners.get(type)?.delete(listener);
  }
};
globalThis.requestAnimationFrame = () => 1;
globalThis.cancelAnimationFrame = () => {};

test('mira segue posição absoluta do ponteiro, não movimento acumulado', async () => {
  const { default: TrainingEngine } = await import(engineUrl);
  const engine = new TrainingEngine(fakeCanvas(), { mode: 'clicking' });

  engine.handleMove({ clientX: 730, clientY: 210, movementX: 99999, movementY: -99999 });
  assert.equal(engine.x, 230);
  assert.equal(engine.y, 110);

  engine.handleMove({ clientX: 120, clientY: 800 });
  assert.equal(engine.x, 0);
  assert.equal(engine.y, 480);

  engine.handleMove({ clientX: 1390, clientY: 100 });
  assert.equal(engine.x, 890);
  assert.equal(engine.y, 0);

  engine.destroy();
});

test('engine registra tempo por alvo, overshoot de flick e tremor', async () => {
  const { default: TrainingEngine } = await import(engineUrl);
  let final = null;
  const flick = new TrainingEngine(fakeCanvas(), {
    mode: 'flick',
    onFinish: result => { final = result; }
  });
  flick.running = true;
  flick.elapsedMs = 1000;
  flick.targets[0].spawnedAt = 200;
  const point = flick.targetPoint(flick.targets[0], flick.elapsedMs);
  flick.x = point.x;
  flick.y = point.y;
  flick.noteAcquired(flick.targets[0]);
  flick.x = point.x + flick.radius(flick.targets[0]) * 2;
  flick.noteOvershoot();
  flick.finish();

  assert.equal(final.category, 'aim');
  assert.equal(final.targetCount, 1);
  assert.equal(final.targetTimeTotalMs, 800);
  assert.equal(final.overshootTotal, 100);
  flick.destroy();

  const hold = new TrainingEngine(fakeCanvas(), { mode: 'crosshair_stability' });
  hold.lastSimX = 100;
  hold.lastSimY = 100;
  hold.x = 100.5;
  hold.trackTremor(8);
  hold.x = 100;
  hold.trackTremor(8);
  assert.ok(hold.tremorMs > 0);
  hold.destroy();
});

test('modalidades cobrem aim e crosshair', async () => {
  const { modeList, modesByCategory } = await import(modesUrl);
  assert.equal(modeList.length, 9);
  assert.equal(modesByCategory('aim').length, 6);
  assert.equal(modesByCategory('crosshair').length, 3);
  assert.ok(modesByCategory('crosshair').every(mode => mode.continuous || mode.kind === 'grid'));
});
