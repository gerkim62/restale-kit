# Frame Guard — Usage Matrix

**Package:** restale-kit
**Companion to:** `restale-kit-frame-guard-spec.md`

## 0. Purpose

This document enumerates every existing, documented way `restale-kit` is used today (read from `docs/server.md`, `docs/pubsub.md`, `docs/getting-started.md`), and shows how Frame Guard (`lifetime`, `beforeFrame`, `guardKeepalive`) applies to each — so that no existing usage pattern is broken or left unclear by the new feature set.

## 1. Where Frame Guard options live (recap)

Frame Guard config (`lifetime`, `beforeFrame`, `guardKeepalive`) is passed to **`SSEChannelOptions`** — the object given to `attachSSE()` / `toSSEResponse()` at channel-creation time — not to `SSEChannelGroup` or `register()`. This was a deliberate correction made during design: `beforeFrame` closes over whatever local variables the caller has in scope (e.g. `sessionId` read from the request), so it never actually needed anything `SSEChannelGroup` uniquely provides. A consequence of this placement, confirmed deliberately: **Frame Guard works identically whether or not a channel is ever registered with a group at all.**

`SSEChannelGroup` may optionally supply **fallback defaults** (`channelDefaults`) for the parts of Frame Guard that are typically uniform across an entire app (`lifetime`, `guardKeepalive`) so they don't need to be repeated at every `attachSSE()` call site. A channel-level value, when present, always wins over a group default — the default only fills a gap. `beforeFrame` is per-connection by nature and is not expected to have a meaningful group-level default (see §4).

## 2. Axes of existing usage

Four independent axes were found across the current docs. Frame Guard must be checked against each:

| Axis | Values found in docs |
|---|---|
| Transport adapter | Express, Node `http`, Fastify (wrapped), Fastify (raw + manual `hijack()`), Hono, generic Fetch API (Bun/Deno/edge) |
| Group usage | Registered with `SSEChannelGroup` / standalone channel, never registered |
| Metadata | `register(channel, meta)` / `register(channel)` with no metadata |
| Deployment topology | Single instance / multi-instance with a `PubSubAdapter` configured |
| Replay | `eventStore` configured for Last-Event-ID replay / not configured |

Topics (`{ topics: [...] }`) are a `register()`-time routing concern only — they do not interact with Frame Guard at all, since Frame Guard is evaluated per-channel before framing, entirely upstream of topic-based delivery. No further mention needed.

## 3. Transport adapters — identical surface, mechanical differences only

Frame Guard is a property of `SSEChannelOptions`, and every adapter accepts the same `SSEChannelOptions` shape under the hood. There is nothing adapter-specific to Frame Guard's *behavior* — only where the options object is passed differs.

### Express / Node `http` / Fastify (wrapped)

```ts
const sessionId = req.session.id
const channel = attachSSE(req, res, {
  target: 'swr',
  lifetime: { ttlMs: 5 * 60 * 1000 },
  guardKeepalive: true,
  beforeFrame: (ctx) => isSessionValid(sessionId) ? { action: 'send' } : { action: 'close' },
})
```

### Fastify (raw objects)

No change beyond the existing `reply.hijack()` requirement — Frame Guard options are passed the same way once hijacked:

```ts
reply.hijack()
const sessionId = request.session.id
const channel = attachSSE(request.raw, reply.raw, {
  target: 'swr',
  lifetime: { ttlMs: 5 * 60 * 1000 },
  beforeFrame: (ctx) => isSessionValid(sessionId) ? { action: 'send' } : { action: 'close' },
})
```

### Hono / generic Fetch API (Bun, Deno, Cloudflare Workers, edge)

`toSSEResponse` returns `{ response, channel }` instead of mutating a passed-in `res` — Frame Guard options go in the same `options` argument as `target`:

```ts
const { response, channel } = toSSEResponse(c.req.raw, {
  target: 'swr',
  lifetime: { ttlMs: 5 * 60 * 1000 },
  beforeFrame: (ctx) => {
    if (!isSessionValid(sessionId)) return { action: 'close' }
    // ctx.signal is only present for frameType: 'signal' — withhold admin-only
    // signals for a demoted user without touching the rest of the connection.
    if (ctx.frameType === 'signal' && isAdminOnlySignal(ctx.signal) && !userIsAdmin) {
      return { action: 'skip' }
    }
    return { action: 'send' }
  },
})
return response
```

**Conclusion:** no adapter needs special-case handling in the Frame Guard implementation. All of them funnel into `createSSEChannel(options)` already; Frame Guard just adds fields to that same options object.

The Hono example above is deliberately the one that uses `ctx.signal` — a per-signal decision like withholding admin-only frames from a demoted user is exactly the case that can't be expressed through closure alone (see spec §4.2.1); the other adapter examples only need the closed-over `sessionId`, so they only use `ctx` as a formality (or can omit the parameter entirely — it's optional to read).

## 4. Group usage: registered vs standalone

### 4.1 Registered with a group (the common case)

```ts
const group = new SSEChannelGroup({
  channelDefaults: {
    lifetime: { ttlMs: 5 * 60 * 1000, onDeadline: { maxAttempts: 2, retryDelayMs: 300 } },
    guardKeepalive: true,
  },
})

app.get('/sse', (req, res) => {
  const sessionId = req.session.id
  const channel = attachSSE(req, res, {
    target: 'swr',
    beforeFrame: (ctx) => isSessionValid(sessionId) ? { action: 'send' } : { action: 'close' },
  }, group)  // Pass group to apply channelDefaults
  group.register(channel, { userId: req.user.id, sessionId })
})
```

`lifetime`/`guardKeepalive` come from the group's `channelDefaults` here since they weren't set on `attachSSE` directly; `beforeFrame` was set per-channel since it's inherently per-connection. The `group` parameter is passed to `attachSSE` as the fourth argument to apply the defaults.

### 4.2 Standalone channel, no group

Fully supported, no degraded behavior. Confirmed directly in the earlier design pass: since Frame Guard never depended on group-provided metadata, an app that pushes signals directly via `channel.invalidate(...)` from its own domain-event handlers, with no `SSEChannelGroup` anywhere, gets full Frame Guard coverage:

```ts
app.get('/sse', (req, res) => {
  const sessionId = req.session.id
  const channel = attachSSE(req, res, {
    target: 'swr',
    lifetime: { ttlMs: 5 * 60 * 1000 },
    guardKeepalive: true,
    beforeFrame: (ctx) => isSessionValid(sessionId) ? { action: 'send' } : { action: 'close' },
  })
  onSomeDomainEvent(() => channel.invalidate({ key: ['todos'] }))
})
```

No `channelDefaults` fallback is available here (there's no group to supply one) — every option must be set directly on `attachSSE`. This is the one real tradeoff of going groupless: you lose the defaulting convenience from §4.1, not any Frame Guard capability itself.

## 5. Metadata: present vs absent

Frame Guard is **entirely unaffected by whether `register()` is given metadata.** This is worth stating explicitly because two *existing* features — `broadcastByKey` and `revokeWhere` — are documented as silently no-ops on channels registered without metadata (`docs/server.md`, "Broadcasting without metadata" / "Revocation without metadata"). Frame Guard does not inherit that limitation, because it isn't metadata-driven in the first place: `beforeFrame` closes over caller-local variables regardless of what (if anything) was passed to `register()`.

Concretely: a channel registered with `group.register(channel)` (no `meta` argument at all, e.g. an app that only ever needs `broadcastToAll`) can still have a fully-functional `beforeFrame`/`lifetime`/`guardKeepalive` configuration, because those were set on `attachSSE`, not on `register()`. No special casing needed — this falls out of §1's placement decision for free.

One real interaction, not a limitation: if the app *does* want `beforeFrame` to close over `sessionId`, that value still has to come from somewhere the request handler already has it (e.g. `req.session.id`) — it doesn't need to flow through `register()`'s `meta` argument at all, even if the same value also happens to be passed there for `revokeWhere`/`broadcast` purposes. The two uses of `sessionId` (Frame Guard's closure, and `register()`'s `meta`) are independent, coincidentally-the-same-value, not the same mechanism.

## 6. Deployment topology: single-instance vs pub/sub multi-instance

### 6.1 Single-instance

No differences from the base case in §4.1/§4.2.

### 6.2 Multi-instance with `PubSubAdapter`

Frame Guard's connection-closing paths (`beforeFrame` → `'close'`, a hit deadline with `onDeadline: 'revoke'`) route through the same underlying close mechanism as `revokeWhere`/`revokeByConnectionId` (per the original spec, §7) — but Frame Guard decisions are evaluated **locally**, on whichever instance holds the connection, using that instance's own closure state. There is no cross-instance broadcast of a `beforeFrame` or deadline decision, unlike an explicit `revokeWhere()` call. This is correct and intentional: `beforeFrame`'s check (e.g. `isSessionValid(sessionId)`) is meant to be re-evaluated wherever the connection actually lives, not centrally decided and fanned out — each instance asks the question itself when its own connection's frame is about to be sent.

**New consideration surfaced by multi-instance: `renew`-wave clustering across the fleet, not just within one instance.** §4.1.4 of the Frame Guard spec already covers jittering *when* a single instance sends `renew` for connections sharing a TTL. In a multi-instance deployment, if every instance computes deadlines the same way (e.g. all connections get `now + 5min` at connect time) and traffic itself arrives in bursts (e.g. after a deploy, when clients reconnect together), the *fleet-wide* renewal wave can be larger than any single instance's local jitter window accounts for. The existing per-connection jitter (§4.1.4) still helps, but a fleet operator relying on Frame Guard at scale should be aware the mitigation is per-instance, not fleet-coordinated — there's no pub/sub-level dampening of `renew` timing the way there is for control-topic revocation broadcasts.

### 6.3 Topics — no interaction

As noted in §2, `topics` (pub/sub routing) and Frame Guard operate on entirely separate axes — one controls which broker subscriptions exist, the other controls whether a given frame is allowed to leave a specific channel. Nothing further to document.

## 7. Replay (`eventStore` / Last-Event-ID) — a real interaction worth flagging

This is the one axis with a genuine, non-obvious interaction with Frame Guard, specifically via `renew`.

When `onDeadline: 'reconnect'` triggers a `renew`-driven reconnect (§4.1.2 of the spec), the resulting close-and-reconnect is, from the transport's point of view, just another disconnect/reconnect cycle — the client's `EventSource` sends the standard `Last-Event-ID` header on its confirmatory attempt exactly as it would after any other drop. This means:

- **With `eventStore` configured** (per `docs/server.md`, "Reconnection & Event History Replay"): any signals emitted during the gap between the `renew`-triggered close and the successful reconnect are replayed automatically, using the exact same mechanism that already covers ordinary network drops. No special Frame Guard-specific replay logic is needed — this falls out of the existing Last-Event-ID plumbing for free, provided the same `eventStore` instance is passed to both `SSEChannelGroup` and the transport helper as already documented.
- **Without `eventStore` configured:** signals emitted during that same gap are lost, same as they would be for any other drop. This is not a new risk introduced by Frame Guard — it's the pre-existing gap in the "no replay buffer" configuration, just now also reachable via a `renew`-triggered reconnect and not only via a raw network blip.

**Recommendation to make explicit in the actual Frame Guard docs (not just this analysis):** any integrator using `onDeadline: 'reconnect'` (the default) should be pointed at the `eventStore` setup in the same breath, since the two features compose to close the "confirmatory reconnect might miss a signal" gap that would otherwise exist even in the common case.

## 8. Consolidated compatibility table

| Existing pattern | Frame Guard support | Notes |
|---|---|---|
| Any transport adapter (Express / Node / Fastify / Hono / Fetch) | Full | Mechanically identical; see §3 |
| Registered with group, `channelDefaults` set | Full, with reduced repetition | §4.1 |
| Registered with group, no `channelDefaults` | Full | Every option set per-channel |
| Standalone channel, no group | Full | No `channelDefaults` fallback available; §4.2 |
| `register()` with metadata | Full | No interaction beyond coincidental shared variables; §5 |
| `register()` without metadata | Full | Unaffected, unlike `broadcastByKey`/`revokeWhere`; §5 |
| Single-instance | Full | Baseline case |
| Multi-instance + `PubSubAdapter` | Full, locally-evaluated | `beforeFrame`/deadline decisions are per-instance, not broadcast; fleet-wide `renew` clustering is a known, only partially-mitigated consideration; §6.2 |
| Topics / pub/sub routing | No interaction | Orthogonal axis; §6.3 |
| `eventStore` configured | Full, and recommended | Closes the `renew`-reconnect signal-loss gap for free; §7 |
| `eventStore` not configured | Full, with a caveat | Same pre-existing gap as any other drop, now also reachable via `renew`; §7 |
| Combined with `revokeWhere` / `revokeByConnectionId` | Full, complementary | Converge on the same underlying close mechanism; see original spec §7 |

## 9. Open item

§6.2's fleet-wide `renew` clustering is flagged but not resolved here — it's a genuine gap in the current design (jitter is per-instance/per-connection, not fleet-coordinated) rather than a documentation-only concern. Worth a follow-up design pass if Frame Guard is expected to be used at a scale where synchronized reconnect bursts after a deploy are a realistic concern.
