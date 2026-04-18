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

COPY package.json bun.lock ./
COPY apps/worker/package.json ./apps/worker/package.json
RUN bun install --frozen-lockfile --production

COPY apps/worker ./apps/worker

WORKDIR /app/apps/worker

ENV NODE_ENV=production

CMD ["bun", "scripts/run-scan.ts"]
