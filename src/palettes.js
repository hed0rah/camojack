// color utilities and preset camo palettes

export function hexToRgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex([r, g, b]) {
  return [r, g, b].map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
}

export function rgbToHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, Math.round(l * 100)];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r)      h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else                h = (r - g) / d + 4;
  return [Math.round(h / 6 * 360), Math.round(s * 100), Math.round(l * 100)];
}

export function hslToRgb([h, s, l]) {
  h /= 360; s /= 100; l /= 100;
  if (s === 0) { const v = Math.round(l * 255); return [v, v, v]; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  function hue2rgb(p, q, t) {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1/6) return p + (q - p) * 6 * t;
    if (t < 1/2) return q;
    if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
    return p;
  }
  return [
    Math.round(hue2rgb(p, q, h + 1/3) * 255),
    Math.round(hue2rgb(p, q, h) * 255),
    Math.round(hue2rgb(p, q, h - 1/3) * 255),
  ];
}

export function lerpColor(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

export const PALETTES = {
  woodland: {
    label: 'Woodland M81',
    colors: ['1a2010', '2d4a1e', '4a6741', '8b6914', 'c4a35a'],
  },
  desert: {
    label: 'Desert 3-Color',
    colors: ['5c3d1e', '8b6330', 'c8b06e', 'd4c08a', 'e8d8b0'],
  },
  marpat_w: {
    label: 'MARPAT Woodland',
    colors: ['1a2610', '2e4820', '4a6835', '7a6040', 'b0a070'],
  },
  marpat_d: {
    label: 'MARPAT Desert',
    colors: ['5c4020', '8c6c3c', 'c8a060', 'd8bc88', 'ece0c0'],
  },
  multicam: {
    label: 'Multicam',
    colors: ['2d3818', '4a5028', '6b6840', '9c8550', 'c8b878'],
  },
  aor1: {
    label: 'AOR-1 Desert',
    colors: ['4a3018', '7a5c30', 'c09060', 'd8b880', 'e8d0a8'],
  },
  aor2: {
    label: 'AOR-2 Woodland',
    colors: ['141e0c', '283818', '3c5428', '607840', '9cb870'],
  },
  tigerstripe: {
    label: 'Tiger Stripe',
    colors: ['0c1408', '1e3010', '384820', '7a6830', 'c8b860'],
  },
  flecktarn: {
    label: 'Flecktarn',
    colors: ['1c2010', '344030', '486040', '8c8050', 'c8c098'],
  },
  amoeba: {
    label: 'Soviet Amoeba',
    colors: ['101810', '284028', '507848', '8c7840', 'c8b868'],
  },
  urban: {
    label: 'Urban / Ghost',
    colors: ['181818', '2e2e2e', '505050', '848484', 'c0c0c0'],
  },
  alpine: {
    label: 'Alpine',
    colors: ['1a2030', '304060', '607890', 'a0b8c8', 'dce8f0'],
  },
  bajablast: {
    label: 'Baja Blast',
    colors: ['1a1040', '7b2d8e', '00b89f', '5ce0d0', 'e0fff8'],
  },
  volcano: {
    label: 'Volcano',
    colors: ['0a0a0a', '301008', '8b2500', 'd4600a', 'f0a030'],
  },
  zombie: {
    label: 'Zombie',
    colors: ['0a0a00', '2d0a0a', '5c1010', '40c020', '80ff30'],
  },
  dragon: {
    label: 'Dragon Red',
    colors: ['0a0808', '1a1018', '401020', '8c1a1a', 'c03030'],
  },
  kryptek_typhon: {
    label: 'Kryptek Typhon',
    colors: ['0a0a0a', '1a1a1a', '2e2e2e', '484848', '606060'],
  },
  kryptek_neptune: {
    label: 'Kryptek Neptune',
    colors: ['081018', '102838', '1a5070', '2888a8', '50b8d0'],
  },
  kryptek_highlander: {
    label: 'Kryptek Highlander',
    colors: ['1a1810', '3a3020', '5c4830', '887050', 'a89070'],
  },
  // ---- additional military palettes ----
  dpm: {
    label: 'DPM (UK)',
    colors: ['1c2410', '2e4418', '4a3018', '7c6030', 'c8a058'],
  },
  frogskin: {
    label: 'Frogskin (USMC WWII)',
    colors: ['1e2810', '3e5828', '5c7838', '8c7840', 'd0b868'],
  },
  desert6: {
    label: '6-Color Desert (DBDU)',
    colors: ['1a1208', '4c3820', '785838', '9c8458', 'c8a060'],
  },
  strichtarn: {
    label: 'Strichtarn (DDR)',
    colors: ['1c2010', '2e3c20', '444c38', '606848', '808870'],
  },
  telo: {
    label: 'Telo Mimetico',
    colors: ['2a1c10', '4a3820', '687048', '989068', 'c0b088'],
  },
  splinter: {
    label: 'Splittertarn',
    colors: ['1c1c10', '384020', '607040', '886830', 'b89858'],
  },
  denison: {
    label: 'Denison Smock',
    colors: ['1c2410', '3c5020', '6c5830', 'a08040', 'd0b860'],
  },
  lizard: {
    label: 'Lizard / TAP 47',
    colors: ['141808', '2a3818', '485428', '706830', 'a89858'],
  },

  // ---- biome palettes ----
  biome_temperate: {
    label: 'Temperate Forest',
    colors: ['2a1e14', '2d4420', '4a6830', '7a5c30', 'b89850'],
  },
  biome_boreal: {
    label: 'Boreal / Conifer',
    colors: ['142010', '243820', '4a3c28', '6e7060', '889068'],
  },
  biome_tropical: {
    label: 'Tropical Jungle',
    colors: ['0c180a', '1e3810', '2d5a1c', '3c8020', '7aa848'],
  },
  biome_arid: {
    label: 'Arid Desert',
    colors: ['4a3018', '7a5c30', 'c09858', 'd8b878', 'e8d8b0'],
  },
  biome_semiarid: {
    label: 'Semi-Arid Scrub',
    colors: ['302818', '505028', '888048', 'a89860', 'c8b880'],
  },
  biome_arctic: {
    label: 'Arctic / Snow',
    colors: ['8898a8', 'b0bcc8', 'd0d8e0', 'e8ecf0', 'f4f4f8'],
  },
  biome_urban: {
    label: 'Urban Concrete',
    colors: ['282828', '505050', '787878', '989088', 'b8b0a8'],
  },
  biome_coastal: {
    label: 'Coastal / Maritime',
    colors: ['1e2838', '3c4848', '607070', '908870', 'c0b090'],
  },
  biome_savanna: {
    label: 'Savanna / Grassland',
    colors: ['302010', '505020', '908030', 'b8a040', 'd8c860'],
  },
  biome_marsh: {
    label: 'Wetland / Marsh',
    colors: ['181408', '303018', '485828', '707040', '989860'],
  },

  custom: {
    label: '-- Custom --',
    colors: ['1a2010', '2d4a1e', '4a6741', '8b6914', 'c4a35a'],
  },
};

// return a mutable copy of the palette color array as hex strings (no #)
export function getPaletteColors(key) {
  return [...(PALETTES[key]?.colors ?? PALETTES.woodland.colors)].map(c => c.replace('#', ''));
}

// biome configs for random palette generation
const BIOME_CONFIGS = {
  temperate:  { hueCenter: 100, hueRange: 40, satRange: [20, 55], valRange: [10, 60] },
  boreal:     { hueCenter: 110, hueRange: 30, satRange: [15, 45], valRange: [8, 55] },
  tropical:   { hueCenter: 115, hueRange: 35, satRange: [30, 70], valRange: [5, 55] },
  arid:       { hueCenter: 35,  hueRange: 20, satRange: [30, 60], valRange: [20, 80] },
  arctic:     { hueCenter: 210, hueRange: 30, satRange: [5, 20],  valRange: [55, 95] },
  urban:      { hueCenter: 0,   hueRange: 10, satRange: [0, 8],   valRange: [10, 75] },
  coastal:    { hueCenter: 170, hueRange: 60, satRange: [15, 40], valRange: [15, 65] },
  savanna:    { hueCenter: 45,  hueRange: 30, satRange: [35, 65], valRange: [10, 70] },
  marsh:      { hueCenter: 85,  hueRange: 40, satRange: [20, 50], valRange: [8, 50] },
};

/**
 * Generate a random 5-color palette for a given biome type.
 * Returns array of hex strings (no #), sorted dark to light.
 */
export function generateRandomPalette(biome = 'temperate') {
  const cfg = BIOME_CONFIGS[biome] || BIOME_CONFIGS.temperate;
  const colors = [];

  for (let i = 0; i < 5; i++) {
    const t = i / 4;
    const h = cfg.hueCenter + (Math.random() - 0.5) * cfg.hueRange;
    const s = cfg.satRange[0] + Math.random() * (cfg.satRange[1] - cfg.satRange[0]);
    const l = cfg.valRange[0] + t * (cfg.valRange[1] - cfg.valRange[0])
              + (Math.random() - 0.5) * 10;
    const rgb = hslToRgb([
      ((h % 360) + 360) % 360,
      Math.max(0, Math.min(100, s)),
      Math.max(0, Math.min(100, l)),
    ]);
    colors.push(rgb);
  }

  // sort by luminance
  colors.sort((a, b) =>
    (0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2]) -
    (0.2126 * b[0] + 0.7152 * b[1] + 0.0722 * b[2])
  );

  return colors.map(rgbToHex);
}

export const BIOME_NAMES = Object.keys(BIOME_CONFIGS);
