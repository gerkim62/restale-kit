I need a thorough, comprehensive audit of this codebase comparing four sources of truth against each other:


Spec (design docs, RFCs, requirements, PRDs — wherever they live)
Docs (README, /docs, API docs, docstrings, comments claiming behavior)
Implementation (actual code behavior)
Tests (what's actually verified vs. what's claimed)


Your goal: find every discrepancy between them — outdated docs, undocumented behavior, spec that was never implemented, implementation that drifted from spec, tests that test the wrong thing or don't exist, dead/contradictory instructions.

Critical constraint: use a persistent ledger, not memory — and never let the ledger itself become the bottleneck

Do not try to hold this analysis in context. Your context window will fill up and you will start summarizing, generalizing, or silently dropping earlier findings — I don't want that. But also: do not funnel everything into one single ledger file. A single file can itself grow larger than what you can safely read back in one go, which just recreates the same problem one level up. Instead, use a small ledger directory:


Before starting, create an audit/ directory in the repo root, containing:

audit/00_INDEX.md — a short, always-small index: list of ledger shards (below), each with a one-line description of scope and a status (not started / in progress / done).
audit/00_PROGRESS.md — running coverage tracker: which files/modules/docs have been fully reviewed, so nothing gets silently skipped or double-counted. Keep this file itself small (append short lines, don't restate detail that belongs in a shard).



Work through the codebase systematically, one module/directory/doc-section at a time, and give each logical area its own shard file, e.g. audit/shard_auth-module.md, audit/shard_billing-spec-vs-impl.md. Never try to read everything before writing anything.
Immediately after each chunk, append findings to that chunk's shard before moving to the next chunk. Do not hold findings in your head to write up "later" — later is when they get lost.
If a shard itself is getting large (e.g. a big module with many discrepancies), split it further (shard_auth-module_part2.md) rather than letting one file balloon — update the index accordingly. The rule of thumb: any file you might need to re-read in full should stay comfortably re-readable in one go.
Update 00_INDEX.md and 00_PROGRESS.md as you go, not at the end. Assume you (or another instance of you) may need to resume work purely by reading the index + progress file + relevant shards, with no memory of this conversation — so those two files must always accurately reflect current state.
When cross-referencing across areas (e.g. a shared spec doc touching multiple modules), it's fine for the same discrepancy to be noted from multiple shards, or for a shard to reference another shard by filename — just don't duplicate long evidence blocks; point to where the detail lives.


Ledger entry format

Within each shard file, for every discrepancy found, log an entry with:

### [ID] Short title
- **Area:** module/file/doc path(s) involved
- **Type:** outdated-doc | spec-not-implemented | implementation-drift | missing-test | wrong-test | contradiction | undocumented-behavior
- **Evidence:** exact file:line references for each source (spec/doc/code/test) — quote the relevant lines
- **Discrepancy:** what disagrees with what, precisely
- **Which source is correct / should be trusted:** your best judgment, with reasoning
- **Recommended fix:** what to edit (doc, code, test, or spec) and roughly how
- **Severity:** critical | high | medium | low
- **Confidence:** high | medium | low (flag if you're unsure and a human should verify)

Process


Inventory first. Map out where spec, docs, implementation, and tests actually live in this repo. Record this in 00_INDEX.md, and turn it into a shard plan (a list of shards you intend to produce) before analyzing anything.
Go source-of-truth by source-of-truth, then cross-reference. E.g., read the spec fully and note every claim/requirement, then check each against docs, code, and tests. Then repeat starting from docs, then from tests, to catch things spec missed.
If a single file (spec doc, code file, etc.) is itself too large to read in one pass, don't skip it or summarize it from a partial read — read it in sequential ranges/pages, and log findings from each range into the shard incrementally, same as you would across multiple files. Note in 00_PROGRESS.md which byte/line range of that file has been covered so far.
Don't skip "boring" agreement. Briefly note when something checks out — it's useful signal that a section was actually reviewed, not skipped.
Flag ambiguity honestly. If you can't tell which source is authoritative, say so in the shard rather than guessing silently.
At the end, produce a summary report (audit/SUMMARY.md) generated from the shards — grouped by severity, with a short "what to trust / what to edit / what to build (missing pieces)" section at the top, and a pointer to which shard has the full detail for each item. The summary is a distillation, not a replacement — keep all shards too.


Start by creating the audit/ directory, the index, and doing the inventory pass now.