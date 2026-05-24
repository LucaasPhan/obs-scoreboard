import { DEFAULT_STATE, clampTimerState, type BroadcastEvent, type MatchState } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type OverlayStateStore = {
  event: BroadcastEvent | null
  state: MatchState
  updatedAt: number
}

const store = globalThis as typeof globalThis & {
  __overlayStateStore?: OverlayStateStore
}

function getStore() {
  store.__overlayStateStore ??= {
    event: null,
    state: DEFAULT_STATE,
    updatedAt: Date.now(),
  }

  return store.__overlayStateStore
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
  const body = await request.json() as { event?: BroadcastEvent; state?: Partial<MatchState> }
  const current = getStore()

  current.event = body.event ?? null
  current.state = clampTimerState(body.state ?? current.state)
  current.updatedAt = Date.now()

  return Response.json(current, {
    headers: {
      'Cache-Control': 'no-store',
    },
  })
}
