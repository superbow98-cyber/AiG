// AiG — fuzzyLogic.js
// Fuzzy Logic — soil + material boundary characterisation for GPR.
// Models vague boundaries between soil types and material categories
// using triangular / trapezoidal membership functions.
//
// Use cases:
//   1. Soil classification from velocity + signal amplitude
//   2. Material softness/hardness boundary scoring
//   3. Depth uncertainty bands
//   4. Confidence hedging — "possibly ceramic, probably not metal"
//
// Exports:
//   classifySoil(velocity_mns, amplitude)      → { label, memberships, dominant }
//   classifyMaterialFuzzy(features)            → { scores, hedged, dominantMaterial }
//   depthUncertaintyBand(depth_m, uncertainty) → { min_m, max_m, band_m }
//   fuzzyAnd(...memberships)                   → number (t-norm min)
//   fuzzyOr(...memberships)                    → number (t-conorm max)

// ── Membership functions ──────────────────────────────────────────────────────

// Triangular: 0 outside [a,c], peaks at b
export function triangular(x, a, b, c) {
  if (x <= a || x >= c) return 0;
  if (x <= b) return (x - a) / (b - a);
  return (c - x) / (c - b);
}

// Trapezoidal: 0 outside [a,d], 1 between [b,c]
export function trapezoidal(x, a, b, c, d) {
  if (x <= a || x >= d) return 0;
  if (x >= b && x <= c) return 1;
  if (x < b) return (x - a) / (b - a);
  return (d - x) / (d - c);
}

// Sigmoid membership (smooth boundary)
export function sigmoidMF(x, center, slope = 20) {
  return 1 / (1 + Math.exp(-slope * (x - center)));
}

// ── T-norms / T-conorms ───────────────────────────────────────────────────────

export function fuzzyAnd(...memberships) { return Math.min(...memberships); }
export function fuzzyOr(...memberships)  { return Math.max(...memberships); }
export function fuzzyNot(m)              { return 1 - m; }

// ── Soil classification ───────────────────────────────────────────────────────
// velocity_mns: typical GPR soil velocities 0.06–0.16 m/ns
// amplitude:    normalised 0–1

const SOIL_RULES = [
  {
    label: 'dry sand',
    // High velocity, low amplitude (low water content)
    fn: (v, a) => fuzzyAnd(
      trapezoidal(v, 0.13, 0.14, 0.16, 0.17),
      triangular(a, 0, 0.2, 0.5)
    ),
  },
  {
    label: 'moist sand',
    fn: (v, a) => fuzzyAnd(
      triangular(v, 0.10, 0.12, 0.14),
      triangular(a, 0.2, 0.4, 0.7)
    ),
  },
  {
    label: 'clay',
    // Low velocity, high amplitude (high water/mineral content)
    fn: (v, a) => fuzzyAnd(
      trapezoidal(v, 0.05, 0.06, 0.08, 0.10),
      triangular(a, 0.5, 0.75, 1.0)
    ),
  },
  {
    label: 'loam',
    fn: (v, a) => fuzzyAnd(
      triangular(v, 0.08, 0.10, 0.12),
      triangular(a, 0.3, 0.5, 0.75)
    ),
  },
  {
    label: 'gravel',
    fn: (v, a) => fuzzyAnd(
      trapezoidal(v, 0.12, 0.13, 0.16, 0.17),
      triangular(a, 0.1, 0.35, 0.6)
    ),
  },
  {
    label: 'saturated soil',
    fn: (v, a) => fuzzyAnd(
      trapezoidal(v, 0.05, 0.06, 0.08, 0.09),
      trapezoidal(a, 0.6, 0.75, 1.0, 1.01)
    ),
  },
];

export function classifySoil(velocity_mns, amplitude) {
  const memberships = {};
  for (const rule of SOIL_RULES) {
    memberships[rule.label] = rule.fn(velocity_mns, amplitude);
  }

  const dominant = Object.entries(memberships)
    .sort((a, b) => b[1] - a[1])[0];

  return {
    label:       dominant[0],
    membership:  dominant[1],
    memberships,
    dominant:    dominant[0],
    // Crisp output via centroid defuzzification (weighted average of rule strengths)
    certainty:   dominant[1],
  };
}

// ── Material fuzzy classification ─────────────────────────────────────────────
// Features expected (from extractFeatures in knn.js — 18-dim):
//   [0] amplitude_mean  [1] amplitude_std  [2] peak_amplitude
//   [3] width_samples   [4] curvature      [5] energy ...

const MATERIAL_RULES = [
  {
    label: 'metal',
    // High amplitude, narrow hyperbola, high energy
    fn: (f) => fuzzyAnd(
      trapezoidal(f[2] ?? 0, 0.7, 0.8, 1.0, 1.01),   // high peak amplitude
      triangular(f[3]  ?? 0, 0,   5,   15),             // narrow width
      trapezoidal(f[5] ?? 0, 0.6, 0.75, 1.0, 1.01)    // high energy
    ),
  },
  {
    label: 'ceramic',
    // Medium amplitude, moderate width, lower energy than metal
    fn: (f) => fuzzyAnd(
      triangular(f[2] ?? 0, 0.3, 0.55, 0.8),
      triangular(f[3] ?? 0, 8,   18,   35),
      triangular(f[5] ?? 0, 0.2, 0.45, 0.7)
    ),
  },
  {
    label: 'bone',
    // Low–medium amplitude, wide diffuse hyperbola
    fn: (f) => fuzzyAnd(
      triangular(f[2] ?? 0, 0.1, 0.3,  0.6),
      triangular(f[3] ?? 0, 15,  28,   50),
      triangular(f[5] ?? 0, 0.1, 0.3,  0.55)
    ),
  },
  {
    label: 'stone',
    // Medium–high amplitude, sharp hyperbola
    fn: (f) => fuzzyAnd(
      triangular(f[2] ?? 0, 0.5, 0.7,  0.95),
      triangular(f[3] ?? 0, 5,   12,   25),
      triangular(f[5] ?? 0, 0.4, 0.6,  0.85)
    ),
  },
  {
    label: 'void',
    // Very high amplitude, very narrow, phase reversal (negative mean)
    fn: (f) => fuzzyAnd(
      trapezoidal(f[2] ?? 0, 0.75, 0.85, 1.0, 1.01),
      triangular(f[3]  ?? 0, 0,    4,    10),
      sigmoidMF(-(f[0] ?? 0), 0, 10)                   // negative mean amplitude
    ),
  },
];

export function classifyMaterialFuzzy(features) {
  const f = Array.from(features);
  const scores = {};

  for (const rule of MATERIAL_RULES) {
    scores[rule.label] = rule.fn(f);
  }

  // Hedge: "possibly X" if membership > 0.2 but not dominant
  const sorted  = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const dominant = sorted[0];
  const hedged   = sorted
    .filter(([, v]) => v > 0.15 && v < dominant[1])
    .map(([k]) => `possibly ${k}`);

  return {
    scores,
    dominantMaterial: dominant[0],
    dominantScore:    dominant[1],
    hedged,           // e.g. ["possibly stone", "possibly ceramic"]
    label: dominant[0],
    confidence: dominant[1],
  };
}

// ── Depth uncertainty band ────────────────────────────────────────────────────
// Returns min/max depth range based on velocity uncertainty.
// uncertainty: 0–1 (from bayesianNet uncertaintySummary)

export function depthUncertaintyBand(depth_m, uncertainty) {
  // Base velocity uncertainty ±5%, scaled by fuzzy uncertainty level
  const velocityError = 0.05 + uncertainty * 0.10; // 5–15%
  const band_m        = depth_m * velocityError;
  return {
    depth_m,
    min_m:  Math.max(0, depth_m - band_m),
    max_m:  depth_m + band_m,
    band_m: band_m * 2,
    uncertainty,
  };
}

// ── Combined fuzzy + Bayesian confidence hedge ────────────────────────────────
// Merges fuzzy material scores with Bayesian posterior for final hedged output.

export function mergeConfidences(bayesianScores, fuzzyScores, weight = 0.4) {
  // weight = fuzzy weight (0.4 fuzzy + 0.6 Bayesian)
  const allMaterials = new Set([
    ...Object.keys(bayesianScores),
    ...Object.keys(fuzzyScores),
  ]);

  const merged = {};
  for (const mat of allMaterials) {
    const b = bayesianScores[mat] ?? 0;
    const fz = fuzzyScores[mat]   ?? 0;
    merged[mat] = (1 - weight) * b + weight * fz;
  }

  const sorted = Object.entries(merged).sort((a, b) => b[1] - a[1]);
  const sum    = sorted.reduce((s, [, v]) => s + v, 0) || 1;
  const norm   = Object.fromEntries(sorted.map(([k, v]) => [k, v / sum]));

  return {
    scores:     norm,
    label:      sorted[0][0],
    confidence: norm[sorted[0][0]],
  };
}
