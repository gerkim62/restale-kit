import { type NextRequest } from 'next/server'
import { group } from '@/lib/restale'

export async function GET(request: NextRequest): Promise<Response> {
  const userId = request.nextUrl.searchParams.get('userId') || 'user_1'
  return group.handle(request, {
    meta: { userId },
  })
}

export async function POST(request: NextRequest): Promise<Response> {
  const userId = request.nextUrl.searchParams.get('userId') || 'user_1'
  return group.handle(request, {
    meta: { userId },
  })
}
