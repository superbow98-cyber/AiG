// AiG — xrfMLP.js
// PhD pipeline step 4: XRF elemental composition → MLP (8→64→32) → 32-D
// chemical embedding, feature importance, chemical fingerprint, confidence.
//
// Same honesty note as resnet18.js: the forward pass below is real (matrix
// multiply → ReLU → matrix multiply), but the weights are deterministically
// seeded, not trained on labelled GPR+XRF excavation records. Swap in real
// weights via loadWeights() once available — every consumer downstream
// (FusionEngine, XRFWorkspace page) keeps working unchanged.
//
// Consumed by: pages/XRFWorkspace.jsx, models/fusionEngine.js

export const XRF_ELEMENTS = ['Fe', 'Cu', 'Pb', 'Ca', 'Si', 'Al', 'Ti', 'Zn'];

// Illustrative reference ranges (weight %) spanning typical soil/artifact
// XRF readings — used only to normalise inputs and estimate input typicality.
// These are NOT calibrated to any specific site; adjust per-project in
// Settings if/when real reference data is available.
export const XRF_REFERENCE_RANGES = {
  Fe: { min: 0.5, max: 45, typical: [1, 25] },
  Cu: { min: 0, max: 90, typical: [0, 15] },
  Pb: { min: 0, max: 80, typical: [0, 10] },
  Ca: { min: 0.1, max: 40, typical: [0.5, 20] },
  Si: { min: 5, max: 45, typical: [10, 35] },
  Al: { min: 1, max: 20, typical: [3, 12] },
  Ti: { min: 0, max: 3, typical: [0.1, 1.2] },
  Zn: { min: 0, max: 60, typical: [0, 8] },
};

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function heInit(rng, fanIn) {
  const scale = Math.sqrt(2 / Math.max(1, fanIn));
  const u1 = Math.max(rng(), 1e-9), u2 = rng();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return z * scale;
}

function makeLinear(rng, inDim, outDim) {
  const w = new Float32Array(inDim * outDim);
  for (let i = 0; i < w.length; i++) w[i] = heInit(rng, inDim);
  const b = new Float32Array(outDim);
  return { w, b, inDim, outDim };
}

function linear(x, layer) {
  const { w, b, inDim, outDim } = layer;
  const out = new Float32Array(outDim);
  for (let o = 0; o < outDim; o++) {
    let sum = b[o];
    for (let i = 0; i < inDim; i++) sum += x[i] * w[i * outDim + o];
    out[o] = sum;
  }
  return out;
}

function relu(x) {
  const out = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) out[i] = x[i] > 0 ? x[i] : 0;
  return out;
}

export function createXRFMLP(seed = 8) {
  const rng = mulberry32(seed);
  return {
    seed,
    trained: false,
    layer1: makeLinear(rng, 8, 64),  // 8 → 64
    layer2: makeLinear(rng, 64, 32), // 64 → 32
    arch: '8 → 64 (ReLU) → 32 (chemical embedding)',
  };
}

export function loadWeights(model, weights) {
  Object.assign(model, weights, { trained: true });
  return model;
}

let _defaultModel = null;
export function getDefaultXRFMLP() {
  if (!_defaultModel) _defaultModel = createXRFMLP(8);
  return _defaultModel;
}

/** Min-max normalise raw ppm/wt% readings to [0,1] using reference ranges. */
export function normaliseElements(elementsObj) {
  return XRF_ELEMENTS.map((el) => {
    const v = Number(elementsObj?.[el] ?? 0);
    const { min, max } = XRF_REFERENCE_RANGES[el];
    const n = (v - min) / Math.max(1e-6, max - min);
    return Math.max(0, Math.min(1, n));
  });
}

/** Forward pass: normalised 8-vector → 32-D embedding. */
export function runXRFMLP(model, elementsObj) {
  const x = normaliseElements(elementsObj);
  const h = relu(linear(x, model.layer1));
  const embedding = linear(h, model.layer2); // 32-D, linear output (no activation on head)
  return { embedding, normalisedInput: x };
}

/**
 * Feature importance via perturbation sensitivity: nudge each of the 8
 * elements by a small step and measure resulting L2 change in the 32-D
 * embedding. Larger change ⇒ embedding is more sensitive to that element.
 * Normalised to sum to 1. This is a real (if simple) sensitivity analysis,
 * not a canned/static importance table.
 */
export function featureImportance(model, elementsObj, epsilon = 0.05) {
  const base = runXRFMLP(model, elementsObj).embedding;
  const importances = XRF_ELEMENTS.map((el) => {
    const perturbed = { ...elementsObj };
    const { min, max } = XRF_REFERENCE_RANGES[el];
    const step = (max - min) * epsilon;
    perturbed[el] = Number(elementsObj?.[el] ?? 0) + step;
    const out = runXRFMLP(model, perturbed).embedding;
    let sumSq = 0;
    for (let i = 0; i < out.length; i++) {
      const d = out[i] - base[i];
      sumSq += d * d;
    }
    return Math.sqrt(sumSq);
  });
  const total = importances.reduce((a, b) => a + b, 0) || 1;
  const normalised = importances.map((v) => v / total);
  return XRF_ELEMENTS.reduce((acc, el, i) => {
    acc[el] = normalised[i];
    return acc;
  }, {});
}

/**
 * Confidence here is an *input typicality* score — how well the raw readings
 * fall inside expected geochemical ranges — NOT a trained classifier's
 * confidence in a material label (that comes from the Fusion Engine once
 * real training data exists). Explicitly labelled as such in the UI.
 */
export function inputTypicality(elementsObj) {
  let withinTypicalCount = 0;
  let totalDeviation = 0;
  for (const el of XRF_ELEMENTS) {
    const v = Number(elementsObj?.[el] ?? 0);
    const { typical, min, max } = XRF_REFERENCE_RANGES[el];
    if (v >= typical[0] && v <= typical[1]) withinTypicalCount++;
    const mid = (typical[0] + typical[1]) / 2;
    const halfRange = Math.max(1e-6, (max - min) / 2);
    totalDeviation += Math.abs(v - mid) / halfRange;
  }
  const meanDeviation = totalDeviation / XRF_ELEMENTS.length;
  const rangeScore = withinTypicalCount / XRF_ELEMENTS.length;
  const deviationScore = Math.max(0, 1 - meanDeviation);
  return Math.max(0, Math.min(1, (rangeScore + deviationScore) / 2));
}

/** Chemical fingerprint: the normalised 0–1 profile, convenient for a radar chart. */
export function chemicalFingerprint(elementsObj) {
  const n = normaliseElements(elementsObj);
  return XRF_ELEMENTS.reduce((acc, el, i) => {
    acc[el] = n[i];
    return acc;
  }, {});
}

/** High-level convenience used by XRFWorkspace + FusionEngine pages. */
export function getChemicalEmbedding(elementsObj, { model } = {}) {
  const m = model ?? getDefaultXRFMLP();
  const { embedding } = runXRFMLP(m, elementsObj);
  return {
    embedding,
    fingerprint: chemicalFingerprint(elementsObj),
    importance: featureImportance(m, elementsObj),
    confidence: inputTypicality(elementsObj),
    trained: m.trained,
  };
}
