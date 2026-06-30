// AiG — randomForest.js
// Random Forest + AdaBoost — in-browser, pure JS, no dependencies.
//
// Exports:
//   trainRandomForest(X, y, opts?)  → RFModel
//   trainAdaBoost(X, y, opts?)      → AdaModel
//   predictRF(model, features)      → { label, confidence, scores }
//   randomForestStep                → useModel adapter (same interface as svmModel)

// ── Helpers ───────────────────────────────────────────────────────────────────

function unique(arr) { return [...new Set(arr)]; }

function majority(labels) {
  const counts = {};
  for (const l of labels) counts[l] = (counts[l] ?? 0) + 1;
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
}

function gini(labels) {
  const n = labels.length;
  if (!n) return 0;
  const counts = {};
  for (const l of labels) counts[l] = (counts[l] ?? 0) + 1;
  return 1 - Object.values(counts).reduce((s, c) => s + (c / n) ** 2, 0);
}

function bootstrapSample(X, y, seed) {
  // LCG for reproducible pseudo-random
  let s = seed >>> 0;
  const rand = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const n = X.length;
  const Xi = [], yi = [];
  for (let i = 0; i < n; i++) {
    const idx = Math.floor(rand() * n);
    Xi.push(X[idx]); yi.push(y[idx]);
  }
  return { Xi, yi };
}

// ── Decision Tree (CART) ──────────────────────────────────────────────────────

function buildTree(X, y, depth, maxDepth, nFeatures) {
  const classes = unique(y);
  if (depth >= maxDepth || classes.length === 1 || X.length < 2) {
    const [label, count] = majority(y);
    return { leaf: true, label, prob: count / y.length };
  }

  const dim = X[0].length;
  // Random feature subset
  const featureIndices = [...Array(dim).keys()]
    .sort(() => Math.random() - 0.5)
    .slice(0, nFeatures);

  let bestGain = -Infinity, bestFeat = 0, bestThresh = 0;

  for (const fi of featureIndices) {
    const vals = X.map((x) => x[fi]);
    const sorted = [...new Set(vals)].sort((a, b) => a - b);
    for (let t = 0; t < sorted.length - 1; t++) {
      const thresh = (sorted[t] + sorted[t + 1]) / 2;
      const left  = y.filter((_, i) => X[i][fi] <= thresh);
      const right = y.filter((_, i) => X[i][fi] >  thresh);
      if (!left.length || !right.length) continue;
      const gain = gini(y)
        - (left.length  / y.length) * gini(left)
        - (right.length / y.length) * gini(right);
      if (gain > bestGain) { bestGain = gain; bestFeat = fi; bestThresh = thresh; }
    }
  }

  if (bestGain <= 0) {
    const [label, count] = majority(y);
    return { leaf: true, label, prob: count / y.length };
  }

  const leftMask  = X.map((x) => x[bestFeat] <= bestThresh);
  const Xl = X.filter((_, i) => leftMask[i]);  const yl = y.filter((_, i) => leftMask[i]);
  const Xr = X.filter((_, i) => !leftMask[i]); const yr = y.filter((_, i) => !leftMask[i]);

  return {
    leaf: false, feat: bestFeat, thresh: bestThresh,
    left:  buildTree(Xl, yl, depth + 1, maxDepth, nFeatures),
    right: buildTree(Xr, yr, depth + 1, maxDepth, nFeatures),
  };
}

function predictTree(node, x) {
  if (node.leaf) return node.label;
  return x[node.feat] <= node.thresh
    ? predictTree(node.left,  x)
    : predictTree(node.right, x);
}

// ── Random Forest ─────────────────────────────────────────────────────────────

export function trainRandomForest(X, y, opts = {}) {
  const { nTrees = 40, maxDepth = 8, nFeatures } = opts;
  const dim  = X[0].length;
  const nFeat = nFeatures ?? Math.max(1, Math.round(Math.sqrt(dim)));
  const classes = unique(y);

  const trees = Array.from({ length: nTrees }, (_, i) => {
    const { Xi, yi } = bootstrapSample(X, y, i * 6364136223846793005 + 1442695040888963407);
    return buildTree(Xi, yi, 0, maxDepth, nFeat);
  });

  return { type: 'randomForest', trees, classes };
}

export function trainAdaBoost(X, y, opts = {}) {
  const { nEstimators = 30 } = opts;
  const n       = X.length;
  const classes = unique(y);
  let weights   = new Array(n).fill(1 / n);
  const stumps  = [];

  for (let t = 0; t < nEstimators; t++) {
    // Weighted bootstrap
    const Xi = [], yi = [];
    let cumW = 0;
    const cdf = weights.map((w) => (cumW += w));
    for (let i = 0; i < n; i++) {
      const r   = Math.random();
      const idx = cdf.findIndex((c) => c >= r) ?? n - 1;
      Xi.push(X[idx]); yi.push(y[idx]);
    }

    const stump = buildTree(Xi, yi, 0, 2, Math.max(1, Math.round(Math.sqrt(X[0].length))));
    const preds = X.map((x) => predictTree(stump, x));
    const err   = weights.reduce((s, w, i) => s + (preds[i] !== y[i] ? w : 0), 0);

    if (err >= 0.5 || err === 0) break;
    const alpha = 0.5 * Math.log((1 - err) / err);
    weights = weights.map((w, i) => w * Math.exp(preds[i] !== y[i] ? alpha : -alpha));
    const sumW = weights.reduce((a, b) => a + b, 0);
    weights = weights.map((w) => w / sumW);
    stumps.push({ stump, alpha });
  }

  return { type: 'adaBoost', stumps, classes };
}

export function predictRF(model, features) {
  const x = Array.from(features);

  if (model.type === 'randomForest') {
    const votes = {};
    for (const tree of model.trees) {
      const label = predictTree(tree, x);
      votes[label] = (votes[label] ?? 0) + 1;
    }
    const total  = model.trees.length;
    const scores = Object.fromEntries(
      Object.entries(votes).map(([k, v]) => [k, v / total])
    );
    const label      = Object.entries(scores).sort((a, b) => b[1] - a[1])[0][0];
    const confidence = scores[label];
    return { label, confidence, scores };
  }

  if (model.type === 'adaBoost') {
    const scores = {};
    for (const { stump, alpha } of model.stumps) {
      const label = predictTree(stump, x);
      scores[label] = (scores[label] ?? 0) + alpha;
    }
    const total = Object.values(scores).reduce((a, b) => a + b, 0) || 1;
    const norm  = Object.fromEntries(Object.entries(scores).map(([k, v]) => [k, v / total]));
    const label = Object.entries(norm).sort((a, b) => b[1] - a[1])[0][0];
    return { label, confidence: norm[label], scores: norm };
  }

  return { label: 'unknown', confidence: 0, scores: {} };
}

// ── useModel adapter ──────────────────────────────────────────────────────────

export function trainRandomForestModel(X, y) { return trainRandomForest(X, y); }
export function trainAdaBoostModel(X, y)     { return trainAdaBoost(X, y); }
export { predictRF as predictRandomForest };
