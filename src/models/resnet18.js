// AiG — resnet18.js
// PhD pipeline step 3: Detected anomaly → Crop → ResNet-18 → 128-D Spatial Embedding
//
// This is a compact ResNet-18-style CNN (stem + 4 residual stages of 2 basic
// blocks each, channel widths 16→32→64→128, global-average-pool) implemented
// as a real forward pass in plain JS — every conv/residual/relu/pool op below
// actually executes, nothing here is a random-number placeholder pretending
// to be a network. There is only one honest caveat, stated plainly:
//
//   ⚠ WEIGHTS ARE UNTRAINED. There is no labelled GPR anomaly image dataset
//   in this repo to train on, so weights are deterministically seeded
//   (mulberry32 PRNG, He-init scale) rather than learned. The architecture,
//   dimensions and math are real; the numbers coming out are NOT yet
//   meaningful material predictions — treat the embedding as a structural
//   placeholder until real weights are trained/loaded (see loadWeights()).
//
// This mirrors the existing Phase 3 plan in deepLearningLoader.js: once a
// trained model is exported (ONNX or a JSON weight dump matching the shapes
// below), call loadWeights() and every downstream consumer (FusionEngine,
// ResNetSpatial page) keeps working unchanged.
//
// Consumed by: pages/ResNetSpatial.jsx, models/fusionEngine.js

// ── seeded PRNG (deterministic — same crop always gives same embedding) ────
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
  // Box-Muller for approx-Gaussian weights
  const u1 = Math.max(rng(), 1e-9), u2 = rng();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return z * scale;
}

function makeConvWeights(rng, kh, kw, cin, cout) {
  const fanIn = kh * kw * cin;
  const w = new Float32Array(kh * kw * cin * cout);
  for (let i = 0; i < w.length; i++) w[i] = heInit(rng, fanIn);
  const b = new Float32Array(cout); // zero bias
  return { w, kh, kw, cin, cout, b };
}

// ── core ops (operate on [H][W][C] plain arrays of Float32Array rows) ──────

function conv2d(input, H, W, layer, stride = 1) {
  const { w, kh, kw, cin, cout, b } = layer;
  const padH = Math.floor(kh / 2), padW = Math.floor(kw / 2);
  const outH = Math.floor((H - 1) / stride) + 1;
  const outW = Math.floor((W - 1) / stride) + 1;
  const out = new Float32Array(outH * outW * cout);

  for (let oy = 0; oy < outH; oy++) {
    const iy0 = oy * stride - padH;
    for (let ox = 0; ox < outW; ox++) {
      const ix0 = ox * stride - padW;
      for (let oc = 0; oc < cout; oc++) {
        let sum = b[oc];
        for (let ky = 0; ky < kh; ky++) {
          const iy = iy0 + ky;
          if (iy < 0 || iy >= H) continue;
          for (let kx = 0; kx < kw; kx++) {
            const ix = ix0 + kx;
            if (ix < 0 || ix >= W) continue;
            const inBase = (iy * W + ix) * cin;
            const wBase = ((ky * kw + kx) * cin) * cout + oc;
            for (let ic = 0; ic < cin; ic++) {
              sum += input[inBase + ic] * w[wBase + ic * cout];
            }
          }
        }
        out[(oy * outW + ox) * cout + oc] = sum;
      }
    }
  }
  return { data: out, H: outH, W: outW, C: cout };
}

function relu(arr) {
  const out = new Float32Array(arr.length);
  for (let i = 0; i < arr.length; i++) out[i] = arr[i] > 0 ? arr[i] : 0;
  return out;
}

function addInPlace(a, b) {
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] + b[i];
  return out;
}

function maxPool2(input, H, W, C) {
  const outH = Math.ceil(H / 2), outW = Math.ceil(W / 2);
  const out = new Float32Array(outH * outW * C);
  for (let oy = 0; oy < outH; oy++) {
    for (let ox = 0; ox < outW; ox++) {
      for (let c = 0; c < C; c++) {
        let m = -Infinity;
        for (let dy = 0; dy < 2; dy++) {
          const iy = oy * 2 + dy; if (iy >= H) continue;
          for (let dx = 0; dx < 2; dx++) {
            const ix = ox * 2 + dx; if (ix >= W) continue;
            const v = input[(iy * W + ix) * C + c];
            if (v > m) m = v;
          }
        }
        out[(oy * outW + ox) * C + c] = m === -Infinity ? 0 : m;
      }
    }
  }
  return { data: out, H: outH, W: outW, C };
}

function globalAvgPool(input, H, W, C) {
  const out = new Float32Array(C);
  for (let c = 0; c < C; c++) {
    let s = 0;
    for (let i = 0; i < H * W; i++) s += input[i * C + c];
    out[c] = s / (H * W);
  }
  return out;
}

// ── architecture definition (mirrors torchvision resnet18 topology,
//    scaled-down channel widths so a browser can run it instantly) ─────────

const STAGE_CHANNELS = [16, 32, 64, 128]; // vs real resnet18: 64,128,256,512
const BLOCKS_PER_STAGE = 2;               // matches resnet18's [2,2,2,2]

export function createResNet18(seed = 18) {
  const rng = mulberry32(seed);
  const model = { seed, trained: false, stem: null, stages: [], embedDim: STAGE_CHANNELS[STAGE_CHANNELS.length - 1] };

  // Stem: 3x3 conv, in=1 (single-channel B-scan amplitude patch)
  model.stem = makeConvWeights(rng, 3, 3, 1, STAGE_CHANNELS[0]);

  let inC = STAGE_CHANNELS[0];
  for (let s = 0; s < STAGE_CHANNELS.length; s++) {
    const outC = STAGE_CHANNELS[s];
    const blocks = [];
    for (let b = 0; b < BLOCKS_PER_STAGE; b++) {
      const stride = (b === 0 && s > 0) ? 2 : 1; // downsample at first block of stages 2-4
      const conv1 = makeConvWeights(rng, 3, 3, inC, outC);
      const conv2 = makeConvWeights(rng, 3, 3, outC, outC);
      const shortcut = (stride !== 1 || inC !== outC)
        ? makeConvWeights(rng, 1, 1, inC, outC)
        : null;
      blocks.push({ conv1, conv2, shortcut, stride, inC, outC });
      inC = outC;
    }
    model.stages.push(blocks);
  }
  return model;
}

/** Replace random weights with real trained ones (same shapes). Call once
 *  a trained export is available; every downstream call site is unaffected. */
export function loadWeights(model, weightsBySeed) {
  // Expected shape: { stem: {w,b}, stages: [[{conv1,conv2,shortcut}, ...], ...] }
  // Left as an explicit integration point — see deepLearningLoader.js for the
  // ONNX-based alternative if weights are exported from PyTorch instead.
  Object.assign(model, weightsBySeed, { trained: true });
  return model;
}

let _defaultModel = null;
export function getDefaultResNet18() {
  if (!_defaultModel) _defaultModel = createResNet18(18);
  return _defaultModel;
}

/**
 * Run the forward pass on a square single-channel patch.
 * @param {object} model  from createResNet18()
 * @param {Float32Array} patch  length = size*size, values normalised ~[-1,1]
 * @param {number} size
 * @returns {{embedding: Float32Array(128), stageActivations: object[]}}
 */
export function runResNet18(model, patch, size) {
  let cur = { data: patch, H: size, W: size, C: 1 };

  const stemOut = conv2d(cur.data, cur.H, cur.W, model.stem, 1);
  cur = { data: relu(stemOut.data), H: stemOut.H, W: stemOut.W, C: stemOut.C };
  const pooled = maxPool2(cur.data, cur.H, cur.W, cur.C);
  cur = { data: pooled.data, H: pooled.H, W: pooled.W, C: pooled.C };

  const stageActivations = [];
  for (const blocks of model.stages) {
    for (const block of blocks) {
      const c1 = conv2d(cur.data, cur.H, cur.W, block.conv1, block.stride);
      const r1 = relu(c1.data);
      const c2 = conv2d(r1, c1.H, c1.W, block.conv2, 1);

      let identity = cur.data;
      let idH = cur.H, idW = cur.W, idC = cur.C;
      if (block.shortcut) {
        const sc = conv2d(cur.data, cur.H, cur.W, block.shortcut, block.stride);
        identity = sc.data; idH = sc.H; idW = sc.W; idC = sc.C;
      }
      // shapes now match (c2.H===idH, c2.C===idC) by construction
      const summed = addInPlace(c2.data, identity);
      const activated = relu(summed);
      cur = { data: activated, H: c2.H, W: c2.W, C: c2.C };
    }
    stageActivations.push({ H: cur.H, W: cur.W, C: cur.C, mean: avg(cur.data) });
  }

  const embedding = globalAvgPool(cur.data, cur.H, cur.W, cur.C); // 128-D
  return { embedding, stageActivations, finalShape: { H: cur.H, W: cur.W, C: cur.C } };
}

function avg(arr) {
  let s = 0; for (let i = 0; i < arr.length; i++) s += arr[i];
  return arr.length ? s / arr.length : 0;
}

// ── crop extraction: pull a normalised patch out of a GPR B-scan matrix ────

/**
 * Crop a window around a detection apex and resample (bilinear) to size×size.
 * @param {Float32Array[]} matrix   [sample][trace] amplitude matrix
 * @param {number} apexSample
 * @param {number} apexTrace
 * @param {number} halfWidthTraces
 * @param {number} halfDepthSamples
 * @param {number} size  output patch dimension (default 32)
 */
export function extractCrop(matrix, apexSample, apexTrace, halfWidthTraces = 8, halfDepthSamples = 15, size = 32) {
  const samples = matrix.length;
  const traces = matrix[0]?.length ?? 0;

  const rTop = Math.max(0, apexSample - Math.round(halfDepthSamples * 0.3));
  const rBot = Math.min(samples - 1, apexSample + halfDepthSamples * 2);
  const cLeft = Math.max(0, apexTrace - halfWidthTraces);
  const cRight = Math.min(traces - 1, apexTrace + halfWidthTraces);

  const cropH = Math.max(1, rBot - rTop);
  const cropW = Math.max(1, cRight - cLeft);

  // find crop-local min/max for normalisation
  let mn = Infinity, mx = -Infinity;
  for (let r = rTop; r <= rBot; r++) {
    for (let c = cLeft; c <= cRight; c++) {
      const v = matrix[r]?.[c] ?? 0;
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
  }
  const range = (mx - mn) || 1;

  const out = new Float32Array(size * size);
  for (let oy = 0; oy < size; oy++) {
    const fy = rTop + (oy / (size - 1)) * cropH;
    for (let ox = 0; ox < size; ox++) {
      const fx = cLeft + (ox / (size - 1)) * cropW;
      const v = bilinear(matrix, fy, fx, samples, traces);
      out[oy * size + ox] = ((v - mn) / range) * 2 - 1; // normalise to [-1, 1]
    }
  }
  return out;
}

function bilinear(matrix, fy, fx, samples, traces) {
  const y0 = Math.max(0, Math.min(samples - 1, Math.floor(fy)));
  const y1 = Math.max(0, Math.min(samples - 1, y0 + 1));
  const x0 = Math.max(0, Math.min(traces - 1, Math.floor(fx)));
  const x1 = Math.max(0, Math.min(traces - 1, x0 + 1));
  const dy = fy - y0, dx = fx - x0;
  const v00 = matrix[y0]?.[x0] ?? 0, v01 = matrix[y0]?.[x1] ?? 0;
  const v10 = matrix[y1]?.[x0] ?? 0, v11 = matrix[y1]?.[x1] ?? 0;
  return v00 * (1 - dy) * (1 - dx) + v01 * (1 - dy) * dx + v10 * dy * (1 - dx) + v11 * dy * dx;
}

/**
 * High-level convenience: detection object (as produced by Detect.jsx) + raw
 * matrix → { embedding, patch, stageActivations }.
 */
export function getSpatialEmbedding(matrix, detection, { size = 32, model } = {}) {
  const m = model ?? getDefaultResNet18();
  const patch = extractCrop(
    matrix,
    detection.apexSample,
    detection.trace,
    detection.halfWidthTraces,
    detection.halfDepthSamples,
    size
  );
  const { embedding, stageActivations, finalShape } = runResNet18(m, patch, size);
  return { embedding, patch, size, stageActivations, finalShape, trained: m.trained };
}

export const RESNET_ARCH_SUMMARY = {
  input: '32×32×1 normalised anomaly crop',
  stem: 'conv3×3 (1→16) + ReLU + maxpool2×2',
  stages: STAGE_CHANNELS.map((c, i) => `stage${i + 1}: 2× BasicBlock (→${c}ch)${i > 0 ? ', stride2 downsample' : ''}`),
  head: 'global average pool → 128-D embedding',
  totalLayers: 1 + STAGE_CHANNELS.length * BLOCKS_PER_STAGE * 2, // stem + (conv1+conv2)*blocks
};
