import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://placeholder.supabase.co'
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'placeholder-anon-key'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

export const CHANNEL_NAME = 'laliga-overlay'
export const STATE_KEY = 'match_state'

export interface MatchState {
  homeName: string
  homeAbbr: string
  homeColor: string
  homeScore: number
  awayName: string
  awayAbbr: string
  awayColor: string
  awayScore: number
  timer: number
  timerRunning: boolean
  timerStartedAt: number | null
  status: string
  injuryTime: number
  halfDurationMinutes: number
  visible: boolean
  matchInitiated: boolean
}

export const DEFAULT_STATE: MatchState = {
  homeName: 'HOME',
  homeAbbr: 'HME',
  homeColor: '#EE2020',
  homeScore: 0,
  awayName: 'AWAY',
  awayAbbr: 'AWY',
  awayColor: '#003DA5',
  awayScore: 0,
  timer: 0,
  timerRunning: false,
  timerStartedAt: null,
  status: 'PRE',
  injuryTime: 0,
  halfDurationMinutes: 20,
  visible: false,
  matchInitiated: false,
}

export const normalizeMatchState = (state: Partial<MatchState>): MatchState => ({
  ...DEFAULT_STATE,
  ...state,
  halfDurationMinutes: state.halfDurationMinutes ?? DEFAULT_STATE.halfDurationMinutes,
})

export const getTimerLimitSeconds = (state: MatchState) => {
  const halfDurationSeconds = Math.max(1, state.halfDurationMinutes) * 60
  const injurySeconds = Math.max(0, state.injuryTime) * 60
  return halfDurationSeconds + injurySeconds
}

export const clampTimerState = (state: Partial<MatchState>): MatchState => {
  const next = normalizeMatchState(state)
  const limit = getTimerLimitSeconds(next)

  if (next.timer >= limit) {
    return { ...next, timer: limit, timerRunning: false, timerStartedAt: null }
  }

  return next
}

export const getCurrentTimestamp = () => new Date().getTime()

export const resolveTimerState = (state: Partial<MatchState>, now = getCurrentTimestamp()): MatchState => {
  const next = clampTimerState(state)

  if (!next.timerRunning || !next.timerStartedAt) return next

  const elapsedSeconds = Math.max(0, Math.floor((now - next.timerStartedAt) / 1000))
  const timer = next.timer + elapsedSeconds
  const limit = getTimerLimitSeconds(next)

  if (timer >= limit) {
    return { ...next, timer: limit, timerRunning: false, timerStartedAt: null }
  }

  return { ...next, timer, timerStartedAt: now }
}

export type BroadcastEvent =
  | { type: 'STATE_UPDATE'; payload: MatchState }
  | { type: 'SCORE_GOAL'; team: 'home' | 'away'; newScore: number }
  | { type: 'SHOW' }
  | { type: 'HIDE' }
