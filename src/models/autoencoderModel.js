// AiG — autoencoderModel.js
// Unsupervised autoencoder for GPR clutter removal and feature compression.
// Pure JS — no external ML library. Manual forward/backward pass.
//
// Architecture: Encoder → Bottleneck → Decoder (symmetric MLP)
//   Input dim  : inputDim  (= samples per trace, e.g. 512)
//   Hidden 1   : hiddenDim (default 128)
//   Bottleneck  : latentDim (default 32)
//   Hidden 2   : hiddenDim (mirror)
//   Output dim : inputDim  (reconstruct input)
//
// Training strategy for GPR:
//   - Feed INDIVIDUAL TRACES (columns of the B-scan matrix) as training vectors.
//   - Clutter is repetitive across traces → autoencoder learns to reconstruct it well.
//   - Buried object hyperbolas are rare + non-repetitive → high reconstruction error.
//   - reconstructionError() per trace is therefore an ANOMALY SCORE for object detection.
//
// Usage (see §6ak in BRAIN.md):
//   const model = trainAutoencoder(matrix, { epochs: 50 })
//   const { cleanMatrix, errorMap } = removeClutter(model, matrix)
//   const latent = encode(model, traceVector)
//   const reconstructed = decode(model, latent)
//   const score = reconstructionError(traceVector, reconstructed)

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Seeded LCG pseudo-random (reproducible weight init) */
function makeLCG(seed = 42) {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0
    return s / 0xffffffff
  }
}

/** Xavier uniform initialiser for weight matrix [rows][cols] */
function xavierMatrix(rows, cols, rng) {
  const limit = Math.sqrt(6 / (rows + cols))
  return Array.from({ length: rows }, () =>
    Float64Array.from({ length: cols }, () => (rng() * 2 - 1) * limit)
  )
}

/** Zero vector */
const zeros = (n) => new Float64Array(n)

/** ReLU activation */
const relu = (x) => Math.max(0, x)
const reluGrad = (x) => (x > 0 ? 1 : 0)

/** Linear (identity) — used for output layer so amplitude range is unconstrained */
const linear = (x) => x
const linearGrad = () => 1

/** Dot product: weight matrix (W[out][in]) × input vector → output vector */
function matVec(W, x) {
  const out = new Float64Array(W.length)
  for (let i = 0; i < W.length; i++) {
    let sum = 0
    for (let j = 0; j < x.length; j++) sum += W[i][j] * x[j]
    out[i] = sum
  }
  return out
}

/** Add bias in-place, apply activation, return { pre, post } for backprop */
function layerForward(W, b, x, activation) {
  const pre = matVec(W, x)
  for (let i = 0; i < pre.length; i++) pre[i] += b[i]
  const post = Float64Array.from(pre, activation)
  return { pre, post }
}

/** Clip gradient to prevent exploding */
const clip = (v, limit = 5) => Math.max(-limit, Math.min(limit, v))

// ---------------------------------------------------------------------------
// Normalisation helpers (per-trace z-score, stored in model for decode)
// ---------------------------------------------------------------------------

function normStats(traces) {
  // traces: Float64Array[] — one per column
  const n = traces[0].length
  const mean = new Float64Array(n)
  const std = new Float64Array(n)
  for (const t of traces) for (let i = 0; i < n; i++) mean[i] += t[i]
  for (let i = 0; i < n; i++) mean[i] /= traces.length
  for (const t of traces) for (let i = 0; i < n; i++) std[i] += (t[i] - mean[i]) ** 2
  for (let i = 0; i < n; i++) std[i] = Math.sqrt(std[i] / traces.length) || 1e-8
  return { mean, std }
}

function normalise(trace, mean, std) {
  return Float64Array.from(trace, (v, i) => (v - mean[i]) / std[i])
}

function denormalise(trace, mean, std) {
  return Float64Array.from(trace, (v, i) => v * std[i] + mean[i])
}

// ---------------------------------------------------------------------------
// trainAutoencoder
// ---------------------------------------------------------------------------

/**
 * Train a symmetric MLP autoencoder on a GPR B-scan matrix.
 *
 * @param {Float32Array[][]} matrix  - matrix[sample][trace], B-scan amplitudes
 * @param {object}           opts
 * @param {number}  opts.latentDim   - bottleneck size          (default 32)
 * @param {number}  opts.hiddenDim   - encoder/decoder width    (default 128)
 * @param {number}  opts.epochs      - training iterations      (default 60)
 * @param {number}  opts.lr          - learning rate            (default 1e-3)
 * @param {number}  opts.seed        - RNG seed for repro       (default 42)
 * @param {Function} opts.onProgress - callback(epoch, loss) for StatusBar
 * @returns {AutoencoderModel}
 */
export function trainAutoencoder(matrix, opts = {}) {
  const {
    latentDim = 32,
    hiddenDim = 128,
    epochs = 60,
    lr = 1e-3,
    seed = 42,
    onProgress = null,
  } = opts

  const samples = matrix.length
  const traces = matrix[0].length
  const inputDim = samples // each trace is a column vector of length = samples

  // ── Extract traces as Float64Array columns ──────────────────────────────
  const traceVectors = Array.from({ length: traces }, (_, t) =>
    Float64Array.from({ length: samples }, (_, s) => matrix[s][t])
  )

  // ── Normalise ────────────────────────────────────────────────────────────
  const { mean: normMean, std: normStd } = normStats(traceVectors)
  const normTraces = traceVectors.map((t) => normalise(t, normMean, normStd))

  // ── Weight initialisation ────────────────────────────────────────────────
  const rng = makeLCG(seed)

  // Encoder: inputDim → hiddenDim → latentDim
  const W1 = xavierMatrix(hiddenDim, inputDim, rng)
  const b1 = zeros(hiddenDim)
  const W2 = xavierMatrix(latentDim, hiddenDim, rng)
  const b2 = zeros(latentDim)

  // Decoder: latentDim → hiddenDim → inputDim
  const W3 = xavierMatrix(hiddenDim, latentDim, rng)
  const b3 = zeros(hiddenDim)
  const W4 = xavierMatrix(inputDim, hiddenDim, rng)
  const b4 = zeros(inputDim)

  // Adam optimiser state
  const adamState = _initAdam([W1, b1, W2, b2, W3, b3, W4, b4])

  // ── Training loop ────────────────────────────────────────────────────────
  let t = 0 // Adam step counter

  for (let epoch = 0; epoch < epochs; epoch++) {
    let epochLoss = 0

    // Shuffle trace indices
    const idx = Array.from({ length: traces }, (_, i) => i)
    _shuffleInPlace(idx, rng)

    for (const i of idx) {
      const x = normTraces[i]

      // ── Forward pass ──────────────────────────────────────────────────
      const l1 = layerForward(W1, b1, x, relu)        // hidden enc
      const l2 = layerForward(W2, b2, l1.post, relu)  // latent
      const l3 = layerForward(W3, b3, l2.post, relu)  // hidden dec
      const l4 = layerForward(W4, b4, l3.post, linear) // output

      // MSE loss
      const diff = Float64Array.from(l4.post, (v, j) => v - x[j])
      epochLoss += diff.reduce((s, v) => s + v * v, 0) / inputDim

      // ── Backward pass ─────────────────────────────────────────────────
      t++

      // dL/d(output pre-activation) = 2*(out - x)/n * linearGrad
      const dL4 = Float64Array.from(diff, (v, j) =>
        clip((2 * v / inputDim) * linearGrad(l4.pre[j]))
      )

      // Grads for W4, b4
      const { dW: dW4, db: db4, dx: dL3a } = _backpropLayer(W4, dL4, l3.post)
      const dL3 = Float64Array.from(dL3a, (v, j) =>
        clip(v * reluGrad(l3.pre[j]))
      )

      const { dW: dW3, db: db3, dx: dL2a } = _backpropLayer(W3, dL3, l2.post)
      const dL2 = Float64Array.from(dL2a, (v, j) =>
        clip(v * reluGrad(l2.pre[j]))
      )

      const { dW: dW2, db: db2, dx: dL1a } = _backpropLayer(W2, dL2, l1.post)
      const dL1 = Float64Array.from(dL1a, (v, j) =>
        clip(v * reluGrad(l1.pre[j]))
      )

      const { dW: dW1, db: db1 } = _backpropLayer(W1, dL1, x)

      // Adam update
      _adamUpdate(
        [W1, b1, W2, b2, W3, b3, W4, b4],
        [dW1, db1, dW2, db2, dW3, db3, dW4, db4],
        adamState, t, lr
      )
    }

    if (onProgress) onProgress(epoch + 1, epochLoss / traces)
  }

  return {
    type: 'autoencoder',
    inputDim,
    hiddenDim,
    latentDim,
    epochs,
    W1, b1, W2, b2, W3, b3, W4, b4,
    normMean,
    normStd,
  }
}

// ---------------------------------------------------------------------------
// encode / decode / reconstructionError
// ---------------------------------------------------------------------------

/**
 * Encode a single trace vector to its latent representation.
 *
 * @param {AutoencoderModel} model
 * @param {Float32Array|Float64Array} traceVector  - length = model.inputDim
 * @returns {Float64Array}  latent vector, length = model.latentDim
 */
export function encode(model, traceVector) {
  const { W1, b1, W2, b2, normMean, normStd } = model
  const x = normalise(traceVector, normMean, normStd)
  const l1 = layerForward(W1, b1, x, relu)
  const l2 = layerForward(W2, b2, l1.post, relu)
  return l2.post
}

/**
 * Decode a latent vector back to a trace vector (in original amplitude space).
 *
 * @param {AutoencoderModel} model
 * @param {Float64Array} latent  - length = model.latentDim
 * @returns {Float64Array}  reconstructed trace, length = model.inputDim
 */
export function decode(model, latent) {
  const { W3, b3, W4, b4, normMean, normStd } = model
  const l3 = layerForward(W3, b3, latent, relu)
  const l4 = layerForward(W4, b4, l3.post, linear)
  return denormalise(l4.post, normMean, normStd)
}

/**
 * Mean squared error between original and reconstructed trace.
 * High error → trace contains anomaly (buried object hyperbola).
 * Low error  → trace is repetitive clutter (air wave, ringing).
 *
 * @param {Float32Array|Float64Array} original
 * @param {Float64Array}              reconstructed
 * @returns {number}  MSE anomaly score ≥ 0
 */
export function reconstructionError(original, reconstructed) {
  let mse = 0
  for (let i = 0; i < original.length; i++) {
    mse += (original[i] - reconstructed[i]) ** 2
  }
  return mse / original.length
}

// ---------------------------------------------------------------------------
// removeClutter  (main GPR processing function)
// ---------------------------------------------------------------------------

/**
 * Apply trained autoencoder to a B-scan matrix to remove repetitive clutter.
 *
 * Strategy:
 *   - For each trace: reconstruct via encode→decode.
 *   - cleanMatrix[s][t] = original[s][t] − reconstructed[s][t]
 *     (subtracts what the autoencoder "understood" = clutter)
 *   - errorMap[t] = reconstructionError per trace (anomaly score map)
 *
 * @param {AutoencoderModel}  model
 * @param {Float32Array[][]}  matrix   - matrix[sample][trace]
 * @param {object}            opts
 * @param {number} opts.threshold      - error percentile above which traces are
 *                                       treated as containing objects (0–1, default 0.75)
 * @returns {{ cleanMatrix: Float32Array[][], errorMap: Float32Array, anomalyMask: Uint8Array }}
 */
export function removeClutter(model, matrix, opts = {}) {
  const { threshold = 0.75 } = opts
  const samples = matrix.length
  const traces = matrix[0].length

  const cleanMatrix = Array.from({ length: samples }, () => new Float32Array(traces))
  const errorMap = new Float32Array(traces)

  for (let t = 0; t < traces; t++) {
    // Extract column
    const traceVec = Float64Array.from({ length: samples }, (_, s) => matrix[s][t])

    // Encode → decode (clutter estimate)
    const latent = encode(model, traceVec)
    const reconstructed = decode(model, latent)

    // Residual = anomaly signal (hyperbolas remain, clutter removed)
    for (let s = 0; s < samples; s++) {
      cleanMatrix[s][t] = traceVec[s] - reconstructed[s]
    }

    errorMap[t] = reconstructionError(traceVec, reconstructed)
  }

  // Build binary anomaly mask at given percentile threshold
  const sorted = Float32Array.from(errorMap).sort()
  const cutoff = sorted[Math.floor(threshold * (traces - 1))]
  const anomalyMask = Uint8Array.from(errorMap, (e) => (e >= cutoff ? 1 : 0))

  return { cleanMatrix, errorMap, anomalyMask }
}

// ---------------------------------------------------------------------------
// autoencoderStep  (usePreprocessing STEP_DEFS adapter)
// ---------------------------------------------------------------------------

/**
 * Thin wrapper matching usePreprocessing STEP_DEFS.run(matrix, params) signature.
 * Trains a fresh autoencoder on the given matrix and returns cleanMatrix.
 *
 * Add to STEP_DEFS in usePreprocessing.js:
 * ```js
 * import { autoencoderStep } from '../models/autoencoderModel'
 * autoencoder: {
 *   label: 'Autoencoder Clutter Removal',
 *   description: 'Trains a neural autoencoder on traces; subtracts learnt clutter.',
 *   defaultParams: { epochs: 40, latentDim: 32, hiddenDim: 128 },
 *   run: (matrix, params, metadata) => autoencoderStep(matrix, params, metadata),
 * }
 * ```
 *
 * @param {Float32Array[][]} matrix
 * @param {{ epochs?: number, latentDim?: number, hiddenDim?: number }} params
 * @returns {Float32Array[][]}  cleanMatrix
 */
export function autoencoderStep(matrix, params = {}) {
  const { epochs = 40, latentDim = 32, hiddenDim = 128 } = params
  const model = trainAutoencoder(matrix, { epochs, latentDim, hiddenDim })
  const { cleanMatrix } = removeClutter(model, matrix)
  return cleanMatrix
}

// ---------------------------------------------------------------------------
// compressFeatures  (for DB matching in Classify.jsx / knn.js)
// ---------------------------------------------------------------------------

/**
 * Compress a feature vector (or trace) to latent space for DB matching.
 * Used as an alternative to raw knn.extractFeatures — gives a denser,
 * learned representation for cosine similarity search.
 *
 * @param {AutoencoderModel}          model
 * @param {Float32Array|Float64Array} featureVector
 * @returns {Float64Array}  latent vector (length = model.latentDim)
 */
export function compressFeatures(model, featureVector) {
  return encode(model, featureVector)
}

// ---------------------------------------------------------------------------
// Adam optimiser (internal)
// ---------------------------------------------------------------------------

function _initAdam(params) {
  return params.map((p) => {
    if (p instanceof Float64Array) {
      return { m: new Float64Array(p.length), v: new Float64Array(p.length) }
    }
    // 2D array
    return p.map((row) => ({
      m: new Float64Array(row.length),
      v: new Float64Array(row.length),
    }))
  })
}

function _adamUpdate(params, grads, state, t, lr, beta1 = 0.9, beta2 = 0.999, eps = 1e-8) {
  const bc1 = 1 - beta1 ** t
  const bc2 = 1 - beta2 ** t

  for (let pi = 0; pi < params.length; pi++) {
    const p = params[pi]
    const g = grads[pi]
    const s = state[pi]

    if (p instanceof Float64Array) {
      for (let i = 0; i < p.length; i++) {
        s.m[i] = beta1 * s.m[i] + (1 - beta1) * g[i]
        s.v[i] = beta2 * s.v[i] + (1 - beta2) * g[i] * g[i]
        p[i] -= lr * (s.m[i] / bc1) / (Math.sqrt(s.v[i] / bc2) + eps)
      }
    } else {
      // 2D weight matrix
      for (let i = 0; i < p.length; i++) {
        for (let j = 0; j < p[i].length; j++) {
          s[i].m[j] = beta1 * s[i].m[j] + (1 - beta1) * g[i][j]
          s[i].v[j] = beta2 * s[i].v[j] + (1 - beta2) * g[i][j] * g[i][j]
          p[i][j] -= lr * (s[i].m[j] / bc1) / (Math.sqrt(s[i].v[j] / bc2) + eps)
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Backprop helper
// ---------------------------------------------------------------------------

/**
 * Compute gradients for one fully-connected layer.
 * W[out][in], delta[out], x[in] → dW[out][in], db[out], dx[in]
 */
function _backpropLayer(W, delta, x) {
  const outDim = W.length
  const inDim = x.length

  const dW = Array.from({ length: outDim }, (_, i) =>
    Float64Array.from({ length: inDim }, (_, j) => clip(delta[i] * x[j]))
  )
  const db = Float64Array.from(delta, (v) => clip(v))
  const dx = new Float64Array(inDim)
  for (let j = 0; j < inDim; j++) {
    for (let i = 0; i < outDim; i++) dx[j] += W[i][j] * delta[i]
    dx[j] = clip(dx[j])
  }
  return { dW, db, dx }
}

// ---------------------------------------------------------------------------
// Fisher-Yates shuffle (LCG-seeded)
// ---------------------------------------------------------------------------

function _shuffleInPlace(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]]
  }
}

// ---------------------------------------------------------------------------
// JSDoc typedef (for BRAIN.md §6ak reference)
// ---------------------------------------------------------------------------

/**
 * @typedef {object} AutoencoderModel
 * @property {'autoencoder'} type
 * @property {number}        inputDim
 * @property {number}        hiddenDim
 * @property {number}        latentDim
 * @property {number}        epochs
 * @property {Array}         W1   encoder hidden weights [hiddenDim][inputDim]
 * @property {Float64Array}  b1   encoder hidden bias
 * @property {Array}         W2   encoder latent weights [latentDim][hiddenDim]
 * @property {Float64Array}  b2   encoder latent bias
 * @property {Array}         W3   decoder hidden weights [hiddenDim][latentDim]
 * @property {Float64Array}  b3   decoder hidden bias
 * @property {Array}         W4   decoder output weights [inputDim][hiddenDim]
 * @property {Float64Array}  b4   decoder output bias
 * @property {Float64Array}  normMean  per-sample mean for z-score normalisation
 * @property {Float64Array}  normStd   per-sample std  for z-score normalisation
 */
