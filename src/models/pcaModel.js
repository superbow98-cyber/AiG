// AiG — pcaModel.js
// Manual PCA (Principal Component Analysis) for GPR clutter removal.
// No external ML library — pure JS using power iteration for eigen decomposition.
//
// Use case: the first N principal components of a B-scan matrix capture
// coherent clutter (ground bounce, ringing, horizontal banding). Removing
// those components and reconstructing leaves anomaly signals (hyperbolas).
//
// Consumed by: usePreprocessing.js (add as a STEP_DEF), Preprocess.jsx

/**
 * Centre a matrix by subtracting the column mean from each column.
 * Returns { centred: Float32Array[][], mean: Float32Array }
 * mean[j] = average amplitude across all samples for trace j.
 */
function centreMatrix(matrix) {
  const samples = matrix.length;
  const traces = matrix[0].length;
  const mean = new Float32Array(traces);

  for (let j = 0; j < traces; j++) {
    let sum = 0;
    for (let i = 0; i < samples; i++) sum += matrix[i][j];
    mean[j] = sum / samples;
  }

  const centred = matrix.map((row) => {
    const r = new Float32Array(traces);
    for (let j = 0; j < traces; j++) r[j] = row[j] - mean[j];
    return r;
  });

  return { centred, mean };
}

/**
 * Compute the covariance matrix of a centred data matrix.
 * Input:  centred[samples][traces]
 * Output: cov[traces][traces]  (traces×traces covariance)
 * We work in trace-space (columns = variables) so PCA finds directions
 * of maximum variance across the scan's horizontal (trace) axis.
 */
function covarianceMatrix(centred) {
  const samples = centred.length;
  const traces = centred[0].length;
  const cov = Array.from({ length: traces }, () => new Float64Array(traces));
  const scale = 1 / (samples - 1);

  for (let i = 0; i < samples; i++) {
    const row = centred[i];
    for (let a = 0; a < traces; a++) {
      for (let b = a; b < traces; b++) {
        cov[a][b] += row[a] * row[b] * scale;
      }
    }
  }
  // Symmetric fill
  for (let a = 0; a < traces; a++) {
    for (let b = a + 1; b < traces; b++) {
      cov[b][a] = cov[a][b];
    }
  }
  return cov;
}

/**
 * Power iteration to find the dominant eigenvector of a symmetric matrix.
 * Runs `maxIter` iterations or until convergence within `tol`.
 */
function powerIteration(matrix, maxIter = 200, tol = 1e-8) {
  const n = matrix.length;
  // Start with a random-ish unit vector
  let vec = new Float64Array(n);
  for (let i = 0; i < n; i++) vec[i] = i === 0 ? 1 : 0.1;

  for (let iter = 0; iter < maxIter; iter++) {
    // Multiply matrix × vec
    const next = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) next[i] += matrix[i][j] * vec[j];
    }
    // Normalise
    let norm = 0;
    for (let i = 0; i < n; i++) norm += next[i] * next[i];
    norm = Math.sqrt(norm) || 1;
    const normalised = new Float64Array(n);
    for (let i = 0; i < n; i++) normalised[i] = next[i] / norm;

    // Check convergence
    let diff = 0;
    for (let i = 0; i < n; i++) diff += (normalised[i] - vec[i]) ** 2;
    vec = normalised;
    if (Math.sqrt(diff) < tol) break;
  }

  // Eigenvalue = vec^T A vec
  let eigenvalue = 0;
  for (let i = 0; i < n; i++) {
    let Av = 0;
    for (let j = 0; j < n; j++) Av += matrix[i][j] * vec[j];
    eigenvalue += vec[i] * Av;
  }

  return { eigenvector: vec, eigenvalue };
}

/**
 * Deflate a symmetric matrix by removing the contribution of one eigenvector.
 * After deflation, the next power iteration finds the next principal component.
 */
function deflate(matrix, eigenvector, eigenvalue) {
  const n = matrix.length;
  const deflated = matrix.map((row) => new Float64Array(row));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      deflated[i][j] -= eigenvalue * eigenvector[i] * eigenvector[j];
    }
  }
  return deflated;
}

/**
 * Extract the top `nComponents` principal components via repeated power iteration.
 * Returns { components: Float64Array[], eigenvalues: number[], explainedVariance: number[] }
 */
function extractComponents(cov, nComponents) {
  const components = [];
  const eigenvalues = [];
  let mat = cov;

  for (let k = 0; k < nComponents; k++) {
    const { eigenvector, eigenvalue } = powerIteration(mat);
    components.push(eigenvector);
    eigenvalues.push(eigenvalue);
    mat = deflate(mat, eigenvector, eigenvalue);
  }

  const totalVar = eigenvalues.reduce((s, v) => s + Math.abs(v), 0) || 1;
  const explainedVariance = eigenvalues.map((v) => Math.abs(v) / totalVar);

  return { components, eigenvalues, explainedVariance };
}

// ── public API ────────────────────────────────────────────────────────────────

/**
 * runPCA(matrix, nComponents)
 *
 * Decomposes the B-scan into principal components and reconstructs using only
 * the top `nComponents` — those components capture coherent clutter.
 * The RESIDUAL (original − reconstruction) is returned as `reducedMatrix`,
 * which represents anomaly signals with clutter suppressed.
 *
 * @param  matrix       Float32Array[][] — raw or pre-centred B-scan
 * @param  nComponents  number of PCs to remove (1–N, default 2)
 * @returns {
 *   reducedMatrix:     Float32Array[][] — clutter-removed matrix (same shape)
 *   clutterMatrix:     Float32Array[][] — the removed clutter (for before/after)
 *   components:        Float64Array[]   — principal component vectors
 *   eigenvalues:       number[]
 *   explainedVariance: number[]         — fraction of variance per component
 * }
 */
export function runPCA(matrix, nComponents = 2) {
  if (!matrix?.length) throw new Error('PCA: empty matrix');
  const samples = matrix.length;
  const traces = matrix[0].length;
  const n = Math.max(1, Math.min(nComponents, traces - 1));

  const { centred, mean } = centreMatrix(matrix);
  const cov = covarianceMatrix(centred);
  const { components, eigenvalues, explainedVariance } = extractComponents(cov, n);

  // Project centred data onto components → scores, then reconstruct clutter
  const clutterCentred = Array.from({ length: samples }, () => new Float32Array(traces));

  for (let k = 0; k < n; k++) {
    const pc = components[k];
    for (let i = 0; i < samples; i++) {
      // Score: dot product of row with PC
      let score = 0;
      for (let j = 0; j < traces; j++) score += centred[i][j] * pc[j];
      // Add back PC contribution to clutter
      for (let j = 0; j < traces; j++) clutterCentred[i][j] += score * pc[j];
    }
  }

  // Build output matrices (add mean back)
  const clutterMatrix = clutterCentred.map((row, i) => {
    const r = new Float32Array(traces);
    for (let j = 0; j < traces; j++) r[j] = row[j] + mean[j];
    return r;
  });

  const reducedMatrix = matrix.map((row, i) => {
    const r = new Float32Array(traces);
    for (let j = 0; j < traces; j++) r[j] = row[j] - clutterCentred[i][j];
    return r;
  });

  return { reducedMatrix, clutterMatrix, components, eigenvalues, explainedVariance };
}

/**
 * Convenience wrapper that matches the STEP_DEFS.run signature in usePreprocessing.js.
 * Add this to STEP_DEFS in usePreprocessing.js:
 *
 *   pca: {
 *     label: 'PCA Clutter Removal',
 *     description: 'Removes top N principal components (coherent clutter).',
 *     defaultParams: { nComponents: 2 },
 *     run: (matrix, params) => pcaStep(matrix, params),
 *   }
 */
export function pcaStep(matrix, params = {}) {
  const { reducedMatrix } = runPCA(matrix, params.nComponents ?? 2);
  return reducedMatrix;
}
