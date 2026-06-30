# AiG — AI-GPR Subsurface Object Identification Tool

> Identify **what is buried, where it is, how big it is, and how deep** — using GPR data alone, enhanced by cross-referencing with historical GPR+XRF records.

---

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Configure Supabase (for Google login + cloud database)
cp .env.example .env
#   then edit .env and paste your project's:
#     VITE_SUPABASE_URL=https://your-project-ref.supabase.co
#     VITE_SUPABASE_ANON_KEY=your-anon-key-here

# 3. Run the dev server
npm run dev          # http://localhost:5173

# 4. Production build
npm run build && npm run preview
```

### Signing in

AiG offers two ways in, so researchers can start instantly:

- **Sign in with Google** — full experience, scans and GPR+XRF records are saved to your Supabase cloud database.
- **Continue as guest** — explore the entire analysis pipeline (Upload → Preprocess → Visualise → Detect → Classify → Cluster) with no setup. Cloud-save features are disabled in guest mode.

> The app boots even without a `.env` file — only the cloud features are disabled until Supabase is configured.

### Supabase setup

Create the database tables by running the SQL in [`docs/DATABASE_SCHEMA.md`](docs/DATABASE_SCHEMA.md) in your Supabase SQL editor, then enable the **Google** provider under *Authentication → Providers* and add `http://localhost:5173/dashboard` to the allowed redirect URLs.

---

## The Problem

Ground Penetrating Radar (GPR) can detect buried objects and anomalies — but it cannot tell you **what material** the object is made of. Currently, the only way to identify material composition is through physical excavation followed by laboratory XRF analysis. Excavation is irreversible, destructive to archaeological context, and expensive.

## What AiG Does

AiG is a personal AI-powered tool that processes GPR B-scan data to automatically identify:

| Output | Method |
|--------|--------|
| **Object position** (X, Y along survey line) | Hyperbola detection via YOLO / Faster R-CNN |
| **Object size** (estimated dimensions) | Segmentation via U-Net / Mask R-CNN |
| **Object depth** | Two-way travel time conversion + velocity estimation |
| **Material type** (predicted) | Cross-reference with historical GPR+XRF database |

The key novelty: AiG maintains a **GPR+XRF reference database** — when a new GPR scan is uploaded, it compares detected hyperbola signatures against previously excavated sites where XRF confirmed the material type. This allows **non-destructive material prediction before excavation**.

---

## How It Works

```
New GPR Scan (.DZT / .dt2 / .sgy)
          │
          ▼
  Preprocessing (PCA, ICA, denoising)
          │
          ▼
  B-scan Visualisation
          │
          ▼
  Object Detection (YOLO / Faster R-CNN)
  → Position (x, trace)
  → Depth (from travel time)
  → Size (bounding box → physical dimensions)
          │
          ▼
  Feature Extraction (CNN / Autoencoder)
  → Hyperbola shape signature
  → Signal amplitude profile
          │
          ▼
  GPR+XRF Reference Database Lookup
  → Match signature against known material records
  → Predict material type (ceramic, metal, bone, stone...)
          │
          ▼
  Output Report
  → Object map (position + depth + size)
  → Material prediction + confidence score
  → Excavation recommendation
```

---

## AI Methods

### Phase 2 — Classical ML (no labelled training data needed)
| Method | Role |
|--------|------|
| PCA | Dimensionality reduction, preprocessing |
| ICA | Signal separation, clutter removal |
| Autoencoder | Unsupervised clutter removal, feature compression |
| K-Means | Anomaly clustering |
| DBSCAN | Noise-resistant clustering |
| SOM | Pattern visualisation |
| SVM | Classification (works with small datasets) |
| Random Forest | Robust, interpretable classification |
| XGBoost | High accuracy feature-based classification |
| k-NN | Hyperbola similarity matching |
| Decision Tree | Interpretable rule-based classification |
| Naïve Bayes | Fast signal classification |
| Logistic Regression | Binary target / no-target |
| AdaBoost | Ensemble for small datasets |
| Bayesian Networks | Uncertainty & confidence estimation |
| Fuzzy Logic | Soil and material characterisation |

### Phase 3 — Deep Learning (requires labelled training data)
| Method | Role |
|--------|------|
| CNN / ResNet / EfficientNet | Radargram classification |
| YOLOv5 / YOLOv8 | Real-time hyperbola & object detection |
| Faster R-CNN | High-precision object detection |
| U-Net | Pixel-level segmentation, boundary extraction |
| LSTM / GRU | A-scan sequential signal analysis |
| ViT / Swin Transformer | Global feature learning |
| VAE | Feature learning, latent space matching |

---

## GPR+XRF Reference Database

The database stores records from previously excavated sites where both GPR and XRF were performed:

```
Record {
  site_id         : unique site identifier
  gpr_signature   : extracted feature vector from B-scan
  hyperbola_shape : curvature, amplitude, width
  depth_m         : confirmed depth (m)
  object_size_cm  : confirmed dimensions (cm)
  xrf_material    : confirmed material (e.g. "ceramic", "iron", "bone")
  xrf_elements    : elemental composition [Fe, Ca, Si, ...]
  location        : GPS coordinates
  date            : excavation date
  notes           : field notes
}
```

When a new scan is analysed, AiG matches the extracted GPR signature against this database using k-NN / cosine similarity to predict material type — **without excavation**.

---

## Project Structure

```
AiG/
├── src/
│   ├── pages/              # App views
│   │   ├── Home.jsx        # Landing / login
│   │   ├── Dashboard.jsx   # Main hub after login
│   │   ├── Upload.jsx      # Upload GPR file
│   │   ├── Preprocess.jsx  # PCA, ICA, denoising
│   │   ├── Visualise.jsx   # B-scan viewer
│   │   ├── Detect.jsx      # Object detection
│   │   ├── Classify.jsx    # Material prediction
│   │   ├── Cluster.jsx     # Anomaly clustering
│   │   ├── Database.jsx    # GPR+XRF reference DB
│   │   ├── Results.jsx     # Final report
│   │   └── Settings.jsx    # App settings
│   ├── components/         # Reusable UI
│   │   ├── Navbar.jsx
│   │   ├── Sidebar.jsx
│   │   ├── FileLoader.jsx
│   │   ├── BScanViewer.jsx
│   │   ├── HyperbolaOverlay.jsx
│   │   ├── DepthScale.jsx
│   │   ├── ObjectMap.jsx
│   │   ├── ResultCard.jsx
│   │   ├── ModelSelector.jsx
│   │   ├── ConfidenceBar.jsx
│   │   ├── ProtectedRoute.jsx
│   │   └── StatusBar.jsx
│   ├── models/             # AI model wrappers
│   │   ├── pcaModel.js
│   │   ├── icaModel.js
│   │   ├── svmModel.js
│   │   ├── randomForest.js
│   │   ├── xgboost.js
│   │   ├── knn.js
│   │   ├── autoencoderModel.js
│   │   ├── clusterModels.js
│   │   ├── fuzzyLogic.js
│   │   ├── bayesianNet.js
│   │   └── deepLearningLoader.js
│   ├── utils/              # Helper functions
│   │   ├── gprParser.js        # Parse .DZT, .dt2, .sgy
│   │   ├── signalProcessing.js # Filtering, gain, background removal
│   │   ├── depthCalc.js        # Travel time → depth conversion
│   │   ├── colormap.js         # B-scan colour rendering
│   │   ├── fileHelpers.js
│   │   └── exportResults.js    # PDF / CSV export
│   ├── lib/
│   │   └── supabase.js         # Supabase client
│   ├── context/
│   │   └── AuthContext.jsx     # Google auth state
│   └── hooks/
│       ├── useGPRData.js
│       ├── useModel.js
│       ├── usePreprocessing.js
│       └── useResults.js
├── docs/
│   ├── ROADMAP.md
│   ├── AI_METHODS.md
│   └── GPR_FORMATS.md
├── data/                   # Sample GPR test files
├── public/
├── .env.example
├── package.json
└── README.md
```

---

## Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + Vite + Tailwind CSS |
| Auth | Supabase (Google OAuth) |
| Database | Supabase (PostgreSQL) — GPR+XRF records |
| ML (classical) | scikit-learn via Python backend |
| ML (deep learning) | PyTorch / TensorFlow.js |
| GPR file parsing | readgssi, gprpy, segyio |
| Export | jsPDF, Papa Parse |

---

## Roadmap

### Phase 1 — Foundation *(current)*
- [x] Repo structure
- [x] Google login (Supabase) + Guest demo mode
- [x] GPR file upload (.DZT, .dt2/.rd3, .sgy, .csv) + synthetic demo
- [x] B-scan visualisation

### Phase 2 — Classical ML
- [ ] Preprocessing (PCA, ICA, background removal)
- [ ] Hyperbola detection (k-NN, SVM)
- [ ] Depth estimation from travel time
- [ ] Clustering (K-Means, DBSCAN)
- [ ] GPR+XRF database — add & search records

### Phase 3 — Deep Learning
- [ ] YOLOv8 hyperbola detection
- [ ] U-Net segmentation
- [ ] CNN material classification
- [ ] VAE signature matching

### Phase 4 — Full Pipeline
- [ ] Automated position + size + depth + material report
- [ ] Confidence scoring
- [ ] PDF export


---

## Research Alignment (GPR + XRF + AI unified framework)

AiG mirrors the 4-stage PhD framework so the app doubles as a living methodology figure:

- **Stage 1 · Survey** — Upload → Preprocess → Visualise → Detect (position, depth, size). Tuned for tropical high-moisture soil via strong denoising (Background removal, PCA, ICA, Autoencoder).
- **Stage 2 · Predict** *(core novelty)* — Classify matches the GPR signature against the historical GPR+XRF database (k-NN) and predicts material **and a weighted elemental profile** (Fe/Ca/Si…) — before excavation.
- **Stage 3–4 · Confirm & Map** — Results report with an **Excavation Priority** ranking (confidence × size × accessibility) to decide what to dig first; Database stores the GPR+XRF reference records.
- **Stage 5 · Validation** — a metrics page answering **RQ4**: accuracy, confusion matrix, per-material precision/recall/F1, and confidence calibration (predicted vs pXRF ground truth). Includes a demo evaluation so it is useful before real data exists.

Settings includes a **Malaysia tropical (high-moisture)** soil preset and attenuation guidance.

---

## Research Context

This tool supports research on **non-destructive archaeological investigation** using the combination of GPR and XRF — eliminating the need for destructive excavation to identify subsurface material composition.

