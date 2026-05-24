'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { supabase, CHANNEL_NAME, DEFAULT_STATE, type MatchState, type BroadcastEvent } from '@/lib/supabase'

const STATUSES = ['PRE', '1H', 'HT', '2H', 'ET', 'PEN', 'FT']

export default function ControlPage() {
  const [state, setState] = useState<MatchState>(DEFAULT_STATE)
  const [connected, setConnected] = useState(false)
  const [toast, setToast] = useState('')
  const [toastVisible, setToastVisible] = useState(false)
  const [savingTimer, setSavingTimer] = useState(false)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)
  const connectedRef = useRef(false)
  const stateRef = useRef(state)
  stateRef.current = state

  // Load state on mount
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
        if (s.timerRunning) startLocalTimer(s.timer)
      }
    }
    load()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Setup broadcast channel
  useEffect(() => {
    const ch = supabase.channel(CHANNEL_NAME)
    ch.subscribe((status) => {
      const isSubscribed = status === 'SUBSCRIBED'
      connectedRef.current = isSubscribed
      setConnected(isSubscribed)
    })
    channelRef.current = ch
    return () => {
      connectedRef.current = false
      supabase.removeChannel(ch)
    }
  }, [])

  const startLocalTimer = useCallback((from: number) => {
    if (timerRef.current) clearInterval(timerRef.current)
    let t = from
    timerRef.current = setInterval(() => {
      t++
      setState(prev => ({ ...prev, timer: t }))
    }, 1000)
  }, [])

  const showToast = (msg: string) => {
    setToast(msg)
    setToastVisible(true)
    setTimeout(() => setToastVisible(false), 2200)
  }

  const broadcast = useCallback(async (event: BroadcastEvent, newState?: MatchState) => {
    const s = newState ?? stateRef.current
    const channel = channelRef.current

    try {
      if (channel && connectedRef.current) {
        await channel.send({ type: 'broadcast', event: 'event', payload: event })
      } else {
        await channel?.httpSend('event', event)
      }
    } catch (error) {
      console.warn('Realtime broadcast failed; persisted state will still update.', error)
    }

    try {
      setSavingTimer(true)
      await supabase.from('overlay_state').upsert({ id: 'singleton', state: s, updated_at: new Date().toISOString() })
    } finally {
      setSavingTimer(false)
    }
  }, [])

  const updateState = useCallback((patch: Partial<MatchState>, broadcastEvent?: BroadcastEvent) => {
    setState(prev => {
      const next = { ...prev, ...patch }
      const event = broadcastEvent ?? { type: 'STATE_UPDATE', payload: next }
      broadcast(event, next)
      return next
    })
  }, [broadcast])

  // Score
  const adjustScore = (team: 'home' | 'away', delta: number) => {
    const key = `${team}Score` as 'homeScore' | 'awayScore'
    const newScore = Math.max(0, stateRef.current[key] + delta)
    const patch = { [key]: newScore } as Partial<MatchState>
    const next = { ...stateRef.current, ...patch }
    setState(next)
    const event: BroadcastEvent = delta > 0
      ? { type: 'SCORE_GOAL', team, newScore }
      : { type: 'STATE_UPDATE', payload: next }
    broadcast(event, next)
    if (delta > 0) showToast(`⚽ GOAL! ${stateRef.current[`${team}Name`].toUpperCase()} ${newScore}`)
  }

  // Timer
  const timerStart = () => {
    if (stateRef.current.timerRunning) return
    startLocalTimer(stateRef.current.timer)
    updateState({ timerRunning: true })
    showToast('▶ TIMER STARTED')
  }

  const timerPause = () => {
    if (timerRef.current) clearInterval(timerRef.current)
    updateState({ timerRunning: false })
    showToast('⏸ TIMER PAUSED')
  }

  const timerReset = () => {
    if (timerRef.current) clearInterval(timerRef.current)
    updateState({ timer: 0, timerRunning: false })
    showToast('↺ TIMER RESET')
  }

  const timerJump = (mins: number) => {
    const secs = mins * 60
    setState(prev => ({ ...prev, timer: secs }))
    if (stateRef.current.timerRunning) startLocalTimer(secs)
    const next = { ...stateRef.current, timer: secs }
    broadcast({ type: 'STATE_UPDATE', payload: next }, next)
    showToast(`⏱ JUMPED TO ${mins}:00`)
  }

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60)
    const s = secs % 60
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }

  const setStatus = (s: string) => {
    updateState({ status: s })
    if (s === '1H' && !stateRef.current.timerRunning) timerStart()
    if (s === 'HT' || s === 'FT') {
      if (timerRef.current) clearInterval(timerRef.current)
      updateState({ status: s, timerRunning: false })
    }
    showToast(`STATUS → ${s}`)
  }

  const showOverlay = () => {
    updateState({ visible: true }, { type: 'SHOW' })
    broadcast({ type: 'SHOW' })
    showToast('▶ OVERLAY SHOWN')
  }

  const hideOverlay = () => {
    updateState({ visible: false }, { type: 'HIDE' })
    broadcast({ type: 'HIDE' })
    showToast('■ OVERLAY HIDDEN')
  }

  const resetAll = () => {
    if (timerRef.current) clearInterval(timerRef.current)
    const next: MatchState = { ...stateRef.current, homeScore: 0, awayScore: 0, timer: 0, timerRunning: false, injuryTime: 0 }
    setState(next)
    broadcast({ type: 'STATE_UPDATE', payload: next }, next)
    showToast('↺ MATCH RESET')
  }

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Oswald:wght@400;600;700&family=Barlow+Condensed:wght@400;500;600&display=swap');
        :root {
          --brand: #1a56db; --dark: #0F0F1A; --panel: #181828;
          --card: #1E1E30; --border: #2A2A42; --text: #E8E8F0;
          --muted: #7A7A9A; --green: #22C55E; --yellow: #F59E0B;
        }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: var(--dark); color: var(--text); font-family: 'Barlow Condensed', sans-serif; min-height: 100vh; }
        .oswald { font-family: 'Oswald', sans-serif; }

        /* Scrollbar */
        ::-webkit-scrollbar { width: 6px; } 
        ::-webkit-scrollbar-track { background: var(--dark); }
        ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }

        input[type=text], input[type=number] {
          width: 100%; background: #11111F; border: 1px solid var(--border);
          color: var(--text); border-radius: 6px; padding: 8px 10px;
          font-family: 'Barlow Condensed', sans-serif; font-size: 15px;
          outline: none; transition: border-color 0.2s;
        }
        input:focus { border-color: var(--brand); }
        input[type=color] {
          width: 36px; height: 36px; border: none; border-radius: 6px;
          cursor: pointer; padding: 2px; background: #11111F; flex-shrink: 0;
        }
        select {
          width: 100%; background: #11111F; border: 1px solid var(--border);
          color: var(--text); border-radius: 6px; padding: 8px 10px;
          font-family: 'Barlow Condensed', sans-serif; font-size: 15px; outline: none;
        }

        @keyframes toast-in  { from { transform: translateY(60px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
        @keyframes toast-out { from { transform: translateY(0); opacity: 1; } to { transform: translateY(60px); opacity: 0; } }
        @keyframes pulse-dot { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }
        @keyframes score-bounce { 0%,100% { transform: scale(1); } 50% { transform: scale(1.4); color: var(--brand); } }
      `}</style>

      {/* Header */}
      <header style={{ background: 'var(--panel)', borderBottom: '2px solid var(--brand)', padding: '12px 20px', display: 'flex', alignItems: 'center', gap: 14, position: 'sticky', top: 0, zIndex: 100 }}>
        <div style={{ background: 'var(--brand)', width: 38, height: 38, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <svg viewBox="0 0 40 40" fill="none" width="24" height="24">
            <path d="M4 8 H11 L15 25 L22 8 H29 L18 32 H12 Z" fill="white"/>
            <path d="M22 8 H36 V14 H27 L25 17 H36 V32 H21 V26 H30 L32 23 H21 V8 Z" fill="white"/>
          </svg>
        </div>
        <span className="oswald" style={{ fontSize: 20, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
          Overlay Control
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          {savingTimer && <span style={{ fontSize: 11, color: 'var(--muted)', letterSpacing: '0.08em' }}>SAVING…</span>}
          <div style={{
            width: 8, height: 8, borderRadius: '50%',
            background: connected ? 'var(--green)' : 'var(--muted)',
            boxShadow: connected ? '0 0 8px var(--green)' : 'none',
            animation: connected ? 'pulse-dot 1.5s infinite' : 'none',
          }} />
          <span style={{ fontSize: 12, color: connected ? 'var(--green)' : 'var(--muted)', letterSpacing: '0.08em', fontWeight: 600 }}>
            {connected ? 'LIVE' : 'CONNECTING…'}
          </span>
        </div>
      </header>

      <div style={{ maxWidth: 860, margin: '0 auto', padding: '16px 16px 60px' }}>

        {/* Live Preview */}
        <div style={{
          background: 'linear-gradient(135deg,#1A1A30,#0F0F20)',
          border: '1px solid var(--border)', borderRadius: 10,
          padding: '24px 20px', marginBottom: 14,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          minHeight: 110, position: 'relative'
        }}>
          <span style={{ position: 'absolute', top: 10, left: 14, fontSize: 10, letterSpacing: '0.15em', color: 'var(--muted)', fontWeight: 600 }}>LIVE PREVIEW</span>
          <div style={{ display: 'flex', height: 64, borderRadius: 6, overflow: 'hidden', boxShadow: '0 6px 28px rgba(0,0,0,0.5)' }}>
            <div style={{ width: 50, background: '#1a56db', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <svg viewBox="0 0 40 40" fill="none" width="24" height="24">
                <path d="M4 8 H11 L15 25 L22 8 H29 L18 32 H12 Z" fill="white"/>
                <path d="M22 8 H36 V14 H27 L25 17 H36 V32 H21 V26 H30 L32 23 H21 V8 Z" fill="white"/>
              </svg>
            </div>
            <div style={{ background: '#111827', display: 'flex', flexDirection: 'column', width: 154 }}>
              {(['home', 'away'] as const).map((team, i) => (
                <div key={team} style={{ height: 32, display: 'flex', alignItems: 'center', padding: '0 10px', gap: 7, borderBottom: i === 0 ? '1px solid rgba(255,255,255,0.07)' : 'none', boxSizing: 'border-box' }}>
                  <div style={{ width: 18, height: 18, borderRadius: '50%', background: state[`${team}Color`] + '55', border: `2px solid ${state[`${team}Color`]}99`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 7, color: 'white', fontWeight: 900, flexShrink: 0, boxSizing: 'border-box' }}>
                    {state[`${team}Abbr`].slice(0, 2)}
                  </div>
                  <span className="oswald" style={{ fontSize: 14, color: 'white', textTransform: 'uppercase', letterSpacing: '0.04em', lineHeight: 1 }}>{state[`${team}Name`].slice(0, 8)}</span>
                </div>
              ))}
            </div>
            <div style={{ background: '#F5F5F5', display: 'flex', flexDirection: 'column', width: 52, flexShrink: 0, borderLeft: '1px solid rgba(255,255,255,0.08)', borderRight: '1px solid rgba(0,0,0,0.08)', boxSizing: 'border-box' }}>
              {(['home', 'away'] as const).map((team, i) => (
                <div key={team} style={{ height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', borderBottom: i === 0 ? '1px solid #D7DCE3' : 'none', boxSizing: 'border-box' }}>
                  <span className="oswald" style={{ fontSize: 25, color: '#0B0D12', fontWeight: 700, lineHeight: 1 }}>{state[`${team}Score`]}</span>
                </div>
              ))}
            </div>
            <div style={{ background: '#111827', display: 'flex', flexDirection: 'column', width: 72, flexShrink: 0 }}>
              <div style={{ height: 32, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', borderBottom: '1px solid rgba(255,255,255,0.07)', boxSizing: 'border-box' }}>
                <span className="oswald" style={{ fontSize: 13, color: 'white', lineHeight: 1 }}>{formatTime(state.timer)}</span>
                {state.injuryTime > 0 && <span className="oswald" style={{ fontSize: 9, color: '#1a56db', lineHeight: 1, marginTop: 2 }}>+{state.injuryTime}</span>}
              </div>
              <div style={{ height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span className="oswald" style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', lineHeight: 1, letterSpacing: '0.06em' }}>{state.status}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Visibility */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
          <Btn color="green" onClick={showOverlay}>▶ SHOW OVERLAY</Btn>
          <Btn color="muted" onClick={hideOverlay}>■ HIDE OVERLAY</Btn>
        </div>

        {/* Teams + Scores */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
          {(['home', 'away'] as const).map(team => (
            <Card key={team} title={`${team === 'home' ? '🏠' : '✈️'} ${team.toUpperCase()} TEAM`}>
              <Field label="Team Name">
                <div style={{ display: 'flex', gap: 8 }}>
                  <input type="text" value={state[`${team}Name`]}
                    onChange={e => updateState({ [`${team}Name`]: e.target.value } as Partial<MatchState>)} />
                  <input type="color" value={state[`${team}Color`]}
                    onChange={e => updateState({ [`${team}Color`]: e.target.value } as Partial<MatchState>)} />
                </div>
              </Field>
              <Field label="Short Code (3 chars)">
                <input type="text" value={state[`${team}Abbr`]} maxLength={3}
                  style={{ textTransform: 'uppercase' }}
                  onChange={e => updateState({ [`${team}Abbr`]: e.target.value.toUpperCase() } as Partial<MatchState>)} />
              </Field>
              <div style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
                <Label>Score</Label>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  background: '#11111F', borderRadius: 8, padding: '8px 12px',
                  border: '1px solid var(--border)', marginTop: 4
                }}>
                  <ScoreBtn onClick={() => adjustScore(team, -1)} sign="−" />
                  <span className="oswald" style={{ flex: 1, textAlign: 'center', fontSize: 38, fontWeight: 700, color: 'var(--text)' }}>
                    {state[`${team}Score`]}
                  </span>
                  <ScoreBtn onClick={() => adjustScore(team, +1)} sign="+" red />
                </div>
              </div>
            </Card>
          ))}
        </div>

        {/* Timer + Status */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>

          {/* Timer */}
          <Card title="⏱ MATCH TIMER">
            <div style={{
              fontFamily: 'Oswald, sans-serif', fontSize: 46, fontWeight: 700,
              textAlign: 'center', letterSpacing: '0.1em',
              color: state.timerRunning ? 'var(--green)' : 'var(--text)',
              background: '#11111F', borderRadius: 8,
              padding: '8px 0', marginBottom: 10,
              border: '1px solid var(--border)',
              transition: 'color 0.3s',
            }}>
              {formatTime(state.timer)}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 7, marginBottom: 10 }}>
              <Btn color="green" onClick={timerStart} disabled={state.timerRunning}>▶</Btn>
              <Btn color="yellow" onClick={timerPause} disabled={!state.timerRunning}>⏸</Btn>
              <Btn color="muted" onClick={timerReset}>↺</Btn>
            </div>
            <Label>Jump to (minutes)</Label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 7, marginTop: 4 }}>
              <input type="number" id="jump-input" defaultValue={0} min={0} max={120} />
              <Btn color="muted" onClick={() => {
                const v = parseInt((document.getElementById('jump-input') as HTMLInputElement).value) || 0
                timerJump(v)
              }}>SET</Btn>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
              <Label style={{ whiteSpace: 'nowrap', marginBottom: 0 }}>Injury Time</Label>
              <input type="number" value={state.injuryTime} min={0} max={20} style={{ width: 64 }}
                onChange={e => updateState({ injuryTime: parseInt(e.target.value) || 0 })} />
            </div>
          </Card>

          {/* Status */}
          <Card title="📋 MATCH STATUS">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginBottom: 14 }}>
              {STATUSES.map(s => (
                <button key={s} onClick={() => setStatus(s)} style={{
                  border: '1px solid',
                  borderColor: state.status === s ? 'var(--brand)' : 'var(--border)',
                  background: state.status === s ? 'var(--brand)' : '#11111F',
                  color: state.status === s ? 'white' : 'var(--muted)',
                  borderRadius: 5, padding: '7px 14px',
                  fontFamily: 'Oswald, sans-serif', fontSize: 13, fontWeight: 600,
                  letterSpacing: '0.06em', cursor: 'pointer', transition: 'all 0.15s',
                }}>
                  {s}
                </button>
              ))}
            </div>

            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, marginTop: 4 }}>
              <Label>Quick Sets</Label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7, marginTop: 6 }}>
                <Btn color="brand" onClick={() => { timerJump(45); setStatus('HT') }}>SET HALF TIME</Btn>
                <Btn color="muted" onClick={() => { timerJump(0); setStatus('2H') }}>2ND HALF START</Btn>
              </div>
            </div>

            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, marginTop: 12 }}>
              <Label>Danger Zone</Label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 7, marginTop: 6 }}>
                <Btn color="muted" onClick={resetAll}>↺ RESET ENTIRE MATCH</Btn>
              </div>
            </div>
          </Card>
        </div>

        {/* OBS instructions */}
        <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, padding: '16px 18px' }}>
          <div className="oswald" style={{ fontSize: 12, letterSpacing: '0.12em', color: 'var(--muted)', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 3, height: 14, background: 'var(--brand)', borderRadius: 2, display: 'inline-block' }} />
            OBS SETUP
          </div>
          <p style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.6 }}>
            In OBS: <strong style={{ color: 'var(--text)' }}>Add Source → Browser Source</strong> → paste your overlay URL →
            set width <strong style={{ color: 'var(--text)' }}>1920</strong> height <strong style={{ color: 'var(--text)' }}>1080</strong> →
            tick <strong style={{ color: 'var(--text)' }}>"Shutdown source when not visible"</strong>.
            Background will be transparent automatically.
          </p>
        </div>

      </div>

      {/* Toast */}
      <div style={{
        position: 'fixed', bottom: 24, right: 20,
        background: 'var(--green)', color: '#0a0a0a',
        fontFamily: 'Oswald, sans-serif', fontSize: 13, fontWeight: 700,
        letterSpacing: '0.1em', textTransform: 'uppercase',
        padding: '9px 18px', borderRadius: 6,
        boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
        animation: toastVisible ? 'toast-in 0.3s cubic-bezier(0.34,1.56,0.64,1) forwards' : 'toast-out 0.25s ease-in forwards',
        pointerEvents: 'none',
        zIndex: 999,
      }}>
        {toast}
      </div>
    </>
  )
}

// Reusable tiny components
function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, padding: '16px 18px' }}>
      <div style={{ fontFamily: 'Oswald, sans-serif', fontSize: 12, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: 3, height: 14, background: 'var(--brand)', borderRadius: 2, display: 'inline-block' }} />
        {title}
      </div>
      {children}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <Label>{label}</Label>
      <div style={{ marginTop: 4 }}>{children}</div>
    </div>
  )
}

function Label({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ fontSize: 11, color: 'var(--muted)', letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 4, ...style }}>
      {children}
    </div>
  )
}

function Btn({ children, onClick, color, disabled }: { children: React.ReactNode; onClick: () => void; color: 'brand' | 'green' | 'yellow' | 'muted'; disabled?: boolean }) {
  const bg = color === 'brand' ? '#1a56db' : color === 'green' ? '#22C55E' : color === 'yellow' ? '#F59E0B' : '#2A2A42'
  const fg = color === 'muted' ? 'var(--text)' : color === 'brand' ? 'white' : '#0a0a0a'
  return (
    <button onClick={onClick} disabled={disabled} style={{
      background: disabled ? '#1a1a2e' : bg, color: disabled ? 'var(--muted)' : fg,
      border: 'none', borderRadius: 6, cursor: disabled ? 'not-allowed' : 'pointer',
      fontFamily: 'Oswald, sans-serif', fontSize: 13, fontWeight: 700,
      letterSpacing: '0.08em', textTransform: 'uppercase',
      padding: '9px 12px', transition: 'all 0.15s', opacity: disabled ? 0.5 : 1,
      width: '100%',
    }}>
      {children}
    </button>
  )
}

function ScoreBtn({ onClick, sign, red }: { onClick: () => void; sign: string; red?: boolean }) {
  return (
    <button onClick={onClick} style={{
      width: 36, height: 36, borderRadius: 6, border: 'none', cursor: 'pointer',
      background: red ? 'var(--brand)' : 'var(--border)', color: 'white',
      fontSize: 20, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center',
      transition: 'transform 0.1s',
      fontFamily: 'Oswald, sans-serif',
    }}
      onMouseDown={e => (e.currentTarget.style.transform = 'scale(0.88)')}
      onMouseUp={e => (e.currentTarget.style.transform = 'scale(1)')}
    >
      {sign}
    </button>
  )
}
