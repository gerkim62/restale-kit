# Public API Audit — Export Additions and Contract Alignment

## P2 — Export `AutoReconnectOptions`, or stop naming it as public

`ClientOptions.autoReconnect` exposes an object form through the public client declaration:

```ts
autoReconnect?: boolean | AutoReconnectOptions
```

`AutoReconnectOptions` is declared in `restale-kit/src/client/core/client-contracts.ts:112-120`, but it is omitted from the `restale-kit/client` barrel at `restale-kit/src/client/core/index.ts:4-15`.

**Impact:** A consumer can use the inline object form but cannot import the type that the library’s own declaration names. The API reference compounds this by presenting it as a normal public interface.

**Decision:**

- Prefer exporting `type AutoReconnectOptions` from `restale-kit/client`; it is a stable, small configuration contract.
- If it is not meant to be named by consumers, change `ClientOptions` to use an inline object type and stop documenting it as an importable type.

## P2 — Do not expose unexported helper types in public documentation

The API reference uses `SignalTarget`, `ReStaleSignalForTarget`, `SignalInputForTarget`, and `TargetForSignal` in display signatures, but the root barrel does not export them. They are implementation-level generic machinery in `restale-kit/src/types/protocol.ts:65-145`.

**Decision:**

- Export `SignalTarget` only if users need to annotate target variables and extension APIs with it.
- Keep the more complex conditional helper types internal unless a concrete external use case requires them.
- Until then, documentation must not present them as copy-paste public imports; use a simple union or explanatory pseudotype.

## P2 — Define shared event details once

This accompanies the code-fix finding. Once `RevokeEventDetail` and `RenewEventDetail` are sourced from a single protocol declaration, re-export the same types from the root and client entry points. That makes either import path equivalent and prevents documentation divergence.

## Required API-surface verification

After any addition/removal/internalization, build the package and test the generated `dist/*.d.ts` files through the package export map. Current tests import source aliases (for example `@/client/core/index.js`), which does not prove that consumers see the intended published surface.
