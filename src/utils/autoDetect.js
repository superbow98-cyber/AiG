// AiG — autoDetect.js
// Shared "quick classical detection" pipeline: findPeaks() → extractFeatures()
// → Detection objects → amplitude-median target/noise split.
//
// This is the exact same logic that used to live only inside Detect.jsx's
// runDetection() callback. It has been extracted here so other pages
// (e.g. ResNetSpatial.jsx's standalone upload flow) can run the same
// classical detector without duplicating the algorithm or drifting out of
// sync with Detect.jsx. Detect.jsx itself now imports from here — behaviour
// is unchanged, only the code location moved.
//
// Consumed by: pages/Detect.jsx, pages/ResNetSpatial.jsx

import { findPeaks, extractFeatures } from '../models/knn';
import { sampleToDepth } from './depthCalc';

export const DEFAULT_DETECT_OPTS = {
  minAmplitudePct: 20,   // % of global max
  neighborRadius:  10,
  depthSkipPct:    5,    // skip top N% of scan (air wave)
  depthMaxPct:     90,
};

/**
 * Estimate bounding box half-dimensions for a detected peak.
 * Uses the half-width at half-max in the apex row, and a fixed
 * depth window below the apex for height.
 */
export function estimateBounds(matrix, apexSample, apexTrace, halfDepthSamples = 15) {
  const samples = matrix.length;
  const traces  = matrix[0]?.length ?? 0;
  const apexAmp = Math.abs(matrix[apexSample]?.[apexTrace] ?? 0);
  const halfMax = apexAmp * 0.5;

  let halfWidthTraces = 5; // default fallback
  for (let dt = 1; dt <= 30; dt++) {
    const l = Math.abs(matrix[apexSample]?.[Math.max(0, apexTrace - dt)] ?? 0);
    const r = Math.abs(matrix[apexSample]?.[Math.min(traces - 1, apexTrace + dt)] ?? 0);
    if (l < halfMax && r < halfMax) { halfWidthTraces = dt; break; }
  }

  return {
    halfWidthTraces:  Math.max(3, halfWidthTraces),
    halfDepthSamples: Math.min(halfDepthSamples, samples - apexSample - 1),
  };
}

/**
 * Convert peak list → Detection objects.
 */
export function buildDetections(peaks, matrix, metadata, velocity, dx_m) {
  return peaks.map((peak, i) => {
    const { halfWidthTraces, halfDepthSamples } = estimateBounds(
      matrix, peak.sample, peak.trace
    );
    const features = extractFeatures(matrix, peak.sample, peak.trace);
    const depth_m  = sampleToDepth(peak.sample, metadata.dt_ns, velocity);
    const position_m = peak.trace * (dx_m ?? 0.02);

    // Size estimate: width in cm from trace spacing, height from sample spacing
    const size_width_cm  = halfWidthTraces  * 2 * (dx_m ?? 0.02) * 100;
    const size_height_cm = halfDepthSamples * 2 * (metadata.dt_ns * velocity / 2) * 100;

    return {
      id:               `det-${i}`,
      trace:            peak.trace,
      apexSample:       peak.sample,
      position_m,
      depth_ns:         peak.sample * metadata.dt_ns,
      depth_m,
      size_width_cm:    Math.round(size_width_cm  * 10) / 10,
      size_height_cm:   Math.round(size_height_cm * 10) / 10,
      halfWidthTraces,
      halfDepthSamples,
      amplitude:        peak.amplitude,
      features,
      label:            null,   // filled after classification
      confidence:       null,
      hyperbola: {
        amplitude:    Math.abs(peak.amplitude),
        width_traces: halfWidthTraces * 2,
        curvature:    features[10] ?? 0,
      },
    };
  });
}

/**
 * Run the full quick classical-detection pipeline synchronously and return
 * the resulting Detection[] (amplitude-median target/noise split, same as
 * Detect.jsx's default "no SVM training data yet" path).
 */
export function quickAutoDetect(matrix, metadata, velocity, dx_m, opts = DEFAULT_DETECT_OPTS) {
  const samples = metadata.samples ?? matrix.length;

  let gMax = 0;
  for (let s = 0; s < matrix.length; s++)
    for (let t = 0; t < (matrix[0]?.length ?? 0); t++) {
      const v = Math.abs(matrix[s][t]);
      if (v > gMax) gMax = v;
    }

  const peaks = findPeaks(matrix, {
    minAmplitude:   gMax * (opts.minAmplitudePct / 100),
    neighborRadius: opts.neighborRadius,
    depthRange: [
      Math.floor(samples * opts.depthSkipPct / 100),
      Math.floor(samples * opts.depthMaxPct  / 100),
    ],
  });

  const allDets = buildDetections(peaks, matrix, metadata, velocity, dx_m);

  const median = (() => {
    const amps = allDets.map((d) => Math.abs(d.amplitude)).sort((a, b) => a - b);
    return amps[Math.floor(amps.length / 2)] ?? 0;
  })();

  return allDets.filter((d) => Math.abs(d.amplitude) >= median);
}
