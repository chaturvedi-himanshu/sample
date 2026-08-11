import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import {
  getLeaves,
  getRosterId,
  loadPrevRosterForRegen,
  saveGeneratedRoster,
  loadRosterFromDb,
} from '@/lib/rosterDb';
import { generateRoster } from '@/lib/scheduler';
import type { RosterApiResponse, RosterData } from '@/lib/types';

export async function GET(): Promise<Response> {
  try {
    const leaves = await getLeaves();
    return Response.json({ leaves });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  const body = await request.json();
  const { doctorId, date, reason, year, month } = body as {
    doctorId: string;
    date: string;
    reason?: string;
    year: number;
    month: number;
  };
  const monthZero = month - 1;

  if (!doctorId || !date) {
    return Response.json({ error: 'doctorId and date are required' }, { status: 400 });
  }

  try {
    await query(
      `INSERT INTO leaves (doctor_id, leave_date, reason)
       VALUES ($1, $2, $3)
       ON CONFLICT (doctor_id, leave_date) DO NOTHING`,
      [doctorId, date, reason ?? null]
    );

    const leaves = await getLeaves();

    // Re-generate the requested month with updated leaves
    let prevRoster: RosterData | null = null;
    const existingId = await getRosterId(year, month);
    if (existingId) {
      prevRoster = await loadPrevRosterForRegen(existingId, year, monthZero, leaves);
    }

    const generated = generateRoster(year, monthZero, leaves, prevRoster, false);
    const rosterId = await saveGeneratedRoster(year, month, monthZero, generated, false);
    const roster = await loadRosterFromDb(rosterId, year, monthZero, leaves);

    const response: RosterApiResponse = { roster, leaves, rosterId };
    return Response.json(response, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return Response.json({ error: message }, { status: 500 });
  }
}
