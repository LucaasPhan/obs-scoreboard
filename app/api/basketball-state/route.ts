import { DEFAULT_BASKETBALL_STATE, clampBasketballState, type BasketballEvent, type BasketballState } from '@/lib/basketball'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type BasketballStateStore = {
  event: BasketballEvent | null
  state: BasketballState
  updatedAt: number
}

const store = globalThis as typeof globalThis & {
  __basketballStateStore?: BasketballStateStore
}

function getStore() {
  store.__basketballStateStore ??= {
    event: null,
    state: DEFAULT_BASKETBALL_STATE,
    updatedAt: Date.now(),
  }

  return store.__basketballStateStore
}

export async function GET() {
  const current = getStore()

  return Response.json(current, {
    headers: {
      'Cache-Control': 'no-store',
    },
  })
}

export async function POST(request: Request) {
  const body = await request.json() as { event?: BasketballEvent; state?: Partial<BasketballState> }
  const current = getStore()

  current.event = body.event ?? null
  current.state = clampBasketballState(body.state ?? current.state)
  current.updatedAt = Date.now()

  return Response.json(current, {
    headers: {
      'Cache-Control': 'no-store',
    },
  })
}
