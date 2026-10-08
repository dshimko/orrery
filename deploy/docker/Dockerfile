# SPDX-License-Identifier: Apache-2.0
# Build from the repository root: docker build -f deploy/docker/Dockerfile .
FROM node:20.19-bookworm-slim AS builder
ENV CI=true
WORKDIR /src
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile && pnpm package

FROM gcr.io/distroless/nodejs20-debian12:nonroot
WORKDIR /app
COPY --from=builder /src/build/app /app
ENV HOST=0.0.0.0 \
    PORT=8787 \
    ORRERY_WEB_DIR=web \
    ORRERY_CONFIG=config/demo.yaml \
    NODE_ENV=production
EXPOSE 8787
# The distroless node image's entrypoint is `node`.
CMD ["server/main.mjs"]
