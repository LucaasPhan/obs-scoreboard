'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { supabase, CHANNEL_NAME, DEFAULT_STATE, LOCAL_API_PATH, LOCAL_CHANNEL_KEY, LOCAL_EVENT_KEY, SUPABASE_CONFIGURED, getCurrentTimestamp, getTimerLimitSeconds, resolveTimerState, type MatchState, type BroadcastEvent } from '@/lib/supabase'

export default function OverlayPage() {
  const [state, setState] = useState<MatchState>(DEFAULT_STATE)
  const [visible, setVisible] = useState(DEFAULT_STATE.visible)
  const [goalTeam, setGoalTeam] = useState<'home' | 'away' | null>(null)
  const [scoreAnimationIds, setScoreAnimationIds] = useState({ home: 0, away: 0 })
  const [boardAnim, setBoardAnim] = useState<'enter' | 'exit' | 'idle'>('enter')
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const lastUpdatedRef = useRef<string | null>(null)
  const stateRef = useRef(state)
  const hydratedRef = useRef(false)

  const animateGoal = useCallback((team: 'home' | 'away') => {
    setScoreAnimationIds(prev => ({ ...prev, [team]: prev[team] + 1 }))
    setGoalTeam(team)
    setTimeout(() => setGoalTeam(null), 1200)
  }, [])

  const startLocalTimer = useCallback((from: number) => {
    if (timerRef.current) clearInterval(timerRef.current)
    let t = from
    timerRef.current = setInterval(() => {
      t++
      setState(prev => {
        const limit = getTimerLimitSeconds(prev)

        if (t >= limit) {
          if (timerRef.current) {
            clearInterval(timerRef.current)
            timerRef.current = null
          }
          return { ...prev, timer: limit, timerRunning: false, timerStartedAt: null }
        }

        return { ...prev, timer: t, timerStartedAt: prev.timerRunning ? getCurrentTimestamp() : prev.timerStartedAt }
      })
    }, 1000)
  }, [])

  const applyState = useCallback((s: MatchState, animateScoreChanges = true) => {
    const next = resolveTimerState(s)
    const previous = stateRef.current
    const shouldAnimateScores = animateScoreChanges && hydratedRef.current && next.matchInitiated
    const homeGoal = shouldAnimateScores && next.homeScore > previous.homeScore
    const awayGoal = shouldAnimateScores && next.awayScore > previous.awayScore

    setState(next)
    stateRef.current = next
    hydratedRef.current = true
    setVisible(next.matchInitiated && next.visible)

    if (homeGoal) animateGoal('home')
    if (awayGoal) animateGoal('away')

    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }

    if (next.timerRunning && next.timer < getTimerLimitSeconds(next)) startLocalTimer(next.timer)
  }, [animateGoal, startLocalTimer])

  const applyEvent = useCallback((payload: BroadcastEvent, syncedState?: MatchState) => {
    if (payload.type === 'STATE_UPDATE') {
      applyState(payload.payload)
    } else if (payload.type === 'SCORE_GOAL') {
      if (syncedState) {
        applyState(resolveTimerState(syncedState), false)
      } else {
        setState(prev => {
          const next = { ...prev, [`${payload.team}Score`]: payload.newScore }
          stateRef.current = next
          return next
        })
      }
      animateGoal(payload.team)
    } else if (payload.type === 'SHOW') {
      if (syncedState) applyState(resolveTimerState(syncedState), false)
      setVisible(true)
      setBoardAnim('enter')
      setTimeout(() => setBoardAnim('idle'), 600)
    } else if (payload.type === 'HIDE') {
      if (syncedState) applyState(resolveTimerState(syncedState), false)
      setBoardAnim('exit')
      setTimeout(() => { setVisible(false); setBoardAnim('idle') }, 500)
    }
  }, [animateGoal, applyState])

  useEffect(() => {
    const load = async () => {
      if (!SUPABASE_CONFIGURED) {
        try {
          const localResponse = await fetch(LOCAL_API_PATH, { cache: 'no-store' })
          if (localResponse.ok) {
            const localData = await localResponse.json() as { state?: Partial<MatchState>; updatedAt?: number }
            if (localData.state) {
              lastUpdatedRef.current = String(localData.updatedAt ?? getCurrentTimestamp())
              applyState(resolveTimerState(localData.state), false)
              return
            }
          }
        } catch {
          // Local route can be unavailable during early dev-server startup.
        }

        return
      }

      const { data } = await supabase
        .from('overlay_state')
        .select('state, updated_at')
        .eq('id', 'singleton')
        .single()
      if (data?.state) {
        lastUpdatedRef.current = data.updated_at
        applyState(resolveTimerState(data.state as Partial<MatchState>), false)
      }
    }
    load()
  }, [applyState])

  useEffect(() => {
    if (!SUPABASE_CONFIGURED || !state.matchInitiated) return

    const channel = supabase.channel(CHANNEL_NAME)
    channel
      .on('broadcast', { event: 'event' }, ({ payload }: { payload: BroadcastEvent }) => {
        applyEvent(payload)
      })
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'overlay_state', filter: 'id=eq.singleton' },
        (payload) => {
          const next = payload.new as { state?: Partial<MatchState>; updated_at?: string } | null

          if (next?.state) {
            lastUpdatedRef.current = next.updated_at ?? null
            applyState(resolveTimerState(next.state))
          }
        }
      )
    channel.subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [applyEvent, applyState, state.matchInitiated])

  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return

    const localChannel = new BroadcastChannel(LOCAL_CHANNEL_KEY)
    localChannel.onmessage = ({ data }: MessageEvent<{ event: BroadcastEvent; state?: Partial<MatchState> }>) => {
      applyEvent(data.event, data.state ? resolveTimerState(data.state) : undefined)
    }

    return () => localChannel.close()
  }, [applyEvent])

  useEffect(() => {
    const onStorage = (storageEvent: StorageEvent) => {
      if (storageEvent.key !== LOCAL_EVENT_KEY || !storageEvent.newValue) return

      try {
        const message = JSON.parse(storageEvent.newValue) as { event: BroadcastEvent; state?: Partial<MatchState> }
        applyEvent(message.event, message.state ? resolveTimerState(message.state) : undefined)
      } catch {
        // Ignore malformed local events from stale tabs or manual storage edits.
      }
    }

    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [applyEvent])

  useEffect(() => {
    const syncFromDb = async () => {
      if (!SUPABASE_CONFIGURED) {
        try {
          const localResponse = await fetch(LOCAL_API_PATH, { cache: 'no-store' })
          if (localResponse.ok) {
            const localData = await localResponse.json() as { state?: Partial<MatchState>; updatedAt?: number }
            const updatedAt = String(localData.updatedAt ?? '')

            if (localData.state && updatedAt && updatedAt !== lastUpdatedRef.current) {
              lastUpdatedRef.current = updatedAt
              applyState(resolveTimerState(localData.state))
            }
          }
        } catch {
          // Local route can be unavailable during early dev-server startup.
        }

        return
      }

      const { data } = await supabase
        .from('overlay_state')
        .select('state, updated_at')
        .eq('id', 'singleton')
        .single()

      if (data?.state && data.updated_at !== lastUpdatedRef.current) {
        lastUpdatedRef.current = data.updated_at
        applyState(resolveTimerState(data.state as Partial<MatchState>))
      }
    }

    const poll = setInterval(syncFromDb, state.matchInitiated ? (SUPABASE_CONFIGURED ? 10000 : 250) : 1000)
    return () => clearInterval(poll)
  }, [applyState, state.matchInitiated])

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60)
    const s = secs % 60
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }

  const animClass = boardAnim === 'enter' ? 'anim-enter' : boardAnim === 'exit' ? 'anim-exit' : ''

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Oswald:wght@700&family=Barlow+Condensed:wght@400;700;900&display=swap');

        *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }

        html, body {
          background: transparent !important;
          width: 100%;
          height: 100%;
          overflow: hidden;
          text-rendering: geometricPrecision;
          -webkit-font-smoothing: antialiased;
        }

        #overlay-root {
          position: absolute;
          inset: 0;
          padding: 32px;
          pointer-events: none;
        }

        @keyframes anim-enter {
          from { transform: translateX(-110%); opacity: 0; }
          to   { transform: translateX(0);     opacity: 1; }
        }
        @keyframes anim-exit {
          from { transform: translateX(0);     opacity: 1; }
          to   { transform: translateX(-110%); opacity: 0; }
        }
        @keyframes score-flash {
          0%   { transform: translateY(0)     scale(1);   color: #111111; }
          20%  { transform: translateY(-100%) scale(0.8); color: #EE2020; }
          21%  { transform: translateY(100%)  scale(0.8); color: #EE2020; }
          60%  { transform: translateY(0)     scale(1.3); color: #EE2020; }
          100% { transform: translateY(0)     scale(1);   color: #111111; }
        }
        @keyframes goal-pulse {
          0%, 100% { opacity: 0; }
          10%, 90%  { opacity: 1; }
          50%       { opacity: 0.7; }
        }

        .anim-enter { animation: anim-enter 0.55s cubic-bezier(0.22,1,0.36,1) forwards; }
        .anim-exit  { animation: anim-exit  0.4s  ease-in                       forwards; }

        .score-updating { animation: score-flash 0.5s cubic-bezier(0.34,1.56,0.64,1) forwards; }

        .goal-flash {
          position: fixed;
          inset: 0;
          pointer-events: none;
          background: rgba(238,32,32,0.15);
          animation: goal-pulse 1s ease-in-out forwards;
        }

        /* ── scoreboard shell ── */
        .board {
          display: flex;
          flex-direction: row;
          height: 132px;
          width: fit-content;
          filter: drop-shadow(0 12px 34px rgba(0,0,0,0.72));
          white-space: nowrap;
        }

        /* brand stripe */
        .brand {
          width: 88px;
          flex-shrink: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #1a56db;
          background-image: repeating-linear-gradient(
            -45deg,
            transparent, transparent 10px,
            rgba(255,255,255,0.06) 10px, rgba(255,255,255,0.06) 20px
          );
        }

        .brand svg {
          width: 56px;
          height: 56px;
        }

        /* teams panel */
        .teams {
          display: flex;
          flex-direction: column;
          background: #111827;
          width: 368px;
        }

        .team-row {
          display: flex;
          flex: 1;
          align-items: center;
          padding: 0 18px 0 20px;
          gap: 14px;
          position: relative;
        }
        .team-row:first-child { border-bottom: 1px solid rgba(255,255,255,0.07); }

        .team-abbr {
          width: 44px;
          height: 44px;
          flex-shrink: 0;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-family: 'Barlow Condensed', sans-serif;
          font-weight: 900;
          font-size: 15px;
          color: white;
        }

        .team-name {
          font-family: 'Oswald', sans-serif;
          font-weight: 700;
          font-size: 32px;
          color: #ffffff;
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }

        .team-accent {
          position: absolute;
          right: 0; top: 0; bottom: 0;
          width: 7px;
        }

        /* scores panel */
        .scores {
          display: flex;
          flex-direction: column;
          background: #f5f5f5;
          width: 92px;
          flex-shrink: 0;
        }

        .score-cell {
          display: flex;
          flex: 1;
          align-items: center;
          justify-content: center;
          overflow: hidden;
        }
        .score-cell:first-child { border-bottom: 1px solid #ddd; }

        .score-val {
          font-family: 'Oswald', sans-serif;
          font-weight: 700;
          font-size: 62px;
          color: #111;
          line-height: 1;
          display: block;
        }

        /* time panel */
        .timeblock {
          display: flex;
          flex-direction: column;
          background: #111827;
          width: 138px;
          flex-shrink: 0;
        }

        .time-top {
          display: flex;
          flex-direction: column;
          flex: 1;
          align-items: center;
          justify-content: center;
          border-bottom: 1px solid rgba(255,255,255,0.07);
        }

        .time-val {
          font-family: 'Oswald', sans-serif;
          font-weight: 700;
          font-size: 28px;
          color: #fff;
          letter-spacing: 0.05em;
        }

        .injury-val {
          font-family: 'Oswald', sans-serif;
          font-weight: 700;
          font-size: 18px;
          color: #1a56db;
          margin-top: 3px;
        }

        .time-bottom {
          display: flex;
          flex: 1;
          align-items: center;
          justify-content: center;
        }

        .status-val {
          font-family: 'Oswald', sans-serif;
          font-weight: 700;
          font-size: 22px;
          color: rgba(255,255,255,0.45);
          letter-spacing: 0.06em;
        }

        @media (max-width: 900px), (max-height: 520px) {
          #overlay-root { padding: 20px; }
          .board { height: 92px; }
          .brand { width: 64px; }
          .brand svg { width: 40px; height: 40px; }
          .teams { width: 260px; }
          .team-row { padding: 0 12px 0 14px; gap: 10px; }
          .team-abbr { width: 32px; height: 32px; font-size: 11px; }
          .team-name { font-size: 22px; }
          .team-accent { width: 5px; }
          .scores { width: 66px; }
          .score-val { font-size: 43px; }
          .timeblock { width: 98px; }
          .time-val { font-size: 20px; }
          .injury-val { font-size: 13px; margin-top: 2px; }
          .status-val { font-size: 15px; }
        }
      `}</style>

      {goalTeam && <div className="goal-flash" />}

      {visible && (
        <div id="overlay-root">
          <div className={`board ${animClass}`}>

            {/* Brand */}
            <div className="brand">
              <svg viewBox="0 0 40 40" fill="none" width="28" height="28">
                <rect x="2" y="2" width="36" height="36" rx="4" fill="rgba(255,255,255,0.1)"/>
                <text x="5" y="30"
                  fontFamily="'Arial Black','Helvetica Neue',sans-serif"
                  fontWeight="900"
                  fontStyle="italic"
                  fontSize="22"
                  letterSpacing="-1"
                  fill="white">VS</text>
              </svg>
            </div>

            {/* Teams */}
            <div className="teams">
              {(['home', 'away'] as const).map(team => (
                <div key={team} className="team-row">
                  <div className="team-abbr" style={{
                    background: state[`${team}Color`] + '44',
                    border: `2px solid ${state[`${team}Color`]}88`,
                  }}>
                    {state[`${team}Abbr`].slice(0, 3)}
                  </div>
                  <span className="team-name">{state[`${team}Name`]}</span>
                  <div className="team-accent" style={{ background: state[`${team}Color`] }} />
                </div>
              ))}
            </div>

            {/* Scores */}
            <div className="scores">
              {(['home', 'away'] as const).map(team => (
                <div key={team} className="score-cell">
                  <span key={`${team}-${scoreAnimationIds[team]}`} className={`score-val${scoreAnimationIds[team] > 0 ? ' score-updating' : ''}`}>
                    {state[`${team}Score`]}
                  </span>
                </div>
              ))}
            </div>

            {/* Time */}
            <div className="timeblock">
              <div className="time-top">
                <span className="time-val">{formatTime(state.timer)}</span>
                {state.injuryTime > 0 && (
                  <span className="injury-val">+{state.injuryTime}</span>
                )}
              </div>
              <div className="time-bottom">
                <span className="status-val">{state.status}</span>
              </div>
            </div>

          </div>
        </div>
      )}
    </>
  )
}
