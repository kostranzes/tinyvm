ALTER TABLE submissions
  ADD COLUMN user_id bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE;

CREATE INDEX submissions_user_idx ON submissions (user_id, created_at DESC);