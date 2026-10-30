#!/usr/bin/env sh
# Генератор трафика: обычный CRUD и немного ошибочных запросов.
# Использование: ./scripts/traffic.sh [адрес] [число проходов]
set -u
BASE=${1:-http://localhost:18080}
ROUNDS=${2:-20}

req() {
  curl -s --noproxy '*' -m 5 -H 'Content-Type: application/json' "$@"
}

id_of() {
  sed -n 's/.*"id":\([0-9]*\).*/\1/p'
}

i=0
while [ "$i" -lt "$ROUNDS" ]; do
  i=$((i + 1))
  space=$(req -X POST "$BASE/api/spaces" -d "{\"name\":\"Нагрузка $i\"}" | id_of)
  task=$(req -X POST "$BASE/api/tasks" -d "{\"space_id\":$space,\"title\":\"Таска $i\",\"priority\":\"high\"}" | id_of)
  req -o /dev/null "$BASE/api/tasks?space_id=$space"
  req -o /dev/null -X PATCH "$BASE/api/tasks/$task" -d '{"status":"in_progress"}'
  req -o /dev/null -X PATCH "$BASE/api/tasks/$task" -d '{"status":"done"}'
  extra=$(req -X POST "$BASE/api/tasks" -d "{\"space_id\":$space,\"title\":\"Лишняя $i\",\"priority\":\"low\"}" | id_of)
  req -o /dev/null -X DELETE "$BASE/api/tasks/$extra"
  # Ошибки клиента: пустое имя, несуществующая таска, неверный приоритет.
  req -o /dev/null -X POST "$BASE/api/spaces" -d '{"name":""}'
  req -o /dev/null "$BASE/api/tasks/999999"
  req -o /dev/null -X POST "$BASE/api/tasks" -d "{\"space_id\":$space,\"title\":\"x\",\"priority\":\"wrong\"}"
  # Каждый пятый раздел оставляем, чтобы в базе копились таски.
  if [ $((i % 5)) -ne 0 ]; then
    req -o /dev/null -X DELETE "$BASE/api/spaces/$space"
  fi
done
echo "Готово: $ROUNDS проходов на $BASE"
