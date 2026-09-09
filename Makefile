.PHONY: api web tidy

api:
	mkdir -p data api/logs logs
	cd api && go run ./cmd/server -config ./config.yaml -audit-db ../data/audit.db -log-dir logs

web:
	cd web && npm run dev

tidy:
	cd api && go mod tidy

build:
	mkdir -p data api/bin api/logs logs
	cd api && go build -o bin/acmanage ./cmd/server
	cd web && npm run build
