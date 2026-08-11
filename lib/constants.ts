import type { Doctor, ShiftDef } from './types';

export const SHIFT_DEFS: Record<string, ShiftDef> = {
  morning:   { key: 'morning',   label: 'Morning',   time: '8:00 AM – 2:00 PM',  startH: 8,  endH: 14, eligibility: 'any',    color: '#E0982C' },
  day:       { key: 'day',       label: 'Day',       time: '10:00 AM – 6:00 PM', startH: 10, endH: 18, eligibility: 'any',    color: '#3E8EC7' },
  obgyn:     { key: 'obgyn',     label: 'OBGYN',     time: '10:00 AM – 6:00 PM', startH: 10, endH: 18, eligibility: 'female', color: '#C94F79' },
  afternoon: { key: 'afternoon', label: 'Afternoon', time: '2:00 PM – 8:00 PM',  startH: 14, endH: 20, eligibility: 'any',    color: '#BD5A2E' },
  night:     { key: 'night',     label: 'Night',     time: '8:00 PM – 8:00 AM',  startH: 20, endH: 32, eligibility: 'any',    color: '#39335F' },
};

export const SHIFT_ORDER = ['morning', 'day', 'obgyn', 'afternoon', 'night'] as const;

export const DOCTORS: Doctor[] = [
  { id: 'meera',  name: 'Dr. Meera Kapoor',   initials: 'MK', gender: 'F', weeklyOff: 3, obgynEligible: true,  mode: 'all',   recovery: true,  chip: '#2F6F5E', note: 'Subject to post-night recovery rule' },
  { id: 'rohan',  name: 'Dr. Rohan Khanna',   initials: 'RK', gender: 'M', weeklyOff: 5, obgynEligible: false, mode: 'rohan', recovery: false, chip: '#5B4B8A', note: '4 nights Mon–Thu + 1 morning + 1 afternoon/week; exempt from recovery' },
  { id: 'aditya', name: 'Dr. Aditya Nair',    initials: 'AN', gender: 'M', weeklyOff: 4, obgynEligible: false, mode: 'all',   recovery: true,  chip: '#8A5A2F', note: 'Subject to post-night recovery rule' },
  { id: 'priya',  name: 'Dr. Priya Sharma',   initials: 'PS', gender: 'F', weeklyOff: 2, obgynEligible: true,  mode: 'all',   recovery: true,  chip: '#A13E5C', note: 'Subject to post-night recovery rule' },
  { id: 'imran',  name: 'Dr. Imran Siddiqui', initials: 'IS', gender: 'M', weeklyOff: 0, obgynEligible: false, mode: 'imran', recovery: true,  chip: '#2F5F8A', note: 'Day Shift only; max 2 nights/month' },
  { id: 'kavya',  name: 'Dr. Kavya Menon',    initials: 'KM', gender: 'F', weeklyOff: 6, obgynEligible: true,  mode: 'all',   recovery: true,  chip: '#6B7A2F', note: 'Subject to post-night recovery rule' },
];

export const DOCTOR_MAP: Record<string, Doctor> = Object.fromEntries(DOCTORS.map(d => [d.id, d]));

export const NIGHT_POOL = ['meera', 'aditya', 'priya', 'kavya'];
export const OBGYN_POOL = ['meera', 'priya', 'kavya'];
export const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const AXIS_START = 6;
export const AXIS_END = 32;

export const INITIAL_LEAVES = [
  { id: 'l1', doctorId: 'meera',  date: '2026-06-05' },
  { id: 'l2', doctorId: 'aditya', date: '2026-06-12' },
  { id: 'l3', doctorId: 'priya',  date: '2026-06-19' },
  { id: 'l4', doctorId: 'kavya',  date: '2026-06-23' },
];
