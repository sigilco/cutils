# Contributing

Thanks for helping with cutils. This file covers the short path from clone to a mergeable PR.

## Setup

Requires node 22 or newer and pnpm (the exact version is pinned in `packageManager`). Use pnpm only, never npm.

```sh
pnpm install
pnpm -r build
```

## Checks

- `pnpm lint` runs oxlint, `pnpm fmt` runs oxfmt.
- `pnpm test` runs every workspace test. Any behavior change ships with tests.
- `scripts/scriptc-gate.sh` (after `pnpm -r build`) fails unless every `packages/*/gate.ts` compiles 100% static under `scriptc coverage`. Read the subset rules in `AGENTS.md` before touching `packages/*/src`.
- `pnpm smoke:pack` packs every package and asserts the tarballs install and resolve.
- Performance claims need a bench cell first; v1 packages ship without perf claims.

## Change intents

Every change that touches `packages/*` records an intent with `pnpm change`, naming the affected packages, the bump type and a one line summary that becomes the changelog entry. Commit the intent file with the change. If a change needs no release, record it with `--bump none`. `pnpm change check` validates intents and versions.

## Commits and PRs

Use conventional commits and keep them atomic: one logical change per commit. Link the PR to its issue. Do not add co-author trailers.

## Plans

Feature work starts from a plan in `.agents/plans/<date>-<purpose>.md` (see `.agents/backlog-policy.md`).

## Releases

Maintainers only. See `RELEASING.md`. Releases are packed and published with pnpm, never npm.
