// UI wiring -- connects DOM controls to TileCanvas and generators

import { PALETTES, getPaletteColors, getPaletteBgIdx, hexToRgb, rgbToHex, rgbToHsl, hslToRgb, generateRandomPalette } from './palettes.js';
import {
  generateVoronoi, generateNoise, generateDigital, generateBlotch,
  generateStripe, generateBrushstroke, generateFleck,
  generateRain, generateChip, generateGeometric,
  generateHoneycomb, generateCarbon, generateContour, generateMetaball,
} from './generators.js';
import { PATTERN_PRESETS } from './presets.js';
import { extractPalette, loadImageData } from './imageColors.js';

// ---- all available generators ----
const GENERATOR_KEYS = [
  'voronoi', 'noise', 'digital', 'blotch', 'metaball',
  'stripe', 'brushstroke', 'fleck', 'rain', 'chip', 'geometric',
  'honeycomb', 'carbon', 'contour',
];

const PALETTE_KEYS = Object.keys(PALETTES).filter(k => k !== 'custom');

function pickRandom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

// ---- DOM ref cache (populated in initUI) ----
// hot-path elements touched on every slider move, swatch click, keyboard shortcut
const dom = {};
function $(id) { return dom[id] ?? (dom[id] = document.getElementById(id)); }

// ---- app state ----
const state = {
  tool:        'brush',
  palette:     getPaletteColors('woodland'),
  activeIdx:   0,
  activeRgb:   [74, 103, 65],
  activeRgb2:  [40, 30, 20],   // secondary color
  activeSlot:  'primary',      // which color slot the swatches/sliders edit
  generator:   'voronoi',
  seed:        1337,
  tileCanvas:  null,
  // blend buffers
  blendA: null,
  blendB: null,
};

// ---- init ----

export function initUI(tc) {
  state.tileCanvas = tc;

  setupTheme();
  setupToolbar();
  setupGeneratorPanel();
  setupPresetPanel();
  setupUserPresets();
  setupBlendPanel();
  setupPalettePanel();
  setupBrushPanel();
  setupStampLibrary();
  setupImageUpload();
  setupRandomPalette();
  setupSeamless();
  setupExport();

  tc.onColorPick = (rgb, hex) => {
    // eyedropper drops into whichever slot is active
    if (state.activeSlot === 'primary') state.activeRgb  = rgb;
    else                                state.activeRgb2 = rgb;
    applyColorToUI(rgb);
  };

  tc.onStatusHint = (text) => {
    const el = document.getElementById('canvas-hint');
    if (el) el.textContent = text;
  };

  // sync UI when brush changes via keyboard shortcuts
  tc.onBrushChange = ({ size, opacity, hardness }) => {
    const sizeSl = document.getElementById('brush-size');
    const opaSl  = document.getElementById('brush-opacity');
    const hardSl = document.getElementById('brush-hardness');
    sizeSl.value = size;
    document.getElementById('brush-size-val').textContent = size;
    opaSl.value = Math.round(opacity * 100);
    document.getElementById('brush-opacity-val').textContent = Math.round(opacity * 100) + '%';
    hardSl.value = Math.round(hardness * 100);
    document.getElementById('brush-hardness-val').textContent = Math.round(hardness * 100) + '%';
  };

  // show only the active tool's panel sections (universal controls stay)
  syncToolPanelVisibility(state.tool);

  // random algo + palette + seed on load
  randomizeAll();
}

// ---- theme ----

function setupTheme() {
  const stored = (() => {
    try { return localStorage.getItem('camojack:theme'); } catch { return null; }
  })();
  applyTheme(stored === 'light' ? 'light' : 'dark');

  const btn = document.getElementById('btn-theme');
  if (!btn) return;
  btn.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    applyTheme(next);
    try { localStorage.setItem('camojack:theme', next); } catch {}
  });
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const btn = document.getElementById('btn-theme');
  if (btn) btn.textContent = theme === 'light' ? 'Dark' : 'Light';
}

// ---- toolbar ----

function setupToolbar() {
  const keyMap = {
    b: 'brush', e: 'eraser', s: 'smear',
    o: 'blob',  a: 'spray',  f: 'fill', p: 'picker',
    c: 'clone', l: 'line',   g: 'gradient',
    r: 'rect',
  };

  document.querySelectorAll('.tool-btn').forEach(btn => {
    btn.addEventListener('click', () => setTool(btn.dataset.tool));
  });

  window.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    if (e.ctrlKey || e.altKey) return;

    const key = e.key.toLowerCase();

    // X swaps primary/secondary color
    if (key === 'x') {
      swapColors();
      return;
    }

    const t = keyMap[key];
    if (t) setTool(t);
  });

  document.getElementById('btn-undo').addEventListener('click', () => state.tileCanvas.undo());
  document.getElementById('btn-redo').addEventListener('click', () => state.tileCanvas.redo());
  const btnInvert = document.getElementById('btn-invert');
  if (btnInvert) btnInvert.addEventListener('click', () => state.tileCanvas.invert());

  document.getElementById('tile-size-sel').addEventListener('change', e => {
    const s = parseInt(e.target.value);
    state.tileCanvas.resize(s);
    document.getElementById('canvas-dim').textContent = `${s} \u00d7 ${s}`;
  });
}

// cached on first call
let _toolBtns = null;
let _toolSections = null;
function setTool(tool) {
  state.tool = tool;
  state.tileCanvas.setTool(tool);
  if (!_toolBtns) _toolBtns = document.querySelectorAll('.tool-btn');
  for (let i = 0; i < _toolBtns.length; i++) {
    _toolBtns[i].classList.toggle('active', _toolBtns[i].dataset.tool === tool);
  }
  syncToolPanelVisibility(tool);
}

// each tool-specific section declares data-show-for="tool1 tool2 ...".
// universal controls (size/opacity/hardness/spacing/symmetry) live outside
// any .tool-section and are always visible.
function syncToolPanelVisibility(tool) {
  if (!_toolSections) _toolSections = document.querySelectorAll('.tool-section');
  for (let i = 0; i < _toolSections.length; i++) {
    const sec = _toolSections[i];
    const tools = (sec.dataset.showFor || '').split(/\s+/);
    sec.hidden = !tools.includes(tool);
  }
}

function swapColors() {
  const tc = state.tileCanvas;
  tc.swapColors();
  const tmp = state.activeRgb;
  state.activeRgb = [...state.activeRgb2];
  state.activeRgb2 = [...tmp];
  // both previews swap visually; active slot stays the same
  document.getElementById('color-preview').style.background  = '#' + rgbToHex(state.activeRgb);
  document.getElementById('color2-preview').style.background = '#' + rgbToHex(state.activeRgb2);
  // refresh sliders to whichever slot is active now
  const activeRgb = state.activeSlot === 'primary' ? state.activeRgb : state.activeRgb2;
  refreshSliders(activeRgb);
}

// switch which color slot the HSL / hex / palette-click controls edit.
// just updates state + visual outline -- doesn't mutate any color.
function setActiveSlot(slot) {
  state.activeSlot = slot;
  document.querySelectorAll('.color-slot').forEach(el => {
    el.classList.toggle('active', el.dataset.slot === slot);
  });
  const rgb = slot === 'primary' ? state.activeRgb : state.activeRgb2;
  refreshSliders(rgb);
}

// update the hex input and HSL sliders to reflect a given color without
// mutating either slot (used after slot switches and swap).
function refreshSliders(rgb) {
  const hex = rgbToHex(rgb);
  const [h, s, l] = rgbToHsl(rgb);
  $('hex-input').value = hex.toUpperCase();
  $('hue-sl').value = h;  $('hue-val').textContent = h;
  $('sat-sl').value = s;  $('sat-val').textContent = s;
  $('lit-sl').value = l;  $('lit-val').textContent = l;
}

// ---- generator panel ----

const PARAM_DEFS = {
  voronoi: [
    { id: 'seed-count',    label: 'Seeds',    min: 2,    max: 64,   value: 12,  step: 1    },
    { id: 'gen-scale',     label: 'Scale',    min: 0.2,  max: 5,    value: 1.0, step: 0.05 },
    { id: 'gen-softness',  label: 'Softness', min: 0,    max: 1,    value: 0,   step: 0.05 },
    { id: 'gen-border',    label: 'Border',   min: 0,    max: 1,    value: 0,   step: 0.05 },
  ],
  noise: [
    { id: 'gen-scale',     label: 'Scale',    min: 0.2,  max: 16,   value: 2.5, step: 0.1  },
    { id: 'gen-octaves',   label: 'Octaves',  min: 1,    max: 10,   value: 5,   step: 1    },
    { id: 'gen-warp',      label: 'Warp',     min: 0,    max: 6,    value: 1.8, step: 0.1  },
  ],
  digital: [
    { id: 'gen-cell',      label: 'Cell px',  min: 1,    max: 40,   value: 5,   step: 1    },
    { id: 'gen-scale',     label: 'Scale',    min: 0.5,  max: 16,   value: 3.5, step: 0.5  },
    { id: 'gen-octaves',   label: 'Octaves',  min: 1,    max: 8,    value: 3,   step: 1    },
  ],
  blotch: [
    { id: 'blob-count',    label: 'Count',    min: 1,    max: 120,  value: 20,  step: 1    },
    { id: 'blob-min',      label: 'Min Size', min: 0.01, max: 0.30, value: 0.04,step: 0.01 },
    { id: 'blob-max',      label: 'Max Size', min: 0.02, max: 0.60, value: 0.18,step: 0.01 },
    { id: 'gen-softness',  label: 'Softness', min: 0,    max: 1,    value: 0,   step: 0.05 },
    { id: 'blob-noise',    label: 'Jitter',   min: 0,    max: 1.5,  value: 0.60,step: 0.05 },
  ],
  metaball: [
    { id: 'mb-clusters',   label: 'Clusters', min: 4,    max: 60,   value: 18,  step: 1    },
    { id: 'mb-core',       label: 'Core Size',min: 0.03, max: 0.20, value: 0.08,step: 0.01 },
    { id: 'mb-satellites', label: 'Lobes',    min: 2,    max: 8,    value: 5,   step: 1    },
    { id: 'mb-spread',     label: 'Spread',   min: 0.3,  max: 1.5,  value: 0.9, step: 0.05 },
    { id: 'mb-sat-size',   label: 'Lobe Size',min: 0.2,  max: 1.0,  value: 0.65,step: 0.05 },
    { id: 'mb-threshold',  label: 'Threshold',min: 0.5,  max: 4.0,  value: 1.5, step: 0.1  },
    { id: 'mb-bg',         label: 'BG Index', min: 0,    max: 4,    value: 0,   step: 1    },
    { id: 'mb-accent',     label: 'Accents',  min: 0,    max: 40,   value: 0,   step: 1    },
    { id: 'mb-accent-core',label: 'AccCore',  min: 0.02, max: 0.10, value: 0.04,step: 0.005},
    { id: 'mb-accent-thr', label: 'AccThresh',min: 0.8,  max: 3.0,  value: 1.7, step: 0.05 },
    { id: 'gen-softness',  label: 'Softness', min: 0,    max: 1,    value: 0,   step: 0.05 },
  ],
  stripe: [
    { id: 'stripe-freq',   label: 'Frequency',min: 0.5,  max: 25,   value: 6.0, step: 0.5  },
    { id: 'stripe-flow',   label: 'Flow',     min: 0.05, max: 5,    value: 0.8, step: 0.05 },
    { id: 'stripe-angle',  label: 'Angle',    min: 0,    max: 360,  value: 78,  step: 1    },
    { id: 'stripe-edge',   label: 'Edge Noise',min: 0,   max: 1.5,  value: 0.45,step: 0.05 },
    { id: 'stripe-contrast',label:'Contrast', min: 0.05, max: 3,    value: 0.5, step: 0.05 },
  ],
  brushstroke: [
    { id: 'brush-layers',  label: 'Layers',   min: 1,    max: 5,    value: 3,   step: 1    },
    { id: 'brush-strokes', label: 'Strokes',  min: 2,    max: 30,   value: 8,   step: 1    },
    { id: 'brush-length',  label: 'Length',   min: 0.10, max: 1.0,  value: 0.45,step: 0.05 },
    { id: 'brush-thick',   label: 'Thickness',min: 0.02, max: 0.20, value: 0.06,step: 0.01 },
    { id: 'brush-curve',   label: 'Curvature',min: 0,    max: 1.0,  value: 0.25,step: 0.05 },
    { id: 'brush-angle',   label: 'Angle',    min: 0,    max: 360,  value: 90,  step: 5    },
    { id: 'brush-anglevar',label: 'AngleVar', min: 0,    max: 90,   value: 30,  step: 5    },
    { id: 'brush-thresh',  label: 'Threshold',min: 0.3,  max: 3.0,  value: 1.0, step: 0.05 },
    { id: 'brush-bg',      label: 'BG Index', min: 0,    max: 4,    value: 0,   step: 1    },
  ],
  fleck: [
    { id: 'fleck-clusters',label: 'Clusters', min: 2,    max: 150,  value: 40,  step: 1    },
    { id: 'fleck-dots',    label: 'Dots/Clust',min: 2,   max: 100,  value: 25,  step: 1    },
    { id: 'fleck-radius',  label: 'Dot Size', min: 1,    max: 24,   value: 4,   step: 1    },
    { id: 'fleck-spread',  label: 'Spread',   min: 0.01, max: 0.40, value: 0.06,step: 0.01 },
  ],
  rain: [
    { id: 'rain-count',    label: 'Count',    min: 10,   max: 1200, value: 300, step: 10   },
    { id: 'rain-width',    label: 'Width',    min: 1,    max: 30,   value: 3,   step: 1    },
    { id: 'rain-min-h',    label: 'Min Height',min: 2,   max: 80,   value: 15,  step: 1    },
    { id: 'rain-max-h',    label: 'Max Height',min: 5,   max: 200,  value: 50,  step: 1    },
    { id: 'rain-angle',    label: 'Angle Var', min: 0,   max: 90,   value: 8,   step: 1    },
  ],
  chip: [
    { id: 'chip-blobs',    label: 'Blobs',    min: 0,    max: 50,   value: 12,  step: 1    },
    { id: 'chip-blob-min', label: 'Blob Min',  min: 0.01, max: 0.25, value: 0.06,step: 0.01 },
    { id: 'chip-blob-max', label: 'Blob Max',  min: 0.02, max: 0.50, value: 0.16,step: 0.01 },
    { id: 'chip-count',    label: 'Chips',    min: 0,    max: 800,  value: 180, step: 10   },
    { id: 'chip-size',     label: 'Chip Size', min: 1,    max: 25,   value: 5,   step: 1    },
    { id: 'gen-softness',  label: 'Softness', min: 0,    max: 1,    value: 0,   step: 0.05 },
    { id: 'chip-shadow',   label: 'Shadow',   min: 0,    max: 1,    value: 0.25,step: 0.05 },
  ],
  geometric: [
    { id: 'geo-cells',     label: 'Cells',    min: 2,    max: 80,   value: 18,  step: 1    },
    { id: 'geo-angular',   label: 'Angularity',min: 0,   max: 1,    value: 0.50,step: 0.05 },
    { id: 'gen-scale',     label: 'Scale',    min: 0.4,  max: 3,    value: 1.0, step: 0.05 },
  ],
  honeycomb: [
    { id: 'hex-cell',      label: 'Cell Size', min: 6,    max: 60,   value: 20,  step: 1    },
    { id: 'hex-border',    label: 'Border',   min: 0,    max: 6,    value: 2,   step: 0.5  },
    { id: 'hex-depth',     label: 'Depth',    min: 0,    max: 0.8,  value: 0,   step: 0.05 },
    { id: 'hex-noise',     label: 'Noise',    min: 0,    max: 0.5,  value: 0,   step: 0.05 },
  ],
  carbon: [
    { id: 'cf-weave',      label: 'Weave px', min: 3,    max: 30,   value: 8,   step: 1    },
    { id: 'cf-depth',      label: 'Depth',    min: 0,    max: 0.8,  value: 0,   step: 0.05 },
    { id: 'cf-gloss',      label: 'Gloss',    min: 0,    max: 0.6,  value: 0,   step: 0.05 },
    { id: 'cf-noise',      label: 'Noise',    min: 0,    max: 0.3,  value: 0,   step: 0.01 },
  ],
  contour: [
    { id: 'ct-scale',      label: 'Scale',    min: 0.5,  max: 6,    value: 1.8, step: 0.1  },
    { id: 'ct-stretch',    label: 'Stretch',  min: 0.5,  max: 5,    value: 2.0, step: 0.1  },
    { id: 'ct-warp',       label: 'Warp',     min: 0,    max: 3,    value: 0.8, step: 0.1  },
    { id: 'ct-sharpness',  label: 'Sharpness',min: 0,    max: 1,    value: 1.0, step: 0.05 },
    { id: 'ct-coverage',   label: 'Coverage', min: 0.1,  max: 0.8,  value: 0.45,step: 0.05 },
    { id: 'ct-puzzle',     label: 'Puzzle',   min: 0,    max: 1,    value: 0,   step: 1    },
  ],
};

function setupGeneratorPanel() {
  const algoSel = document.getElementById('gen-algo');
  algoSel.addEventListener('change', () => {
    state.generator = algoSel.value;
    renderParams(algoSel.value);
    document.getElementById('pattern-preset').value = '';
  });

  const seedInput = document.getElementById('gen-seed');
  seedInput.addEventListener('change', () => { state.seed = parseInt(seedInput.value) || 0; });

  document.getElementById('btn-rand-seed').addEventListener('click', () => {
    state.seed = Math.floor(Math.random() * 65536);
    seedInput.value = state.seed;
  });

  document.getElementById('btn-generate').addEventListener('click', () => {
    // auto-increment seed so repeated Generate clicks produce different output
    state.seed = (state.seed + 1) % 65536;
    document.getElementById('gen-seed').value = state.seed;
    runGenerator();
  });

  const tileableCb = document.getElementById('gen-tileable');
  if (tileableCb) tileableCb.addEventListener('change', runGenerator);

  const varyBtn = document.getElementById('btn-vary');
  if (varyBtn) varyBtn.addEventListener('click', varyParams);

  const repeatSel = document.getElementById('preview-repeat');
  repeatSel.addEventListener('change', () => {
    const n = parseInt(repeatSel.value);
    state.tileCanvas.setPreviewRepeat(n);
    document.getElementById('preview-label').textContent = `${n} x ${n} tile repeat`;
  });

  document.getElementById('btn-randomize').addEventListener('click', randomizeAll);

  renderParams(state.generator);
}

function renderParams(algo) {
  const container = document.getElementById('gen-params');
  container.innerHTML = '';

  for (const p of (PARAM_DEFS[algo] ?? [])) {
    const row = document.createElement('div');
    row.className = 'param-row';
    row.innerHTML = `
      <label for="${p.id}">${p.label}</label>
      <input type="range" id="${p.id}"
             min="${p.min}" max="${p.max}" value="${p.value}" step="${p.step}">
      <span class="param-val">${fmtVal(p.value)}</span>
    `;
    const sl = row.querySelector('input');
    const vl = row.querySelector('.param-val');
    sl.addEventListener('input', () => { vl.textContent = fmtVal(parseFloat(sl.value)); });
    container.appendChild(row);
  }
  // sync bg sliders to the currently selected palette's recommendation.
  // presets that explicitly set mb-bg/brush-bg override this later, since
  // setupPresetPanel applies preset.params AFTER renderParams.
  syncBgSlidersToPalette();
}

// when palette changes (and no preset is overriding), point any visible
// bg slider at the palette's natural bg index.
function syncBgSlidersToPalette() {
  const palKey = document.getElementById('palette-preset')?.value;
  if (!palKey || palKey === 'custom') return;
  const bgIdx = getPaletteBgIdx(palKey);
  for (const id of ['mb-bg', 'brush-bg']) {
    const el = document.getElementById(id);
    if (!el) continue;
    const min = parseFloat(el.min), max = parseFloat(el.max);
    const clamped = Math.min(max, Math.max(min, bgIdx));
    el.value = clamped;
    if (el.nextElementSibling) el.nextElementSibling.textContent = fmtVal(clamped);
  }
}

function fmtVal(v) {
  return Number.isInteger(v) || Math.abs(v - Math.round(v)) < 0.001
    ? String(Math.round(v))
    : v.toFixed(2);
}

function getParam(id, def) {
  const el = document.getElementById(id);
  return el ? parseFloat(el.value) : def;
}

function randomizeAll() {
  const algo = pickRandom(GENERATOR_KEYS);
  state.generator = algo;
  document.getElementById('gen-algo').value = algo;

  const paletteLocked = !!document.getElementById('palette-lock')?.checked;
  if (!paletteLocked) {
    const palKey = pickRandom(PALETTE_KEYS);
    state.palette = getPaletteColors(palKey);
    PALETTES.custom.colors = [...state.palette];
    document.getElementById('palette-preset').value = palKey;
    renderSwatches();
    setActiveSwatch(0);
  }

  state.seed = Math.floor(Math.random() * 65536);
  document.getElementById('gen-seed').value = state.seed;

  renderParams(algo);
  document.querySelectorAll('#gen-params input[type="range"]').forEach(sl => {
    const min = parseFloat(sl.min), max = parseFloat(sl.max), step = parseFloat(sl.step) || 0.01;
    const steps = Math.floor((max - min) / step);
    const val = min + Math.floor(Math.random() * steps) * step;
    sl.value = val;
    sl.nextElementSibling.textContent = fmtVal(val);
  });

  document.getElementById('pattern-preset').value = '';
  runGenerator();
}

// nudge every slider in the current generator's param panel by +/- ~10% of its range,
// keep generator/palette fixed, then regenerate. lets you explore a neighborhood.
function varyParams() {
  const jitter = 0.10;
  document.querySelectorAll('#gen-params input[type="range"]').forEach(sl => {
    const min = parseFloat(sl.min), max = parseFloat(sl.max);
    const step = parseFloat(sl.step) || 0.01;
    const range = max - min;
    const cur = parseFloat(sl.value);
    const delta = (Math.random() * 2 - 1) * range * jitter;
    let next = cur + delta;
    // snap to nearest step
    next = Math.round((next - min) / step) * step + min;
    next = Math.max(min, Math.min(max, next));
    sl.value = next;
    if (sl.nextElementSibling) sl.nextElementSibling.textContent = fmtVal(next);
  });
  runGenerator();
}

function runGenerator() {
  const tc  = state.tileCanvas;
  const ctx = tc.ctx;
  const sz  = tc.size;
  const pal = state.palette;
  const seed = state.seed;
  const tileable = !!document.getElementById('gen-tileable')?.checked;

  tc.pushHistory();

  switch (state.generator) {
    case 'voronoi':
      generateVoronoi(ctx, sz, pal, { seedCount: getParam('seed-count', 12)|0, scale: getParam('gen-scale', 1.0), softness: getParam('gen-softness', 0), border: getParam('gen-border', 0), seed }); break;
    case 'noise':
      generateNoise(ctx, sz, pal, { scale: getParam('gen-scale', 2.5), octaves: getParam('gen-octaves', 5)|0, warpStrength: getParam('gen-warp', 1.8), tileable, seed }); break;
    case 'digital':
      generateDigital(ctx, sz, pal, { cellSize: getParam('gen-cell', 5)|0, scale: getParam('gen-scale', 3.5), octaves: getParam('gen-octaves', 3)|0, tileable, seed }); break;
    case 'blotch':
      generateBlotch(ctx, sz, pal, { count: getParam('blob-count', 20)|0, minSize: getParam('blob-min', 0.04), maxSize: getParam('blob-max', 0.18), softness: getParam('gen-softness', 0), blobNoise: getParam('blob-noise', 0.60), seed }); break;
    case 'metaball':
      generateMetaball(ctx, sz, pal, { clusters: getParam('mb-clusters', 18)|0, coreRadius: getParam('mb-core', 0.08), satellites: getParam('mb-satellites', 5)|0, spread: getParam('mb-spread', 0.9), satSize: getParam('mb-sat-size', 0.65), threshold: getParam('mb-threshold', 1.5), softness: getParam('gen-softness', 0), bgIdx: getParam('mb-bg', 0)|0, accentClusters: getParam('mb-accent', 0)|0, accentCore: getParam('mb-accent-core', 0.04), accentThreshold: getParam('mb-accent-thr', 1.7), seed }); break;
    case 'stripe':
      generateStripe(ctx, sz, pal, { stripeFreq: getParam('stripe-freq', 6.0), flowFreq: getParam('stripe-flow', 0.8), angle: getParam('stripe-angle', 78), edgeNoise: getParam('stripe-edge', 0.45), contrast: getParam('stripe-contrast', 0.5), tileable, seed }); break;
    case 'brushstroke':
      generateBrushstroke(ctx, sz, pal, { layers: getParam('brush-layers', 3)|0, strokes: getParam('brush-strokes', 8)|0, length: getParam('brush-length', 0.45), thickness: getParam('brush-thick', 0.06), curvature: getParam('brush-curve', 0.25), angle: getParam('brush-angle', 90), angleVar: getParam('brush-anglevar', 30), threshold: getParam('brush-thresh', 1.0), bgIdx: getParam('brush-bg', 0)|0, seed }); break;
    case 'fleck':
      generateFleck(ctx, sz, pal, { clusters: getParam('fleck-clusters', 40)|0, dotsPerClust: getParam('fleck-dots', 25)|0, dotRadius: getParam('fleck-radius', 4)|0, spread: getParam('fleck-spread', 0.06), seed }); break;
    case 'rain':
      generateRain(ctx, sz, pal, { dashCount: getParam('rain-count', 300)|0, dashWidth: getParam('rain-width', 3)|0, dashMinH: getParam('rain-min-h', 15)|0, dashMaxH: getParam('rain-max-h', 50)|0, angleVar: getParam('rain-angle', 8), seed }); break;
    case 'chip':
      generateChip(ctx, sz, pal, { blobCount: getParam('chip-blobs', 12)|0, blobMin: getParam('chip-blob-min', 0.06), blobMax: getParam('chip-blob-max', 0.16), chipCount: getParam('chip-count', 180)|0, chipSize: getParam('chip-size', 5)|0, softness: getParam('gen-softness', 0), shadow: getParam('chip-shadow', 0.40), seed }); break;
    case 'geometric':
      generateGeometric(ctx, sz, pal, { cellCount: getParam('geo-cells', 18)|0, angularity: getParam('geo-angular', 0.50), scale: getParam('gen-scale', 1.0), seed }); break;
    case 'honeycomb':
      generateHoneycomb(ctx, sz, pal, { cellSize: getParam('hex-cell', 20)|0, border: getParam('hex-border', 2), depth: getParam('hex-depth', 0.30), noise: getParam('hex-noise', 0.15), tileable, seed }); break;
    case 'carbon':
      generateCarbon(ctx, sz, pal, { weaveSize: getParam('cf-weave', 8)|0, depth: getParam('cf-depth', 0.40), glossy: getParam('cf-gloss', 0.20), noise: getParam('cf-noise', 0.08), tileable, seed }); break;
    case 'contour':
      generateContour(ctx, sz, pal, { scale: getParam('ct-scale', 1.8), stretch: getParam('ct-stretch', 2.0), warp: getParam('ct-warp', 0.8), sharpness: getParam('ct-sharpness', 1.0), coverage: getParam('ct-coverage', 0.45), puzzle: getParam('ct-puzzle', 0), tileable, seed }); break;
  }

  tc.updatePreview();
}

// ---- pattern presets ----

function setupPresetPanel() {
  const sel = document.getElementById('pattern-preset');
  sel.addEventListener('change', () => {
    const key = sel.value;
    if (!key) return;

    const preset = PATTERN_PRESETS[key];
    if (!preset) return;

    const algoSel = document.getElementById('gen-algo');
    algoSel.value = preset.generator;
    state.generator = preset.generator;

    if (preset.palette && PALETTES[preset.palette]) {
      state.palette = getPaletteColors(preset.palette);
      PALETTES.custom.colors = [...state.palette];
      document.getElementById('palette-preset').value = preset.palette;
      renderSwatches();
      setActiveSwatch(0);
    }

    renderParams(preset.generator);
    if (preset.params) {
      for (const [id, val] of Object.entries(preset.params)) {
        const el = document.getElementById(id);
        if (el) {
          el.value = val;
          const valSpan = el.nextElementSibling;
          if (valSpan) valSpan.textContent = fmtVal(val);
        }
      }
    }

    runGenerator();
  });
}

// ---- user-defined presets (localStorage) + JSON clipboard ----

const USER_PRESET_KEY = 'camojack:userPresets';

function loadUserPresets() {
  try {
    const raw = localStorage.getItem(USER_PRESET_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveUserPresets(list) {
  try { localStorage.setItem(USER_PRESET_KEY, JSON.stringify(list)); } catch {}
}

// snapshot current generator + palette + seed + tileable + all visible slider values
function captureState() {
  const params = {};
  document.querySelectorAll('#gen-params input[type="range"]').forEach(sl => {
    params[sl.id] = parseFloat(sl.value);
  });
  const palKey = document.getElementById('palette-preset')?.value || 'custom';
  return {
    generator: state.generator,
    paletteKey: palKey,
    paletteColors: [...state.palette],
    seed: state.seed,
    tileable: !!document.getElementById('gen-tileable')?.checked,
    params,
  };
}

// reverse of captureState: drive UI back into the recorded state, then regenerate
function applyState(s) {
  if (!s || typeof s !== 'object') return false;
  // require at least one of the meaningful fields, otherwise a malformed paste
  // would silently no-op and look like success
  if (!s.generator && !Array.isArray(s.paletteColors) && !s.params) return false;

  if (s.generator) {
    state.generator = s.generator;
    const algoSel = document.getElementById('gen-algo');
    if (algoSel) algoSel.value = s.generator;
    renderParams(s.generator);
  }

  if (Array.isArray(s.paletteColors) && s.paletteColors.length &&
      s.paletteColors.every(c => typeof c === 'string' && /^#?[0-9a-fA-F]{6}$/.test(c))) {
    state.palette = s.paletteColors.map(c => c.replace('#', '').toLowerCase());
    PALETTES.custom.colors = [...state.palette];
    const palSel = document.getElementById('palette-preset');
    if (palSel) palSel.value = s.paletteKey || 'custom';
    renderSwatches();
    setActiveSwatch(0);
  }

  if (typeof s.seed === 'number') {
    state.seed = s.seed;
    const seedIn = document.getElementById('gen-seed');
    if (seedIn) seedIn.value = s.seed;
  }

  const tileCb = document.getElementById('gen-tileable');
  if (tileCb && typeof s.tileable === 'boolean') tileCb.checked = s.tileable;

  if (s.params && typeof s.params === 'object') {
    for (const [id, val] of Object.entries(s.params)) {
      const el = document.getElementById(id);
      if (el) {
        el.value = val;
        if (el.nextElementSibling) el.nextElementSibling.textContent = fmtVal(parseFloat(val));
      }
    }
  }

  document.getElementById('pattern-preset').value = '';
  runGenerator();
  return true;
}

function refreshUserPresetSelect() {
  const sel = document.getElementById('user-preset');
  if (!sel) return;
  const list = loadUserPresets();
  sel.innerHTML = '<option value="">-- Saved --</option>' +
    list.map((p, i) => `<option value="${i}">${escapeHtml(p.name)}</option>`).join('');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function setupUserPresets() {
  const sel = document.getElementById('user-preset');
  if (!sel) return;
  refreshUserPresetSelect();

  sel.addEventListener('change', () => {
    const idx = parseInt(sel.value);
    if (Number.isNaN(idx)) return;
    const entry = loadUserPresets()[idx];
    if (entry) applyState(entry.state);
  });

  document.getElementById('btn-preset-save')?.addEventListener('click', () => {
    const name = prompt('Name this preset:');
    if (!name) return;
    const list = loadUserPresets();
    const entry = { name: name.slice(0, 64), state: captureState() };
    // overwrite same-named
    const existing = list.findIndex(p => p.name === entry.name);
    if (existing >= 0) list[existing] = entry; else list.push(entry);
    saveUserPresets(list);
    refreshUserPresetSelect();
    sel.value = String(list.findIndex(p => p.name === entry.name));
    flashButton('btn-preset-save', 'Saved');
  });

  document.getElementById('btn-preset-delete')?.addEventListener('click', () => {
    const idx = parseInt(sel.value);
    if (Number.isNaN(idx)) return;
    const list = loadUserPresets();
    const entry = list[idx];
    if (!entry) return;
    if (!confirm(`Delete preset "${entry.name}"?`)) return;
    list.splice(idx, 1);
    saveUserPresets(list);
    refreshUserPresetSelect();
  });

  document.getElementById('btn-preset-copy')?.addEventListener('click', async () => {
    const json = JSON.stringify(captureState(), null, 2);
    try {
      await navigator.clipboard.writeText(json);
      flashButton('btn-preset-copy', 'Copied!');
    } catch {
      // fallback: dump into prompt so user can manual copy
      prompt('Copy this JSON:', json);
    }
  });

  document.getElementById('btn-preset-paste')?.addEventListener('click', async () => {
    let text = '';
    try { text = await navigator.clipboard.readText(); } catch {}
    if (!text) text = prompt('Paste preset JSON:') || '';
    if (!text) return;
    try {
      const obj = JSON.parse(text);
      if (!applyState(obj)) throw new Error('invalid');
      flashButton('btn-preset-paste', 'Loaded!');
    } catch (e) {
      alert('Could not parse preset JSON.');
    }
  });
}

function flashButton(id, msg) {
  const btn = document.getElementById(id);
  if (!btn) return;
  const prev = btn.textContent;
  btn.textContent = msg;
  setTimeout(() => { btn.textContent = prev; }, 900);
}

// ---- pattern blending ----

function setupBlendPanel() {
  const btnA = document.getElementById('btn-capture-a');
  const btnB = document.getElementById('btn-capture-b');
  const btnBlend = document.getElementById('btn-apply-blend');
  if (!btnA) return; // blend panel not in DOM yet

  btnA.addEventListener('click', () => {
    const tc = state.tileCanvas;
    state.blendA = tc.ctx.getImageData(0, 0, tc.size, tc.size);
    btnA.textContent = 'A captured';
    // draw thumbnail
    drawBlendThumb('blend-thumb-a', state.blendA, tc.size);
  });

  btnB.addEventListener('click', () => {
    const tc = state.tileCanvas;
    state.blendB = tc.ctx.getImageData(0, 0, tc.size, tc.size);
    btnB.textContent = 'B captured';
    drawBlendThumb('blend-thumb-b', state.blendB, tc.size);
  });

  btnBlend.addEventListener('click', () => {
    if (!state.blendA || !state.blendB) return;
    const tc = state.tileCanvas;
    const mode = document.getElementById('blend-mode').value;
    const mix = parseInt(document.getElementById('blend-mix').value) / 100;

    tc.pushHistory();

    const a = state.blendA.data;
    const b = state.blendB.data;
    const out = tc.ctx.createImageData(tc.size, tc.size);
    const d = out.data;

    for (let i = 0; i < a.length; i += 4) {
      for (let ch = 0; ch < 3; ch++) {
        const av = a[i + ch] / 255;
        const bv = b[i + ch] / 255;
        let result;

        switch (mode) {
          case 'multiply':   result = av * bv; break;
          case 'screen':     result = 1 - (1 - av) * (1 - bv); break;
          case 'overlay':    result = av < 0.5 ? 2 * av * bv : 1 - 2 * (1 - av) * (1 - bv); break;
          case 'difference': result = Math.abs(av - bv); break;
          case 'soft-light':
            result = bv <= 0.5
              ? av - (1 - 2 * bv) * av * (1 - av)
              : av + (2 * bv - 1) * (Math.sqrt(av) - av);
            break;
          default: result = bv; // normal: top layer at mix opacity
        }

        // lerp between A and blended result by mix amount
        const final = av * (1 - mix) + result * mix;
        d[i + ch] = Math.round(Math.max(0, Math.min(1, final)) * 255);
      }
      d[i + 3] = 255;
    }

    tc.ctx.putImageData(out, 0, 0);
    tc.updatePreview();
  });

  // blend mix slider value display
  const mixSl = document.getElementById('blend-mix');
  if (mixSl) {
    const mixVal = document.getElementById('blend-mix-val');
    mixSl.addEventListener('input', () => {
      if (mixVal) mixVal.textContent = mixSl.value + '%';
    });
  }
}

function drawBlendThumb(canvasId, imageData, size) {
  const c = document.getElementById(canvasId);
  if (!c) return;
  const ctx = c.getContext('2d');
  // create a temp canvas at full size, draw imageData, then scale down
  const tmp = document.createElement('canvas');
  tmp.width = size; tmp.height = size;
  tmp.getContext('2d').putImageData(imageData, 0, 0);
  c.width = c.clientWidth || 100;
  c.height = c.clientWidth || 100;
  ctx.drawImage(tmp, 0, 0, c.width, c.height);
  c.style.display = 'block';
}

// ---- image upload / palette extraction ----

function setupImageUpload() {
  const fileInput = document.getElementById('img-upload');
  const preview   = document.getElementById('img-preview');
  const extractBtn = document.getElementById('btn-extract-palette');
  const label     = document.getElementById('img-upload-label');
  let loadedImageData = null;

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;

    try {
      const { imageData, canvas } = await loadImageData(file);
      loadedImageData = imageData;

      const ctx = preview.getContext('2d');
      preview.width = canvas.width;
      preview.height = canvas.height;
      ctx.drawImage(canvas, 0, 0);
      preview.style.display = 'block';
      label.style.display = 'none';
      extractBtn.disabled = false;
    } catch {
      loadedImageData = null;
      extractBtn.disabled = true;
    }
  });

  const area = document.getElementById('img-upload-area');
  area.addEventListener('dragover', e => { e.preventDefault(); area.classList.add('drag-over'); });
  area.addEventListener('dragleave', () => area.classList.remove('drag-over'));
  area.addEventListener('drop', e => {
    e.preventDefault();
    area.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) {
      const dt = new DataTransfer();
      dt.items.add(file);
      fileInput.files = dt.files;
      fileInput.dispatchEvent(new Event('change'));
    }
  });

  extractBtn.addEventListener('click', () => {
    if (!loadedImageData) return;
    const colors = extractPalette(loadedImageData, 5);
    state.palette = colors.map(([r, g, b]) => rgbToHex([r, g, b]));
    PALETTES.custom.colors = [...state.palette];
    document.getElementById('palette-preset').value = 'custom';
    renderSwatches();
    setActiveSwatch(0);
  });
}

// ---- random palette by biome ----

function setupRandomPalette() {
  document.getElementById('btn-random-palette').addEventListener('click', () => {
    const biome = document.getElementById('random-biome').value;
    const colors = generateRandomPalette(biome);
    state.palette = [...colors];
    PALETTES.custom.colors = [...state.palette];
    document.getElementById('palette-preset').value = 'custom';
    renderSwatches();
    setActiveSwatch(0);
  });
}

// ---- palette panel ----

function setupPalettePanel() {
  const presetSel = document.getElementById('palette-preset');
  presetSel.addEventListener('change', () => {
    const key = presetSel.value;
    if (key !== 'custom') {
      state.palette = getPaletteColors(key);
      PALETTES.custom.colors = [...state.palette];
    }
    renderSwatches();
    setActiveSwatch(0);
    // point bg sliders at the new palette's natural background
    syncBgSlidersToPalette();
  });

  renderSwatches();
  setActiveSwatch(0);

  ['hue-sl', 'sat-sl', 'lit-sl'].forEach(id => {
    document.getElementById(id).addEventListener('input', onHslChange);
  });

  const hexIn = document.getElementById('hex-input');
  hexIn.addEventListener('change', () => {
    const hex = hexIn.value.replace(/[^0-9a-fA-F]/g, '').padEnd(6, '0').slice(0, 6);
    hexIn.value = hex.toUpperCase();
    const rgb = hexToRgb(hex);
    if (state.activeSlot === 'primary') {
      state.activeRgb = rgb;
      applyColorToUI(rgb, true);
      commitSwatchColor(hex);
    } else {
      state.activeRgb2 = rgb;
      applyColorToUI(rgb, true);
    }
  });

  // swap colors button
  const swapBtn = document.getElementById('btn-swap-colors');
  if (swapBtn) swapBtn.addEventListener('click', swapColors);

  // clicking either color swatch makes it the active slot (sliders /
  // hex / palette clicks edit that slot until you click the other one).
  document.querySelectorAll('.color-slot').forEach(el => {
    el.addEventListener('click', () => setActiveSlot(el.dataset.slot));
  });

  // initialize both swatch previews from state
  document.getElementById('color-preview').style.background  = '#' + rgbToHex(state.activeRgb);
  document.getElementById('color2-preview').style.background = '#' + rgbToHex(state.activeRgb2);
}

function renderSwatches() {
  const container = document.getElementById('palette-swatches');
  container.innerHTML = '';

  state.palette.forEach((hex, idx) => {
    const sw = document.createElement('div');
    sw.className = 'swatch' + (idx === state.activeIdx ? ' active' : '');
    sw.style.background = '#' + hex;
    sw.title = '#' + hex.toUpperCase() + ' (click = active slot; right-click = inactive slot)';
    // left click sets the currently-active slot.
    // alt-click or right-click sets the inactive slot without changing focus.
    sw.addEventListener('click', (e) => {
      if (e.altKey) {
        setInactiveSlot(hex);
      } else {
        setActiveSwatch(idx);
      }
    });
    sw.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      setInactiveSlot(hex);
    });
    sw.addEventListener('dblclick', () => {
      const input = document.createElement('input');
      input.type = 'color';
      input.value = '#' + hex;
      input.style.display = 'none';
      document.body.appendChild(input);
      input.click();
      input.addEventListener('input', () => {
        const newHex = input.value.slice(1);
        state.palette[idx] = newHex;
        PALETTES.custom.colors = [...state.palette];
        document.getElementById('palette-preset').value = 'custom';
        sw.style.background = '#' + newHex;
        if (idx === state.activeIdx && state.activeSlot === 'primary') {
          state.activeRgb = hexToRgb(newHex);
          applyColorToUI(state.activeRgb);
        }
      });
      input.addEventListener('change', () => document.body.removeChild(input));
    });
    container.appendChild(sw);
  });
}

// write a hex color into whichever slot is NOT currently active. used by
// right-click and alt-click on palette swatches so the user can stock the
// secondary color without losing focus.
function setInactiveSlot(hex) {
  const rgb = hexToRgb(hex);
  if (state.activeSlot === 'primary') {
    state.activeRgb2 = rgb;
    state.tileCanvas.setColor2(rgb);
    $('color2-preview').style.background = '#' + hex;
  } else {
    state.activeRgb = rgb;
    state.tileCanvas.setColor(rgb);
    $('color-preview').style.background = '#' + hex;
  }
}

// set the active slot to a palette entry. only primary tracks activeIdx
// (the palette pointer for the "edit this swatch when sliders move" flow);
// when secondary is active, palette state is left untouched.
function setActiveSwatch(idx) {
  const hex = state.palette[idx];
  const rgb = hexToRgb(hex);

  if (state.activeSlot === 'primary') {
    state.activeIdx = idx;
    const swatches = $('palette-swatches').children;
    for (let i = 0; i < swatches.length; i++) {
      swatches[i].classList.toggle('active', i === idx);
    }
    state.activeRgb = rgb;
  } else {
    state.activeRgb2 = rgb;
  }
  applyColorToUI(rgb);
}

function onHslChange() {
  const h = parseInt($('hue-sl').value);
  const s = parseInt($('sat-sl').value);
  const l = parseInt($('lit-sl').value);
  $('hue-val').textContent = h;
  $('sat-val').textContent = s;
  $('lit-val').textContent = l;

  const rgb = hslToRgb([h, s, l]);
  const hex = rgbToHex(rgb);

  if (state.activeSlot === 'primary') {
    state.activeRgb = rgb;
    $('color-preview').style.background = '#' + hex;
    $('hex-input').value = hex.toUpperCase();
    commitSwatchColor(hex);   // primary edits live-update palette[activeIdx]
  } else {
    state.activeRgb2 = rgb;
    state.tileCanvas.setColor2(rgb);
    $('color2-preview').style.background = '#' + hex;
    $('hex-input').value = hex.toUpperCase();
  }
}

function commitSwatchColor(hex) {
  state.palette[state.activeIdx] = hex;
  PALETTES.custom.colors = [...state.palette];
  $('palette-preset').value = 'custom';
  const swatches = $('palette-swatches').children;
  const sw = swatches[state.activeIdx];
  if (sw) {
    sw.style.background = '#' + hex;
    sw.title = '#' + hex.toUpperCase();
  }
  state.tileCanvas.setColor(state.activeRgb);
}

// update the preview swatch + hex/HSL inputs for whichever slot is
// currently active, and push the color to the tile canvas as that slot.
function applyColorToUI(rgb, skipHex = false) {
  const hex = rgbToHex(rgb);
  const [h, s, l] = rgbToHsl(rgb);

  if (state.activeSlot === 'primary') {
    $('color-preview').style.background = '#' + hex;
    state.tileCanvas.setColor(rgb);
  } else {
    $('color2-preview').style.background = '#' + hex;
    state.tileCanvas.setColor2(rgb);
  }
  if (!skipHex) $('hex-input').value = hex.toUpperCase();

  $('hue-sl').value = h;
  $('sat-sl').value = s;
  $('lit-sl').value = l;
  $('hue-val').textContent = h;
  $('sat-val').textContent = s;
  $('lit-val').textContent = l;
}

// ---- brush panel ----

function setupBrushPanel() {
  const sizeSl = document.getElementById('brush-size');
  const opaSl  = document.getElementById('brush-opacity');
  const hardSl = document.getElementById('brush-hardness');

  document.getElementById('brush-shape').addEventListener('change', e => {
    state.tileCanvas.setBrushShape(e.target.value);
  });

  document.getElementById('blob-style').addEventListener('change', e => {
    state.tileCanvas.setBlobStyle(e.target.value);
  });

  document.getElementById('spray-type').addEventListener('change', e => {
    state.tileCanvas.setSprayType(e.target.value);
  });

  document.getElementById('blob-vary').addEventListener('change', e => {
    state.tileCanvas.setBlobVary(e.target.checked);
  });

  document.getElementById('blob-mode').addEventListener('change', e => {
    const tc = state.tileCanvas;
    const mode = e.target.value;
    tc.setBlobPath(mode === 'path');
    tc.setBlobSingle(mode === 'single');
    tc.setBlobLayered(mode === 'layered');
    syncBlobSubrows(mode);
  });
  syncBlobSubrows(document.getElementById('blob-mode').value);

  const jagSl  = document.getElementById('blob-jaggedness');
  const jagVal = document.getElementById('blob-jaggedness-val');
  if (jagSl && jagVal) {
    jagSl.addEventListener('input', () => {
      const v = parseInt(jagSl.value);
      state.tileCanvas.setBlobJaggedness(v / 100);
      jagVal.textContent = v === 0 ? 'default' : '+' + v + '%';
    });
  }

  const pressSl  = document.getElementById('blob-pressure');
  const pressVal = document.getElementById('blob-pressure-val');
  if (pressSl && pressVal) {
    pressSl.addEventListener('input', () => {
      const v = parseInt(pressSl.value);
      state.tileCanvas.setPathPressure(v / 100);
      pressVal.textContent = v + '%';
    });
  }

  setupSprayPanel();

  // shape mode (rect/ellipse)
  const shapeSel = document.getElementById('shape-mode');
  if (shapeSel) {
    shapeSel.addEventListener('change', e => {
      state.tileCanvas.setShapeMode(e.target.value);
    });
  }

  // filled checkbox
  const filledCb = document.getElementById('shape-filled');
  if (filledCb) {
    filledCb.addEventListener('change', e => {
      state.tileCanvas.setShapeFilled(e.target.checked);
    });
  }

  sizeSl.addEventListener('input', () => {
    const v = parseInt(sizeSl.value);
    document.getElementById('brush-size-val').textContent = v;
    state.tileCanvas.setBrushSize(v);
  });

  opaSl.addEventListener('input', () => {
    const v = parseInt(opaSl.value);
    document.getElementById('brush-opacity-val').textContent = v + '%';
    state.tileCanvas.setOpacity(v / 100);
  });

  hardSl.addEventListener('input', () => {
    const v = parseInt(hardSl.value);
    document.getElementById('brush-hardness-val').textContent = v + '%';
    state.tileCanvas.setHardness(v / 100);
  });

  const spacingSl = document.getElementById('brush-spacing');
  spacingSl.addEventListener('input', () => {
    const v = parseInt(spacingSl.value);
    document.getElementById('brush-spacing-val').textContent = v + '%';
    state.tileCanvas.setSpacing(v / 100);
  });

  const scatterSl = document.getElementById('brush-scatter');
  if (scatterSl) {
    scatterSl.addEventListener('input', () => {
      const v = parseInt(scatterSl.value);
      document.getElementById('brush-scatter-val').textContent = v + '%';
      state.tileCanvas.setScatter(v / 100);
    });
  }

  const scatterRateSl = document.getElementById('brush-scatter-rate');
  if (scatterRateSl) {
    scatterRateSl.addEventListener('input', () => {
      const v = parseInt(scatterRateSl.value);
      const mul = v / 100;
      document.getElementById('brush-scatter-rate-val').textContent = mul.toFixed(1) + 'x';
      state.tileCanvas.setScatterRate(mul);
    });
  }

  const fillSl = document.getElementById('fill-tolerance');
  if (fillSl) {
    fillSl.addEventListener('input', () => {
      const v = parseInt(fillSl.value);
      document.getElementById('fill-tolerance-val').textContent = v;
      state.tileCanvas.setFillTolerance(v);
    });
  }

  document.getElementById('sym-h').addEventListener('change', updateSymmetry);
  document.getElementById('sym-v').addEventListener('change', updateSymmetry);
}

function updateSymmetry() {
  const h = document.getElementById('sym-h').checked;
  const v = document.getElementById('sym-v').checked;
  state.tileCanvas.setSymmetry(h, v);
}

// ---- spray panel ----

// each spray type wants a different parameter; show/hide subrows so the
// user only sees what's relevant. always-shown: density + falloff.
function setupSprayPanel() {
  const tc = state.tileCanvas;
  const typeSel = document.getElementById('spray-type');

  const wire = (slId, valId, setter, fmt) => {
    const sl  = document.getElementById(slId);
    const val = document.getElementById(valId);
    if (!sl || !val) return;
    sl.addEventListener('input', () => {
      const v = parseInt(sl.value);
      setter(v);
      val.textContent = fmt(v);
    });
  };

  wire('spray-density',  'spray-density-val',  v => tc.setSprayDensity(v / 100), v => v + '%');
  wire('spray-falloff',  'spray-falloff-val',  v => tc.setSprayFalloff(v / 100), v => v + '%');
  wire('spray-tight',    'spray-tight-val',    v => tc.setSprayTight(v / 100),   v => v + '%');
  wire('spray-dotmax',   'spray-dotmax-val',   v => tc.setSprayDotMax(v),        v => String(v));
  wire('spray-fleckjit', 'spray-fleckjit-val', v => tc.setSprayFleckJit(v / 100),v => v + '%');

  if (typeSel) {
    typeSel.addEventListener('change', () => syncSpraySubrows(typeSel.value));
    syncSpraySubrows(typeSel.value);
  }
}

function syncBlobSubrows(mode) {
  document.querySelectorAll('.blob-path-only').forEach(el => el.hidden = mode !== 'path');
}

function syncSpraySubrows(type) {
  const map = {
    cluster:  '.spray-cluster-only',
    splatter: '.spray-splatter-only',
    fleck:    '.spray-fleck-only',
  };
  for (const sel of Object.values(map)) {
    document.querySelectorAll(sel).forEach(el => el.hidden = true);
  }
  if (map[type]) {
    document.querySelectorAll(map[type]).forEach(el => el.hidden = false);
  }
}

// ---- stamp library ----

function setupStampLibrary() {
  const tc = state.tileCanvas;

  $('btn-gen-stamp').addEventListener('click', () => {
    const type = $('stamp-type').value;
    const hard = $('stamp-hard').checked;
    tc.generateRandomStamp({ type, hard });
    renderStampLibrary();
    setTool('blob');
  });

  $('btn-clear-stamp').addEventListener('click', () => {
    tc.setActiveStamp(null);
    renderStampLibrary();
  });

  $('stamp-randrot').addEventListener('change', e => {
    tc.setStampRandomRotate(e.target.checked);
  });

  // import image as stamp
  $('btn-import-stamp').addEventListener('click', () => {
    $('stamp-file').click();
  });
  $('stamp-file').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      await tc.importStamp(file);
      renderStampLibrary();
      setTool('blob');
    } catch (err) {
      console.error('stamp import failed', err);
    }
    e.target.value = ''; // allow re-importing same file
  });
}

function renderStampLibrary() {
  const tc = state.tileCanvas;
  const lib = $('stamp-library');
  lib.innerHTML = '';
  for (const stamp of tc.stamps) {
    const cell = document.createElement('div');
    cell.className = 'stamp-cell' + (stamp.id === tc.activeStampId ? ' active' : '');
    cell.innerHTML = `<img src="${stamp.thumbUrl}"><button class="del" title="Delete">&times;</button>`;
    cell.addEventListener('click', (e) => {
      if (e.target.classList.contains('del')) {
        e.stopPropagation();
        tc.deleteStamp(stamp.id);
        renderStampLibrary();
        return;
      }
      tc.setActiveStamp(stamp.id);
      renderStampLibrary();
    });
    lib.appendChild(cell);
  }
}

// ---- seamless tiling ----

function setupSeamless() {
  const featherSl = document.getElementById('seam-feather');
  const featherVal = document.getElementById('seam-feather-val');
  featherSl.addEventListener('input', () => {
    featherVal.textContent = featherSl.value;
  });

  document.getElementById('btn-auto-seam').addEventListener('click', () => {
    const fw = parseInt(featherSl.value);
    state.tileCanvas.autoSeam(fw);
  });

  const offsetBtn = document.getElementById('btn-offset-view');
  offsetBtn.addEventListener('click', () => {
    const isOffset = state.tileCanvas.toggleOffsetView();
    offsetBtn.textContent = isOffset ? 'Restore View' : 'Offset View';
    offsetBtn.classList.toggle('btn-accent', isOffset);
  });
}

// ---- export ----

function setupExport() {
  document.getElementById('btn-export-tile').addEventListener('click', async () => {
    const blob = await state.tileCanvas.exportTile();
    downloadBlob(blob, 'camo-tile.png');
  });

  document.getElementById('btn-export-sheet').addEventListener('click', async () => {
    const cols = parseInt(document.getElementById('exp-cols').value) || 4;
    const rows = parseInt(document.getElementById('exp-rows').value) || 4;
    const blob = await state.tileCanvas.exportSheet(cols, rows);
    downloadBlob(blob, `camo-sheet-${cols}x${rows}.png`);
  });

  document.getElementById('btn-export').addEventListener('click', async () => {
    const blob = await state.tileCanvas.exportTile();
    downloadBlob(blob, 'camo-tile.png');
  });

  document.getElementById('btn-print').addEventListener('click', async () => {
    const paper   = document.getElementById('print-paper').value;
    const orient  = document.getElementById('print-orient').value;
    const tileIn  = parseFloat(document.getElementById('print-tile-in').value) || 4;
    const bleed   = document.getElementById('print-bleed').checked;
    const blob    = await state.tileCanvas.exportTile();
    const dataUrl = await blobToDataURL(blob);
    openPrintWindow(dataUrl, { paper, orient, tileIn, bleed });
  });
}

function blobToDataURL(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload  = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(blob);
  });
}

function openPrintWindow(dataUrl, { paper, orient, tileIn, bleed }) {
  const margin = bleed ? '0' : '0.25in';
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>CamoJack Print</title>
<style>
  @page { size: ${paper} ${orient}; margin: ${margin}; }
  html, body { margin: 0; padding: 0; background: #fff; }
  body {
    background-image: url('${dataUrl}');
    background-repeat: repeat;
    background-size: ${tileIn}in ${tileIn}in;
    width: 100%;
    min-height: 100vh;
    image-rendering: -webkit-optimize-contrast;
  }
  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
  .preview-note {
    position: fixed; top: 8px; left: 8px;
    font: 12px/1.4 system-ui, sans-serif;
    background: rgba(255,255,255,0.85); padding: 4px 8px;
    border: 1px solid #999;
  }
  @media print { .preview-note { display: none; } }
</style></head>
<body>
  <div class="preview-note">CamoJack print preview. If print dialog didn't open, press Ctrl/Cmd+P. Close this tab when done.</div>
  <script>
    window.addEventListener('load', () => { setTimeout(() => window.print(), 300); });
  <\/script>
</body></html>`;
  const w = window.open('', '_blank');
  if (!w) {
    alert('Popup blocked. Allow popups for this site to use print.');
    return;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a   = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
