# Duty Doctor Roster

A constraint-based monthly duty roster scheduler for a hospital emergency department. Six doctors, five shift types, full rule enforcement, Supabase persistence, and a React calendar UI with inline editing and manual-override tracking.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19 / Next.js 16 App Router |
| Backend API | Next.js Route Handlers (Node.js) |
| Database | Supabase (PostgreSQL) — **raw SQL only, no ORM** |
| Styling | Tailwind CSS v4 |
| Deployment | Vercel (app) + Supabase (database) |

---

## Setup

### 1. Clone and install

```bash
git clone <your-repo-url>
cd duty-doctor-roster
npm install
```

### 2. Create a Supabase project

1. Go to [supabase.com](https://supabase.com) and create a new project.
2. Open **SQL Editor** and run the full schema + seed script:

```bash
# Paste the contents of supabase/duty-doctor-roster-schema.sql into the SQL Editor and run it.
```

This creates all tables, indexes, the 6 doctors, 5 shift types, and the 4 seeded June 2026 leave days.

### 3. Configure environment variables

```bash
cp .env.example .env.local
```

Edit `.env.local` and fill in your Supabase connection string:

```
DATABASE_URL=postgresql://postgres.[PROJECT-REF]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:6543/postgres
```

Find this in: **Supabase Dashboard → Project Settings → Database → Connection string (URI mode)**.  
Use the **Transaction pooler** (port `6543`) for Vercel serverless deployments.

### 4. Run locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

On first load, the app auto-generates the June 2026 roster and persists it to Supabase.

---

## Environment Variables

| Variable | Description |
|---|---|
| `DATABASE_URL` | Supabase PostgreSQL connection string (Transaction pooler URL) |

See `.env.example` for format.

---

## Algorithm — How the Roster Generator Works

The generation engine lives in `lib/scheduler.ts`. It walks the target month **day by day** (day 1 → last day) and applies constraints in the exact priority order from the spec (§9):

### Priority order (applied in sequence, earlier rules always win)

| # | Rule |
|---|---|
| 1 | **Gender restrictions** — OBGYN shift: female doctors only |
| 2 | **Weekly offs** — each doctor's fixed day off cannot be auto-assigned |
| 3 | **Approved leave days** — leave blocks all assignment for that date |
| 4 | **One shift per day** — tracked via `assignedToday` set |
| 5 | **Max 6 shifts/week** — `weekly[doctorId]` counter, reset every Monday |
| 6 | **Dr. Rohan Khanna's fixed pattern** — Night Mon–Thu, Morning Sat, Afternoon Sun |
| 7 | **Dr. Imran Siddiqui's restrictions** — Day Shift only; max 2 Night shifts/month |
| 8 | **Post-night recovery** — after Night, only Afternoon (or off) the next day |
| 9 | **No consecutive Night shifts** — except Rohan (Mon–Thu exemption) |
| 10 | **Equal Night shift distribution** — lowest monthly Night count gets priority |
| 11 | **Equal OBGYN duty distribution** — lowest monthly OBGYN count gets priority |
| 12 | **Day Shift catch-all** — all remaining available doctors are assigned Day |

### Shift assignment order within a day

`Night → OBGYN → Morning → Afternoon → Day`

Night and OBGYN are filled first because they have the tightest eligibility constraints. Day is last because it acts as the catch-all for everyone not yet placed.

### Reduced-staffing rules (§12)

Before assigning any shifts, the engine counts how many doctors are **unavailable** (on weekly off, on leave, or in post-night recovery):

- **≥ 2 unavailable** → OBGYN shift removed for the day
- **≥ 3 unavailable** → OBGYN *and* Day shift removed for the day

---

## Manual Overrides vs. Regeneration

### What "Generate roster" does

Clicking **Generate roster** calls `POST /api/roster/generate` with `resetManual: false`.

The generator:
1. Loads all existing manual overrides from the `shift_day_status` (`is_manual_cell = true`) and `assignments` (`is_manual_override = true`) tables.
2. Reconstructs the previous roster state in memory, with manual cells marked.
3. Runs the scheduling algorithm — the `lockManual()` function skips any cell marked as manual, keeping its existing doctor assignments exactly as-is.
4. Only fills cells that were *not* manually edited.

**Result:** Manual edits survive regeneration.

### What "Reset month" does

Clicking **Reset month** calls `POST /api/roster/generate` with `resetManual: true`.

The generator ignores all manual markers and overwrites every cell with freshly computed assignments.

**Result:** All manual overrides are cleared and the month is rebuilt from scratch.

### How `is_manual_override` is read back on load

`GET /api/roster?year=&month=` queries both `assignments` and `shift_day_status`. Any row with `is_manual_override = true` or `is_manual_cell = true` causes `manualCells[shiftKey] = true` for that date in the in-memory roster, which the UI renders as the "edited" badge on that shift cell.

### Leave day changes trigger regeneration

Adding or removing a leave day via the UI automatically re-runs the generator for the affected month (with `resetManual: false`), so the schedule stays consistent with updated availability while preserving all manual overrides.

---

## Database Schema

See `supabase/duty-doctor-roster-schema.sql` for the full schema. Key tables:

| Table | Purpose |
|---|---|
| `doctors` | Master doctor data (gender, weekly off, shift mode, recovery flag) |
| `shift_types` | The 5 shift definitions with eligibility rules |
| `leaves` | Approved leave days (seeded + admin-managed) |
| `monthly_rosters` | One record per (year, month) pair |
| `shift_day_status` | Per-shift, per-day active flag and manual-cell marker |
| `assignments` | Individual doctor–shift–date records with `is_manual_override` and `source` |

---

## Deployment (Vercel + Supabase)

1. Push the repo to GitHub.
2. Import the repo in [vercel.com](https://vercel.com).
3. Add the `DATABASE_URL` environment variable in the Vercel project settings (use the **Transaction pooler** URL from Supabase for serverless compatibility).
4. Deploy — Vercel auto-detects Next.js and builds correctly.
# sample
# sample
# sample
