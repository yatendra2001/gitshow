# syntax = docker/dockerfile:1.7

FROM oven/bun:1.2-debian AS runtime

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
       git ca-certificates curl gnupg \
  && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
       | tee /usr/share/keyrings/githubcli-archive-keyring.gpg > /dev/null \
  && chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
       > /etc/apt/sources.list.d/github-cli.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends gh \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

# Install layer — copy ONLY package.json files first so the install layer
# stays cached when source changes. The worker has a workspace dep on
# `@gitshow/shared` so we need that package's manifest present too.
COPY package.json bun.lock ./
COPY apps/worker/package.json ./apps/worker/package.json
COPY packages/shared/package.json ./packages/shared/package.json

# `--production` skips devDependencies; `--frozen-lockfile` aborts if the
# lockfile would mutate — both are intentional for reproducible builds.
RUN bun install --frozen-lockfile --production

# Now bring in source for both the worker and the shared package. Order
# matters: shared first so worker compilation can resolve its imports
# without a second install pass.
COPY packages/shared ./packages/shared
COPY apps/worker ./apps/worker

WORKDIR /app/apps/worker

ENV NODE_ENV=production

CMD ["bun", "scripts/run-scan.ts"]
