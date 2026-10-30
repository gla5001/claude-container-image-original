# syntax=docker/dockerfile:1

# Two stages keep build tooling out of the image we run.
#
# Build stage (full node image, ~1.8 GB): compiles node-pty from C++ (it ships no Linux prebuilds, so it
# needs python/make/g++), installs the dev dependencies (Vite, Tailwind, TypeScript) to build dist/, then
# prunes node_modules down to the runtime dependencies (express, ws and the compiled node-pty).
#
# Runtime stage (slim node image, ~380 MB): copies in only that output and adds the claude CLI and the
# tools the coding-agents need. No compilers (unless EXTRA_APT_PACKAGES adds them), dev dependencies or
# app source code. That keeps the image smaller and leaves less to work with for anyone who gets a shell
# in a container that exists to hand one out.
FROM node:26-trixie AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

# Runtime stage: see the note at the top.
FROM node:26-trixie-slim

# Extra tools for the projects Claude works on, chosen at build time (see README, "Docker").
ARG EXTRA_APT_PACKAGES=""
ARG EXTRA_NPM_PACKAGES=""

# CLIs the coding-agents need: git 2.42+, gh and jq are required, acli is for Jira board mode.
# gh and acli come from their vendors' apt repos (Debian's gh is years behind).
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl \
  && install -d -m 755 /etc/apt/keyrings \
  && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /etc/apt/keyrings/github-cli.gpg \
  && curl -fsSL https://acli.atlassian.com/gpg/public-key.asc -o /etc/apt/keyrings/acli.asc \
  && arch=$(dpkg --print-architecture) \
  && echo "deb [arch=$arch signed-by=/etc/apt/keyrings/github-cli.gpg] https://cli.github.com/packages stable main" \
    > /etc/apt/sources.list.d/github-cli.list \
  && echo "deb [arch=$arch signed-by=/etc/apt/keyrings/acli.asc] https://acli.atlassian.com/linux/deb stable main" \
    > /etc/apt/sources.list.d/acli.list \
  && apt-get update && apt-get install -y --no-install-recommends git jq gh acli $EXTRA_APT_PACKAGES \
  && rm -rf /var/lib/apt/lists/*

# Playwright MCP for the build-qa agent, plus the Chromium build it drives and that browser's system
# libraries. The MCP refuses the smaller headless-only Chromium, so this is the full browser (~675 MB).
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN npm install -g @playwright/mcp $EXTRA_NPM_PACKAGES \
  && /usr/local/lib/node_modules/@playwright/mcp/node_modules/.bin/playwright install --with-deps chromium \
  && rm -rf /var/lib/apt/lists/*

RUN install -d -o node -g node /workspace
USER node
# Native installer from https://code.claude.com/docs/en/quickstart; it installs into ~/.local/bin of the current user.
ENV PATH=/home/node/.local/bin:$PATH
RUN curl -fsSL https://claude.ai/install.sh | bash && claude --version
# Mark first-run onboarding done (merged into the installer's config), otherwise claude asks for a
# browser login instead of using CLAUDE_CODE_OAUTH_TOKEN.
RUN node -e "const fs = require('fs'), f = '/home/node/.claude.json'; \
  fs.writeFileSync(f, JSON.stringify({ ...JSON.parse(fs.readFileSync(f)), hasCompletedOnboarding: true }))"
# Headless, with Chromium's sandbox left on (it works for this non-root user).
RUN claude mcp add --scope user playwright -- playwright-mcp --browser chromium --headless

# coding-agents is private, so the clone uses a GitHub token passed as a build secret: it exists only
# during this step and is never written into the image. The repo lives outside /workspace, and its
# install.sh symlinks the agents, skills, hooks and mods into ~/.claude, then runs its checks.
# `gh auth setup-git` makes git ask gh for GitHub credentials, so pushes work once GH_TOKEN is passed
# to the running container.
# OWNER/REPO or a GitHub URL. A different repo must keep the same layout (claude-agents/install.sh).
ARG CODING_AGENTS_REPO=gla5001/coding-agents
RUN --mount=type=secret,id=gh_token,env=GH_TOKEN \
  gh repo clone "$CODING_AGENTS_REPO" ~/coding-agents \
  && gh auth setup-git \
  && ~/coding-agents/claude-agents/install.sh

WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3001 SESSION_CWD=/workspace
EXPOSE 3001
CMD ["node", "dist/index.js"]
