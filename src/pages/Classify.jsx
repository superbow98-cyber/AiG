// AiG — Classify.jsx
// Material classification page — k-NN DB match + SVM/NaiveBayes ensemble
// for each detected object from Detect.jsx.
//
// Pipeline per object:
//   1. knnSearch(features, dbRecords, k=5) → top-5 DB matches
//   2. predictMaterial(matches)            → majority-vote label + confidence
//   3. predictClassifier(svmModel, vec)    → SVM/NB/LogReg label + confidence
//   4. Ensemble: average confidence, pick highest
//   5. Build ClassificationResult → pass to /results
//
// Reads:  location.state { matrix, metadata, velocity, filename, scanId, detections }
// Passes: location.state + classifiedDetections → /results
//
// Consumed by: App.jsx (route /classify)

import { useState, useEffect, useCallback } from 'react';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { knnSearch, predictMaterial, predictElements, MIN_SAMPLES_PER_CLASS } from '../models/knn';
import { trainClassifier, predictClassifier } from '../models/svmModel';
import ConfidenceBar   from '../components/ConfidenceBar';
import ResultCard      from '../components/ResultCard';
import ObjectMap       from '../components/ObjectMap';
import StatusBar       from '../components/StatusBar';
// §41 — Classify was the only stage in the pipeline (Detect, Detection Lab,
// Results all do this) that never rendered the actual B-scan. It only showed
// ObjectMap (an abstract top-down dot map) + text cards, so there was no way
// to see WHERE on the real radargram image a material label came from. These
// three are the exact same trio Detect.jsx uses to render B-scan + boxes.
import BScanViewer      from '../components/BScanViewer';
import DepthScale       from '../components/DepthScale';
import HyperbolaOverlay from '../components/HyperbolaOverlay';
import useResponsiveScanHeight from '../hooks/useResponsiveScanHeight';
import { getMatrixRange } from '../utils/colormap';

// ── Material colour map (shared with HyperbolaOverlay) ───────────────────────
const MATERIAL_COLORS = {
  ceramic: '#34d399', metal: '#f87171', bone: '#fbbf24',
  stone: '#a78bfa',   void: '#38bdf8',  unknown: '#94a3b8',
};
function matColor(label) {
  return MATERIAL_COLORS[label?.toLowerCase()] ?? MATERIAL_COLORS.unknown;
}

// ── Classifier options ────────────────────────────────────────────────────────
const CLASSIFIER_OPTS = [
  { value: 'knn',              label: 'k-NN only (DB match)' },
  { value: 'naiveBayes',       label: 'Naïve Bayes' },
  { value: 'logisticRegression', label: 'Logistic Regression' },
  { value: 'svm',              label: 'SVM (linear)' },
  { value: 'decisionTree',     label: 'Decision Tree' },
  { value: 'ensemble',         label: 'Ensemble (k-NN + NB)' },
];

// ── Ensemble: average k-NN + NB confidence scores ────────────────────────────
function ensemblePredict(knnResult, nbResult) {
  const allMats = new Set([
    ...Object.keys(knnResult.votes ?? {}),
    ...Object.keys(nbResult.scores ?? {}),
  ]);
  const combined = {};
  for (const m of allMats) {
    combined[m] = ((knnResult.votes?.[m] ?? 0) + (nbResult.scores?.[m] ?? 0)) / 2;
  }
  const label = Object.entries(combined).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'unknown';
  const total = Object.values(combined).reduce((s, v) => s + v, 0) || 1;
  return { label, confidence: (combined[label] / total), scores: combined };
}

// ── Main component ────────────────────────────────────────────────────────────
export default function Classify() {
  const location = useLocation();
  const navigate = useNavigate();
  const state     = location.state;

  const detections = state?.detections ?? [];
  const matrix     = state?.matrix     ?? null;
  const metadata   = state?.metadata   ?? null;
  const velocity   = state?.velocity   ?? 0.1;
  const filename   = state?.filename   ?? 'scan';
  const dx_m       = metadata?.dx_m    ?? 0.02;
  const scanLengthM = (metadata?.traces ?? 0) * dx_m;

  const [dbRecords,     setDbRecords]     = useState([]);
  const [dbLoading,     setDbLoading]     = useState(false);
  const [dbError,       setDbError]       = useState(null);
  const [classifier,    setClassifier]    = useState('ensemble');
  const [k,             setK]             = useState(5);
  const [running,       setRunning]       = useState(false);
  const [progress,      setProgress]      = useState(0);
  const [statusMsg,     setStatusMsg]     = useState('');
  const [results,       setResults]       = useState([]);
  const [error,         setError]         = useState(null);
  const [expandedId,    setExpandedId]    = useState(null);

  // ── B-scan view state (§41 — same pattern as Detect.jsx) ──────────────────
  const scanHeight = useResponsiveScanHeight(480);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [panOffset,  setPanOffset]  = useState({ x: 0, y: 0 });
  const [zoom,       setZoom]       = useState(1);
  const [colormap]   = useState('grey'); // grayscale-only — standard GPR B-scan display
  const [hoverInfo,  setHoverInfo]  = useState(null);
  const samples = metadata?.samples ?? matrix?.length ?? 0;
  const traces  = metadata?.traces  ?? (matrix?.[0]?.length ?? 0);
  const { min: minVal, max: maxVal } = matrix ? getMatrixRange(matrix) : { min: 0, max: 1 };
  // Once classification runs, overlay the CLASSIFIED objects (material label
  // + colour) instead of the plain pre-classification detections, so the
  // B-scan visually answers "which material is where" — the actual thing
  // this page computes but previously never showed on the scan itself.
  const overlayDetections = results.length > 0 ? results : detections;

  // ── Load DB records on mount ──────────────────────────────────────────────
  useEffect(() => {
    async function fetchRecords() {
      setDbLoading(true);
      setDbError(null);
      try {
        const { data, error } = await supabase
          .from('gpr_xrf_records')
          .select('id, material:xrf_material, gpr_signature, hyperbola_shape, xrf_elements, depth_m, size_width_cm, site_id');
        if (error) throw error;
        setDbRecords(data ?? []);
      } catch (e) {
        setDbError(e.message ?? 'Failed to load database records');
      } finally {
        setDbLoading(false);
      }
    }
    fetchRecords();
  }, []);

  // ── Guard ─────────────────────────────────────────────────────────────────
  if (!matrix || !metadata || !detections.length) {
    return (
      <div className="p-8 text-center space-y-3">
        <p className="text-stone-500">No detections to classify.</p>
        <Link to="/detect" className="text-[#C9971A] hover:underline text-sm">
          ← Back to Detect
        </Link>
      </div>
    );
  }

  // ── Run classification ────────────────────────────────────────────────────
  const runClassification = useCallback(async () => {
    setRunning(true);
    setError(null);
    setResults([]);
    setProgress(5);
    setStatusMsg('Preparing feature vectors…');
    await new Promise((r) => setTimeout(r, 0));

    try {
      // Train a lightweight classifier on DB records if we have enough data
      let trainedModel = null;
      if (dbRecords.length >= 3 && classifier !== 'knn') {
        setStatusMsg('Training classifier on DB records…');
        setProgress(15);
        await new Promise((r) => setTimeout(r, 0));
        const trainType = classifier === 'ensemble' ? 'naiveBayes' : classifier;
        const featureVecs = dbRecords
          .filter((r) => r.gpr_signature?.length > 0)
          .map((r) => new Float32Array(r.gpr_signature));
        const labels = dbRecords
          .filter((r) => r.gpr_signature?.length > 0)
          .map((r) => r.material ?? 'unknown');
        if (featureVecs.length >= 2) {
          trainedModel = trainClassifier(trainType, featureVecs, labels);
        }
      }

      const classified = [];
      const total = detections.length;

      for (let i = 0; i < total; i++) {
        const det = detections[i];
        setProgress(20 + Math.round((i / total) * 70));
        setStatusMsg(`Classifying object ${i + 1} of ${total}…`);
        await new Promise((r) => setTimeout(r, 0));

        // k-NN match
        const matches = knnSearch(det.features, dbRecords, k, 'cosine');
        const knnPred = predictMaterial(matches, dbRecords);

        // Classifier predict (if model trained)
        let clsPred = null;
        if (trainedModel) {
          clsPred = predictClassifier(trainedModel, det.features);
        }

        // Final prediction
        let finalLabel, finalConfidence, finalScores;
        if (classifier === 'ensemble' && clsPred) {
          const ens = ensemblePredict(knnPred, clsPred);
          finalLabel      = ens.label;
          finalConfidence = ens.confidence;
          finalScores     = ens.scores;
        } else if (classifier === 'knn' || !clsPred) {
          finalLabel      = knnPred.material;
          finalConfidence = knnPred.confidence;
          finalScores     = knnPred.votes;
        } else {
          finalLabel      = clsPred.label;
          finalConfidence = clsPred.confidence;
          finalScores     = clsPred.scores;
        }

        // Top matches for UI
        const topMatches = matches.slice(0, 3).map((m) => ({
          material:   m.material,
          similarity: m.similarity,
          record_id:  m.record_id,
          site_id:    m.record?.site_id ?? null,
        }));

        // Predicted elemental profile — weighted average across matched neighbours
        // (GPR pattern → likely chemistry). Falls back to best match's raw vector.
        const elemPred = predictElements(matches);
        const xrf_elements =
          elemPred.fromMatches > 0 ? elemPred.elements : (matches[0]?.record?.xrf_elements ?? null);

        // Data-sufficiency check — is the FINAL label (whichever method won:
        // knn / classifier / ensemble) actually backed by enough confirmed DB
        // records to trust, or is this a lucky/thin match? predictMaterial()
        // already computes this internally but only against knnPred's own
        // label; recompute against finalLabel since that's what's shown.
        const classSampleCount = dbRecords.filter((r) => r.xrf_material === finalLabel).length;
        const insufficientData = classSampleCount < MIN_SAMPLES_PER_CLASS;

        classified.push({
          ...det,
          label:       finalLabel,
          material:    finalLabel,
          confidence:  finalConfidence,
          scores:      finalScores,
          top_matches: topMatches,
          xrf_elements,
          db_match_count: matches.length,
          insufficientData,
          classSampleCount,
        });
      }

      setProgress(100);
      setStatusMsg(`Classification complete — ${classified.length} objects classified`);
      setResults(classified);
    } catch (err) {
      setError(err.message ?? 'Classification failed');
    } finally {
      setRunning(false);
    }
  }, [detections, dbRecords, classifier, k]);

  // ── Proceed to results ────────────────────────────────────────────────────
  const goResults = () => {
    navigate('/results', {
      state: { ...state, detections: results },
    });
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="p-6 space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-stone-800">Material Classification</h1>
          <p className="text-sm text-stone-500 mt-0.5">
            {filename} · {detections.length} object{detections.length !== 1 ? 's' : ''} to classify
          </p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={runClassification}
            disabled={running || dbLoading}
            className="px-4 py-2 bg-[#C9971A] hover:bg-[#a87d12] disabled:bg-stone-200
                       text-white text-sm font-semibold rounded-lg transition-colors"
          >
            {running ? 'Classifying…' : 'Run Classification'}
          </button>
          {results.length > 0 && (
            <button
              onClick={goResults}
              className="px-4 py-2 bg-violet-600 hover:bg-violet-500
                         text-white text-sm font-semibold rounded-lg transition-colors"
            >
              View Results →
            </button>
          )}
          {results.length > 0 && (
            <Link
              to="/cluster"
              state={{ ...state, detections: results }}
              className="px-4 py-2 bg-white border border-[#E8DFA0] text-stone-600 hover:text-stone-900
                         text-sm font-semibold rounded-lg transition-colors flex items-center"
              title="Optional — group these classified objects by GPR signature similarity, a separate (unsupervised) analysis from classification"
            >
              Also try Cluster analysis →
            </Link>
          )}
        </div>
      </div>

      {/* Status bar */}
      <StatusBar step={statusMsg} progress={progress} visible={running || progress === 100} />

      {/* B-scan + material overlay (§41) — shows WHERE each classified
          material sits on the real radargram, not just a text card. Boxes
          are unlabeled/neutral (Detect.jsx's raw target/noise) until
          classification runs, then flip to material colour + label the
          moment `results` populates — same box component Detect.jsx and
          DetectionLab.jsx already use, so styling stays consistent across
          every stage of the pipeline. */}
      {matrix && metadata && (
        <div className="bg-white border border-[#F0E9B8] rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-stone-600">
              B-scan{results.length > 0 ? ' — classified by material' : ' (run classification to label)'}
            </span>
            <span className="text-xs text-stone-400 bg-[#F7F3D0] border border-[#E8DFA0] rounded px-2 py-1">
              grayscale · amplitude
            </span>
          </div>

          <div className="relative flex">
            <DepthScale
              samples={samples}
              dt_ns={metadata.dt_ns}
              velocity={velocity}
              height_px={scanHeight}
            />
            <div className="relative flex-1 min-w-0">
              <BScanViewer
                matrix={matrix}
                colormap={colormap}
                minVal={minVal}
                maxVal={maxVal}
                height={scanHeight}
                velocity={velocity}
                dt_ns={metadata.dt_ns}
                onPixelHover={setHoverInfo}
                onViewChange={({ panOffset: po, zoom: z, canvasWidth: cw, canvasHeight: ch }) => {
                  setPanOffset(po);
                  setZoom(z);
                  setCanvasSize({ width: cw, height: ch });
                }}
              />
              <HyperbolaOverlay
                detections={overlayDetections}
                canvasWidth={canvasSize.width}
                canvasHeight={canvasSize.height}
                totalTraces={traces}
                totalSamples={samples}
                panOffset={panOffset}
                zoom={zoom}
              />
            </div>
          </div>

          {hoverInfo && (
            <div className="text-xs text-stone-500 font-mono">
              Trace {hoverInfo.trace} · Sample {hoverInfo.sample} ·
              Depth {hoverInfo.depth_m?.toFixed(3)}m · Amp {hoverInfo.amplitude?.toFixed(1)}
            </div>
          )}
        </div>
      )}

      {/* DB status banner */}
      <div className={`rounded-lg px-4 py-3 text-sm flex items-center gap-3 border
        ${dbError
          ? 'bg-red-50 border-red-200 text-red-700'
          : dbLoading
            ? 'bg-white border-[#F0E9B8] text-stone-500'
            : 'bg-white border-[#F0E9B8] text-stone-600'
        }`}
      >
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
          dbError ? 'bg-red-400' : dbLoading ? 'bg-yellow-400 animate-pulse' : 'bg-[#C9971A]'
        }`} />
        {dbError
          ? `DB error: ${dbError} — k-NN will have no matches`
          : dbLoading
            ? 'Loading reference database…'
            : `Reference DB: ${dbRecords.length} record${dbRecords.length !== 1 ? 's' : ''} loaded`
        }
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-red-700 text-sm">
          {error}
        </div>
      )}

      {/* Options */}
      <div className="bg-white border border-[#F0E9B8] rounded-xl px-5 py-4 grid grid-cols-2 gap-6">
        <div>
          <label className="text-xs text-stone-500 block mb-1">Classifier</label>
          <select
            value={classifier}
            onChange={(e) => setClassifier(e.target.value)}
            className="w-full bg-[#F7F3D0] border border-[#E8DFA0] text-stone-700 rounded-lg px-3 py-2 text-sm"
          >
            {CLASSIFIER_OPTS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs text-stone-500 block mb-1">
            k neighbours: <span className="text-stone-800 font-mono">{k}</span>
          </label>
          <input
            type="range" min={1} max={Math.max(1, dbRecords.length)} step={1}
            value={k}
            onChange={(e) => setK(Number(e.target.value))}
            className="w-full accent-[#C9971A] mt-2"
          />
        </div>
      </div>

      {/* Results — ObjectMap */}
      {results.length > 0 && (
        <ObjectMap
          detections={results}
          scanLengthM={scanLengthM}
          velocity={velocity}
        />
      )}

      {/* Results — cards */}
      {results.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-sm font-semibold text-stone-600">
            Classification Results
          </h2>
          {results.map((res, i) => (
            <div
              key={res.id}
              className="bg-white border border-[#F0E9B8] rounded-xl overflow-hidden"
            >
              {/* Card header */}
              <div className="flex items-center justify-between px-5 py-4">
                <div className="flex items-center gap-3">
                  <span
                    className="w-3 h-3 rounded-full flex-shrink-0"
                    style={{ backgroundColor: matColor(res.material) }}
                  />
                  <div>
                    <p className="text-stone-800 font-semibold text-sm">
                      Object {i + 1}
                      {res.material && res.material !== 'unknown' && (
                        <span
                          className="ml-2 text-xs font-bold px-2 py-0.5 rounded-full capitalize"
                          style={{
                            backgroundColor: matColor(res.material) + '33',
                            color: matColor(res.material),
                          }}
                        >
                          {res.material}
                        </span>
                      )}
                    </p>
                    <p className="text-stone-500 text-xs mt-0.5">
                      {res.position_m.toFixed(2)}m along survey · {res.depth_m.toFixed(2)}m deep
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setExpandedId(expandedId === res.id ? null : res.id)}
                  className="text-xs text-stone-500 hover:text-stone-900 transition-colors"
                >
                  {expandedId === res.id ? 'Less ▲' : 'Details ▼'}
                </button>
              </div>

              {/* Confidence bar */}
              <div className="px-5 pb-4">
                <ConfidenceBar
                  label={res.material ?? 'unknown'}
                  confidence={res.confidence ?? 0}
                  color={matColor(res.material)}
                />
              </div>

              {/* Expanded details */}
              {expandedId === res.id && (
                <div className="border-t border-[#F0E9B8] px-5 py-4 space-y-4">

                  {/* Top k-NN matches */}
                  {res.top_matches?.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-stone-500 mb-2">
                        Top DB Matches (k-NN)
                      </p>
                      <div className="space-y-1.5">
                        {res.top_matches.map((m, mi) => (
                          <div key={mi} className="flex items-center gap-3">
                            <span
                              className="w-2 h-2 rounded-full flex-shrink-0"
                              style={{ backgroundColor: matColor(m.material) }}
                            />
                            <span className="text-xs text-stone-600 capitalize w-20">
                              {m.material}
                            </span>
                            <div className="flex-1 h-1.5 bg-[#F7F3D0] rounded-full overflow-hidden">
                              <div
                                className="h-full rounded-full"
                                style={{
                                  width: `${Math.max(0, Math.min(1, m.similarity)) * 100}%`,
                                  backgroundColor: matColor(m.material),
                                }}
                              />
                            </div>
                            <span className="text-xs text-stone-400 font-mono w-10 text-right">
                              {(m.similarity * 100).toFixed(0)}%
                            </span>
                            {m.site_id && (
                              <span className="text-xs text-stone-400 font-mono">
                                {m.site_id}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Score breakdown */}
                  {res.scores && Object.keys(res.scores).length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-stone-500 mb-2">
                        Score Breakdown
                      </p>
                      <div className="space-y-1.5">
                        {Object.entries(res.scores)
                          .sort((a, b) => b[1] - a[1])
                          .map(([mat, score]) => (
                            <div key={mat} className="flex items-center gap-3">
                              <span className="text-xs text-stone-500 capitalize w-20">{mat}</span>
                              <div className="flex-1 h-1.5 bg-[#F7F3D0] rounded-full overflow-hidden">
                                <div
                                  className="h-full rounded-full"
                                  style={{
                                    width: `${Math.min(100, score * 100)}%`,
                                    backgroundColor: matColor(mat),
                                    opacity: 0.7,
                                  }}
                                />
                              </div>
                              <span className="text-xs text-stone-400 font-mono w-10 text-right">
                                {(score * 100).toFixed(1)}%
                              </span>
                            </div>
                          ))}
                      </div>
                    </div>
                  )}

                  {/* XRF elements */}
                  {res.xrf_elements && (
                    <div>
                      <p className="text-xs font-semibold text-stone-500 mb-2">
                        XRF Elements (best DB match)
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {Object.entries(res.xrf_elements)
                          .sort((a, b) => b[1] - a[1])
                          .slice(0, 8)
                          .map(([el, pct]) => (
                            <span
                              key={el}
                              className="text-xs font-mono bg-[#F7F3D0] text-stone-700 px-2 py-1 rounded"
                            >
                              {el}: {typeof pct === 'number' ? pct.toFixed(1) : pct}%
                            </span>
                          ))}
                      </div>
                    </div>
                  )}

                  {/* Object metrics */}
                  <div className="grid grid-cols-3 gap-3">
                    {[
                      { label: 'Size',      value: `${res.size_width_cm}×${res.size_height_cm}cm` },
                      { label: 'DB matches', value: res.db_match_count ?? 0 },
                      { label: 'Amplitude', value: res.amplitude?.toFixed(1) ?? '—' },
                    ].map(({ label, value }) => (
                      <div key={label} className="bg-[#FDFBF0] rounded-lg p-3 text-center">
                        <p className="text-xs text-stone-400 mb-1">{label}</p>
                        <p className="text-sm font-bold text-stone-700 font-mono">{value}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Empty state — no results yet */}
      {results.length === 0 && !running && (
        <div className="text-center py-12 text-stone-400 text-sm">
          {dbRecords.length === 0
            ? 'No reference records in database — k-NN will return "unknown". Add records via Database page after excavation confirms materials.'
            : 'Press "Run Classification" to classify detected objects against the reference database.'
          }
        </div>
      )}

    </div>
  );
}
