import { type NextRequest } from 'next/server';
import { withTransaction } from '@/lib/db';
import {
  getLeaves,
  loadRosterFromDb,
  markCellManual,
} from '@/lib/rosterDb';
import { validateAssignment } from '@/lib/scheduler';
import type { RosterApiResponse } from '@/lib/types';

type AssignmentAction = 'add' | 'remove' | 'clear' | 'toggle_active';

interface AssignmentRequest {
  rosterId: string;
  date: string;
  shiftTypeId: string;
  action: AssignmentAction;
  doctorId?: string;
  note?: string;
  year: number;
  month: number;
}

export async function PUT(request: NextRequest): Promise<Response> {
  const body = (await request.json()) as AssignmentRequest;
  const { rosterId, date, shiftTypeId, action, doctorId, note, year, month } = body;
  const monthZero = month - 1;

  if (!rosterId || !date || !shiftTypeId || !action) {
    return Response.json({ error: 'Missing required fields' }, { status: 400 });
  }

  try {
    const leaves = await getLeaves();

    // Run validation for 'add' actions and return warnings (informational only)
    let warnings: string[] = [];
    if (action === 'add' && doctorId) {
      const currentRoster = await loadRosterFromDb(rosterId, year, monthZero, leaves);
      warnings = validateAssignment(doctorId, date, shiftTypeId, currentRoster, leaves);
    }

    await withTransaction(async client => {
      if (action === 'toggle_active') {
        // Flip the shift's active flag for this day
        const current = await client.query<{ active: boolean }>(
          `SELECT active FROM shift_day_status
           WHERE roster_id = $1 AND shift_type_id = $2 AND assignment_date = $3`,
          [rosterId, shiftTypeId, date]
        );
        const wasActive = current.rows[0]?.active ?? true;
        const nowActive = !wasActive;

        await client.query(
          `INSERT INTO shift_day_status
             (roster_id, shift_type_id, assignment_date, active, is_manual_cell)
           VALUES ($1, $2, $3, $4, true)
           ON CONFLICT (roster_id, shift_type_id, assignment_date)
           DO UPDATE SET active = EXCLUDED.active, is_manual_cell = true`,
          [rosterId, shiftTypeId, date, nowActive]
        );

        // When deactivating, remove all assignments for this cell
        if (!nowActive) {
          await client.query(
            `DELETE FROM assignments
             WHERE roster_id = $1 AND shift_type_id = $2 AND assignment_date = $3`,
            [rosterId, shiftTypeId, date]
          );
        }
        return;
      }

      if (action === 'add' && doctorId) {
        await client.query(
          `INSERT INTO assignments
             (roster_id, shift_type_id, doctor_id, assignment_date,
              is_manual_override, source, note)
           VALUES ($1, $2, $3, $4, true, 'manual', $5)
           ON CONFLICT (roster_id, shift_type_id, doctor_id, assignment_date)
           DO UPDATE SET is_manual_override = true, source = 'manual', note = EXCLUDED.note`,
          [rosterId, shiftTypeId, doctorId, date, note ?? null]
        );
        await markCellManual(client, rosterId, shiftTypeId, date);
        return;
      }

      if (action === 'remove' && doctorId) {
        await client.query(
          `DELETE FROM assignments
           WHERE roster_id = $1
             AND shift_type_id = $2
             AND doctor_id = $3
             AND assignment_date = $4`,
          [rosterId, shiftTypeId, doctorId, date]
        );
        // Mark remaining assignments in this cell as manual
        await client.query(
          `UPDATE assignments
           SET is_manual_override = true, source = 'manual'
           WHERE roster_id = $1 AND shift_type_id = $2 AND assignment_date = $3`,
          [rosterId, shiftTypeId, date]
        );
        await markCellManual(client, rosterId, shiftTypeId, date);
        return;
      }

      if (action === 'clear') {
        await client.query(
          `DELETE FROM assignments
           WHERE roster_id = $1 AND shift_type_id = $2 AND assignment_date = $3`,
          [rosterId, shiftTypeId, date]
        );
        // Mark cell manual (so regeneration keeps it empty)
        await markCellManual(client, rosterId, shiftTypeId, date);
        return;
      }
    });

    // Reload and return fresh roster
    const roster = await loadRosterFromDb(rosterId, year, monthZero, leaves);
    const response: RosterApiResponse & { warnings?: string[] } = {
      roster,
      leaves,
      rosterId,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
    return Response.json(response);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return Response.json({ error: message }, { status: 500 });
  }
}
