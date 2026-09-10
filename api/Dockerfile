FROM golang:1.26-alpine AS build
WORKDIR /src
# 国内构建默认走 goproxy.cn，避免 proxy.golang.org 超时
ARG GOPROXY=https://goproxy.cn,https://goproxy.io,direct
ENV GOPROXY=${GOPROXY}
ENV GOSUMDB=off
COPY api/go.mod api/go.sum ./
RUN go mod download
COPY api/ ./
RUN CGO_ENABLED=0 go build -o /out/acmanage ./cmd/server

FROM alpine:3.20
RUN apk add --no-cache ca-certificates tzdata
WORKDIR /app
COPY --from=build /out/acmanage /usr/local/bin/acmanage
COPY api/config.yaml /etc/acmanage/config.yaml
# 精选模块目录（相对 WORKDIR → data/modules/curated.json）
COPY api/data/modules /app/data/modules
EXPOSE 8080
ENTRYPOINT ["acmanage", "-config", "/etc/acmanage/config.yaml", "-audit-db", "/data/audit.db", "-log-dir", "/app/logs"]
