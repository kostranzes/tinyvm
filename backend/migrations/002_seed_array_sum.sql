WITH new_task AS (
  INSERT INTO tasks (slug, title, description, starter_code, instruction_limit, difficulty)
  VALUES (
    'array-sum',
    'Сумма массива',
    $desc$Найдите сумму элементов массива беззнаковых 64-битных чисел.

Вход:
- rdi: адрес начала массива (0x110000)
- rsi: количество элементов
- элементы лежат подряд в памяти, по 8 байт, порядок байт little-endian

Выход:
- rax: сумма всех элементов (по модулю 2^64)

Массив может быть пустым (rsi = 0), тогда результат равен 0.$desc$,
    $code$; rdi = адрес массива, rsi = количество элементов (по 8 байт)
; результат нужно оставить в rax

$code$,
    10000,
    'easy'
  )
  RETURNING id
)
INSERT INTO task_tests (task_id, position, is_hidden, input, expected)
SELECT new_task.id, t.pos, t.hidden, t.input::jsonb, t.expected::jsonb
FROM new_task,
(VALUES
  (1, false,
   '{"registers":{"rdi":"0x110000","rsi":"4"},"memory":[{"address":"0x110000","data":"0100000000000000020000000000000003000000000000000400000000000000"}]}',
   '{"registers":{"rax":"0x000000000000000a"}}'),
  (2, true,
   '{"registers":{"rdi":"0x110000","rsi":"1"},"memory":[{"address":"0x110000","data":"2a00000000000000"}]}',
   '{"registers":{"rax":"0x000000000000002a"}}'),
  (3, true,
   '{"registers":{"rdi":"0x110000","rsi":"0"},"memory":[]}',
   '{"registers":{"rax":"0x0000000000000000"}}')
) AS t(pos, hidden, input, expected);