import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://placeholder.supabase.co'
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'placeholder-anon-key'

export const basketballSupabase = createClient(supabaseUrl, supabaseAnonKey)

export const BASKETBALL_CHANNEL_NAME = 'basketball-overlay'
export const BASKETBALL_STATE_ID = 'basketball'

export interface BasketballState {
  homeName: string
  homeAbbr: string
  homeColor: string
  homeScore: number
  awayName: string
  awayAbbr: string
  awayColor: string
  awayScore: number
  period: number
  periodLengthMinutes: number
  clock: number
  clockRunning: boolean
  clockStartedAt: number | null
  shotClock: number
  possession: 'home' | 'away' | null
  homeBonus: boolean
  awayBonus: boolean
  visible: boolean
  gameInitiated: boolean
  syncVersion: number
}

export const DEFAULT_BASKETBALL_STATE: BasketballState = {
  homeName: 'LAKERS',
  homeAbbr: 'LAL',
  homeColor: '#552583',
  homeScore: 0,
  awayName: 'CELTICS',
  awayAbbr: 'BOS',
  awayColor: '#007A33',
  awayScore: 0,
  period: 1,
  periodLengthMinutes: 12,
  clock: 12 * 60,
  clockRunning: false,
  clockStartedAt: null,
  shotClock: 0,
  possession: null,
  homeBonus: false,
  awayBonus: false,
  visible: false,
  gameInitiated: false,
  syncVersion: 0,
}

export type BasketballEvent =
  | { type: 'STATE_UPDATE'; payload: BasketballState }
  | { type: 'SCORE'; team: 'home' | 'away'; points: number; newScore: number; syncVersion?: number }
  | { type: 'SHOW'; syncVersion?: number }
  | { type: 'HIDE'; syncVersion?: number }

export const getCurrentTimestamp = () => new Date().getTime()

export const getPeriodLengthSeconds = (state: Pick<BasketballState, 'periodLengthMinutes'>) =>
  Math.max(1, state.periodLengthMinutes) * 60

export const normalizeBasketballState = (state: Partial<BasketballState>): BasketballState => ({
  ...DEFAULT_BASKETBALL_STATE,
  ...state,
  periodLengthMinutes: state.periodLengthMinutes ?? DEFAULT_BASKETBALL_STATE.periodLengthMinutes,
  syncVersion: state.syncVersion ?? DEFAULT_BASKETBALL_STATE.syncVersion,
  clock: state.clock ?? getPeriodLengthSeconds({
    periodLengthMinutes: state.periodLengthMinutes ?? DEFAULT_BASKETBALL_STATE.periodLengthMinutes,
  }),
})

export const clampBasketballState = (state: Partial<BasketballState>): BasketballState => {
  const next = normalizeBasketballState(state)
  const limit = getPeriodLengthSeconds(next)
  const clock = Math.min(Math.max(0, next.clock), limit)

  if (clock <= 0) return { ...next, clock: 0, clockRunning: false, clockStartedAt: null }

  return { ...next, clock }
}

export const resolveBasketballClock = (state: Partial<BasketballState>, now = getCurrentTimestamp()): BasketballState => {
  const next = clampBasketballState(state)

  if (!next.clockRunning || !next.clockStartedAt) return next

  const elapsedSeconds = Math.max(0, Math.floor((now - next.clockStartedAt) / 1000))
  const clock = next.clock - elapsedSeconds

  if (clock <= 0) return { ...next, clock: 0, clockRunning: false, clockStartedAt: null }

  return { ...next, clock, clockStartedAt: now }
}
