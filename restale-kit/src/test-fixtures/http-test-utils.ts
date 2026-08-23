import { EventEmitter } from 'node:events'
import { Writable } from 'node:stream'
import type { IncomingMessage, ServerResponse, Server } from 'node:http'
import { vi } from 'vitest'

export type MockServerResponse = ServerResponse & {
  writtenChunks: string[]
}

/**
 * Creates a mock Node.js IncomingMessage for transport testing.
 */
export function createMockNodeRequest(
  url = '/sse',
  headers: Record<string, string | string[] | undefined> = {}
): IncomingMessage {
  return Object.assign(new EventEmitter(), {
    url,
    headers,
  }) as unknown as IncomingMessage
}

/**
 * Creates a mock Node.js ServerResponse that records written chunks.
 */
export function createMockNodeResponse(): MockServerResponse {
  const writtenChunks: string[] = []
  const res = new Writable({
    write(chunk, _encoding, callback) {
      writtenChunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'))
      callback()
    },
  }) as unknown as MockServerResponse
  res.writtenChunks = writtenChunks
  res.writeHead = vi.fn()
  return res
}

/**
 * Robust stream reader helper that races chunk reads against a deadline,
 * ensuring tests fail with clear diagnostic messages instead of hanging indefinitely.
 */
export async function readStreamUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  predicate: (text: string) => boolean,
  timeoutMs = 2500
): Promise<string> {
  const decoder = new TextDecoder()
  let accumulated = ''
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    const remainingMs = Math.max(1, deadline - Date.now())
    let timer: NodeJS.Timeout | undefined
    const timeoutPromise = new Promise<{ value: undefined; done: true; timeout: true }>((resolve) => {
      timer = setTimeout(() => {
        resolve({ value: undefined, done: true, timeout: true })
      }, remainingMs)
    })

    try {
      const result = await Promise.race([reader.read(), timeoutPromise])
      if ('timeout' in result) {
        throw new Error(
          `[readStreamUntil] Timed out after ${String(timeoutMs)}ms waiting for predicate. Accumulated output so far: ${JSON.stringify(accumulated)}`
        )
      }
      if (result.done) break
      accumulated += decoder.decode(result.value, { stream: true })
      if (predicate(accumulated)) return accumulated
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  if (!predicate(accumulated)) {
    throw new Error(
      `[readStreamUntil] Stream completed before predicate was satisfied. Accumulated output: ${JSON.stringify(accumulated)}`
    )
  }
  return accumulated
}

/**
 * Cleanly closes a Node.js HTTP server, terminating all active keep-alive connections
 * to avoid test teardown delays.
 */
export async function closeHttpServer(server: Server | undefined): Promise<void> {
  if (!server) return
  if (typeof server.closeAllConnections === 'function') {
    server.closeAllConnections()
  }
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve()
    })
  })
}
