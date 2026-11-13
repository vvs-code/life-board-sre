#!/usr/bin/env sh
# Сборка образов приложения в Docker-демоне minikube.
set -eu
cd "$(dirname "$0")/.."

# 1. Базовые образы скачиваются на хосте и загружаются в minikube через `minikube image load`.
#    Так сборка не зависит от того, резолвит ли DNS внутри ноды minikube внешние реестры.
for image in node:22-alpine nginx:1.27-alpine postgres:16-alpine \
  victoriametrics/victoria-logs:v1.53.0 timberio/vector:0.61.0-alpine \
  victoriametrics/victoria-metrics:v1.155.0 prometheuscommunity/postgres-exporter:v0.20.1 \
  victoriametrics/vmalert:v1.155.0 prom/alertmanager:v0.34.1 axllent/mailpit:v1.29; do
  docker pull -q "$image"
  minikube image load "$image"
done

# 2. Переключаем docker CLI на демон внутри minikube и собираем образы прямо там.
#    После этого кластер видит их без реестра (imagePullPolicy: Never в манифестах).
eval "$(minikube docker-env)"
docker build -t lifeboard-backend:0.6.0 backend
docker build -t lifeboard-frontend:0.6.0 frontend
docker images | grep lifeboard
