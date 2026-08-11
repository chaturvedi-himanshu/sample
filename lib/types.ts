export type Gender = 'M' | 'F';
export type ShiftMode = 'all' | 'rohan' | 'imran';
export type Source = 'generated' | 'manual';

export interface Doctor {
  id: string;
  name: string;
  initials: string;
  gender: Gender;
  weeklyOff: number; // 0=Sun, 1=Mon, ..., 6=Sat
  obgynEligible: boolean;
  mode: ShiftMode;
  recovery: boolean;
  chip: string;
  note: string;
}

export interface ShiftDef {
  key: string;
  label: string;
  time: string;
  startH: number;
  endH: number;
  eligibility: 'any' | 'female';
  color: string;
}

export interface Leave {
  id: string;
  doctorId: string;
  date: string; // YYYY-MM-DD
  reason?: string;
}

export interface ShiftCell {
  active: boolean;
  assignments: string[]; // doctor IDs
}

export interface DayMeta {
  onLeave: string[];
  off: string[];
  recovery: string[];
  unavailableCount: number;
  removeObgyn: boolean;
  removeDay: boolean;
}

export interface DayData {
  shifts: Record<string, ShiftCell>;
  manualCells: Record<string, boolean>;
  meta: DayMeta;
}

export type RosterData = Record<string, DayData>;

export interface RosterApiResponse {
  roster: RosterData;
  leaves: Leave[];
  rosterId: string;
}
