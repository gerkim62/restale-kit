# Audit 3 Shard 06: Examples, Scripts, Workspace Configs, and Testing Plan

## Reviewed Sources
- `examples/README.md`
- `examples/backend/**/*`
- `examples/frontend/**/*`
- `examples/shared/**/*`
- `examples/vercel-redis/**/*`
- `scripts/extract-changelog.mjs`
- `scripts/run-example.mjs`
- `scripts/verify-package.mjs`
- `package.json`
- `pnpm-workspace.yaml`
- `vitest-testing-plan.md`

---

### [AUDIT3-06-01] Agreement Check: Workspace Package Configs, Smoke Test & Interactive Runner
- **Area:** Workspace root scripts & example apps
- **Type:** agreement
- **Evidence:**
  - `scripts/verify-package.mjs`: Packs `restale-kit` tarball into a temporary directory and validates importing all 15 subpath exports.
  - `scripts/run-example.mjs`: Provides interactive selection of Express, Hono, Fastify, and Node backends paired with React Query or SWR frontends on ports 3000-3003 and 5173-5174.
  - `vitest-testing-plan.md`: Historical migration plan from `node:test` to Vitest — migration fully executed in `restale-kit`.
- **Discrepancy:** None. Workspace scripts and example setups are fully functional and consistent.
- **Which source is correct / should be trusted:** Implementation.
- **Recommended fix:** No action required.
- **Severity:** low
- **Confidence:** high
