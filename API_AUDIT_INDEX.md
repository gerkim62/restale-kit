# Public API Boundary Audit

**Audit date:** 2026-08-12

This audit separates public-boundary problems by the action they require. It covers the package export map in `restale-kit/package.json`, every public barrel, the emitted-public source contracts, runtime use sites, tests, and the documentation set.

## Reports

- [Implementation fixes](./API_AUDIT_CODE_FIXES.md): public contracts that do not work as declared.
- [Internalization candidates](./API_AUDIT_INTERNALIZATION.md): members exposed to consumers although source comments and use sites identify them as framework/transport implementation details.
- [Export-removal candidates](./API_AUDIT_EXPORT_REMOVALS.md): barrel exports with no consumer-facing role.
- [Export additions and contract alignment](./API_AUDIT_EXPORT_ADDITIONS.md): types needed to make public declarations usable and importable.
- [Documentation corrections](./API_AUDIT_DOCUMENTATION.md): source-verified documentation defects, separate from API design decisions.

## Boundary policy used

An API belongs in a package entry point only when at least one of the following is true:

1. A normal consumer needs it to perform a supported task.
2. It is an intentional extension point, such as a custom adapter or custom event store.
3. It is required to name a type in a public method signature.

Otherwise it should remain module-private, be marked `@internal` and stripped from declarations, or be removed from the relevant barrel. Existing runtime reachability is not, by itself, a reason to support an API.

## Priority summary

| Priority | Action | Findings |
|---|---|---:|
| P0 | Restore documented group-level event replay | 1 |
| P0 | Fix or remove declared-but-dead client options | 1 |
| P1 | Fix silent/dead configuration and reconnect-mechanism contracts | 3 |
| P1 | Hide framework/transport-only methods and inputs | 5 |
| P1 | Remove an internal merge helper from the server barrel | 1 |
| P1 | Correct docs that promise the wrong wire protocol or invalid signal shapes | 7 |
| P2 | Export or stop naming `AutoReconnectOptions` | 1 |
| P2 | Complete the public API documentation and extension-point guidance | 1 report |

No production source was changed by this audit; these files are implementation decisions and work items.
