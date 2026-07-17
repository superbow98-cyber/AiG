// AiG — FusionEngine.jsx
// AI Research Lab · Fusion Workspace (PhD thesis novelty)
// 128-D ResNet spatial embedding ⊕ 32-D XRF chemical embedding → 160-D →
// late fusion → material prediction (Metal / Ceramic / Lithic / Soil), with
// a GPR-only vs XRF-only vs Fusion comparison panel.
//
// Reads: location.state.resnetEmbedding / .xrfEmbedding, if navigated here
//        from ResNetSpatial.jsx and/or XRFWorkspace.jsx. Missing halves can
//        still be generated in-place using the same models directly.

import { useState, useMemo, useEffect } from 'react';
import { useLocation, Link } from 'react-router-dom';
import {
  predictMaterial,
  topContributingDimensions,
  getDefaultFusionEngine,
  MATERIAL_CLASSES,
} from '../models/fusionEngine';
import { getSpatialEmbedding, getDefaultResNet18, runResNet18 } from '../models/resnet18';
import { getChemicalEmbedding, getDefaultXRFMLP, XRF_ELEMENTS, XRF_REFERENCE_RANGES } from '../models/xrfMLP';

const MATERIAL_COLORS = {
  metal: '#a8a29e', ceramic: '#c2703d', lithic: '#78716c', soil: '#8b6f3f',
};

function PredictionCard({ title, prediction, subtitle }) {
  if (!prediction) {
    return (
      <div className="bg-white border border-[#F0E9B8] rounded-xl p-4">
        <p className="text-xs font-bold uppercase tracking-wider text-stone-400 mb-2">{title}</p>
        <p className="text-xs text-stone-400">Not available.</p>
      </div>
    );
  }
  return (
    <div className="bg-white border border-[#F0E9B8] rounded-xl p-4 space-y-3">
      <div>
        <p className="text-xs font-bold uppercase tracking-wider text-stone-400">{title}</p>
        {subtitle && <p className="text-[10px] text-stone-400 mt-0.5">{subtitle}</p>}
      </div>
      <div className="flex items-baseline gap-2">
        <span
          className="text-lg font-bold capitalize"
          style={{ color: MATERIAL_COLORS[prediction.label] ?? '#C9971A' }}
        >
          {prediction.label}
        </span>
        <span className="text-sm font-mono text-stone-400">{Math.round(prediction.confidence * 100)}%</span>
      </div>
      <div className="space-y-1.5">
        {MATERIAL_CLASSES.map((c) => (
          <div key={c} className="flex items-center gap-2">
            <span className="text-xs text-stone-500 w-14 capitalize">{c}</span>
            <div className="flex-1 h-1.5 bg-[#F7F3D0] rounded-full overflow-hidden">
              <div
                className="h-full rounded-full"
                style={{ width: `${Math.round((prediction.scores[c] ?? 0) * 100)}%`, background: MATERIAL_COLORS[c] }}
              />
            </div>
            <span className="text-[10px] text-stone-400 font-mono w-8 text-right">
              {Math.round((prediction.scores[c] ?? 0) * 100)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function FusionEngine() {
  const location = useLocation();
  const state = location.state ?? {};

  const [resnetEmbedding, setResnetEmbedding] = useState(state.resnetEmbedding ?? null);
  const [xrfEmbedding, setXrfEmbedding] = useState(state.xrfEmbedding ?? null);
  const [result, setResult] = useState(null);
  const [running, setRunning] = useState(false);
  // If we arrived here via navigation with real inputs already in hand
  // (from ResNet-18 Spatial AI and/or XRF Workspace's "Send to Fusion"),
  // skip the "View Demo" gate entirely — that's what looked like a blank
  // page: real data was loaded into state but the gate screen still showed.
  const [started, setStarted] = useState(
    Boolean(state.resnetEmbedding || state.xrfEmbedding || (state.matrix && state.detection) || state.elements)
  );

  // Fallback: if no ResNet embedding was passed but a detection+matrix was,
  // compute it right here so the page is usable standalone too.
  useEffect(() => {
    if (!resnetEmbedding && state.matrix && state.detection) {
      const out = getSpatialEmbedding(state.matrix, state.detection, { size: 32, model: getDefaultResNet18() });
      setResnetEmbedding(Array.from(out.embedding));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fallback: if no XRF embedding but raw elements were passed, compute here.
  useEffect(() => {
    if (!xrfEmbedding && state.elements) {
      const out = getChemicalEmbedding(state.elements, { model: getDefaultXRFMLP() });
      setXrfEmbedding(Array.from(out.embedding));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fusionModel = useMemo(() => getDefaultFusionEngine(), []);

  // Standalone demo helper: lets a visitor try the Fusion Engine directly,
  // without first running Detect → ResNet-18 Spatial AI and XRF Workspace.
  // Builds a synthetic 32×32 patch (radial ripple, not real GPR data) through
  // the real ResNet-18 forward pass, and typical-range XRF elements through
  // the real XRF MLP — same honesty convention as elsewhere in §7: real
  // forward pass, clearly-labelled synthetic/demo input.
  function generateSampleEmbeddings() {
    const size = 32;
    const patch = new Float32Array(size * size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = (x - size / 2) / size;
        const dy = (y - size / 2) / size;
        const r = Math.sqrt(dx * dx + dy * dy);
        patch[y * size + x] = Math.sin(6 * r) * Math.exp(-3 * r * r);
      }
    }
    const resnetOut = runResNet18(getDefaultResNet18(), patch, size);
    setResnetEmbedding(Array.from(resnetOut.embedding));

    const sampleElements = XRF_ELEMENTS.reduce((acc, el) => {
      const { typical } = XRF_REFERENCE_RANGES[el];
      acc[el] = Number(((typical[0] + typical[1]) / 2).toFixed(2));
      return acc;
    }, {});
    const xrfOut = getChemicalEmbedding(sampleElements, { model: getDefaultXRFMLP() });
    setXrfEmbedding(Array.from(xrfOut.embedding));
  }

  function runFusion() {
    if (!resnetEmbedding || !xrfEmbedding) return;
    setRunning(true);
    setTimeout(() => {
      const out = predictMaterial(
        new Float32Array(resnetEmbedding),
        new Float32Array(xrfEmbedding),
        { model: fusionModel }
      );
      const contributions = topContributingDimensions(out.fusedVector, out.fusion.label, { model: fusionModel }, 8);
      setResult({ ...out, contributions });
      setRunning(false);
    }, 0);
  }

  const ready = Boolean(resnetEmbedding && xrfEmbedding);

  return (
    <div className="min-h-full p-6 space-y-6" style={{ background: '#FDFBF0' }}>
      <div>
        <p className="text-xs font-bold uppercase tracking-wider mb-1" style={{ color: '#C9971A' }}>
          AI Research Lab
        </p>
        <h1 className="text-2xl font-bold text-stone-800">Fusion Engine</h1>
        <p className="text-stone-500 text-sm mt-1">
          128-D ResNet ⊕ 32-D XRF → 160-D → late fusion → material prediction
        </p>
      </div>

      <div className="rounded-xl border p-3 text-xs" style={{ borderColor: '#E8DFA0', background: '#F7F3D0', color: '#92692A' }}>
        <strong>Architecture demo — untrained weights.</strong> Fusion, GPR-only and XRF-only heads
        are real linear+softmax classifiers over the real embeddings, but none are trained on
        validated material ground truth yet. Predictions below are illustrative of the pipeline
        shape, not yet reliable material calls — see <code>fusionEngine.train()</code> for the
        intended training entry point once labelled records exist.
      </div>

      {!started ? (
        <div className="bg-white border border-[#F0E9B8] rounded-xl p-10 flex flex-col items-center text-center gap-4">
          <p className="text-sm text-stone-500 max-w-md">
            This workspace combines a 128-D ResNet spatial embedding with a 32-D XRF chemical
            embedding into a 160-D fused prediction. Nothing runs until you're ready.
          </p>
          <button
            onClick={() => setStarted(true)}
            className="px-5 py-2.5 rounded-xl text-sm font-medium text-white transition-colors"
            style={{ background: '#C9971A' }}
          >
            View Demo
          </button>
        </div>
      ) : (
      <>
      {/* Inputs status */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white border border-[#F0E9B8] rounded-xl p-4">
          <p className="text-xs font-bold uppercase tracking-wider text-stone-400 mb-2">128-D ResNet embedding</p>
          {resnetEmbedding ? (
            <p className="text-xs text-stone-600">✓ loaded ({resnetEmbedding.length} dims)</p>
          ) : (
            <p className="text-xs text-stone-400">
              Not loaded. <Link to="/detect" className="underline" style={{ color: '#C9971A' }}>Run detection</Link> then open a detection in{' '}
              <Link to="/resnet-spatial" className="underline" style={{ color: '#C9971A' }}>ResNet-18 Spatial AI</Link>.
            </p>
          )}
        </div>
        <div className="bg-white border border-[#F0E9B8] rounded-xl p-4">
          <p className="text-xs font-bold uppercase tracking-wider text-stone-400 mb-2">32-D XRF embedding</p>
          {xrfEmbedding ? (
            <p className="text-xs text-stone-600">✓ loaded ({xrfEmbedding.length} dims)</p>
          ) : (
            <p className="text-xs text-stone-400">
              Not loaded. Enter elements in the{' '}
              <Link to="/xrf-workspace" className="underline" style={{ color: '#C9971A' }}>XRF AI Workspace</Link>.
            </p>
          )}
        </div>
      </div>

      {!ready && (
        <button
          onClick={generateSampleEmbeddings}
          className="px-4 py-2 rounded-xl text-sm font-medium border transition-colors"
          style={{ borderColor: '#E8DFA0', color: '#92692A', background: '#F7F3D0' }}
        >
          Generate Sample Embeddings (try standalone)
        </button>
      )}

      <button
        onClick={runFusion}
        disabled={!ready || running}
        className="px-5 py-2.5 rounded-xl text-sm font-medium text-white transition-colors disabled:opacity-40"
        style={{ background: '#C9971A' }}
      >
        {running ? 'Running fusion…' : 'Run Fusion Prediction'}
      </button>

      {result && (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <PredictionCard title="GPR only" subtitle="128-D ResNet embedding → 4-class head" prediction={result.gprOnly} />
            <PredictionCard title="XRF only" subtitle="32-D XRF embedding → 4-class head" prediction={result.xrfOnly} />
            <PredictionCard title="Fusion" subtitle="160-D combined → 4-class head" prediction={result.fusion} />
          </div>

          <div className="bg-white border border-[#F0E9B8] rounded-xl p-4">
            <p className="text-xs font-bold uppercase tracking-wider text-stone-400 mb-3">
              Top contributing dimensions to "{result.fusion.label}" prediction
            </p>
            <div className="space-y-1.5">
              {result.contributions.map((c, i) => {
                const max = Math.max(...result.contributions.map((x) => Math.abs(x.contribution)));
                const pct = Math.round((Math.abs(c.contribution) / Math.max(1e-6, max)) * 100);
                return (
                  <div key={i} className="flex items-center gap-2">
                    <span className="text-xs text-stone-500 w-28 font-mono">
                      {c.source}[{c.sourceIndex}]
                    </span>
                    <div className="flex-1 h-1.5 bg-[#F7F3D0] rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${pct}%`,
                          background: c.contribution >= 0 ? '#C9971A' : '#b45252',
                        }}
                      />
                    </div>
                    <span className="text-[10px] text-stone-400 font-mono w-14 text-right">
                      {c.contribution.toFixed(4)}
                    </span>
                  </div>
                );
              })}
            </div>
            <p className="text-[10px] text-stone-400 mt-2">
              A lightweight stand-in for full Grad-CAM/SHAP — planned under the Explainable AI module.
            </p>
          </div>
        </>
      )}
      </>
      )}
    </div>
  );
}
