# SPDX-License-Identifier: Apache-2.0
# Build from the repository root: docker build -f deploy/docker/Dockerfile .
# Base images are build args so a fork can pull them from an internal registry mirror:
#   docker build --build-arg BUILDER_IMAGE=registry.internal/node:24-bookworm-slim ...
ARG BUILDER_IMAGE=node:24-bookworm-slim
ARG RUNTIME_IMAGE=gcr.io/distroless/nodejs24-debian12:nonroot
FROM ${BUILDER_IMAGE} AS builder
ENV CI=true
WORKDIR /src
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile && pnpm package

FROM ${RUNTIME_IMAGE}
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
