import { type NextRequest } from 'next/server';
import { getLeaves, getRosterId, loadRosterFromDb, saveGeneratedRoster } from '@/lib/rosterDb';
import { generateRoster } from '@/lib/scheduler';
import type { RosterApiResponse } from '@/lib/types';

export async function GET(request: NextRequest): Promise<Response> {
  const { searchParams } = request.nextUrl;
  const year = parseInt(searchParams.get('year') ?? '2026', 10);
  const month = parseInt(searchParams.get('month') ?? '6', 10);
  const monthZero = month - 1;

  try {
    const leaves = await getLeaves();
    let rosterId = await getRosterId(year, month);

    if (!rosterId) {
      // Auto-generate if no data exists for this month
      const generated = generateRoster(year, monthZero, leaves, null, false);
      rosterId = await saveGeneratedRoster(year, month, monthZero, generated, false);
    }

    const roster = await loadRosterFromDb(rosterId, year, monthZero, leaves);

    const body: RosterApiResponse = { roster, leaves, rosterId };
    return Response.json(body);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return Response.json({ error: message }, { status: 500 });
  }
}
