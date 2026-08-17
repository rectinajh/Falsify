FROM node:24-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates libssl3 findutils \
    && rm -rf /var/lib/apt/lists/*

# Install Foundry (forge + cast) from a pinned GitHub release. This avoids the
# foundry.paradigm.xyz installer, which is rate-limited and caused build failures.
RUN curl -fsSL -o /tmp/foundry.tar.gz \
      https://github.com/foundry-rs/foundry/releases/download/v1.7.1/foundry_v1.7.1_linux_amd64.tar.gz \
    && mkdir -p /tmp/foundry \
    && tar -xzf /tmp/foundry.tar.gz -C /tmp/foundry \
    && find /tmp/foundry -name forge -type f -exec cp {} /usr/local/bin/forge \; \
    && find /tmp/foundry -name cast -type f -exec cp {} /usr/local/bin/cast \; \
    && chmod +x /usr/local/bin/forge /usr/local/bin/cast \
    && rm -rf /tmp/foundry /tmp/foundry.tar.gz

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY . .

# Precompile the Foundry project so cold starts don't pay a compile penalty.
RUN forge build

ENV PORT=8080
EXPOSE 8080
# Secrets are injected as Cloud Run environment variables, not baked in.
CMD ["node", "app/server.mjs"]
