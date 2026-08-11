CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS doctors (
  id             TEXT        PRIMARY KEY,
  name           TEXT        NOT NULL,
  initials       TEXT        NOT NULL,
  gender         CHAR(1)     NOT NULL CHECK (gender IN ('M', 'F')),
  weekly_off     SMALLINT    NOT NULL CHECK (weekly_off BETWEEN 0 AND 6), -- 0=Sun … 6=Sat
  obgyn_eligible BOOLEAN     NOT NULL DEFAULT false,
  mode           TEXT        NOT NULL DEFAULT 'all' CHECK (mode IN ('all', 'rohan', 'imran')),
  recovery       BOOLEAN     NOT NULL DEFAULT true,
  chip_color     TEXT        NOT NULL DEFAULT '#888888',
  note           TEXT
);

CREATE TABLE IF NOT EXISTS shift_types (
  id            TEXT        PRIMARY KEY,
  label         TEXT        NOT NULL,
  time_range    TEXT        NOT NULL,
  start_hour    SMALLINT    NOT NULL,
  end_hour      SMALLINT    NOT NULL,
  eligibility   TEXT        NOT NULL DEFAULT 'any' CHECK (eligibility IN ('any', 'female')),
  min_doctors   SMALLINT    NOT NULL DEFAULT 1,
  display_order SMALLINT    NOT NULL,
  color         TEXT        NOT NULL
);

CREATE TABLE IF NOT EXISTS leaves (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  doctor_id   TEXT        NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
  leave_date  DATE        NOT NULL,
  reason      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (doctor_id, leave_date)
);

CREATE TABLE IF NOT EXISTS monthly_rosters (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  year         SMALLINT    NOT NULL,
  month        SMALLINT    NOT NULL CHECK (month BETWEEN 1 AND 12),
  status       TEXT        NOT NULL DEFAULT 'generated' CHECK (status IN ('draft', 'generated')),
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (year, month)
);

CREATE TABLE IF NOT EXISTS shift_day_status (
  roster_id       UUID     NOT NULL REFERENCES monthly_rosters(id) ON DELETE CASCADE,
  shift_type_id   TEXT     NOT NULL REFERENCES shift_types(id),
  assignment_date DATE     NOT NULL,
  active          BOOLEAN  NOT NULL DEFAULT true,
  is_manual_cell  BOOLEAN  NOT NULL DEFAULT false,
  PRIMARY KEY (roster_id, shift_type_id, assignment_date)
);

CREATE TABLE IF NOT EXISTS assignments (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  roster_id           UUID        NOT NULL REFERENCES monthly_rosters(id) ON DELETE CASCADE,
  shift_type_id       TEXT        NOT NULL REFERENCES shift_types(id),
  doctor_id           TEXT        NOT NULL REFERENCES doctors(id),
  assignment_date     DATE        NOT NULL,
  is_manual_override  BOOLEAN     NOT NULL DEFAULT false,
  source              TEXT        NOT NULL DEFAULT 'generated' CHECK (source IN ('generated', 'manual')),
  note                TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (roster_id, shift_type_id, doctor_id, assignment_date)
);

CREATE INDEX IF NOT EXISTS idx_assignments_roster    ON assignments (roster_id);
CREATE INDEX IF NOT EXISTS idx_assignments_date      ON assignments (assignment_date);
CREATE INDEX IF NOT EXISTS idx_shift_day_status_roster ON shift_day_status (roster_id);
CREATE INDEX IF NOT EXISTS idx_leaves_doctor         ON leaves (doctor_id);
CREATE INDEX IF NOT EXISTS idx_leaves_date           ON leaves (leave_date);

INSERT INTO doctors (id, name, initials, gender, weekly_off, obgyn_eligible, mode, recovery, chip_color, note)
VALUES
  ('meera',  'Dr. Meera Kapoor',   'MK', 'F', 3, true,  'all',   true,  '#2F6F5E', 'Subject to post-night recovery rule'),
  ('rohan',  'Dr. Rohan Khanna',   'RK', 'M', 5, false, 'rohan', false, '#5B4B8A', '4 nights Mon–Thu + 1 morning + 1 afternoon/week; exempt from recovery'),
  ('aditya', 'Dr. Aditya Nair',    'AN', 'M', 4, false, 'all',   true,  '#8A5A2F', 'Subject to post-night recovery rule'),
  ('priya',  'Dr. Priya Sharma',   'PS', 'F', 2, true,  'all',   true,  '#A13E5C', 'Subject to post-night recovery rule'),
  ('imran',  'Dr. Imran Siddiqui', 'IS', 'M', 0, false, 'imran', true,  '#2F5F8A', 'Day Shift only; max 2 nights/month'),
  ('kavya',  'Dr. Kavya Menon',    'KM', 'F', 6, true,  'all',   true,  '#6B7A2F', 'Subject to post-night recovery rule')
ON CONFLICT (id) DO NOTHING;

INSERT INTO shift_types (id, label, time_range, start_hour, end_hour, eligibility, min_doctors, display_order, color)
VALUES
  ('morning',   'Morning',   '8:00 AM – 2:00 PM',  8,  14, 'any',    1, 1, '#E0982C'),
  ('day',       'Day',       '10:00 AM – 6:00 PM', 10, 18, 'any',    1, 2, '#3E8EC7'),
  ('obgyn',     'OBGYN',     '10:00 AM – 6:00 PM', 10, 18, 'female', 1, 3, '#C94F79'),
  ('afternoon', 'Afternoon', '2:00 PM – 8:00 PM',  14, 20, 'any',    1, 4, '#BD5A2E'),
  ('night',     'Night',     '8:00 PM – 8:00 AM',  20, 32, 'any',    1, 5, '#39335F')
ON CONFLICT (id) DO NOTHING;

INSERT INTO leaves (doctor_id, leave_date)
VALUES
  ('meera',  '2026-06-05'),
  ('aditya', '2026-06-12'),
  ('priya',  '2026-06-19'),
  ('kavya',  '2026-06-23')
ON CONFLICT (doctor_id, leave_date) DO NOTHING;
