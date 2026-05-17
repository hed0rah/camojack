// TileCanvas - the main editable tile canvas with wraparound brush tools

import { hexToRgb, rgbToHex } from './palettes.js';
import { createNoise } from './noise.js';

const MAX_HISTORY = 30;

export class TileCanvas {
  constructor({ canvas, previewCanvas, size = 512 }) {
    this.size = size;
    this.canvas = canvas;
    this.ctx    = canvas.getContext('2d', { willReadFrequently: true });
    canvas.width  = size;
    canvas.height = size;

    this.previewCanvas = previewCanvas;
    this.pctx = previewCanvas.getContext('2d');

    // tool state
    this.tool       = 'brush';
    this.color      = [74, 103, 65];
    this.color2     = [40, 30, 20];   // secondary color (gradient, swap)
    this.brushSize  = 20;
    this.opacity    = 1.0;     // solid by default -- camo is flat-printed
    this.hardness   = 1.0;     // hard edges by default
    this.spacing    = 0.30;    // stroke spacing as fraction of brush size
    this.brushShape = 'circle';
    this.sprayType  = 'uniform';
    this.blobStyle  = 'organic';
    this.blobVary   = true;
    this.blobPath   = false;    // path-follow mode: drag spine, blob spawns on mouseup
    this.blobSingle = false;   // single stamp per click (no drag-painting)
    this.blobLayered = false;  // stamps 2-4 overlapping offset blobs per click

    // stamp library: baked blob shapes (alpha masks) saved for reuse
    this.stamps = [];          // [{id, mask: Uint8Array, size, thumbUrl}]
    this.activeStampId = null;
    this.stampRotation = 0;    // fixed rotation (radians)
    this.stampRandomRotate = true; // randomize per click
    this.blobScale  = 0;       // 0 = auto (scales with brushSize), >0 = fixed perturbation px
    this._blobSeed  = 0;
    this._blobPathPts = [];
    this._offsetView = false;  // seamless editing: canvas shifted by half
    this.symmetry   = { h: false, v: false };

    // shape tool state
    this.shapeMode   = 'rect';   // 'rect' | 'ellipse'
    this.shapeFilled = false;

    // clone stamp state
    this._cloneSrc    = null;  // {x,y} alt-click source
    this._cloneOffset = null;  // {dx,dy} offset from source to dest
    this._cloneSnap   = null;  // imageData snapshot for source reading

    // line tool state
    this._lineStart   = null;  // {x,y} first click

    // shape/gradient preview state
    this._shapeStart  = null;  // {x,y} drag start
    this._shapeBase   = null;  // imageData snapshot for live preview

    // stroke state
    this._painting  = false;
    this._lastPos   = null;
    this._smearSnap = null;
    this._shiftHeld = false;
    this._strokeData = null; // persistent ImageData during a stroke (no get/put per move)

    // rAF-batched updates
    this._rafPending = 0;
    this._needsPreview = false;
    this._needsCursor  = false;

    // undo/redo
    this._history  = [];
    this._histIdx  = -1;

    // callbacks
    this.onColorPick = null;
    this.onStatusHint = null;  // (text) => update statusbar hint

    // cursor overlay
    this._cursorCanvas = document.getElementById('cursor-overlay');
    if (this._cursorCanvas) {
      this._cursorCtx = this._cursorCanvas.getContext('2d');
      this._cursorCanvas.width = canvas.width;
      this._cursorCanvas.height = canvas.height;
    }
    this._cursorPos = null;

    // callback for brush size/opacity changes from keyboard
    this.onBrushChange = null;

    this._fill(40, 30, 20);
    this._saveHistory();
    this._bindEvents();
    this.updatePreview();
  }

  // ---- public API ----

  setTool(t) {
    // clear any pending multi-click tool state when switching
    this._lineStart = null;
    this._shapeStart = null;
    this._shapeBase = null;
    this.tool = t;
    this._updateCursor();
    this._emitHint();
  }
  setColor(rgb)     { this.color     = rgb; }
  setColor2(rgb)    { this.color2    = rgb; }
  setBrushSize(n)   { this.brushSize = n; this._drawCursor(); }
  setOpacity(v)     { this.opacity   = v; }
  setHardness(v)    { this.hardness  = v; }
  setSpacing(v)     { this.spacing   = v; }
  setBrushShape(s)  { this.brushShape = s; }
  setSprayType(t)   { this.sprayType  = t; }
  setBlobStyle(s)   { this.blobStyle  = s; }
  setBlobVary(v)    { this.blobVary   = v; }
  setBlobPath(v)    { this.blobPath   = v; }
  setBlobSingle(v)  { this.blobSingle = v; }
  setBlobLayered(v) { this.blobLayered = v; }
  setActiveStamp(id) { this.activeStampId = id; }
  setStampRotation(rad) { this.stampRotation = rad; }
  setStampRandomRotate(v) { this.stampRandomRotate = v; }
  setBlobScale(v)   { this.blobScale  = v; }
  setShapeMode(m)   { this.shapeMode  = m; }
  setShapeFilled(v) { this.shapeFilled = v; }
  setSymmetry(h, v) { this.symmetry = { h, v }; }

  swapColors() {
    [this.color, this.color2] = [this.color2, this.color];
  }

  resize(newSize) {
    const tmp = document.createElement('canvas');
    tmp.width = newSize; tmp.height = newSize;
    const tc = tmp.getContext('2d');
    tc.drawImage(this.canvas, 0, 0, newSize, newSize);
    this.size = newSize;
    this.canvas.width = this.canvas.height = newSize;
    this.ctx.drawImage(tmp, 0, 0);
    if (this._cursorCanvas) {
      this._cursorCanvas.width = newSize;
      this._cursorCanvas.height = newSize;
    }
    this._history = [];
    this._histIdx = -1;
    this._saveHistory();
    this.updatePreview();
  }

  pushHistory() { this._saveHistory(); }

  undo() {
    if (this._histIdx <= 0) return;
    this._histIdx--;
    this.ctx.putImageData(this._history[this._histIdx], 0, 0);
    this._rehash();
    this.updatePreview();
  }

  redo() {
    if (this._histIdx >= this._history.length - 1) return;
    this._histIdx++;
    this.ctx.putImageData(this._history[this._histIdx], 0, 0);
    this._rehash();
    this.updatePreview();
  }

  _rehash() {
    const d = this._history[this._histIdx].data;
    let h = 0;
    for (let i = 0; i < d.length; i += 128) h = ((h << 5) + h + d[i]) | 0;
    this._lastHash = h;
  }

  setPreviewRepeat(n) {
    this.previewRepeat = n;
    this.updatePreview();
  }

  updatePreview() {
    const p = this.previewCanvas;
    const n = this.previewRepeat || 3;
    const pw = p.width / n, ph = p.height / n;
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        this.pctx.drawImage(this.canvas, c * pw, r * ph, pw, ph);
      }
    }
  }

  exportTile() {
    return new Promise(resolve => this.canvas.toBlob(resolve, 'image/png'));
  }

  exportSheet(cols, rows) {
    const S = this.size;
    const tmp = document.createElement('canvas');
    tmp.width = S * cols; tmp.height = S * rows;
    const tc = tmp.getContext('2d');
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        tc.drawImage(this.canvas, c * S, r * S);
      }
    }
    return new Promise(resolve => tmp.toBlob(resolve, 'image/png'));
  }

  // ---- private ----

  _emitHint() {
    if (!this.onStatusHint) return;
    const hints = {
      clone: this._cloneSrc ? '' : 'Alt+click to set clone source',
      line:  this._lineStart ? 'Click to draw line (Shift = constrain)' : 'Click to set start point',
      rect:  'Click+drag to draw rectangle (Shift = square)',
      ellipse: 'Click+drag to draw ellipse (Shift = circle)',
      gradient: 'Click+drag for gradient direction',
    };
    this.onStatusHint(hints[this.tool] ?? '');
  }

  _fill(r, g, b) {
    const id = this.ctx.createImageData(this.size, this.size);
    for (let i = 0; i < this.size * this.size; i++) {
      id.data[i * 4]     = r;
      id.data[i * 4 + 1] = g;
      id.data[i * 4 + 2] = b;
      id.data[i * 4 + 3] = 255;
    }
    this.ctx.putImageData(id, 0, 0);
  }

  _updateCursor() {
    // tools that show system cursor instead of brush outline
    const sysCursor = { picker: 'crosshair', fill: 'cell', clone: 'copy' };
    if (sysCursor[this.tool]) {
      this.canvas.style.cursor = sysCursor[this.tool];
    } else {
      this.canvas.style.cursor = 'none'; // hide system cursor, we draw our own
    }
  }

  _drawCursor(pos) {
    if (!this._cursorCtx) return;
    const ctx = this._cursorCtx;
    const sz = this.size;
    ctx.clearRect(0, 0, sz, sz);

    if (pos) this._cursorPos = pos;
    const p = this._cursorPos;
    if (!p) return;

    // don't draw cursor for tools that use system cursor
    const noCursorTools = ['picker', 'fill'];
    if (noCursorTools.includes(this.tool)) return;

    const r = this.brushSize;
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 1;

    if (this.brushShape === 'square') {
      ctx.strokeRect(p.x - r, p.y - r, r * 2, r * 2);
    } else if (this.brushShape === 'pixel') {
      ctx.strokeRect(Math.floor(p.x) - 0.5, Math.floor(p.y) - 0.5, 2, 2);
    } else {
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.stroke();
    }

    // inner dot for precision
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillRect(Math.floor(p.x), Math.floor(p.y), 1, 1);
  }

  _notifyBrushChange() {
    this._drawCursor();
    if (this.onBrushChange) this.onBrushChange({
      size: this.brushSize,
      opacity: this.opacity,
      hardness: this.hardness,
    });
  }

  _clearCursor() {
    if (this._cursorCtx) {
      this._cursorCtx.clearRect(0, 0, this.size, this.size);
    }
  }

  // live preview of the blob-path spine while the user drags. shows the
  // recorded points as a polyline plus a ghost circle at the cursor so
  // the user can see what shape they're about to commit on mouseup.
  _drawPathPreview() {
    if (!this._cursorCtx) return;
    const pts = this._blobPathPts;
    if (!pts || pts.length === 0) return;
    const ctx = this._cursorCtx;
    const S = this.size;
    ctx.clearRect(0, 0, S, S);

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // outer shadow for contrast on any background
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();

    // inner line
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();

    // ghost circle at current point showing brush radius
    const last = pts[pts.length - 1];
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(last.x, last.y, this.brushSize, 0, Math.PI * 2);
    ctx.stroke();
  }

  // rAF-batched paint loop: multiple requests coalesce into one frame
  _scheduleFrame(flags) {
    if (flags & 1) this._needsPreview = true;
    if (flags & 2) this._needsCursor = true;
    if (this._rafPending) return;
    this._rafPending = requestAnimationFrame(() => {
      this._rafPending = 0;
      if (this._needsPreview) {
        this._needsPreview = false;
        this.updatePreview();
      }
      if (this._needsCursor) {
        this._needsCursor = false;
        this._drawCursor();
      }
    });
  }

  _getTilePos(e) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (this.size / rect.width),
      y: (e.clientY - rect.top)  * (this.size / rect.height),
    };
  }

  _bindEvents() {
    const c = this.canvas;
    c.addEventListener('mousedown',  e => this._onDown(e));
    // canvas-level move drives cursor preview only when not painting --
    // active strokes use window-level listeners so they survive leaving
    // the canvas. this fixes the "stroke dies when you wander off" UX.
    c.addEventListener('mousemove',  e => { if (!this._painting) { this._onMove(e); this._updateCoords(e); } });
    c.addEventListener('mouseleave', () => { if (!this._painting) this._clearCursor(); });
    c.addEventListener('contextmenu', e => e.preventDefault());

    // pre-bind window handlers so attach/detach use the same function ref
    this._winMove = e => { this._onMove(e); this._updateCoords(e); };
    this._winUp   = e => this._onUp(e);

    window.addEventListener('keydown', e => {
      if (e.ctrlKey && e.key === 'z') { this.undo(); e.preventDefault(); }
      if (e.ctrlKey && e.key === 'y') { this.redo(); e.preventDefault(); }
      if (e.key === 'Shift') this._shiftHeld = true;

      // brush size: [ smaller, ] bigger
      if (e.key === '[' && !e.shiftKey) {
        this.brushSize = Math.max(1, this.brushSize <= 10 ? this.brushSize - 1 : Math.round(this.brushSize * 0.8));
        this._notifyBrushChange();
        e.preventDefault();
      }
      if (e.key === ']' && !e.shiftKey) {
        this.brushSize = Math.min(512, this.brushSize < 10 ? this.brushSize + 1 : Math.round(this.brushSize * 1.25));
        this._notifyBrushChange();
        e.preventDefault();
      }
      // hardness: { softer, } harder
      if (e.key === '{') {
        this.hardness = Math.max(0, Math.round((this.hardness - 0.1) * 10) / 10);
        this._notifyBrushChange();
        e.preventDefault();
      }
      if (e.key === '}') {
        this.hardness = Math.min(1, Math.round((this.hardness + 0.1) * 10) / 10);
        this._notifyBrushChange();
        e.preventDefault();
      }
      // opacity: 1-9 = 10%-90%, 0 = 100%
      if (!e.ctrlKey && !e.altKey && e.target.tagName !== 'INPUT' && e.target.tagName !== 'SELECT') {
        const num = parseInt(e.key);
        if (!isNaN(num) && num >= 0 && num <= 9) {
          this.opacity = num === 0 ? 1.0 : num / 10;
          this._notifyBrushChange();
        }
      }

      if (e.key === 'Escape') {
        // cancel pending line/shape
        if (this._lineStart) { this._lineStart = null; this._emitHint(); }
        if (this._shapeStart && this._shapeBase) {
          this.ctx.putImageData(this._shapeBase, 0, 0);
          this._shapeStart = null; this._shapeBase = null;
          this.updatePreview();
        }
      }
    });
    window.addEventListener('keyup', e => {
      if (e.key === 'Shift') this._shiftHeld = false;
    });
  }

  _updateCoords(e) {
    const pos = this._getTilePos(e);
    // cache DOM ref once
    if (!this._coordsEl) this._coordsEl = document.getElementById('canvas-coords');
    if (this._coordsEl) this._coordsEl.textContent = `x: ${Math.floor(pos.x)}  y: ${Math.floor(pos.y)}`;
    // rAF-batch the cursor draw so rapid mousemoves coalesce
    if (!this._painting) {
      this._cursorPos = pos;
      this._scheduleFrame(2);
    }
  }

  // ---- mouse handlers ----

  // attach window-level move/up so a stroke survives leaving the canvas
  _attachDrag() {
    if (this._dragAttached) return;
    window.addEventListener('mousemove', this._winMove);
    window.addEventListener('mouseup',   this._winUp);
    this._dragAttached = true;
  }

  _detachDrag() {
    if (!this._dragAttached) return;
    window.removeEventListener('mousemove', this._winMove);
    window.removeEventListener('mouseup',   this._winUp);
    this._dragAttached = false;
  }

  _onDown(e) {
    if (e.button !== 0) return;
    const pos = this._getTilePos(e);

    // -- picker --
    if (this.tool === 'picker') {
      this._pickColor(pos);
      return;
    }

    // -- fill --
    if (this.tool === 'fill') {
      this._saveHistory();
      this._floodFill(pos);
      return;
    }

    // -- clone: alt+click sets source --
    if (this.tool === 'clone' && e.altKey) {
      this._cloneSrc = { x: pos.x, y: pos.y };
      this._cloneOffset = null;
      this._emitHint();
      return;
    }

    // -- line: two-click workflow --
    if (this.tool === 'line') {
      if (!this._lineStart) {
        this._lineStart = pos;
        this._saveHistory();
        this._emitHint();
      } else {
        let end = pos;
        if (this._shiftHeld) end = this._snapAngle(this._lineStart, end);
        this._applyStroke(this._lineStart, end);
        this.updatePreview();
        this._lineStart = null;
        this._emitHint();
      }
      return;
    }

    // -- rect / ellipse / gradient: click-drag with preview --
    if (this.tool === 'rect' || this.tool === 'ellipse' || this.tool === 'gradient') {
      this._saveHistory();
      this._shapeStart = pos;
      this._shapeBase = this.ctx.getImageData(0, 0, this.size, this.size);
      this._painting = true;
      this._attachDrag();
      return;
    }

    // -- blob path mode: collect points with speed, render on mouseup --
    if (this.tool === 'blob' && this.blobPath) {
      this._saveHistory();
      this._blobPathPts = [{ x: pos.x, y: pos.y, speed: 0 }];
      this._painting = true;
      this._lastPos = pos;
      this._attachDrag();
      return;
    }

    // -- blob single stamp: one blob per click, no drag painting --
    if (this.tool === 'blob' && this.blobSingle) {
      this._saveHistory();
      this._applyStroke(pos, pos);
      this.updatePreview();
      return;
    }

    // -- blob layered: stamp 2-4 offset blobs per click for multi-shade overlap --
    if (this.tool === 'blob' && this.blobLayered) {
      this._saveHistory();
      const r = this.brushSize;
      const layers = 2 + Math.floor(Math.random() * 3); // 2-4 stamps
      const imageData = this.ctx.getImageData(0, 0, this.size, this.size);
      for (let n = 0; n < layers; n++) {
        // one seed per layer (shared across wraparound copies) so layers
        // differ from each other even when blobVary is off.
        const layerSeed = ((Math.random() * 0xFFFFFFFF) | 0) >>> 0;
        const ox = (Math.random() - 0.5) * r * 0.6;
        const oy = (Math.random() - 0.5) * r * 0.6;
        const positions = this._expandPositions(pos.x + ox, pos.y + oy);
        for (const [px, py] of positions) {
          this._paintBlob(imageData, px, py, layerSeed);
        }
      }
      this.ctx.putImageData(imageData, 0, 0);
      this.updatePreview();
      return;
    }

    // -- standard painting tools --
    this._painting = true;
    this._lastPos = pos;
    this._saveHistory();
    this._attachDrag();

    // grab one ImageData at stroke start, reuse across the whole drag
    this._strokeData = this.ctx.getImageData(0, 0, this.size, this.size);

    if (this.tool === 'smear') {
      // smear needs a read-only source snapshot (separate from stroke buffer)
      this._smearSnap = new ImageData(
        new Uint8ClampedArray(this._strokeData.data),
        this.size, this.size,
      );
    }

    if (this.tool === 'clone') {
      if (!this._cloneSrc) { this._strokeData = null; return; }
      if (!this._cloneOffset) {
        this._cloneOffset = {
          dx: this._cloneSrc.x - pos.x,
          dy: this._cloneSrc.y - pos.y,
        };
      }
      this._cloneSnap = new ImageData(
        new Uint8ClampedArray(this._strokeData.data),
        this.size, this.size,
      );
    }

    this._applyStroke(pos, pos);
  }

  _onMove(e) {
    if (!this._painting) return;
    const pos = this._getTilePos(e);
    const S = this.size;
    const inBounds = pos.x >= 0 && pos.x < S && pos.y >= 0 && pos.y < S;

    // blob path mode: only record while cursor is inside canvas. when the
    // user leaves and comes back, treat re-entry as a new segment by
    // pushing the entry point with zero speed (so we don't streak across
    // the panels).
    if (this.tool === 'blob' && this.blobPath) {
      if (!inBounds) {
        this._lastPos = null;
        return;
      }
      const prev = this._blobPathPts[this._blobPathPts.length - 1];
      const dx = pos.x - (prev?.x ?? pos.x);
      const dy = pos.y - (prev?.y ?? pos.y);
      const speed = (this._lastPos === null) ? 0 : Math.sqrt(dx * dx + dy * dy);
      this._blobPathPts.push({ x: pos.x, y: pos.y, speed });
      this._lastPos = pos;
      this._drawPathPreview();
      return;
    }

    // shape/gradient preview: clamp end to canvas so rubber-band stays
    // sane even when the cursor wanders into the side panels.
    if ((this.tool === 'rect' || this.tool === 'ellipse' || this.tool === 'gradient') && this._shapeStart && this._shapeBase) {
      this.ctx.putImageData(this._shapeBase, 0, 0);
      let end = {
        x: Math.max(0, Math.min(S - 1, pos.x)),
        y: Math.max(0, Math.min(S - 1, pos.y)),
      };
      if (this._shiftHeld) {
        if (this.tool === 'gradient') {
          end = this._snapAngle(this._shapeStart, end);
        } else {
          end = this._constrainSquare(this._shapeStart, end);
        }
      }
      if (this.tool === 'gradient') {
        this._drawGradient(this._shapeStart, end);
      } else {
        this._drawShape(this._shapeStart, end);
      }
      this._scheduleFrame(1);
      return;
    }

    // standard stroke tools: don't paint while outside canvas; on
    // re-entry, snap _lastPos to current so we don't draw a long streak
    // back to where the cursor exited.
    if (!inBounds) {
      this._lastPos = null;
      return;
    }
    if (this._lastPos === null) {
      this._lastPos = pos;
    }
    this._applyStroke(this._lastPos, pos);
    // smear/clone use the persistent stroke buffer's data as the source snapshot
    // no more full getImageData per frame
    if (this.tool === 'smear' && this._strokeData) {
      this._smearSnap.data.set(this._strokeData.data);
    }
    if (this.tool === 'clone' && this._strokeData) {
      this._cloneSnap.data.set(this._strokeData.data);
    }
    this._lastPos = pos;
    this._scheduleFrame(1);
  }

  _onUp(e) {
    if (!this._painting) return;
    this._detachDrag();

    // finalize blob path
    if (this.tool === 'blob' && this.blobPath && this._blobPathPts.length > 1) {
      this._clearCursor();           // wipe the path-preview polyline
      this._renderBlobPath(this._blobPathPts);
      this._blobPathPts = [];
      this._painting = false;
      this._lastPos = null;
      this.updatePreview();
      this._drawCursor();            // restore brush outline
      return;
    }
    this._blobPathPts = [];

    // finalize shape/gradient
    if ((this.tool === 'rect' || this.tool === 'ellipse' || this.tool === 'gradient') && this._shapeStart) {
      // the last _onMove already drew the final state
      this._shapeStart = null;
      this._shapeBase = null;
    }

    this._painting  = false;
    this._lastPos   = null;
    this._smearSnap = null;
    this._cloneSnap = null;
    this._strokeData = null; // release stroke buffer
    this.updatePreview();
    this._drawCursor(); // restore cursor after painting
  }

  // ---- angle snap helper (0/45/90/135/180) ----

  _snapAngle(origin, point) {
    const dx = point.x - origin.x;
    const dy = point.y - origin.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const angle = Math.atan2(dy, dx);
    const snapped = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
    return {
      x: origin.x + Math.cos(snapped) * dist,
      y: origin.y + Math.sin(snapped) * dist,
    };
  }

  // constrain to square (equal width/height)
  _constrainSquare(start, end) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const side = Math.max(Math.abs(dx), Math.abs(dy));
    return {
      x: start.x + Math.sign(dx) * side,
      y: start.y + Math.sign(dy) * side,
    };
  }

  // ---- stroke interpolation ----

  _applyStroke(from, to) {
    const spacing = Math.max(1, this.brushSize * this.spacing);
    const dx = to.x - from.x, dy = to.y - from.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    // use persistent stroke buffer if available (during drag)
    // otherwise grab a one-shot imageData for a single-click operation
    const useStroke = this._strokeData !== null;
    const imageData = useStroke ? this._strokeData : this.ctx.getImageData(0, 0, this.size, this.size);

    if (dist === 0) {
      // single point: paint exactly once (no double-application bug)
      this._applyAtPoint(imageData, from.x, from.y, 0, 0);
    } else {
      const steps = Math.max(1, Math.ceil(dist / spacing));
      const invDist = 1 / dist;
      const ndx = dx * invDist;
      const ndy = dy * invDist;
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const x = from.x + dx * t;
        const y = from.y + dy * t;
        this._applyAtPoint(imageData, x, y, ndx, ndy);
      }
    }

    this.ctx.putImageData(imageData, 0, 0);
  }

  // get all positions to paint at (base + symmetry + wraparound)
  _expandPositions(cx, cy) {
    const S = this.size;
    const r = this.brushSize;
    const bases = [[cx, cy]];

    if (this.symmetry.h) bases.push([cx, S - cy]);
    if (this.symmetry.v) bases.push([S - cx, cy]);
    if (this.symmetry.h && this.symmetry.v) bases.push([S - cx, S - cy]);

    const result = [];
    for (const [bx, by] of bases) {
      result.push([bx, by]);
      if (bx - r < 0)  result.push([bx + S, by]);
      if (bx + r > S)  result.push([bx - S, by]);
      if (by - r < 0)  result.push([bx, by + S]);
      if (by + r > S)  result.push([bx, by - S]);
      if (bx - r < 0  && by - r < 0)  result.push([bx + S, by + S]);
      if (bx + r > S  && by - r < 0)  result.push([bx - S, by + S]);
      if (bx - r < 0  && by + r > S)  result.push([bx + S, by - S]);
      if (bx + r > S  && by + r > S)  result.push([bx - S, by - S]);
    }
    return result;
  }

  _applyAtPoint(imageData, cx, cy, ndx, ndy) {
    // spray manages its own wrap+symmetry (toroidal per-dot), so call once
    if (this.tool === 'spray') {
      this._paintSpray(imageData, cx, cy);
      return;
    }

    // procedural blob: lock one seed so every wraparound copy is the same
    // silhouette -- otherwise the wrapped half of an edge stamp is a
    // different random shape and the seam visibly breaks.
    let blobSeed = null;
    if (this.tool === 'blob' && !(this.activeStampId && this.stamps.length > 0)) {
      blobSeed = this.blobVary ? (this._blobSeed++ + 1) : 1337;
    }
    // same rule for active stamps with random rotation -- pin the angle once
    let stampAngleOverride = null;
    if (this.tool === 'blob' && this.activeStampId && this.stamps.length > 0
        && this.stampRandomRotate) {
      stampAngleOverride = Math.random() * Math.PI * 2;
    }

    const positions = this._expandPositions(cx, cy);
    for (const [px, py] of positions) {
      switch (this.tool) {
        case 'brush':  this._paintBrush(imageData, px, py, this.color); break;
        case 'eraser': this._paintBrush(imageData, px, py, this.color, true); break;
        case 'smear':  this._paintSmear(imageData, px, py, ndx, ndy); break;
        case 'blob':
          // if an active stamp is selected, use it; otherwise procedural blob
          if (this.activeStampId && this.stamps.length > 0) {
            this._paintStamp(imageData, px, py, stampAngleOverride);
          } else {
            this._paintBlob(imageData, px, py, blobSeed);
          }
          break;
        case 'clone':  this._paintClone(imageData, px, py); break;
        case 'line':   this._paintBrush(imageData, px, py, this.color); break;
      }
    }
  }

  // ---- paint: brush ----

  _paintBrush(imageData, cx, cy, color, eraser = false) {
    const data = imageData.data;
    const width = imageData.width, height = imageData.height;
    const r  = this.brushSize;
    const h  = this.hardness;
    const op = this.opacity;
    const shape = this.brushShape;
    const [rc, gc, bc] = eraser ? this.color2 : color;

    if (shape === 'pixel') {
      const pxI = (cx + 0.5) | 0, pyI = (cy + 0.5) | 0;
      if (pxI >= 0 && pxI < width && pyI >= 0 && pyI < height) {
        const i = (pyI * width + pxI) * 4;
        const invOp = 1 - op;
        data[i]     = (data[i]     * invOp + rc * op) | 0;
        data[i + 1] = (data[i + 1] * invOp + gc * op) | 0;
        data[i + 2] = (data[i + 2] * invOp + bc * op) | 0;
      }
      return;
    }

    // hoist constants
    const r2 = r * r;
    const invR = 1 / r;
    const softDivisor = 1 / (1 - h + 0.001);
    const isSquare = shape === 'square';

    const x0 = Math.max(0, (cx - r + 1) | 0);
    const x1 = Math.min(width  - 1, (cx + r) | 0);
    const y0 = Math.max(0, (cy - r + 1) | 0);
    const y1 = Math.min(height - 1, (cy + r) | 0);

    for (let py = y0; py <= y1; py++) {
      const dy = py - cy;
      const dy2 = dy * dy;
      const rowBase = py * width;
      for (let px = x0; px <= x1; px++) {
        const dx = px - cx;
        let alpha;

        if (isSquare) {
          const adx = dx < 0 ? -dx : dx;
          const ady = dy < 0 ? -dy : dy;
          const d = adx > ady ? adx : ady;
          if (d > r) continue;
          const t = d * invR;
          alpha = (t <= h ? 1 : 1 - (t - h) * softDivisor) * op;
          if (alpha <= 0) continue;
        } else {
          const d2 = dx * dx + dy2;
          if (d2 > r2) continue;
          const t = Math.sqrt(d2) * invR;
          alpha = (t <= h ? 1 : 1 - (t - h) * softDivisor) * op;
          if (alpha <= 0) continue;
        }

        const i = (rowBase + px) * 4;
        const inv = 1 - alpha;
        data[i]     = (data[i]     * inv + rc * alpha) | 0;
        data[i + 1] = (data[i + 1] * inv + gc * alpha) | 0;
        data[i + 2] = (data[i + 2] * inv + bc * alpha) | 0;
      }
    }
  }

  // ---- paint: smear ----

  _paintSmear(imageData, cx, cy, ndx, ndy) {
    const { data, width, height } = imageData;
    const src = this._smearSnap ?? imageData;
    const r   = this.brushSize;
    const op  = this.opacity * 0.6;
    const pull = r * 0.4;

    const x0 = Math.max(0, Math.ceil(cx - r));
    const x1 = Math.min(width  - 1, Math.floor(cx + r));
    const y0 = Math.max(0, Math.ceil(cy - r));
    const y1 = Math.min(height - 1, Math.floor(cy + r));

    for (let py = y0; py <= y1; py++) {
      for (let px = x0; px <= x1; px++) {
        const dx = px - cx, dy = py - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > r) continue;

        const t = 1 - dist / r;
        const alpha = t * t * op;

        const sx = px - ndx * pull * t;
        const sy = py - ndy * pull * t;

        const [sr, sg, sb] = this._bilinear(src.data, width, height, sx, sy);

        const i = (py * width + px) * 4;
        data[i]     = Math.round(data[i]     * (1 - alpha) + sr * alpha);
        data[i + 1] = Math.round(data[i + 1] * (1 - alpha) + sg * alpha);
        data[i + 2] = Math.round(data[i + 2] * (1 - alpha) + sb * alpha);
      }
    }
  }

  // ---- paint: clone stamp ----

  _paintClone(imageData, cx, cy) {
    if (!this._cloneSnap || !this._cloneOffset) return;
    const { data, width, height } = imageData;
    const src = this._cloneSnap;
    const r  = this.brushSize;
    const h  = this.hardness;
    const op = this.opacity;
    const { dx: odx, dy: ody } = this._cloneOffset;

    const x0 = Math.max(0, Math.ceil(cx - r));
    const x1 = Math.min(width  - 1, Math.floor(cx + r));
    const y0 = Math.max(0, Math.ceil(cy - r));
    const y1 = Math.min(height - 1, Math.floor(cy + r));

    for (let py = y0; py <= y1; py++) {
      for (let px = x0; px <= x1; px++) {
        const dx = px - cx, dy = py - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > r) continue;

        const t = dist / r;
        const alpha = Math.max(0, t <= h ? 1 : 1 - (t - h) / (1 - h + 0.001)) * op;

        // sample from source position (toroidal via _bilinear)
        const [sr, sg, sb] = this._bilinear(src.data, width, height, px + odx, py + ody);

        const i = (py * width + px) * 4;
        data[i]     = Math.round(data[i]     * (1 - alpha) + sr * alpha);
        data[i + 1] = Math.round(data[i + 1] * (1 - alpha) + sg * alpha);
        data[i + 2] = Math.round(data[i + 2] * (1 - alpha) + sb * alpha);
      }
    }
  }

  // ---- paint: blob ----

  // metaball cluster stamp: 1 core + 4-7 satellites, painted where the summed
  // field exceeds a threshold. produces smooth lobed shapes like real woodland
  // camo blobs. replaces angular-noise perturbation which produced spiky stars.
  // seedOverride lets callers force a specific shape -- needed so wraparound
  // copies (and layered stamps) keep the same silhouette across the seam.
  _paintBlob(imageData, cx, cy, seedOverride = null) {
    const { data, width, height } = imageData;
    const r   = this.brushSize;
    const op  = this.opacity;
    const [rc, gc, bc] = this.color;
    const style = this.blobStyle;

    let s = seedOverride !== null
      ? seedOverride
      : (this.blobVary ? (this._blobSeed++ + 1) : 1337);
    s = s >>> 0;
    const rng = () => { s = (Math.imul(1664525, s) + 1013904223) >>> 0; return s / 0x100000000; };

    // style -> cluster shape parameters
    let nSat, spread, satSize, threshold, anisotropy = 1, axisAngle = 0;
    switch (style) {
      case 'cloud':
        nSat = 7; spread = 1.0; satSize = 0.80; threshold = 1.2; break;
      case 'splat':
        nSat = 6; spread = 1.35; satSize = 0.50; threshold = 1.3; break;
      case 'elongated':
        nSat = 5; spread = 1.0; satSize = 0.65; threshold = 1.5;
        anisotropy = 2.4; axisAngle = rng() * Math.PI * 2; break;
      case 'jagged':
        nSat = 4; spread = 0.80; satSize = 0.55; threshold = 1.8; break;
      default: // organic -- the classic woodland-camo blob
        nSat = 5; spread = 1.0; satSize = 0.70; threshold = 1.55; break;
    }

    // manual perturbation slider scales satellite reach when > 0
    const reachScale = this.blobScale > 0 ? this.blobScale / Math.max(1, r) : 1.0;
    const coreR = r * 0.55;
    const ca = Math.cos(axisAngle), sa = Math.sin(axisAngle);

    const blobs = [{ x: cx, y: cy, r: coreR * (0.95 + rng() * 0.15) }];
    for (let i = 0; i < nSat; i++) {
      const angle = (i / nSat) * Math.PI * 2 + (rng() - 0.5) * 0.7;
      const d = coreR * spread * (0.75 + rng() * 0.5) * reachScale;
      // anisotropic stretch along axisAngle for elongated style
      const lx = Math.cos(angle) * d * anisotropy;
      const ly = Math.sin(angle) * d;
      blobs.push({
        x: cx + (lx * ca - ly * sa),
        y: cy + (lx * sa + ly * ca),
        r: coreR * satSize * (0.7 + rng() * 0.55),
      });
    }

    // AABB over all blobs (each blob's metaball field tapers off by ~3r)
    let ax0 = width, ay0 = height, ax1 = 0, ay1 = 0;
    for (const b of blobs) {
      const reach = b.r * 3;
      if (b.x - reach < ax0) ax0 = b.x - reach;
      if (b.y - reach < ay0) ay0 = b.y - reach;
      if (b.x + reach > ax1) ax1 = b.x + reach;
      if (b.y + reach > ay1) ay1 = b.y + reach;
    }
    const x0 = Math.max(0, Math.floor(ax0));
    const y0 = Math.max(0, Math.floor(ay0));
    const x1 = Math.min(width - 1, Math.ceil(ax1));
    const y1 = Math.min(height - 1, Math.ceil(ay1));

    // soft band: lower hardness -> softer edge falloff outside the threshold
    const softBand = (1 - this.hardness) * threshold * 0.6;

    for (let py = y0; py <= y1; py++) {
      for (let px = x0; px <= x1; px++) {
        let sum = 0;
        for (let k = 0; k < blobs.length; k++) {
          const b = blobs[k];
          const dx = px - b.x, dy = py - b.y;
          const d2 = dx * dx + dy * dy;
          const r2 = b.r * b.r;
          if (d2 < r2 * 9) sum += r2 / (r2 + d2);
        }
        if (sum <= threshold) continue;

        let alpha;
        if (softBand <= 0) {
          alpha = op;
        } else {
          alpha = Math.min(1, (sum - threshold) / softBand) * op;
        }
        if (alpha <= 0) continue;

        const i = (py * width + px) * 4;
        const inv = 1 - alpha;
        data[i]     = (data[i]     * inv + rc * alpha) | 0;
        data[i + 1] = (data[i + 1] * inv + gc * alpha) | 0;
        data[i + 2] = (data[i + 2] * inv + bc * alpha) | 0;
      }
    }
  }

  // ---- blob path rendering ----
  // draws a blob shape whose spine follows the recorded mouse path

  _renderBlobPath(pts) {
    if (pts.length < 2) return;
    const imageData = this.ctx.getImageData(0, 0, this.size, this.size);
    const { data, width, height } = imageData;
    const S   = this.size;
    const r   = this.brushSize;
    const op  = this.opacity;
    const [rc, gc, bc] = this.color;

    // subsample the recorded path to evenly spaced spine points.
    // tighter spacing keeps the metaball field above threshold between blobs;
    // earlier spacing of r*0.4 left gaps on fast strokes (thin blob + wide spacing).
    const spacing = Math.max(2, r * 0.28);
    const spine = [pts[0]];
    let accum = 0;
    for (let i = 1; i < pts.length; i++) {
      const dx = pts[i].x - pts[i-1].x;
      const dy = pts[i].y - pts[i-1].y;
      accum += Math.sqrt(dx * dx + dy * dy);
      if (accum >= spacing) {
        spine.push(pts[i]);
        accum = 0;
      }
    }
    if (spine.length < 2) spine.push(pts[pts.length - 1]);

    // speed-based radii: drawing fast = thinner stroke, slow = thicker.
    const speeds = spine.map(p => p.speed || 0);
    const maxSpeed = Math.max(1, ...speeds);
    const spineRadii = spine.map(p => {
      const speedNorm = (p.speed || 0) / maxSpeed;
      return r * (1.0 - speedNorm * 0.5);   // range: 0.5r to 1.0r
    });
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 1; i < spineRadii.length - 1; i++) {
        spineRadii[i] = spineRadii[i] * 0.5 + (spineRadii[i-1] + spineRadii[i+1]) * 0.25;
      }
    }

    // chain-of-metaballs along the path
    const baseBlobs = spine.map((p, i) => ({ x: p.x, y: p.y, r: spineRadii[i] * 0.7 }));

    // expand each spine ball into mirror/wrap copies so the path tiles
    // seamlessly and respects the symmetry toggles.
    const sym = this.symmetry;
    const blobs = [];
    for (const b of baseBlobs) {
      const bases = [[b.x, b.y]];
      if (sym.h) bases.push([b.x, S - b.y]);
      if (sym.v) bases.push([S - b.x, b.y]);
      if (sym.h && sym.v) bases.push([S - b.x, S - b.y]);
      for (const [bx, by] of bases) {
        blobs.push({ x: bx, y: by, r: b.r });
        // toroidal phantoms when the field reaches off-edge
        const reach = b.r * 3;
        const leftWrap  = bx - reach < 0;
        const rightWrap = bx + reach > S;
        const topWrap   = by - reach < 0;
        const botWrap   = by + reach > S;
        if (leftWrap)  blobs.push({ x: bx + S, y: by, r: b.r });
        if (rightWrap) blobs.push({ x: bx - S, y: by, r: b.r });
        if (topWrap)   blobs.push({ x: bx, y: by + S, r: b.r });
        if (botWrap)   blobs.push({ x: bx, y: by - S, r: b.r });
        if (leftWrap  && topWrap) blobs.push({ x: bx + S, y: by + S, r: b.r });
        if (rightWrap && topWrap) blobs.push({ x: bx - S, y: by + S, r: b.r });
        if (leftWrap  && botWrap) blobs.push({ x: bx + S, y: by - S, r: b.r });
        if (rightWrap && botWrap) blobs.push({ x: bx - S, y: by - S, r: b.r });
      }
    }

    // match click-blob's per-style threshold so a path stroke has the same
    // edge character as a click stamp of the same style.
    let threshold;
    switch (this.blobStyle) {
      case 'cloud':     threshold = 1.20; break;
      case 'splat':     threshold = 1.30; break;
      case 'elongated': threshold = 1.40; break;
      case 'jagged':    threshold = 1.65; break;
      default:          threshold = 1.45; break;   // organic
    }
    const softBand = (1 - this.hardness) * threshold * 0.6;

    // AABB clamped to canvas; phantoms outside the canvas contribute via the
    // metaball field even though we don't iterate their pixels directly.
    let ax0 = width, ay0 = height, ax1 = 0, ay1 = 0;
    for (const b of blobs) {
      const reach = b.r * 3;
      if (b.x - reach < ax0) ax0 = b.x - reach;
      if (b.y - reach < ay0) ay0 = b.y - reach;
      if (b.x + reach > ax1) ax1 = b.x + reach;
      if (b.y + reach > ay1) ay1 = b.y + reach;
    }
    const x0 = Math.max(0, Math.floor(ax0));
    const y0 = Math.max(0, Math.floor(ay0));
    const x1 = Math.min(width - 1, Math.ceil(ax1));
    const y1 = Math.min(height - 1, Math.ceil(ay1));

    for (let py = y0; py <= y1; py++) {
      for (let px = x0; px <= x1; px++) {
        let sum = 0;
        for (let k = 0; k < blobs.length; k++) {
          const b = blobs[k];
          const dx = px - b.x, dy = py - b.y;
          const d2 = dx * dx + dy * dy;
          const r2 = b.r * b.r;
          if (d2 < r2 * 9) sum += r2 / (r2 + d2);
        }
        if (sum <= threshold) continue;

        let alpha;
        if (softBand <= 0) {
          alpha = op;
        } else {
          alpha = Math.min(1, (sum - threshold) / softBand) * op;
        }
        if (alpha <= 0) continue;

        const i = (py * width + px) * 4;
        const inv = 1 - alpha;
        data[i]     = (data[i]     * inv + rc * alpha) | 0;
        data[i + 1] = (data[i + 1] * inv + gc * alpha) | 0;
        data[i + 2] = (data[i + 2] * inv + bc * alpha) | 0;
      }
    }

    this.ctx.putImageData(imageData, 0, 0);
  }

  // ---- stamp library ----

  // generate a random blob shape as a baked alpha mask
  // type: 'organic' | 'elongated' | 'brick' | 'digital' | 'splatter'
  // hard: true = solid silhouette, false = soft falloff
  generateRandomStamp(opts = {}) {
    const {
      type = 'organic',
      refSize = 128,
      hard = true,
    } = opts;

    const mask = new Uint8ClampedArray(refSize * refSize);

    if (type === 'organic')        this._buildOrganicMask(mask, refSize);
    else if (type === 'elongated') this._buildElongatedMask(mask, refSize);
    else if (type === 'brick')     this._buildBrickMask(mask, refSize);
    else if (type === 'digital')   this._buildDigitalMask(mask, refSize);
    else if (type === 'splatter')  this._buildSplatterMask(mask, refSize);
    else                           this._buildOrganicMask(mask, refSize);

    // hard edge: snap partial alphas to fully on/off with 1-pixel feather
    if (hard) {
      for (let i = 0; i < mask.length; i++) {
        if (mask[i] >= 128) mask[i] = 255;
        else if (mask[i] > 32) mask[i] = mask[i] * 2;
        else mask[i] = 0;
      }
    }

    return this._registerStamp(mask, refSize);
  }

  // ---- stamp shape builders ----

  // organic: union of 4-7 overlapping circles via metaball field
  // gives smooth puzzle-piece shapes like real woodland camo
  _buildOrganicMask(mask, sz) {
    const cx = sz / 2, cy = sz / 2;
    const baseR = sz * 0.16;

    const blobs = [{ x: cx, y: cy, r: baseR * (0.9 + Math.random() * 0.5) }];
    const n = 4 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const angle = (i / n) * Math.PI * 2 + (Math.random() - 0.5) * 0.8;
      const dist = baseR * (0.9 + Math.random() * 1.0);
      blobs.push({
        x: cx + Math.cos(angle) * dist,
        y: cy + Math.sin(angle) * dist,
        r: baseR * (0.5 + Math.random() * 0.7),
      });
    }

    const T = 0.6;
    for (let py = 0; py < sz; py++) {
      for (let px = 0; px < sz; px++) {
        let sum = 0;
        for (const b of blobs) {
          const dx = px - b.x, dy = py - b.y;
          const d2 = dx * dx + dy * dy;
          const r2 = b.r * b.r;
          if (d2 < r2 * 9) sum += r2 / (d2 + 1);
        }
        if (sum > T) {
          const v = Math.min(1, (sum - T) * 4);
          mask[py * sz + px] = (v * 255) | 0;
        }
      }
    }
  }

  // elongated: line of metaballs with perpendicular jitter
  _buildElongatedMask(mask, sz) {
    const cx = sz / 2, cy = sz / 2;
    const baseR = sz * 0.12;
    const stretchAngle = Math.random() * Math.PI * 2;
    const cosA = Math.cos(stretchAngle), sinA = Math.sin(stretchAngle);

    const n = 4 + Math.floor(Math.random() * 3);
    const blobs = [];
    for (let i = 0; i < n; i++) {
      const t = (i / (n - 1) - 0.5) * sz * 0.55;
      const offX = cosA * t;
      const offY = sinA * t;
      const jit = (Math.random() - 0.5) * baseR * 1.2;
      const jx = -sinA * jit;
      const jy = cosA * jit;
      blobs.push({
        x: cx + offX + jx,
        y: cy + offY + jy,
        r: baseR * (0.7 + Math.random() * 0.6),
      });
    }

    const T = 0.55;
    for (let py = 0; py < sz; py++) {
      for (let px = 0; px < sz; px++) {
        let sum = 0;
        for (const b of blobs) {
          const dx = px - b.x, dy = py - b.y;
          const d2 = dx * dx + dy * dy;
          const r2 = b.r * b.r;
          if (d2 < r2 * 9) sum += r2 / (d2 + 1);
        }
        if (sum > T) {
          const v = Math.min(1, (sum - T) * 4);
          mask[py * sz + px] = (v * 255) | 0;
        }
      }
    }
  }

  // brick: rounded rectangle with random size + slight tilt
  _buildBrickMask(mask, sz) {
    const cx = sz / 2, cy = sz / 2;
    const w = sz * (0.30 + Math.random() * 0.20);
    const h = sz * (0.18 + Math.random() * 0.16);
    const radius = Math.min(w, h) * (0.10 + Math.random() * 0.20);
    const angle = (Math.random() - 0.5) * 0.4;
    const cosA = Math.cos(angle), sinA = Math.sin(angle);

    for (let py = 0; py < sz; py++) {
      for (let px = 0; px < sz; px++) {
        const dx = px - cx, dy = py - cy;
        const lx = dx * cosA + dy * sinA;
        const ly = -dx * sinA + dy * cosA;
        // SDF of a rounded box
        const qx = Math.abs(lx) - w + radius;
        const qy = Math.abs(ly) - h + radius;
        const outside = Math.sqrt(Math.max(qx, 0) ** 2 + Math.max(qy, 0) ** 2)
                      + Math.min(Math.max(qx, qy), 0) - radius;
        if (outside <= 0) {
          mask[py * sz + px] = 255;
        } else if (outside < 1.5) {
          mask[py * sz + px] = ((1.5 - outside) / 1.5 * 255) | 0;
        }
      }
    }
  }

  // digital: pixelated voronoi-style cell (MARPAT chip)
  _buildDigitalMask(mask, sz) {
    const cellPx = 5 + Math.floor(Math.random() * 5);
    const cx = sz / 2, cy = sz / 2;
    const baseR = sz * 0.20;

    // smooth metaball shape, then quantize to cells
    const blobs = [{ x: cx, y: cy, r: baseR }];
    const n = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const angle = (i / n) * Math.PI * 2 + (Math.random() - 0.5) * 0.6;
      const dist = baseR * (0.7 + Math.random() * 0.7);
      blobs.push({
        x: cx + Math.cos(angle) * dist,
        y: cy + Math.sin(angle) * dist,
        r: baseR * (0.4 + Math.random() * 0.5),
      });
    }

    const T = 0.5;
    for (let py = 0; py < sz; py += cellPx) {
      for (let px = 0; px < sz; px += cellPx) {
        const scx = px + cellPx / 2;
        const scy = py + cellPx / 2;
        let sum = 0;
        for (const b of blobs) {
          const dx = scx - b.x, dy = scy - b.y;
          const d2 = dx * dx + dy * dy;
          const r2 = b.r * b.r;
          if (d2 < r2 * 9) sum += r2 / (d2 + 1);
        }
        const fill = sum > T ? 255 : 0;
        for (let cy2 = py; cy2 < py + cellPx && cy2 < sz; cy2++) {
          for (let cx2 = px; cx2 < px + cellPx && cx2 < sz; cx2++) {
            mask[cy2 * sz + cx2] = fill;
          }
        }
      }
    }
  }

  // splatter: irregular paint splat with widely scattered satellites
  _buildSplatterMask(mask, sz) {
    const cx = sz / 2, cy = sz / 2;
    const baseR = sz * 0.14;

    const blobs = [{ x: cx, y: cy, r: baseR * 1.2 }];
    const n = 6 + Math.floor(Math.random() * 5);
    for (let i = 0; i < n; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = baseR * (0.8 + Math.random() * 2.4);
      blobs.push({
        x: cx + Math.cos(angle) * dist,
        y: cy + Math.sin(angle) * dist,
        r: baseR * (0.20 + Math.random() * 0.50),
      });
    }

    const T = 0.5;
    for (let py = 0; py < sz; py++) {
      for (let px = 0; px < sz; px++) {
        let sum = 0;
        for (const b of blobs) {
          const dx = px - b.x, dy = py - b.y;
          const d2 = dx * dx + dy * dy;
          const r2 = b.r * b.r;
          if (d2 < r2 * 9) sum += r2 / (d2 + 1);
        }
        if (sum > T) {
          const v = Math.min(1, (sum - T) * 5);
          mask[py * sz + px] = (v * 255) | 0;
        }
      }
    }
  }

  // build thumbnail canvas and store stamp
  _registerStamp(mask, refSize) {
    const thumb = document.createElement('canvas');
    thumb.width = 48;
    thumb.height = 48;
    const tctx = thumb.getContext('2d');
    const thumbData = tctx.createImageData(48, 48);
    const td = thumbData.data;
    const scale = refSize / 48;
    for (let ty = 0; ty < 48; ty++) {
      for (let tx = 0; tx < 48; tx++) {
        const sx = (tx * scale) | 0;
        const sy = (ty * scale) | 0;
        const a = mask[sy * refSize + sx];
        const i = (ty * 48 + tx) * 4;
        td[i] = 240; td[i + 1] = 240; td[i + 2] = 240;
        td[i + 3] = a;
      }
    }
    tctx.putImageData(thumbData, 0, 0);
    const thumbUrl = thumb.toDataURL();

    const id = 'stamp_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
    this.stamps.push({ id, mask, size: refSize, thumbUrl });
    this.activeStampId = id;
    return id;
  }

  // import a stamp from an image file: uses alpha if present, else luminance threshold
  async importStamp(file, refSize = 128) {
    const url = URL.createObjectURL(file);
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });

    const tmp = document.createElement('canvas');
    tmp.width = refSize;
    tmp.height = refSize;
    const tctx = tmp.getContext('2d');
    const aspect = img.width / img.height;
    let dw, dh, dx, dy;
    if (aspect >= 1) {
      dw = refSize; dh = refSize / aspect;
      dx = 0; dy = (refSize - dh) / 2;
    } else {
      dh = refSize; dw = refSize * aspect;
      dx = (refSize - dw) / 2; dy = 0;
    }
    tctx.drawImage(img, dx, dy, dw, dh);
    URL.revokeObjectURL(url);

    const data = tctx.getImageData(0, 0, refSize, refSize).data;
    const mask = new Uint8ClampedArray(refSize * refSize);

    let hasAlpha = false;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] < 250) { hasAlpha = true; break; }
    }

    if (hasAlpha) {
      for (let i = 0; i < mask.length; i++) mask[i] = data[i * 4 + 3];
    } else {
      for (let i = 0; i < mask.length; i++) {
        const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
        const lum = r * 0.3 + g * 0.59 + b * 0.11;
        mask[i] = lum < 128 ? 255 : 0;
      }
    }

    return this._registerStamp(mask, refSize);
  }

  deleteStamp(id) {
    this.stamps = this.stamps.filter(s => s.id !== id);
    if (this.activeStampId === id) {
      this.activeStampId = this.stamps.length > 0 ? this.stamps[0].id : null;
    }
  }

  _paintStamp(imageData, cx, cy, angleOverride = null) {
    const stamp = this.stamps.find(s => s.id === this.activeStampId);
    if (!stamp) return;

    const data = imageData.data;
    const width = imageData.width, height = imageData.height;
    const r = this.brushSize;
    const op = this.opacity;
    const [rc, gc, bc] = this.color;

    // angleOverride lets the caller pin a stable angle across wraparound
    // copies so seams don't get mismatched rotations.
    let angle;
    if (angleOverride !== null) angle = angleOverride;
    else angle = this.stampRandomRotate
      ? Math.random() * Math.PI * 2
      : this.stampRotation;
    const cosA = Math.cos(angle), sinA = Math.sin(angle);

    // rotated stamp reaches up to r*sqrt(2) on the diagonal
    const reach = r * Math.SQRT2;
    const x0 = Math.max(0, (cx - reach) | 0);
    const x1 = Math.min(width - 1, (cx + reach + 1) | 0);
    const y0 = Math.max(0, (cy - reach) | 0);
    const y1 = Math.min(height - 1, (cy + reach + 1) | 0);

    const stampSize = stamp.size;
    const stampCenter = stampSize / 2;
    const scale = stampSize / (r * 2);
    const mask = stamp.mask;

    for (let py = y0; py <= y1; py++) {
      const dy = py - cy;
      const rowBase = py * width;
      for (let px = x0; px <= x1; px++) {
        const dx = px - cx;
        // rotate destination coords into stamp-local space
        const rdx = dx * cosA + dy * sinA;
        const rdy = -dx * sinA + dy * cosA;
        const sx = rdx * scale + stampCenter;
        const sy = rdy * scale + stampCenter;
        if (sx < 0 || sx >= stampSize - 1 || sy < 0 || sy >= stampSize - 1) continue;

        // bilinear sample for smooth scaling
        const sxi = sx | 0, syi = sy | 0;
        const tx = sx - sxi, ty = sy - syi;
        const i00 = syi * stampSize + sxi;
        const a00 = mask[i00];
        const a10 = mask[i00 + 1];
        const a01 = mask[i00 + stampSize];
        const a11 = mask[i00 + stampSize + 1];
        const a = (a00 * (1 - tx) + a10 * tx) * (1 - ty) +
                  (a01 * (1 - tx) + a11 * tx) * ty;

        const alpha = (a / 255) * op;
        if (alpha <= 0) continue;

        const i = (rowBase + px) * 4;
        const inv = 1 - alpha;
        data[i]     = (data[i]     * inv + rc * alpha) | 0;
        data[i + 1] = (data[i + 1] * inv + gc * alpha) | 0;
        data[i + 2] = (data[i + 2] * inv + bc * alpha) | 0;
      }
    }
  }

  // ---- paint: spray ----

  // toroidal blend of one pixel with optional symmetry mirroring.
  // x/y can be any integer (negative or beyond canvas); wraps into [0,size).
  _blendDotTiled(data, S, x, y, rc, gc, bc, alpha) {
    if (alpha <= 0) return;
    const sym = this.symmetry;
    const wx = ((x % S) + S) % S;
    const wy = ((y % S) + S) % S;
    const inv = 1 - alpha;
    let i = (wy * S + wx) * 4;
    data[i]     = (data[i]     * inv + rc * alpha) | 0;
    data[i + 1] = (data[i + 1] * inv + gc * alpha) | 0;
    data[i + 2] = (data[i + 2] * inv + bc * alpha) | 0;
    if (sym.h) {
      const my = ((S - wy) % S + S) % S;
      i = (my * S + wx) * 4;
      data[i]     = (data[i]     * inv + rc * alpha) | 0;
      data[i + 1] = (data[i + 1] * inv + gc * alpha) | 0;
      data[i + 2] = (data[i + 2] * inv + bc * alpha) | 0;
    }
    if (sym.v) {
      const mx = ((S - wx) % S + S) % S;
      i = (wy * S + mx) * 4;
      data[i]     = (data[i]     * inv + rc * alpha) | 0;
      data[i + 1] = (data[i + 1] * inv + gc * alpha) | 0;
      data[i + 2] = (data[i + 2] * inv + bc * alpha) | 0;
    }
    if (sym.h && sym.v) {
      const my = ((S - wy) % S + S) % S;
      const mx = ((S - wx) % S + S) % S;
      i = (my * S + mx) * 4;
      data[i]     = (data[i]     * inv + rc * alpha) | 0;
      data[i + 1] = (data[i + 1] * inv + gc * alpha) | 0;
      data[i + 2] = (data[i + 2] * inv + bc * alpha) | 0;
    }
  }

  // spray generates jitter once in canvas space and writes each dot via the
  // tiled blend helper -- so wraparound and symmetry produce matching pixels
  // (not independent random samples). this is what makes spray seam-clean.
  _paintSpray(imageData, cx, cy) {
    const { data } = imageData;
    const S   = this.size;
    const r   = this.brushSize;
    const op  = this.opacity;
    const [rc, gc, bc] = this.color;
    const type = this.sprayType;

    if (type === 'cluster') {
      const density = Math.round(r * 2);
      const alpha = op * 0.7;
      for (let k = 0; k < density; k++) {
        const u1 = Math.random(), u2 = Math.random();
        const mag = r * 0.4 * Math.sqrt(-2 * Math.log(u1 + 0.001));
        if (mag > r) continue;
        const angle = Math.PI * 2 * u2;
        const px = Math.round(cx + Math.cos(angle) * mag);
        const py = Math.round(cy + Math.sin(angle) * mag);
        this._blendDotTiled(data, S, px, py, rc, gc, bc, alpha);
      }
    } else if (type === 'splatter') {
      const count = Math.round(r * 0.4) + 3;
      const alpha = op * 0.85;
      for (let k = 0; k < count; k++) {
        const angle = Math.random() * Math.PI * 2;
        const d = Math.random() * r;
        const dotCx = cx + Math.cos(angle) * d;
        const dotCy = cy + Math.sin(angle) * d;
        const dotR = 1 + Math.floor(Math.random() * Math.max(1, r * 0.15));
        const dotR2 = dotR * dotR;

        for (let dy = -dotR; dy <= dotR; dy++) {
          for (let dx = -dotR; dx <= dotR; dx++) {
            if (dx * dx + dy * dy > dotR2) continue;
            const px = Math.round(dotCx + dx);
            const py = Math.round(dotCy + dy);
            this._blendDotTiled(data, S, px, py, rc, gc, bc, alpha);
          }
        }
      }
    } else {
      const density = Math.round(r * 1.5);
      for (let k = 0; k < density; k++) {
        const angle = Math.random() * Math.PI * 2;
        const d     = Math.random() * r;
        const px = Math.round(cx + Math.cos(angle) * d);
        const py = Math.round(cy + Math.sin(angle) * d);
        const alpha = op * (1 - d / r);
        this._blendDotTiled(data, S, px, py, rc, gc, bc, alpha);
      }
    }
  }

  // ---- draw: shapes (rect/ellipse) ----

  _drawShape(start, end) {
    const imageData = this.ctx.getImageData(0, 0, this.size, this.size);
    const { data, width, height } = imageData;
    const [rc, gc, bc] = this.color;
    const op = this.opacity;
    const filled = this.shapeFilled;
    const bw = Math.max(1, this.brushSize * 0.3); // border width for outlined
    const mode = this.tool === 'ellipse' ? 'ellipse' : this.shapeMode;

    const sx = Math.min(start.x, end.x), ex = Math.max(start.x, end.x);
    const sy = Math.min(start.y, end.y), ey = Math.max(start.y, end.y);

    const x0 = Math.max(0, Math.floor(sx - bw));
    const x1 = Math.min(width - 1, Math.ceil(ex + bw));
    const y0 = Math.max(0, Math.floor(sy - bw));
    const y1 = Math.min(height - 1, Math.ceil(ey + bw));

    if (mode === 'ellipse' || this.tool === 'ellipse') {
      const ccx = (sx + ex) / 2, ccy = (sy + ey) / 2;
      const rx = (ex - sx) / 2, ry = (ey - sy) / 2;

      for (let py = y0; py <= y1; py++) {
        for (let px = x0; px <= x1; px++) {
          const dx = px - ccx, dy = py - ccy;
          const d = (rx > 0 && ry > 0) ? Math.sqrt((dx / rx) ** 2 + (dy / ry) ** 2) : 2;

          let alpha = 0;
          if (filled) {
            if (d <= 1) alpha = op;
            else if (d <= 1 + bw / Math.max(rx, ry, 1)) alpha = op * (1 - (d - 1) / (bw / Math.max(rx, ry, 1)));
          } else {
            const edge = Math.abs(d - 1) * Math.max(rx, ry, 1);
            if (edge < bw) alpha = op * (1 - edge / bw);
          }

          if (alpha <= 0) continue;
          alpha = Math.min(1, alpha);
          const i = (py * width + px) * 4;
          data[i]     = Math.round(data[i]     * (1 - alpha) + rc * alpha);
          data[i + 1] = Math.round(data[i + 1] * (1 - alpha) + gc * alpha);
          data[i + 2] = Math.round(data[i + 2] * (1 - alpha) + bc * alpha);
        }
      }
    } else {
      // rectangle
      for (let py = y0; py <= y1; py++) {
        for (let px = x0; px <= x1; px++) {
          // distance to nearest rect edge
          const dLeft = px - sx, dRight = ex - px;
          const dTop = py - sy, dBot = ey - py;
          const inside = dLeft >= 0 && dRight >= 0 && dTop >= 0 && dBot >= 0;
          const edgeDist = Math.min(Math.abs(dLeft), Math.abs(dRight), Math.abs(dTop), Math.abs(dBot));

          let alpha = 0;
          if (filled) {
            if (inside) alpha = op;
            else {
              // small anti-alias fringe
              const out = Math.max(-dLeft, -dRight, -dTop, -dBot);
              if (out < 1) alpha = op * (1 - out);
            }
          } else {
            if (inside && edgeDist < bw) alpha = op * (1 - edgeDist / bw);
            else if (!inside) {
              const out = Math.max(-dLeft, -dRight, -dTop, -dBot);
              if (out < bw) alpha = op * (1 - out / bw) * 0.5;
            }
          }

          if (alpha <= 0) continue;
          alpha = Math.min(1, alpha);
          const i = (py * width + px) * 4;
          data[i]     = Math.round(data[i]     * (1 - alpha) + rc * alpha);
          data[i + 1] = Math.round(data[i + 1] * (1 - alpha) + gc * alpha);
          data[i + 2] = Math.round(data[i + 2] * (1 - alpha) + bc * alpha);
        }
      }
    }

    this.ctx.putImageData(imageData, 0, 0);
  }

  // ---- draw: gradient ----

  _drawGradient(start, end) {
    const imageData = this.ctx.getImageData(0, 0, this.size, this.size);
    const { data, width, height } = imageData;
    const [r1, g1, b1] = this.color;
    const [r2, g2, b2] = this.color2;
    const op = this.opacity;

    const dx = end.x - start.x, dy = end.y - start.y;
    const len2 = dx * dx + dy * dy;

    for (let py = 0; py < height; py++) {
      for (let px = 0; px < width; px++) {
        const pdx = px - start.x, pdy = py - start.y;
        const t = len2 > 0 ? Math.max(0, Math.min(1, (pdx * dx + pdy * dy) / len2)) : 0;

        const cr = r1 + (r2 - r1) * t;
        const cg = g1 + (g2 - g1) * t;
        const cb = b1 + (b2 - b1) * t;

        const i = (py * width + px) * 4;
        data[i]     = Math.round(data[i]     * (1 - op) + cr * op);
        data[i + 1] = Math.round(data[i + 1] * (1 - op) + cg * op);
        data[i + 2] = Math.round(data[i + 2] * (1 - op) + cb * op);
      }
    }

    this.ctx.putImageData(imageData, 0, 0);
  }

  // ---- seamless tiling ----

  // auto-seam: blend a feather strip at each edge with the opposite edge
  // width is the feather zone in pixels
  autoSeam(featherWidth = 16) {
    this._saveHistory();
    const sz = this.size;
    const imageData = this.ctx.getImageData(0, 0, sz, sz);
    const src = new Uint8ClampedArray(imageData.data); // copy original
    const { data } = imageData;
    const fw = Math.min(featherWidth, Math.floor(sz / 4));

    for (let y = 0; y < sz; y++) {
      for (let x = 0; x < sz; x++) {
        // compute blend weight based on distance from each edge
        const dL = x;               // distance from left
        const dR = sz - 1 - x;      // distance from right
        const dT = y;               // distance from top
        const dB = sz - 1 - y;      // distance from bottom

        // horizontal feather: blend with pixel from opposite edge
        let blendH = 0;
        if (dL < fw) blendH = 1 - dL / fw;
        else if (dR < fw) blendH = 1 - dR / fw;

        // vertical feather: blend with pixel from opposite edge
        let blendV = 0;
        if (dT < fw) blendV = 1 - dT / fw;
        else if (dB < fw) blendV = 1 - dB / fw;

        if (blendH <= 0 && blendV <= 0) continue;

        const i = (y * sz + x) * 4;
        let r = src[i], g = src[i+1], b = src[i+2];

        if (blendH > 0) {
          // sample from opposite x
          const ox = (x + Math.floor(sz / 2)) % sz;
          // but actually we want the wrapped edge counterpart
          const mirrorX = dL < fw ? (sz - 1 - dL) : (sz - 1 - dR);
          const mi = (y * sz + mirrorX) * 4;
          const t = blendH * 0.5; // gentle blend
          r = r * (1 - t) + src[mi]   * t;
          g = g * (1 - t) + src[mi+1] * t;
          b = b * (1 - t) + src[mi+2] * t;
        }

        if (blendV > 0) {
          const mirrorY = dT < fw ? (sz - 1 - dT) : (sz - 1 - dB);
          const mi = (mirrorY * sz + x) * 4;
          const t = blendV * 0.5;
          r = r * (1 - t) + src[mi]   * t;
          g = g * (1 - t) + src[mi+1] * t;
          b = b * (1 - t) + src[mi+2] * t;
        }

        data[i]   = Math.round(r);
        data[i+1] = Math.round(g);
        data[i+2] = Math.round(b);
      }
    }

    this.ctx.putImageData(imageData, 0, 0);
    this.updatePreview();
  }

  // offset view: shift canvas by half in both axes so seams are centered
  // call again to shift back. all editing in offset mode is real -- just the
  // viewport is shifted so edge seams are visible in the middle
  toggleOffsetView() {
    this._saveHistory();
    const sz = this.size;
    const src = this.ctx.getImageData(0, 0, sz, sz);
    const dst = this.ctx.createImageData(sz, sz);
    const hx = Math.floor(sz / 2), hy = Math.floor(sz / 2);

    for (let y = 0; y < sz; y++) {
      for (let x = 0; x < sz; x++) {
        const sx = (x + hx) % sz;
        const sy = (y + hy) % sz;
        const si = (sy * sz + sx) * 4;
        const di = (y * sz + x) * 4;
        dst.data[di]   = src.data[si];
        dst.data[di+1] = src.data[si+1];
        dst.data[di+2] = src.data[si+2];
        dst.data[di+3] = 255;
      }
    }

    this.ctx.putImageData(dst, 0, 0);
    this._offsetView = !this._offsetView;
    this.updatePreview();
    return this._offsetView;
  }

  // ---- utility ----

  _pickColor(pos) {
    const px = Math.max(0, Math.min(this.size - 1, Math.round(pos.x)));
    const py = Math.max(0, Math.min(this.size - 1, Math.round(pos.y)));
    const id = this.ctx.getImageData(px, py, 1, 1).data;
    const hex = rgbToHex([id[0], id[1], id[2]]);
    if (this.onColorPick) this.onColorPick([id[0], id[1], id[2]], hex);
  }

  _floodFill(pos) {
    const px = Math.max(0, Math.min(this.size - 1, Math.round(pos.x)));
    const py = Math.max(0, Math.min(this.size - 1, Math.round(pos.y)));
    const imageData = this.ctx.getImageData(0, 0, this.size, this.size);
    const { data, width, height } = imageData;

    const tIdx = (py * width + px) * 4;
    const tr = data[tIdx], tg = data[tIdx + 1], tb = data[tIdx + 2];
    const [fr, fg, fb] = this.color;

    if (tr === fr && tg === fg && tb === fb) return;

    const tol = 30;
    const visited = new Uint8Array(width * height);
    const stack = [px + py * width];

    while (stack.length) {
      const flat = stack.pop();
      if (visited[flat]) continue;
      visited[flat] = 1;

      const x = flat % width;
      const y = (flat - x) / width;
      if (x < 0 || x >= width || y < 0 || y >= height) continue;

      const i = flat * 4;
      const dr = data[i] - tr, dg = data[i + 1] - tg, db = data[i + 2] - tb;
      if (Math.sqrt(dr*dr + dg*dg + db*db) > tol) continue;

      data[i]     = fr;
      data[i + 1] = fg;
      data[i + 2] = fb;

      if (x > 0)         stack.push(flat - 1);
      if (x < width - 1) stack.push(flat + 1);
      if (y > 0)         stack.push(flat - width);
      if (y < height-1)  stack.push(flat + width);
    }

    this.ctx.putImageData(imageData, 0, 0);
    this.updatePreview();
  }

  _bilinear(data, width, height, x, y) {
    x = ((x % width)  + width)  % width;
    y = ((y % height) + height) % height;
    const x0 = Math.floor(x), x1 = Math.min(width  - 1, x0 + 1);
    const y0 = Math.floor(y), y1 = Math.min(height - 1, y0 + 1);
    const tx = x - x0, ty = y - y0;
    const w00 = (1-tx)*(1-ty), w10 = tx*(1-ty), w01 = (1-tx)*ty, w11 = tx*ty;
    const i00 = (y0*width+x0)*4, i10 = (y0*width+x1)*4;
    const i01 = (y1*width+x0)*4, i11 = (y1*width+x1)*4;
    return [
      data[i00]*w00 + data[i10]*w10 + data[i01]*w01 + data[i11]*w11,
      data[i00+1]*w00 + data[i10+1]*w10 + data[i01+1]*w01 + data[i11+1]*w11,
      data[i00+2]*w00 + data[i10+2]*w10 + data[i01+2]*w01 + data[i11+2]*w11,
    ];
  }

  _saveHistory() {
    const snap = this.ctx.getImageData(0, 0, this.size, this.size);
    // skip if canvas hasn't changed since last save (fast checksum)
    if (this._histIdx >= 0) {
      const curr = snap.data;
      let hash = 0;
      // djb2-style hash over every 128th byte -- fast and reliable
      const step = 128;
      for (let i = 0; i < curr.length; i += step) {
        hash = ((hash << 5) + hash + curr[i]) | 0;
      }
      if (hash === this._lastHash) return;
      this._lastHash = hash;
    } else {
      // compute hash for initial state too
      const curr = snap.data;
      let hash = 0;
      const step = 128;
      for (let i = 0; i < curr.length; i += step) {
        hash = ((hash << 5) + hash + curr[i]) | 0;
      }
      this._lastHash = hash;
    }
    this._history = this._history.slice(0, this._histIdx + 1);
    this._history.push(snap);
    if (this._history.length > MAX_HISTORY) this._history.shift();
    this._histIdx = this._history.length - 1;
  }
}
