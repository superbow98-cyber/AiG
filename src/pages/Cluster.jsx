// AiG — Cluster.jsx
// Anomaly clustering — group detected objects by GPR signature similarity.
// Runs K-Means, DBSCAN, or SOM in-browser on 18-dim feature vectors,
// projected to 2D via PCA for the scatter plot.
//
// Reads:  location.state { matrix, metadata, velocity, filename, scanId, detections }
//         detections = ClassificationResults from Classify.jsx (or raw from Detect.jsx)
// Passes: location.state + detections (with clusterLabel added) → /results
//
// Consumed by: App.jsx (route /cluster)

import { useState, useCallback, useMemo } from 'react';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import { kMeans, dbscan, trainSOM, somClusterLabels, clusterStats } from '../models/clusterModels';
import ObjectMap from '../components/ObjectMap';
import StatusBar from '../components/StatusBar';

// ── Colour palette ────────────────────────────────────────────────────────────
const CLUSTER_COLORS = [
  '#34d399','#f87171','#fbbf24','#a78bfa',
  '#38bdf8','#fb923c','#e879f9','#4ade80',
  '#f472b6','#60a5fa',
];
const NOISE_COLOR = '#475569';

function clusterColor(label) {
  if (label === -1 || label == null) return NOISE_COLOR;
  return CLUSTER_COLORS[label % CLUSTER_COLORS.length];
}

// ── PCA 2D projection ─────────────────────────────────────────────────────────
function pca2D(vectors) {
  if (!vectors.length) return [];
  const dim = vectors[0].length;
  const n   = vectors.length;

  const mean = new Float64Array(dim);
  for (const v of vectors) for (let d = 0; d < dim; d++) mean[d] += v[d] / n;
  const centred = vectors.map((v) => v.map((x, d) => x - mean[d]));

  function powerIter(data, exclude = null) {
    let vec = new Array(dim).fill(0).map((_, i) => (i === 0 ? 1 : Math.random() * 0.01));
    for (let iter = 0; iter < 50; iter++) {
      let next = new Array(dim).fill(0);
      for (const row of data) {
        let dot = row.reduce((s, x, i) => s + x * vec[i], 0);
        if (exclude) dot -= exclude.reduce((s, x, i) => s + x * vec[i], 0)
                              * exclude.reduce((s, x, i) => s + x * row[i], 0);
        for (let i = 0; i < dim; i++) next[i] += row[i] * dot;
      }
      const norm = Math.sqrt(next.reduce((s, x) => s + x * x, 0)) || 1;
      vec = next.map((x) => x / norm);
    }
    return vec;
  }

  const pc1 = powerIter(centred);
  const pc2 = powerIter(centred, pc1);

  return centred.map((v) => ({
    x: v.reduce((s, x, i) => s + x * pc1[i], 0),
    y: v.reduce((s, x, i) => s + x * pc2[i], 0),
  }));
}

// ── Scatter plot ──────────────────────────────────────────────────────────────
const PAD = 24;

function ScatterPlot({ points, labels, detections, width = 700, height = 320 }) {
  if (!points.length) return null;

  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const xMin = Math.min(...xs), xMax = Math.max(...xs);
  const yMin = Math.min(...ys), yMax = Math.max(...ys);
  const xRange = xMax - xMin || 1;
  const yRange = yMax - yMin || 1;

  const toSvgX = (x) => PAD + ((x - xMin) / xRange) * (width  - PAD * 2);
  const toSvgY = (y) => PAD + ((y - yMin) / yRange) * (height - PAD * 2);

  return (
    <svg width={width} height={height} className="w-full" viewBox={`0 0 ${width} ${height}`}>
      <line x1={PAD} y1={height - PAD} x2={width - PAD} y2={height - PAD}
            stroke="#374151" strokeWidth={1} />
      <line x1={PAD} y1={PAD} x2={PAD} y2={height - PAD}
            stroke="#374151" strokeWidth={1} />
      <text x={width / 2} y={height - 4} textAnchor="middle"
            fontSize={9} fill="#6b7280" fontFamily="monospace">PC1</text>
      <text x={8} y={height / 2} textAnchor="middle" fontSize={9}
            fill="#6b7280" fontFamily="monospace"
            transform={`rotate(-90, 8, ${height / 2})`}>PC2</text>

      {points.map((p, i) => {
        const color = clusterColor(labels[i]);
        const det   = detections[i];
        return (
          <g key={i}>
            <circle
              cx={toSvgX(p.x)} cy={toSvgY(p.y)} r={5}
              fill={color} fillOpacity={0.8} stroke={color} strokeWidth={1}
            >
              <title>
                {`Object ${i + 1} — cluster ${labels[i] === -1 ? 'noise' : labels[i]}\n`}
                {det ? `${det.position_m?.toFixed(2)}m · ${det.depth_m?.toFixed(2)}m deep` : ''}
              </title>
            </circle>
            <text
              x={toSvgX(p.x)} y={toSvgY(p.y) - 7}
              textAnchor="middle" fontSize={8}
              fill={color} fontFamily="monospace"
            >
              {i + 1}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

const DEFAULT_OPTS = { k: 3, eps: 2.0, minPts: 2, somK: 3 };

export default function Cluster() {
  const location = useLocation();
  const navigate = useNavigate();
  const state    = location.state;

  const detections  = state?.detections ?? [];
  const velocity    = state?.velocity   ?? 0.1;
  const filename    = state?.filename   ?? 'scan';
  const dx_m        = state?.metadata?.dx_m ?? 0.02;
  const scanLengthM = (state?.metadata?.traces ?? 0) * dx_m;

  const [algorithm, setAlgorithm] = useState('kmeans');
  const [opts,      setOpts]      = useState(DEFAULT_OPTS);
  const [labels,    setLabels]    = useState([]);
  const [stats,     setStats]     = useState(null);
  const [running,   setRunning]   = useState(false);
  const [error,     setError]     = useState(null);

  const setOpt = (k, v) => setOpts((o) => ({ ...o, [k]: v }));

  // ── Feature vectors ────────────────────────────────────────────────────────
  const vectors = useMemo(() =>
    detections.map((d) => Array.from(d.features ?? [])).filter((v) => v.length > 0),
    [detections]
  );

  // ── PCA projection ─────────────────────────────────────────────────────────
  const projected = useMemo(() =>
    vectors.length >= 2 ? pca2D(vectors) : [],
    [vectors]
  );

  // ── Run clustering ─────────────────────────────────────────────────────────
  const runClustering = useCallback(async () => {
    if (!vectors.length) return;
    setRunning(true);
    setError(null);
    setStats(null);
    await new Promise((r) => setTimeout(r, 0));
    try {
      let newLabels;

      if (algorithm === 'kmeans') {
        const k = Math.min(opts.k, vectors.length);
        newLabels = kMeans(vectors, k);
      } else if (algorithm === 'dbscan') {
        newLabels = dbscan(vectors, opts.eps, opts.minPts);
      } else if (algorithm === 'som') {
        const somModel = trainSOM(vectors, { gridX: 5, gridY: 5, epochs: 80 });
        newLabels = somClusterLabels(somModel, vectors, Math.min(opts.somK, vectors.length));
      }

      setLabels(newLabels);
      setStats(clusterStats(vectors, newLabels));
    } catch (e) {
      setError(e.message ?? 'Clustering failed');
    } finally {
      setRunning(false);
    }
  }, [vectors, algorithm, opts]);

  // ── Labelled detections for ObjectMap ─────────────────────────────────────
  const labelledDetections = useMemo(() =>
    detections.map((d, i) => ({
      ...d,
      material: labels[i] != null && labels[i] !== -1
        ? `cluster-${labels[i]}`
        : (labels[i] === -1 ? 'noise' : (d.material ?? d.label ?? 'unknown')),
      label: labels[i] != null && labels[i] !== -1
        ? `cluster-${labels[i]}`
        : (labels[i] === -1 ? 'noise' : (d.material ?? d.label ?? 'unknown')),
    })),
    [detections, labels]
  );

  // ── Cluster summary ────────────────────────────────────────────────────────
  const clusterSummary = useMemo(() => {
    if (!labels.length) return [];
    const map = {};
    labels.forEach((l, i) => {
      const key = l === -1 ? 'noise' : `Cluster ${l}`;
      if (!map[key]) map[key] = { count: 0, label: l, indices: [] };
      map[key].count++;
      map[key].indices.push(i);
    });
    return Object.entries(map).sort((a, b) => {
      if (a[1].label === -1) return 1;
      if (b[1].label === -1) return -1;
      return a[1].label - b[1].label;
    });
  }, [labels]);

  const goResults = () => navigate('/results', {
    state: { ...state, detections: labelledDetections },
  });

  // ── Guard ──────────────────────────────────────────────────────────────────
  if (!detections.length) {
    return (
      <div className="p-8 text-center space-y-3">
        <p className="text-stone-500">No detections to cluster.</p>
        <Link to="/detect" className="text-[#C9971A] hover:underline text-sm">
          ← Back to Detect
        </Link>
      </div>
    );
  }

  const nClusters = labels.length ? new Set(labels.filter((l) => l !== -1)).size : 0;
  const nNoise    = labels.filter((l) => l === -1).length;

  return (
    <div className="p-6 space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-stone-800">Cluster Analysis</h1>
          <p className="text-sm text-stone-500 mt-0.5">
            {filename} · {detections.length} objects · {vectors.length} with feature vectors
          </p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={runClustering}
            disabled={running || !vectors.length}
            className="px-4 py-2 bg-[#C9971A] hover:bg-[#a87d12] disabled:bg-stone-200
                       text-white text-sm font-semibold rounded-lg transition-colors"
          >
            {running ? 'Clustering…' : 'Run Clustering'}
          </button>
          {labels.length > 0 && (
            <button
              onClick={goResults}
              className="px-4 py-2 bg-violet-600 hover:bg-violet-500
                         text-white text-sm font-semibold rounded-lg transition-colors"
            >
              View Results →
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3
                        text-red-700 text-sm">{error}</div>
      )}

      {/* Algorithm + options */}
      <div className="bg-white border border-[#F0E9B8] rounded-xl px-5 py-4 space-y-4">

        {/* Algorithm toggle */}
        <div className="flex gap-2">
          {[
            { value: 'kmeans', label: 'K-Means' },
            { value: 'dbscan', label: 'DBSCAN'  },
            { value: 'som',    label: 'SOM'      },
          ].map((a) => (
            <button
              key={a.value}
              onClick={() => setAlgorithm(a.value)}
              className={`px-4 py-1.5 text-sm font-semibold rounded-lg transition-colors
                ${algorithm === a.value
                  ? 'bg-[#C9971A] text-white'
                  : 'bg-[#F7F3D0] text-stone-500 hover:text-stone-900'}`}
            >
              {a.label}
            </button>
          ))}
        </div>

        {/* K-Means options */}
        {algorithm === 'kmeans' && (
          <div>
            <label className="text-xs text-stone-500 block mb-1">
              Clusters (k): <span className="text-stone-800 font-mono">{opts.k}</span>
            </label>
            <input
              type="range" min={2} max={Math.min(10, detections.length)} step={1}
              value={opts.k}
              onChange={(e) => setOpt('k', Number(e.target.value))}
              className="w-64 accent-[#C9971A]"
            />
          </div>
        )}

        {/* DBSCAN options */}
        {algorithm === 'dbscan' && (
          <div className="grid grid-cols-2 gap-6">
            <div>
              <label className="text-xs text-stone-500 block mb-1">
                Epsilon (ε): <span className="text-stone-800 font-mono">{opts.eps.toFixed(1)}</span>
              </label>
              <input
                type="range" min={0.5} max={10} step={0.5}
                value={opts.eps}
                onChange={(e) => setOpt('eps', Number(e.target.value))}
                className="w-full accent-[#C9971A]"
              />
            </div>
            <div>
              <label className="text-xs text-stone-500 block mb-1">
                Min points: <span className="text-stone-800 font-mono">{opts.minPts}</span>
              </label>
              <input
                type="range" min={1} max={Math.max(1, Math.floor(detections.length / 2))} step={1}
                value={opts.minPts}
                onChange={(e) => setOpt('minPts', Number(e.target.value))}
                className="w-full accent-[#C9971A]"
              />
            </div>
          </div>
        )}

        {/* SOM options */}
        {algorithm === 'som' && (
          <div>
            <label className="text-xs text-stone-500 block mb-1">
              Output clusters (k): <span className="text-stone-800 font-mono">{opts.somK}</span>
            </label>
            <input
              type="range" min={2} max={Math.min(10, detections.length)} step={1}
              value={opts.somK}
              onChange={(e) => setOpt('somK', Number(e.target.value))}
              className="w-64 accent-[#C9971A]"
            />
            <p className="text-xs text-stone-400 mt-1">
              SOM trains a 5×5 grid, then groups nodes into k clusters via K-Means.
            </p>
          </div>
        )}
      </div>

      {/* Stats row */}
      {labels.length > 0 && (
        <div className="grid grid-cols-4 gap-4">
          {[
            { label: 'Clusters found',    value: nClusters },
            { label: 'Noise points',      value: nNoise },
            { label: 'Objects clustered', value: detections.length - nNoise },
            {
              label: 'Silhouette score',
              value: stats?.silhouette != null
                ? stats.silhouette.toFixed(3)
                : '—',
              hint: 'Higher = better separation',
            },
          ].map(({ label, value, hint }) => (
            <div key={label} className="bg-white border border-[#F0E9B8] rounded-xl p-4">
              <p className="text-xs text-stone-400 mb-1">{label}</p>
              <p className="text-2xl font-bold text-[#C9971A] font-mono">{value}</p>
              {hint && <p className="text-xs text-stone-400 mt-0.5">{hint}</p>}
            </div>
          ))}
        </div>
      )}

      {/* PCA scatter plot */}
      <div className="bg-white border border-[#F0E9B8] rounded-xl p-5">
        <h2 className="text-sm font-semibold text-stone-600 mb-4">
          Feature Space (PCA 2D projection)
        </h2>
        {projected.length >= 2 ? (
          <>
            <ScatterPlot
              points={projected}
              labels={labels.length ? labels : new Array(detections.length).fill(null)}
              detections={detections}
            />
            {clusterSummary.length > 0 && (
              <div className="flex flex-wrap gap-3 mt-3">
                {clusterSummary.map(([name, { label: l, count }]) => (
                  <div key={name} className="flex items-center gap-1.5">
                    <span
                      className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                      style={{ backgroundColor: clusterColor(l) }}
                    />
                    <span className="text-xs text-stone-500">{name} ({count})</span>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <p className="text-sm text-stone-400 text-center py-8">
            {vectors.length < 2
              ? 'Need at least 2 objects with feature vectors to project.'
              : 'Run clustering to see projection.'}
          </p>
        )}
      </div>

      {/* Object map */}
      <ObjectMap
        detections={labels.length ? labelledDetections : detections}
        scanLengthM={scanLengthM}
        velocity={velocity}
      />

      {/* Cluster breakdown table */}
      {clusterSummary.length > 0 && (
        <div className="bg-white border border-[#F0E9B8] rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-[#F0E9B8]">
            <h2 className="text-sm font-semibold text-stone-600">Cluster Summary</h2>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-[#FDFBF0] text-stone-500 text-xs uppercase tracking-wide">
              <tr>
                {['Cluster', 'Objects', 'Avg Depth', 'Avg Position'].map((h) => (
                  <th key={h} className="px-4 py-3 text-left">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F0E9B8]">
              {clusterSummary.map(([name, { label: l, indices }]) => {
                const members  = indices.map((i) => detections[i]);
                const avgDepth = members.reduce((s, d) => s + (d.depth_m     ?? 0), 0) / members.length;
                const avgPos   = members.reduce((s, d) => s + (d.position_m  ?? 0), 0) / members.length;
                return (
                  <tr key={name} className="hover:bg-[#FDFBF0] transition-colors">
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full"
                              style={{ backgroundColor: clusterColor(l) }} />
                        <span className="text-stone-800 font-medium">{name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-2 text-stone-600 font-mono">{indices.length}</td>
                    <td className="px-4 py-2 text-stone-600 font-mono">{avgDepth.toFixed(2)}m</td>
                    <td className="px-4 py-2 text-stone-600 font-mono">{avgPos.toFixed(2)}m</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
