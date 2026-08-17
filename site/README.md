# dictawhisper.com

Marketing + notes site for [DictaWhisper](https://github.com/Catalyst-Forge-LLC/dictawhisper), built with [FilePress](https://getfilepress.com) ([`getfilepress`](https://www.npmjs.com/package/getfilepress) on npm).

```bash
# this repo has a parent pnpm workspace; keep the site lockfile independent
pnpm install --ignore-workspace
pnpm dev          # local preview
pnpm build        # → build/
```

From the package root: `pnpm site:dev` / `pnpm site:build` / `pnpm ship`. Live target: [dictawhisper.com](https://dictawhisper.com).

Optional: edit `theme.css` next to `filepress.config.ts`.

## Deploy (Cloudflare Pages)

**Use one pipeline only.** Dual deploys overwrite each other when asset hashes disagree.

```bash
pnpm ship
# = pnpm build && wrangler pages deploy build --project-name=dictawhisper
```

Then attach **dictawhisper.com** in the Cloudflare dashboard.

### Git-connected Pages

| Setting | Value |
|---|---|
| Root directory | `site` |
| Build command | `pnpm install && pnpm build` |
| Output directory | `build` |
| Node | 20+ |

Dependency is the public npm package:

```json
"getfilepress": "^0.1.3"
```

## Content sync

**Site** = product narrative (home, Install, posts). **Root README** = flags, HTTP, env. Same facts in both; the site stays plainer. When behavior changes, update README + `site/pages/*`.

Site copy follows [aiBreze](https://aibreze.com): `landing.md` plus [`docs/aibreze-overlay.md`](../docs/aibreze-overlay.md).
