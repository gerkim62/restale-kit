import { type NextRequest, NextResponse } from 'next/server'
import { updateTodo, deleteTodo } from '@/lib/todos'
import { group } from '@/lib/restale'

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params
  const userId = request.nextUrl.searchParams.get('userId') || 'user_1'
  const body = (await request.json()) as { text?: string; completed?: boolean }
  const updated = updateTodo(userId, id, body)

  if (!updated) {
    return NextResponse.json({ error: 'Todo not found' }, { status: 404 })
  }

  group.local.broadcast({ key: ['todos', { userId }] }, (meta) => meta?.userId === userId)

  return NextResponse.json(updated)
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params
  const userId = request.nextUrl.searchParams.get('userId') || 'user_1'
  const deleted = deleteTodo(userId, id)

  if (!deleted) {
    return NextResponse.json({ error: 'Todo not found' }, { status: 404 })
  }

  group.local.broadcast({ key: ['todos', { userId }] }, (meta) => meta?.userId === userId)

  return new NextResponse(null, { status: 204 })
}
