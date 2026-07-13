# AiG v2 — Database Fix & Setup Guide

This release fixes the "**Save All to Database** shows success but the database stays
empty" problem and adds Batch Upload, user connections, dataset sharing, and a live
per-dataset chat. AiG is **serverless** — the browser talks to Supabase directly
(there is no separate backend to deploy).

## 1. Why saving looked successful but stored nothing

Two real bugs + one config cause:

1. **False success (code).** In `Results.jsx`, `handleSaveToDb()` caught its own error
   and returned normally, so `handleSaveAll()` counted every row as "saved" even when
   the insert failed. → Fixed: errors now propagate and the UI shows the real error.
2. **Missing `user_id` (code).** The insert did not include `user_id`, so Row Level
   Security (which requires `auth.uid() = user_id`) rejected the write. → Fixed: all
   writes go through `src/lib/db.js`, which always attaches `user_id`.
3. **Row Level Security not configured (database).** If RLS is on with no INSERT policy,
   every insert is rejected. → Fixed by the migration below (adds correct policies).

Guest/demo mode is **local only** — it now clearly tells you to sign in with Google to
store to the cloud, instead of pretending to save.

## 2. Run the migration (once)

1. Open your Supabase project → **SQL Editor** → **New query**.
2. Paste the whole of [`docs/migrations/001_aig_v2.sql`](migrations/001_aig_v2.sql) and **Run**.
   - It only **adds** columns/tables (`IF NOT EXISTS`) — nothing is dropped, and it is
     safe to re-run.
   - It enables RLS + correct policies, creates `profiles`, `datasets`,
     `user_connections`, `dataset_shares`, `dataset_messages`, and turns on realtime
     for the chat table.

## 3. Enable Google auth (if not already)

Authentication → Providers → **Google** → enable, add your OAuth client id/secret, and
add `http://localhost:5173/dashboard` (and your deployed URL) to the redirect allow-list.
Put your keys in `.env` (copy from `.env.example`):

```
VITE_SUPABASE_URL=https://YOUR-REF.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR-ANON-KEY
```

## 4. Run the app

```
npm install
npm run dev      # http://localhost:5173
```

## 5. Test checklist

| Test | How | Expected |
|------|-----|----------|
| Save to database | Detect → Classify → Results → **Save All to DB** | Green **Saved Successfully** card with Dataset ID, User, Files, Database Status = Stored |
| Records appear | Supabase → Table editor → `gpr_xrf_records` | New rows with your `user_id` + `dataset_id` |
| Guest is blocked | Use guest mode → Save All | Clear message: sign in to store (no false success) |
| Batch upload | Sidebar → **Batch Upload**, pick ≤10 files → Upload | Rows saved to `gpr_scans` under one Dataset ID |
| Retrieve | Dashboard | Scan/record counts increase |
| Connect user | **Connect Users** → search → Connect; other user Accepts | Row in `user_connections` flips to `accepted` |
| Share dataset | **Datasets & Chat** → set Connected/Public | `datasets.visibility` updates |
| Dataset chat | **Datasets & Chat** → Chat on Dataset → send | Message appears live for connected users |
| AI fusion stored | inspect a `gpr_xrf_records` row | `gpr_features`, `xrf_features`, `fusion_output` populated |

## 6. What is stored per record (required fields)

`gpr_xrf_records` now includes: `dataset_id`, `user_id`, `site_id`, `material_id`,
`artifact_category`, `gpr_signature` + `gpr_features`, `xrf_material` + `xrf_elements` +
`xrf_features`, `ai_prediction`, `fusion_output`, `confidence`, `created_at` (timestamp),
plus the existing position/depth/size fields. All additions are backward compatible.
