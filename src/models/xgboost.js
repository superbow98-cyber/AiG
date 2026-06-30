// AiG — xgboost.js
// XGBoost-style gradient boosting — in-browser, pure JS.
// Implements: gradient boosted regression trees (GBRT) with softmax loss
// for multi-class classification.
//
// Exports:
//   trainXGBoost(X, y, opts?)   → XGBModel
//   predictXGB(model, features) → { label, confidence, scores }

// ── Helpers ───────────────────────────────────────────────────────────────────

function unique(arr) { return [...new Set(arr)]; }

function softmax(logits) {
  const max  = Math.max(...logits);
  const exps = logits.map((x) => Math.exp(x - max));
  const sum  = exps.reduce((a, b) => a + b, 0);
  return exps.map((e) => e / sum);
}

// ── Regression tree for gradients ────────────────────────────────────────────

function buildRegTree(X, gradients, maxDepth, minLeaf, lambda) {
  function score(grads) {
    const G = grads.reduce((a, b) => a + b, 0);
    const H = grads.length; // approximation: H_i = 1
    return (G * G) / (H + lambda);
  }

  function build(indices, depth) {
    const grads = indices.map((i) => gradients[i]);
    if (depth >= maxDepth || indices.length <= minLeaf) {
      const G = grads.reduce((a, b) => a + b, 0);
      return { leaf: true, value: -G / (grads.length + lambda) };
    }

    let bestGain = -Infinity, bestFeat = -1, bestThresh = 0;
    const dim = X[0].length;

    for (let fi = 0; fi < dim; fi++) {
      const vals = indices.map((i) => ({ v: X[i][fi], g: gradients[i] }))
        .sort((a, b) => a.v - b.v);

      let GL = 0, HL = 0;
      const GR = grads.reduce((a, b) => a + b, 0);
      const HR = indices.length;

      for (let t = 0; t < vals.length - 1; t++) {
        GL += vals[t].g; HL++;
        const GRt = GR - GL, HRt = HR - HL;
        if (HL < minLeaf || HRt < minLeaf) continue;
        const gain = (GL * GL) / (HL + lambda)
                   + (GRt * GRt) / (HRt + lambda)
                   - score(grads);
        if (gain > bestGain) {
          bestGain = gain;
          bestFeat = fi;
          bestThresh = (vals[t].v + vals[t + 1].v) / 2;
        }
      }
    }

    if (bestFeat === -1) {
      const G = grads.reduce((a, b) => a + b, 0);
      return { leaf: true, value: -G / (grads.length + lambda) };
    }

    const left  = indices.filter((i) => X[i][bestFeat] <= bestThresh);
    const right = indices.filter((i) => X[i][bestFeat] >  bestThresh);
    return {
      leaf: false, feat: bestFeat, thresh: bestThresh,
      left:  build(left,  depth + 1),
      right: build(right, depth + 1),
    };
  }

  return build([...Array(X.length).keys()], 0);
}

function predictRegTree(node, x) {
  if (node.leaf) return node.value;
  return x[node.feat] <= node.thresh
    ? predictRegTree(node.left,  x)
    : predictRegTree(node.right, x);
}

// ── XGBoost trainer ───────────────────────────────────────────────────────────

export function trainXGBoost(X, y, opts = {}) {
  const {
    nRounds   = 40,
    maxDepth  = 4,
    lr        = 0.15,   // learning rate (eta)
    lambda    = 1.0,    // L2 regularisation
    minLeaf   = 1,
  } = opts;

  const classes = unique(y).sort();
  const K       = classes.length;
  const n       = X.length;
  const classIdx = Object.fromEntries(classes.map((c, i) => [c, i]));

  // F[k][i] = score for class k, sample i
  const F = Array.from({ length: K }, () => new Float64Array(n));
  const rounds = []; // Array<tree[]> — one tree per class per round

  for (let r = 0; r < nRounds; r++) {
    const roundTrees = [];

    // Compute softmax probs
    const probs = Array.from({ length: n }, (_, i) =>
      softmax(Array.from({ length: K }, (__, k) => F[k][i]))
    );

    for (let k = 0; k < K; k++) {
      // Gradient: g_i = p_k(x_i) - 1{y_i == k}
      const gradients = Array.from({ length: n }, (_, i) =>
        probs[i][k] - (classIdx[y[i]] === k ? 1 : 0)
      );

      const tree = buildRegTree(X, gradients, maxDepth, minLeaf, lambda);
      roundTrees.push(tree);

      // Update scores
      for (let i = 0; i < n; i++) {
        F[k][i] += lr * predictRegTree(tree, X[i]);
      }
    }
    rounds.push(roundTrees);
  }

  return { type: 'xgboost', rounds, classes, K, lr };
}

// ── Prediction ────────────────────────────────────────────────────────────────

export function predictXGB(model, features) {
  const x = Array.from(features);
  const F = new Float64Array(model.K);

  for (const roundTrees of model.rounds) {
    for (let k = 0; k < model.K; k++) {
      F[k] += model.lr * predictRegTree(roundTrees[k], x);
    }
  }

  const probs  = softmax(Array.from(F));
  const scores = Object.fromEntries(model.classes.map((c, i) => [c, probs[i]]));
  const label  = model.classes[probs.indexOf(Math.max(...probs))];
  return { label, confidence: scores[label], scores };
}

// ── useModel adapter ──────────────────────────────────────────────────────────

export function trainXGBoostModel(X, y) { return trainXGBoost(X, y); }
export { predictXGB as predictXGBoost };
