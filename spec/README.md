# restale-kit — Spec

Design documents, wire protocol contracts, and architectural decision records.

> These are internal spec documents for contributors and maintainers, not usage guides.
> For day-to-day usage, see the **[docs/](../docs/README.md)** folder.

---

## Spec documents

| File | Contents |
|---|---|
| [sse-query-invalidate-contract.md](./sse-query-invalidate-contract.md) | Wire protocol, channel lifecycle, server API, client API, key matching semantics, Standard Schema integration |
| [pubsub-adapter-contract.md](./pubsub-adapter-contract.md) | Pub/Sub adapter interface, `SSEChannelGroup` integration, adapter rules |
| [restale-kit-connection-revocation-spec.md](./restale-kit-connection-revocation-spec.md) | Connection revocation architecture, per-connection and cluster-wide revocation APIs |
| [client-target-negotiation.md](./client-target-negotiation.md) | Client-server target negotiation protocol and unsupported target rejection flow |
| [restale-kit-frame-guard-spec.md](./restale-kit-frame-guard-spec.md) | Frame Guard feature: connection lifetime, deadline handling, and signal gating |
| [restale-kit-frame-guard-usage-matrix.md](./restale-kit-frame-guard-usage-matrix.md) | Frame Guard usage patterns and integration examples |
| [folder-structure.md](./folder-structure.md) | Source tree layout and import path → source entrypoint mapping |
