'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { supabase, CHANNEL_NAME, DEFAULT_STATE, type MatchState, type BroadcastEvent } from '@/lib/supabase'

export default function OverlayPage() {
  const [state, setState] = useState<MatchState>(DEFAULT_STATE)
  const [visible, setVisible] = useState(true)
  const [goalTeam, setGoalTeam] = useState<'home' | 'away' | null>(null)
  const [animatingScore, setAnimatingScore] = useState<'home' | 'away' | null>(null)
  const [boardAnim, setBoardAnim] = useState<'enter' | 'exit' | 'idle'>('enter')
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const stateRef = useRef(state)
  stateRef.current = state

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase
        .from('overlay_state')
        .select('state')
        .eq('id', 'singleton')
        .single()
      if (data?.state) {
        const s = data.state as MatchState
        setState(s)
        setVisible(s.visible)
        if (s.timerRunning) startLocalTimer(s.timer)
      }
    }
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const startLocalTimer = useCallback((from: number) => {
    if (timerRef.current) clearInterval(timerRef.current)
    let t = from
    timerRef.current = setInterval(() => {
      t++
      setState(prev => ({ ...prev, timer: t }))
    }, 1000)
  }, [])

  useEffect(() => {
    const channel = supabase.channel(CHANNEL_NAME)
    channel.on('broadcast', { event: 'event' }, ({ payload }: { payload: BroadcastEvent }) => {
      if (payload.type === 'STATE_UPDATE') {
        const s = payload.payload
        setState(s)
        if (s.timerRunning && !stateRef.current.timerRunning) startLocalTimer(s.timer)
        else if (!s.timerRunning && timerRef.current) clearInterval(timerRef.current)
      } else if (payload.type === 'SCORE_GOAL') {
        setState(prev => ({ ...prev, [`${payload.team}Score`]: payload.newScore }))
        setAnimatingScore(payload.team)
        setGoalTeam(payload.team)
        setTimeout(() => setAnimatingScore(null), 600)
        setTimeout(() => setGoalTeam(null), 1200)
      } else if (payload.type === 'SHOW') {
        setVisible(true)
        setBoardAnim('enter')
        setTimeout(() => setBoardAnim('idle'), 600)
      } else if (payload.type === 'HIDE') {
        setBoardAnim('exit')
        setTimeout(() => { setVisible(false); setBoardAnim('idle') }, 500)
      }
    })
    channel.subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [startLocalTimer])

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
        }

        #overlay-root {
          position: absolute;
          top: 20px;
          left: 20px;
        }

        @keyframes anim-enter {
          from { transform: translateX(-110%); opacity: 0; }
          to   { transform: translateX(0);     opacity: 1; }
        }
        @keyframes anim-exit {
          from { transform: translateX(0);     opacity: 1; }
          to   { transform: translateX(-110%); opacity: 0; }
        }
        @keyframes score-flip {
          0%   { transform: translateY(0)     scale(1);    color: #111; }
          20%  { transform: translateY(-110%) scale(0.75); color: #1a56db; }
          21%  { transform: translateY(110%)  scale(0.75); color: #1a56db; }
          65%  { transform: translateY(0)     scale(1.35); color: #1a56db; }
          100% { transform: translateY(0)     scale(1);    color: #111; }
        }
        @keyframes goal-pulse {
          0%, 100% { opacity: 0; }
          15%, 85%  { opacity: 1; }
          50%       { opacity: 0.5; }
        }

        .anim-enter { animation: anim-enter 0.55s cubic-bezier(0.22,1,0.36,1) forwards; }
        .anim-exit  { animation: anim-exit  0.4s  ease-in                       forwards; }

        .score-flip { animation: score-flip 0.55s cubic-bezier(0.34,1.56,0.64,1) forwards; }

        .goal-flash {
          position: fixed;
          inset: 0;
          pointer-events: none;
          background: rgba(26,86,219,0.15);
          animation: goal-pulse 1.1s ease-in-out forwards;
        }

        /* ── scoreboard shell ── */
        .board {
          display: flex;
          flex-direction: row;
          height: 76px;
          filter: drop-shadow(0 6px 22px rgba(0,0,0,0.7));
          white-space: nowrap;
        }

        /* brand stripe */
        .brand {
          width: 50px;
          flex-shrink: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #1a56db;
          background-image: repeating-linear-gradient(
            -45deg,
            transparent, transparent 6px,
            rgba(255,255,255,0.06) 6px, rgba(255,255,255,0.06) 12px
          );
        }

        /* teams panel */
        .teams {
          display: flex;
          flex-direction: column;
          background: #111827;
          min-width: 192px;
        }

        .team-row {
          display: flex;
          flex: 1;
          align-items: center;
          padding: 0 10px 0 12px;
          gap: 8px;
          position: relative;
        }
        .team-row:first-child { border-bottom: 1px solid rgba(255,255,255,0.07); }

        .team-abbr {
          width: 26px;
          height: 26px;
          flex-shrink: 0;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-family: 'Barlow Condensed', sans-serif;
          font-weight: 900;
          font-size: 9px;
          color: white;
        }

        .team-name {
          font-family: 'Oswald', sans-serif;
          font-weight: 700;
          font-size: 17px;
          color: #ffffff;
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }

        .team-accent {
          position: absolute;
          right: 0; top: 0; bottom: 0;
          width: 4px;
        }

        /* scores panel */
        .scores {
          display: flex;
          flex-direction: column;
          background: #f5f5f5;
          min-width: 52px;
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
          font-size: 34px;
          color: #111;
          line-height: 1;
          display: block;
        }

        /* time panel */
        .timeblock {
          display: flex;
          flex-direction: column;
          background: #111827;
          min-width: 74px;
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
          font-size: 15px;
          color: #fff;
          letter-spacing: 0.05em;
        }

        .injury-val {
          font-family: 'Oswald', sans-serif;
          font-weight: 700;
          font-size: 11px;
          color: #1a56db;
          margin-top: 1px;
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
          font-size: 12px;
          color: rgba(255,255,255,0.45);
          letter-spacing: 0.06em;
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
                  <span className={`score-val${animatingScore === team ? ' score-flip' : ''}`}>
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
