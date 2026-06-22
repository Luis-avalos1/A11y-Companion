// Generates an Ishihara-style color-vision test plate as an SVG. A green "5"
// hides among warm (red/orange) dots — under the protanopia/deuteranopia
// filters the number washes out, which makes the color-blindness simulation
// obvious in the demo. Pure deterministic layout (no RNG) so it is stable.
import { writeFileSync } from 'node:fs';

const SIZE = 420;
const R = 200;
const C = SIZE / 2;

// 5x7 matrix for the digit "5".
const GLYPH = [
  '11111',
  '10000',
  '11110',
  '00001',
  '00001',
  '10001',
  '01110',
];
const GW = 5, GH = 7;

// A tiny deterministic pseudo-random so dot sizes/jitter look organic but stable.
let seed = 1337;
const rnd = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};

const warm = ['#e9683b', '#f0883e', '#d94f3d', '#f4a259', '#c0452f', '#eba145'];
const figure = ['#5fae54', '#7cc36a', '#4f9d49', '#9bcf7e'];

function onGlyph(x, y) {
  // Map plate coords to the glyph box (centered, ~64% of diameter).
  const boxW = R * 1.15, boxH = R * 1.55;
  const gx = (x - (C - boxW / 2)) / boxW;
  const gy = (y - (C - boxH / 2)) / boxH;
  if (gx < 0 || gx >= 1 || gy < 0 || gy >= 1) return false;
  const col = Math.floor(gx * GW);
  const row = Math.floor(gy * GH);
  return GLYPH[row]?.[col] === '1';
}

const dots = [];
const step = 17;
for (let y = C - R; y <= C + R; y += step) {
  for (let x = C - R; x <= C + R; x += step) {
    const jx = x + (rnd() - 0.5) * 10;
    const jy = y + (rnd() - 0.5) * 10;
    const dist = Math.hypot(jx - C, jy - C);
    const rad = 5 + rnd() * 4;
    if (dist > R - rad) continue;
    const fig = onGlyph(jx, jy);
    const pal = fig ? figure : warm;
    const color = pal[Math.floor(rnd() * pal.length)];
    dots.push(`<circle cx="${jx.toFixed(1)}" cy="${jy.toFixed(1)}" r="${rad.toFixed(1)}" fill="${color}"/>`);
  }
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}" role="img" aria-label="Color vision test plate. People with typical color vision see the number 5; with red-green color blindness it is hard to read.">
  <rect width="${SIZE}" height="${SIZE}" fill="#fdf6ec"/>
  <circle cx="${C}" cy="${C}" r="${R + 4}" fill="#f6ead8"/>
  ${dots.join('\n  ')}
</svg>
`;

writeFileSync(new URL('../demo/assets/colorblind-plate.svg', import.meta.url), svg);
console.log('wrote colorblind-plate.svg with', dots.length, 'dots');
