// AiG — deepLearningLoader.js
// Phase 3 deep learning inference for GPR B-scan analysis.
// Primary model: U-Net segmentation via ONNX Runtime Web.
// Secondary: CNN classifier (material prediction from hyperbola patch).
//
// Runtime dependency (CDN, loaded lazily — NOT in package.json):
//   https://cdn.jsdelivr.net/npm/onnxruntime-web@1.18.0/dist/ort.min.js
//
// Add to index.html <head> for Phase 3:
//   <script src="https://cdn.jsdelivr.net/npm/onnxruntime-web@1.18.0/dist/ort.min.js"></script>
//
// Model files: place in /public/models/ or serve from remote URL.
//   /public/models/unet_gpr.onnx     — U-Net segmentation (recommended)
//   /public/models/cnn_material.onnx — CNN material classifier (optional)
//
// Workflow:
//   1. loadUNet(path)              → DLModel
//   2. runUNetInference(model, matrix, metadata) → { mask, detections }
//   3. Pass detections to HyperbolaOverlay + ObjectMap (same shape as Detect.jsx output)
//
// For CNN material classification:
//   1. loadCNN(path)               → DLModel
//   2. runCNNInference(model, patch) → { label, confidence, scores }

// ---------------------------------------------------------------------------
// ONNX Runtime loader (lazy — only fetched when Phase 3 is first used)
// ---------------------------------------------------------------------------

let _ort = null

/**
 * Lazily resolve the ONNX Runtime global (`window.ort`).
 * Returns null (with console warning) if the CDN script is not loaded.
 * @returns {object|null} ort namespace
 */
async function getORT() {
  if (_ort) return _ort
  if (typeof window !== 'undefined' && window.ort) {
    _ort = window.ort
    return _ort
  }
  // Try dynamic import as fallback (works in Vite if onnxruntime-web is installed)
  try {
    const mod = await import('onnxruntime-web')
    _ort = mod
    return _ort
  } catch {
    console.warn(
      '[AiG deepLearningLoader] onnxruntime-web not found.\n' +
      'Add to index.html: <script src="https://cdn.jsdelivr.net/npm/onnxruntime-web@1.18.0/dist/ort.min.js"></script>\n' +
      'or install: npm install onnxruntime-web'
    )
    return null
  }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default U-Net input tile size (pixels). Must match model training config. */
export const UNET_TILE_SIZE = 256

/** Default CNN patch size around each detected apex. */
export const CNN_PATCH_SIZE = 64

/** Material labels — must match training label order. */
export const DL_MATERIAL_LABELS = ['metal', 'ceramic', 'bone', 'stone', 'void', 'unknown']

/** Default model paths (relative to /public/). */
export const DEFAULT_MODEL_PATHS = {
  unet: '/models/unet_gpr.onnx',
  cnn:  '/models/cnn_material.onnx',
}

// ---------------------------------------------------------------------------
// Model loading
// ---------------------------------------------------------------------------

/**
 * Load a U-Net ONNX model for GPR B-scan segmentation.
 *
 * @param {string} modelPath  - URL or path to .onnx file (default: DEFAULT_MODEL_PATHS.unet)
 * @param {object} opts
 * @param {string} opts.executionProvider - 'wasm' | 'webgl' | 'webgpu' (default: 'wasm')
 * @returns {Promise<DLModel>}
 */
export async function loadUNet(modelPath = DEFAULT_MODEL_PATHS.unet, opts = {}) {
  return _loadONNXModel('unet', modelPath, opts)
}

/**
 * Load a CNN ONNX model for material classification from hyperbola patches.
 *
 * @param {string} modelPath  - URL or path to .onnx file (default: DEFAULT_MODEL_PATHS.cnn)
 * @param {object} opts
 * @returns {Promise<DLModel>}
 */
export async function loadCNN(modelPath = DEFAULT_MODEL_PATHS.cnn, opts = {}) {
  return _loadONNXModel('cnn', modelPath, opts)
}

async function _loadONNXModel(type, modelPath, opts = {}) {
  const { executionProvider = 'wasm' } = opts
  const ort = await getORT()
  if (!ort) throw new Error('ONNX Runtime not available — see console for setup instructions.')

  let session
  try {
    session = await ort.InferenceSession.create(modelPath, {
      executionProviders: [executionProvider],
      graphOptimizationLevel: 'all',
    })
  } catch (err) {
    throw new Error(`Failed to load ${type} model from "${modelPath}": ${err.message}`)
  }

  // Inspect input/output shapes from model metadata
  const inputNames  = session.inputNames
  const outputNames = session.outputNames

  return {
    type,           // 'unet' | 'cnn'
    session,
    inputNames,
    outputNames,
    modelPath,
    executionProvider,
    loaded: true,
  }
}

// ---------------------------------------------------------------------------
// Pre/post-processing helpers
// ---------------------------------------------------------------------------

/**
 * Convert a GPR B-scan matrix → Float32 ONNX tensor, normalised to [0, 1].
 * Tiles the B-scan into overlapping UNET_TILE_SIZE×UNET_TILE_SIZE patches
 * if the scan is larger than the tile size.
 *
 * Output shape: [1, 1, tileH, tileW]  (batch=1, channels=1, H, W)
 *
 * @param {object} ort            - ONNX Runtime namespace
 * @param {Float32Array[][]} matrix - matrix[sample][trace]
 * @param {number} tileH
 * @param {number} tileW
 * @param {number} offsetS        - sample (row) offset for this tile
 * @param {number} offsetT        - trace (col) offset for this tile
 * @returns {ort.Tensor}
 */
function _matrixTileToTensor(ort, matrix, tileH, tileW, offsetS = 0, offsetT = 0) {
  const samples = matrix.length
  const traces  = matrix[0].length

  // Compute global amplitude range for normalisation
  let globalMin = Infinity, globalMax = -Infinity
  for (let s = 0; s < samples; s++) {
    for (let t = 0; t < traces; t++) {
      const v = matrix[s][t]
      if (v < globalMin) globalMin = v
      if (v > globalMax) globalMax = v
    }
  }
  const range = (globalMax - globalMin) || 1

  const data = new Float32Array(tileH * tileW)
  for (let s = 0; s < tileH; s++) {
    for (let t = 0; t < tileW; t++) {
      const sr = offsetS + s
      const tr = offsetT + t
      const v = (sr < samples && tr < traces) ? matrix[sr][tr] : 0
      data[s * tileW + t] = (v - globalMin) / range
    }
  }

  return new ort.Tensor('float32', data, [1, 1, tileH, tileW])
}

/**
 * Extract a square patch around a detected apex from the B-scan matrix.
 * Used to feed individual hyperbola patches into the CNN classifier.
 *
 * @param {Float32Array[][]} matrix
 * @param {number} apexSample  - row (depth axis)
 * @param {number} apexTrace   - col (distance axis)
 * @param {number} patchSize   - CNN_PATCH_SIZE (square)
 * @returns {Float32Array}     - flat [patchSize × patchSize], normalised [0,1]
 */
export function extractPatch(matrix, apexSample, apexTrace, patchSize = CNN_PATCH_SIZE) {
  const half    = Math.floor(patchSize / 2)
  const samples = matrix.length
  const traces  = matrix[0].length

  let min = Infinity, max = -Infinity
  const patch = new Float32Array(patchSize * patchSize)

  // First pass: read values + track range
  for (let ds = 0; ds < patchSize; ds++) {
    for (let dt = 0; dt < patchSize; dt++) {
      const s = apexSample - half + ds
      const t = apexTrace  - half + dt
      const v = (s >= 0 && s < samples && t >= 0 && t < traces) ? matrix[s][t] : 0
      patch[ds * patchSize + dt] = v
      if (v < min) min = v
      if (v > max) max = v
    }
  }

  // Second pass: normalise [0, 1]
  const range = (max - min) || 1
  for (let i = 0; i < patch.length; i++) patch[i] = (patch[i] - min) / range
  return patch
}

// ---------------------------------------------------------------------------
// U-Net inference → segmentation mask → detections
// ---------------------------------------------------------------------------

/**
 * Run U-Net segmentation on a full B-scan matrix.
 * Tiles the scan, runs inference per tile, stitches output mask back together.
 *
 * @param {DLModel}          model
 * @param {Float32Array[][]} matrix    - matrix[sample][trace]
 * @param {object}           metadata  - { traces, samples, dt_ns, dx_m }
 * @param {object}           opts
 * @param {number} opts.tileSize       - square tile size (default UNET_TILE_SIZE)
 * @param {number} opts.overlap        - overlap between tiles in px (default 32)
 * @param {number} opts.threshold      - sigmoid threshold for foreground (default 0.5)
 * @param {Function} opts.onProgress   - callback(tilesComplete, tilesTotal)
 * @returns {Promise<UNetResult>}
 */
export async function runUNetInference(model, matrix, metadata, opts = {}) {
  if (!model?.loaded) throw new Error('Model not loaded — call loadUNet() first.')

  const ort = await getORT()
  const {
    tileSize    = UNET_TILE_SIZE,
    overlap     = 32,
    threshold   = 0.5,
    onProgress  = null,
  } = opts

  const samples = matrix.length
  const traces  = matrix[0].length

  // Full output mask (same dimensions as input)
  const mask    = new Float32Array(samples * traces) // flat [sample * traces + trace]
  const counts  = new Float32Array(samples * traces) // for overlap averaging

  // Tile grid
  const stride  = tileSize - overlap
  const tileRowStarts = _tileStarts(samples, tileSize, stride)
  const tileColStarts = _tileStarts(traces,  tileSize, stride)
  const totalTiles = tileRowStarts.length * tileColStarts.length
  let tilesDone = 0

  for (const offsetS of tileRowStarts) {
    for (const offsetT of tileColStarts) {
      const inputTensor = _matrixTileToTensor(ort, matrix, tileSize, tileSize, offsetS, offsetT)

      const feeds = { [model.inputNames[0]]: inputTensor }
      const results = await model.session.run(feeds)
      const output  = results[model.outputNames[0]]

      // Output shape expected: [1, 1, tileSize, tileSize] — sigmoid logits or probabilities
      const outData = output.data // Float32Array

      for (let ds = 0; ds < tileSize; ds++) {
        for (let dt = 0; dt < tileSize; dt++) {
          const s = offsetS + ds
          const t = offsetT + dt
          if (s >= samples || t >= traces) continue
          const idx    = s * traces + t
          const outIdx = ds * tileSize + dt
          // Apply sigmoid if model outputs raw logits
          const prob = _sigmoid(outData[outIdx])
          mask[idx]   += prob
          counts[idx] += 1
        }
      }

      tilesDone++
      if (onProgress) onProgress(tilesDone, totalTiles)
    }
  }

  // Average overlapping regions
  for (let i = 0; i < mask.length; i++) {
    mask[i] = counts[i] > 0 ? mask[i] / counts[i] : 0
  }

  // Threshold → binary mask
  const binaryMask = Uint8Array.from(mask, (v) => (v >= threshold ? 1 : 0))

  // Extract detections from connected components in binary mask
  const detections = _maskToDetections(binaryMask, samples, traces, metadata)

  return {
    mask,        // Float32Array — raw probability map [samples × traces]
    binaryMask,  // Uint8Array   — thresholded mask
    detections,  // Detection[]  — same shape as Detect.jsx output
    modelType: 'unet',
    tileSize,
    threshold,
  }
}

// ---------------------------------------------------------------------------
// CNN inference → material classification
// ---------------------------------------------------------------------------

/**
 * Run CNN material classifier on a hyperbola patch.
 *
 * @param {DLModel}    model
 * @param {Float32Array} patch  - flat [patchSize × patchSize], from extractPatch()
 * @param {number}     patchSize
 * @returns {Promise<{ label, confidence, scores }>}
 */
export async function runCNNInference(model, patch, patchSize = CNN_PATCH_SIZE) {
  if (!model?.loaded) throw new Error('CNN model not loaded — call loadCNN() first.')

  const ort = await getORT()

  const inputTensor = new ort.Tensor('float32', patch, [1, 1, patchSize, patchSize])
  const feeds   = { [model.inputNames[0]]: inputTensor }
  const results = await model.session.run(feeds)
  const output  = results[model.outputNames[0]]

  // Expected output: [1, nClasses] logits or softmax probabilities
  const logits = Array.from(output.data)
  const probs  = _softmax(logits)

  const maxIdx    = probs.indexOf(Math.max(...probs))
  const label     = DL_MATERIAL_LABELS[maxIdx] ?? 'unknown'
  const confidence = probs[maxIdx]

  const scores = {}
  DL_MATERIAL_LABELS.forEach((l, i) => { scores[l] = probs[i] ?? 0 })

  return { label, confidence, scores, modelType: 'cnn' }
}

// ---------------------------------------------------------------------------
// Unified runInference entry point (for useModel.js integration)
// ---------------------------------------------------------------------------

/**
 * Unified inference entry point — dispatches to U-Net or CNN based on model.type.
 * Called by useModel.js when model type is 'unet' or 'cnn'.
 *
 * @param {DLModel}          model
 * @param {Float32Array[][]} matrix    - full B-scan matrix (for unet) or patch (for cnn)
 * @param {object}           metadata
 * @param {object}           opts
 * @returns {Promise<UNetResult | CNNResult>}
 */
export async function runInference(model, matrix, metadata, opts = {}) {
  if (!model?.loaded) throw new Error('Deep learning model not loaded.')
  if (model.type === 'unet') return runUNetInference(model, matrix, metadata, opts)
  if (model.type === 'cnn')  return runCNNInference(model, matrix, opts.patchSize)
  throw new Error(`Unknown DL model type: "${model.type}"`)
}

// ---------------------------------------------------------------------------
// isONNXAvailable — guard for UI phase gating
// ---------------------------------------------------------------------------

/**
 * Check if ONNX Runtime is available in this environment.
 * Use in ModelSelector.jsx / Detect.jsx to show/hide Phase 3 options.
 *
 * @returns {Promise<boolean>}
 */
export async function isONNXAvailable() {
  const ort = await getORT()
  return ort !== null
}

// ---------------------------------------------------------------------------
// Connected component labelling → Detection[] objects
// ---------------------------------------------------------------------------

/**
 * Convert binary segmentation mask to Detection objects.
 * Uses 4-connected flood fill to label components, then computes bounding box
 * per component → maps to the Detection shape used by HyperbolaOverlay + ObjectMap.
 *
 * @param {Uint8Array}  binaryMask  - flat [samples × traces]
 * @param {number}      samples
 * @param {number}      traces
 * @param {object}      metadata    - { dt_ns, dx_m }
 * @returns {Detection[]}
 */
function _maskToDetections(binaryMask, samples, traces, metadata) {
  const { dt_ns = 0.2, dx_m = 0.02 } = metadata ?? {}
  const velocity = 0.1 // m/ns default — should come from useSettings() in calling page

  const labels  = new Int32Array(samples * traces).fill(-1)
  let nextLabel = 0

  // 4-connected BFS flood fill
  for (let s = 0; s < samples; s++) {
    for (let t = 0; t < traces; t++) {
      const idx = s * traces + t
      if (binaryMask[idx] !== 1 || labels[idx] !== -1) continue

      const queue = [idx]
      labels[idx] = nextLabel

      while (queue.length > 0) {
        const cur = queue.pop()
        const cs  = Math.floor(cur / traces)
        const ct  = cur % traces

        for (const [ns, nt] of [[cs-1,ct],[cs+1,ct],[cs,ct-1],[cs,ct+1]]) {
          if (ns < 0 || ns >= samples || nt < 0 || nt >= traces) continue
          const nidx = ns * traces + nt
          if (binaryMask[nidx] !== 1 || labels[nidx] !== -1) continue
          labels[nidx] = nextLabel
          queue.push(nidx)
        }
      }
      nextLabel++
    }
  }

  if (nextLabel === 0) return []

  // Compute bounding box per component
  const boxes = Array.from({ length: nextLabel }, () => ({
    minS: Infinity, maxS: -Infinity,
    minT: Infinity, maxT: -Infinity,
    pixelCount: 0,
  }))

  for (let s = 0; s < samples; s++) {
    for (let t = 0; t < traces; t++) {
      const lbl = labels[s * traces + t]
      if (lbl === -1) continue
      const b = boxes[lbl]
      if (s < b.minS) b.minS = s
      if (s > b.maxS) b.maxS = s
      if (t < b.minT) b.minT = t
      if (t > b.maxT) b.maxT = t
      b.pixelCount++
    }
  }

  // Filter tiny noise components (< 16 pixels) and convert to Detection shape
  return boxes
    .filter((b) => b.pixelCount >= 16)
    .map((b, i) => {
      const apexSample = b.minS                          // top of hyperbola = shallowest point
      const apexTrace  = Math.round((b.minT + b.maxT) / 2)
      const depth_ns   = apexSample * dt_ns
      const depth_m    = (depth_ns * velocity) / 2
      const position_m = apexTrace * (dx_m ?? 0.02)
      const widthTraces = b.maxT - b.minT + 1
      const heightSamples = b.maxS - b.minS + 1

      return {
        id:             `dl_${i}`,
        trace:          apexTrace,
        position_m:     +position_m.toFixed(3),
        depth_ns:       +depth_ns.toFixed(2),
        depth_m:        +depth_m.toFixed(3),
        size_width_cm:  +(widthTraces * (dx_m ?? 0.02) * 100).toFixed(1),
        size_height_cm: +(heightSamples * dt_ns * velocity / 2 * 100).toFixed(1),
        features:       new Float32Array(6).fill(0), // placeholder — CNN fills this
        hyperbola: {
          curvature:    0,   // not computed from mask — CNN or classical step fills
          amplitude:    0,
          width_traces: widthTraces,
        },
        source: 'unet',     // tag so Detect.jsx / Results.jsx can show model provenance
        bbox: {             // pixel bbox for HyperbolaOverlay (maps to canvas coords)
          x: b.minT, y: b.minS,
          width: widthTraces, height: heightSamples,
        },
      }
    })
}

// ---------------------------------------------------------------------------
// Math helpers
// ---------------------------------------------------------------------------

const _sigmoid = (x) => 1 / (1 + Math.exp(-x))

function _softmax(logits) {
  const max  = Math.max(...logits)
  const exps = logits.map((v) => Math.exp(v - max))
  const sum  = exps.reduce((a, b) => a + b, 0)
  return exps.map((v) => v / sum)
}

/** Compute tile start offsets for a given dimension, stride, and tile size. */
function _tileStarts(totalLen, tileSize, stride) {
  const starts = []
  for (let s = 0; s < totalLen; s += stride) {
    starts.push(Math.min(s, Math.max(0, totalLen - tileSize)))
    if (s + tileSize >= totalLen) break
  }
  return [...new Set(starts)] // deduplicate when scan smaller than tile
}

// ---------------------------------------------------------------------------
// JSDoc typedefs
// ---------------------------------------------------------------------------

/**
 * @typedef {object} DLModel
 * @property {'unet'|'cnn'}   type
 * @property {object}         session         - ort.InferenceSession
 * @property {string[]}       inputNames
 * @property {string[]}       outputNames
 * @property {string}         modelPath
 * @property {string}         executionProvider
 * @property {true}           loaded
 */

/**
 * @typedef {object} UNetResult
 * @property {Float32Array}  mask         - probability map, flat [samples × traces]
 * @property {Uint8Array}    binaryMask   - thresholded mask
 * @property {Detection[]}   detections   - extracted objects (same shape as Detect.jsx)
 * @property {'unet'}        modelType
 * @property {number}        tileSize
 * @property {number}        threshold
 */

/**
 * @typedef {object} CNNResult
 * @property {string}        label
 * @property {number}        confidence   - 0–1
 * @property {object}        scores       - { [material]: probability }
 * @property {'cnn'}         modelType
 */
