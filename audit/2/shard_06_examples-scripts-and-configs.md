# Audit Shard 06: Examples, Scripts, and Workspace Configurations

### [AUDIT2-06-001] Verified agreement on build scripts and example runners
- **Area:** `scripts/run-example.mjs`, `scripts/verify-package.mjs`, `scripts/extract-changelog.mjs`, `package.json`, `pnpm-workspace.yaml`, `examples/`
- **Type:** undocumented-behavior
- **Evidence:**
  - `scripts/verify-package.mjs:48-64`: Verifies that all 15 public subpath exports (`restale-kit`, `/server`, `/node`, `/fetch`, `/client`, `/react`, `/swr`, `/tanstack-query`, `/pubsub`, `/redis`, `/ably`, `/pusher`, `/express`, `/fastify`, `/hono`) can be imported cleanly from an installed npm tarball.
  - `scripts/run-example.mjs:5-15`: Maps all 4 backend example packages (`@restale-kit-example/express`, `hono`, `fastify`, `node`) and 2 frontend example packages (`react-query`, `react-swr`).
- **Discrepancy:** None — workspace scripts and example packages align with package exports and root scripts.
- **Which source is correct / should be trusted:** Implementation matches specification and documentation.
- **Recommended fix:** No code changes needed.
- **Severity:** low
- **Confidence:** high
