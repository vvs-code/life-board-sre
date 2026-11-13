# Life Board. Домашние задания по SRE

## Отчёты

| ДЗ | Тема | Отчёт |
|---|---|---|
| 1 | Приложение 12 факторов | [docs/hw-1/Отчет.md](docs/hw-1/Отчет.md) |
| 2 | Основы Kubernetes | [docs/hw-2/Отчет.md](docs/hw-2/Отчет.md) |
| 3 | Логирование | [docs/hw-3/Отчет.md](docs/hw-3/Отчет.md) |
| 4 | Метрики | [docs/hw-4/Отчет.md](docs/hw-4/Отчет.md) |
| 5 | SLA | [docs/hw-5/Отчет.md](docs/hw-5/Отчет.md) |
| 6 | Алерты | [docs/hw-6/Отчет.md](docs/hw-6/Отчет.md) |
| 7 | Grafana | [docs/hw-7/Отчет.md](docs/hw-7/Отчет.md) |

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

## SLA

Пробер запускается вместе с приложением (`k8s/prober.yaml`). Для демонстрации есть управляемые сбои:

```bash
./scripts/fault.sh errors   # 30% запросов к API отвечают 500
./scripts/fault.sh slow     # каждый запрос медленнее на 600 мс
./scripts/fault.sh block    # каждый запрос на 150 мс занимает event loop
./scripts/fault.sh db       # падение базы
./scripts/fault.sh off      # всё вернуть
```

Формулы SLI и SLO описаны в [docs/hw-5/Отчет.md](docs/hw-5/Отчет.md).

## Алерты

```bash
kubectl apply -k k8s/alerting/
helm upgrade --install vm-alert vm/victoria-metrics-alert --version 0.52.0 -n monitoring -f k8s/alerting/values.yaml
kubectl -n monitoring port-forward svc/mailpit 8025:8025
```

Правила и настройки Alertmanager лежат в `k8s/alerting/values.yaml`. Письма приходят в Mailpit: http://localhost:8025.

## Grafana

```bash
helm repo add grafana-community https://grafana-community.github.io/helm-charts
kubectl apply -k k8s/grafana/
helm upgrade --install grafana grafana-community/grafana --version 14.4.1 -n monitoring -f k8s/grafana/values.yaml
kubectl -n monitoring port-forward svc/grafana 3000:80
```

Дашборд приложения: http://localhost:3000/d/lifeboard. Пароль пользователя admin:

```bash
kubectl -n monitoring get secret grafana -o jsonpath='{.data.admin-password}' | base64 -d
```

## Тесты

```bash
cd backend && npm install && npm test
```
