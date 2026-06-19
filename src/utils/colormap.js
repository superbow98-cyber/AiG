// AiG — colormap
// Builds 256-entry colour lookup tables and rasterises a GPR amplitude
// matrix into an RGBA pixel buffer for BScanViewer.jsx's <canvas>.
//
// Convention (matches gprParser.js / depthCalc.js):
//   matrix[sampleIndex][traceIndex] = amplitude
//   sampleIndex grows downward (depth), traceIndex grows rightward (distance)
// applyColormap() flattens row-major (sample 0 first) to match how
// CanvasRenderingContext2D.putImageData() expects pixel data.

const LUT_SIZE = 256;

// ---------------------------------------------------------------------------
// LUT builders
// ---------------------------------------------------------------------------

/** Linearly interpolate between colour stops to build a 256-entry [r,g,b] LUT.
 *  stops: [{ t: 0..1, rgb: [r,g,b] }, ...] — must be sorted by t, cover 0 and 1.
 */
function buildLUT(stops) {
  const lut = new Array(LUT_SIZE);
  for (let i = 0; i < LUT_SIZE; i++) {
    const t = i / (LUT_SIZE - 1);

    let lo = stops[0];
    let hi = stops[stops.length - 1];
    for (let s = 0; s < stops.length - 1; s++) {
      if (t >= stops[s].t && t <= stops[s + 1].t) {
        lo = stops[s];
        hi = stops[s + 1];
        break;
      }
    }

    const span = hi.t - lo.t;
    const localT = span > 0 ? (t - lo.t) / span : 0;

    lut[i] = [
      Math.round(lo.rgb[0] + (hi.rgb[0] - lo.rgb[0]) * localT),
      Math.round(lo.rgb[1] + (hi.rgb[1] - lo.rgb[1]) * localT),
      Math.round(lo.rgb[2] + (hi.rgb[2] - lo.rgb[2]) * localT),
    ];
  }
  return lut;
}

function buildGreyLUT() {
  return buildLUT([
    { t: 0, rgb: [0, 0, 0] },
    { t: 1, rgb: [255, 255, 255] },
  ]);
}

/** Classic diverging seismic map: blue (negative) -> white (zero) -> red (positive). */
function buildSeismicLUT() {
  return buildLUT([
    { t: 0.0, rgb: [0, 0, 150] },
    { t: 0.25, rgb: [0, 90, 255] },
    { t: 0.5, rgb: [255, 255, 255] },
    { t: 0.75, rgb: [255, 90, 0] },
    { t: 1.0, rgb: [150, 0, 0] },
  ]);
}

/** "hot": black -> red -> orange -> yellow -> white. */
function buildHotLUT() {
  return buildLUT([
    { t: 0.0, rgb: [0, 0, 0] },
    { t: 0.35, rgb: [180, 0, 0] },
    { t: 0.6, rgb: [255, 120, 0] },
    { t: 0.85, rgb: [255, 230, 0] },
    { t: 1.0, rgb: [255, 255, 255] },
  ]);
}

/** Approximation of matplotlib's viridis (dark purple -> teal -> yellow-green). */
function buildViridisLUT() {
  return buildLUT([
    { t: 0.0, rgb: [68, 1, 84] },
    { t: 0.2, rgb: [70, 50, 127] },
    { t: 0.4, rgb: [54, 92, 141] },
    { t: 0.55, rgb: [39, 127, 142] },
    { t: 0.7, rgb: [31, 161, 135] },
    { t: 0.85, rgb: [74, 193, 109] },
    { t: 1.0, rgb: [253, 231, 37] },
  ]);
}

export const COLORMAPS = {
  grey: buildGreyLUT(),
  seismic: buildSeismicLUT(),
  viridis: buildViridisLUT(),
  hot: buildHotLUT(),
};

export function getColormapNames() {
  return Object.keys(COLORMAPS);
}

// ---------------------------------------------------------------------------
// Normalisation + rasterisation
// ---------------------------------------------------------------------------

/**
 * Map a raw amplitude value to a 0..255 LUT index.
 * `seismic` is diverging — it's centred on 0 using the larger of |minVal|/|maxVal|
 * so zero amplitude always lands on white, regardless of how asymmetric the
 * actual data range is. Other maps use a plain linear min->max stretch.
 */
export function normaliseValue(value, minVal, maxVal, colormapName = 'grey') {
  if (!Number.isFinite(value)) return 0;

  if (colormapName === 'seismic') {
    const bound = Math.max(Math.abs(minVal), Math.abs(maxVal)) || 1;
    const t = (value + bound) / (2 * bound); // -bound..bound -> 0..1
    return Math.max(0, Math.min(255, Math.round(t * 255)));
  }

  const range = maxVal - minVal;
  if (range <= 0) return 0;
  const t = (value - minVal) / range;
  return Math.max(0, Math.min(255, Math.round(t * 255)));
}

/**
 * Convert a GPR matrix into an RGBA pixel buffer ready for
 * `ctx.putImageData(new ImageData(buffer, traces, samples), 0, 0)`.
 *
 * @param matrix       Float32Array[][] — matrix[sample][trace]
 * @param colormapName one of getColormapNames()
 * @param minVal       amplitude mapped to LUT index 0 (or -bound for seismic)
 * @param maxVal       amplitude mapped to LUT index 255 (or +bound for seismic)
 * @returns Uint8ClampedArray of length samples * traces * 4 (RGBA), row-major,
 *          sample 0 first — matches matrix orientation directly, no flipping needed.
 */
export function applyColormap(matrix, colormapName = 'grey', minVal, maxVal) {
  const lut = COLORMAPS[colormapName] || COLORMAPS.grey;
  const samples = matrix.length;
  const traces = samples > 0 ? matrix[0].length : 0;

  const pixels = new Uint8ClampedArray(samples * traces * 4);

  let pi = 0;
  for (let s = 0; s < samples; s++) {
    const row = matrix[s];
    for (let t = 0; t < traces; t++) {
      const idx = normaliseValue(row[t], minVal, maxVal, colormapName);
      const [r, g, b] = lut[idx];
      pixels[pi++] = r;
      pixels[pi++] = g;
      pixels[pi++] = b;
      pixels[pi++] = 255; // fully opaque
    }
  }

  return pixels;
}

/**
 * Convenience helper: scan the matrix for its actual min/max amplitude, so
 * Visualise.jsx can default the colormap range to "fit the data" before the
 * user adjusts it manually.
 */
export function getMatrixRange(matrix) {
  let min = Infinity;
  let max = -Infinity;
  for (const row of matrix) {
    for (let i = 0; i < row.length; i++) {
      const v = row[i];
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return { min: 0, max: 0 };
  }
  return { min, max };
}
