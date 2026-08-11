import type { Leave, RosterData, ShiftCell, Doctor } from './types';
import { DOCTORS, DOCTOR_MAP, SHIFT_ORDER, NIGHT_POOL, OBGYN_POOL, WEEKDAY_LABELS } from './constants';

// ── Date helpers ──────────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, '0');

export const toISO = (y: number, mZero: number, d: number) =>
  `${y}-${pad(mZero + 1)}-${pad(d)}`;

export const daysInMonth = (y: number, mZero: number) =>
  new Date(y, mZero + 1, 0).getDate();

export const dowOf = (iso: string) => new Date(iso + 'T00:00:00').getDay();

export const prevISO = (iso: string): string => {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() - 1);
  return toISO(d.getFullYear(), d.getMonth(), d.getDate());
};

export const mondayOfWeek = (iso: string): string => {
  const d = new Date(iso + 'T00:00:00');
  const delta = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - delta);
  return toISO(d.getFullYear(), d.getMonth(), d.getDate());
};

export const monthLabel = (y: number, mZero: number) =>
  new Date(y, mZero, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

// ── Core generator ────────────────────────────────────────

export function generateRoster(
  year: number,
  monthZero: number,
  leaves: Leave[],
  prevRoster: RosterData | null,
  resetManual: boolean
): RosterData {
  const total = daysInMonth(year, monthZero);
  const roster: RosterData = {};

  const weekly: Record<string, number> = {};
  const monthlyNight: Record<string, number> = {};
  const monthlyObgyn: Record<string, number> = {};
  DOCTORS.forEach(d => {
    weekly[d.id] = 0;
    monthlyNight[d.id] = 0;
    monthlyObgyn[d.id] = 0;
  });

  let rohanMorningDoneThisWeek = false;
  let rohanAfternoonDoneThisWeek = false;
  let nightYesterday = new Set<string>();

  for (let day = 1; day <= total; day++) {
    const iso = toISO(year, monthZero, day);
    const dow = dowOf(iso);

    // Rule 5: reset weekly counter on Monday
    if (dow === 1) {
      DOCTORS.forEach(d => (weekly[d.id] = 0));
      rohanMorningDoneThisWeek = false;
      rohanAfternoonDoneThisWeek = false;
    }

    const prevDay = prevRoster?.[iso];
    const manualCells: Record<string, boolean> =
      !resetManual && prevDay ? { ...prevDay.manualCells } : {};

    const onLeaveToday = new Set(leaves.filter(l => l.date === iso).map(l => l.doctorId));
    const offToday = new Set(DOCTORS.filter(d => d.weeklyOff === dow).map(d => d.id));
    const recoveryToday = new Set(
      [...nightYesterday].filter(id => DOCTOR_MAP[id]?.recovery)
    );

    const unavailable = new Set([...onLeaveToday, ...offToday, ...recoveryToday]);
    const removeObgyn = unavailable.size >= 2;
    const removeDay = unavailable.size >= 3;

    const assignedToday = new Set<string>();
    const shifts: Record<string, ShiftCell> = {};
    SHIFT_ORDER.forEach(k => (shifts[k] = { active: true, assignments: [] }));
    if (removeObgyn) shifts.obgyn.active = false;
    if (removeDay) shifts.day.active = false;

    const availableFor = (doc: Doctor) =>
      !onLeaveToday.has(doc.id) &&
      !offToday.has(doc.id) &&
      !assignedToday.has(doc.id) &&
      weekly[doc.id] < 6;

    // Lock in manual cells from previous run (spec §13)
    const lockManual = (key: string): boolean => {
      if (manualCells[key] && prevDay?.shifts[key]) {
        shifts[key] = {
          active: prevDay.shifts[key].active,
          assignments: [...prevDay.shifts[key].assignments],
        };
        shifts[key].assignments.forEach(id => {
          assignedToday.add(id);
          weekly[id] = (weekly[id] || 0) + 1;
          if (key === 'night') monthlyNight[id] = (monthlyNight[id] || 0) + 1;
          if (key === 'obgyn') monthlyObgyn[id] = (monthlyObgyn[id] || 0) + 1;
        });
        return true;
      }
      return false;
    };

    // Rule 6: Rohan's fixed weekly pattern
    let rohanShiftToday: string | null = null;
    if (!onLeaveToday.has('rohan') && !offToday.has('rohan')) {
      if ([1, 2, 3, 4].includes(dow)) rohanShiftToday = 'night';
      else if (dow === 6 && !rohanMorningDoneThisWeek) rohanShiftToday = 'morning';
      else if (dow === 0 && !rohanAfternoonDoneThisWeek) rohanShiftToday = 'afternoon';
    }

    // ── NIGHT (rules 6, 7, 9, 10) ──────────────────────────
    if (!lockManual('night') && shifts.night.active) {
      if (rohanShiftToday === 'night') {
        shifts.night.assignments.push('rohan');
        assignedToday.add('rohan');
        weekly.rohan++;
        monthlyNight.rohan++;
      } else {
        let candidates = NIGHT_POOL.filter(
          id => availableFor(DOCTOR_MAP[id]) && !recoveryToday.has(id)
        );
        // Imran fallback (rule 7) — capped at 2/month
        if (candidates.length === 0) {
          const imran = DOCTOR_MAP.imran;
          if (availableFor(imran) && !recoveryToday.has('imran') && monthlyNight.imran < 2) {
            candidates = ['imran'];
          }
        }
        if (candidates.length > 0) {
          candidates.sort((a, b) => monthlyNight[a] - monthlyNight[b]); // rule 10: equal distribution
          const pick = candidates[0];
          shifts.night.assignments.push(pick);
          assignedToday.add(pick);
          weekly[pick]++;
          monthlyNight[pick]++;
        }
      }
    }

    // ── OBGYN (rules 1, 11) ────────────────────────────────
    if (shifts.obgyn.active && !lockManual('obgyn')) {
      const candidates = OBGYN_POOL.filter(
        id => availableFor(DOCTOR_MAP[id]) && !recoveryToday.has(id)
      );
      if (candidates.length > 0) {
        candidates.sort((a, b) => monthlyObgyn[a] - monthlyObgyn[b]); // rule 11: equal distribution
        const pick = candidates[0];
        shifts.obgyn.assignments.push(pick);
        assignedToday.add(pick);
        weekly[pick]++;
        monthlyObgyn[pick]++;
      }
    }

    // ── MORNING ────────────────────────────────────────────
    if (!lockManual('morning')) {
      if (rohanShiftToday === 'morning') {
        shifts.morning.assignments.push('rohan');
        assignedToday.add('rohan');
        weekly.rohan++;
        rohanMorningDoneThisWeek = true;
      } else {
        const candidates = DOCTORS.filter(
          d => d.mode !== 'imran' && d.id !== 'rohan' && availableFor(d) && !recoveryToday.has(d.id)
        );
        if (candidates.length > 0) {
          candidates.sort((a, b) => weekly[a.id] - weekly[b.id]);
          const pick = candidates[0].id;
          shifts.morning.assignments.push(pick);
          assignedToday.add(pick);
          weekly[pick]++;
        }
      }
    }

    // ── AFTERNOON (rule 8: recovery doctors get first refusal) ──
    if (!lockManual('afternoon')) {
      if (rohanShiftToday === 'afternoon') {
        shifts.afternoon.assignments.push('rohan');
        assignedToday.add('rohan');
        weekly.rohan++;
        rohanAfternoonDoneThisWeek = true;
      } else {
        let pick: string | null = null;
        const recoveryCandidates = DOCTORS.filter(
          d => recoveryToday.has(d.id) && d.mode !== 'imran' && availableFor(d)
        );
        if (recoveryCandidates.length > 0) {
          recoveryCandidates.sort((a, b) => weekly[a.id] - weekly[b.id]);
          pick = recoveryCandidates[0].id;
        } else {
          const normalCandidates = DOCTORS.filter(
            d => d.mode !== 'imran' && d.id !== 'rohan' && availableFor(d)
          );
          if (normalCandidates.length > 0) {
            normalCandidates.sort((a, b) => weekly[a.id] - weekly[b.id]);
            pick = normalCandidates[0].id;
          }
        }
        if (pick) {
          shifts.afternoon.assignments.push(pick);
          assignedToday.add(pick);
          weekly[pick]++;
        }
      }
    }

    // ── DAY (rule 12: catch-all) ───────────────────────────
    if (shifts.day.active && !lockManual('day')) {
      const remaining = DOCTORS.filter(
        d => d.id !== 'rohan' && availableFor(d) && !recoveryToday.has(d.id)
      );
      remaining.forEach(d => {
        shifts.day.assignments.push(d.id);
        assignedToday.add(d.id);
        weekly[d.id]++;
      });
    }

    roster[iso] = {
      shifts,
      manualCells,
      meta: {
        onLeave: [...onLeaveToday],
        off: [...offToday],
        recovery: [...recoveryToday],
        unavailableCount: unavailable.size,
        removeObgyn,
        removeDay,
      },
    };

    nightYesterday = new Set(shifts.night.assignments);
  }

  return roster;
}

// ── Meta recomputation (used when loading roster from DB) ─

export function computeRosterMeta(
  year: number,
  monthZero: number,
  rosterData: RosterData,
  leaves: Leave[]
): RosterData {
  const total = daysInMonth(year, monthZero);
  const result: RosterData = { ...rosterData };
  let nightYesterday = new Set<string>();

  for (let day = 1; day <= total; day++) {
    const iso = toISO(year, monthZero, day);
    const dow = dowOf(iso);
    const dayData = result[iso];
    if (!dayData) continue;

    const onLeaveToday = new Set(leaves.filter(l => l.date === iso).map(l => l.doctorId));
    const offToday = new Set(DOCTORS.filter(d => d.weeklyOff === dow).map(d => d.id));
    const recoveryToday = new Set(
      [...nightYesterday].filter(id => DOCTOR_MAP[id]?.recovery)
    );
    const unavailable = new Set([...onLeaveToday, ...offToday, ...recoveryToday]);

    result[iso] = {
      ...dayData,
      meta: {
        onLeave: [...onLeaveToday],
        off: [...offToday],
        recovery: [...recoveryToday],
        unavailableCount: unavailable.size,
        removeObgyn: unavailable.size >= 2,
        removeDay: unavailable.size >= 3,
      },
    };

    nightYesterday = new Set(dayData.shifts.night?.assignments ?? []);
  }

  return result;
}

// ── Manual assignment validation ─────────────────────────

export function validateAssignment(
  doctorId: string,
  iso: string,
  shiftKey: string,
  roster: RosterData,
  leaves: Leave[]
): string[] {
  const doc = DOCTOR_MAP[doctorId];
  const dow = dowOf(iso);
  const warnings: string[] = [];

  if (shiftKey === 'obgyn' && doc.gender !== 'F') {
    warnings.push(`${doc.name} — OBGYN is restricted to female doctors.`);
  }
  if (doc.weeklyOff === dow) {
    warnings.push(`${doc.name} has a weekly off on ${WEEKDAY_LABELS[dow]}.`);
  }
  if (leaves.some(l => l.doctorId === doctorId && l.date === iso)) {
    warnings.push(`${doc.name} is on approved leave this day.`);
  }

  const day = roster[iso];
  if (day) {
    SHIFT_ORDER.forEach(k => {
      if (k !== shiftKey && day.shifts[k]?.assignments.includes(doctorId)) {
        warnings.push(
          `${doc.name} is already on the ${k.charAt(0).toUpperCase() + k.slice(1)} shift today — one shift per day.`
        );
      }
    });
  }

  if (doc.mode === 'imran' && shiftKey !== 'day' && shiftKey !== 'night') {
    warnings.push(`${doc.name} is Day-Shift-only (Night allowed only as a capped exception).`);
  }
  if (doc.mode === 'rohan' && !['night', 'morning', 'afternoon'].includes(shiftKey)) {
    warnings.push(`${doc.name}'s pattern is fixed to Night / Morning / Afternoon only.`);
  }

  const prevDay = roster[prevISO(iso)];
  const wasNightYesterday = prevDay?.shifts.night?.assignments.includes(doctorId);
  if (wasNightYesterday && doc.recovery && shiftKey !== 'afternoon') {
    warnings.push(
      `${doc.name} worked Night yesterday — post-night recovery allows only Afternoon or off.`
    );
  }
  if (wasNightYesterday && shiftKey === 'night' && doc.mode !== 'rohan') {
    warnings.push(`${doc.name} cannot work consecutive Night shifts.`);
  }

  const monday = mondayOfWeek(iso);
  let weekCount = 0;
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday + 'T00:00:00');
    d.setDate(d.getDate() + i);
    const wIso = toISO(d.getFullYear(), d.getMonth(), d.getDate());
    const wDay = roster[wIso];
    if (wDay) {
      SHIFT_ORDER.forEach(k => {
        if (wDay.shifts[k]?.assignments.includes(doctorId)) weekCount++;
      });
    }
  }
  if (weekCount >= 6 && !day?.shifts[shiftKey]?.assignments.includes(doctorId)) {
    warnings.push(`${doc.name} would exceed the 6-shifts-per-week limit.`);
  }

  return warnings;
}
