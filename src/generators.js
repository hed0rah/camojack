// camo pattern generators
// each fills a 2D canvas context at native tile size

import { createNoise, seededRng } from './noise.js';
import { hexToRgb, lerpColor } from './palettes.js';

// ---- helpers ----

function poisson(count, size, rng, minDist) {
  // Poisson disk sampling with toroidal wrap
  const r = minDist ?? size / Math.sqrt(count * Math.PI * 0.5);
  const pts = [];
  const active = [];

  const add = (p) => { pts.push(p); active.push(p); };
  add([rng() * size, rng() * size]);

  while (active.length && pts.length < count * 4) {
    const idx = Math.floor(rng() * active.length);
    const [ax, ay] = active[idx];
    let placed = false;
    for (let k = 0; k < 30; k++) {
      const angle = rng() * Math.PI * 2;
      const d = r + rng() * r;
      const nx = ((ax + Math.cos(angle) * d) % size + size) % size;
      const ny = ((ay + Math.sin(angle) * d) % size + size) % size;
      let ok = true;
      for (const [px, py] of pts) {
        const dx = Math.min(Math.abs(nx - px), size - Math.abs(nx - px));
        const dy = Math.min(Math.abs(ny - py), size - Math.abs(ny - py));
        if (dx * dx + dy * dy < r * r) { ok = false; break; }
      }
      if (ok) { add([nx, ny]); placed = true; break; }
    }
    if (!placed) active.splice(idx, 1);
  }

  // fill remaining if needed
  while (pts.length < count) pts.push([rng() * size, rng() * size]);
  return pts.slice(0, count);
}

// bilinear sample of imageData (handles tiling wrap)
function bsample(data, w, h, x, y) {
  x = ((x % w) + w) % w;
  y = ((y % h) + h) % h;
  const x0 = Math.floor(x), x1 = (x0 + 1) % w;
  const y0 = Math.floor(y), y1 = (y0 + 1) % h;
  const tx = x - x0, ty = y - y0;
  const i00 = (y0 * w + x0) * 4;
  const i10 = (y0 * w + x1) * 4;
  const i01 = (y1 * w + x0) * 4;
  const i11 = (y1 * w + x1) * 4;
  const w00 = (1 - tx) * (1 - ty), w10 = tx * (1 - ty);
  const w01 = (1 - tx) * ty,       w11 = tx * ty;
  return [
    data[i00] * w00 + data[i10] * w10 + data[i01] * w01 + data[i11] * w11,
    data[i00+1]*w00 + data[i10+1]*w10 + data[i01+1]*w01 + data[i11+1]*w11,
    data[i00+2]*w00 + data[i10+2]*w10 + data[i01+2]*w01 + data[i11+2]*w11,
  ];
}

function rgbs(palette) {
  return palette.map(hexToRgb);
}

function paletteIdx(v, n) {
  // v in [0,1], returns palette index
  return Math.min(n - 1, Math.floor(v * n));
}

// ---- Voronoi ----

export function generateVoronoi(ctx, size, palette, opts = {}) {
  const {
    seedCount = 12,
    scale     = 1.0,
    softness  = 0.25,
    border    = 0.35,
    seed      = 0,
  } = opts;

  const rng = seededRng(seed);
  const n   = createNoise(seed + 77);
  const colors = rgbs(palette);
  const S = size / scale;

  const seeds = poisson(seedCount, S, rng);

  // assign palette color per seed via noise at seed position
  const seedCol = seeds.map(([sx, sy]) => {
    const v = n.get(sx * 0.02, sy * 0.02) * 0.5 + 0.5;
    return colors[paletteIdx(v, colors.length)];
  });

  const imageData = ctx.createImageData(size, size);
  const { data } = imageData;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = x / scale;
      const py = y / scale;

      let d1 = Infinity, d2 = Infinity, nearest = 0;

      for (let s = 0; s < seeds.length; s++) {
        const [sx, sy] = seeds[s];
        // check 9 toroidal copies
        for (let ox = -1; ox <= 1; ox++) {
          for (let oy = -1; oy <= 1; oy++) {
            const wx = sx + ox * S;
            const wy = sy + oy * S;
            const dx = px - wx, dy = py - wy;
            const d = dx * dx + dy * dy;
            if (d < d1) { d2 = d1; d1 = d; nearest = s; }
            else if (d < d2) { d2 = d; }
          }
        }
      }

      d1 = Math.sqrt(d1);
      d2 = Math.sqrt(d2);

      let col = seedCol[nearest];

      if (border > 0 && softness > 0) {
        const gap = d2 - d1;
        const edgeT = Math.max(0, 1 - gap / (d1 * softness + 0.001));
        if (edgeT > 0) {
          const dark = col.map(c => c * (1 - border));
          col = lerpColor(col, dark, edgeT);
        }
      }

      const idx = (y * size + x) * 4;
      data[idx]     = col[0];
      data[idx + 1] = col[1];
      data[idx + 2] = col[2];
      data[idx + 3] = 255;
    }
  }

  ctx.putImageData(imageData, 0, 0);
}

// ---- Noise (domain-warped FBM) ----

export function generateNoise(ctx, size, palette, opts = {}) {
  const {
    scale        = 2.5,
    octaves      = 5,
    warpStrength = 1.8,
    seed         = 0,
  } = opts;

  const n1 = createNoise(seed);
  const n2 = createNoise(seed + 1000);
  const n3 = createNoise(seed + 2000);
  const colors = rgbs(palette);
  const nc = colors.length;

  const imageData = ctx.createImageData(size, size);
  const { data } = imageData;

  const vals = new Float32Array(size * size);
  let mn = Infinity, mx = -Infinity;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = (x / size) * scale;
      const ny = (y / size) * scale;

      // domain warp: offset sample position with low-freq noise
      const wx = nx + warpStrength * n2.fbm(nx * 0.7, ny * 0.7, 2);
      const wy = ny + warpStrength * n3.fbm(nx * 0.7 + 4.3, ny * 0.7 + 1.7, 2);

      const v = n1.fbm(wx, wy, octaves);
      vals[y * size + x] = v;
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
  }

  const range = mx - mn || 1;

  for (let i = 0; i < size * size; i++) {
    const v = (vals[i] - mn) / range; // [0,1]
    const col = colors[paletteIdx(v, nc)];
    const idx = i * 4;
    data[idx]     = col[0];
    data[idx + 1] = col[1];
    data[idx + 2] = col[2];
    data[idx + 3] = 255;
  }

  ctx.putImageData(imageData, 0, 0);
}

// ---- Digital (MARPAT-style pixelated) ----

export function generateDigital(ctx, size, palette, opts = {}) {
  const {
    cellSize = 5,
    scale    = 3.5,
    octaves  = 3,
    seed     = 0,
  } = opts;

  const n = createNoise(seed);
  const colors = rgbs(palette);
  const nc = colors.length;

  // compute per-cell colors
  const cols = Math.ceil(size / cellSize);
  const rows = Math.ceil(size / cellSize);
  const cellColors = new Array(rows * cols);

  for (let cr = 0; cr < rows; cr++) {
    for (let cc = 0; cc < cols; cc++) {
      const nx = (cc / cols) * scale;
      const ny = (cr / rows) * scale;
      const v = n.fbm(nx, ny, octaves) * 0.5 + 0.5;
      cellColors[cr * cols + cc] = colors[paletteIdx(Math.max(0, Math.min(0.9999, v)), nc)];
    }
  }

  const imageData = ctx.createImageData(size, size);
  const { data } = imageData;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const cr = Math.min(rows - 1, Math.floor(y / cellSize));
      const cc = Math.min(cols - 1, Math.floor(x / cellSize));
      const col = cellColors[cr * cols + cc];
      const idx = (y * size + x) * 4;
      data[idx]     = col[0];
      data[idx + 1] = col[1];
      data[idx + 2] = col[2];
      data[idx + 3] = 255;
    }
  }

  ctx.putImageData(imageData, 0, 0);
}

// ---- Blotch (organic shapes with toroidal wrap) ----

export function generateBlotch(ctx, size, palette, opts = {}) {
  const {
    count    = 20,
    minSize  = 0.04,
    maxSize  = 0.18,
    softness = 0.25,
    blobNoise = 0.60,
    seed     = 0,
  } = opts;

  const rng = seededRng(seed);
  const n   = createNoise(seed + 33);
  const n2  = createNoise(seed + 77);
  const colors = rgbs(palette);

  const imageData = ctx.createImageData(size, size);
  const { data } = imageData;

  fillBg(data, size, colors[0]);

  for (let b = 0; b < count; b++) {
    const r = (minSize + rng() * (maxSize - minSize)) * size;
    const palIdx = 1 + Math.floor(rng() * (colors.length - 1));
    const col = colors[Math.min(palIdx, colors.length - 1)];

    // per-blob jitter scale: varies from 0.3x to 1.5x the base blobNoise
    const jitterScale = blobNoise * (0.3 + rng() * 1.2);
    // per-blob noise frequency: some smooth, some detailed
    const noiseFreq = 0.8 + rng() * 1.8;

    // some blobs get elongated (path-like) for woodland character
    const isElongated = rng() < 0.3;
    const elongAngle = rng() * Math.PI * 2;
    const stretch = isElongated ? 1.5 + rng() * 1.5 : 1;
    const cosE = Math.cos(elongAngle), sinE = Math.sin(elongAngle);

    const cx = rng() * size;
    const cy = rng() * size;
    const reach = r * stretch * 1.6;

    for (const [ox, oy] of toroidalOffsets(cx, cy, reach, size)) {
      const bcx = cx + ox, bcy = cy + oy;
      const x0 = Math.max(0, Math.ceil(bcx - reach));
      const x1 = Math.min(size - 1, Math.floor(bcx + reach));
      const y0 = Math.max(0, Math.ceil(bcy - reach));
      const y1 = Math.min(size - 1, Math.floor(bcy + reach));

      for (let py = y0; py <= y1; py++) {
        for (let px = x0; px <= x1; px++) {
          let dx = px - bcx, dy = py - bcy;

          // rotate + squash for elongated blobs
          if (isElongated) {
            const lx = dx * cosE + dy * sinE;
            const ly = -dx * sinE + dy * cosE;
            dx = lx / stretch;
            dy = ly;
          }

          const dist = Math.sqrt(dx * dx + dy * dy);
          const angle = Math.atan2(dy, dx);

          // multi-scale noise perturbation
          const nv1 = n.get(
            Math.cos(angle) * noiseFreq + b * 0.27,
            Math.sin(angle) * noiseFreq + b * 0.27
          );
          const nv2 = n2.get(
            Math.cos(angle) * noiseFreq * 3.1 + b * 0.53,
            Math.sin(angle) * noiseFreq * 3.1 + b * 0.53
          );
          const pertR = r * (1 + jitterScale * (nv1 * 0.7 + nv2 * 0.3));

          if (dist > pertR) continue;

          const softEdge = pertR * (1 - softness);
          let alpha = dist <= softEdge ? 1 : 1 - (dist - softEdge) / (pertR - softEdge + 0.001);
          alpha = Math.max(0, Math.min(1, alpha));

          const i = (py * size + px) * 4;
          data[i]     = Math.round(data[i]     * (1 - alpha) + col[0] * alpha);
          data[i + 1] = Math.round(data[i + 1] * (1 - alpha) + col[1] * alpha);
          data[i + 2] = Math.round(data[i + 2] * (1 - alpha) + col[2] * alpha);
        }
      }
    }
  }

  ctx.putImageData(imageData, 0, 0);
}

// ---- shared helper: toroidal edge offsets ----

function toroidalOffsets(cx, cy, r, size) {
  const off = [[0, 0]];
  if (cx - r < 0)    off.push([ size, 0]);
  if (cx + r > size) off.push([-size, 0]);
  if (cy - r < 0)    off.push([0,  size]);
  if (cy + r > size) off.push([0, -size]);
  if (cx - r < 0  && cy - r < 0)    off.push([ size,  size]);
  if (cx + r > size && cy - r < 0)  off.push([-size,  size]);
  if (cx - r < 0  && cy + r > size) off.push([ size, -size]);
  if (cx + r > size && cy + r > size) off.push([-size, -size]);
  return off;
}

function fillBg(data, size, color) {
  for (let i = 0; i < size * size; i++) {
    data[i * 4] = color[0]; data[i * 4 + 1] = color[1];
    data[i * 4 + 2] = color[2]; data[i * 4 + 3] = 255;
  }
}

// ---- Tiger Stripe / directional stripe ----

export function generateStripe(ctx, size, palette, opts = {}) {
  const {
    stripeFreq = 6.0,
    flowFreq   = 0.8,
    angle      = 78,
    edgeNoise  = 0.45,
    contrast   = 0.5,
    seed       = 0,
  } = opts;

  const n1 = createNoise(seed);
  const n2 = createNoise(seed + 500);
  const colors = rgbs(palette);
  const nc = colors.length;

  const rad = angle * Math.PI / 180;
  const cosA = Math.cos(rad), sinA = Math.sin(rad);

  const imageData = ctx.createImageData(size, size);
  const { data } = imageData;
  const vals = new Float32Array(size * size);
  let mn = Infinity, mx = -Infinity;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = x / size, ny = y / size;
      const rx = nx * cosA + ny * sinA;
      const ry = -nx * sinA + ny * cosA;
      const stripe = n1.fbm(rx * stripeFreq, ry * flowFreq, 3, 2.0, 0.5);
      const warp   = n2.fbm(nx * 3.5, ny * 3.5, 2) * edgeNoise;
      const v = stripe + warp;
      vals[y * size + x] = v;
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
  }

  const range = mx - mn || 1;
  for (let i = 0; i < size * size; i++) {
    let v = (vals[i] - mn) / range;
    v = Math.pow(v, 1 / (contrast + 0.01));
    v = Math.max(0, Math.min(0.9999, v));
    const col = colors[paletteIdx(v, nc)];
    const idx = i * 4;
    data[idx] = col[0]; data[idx + 1] = col[1]; data[idx + 2] = col[2]; data[idx + 3] = 255;
  }

  ctx.putImageData(imageData, 0, 0);
}

// ---- Brushstroke (Woodland / DPM style layered elongated blobs) ----

export function generateBrushstroke(ctx, size, palette, opts = {}) {
  const {
    layers     = 4,
    blobsPer   = 7,
    sizeMin    = 0.10,
    sizeMax    = 0.28,
    softness   = 0.30,
    jitter     = 0.50,
    elongation = 0.40,
    seed       = 0,
  } = opts;

  const rng = seededRng(seed);
  const colors = rgbs(palette);
  const nc = colors.length;

  const imageData = ctx.createImageData(size, size);
  const { data } = imageData;
  fillBg(data, size, colors[0]);

  for (let L = 1; L < nc && L <= layers; L++) {
    const col = colors[L % nc];
    const n = createNoise(seed + L * 111);
    const count = blobsPer + Math.round((rng() - 0.5) * 4);

    for (let b = 0; b < count; b++) {
      const cx = rng() * size;
      const cy = rng() * size;
      const r  = (sizeMin + rng() * (sizeMax - sizeMin)) * size;
      const bAngle  = rng() * Math.PI * 2;
      const stretch = 1 + elongation * (1 + rng());
      const R = r * stretch;

      for (const [ox, oy] of toroidalOffsets(cx, cy, R * 1.5, size)) {
        const bcx = cx + ox, bcy = cy + oy;
        const x0 = Math.max(0, Math.ceil(bcx - R * 1.5));
        const x1 = Math.min(size - 1, Math.floor(bcx + R * 1.5));
        const y0 = Math.max(0, Math.ceil(bcy - R * 1.5));
        const y1 = Math.min(size - 1, Math.floor(bcy + R * 1.5));

        const cosB = Math.cos(bAngle), sinB = Math.sin(bAngle);

        for (let py = y0; py <= y1; py++) {
          for (let px = x0; px <= x1; px++) {
            const dx = px - bcx, dy = py - bcy;
            const lx = dx * cosB + dy * sinB;
            const ly = -dx * sinB + dy * cosB;
            const dist  = Math.sqrt((lx / stretch) ** 2 + ly * ly);
            const angle = Math.atan2(ly, lx / stretch);

            const pertR = r * (1 + jitter * n.get(
              Math.cos(angle) * 1.5 + b * 0.3 + L * 0.2,
              Math.sin(angle) * 1.5 + b * 0.3 + L * 0.2
            ));

            if (dist > pertR) continue;

            const softEdge = pertR * (1 - softness);
            let alpha = dist <= softEdge ? 1 : 1 - (dist - softEdge) / (pertR - softEdge + 0.001);
            alpha = Math.max(0, Math.min(1, alpha));

            const i = (py * size + px) * 4;
            data[i]     = Math.round(data[i]     * (1 - alpha) + col[0] * alpha);
            data[i + 1] = Math.round(data[i + 1] * (1 - alpha) + col[1] * alpha);
            data[i + 2] = Math.round(data[i + 2] * (1 - alpha) + col[2] * alpha);
          }
        }
      }
    }
  }

  ctx.putImageData(imageData, 0, 0);
}

// ---- Flecktarn (clustered small dots) ----

export function generateFleck(ctx, size, palette, opts = {}) {
  const {
    clusters     = 40,
    dotsPerClust = 25,
    dotRadius    = 4,
    spread       = 0.06,
    seed         = 0,
  } = opts;

  const rng = seededRng(seed);
  const colors = rgbs(palette);
  const nc = colors.length;

  const imageData = ctx.createImageData(size, size);
  const { data } = imageData;
  fillBg(data, size, colors[0]);

  for (let c = 0; c < clusters; c++) {
    const ccx = rng() * size;
    const ccy = rng() * size;
    const colIdx = 1 + Math.floor(rng() * (nc - 1));
    const col = colors[colIdx % nc];
    const clusterR = spread * size;

    for (let d = 0; d < dotsPerClust; d++) {
      const a = rng() * Math.PI * 2;
      const dist = rng() * clusterR;
      const dx = ccx + Math.cos(a) * dist;
      const dy = ccy + Math.sin(a) * dist;
      const r  = Math.max(1, dotRadius + Math.round((rng() - 0.5) * 3));

      for (const [ox, oy] of toroidalOffsets(dx, dy, r, size)) {
        const bx = dx + ox, by = dy + oy;
        const x0 = Math.max(0, Math.ceil(bx - r));
        const x1 = Math.min(size - 1, Math.floor(bx + r));
        const y0 = Math.max(0, Math.ceil(by - r));
        const y1 = Math.min(size - 1, Math.floor(by + r));

        for (let py = y0; py <= y1; py++) {
          for (let px = x0; px <= x1; px++) {
            const dd = Math.sqrt((px - bx) ** 2 + (py - by) ** 2);
            if (dd > r) continue;
            const alpha = Math.min(1, (1 - dd / r) * 1.5);
            const i = (py * size + px) * 4;
            data[i]     = Math.round(data[i]     * (1 - alpha) + col[0] * alpha);
            data[i + 1] = Math.round(data[i + 1] * (1 - alpha) + col[1] * alpha);
            data[i + 2] = Math.round(data[i + 2] * (1 - alpha) + col[2] * alpha);
          }
        }
      }
    }
  }

  ctx.putImageData(imageData, 0, 0);
}

// ---- Rain / Strichtarn (vertical dashes) ----

export function generateRain(ctx, size, palette, opts = {}) {
  const {
    dashCount  = 300,
    dashWidth  = 3,
    dashMinH   = 15,
    dashMaxH   = 50,
    angleVar   = 8,
    seed       = 0,
  } = opts;

  const rng = seededRng(seed);
  const colors = rgbs(palette);
  const nc = colors.length;

  const imageData = ctx.createImageData(size, size);
  const { data } = imageData;
  fillBg(data, size, colors[0]);

  for (let d = 0; d < dashCount; d++) {
    const cx = rng() * size;
    const cy = rng() * size;
    const w  = Math.max(1, dashWidth + Math.round((rng() - 0.5) * 2));
    const h  = dashMinH + rng() * (dashMaxH - dashMinH);
    const angleDeg = 90 + (rng() - 0.5) * angleVar * 2;
    const rad = angleDeg * Math.PI / 180;
    const colIdx = 1 + Math.floor(rng() * (nc - 1));
    const col = colors[colIdx % nc];

    const dx = Math.cos(rad), dy = Math.sin(rad);
    const steps = Math.ceil(h);

    for (let s = 0; s < steps; s++) {
      const px = cx + dx * (s - steps / 2);
      const py = cy + dy * (s - steps / 2);

      for (let ww = -Math.floor(w / 2); ww <= Math.floor(w / 2); ww++) {
        const fx = ((Math.round(px + dy * ww) % size) + size) % size;
        const fy = ((Math.round(py - dx * ww) % size) + size) % size;
        const alpha = 0.8;
        const i = (fy * size + fx) * 4;
        data[i]     = Math.round(data[i]     * (1 - alpha) + col[0] * alpha);
        data[i + 1] = Math.round(data[i + 1] * (1 - alpha) + col[1] * alpha);
        data[i + 2] = Math.round(data[i + 2] * (1 - alpha) + col[2] * alpha);
      }
    }
  }

  ctx.putImageData(imageData, 0, 0);
}

// ---- Chocolate Chip / DBDU (blobs with small angular chips) ----

export function generateChip(ctx, size, palette, opts = {}) {
  const {
    blobCount  = 12,
    blobMin    = 0.06,
    blobMax    = 0.16,
    chipCount  = 180,
    chipSize   = 5,
    softness   = 0.20,
    shadow     = 0.4,
    seed       = 0,
  } = opts;

  const rng = seededRng(seed);
  const n   = createNoise(seed + 20);
  const colors = rgbs(palette);
  const nc = colors.length;

  const imageData = ctx.createImageData(size, size);
  const { data } = imageData;
  fillBg(data, size, colors[0]);

  // consistent light direction for shadows
  const lightAngle = 2.3; // roughly upper-left
  const shadowDx = Math.cos(lightAngle);
  const shadowDy = Math.sin(lightAngle);

  const midColors = Math.max(1, nc - 1);
  for (let b = 0; b < blobCount; b++) {
    const cx = rng() * size;
    const cy = rng() * size;
    const r  = (blobMin + rng() * (blobMax - blobMin)) * size;
    const colIdx = 1 + Math.floor(rng() * Math.min(midColors, nc - 1));
    const col = colors[Math.min(colIdx, nc - 1)];

    for (const [ox, oy] of toroidalOffsets(cx, cy, r * 1.5, size)) {
      const bcx = cx + ox, bcy = cy + oy;
      const x0 = Math.max(0, Math.ceil(bcx - r * 1.5));
      const x1 = Math.min(size - 1, Math.floor(bcx + r * 1.5));
      const y0 = Math.max(0, Math.ceil(bcy - r * 1.5));
      const y1 = Math.min(size - 1, Math.floor(bcy + r * 1.5));

      for (let py = y0; py <= y1; py++) {
        for (let px = x0; px <= x1; px++) {
          const ddx = px - bcx, ddy = py - bcy;
          const dist = Math.sqrt(ddx * ddx + ddy * ddy);
          const angle = Math.atan2(ddy, ddx);
          const pertR = r * (1 + 0.4 * n.get(
            Math.cos(angle) * 1.5 + b * 0.3,
            Math.sin(angle) * 1.5 + b * 0.3
          ));
          if (dist > pertR) continue;
          const softEdge = pertR * (1 - softness);
          let alpha = dist <= softEdge ? 1 : 1 - (dist - softEdge) / (pertR - softEdge + 0.001);
          alpha = Math.max(0, Math.min(1, alpha));
          const i = (py * size + px) * 4;
          data[i]     = Math.round(data[i]     * (1 - alpha) + col[0] * alpha);
          data[i + 1] = Math.round(data[i + 1] * (1 - alpha) + col[1] * alpha);
          data[i + 2] = Math.round(data[i + 2] * (1 - alpha) + col[2] * alpha);
        }
      }
    }
  }

  // store chip positions for shadow pass
  const chipCol = colors[nc - 1];
  const chips = [];
  for (let c = 0; c < chipCount; c++) {
    const cx = rng() * size;
    const cy = rng() * size;
    const r  = Math.max(2, chipSize + Math.round((rng() - 0.5) * 3));
    const ca = rng() * Math.PI * 2;
    chips.push({ cx, cy, r, ca });
  }

  // shadow pass first (rendered behind the chips)
  if (shadow > 0) {
    const sOff = Math.max(2, Math.round(chipSize * 0.6));
    for (const { cx, cy, r, ca } of chips) {
      const cosC = Math.cos(ca), sinC = Math.sin(ca);
      const scx = cx + shadowDx * sOff;
      const scy = cy + shadowDy * sOff;
      for (let ddy = -r - 1; ddy <= r + 1; ddy++) {
        for (let ddx = -r - 1; ddx <= r + 1; ddx++) {
          const lx = ddx * cosC + ddy * sinC;
          const ly = -ddx * sinC + ddy * cosC;
          if (Math.abs(lx) + Math.abs(ly) * 0.7 > r + 0.5) continue;
          const px = ((Math.round(scx + ddx) % size) + size) % size;
          const py = ((Math.round(scy + ddy) % size) + size) % size;
          const i = (py * size + px) * 4;
          // darken existing pixel
          data[i]     = Math.round(data[i]     * (1 - shadow * 0.5));
          data[i + 1] = Math.round(data[i + 1] * (1 - shadow * 0.5));
          data[i + 2] = Math.round(data[i + 2] * (1 - shadow * 0.5));
        }
      }
    }
  }

  // chip pass on top
  for (const { cx, cy, r, ca } of chips) {
    const cosC = Math.cos(ca), sinC = Math.sin(ca);
    for (let ddy = -r; ddy <= r; ddy++) {
      for (let ddx = -r; ddx <= r; ddx++) {
        const lx = ddx * cosC + ddy * sinC;
        const ly = -ddx * sinC + ddy * cosC;
        if (Math.abs(lx) + Math.abs(ly) * 0.7 > r) continue;
        const px = ((Math.round(cx + ddx) % size) + size) % size;
        const py = ((Math.round(cy + ddy) % size) + size) % size;
        const i = (py * size + px) * 4;
        data[i] = chipCol[0]; data[i + 1] = chipCol[1]; data[i + 2] = chipCol[2];
      }
    }
  }

  ctx.putImageData(imageData, 0, 0);
}

// ---- Geometric / angular Voronoi (Telo Mimetico, Splinter) ----

export function generateGeometric(ctx, size, palette, opts = {}) {
  const {
    cellCount  = 18,
    angularity = 0.5,
    scale      = 1.0,
    seed       = 0,
  } = opts;

  const rng = seededRng(seed);
  const n   = createNoise(seed + 50);
  const colors = rgbs(palette);
  const S = size / scale;

  const seeds = poisson(cellCount, S, rng);

  const seedCol = seeds.map(([sx, sy]) => {
    const v = n.get(sx * 0.02, sy * 0.02) * 0.5 + 0.5;
    return colors[paletteIdx(v, colors.length)];
  });

  const imageData = ctx.createImageData(size, size);
  const { data } = imageData;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = x / scale, py = y / scale;
      let d1 = Infinity, nearest = 0;

      for (let s = 0; s < seeds.length; s++) {
        const [sx, sy] = seeds[s];
        for (let ox = -1; ox <= 1; ox++) {
          for (let oy = -1; oy <= 1; oy++) {
            const wx = sx + ox * S, wy = sy + oy * S;
            const ddx = Math.abs(px - wx), ddy = Math.abs(py - wy);
            const eucl = Math.sqrt(ddx * ddx + ddy * ddy);
            const manh = ddx + ddy;
            const d = eucl * (1 - angularity) + manh * angularity;
            if (d < d1) { d1 = d; nearest = s; }
          }
        }
      }

      const col = seedCol[nearest];
      const idx = (y * size + x) * 4;
      data[idx] = col[0]; data[idx + 1] = col[1]; data[idx + 2] = col[2]; data[idx + 3] = 255;
    }
  }

  ctx.putImageData(imageData, 0, 0);
}

// ---- Honeycomb ----

export function generateHoneycomb(ctx, size, palette, opts = {}) {
  const {
    cellSize  = 20,
    border    = 2,
    depth     = 0.3,
    noise     = 0.15,
    seed      = 0,
  } = opts;

  const n = createNoise(seed + 60);
  const colors = rgbs(palette);
  const nc = colors.length;

  const imageData = ctx.createImageData(size, size);
  const { data } = imageData;

  const r = cellSize;

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      // axial hex coords (pointy-top)
      const qf = (px * 2/3) / r;
      const rf = (-px / 3 + Math.sqrt(3)/3 * py) / r;
      let q = Math.round(qf), rr = Math.round(rf), s = Math.round(-qf - rf);
      const qd = Math.abs(q - qf), rd = Math.abs(rr - rf), sd = Math.abs(s - (-qf - rf));
      if (qd > rd && qd > sd) q = -rr - s;
      else if (rd > sd) rr = -q - s;

      // hex center
      const cx = r * (3/2 * q);
      const cy = r * (Math.sqrt(3)/2 * q + Math.sqrt(3) * rr);
      const dx = px - cx, dy = py - cy;
      const dist = Math.sqrt(dx * dx + dy * dy) / r;

      // color per cell from noise
      const nv = n.get(q * 0.3, rr * 0.3) * 0.5 + 0.5;
      const colIdx = Math.min(nc - 1, Math.floor(nv * nc));
      const col = colors[colIdx];
      const cellNoise = n.get(q * 1.7 + 100, rr * 1.7 + 100) * noise;

      // hex edge distance (approximate)
      const ax = Math.abs(dx), ay = Math.abs(dy);
      const hexDist = Math.max(ax * 2 / 3, ax / 3 + ay * Math.sqrt(3) / 3) / r;
      const edgeDist = (1 - hexDist) * r;

      let cr, cg, cb;
      if (edgeDist < border) {
        const t = edgeDist / border;
        cr = col[0] * 0.12 * (1 - t) + col[0] * (1 - depth + cellNoise) * t;
        cg = col[1] * 0.12 * (1 - t) + col[1] * (1 - depth + cellNoise) * t;
        cb = col[2] * 0.12 * (1 - t) + col[2] * (1 - depth + cellNoise) * t;
      } else {
        const shade = 1 - depth * dist * 0.5 + cellNoise;
        cr = col[0] * shade; cg = col[1] * shade; cb = col[2] * shade;
      }

      const i = (py * size + px) * 4;
      data[i]     = Math.max(0, Math.min(255, Math.round(cr)));
      data[i + 1] = Math.max(0, Math.min(255, Math.round(cg)));
      data[i + 2] = Math.max(0, Math.min(255, Math.round(cb)));
      data[i + 3] = 255;
    }
  }

  ctx.putImageData(imageData, 0, 0);
}

// ---- Carbon Fiber ----

export function generateCarbon(ctx, size, palette, opts = {}) {
  const {
    weaveSize = 8,
    depth     = 0.4,
    glossy    = 0.2,
    noise     = 0.08,
    seed      = 0,
  } = opts;

  const n = createNoise(seed + 70);
  const colors = rgbs(palette);
  const base = colors[0];
  const hi = colors.length > 1 ? colors[1] : [Math.min(255, base[0] + 40), Math.min(255, base[1] + 40), Math.min(255, base[2] + 40)];

  const imageData = ctx.createImageData(size, size);
  const { data } = imageData;

  const w = weaveSize;
  const w2 = w * 2;

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const cx = ((px % w2) + w2) % w2;
      const cy = ((py % w2) + w2) % w2;
      const qx = cx < w ? 0 : 1;
      const qy = cy < w ? 0 : 1;
      const raised = (qx + qy) % 2 === 0;

      const lx = (cx % w) / w;
      const ly = (cy % w) / w;

      let fiberT;
      if (raised) {
        fiberT = Math.abs(ly - 0.5) * 2;
      } else {
        fiberT = Math.abs(lx - 0.5) * 2;
      }

      let shade = raised ? (1 - depth * 0.3) : (1 - depth * 0.7);

      // fiber texture striping
      const fiberStripe = raised
        ? Math.abs(Math.sin(ly * Math.PI * w * 0.5)) * 0.15
        : Math.abs(Math.sin(lx * Math.PI * w * 0.5)) * 0.15;
      shade += fiberStripe;

      // gloss
      const centerDist = Math.sqrt((lx - 0.5) ** 2 + (ly - 0.5) ** 2);
      if (raised && centerDist < 0.3) {
        shade += glossy * (1 - centerDist / 0.3);
      }

      // edge darkening between cells
      shade -= fiberT * depth * 0.3;

      shade += n.get(px * 0.1, py * 0.1) * noise;
      shade = Math.max(0, Math.min(1.3, shade));

      const t = Math.max(0, shade - 0.8) / 0.5;
      const cr = base[0] * shade * (1 - t) + hi[0] * t;
      const cg = base[1] * shade * (1 - t) + hi[1] * t;
      const cb = base[2] * shade * (1 - t) + hi[2] * t;

      const i = (py * size + px) * 4;
      data[i]     = Math.max(0, Math.min(255, Math.round(cr)));
      data[i + 1] = Math.max(0, Math.min(255, Math.round(cg)));
      data[i + 2] = Math.max(0, Math.min(255, Math.round(cb)));
      data[i + 3] = 255;
    }
  }

  ctx.putImageData(imageData, 0, 0);
}

// ---- Contour / Classic Woodland ----
// the actual algorithm behind M81 woodland and similar layered camo:
// each color is a domain-warped noise field thresholded at a coverage level
// painted back-to-front with horizontally stretched coordinates

export function generateContour(ctx, size, palette, opts = {}) {
  const {
    scale      = 1.8,
    stretch    = 2.0,
    warp       = 0.8,
    sharpness  = 0.85,
    coverage   = 0.45,
    puzzle     = 0,     // 0 = layered overlap, 1 = puzzle partition (value bands)
    seed       = 0,
  } = opts;

  const colors = rgbs(palette);
  const nc = colors.length;
  const imageData = ctx.createImageData(size, size);
  const { data } = imageData;

  // -- puzzle mode: one noise field partitioned into value bands --
  // every pixel belongs to exactly one color, shapes fit complementary
  if (puzzle >= 0.5) {
    const n1 = createNoise(seed + 137);
    const n2 = createNoise(seed + 637);
    const n3 = createNoise(seed + 1137);

    const vals = new Float32Array(size * size);
    let mn = Infinity, mx = -Infinity;

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const nx = (x / size) * scale / stretch;
        const ny = (y / size) * scale;
        const wx = nx + warp * n2.fbm(nx * 0.8, ny * 0.8, 2);
        const wy = ny + warp * n3.fbm(nx * 0.8 + 3.7, ny * 0.8 + 1.3, 2);
        const v = n1.fbm(wx, wy, 3, 2.0, 0.5);
        vals[y * size + x] = v;
        if (v < mn) mn = v;
        if (v > mx) mx = v;
      }
    }

    const range = mx - mn || 1;

    // build band edges from coverage: darker colors get larger regions
    // coverage controls the relative sizing -- higher coverage = more balanced bands
    // edges[0] = 0, edges[nc] = 1, edges[i] = cumulative fraction up to color i
    const edges = new Array(nc + 1);
    edges[0] = 0;
    edges[nc] = 1;
    // base weight per color: background largest, each subsequent smaller
    const weights = [];
    let wsum = 0;
    for (let i = 0; i < nc; i++) {
      const w = 1 - (i / nc) * 0.55 * (1 - coverage);
      weights.push(w);
      wsum += w;
    }
    let cum = 0;
    for (let i = 0; i < nc; i++) {
      cum += weights[i] / wsum;
      edges[i + 1] = cum;
    }

    // hard-edge factor for AA between bands
    const aa = sharpness >= 0.95 ? 0 : (1 - sharpness) * 0.04;

    for (let i = 0; i < size * size; i++) {
      const v = (vals[i] - mn) / range;
      // find which band this pixel falls in
      let band = 0;
      for (let b = 1; b < nc; b++) {
        if (v >= edges[b]) band = b;
        else break;
      }
      const col = colors[band];
      const idx = i * 4;

      // optional soft AA near band boundaries
      if (aa > 0 && band < nc - 1 && v > edges[band + 1] - aa) {
        const t = (v - (edges[band + 1] - aa)) / aa;
        const next = colors[band + 1];
        data[idx]     = Math.round(col[0] * (1 - t) + next[0] * t);
        data[idx + 1] = Math.round(col[1] * (1 - t) + next[1] * t);
        data[idx + 2] = Math.round(col[2] * (1 - t) + next[2] * t);
      } else {
        data[idx]     = col[0];
        data[idx + 1] = col[1];
        data[idx + 2] = col[2];
      }
      data[idx + 3] = 255;
    }

    ctx.putImageData(imageData, 0, 0);
    return;
  }

  // -- layered overlap mode: independent noise field per color, painted back-to-front --
  fillBg(data, size, colors[0]);

  for (let L = 1; L < nc; L++) {
    const n1 = createNoise(seed + L * 137);
    const n2 = createNoise(seed + L * 137 + 500);
    const n3 = createNoise(seed + L * 137 + 1000);
    const col = colors[L];

    const layerCov = coverage * (1 - (L - 1) / nc * 0.7);

    const vals = new Float32Array(size * size);
    let mn = Infinity, mx = -Infinity;

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const nx = (x / size) * scale / stretch;
        const ny = (y / size) * scale;
        const wx = nx + warp * n2.fbm(nx * 0.8, ny * 0.8, 2);
        const wy = ny + warp * n3.fbm(nx * 0.8 + 3.7, ny * 0.8 + 1.3, 2);
        const v = n1.fbm(wx, wy, 3, 2.0, 0.5);
        vals[y * size + x] = v;
        if (v < mn) mn = v;
        if (v > mx) mx = v;
      }
    }

    const range = mx - mn || 1;
    const threshold = 1 - layerCov;

    for (let i = 0; i < size * size; i++) {
      const v = (vals[i] - mn) / range;
      if (v < threshold) continue;

      const edge = (v - threshold) / (1 - threshold);
      let alpha;
      if (sharpness >= 0.95) {
        alpha = 1;
      } else {
        alpha = Math.min(1, edge * (1 + sharpness * 20));
      }

      const idx = i * 4;
      data[idx]     = Math.round(data[idx]     * (1 - alpha) + col[0] * alpha);
      data[idx + 1] = Math.round(data[idx + 1] * (1 - alpha) + col[1] * alpha);
      data[idx + 2] = Math.round(data[idx + 2] * (1 - alpha) + col[2] * alpha);
    }
  }

  ctx.putImageData(imageData, 0, 0);
}
