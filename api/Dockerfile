FROM golang:1.26-alpine AS build
WORKDIR /src
COPY api/go.mod api/go.sum ./
RUN go mod download
COPY api/ ./
RUN CGO_ENABLED=0 go build -o /out/acmanage ./cmd/server

FROM alpine:3.20
RUN apk add --no-cache ca-certificates tzdata
WORKDIR /app
COPY --from=build /out/acmanage /usr/local/bin/acmanage
COPY config.example.yaml /etc/acmanage/config.yaml
EXPOSE 8080
ENTRYPOINT ["acmanage", "-config", "/etc/acmanage/config.yaml", "-audit-db", "/data/audit.db", "-log-dir", "/app/logs"]
