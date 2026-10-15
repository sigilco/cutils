# Backlog policy

Project: sigilco/cutils.

## Refinement

A task is refined when all four hold:

1. **Iteration/Quarter** set.
2. **Effort** estimate (S/M/L/XL), including testing and bug-potential per contact surface.
3. **Start date + Target date**, scheduled.
4. **Classification**: `feature` / `bug` / `cosmetic` / `infra`.

Draft items are acceptable during research; refine before code lands.

## Workflow

1. Plans go to `.agents/plans/<date>-<purpose>.md` and must exist on disk before implementation begins.
2. Implementation is atomic: one logical change per commit, conventional commit format.
3. On completion: close the tracking issue.
