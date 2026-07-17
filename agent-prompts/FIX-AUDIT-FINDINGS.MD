I have an existing audit/ directory containing a discrepancy audit of this repo (00_INDEX.md, 00_PROGRESS.md, shard files, and SUMMARY.md). I need you to now work through those findings and fix them, while tracking your fix progress with the same rigor — don't rely on memory, and don't force everything into one file that could outgrow what's re-readable in one pass.

Step 1: Read before touching anything

Read audit/00_INDEX.md, audit/00_PROGRESS.md, and audit/SUMMARY.md first to understand scope and severity. Do not start fixing until you've built a plan.

Step 2: Set up a fix-tracking directory, structured like the audit was

Create a fixes/ directory, containing:


fixes/00_INDEX.md — list of fix-batches (below), each with scope, source shard(s) it addresses, and status (not started / in progress / blocked / done).
fixes/00_PROGRESS.md — running, small, append-only log: which audit findings (by ID) have been triaged, fixed, verified, or explicitly deferred/rejected. This is the single source of truth for "is finding X done yet" — keep entries terse (one line per status change), so this file itself never needs splitting.


Group work into fix-batches, mirroring the audit's shards where it makes sense (e.g. fixes/batch_auth-module.md) — but a batch can also be organized by fix type (all "outdated-doc" fixes together) or by severity (all "critical" first) if that's a more sensible unit of work. State your grouping rationale in 00_INDEX.md.

If a batch file itself grows large (many findings, long before/after diffs, long reasoning), split it (batch_auth-module_part2.md) rather than letting it balloon — same rule as the audit: anything you might need to re-read in full should stay comfortably re-readable in one go.

Step 3: Work order


Triage first, across all findings, before fixing anything. For each finding ID in the audit, decide: fix now / needs human decision / defer (with reason) / reject (audit was wrong, with reason). Record this triage in the relevant batch file. This step alone may be worth doing as its own pass across all shards before any code changes.
Fix in severity order: critical → high → medium → low, unless dependencies force a different order (note when you deviate and why).
One finding (or tightly related cluster of findings) at a time. For each:

Re-read the original finding in its audit shard (don't rely on the summary alone — the shard has the evidence).
Decide which source is being brought into alignment (usually: fix code/docs/tests to match the correct source identified in the audit — but re-verify that judgment now that you're looking at the real code).
Make the change.
Update or add tests if the audit flagged missing/wrong test coverage.
Record the fix in the batch file (format below) immediately — not after finishing the whole batch.
Update fixes/00_PROGRESS.md with a one-line status change.



Verify as you go. Run relevant tests/build after each fix or small cluster of fixes, not just at the end. Log pass/fail in the batch entry.


Fix entry format

For every finding acted on, log an entry in its batch file:

### [Audit ID] Short title
- **Audit source:** audit/shard_xxx.md
- **Triage decision:** fix-now | needs-human-decision | deferred | rejected
- **Reasoning:** why this decision, especially if it differs from the audit's recommendation
- **Change made:** files touched, what changed (doc/code/test/spec), brief diff summary
- **Tests:** added/updated/none needed — and result of running them
- **Status:** in-progress | done | blocked (+ what it's blocked on)
- **Follow-ups:** anything this fix surfaced that isn't yet covered by an audit finding

For anything marked needs-human-decision, deferred, or rejected, still log it fully — these are as important to track as completed fixes, so nothing silently falls through.

Constraints


Don't batch-fix blindly by pattern-matching across many findings at once without checking each one individually — audits can be wrong about specifics even when right about the general issue.
Don't mark something done until you've actually verified it (tests pass, or manual reasoning is recorded for why no test could verify it).
If fixing one finding reveals the audit missed a related discrepancy, log it as a new finding (append to the relevant audit shard, or create audit/shard_followups.md if none fits) rather than quietly fixing it out of scope — keep the audit and fixes in sync as living documents.
Resumability matters: assume you (or another instance of you) may pick this up later with no memory of this session — fixes/00_INDEX.md and fixes/00_PROGRESS.md must always be accurate enough to resume from cold.


Step 4: Wrap-up report

Once all findings are triaged and either fixed, deferred, or rejected, produce fixes/SUMMARY.md: counts by status and severity, list of anything still needing a human decision, and list of any new findings surfaced during fixing that haven't been addressed yet.

Start by reading the audit files, then create fixes/, build the fix-batch plan, and begin the triage pass now.