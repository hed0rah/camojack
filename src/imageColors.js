// k-means++ color clustering for image palette extraction

function luminance([r, g, b]) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function initCentroids(pixels, k) {
  const centroids = [pixels[Math.floor(Math.random() * pixels.length)]];

  for (let c = 1; c < k; c++) {
    const dists = pixels.map(px => {
      let minD = Infinity;
      for (const ct of centroids) {
        const d = (px[0]-ct[0])**2 + (px[1]-ct[1])**2 + (px[2]-ct[2])**2;
        if (d < minD) minD = d;
      }
      return minD;
    });

    const total = dists.reduce((a, b) => a + b, 0);
    let target = Math.random() * total;
    for (let i = 0; i < dists.length; i++) {
      target -= dists[i];
      if (target <= 0) { centroids.push([...pixels[i]]); break; }
    }
    if (centroids.length <= c) centroids.push(pixels[Math.floor(Math.random() * pixels.length)]);
  }

  return centroids;
}

/**
 * Extract k dominant colors from an image loaded onto a canvas.
 * @param {ImageData} imageData - raw pixel data from a canvas
 * @param {number} k - number of colors to extract (default 5)
 * @param {number} iterations - k-means iterations (default 18)
 * @returns {number[][]} array of [r,g,b] arrays sorted dark to light
 */
export function extractPalette(imageData, k = 5, iterations = 18) {
  const { data, width, height } = imageData;

  // sub-sample for speed: ~2500 samples max
  const stride = Math.max(1, Math.floor(Math.sqrt(width * height / 2500)));
  const pixels = [];
  for (let y = 0; y < height; y += stride) {
    for (let x = 0; x < width; x += stride) {
      const i = (y * width + x) * 4;
      if (data[i + 3] < 128) continue; // skip transparent
      pixels.push([data[i], data[i + 1], data[i + 2]]);
    }
  }

  if (pixels.length < k) return pixels;

  const centroids = initCentroids(pixels, k);

  for (let iter = 0; iter < iterations; iter++) {
    const clusters = Array.from({ length: k }, () => []);

    for (const px of pixels) {
      let minD = Infinity, best = 0;
      for (let c = 0; c < k; c++) {
        const dr = px[0] - centroids[c][0];
        const dg = px[1] - centroids[c][1];
        const db = px[2] - centroids[c][2];
        const d = dr * dr + dg * dg + db * db;
        if (d < minD) { minD = d; best = c; }
      }
      clusters[best].push(px);
    }

    for (let c = 0; c < k; c++) {
      if (clusters[c].length === 0) continue;
      const s = [0, 0, 0];
      for (const px of clusters[c]) { s[0] += px[0]; s[1] += px[1]; s[2] += px[2]; }
      const n = clusters[c].length;
      centroids[c] = [Math.round(s[0] / n), Math.round(s[1] / n), Math.round(s[2] / n)];
    }
  }

  centroids.sort((a, b) => luminance(a) - luminance(b));
  return centroids;
}

/**
 * Load an image file into ImageData.
 * @param {File} file
 * @returns {Promise<ImageData>}
 */
export function loadImageData(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      // scale down for speed (max 400px on longest side)
      const max = 400;
      let w = img.width, h = img.height;
      if (w > max || h > max) {
        const s = max / Math.max(w, h);
        w = Math.round(w * s);
        h = Math.round(h * s);
      }
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      resolve({ imageData: ctx.getImageData(0, 0, w, h), canvas: c });
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Failed to load image')); };
    img.src = url;
  });
}
