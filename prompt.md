# Migrate restale-kit from ESLint to Oxlint + tsgolint

## Context

You are migrating the linter in this monorepo from ESLint + typescript-eslint to Oxlint + tsgolint.
The goal is speed. The constraint is **zero rule relaxation** — every rule that was an error must remain an error; every rule that was off must remain off.

Before making any changes, read and internalize this entire prompt.

---

## What the current ESLint config enforces

The active config is `eslint.config.mjs`. Here is the exact rule inventory you must preserve:

### Rules applied to all `**/*.ts` and `**/*.tsx` files (errors unless noted)

These come from `tseslint.configs.strictTypeChecked` plus explicit overrides:

| Rule | Severity | Note |
|---|---|---|
| `@typescript-eslint/no-explicit-any` | error | |
| `@typescript-eslint/no-unsafe-type-assertion` | error | bans `as` casts |
| `@typescript-eslint/no-non-null-assertion` | error | bans `!` |
| `@typescript-eslint/no-unsafe-assignment` | error | |
| `@typescript-eslint/no-unsafe-argument` | error | |
| `@typescript-eslint/no-unsafe-return` | error | |
| `@typescript-eslint/no-unsafe-member-access` | error | |
| `@typescript-eslint/no-unnecessary-type-arguments` | **off** | explicitly disabled |
| `@typescript-eslint/no-unnecessary-condition` | **off** | explicitly disabled |
| All other `strictTypeChecked` rules | error | inherited from preset |
| `@eslint-community/eslint-comments/require-description` | error | **see gap note below** |
| All `@eslint-community/eslint-comments` recommended rules | error | `disable-enable-pair`, `no-aggregating-enable`, `no-duplicate-disable`, `no-unlimited-disable`, `no-unused-disable`, `no-unused-enable` |
| `eslint` core recommended rules | error | applied to all files |

### Rules relaxed for test files

The following globs have all of the above type-aware rules set to `off`:
- `**/__tests__/**/*.{ts,tsx}`
- `**/*.test.{ts,tsx}`
- `**/*.test-d.{ts,tsx}`
- `**/test-fixtures/**/*.{ts,tsx}`

Rules turned off in tests: `no-explicit-any`, `no-unsafe-type-assertion`, `no-non-null-assertion`, `no-unsafe-assignment`, `no-unsafe-argument`, `no-unsafe-return`, `no-unsafe-member-access`, `no-unsafe-call`, `no-unnecessary-condition`, `unbound-method`, `no-invalid-void-type`, `no-unused-vars`, `no-unlimited-disable`, `disable-enable-pair`, `require-description`.

### Global ignores

`**/dist/**`, `**/node_modules/**`, `**/examples/**`, `**/coverage/**`, `**/vitest.config.ts`

---

## Known gap you must handle explicitly

**`require-description` has no native oxlint equivalent yet.**

The ESLint rule `@eslint-community/eslint-comments/require-description` enforces that every `// eslint-disable` directive includes a `--` description explaining why. oxlint tracked this as feature request oxc-project/oxc#22193. As of writing, the issue is closed but has no linked merged PR and does not appear in any oxlint changelog or release notes — its status is ambiguous and you must not assume it shipped.

**Before writing any config**, check the current installed oxlint version's changelog and the oxlint rules reference (`oxlint --rules | grep description` or equivalent) to confirm whether a native `reportUndescribedDirectives` option or equivalent rule exists. If it does, use it. If it does not, use the JS plugin fallback described below.

**JS plugin fallback:** keep `@eslint-community/eslint-plugin-eslint-comments` as a JS plugin inside oxlint using the `jsPlugins` field, enabling only `require-description` as an error. Do **not** silently drop this rule. Do **not** comment it out "for now". The entire point of the rule is to prevent undocumented suppressions — dropping it would undermine the codebase's own discipline.

**Important caveat on JS plugins:** the oxlint JS plugin API is currently in alpha and is explicitly not subject to semver. A breaking change in a minor oxlint bump is possible. To guard against this, pin the oxlint version exactly (no `^` or `~`) in `package.json` and add a comment explaining why:

```json
// package.json devDependencies
"oxlint": "x.y.z",  // pinned: JS plugins API is alpha, not semver-stable
"oxlint-tsgolint": "x.y.z"
```

When upgrading oxlint in future, re-verify the JS plugin still behaves correctly before widening the pin.

---

## Step-by-step instructions

### 1. Audit the current state first

Run the existing ESLint and confirm it passes with zero warnings:
```
pnpm lint
```
If it doesn't pass cleanly, stop and report. Do not migrate a broken baseline.

### 2. Install new dependencies

```
pnpm add -D oxlint oxlint-tsgolint --workspace-root
```

Do **not** remove ESLint packages yet. You will remove them at the end, only after the new config is verified clean.

### 3. Check native `require-description` support

Before running the migration tool or writing any config, run:
```
npx oxlint --rules 2>&1 | grep -i "description\|directive"
```

Also check the oxlint changelog for the installed version for any mention of `reportUndescribedDirectives`. If native support exists, note it and use it in step 4. If not, proceed with the JS plugin fallback.

### 4. Run the official migration tool

```
pnpm dlx @oxlint/migrate --type-aware
```

This reads `eslint.config.mjs` and generates `.oxlintrc.json`. **Do not treat its output as final.** Inspect it against the rule inventory above line by line. The migration tool may miss rules, miscategorise severities, or silently drop the `require-description` rule.

### 5. Write the final `.oxlintrc.json`

Build or correct the config file to match the rule inventory exactly. The structure must:

- Set `"$schema": "./node_modules/oxlint/configuration_schema.json"`
- Enable the `typescript` plugin (it is on by default but be explicit)
- Enable `typeAware: true` and `typeCheck: true` under options to activate tsgolint
- Point at `restale-kit/tsconfig.json` for the TypeScript program — tsgolint needs a tsconfig to build the type program
- Mirror the ignore patterns: `**/dist/**`, `**/node_modules/**`, `**/examples/**`, `**/coverage/**`, `**/vitest.config.ts`
- Explicitly set `off` for `typescript/no-unnecessary-type-arguments` and `typescript/no-unnecessary-condition` — these were intentionally disabled and must stay off
- Use an `overrides` block for test file globs to relax the same rules the ESLint config relaxed
- Handle `require-description` via native rule or JS plugin as determined in step 3

If using the JS plugin fallback, the `jsPlugins` entry looks like:
```json
{
  "jsPlugins": ["@eslint-community/eslint-plugin-eslint-comments"]
}
```
Then enable only `@eslint-community/eslint-comments/require-description` as an error rule. The other recommended rules from this plugin (`disable-enable-pair`, `no-unlimited-disable`, etc.) may have native oxlint equivalents — check the oxlint rules reference and use native rules where they exist, JS plugin rules only for what remains.

### 6. Update `package.json` scripts

Replace the `lint` and `lint:fix` scripts in the root `package.json`:

```json
"lint": "oxlint --deny-warnings",
"lint:fix": "oxlint --fix --deny-warnings"
```

`--deny-warnings` preserves the existing `--max-warnings 0` behaviour.

Update the `validate` script to call `pnpm run lint` as before — no change needed there if it already references `pnpm run lint` by name.

### 7. Verify the new config catches what it should

Run:
```
pnpm lint
```

The run must complete with **zero warnings and zero errors**. If there are errors, fix the source or the config — do not suppress them unless they were already suppressed in the old config.

Then write a small deliberate violation in a scratch file — for example a bare `as any` cast in a `.ts` file — run oxlint, confirm it errors, then delete the scratch file. This confirms type-aware rules are actually firing.

Also confirm `require-description` is active: add a bare `// eslint-disable-next-line typescript/no-explicit-any` with no `--` description, run oxlint, confirm it errors.

### 8. Remove ESLint

Only after step 7 passes cleanly:

```
pnpm remove eslint typescript-eslint @eslint/js --workspace-root
```

Keep `@eslint-community/eslint-plugin-eslint-comments` if you are using it as a JS plugin in oxlint (you likely are, for `require-description`). Remove it only if native oxlint support made it unnecessary.

Delete `eslint.config.mjs`.

Run `pnpm lint` one final time to confirm nothing broke during cleanup.

### 9. Update `typescript` dependency

The root `package.json` currently has:
```json
"typescript": "npm:@typescript/typescript6@^6.0.2",
"typescript-7": "npm:typescript@7.0.2"
```

tsgolint uses typescript-go (the TS7 native compiler) internally — it does **not** consume the `typescript` npm package. So the `typescript` alias (TS6) was kept solely for ESLint. Now that ESLint is gone, the TS6 alias has no consumer.

Verify this is true by grepping for any remaining reference to `require('typescript')` or `import ... from 'typescript'` in non-test tooling scripts. If nothing references it, remove the `typescript` (TS6) alias and rename `typescript-7` back to `typescript` so the `typecheck` script in package.json works without the `node_modules/typescript-7/bin/tsc` path indirection.

If any tool still needs TS6, leave it and document why in a comment in `package.json`.

---

## Hard constraints — do not violate these

- **Do not comment out any rule** with a "TODO: re-enable" note. If a rule cannot be expressed in oxlint natively, handle it via a JS plugin.
- **Do not change any source files** to work around lint rules. The source already passes ESLint clean — it must pass oxlint clean for the same reasons.
- **Do not add `oxlint-disable` or `eslint-disable` comments** to make the migration pass.
- **Do not relax test file overrides** beyond what the existing ESLint config already relaxes.
- **Do not set `--max-warnings` to anything other than 0** (use `--deny-warnings`).
- **Do not use `^` or `~` version ranges for oxlint or oxlint-tsgolint** — pin exact versions because the JS plugins API is alpha and not semver-stable.
- **Verify every rule in the inventory table above** has an outcome in the new config — either a native oxlint rule, a JS plugin rule, or a documented reason it genuinely does not apply in oxlint's model (e.g. it is already enforced by the type checker itself).

---

## Definition of done

- [ ] `pnpm lint` exits 0 with no warnings
- [ ] `pnpm validate` passes end to end
- [ ] A deliberate `as any` in a `.ts` file triggers an oxlint error
- [ ] A bare `// eslint-disable-next-line` with no description triggers an error
- [ ] `eslint.config.mjs` is deleted
- [ ] ESLint npm packages are removed (except any retained as oxlint JS plugins)
- [ ] No `eslint-disable` or `oxlint-disable` comments were added during this migration
- [ ] oxlint and oxlint-tsgolint are pinned to exact versions in `package.json` with a comment explaining why