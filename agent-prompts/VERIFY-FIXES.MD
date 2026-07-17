I have a fixes/ directory (00_INDEX.md, 00_PROGRESS.md, batch files, SUMMARY.md) documenting fixes made in response to audit/ findings (possibly filtered through verify/ findings, if that exists). Your job is to independently re-verify that each fix actually did what it claims: resolves the original finding, doesn't silently reintroduce it elsewhere, has real test coverage, and didn't break anything else.

Ground rule: re-derive, don't rubber-stamp

Don't trust a batch file's "Status: done" or "Tests: pass" at face value. Re-open the actual changed files, re-run the actual tests yourself, and re-check the actual original discrepancy against the current code. A fix log claiming success is a claim, not evidence.

Step 1: Read before checking anything

The fix directory uses a session index matching the audit (e.g. `fixes/1/`, `fixes/2/`). Read `fixes/{idx}/00_INDEX.md` and `fixes/{idx}/00_PROGRESS.md` for the full list of fix entries and their status. The index should also record the source audit path (`audit/{idx}/`) and verification path (`verify/{idx}/`) if one exists — pull those up for each entry too, so you know what was actually supposed to change and what was independently verified before fixing.

Step 2: Set up a fix-check directory, same shape as before

Create a `checks/{idx}/` directory (matching the same session index) containing:


`checks/{idx}/00_INDEX.md` — list of check batches, mirroring `fixes/{idx}/` batches, each with status (not started / in progress / done).
`checks/{idx}/00_PROGRESS.md` — small, append-only log of which fix entries have been checked and their verdict, one line each. Keep it terse so it never needs splitting.


For each `fixes/{idx}/batch_*.md`, create a corresponding `checks/{idx}/check_<batch-name>.md`. Split a check batch if it grows large — same rule as always: nothing should exceed what's comfortably re-readable in one pass.

Step 3: Check one fix at a time

For every fix entry, in order:


Re-locate the original problem. Pull the original audit finding (evidence, "which source is correct" call) and, if present, the verify/ verdict. If the finding was verified as refuted or unverifiable, flag that the fix may have been unnecessary or based on a bad premise — check whether it was still applied and whether that caused harm.
Diff-check the actual change. Look at what really changed in the repo (not just the batch file's summary of it) — read the current file content directly.
Confirm the discrepancy is actually gone. Re-check the same file:line-equivalent locations across spec/doc/code/test that originally disagreed — do they now agree? Don't just check that something changed; check that the specific disagreement is resolved.
Check for reintroduction elsewhere. Search for other places in the repo that referenced the old (wrong) behavior/text — a fix in one spot sometimes leaves stale duplicates elsewhere (another doc section, a comment, a second code path, a client SDK, a changelog).
Re-run tests yourself. Don't trust the logged test result — actually run the relevant test(s) now. If the fix added/changed a test, confirm the new test actually exercises the changed behavior and would have failed before the fix (i.e., it's not a vacuous test).
Check for collateral damage. Run the broader test suite (or the most relevant surrounding subset if the full suite is impractical) to check the fix didn't break something adjacent. Note any new failures.
Record a verdict.


Check entry format

### [Audit ID] Short title
- **Fix source:** fixes/batch_xxx.md
- **Original claim:** what the fix batch said it did
- **Re-verified change:** what you actually found in the current code/docs/spec/tests
- **Discrepancy resolved?** yes | no | partially | reintroduced-elsewhere (with location if so)
- **Test verification:** command(s) run, actual result (paste key output), and whether the test would have caught the original bug
- **Collateral check:** any regressions or side effects found, or "none found" + what you checked
- **Verdict:** pass | fail | partial-pass | needs-human-judgment
- **Follow-up needed:** what still needs doing, if anything

fail = the fix doesn't actually resolve the finding, or breaks something else, or the "done" status was simply wrong.
partial-pass = the core issue is resolved but something is incomplete (missing edge case, stale reference left elsewhere, weak test).
needs-human-judgment = facts are clear but whether this counts as "resolved enough" is a judgment call.

Constraints


Don't sample — check every fix entry, not a representative subset, unless the batch is large enough that you agree with me on a sampling plan first.
A fix that passes tests but doesn't actually address the original finding's root cause is a fail, not a pass — re-check against the original discrepancy, not just "did the diff look reasonable."
If you find every single fix in a batch is a clean pass with zero issues, slow down — re-check your own work before logging it, since some rate of incomplete fixes is expected and a perfect record is a signal to look harder, not a sign of a good fix pass.
If a fix reveals a new problem, log it as a new item rather than silently fixing it — append to checks/NEW_FINDINGS.md (create if needed) rather than expanding scope invisibly.
Resumability: assume this may be picked up cold later — checks/00_INDEX.md and checks/00_PROGRESS.md must always reflect true current state.


Step 4: Reconciliation summary

Once all fixes are checked, produce checks/SUMMARY.md:


Counts by verdict (pass / fail / partial-pass / needs-human-judgment)
Full list of fails and partial-passes with a one-line reason each — these need another fix pass
Any newly discovered issues logged in checks/NEW_FINDINGS.md
Any pattern in the failures (e.g. "fixes often addressed symptoms not root cause" or "tests were frequently vacuous") — useful signal about how much to trust the fix process going forward, and whether the fix-tracking prompt itself needs tightening


Start by reading the fix log (and audit/verify findings behind each entry), then create checks/, build the check-batch plan, and begin checking fixes in 00_INDEX.md order now.