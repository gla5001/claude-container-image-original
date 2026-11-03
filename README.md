# Session Runner

A web UI that runs Claude Code (`claude`) in a pseudo-terminal and lets you drive it from the browser. The app only ever runs `claude`: the browser can't choose a different command. It shows live output, the last ~1000 lines of history, and whether Claude is **Working** or **Needs input**. It can also send a push notification to your desktop or phone when Claude needs input (see [Notifications](#notifications)).

Claude starts on its own when the first page opens. Other tabs join the same session. **Restart** stops Claude if it's running and starts it again on the same conversation (`claude --continue`, or a fresh `claude` if there's nothing to resume). If you quit Claude (`/exit`, Ctrl-C twice), it stays stopped until you press Restart. For a fresh conversation, use `/clear` inside Claude.

## Security model

Read this before running it anywhere but your own laptop.

- **The app is a shell with no login.** Anyone who can reach its port controls Claude and the shell around it, and can read the Claude and GitHub tokens the container holds. Access must be limited to you.
- **The server listens on loopback (`127.0.0.1`) only**, in the image too. Nothing on the container or pod network can reach it.
- **There are only two ways in:** `kubectl port-forward` in Kubernetes, or local Docker with `HOST=0.0.0.0` and the port published on your machine's loopback only. Both are described below. To serve it on a domain instead, see [Serving it on a domain](#serving-it-on-a-domain).
- **The origin check isn't authentication.** It stops other websites from driving the app through your browser. Any other client that can reach the port is accepted, which is why the port must stay unreachable.

## Run in production (Kubernetes)

One pod per person and repo, reached only through `kubectl port-forward`. The manifest is [`k8s/session-runner.yaml`](k8s/session-runner.yaml).

1. **Build the image for the repo** (see [Build the image](#build-the-image)), and give it a tag per repo:

   ```sh
   GH_TOKEN=$(gh auth token) docker build --secret id=gh_token,env=GH_TOKEN \
     --build-arg WORKSPACE_REPO=your-org/your-repo \
     -t registry.example.com/session-runner:your-repo .
   ```

2. **Push it to a private registry only.** The image contains the source code of both the workspace repo and coding-agents. It holds no tokens.

3. **Create the runtime credentials with the least access that works:**
   - Claude: run `claude setup-token` on your machine. It opens a browser sign-in and prints an OAuth token for your Claude subscription (Pro, Max, Team or Enterprise) that lasts a year.
   - GitHub: create a [fine-grained personal access token](https://github.com/settings/personal-access-tokens) for the workspace repo only, with **Contents** and **Pull requests** set to read and write, plus any other permissions your agents need, such as the project board for build-lead's board mode. Don't use your full `gh auth token` in a shared cluster.

   Export the two tokens in your shell, then create the Secret in your own namespace:

   ```sh
   kubectl -n your-namespace create secret generic session-runner \
     --from-literal=CLAUDE_CODE_OAUTH_TOKEN="$CLAUDE_CODE_OAUTH_TOKEN" \
     --from-literal=GH_TOKEN="$GITHUB_TOKEN" \
     --from-literal=GIT_AUTHOR_NAME="$(git config user.name)" \
     --from-literal=GIT_AUTHOR_EMAIL="$(git config user.email)" \
     --from-literal=GIT_COMMITTER_NAME="$(git config user.name)" \
     --from-literal=GIT_COMMITTER_EMAIL="$(git config user.email)"
   ```

   `GH_TOKEN` logs `gh` in, and `git` uses `gh` for GitHub credentials, so the agents can clone, push and open PRs. The `GIT_*` variables give commits your name and email. Without them, `git commit` fails with "Author identity unknown".

4. **Set `image`** in `k8s/session-runner.yaml` to the tag you pushed, then apply it:

   ```sh
   kubectl -n your-namespace apply -f k8s/session-runner.yaml
   ```

5. **Connect** and open http://localhost:3001:

   ```sh
   kubectl -n your-namespace port-forward deploy/session-runner 3001:3001
   ```

What the manifest does:

- **No Service, Ingress or LoadBalancer.** Port-forward runs inside the pod's network namespace, and your cluster credentials authorize it, so it reaches the loopback-only server. Other pods get "connection refused".
- **A NetworkPolicy refuses all incoming pod traffic**, as a second layer in case `HOST` is ever changed. This needs a network plugin that enforces NetworkPolicy, such as Calico, Cilium, or the AWS VPC CNI with network policies turned on.
- **The pod runs locked down:** as the non-root `node` user (uid 1000), with all Linux capabilities dropped, no privilege escalation, the runtime's default seccomp profile, and no Kubernetes service account token. Claude, git and the QA agent's Chromium (with its own sandbox on) all work under these settings.
- **One replica, recreated on update.** Each pod holds one Claude session.

This setup was tested on Kubernetes 1.32 (minikube). Another pod got connection refused, port-forward worked, and Claude and Chromium ran under the security settings above.

Rules for keeping it safe:

- **Don't add a Service, Ingress, LoadBalancer or NodePort, and don't set `HOST` in the cluster.**
- **Give each person their own namespace.** Anyone with `pods/portforward` or `pods/exec` permission in the namespace can use the session and read its tokens. Grant those permissions only to the person the session belongs to.
- **Push your work.** Nothing is persisted: a pod restart resets the repo to the commit the image was built from. Rebuild the image to start from newer code.
- **Replace tokens deliberately.** For the running pod, paste a new Claude token in Settings (see [Switching Claude accounts](#switching-claude-accounts)). That token is gone when the pod restarts. To change it permanently, update the Secret and run `kubectl -n your-namespace rollout restart deploy/session-runner`.
- **Sharing a session over the network** needs an authenticating proxy in front of the app. See [Serving it on a domain](#serving-it-on-a-domain). Don't expose the app itself.

## Serving it on a domain

This repo doesn't include this setup yet. It describes how to reach a session at a URL like `https://example.com` instead of through port-forward.

**Don't set `HOST=0.0.0.0` and point an Ingress at the app.** That puts a shell with no login on the internet.

**Best practice is not to write your own auth.** Use these layers together:

1. **Single sign-on through your identity provider** (Okta, Google Workspace, Entra or a GitHub org), with MFA enforced there. No shared passwords or tokens.
2. **An identity-aware proxy in front of the app**, such as `oauth2-proxy` or the AWS load balancer's (ALB's) built-in OIDC. The app never handles logins itself.
3. **An allow-list per pod.** Being logged in isn't enough. Only the person a session belongs to gets into it.
4. **The proxy as the only way in.** The NetworkPolicy, or security groups for pods on EKS, lets traffic reach the proxy and nothing else.
5. **The app checks the identity itself**, by verifying the signed identity header the proxy adds and the `Origin` header. A misconfigured proxy then fails closed instead of open.
6. **Ideally, no public exposure.** Use an internal load balancer reached over a VPN or zero-trust network (Tailscale, Cloudflare Access, AWS Verified Access), so even the login page isn't public. Treat this like SSH into production.

### Sidecar proxy (recommended)

Kubernetes schedules **pods**, and a pod can run several **containers**. All containers in a pod share one network namespace: the same IP, the same `127.0.0.1` and the same ports. Run `oauth2-proxy` as a second container in the session-runner pod and it can reach the app on loopback, while nothing outside the pod can:

```
internet ──▶ ALB ──▶ pod IP :4180
                       │
          ┌─────── pod ┼──────────────────────────────┐
          │  container: oauth2-proxy                  │
          │    listens 0.0.0.0:4180  (reachable)      │
          │    checks login, then forwards to ───┐    │
          │                                      ▼    │
          │  container: session-runner                │
          │    listens 127.0.0.1:3001 (pod-only)      │
          └───────────────────────────────────────────┘
```

- The proxy reaches `127.0.0.1:3001` because it shares the pod's loopback.
- Other pods and anything else in the VPC can only reach the pod IP. Nothing listens on 3001 there, so their connections are refused. The only way in is port 4180, through the login.
- The Service, Ingress and NetworkPolicy all point at port 4180 only. The app keeps its default `HOST`.

### ALB OIDC (no sidecar)

On EKS, the AWS Load Balancer Controller can require a login at the load balancer itself (`alb.ingress.kubernetes.io/auth-type: oidc`, or Cognito). That takes only Ingress annotations, but the login happens outside the pod, so there's no shared loopback:

- The app has to listen on the pod IP (`HOST=0.0.0.0`).
- Anything that can reach the pod IP directly skips the login. Allow ingress only from the ALB's security group.
- The app should verify the `x-amzn-oidc-data` JWT the ALB adds to every request, and refuse requests without it.

The sidecar is the safer of the two, because the app never leaves loopback.

### App changes either setup needs

- **Allowed origin.** `isLocalOrigin` in `server/index.ts` accepts only `localhost`, `127.0.0.1` and `[::1]`, so the WebSocket from `https://example.com` would be refused. It needs a setting for the public origin.
- **Still one session per pod.** Everyone who gets into a pod shares its Claude session. Give each person their own pod and hostname or path.

## Run locally with Docker

Build the image (see [Build the image](#build-the-image)), then:

```sh
docker run --rm --init -e HOST=0.0.0.0 -p 127.0.0.1:3001:3001 \
  -e CLAUDE_CODE_OAUTH_TOKEN \
  -e GH_TOKEN="$(gh auth token)" \
  -e GIT_AUTHOR_NAME="$(git config user.name)" -e GIT_AUTHOR_EMAIL="$(git config user.email)" \
  -e GIT_COMMITTER_NAME="$(git config user.name)" -e GIT_COMMITTER_EMAIL="$(git config user.email)" \
  session-runner
```

Open http://localhost:3001. Ctrl+C stops the container.

- `-e HOST=0.0.0.0 -p 127.0.0.1:3001:3001` go together. Docker forwards ports to the container's network interface, not its loopback, so the server has to listen on all of the container's interfaces. The `127.0.0.1:` prefix then publishes the port on your machine only. Never drop that prefix.
- `-e CLAUDE_CODE_OAUTH_TOKEN` passes the token from `claude setup-token` through from your shell, so it never appears in the command line. The image marks Claude's first-run setup as done, so Claude uses the token without asking for a browser login. To use a Console API key instead, pass `-e ANTHROPIC_API_KEY`. Pass only one of the two: an API key takes precedence over the token.
- Your `gh auth token` is fine on your own machine. Prefer a fine-grained token anywhere else (see [Run in production](#run-in-production-kubernetes)).
- `--init` lets Ctrl+C and `docker stop` shut the server down.

In both Docker and Kubernetes:

- Claude asks whether to trust the repo folder the first time in each new container. Answer with ↓ then Enter.
- `acli` isn't logged in. If you use Jira board mode, run `acli jira auth login` inside a session.

## Build the image

The image contains the app, Claude Code (from the [native installer](https://code.claude.com/docs/en/quickstart#step-1-install-claude-code)), and everything the [coding-agents](https://github.com/gla5001/coding-agents) need: `git`, `gh`, `jq`, `acli` (Jira board mode) and the Playwright MCP server with Chromium (for the QA agent). It runs Node 26 on Debian trixie and is about 2.7 GB, mostly Chromium.

Each image is built for one repo, the one Claude will work on. `WORKSPACE_REPO` (required) is `owner/repo` or a GitHub URL. The build clones it to `/workspace/<repo name>`, and every Claude session starts at its root. coding-agents is cloned to `/home/node/coding-agents`, and its `install.sh` links the agents, skills, hooks and mods into `~/.claude`.

Both repos are cloned with a GitHub token, passed as a build secret. It exists only during the clone steps and is never stored in the image. The token must be able to read both repos.

```sh
GH_TOKEN=$(gh auth token) docker build --secret id=gh_token,env=GH_TOKEN \
  --build-arg WORKSPACE_REPO=your-org/your-repo \
  -t session-runner .
```

The build stops with an error that explains the problem if `WORKSPACE_REPO` is missing, if the token is missing, or if the token can't clone the repo.

Optional build arguments:

| Argument             | Default                 | What it does                                                                                                                                                  |
| -------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `EXTRA_APT_PACKAGES` | none                    | Space-separated Debian 13 (trixie) packages for the projects Claude works on, for example `python3 python3-venv python3-pip make` or `golang build-essential` |
| `EXTRA_NPM_PACKAGES` | none                    | Space-separated global npm packages, for example `pnpm yarn`. Node 26 and npm are always included                                                             |
| `CODING_AGENTS_REPO` | `gla5001/coding-agents` | A fork or copy of coding-agents (`owner/repo` or a GitHub URL). It must keep the install script at `claude-agents/install.sh`                                 |

Both clones are cached like any other build step, so a rebuild won't pick up new commits in either repo on its own. Add `--no-cache` when you want the latest. Changing `WORKSPACE_REPO` re-clones only the workspace repo.

## Notifications

Press the bell in the header and allow notifications. From then on, each time Claude stops and waits for you (it finished a turn, asks a question, or a permission or destruction-blocker prompt appears), that browser gets a notification, even with the tab closed or the phone locked. Click it to return to the session. No notification is sent while you have a Session Runner tab focused on any device, since you're already looking.

It's standard [Web Push](https://developer.mozilla.org/en-US/docs/Web/API/Push_API), with no account or third-party SDK. A service worker (`public/sw.js`) shows the notifications, and the server sends them itself with keys it generates when it starts. Delivery goes through the push service built into each browser (Google's for Chrome, Mozilla's for Firefox, Apple's for Safari), so the container needs outbound HTTPS to those services, like it already needs for GitHub and Anthropic. Messages are encrypted end to end. The push service sees only the delivery address, and the message holds only the repo folder's name.

What each device needs:

- **Desktop:** works through `kubectl port-forward` or local Docker as-is. Browsers treat `localhost` as secure.
- **Android:** Chrome or Firefox, opening the app over HTTPS. A phone can't reach your laptop's `localhost`, so this needs the setup in [Serving it on a domain](#serving-it-on-a-domain).
- **iPhone and iPad (iOS 16.4+):** the same HTTPS address, opened in Safari, then **Share → Add to Home Screen**. Open the app from the Home Screen icon and press the bell there. Safari tabs can't get web push. Only Home Screen apps can.

Good to know:

- The bell is dimmed when notifications aren't possible (plain `http` off `localhost`, or iOS outside a Home Screen app) or are blocked in browser settings. Hover over it to see which.
- The server keeps subscriptions in memory. After the container or pod restarts, open the app once on each device and it subscribes again without asking.
- A browser holds one push subscription per address. To get notifications from several pods on one machine, forward each pod to its own local port (`3001:3001`, `3002:3001`, …).

## Switching Claude accounts

To switch Claude accounts or replace an expired token without restarting the container, open **Settings** (the gear in the header) and paste a new token. It applies to every session started afterwards and replaces any `ANTHROPIC_API_KEY`. With **Restart the running session now** ticked, Claude restarts on the new token and picks up the same conversation. The server keeps the token in memory only. It is never sent back to a browser and is gone when the container stops.

## Develop

Requires Node 26 (`nvm use` picks it up from `.nvmrc`).

```sh
npm install
npm run dev      # web on http://localhost:5173 (hot reload), session server on 127.0.0.1:3001
npm test         # session lifecycle tests
npm run lint     # ESLint + Prettier check
npm run format   # auto-fix both
npm run build    # dist/index.js (server bundle) + dist/public (client)
npm start        # serves the build from http://127.0.0.1:3001
```

Claude runs in `SESSION_CWD`, which defaults to the folder the server was started from. The browser can't change it. `PORT` defaults to 3001.

Prettier handles formatting. ESLint enforces two rules on top: braces on every `if`/`else`/loop (`curly`), and a blank line after every block (`padding-line-between-statements`).

## How it works

- `server/session.ts`: spawns `claude` through `$SHELL -c` in a PTY (`node-pty`), keeps a short output buffer for clients that reconnect, and tracks status.
- `server/index.ts`: Express + `ws`. Relays output, input and resize events between the session and every connected tab, holds the token set in Settings, and sends a push notification when the session starts waiting and no tab is focused.
- `server/push.ts`: Web Push with `web-push`. Generates the VAPID keys, keeps browser subscriptions in memory, and drops the ones the push service says are gone.
- `src/`: React + xterm.js terminal, quick keys for TUI prompts (↑ ↓ Enter Esc 1/2/3…), a reply box, the notifications bell (`usePush.ts`) and the Settings dialog. When the session blocks, the tab title changes too.
- `public/`: the service worker that shows notifications, and the web app manifest that lets iOS add the app to the Home Screen.
- `shared/protocol.ts`: the WebSocket message types both sides use.

## Status detection

**Needs input** is shown when Claude has been quiet for 1.5s, or when a known blocking prompt appears (`BLOCKED_MARKERS` in `server/session.ts`). The second check covers prompts like the destruction-blocker mod's, where Claude's spinner keeps animating during the hold. It stays on until the user sends input.

**Starting** is shown from launch (or Restart) until Claude first goes quiet, so its startup screen doesn't read as **Working**. Output that draws nothing, like the cursor position queries idle Claude sends several times a second, never counts as working.

## Destruction blocker mod

Claude loads the mod from `~/.claude/settings.json` like it does in any other terminal. Answer with the **1** (Proceed) or **2** (Cancel) quick keys, or **Esc** to interrupt (which also refuses the command). The mod's panel only appears when the terminal is at least 144 columns wide, which is roughly a 1200px+ browser window. In a narrower terminal the mod says it moved to the band above the prompt, but Claude never draws that band, so the hold is invisible and `1`/`2` get typed into the prompt. If that happens, press Esc.
