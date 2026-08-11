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

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await context.params;

  const bodyText = await request.text();
  const body = bodyText ? (JSON.parse(bodyText) as { year?: number; month?: number }) : {};
  const year = body.year ?? 2026;
  const month = body.month ?? 6;
  const monthZero = month - 1;

  try {
    await query(`DELETE FROM leaves WHERE id = $1`, [id]);

    const leaves = await getLeaves();

    // Re-generate the affected month
    let prevRoster: RosterData | null = null;
    const existingId = await getRosterId(year, month);
    if (existingId) {
      prevRoster = await loadPrevRosterForRegen(existingId, year, monthZero, leaves);
    }

    const generated = generateRoster(year, monthZero, leaves, prevRoster, false);
    const rosterId = await saveGeneratedRoster(year, month, monthZero, generated, false);
    const roster = await loadRosterFromDb(rosterId, year, monthZero, leaves);

    const response: RosterApiResponse = { roster, leaves, rosterId };
    return Response.json(response);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return Response.json({ error: message }, { status: 500 });
  }
}
