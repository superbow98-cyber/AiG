// AiG — useGPRData.js
// Central hook that holds the current GPR scan in React state.
// Call setScan(file, { radFile }) to parse a GPR file and store the result.
// The optional radFile is required for Mala .rd3/.dt2 format (two-file pair).
// Call clearScan() to reset to the initial empty state.

import { useState, useCallback } from 'react';
import { parseGPRFile } from '../utils/gprParser';
import { generateSyntheticScan } from '../utils/gprParser';
import { DEFAULT_VELOCITY_M_PER_NS } from '../utils/depthCalc';

const INITIAL_STATE = {
  matrix: null,           // Float32Array[][] — matrix[sample][trace] = amplitude
  metadata: null,         // { traces, samples, dt_ns, dx_m, format, ... }
  filename: null,         // string
  format: null,           // 'dzt' | 'rd3' | 'sgy' | 'csv' | 'synthetic'
  velocity: DEFAULT_VELOCITY_M_PER_NS,  // m/ns — user-adjustable via Settings.jsx
  loading: false,
  error: null,
};

// dx_m fallback for SEG-Y files (null in metadata — see §6a / BRAIN.md)
export const DEFAULT_DX_M = 0.02; // metres between traces

/**
 * Main hook — useGPRData
 *
 * Returns:
 *   scan        — { matrix, metadata, filename, format, velocity, loading, error }
 *   setScan     — async (file, { radFile? }) — parses & stores; throws/returns error via scan.error
 *   loadDemo    — () — loads a synthetic scan for UI development without a real file
 *   clearScan   — () — resets state
 *   setVelocity — (v: number) — update soil velocity without re-parsing
 *   getDxM      — () — returns metadata.dx_m ?? DEFAULT_DX_M (safe for ObjectMap / DepthScale)
 */
export function useGPRData() {
  const [scan, setScanState] = useState(INITIAL_STATE);

  /** Parse a real GPR file and store the result. */
  const setScan = useCallback(async (file, { radFile = null } = {}) => {
    setScanState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const result = await parseGPRFile(file, { radFile });
      setScanState({
        matrix: result.matrix,
        metadata: result.metadata,
        filename: result.filename ?? file.name,
        format: result.metadata.format,
        velocity: DEFAULT_VELOCITY_M_PER_NS,
        loading: false,
        error: null,
      });
    } catch (err) {
      setScanState((prev) => ({
        ...prev,
        loading: false,
        error: err.message ?? 'Failed to parse GPR file.',
      }));
    }
  }, []);

  /** Load a synthetic demo scan — useful during UI development without real files. */
  const loadDemo = useCallback(() => {
    setScanState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      // generateSyntheticScan returns { matrix, metadata } (no filename field)
      const result = generateSyntheticScan({ traces: 200, samples: 512, dt_ns: 0.2, dx_m: 0.02 });
      setScanState({
        matrix: result.matrix,
        metadata: result.metadata,
        filename: 'demo_scan.synthetic',
        format: 'synthetic',
        velocity: DEFAULT_VELOCITY_M_PER_NS,
        loading: false,
        error: null,
      });
    } catch (err) {
      setScanState((prev) => ({
        ...prev,
        loading: false,
        error: err.message ?? 'Failed to generate demo scan.',
      }));
    }
  }, []);

  /** Reset to empty state. */
  const clearScan = useCallback(() => {
    setScanState(INITIAL_STATE);
  }, []);

  /**
   * Update the soil velocity assumption without re-parsing.
   * Triggers re-renders in Visualise / DepthScale / ResultCard wherever scan.velocity is read.
   */
  const setVelocity = useCallback((v) => {
    if (Number.isFinite(v) && v > 0) {
      setScanState((prev) => ({ ...prev, velocity: v }));
    }
  }, []);

  /**
   * Safe accessor for trace-spacing — SEG-Y metadata.dx_m is null (see §6a BRAIN.md).
   * Use this everywhere ObjectMap / DepthScale / Visualise.jsx need a distance step.
   */
  const getDxM = useCallback(() => {
    return scan.metadata?.dx_m ?? DEFAULT_DX_M;
  }, [scan.metadata]);

  return {
    scan,
    setScan,
    loadDemo,
    clearScan,
    setVelocity,
    getDxM,
  };
}

// Default export alias — some pages import this hook as a default.
export default useGPRData;
