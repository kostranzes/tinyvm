CREATE TABLE tasks (
  id                 bigserial PRIMARY KEY,
  slug               text NOT NULL UNIQUE,
  title              text NOT NULL,
  description        text NOT NULL,
  starter_code       text NOT NULL DEFAULT '',
  instruction_limit  integer NOT NULL DEFAULT 1000
                     CHECK (instruction_limit BETWEEN 1 AND 1000000),
  difficulty         text NOT NULL DEFAULT 'easy'
                     CHECK (difficulty IN ('easy', 'medium', 'hard')),
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- input:    {"registers": {"rdi": "0x110000"}, "memory": [{"address": "0x110000", "data": "0a00..."}]}
-- expected: {"registers": {"rax": "0x000000000000000f"}, "memory": [{"address": "0x110000", "data": "..."}]}
-- Скрытые тесты (is_hidden) не должны попадать в ответы пользователю.
CREATE TABLE task_tests (
  id          bigserial PRIMARY KEY,
  task_id     bigint NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  position    integer NOT NULL,
  is_hidden   boolean NOT NULL DEFAULT false,
  input       jsonb NOT NULL,
  expected    jsonb NOT NULL,
  UNIQUE (task_id, position)
);

CREATE TABLE submissions (
  id                 bigserial PRIMARY KEY,
  task_id            bigint NOT NULL REFERENCES tasks (id),
  source             text NOT NULL,
  verdict            text NOT NULL
                     CHECK (verdict IN ('accepted', 'wrong_answer', 'runtime_error',
                                        'limit_exceeded', 'assembly_error')),
  instruction_count  integer,
  details            jsonb,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX submissions_task_id_idx ON submissions (task_id, created_at DESC);