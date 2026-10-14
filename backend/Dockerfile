# Pin NODE_IMAGE to an approved image digest in the release build.
ARG NODE_IMAGE=node:22-bookworm-slim

FROM ${NODE_IMAGE} AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund

FROM dependencies AS build
COPY tsconfig.json ./
COPY src ./src
COPY migrations ./migrations
COPY scripts/transfer.ts scripts/copy-migrations.mjs ./scripts/
RUN npm run build

FROM dependencies AS production-dependencies
RUN npm prune --omit=dev --ignore-scripts --no-audit --no-fund

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3001 \
    MEDIA_ROOT=/app/media \
    WORKER_ENABLED=true
WORKDIR /app

# Debian's FFmpeg is a separately executed CLI and includes GPL components.
# Retain the distribution's /usr/share/doc/*/copyright files in this image.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates ffmpeg fonts-noto-cjk fontconfig \
    && fc-cache -f \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /app/media \
    && chown node:node /app/media

COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=production-dependencies /app/package.json /app/package-lock.json ./
COPY --from=build /app/dist ./dist
COPY LICENSE README.md THIRD_PARTY_DEPENDENCY_NOTICES.txt ./
COPY docs ./docs

USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/ready',{signal:AbortSignal.timeout(4000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/src/server.js"]
