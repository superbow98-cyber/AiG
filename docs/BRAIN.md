# AiG — BRAIN.md
### The single source of truth for AiG's architecture, contracts, and data shapes.

> **Reconstruction notice.** Source files throughout this repo reference a
> `BRAIN.md` by section number (`§5`, `§6a`, `§6h`, `§6i`, `§6ak`, `§6ao`,
> `§6aq`, ...) as their contract of record, but no such file was present in
> the project archive this document was built from. This is a **fresh
> reconstruction**, assembled by reading every `Contract`, `Consumed by`,
> `Reads:`/`Passes:`, and `LOCKED SPEC` comment in the codebase and
> formalising them here. Section numbers already referenced in code are
> preserved exactly so existing comments stay correct; everything else is
> organised to fit around them. If an original BRAIN.md turns up, reconcile
> against it — this one does not claim to be authoritative history, only an
> accurate map of the code as it stands, version 1.0.

---

## 0 · How to use this document

- Every page/hook/model file that matters states its **Reads / Passes /
  Consumed by** contract in its own header comment. BRAIN.md is where those
  contracts get named, numbered, and cross-referenced.
- `§N` section numbers are cited from code comments — grep for `§6h` etc. to
  jump straight to the file enforcing that contract.
- **LOCKED SPEC** sections (`§6ao` Navbar, `§6aq` Dashboard, ...) mark pages
  whose visual design is considered final — don't restyle them without
  updating this doc.
- New work (Phase 3–5, added in this session) lives under **§7**, kept
  separate from the reconstructed §1–§6 so it's obvious which parts are
  original-app history and which are new AI Research Lab additions.

---

## §1 · System overview

```
React 18 + Vite 5 + Tailwind 3, client-only SPA
react-router-dom v6 for routing, all pages share <Layout> (Navbar + Sidebar)
Supabase (Postgres + Auth + Realtime) for cloud persistence — optional;
  app boots and runs fully in Guest Mode with no .env configured
No server-side compute — every model in src/models/ is a pure-JS
  forward pass that runs in the browser. "Training" (where implemented)
  also runs client-side over whatever's in the Supabase reference DB.
```

**Directory map**
```
src/
  App.jsx            route table
  context/            AuthContext.jsx (Google OAuth + Guest mode)
  components/         shared UI (BScanViewer, ObjectMap, Sidebar, ...)
  hooks/               useGPRData, usePreprocessing, useModel, useResults
  models/              one file per algorithm — hand-implemented, no ML
                        framework dependency (see §6 and §7)
  pages/               one file per route, each documents its own
                        Reads / Passes / Consumed-by contract
  utils/               signalProcessing, depthCalc, colormap, gprParser,
                        exportResults, fileHelpers, metrics
  lib/                 supabase.js (client), db.js (query helpers)
```

---

## §2 · Pipeline & navigation

The Sidebar groups routes by the PhD 5-stage unified framework — the nav
structure *is* the mental model of the app:

```
Stage 1 · Survey     /upload /batch /preprocess /visualise /detect
Stage 2 · Predict     /classify /cluster
Stage 3–4 · Confirm & Map   /results /database
Stage 5 · Validate    /validate
AI Research Lab       /resnet-spatial /xrf-workspace /fusion-engine   ← §7, new
Collaborate            /connections /datasets
```

**Canonical happy path** (state passed hop-to-hop via `react-router`
`location.state`, since GPR matrices are too large for the URL and
`useResults.js` sessionStorage is the refresh-safe fallback):

```
Upload (.DZT/.dt2/.sgy)
  → matrix, metadata, format, velocity, scanId
Preprocess (dewow / bg-removal / gain / bandpass / PCA / ICA)
  → processedMatrix, steps[]
Visualise (B-scan render, colormap, depth scale)
  → (pass-through)
Detect (peak-picking + SVM target/noise)
  → detections[] (see §5 Detection shape)
Classify (k-NN / ensemble / classical ML vs gpr_xrf_records)
  → classifiedDetections[] (adds material, confidence, xrf_elements)
Cluster (K-Means / DBSCAN / SOM)
  → detections with clusterLabel
Results (report, PDF/CSV/JSON export — §6i)
Validate (accuracy against ground truth, if available)

  ⤷ NEW branch, opt-in, does not replace the path above:
Detect → "Analyze in AI Research Lab" → ResNet-18 Spatial AI (§7a)
                                          ↘
XRF AI Workspace (§7b) ─────────────────→ Fusion Engine (§7c)
```

---

## §3 · Auth & roles

`AuthContext.jsx` — two modes, **unchanged by this session's work**:
- **Google OAuth** via Supabase → full cloud persistence.
- **Guest mode** (`localStorage['aig_guest_mode']`) → full pipeline works,
  cloud-save (Supabase writes) silently no-ops.

There is currently **no role system** (no `researcher` / `admin` distinction
in `profiles`). The original PhD-platform brief calls for
Normal user / Researcher / Admin tiers; that does not exist yet. The AI
Research Lab pages (§7) are reachable by any signed-in or guest user today.
**Do not add role gating by touching AuthContext.jsx** — the correct,
additive path is a `role` column on `profiles` (see §4) checked at the
route/sidebar level, planned but not yet built (tracked in §7, Roadmap).

---

## §4 · Database (Supabase / Postgres)

Full column list: `docs/DATABASE_SCHEMA.md`. Summary relevant to this brain:

| Table | Purpose |
|---|---|
| `gpr_scans` | raw + processed B-scan matrices per upload |
| `gpr_xrf_records` | the GPR+XRF reference DB — the thing Classify.jsx and knn.js match against |
| `profiles`, `datasets`, `user_connections`, `dataset_shares`, `dataset_messages` | collaboration layer |

`gpr_xrf_records` **already has v2 columns anticipating §7's fusion
pipeline** — `gpr_features` (jsonb), `xrf_features` (jsonb), `fusion_output`
(jsonb), `ai_prediction`, `confidence`, `predicted_material`,
`predicted_confidence`. §7's embeddings are designed to slot into
`gpr_features`/`xrf_features` directly with no schema change:
`gpr_features = Array.from(resnetEmbedding)` (128 floats),
`xrf_features = Array.from(xrfEmbedding)` (32 floats),
`fusion_output = { fusion, gprOnly, xrfOnly }` from `fusionEngine.predictMaterial()`.
No migration is needed for §7a–§7c; one *will* be needed for §7d–§7i
(Detection Lab model-selector persistence, Experiment Manager, Dataset
Manager provenance columns, StyleGAN2 synthetic-record flag) — see Roadmap.

---

## §5 · Core data shapes

**Detection** (built by `Detect.jsx::buildDetections`, flows through
Classify/Cluster/Results):
```ts
{
  id: string,                // "det-0"
  trace: number, apexSample: number,
  position_m: number, depth_ns: number, depth_m: number,
  size_width_cm: number, size_height_cm: number,
  halfWidthTraces: number, halfDepthSamples: number,
  amplitude: number,
  features: number[],        // 18-element feature vector, models/knn.js
  label: string|null,        // 'target' | 'noise', filled by SVM
  confidence: number|null,
  hyperbola: { amplitude, width_traces, curvature },
  clusterLabel?: string,     // added by Cluster.jsx
}
```

**ClassificationResult** (`BRAIN §5`, cited by `exportResults.js`):
```ts
{
  id, trace, position_m, depth_ns, depth_m, size_width_cm, size_height_cm,
  material: string, confidence: number,
  top_matches: Array<{record, score}>,
  xrf_elements: Record<string, number> | null,
  hyperbola: {...}, features: number[],
}
```

**§7 additions** (new, additive — do not replace the above):
```ts
SpatialEmbeddingResult   // resnet18.js  → §7a
{ embedding: Float32Array(128), patch: Float32Array(1024), size: 32,
  stageActivations: {H,W,C,mean}[], finalShape: {H,W,C}, trained: boolean }

ChemicalEmbeddingResult  // xrfMLP.js    → §7b
{ embedding: Float32Array(32), fingerprint: Record<Element,0..1>,
  importance: Record<Element,0..1>, confidence: number /* input-typicality, NOT a material confidence */,
  trained: boolean }

FusionResult             // fusionEngine.js → §7c
{ fusion: Prediction, gprOnly: Prediction, xrfOnly: Prediction,
  fusedVector: Float32Array(160), trained: boolean }
Prediction = { label: 'metal'|'ceramic'|'lithic'|'soil', confidence: number,
               scores: Record<label, number> }
```

---

## §6 · Reconstructed component/module contracts

Only the sections actually cited by in-repo comments are numbered here;
this is not a complete enumeration of every file (the lettering gaps —
`§6b`–`§6g`, `§6j`–`§6aj`, `§6al`–`§6an`, `§6ap`, `§6ar`+ — belong to files
whose original contract comments don't survive in this archive; infer
from each file's own header if needed).

**§6a — SEG-Y trace-spacing fallback.** SEG-Y files don't carry a reliable
`dx_m` in their header; `metadata.dx_m` is `null` for `.sgy` uploads.
`useGPRData.js` and `Detect.jsx` must use the safe accessor / fallback
constant rather than assuming `metadata.dx_m` is populated.

**§6h — `signalProcessing.js` contract.** Matrix convention:
`matrix[sampleIndex][traceIndex]`, rows = samples (depth/fast-time),
columns = traces (survey position/slow-time). Every exported function
(`backgroundRemoval`, `applyGain(matrix, type, options)`, `bandpassFilter`)
returns a **new** `Float32Array[][]`, never mutates its input. §7's
`resnet18.js::extractCrop` follows the same convention when reading crops
out of this matrix.

**§6i — `exportResults.js` contract.** `generatePDFReport(results, meta)`,
`exportCSV(results, filename)`, `exportJSON(results, filename)`, where
`results: ClassificationResult[]` (§5) and
`meta = { filename, metadata, velocity, scanLengthM }`.

**§6ak — `autoencoderModel.js` usage.** Unsupervised clutter-removal
autoencoder, Phase 2 classical-ML tier (no labelled data required) — not to
be confused with the Phase 3 deep-learning stubs in `deepLearningLoader.js`
or the §7 embedding models, which are architecturally deep nets even though
(like the autoencoder) they currently run with non-learned weights.

**§6ao — `Navbar.jsx` LOCKED SPEC.** Pastel/gold theme, final — see §8 for
the token values. Do not restyle without updating this section.

**§6aq — `Dashboard.jsx` LOCKED SPEC.** Pastel/gold theme + live Supabase
data. Same restriction as §6ao.

**Classical ML inventory (Phase 2, `docs/AI_METHODS.md`)** — PCA, ICA,
Autoencoder, K-Means, DBSCAN, SOM, SVM, Random Forest, XGBoost, k-NN,
Decision Tree, Naïve Bayes, Logistic Regression, AdaBoost, Bayesian
Networks, Fuzzy Logic. All hand-implemented in `src/models/`, all runnable
without labelled training data (k-NN/ensemble need only the reference DB).

**Deep learning inventory (Phase 3, stub status in `useModel.js`)** —
YOLOv5/v8, Faster R-CNN, U-Net, CNN/ResNet/EfficientNet, LSTM/GRU,
ViT/Swin, VAE — routed through `deepLearningLoader.js`, which expects
ONNX Runtime Web (`onnxruntime-web`, CDN-loaded lazily, not in
`package.json`) and model files under `/public/models/*.onnx`. **§7's
ResNet-18/MLP/Fusion models are a parallel, self-contained JS-forward-pass
implementation of part of this same Phase 3/4 ambition** — see §7's
architecture note for why, and how the two paths reconcile.

---

## §7 · AI Research Lab — PhD pipeline (Phase 3–5, NEW)

*Everything in §7 is additive: new files, three new routes, one new
sidebar group, one new link on `Detect.jsx`. Nothing in §1–§6 was modified
beyond those additions. Full change list at the end of this section.*

### Architecture note — why hand-rolled JS instead of ONNX

`deepLearningLoader.js` (§6, Phase 3) already plans an ONNX Runtime Web
path for trained deep models. §7 doesn't replace that plan — it can't,
because there are no trained ONNX weights or labelled GPR-anomaly/material
datasets in this repo to export from. Instead, §7a–§7c implement the
**real architecture** (actual conv/residual/linear/softmax math, not
canned numbers) with **deterministically seeded, untrained weights**, so
the full pipeline shape — crop → embedding → fusion → prediction — is
concretely wired, testable, and demonstrable end-to-end today. Every model
file exposes `loadWeights(model, weights)` as the swap-in point: the day
trained weights exist (from either this seeded-JS path being trained via a
future `fusionEngine.train()` against `gpr_xrf_records`, or from a
PyTorch/ONNX export), no page or downstream consumer needs to change.

**This distinction is surfaced in the UI, not just this doc** — every §7
page carries a visible "Architecture demo — untrained weights" banner.
Treat predictions from §7a–§7c as illustrating the *pipeline*, not yet as
reliable material calls.

### §7a — ResNet-18 Spatial AI Module

`src/models/resnet18.js` + `src/pages/ResNetSpatial.jsx`, route `/resnet-spatial`.

```
Detection (from Detect.jsx) → extractCrop() → 32×32×1 normalised patch
  → stem: conv3×3(1→16) + ReLU + maxpool2×2
  → stage1: 2×BasicBlock (16ch)
  → stage2: 2×BasicBlock (32ch, stride-2 downsample)
  → stage3: 2×BasicBlock (64ch, stride-2 downsample)
  → stage4: 2×BasicBlock (128ch, stride-2 downsample)
  → global average pool → 128-D embedding
```
17 conv layers total, topology mirrors torchvision's `resnet18`
(`[2,2,2,2]` BasicBlocks) with scaled-down channel widths (16→32→64→128
vs the original 64→128→256→512) so it runs instantly client-side on a
small crop. `extractCrop()` reads directly from the §6h matrix convention
and bilinear-resamples the detection's bounding window to 32×32,
normalising amplitude to `[-1, 1]`.

**Reads:** `location.state { matrix, metadata, detections, filename,
scanId, velocity }` (passed from Detect.jsx's new "Analyze in AI Research
Lab" link — see change list).
**Passes:** → `/fusion-engine { resnetEmbedding, resnetPatch,
resnetPatchSize, detection, matrix, metadata, filename, scanId, velocity,
detections }`.

### §7b — XRF AI Workspace

`src/models/xrfMLP.js` + `src/pages/XRFWorkspace.jsx`, route `/xrf-workspace`.

```
8 elements [Fe,Cu,Pb,Ca,Si,Al,Ti,Zn] (wt%)
  → min-max normalise against XRF_REFERENCE_RANGES
  → Linear(8→64) + ReLU
  → Linear(64→32)                      → 32-D chemical embedding
```
Also computes, from the same forward pass:
- **Chemical fingerprint** — the normalised `[0,1]` 8-vector, for radar-style display.
- **Feature importance** — real perturbation sensitivity analysis: nudge
  each element by 5% of its reference range, measure L2 change in the
  32-D output, normalise across the 8 elements. Not a static/canned table.
- **Confidence** — explicitly an *input-typicality* score (how close raw
  readings sit to `XRF_REFERENCE_RANGES[el].typical`), **not** a trained
  classifier's confidence in a material label. Labelled as such in the UI
  to avoid implying more than the untrained model can currently support.

Can optionally load existing readings from `gpr_xrf_records.xrf_elements`
(read-only `supabase.from('gpr_xrf_records').select(...)` fetch) instead
of manual entry.

**Reads:** optional `location.state.detection`/scan info (context only).
**Passes:** → `/fusion-engine { xrfEmbedding, elements, ...scan info }`.

### §7c — Fusion Engine

`src/models/fusionEngine.js` + `src/pages/FusionEngine.jsx`, route `/fusion-engine`.

```
128-D ResNet embedding ⊕ 32-D XRF embedding → 160-D fused vector
  → Linear(160→4) + softmax   → Fusion prediction  {metal, ceramic, lithic, soil}
  → Linear(128→4) + softmax   → GPR-only prediction   (comparison head)
  → Linear(32→4)  + softmax   → XRF-only prediction   (comparison head)
```
All three heads run on the same input embeddings so the UI can render the
required "compare GPR only / XRF only / Fusion" panel side by side.
`topContributingDimensions()` gives a cheap real contribution analysis
(`|weight[dim, predictedClass] × input[dim]|`, top-N) as a stand-in for the
full Grad-CAM/SHAP panel planned in §7e.

`fusionEngine.train()` is an **explicit, intentional stub** — it throws
rather than fakes a fit, documenting exactly what's needed
(`gpr_xrf_records` rows with validated `ground_truth_material` +
populated `gpr_features`/`xrf_features`) to implement it for real.

**Reads:** `location.state.resnetEmbedding` / `.xrfEmbedding` if arriving
from §7a/§7b; falls back to computing either in-place if only raw
`matrix`+`detection` or `elements` were passed, so the page also works
standalone.

### §7d — AI Detection Lab

`src/models/detectionModels.js` + `src/pages/DetectionLab.jsx`, route `/detection-lab`.

A shared coarse-grid backbone (28×16 cells over the full B-scan, 4 real
per-cell stats — meanAbs/maxAbs/variance/vertical-gradient — through
conv3×3(4→12)+ReLU → conv3×3(12→16)+ReLU → per-cell LayerNorm) feeds three
selectable detector heads, run **alongside**, not instead of, the existing
SVM/peak-picking detector in `Detect.jsx`:

```
YOLO-lite       — anchor-free, 1 box/cell: Linear(16→9) → 4 box deltas +
                  objectness + 4-class softmax {metal, ceramic, stone, void}
Faster R-CNN-lite — 2-stage: RPN (Linear(16→2×2anchors) objectness+deltas)
                  → NMS → ROI head (Linear(16→32)+ReLU → 4-class softmax +
                  4 box-refine)
Mask R-CNN-lite — Faster R-CNN-lite + mask branch: Linear(16→32)+ReLU →
                  Linear(32→8×8) sigmoid, one 8×8 mask per kept proposal
```

Same honesty convention as §7a–§7c: real forward pass, deterministically
seeded (mulberry32/He-init) **untrained** weights — visible banner on the
page. The per-cell LayerNorm exists specifically so confidence scores
spread out under the UI's threshold slider instead of collapsing into an
all-or-nothing cliff (an artifact of unnormalised conv-sum magnitude with
random weights, caught and fixed during a runtime smoke test, not just a
build check).

**Reads:** `location.state { matrix, metadata, detections /* classical */,
filename, scanId, velocity }` (passed from `Detect.jsx`'s new "Compare with
AI Detection Lab" link).
**Passes:** → `/resnet-spatial { matrix, metadata, detections: aiDetections
(one or all), filename, scanId, velocity }` — an AI Detection Lab box can
enter the same ResNet-18 → Fusion Engine pipeline as a classical detection,
since `runDetector()` emits the same Detection shape (`trace`, `apexSample`,
`halfWidthTraces`, `halfDepthSamples`, `label`, `confidence`, …) that
`Detect.jsx` and `HyperbolaOverlay` already expect.

`detectionModels.compareDetections()` matches AI boxes against the
classical list by trace/sample tolerance for the page's "classical vs AI"
stats panel (matched / AI-only / classical-only / match rate). Matching
position does not imply the material label is correct — it's an untrained
head.

`detectionModels.train()` is an explicit stub, same pattern as
`fusionEngine.train()`: it throws and documents that a labelled set of GPR
B-scans with ground-truth boxes (+ masks for Mask R-CNN-lite) is needed and
doesn't exist in this repo yet.

### §7e–§7j — Planned, not yet built

Per the original brief, kept here as the section reservations so future
work doesn't renumber what's already shipped:

| § | Module | Status |
|---|---|---|
| §7e | Explainable AI (Grad-CAM, SHAP, full feature-importance panel) — §7c's `topContributingDimensions` is a placeholder for this | not started |
| §7f | AI Experiment Manager (train/save/compare experiments, accuracy/loss/precision/recall/F1/ROC/confusion matrix) | not started |
| §7g | Research Dataset Manager (extends §4 schema: raw/processed GPR, detections, ResNet features, raw/MLP XRF features, fusion results, ground truth, validation, notes) | not started |
| §7h | Validation Dashboard (accuracy, precision, recall, F1, ROC, cross-validation, calibration, prediction distribution) | not started |
| §7i | StyleGAN2-ADA prep (synthetic GPR generation infra, synthetic-vs-real comparison, dataset balancing) — explicitly **architecture/UI scaffolding only**, no fake generation | not started |
| §7j | Role system (Normal / Researcher / Admin) gating §7 pages | not started — needs a `profiles.role` column, additive, does not touch AuthContext auth flow |

### §7 — exact change list (for audit)

New files (§7a–§7c): `src/models/resnet18.js`, `src/models/xrfMLP.js`,
`src/models/fusionEngine.js`, `src/pages/ResNetSpatial.jsx`,
`src/pages/XRFWorkspace.jsx`, `src/pages/FusionEngine.jsx`,
`docs/BRAIN.md` (this file).
New files (§7d): `src/models/detectionModels.js`, `src/pages/DetectionLab.jsx`.
Edited (additive lines only): `src/App.jsx` (+4 imports, +4 routes),
`src/components/Sidebar.jsx` (+4 icon imports, +1 nav group with 4 links),
`src/pages/Detect.jsx` (+1 `Link` to `/detection-lab` alongside the existing
`/resnet-spatial` link, existing detector and UI untouched).

---

## §8 · Design tokens (pastel/gold theme)

Cited by every LOCKED SPEC page (§6ao, §6aq) and followed by all §7 pages:

| Token | Value | Use |
|---|---|---|
| Page background | `#FDFBF0` | `<div className="min-h-full p-6">` |
| Panel/sidebar background | `#F7F3D0` | cards' inner fill, sidebar |
| Border | `#F0E9B8` / `#E8DFA0` | card borders, input borders |
| Accent gold | `#C9971A` | primary buttons, active nav, headings |
| Accent gold (hover) | `#a87d12` | button hover |
| Accent brown | `#92692A` | secondary button text |
| Body text | `stone-800` / `stone-600` / `stone-500` / `stone-400` (Tailwind) | headings / body / muted / placeholder |
| Rounded | `rounded-xl` (cards), `rounded-lg` (inputs/buttons) | |

---

## Appendix · Honesty ledger

Anything in this document describing §7 models as producing "predictions"
or "confidence" should be read through the untrained-weights caveat stated
in §7's architecture note. Nothing in §7 has been trained on ground-truth
GPR+XRF+material data; there isn't any in this repo yet. The value of §7
today is a **working, correctly-shaped pipeline** (verified end-to-end:
128-D + 32-D → 160-D → softmax, ~90ms in-browser) ready to receive real
weights — not a validated material classifier.
