# Life Board. Домашние задания по SRE

## Отчёты

| ДЗ | Тема | Отчёт |
|---|---|---|
| 1 | Приложение 12 факторов | [docs/hw-1/Отчет.md](docs/hw-1/Отчет.md) |
| 2 | Основы Kubernetes | [docs/hw-2/Отчет.md](docs/hw-2/Отчет.md) |

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
kubectl apply -k k8s/
minikube service frontend -n lifeboard
```

## Тесты

```bash
cd backend && npm install && npm test
```
