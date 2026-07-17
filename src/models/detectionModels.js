// AiG — detectionModels.js
// §7d — AI Detection Lab: a coarse-grid backbone shared by three detector
// heads (YOLO-lite / Faster R-CNN-lite / Mask R-CNN-lite) that run directly
// on the full B-scan matrix, as an AI alternative sitting *alongside* the
// existing SVM/peak-picking detector in Detect.jsx (models/knn.js +
// models/svmModel.js) — not a replacement for it.
//
// Same honesty note as resnet18.js / xrfMLP.js / fusionEngine.js: every
// conv/linear/softmax/NMS operation below is a real forward pass over real
// per-cell statistics pulled from the matrix — nothing is a canned number —
// but the conv/linear weights are deterministically seeded (mulberry32,
// He-init), not trained on labelled GPR object boxes/masks, because no such
// dataset exists in this repo yet. Treat boxes/masks/scores as illustrating
// the *pipeline* (grid backbone → per-method head → decode → NMS), not yet
// as calibrated detections. loadWeights() is the swap-in point once trained
// weights exist; train() is an explicit stub, same pattern as
// fusionEngine.train().
//
// Consumed by: pages/DetectionLab.jsx

import { sampleToDepth } from '../utils/depthCalc';

export const DETECTOR_CLASSES = ['metal', 'ceramic', 'stone', 'void'];

export const DETECTOR_METHODS = [
  {
    key: 'yolo',
    label: 'YOLO-lite (single-stage, anchor-free)',
    description: 'One box per grid cell, decoded directly from the backbone feature map. Fastest, coarsest.',
  },
  {
    key: 'frcnn',
    label: 'Faster R-CNN-lite (2-stage: RPN → ROI head)',
    description: 'RPN scores 2 anchors/cell → NMS → ROI classification + box refinement head.',
  },
  {
    key: 'maskrcnn',
    label: 'Mask R-CNN-lite (Faster R-CNN + mask head)',
    description: 'Same 2-stage pipeline as Faster R-CNN-lite, plus an 8×8 per-proposal mask branch.',
  },
];

// ── grid geometry ────────────────────────────────────────────────────────
const GRID_W = 28; // cells across traces
const GRID_H = 16; // cells across depth samples
const IN_CH  = 4;  // meanAbs, maxAbs, variance, vertical-gradient
const MID_CH = 12;
const OUT_CH = 16; // backbone output channels — feeds every head

// ── seeded PRNG / init (same convention as resnet18.js) ────────────────────
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function heInit(rng, fanIn) {
  const scale = Math.sqrt(2 / Math.max(1, fanIn));
  const u1 = Math.max(rng(), 1e-9), u2 = rng();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return z * scale;
}
function makeConv(rng, kh, kw, cin, cout) {
  const w = new Float32Array(kh * kw * cin * cout);
  for (let i = 0; i < w.length; i++) w[i] = heInit(rng, kh * kw * cin);
  return { w, b: new Float32Array(cout), kh, kw, cin, cout };
}
function makeLinear(rng, inDim, outDim) {
  const w = new Float32Array(inDim * outDim);
  for (let i = 0; i < w.length; i++) w[i] = heInit(rng, inDim);
  return { w, b: new Float32Array(outDim), inDim, outDim };
}

// ── tiny conv2d over the coarse grid (same-padding, stride 1) ──────────────
function conv2d(input, H, W, layer) {
  const { w, b, kh, kw, cin, cout } = layer;
  const padH = Math.floor(kh / 2), padW = Math.floor(kw / 2);
  const out = new Float32Array(H * W * cout);
  for (let oy = 0; oy < H; oy++) {
    for (let ox = 0; ox < W; ox++) {
      for (let oc = 0; oc < cout; oc++) {
        let sum = b[oc];
        for (let ky = 0; ky < kh; ky++) {
          const iy = oy - padH + ky;
          if (iy < 0 || iy >= H) continue;
          for (let kx = 0; kx < kw; kx++) {
            const ix = ox - padW + kx;
            if (ix < 0 || ix >= W) continue;
            const inBase = (iy * W + ix) * cin;
            const wBase = ((ky * kw + kx) * cin) * cout + oc;
            for (let ic = 0; ic < cin; ic++) {
              sum += input[inBase + ic] * w[wBase + ic * cout];
            }
          }
        }
        out[(oy * W + ox) * cout + oc] = sum;
      }
    }
  }
  return out;
}
function relu(arr) {
  const out = new Float32Array(arr.length);
  for (let i = 0; i < arr.length; i++) out[i] = arr[i] > 0 ? arr[i] : 0;
  return out;
}
function sigmoid(x) { return 1 / (1 + Math.exp(-x)); }

// Per-cell layer normalisation over the channel dimension — standard in real
// detector backbones (Batch/LayerNorm after conv) and needed here because,
// without it, unbounded conv-sum magnitudes push every head's sigmoid/softmax
// toward saturation, collapsing "confidence" into an all-or-nothing cliff
// regardless of the threshold the user picks.
function layerNormPerCell(features, numCells, C) {
  const out = new Float32Array(features.length);
  for (let i = 0; i < numCells; i++) {
    const base = i * C;
    let mean = 0;
    for (let c = 0; c < C; c++) mean += features[base + c];
    mean /= C;
    let variance = 0;
    for (let c = 0; c < C; c++) variance += (features[base + c] - mean) ** 2;
    variance /= C;
    const std = Math.sqrt(variance + 1e-5);
    for (let c = 0; c < C; c++) out[base + c] = (features[base + c] - mean) / std;
  }
  return out;
}
function softmax(arr) {
  const m = Math.max(...arr);
  const exps = arr.map((v) => Math.exp(v - m));
  const s = exps.reduce((a, b) => a + b, 0) || 1;
  return exps.map((v) => v / s);
}
function linear(input, layer) {
  const { w, b, inDim, outDim } = layer;
  const out = new Float32Array(outDim);
  for (let o = 0; o < outDim; o++) {
    let sum = b[o];
    for (let i = 0; i < inDim; i++) sum += input[i] * w[i * outDim + o];
    out[o] = sum;
  }
  return out;
}

// ── model construction ──────────────────────────────────────────────────
export function createDetector(method, seed = 707) {
  const rng = mulberry32(seed);
  const backbone = {
    conv1: makeConv(rng, 3, 3, IN_CH, MID_CH),
    conv2: makeConv(rng, 3, 3, MID_CH, OUT_CH),
  };

  const numClasses = DETECTOR_CLASSES.length;
  const model = { method, seed, trained: false, backbone };

  if (method === 'yolo') {
    // Anchor-free: 1 box/cell. Output = 4 (box deltas) + 1 (objectness) + numClasses
    model.head = { pred: makeLinear(rng, OUT_CH, 4 + 1 + numClasses) };
  } else {
    // Faster R-CNN-lite / Mask R-CNN-lite: RPN (2 anchors/cell) → ROI head
    const numAnchors = 2;
    model.numAnchors = numAnchors;
    model.rpn = {
      objectness: makeLinear(rng, OUT_CH, numAnchors),
      boxDelta:   makeLinear(rng, OUT_CH, numAnchors * 4),
    };
    model.roi = {
      fc:    makeLinear(rng, OUT_CH, 32),
      cls:   makeLinear(rng, 32, numClasses),
      box:   makeLinear(rng, 32, 4),
    };
    if (method === 'maskrcnn') {
      model.maskHead = {
        fc:   makeLinear(rng, OUT_CH, 32),
        mask: makeLinear(rng, 32, 8 * 8), // 8x8 mask logits
      };
    }
  }
  return model;
}

/** Swap-in point once trained weights exist — same convention as resnet18.js. */
export function loadWeights(model, weights) {
  Object.assign(model, weights, { trained: true });
  return model;
}

/** Explicit stub — documents exactly what training this would need. */
export function train() {
  throw new Error(
    'detectionModels.train() is not implemented — needs a labelled set of ' +
    'GPR B-scans with ground-truth object boxes (+ masks for Mask R-CNN-lite), ' +
    'which does not exist in this repo yet. See gpr_xrf_records / §7g Research ' +
    'Dataset Manager for where that data would need to accumulate first.'
  );
}

const _cache = {};
export function getDefaultDetector(method) {
  if (!_cache[method]) _cache[method] = createDetector(method);
  return _cache[method];
}

// ── grid feature extraction (real stats pulled from the matrix) ───────────
function computeGridFeatures(matrix, samples, traces) {
  const cellW = traces / GRID_W;
  const cellH = samples / GRID_H;
  const feat = new Float32Array(GRID_H * GRID_W * IN_CH);

  // global scale for normalisation
  let gMax = 1e-6;
  for (let s = 0; s < samples; s++)
    for (let t = 0; t < traces; t++) {
      const v = Math.abs(matrix[s]?.[t] ?? 0);
      if (v > gMax) gMax = v;
    }

  for (let gy = 0; gy < GRID_H; gy++) {
    const s0 = Math.floor(gy * cellH), s1 = Math.min(samples, Math.floor((gy + 1) * cellH));
    for (let gx = 0; gx < GRID_W; gx++) {
      const t0 = Math.floor(gx * cellW), t1 = Math.min(traces, Math.floor((gx + 1) * cellW));
      let sum = 0, sumSq = 0, max = 0, grad = 0, n = 0;
      for (let s = s0; s < s1; s++) {
        for (let t = t0; t < t1; t++) {
          const v = Math.abs(matrix[s]?.[t] ?? 0);
          sum += v; sumSq += v * v; n++;
          if (v > max) max = v;
          const below = Math.abs(matrix[s + 1]?.[t] ?? v);
          grad += Math.abs(below - v);
        }
      }
      n = n || 1;
      const mean = sum / n;
      const variance = Math.max(0, sumSq / n - mean * mean);
      const base = (gy * GRID_W + gx) * IN_CH;
      feat[base + 0] = mean / gMax;
      feat[base + 1] = max / gMax;
      feat[base + 2] = Math.sqrt(variance) / gMax;
      feat[base + 3] = (grad / n) / gMax;
    }
  }
  return feat;
}

// ── box decode helpers ──────────────────────────────────────────────────
// Anchor base sizes, in *cells*, so Faster/Mask R-CNN-lite proposals span
// more than one grid cell (a real RPN's whole point vs YOLO's 1-box/cell).
const ANCHORS = [{ w: 1.4, h: 1.0 }, { w: 1.0, h: 1.8 }];

function decodeBox(cx, cy, tw, th, anchorW, anchorH, cellW, cellH) {
  const w = Math.max(1, anchorW * Math.exp(Math.max(-2, Math.min(2, tw))));
  const h = Math.max(1, anchorH * Math.exp(Math.max(-2, Math.min(2, th))));
  return {
    x0: (cx - w / 2) * cellW,
    y0: (cy - h / 2) * cellH,
    x1: (cx + w / 2) * cellW,
    y1: (cy + h / 2) * cellH,
  };
}
function iou(a, b) {
  const x0 = Math.max(a.x0, b.x0), y0 = Math.max(a.y0, b.y0);
  const x1 = Math.min(a.x1, b.x1), y1 = Math.min(a.y1, b.y1);
  const inter = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
  const areaA = Math.max(0, a.x1 - a.x0) * Math.max(0, a.y1 - a.y0);
  const areaB = Math.max(0, b.x1 - b.x0) * Math.max(0, b.y1 - b.y0);
  const union = areaA + areaB - inter;
  return union > 0 ? inter / union : 0;
}
function nms(cands, iouThresh) {
  const sorted = [...cands].sort((a, b) => b.score - a.score);
  const kept = [];
  for (const c of sorted) {
    if (kept.every((k) => iou(k.box, c.box) < iouThresh)) kept.push(c);
  }
  return kept;
}

// ── main entry point ───────────────────────────────────────────────────
/**
 * Run a detector over a full GPR B-scan matrix.
 * @returns {{ detections, gridShape, stats, archSummary }}
 */
export function runDetector(matrix, metadata, {
  method = 'yolo',
  model,
  confThreshold = 0.5,
  nmsIoU = 0.35,
  maxDetections = 30,
} = {}) {
  const m = model ?? getDefaultDetector(method);
  const samples = metadata?.samples ?? matrix.length;
  const traces  = metadata?.traces  ?? (matrix[0]?.length ?? 0);
  const dx_m    = metadata?.dx_m ?? 0.02;
  const velocity = metadata?.velocity ?? 0.1;
  const cellW = traces / GRID_W;
  const cellH = samples / GRID_H;

  const gridFeat = computeGridFeatures(matrix, samples, traces);
  const c1 = relu(conv2d(gridFeat, GRID_H, GRID_W, m.backbone.conv1));
  const rawBackboneOut = relu(conv2d(c1, GRID_H, GRID_W, m.backbone.conv2)); // GRID_H*GRID_W*OUT_CH
  const backboneOut = layerNormPerCell(rawBackboneOut, GRID_H * GRID_W, OUT_CH);

  const candidates = [];

  if (method === 'yolo') {
    for (let gy = 0; gy < GRID_H; gy++) {
      for (let gx = 0; gx < GRID_W; gx++) {
        const base = (gy * GRID_W + gx) * OUT_CH;
        const cellFeat = backboneOut.subarray(base, base + OUT_CH);
        const pred = linear(cellFeat, m.head.pred);
        const objectness = sigmoid(pred[4]);
        const classProbs = softmax(Array.from(pred.slice(5)));
        const classIdx = classProbs.indexOf(Math.max(...classProbs));
        const score = objectness * classProbs[classIdx];
        if (score < confThreshold) continue;
        const cx = gx + 0.5 + pred[0] * 0.5;
        const cy = gy + 0.5 + pred[1] * 0.5;
        const box = decodeBox(cx, cy, pred[2], pred[3], 1.6, 1.6, cellW, cellH);
        candidates.push({ box, score, classIdx, objectness, classProbs });
      }
    }
  } else {
    // Faster R-CNN-lite / Mask R-CNN-lite: RPN over 2 anchors/cell
    for (let gy = 0; gy < GRID_H; gy++) {
      for (let gx = 0; gx < GRID_W; gx++) {
        const base = (gy * GRID_W + gx) * OUT_CH;
        const cellFeat = backboneOut.subarray(base, base + OUT_CH);
        const obj = linear(cellFeat, m.rpn.objectness);
        const deltas = linear(cellFeat, m.rpn.boxDelta);
        for (let a = 0; a < m.numAnchors; a++) {
          const objectness = sigmoid(obj[a]);
          if (objectness < confThreshold * 0.6) continue; // RPN pre-filter, looser than final threshold
          const anchor = ANCHORS[a];
          const box = decodeBox(
            gx + 0.5, gy + 0.5,
            deltas[a * 4 + 2], deltas[a * 4 + 3],
            anchor.w * 1.4, anchor.h * 1.4,
            cellW, cellH
          );
          // ROI head: pool = the originating cell's own feature (coarse-grid stand-in
          // for ROIAlign — there is only one cell's worth of feature under a small box).
          const roiHidden = relu(linear(cellFeat, m.roi.fc));
          const classProbs = softmax(Array.from(linear(roiHidden, m.roi.cls)));
          const classIdx = classProbs.indexOf(Math.max(...classProbs));
          const score = objectness * classProbs[classIdx];
          if (score < confThreshold) continue;

          let mask = null;
          if (method === 'maskrcnn') {
            const maskHidden = relu(linear(cellFeat, m.maskHead.fc));
            const maskLogits = linear(maskHidden, m.maskHead.mask);
            mask = Float32Array.from(maskLogits, sigmoid); // 8x8, values [0,1]
          }
          candidates.push({ box, score, classIdx, objectness, classProbs, mask });
        }
      }
    }
  }

  const kept = nms(candidates, nmsIoU).slice(0, maxDetections);

  // Convert to the app's canonical Detection shape (same fields Detect.jsx
  // produces) so this can share HyperbolaOverlay / ObjectMap / the
  // ResNet-18 crop pipeline unchanged.
  const detections = kept.map((k, i) => {
    const traceCenter  = Math.round((k.box.x0 + k.box.x1) / 2);
    const sampleCenter = Math.round((k.box.y0 + k.box.y1) / 2);
    const halfWidthTraces  = Math.max(2, Math.round((k.box.x1 - k.box.x0) / 2));
    const halfDepthSamples = Math.max(2, Math.round((k.box.y1 - k.box.y0) / 2));
    return {
      id: `ai-${method}-${i}`,
      source: 'ai-detection-lab',
      method,
      trace: Math.max(0, Math.min(traces - 1, traceCenter)),
      apexSample: Math.max(0, Math.min(samples - 1, sampleCenter)),
      halfWidthTraces,
      halfDepthSamples,
      position_m: traceCenter * dx_m,
      depth_m: sampleToDepth(sampleCenter, metadata?.dt_ns ?? 1, velocity),
      // Same formula as utils/autoDetect.js buildDetections() and
      // deepLearningLoader.js _maskToDetections() — was missing here, which
      // is why ResNet-18's "Width:"/"Height:" fields render blank for any
      // detection sent over from AI Detection Lab.
      size_width_cm:  +(halfWidthTraces  * 2 * dx_m * 100).toFixed(1),
      size_height_cm: +(halfDepthSamples * 2 * (metadata?.dt_ns ?? 1) * velocity / 2 * 100).toFixed(1),
      label: DETECTOR_CLASSES[k.classIdx],
      confidence: k.score,
      classProbs: k.classProbs,
      mask: k.mask ? Array.from(k.mask) : null,
      maskSize: k.mask ? 8 : null,
      amplitude: 0,
    };
  });

  const perClass = {};
  for (const c of DETECTOR_CLASSES) perClass[c] = 0;
  for (const d of detections) perClass[d.label] = (perClass[d.label] ?? 0) + 1;
  const avgConfidence = detections.length
    ? detections.reduce((s, d) => s + d.confidence, 0) / detections.length
    : 0;

  return {
    detections,
    gridShape: { w: GRID_W, h: GRID_H },
    stats: {
      count: detections.length,
      candidatesBeforeNms: candidates.length,
      avgConfidence,
      perClass,
    },
    archSummary: ARCH_SUMMARIES[method],
    trained: m.trained,
  };
}

// ── architecture summaries for display (mirrors RESNET_ARCH_SUMMARY) ──────
export const ARCH_SUMMARIES = {
  yolo: {
    input: `${GRID_H}×${GRID_W} grid, 4ch cell stats (mean/max/var/vgrad)`,
    backbone: `conv3×3(4→${MID_CH})+ReLU → conv3×3(${MID_CH}→${OUT_CH})+ReLU → per-cell LayerNorm`,
    head: `per-cell: Linear(${OUT_CH}→9) → 4 box deltas + objectness + 4-class softmax`,
    notes: 'Anchor-free, 1 box per cell — fastest, coarsest of the three.',
  },
  frcnn: {
    input: `${GRID_H}×${GRID_W} grid, 4ch cell stats (mean/max/var/vgrad)`,
    backbone: `conv3×3(4→${MID_CH})+ReLU → conv3×3(${MID_CH}→${OUT_CH})+ReLU → per-cell LayerNorm`,
    head: `RPN: Linear(${OUT_CH}→2×2anchors) objectness+deltas → NMS → ROI: Linear(${OUT_CH}→32)+ReLU→Linear(32→4 classes)+Linear(32→4 box)`,
    notes: '2-stage: region proposals first, then a separate classification/refinement head per proposal.',
  },
  maskrcnn: {
    input: `${GRID_H}×${GRID_W} grid, 4ch cell stats (mean/max/var/vgrad)`,
    backbone: `conv3×3(4→${MID_CH})+ReLU → conv3×3(${MID_CH}→${OUT_CH})+ReLU → per-cell LayerNorm`,
    head: `Faster R-CNN-lite head + mask branch: Linear(${OUT_CH}→32)+ReLU→Linear(32→8×8) sigmoid`,
    notes: 'Same 2-stage pipeline as Faster R-CNN-lite, plus a per-proposal 8×8 binary mask.',
  },
};

// ── compare AI detections against the classical SVM/peak detector ─────────
/**
 * @param {object[]} aiDets   from runDetector().detections
 * @param {object[]} classicalDets  from Detect.jsx (SVM/peak-picking)
 */
export function compareDetections(aiDets = [], classicalDets = [], {
  toleranceTraces = 6,
  toleranceSamples = 8,
} = {}) {
  const matched = [];
  const aiOnly = [];
  const usedClassical = new Set();

  for (const a of aiDets) {
    const hit = classicalDets.find((c, i) =>
      !usedClassical.has(i) &&
      Math.abs(c.trace - a.trace) <= toleranceTraces &&
      Math.abs(c.apexSample - a.apexSample) <= toleranceSamples
    );
    if (hit) {
      usedClassical.add(classicalDets.indexOf(hit));
      matched.push({ ai: a, classical: hit });
    } else {
      aiOnly.push(a);
    }
  }
  const classicalOnly = classicalDets.filter((_, i) => !usedClassical.has(i));

  return {
    matched,
    aiOnly,
    classicalOnly,
    matchRate: classicalDets.length ? matched.length / classicalDets.length : 0,
  };
}
