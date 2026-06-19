// AiG — svmModel.js
// Classical classifiers for GPR hyperbola material classification.
// Implements: Linear SVM, Naive Bayes (Gaussian), Logistic Regression,
// and Decision Tree — all in pure JS, no external ML library.
//
// All classifiers share the same interface:
//   train(features, labels)  → model
//   predict(model, vec)      → { label, confidence, scores }
//
// Input features are the 18-element vectors from knn.js extractFeatures().
// Labels are material strings e.g. 'ceramic', 'metal', 'bone', 'stone', 'void'
//
// Consumed by: useResults.js, Classify.jsx

// ── shared utils ──────────────────────────────────────────────────────────────

function uniqueLabels(labels) {
  return [...new Set(labels)];
}

function groupByLabel(features, labels) {
  const groups = {};
  for (let i = 0; i < labels.length; i++) {
    const l = labels[i];
    if (!groups[l]) groups[l] = [];
    groups[l].push(features[i]);
  }
  return groups;
}

function colMean(vecs) {
  const n = vecs.length;
  const d = vecs[0].length;
  const m = new Float64Array(d);
  for (const v of vecs) for (let j = 0; j < d; j++) m[j] += v[j] / n;
  return m;
}

function colVar(vecs, mean) {
  const n = vecs.length;
  const d = mean.length;
  const v = new Float64Array(d);
  for (const vec of vecs)
    for (let j = 0; j < d; j++) v[j] += (vec[j] - mean[j]) ** 2 / n;
  return v;
}

function dotVV(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

function softmax(scores) {
  const keys = Object.keys(scores);
  const max = Math.max(...keys.map((k) => scores[k]));
  const exps = {};
  let sum = 0;
  for (const k of keys) { exps[k] = Math.exp(scores[k] - max); sum += exps[k]; }
  const probs = {};
  for (const k of keys) probs[k] = exps[k] / (sum || 1);
  return probs;
}

// ── feature normalisation ─────────────────────────────────────────────────────

/**
 * Compute mean and std for each feature dimension across the training set.
 * Used to z-score normalise features before SVM / LogReg training.
 */
export function computeNormaliser(features) {
  const n = features.length;
  const d = features[0].length;
  const mean = new Float64Array(d);
  const std  = new Float64Array(d);

  for (const v of features) for (let j = 0; j < d; j++) mean[j] += v[j] / n;
  for (const v of features) for (let j = 0; j < d; j++) std[j]  += (v[j] - mean[j]) ** 2 / n;
  for (let j = 0; j < d; j++) std[j] = Math.sqrt(std[j]) || 1;

  return { mean, std };
}

export function normalise(vec, { mean, std }) {
  const out = new Float64Array(vec.length);
  for (let j = 0; j < vec.length; j++) out[j] = (vec[j] - mean[j]) / std[j];
  return out;
}

// ── 1. Gaussian Naive Bayes ───────────────────────────────────────────────────

/**
 * Train a Gaussian Naive Bayes classifier.
 * Estimates per-class mean and variance for each feature dimension.
 */
export function trainNaiveBayes(features, labels) {
  const classes = uniqueLabels(labels);
  const groups  = groupByLabel(features, labels);
  const n       = labels.length;

  const classPrior = {};
  const classMean  = {};
  const classVar   = {};

  for (const cls of classes) {
    const vecs = groups[cls];
    classPrior[cls] = vecs.length / n;
    classMean[cls]  = colMean(vecs);
    classVar[cls]   = colVar(vecs, classMean[cls]);
    // Add small epsilon to avoid zero variance
    for (let j = 0; j < classVar[cls].length; j++) classVar[cls][j] += 1e-9;
  }

  return { type: 'naiveBayes', classes, classPrior, classMean, classVar };
}

export function predictNaiveBayes(model, vec) {
  const { classes, classPrior, classMean, classVar } = model;
  const logScores = {};

  for (const cls of classes) {
    let logP = Math.log(classPrior[cls]);
    const mu  = classMean[cls];
    const sig = classVar[cls];
    for (let j = 0; j < vec.length; j++) {
      // Log Gaussian PDF
      logP -= 0.5 * Math.log(2 * Math.PI * sig[j]);
      logP -= (vec[j] - mu[j]) ** 2 / (2 * sig[j]);
    }
    logScores[cls] = logP;
  }

  // Convert log scores to probabilities via softmax
  const probs = softmax(logScores);
  const label = classes.reduce((best, c) => probs[c] > probs[best] ? c : best, classes[0]);
  return { label, confidence: probs[label], scores: probs };
}

// ── 2. Logistic Regression (one-vs-rest, gradient descent) ───────────────────

/**
 * Train a one-vs-rest Logistic Regression classifier.
 * Each class gets its own binary logistic regression model.
 */
export function trainLogisticRegression(features, labels, {
  lr = 0.01, epochs = 200, lambda = 1e-4,
} = {}) {
  const classes = uniqueLabels(labels);
  const norm    = computeNormaliser(features);
  const X       = features.map((v) => normalise(v, norm));
  const d       = X[0].length;

  const weights = {};
  const biases  = {};

  for (const cls of classes) {
    const y = labels.map((l) => l === cls ? 1 : 0);
    const w = new Float64Array(d);
    let   b = 0;

    for (let ep = 0; ep < epochs; ep++) {
      const dw = new Float64Array(d);
      let   db = 0;

      for (let i = 0; i < X.length; i++) {
        const z    = dotVV(w, X[i]) + b;
        const pred = 1 / (1 + Math.exp(-z));
        const err  = pred - y[i];
        for (let j = 0; j < d; j++) dw[j] += err * X[i][j];
        db += err;
      }

      const scale = 1 / X.length;
      for (let j = 0; j < d; j++) w[j] -= lr * (dw[j] * scale + lambda * w[j]);
      b -= lr * db * scale;
    }

    weights[cls] = w;
    biases[cls]  = b;
  }

  return { type: 'logisticRegression', classes, weights, biases, norm };
}

export function predictLogisticRegression(model, vec) {
  const { classes, weights, biases, norm } = model;
  const x = normalise(vec, norm);
  const scores = {};

  for (const cls of classes) {
    const z = dotVV(weights[cls], x) + biases[cls];
    scores[cls] = 1 / (1 + Math.exp(-z)); // sigmoid probability
  }

  // Normalise to sum to 1
  const total = Object.values(scores).reduce((a, b) => a + b, 0) || 1;
  const probs = {};
  for (const cls of classes) probs[cls] = scores[cls] / total;

  const label = classes.reduce((best, c) => probs[c] > probs[best] ? c : best, classes[0]);
  return { label, confidence: probs[label], scores: probs };
}

// ── 3. Linear SVM (one-vs-rest, SGD with hinge loss) ─────────────────────────

/**
 * Train a linear SVM using stochastic gradient descent with hinge loss.
 * One-vs-rest: one binary SVM per class.
 */
export function trainSVM(features, labels, {
  lr = 0.01, epochs = 300, C = 1.0,
} = {}) {
  const classes = uniqueLabels(labels);
  const norm    = computeNormaliser(features);
  const X       = features.map((v) => normalise(v, norm));
  const d       = X[0].length;

  const weights = {};
  const biases  = {};

  for (const cls of classes) {
    const y = labels.map((l) => l === cls ? 1 : -1);
    const w = new Float64Array(d);
    let   b = 0;

    for (let ep = 0; ep < epochs; ep++) {
      const lrEp = lr / (1 + ep * 0.01); // learning rate decay
      for (let i = 0; i < X.length; i++) {
        const margin = y[i] * (dotVV(w, X[i]) + b);
        if (margin < 1) {
          // Hinge loss gradient
          for (let j = 0; j < d; j++)
            w[j] += lrEp * (C * y[i] * X[i][j] - w[j]);
          b += lrEp * C * y[i];
        } else {
          // Regularisation only
          for (let j = 0; j < d; j++) w[j] -= lrEp * w[j];
        }
      }
    }

    weights[cls] = w;
    biases[cls]  = b;
  }

  return { type: 'svm', classes, weights, biases, norm };
}

export function predictSVM(model, vec) {
  const { classes, weights, biases, norm } = model;
  const x = normalise(vec, norm);
  const scores = {};

  for (const cls of classes) {
    scores[cls] = dotVV(weights[cls], x) + biases[cls];
  }

  // Convert decision values to pseudo-probabilities via softmax
  const probs = softmax(scores);
  const label = classes.reduce((best, c) => scores[c] > scores[best] ? c : best, classes[0]);
  return { label, confidence: probs[label], scores: probs };
}

// ── 4. Decision Tree (CART, Gini impurity) ───────────────────────────────────

function gini(groups, classes) {
  const total = groups.reduce((s, g) => s + g.length, 0);
  let impurity = 0;
  for (const group of groups) {
    const size = group.length;
    if (size === 0) continue;
    let score = 1;
    for (const cls of classes) {
      const p = group.filter((r) => r.label === cls).length / size;
      score -= p * p;
    }
    impurity += score * (size / total);
  }
  return impurity;
}

function bestSplit(rows, classes) {
  let bestGini = Infinity, bestFeature = 0, bestThreshold = 0, bestGroups = null;
  const d = rows[0].features.length;

  for (let f = 0; f < d; f++) {
    const vals = [...new Set(rows.map((r) => r.features[f]))].sort((a, b) => a - b);
    for (let t = 0; t < vals.length - 1; t++) {
      const threshold = (vals[t] + vals[t + 1]) / 2;
      const left  = rows.filter((r) => r.features[f] <= threshold);
      const right = rows.filter((r) => r.features[f] >  threshold);
      const g = gini([left, right], classes);
      if (g < bestGini) {
        bestGini = g; bestFeature = f; bestThreshold = threshold;
        bestGroups = { left, right };
      }
    }
  }
  return { feature: bestFeature, threshold: bestThreshold, gini: bestGini, groups: bestGroups };
}

function majorityLabel(rows) {
  const counts = {};
  for (const r of rows) counts[r.label] = (counts[r.label] ?? 0) + 1;
  return Object.entries(counts).reduce((best, [l, c]) => c > best[1] ? [l, c] : best, ['', 0])[0];
}

function buildTree(rows, classes, depth, maxDepth, minSize) {
  if (rows.length <= minSize || depth >= maxDepth) {
    return { leaf: true, label: majorityLabel(rows), size: rows.length };
  }
  const { feature, threshold, gini: g, groups } = bestSplit(rows, classes);
  if (!groups || g === 0) {
    return { leaf: true, label: majorityLabel(rows), size: rows.length };
  }
  if (groups.left.length === 0 || groups.right.length === 0) {
    return { leaf: true, label: majorityLabel(rows), size: rows.length };
  }
  return {
    leaf: false, feature, threshold,
    left:  buildTree(groups.left,  classes, depth + 1, maxDepth, minSize),
    right: buildTree(groups.right, classes, depth + 1, maxDepth, minSize),
  };
}

function traverseTree(node, vec) {
  if (node.leaf) return node.label;
  return vec[node.feature] <= node.threshold
    ? traverseTree(node.left, vec)
    : traverseTree(node.right, vec);
}

export function trainDecisionTree(features, labels, { maxDepth = 8, minSize = 2 } = {}) {
  const classes = uniqueLabels(labels);
  const rows    = features.map((f, i) => ({ features: Array.from(f), label: labels[i] }));
  const tree    = buildTree(rows, classes, 0, maxDepth, minSize);
  return { type: 'decisionTree', classes, tree };
}

export function predictDecisionTree(model, vec) {
  const label = traverseTree(model.tree, Array.from(vec));
  // Decision tree gives hard label only — confidence 1.0 for winner
  const scores = Object.fromEntries(model.classes.map((c) => [c, c === label ? 1 : 0]));
  return { label, confidence: 1.0, scores };
}

// ── unified classifier interface ──────────────────────────────────────────────

/**
 * Train any supported classifier by name.
 * @param type     'naiveBayes' | 'logisticRegression' | 'svm' | 'decisionTree'
 * @param features Float32Array[] — training feature vectors
 * @param labels   string[] — material labels
 * @param options  optional hyperparameters passed to the specific trainer
 */
export function trainClassifier(type, features, labels, options = {}) {
  switch (type) {
    case 'naiveBayes':          return trainNaiveBayes(features, labels);
    case 'logisticRegression':  return trainLogisticRegression(features, labels, options);
    case 'svm':                 return trainSVM(features, labels, options);
    case 'decisionTree':        return trainDecisionTree(features, labels, options);
    default: throw new Error(`Unknown classifier type: ${type}`);
  }
}

/**
 * Run prediction with any trained model.
 * @param model   output of trainClassifier
 * @param vec     Float32Array — feature vector to classify
 * @returns { label: string, confidence: number, scores: { [material]: number } }
 */
export function predictClassifier(model, vec) {
  switch (model.type) {
    case 'naiveBayes':          return predictNaiveBayes(model, vec);
    case 'logisticRegression':  return predictLogisticRegression(model, vec);
    case 'svm':                 return predictSVM(model, vec);
    case 'decisionTree':        return predictDecisionTree(model, vec);
    default: throw new Error(`Unknown model type: ${model.type}`);
  }
}
