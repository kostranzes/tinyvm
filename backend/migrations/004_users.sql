CREATE TABLE users (
  id             bigserial PRIMARY KEY,
  email          text NOT NULL,
  password_hash  text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- Email без учёта регистра.
CREATE UNIQUE INDEX users_email_lower_idx ON users (lower(email));

-- В token_hash лежит SHA-256 от токена из куки, сам токен не хранится.
CREATE TABLE login_sessions (
  token_hash  text PRIMARY KEY,
  user_id     bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL
);

CREATE INDEX login_sessions_user_idx ON login_sessions (user_id);
CREATE INDEX login_sessions_expires_idx ON login_sessions (expires_at);