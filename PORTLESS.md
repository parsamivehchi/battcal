# Portless rollout notes

[portless](https://github.com/vercel-labs/portless) replaces `localhost:PORT` dev
URLs with stable, named `.localhost` HTTPS URLs. Installed globally (`npm i -g
portless`, v0.15.1). Node 26 on this machine satisfies the Node 24+ requirement.

## One-time privileged setup (do this once)

The proxy binds port 443, which needs elevation once. Run in your terminal:

```sh
# Stop the temporary non-privileged proxy if it is running
portless proxy stop

# Install the proxy as a startup service (binds 443, survives reboot) + trust CA
sudo portless service install
portless trust
portless doctor            # expect 0 failures
```

After that, every registered app is reachable at `https://<name>.localhost` with a
trusted cert and no port. Until then, a non-privileged fallback proxy serves the
same routes on `https://<name>.localhost:1355`.

## BattCal dashboard

Registered as a static alias (the dashboard server is a plain Node process, not a
portless-run dev server):

```sh
portless alias battcal 4437     # already done -> https://battcal.localhost
```

## Portfolio configs (already written)

Every actively-developed web app in `~/Desktop/DEV` has a `portless.json` naming
it. Start any app through the proxy by replacing the dev command:

| Project | URL after `portless` |
|---|---|
| aecom.engineering (monorepo, 12 apps) | `portal.aecom.localhost`, `finance.aecom.localhost`, `investments.aecom.localhost`, … |
| squared.engineering/web | `squared.localhost` |
| heatmapfinance.com (v1) | `hmf.localhost` |
| heatmapfinance-next (v2) | `hmf-next.localhost` |
| starlink-sky-web | `starlink.localhost` |
| dev-workspace-dashboard | `devdash.localhost` |
| + 10 more Vite/Next apps | see each project's `portless.json` |

Usage per project:

```sh
cd ~/Desktop/DEV/squared.engineering/web
portless            # runs the "dev" script through the proxy -> https://squared.localhost

# aecom monorepo: from the repo root starts ALL apps, or cd into one:
cd ~/Desktop/DEV/aecom.engineering && portless
cd ~/Desktop/DEV/aecom.engineering/apps/finance && portless   # just finance
```

This eliminates the real port collisions in the tree: aecom portal, heatmapfinance,
and heatmapfinance-landing all fought over port 3470; the three default-3000 Next
apps (squared, hmf-next, wartime) collided too. Named URLs remove the conflict.

## Framework caveat (Next.js apps)

Add the portless hostname to `allowedDevOrigins` in each Next app's config, e.g.:

```js
// next.config.js
module.exports = { allowedDevOrigins: ["squared.localhost", "*.squared.localhost"] };
```

Vite apps that hardcode `http://localhost:PORT` proxy targets (dev-workspace-dashboard
-> 8010, heatmapfinance -> host.docker.internal) should point those at the new
`.localhost` names with `changeOrigin: true` to avoid the 508 loop portless warns on.
