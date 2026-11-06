-- array-max
WITH new_task AS (
  INSERT INTO tasks (slug, title, description, starter_code, instruction_limit, difficulty)
  VALUES (
    'array-max',
    'Максимум массива',
    $desc$Найдите наибольший элемент массива беззнаковых 64-битных чисел.

Вход:
- rdi: адрес начала массива (0x110000)
- rsi: количество элементов, не меньше 1
- элементы лежат подряд в памяти, по 8 байт, порядок байт little-endian

Выход:
- rax: наибольший элемент

Числа беззнаковые: 0xffffffffffffffff больше любого другого значения.$desc$,
    $code$; rdi = адрес массива, rsi = количество элементов (по 8 байт, без знака)
; наибольший элемент нужно оставить в rax

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
   '{"registers":{"rdi":"0x110000","rsi":"4"},"memory":[{"address":"0x110000","data":"0300000000000000090000000000000002000000000000000700000000000000"}]}',
   '{"registers":{"rax":"9"}}'),
  (2, true,
   '{"registers":{"rdi":"0x110000","rsi":"1"},"memory":[{"address":"0x110000","data":"0500000000000000"}]}',
   '{"registers":{"rax":"5"}}'),
  (3, true,
   '{"registers":{"rdi":"0x110000","rsi":"3"},"memory":[{"address":"0x110000","data":"0100000000000000ffffffffffffffff0700000000000000"}]}',
   '{"registers":{"rax":"18446744073709551615"}}'),
  (4, true,
   '{"registers":{"rdi":"0x110000","rsi":"3"},"memory":[{"address":"0x110000","data":"0a000000000000000a000000000000000a00000000000000"}]}',
   '{"registers":{"rax":"10"}}')
) AS t(pos, hidden, input, expected);

-- array-reverse
WITH new_task AS (
  INSERT INTO tasks (slug, title, description, starter_code, instruction_limit, difficulty)
  VALUES (
    'array-reverse',
    'Разворот массива',
    $desc$Разверните массив 64-битных чисел на месте: первый элемент должен стать последним, второй предпоследним и так далее.

Вход:
- rdi: адрес начала массива (0x110000)
- rsi: количество элементов, может быть 0
- элементы лежат подряд в памяти, по 8 байт, порядок байт little-endian

Выход:
- массив в памяти по адресу rdi, записанный в обратном порядке

Память за пределами массива трогать нельзя. Регистры проверяться не будут.$desc$,
    $code$; rdi = адрес массива, rsi = количество элементов (по 8 байт)
; массив нужно развернуть на месте

$code$,
    10000,
    'medium'
  )
  RETURNING id
)
INSERT INTO task_tests (task_id, position, is_hidden, input, expected)
SELECT new_task.id, t.pos, t.hidden, t.input::jsonb, t.expected::jsonb
FROM new_task,
(VALUES
  (1, false,
   '{"registers":{"rdi":"0x110000","rsi":"5"},"memory":[{"address":"0x110000","data":"01000000000000000200000000000000030000000000000004000000000000000500000000000000"}]}',
   '{"memory":[{"address":"0x110000","data":"05000000000000000400000000000000030000000000000002000000000000000100000000000000"}]}'),
  (2, true,
   '{"registers":{"rdi":"0x110000","rsi":"1"},"memory":[{"address":"0x110000","data":"0700000000000000"}]}',
   '{"memory":[{"address":"0x110000","data":"0700000000000000"}]}'),
  (3, true,
   '{"registers":{"rdi":"0x110000","rsi":"4"},"memory":[{"address":"0x110000","data":"0100000000000000020000000000000003000000000000000400000000000000"}]}',
   '{"memory":[{"address":"0x110000","data":"0400000000000000030000000000000002000000000000000100000000000000"}]}'),
  (4, true,
   '{"registers":{"rdi":"0x110000","rsi":"2"},"memory":[{"address":"0x110000","data":"ffffffffffffffff0807060504030201"}]}',
   '{"memory":[{"address":"0x110000","data":"0807060504030201ffffffffffffffff"}]}'),
  (5, true,
   '{"registers":{"rdi":"0x110000","rsi":"0"},"memory":[{"address":"0x110000","data":"aa00000000000000"}]}',
   '{"memory":[{"address":"0x110000","data":"aa00000000000000"}]}')
) AS t(pos, hidden, input, expected);

-- factorial
WITH new_task AS (
  INSERT INTO tasks (slug, title, description, starter_code, instruction_limit, difficulty)
  VALUES (
    'factorial',
    'Факториал',
    $desc$Вычислите факториал числа n.

Вход:
- rdi: число n от 0 до 20

Выход:
- rax: n! (для n = 0 результат равен 1)

20! ещё помещается в 64 бита, поэтому переполнения не будет.$desc$,
    $code$; rdi = n (от 0 до 20)
; n! нужно оставить в rax

$code$,
    1000,
    'easy'
  )
  RETURNING id
)
INSERT INTO task_tests (task_id, position, is_hidden, input, expected)
SELECT new_task.id, t.pos, t.hidden, t.input::jsonb, t.expected::jsonb
FROM new_task,
(VALUES
  (1, false, '{"registers":{"rdi":"5"},"memory":[]}', '{"registers":{"rax":"120"}}'),
  (2, true, '{"registers":{"rdi":"0"},"memory":[]}', '{"registers":{"rax":"1"}}'),
  (3, true, '{"registers":{"rdi":"1"},"memory":[]}', '{"registers":{"rax":"1"}}'),
  (4, true, '{"registers":{"rdi":"10"},"memory":[]}', '{"registers":{"rax":"3628800"}}'),
  (5, true, '{"registers":{"rdi":"20"},"memory":[]}', '{"registers":{"rax":"2432902008176640000"}}')
) AS t(pos, hidden, input, expected);