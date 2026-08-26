import { type NextRequest, NextResponse } from 'next/server'
import { getTodos, createTodo } from '@/lib/todos'
import { group } from '@/lib/restale'

export async function GET(request: NextRequest): Promise<Response> {
  const userId = request.nextUrl.searchParams.get('userId') || 'user_1'
  const todos = getTodos(userId)
  return NextResponse.json(todos)
}

export async function POST(request: NextRequest): Promise<Response> {
  const userId = request.nextUrl.searchParams.get('userId') || 'user_1'
  const body = (await request.json()) as { text?: string }
  if (!body.text || typeof body.text !== 'string') {
    return NextResponse.json({ error: 'Text is required' }, { status: 400 })
  }
  const todo = createTodo(userId, body.text)

  // Broadcast invalidation signal to cluster or local connections for this user
  group.local.broadcast({ key: ['todos', { userId }] }, (meta) => meta?.userId === userId)

  return NextResponse.json(todo, { status: 201 })
}
