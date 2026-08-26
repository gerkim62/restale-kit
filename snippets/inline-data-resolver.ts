import { SSEChannelGroup, type InlineDataResolver } from 'restale-kit/server'

interface UserMeta {
  userId: string
  role: string
}

interface ClientContext {
  activeWorkspaceId: string
}

interface TodoPayload {
  id: string
  workspaceId: string
  title: string
}

function isTodoPayload(val: unknown): val is TodoPayload {
  return typeof val === 'object' && val !== null && 'id' in val && 'workspaceId' in val && 'title' in val
}

const customResolver: InlineDataResolver<UserMeta, ClientContext> = (connections, payload) => {
  const map = new Map()
  if (!isTodoPayload(payload)) return map

  for (const conn of connections) {
    // Only send inline data to clients actively viewing this workspace
    if (conn.clientContext?.activeWorkspaceId === payload.workspaceId) {
      map.set(conn.connectionId, {
        action: 'inlineData',
        signal: { key: ['todos', { id: payload.id }] },
        inlineData: payload,
        markStale: false,
      })
    } else {
      // Other connections fall back to a revalidate signal
      map.set(conn.connectionId, {
        action: 'revalidate',
        signal: { key: ['todos'] },
      })
    }
  }

  return map
}

const group = new SSEChannelGroup<UserMeta, ClientContext>({
  secret: process.env.RESTALE_SECRET || 'secret-key-at-least-32-chars-long',
  scopeBy: ['userId'],
  inlineDataResolver: customResolver,
})

export async function pushTodoUpdate(todo: { id: string; workspaceId: string; title: string }) {
  await group.local.pushInlineData(todo, () => true)
}
