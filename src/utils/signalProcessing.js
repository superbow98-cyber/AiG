// AiG — signalProcessing.js
// GPR trace signal-processing primitives operating on a B-scan matrix.
//
// Matrix convention (matches gprParser.js / colormap.js):
//   matrix[sampleIndex][traceIndex] = amplitude
//   → rows    = samples  (depth axis, fast time)
//   → columns = traces   (survey position, slow time)
//
// A "trace" is therefore one COLUMN (fixed traceIndex, varying sampleIndex).
// Every export returns a NEW Float32Array[][] and never mutates its input.
//
// Contract (BRAIN §6h):
//   backgroundRemoval(matrix)
//   applyGain(matrix, type='linear', options={})   // 'linear' | 'agc' | 'dewow'
//   bandpassFilter(matrix, lowMHz, highMHz, dt_ns)

// ── helpers ────────────────────────────────────────────────────────────────
function dims(matrix) {
  const rows = matrix.length;
  const cols = rows > 0 ? matrix[0].length : 0;
  return { rows, cols };
}

function allocLike(matrix) {
  const { rows, cols } = dims(matrix);
  const out = new Array(rows);
  for (let r = 0; r < rows; r++) out[r] = new Float32Array(cols);
  return out;
}

// ── background removal ──────────────────────────────────────────────────────
// Computes the mean trace (average A-scan across all traces) and subtracts it
// from every trace. Removes flat horizontal banding / the direct air-coupled
// wave that is common to all traces.
export function backgroundRemoval(matrix) {
  const { rows, cols } = dims(matrix);
  const out = allocLike(matrix);
  if (rows === 0 || cols === 0) return out;

  for (let r = 0; r < rows; r++) {
    const row = matrix[r];
    let mean = 0;
    for (let c = 0; c < cols; c++) mean += row[c];
    mean /= cols;
    const orow = out[r];
    for (let c = 0; c < cols; c++) orow[c] = row[c] - mean;
  }
  return out;
}

// ── gain ────────────────────────────────────────────────────────────────────
// type 'linear' : amplitude *= (sampleIndex / samples) * factor   (factor=2)
// type 'agc'    : normalise each depth window to unit RMS         (windowSize=32)
// type 'dewow'  : highpass per trace (subtract running mean)      (window=auto)
export function applyGain(matrix, type = 'linear', options = {}) {
  switch (type) {
    case 'linear':
      return linearGain(matrix, options.factor ?? 2);
    case 'agc':
      return agcGain(matrix, options.windowSize ?? 32);
    case 'dewow':
      return dewow(matrix, options.windowSize ?? 0);
    default:
      throw new Error(`applyGain: unknown type "${type}"`);
  }
}

function linearGain(matrix, factor) {
  const { rows, cols } = dims(matrix);
  const out = allocLike(matrix);
  const denom = rows > 0 ? rows : 1;
  for (let r = 0; r < rows; r++) {
    const g = (r / denom) * factor;
    const row = matrix[r];
    const orow = out[r];
    for (let c = 0; c < cols; c++) orow[c] = row[c] * g;
  }
  return out;
}

// AGC — for each sample of each trace, divide by the local RMS computed over a
// centred window of `windowSize` samples along the depth axis (per column).
function agcGain(matrix, windowSize) {
  const { rows, cols } = dims(matrix);
  const out = allocLike(matrix);
  if (rows === 0 || cols === 0) return out;
  const half = Math.max(1, Math.floor(windowSize / 2));

  for (let c = 0; c < cols; c++) {
    // prefix sum of squares down the column for O(1) window RMS
    const sq = new Float64Array(rows + 1);
    for (let r = 0; r < rows; r++) sq[r + 1] = sq[r] + matrix[r][c] * matrix[r][c];

    for (let r = 0; r < rows; r++) {
      const lo = Math.max(0, r - half);
      const hi = Math.min(rows, r + half + 1);
      const n = hi - lo;
      const rms = Math.sqrt((sq[hi] - sq[lo]) / n) || 1e-9;
      out[r][c] = matrix[r][c] / rms;
    }
  }
  return out;
}

// Dewow — remove the low-frequency "wow" (DC drift) from each trace by
// subtracting a running mean (a simple zero-phase highpass). Default window is
// ~1/20 of the trace length, clamped to a sensible range.
function dewow(matrix, windowSize) {
  const { rows, cols } = dims(matrix);
  const out = allocLike(matrix);
  if (rows === 0 || cols === 0) return out;
  let win = windowSize > 0 ? windowSize : Math.round(rows / 20);
  win = Math.max(3, Math.min(win, rows));
  const half = Math.floor(win / 2);

  for (let c = 0; c < cols; c++) {
    const sum = new Float64Array(rows + 1);
    for (let r = 0; r < rows; r++) sum[r + 1] = sum[r] + matrix[r][c];
    for (let r = 0; r < rows; r++) {
      const lo = Math.max(0, r - half);
      const hi = Math.min(rows, r + half + 1);
      const mean = (sum[hi] - sum[lo]) / (hi - lo);
      out[r][c] = matrix[r][c] - mean;
    }
  }
  return out;
}

// ── bandpass ────────────────────────────────────────────────────────────────
// Windowed-sinc (Blackman) FIR bandpass applied per trace (down each column).
// lowMHz / highMHz are passband edges; dt_ns is the sample interval in ns.
export function bandpassFilter(matrix, lowMHz, highMHz, dt_ns) {
  const { rows, cols } = dims(matrix);
  const out = allocLike(matrix);
  if (rows === 0 || cols === 0) return out;

  const dt_s = (dt_ns ?? 0.2) * 1e-9;
  const fs = 1 / dt_s;                    // sampling freq in Hz
  const fNyq = fs / 2;
  let fLow = (lowMHz ?? 0) * 1e6;
  let fHigh = (highMHz ?? fNyq) * 1e6;
  // clamp to valid (0, Nyquist) band
  fLow = Math.max(0, Math.min(fLow, fNyq * 0.999));
  fHigh = Math.max(fLow + fs * 1e-6, Math.min(fHigh, fNyq * 0.999));

  const fcl = fLow / fs;                  // normalised cutoffs (cycles/sample)
  const fch = fHigh / fs;

  // FIR length — odd, scaled to trace length but capped for performance
  let N = 101;
  if (N > rows) N = rows % 2 === 0 ? rows - 1 : rows;
  if (N < 5) {
    // too short to filter meaningfully — return a copy
    for (let r = 0; r < rows; r++) out[r].set(matrix[r]);
    return out;
  }
  const M = (N - 1) / 2;

  // bandpass kernel = highpass(fcl) ... lowpass(fch) → (lp_high - lp_low)
  const kernel = new Float64Array(N);
  let sum = 0;
  for (let i = 0; i < N; i++) {
    const n = i - M;
    // ideal lowpass sinc at fch minus ideal lowpass sinc at fcl
    const lpHigh = n === 0 ? 2 * fch : Math.sin(2 * Math.PI * fch * n) / (Math.PI * n);
    const lpLow = n === 0 ? 2 * fcl : Math.sin(2 * Math.PI * fcl * n) / (Math.PI * n);
    // Blackman window
    const w =
      0.42 -
      0.5 * Math.cos((2 * Math.PI * i) / (N - 1)) +
      0.08 * Math.cos((4 * Math.PI * i) / (N - 1));
    const h = (lpHigh - lpLow) * w;
    kernel[i] = h;
    sum += h;
  }
  // (bandpass kernels sum ~0; no DC normalisation needed)

  // convolve each column with the FIR kernel (zero-padded, centred)
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      let acc = 0;
      for (let k = 0; k < N; k++) {
        const idx = r + (k - M);
        if (idx >= 0 && idx < rows) acc += matrix[idx][c] * kernel[k];
      }
      out[r][c] = acc;
    }
  }
  return out;
}
