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
import { getSpatialEmbedding, getDefaultResNet18 } from '../models/resnet18';
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
    </div>
  );
}
