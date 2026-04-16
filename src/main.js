import { TileCanvas } from './TileCanvas.js';
import { initUI } from './ui.js';

const canvas  = document.getElementById('tile-canvas');
const preview = document.getElementById('preview-canvas');

const tc = new TileCanvas({ canvas, previewCanvas: preview, size: 512 });

initUI(tc);
