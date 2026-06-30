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
