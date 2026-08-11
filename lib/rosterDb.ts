

import { PoolClient } from 'pg';
import type { Leave, RosterData, ShiftCell } from './types';
import { SHIFT_ORDER } from './constants';
import { toISO, daysInMonth, computeRosterMeta } from './scheduler';
import { query, queryOne, withTransaction } from './db';

// ── Leaves ────────────────────────────────────────────────

export async function getLeaves(): Promise<Leave[]> {
  return query<Leave>(
    `SELECT id::text AS id, doctor_id AS "doctorId", leave_date::text AS date, reason
     FROM leaves
     ORDER BY leave_date`
  );
}

// ── Roster lookup / creation ──────────────────────────────

export async function getRosterId(year: number, month: number): Promise<string | null> {
  const row = await queryOne<{ id: string }>(
    `SELECT id::text AS id FROM monthly_rosters WHERE year = $1 AND month = $2`,
    [year, month]
  );
  return row?.id ?? null;
}

async function upsertRoster(
  client: PoolClient,
  year: number,
  month: number
): Promise<string> {
  const row = await client.query<{ id: string }>(
    `INSERT INTO monthly_rosters (year, month, status, generated_at)
     VALUES ($1, $2, 'generated', NOW())
     ON CONFLICT (year, month)
     DO UPDATE SET status = 'generated', generated_at = NOW()
     RETURNING id::text AS id`,
    [year, month]
  );
  return row.rows[0].id;
}

// ── Load roster from DB → RosterData ─────────────────────

export async function loadRosterFromDb(
  rosterId: string,
  year: number,
  monthZero: number,
  leaves: Leave[]
): Promise<RosterData> {
  const total = daysInMonth(year, monthZero);

  const roster: RosterData = {};
  for (let day = 1; day <= total; day++) {
    const iso = toISO(year, monthZero, day);
    const shifts: Record<string, ShiftCell> = {};
    SHIFT_ORDER.forEach(k => (shifts[k] = { active: true, assignments: [] }));
    roster[iso] = {
      shifts,
      manualCells: {},
      meta: {
        onLeave: [], off: [], recovery: [],
        unavailableCount: 0, removeObgyn: false, removeDay: false,
      },
    };
  }

  type StatusRow = { shift_type_id: string; date: string; active: boolean; is_manual_cell: boolean };
  const statuses = await query<StatusRow>(
    `SELECT shift_type_id, assignment_date::text AS date, active, is_manual_cell
     FROM shift_day_status
     WHERE roster_id = $1`,
    [rosterId]
  );

  type AssignRow = { shift_type_id: string; doctor_id: string; date: string; is_manual_override: boolean };
  const assignments = await query<AssignRow>(
    `SELECT shift_type_id, doctor_id, assignment_date::text AS date, is_manual_override
     FROM assignments
     WHERE roster_id = $1
     ORDER BY assignment_date`,
    [rosterId]
  );

  for (const s of statuses) {
    const day = roster[s.date];
    if (!day) continue;
    if (day.shifts[s.shift_type_id]) {
      day.shifts[s.shift_type_id].active = s.active;
    }
    if (s.is_manual_cell) {
      day.manualCells[s.shift_type_id] = true;
    }
  }

  for (const a of assignments) {
    const day = roster[a.date];
    if (!day?.shifts[a.shift_type_id]) continue;
    if (!day.shifts[a.shift_type_id].assignments.includes(a.doctor_id)) {
      day.shifts[a.shift_type_id].assignments.push(a.doctor_id);
    }
    if (a.is_manual_override) {
      day.manualCells[a.shift_type_id] = true;
    }
  }

  return computeRosterMeta(year, monthZero, roster, leaves);
}

// ── Save generated roster to DB (bulk — few round trips) ──

export async function saveGeneratedRoster(
  year: number,
  month: number,
  monthZero: number,
  rosterData: RosterData,
  resetManual: boolean
): Promise<string> {
  return withTransaction(async client => {
    const rosterId = await upsertRoster(client, year, month);
    const total = daysInMonth(year, monthZero);

    // Collect rows in memory, then write in bulk
    const statusRows: Array<[string, string, string, boolean, boolean]> = [];
    const assignmentRows: Array<[string, string, string, string]> = [];
    const regenerableDates: string[] = [];
    const regenerableShifts: string[] = [];

    for (let day = 1; day <= total; day++) {
      const iso = toISO(year, monthZero, day);
      const dayData = rosterData[iso];
      if (!dayData) continue;

      for (const shiftKey of SHIFT_ORDER) {
        const shiftCell = dayData.shifts[shiftKey];
        const isManualCell = !resetManual && (dayData.manualCells?.[shiftKey] ?? false);

        statusRows.push([rosterId, shiftKey, iso, shiftCell.active, isManualCell]);

        if (isManualCell) continue;

        regenerableDates.push(iso);
        regenerableShifts.push(shiftKey);

        for (const doctorId of shiftCell.assignments) {
          assignmentRows.push([rosterId, shiftKey, doctorId, iso]);
        }
      }
    }

    // 1) Upsert all shift_day_status rows
    if (statusRows.length > 0) {
      const values: unknown[] = [];
      const placeholders: string[] = [];
      statusRows.forEach((row, i) => {
        const o = i * 5;
        placeholders.push(`($${o + 1}, $${o + 2}, $${o + 3}::date, $${o + 4}, $${o + 5})`);
        values.push(...row);
      });

      await client.query(
        `INSERT INTO shift_day_status
           (roster_id, shift_type_id, assignment_date, active, is_manual_cell)
         VALUES ${placeholders.join(', ')}
         ON CONFLICT (roster_id, shift_type_id, assignment_date)
         DO UPDATE SET
           active = EXCLUDED.active,
           is_manual_cell = EXCLUDED.is_manual_cell`,
        values
      );
    }

    // 2) Delete generated (or all, if reset) assignments for regenerable cells
    if (resetManual) {
      await client.query(`DELETE FROM assignments WHERE roster_id = $1`, [rosterId]);
    } else if (regenerableDates.length > 0) {
      // Delete non-manual assignments for cells we are regenerating
      await client.query(
        `DELETE FROM assignments a
         USING unnest($2::text[], $3::text[]) AS x(shift_type_id, assignment_date)
         WHERE a.roster_id = $1
           AND a.shift_type_id = x.shift_type_id
           AND a.assignment_date = x.assignment_date::date
           AND a.is_manual_override = false`,
        [rosterId, regenerableShifts, regenerableDates]
      );
    }

    // 3) Bulk insert generated assignments
    if (assignmentRows.length > 0) {
      const values: unknown[] = [];
      const placeholders: string[] = [];
      assignmentRows.forEach((row, i) => {
        const o = i * 4;
        placeholders.push(`($${o + 1}, $${o + 2}, $${o + 3}, $${o + 4}::date, false, 'generated')`);
        values.push(...row);
      });

      await client.query(
        `INSERT INTO assignments
           (roster_id, shift_type_id, doctor_id, assignment_date, is_manual_override, source)
         VALUES ${placeholders.join(', ')}
         ON CONFLICT (roster_id, shift_type_id, doctor_id, assignment_date)
         DO NOTHING`,
        values
      );
    }

    return rosterId;
  });
}

// ── Build prevRoster skeleton from DB (for regeneration) ─

export async function loadPrevRosterForRegen(
  rosterId: string,
  year: number,
  monthZero: number,
  leaves: Leave[]
): Promise<RosterData> {
  return loadRosterFromDb(rosterId, year, monthZero, leaves);
}

// ── Mark a shift-day cell as manually edited ──────────────

export async function markCellManual(
  client: PoolClient,
  rosterId: string,
  shiftTypeId: string,
  date: string
): Promise<void> {
  await client.query(
    `INSERT INTO shift_day_status
       (roster_id, shift_type_id, assignment_date, active, is_manual_cell)
     VALUES ($1, $2, $3, true, true)
     ON CONFLICT (roster_id, shift_type_id, assignment_date)
     DO UPDATE SET is_manual_cell = true`,
    [rosterId, shiftTypeId, date]
  );
}
