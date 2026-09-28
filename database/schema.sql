BEGIN;

CREATE TABLE IF NOT EXISTS families (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_user_id TEXT NOT NULL UNIQUE,
  parent_pin_hash TEXT,
  parent_pin_salt TEXT,
  daily_limit_minutes INTEGER NOT NULL DEFAULT 20
    CHECK (daily_limit_minutes BETWEEN 5 AND 180),
  privacy_settings JSONB NOT NULL DEFAULT '{"shareAnalytics":false}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Local accounts always own newly-created local:<account UUID> families.
-- Legacy Clerk identities are intentionally left untouched and unclaimable.
CREATE TABLE IF NOT EXISTS local_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE CHECK (email = lower(email)),
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  recovery_hash TEXT NOT NULL,
  family_id UUID NOT NULL UNIQUE REFERENCES families(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE local_accounts ADD COLUMN IF NOT EXISTS recovery_hash TEXT;

CREATE TABLE IF NOT EXISTS local_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES local_accounts(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS local_sessions_account_id_idx ON local_sessions(account_id);
CREATE INDEX IF NOT EXISTS local_sessions_expires_at_idx ON local_sessions(expires_at);

CREATE TABLE IF NOT EXISTS child_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  age_band TEXT NOT NULL CHECK (age_band IN ('5–8','9–12','13–15')),
  level TEXT NOT NULL,
  daily_goal_minutes INTEGER NOT NULL
    CHECK (daily_goal_minutes BETWEEN 5 AND 180),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS child_progress (
  child_id UUID PRIMARY KEY REFERENCES child_profiles(id) ON DELETE CASCADE,
  completed_lesson_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  minutes INTEGER NOT NULL DEFAULT 0 CHECK (minutes >= 0),
  streak INTEGER NOT NULL DEFAULT 0 CHECK (streak >= 0),
  skill_scores JSONB NOT NULL DEFAULT '{}'::jsonb,
  assessments JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS child_profiles_family_id_idx
  ON child_profiles(family_id);

-- Reviewed curriculum is deliberately separate from learner progress.  Asset
-- URLs are provider metadata, never credentials; publishing is blocked until
-- both independent approvals are recorded.
CREATE TABLE IF NOT EXISTS curriculum_lessons (
  id TEXT PRIMARY KEY,
  level TEXT NOT NULL CHECK (level IN ('Pre-A1','A1','A2','B1','B2','C1')),
  unit_id TEXT NOT NULL,
  age_bands JSONB NOT NULL DEFAULT '["5–8","9–12","13–15"]'::jsonb,
  title TEXT NOT NULL,
  objective TEXT NOT NULL,
  duration INTEGER NOT NULL CHECK (duration BETWEEN 1 AND 180),
  lesson_type TEXT NOT NULL,
  review_state TEXT NOT NULL DEFAULT 'draft'
    CHECK (review_state IN ('draft','in_review','approved','published','rejected')),
  video JSONB NOT NULL,
  subtitles JSONB NOT NULL DEFAULT '[]'::jsonb,
  transcript TEXT NOT NULL DEFAULT '',
  vocabulary JSONB NOT NULL DEFAULT '[]'::jsonb,
  activities JSONB NOT NULL DEFAULT '[]'::jsonb,
  assessment JSONB,
  educator_approved BOOLEAN NOT NULL DEFAULT false,
  age_safety_approved BOOLEAN NOT NULL DEFAULT false,
  review_notes TEXT,
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE curriculum_lessons ADD COLUMN IF NOT EXISTS age_bands JSONB NOT NULL DEFAULT '["5–8","9–12","13–15"]'::jsonb;
CREATE INDEX IF NOT EXISTS curriculum_lessons_level_idx ON curriculum_lessons(level, unit_id);
INSERT INTO curriculum_lessons
  (id, level, unit_id, title, objective, duration, lesson_type, video, subtitles, transcript, vocabulary, activities, assessment)
SELECT lower(replace(level, '-', '')) || '-' || unit_id || '-' || lpad(n::text, 2, '0'),
  level, unit_id, topic || ': part ' || n,
  'Build confidence with ' || lower(topic) || ' in a new situation.',
  CASE level WHEN 'Pre-A1' THEN 10 WHEN 'A1' THEN 12 WHEN 'A2' THEN 15 WHEN 'B1' THEN 18 WHEN 'B2' THEN 20 ELSE 22 END,
  'Structured practice',
  jsonb_build_object('provider','mux','assetId','hikid-' || lower(replace(level, '-', '')) || '-' || unit_id || '-' || lpad(n::text, 2, '0'),
    'playbackUrl','https://stream.mux.com/hikid-' || lower(replace(level, '-', '')) || '-' || unit_id || '-' || lpad(n::text, 2, '0') || '.m3u8'),
  jsonb_build_array(jsonb_build_object('language','en','url','https://cdn.hikid.app/subtitles/' || lower(replace(level, '-', '')) || '-' || unit_id || '-' || lpad(n::text, 2, '0') || '.vtt')),
  'Watch, listen, and practise ' || lower(topic) || ' together.',
  jsonb_build_array('listen','speak','practise'),
  jsonb_build_array(jsonb_build_object('type','listen','prompt','Listen and repeat the useful phrase.')),
  jsonb_build_object('prompt','Choose the best phrase for this lesson.','answer','practise')
FROM (VALUES
 ('Pre-A1','p1','Hello, world'),('Pre-A1','p2','My little day'),('Pre-A1','p3','Play and move'),
 ('A1','a1','Meet and greet'),('A1','a2','Home base'),('A1','a3','Out and about'),
 ('A2','b1','Small adventures'),('A2','b2','Food lab'),('A2','b3','The big idea'),
 ('B1','c1','City signals'),('B1','c2','Make it happen'),('B1','c3','Point of view'),
 ('B2','d1','The bigger picture'),('B2','d2','Culture club'),('B2','d3','Future voices'),
 ('C1','e1','Elegant arguments'),('C1','e2','Deep listening'),('C1','e3','Your signature')
) AS units(level,unit_id,topic) CROSS JOIN generate_series(1,16) AS series(n)
WHERE (level='Pre-A1' AND n<=6) OR (level='A1' AND n<=8) OR (level='A2' AND n<=10)
   OR (level='B1' AND n<=12) OR (level='B2' AND n<=14) OR level='C1'
ON CONFLICT (id) DO NOTHING;

COMMIT;