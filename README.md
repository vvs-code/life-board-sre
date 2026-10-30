# Life Board. Домашние задания по SRE

## Отчёты

| ДЗ | Тема | Отчёт |
|---|---|---|
| 1 | Приложение 12 факторов | [docs/hw-1/Отчет.md](docs/hw-1/Отчет.md) |
| 2 | Основы Kubernetes | [docs/hw-2/Отчет.md](docs/hw-2/Отчет.md) |
| 3 | Логирование | [docs/hw-3/Отчет.md](docs/hw-3/Отчет.md) |
| 4 | Метрики | [docs/hw-4/Отчет.md](docs/hw-4/Отчет.md) |

Описание продукта: [docs/PRODUCT.md](docs/PRODUCT.md). Целевая архитектура: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Docker Compose

```bash
cp .env.example .env
docker compose up --build
```

Приложение откроется на http://localhost:8080.

## Kubernetes (minikube)

```bash
./scripts/start-minikube.sh
./scripts/build-images.sh
kubectl -n lifeboard delete job migrate --ignore-not-found
kubectl apply -k k8s/
minikube service frontend -n lifeboard
```

## Логи

```bash
kubectl apply -k k8s/logging/
kubectl -n monitoring port-forward svc/victoria-logs 9428:9428
```

Интерфейс Victoria Logs откроется на http://localhost:9428/select/vmui/. Трафик для проверки даёт `scripts/traffic.sh`.

## Метрики

```bash
helm repo add vm https://victoriametrics.github.io/helm-charts/
helm upgrade --install vm-single vm/victoria-metrics-single --version 0.50.0 -n monitoring -f k8s/metrics/vm-values.yaml
kubectl -n monitoring port-forward svc/vm-single-victoria-metrics-single-server 8428:8428
```

Интерфейс Victoria Metrics откроется на http://localhost:8428/vmui/, цели сбора на http://localhost:8428/targets.

## Тесты

```bash
cd backend && npm install && npm test
```
