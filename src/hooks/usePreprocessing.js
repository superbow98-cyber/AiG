// AiG — usePreprocessing.js
// Manages the preprocessing pipeline applied on top of a raw GPR scan matrix.
// Each step is applied sequentially and recorded in `steps[]` so the user
// can see what has been applied and reset to raw at any time.
//
// Depends on: signalProcessing.js
// Consumed by: Preprocess.jsx, and passed forward to Visualise/Detect via location.state

import { useState, useCallback, useRef } from 'react';
import {
  backgroundRemoval,
  applyGain,
  bandpassFilter,
} from '../utils/signalProcessing';
import { pcaStep } from '../models/pcaModel';
import { icaStep } from '../models/icaModel';
import { autoencoderStep } from '../models/autoencoderModel';

// ── step definitions ──────────────────────────────────────────────────────────
// Each step has a name, a runner function, and default params.
// Preprocess.jsx builds its UI from STEP_DEFS — add new steps here only.
export const STEP_DEFS = {
  backgroundRemoval: {
    label: 'Background Removal',
    description: 'Subtracts mean trace — removes flat horizontal banding (air wave).',
    defaultParams: {},
    run: (matrix, _params) => backgroundRemoval(matrix),
  },
  dewow: {
    label: 'Dewow',
    description: 'Highpass IIR filter per trace — removes low-frequency DC drift.',
    defaultParams: {},
    run: (matrix, _params) => applyGain(matrix, 'dewow'),
  },
  linearGain: {
    label: 'Linear Gain',
    description: 'Multiplies amplitude by a ramp that increases with depth.',
    defaultParams: { factor: 2 },
    run: (matrix, params) => applyGain(matrix, 'linear', params),
  },
  agc: {
    label: 'AGC (Auto Gain Control)',
    description: 'Normalises each depth window to unit RMS — equalises shallow and deep energy.',
    defaultParams: { windowSize: 32 },
    run: (matrix, params) => applyGain(matrix, 'agc', params),
  },
  bandpass: {
    label: 'Bandpass Filter',
    description: 'FIR windowed-sinc bandpass — suppress frequencies outside GPR antenna range.',
    defaultParams: { lowMHz: 200, highMHz: 800 },
    run: (matrix, params, meta) =>
      bandpassFilter(matrix, params.lowMHz, params.highMHz, meta?.dt_ns ?? 0.2),
  },
  pca: {
    label: 'PCA Clutter Removal',
    description: 'Removes top N principal components (coherent clutter). Slow if traces > 1500.',
    defaultParams: { nComponents: 2 },
    run: (matrix, params) => pcaStep(matrix, params),
  },
  ica: {
    label: 'ICA Signal Separation',
    description: 'Separates independent sources — suppresses Gaussian clutter ICs.',
    defaultParams: { nComponents: 3 },
    run: (matrix, params) => icaStep(matrix, params),
  },
  autoencoder: {
    label: 'Autoencoder Clutter Removal',
    description: 'Trains a neural autoencoder on traces; subtracts learnt clutter. Best after Background Removal.',
    defaultParams: { epochs: 40, latentDim: 32, hiddenDim: 128 },
    run: (matrix, params) => autoencoderStep(matrix, params),
  },
};

// ── hook ──────────────────────────────────────────────────────────────────────
/**
 * usePreprocessing(rawMatrix, metadata)
 *
 * Returns:
 *   processedMatrix  — current matrix after all applied steps (or rawMatrix if none)
 *   steps            — [{ name, params, label }] — ordered list of applied steps
 *   applyStep        — (stepName, params?) — append a step and recompute
 *   removeStep       — (index) — remove step at index and recompute from scratch
 *   reset            — () — clear all steps, revert to rawMatrix
 *   processing       — boolean — true while pipeline is running (for StatusBar)
 *   error            — string | null
 */
export function usePreprocessing(rawMatrix, metadata) {
  const [steps, setSteps] = useState([]);           // [{ name, params }]
  const [processedMatrix, setProcessedMatrix] = useState(rawMatrix ?? null);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState(null);

  // Keep rawMatrix ref up to date if parent re-loads a new scan
  const rawRef = useRef(rawMatrix);
  if (rawMatrix !== rawRef.current) {
    rawRef.current = rawMatrix;
    setSteps([]);
    setProcessedMatrix(rawMatrix);
    setError(null);
  }

  // ── pipeline runner ─────────────────────────────────────────────────────
  const runPipeline = useCallback((stepsToRun, raw) => {
    if (!raw) return;
    setProcessing(true);
    setError(null);

    // Run synchronously but yield to browser between steps via setTimeout
    // so StatusBar can update. For very large matrices this prevents UI freeze.
    let current = raw;
    let i = 0;

    const runNext = () => {
      if (i >= stepsToRun.length) {
        setProcessedMatrix(current);
        setProcessing(false);
        return;
      }
      const { name, params } = stepsToRun[i];
      const def = STEP_DEFS[name];
      if (!def) { i++; runNext(); return; }
      try {
        current = def.run(current, params ?? def.defaultParams, metadata);
      } catch (err) {
        setError(`Step "${def.label}" failed: ${err.message}`);
        setProcessing(false);
        return;
      }
      i++;
      setTimeout(runNext, 0);
    };

    setTimeout(runNext, 0);
  }, [metadata]);

  // ── public API ──────────────────────────────────────────────────────────
  const applyStep = useCallback((stepName, params) => {
    if (!STEP_DEFS[stepName]) {
      setError(`Unknown step: ${stepName}`);
      return;
    }
    const def = STEP_DEFS[stepName];
    const newStep = { name: stepName, params: params ?? def.defaultParams, label: def.label };
    const newSteps = [...steps, newStep];
    setSteps(newSteps);
    runPipeline(newSteps, rawRef.current);
  }, [steps, runPipeline]);

  const removeStep = useCallback((index) => {
    const newSteps = steps.filter((_, i) => i !== index);
    setSteps(newSteps);
    runPipeline(newSteps, rawRef.current);
  }, [steps, runPipeline]);

  const reset = useCallback(() => {
    setSteps([]);
    setProcessedMatrix(rawRef.current);
    setError(null);
  }, []);

  return {
    processedMatrix: processedMatrix ?? rawMatrix,
    steps,
    applyStep,
    removeStep,
    reset,
    processing,
    error,
  };
}
