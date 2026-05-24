'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  BASKETBALL_CHANNEL_NAME,
  BASKETBALL_LOCAL_API_PATH,
  BASKETBALL_LOCAL_CHANNEL_KEY,
  BASKETBALL_LOCAL_EVENT_KEY,
  BASKETBALL_STATE_ID,
  BASKETBALL_SUPABASE_CONFIGURED,
  DEFAULT_BASKETBALL_STATE,
  basketballSupabase,
  getCurrentTimestamp,
  resolveBasketballClock,
  type BasketballEvent,
  type BasketballState,
} from '@/lib/basketball'

export default function BasketballOverlayPage() {
  const [state, setState] = useState<BasketballState>(DEFAULT_BASKETBALL_STATE)
  const [visible, setVisible] = useState(DEFAULT_BASKETBALL_STATE.visible)
  const [scoreAnimationIds, setScoreAnimationIds] = useState({ home: 0, away: 0 })
  const [boardAnim, setBoardAnim] = useState<'enter' | 'exit' | 'idle'>('enter')
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const lastUpdatedRef = useRef<string | null>(null)
  const stateRef = useRef(state)
  const hydratedRef = useRef(false)

  const animateScore = useCallback((team: 'home' | 'away') => {
    setScoreAnimationIds(prev => ({ ...prev, [team]: prev[team] + 1 }))
  }, [])

  const startLocalClock = useCallback((from: number) => {
    if (timerRef.current) clearInterval(timerRef.current)
    let t = from

    timerRef.current = setInterval(() => {
      t--
      setState(prev => {
        if (t <= 0) {
          if (timerRef.current) {
            clearInterval(timerRef.current)
            timerRef.current = null
          }
          return { ...prev, clock: 0, clockRunning: false, clockStartedAt: null }
        }

        return { ...prev, clock: t, clockStartedAt: prev.clockRunning ? getCurrentTimestamp() : prev.clockStartedAt }
      })
    }, 1000)
  }, [])

  const applyState = useCallback((incoming: BasketballState, animateScoreChanges = true) => {
    const next = resolveBasketballClock(incoming)
    const previous = stateRef.current
    const canAnimate = animateScoreChanges && hydratedRef.current && next.gameInitiated
    const homeScored = canAnimate && next.homeScore > previous.homeScore
    const awayScored = canAnimate && next.awayScore > previous.awayScore

    setState(next)
    stateRef.current = next
    hydratedRef.current = true
    setVisible(next.gameInitiated && next.visible)

    if (homeScored) animateScore('home')
    if (awayScored) animateScore('away')

    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }

    if (next.clockRunning && next.clock > 0) startLocalClock(next.clock)
  }, [animateScore, startLocalClock])

  const applyEvent = useCallback((event: BasketballEvent, syncedState?: BasketballState) => {
    if (event.type === 'STATE_UPDATE') {
      applyState(event.payload)
    } else if (event.type === 'SCORE') {
      if (syncedState) {
        applyState(resolveBasketballClock(syncedState), false)
      } else {
        setState(prev => {
          const next = { ...prev, [`${event.team}Score`]: event.newScore }
          stateRef.current = next
          return next
        })
      }
      animateScore(event.team)
    } else if (event.type === 'SHOW') {
      if (syncedState) applyState(resolveBasketballClock(syncedState), false)
      setVisible(true)
      setBoardAnim('enter')
      setTimeout(() => setBoardAnim('idle'), 450)
    } else if (event.type === 'HIDE') {
      if (syncedState) applyState(resolveBasketballClock(syncedState), false)
      setBoardAnim('exit')
      setTimeout(() => { setVisible(false); setBoardAnim('idle') }, 350)
    }
  }, [animateScore, applyState])

  useEffect(() => {
    const load = async () => {
      if (!BASKETBALL_SUPABASE_CONFIGURED) {
        try {
          const response = await fetch(BASKETBALL_LOCAL_API_PATH, { cache: 'no-store' })
          if (response.ok) {
            const data = await response.json() as { state?: Partial<BasketballState>; updatedAt?: number }
            if (data.state) {
              lastUpdatedRef.current = String(data.updatedAt ?? getCurrentTimestamp())
              applyState(resolveBasketballClock(data.state), false)
              return
            }
          }
        } catch {
          // Ignore local route startup races.
        }

        return
      }

      const { data } = await basketballSupabase
        .from('overlay_state')
        .select('state, updated_at')
        .eq('id', BASKETBALL_STATE_ID)
        .single()

      if (data?.state) {
        lastUpdatedRef.current = data.updated_at
        applyState(resolveBasketballClock(data.state as Partial<BasketballState>), false)
      }
    }

    load()
  }, [applyState])

  useEffect(() => {
    if (!BASKETBALL_SUPABASE_CONFIGURED || !state.gameInitiated) return

    const channel = basketballSupabase.channel(BASKETBALL_CHANNEL_NAME)
    channel
      .on('broadcast', { event: 'event' }, ({ payload }: { payload: BasketballEvent }) => {
        applyEvent(payload)
      })
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'overlay_state', filter: `id=eq.${BASKETBALL_STATE_ID}` },
        (payload) => {
          const next = payload.new as { state?: Partial<BasketballState>; updated_at?: string } | null

          if (next?.state) {
            lastUpdatedRef.current = next.updated_at ?? null
            applyState(resolveBasketballClock(next.state))
          }
        }
      )
    channel.subscribe()

    return () => { basketballSupabase.removeChannel(channel) }
  }, [applyEvent, applyState, state.gameInitiated])

  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return

    const localChannel = new BroadcastChannel(BASKETBALL_LOCAL_CHANNEL_KEY)
    localChannel.onmessage = ({ data }: MessageEvent<{ event: BasketballEvent; state?: Partial<BasketballState> }>) => {
      applyEvent(data.event, data.state ? resolveBasketballClock(data.state) : undefined)
    }

    return () => localChannel.close()
  }, [applyEvent])

  useEffect(() => {
    const onStorage = (storageEvent: StorageEvent) => {
      if (storageEvent.key !== BASKETBALL_LOCAL_EVENT_KEY || !storageEvent.newValue) return

      try {
        const message = JSON.parse(storageEvent.newValue) as { event: BasketballEvent; state?: Partial<BasketballState> }
        applyEvent(message.event, message.state ? resolveBasketballClock(message.state) : undefined)
      } catch {
        // Ignore stale or malformed events.
      }
    }

    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [applyEvent])

  useEffect(() => {
    const syncState = async () => {
      if (!BASKETBALL_SUPABASE_CONFIGURED) {
        try {
          const response = await fetch(BASKETBALL_LOCAL_API_PATH, { cache: 'no-store' })
          if (response.ok) {
            const data = await response.json() as { state?: Partial<BasketballState>; updatedAt?: number }
            const updatedAt = String(data.updatedAt ?? '')

            if (data.state && updatedAt && updatedAt !== lastUpdatedRef.current) {
              lastUpdatedRef.current = updatedAt
              applyState(resolveBasketballClock(data.state))
            }
          }
        } catch {
          // Ignore transient local API misses.
        }

        return
      }

      const { data } = await basketballSupabase
        .from('overlay_state')
        .select('state, updated_at')
        .eq('id', BASKETBALL_STATE_ID)
        .single()

      if (data?.state && data.updated_at !== lastUpdatedRef.current) {
        lastUpdatedRef.current = data.updated_at
        applyState(resolveBasketballClock(data.state as Partial<BasketballState>))
      }
    }

    const poll = setInterval(syncState, state.gameInitiated ? (BASKETBALL_SUPABASE_CONFIGURED ? 10000 : 250) : 1000)
    return () => clearInterval(poll)
  }, [applyState, state.gameInitiated])

  const formatClock = (secs: number) => {
    const m = Math.floor(secs / 60)
    const s = secs % 60
    return `${m}:${String(s).padStart(2, '0')}`
  }

  const periodLabel = state.period > 4 ? `OT${state.period - 4}` : `${state.period}Q`
  const animClass = boardAnim === 'enter' ? 'scorebug-enter' : boardAnim === 'exit' ? 'scorebug-exit' : ''

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@600;800;900&display=swap');

        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        html, body {
          width: 100%;
          height: 100%;
          overflow: hidden;
          background: transparent !important;
          -webkit-font-smoothing: antialiased;
          text-rendering: geometricPrecision;
        }

        #basketball-overlay-root {
          position: fixed;
          inset: 0;
          pointer-events: none;
          padding: 0 48px 52px;
          display: flex;
          align-items: flex-end;
          justify-content: center;
        }

        @keyframes scorebug-enter {
          from { transform: translateY(120%); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }

        @keyframes scorebug-exit {
          from { transform: translateY(0); opacity: 1; }
          to { transform: translateY(120%); opacity: 0; }
        }

        @keyframes score-pop {
          0% { transform: translateY(0) scale(1); }
          35% { transform: translateY(-12%) scale(1.18); color: #F5D76E; }
          100% { transform: translateY(0) scale(1); }
        }

        .scorebug {
          height: 86px;
          display: flex;
          align-items: stretch;
          filter: drop-shadow(0 12px 28px rgba(0,0,0,.72));
          font-family: Inter, Arial, sans-serif;
          max-width: calc(100vw - 96px);
        }

        .scorebug-enter { animation: scorebug-enter .42s cubic-bezier(.22,1,.36,1) forwards; }
        .scorebug-exit { animation: scorebug-exit .32s ease-in forwards; }

        .league-mark {
          width: 48px;
          background: linear-gradient(180deg,#17408B 0 50%,#C9082A 50%);
          color: white;
          display: grid;
          place-items: center;
          font-weight: 900;
          font-size: 18px;
          letter-spacing: -.03em;
        }

        .team-block {
          width: 212px;
          display: grid;
          grid-template-columns: 1fr 74px;
          color: white;
          border-right: 1px solid rgba(255,255,255,.18);
        }

        .team-meta {
          min-width: 0;
          display: flex;
          flex-direction: column;
          justify-content: center;
          padding: 0 14px;
          background: rgba(0,0,0,.2);
        }

        .team-name {
          font-size: 13px;
          font-weight: 900;
          letter-spacing: .08em;
          text-transform: uppercase;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .team-flags {
          display: flex;
          align-items: center;
          gap: 8px;
          min-height: 16px;
          margin-top: 6px;
          font-size: 10px;
          font-weight: 900;
          letter-spacing: .1em;
        }

        .possession {
          color: #F5D76E;
          font-size: 13px;
        }

        .bonus {
          color: rgba(255,255,255,.84);
        }

        .team-score {
          display: grid;
          place-items: center;
          background: rgba(0,0,0,.34);
          font-size: 43px;
          font-weight: 900;
          line-height: 1;
          overflow: hidden;
        }

        .score-pop {
          animation: score-pop .42s cubic-bezier(.34,1.56,.64,1) forwards;
        }

        .game-block {
          width: 180px;
          display: grid;
          grid-template-rows: 1fr 30px;
          background: #F5F3EE;
          color: #05070B;
        }

        .clock-line {
          display: grid;
          grid-template-columns: 1fr 54px;
          align-items: center;
        }

        .clock {
          text-align: center;
          font-size: 34px;
          font-weight: 900;
          letter-spacing: -.04em;
          font-variant-numeric: tabular-nums;
        }

        .shot {
          height: 100%;
          display: grid;
          place-items: center;
          background: #05070B;
          color: #F5D76E;
          font-size: 27px;
          font-weight: 900;
          font-variant-numeric: tabular-nums;
        }

        .period-line {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 12px;
          border-top: 1px solid #D4D1CA;
          font-size: 12px;
          font-weight: 900;
          letter-spacing: .12em;
        }

        @media (max-width: 900px), (max-height: 520px) {
          #basketball-overlay-root { padding: 0 24px 24px; }
          .scorebug { height: 66px; max-width: calc(100vw - 48px); }
          .league-mark { width: 36px; font-size: 14px; }
          .team-block { width: 150px; grid-template-columns: 1fr 52px; }
          .team-meta { padding: 0 10px; }
          .team-name { font-size: 10px; }
          .team-flags { margin-top: 4px; font-size: 8px; gap: 5px; }
          .possession { font-size: 10px; }
          .team-score { font-size: 31px; }
          .game-block { width: 132px; grid-template-rows: 1fr 23px; }
          .clock-line { grid-template-columns: 1fr 40px; }
          .clock { font-size: 24px; }
          .shot { font-size: 20px; }
          .period-line { font-size: 9px; gap: 8px; }
        }
      `}</style>

      {visible && (
        <div id="basketball-overlay-root">
          <div className={`scorebug ${animClass}`}>
            <div className="league-mark">NBA</div>

            {(['away', 'home'] as const).map(team => (
              <div key={team} className="team-block" style={{ background: state[`${team}Color`] }}>
                <div className="team-meta">
                  <div className="team-name">{state[`${team}Abbr`]} {state[`${team}Name`]}</div>
                  <div className="team-flags">
                    {state.possession === team && <span className="possession">●</span>}
                    {state[`${team}Bonus`] && <span className="bonus">BONUS</span>}
                  </div>
                </div>
                <div className="team-score">
                  <span key={`${team}-${scoreAnimationIds[team]}`} className={scoreAnimationIds[team] > 0 ? 'score-pop' : ''}>
                    {state[`${team}Score`]}
                  </span>
                </div>
              </div>
            ))}

            <div className="game-block">
              <div className="clock-line">
                <div className="clock">{formatClock(state.clock)}</div>
                <div className="shot">{state.shotClock}</div>
              </div>
              <div className="period-line">
                <span>{periodLabel}</span>
                <span>{state.clockRunning ? 'LIVE' : 'STOP'}</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
