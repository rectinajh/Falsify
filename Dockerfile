FROM node:24-slim

# Foundry provides the deterministic verifier (`forge test`).
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl git ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && curl -L https://foundry.paradigm.xyz | bash \
    && /root/.foundry/bin/foundryup \
    && cp /root/.foundry/bin/forge /root/.foundry/bin/cast /usr/local/bin/

WORKDIR /app
COPY . .

ENV PORT=8080
EXPOSE 8080

# Secrets (GEMINI_API_KEY, etc.) are injected as Cloud Run environment variables,
# not baked into the image and not read from a committed .env file.
CMD ["node", "app/server.mjs"]
