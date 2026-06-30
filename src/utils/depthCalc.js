// AiG — depthCalc
// Two-way travel time (nanoseconds) <-> depth (metres) conversion for GPR data.
// Velocity is the propagation speed of the EM wave through the soil/material
// being surveyed — it is NOT a fixed physical constant, it depends on soil
// moisture/composition, so it's exposed as a parameter everywhere (adjustable
// in Settings.jsx, defaults to dry-soil average).

// Defaults match docs/GPR_FORMATS.md
export const DEFAULT_VELOCITY_M_PER_NS = 0.1;  // dry soil
export const VELOCITY_RANGE = { min: 0.06, max: 0.12 }; // wet/clay .. dry/sandy, matches Settings.jsx slider spec

export const SOIL_VELOCITY_PRESETS = {
  dry_sand: 0.15,
  dry_soil: 0.1,
  moist_soil: 0.08,
  wet_clay: 0.06,
  tropical_wet: 0.055,   // Malaysia tropical high-moisture soil — strong attenuation
  concrete: 0.1,
  ice: 0.16,
};

/**
 * Convert two-way travel time to depth.
 * depth (m) = (travel_time_ns * velocity_m_per_ns) / 2  — divide by 2 because
 * the signal travels down AND back up.
 */
export function nsToMetres(ns, velocity = DEFAULT_VELOCITY_M_PER_NS) {
  if (!Number.isFinite(ns)) return 0;
  return (ns * velocity) / 2;
}

/**
 * Inverse of nsToMetres — given a target depth, what two-way travel time
 * would produce it. Useful for placing depth gridlines on DepthScale.jsx.
 */
export function metresToNs(m, velocity = DEFAULT_VELOCITY_M_PER_NS) {
  if (!Number.isFinite(m) || velocity === 0) return 0;
  return (m * 2) / velocity;
}

/**
 * Build a depth value (in metres) for every sample row of a B-scan, so
 * BScanViewer/DepthScale can map "sample index" -> "depth" directly without
 * recomputing the conversion per pixel.
 *
 * sample s corresponds to travel time s * dt_ns (sample 0 = surface = 0 ns).
 */
export function getDepthAxis(samples, dt_ns, velocity = DEFAULT_VELOCITY_M_PER_NS) {
  const axis = new Float32Array(samples);
  for (let s = 0; s < samples; s++) {
    axis[s] = nsToMetres(s * dt_ns, velocity);
  }
  return axis;
}

/**
 * Total depth range covered by a scan — handy for DepthScale tick spacing
 * and for clamping a "max depth" filter in Detect/Settings.
 */
export function getMaxDepth(samples, dt_ns, velocity = DEFAULT_VELOCITY_M_PER_NS) {
  return nsToMetres((samples - 1) * dt_ns, velocity);
}

/**
 * Convert a sample index (row in the matrix) to depth in metres directly —
 * convenience wrapper so callers that only have { dt_ns } from metadata
 * don't need to know the ns formula.
 */
export function sampleToDepth(sampleIndex, dt_ns, velocity = DEFAULT_VELOCITY_M_PER_NS) {
  return nsToMetres(sampleIndex * dt_ns, velocity);
}

/**
 * Inverse of sampleToDepth — given a target depth, which sample row is
 * closest. Used by ResultCard/Detect to translate a clicked depth back into
 * a row index for highlighting on BScanViewer.
 */
export function depthToSample(depthM, dt_ns, velocity = DEFAULT_VELOCITY_M_PER_NS) {
  const ns = metresToNs(depthM, velocity);
  return dt_ns > 0 ? Math.round(ns / dt_ns) : 0;
}

/**
 * Tick mark generator for DepthScale.jsx — produces evenly spaced depth
 * labels (in metres) across the scan's depth range, snapped to "nice"
 * round numbers (0.1 / 0.25 / 0.5 / 1m steps depending on range).
 */
export function getDepthTicks(samples, dt_ns, velocity = DEFAULT_VELOCITY_M_PER_NS, targetTickCount = 8) {
  const maxDepth = getMaxDepth(samples, dt_ns, velocity);
  if (maxDepth <= 0) return [0];

  const rawStep = maxDepth / targetTickCount;
  const niceSteps = [0.05, 0.1, 0.25, 0.5, 1, 2, 5];
  const step = niceSteps.find((s) => s >= rawStep) ?? niceSteps[niceSteps.length - 1];

  const ticks = [];
  for (let d = 0; d <= maxDepth; d += step) {
    ticks.push(Math.round(d * 1000) / 1000); // clean float rounding
  }
  return ticks;
}
