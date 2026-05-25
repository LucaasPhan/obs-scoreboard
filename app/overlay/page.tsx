'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { supabase, CHANNEL_NAME, DEFAULT_STATE, getCurrentTimestamp, getTimerLimitSeconds, resolveTimerState, SUPABASE_CONFIGURED, LOCAL_CHANNEL_KEY, LOCAL_API_PATH, type MatchState, type BroadcastEvent } from '@/lib/supabase'

export default function OverlayPage() {
  const [state, setState] = useState<MatchState>(DEFAULT_STATE)
  const [visible, setVisible] = useState(DEFAULT_STATE.visible)
  const [scoreAnimationIds, setScoreAnimationIds] = useState({ home: 0, away: 0 })
  const [boardAnim, setBoardAnim] = useState<'enter' | 'exit' | 'idle'>('enter')
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const stateRef = useRef(state)
  const hydratedRef = useRef(false)
  const timerCountRef = useRef(state.timer)

  const animateGoal = useCallback((team: 'home' | 'away') => {
    setScoreAnimationIds(prev => ({ ...prev, [team]: prev[team] + 1 }))
  }, [])

  const startLocalTimer = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current)

    timerRef.current = setInterval(() => {
      timerCountRef.current++
      setState(prev => {
        const limit = getTimerLimitSeconds(prev)
        if (timerCountRef.current >= limit) {
          if (timerRef.current) {
            clearInterval(timerRef.current)
            timerRef.current = null
          }
          return { ...prev, timer: limit, timerRunning: false, timerStartedAt: null }
        }
        return { ...prev, timer: timerCountRef.current, timerStartedAt: prev.timerRunning ? getCurrentTimestamp() : prev.timerStartedAt }
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
    setVisible(next.visible)

    if (homeGoal) animateGoal('home')
    if (awayGoal) animateGoal('away')

    timerCountRef.current = next.timer

    if (next.timerRunning && next.timer < getTimerLimitSeconds(next)) {
      if (!timerRef.current) startLocalTimer()
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
    }
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
      const wasVisible = stateRef.current.visible
      if (syncedState) applyState(resolveTimerState(syncedState), false)
      if (!wasVisible) {
        setVisible(true)
        setBoardAnim('enter')
        setTimeout(() => setBoardAnim('idle'), 600)
      }
    } else if (payload.type === 'HIDE') {
      const wasVisible = stateRef.current.visible
      if (syncedState) applyState(resolveTimerState(syncedState), false)
      if (wasVisible) {
        setBoardAnim('exit')
        setTimeout(() => { setVisible(false); setBoardAnim('idle') }, 500)
      }
    }
  }, [animateGoal, applyState])

  // Initial load
  useEffect(() => {
    const load = async () => {
      let dataState: any = null

      if (SUPABASE_CONFIGURED) {
        const { data } = await supabase
          .from('overlay_state')
          .select('state, updated_at')
          .eq('id', 'singleton')
          .single()
        if (data?.state) dataState = data.state
      } else {
        try {
          const res = await fetch(LOCAL_API_PATH)
          const data = await res.json()
          if (data?.state) dataState = data.state
        } catch {}
      }

      if (dataState) {
        applyState(resolveTimerState(dataState as Partial<MatchState>), false)
      }
    }
    load()
  }, [applyState])

  // Listen to channels
  useEffect(() => {
    if (SUPABASE_CONFIGURED) {
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
              applyState(resolveTimerState(next.state))
            }
          }
        )
      channel.subscribe()
      return () => { supabase.removeChannel(channel) }
    } else {
      const bc = new BroadcastChannel(LOCAL_CHANNEL_KEY)
      bc.onmessage = (e) => applyEvent(e.data)

      const apiTimer = setInterval(async () => {
        try {
          const res = await fetch(LOCAL_API_PATH)
          const data = await res.json()
          if (data?.state) {
            applyState(resolveTimerState(data.state), false)
          }
        } catch {}
      }, 1000)

      return () => {
        bc.close()
        clearInterval(apiTimer)
      }
    }
  }, [applyEvent, applyState])

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
          position: fixed;
          inset: 0;
          padding: 48px;
          pointer-events: none;
        }

        @keyframes score-flash {
          0%   { transform: translateY(0)     scale(1);   color: #111111; }
          20%  { transform: translateY(-100%) scale(0.8); color: #EE2020; }
          21%  { transform: translateY(100%)  scale(0.8); color: #EE2020; }
          60%  { transform: translateY(0)     scale(1.3); color: #EE2020; }
          100% { transform: translateY(0)     scale(1);   color: #111111; }
        }
        .anim-exit  { animation: anim-exit  0.4s  ease-in                       forwards; }

        .score-updating { animation: score-flash 0.5s cubic-bezier(0.34,1.56,0.64,1) forwards; }

        /* ── scoreboard shell ── */
        .board {
          display: flex;
          flex-direction: row;
          height: 90px;
          width: fit-content;
          max-width: calc(100vw - 96px);
          filter: drop-shadow(0 10px 26px rgba(0,0,0,0.7));
          white-space: nowrap;
        }

        /* brand stripe */
        .brand {
          width: 60px;
          flex-shrink: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #1a56db;
          background-image: repeating-linear-gradient(
            -45deg,
            transparent, transparent 7px,
            rgba(255,255,255,0.06) 7px, rgba(255,255,255,0.06) 14px
          );
        }

        .brand svg {
          width: 38px;
          height: 38px;
        }

        /* teams panel */
        .teams {
          display: flex;
          flex-direction: column;
          background: #111827;
          width: 300px;
          min-width: 0;
        }

        .team-row {
          display: flex;
          flex: 1;
          align-items: center;
          padding: 0 14px 0 16px;
          gap: 10px;
          position: relative;
          min-width: 0;
        }
        .team-row:first-child { border-bottom: 1px solid rgba(255,255,255,0.07); }

        .team-abbr {
          width: 32px;
          height: 32px;
          flex-shrink: 0;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-family: 'Barlow Condensed', sans-serif;
          font-weight: 900;
          font-size: 11px;
          color: white;
        }

        .team-name {
          font-family: 'Oswald', sans-serif;
          font-weight: 700;
          font-size: 23px;
          color: #ffffff;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .team-accent {
          position: absolute;
          right: 0; top: 0; bottom: 0;
          width: 5px;
        }

        /* scores panel */
        .scores {
          display: flex;
          flex-direction: column;
          background: #f5f5f5;
          width: 64px;
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
          font-size: 42px;
          color: #111;
          line-height: 1;
          display: block;
        }

        /* time panel */
        .timeblock {
          display: flex;
          flex-direction: column;
          background: #111827;
          width: 104px;
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
          font-size: 21px;
          color: #fff;
          letter-spacing: 0.05em;
        }

        .injury-val {
          font-family: 'Oswald', sans-serif;
          font-weight: 700;
          font-size: 13px;
          color: #1a56db;
          margin-top: 2px;
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
          font-size: 16px;
          color: rgba(255,255,255,0.45);
          letter-spacing: 0.06em;
        }

        @media (max-width: 900px), (max-height: 520px) {
          #overlay-root { padding: 24px; }
          .board { height: 72px; max-width: calc(100vw - 48px); }
          .brand { width: 48px; }
          .brand svg { width: 30px; height: 30px; }
          .teams { width: 232px; }
          .team-row { padding: 0 10px 0 12px; gap: 8px; }
          .team-abbr { width: 26px; height: 26px; font-size: 9px; }
          .team-name { font-size: 18px; }
          .team-accent { width: 4px; }
          .scores { width: 52px; }
          .score-val { font-size: 34px; }
          .timeblock { width: 84px; }
          .time-val { font-size: 17px; }
          .injury-val { font-size: 11px; margin-top: 1px; }
          .status-val { font-size: 13px; }
        }
      `}</style>

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
      <div id="overlay-root">
        <div className={`board ${animClass}`}>
          {/* HOME */}
          <div className="team-block home" style={{ '--team-color': state.homeColor } as React.CSSProperties}>
            <div className="team-info">
              <span className="team-name">{state.homeAbbr}</span>
            </div>
            <span className={`score-val ${homeAnim ? 'score-updating' : ''}`}>{state.homeScore}</span>
          </div>

          {/* TIME */}
          <div className="timeblock">
            <span className="time-val">{formatTime(state.timer)}</span>
            <span className="status-val">{state.status}</span>
            {state.injuryTime > 0 && <span className="injury-time">+{state.injuryTime}</span>}
          </div>

          {/* AWAY */}
          <div className="team-block away" style={{ '--team-color': state.awayColor } as React.CSSProperties}>
            <span className={`score-val ${awayAnim ? 'score-updating' : ''}`}>{state.awayScore}</span>
            <div className="team-info" style={{ alignItems: 'flex-end' }}>
              <span className="team-name">{state.awayAbbr}</span>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
