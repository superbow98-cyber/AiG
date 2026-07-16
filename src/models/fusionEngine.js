// AiG — fusionEngine.js
// PhD pipeline step 5 (thesis novelty): 128-D ResNet spatial embedding ⊕ 32-D
// XRF chemical embedding → 160-D → late fusion → material prediction
// (Metal / Ceramic / Lithic / Soil), with GPR-only and XRF-only heads kept
// alongside for the "compare fusion vs single-modality" requirement.
//
// Same honesty note as resnet18.js / xrfMLP.js: the linear layers + softmax
// below are a real forward pass, but weights are seeded, not trained on
// ground-truth GPR+XRF+material records — there aren't any in this repo yet.
// Once docs/DATABASE_SCHEMA.md gpr_xrf_records accumulates enough validated
// rows, this file's train() function (stub below) is the place to fit real
// weights; loadWeights() is the swap-in point for every consumer.
//
// Consumed by: pages/FusionEngine.jsx

export const MATERIAL_CLASSES = ['metal', 'ceramic', 'lithic', 'soil'];

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

function softmax(x) {
  const m = Math.max(...x);
  const exps = Array.from(x, (v) => Math.exp(v - m));
  const sum = exps.reduce((a, b) => a + b, 0) || 1;
  return exps.map((v) => v / sum);
}

export function createFusionEngine(seed = 160) {
  const rng = mulberry32(seed);
  return {
    seed,
    trained: false,
    fusionHead: makeLinear(rng, 160, MATERIAL_CLASSES.length), // 160 → 4
    gprOnlyHead: makeLinear(rng, 128, MATERIAL_CLASSES.length), // 128 → 4
    xrfOnlyHead: makeLinear(rng, 32, MATERIAL_CLASSES.length),  // 32 → 4
    arch: '160-D (128 ResNet ⊕ 32 XRF) → linear → softmax(4) late fusion',
  };
}

export function loadWeights(model, weights) {
  Object.assign(model, weights, { trained: true });
  return model;
}

let _defaultModel = null;
export function getDefaultFusionEngine() {
  if (!_defaultModel) _defaultModel = createFusionEngine(160);
  return _defaultModel;
}

function classify(vector, head) {
  const logits = linear(vector, head);
  const probs = softmax(logits);
  const scores = MATERIAL_CLASSES.reduce((acc, c, i) => { acc[c] = probs[i]; return acc; }, {});
  let bestIdx = 0;
  for (let i = 1; i < probs.length; i++) if (probs[i] > probs[bestIdx]) bestIdx = i;
  return { label: MATERIAL_CLASSES[bestIdx], confidence: probs[bestIdx], scores };
}

/**
 * Concatenate ResNet (128-D) + XRF (32-D) embeddings → 160-D fusion vector.
 */
export function concatEmbeddings(resnetEmbedding, xrfEmbedding) {
  const out = new Float32Array(160);
  out.set(resnetEmbedding.subarray ? resnetEmbedding.subarray(0, 128) : resnetEmbedding.slice(0, 128), 0);
  out.set(xrfEmbedding.subarray ? xrfEmbedding.subarray(0, 32) : xrfEmbedding.slice(0, 32), 128);
  return out;
}

/**
 * Run all three predictions (fusion / GPR-only / XRF-only) so the UI can
 * show the "compare GPR only vs XRF only vs Fusion" panel required by the
 * research methodology.
 */
export function predictMaterial(resnetEmbedding, xrfEmbedding, { model } = {}) {
  const m = model ?? getDefaultFusionEngine();
  const fused = concatEmbeddings(resnetEmbedding, xrfEmbedding);

  const fusion = classify(fused, m.fusionHead);
  const gprOnly = classify(resnetEmbedding, m.gprOnlyHead);
  const xrfOnly = classify(xrfEmbedding, m.xrfOnlyHead);

  return {
    fusion, gprOnly, xrfOnly,
    fusedVector: fused,
    trained: m.trained,
  };
}

/**
 * Lightweight "explanation": which of the 160 input dimensions pushed the
 * predicted class logit the most (|weight[dim, predictedClass] * input[dim]|,
 * top 10). Real contribution analysis on the actual weights/activations used
 * for the prediction — a cheap stand-in for the Grad-CAM/SHAP panel planned
 * for the Explainable AI module, not a canned list.
 */
export function topContributingDimensions(fusedVector, predictedLabel, { model } = {}, topN = 10) {
  const m = model ?? getDefaultFusionEngine();
  const classIdx = MATERIAL_CLASSES.indexOf(predictedLabel);
  if (classIdx < 0) return [];
  const { w, outDim } = m.fusionHead;
  const contributions = [];
  for (let i = 0; i < fusedVector.length; i++) {
    const weight = w[i * outDim + classIdx];
    const contribution = weight * fusedVector[i];
    contributions.push({
      dim: i,
      source: i < 128 ? 'resnet' : 'xrf',
      sourceIndex: i < 128 ? i : i - 128,
      contribution,
    });
  }
  contributions.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
  return contributions.slice(0, topN);
}

/**
 * STUB — intentionally not implemented. Once gpr_xrf_records has enough
 * validated (embedding, ground_truth_material) pairs, fit fusionHead /
 * gprOnlyHead / xrfOnlyHead here (e.g. gradient descent on cross-entropy)
 * and call loadWeights(). Left unimplemented rather than faked.
 */
export function train(/* records */) {
  throw new Error('fusionEngine.train() not implemented — needs validated gpr_xrf_records with ground_truth_material to fit real weights.');
}
