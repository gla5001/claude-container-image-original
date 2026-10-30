# Two stages keep build tooling out of the image we run.
#
# Build stage (full node image, ~1.8 GB): compiles node-pty from C++ (it ships no Linux prebuilds, so it
# needs python/make/g++), installs the dev dependencies (Vite, Tailwind, TypeScript) to build dist/, then
# prunes node_modules down to the runtime dependencies (express, ws and the compiled node-pty).
#
# Runtime stage (slim node image, ~380 MB): copies in only that output and adds the claude CLI.
# No compilers, dev dependencies or source code, which roughly halves the image. It also leaves less
# to work with for anyone who gets a shell in a container that exists to hand one out.
FROM node:26-trixie AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

# Runtime stage: see the note at the top.
FROM node:26-trixie-slim
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN install -d -o node -g node /workspace
USER node
# Native installer from https://code.claude.com/docs/en/quickstart; it installs into ~/.local/bin of the current user.
ENV PATH=/home/node/.local/bin:$PATH
RUN curl -fsSL https://claude.ai/install.sh | bash && claude --version
# Mark first-run onboarding done (merged into the installer's config), otherwise claude asks for a
# browser login instead of using CLAUDE_CODE_OAUTH_TOKEN.
RUN node -e "const fs = require('fs'), f = '/home/node/.claude.json'; \
  fs.writeFileSync(f, JSON.stringify({ ...JSON.parse(fs.readFileSync(f)), hasCompletedOnboarding: true }))"
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3001 SESSION_CWD=/workspace
EXPOSE 3001
CMD ["node", "dist/index.js"]
