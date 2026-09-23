# RepoMesh verify client and XRPL anchor poster.
# Does not run rippled. XRPL_SEED and REPOMESH_SIGNING_KEY are runtime
# environment only — they are not build arguments and they are not image layers.
FROM node:22-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/repomesh

COPY package.json package-lock.json ./
COPY packages/repomesh-cli/package.json packages/repomesh-cli/package.json
COPY packages/repomesh-cli packages/repomesh-cli
COPY anchor/xrpl/package.json anchor/xrpl/package-lock.json anchor/xrpl/
COPY anchor/xrpl/scripts anchor/xrpl/scripts
COPY anchor/xrpl/config.json anchor/xrpl/config.json

RUN npm ci --ignore-scripts --workspace @mcptoolshop/repomesh \
 && node packages/repomesh-cli/scripts/build.mjs \
 && npm ci --ignore-scripts --prefix anchor/xrpl \
 && chown -R node:node /opt/repomesh

USER node

ENTRYPOINT ["node", "/opt/repomesh/packages/repomesh-cli/dist/cli.mjs"]
CMD ["--help"]
