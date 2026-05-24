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

  // Load persisted state on mount
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

  // Subscribe to broadcast
  useEffect(() => {
    const channel = supabase.channel(CHANNEL_NAME)

    channel.on('broadcast', { event: 'event' }, ({ payload }: { payload: BroadcastEvent }) => {
      if (payload.type === 'STATE_UPDATE') {
        const s = payload.payload
        setState(s)
        if (s.timerRunning && !stateRef.current.timerRunning) {
          startLocalTimer(s.timer)
        } else if (!s.timerRunning) {
          if (timerRef.current) clearInterval(timerRef.current)
        }
      } else if (payload.type === 'SCORE_GOAL') {
        setState(prev => ({
          ...prev,
          [`${payload.team}Score`]: payload.newScore,
        }))
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

  const boardClass = boardAnim === 'enter'
    ? 'animate-slide-in'
    : boardAnim === 'exit'
      ? 'animate-slide-out'
      : ''

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Oswald:wght@700&family=Barlow+Condensed:wght@400;700;900&display=swap');

        * { margin: 0; padding: 0; box-sizing: border-box; }

        body {
          background: transparent !important;
          font-family: 'Barlow Condensed', sans-serif;
        }

        @keyframes slide-in {
          from { transform: translateX(-120%); opacity: 0; }
          to   { transform: translateX(0);     opacity: 1; }
        }
        @keyframes slide-out {
          from { transform: translateX(0);     opacity: 1; }
          to   { transform: translateX(-120%); opacity: 0; }
        }
        @keyframes score-flip {
          0%   { transform: translateY(0) scale(1);    color: #111; }
          20%  { transform: translateY(-100%) scale(0.8); color: #EE2020; }
          21%  { transform: translateY(100%)  scale(0.8); color: #EE2020; }
          65%  { transform: translateY(0) scale(1.35); color: #EE2020; }
          100% { transform: translateY(0) scale(1);    color: #111; }
        }
        @keyframes goal-pulse {
          0%, 100% { opacity: 0; }
          15%, 85%  { opacity: 1; }
          50%       { opacity: 0.6; }
        }

        .animate-slide-in  { animation: slide-in  0.55s cubic-bezier(0.22,1,0.36,1) forwards; }
        .animate-slide-out { animation: slide-out 0.4s ease-in forwards; }
        .score-flip        { animation: score-flip 0.55s cubic-bezier(0.34,1.56,0.64,1) forwards; }
        .goal-pulse        { animation: goal-pulse 1.1s ease-in-out forwards; }

        .oswald { font-family: 'Oswald', sans-serif; font-weight: 700; }
        .barlow { font-family: 'Barlow Condensed', sans-serif; }
      `}</style>

      {/* Goal flash */}
      {goalTeam && (
        <div
          className="goal-pulse fixed inset-0 pointer-events-none z-50"
          style={{ background: 'rgba(238,32,32,0.18)' }}
        />
      )}

      {visible && (
        <div className={`fixed top-5 left-5 ${boardClass}`} style={{ filter: 'drop-shadow(0 6px 20px rgba(0,0,0,0.65))' }}>
          <div className="flex" style={{ height: 78 }}>

            {/* Brand stripe */}
            <div className="flex items-center justify-center flex-shrink-0" style={{
              width: 52, background: '#EE2020',
              backgroundImage: 'repeating-linear-gradient(-45deg,transparent,transparent 6px,rgba(255,255,255,0.05) 6px,rgba(255,255,255,0.05) 12px)'
            }}>
              <svg viewBox="0 0 40 40" fill="none" width="30" height="30">
                <path d="M8 28 L20 8 L28 8 L16 24 L30 24 L30 32 L22 32 L22 24 L8 28Z" fill="white"/>
              </svg>
            </div>

            {/* Teams */}
            <div className="flex flex-col" style={{ background: '#1A1A2E', minWidth: 190 }}>
              {(['home', 'away'] as const).map((team, i) => (
                <div key={team} className="flex items-center flex-1 gap-2 px-3 relative"
                  style={{ borderBottom: i === 0 ? '1px solid rgba(255,255,255,0.07)' : 'none' }}>
                  <div className="flex items-center justify-center flex-shrink-0 rounded-full text-white font-black"
                    style={{
                      width: 26, height: 26, fontSize: 9,
                      background: state[`${team}Color`] + '55',
                      border: `2px solid ${state[`${team}Color`]}99`,
                      fontFamily: 'Barlow Condensed, sans-serif',
                    }}>
                    {state[`${team}Abbr`].slice(0, 3)}
                  </div>
                  <span className="oswald text-white uppercase tracking-wide"
                    style={{ fontSize: 17, letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>
                    {state[`${team}Name`]}
                  </span>
                  {/* color accent */}
                  <div className="absolute right-0 top-0 bottom-0" style={{ width: 4, background: state[`${team}Color`] }} />
                </div>
              ))}
            </div>

            {/* Scores */}
            <div className="flex flex-col" style={{ background: '#F5F5F5', minWidth: 52 }}>
              {(['home', 'away'] as const).map((team, i) => (
                <div key={team} className="flex items-center justify-center flex-1 overflow-hidden"
                  style={{ borderBottom: i === 0 ? '1px solid #DDD' : 'none' }}>
                  <span
                    className={`oswald ${animatingScore === team ? 'score-flip' : ''}`}
                    style={{ fontSize: 34, color: '#111', lineHeight: 1 }}>
                    {state[`${team}Score`]}
                  </span>
                </div>
              ))}
            </div>

            {/* Time + Status */}
            <div className="flex flex-col" style={{ background: '#1A1A2E', minWidth: 72 }}>
              <div className="flex flex-col items-center justify-center flex-1"
                style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
                <span className="oswald text-white" style={{ fontSize: 15, letterSpacing: '0.05em' }}>
                  {formatTime(state.timer)}
                </span>
                {state.injuryTime > 0 && (
                  <span className="oswald" style={{ fontSize: 11, color: '#EE2020', marginTop: 1 }}>
                    +{state.injuryTime}
                  </span>
                )}
              </div>
              <div className="flex items-center justify-center flex-1">
                <span className="oswald" style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', letterSpacing: '0.06em' }}>
                  {state.status}
                </span>
              </div>
            </div>

          </div>
        </div>
      )}
    </>
  )
}
