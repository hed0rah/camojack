// pattern presets: one-click camo pattern generation
// each preset maps to a generator + palette + parameter set

export const PATTERN_PRESETS = {
  // ---- classic ----
  woodland_m81: {
    label: 'Woodland M81',
    generator: 'contour',
    palette: 'woodland',
    params: {
      'ct-scale': 1.6, 'ct-stretch': 2.2, 'ct-warp': 0.9,
      'ct-sharpness': 0.90, 'ct-coverage': 0.55, 'ct-puzzle': 1,
    },
  },
  dpm: {
    label: 'DPM (UK)',
    generator: 'contour',
    palette: 'dpm',
    params: {
      'ct-scale': 2.0, 'ct-stretch': 1.8, 'ct-warp': 1.0,
      'ct-sharpness': 0.88, 'ct-coverage': 0.50, 'ct-puzzle': 1,
    },
  },
  tiger_stripe: {
    label: 'Tiger Stripe',
    generator: 'stripe',
    palette: 'tigerstripe',
    params: {
      'stripe-freq': 5.5, 'stripe-flow': 0.8, 'stripe-angle': 78,
      'stripe-edge': 0.45, 'stripe-contrast': 0.5,
    },
  },
  duckhunter: {
    label: 'Duck Hunter / Frogskin',
    generator: 'contour',
    palette: 'frogskin',
    params: {
      'ct-scale': 3.5, 'ct-stretch': 1.2, 'ct-warp': 0.6,
      'ct-sharpness': 0.92, 'ct-coverage': 0.55, 'ct-puzzle': 1,
    },
  },
  denison: {
    label: 'Denison Smock',
    generator: 'contour',
    palette: 'denison',
    params: {
      'ct-scale': 1.5, 'ct-stretch': 2.5, 'ct-warp': 1.2,
      'ct-sharpness': 0.75, 'ct-coverage': 0.55, 'ct-puzzle': 1,
    },
  },
  lizard: {
    label: 'Lizard / TAP 47',
    generator: 'contour',
    palette: 'lizard',
    params: {
      'ct-scale': 2.5, 'ct-stretch': 3.0, 'ct-warp': 0.7,
      'ct-sharpness': 0.90, 'ct-coverage': 0.50, 'ct-puzzle': 1,
    },
  },

  // ---- modern ----
  marpat_woodland: {
    label: 'MARPAT Woodland',
    generator: 'digital',
    palette: 'marpat_w',
    params: { 'gen-cell': 5, 'gen-scale': 3.5, 'gen-octaves': 3 },
  },
  marpat_desert: {
    label: 'MARPAT Desert',
    generator: 'digital',
    palette: 'marpat_d',
    params: { 'gen-cell': 5, 'gen-scale': 3.5, 'gen-octaves': 3 },
  },
  multicam: {
    label: 'Multicam',
    generator: 'contour',
    palette: 'multicam',
    params: {
      'ct-scale': 2.2, 'ct-stretch': 1.8, 'ct-warp': 1.5,
      'ct-sharpness': 0.50, 'ct-coverage': 0.55, 'ct-puzzle': 1,
    },
  },
  flecktarn_preset: {
    label: 'Flecktarn',
    generator: 'fleck',
    palette: 'flecktarn',
    params: {
      'fleck-clusters': 40, 'fleck-dots': 25,
      'fleck-radius': 4, 'fleck-spread': 0.06,
    },
  },

  // ---- historical ----
  telo_mimetico: {
    label: 'Telo Mimetico',
    generator: 'contour',
    palette: 'telo',
    params: {
      'ct-scale': 1.4, 'ct-stretch': 1.5, 'ct-warp': 0.5,
      'ct-sharpness': 0.92, 'ct-coverage': 0.55, 'ct-puzzle': 1,
    },
  },
  splinter: {
    label: 'Splittertarn',
    generator: 'geometric',
    palette: 'splinter',
    params: { 'geo-cells': 25, 'geo-angular': 0.70, 'gen-scale': 1.2 },
  },
  strichtarn: {
    label: 'Strichtarn (Rain)',
    generator: 'rain',
    palette: 'strichtarn',
    params: {
      'rain-count': 300, 'rain-width': 3,
      'rain-min-h': 15, 'rain-max-h': 50, 'rain-angle': 8,
    },
  },
  amoeba_preset: {
    label: 'Soviet Amoeba (TTsKO)',
    generator: 'metaball',
    palette: 'amoeba',
    params: {
      'mb-clusters': 8, 'mb-core': 0.13, 'mb-satellites': 6,
      'mb-spread': 1.15, 'mb-sat-size': 0.65,
      'mb-threshold': 1.6, 'mb-bg': 2, 'gen-softness': 0,
    },
  },
  chocolate_chip: {
    label: '6-Color Desert (DBDU)',
    generator: 'chip',
    palette: 'desert6',
    params: {
      'chip-blobs': 12, 'chip-blob-min': 0.06, 'chip-blob-max': 0.16,
      'chip-count': 180, 'chip-size': 5, 'gen-softness': 0.20,
    },
  },
  // ---- novelty / viral ----
  baja_blast: {
    label: 'Baja Blast',
    generator: 'brushstroke',
    palette: 'bajablast',
    params: {
      'brush-layers': 5, 'brush-blobs': 10,
      'brush-min': 0.08, 'brush-max': 0.30,
      'gen-softness': 0.35, 'brush-jitter': 0.55, 'brush-elong': 0.50,
    },
  },
  volcano: {
    label: 'Volcano',
    generator: 'blotch',
    palette: 'volcano',
    params: {
      'blob-count': 30, 'blob-min': 0.03, 'blob-max': 0.22,
      'gen-softness': 0.30, 'blob-noise': 0.80,
    },
  },
  zombie: {
    label: 'Zombie',
    generator: 'fleck',
    palette: 'zombie',
    params: {
      'fleck-clusters': 60, 'fleck-dots': 20,
      'fleck-radius': 6, 'fleck-spread': 0.10,
    },
  },
  dragon_red: {
    label: 'Dragon Red',
    generator: 'noise',
    palette: 'dragon',
    params: {
      'gen-scale': 4.0, 'gen-octaves': 6, 'gen-warp': 2.5,
    },
  },
  kryptek_dark: {
    label: 'Kryptek Typhon',
    generator: 'voronoi',
    palette: 'kryptek_typhon',
    params: {
      'seed-count': 24, 'gen-scale': 1.2,
      'gen-softness': 0.15, 'gen-border': 0.60,
    },
  },
  kryptek_ocean: {
    label: 'Kryptek Neptune',
    generator: 'voronoi',
    palette: 'kryptek_neptune',
    params: {
      'seed-count': 20, 'gen-scale': 1.0,
      'gen-softness': 0.20, 'gen-border': 0.55,
    },
  },
  carbon_black: {
    label: 'Carbon Fiber',
    generator: 'carbon',
    palette: 'kryptek_typhon',
    params: {
      'cf-weave': 8, 'cf-depth': 0.40, 'cf-gloss': 0.20, 'cf-noise': 0.06,
    },
  },
  honeycomb_tactical: {
    label: 'Honeycomb Tactical',
    generator: 'honeycomb',
    palette: 'kryptek_highlander',
    params: {
      'hex-cell': 18, 'hex-border': 2, 'hex-depth': 0.35, 'hex-noise': 0.12,
    },
  },
};

export const PRESET_GROUPS = [
  {
    label: 'Classic',
    presets: ['woodland_m81', 'dpm', 'tiger_stripe', 'duckhunter', 'denison', 'lizard'],
  },
  {
    label: 'Modern',
    presets: ['marpat_woodland', 'marpat_desert', 'multicam', 'flecktarn_preset'],
  },
  {
    label: 'Historical',
    presets: ['telo_mimetico', 'splinter', 'strichtarn', 'amoeba_preset', 'chocolate_chip'],
  },
  {
    label: 'Novelty',
    presets: ['baja_blast', 'volcano', 'zombie', 'dragon_red'],
  },
  {
    label: 'Tactical',
    presets: ['kryptek_dark', 'kryptek_ocean', 'carbon_black', 'honeycomb_tactical'],
  },
];
