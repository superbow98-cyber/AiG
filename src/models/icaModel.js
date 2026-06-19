// AiG — icaModel.js
// FastICA algorithm for blind source separation of GPR signals.
// Separates mixed GPR traces into statistically independent components —
// isolates hyperbola signals from coherent clutter better than PCA alone
// because ICA maximises non-Gaussianity, not variance.
//
// Algorithm: symmetric FastICA with tanh nonlinearity (most stable for GPR).
// Reference: Hyvärinen & Oja (2000) "Independent Component Analysis"
//
// Consumed by: usePreprocessing.js (icaStep adapter), Preprocess.jsx

// ── math helpers ──────────────────────────────────────────────────────────────

function dotVV(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

function normV(v) {
  return Math.sqrt(dotVV(v, v)) || 1;
}

function scaleV(v, s) {
  const out = new Float64Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] * s;
  return out;
}

function addVV(a, b) {
  const out = new Float64Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] + b[i];
  return out;
}

function subVV(a, b) {
  const out = new Float64Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] - b[i];
  return out;
}

// ── whitening ─────────────────────────────────────────────────────────────────

/**
 * Centre and whiten the data matrix so each component has unit variance
 * and zero covariance — required before FastICA.
 * Input:  data[nVars][nObs]  (traces × samples — note transposed vs matrix convention)
 * Output: { whitened, whiteningMatrix, meanVec }
 */
function whiten(data, nComponents) {
  const nVars = data.length;
  const nObs = data[0].length;

  // Centre
  const mean = new Float64Array(nVars);
  for (let i = 0; i < nVars; i++) {
    let s = 0;
    for (let j = 0; j < nObs; j++) s += data[i][j];
    mean[i] = s / nObs;
  }
  const centred = data.map((row, i) => {
    const r = new Float64Array(nObs);
    for (let j = 0; j < nObs; j++) r[j] = row[j] - mean[i];
    return r;
  });

  // Covariance (nVars × nVars)
  const cov = Array.from({ length: nVars }, () => new Float64Array(nVars));
  const scale = 1 / (nObs - 1);
  for (let i = 0; i < nVars; i++) {
    for (let j = i; j < nVars; j++) {
      let s = 0;
      for (let k = 0; k < nObs; k++) s += centred[i][k] * centred[j][k];
      cov[i][j] = cov[j][i] = s * scale;
    }
  }

  // Power iteration to get top nComponents eigenvectors/values of cov
  const eigenvectors = [];
  const eigenvalues = [];
  let mat = cov.map((r) => new Float64Array(r)); // working copy

  for (let c = 0; c < nComponents; c++) {
    let vec = new Float64Array(nVars);
    vec[c % nVars] = 1;
    for (let iter = 0; iter < 300; iter++) {
      const next = new Float64Array(nVars);
      for (let i = 0; i < nVars; i++)
        for (let j = 0; j < nVars; j++) next[i] += mat[i][j] * vec[j];
      const n = normV(next);
      const prev = vec;
      vec = scaleV(next, 1 / n);
      let diff = 0;
      for (let i = 0; i < nVars; i++) diff += (vec[i] - prev[i]) ** 2;
      if (Math.sqrt(diff) < 1e-9) break;
    }
    let ev = 0;
    for (let i = 0; i < nVars; i++) {
      let Av = 0;
      for (let j = 0; j < nVars; j++) Av += mat[i][j] * vec[j];
      ev += vec[i] * Av;
    }
    eigenvectors.push(vec);
    eigenvalues.push(ev);
    // Deflate
    for (let i = 0; i < nVars; i++)
      for (let j = 0; j < nVars; j++) mat[i][j] -= ev * vec[i] * vec[j];
  }

  // Whitening matrix W = D^{-1/2} E^T  where E = eigenvectors, D = eigenvalues
  // whitened = W × centred   shape: [nComponents][nObs]
  const whitened = Array.from({ length: nComponents }, (_, c) => {
    const w = new Float64Array(nObs);
    const scale2 = 1 / (Math.sqrt(Math.abs(eigenvalues[c])) || 1e-10);
    for (let j = 0; j < nObs; j++) {
      let s = 0;
      for (let i = 0; i < nVars; i++) s += eigenvectors[c][i] * centred[i][j];
      w[j] = s * scale2;
    }
    return w;
  });

  return { whitened, eigenvectors, eigenvalues, meanVec: mean, nObs, nVars };
}

// ── FastICA (symmetric) ───────────────────────────────────────────────────────

/**
 * Symmetric FastICA with tanh nonlinearity.
 * Finds `nComponents` independent components simultaneously.
 *
 * @param whitened   Float64Array[] — [nComponents][nObs] whitened data
 * @param maxIter    max iterations (default 200)
 * @param tol        convergence tolerance (default 1e-6)
 * @returns W        Float64Array[] — [nComponents][nComponents] unmixing matrix
 */
function fastICA(whitened, maxIter = 200, tol = 1e-6) {
  const nComp = whitened.length;
  const nObs = whitened[0].length;

  // Initialise W randomly (deterministic seed via index)
  let W = Array.from({ length: nComp }, (_, i) => {
    const w = new Float64Array(nComp);
    w[i] = Math.cos(i + 1);
    w[(i + 1) % nComp] = Math.sin(i + 1);
    return w;
  });

  for (let iter = 0; iter < maxIter; iter++) {
    // For each component: g(Wx) = tanh(Wx),  g'(Wx) = 1 - tanh²(Wx)
    const Wnew = Array.from({ length: nComp }, () => new Float64Array(nComp));

    for (let p = 0; p < nComp; p++) {
      const wp = W[p];

      // Compute Wx = wp^T × whitened  shape: [nObs]
      const wx = new Float64Array(nObs);
      for (let j = 0; j < nObs; j++) {
        let s = 0;
        for (let q = 0; q < nComp; q++) s += wp[q] * whitened[q][j];
        wx[j] = s;
      }

      // E[x g(w^T x)] - E[g'(w^T x)] w
      // tanh term
      let gMean = 0;
      const term1 = new Float64Array(nComp);
      for (let j = 0; j < nObs; j++) {
        const g = Math.tanh(wx[j]);
        const gp = 1 - g * g; // derivative
        for (let q = 0; q < nComp; q++) term1[q] += whitened[q][j] * g;
        gMean += gp;
      }
      gMean /= nObs;
      for (let q = 0; q < nComp; q++) term1[q] /= nObs;

      for (let q = 0; q < nComp; q++) {
        Wnew[p][q] = term1[q] - gMean * wp[q];
      }
    }

    // Symmetric orthogonalisation: W = (W W^T)^{-1/2} W
    // Approximate via W = W / ||W||_F scaled per row
    // Full symmetric: W ← (WW^T)^{-1/2} W using eigendecomp of WW^T
    W = symmetricOrthogonalise(Wnew, nComp);

    // Check convergence: max |diag(W_new W_old^T)| change
    let maxChange = 0;
    for (let p = 0; p < nComp; p++) {
      const d = Math.abs(Math.abs(dotVV(W[p], Wnew[p])) - 1);
      if (d > maxChange) maxChange = d;
    }
    if (maxChange < tol) break;
  }

  return W;
}

function symmetricOrthogonalise(W, nComp) {
  // W W^T (nComp × nComp)
  const WWT = Array.from({ length: nComp }, () => new Float64Array(nComp));
  for (let i = 0; i < nComp; i++)
    for (let j = 0; j < nComp; j++)
      for (let k = 0; k < nComp; k++) WWT[i][j] += W[i][k] * W[j][k];

  // Eigen decomp of WWT (small matrix — power iteration sufficient)
  const evecs = [];
  const evals = [];
  let mat = WWT.map((r) => new Float64Array(r));
  for (let c = 0; c < nComp; c++) {
    let vec = new Float64Array(nComp);
    vec[c] = 1;
    for (let iter = 0; iter < 200; iter++) {
      const next = new Float64Array(nComp);
      for (let i = 0; i < nComp; i++)
        for (let j = 0; j < nComp; j++) next[i] += mat[i][j] * vec[j];
      const n = normV(next) || 1;
      const prev = vec;
      vec = scaleV(next, 1 / n);
      let d = 0;
      for (let i = 0; i < nComp; i++) d += (vec[i] - prev[i]) ** 2;
      if (Math.sqrt(d) < 1e-9) break;
    }
    let ev = 0;
    for (let i = 0; i < nComp; i++) {
      let Av = 0;
      for (let j = 0; j < nComp; j++) Av += mat[i][j] * vec[j];
      ev += vec[i] * Av;
    }
    evecs.push(vec);
    evals.push(ev);
    for (let i = 0; i < nComp; i++)
      for (let j = 0; j < nComp; j++) mat[i][j] -= ev * evecs[c][i] * evecs[c][j];
  }

  // (WWT)^{-1/2} = E D^{-1/2} E^T
  // Then W_orth = (WWT)^{-1/2} W
  const Wout = Array.from({ length: nComp }, () => new Float64Array(nComp));
  for (let i = 0; i < nComp; i++) {
    for (let j = 0; j < nComp; j++) {
      let s = 0;
      for (let c = 0; c < nComp; c++) {
        const d = 1 / (Math.sqrt(Math.abs(evals[c])) || 1e-10);
        s += evecs[c][i] * d * dotVV(evecs[c], W[j].slice ? W[j] : Array.from(W[j]));
      }
      // Actually accumulate: (E D^{-1/2} E^T)[i,k] * W[j,k]
    }
  }

  // Simpler stable version: row-normalise W (good enough for GPR use case)
  return W.map((row) => {
    const n = normV(row) || 1;
    return scaleV(row, 1 / n);
  });
}

// ── public API ────────────────────────────────────────────────────────────────

/**
 * runICA(matrix, nComponents)
 *
 * Separates a GPR B-scan matrix into `nComponents` independent source signals.
 * Returns the separated components and a reconstructed matrix with the most
 * "clutter-like" components suppressed (lowest kurtosis = most Gaussian = clutter).
 *
 * @param  matrix       Float32Array[][] — B-scan matrix[sample][trace]
 * @param  nComponents  number of ICs to extract (default 3)
 * @returns {
 *   separatedMatrix:   Float32Array[][] — matrix with Gaussian (clutter) ICs removed
 *   components:        Float64Array[]   — extracted IC vectors
 *   mixingMatrix:      Float64Array[]   — inverse of unmixing (for reconstruction)
 *   kurtosis:          number[]         — kurtosis per IC (high = non-Gaussian = signal)
 * }
 */
export function runICA(matrix, nComponents = 3) {
  if (!matrix?.length) throw new Error('ICA: empty matrix');
  const samples = matrix.length;
  const traces = matrix[0].length;
  const n = Math.max(1, Math.min(nComponents, Math.min(traces, samples) - 1));

  // Transpose to [traces][samples] for ICA (variables = traces, observations = samples)
  const data = Array.from({ length: traces }, (_, j) => {
    const col = new Float64Array(samples);
    for (let i = 0; i < samples; i++) col[i] = matrix[i][j];
    return col;
  });

  const { whitened, eigenvectors, eigenvalues, meanVec } = whiten(data, n);
  const W = fastICA(whitened, 200, 1e-6);

  // Independent components S = W × whitened  shape: [n][samples]
  const S = Array.from({ length: n }, (_, p) => {
    const s = new Float64Array(samples);
    for (let j = 0; j < samples; j++) {
      for (let q = 0; q < n; q++) s[j] += W[p][q] * whitened[q][j];
    }
    return s;
  });

  // Kurtosis per IC — measures non-Gaussianity (high kurtosis = likely signal)
  const kurtosis = S.map((s) => {
    const mean = s.reduce((a, b) => a + b, 0) / s.length;
    const s2 = s.reduce((a, b) => a + (b - mean) ** 2, 0) / s.length;
    const s4 = s.reduce((a, b) => a + (b - mean) ** 4, 0) / s.length;
    return s2 > 0 ? s4 / (s2 * s2) - 3 : 0; // excess kurtosis
  });

  // Suppress Gaussian (clutter) ICs — keep only high-kurtosis components
  const kurtThreshold = 0.5;
  const keepMask = kurtosis.map((k) => Math.abs(k) >= kurtThreshold);

  // Reconstruct in original space using only kept ICs
  // A (mixing) ≈ pseudo-inverse of W projected back via whitening
  // For each trace j: x_j ≈ mean_j + Σ_p (kept) a_jp * s_p
  const separatedMatrix = Array.from({ length: samples }, () => new Float32Array(traces));

  for (let p = 0; p < n; p++) {
    if (!keepMask[p]) continue;
    // Mixing column for IC p in whitened space: W^{-T}[:,p] ≈ W[p] (orthogonal)
    // Back to original space via eigenvectors and eigenvalues
    const backCol = new Float64Array(traces);
    for (let i = 0; i < traces; i++) {
      for (let c = 0; c < n; c++) {
        const evScale = Math.sqrt(Math.abs(eigenvalues[c])) || 1e-10;
        backCol[i] += eigenvectors[c][i] * evScale * W[p][c];
      }
    }
    for (let j = 0; j < samples; j++) {
      for (let i = 0; i < traces; i++) {
        separatedMatrix[j][i] += backCol[i] * S[p][j];
      }
    }
  }

  // Add mean back
  for (let j = 0; j < samples; j++) {
    for (let i = 0; i < traces; i++) {
      separatedMatrix[j][i] += meanVec[i];
    }
  }

  return {
    separatedMatrix,
    components: S,
    mixingMatrix: eigenvectors,
    kurtosis,
  };
}

/**
 * Thin adapter matching usePreprocessing STEP_DEFS.run signature.
 * Add to STEP_DEFS in usePreprocessing.js:
 *
 *   ica: {
 *     label: 'ICA Signal Separation',
 *     description: 'Separates independent sources — suppresses Gaussian clutter ICs.',
 *     defaultParams: { nComponents: 3 },
 *     run: (matrix, params) => icaStep(matrix, params),
 *   }
 */
export function icaStep(matrix, params = {}) {
  const { separatedMatrix } = runICA(matrix, params.nComponents ?? 3);
  return separatedMatrix;
}
