// seeded 2D simplex noise + fractional Brownian motion
// based on Stefan Gustavson's simplex noise algorithm

const GRAD2 = [
  [1,1],[-1,1],[1,-1],[-1,-1],
  [1,0],[-1,0],[1,0],[-1,0],
  [0,1],[0,-1],[0,1],[0,-1],
];

function buildPerm(seed) {
  let s = seed >>> 0;
  const rng = () => { s = (Math.imul(1664525, s) + 1013904223) >>> 0; return s; };
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = rng() % (i + 1);
    const t = p[i]; p[i] = p[j]; p[j] = t;
  }
  const perm = new Uint8Array(512);
  const pmod = new Uint8Array(512);
  for (let i = 0; i < 512; i++) {
    perm[i] = p[i & 255];
    pmod[i] = perm[i] % 12;
  }
  return { perm, pmod };
}

/**
 * Create a seeded noise instance.
 * @param {number} seed integer seed
 * @returns {{ get(x,y): number, fbm(x,y,octaves?,lacunarity?,gain?): number }}
 */
export function createNoise(seed = 0) {
  const { perm, pmod } = buildPerm(seed);

  function get(xin, yin) {
    const F2 = 0.5 * (Math.sqrt(3) - 1);
    const G2 = (3 - Math.sqrt(3)) / 6;

    const s = (xin + yin) * F2;
    const i = Math.floor(xin + s) | 0;
    const j = Math.floor(yin + s) | 0;
    const t = (i + j) * G2;

    const x0 = xin - (i - t);
    const y0 = yin - (j - t);
    const i1 = x0 > y0 ? 1 : 0;
    const j1 = x0 > y0 ? 0 : 1;
    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2;
    const y2 = y0 - 1 + 2 * G2;

    const ii = i & 255;
    const jj = j & 255;
    const gi0 = pmod[ii     + perm[jj     ]];
    const gi1 = pmod[ii + i1 + perm[jj + j1]];
    const gi2 = pmod[ii + 1  + perm[jj + 1 ]];

    let n0 = 0, n1 = 0, n2 = 0;
    let tt = 0.5 - x0 * x0 - y0 * y0;
    if (tt >= 0) { tt *= tt; n0 = tt * tt * (GRAD2[gi0][0] * x0 + GRAD2[gi0][1] * y0); }
    tt = 0.5 - x1 * x1 - y1 * y1;
    if (tt >= 0) { tt *= tt; n1 = tt * tt * (GRAD2[gi1][0] * x1 + GRAD2[gi1][1] * y1); }
    tt = 0.5 - x2 * x2 - y2 * y2;
    if (tt >= 0) { tt *= tt; n2 = tt * tt * (GRAD2[gi2][0] * x2 + GRAD2[gi2][1] * y2); }

    return 70 * (n0 + n1 + n2); // range approx [-1, 1]
  }

  function fbm(x, y, octaves = 4, lacunarity = 2.0, gain = 0.5) {
    let val = 0, amp = 1, freq = 1, max = 0;
    for (let o = 0; o < octaves; o++) {
      val += get(x * freq, y * freq) * amp;
      max += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return val / max;
  }

  return { get, fbm };
}

/** Simple seeded PRNG, returns a function that yields [0, 1) each call. */
export function seededRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}
