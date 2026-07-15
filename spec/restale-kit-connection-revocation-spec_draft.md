# Connection Revocation Specification

**Package:** restale-kit

## 1. Overview

An open SSE connection must be actively closed by the server when its underlying session or authentication state terminates (logout, session expiration, ban, or security revocation). In a distributed multi-instance deployment, the server instance receiving the logout request may be different from the instance maintaining the active SSE transport stream.

`restale-kit` provides connection revocation capabilities across single-instance and cluster-wide deployments.

## 2. Revocation Granularity & Connection Metadata

Connections can be revoked either per individual client connection or across all connections matching a criteria predicate (e.g. all sessions for a user).

| Intent | API Call | Scope & Behavior |
|---|---|---|
| Revoke specific connection | `revokeByConnectionId(connectionId, { userId, sessionId })` | Closes the single connection matching `connectionId` within the authenticated scope |
| Revoke all user connections | `revokeWhere({ userId })` | Closes every active connection for that user across the cluster |

### 2.1 `connectionId` Generation and Extraction

- **Client side**: `SSEInvalidatorClient` generates a unique UUID (`connectionId`) per connection instance and automatically appends it as `__restale_cid__` in the SSE connection URL.
- **Server side**: Transport helpers (`attachSSE`, `toSSEResponse`) extract `__restale_cid__` from the request URL and assign it to `channel.connectionId`. If `__restale_cid__` is missing or empty, `attachSSE`/`toSSEResponse` throw synchronously.
- **Security**: `connectionId` is an opaque transport correlation value, not an authorization token. Production handlers combining `revokeByConnectionId` with trusted server-side identity (e.g. `{ userId, sessionId }`) ensure callers cannot revoke unauthorized connections.

## 3. Revocation APIs

- **`revokeWhere(criteria: JSONValue)`**: Closes all local channels whose metadata subset-matches `criteria`. When a `PubSubAdapter` is configured, broadcasts a control message to `controlTopic` to close matching channels across all cluster instances. Channels registered without metadata (`undefined`) are excluded from criteria matching.
- **`revokeByConnectionId(connectionId: string, scope?: Record<string, JSONValue>)`**: Closes the channel matching `connectionId` locally if its metadata satisfies `scope`. Broadcasts a control revocation message across the cluster when pub/sub is configured.

## 4. Control Communication & Subscriptions

- **Control Messages**: `PubSubMessage` is a discriminated union (`kind: 'signal' | 'control'`). Control messages carry revocation payloads across instances.
- **Lifecycle & Teardown**: `SSEChannelGroup` subscribes to `controlTopic` (default: `'__restale_control__'`) upon initialization. Calling `group.dispose()` unsubscribes from the control topic idempotently without force-closing registered client connections.

## 5. Non-Goals

- Not a firewall/auth gateway — does not prevent subsequent reconnect attempts (auth middleware handles connection rejection).
- Not guaranteed delivery beyond underlying pub/sub broker capabilities.
- Not an authorization framework for API endpoint access controls.
