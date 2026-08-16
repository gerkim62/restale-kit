# Universal signal audit suite

These regression tests cover the migration from target-routed invalidation payloads to a single universal protocol.

The retained test paths document the removed failure modes: target discriminants, framework-specific payloads, negotiated targets, target headers, and adapter/channel generic mismatches. Their current assertions verify the replacement contract:

- every signal has a JSON-compatible `key` array;
- revalidation signals may use `exact`;
- inline-data signals use `inlineData` and optional `markStale`;
- retired routing fields, including `target`, are rejected at the validation boundary;
- server frames and pub/sub envelopes carry universal signals without target metadata.

Run the suite with `pnpm --filter restale-kit run test`.
