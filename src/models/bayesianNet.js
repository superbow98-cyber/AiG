// AiG — bayesianNet.js
// Naive Bayesian Network — uncertainty + confidence estimation for GPR material prediction.
// Complements svmModel.js NB with a richer probability framework:
//   - Prior from DB label distribution
//   - Likelihood from Gaussian feature model per class
//   - Posterior = prior × likelihood (log-space for numerical stability)
//   - Uncertainty = entropy of posterior distribution
//
// Exports:
//   trainBayesianNet(X, y)              → BNModel
//   predictBayesian(model, features)    → { label, confidence, scores, uncertainty, entropy }
//   calibrateProbabilities(scores)      → Platt-scaled scores (sigmoid)

// ── Helpers ───────────────────────────────────────────────────────────────────

function unique(arr) { return [...new Set(arr)]; }

function mean(vals) {
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function variance(vals, m) {
  const mu = m ?? mean(vals);
  return vals.reduce((s, x) => s + (x - mu) ** 2, 0) / (vals.length || 1);
}

// Log Gaussian PDF — numerically stable
function logGaussianPDF(x, mu, sigma2) {
  const s2 = Math.max(sigma2, 1e-9); // avoid log(0)
  return -0.5 * Math.log(2 * Math.PI * s2) - ((x - mu) ** 2) / (2 * s2);
}

// Shannon entropy of probability distribution
function entropy(probs) {
  return -probs.reduce((s, p) => {
    const pp = Math.max(p, 1e-12);
    return s + pp * Math.log2(pp);
  }, 0);
}

// Softmax from log-scores
function softmaxLog(logScores) {
  const max  = Math.max(...logScores);
  const exps = logScores.map((l) => Math.exp(l - max));
  const sum  = exps.reduce((a, b) => a + b, 0);
  return exps.map((e) => e / sum);
}

// ── Training ──────────────────────────────────────────────────────────────────

export function trainBayesianNet(X, y) {
  if (!X.length) throw new Error('No training data');
  const classes = unique(y).sort();
  const dim     = X[0].length;
  const n       = X.length;

  const classPriors = {};   // log P(class)
  const means       = {};   // means[class][feat]
  const variances   = {};   // variances[class][feat]

  for (const cls of classes) {
    const indices = y.reduce((acc, label, i) => {
      if (label === cls) acc.push(i);
      return acc;
    }, []);

    classPriors[cls] = Math.log(indices.length / n);

    means[cls]     = new Float64Array(dim);
    variances[cls] = new Float64Array(dim);

    for (let d = 0; d < dim; d++) {
      const vals = indices.map((i) => X[i][d]);
      const mu   = mean(vals);
      means[cls][d]     = mu;
      variances[cls][d] = variance(vals, mu);
    }
  }

  return { type: 'bayesianNet', classes, dim, classPriors, means, variances };
}

// ── Prediction ────────────────────────────────────────────────────────────────

export function predictBayesian(model, features) {
  const x = Array.from(features);

  // Log posterior per class: log P(class) + sum log P(x_d | class)
  const logPosteriors = model.classes.map((cls) => {
    let logP = model.classPriors[cls];
    for (let d = 0; d < Math.min(x.length, model.dim); d++) {
      logP += logGaussianPDF(x[d], model.means[cls][d], model.variances[cls][d]);
    }
    return logP;
  });

  const probs  = softmaxLog(logPosteriors);
  const scores = Object.fromEntries(model.classes.map((c, i) => [c, probs[i]]));

  const bestIdx    = probs.indexOf(Math.max(...probs));
  const label      = model.classes[bestIdx];
  const confidence = probs[bestIdx];
  const ent        = entropy(probs);

  // Uncertainty: normalised entropy (0 = certain, 1 = max uncertainty)
  const maxEntropy  = Math.log2(model.classes.length || 1);
  const uncertainty = maxEntropy > 0 ? ent / maxEntropy : 0;

  return { label, confidence, scores, uncertainty, entropy: ent };
}

// ── Platt scaling (sigmoid calibration) ──────────────────────────────────────
// Calibrates overconfident raw scores toward true probabilities.
// Call after predictBayesian if raw confidences seem too extreme.

export function calibrateProbabilities(scores) {
  const entries = Object.entries(scores);
  // Sigmoid squash: p_cal = 1 / (1 + exp(-4 * (p - 0.5)))
  const calibrated = entries.map(([k, p]) => [k, 1 / (1 + Math.exp(-4 * (p - 0.5)))]);
  const sum = calibrated.reduce((s, [, p]) => s + p, 0) || 1;
  return Object.fromEntries(calibrated.map(([k, p]) => [k, p / sum]));
}

// ── Uncertainty summary (for UI display) ─────────────────────────────────────

export function uncertaintySummary(uncertainty) {
  if (uncertainty < 0.2) return { level: 'low',    label: 'High confidence',   color: '#34d399' };
  if (uncertainty < 0.5) return { level: 'medium', label: 'Moderate confidence', color: '#fbbf24' };
  return                        { level: 'high',   label: 'Uncertain',          color: '#f87171' };
}
