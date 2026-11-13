#!/usr/bin/env sh
# Управляемые сбои для демонстрации SLO.
# Использование: ./scripts/fault.sh errors|slow|block|db|off
set -eu
NS=lifeboard

case "${1:-}" in
  errors)
    # 30% запросов к API отвечают 500.
    kubectl -n "$NS" set env deployment/backend FAULT_ERROR_RATE=0.3 FAULT_DELAY_MS- FAULT_BLOCK_MS-
    ;;
  slow)
    # Каждый запрос к API медленнее на 600 мс.
    kubectl -n "$NS" set env deployment/backend FAULT_DELAY_MS=600 FAULT_ERROR_RATE- FAULT_BLOCK_MS-
    ;;
  block)
    # Каждый запрос к API на 150 мс занимает event loop синхронной работой.
    kubectl -n "$NS" set env deployment/backend FAULT_BLOCK_MS=150 FAULT_ERROR_RATE- FAULT_DELAY_MS-
    ;;
  db)
    # Падение базы: 500 от бэкенда, 502 от nginx и pg_up=0.
    kubectl -n "$NS" scale statefulset postgres --replicas=0
    ;;
  off)
    kubectl -n "$NS" scale statefulset postgres --replicas=1
    kubectl -n "$NS" set env deployment/backend FAULT_ERROR_RATE- FAULT_DELAY_MS- FAULT_BLOCK_MS-
    ;;
  *)
    echo "Использование: $0 errors|slow|block|db|off" >&2
    exit 1
    ;;
esac
