import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://placeholder.supabase.co'
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'placeholder'

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
  status: string
  injuryTime: number
  visible: boolean
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
  status: 'PRE',
  injuryTime: 0,
  visible: true,
}

export type BroadcastEvent =
  | { type: 'STATE_UPDATE'; payload: MatchState }
  | { type: 'SCORE_GOAL'; team: 'home' | 'away'; newScore: number }
  | { type: 'SHOW' }
  | { type: 'HIDE' }
