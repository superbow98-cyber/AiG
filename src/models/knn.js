// AiG — knn.js
// k-Nearest Neighbours for GPR hyperbola matching against the Supabase
// GPR+XRF reference database. Core of the PhD novelty — matches a detected
// hyperbola's feature vector against historical records where both GPR
// and lab XRF confirmed the material type.
//
// Also contains feature extraction from a detected hyperbola window,
// used by both knnSearch and the classical classifiers (svmModel, randomForest).
//
// Consumed by: Classify.jsx, useResults.js

// ── vector math ───────────────────────────────────────────────────────────────

/**
 * Cosine similarity between two vectors — range [-1, 1].
 * Returns 0 if either vector is zero-magnitude.
 */
export function cosineSimilarity(vecA, vecB) {
  if (vecA.length !== vecB.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dot   += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom > 0 ? dot / denom : 0;
}

/**
 * Euclidean distance between two vectors.
 */
export function euclideanDistance(vecA, vecB) {
  let sum = 0;
  for (let i = 0; i < vecA.length; i++) sum += (vecA[i] - vecB[i]) ** 2;
  return Math.sqrt(sum);
}

// ── feature extraction ────────────────────────────────────────────────────────

/**
 * Extract a fixed-length feature vector from a hyperbola window of the B-scan.
 *
 * The window is a sub-matrix centred on the hyperbola apex:
 *   rows: apex_sample ± halfDepth  (default ±20 samples)
 *   cols: apex_trace  ± halfWidth  (default ±15 traces)
 *
 * Features extracted (total 18 features):
 *   [0]    peak amplitude (absolute max in window)
 *   [1]    mean amplitude
 *   [2]    RMS amplitude
 *   [3]    amplitude std dev
 *   [4]    skewness
 *   [5]    kurtosis (excess)
 *   [6]    apex row (normalised 0–1 by samples)
 *   [7]    apex col (normalised 0–1 by traces)
 *   [8]    window energy (sum of squares)
 *   [9]    zero-crossing rate (per row, averaged)
 *   [10]   curvature estimate (see below)
 *   [11]   left arm slope  (amplitude gradient left of apex)
 *   [12]   right arm slope (amplitude gradient right of apex)
 *   [13]   hyperbola width at half-max (traces)
 *   [14]   asymmetry index (|left - right| / (left + right))
 *   [15]   dominant frequency estimate (via zero-crossing of apex trace, in samples)
 *   [16]   amplitude decay rate (fit of peak vs depth below apex)
 *   [17]   signal-to-clutter ratio (peak / mean of surrounding border)
 *
 * @param matrix      Float32Array[][] — full B-scan
 * @param apexSample  number — row index of hyperbola apex
 * @param apexTrace   number — column index of hyperbola apex
 * @param halfDepth   number — samples above/below apex to include (default 20)
 * @param halfWidth   number — traces left/right of apex to include (default 15)
 * @returns Float32Array of length 18
 */
export function extractFeatures(matrix, apexSample, apexTrace, halfDepth = 20, halfWidth = 15) {
  const totalSamples = matrix.length;
  const totalTraces  = matrix[0].length;

  const r0 = Math.max(0, apexSample - halfDepth);
  const r1 = Math.min(totalSamples - 1, apexSample + halfDepth);
  const c0 = Math.max(0, apexTrace  - halfWidth);
  const c1 = Math.min(totalTraces  - 1, apexTrace  + halfWidth);

  // Flatten window
  const vals = [];
  for (let r = r0; r <= r1; r++)
    for (let c = c0; c <= c1; c++) vals.push(matrix[r][c]);

  const n = vals.length || 1;

  // Basic stats
  let sum = 0, sumSq = 0, peak = 0;
  for (const v of vals) {
    sum   += v;
    sumSq += v * v;
    if (Math.abs(v) > Math.abs(peak)) peak = v;
  }
  const mean = sum / n;
  const rms  = Math.sqrt(sumSq / n);
  const variance = sumSq / n - mean * mean;
  const std  = Math.sqrt(Math.max(0, variance));

  let skew = 0, kurt = 0;
  for (const v of vals) {
    const d = v - mean;
    skew += d ** 3;
    kurt += d ** 4;
  }
  skew = std > 0 ? skew / (n * std ** 3) : 0;
  kurt = std > 0 ? kurt / (n * std ** 4) - 3 : 0;

  // Apex position (normalised)
  const apexNormRow = totalSamples > 1 ? apexSample / (totalSamples - 1) : 0;
  const apexNormCol = totalTraces  > 1 ? apexTrace  / (totalTraces  - 1) : 0;

  // Energy
  const energy = sumSq;

  // Zero-crossing rate (averaged across rows of window)
  let zcr = 0;
  for (let r = r0; r <= r1; r++) {
    let zc = 0;
    for (let c = c0; c < c1; c++) {
      if (matrix[r][c] * matrix[r][c + 1] < 0) zc++;
    }
    zcr += zc / Math.max(1, c1 - c0);
  }
  zcr /= Math.max(1, r1 - r0 + 1);

  // Curvature: fit apex row amplitude profile — compare peak to neighbours 2 traces away
  const apexAmp = Math.abs(matrix[apexSample]?.[apexTrace] ?? 0);
  const leftAmp  = Math.abs(matrix[apexSample]?.[Math.max(0, apexTrace - 2)]  ?? 0);
  const rightAmp = Math.abs(matrix[apexSample]?.[Math.min(totalTraces - 1, apexTrace + 2)] ?? 0);
  const curvature = apexAmp > 0 ? (apexAmp - (leftAmp + rightAmp) / 2) / apexAmp : 0;

  // Arm slopes: amplitude at apex vs 5 traces away, 5 samples below apex
  const leftSlope  = apexAmp > 0
    ? (apexAmp - Math.abs(matrix[Math.min(totalSamples-1, apexSample+5)]?.[Math.max(0, apexTrace-5)] ?? 0)) / apexAmp
    : 0;
  const rightSlope = apexAmp > 0
    ? (apexAmp - Math.abs(matrix[Math.min(totalSamples-1, apexSample+5)]?.[Math.min(totalTraces-1, apexTrace+5)] ?? 0)) / apexAmp
    : 0;

  // Width at half-max (traces)
  const halfMax = apexAmp / 2;
  let widthHM = 0;
  const apexRow = matrix[apexSample] ?? [];
  for (let c = c0; c <= c1; c++) {
    if (Math.abs(apexRow[c] ?? 0) >= halfMax) widthHM++;
  }

  // Asymmetry
  const denom = (leftAmp + rightAmp) || 1;
  const asymmetry = Math.abs(leftAmp - rightAmp) / denom;

  // Dominant frequency via zero-crossing of apex trace (samples between crossings)
  const apexCol = apexTrace;
  let crossings = 0;
  for (let r = r0; r < r1; r++) {
    if ((matrix[r]?.[apexCol] ?? 0) * (matrix[r+1]?.[apexCol] ?? 0) < 0) crossings++;
  }
  const domFreqEst = crossings > 0 ? (r1 - r0) / crossings : r1 - r0;

  // Amplitude decay rate below apex
  let decaySum = 0, decayCount = 0;
  for (let r = apexSample + 1; r <= Math.min(totalSamples - 1, apexSample + 10); r++) {
    const a = Math.abs(matrix[r]?.[apexTrace] ?? 0);
    if (apexAmp > 0) { decaySum += a / apexAmp; decayCount++; }
  }
  const decayRate = decayCount > 0 ? 1 - decaySum / decayCount : 0;

  // Signal-to-clutter: peak vs border mean
  const borderVals = [];
  for (let c = c0; c <= c1; c++) {
    if (matrix[r0]?.[c] != null) borderVals.push(Math.abs(matrix[r0][c]));
    if (matrix[r1]?.[c] != null) borderVals.push(Math.abs(matrix[r1][c]));
  }
  for (let r = r0; r <= r1; r++) {
    if (matrix[r]?.[c0] != null) borderVals.push(Math.abs(matrix[r][c0]));
    if (matrix[r]?.[c1] != null) borderVals.push(Math.abs(matrix[r][c1]));
  }
  const borderMean = borderVals.length > 0
    ? borderVals.reduce((a, b) => a + b, 0) / borderVals.length : 1;
  const scr = borderMean > 0 ? Math.abs(peak) / borderMean : 0;

  return new Float32Array([
    peak, mean, rms, std, skew, kurt,
    apexNormRow, apexNormCol, energy, zcr,
    curvature, leftSlope, rightSlope, widthHM,
    asymmetry, domFreqEst, decayRate, scr,
  ]);
}

// ── k-NN search ───────────────────────────────────────────────────────────────

/**
 * Search a database of GPR+XRF records for the k most similar to a query vector.
 *
 * @param queryVec   Float32Array — feature vector of the detected hyperbola (length 18)
 * @param database   Array of Supabase gpr_xrf_records rows:
 *                   [{ id, material, gpr_signature: number[], ...rest }]
 * @param k          number of top matches to return (default 5)
 * @param metric     'cosine' | 'euclidean' (default 'cosine')
 * @returns Array of top-k matches sorted by similarity desc:
 *   [{ record_id, material, similarity, distance, record }]
 */
export function knnSearch(queryVec, database, k = 5, metric = 'cosine') {
  if (!database?.length) return [];

  const scored = database
    .filter((row) => Array.isArray(row.gpr_signature) && row.gpr_signature.length > 0)
    .map((row) => {
      const sig = new Float32Array(row.gpr_signature);
      // Pad or trim to match query length
      const aligned = new Float32Array(queryVec.length);
      for (let i = 0; i < Math.min(sig.length, queryVec.length); i++) aligned[i] = sig[i];

      const similarity = cosineSimilarity(queryVec, aligned);
      const distance   = euclideanDistance(queryVec, aligned);

      return {
        record_id:  row.id,
        material:   row.material ?? 'unknown',
        similarity,
        distance,
        record:     row,
      };
    });

  // Sort by cosine similarity desc (or distance asc for euclidean)
  if (metric === 'euclidean') {
    scored.sort((a, b) => a.distance - b.distance);
  } else {
    scored.sort((a, b) => b.similarity - a.similarity);
  }

  return scored.slice(0, k);
}

/**
 * Majority-vote material prediction from k-NN results.
 * Weights votes by similarity score.
 *
 * @param matches   output of knnSearch
 * @returns { material: string, confidence: number (0–1), votes: { [material]: number } }
 */
export function predictMaterial(matches) {
  if (!matches?.length) return { material: 'unknown', confidence: 0, votes: {} };

  const votes = {};
  let totalWeight = 0;

  for (const m of matches) {
    const w = Math.max(0, m.similarity); // cosine can be negative
    votes[m.material] = (votes[m.material] ?? 0) + w;
    totalWeight += w;
  }

  let bestMaterial = 'unknown';
  let bestWeight = -Infinity;
  for (const [mat, w] of Object.entries(votes)) {
    if (w > bestWeight) { bestWeight = w; bestMaterial = mat; }
  }

  const confidence = totalWeight > 0 ? bestWeight / totalWeight : 0;
  return { material: bestMaterial, confidence, votes };
}

// ── findPeaks ────────────────────────────────────────────────────────────────
// Local-maxima (hyperbola-apex candidate) detector over a B-scan matrix.
//   matrix[sampleIndex][traceIndex] = amplitude
// options:
//   minAmplitude   — ignore peaks weaker than this absolute amplitude
//   neighborRadius — non-max suppression radius (samples & traces)
//   depthRange     — [startSample, endSample) window to search (skips direct wave)
// Returns: Array<{ sample, trace, amplitude }> sorted by |amplitude| desc.
export function findPeaks(matrix, { minAmplitude = 0, neighborRadius = 3, depthRange } = {}) {
  const rows = matrix.length;
  const cols = rows > 0 ? matrix[0].length : 0;
  if (rows === 0 || cols === 0) return [];

  const sStart = depthRange ? Math.max(0, depthRange[0]) : 0;
  const sEnd = depthRange ? Math.min(rows, depthRange[1]) : rows;
  const r = Math.max(1, neighborRadius | 0);

  const candidates = [];
  for (let s = sStart; s < sEnd; s++) {
    for (let t = 0; t < cols; t++) {
      const av = Math.abs(matrix[s][t]);
      if (av < minAmplitude) continue;

      let isMax = true;
      for (let ds = -r; ds <= r && isMax; ds++) {
        const ss = s + ds;
        if (ss < 0 || ss >= rows) continue;
        for (let dt = -r; dt <= r; dt++) {
          const tt = t + dt;
          if (tt < 0 || tt >= cols) continue;
          if (ss === s && tt === t) continue;
          if (Math.abs(matrix[ss][tt]) > av) { isMax = false; break; }
        }
      }
      if (isMax) candidates.push({ sample: s, trace: t, amplitude: matrix[s][t] });
    }
  }

  // greedy non-maximum suppression by descending |amplitude|
  candidates.sort((a, b) => Math.abs(b.amplitude) - Math.abs(a.amplitude));
  const kept = [];
  for (const c of candidates) {
    let ok = true;
    for (const k of kept) {
      if (Math.abs(k.sample - c.sample) <= r && Math.abs(k.trace - c.trace) <= r) { ok = false; break; }
    }
    if (ok) kept.push(c);
  }
  return kept;
}

// ── predictElements ──────────────────────────────────────────────────────────
// Predicted elemental profile (the PhD novelty: GPR pattern → likely chemistry).
// Weighted average of the matched neighbours' xrf_elements vectors, weighted by
// cosine similarity. Returns { elements: { Fe: .., Ca: .., ... }, fromMatches }.
// Neighbours store xrf_elements either as an object {Fe:.., Ca:..} or array.
export function predictElements(matches) {
  if (!matches?.length) return { elements: {}, fromMatches: 0 };
  const acc = {};
  let totalW = 0;
  let used = 0;
  for (const m of matches) {
    const el = m.record?.xrf_elements;
    if (!el) continue;
    const w = Math.max(0, m.similarity ?? 0) || 1e-6;
    const entries = Array.isArray(el)
      ? el.map((v, i) => [`E${i}`, v])
      : Object.entries(el);
    for (const [k, v] of entries) {
      const num = Number(v);
      if (Number.isNaN(num)) continue;
      acc[k] = (acc[k] ?? 0) + num * w;
    }
    totalW += w;
    used += 1;
  }
  if (totalW > 0) for (const k of Object.keys(acc)) acc[k] /= totalW;
  return { elements: acc, fromMatches: used };
}
