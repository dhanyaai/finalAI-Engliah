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

COMMIT;