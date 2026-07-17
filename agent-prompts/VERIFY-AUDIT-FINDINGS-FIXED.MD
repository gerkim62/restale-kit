I have an audit/{idx} directory (00_INDEX.md, 00_PROGRESS.md, shard files, SUMMARY.md) containing claimed discrepancies between spec, docs, implementation, and tests. Audits like this can contain false positives (misread code, stale line references, misunderstood intent), false negatives aren't your concern here, and mis-judged "which source is correct." Your job is to independently re-verify every claimed finding against the actual repo, not to trust the audit's evidence citations at face value.

Ground rule: re-derive, don't rubber-stamp

For each finding, go back to the primary sources yourself — open the actual file:line ranges cited, read the actual spec/doc text, run or trace the actual code path, check the actual test. Do not accept the audit's quoted evidence as correct just because it's quoted — re-read the real file and confirm the quote matches and is representative (not cherry-picked or missing context that resolves the "discrepancy").

Step 1: Read the audit

Read `audit/{idx}/00_INDEX.md` and `audit/{idx}/00_PROGRESS.md` first to get the list of shards. **Do not claim the audit inventory is complete based on these files alone** — they list shard filenames but not individual finding details. After reading the index and progress files, enumerate every shard listed in `00_INDEX.md` and read each one in full before creating verification batches or starting any verification. Finding IDs, evidence, and severity live in the shards, not in the index. `SUMMARY.md` (if present) is generated at the end of the audit run and may be absent or stale — do not use it as the initial finding list.

Step 2: Set up a verification directory, same shape as the audit

Create a verify/{idx}/ directory containing:


verify/{idx}/00_INDEX.md — list of verification batches, mirroring audit shards, each with status (not started / in progress / done).
verify/{idx}/00_PROGRESS.md — small, append-only log of which finding IDs have been verified so far and their verdict in one line each. This must never need splitting — keep it terse.


For each audit shard, create a corresponding verify/{idx}/verify_<shard-name>.md. If a verification batch grows large, split it (verify/{idx}/verify_<shard-name>_part2.md), same rule as before: nothing should grow past what's comfortably re-readable in one pass.

Step 3: Verify one finding at a time

For every finding ID in the audit, in order:


Open every file:line reference the finding cites — for spec, doc, code, and test evidence.
Confirm the quoted/paraphrased evidence is accurate and not out of context.
Confirm the discrepancy actually exists as described — i.e., the two (or more) sources really do disagree, not just superficially.
Independently re-judge which source should be trusted — don't just copy the audit's "which source is correct" call. Check things like: is the spec actually current, or was it superseded by a later decision recorded elsewhere (commit messages, changelog, newer doc)? Is the "implementation drift" actually intentional and documented somewhere the audit missed?
Check severity — is it actually critical/high, or did the audit over/under-state impact?
Record a verdict.


Verification entry format

### [Audit ID] Short title
- **Audit claim:** one-line restatement of what the audit said
- **Re-checked evidence:** file:line for each source, with what you actually found there (confirm or correct the audit's citations)
- **Verdict:** confirmed | refuted | partially-correct | unverifiable | needs-human-judgment
- **Reasoning:** why — especially for anything other than "confirmed"
- **Correction (if any):** what the audit got wrong — wrong file/line, wrong "which source is correct" call, wrong severity, evidence taken out of context, or finding doesn't actually exist
- **Confidence:** high | medium | low

unverifiable = you don't have enough information to confirm or refute (e.g. depends on undocumented product intent) — flag for a human rather than guessing.
needs-human-judgment = the facts are clear but "which source should win" is a genuine judgment call, not something re-reading the code resolves.

Constraints


Don't skim. A finding citing 5 file:line references needs all 5 checked, not a sample.
Don't just check whether the discrepancy could exist — check whether it does, right now, in the current state of the repo (files may have changed since the audit ran; note if so).
Treat "confirmed" as requiring the same bar as the original audit should have used — full evidence, not vibes.
If you find yourself agreeing with every single finding in a shard with no corrections, that's a signal to slow down and look harder, not a sign you're doing well — some rate of audit error is expected and a 100% confirm rate across a large audit is itself suspicious.
Resumability: assume this may be picked up cold later — verify/{idx}/00_INDEX.md and verify/{idx}/00_PROGRESS.md must always reflect true current state.


Step 4: Reconciliation summary

Once all findings are verified, produce verify/{idx}/SUMMARY.md:


Counts by verdict (confirmed / refuted / partially-correct / unverifiable / needs-human-judgment)
Full list of refuted and partially-correct findings with a one-line reason each (these are what should NOT be acted on as-is if a fix pass runs next)
Full list of needs-human-judgment and unverifiable findings, flagged for a person
Any pattern in the errors (e.g. "audit consistently misattributed severity" or "audit's line references were often off by a version") — useful signal about how much to trust this audit tool/process going forward


Start by reading audit/{idx}/, then create verify/{idx}/, build the verification batch plan, and begin verifying findings in audit/{idx}/00_INDEX.md order now.