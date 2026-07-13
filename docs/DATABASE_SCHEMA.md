# GPR+XRF Reference Database Schema

Stored in Supabase (PostgreSQL).

## Table: gpr_xrf_records
| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| user_id | uuid | Auth user (owner) |
| site_id | text | Site name / identifier |
| scan_filename | text | Original GPR filename |
| gpr_signature | float[] | Extracted feature vector from B-scan |
| hyperbola_shape | jsonb | Curvature, amplitude, width values |
| position_trace | int | Trace number along survey line |
| position_m | float | Distance along survey line (m) |
| depth_ns | float | Two-way travel time (ns) |
| depth_m | float | Confirmed depth (m) |
| size_width_cm | float | Estimated object width (cm) |
| size_height_cm | float | Estimated object height (cm) |
| xrf_material | text | Confirmed material (ceramic, iron, bone...) |
| xrf_elements | jsonb | Elemental composition {Fe: 12.3, Ca: 8.1, ...} |
| gps_lat | float | Site GPS latitude |
| gps_lng | float | Site GPS longitude |
| excavation_date | date | Date of excavation and XRF analysis |
| notes | text | Field notes |
| created_at | timestamp | Record creation time |

## Table: gpr_scans
| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| user_id | uuid | Auth user |
| filename | text | Uploaded GPR filename |
| format | text | DZT / dt2 / sgy |
| scan_data | jsonb | Processed B-scan matrix |
| created_at | timestamp | Upload time |

---

## v2 additions (see `migrations/001_aig_v2.sql`)

### gpr_xrf_records — new columns (added, backward compatible)
| Column | Type | Description |
|--------|------|-------------|
| dataset_id | text | Links GPR + XRF + AI results into one dataset |
| material_id | text | Material identifier |
| artifact_category | text | Artifact category |
| ai_prediction | text | AI-predicted material |
| confidence | float | Prediction confidence (0–1) |
| gpr_features | jsonb | GPR embedding / feature vector (fusion input) |
| xrf_features | jsonb | XRF elemental features (fusion input) |
| fusion_output | jsonb | Late-fusion classifier output (scores, top matches) |
| predicted_material / predicted_confidence | text / float | For the Validation page (RQ4) |

### New tables
| Table | Purpose |
|-------|---------|
| profiles | User directory for search/connect (id, email, display_name) |
| datasets | Dataset grouping + visibility (private / connected / public) |
| user_connections | Connect requests (requester_id, addressee_id, status) |
| dataset_shares | Explicit per-user dataset shares |
| dataset_messages | Live "Chat on Dataset" discussion (realtime enabled) |

All new tables have Row Level Security policies; `gpr_scans` gains a `dataset_id` link.
