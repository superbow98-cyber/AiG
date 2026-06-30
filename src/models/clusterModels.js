// AiG — clusterModels.js
// K-Means, DBSCAN, SOM — in-browser clustering for GPR anomaly grouping.
// These are the canonical implementations — Cluster.jsx has inline versions
// but should import from here going forward.
//
// Exports:
//   kMeans(vectors, k, opts?)          → labels[]
//   dbscan(vectors, eps, minPts)       → labels[]  (-1 = noise)
//   trainSOM(vectors, opts?)           → SOMModel
//   predictSOM(model, vector)          → { label, bmuX, bmuY, distance }
//   clusterStats(vectors, labels)      → { nClusters, nNoise, silhouette, inertia }

// ── Distance helpers ──────────────────────────────────────────────────────────

function euclidean(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2;
  return Math.sqrt(s);
}

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na  += a[i] * a[i];
    nb  += b[i] * b[i];
  }
  return 1 - dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-12);
}

function dist(a, b, metric = 'euclidean') {
  return metric === 'cosine' ? cosine(a, b) : euclidean(a, b);
}

// ── K-Means ───────────────────────────────────────────────────────────────────

export function kMeans(vectors, k, opts = {}) {
  const { maxIter = 150, metric = 'euclidean', seed = 42 } = opts;
  if (!vectors.length) return [];
  if (vectors.length <= k) return vectors.map((_, i) => i);

  const dim = vectors[0].length;
  const n   = vectors.length;

  // K-Means++ initialisation
  let s = seed >>> 0;
  const lcg = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };

  const centroidIdx = [Math.floor(lcg() * n)];
  while (centroidIdx.length < k) {
    const dists = vectors.map((v) =>
      Math.min(...centroidIdx.map((ci) => dist(v, vectors[ci], metric) ** 2))
    );
    const total = dists.reduce((a, b) => a + b, 0);
    let r = lcg() * total;
    for (let i = 0; i < n; i++) {
      r -= dists[i];
      if (r <= 0) { centroidIdx.push(i); break; }
    }
    if (centroidIdx.length < k) centroidIdx.push(Math.floor(lcg() * n));
  }

  let centroids = centroidIdx.map((i) => [...vectors[i]]);
  let labels    = new Array(n).fill(0);

  for (let iter = 0; iter < maxIter; iter++) {
    // Assign
    const newLabels = vectors.map((v) => {
      let best = 0, bestD = Infinity;
      for (let c = 0; c < k; c++) {
        const d = dist(v, centroids[c], metric);
        if (d < bestD) { bestD = d; best = c; }
      }
      return best;
    });

    if (newLabels.every((l, i) => l === labels[i])) break;
    labels = newLabels;

    // Update centroids
    centroids = Array.from({ length: k }, (_, c) => {
      const members = vectors.filter((_, i) => labels[i] === c);
      if (!members.length) return centroids[c];
      return Array.from({ length: dim }, (__, d) =>
        members.reduce((s, v) => s + v[d], 0) / members.length
      );
    });
  }

  return labels;
}

// ── DBSCAN ────────────────────────────────────────────────────────────────────

export function dbscan(vectors, eps, minPts, opts = {}) {
  const { metric = 'euclidean' } = opts;
  const n      = vectors.length;
  const labels = new Array(n).fill(-1); // -1 = noise
  const visited = new Uint8Array(n);
  let cluster   = 0;

  function neighbours(idx) {
    const nb = [];
    for (let i = 0; i < n; i++) {
      if (dist(vectors[idx], vectors[i], metric) <= eps) nb.push(i);
    }
    return nb;
  }

  for (let i = 0; i < n; i++) {
    if (visited[i]) continue;
    visited[i] = 1;
    const nb = neighbours(i);
    if (nb.length < minPts) continue; // noise for now

    labels[i] = cluster;
    const queue = nb.filter((j) => j !== i);

    while (queue.length) {
      const j = queue.shift();
      if (!visited[j]) {
        visited[j] = 1;
        const nb2 = neighbours(j);
        if (nb2.length >= minPts) {
          for (const jj of nb2) {
            if (!queue.includes(jj) && !visited[jj]) queue.push(jj);
          }
        }
      }
      if (labels[j] === -1) labels[j] = cluster;
    }
    cluster++;
  }

  return labels;
}

// ── Self-Organising Map (SOM) ─────────────────────────────────────────────────

export function trainSOM(vectors, opts = {}) {
  const {
    gridX    = 6,
    gridY    = 6,
    epochs   = 100,
    lrInit   = 0.5,   // initial learning rate
    lrFinal  = 0.01,
    sigInit  = 3.0,   // initial neighbourhood radius
    sigFinal = 0.5,
  } = opts;

  if (!vectors.length) throw new Error('No vectors to train SOM');
  const dim = vectors[0].length;
  const nNodes = gridX * gridY;

  // Init weights — random sample from input vectors
  const weights = Array.from({ length: nNodes }, (_, i) => {
    const src = vectors[i % vectors.length];
    return src.map((x) => x + (Math.random() - 0.5) * 0.01);
  });

  const totalSteps = epochs * vectors.length;
  let step = 0;

  for (let e = 0; e < epochs; e++) {
    // Shuffle
    const order = [...Array(vectors.length).keys()].sort(() => Math.random() - 0.5);

    for (const vi of order) {
      const t   = step / totalSteps;
      const lr  = lrInit  * Math.pow(lrFinal  / lrInit,  t);
      const sig = sigInit * Math.pow(sigFinal / sigInit, t);
      const v   = vectors[vi];

      // Find BMU (best matching unit)
      let bmu = 0, bmuDist = Infinity;
      for (let n = 0; n < nNodes; n++) {
        const d = euclidean(v, weights[n]);
        if (d < bmuDist) { bmuDist = d; bmu = n; }
      }

      const bmuX = bmu % gridX;
      const bmuY = Math.floor(bmu / gridX);

      // Update neighbourhood
      for (let n = 0; n < nNodes; n++) {
        const nx   = n % gridX;
        const ny   = Math.floor(n / gridX);
        const gridDist2 = (nx - bmuX) ** 2 + (ny - bmuY) ** 2;
        const h    = Math.exp(-gridDist2 / (2 * sig ** 2));
        for (let d = 0; d < dim; d++) {
          weights[n][d] += lr * h * (v[d] - weights[n][d]);
        }
      }
      step++;
    }
  }

  return { type: 'som', gridX, gridY, dim, weights };
}

export function predictSOM(model, vector) {
  const v = Array.from(vector);
  let bmu = 0, bmuDist = Infinity;

  for (let n = 0; n < model.weights.length; n++) {
    const d = euclidean(v, model.weights[n]);
    if (d < bmuDist) { bmuDist = d; bmu = n; }
  }

  return {
    label:    bmu,
    bmuX:     bmu % model.gridX,
    bmuY:     Math.floor(bmu / model.gridX),
    distance: bmuDist,
    nodeIdx:  bmu,
  };
}

// Assign cluster labels via SOM — group similar BMUs into clusters using k-Means on grid coords
export function somClusterLabels(model, vectors, k) {
  const bmus = vectors.map((v) => {
    const { bmuX, bmuY } = predictSOM(model, v);
    return [bmuX, bmuY];
  });
  return kMeans(bmus, k, { metric: 'euclidean' });
}

// ── Cluster quality metrics ───────────────────────────────────────────────────

export function clusterStats(vectors, labels) {
  if (!vectors.length || !labels.length) return null;

  const clusterIds = [...new Set(labels.filter((l) => l !== -1))];
  const nClusters  = clusterIds.length;
  const nNoise     = labels.filter((l) => l === -1).length;

  // Inertia (within-cluster sum of squared distances to centroid)
  const centroids = {};
  for (const c of clusterIds) {
    const members = vectors.filter((_, i) => labels[i] === c);
    const dim     = vectors[0].length;
    centroids[c]  = Array.from({ length: dim }, (__, d) =>
      members.reduce((s, v) => s + v[d], 0) / members.length
    );
  }
  const inertia = vectors.reduce((s, v, i) => {
    if (labels[i] === -1) return s;
    return s + euclidean(v, centroids[labels[i]]) ** 2;
  }, 0);

  // Silhouette score (mean over non-noise points)
  let silhouette = 0;
  const nonNoise = vectors.filter((_, i) => labels[i] !== -1);
  if (nonNoise.length > 1 && nClusters > 1) {
    const sil = vectors.map((v, i) => {
      if (labels[i] === -1) return 0;
      const sameCluster  = vectors.filter((_, j) => labels[j] === labels[i] && j !== i);
      const otherClusters = clusterIds.filter((c) => c !== labels[i]);
      if (!sameCluster.length) return 0;

      const a = sameCluster.reduce((s, u) => s + euclidean(v, u), 0) / sameCluster.length;
      const b = Math.min(...otherClusters.map((c) => {
        const members = vectors.filter((_, j) => labels[j] === c);
        return members.reduce((s, u) => s + euclidean(v, u), 0) / members.length;
      }));
      return (b - a) / Math.max(a, b);
    });
    silhouette = sil.reduce((s, x) => s + x, 0) / sil.length;
  }

  return { nClusters, nNoise, inertia, silhouette: parseFloat(silhouette.toFixed(3)) };
}
