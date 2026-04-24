# syntax = docker/dockerfile:1.7

FROM oven/bun:1.2.2-debian AS runtime

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
       git ca-certificates curl gnupg \
       libvips-dev \
       libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 \
       libdrm2 libdbus-1-3 libatspi2.0-0 libx11-6 libxcomposite1 \
       libxdamage1 libxext6 libxfixes3 libxrandr2 libgbm1 libxkbcommon0 \
       libpango-1.0-0 libcairo2 libasound2 libxshmfence1 \
  && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
       | tee /usr/share/keyrings/githubcli-archive-keyring.gpg > /dev/null \
  && chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
       > /etc/apt/sources.list.d/github-cli.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends gh \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

# Install layer — copy every workspace's package.json so bun.lock's
# workspace declarations match what's on disk. Skipping any of them
# (e.g. apps/web, apps/realtime) makes `--frozen-lockfile` fail with
# "lockfile had changes" because the workspace shape disagrees with
# the lockfile, even though no actual versions changed.
COPY package.json bun.lock ./
COPY apps/worker/package.json ./apps/worker/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY apps/realtime/package.json ./apps/realtime/package.json
COPY packages/shared/package.json ./packages/shared/package.json

# `--production` skips devDependencies; `--frozen-lockfile` aborts if the
# lockfile would mutate. Intentional for reproducible builds.
RUN bun install --frozen-lockfile --production

# Playwright Chromium browser — needed for the LinkedIn Tier-3 fetcher.
# We install only Chromium (not Firefox/Webkit) to keep the image small.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN cd apps/worker && bunx playwright install chromium --with-deps

# Now bring in source for both the worker and the shared package. Other
# workspaces stay as install-only stubs to keep this image lean.
COPY packages/shared ./packages/shared
COPY apps/worker ./apps/worker

WORKDIR /app/apps/worker

ENV NODE_ENV=production

CMD ["bun", "scripts/run-scan.ts"]
