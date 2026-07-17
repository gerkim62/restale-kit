I need you to verify that all audit findings logged in the audit directory provided by the user (e.g. `audit/1/`, `audit/2/`, etc.) and recorded as fixed in the corresponding fixes directory (e.g. `fixes/1/`, `fixes/2/`, etc.) are fully resolved and verified across the codebase.

Step 1: Read before verifying

Read `00_INDEX.md` and `SUMMARY.md` in the audit directory provided by the user, and `00_INDEX.md`, `00_PROGRESS.md`, and `SUMMARY.md` in the fixes directory to get the full list of findings and recorded fixes.

Step 2: Set up a verification directory

Create a verifications subfolder matching the audit session (the one provided by the user, e.g. `verifications/1/`, `verifications/2/`, etc.) containing:

- `00_INDEX.md` — list of verification passes per shard/component.
- `00_PROGRESS.md` — append-only status log for each finding ID.

Step 3: Verification process

For each finding ID:
1. Re-read the original discrepancy in the relevant audit shard (`shard_xxx.md`).
2. Re-read the fix entry in the relevant fix batch (`batch_xxx.md`).
3. Inspect the active source code, docs, and spec files referenced in the finding to confirm alignment.
4. Run targeted automated tests (`pnpm --filter restale-kit test`) to confirm tests pass.
5. Log a verification entry in `batch_xxx.md` inside the verifications directory (pass/fail, evidence, test output).

Step 4: Summary

Produce `SUMMARY.md` inside the verifications directory summarizing verified findings, any remaining unverified items, and overall codebase consistency status.
