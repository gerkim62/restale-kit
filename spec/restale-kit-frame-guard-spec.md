# Frame Guard Specification

**Package:** restale-kit

## 1. Overview

An SSE connection, once established, is a long-lived stream. `restale-kit` today only closes a connection when the integrator explicitly calls `revokeWhere()` or `revokeByConnectionId()`. Many authorization states (session expiry, logout elsewhere, ban, plan downgrade) don't naturally produce an event to trigger those calls — the connection stays open and keeps delivering frames until something notices and acts.

**Frame Guard** gives integrators a way to gate outgoing frames against their own, arbitrary authorization logic — either on a fixed schedule, per-frame, or both — without requiring restale-kit to understand sessions, tokens, or any specific auth model.

This is a general-purpose hook, not an "auth" feature specifically. Authorization is the primary expected use, but the same mechanism is equally usable for rate limiting, feature-flag gating, tenant suspension, or any other "should this frame go out right now" decision.

### 1.1 Where Frame Guard options live

`lifetime`, `beforeFrame`, and `guardKeepalive` are fields on `SSEChannelOptions` — the object passed to `attachSSE()` / `toSSEResponse()` at channel-creation time. They are **not** part of `SSEChannelGroup` or `register()`. This is a deliberate placement, not an incidental one: `beforeFrame` closes over whatever local variables the caller already has in scope at that point (a `userId`, a `sessionId` read from the request) — it never needed anything `SSEChannelGroup` uniquely provides. One direct consequence: **Frame Guard is fully functional on a channel that is never registered with any group at all** — a standalone `attachSSE()` call, with signals pushed via `channel.invalidate(...)` directly, gets complete Frame Guard coverage with no group involved.

`SSEChannelGroup` may optionally supply **`channelDefaults`** — fallback values for the parts of Frame Guard that are typically uniform across an entire app (`lifetime`, `guardKeepalive`), so they don't need to be repeated at every `attachSSE()` call site:

```ts
const group = new SSEChannelGroup({
  channelDefaults: {
    lifetime: { ttlMs: 5 * 60 * 1000 },
    guardKeepalive: true,
  },
})
```

A channel-level value, when set directly on `attachSSE()`/`toSSEResponse()`, always wins over a group default — the default only fills a gap left by the channel. `beforeFrame` is per-connection by nature (it typically closes over that specific request's identity) and is not expected to have a meaningful group-wide default; it is set per-channel.

**Merge semantics for `channelDefaults` are precise, not "shallow" or "deep":**

- **Presence, not truthiness, decides override.** A field counts as "set by the channel" if the channel's options object literally contains that key — not if its value is truthy. `guardKeepalive: false` on a channel correctly overrides a group default of `true`; a naive `??`/`||` merge would not, since both treat `false` as equivalent to absent. This rule applies uniformly to every `channelDefaults`-eligible field.
- **`lifetime` merges as two independent parts, not as one whole object and not field-by-field.** The time value (`ttlMs`/`deadline` — mutually exclusive, so they merge as one atomic pair) and `onDeadline` are defaulted separately. If a channel sets only `lifetime: { ttlMs: 60_000 }`, it still inherits the group's `onDeadline` default, because it never touched that field — a whole-object replace would silently drop it. Conversely, `ttlMs`/`deadline` are never merged at the sub-field level with each other, since only one may be present at a time.

**`guardKeepalive` as a group default is inert on any channel that doesn't also set its own `beforeFrame`.** `guardKeepalive` is not an independent setting — it's a modifier on `beforeFrame`, answering "when `beforeFrame` exists, should it also run on keepalive ticks." Since `beforeFrame` itself can never come from `channelDefaults` (see above), a `guardKeepalive: true` default only does something on the subset of channels that separately define their own `beforeFrame`; on every other channel using the group's defaults, it's a no-op — there's nothing for it to guard.

## 2. Goals

- Let integrators bound how stale an unauthorized connection can remain open, without forcing them to invent their own timer/sweep infrastructure.
- Let integrators run a fine-grained check before any individual frame is sent, when they have a cheap way to decide.
- Keep both mechanisms fully optional and independently composable — none, either, or both.
- Keep the decision logic entirely in the integrator's hands: restale-kit calls the function and acts on its answer, and does not interpret, cache, retry, or second-guess it.

## 3. Non-Goals

- Not an authorization framework. Frame Guard does not know what a "session" or "user" is; the integrator's function supplies all of that meaning.
- Not a caching layer. If a check is expensive, memoizing or rate-limiting it is the integrator's responsibility, not restale-kit's.
- Not a substitute for connection-establishment auth. Frame Guard governs frames on an already-open connection; rejecting the initial connection is still the integrator's own middleware's job.

## 4. Two Independent Mechanisms

### 4.1 Lifetime (`ttlMs` / `deadline`)

A connection-level, always-on deadline after which the connection is closed, independent of frame activity. Useful when the integrator knows a concrete expiry moment up front (e.g. a token's `exp` claim, a fixed session TTL) and wants a guaranteed upper bound on staleness without writing any check function at all.

- Expressed as either a relative duration from connection start (`ttlMs`) or an absolute point in time (`deadline`) — mutually exclusive, not both.
- Enforced regardless of whether frames are flowing; this is what covers otherwise-idle connections.
- Cheap by construction: a timestamp comparison, no user code invoked.

#### 4.1.1 A deadline is a hint, not a verdict

A `ttlMs`/`deadline` value is frequently a guess rather than ground truth — a session may have been renewed elsewhere, a sliding-window TTL may have been extended by other activity, or the deadline may simply have been set conservatively. Treating every hit deadline as a confirmed revocation discards connections that may still be perfectly valid.

`onDeadline` controls how a hit deadline is treated:

```
type OnDeadline =
  | 'reconnect'                                     // shorthand: maxAttempts: 1, retryDelayMs: 250
  | 'revoke'
  | { maxAttempts?: number; retryDelayMs?: number }   // reconnect, customized — omitted fields keep the shorthand defaults
```

| Value | Behavior |
|---|---|
| `'reconnect'` (default) or `{ maxAttempts?, retryDelayMs? }` | The server sends an explicit `renew` frame, then closes the stream — see §4.1.2. This is distinct both from a revoke and from an ordinary network drop: it tells the client plainly that the close is intentional but not a verdict, and asks it to make one confirmatory reconnect attempt through the integrator's real auth middleware — the actual source of truth. If the session is genuinely still valid, a new connection (and new deadline) is opened. If it's genuinely dead, the new connection attempt is rejected there instead. The object form is identical in behavior — it only overrides the `maxAttempts`/`retryDelayMs` values the server puts in the `renew` frame, in place of the `'reconnect'` shorthand's defaults. |
| `'revoke'` | The stream ends with a terminal revoke frame, identical to an explicit `revokeWhere`/`revokeByConnectionId` call. No reconnection is attempted. Appropriate when the deadline itself is authoritative and unambiguous (e.g. derived directly from a signed token's `exp` claim), and a wasted reconnect round trip isn't worth avoiding false negatives for. |

`'reconnect'` is the default because a deadline is, by construction, usually a hint the integrator chose defensively — the middleware that gated the original connection remains the authoritative check, and re-running it costs one reconnect rather than one wrongly-dropped, still-valid connection.

#### 4.1.2 The `renew` frame

A hit deadline configured with `onDeadline: 'reconnect'` must not be communicated by silently ending the stream and letting the client infer intent from timing or `readyState` — that relies on the native `EventSource` reconnection heuristics the integrator does not control, and is indistinguishable from a genuine network drop. Instead, the server sends a dedicated, named frame before closing:

```
event: renew
data: { "reason": "deadline", "maxAttempts": 1, "retryDelayMs": 250 }
```

This is a sibling of the existing `revoke` frame, not a variant of it — same mechanism (a distinct SSE event type with its own client-side listener), opposite meaning. `revoke` asserts "you are not authorized, do not come back." `renew` asserts "this connection is ending on purpose, but you are not being told you're unauthorized — go ahead and try again."

On receiving `renew`, the client:

- Treats it as a *distinct* signal from the generic `onerror` path used for network drops — it does not fall into the shared `jsBackoffAutoReconnect` loop or consume the connection's `maxRetries` budget. Reusing that budget here would apply network-flakiness retry philosophy to a question that a single attempt already answers definitively (see §4.1.3).
- Makes exactly `maxAttempts` confirmatory reconnect attempts, as specified in the `renew` frame's payload. The client holds no independent default and performs no local override — `maxAttempts` is read from the frame the server sent for *that* deadline hit, full stop. (A server implementation will commonly default to `1` when constructing the frame, but that is a server-side default, not a client-side one — the client never needs to know or assume what the typical value is.)
- If `maxAttempts` is greater than `1`, spaces attempts apart per `retryDelayMs` and the jitter rule in §4.1.5 — see there for why this is not exponential backoff. `retryDelayMs` is irrelevant and may be omitted when `maxAttempts` is `1`.
- If the confirmatory attempt(s) fail, treats the connection as equivalent to having received `revoke` — final, no further retries, `status: 'closed'`.

`maxAttempts` is server-supplied rather than a client-side config value because the server is the one that knows how likely a `renew` is to be a false positive for its own deadline policy — the client should not have to guess.

#### 4.1.3 Retry-budget isolation

Because a `renew`-triggered reconnect is confirmatory rather than resilience-oriented, it deliberately uses its own small, separate attempt count instead of the connection's general-purpose `maxRetries`/backoff configuration. The two exist to answer different questions:

- `maxRetries` + backoff (existing, network-drop path): *"conditions may change moment to moment, so it's worth trying again with increasing delay."*
- `renew`'s `maxAttempts` (new, deadline path): *"this is a yes/no question about current validity, and a single attempt already answers it — repeating it on a backoff schedule doesn't change the answer, it only adds load."*

Collapsing the two into one budget would mean a connection whose session is genuinely, permanently invalid gets retried the same number of times a flaky network connection would — hammering the server with requests that cannot succeed until `maxRetries` is exhausted. Keeping them separate bounds the worst case for a confirmed-dead session to exactly `maxAttempts` (default: one) extra request, regardless of how large `maxRetries` is configured for ordinary network resilience.

#### 4.1.4 Avoiding synchronized `renew` waves

If many connections share the same TTL, they don't just each retry independently — their deadlines land at the same instant, producing a burst of simultaneous `renew` frames and reconnect attempts rather than a spread-out trickle. Because `renew` is server-sent, this is a server-side concern rather than something the client needs to reason about: jitter *when the server sends* `renew` for a given connection (within a small random window at or after the nominal deadline), rather than requiring every client to independently jitter its own deadline.

#### 4.1.5 Spacing between confirmatory attempts (`maxAttempts` > 1)

`maxAttempts` greater than `1` is not a resilience mechanism — it exists for one narrow, legitimate reason: giving eventually-consistent auth state (a replicated session store, a cache that hasn't yet observed a renewal) a brief window to catch up, when the server itself knows its own backing store has that kind of lag. It is not there to "try harder" against a session that is simply, definitively dead.

That distinction drives the spacing rule:

- **Fixed delay, not exponential backoff.** `retryDelayMs` is a flat interval applied between each attempt, sourced from the `renew` frame — not a growing sequence like the `maxRetries` backoff path. Exponential growth is a tool for riding out conditions that may keep changing for a while; a replication-lag window is short and roughly constant, so a fixed short delay (typically low hundreds of ms) models it more honestly than a curve designed for a different kind of uncertainty.
- **Small client-side jitter applied on top of `retryDelayMs`, not instead of it.** §4.1.4's jitter spreads out when the *first* `renew` in a wave is sent, but if every affected client then waits the exact same `retryDelayMs` before its next attempt, the second (and any subsequent) attempt re-synchronizes right back into a wave. The client applies a small jitter window (e.g. ±20%) around the server-supplied `retryDelayMs` for each spaced attempt, so that a herd whose first attempts were already spread stays spread through the rest of its attempts too. This is local spacing logic the client owns — the server only supplies the base interval, not the jitter itself.
- **No fail-fast on a "clearly fatal" response.** In principle, a definitively-dead session (e.g. an explicit `401`) shouldn't need to burn through all `maxAttempts` — but the client cannot make that distinction with the current native-`EventSource`-based transport, which does not expose the HTTP status code of a failed request to application code. Every failed confirmatory attempt is therefore treated identically regardless of cause, and the count-based exhaustion described in §4.1.2 is the only signal available under this transport — which is also why `maxAttempts` should stay small and server-chosen rather than generous by default.

#### 4.1.6 A deadline that is already past at connect time is still just a hint

A resolved deadline (`connectedAt + ttlMs`, or an absolute `deadline`) can occasionally already be in the past the moment a channel is created — e.g. a `deadline` derived from a token's `exp` claim that hadn't been refreshed, or clock skew. This does **not** change how `onDeadline` is honored: per §4.1.1, a deadline is a hint about likely staleness, not a verdict, regardless of whether it's hit exactly on schedule or found already-expired at the first check. Overriding the integrator's configured `onDeadline` in this case — for example, forcing `'revoke'` even though `'reconnect'` was requested — would take that choice away from the integrator based on the same kind of guess the deadline itself already is.

What this scenario *does* require is a floor on how soon a freshly-connected channel's deadline is allowed to fire: **never immediately.** The earliest a channel's deadline may trigger `onDeadline` handling is a fixed minimum delay (the constant `DEADLINE_MIN_FIRE_DELAY_MS`, currently 250ms) after that channel's connection began, even if the raw resolved deadline value is already in the past by more than that. Without this floor, a connection whose deadline source is persistently stale (e.g. a token that never gets refreshed between reconnects) would cycle through `renew` → confirmatory reconnect → immediately-expired-again → `renew` with no delay between cycles, hammering the server in a tight loop. With the floor, the same underlying problem still surfaces — the connection still cycles, `onDeadline` is still honored exactly as configured — but at minimum-delay-spaced intervals instead of instantly, turning a tight loop into a bounded-rate one. This fixed floor applies regardless of the channel's configured `retryDelayMs` or `onDeadline` values, ensuring consistent protection against tight loops.

### 4.2 Frame Guard function (`beforeFrame`)

A function supplied by the integrator, evaluated before a frame is sent, that returns one of three outcomes:

```
type FrameGuardResult =
  | { action: 'send' }
  | { action: 'skip' }
  | { action: 'close'; reason?: string }
```

- **Send** — the frame goes out normally.
- **Skip** — this specific frame is dropped; the connection stays open.
- **Close** — the connection is closed through the same path as an explicit revocation (terminal frame sent, no auto-reconnect, teardown callbacks fire). `reason`, if provided, is carried through to the same place a `revokeWhere`/`revokeByConnectionId` reason would surface.

The function is expected to close over whatever identity or state it needs (e.g. a user ID, a session reference) at the point where the integrator already has that context available — it is not handed a generic "metadata" payload by restale-kit.

By default, this function runs before **signal frames only** (the invalidation events the connection actually exists to deliver).

#### 4.2.1 The `ctx` argument

`beforeFrame` receives one argument, `ctx`, but it is deliberately minimal:

```
ctx.signal          // the invalidation about to be sent (undefined for a keepalive frame)
ctx.frameType        // 'signal' | 'keepalive'
ctx.connectionId      // the __restale_cid__ for this connection
ctx.requestedTarget    // the __restale_target__ the client asked for, if any
ctx.isResume         // true if this connection began from a Last-Event-ID (reconnect), false for a fresh connect
```

The test for what belongs here is not "does restale-kit happen to know this" — it's **"could the caller possibly have known this themselves, no matter how they structured their code."** Two fields (`meta`, `connectedAt`/`now`) were deliberately considered and left out; see the rationale split below.

**`ctx.signal` — included, and the only genuinely load-bearing field.** This is not a convenience — it is the one piece of information that is *structurally impossible* to obtain via closure, at any point, no matter how the integrator writes their code. `beforeFrame` is defined once, at `attachSSE`/`toSSEResponse` time. The signal it needs to evaluate is decided later, by code the closure's author may never even see — a `group.broadcastToAll(...)` call in an unrelated route handler, a cron job, or a pub/sub message arriving from a different server instance. Without `ctx.signal`, per-signal decisions (e.g. "skip admin-only signals after a role downgrade," "delay a signal until replication catches up") are simply unimplementable, regardless of closure cleverness.

**`ctx.connectionId` / `ctx.requestedTarget` / `ctx.isResume` — included as convenience, not necessity.** All three are parsed by `attachSSE`/`toSSEResponse` moments before the channel is returned. An integrator *could* obtain `connectionId` themselves via a hoist-and-assign-after-`attachSSE` pattern, but that's an awkward workaround for something already computed one line earlier inside the kit — and duplicating the kit's own query-string/header-parsing to get at `requestedTarget`/`isResume` independently would mean reimplementing (and risk drifting from) an internal detail that isn't part of the stable public contract. These are included because the alternative is friction, not because they're otherwise unobtainable.

**`meta` — deliberately excluded.** Unlike `signal`, metadata is something the caller already possesses *before* writing the `beforeFrame` closure — it's typically the same local variable (`userId`, `sessionId`) they're about to pass to `register()` a few lines later. Threading it through `ctx` as well would create two routes to the same value for no benefit, and would reintroduce the earlier architectural mismatch (metadata living in `SSEChannelGroup`, not on the channel) that motivated moving `beforeFrame` off `register()` in the first place.

**`ctx.connectedAt`/`ctx.now` / a per-call invocation counter — deliberately excluded.** Both are trivially available to the caller with a `Date.now()` or a closed-over `let count = 0` in their own outer scope. Adding kit-supplied equivalents would be redundant surface area for something that adds no real capability the integrator didn't already have.

### 4.3 Keepalive coverage (`guardKeepalive`)

Signal frames are not guaranteed to occur at any particular rate — a mostly-idle connection may never trigger `beforeFrame` on its own, leaving the same blind spot Frame Guard was meant to close. Keepalive frames (when enabled) fire on a fixed interval regardless of activity, so extending the guard to them closes that gap. When `frameType` is `'keepalive'`, `ctx.signal` is `undefined`.

`guardKeepalive` has no effect on a channel that does not also have `beforeFrame` set — there is no function to extend to keepalive ticks in the first place. Setting `guardKeepalive: true` alone, with no `beforeFrame` anywhere on that channel, is a no-op.

This is opt-in and **defaults to off**, because keepalives are, by design, much higher-frequency than signals — running a non-trivial check on every keepalive tick is a materially different cost than running it on every signal. Integrators with a cheap check can safely enable it for full coverage; integrators with an expensive check can rely on `ttlMs`/`deadline` as their idle backstop instead.

## 5. Configuration Matrix

All combinations are valid, independent configurations — not special cases:

| `ttlMs` / `deadline` | `beforeFrame` | `guardKeepalive` | Resulting behavior |
|---|---|---|---|
| ✗ | ✗ | — | No forced closure. Connection lives until the client disconnects or an explicit `revokeWhere`/`revokeByConnectionId` call. (Current default behavior, unchanged.) |
| ✓ | ✗ | — | At the deadline, ended per `onDeadline` — a `renew` frame + one confirmatory reconnect attempt by default, or a hard `revoke` if configured. No per-frame gating in between. |
| ✗ | ✓ | ✗ | Every signal is checked before delivery. Idle connections with no signals are not checked. |
| ✗ | ✓ | ✓ | Every signal and every keepalive tick is checked. Full coverage, cost scales with keepalive frequency. |
| ✓ | ✓ | either | Per-frame gating as above, with a guaranteed upper bound on staleness from the deadline even if the guard function is never triggered (e.g. `guardKeepalive` left off and no signals occur). The deadline's own closure still follows `onDeadline` independently of what `beforeFrame` decides on individual frames. |

## 6. Failure Semantics

- A **Close** result from `beforeFrame` is functionally equivalent to the integrator calling revocation directly: the client receives a terminal signal distinguishing an intentional close from a network error, and does not attempt to reconnect. Unlike a hit deadline, `beforeFrame` returning `Close` is a positive assertion by the integrator's own logic, not a hint — it is always treated as authoritative and always uses the hard revoke path, regardless of `onDeadline`.
- A hit deadline is not a positive assertion — see §4.1.1–§4.1.4. Its default (`onDeadline: 'reconnect'`) sends an explicit `renew` frame rather than a revoke frame or a silent close, and allows a single confirmatory reconnection through the same auth path that gated the original connection — bounded to `maxAttempts`, isolated from the connection's general `maxRetries` budget.
- A **Skip** result must not be silently indistinguishable from normal quiet periods over the long term — integrators using `Skip` repeatedly instead of `Close` should be aware the client has no way to know frames are being withheld.
- Errors or timeouts thrown by the guard function should be handled inside the function itself when possible (e.g. deciding whether an auth-service timeout should fail open or fail closed). If an unhandled error is thrown inside `beforeFrame`, restale-kit catches it, logs a warning, and fails closed by treating it as `{ action: 'close' }` to ensure security invariants are preserved.

## 7. Relationship to Existing Revocation APIs

Frame Guard and `revokeWhere`/`revokeByConnectionId` are complementary, not competing:

- `revokeWhere` / `revokeByConnectionId`: **event-driven** — use when the integrator's own code path already knows a session died (logout handler, ban action, admin panel).
- Frame Guard: **poll/check-driven** — use when there is no natural event, only a fact that can be checked (has this session expired as of right now?).

Both ultimately close the connection through the same underlying mechanism, so client-side behavior (no auto-reconnect, teardown callbacks) is consistent regardless of which path triggered it.
