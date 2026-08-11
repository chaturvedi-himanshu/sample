import { type NextRequest } from 'next/server';
import {
  getLeaves,
  getRosterId,
  loadPrevRosterForRegen,
  saveGeneratedRoster,
  loadRosterFromDb,
} from '@/lib/rosterDb';
import { generateRoster } from '@/lib/scheduler';
import type { RosterApiResponse, RosterData } from '@/lib/types';

export async function POST(request: NextRequest): Promise<Response> {
  const body = await request.json();
  const { year, month, resetManual = false } = body as {
    year: number;
    month: number;
    resetManual?: boolean;
  };
  const monthZero = month - 1;

  try {
    const leaves = await getLeaves();

    // Load existing manual overrides (unless reset)
    let prevRoster: RosterData | null = null;
    const existingId = await getRosterId(year, month);
    if (existingId && !resetManual) {
      prevRoster = await loadPrevRosterForRegen(existingId, year, monthZero, leaves);
    }

    const generated = generateRoster(year, monthZero, leaves, prevRoster, resetManual);
    const rosterId = await saveGeneratedRoster(year, month, monthZero, generated, resetManual);
    const roster = await loadRosterFromDb(rosterId, year, monthZero, leaves);

    const response: RosterApiResponse = { roster, leaves, rosterId };
    return Response.json(response);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return Response.json({ error: message }, { status: 500 });
  }
}
