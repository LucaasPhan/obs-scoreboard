'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  BASKETBALL_CHANNEL_NAME,
  BASKETBALL_STATE_ID,
  DEFAULT_BASKETBALL_STATE,
  basketballSupabase,
  getCurrentTimestamp,
  getPeriodLengthSeconds,
  resolveBasketballClock,
  type BasketballEvent,
  type BasketballState,
} from '@/lib/basketball'

const PERIODS = [1, 2, 3, 4, 5, 6]

export default function BasketballControlPage() {
  const [state, setState] = useState<BasketballState>(DEFAULT_BASKETBALL_STATE)
  const [connected, setConnected] = useState(false)
  const [toast, setToast] = useState('')
  const [toastVisible, setToastVisible] = useState(false)
  const [saving, setSaving] = useState(false)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const channelRef = useRef<ReturnType<typeof basketballSupabase.channel> | null>(null)
  const connectedRef = useRef(false)
  const stateRef = useRef(state)
  const nextSyncVersionRef = useRef(DEFAULT_BASKETBALL_STATE.syncVersion)
  const persistenceQueueRef = useRef(Promise.resolve())

  const showToast = useCallback((msg: string) => {
    setToast(msg)
    setToastVisible(true)
    setTimeout(() => setToastVisible(false), 2000)
  }, [])

  const stampState = useCallback((next: BasketballState): BasketballState => {
    const syncVersion = Math.max(getCurrentTimestamp(), nextSyncVersionRef.current + 1)
    nextSyncVersionRef.current = syncVersion
    return { ...next, syncVersion }
  }, [])

  const broadcast = useCallback(async (event: BasketballEvent, newState?: BasketballState) => {
    const s = newState ?? stateRef.current

    if (channelRef.current && connectedRef.current) {
      try {
        await channelRef.current.send({ type: 'broadcast', event: 'event', payload: event })
      } catch {
        // The persisted row still keeps other clients synchronized.
      }
    }

    persistenceQueueRef.current = persistenceQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        try {
          setSaving(true)
          await basketballSupabase
            .from('overlay_state')
            .upsert({ id: BASKETBALL_STATE_ID, state: s, updated_at: new Date().toISOString() })
        } catch {
          // Persist failures are non-fatal; realtime broadcast already delivered the event.
        }
      })
      .finally(() => setSaving(false))

    await persistenceQueueRef.current
  }, [])

  const startLocalClock = useCallback((from: number) => {
    if (timerRef.current) clearInterval(timerRef.current)
    let t = from

    timerRef.current = setInterval(() => {
      t--
      setState(prev => {
        if (t <= 0) {
          const next = stampState({ ...prev, clock: 0, clockRunning: false, clockStartedAt: null })
          stateRef.current = next
          if (timerRef.current) {
            clearInterval(timerRef.current)
            timerRef.current = null
          }
          setTimeout(() => {
            broadcast({ type: 'STATE_UPDATE', payload: next }, next)
            showToast('CLOCK EXPIRED')
          }, 0)
          return next
        }

        const next = { ...prev, clock: t, clockStartedAt: prev.clockRunning ? getCurrentTimestamp() : prev.clockStartedAt }
        stateRef.current = next
        return next
      })
    }, 1000)
  }, [broadcast, showToast, stampState])

  useEffect(() => {
    stateRef.current = state
  }, [state])

  // Load initial state from Supabase
  useEffect(() => {
    const load = async () => {
      const { data } = await basketballSupabase
        .from('overlay_state')
        .select('state')
        .eq('id', BASKETBALL_STATE_ID)
        .single()

      if (data?.state) {
        const next = resolveBasketballClock(data.state as Partial<BasketballState>)
        nextSyncVersionRef.current = Math.max(nextSyncVersionRef.current, next.syncVersion)
        stateRef.current = next
        setState(next)
        if (next.clockRunning) startLocalClock(next.clock)
      }
    }
    load()
  }, [startLocalClock])

  // Subscribe to Supabase Realtime channel
  useEffect(() => {
    const channel = basketballSupabase.channel(BASKETBALL_CHANNEL_NAME)
    channel.subscribe(status => {
      const isSubscribed = status === 'SUBSCRIBED'
      connectedRef.current = isSubscribed
      setConnected(isSubscribed)
    })
    channelRef.current = channel

    return () => {
      connectedRef.current = false
      channelRef.current = null
      basketballSupabase.removeChannel(channel)
    }
  }, [])

  const updateState = useCallback((patch: Partial<BasketballState>, event?: BasketballEvent) => {
    setState(prev => {
      const next = stampState({ ...prev, ...patch })
      const nextEvent = event?.type === 'SHOW' || event?.type === 'HIDE' ? { ...event, syncVersion: next.syncVersion } : event
      stateRef.current = next
      broadcast(nextEvent ?? { type: 'STATE_UPDATE', payload: next }, next)
      return next
    })
  }, [broadcast, stampState])

  const initiateGame = () => {
    if (stateRef.current.gameInitiated) return

    const next = stampState({ ...stateRef.current, gameInitiated: true, visible: true })
    stateRef.current = next
    setState(next)
    broadcast({ type: 'STATE_UPDATE', payload: next }, next)
    showToast('GAME INITIATED')
  }

  const adjustScore = (team: 'home' | 'away', points: number) => {
    const key = `${team}Score` as 'homeScore' | 'awayScore'
    const newScore = Math.max(0, stateRef.current[key] + points)
    const next = stampState({ ...stateRef.current, [key]: newScore })
    stateRef.current = next
    setState(next)
    broadcast(points > 0 ? { type: 'SCORE', team, points, newScore, syncVersion: next.syncVersion } : { type: 'STATE_UPDATE', payload: next }, next)
    showToast(points > 0 ? `${stateRef.current[`${team}Abbr`]} +${points}` : `${stateRef.current[`${team}Abbr`]} SCORE DOWN`)
  }

  const clockStart = () => {
    const current = resolveBasketballClock(stateRef.current)
    if (current.clockRunning || current.clock <= 0) return

    const next = stampState({ ...current, clockRunning: true, clockStartedAt: getCurrentTimestamp() })
    stateRef.current = next
    setState(next)
    startLocalClock(next.clock)
    broadcast({ type: 'STATE_UPDATE', payload: next }, next)
    showToast('CLOCK STARTED')
  }

  const clockPause = () => {
    if (timerRef.current) clearInterval(timerRef.current)
    const current = resolveBasketballClock(stateRef.current)
    updateState({ clock: current.clock, clockRunning: false, clockStartedAt: null })
    showToast('CLOCK PAUSED')
  }

  const clockReset = () => {
    if (timerRef.current) clearInterval(timerRef.current)
    updateState({ clock: getPeriodLengthSeconds(stateRef.current), clockRunning: false, clockStartedAt: null, shotClock: 0 })
    showToast('CLOCK RESET')
  }

  const setClockMinutes = (minutes: number) => {
    const clock = Math.min(Math.max(0, minutes), stateRef.current.periodLengthMinutes) * 60
    const next = stampState({ ...stateRef.current, clock, clockRunning: false, clockStartedAt: null })
    stateRef.current = next
    if (timerRef.current) clearInterval(timerRef.current)
    setState(next)
    broadcast({ type: 'STATE_UPDATE', payload: next }, next)
  }

  const setPeriodLength = (minutes: number) => {
    const periodLengthMinutes = Math.min(Math.max(minutes || 1, 1), 20)
    const limit = periodLengthMinutes * 60
    const next = stampState({
      ...stateRef.current,
      periodLengthMinutes,
      clock: Math.min(stateRef.current.clock, limit),
      clockRunning: false,
      clockStartedAt: null,
    })
    stateRef.current = next
    if (timerRef.current) clearInterval(timerRef.current)
    setState(next)
    broadcast({ type: 'STATE_UPDATE', payload: next }, next)
  }

  const nextPeriod = () => {
    if (timerRef.current) clearInterval(timerRef.current)
    const period = Math.min(stateRef.current.period + 1, 6)
    const next = stampState({
      ...stateRef.current,
      period,
      clock: getPeriodLengthSeconds(stateRef.current),
      clockRunning: false,
      clockStartedAt: null,
      shotClock: 0,
      homeBonus: false,
      awayBonus: false,
    })
    stateRef.current = next
    setState(next)
    broadcast({ type: 'STATE_UPDATE', payload: next }, next)
    showToast(`PERIOD ${period}`)
  }

  const resetGame = () => {
    if (timerRef.current) clearInterval(timerRef.current)
    connectedRef.current = false
    setConnected(false)
    const next = stampState({ ...DEFAULT_BASKETBALL_STATE, periodLengthMinutes: stateRef.current.periodLengthMinutes })
    stateRef.current = next
    setState(next)
    broadcast({ type: 'STATE_UPDATE', payload: next }, next)
    showToast('GAME RESET')
  }

  const showOverlay = () => {
    updateState({ visible: true }, { type: 'SHOW' })
    showToast('OVERLAY SHOWN')
  }

  const hideOverlay = () => {
    updateState({ visible: false }, { type: 'HIDE' })
    showToast('OVERLAY HIDDEN')
  }

  const formatClock = (secs: number) => {
    const m = Math.floor(secs / 60)
    const s = secs % 60
    return `${m}:${String(s).padStart(2, '0')}`
  }

  const liveActive = state.gameInitiated && connected

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@500;700;900&family=Oswald:wght@600;700&display=swap');
        :root {
          --bg:#080A0F; --panel:#10141D; --card:#161C27; --line:#293241;
          --text:#F6F8FB; --muted:#8792A3; --nba-red:#C9082A; --nba-blue:#17408B;
          --green:#20D07A; --amber:#F5B942;
        }
        * { box-sizing:border-box; margin:0; padding:0; }
        body { background:var(--bg); color:var(--text); font-family:Inter, sans-serif; min-height:100vh; }
        input { width:100%; background:#0A0E15; border:1px solid var(--line); color:var(--text); border-radius:6px; padding:9px 10px; font:700 13px Inter, sans-serif; outline:none; }
        input:focus { border-color:var(--nba-blue); }
        input[type=color] { width:40px; height:38px; padding:2px; flex-shrink:0; cursor:pointer; }
        @keyframes toast-in { from { transform:translateY(50px); opacity:0; } to { transform:translateY(0); opacity:1; } }
        @keyframes toast-out { from { transform:translateY(0); opacity:1; } to { transform:translateY(50px); opacity:0; } }
        @keyframes pulse-dot { 0%,100% { opacity:1; } 50% { opacity:.35; } }
      `}</style>

      <header style={{ height: 66, background: '#0B0F17', borderBottom: '2px solid var(--nba-red)', display: 'flex', alignItems: 'center', gap: 14, padding: '0 22px', position: 'sticky', top: 0, zIndex: 10 }}>
        <div style={{ width: 42, height: 42, borderRadius: 5, background: 'linear-gradient(90deg,var(--nba-blue) 0 50%,var(--nba-red) 50%)', display: 'grid', placeItems: 'center', font: '900 18px Inter', color: 'white' }}>B</div>
        <div>
          <div style={{ font: '900 18px Inter', letterSpacing: '.08em' }}>BASKETBALL CONTROL</div>
          <div style={{ color: 'var(--muted)', fontSize: 11, letterSpacing: '.12em' }}>NBA STYLE SCOREBUG</div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          {saving && <span style={{ color: 'var(--muted)', fontSize: 11, letterSpacing: '.12em' }}>SAVING</span>}
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: liveActive ? 'var(--green)' : 'var(--muted)', boxShadow: liveActive ? '0 0 9px var(--green)' : 'none', animation: liveActive ? 'pulse-dot 1.4s infinite' : 'none' }} />
          <span style={{ color: liveActive ? 'var(--green)' : 'var(--muted)', fontSize: 12, fontWeight: 900, letterSpacing: '.1em' }}>
            {state.gameInitiated ? (connected ? 'LIVE' : 'CONNECTING') : 'STANDBY'}
          </span>
        </div>
      </header>

      <main style={{ maxWidth: 980, margin: '0 auto', padding: '18px 16px 64px' }}>
        <section style={{ background: 'linear-gradient(135deg,#101827,#070A10)', border: '1px solid var(--line)', borderRadius: 8, padding: 22, marginBottom: 14, display: 'grid', placeItems: 'center', position: 'relative' }}>
          <span style={{ position: 'absolute', top: 10, left: 14, color: 'var(--muted)', fontSize: 10, fontWeight: 900, letterSpacing: '.16em' }}>LIVE PREVIEW</span>
          <div style={{ display: 'flex', height: 64, borderRadius: 5, overflow: 'hidden', boxShadow: '0 12px 30px rgba(0,0,0,.55)', fontFamily: 'Inter, sans-serif' }}>
            {(['away', 'home'] as const).map(team => (
              <div key={team} style={{ display: 'flex', alignItems: 'center', background: state[`${team}Color`], color: 'white', minWidth: 132, padding: '0 10px', gap: 10 }}>
                <span style={{ fontWeight: 900, fontSize: 16 }}>{state[`${team}Abbr`]}</span>
                <span style={{ marginLeft: 'auto', fontWeight: 900, fontSize: 35, lineHeight: 1 }}>{state[`${team}Score`]}</span>
              </div>
            ))}
            <div style={{ width: 118, background: '#F7F7F5', color: '#070A10', display: 'grid', gridTemplateRows: '1fr 1fr' }}>
              <div style={{ display: 'grid', placeItems: 'center', fontWeight: 900, fontSize: 20 }}>{formatClock(state.clock)}</div>
              <div style={{ display: 'grid', placeItems: 'center', borderTop: '1px solid #D7D7D2', fontWeight: 900, fontSize: 12, letterSpacing: '.12em' }}>{state.period > 4 ? `OT${state.period - 4}` : `Q${state.period}`}</div>
            </div>
          </div>
        </section>

        <section style={{ display: 'grid', gridTemplateColumns: '1.25fr 1fr 1fr', gap: 10, marginBottom: 14 }}>
          <Btn color="blue" onClick={initiateGame} disabled={state.gameInitiated}>{state.gameInitiated ? 'GAME LIVE' : 'INITIATE GAME'}</Btn>
          <Btn color="green" onClick={showOverlay} disabled={!state.gameInitiated}>SHOW OVERLAY</Btn>
          <Btn color="muted" onClick={hideOverlay} disabled={!state.gameInitiated}>HIDE OVERLAY</Btn>
        </section>

        <section style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
          {(['away', 'home'] as const).map(team => (
            <Card key={team} title={`${team.toUpperCase()} TEAM`}>
              <Field label="Team name">
                <div style={{ display: 'flex', gap: 8 }}>
                  <input value={state[`${team}Name`]} onChange={e => updateState({ [`${team}Name`]: e.target.value.toUpperCase() } as Partial<BasketballState>)} />
                  <input type="color" value={state[`${team}Color`]} onChange={e => updateState({ [`${team}Color`]: e.target.value } as Partial<BasketballState>)} />
                </div>
              </Field>
              <Field label="Abbreviation">
                <input maxLength={4} value={state[`${team}Abbr`]} onChange={e => updateState({ [`${team}Abbr`]: e.target.value.toUpperCase() } as Partial<BasketballState>)} />
              </Field>
              <div style={{ marginTop: 12, borderTop: '1px solid var(--line)', paddingTop: 12 }}>
                <Label>Score</Label>
                <div style={{ display: 'grid', gridTemplateColumns: '54px 1fr 54px', gap: 8, alignItems: 'center', marginTop: 6 }}>
                  <ScoreBtn onClick={() => adjustScore(team, -1)} label="-1" />
                  <div style={{ height: 58, display: 'grid', placeItems: 'center', background: '#0A0E15', border: '1px solid var(--line)', borderRadius: 7, font: '900 36px Inter' }}>{state[`${team}Score`]}</div>
                  <ScoreBtn onClick={() => adjustScore(team, 1)} label="+1" hot />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
                  <Btn color="blue" onClick={() => adjustScore(team, 2)}>+2</Btn>
                  <Btn color="red" onClick={() => adjustScore(team, 3)}>+3</Btn>
                </div>
              </div>
            </Card>
          ))}
        </section>

        <section style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Card title="GAME CLOCK">
            <div style={{ height: 76, display: 'grid', placeItems: 'center', background: '#F7F7F5', color: '#070A10', borderRadius: 7, font: '900 42px Inter', marginBottom: 10 }}>
              {formatClock(state.clock)}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 10 }}>
              <Btn color="green" onClick={clockStart} disabled={state.clockRunning}>START</Btn>
              <Btn color="yellow" onClick={clockPause} disabled={!state.clockRunning}>PAUSE</Btn>
              <Btn color="muted" onClick={clockReset}>RESET</Btn>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 76px', gap: 8, alignItems: 'end' }}>
              <Field label="Set clock minutes">
                <input id="basketball-clock-set" type="number" defaultValue={state.periodLengthMinutes} min={0} max={state.periodLengthMinutes} />
              </Field>
              <Btn color="muted" onClick={() => {
                const input = document.getElementById('basketball-clock-set') as HTMLInputElement | null
                setClockMinutes(parseInt(input?.value ?? '0') || 0)
              }}>SET</Btn>
            </div>
            <div style={{ marginTop: 10 }}>
              <Field label="Period length">
                <input type="number" value={state.periodLengthMinutes} min={1} max={20} onChange={e => setPeriodLength(parseInt(e.target.value) || 1)} />
              </Field>
            </div>
          </Card>

          <Card title="PERIOD + GAME STATE">
            <Label>Period</Label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, margin: '6px 0 12px' }}>
              {PERIODS.map(period => (
                <button key={period} onClick={() => updateState({ period })} style={{
                  border: '1px solid',
                  borderColor: state.period === period ? 'var(--nba-red)' : 'var(--line)',
                  background: state.period === period ? 'var(--nba-red)' : '#0A0E15',
                  color: 'white',
                  borderRadius: 5,
                  padding: '8px 12px',
                  font: '900 12px Inter',
                  cursor: 'pointer',
                }}>{period > 4 ? `OT${period - 4}` : `Q${period}`}</button>
              ))}
            </div>
            <Btn color="blue" onClick={nextPeriod}>NEXT PERIOD</Btn>

            <div style={{ borderTop: '1px solid var(--line)', paddingTop: 12, marginTop: 12 }}>
              <Label>Possession</Label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginTop: 6 }}>
                <Btn color="muted" onClick={() => updateState({ possession: 'away' })}>{state.awayAbbr}</Btn>
                <Btn color="muted" onClick={() => updateState({ possession: null })}>NONE</Btn>
                <Btn color="muted" onClick={() => updateState({ possession: 'home' })}>{state.homeAbbr}</Btn>
              </div>
            </div>

            <div style={{ borderTop: '1px solid var(--line)', paddingTop: 12, marginTop: 12 }}>
              <Label>Bonus</Label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 6 }}>
                <Btn color={state.awayBonus ? 'red' : 'muted'} onClick={() => updateState({ awayBonus: !state.awayBonus })}>{state.awayAbbr} BONUS</Btn>
                <Btn color={state.homeBonus ? 'red' : 'muted'} onClick={() => updateState({ homeBonus: !state.homeBonus })}>{state.homeAbbr} BONUS</Btn>
              </div>
            </div>

            <div style={{ borderTop: '1px solid var(--line)', paddingTop: 12, marginTop: 12 }}>
              <Btn color="muted" onClick={resetGame}>RESET GAME</Btn>
            </div>
          </Card>
        </section>
      </main>

      <div style={{
        position: 'fixed',
        right: 20,
        bottom: 22,
        background: 'var(--green)',
        color: '#06100A',
        padding: '10px 16px',
        borderRadius: 6,
        font: '900 12px Inter',
        letterSpacing: '.1em',
        pointerEvents: 'none',
        animation: toastVisible ? 'toast-in .25s ease-out forwards' : 'toast-out .2s ease-in forwards',
      }}>{toast}</div>
    </>
  )
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 8, padding: '16px 18px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, color: 'var(--muted)', font: '900 12px Inter', letterSpacing: '.12em', marginBottom: 13 }}>
        <span style={{ width: 4, height: 15, borderRadius: 1, background: 'linear-gradient(var(--nba-blue),var(--nba-red))' }} />
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
      <div style={{ marginTop: 5 }}>{children}</div>
    </div>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return <div style={{ color: 'var(--muted)', font: '900 11px Inter', letterSpacing: '.1em', textTransform: 'uppercase' }}>{children}</div>
}

function Btn({ children, onClick, color, disabled }: { children: React.ReactNode; onClick: () => void; color: 'blue' | 'red' | 'green' | 'yellow' | 'muted'; disabled?: boolean }) {
  const bg = color === 'blue' ? 'var(--nba-blue)' : color === 'red' ? 'var(--nba-red)' : color === 'green' ? 'var(--green)' : color === 'yellow' ? 'var(--amber)' : '#283141'
  const fg = color === 'green' || color === 'yellow' ? '#06080C' : 'white'

  return (
    <button onClick={onClick} disabled={disabled} style={{
      width: '100%',
      border: 'none',
      borderRadius: 6,
      background: disabled ? '#111722' : bg,
      color: disabled ? 'var(--muted)' : fg,
      cursor: disabled ? 'not-allowed' : 'pointer',
      padding: '10px 12px',
      font: '900 12px Inter',
      letterSpacing: '.08em',
      opacity: disabled ? .55 : 1,
    }}>{children}</button>
  )
}

function ScoreBtn({ label, onClick, hot }: { label: string; onClick: () => void; hot?: boolean }) {
  return (
    <button onClick={onClick} style={{
      height: 46,
      border: 'none',
      borderRadius: 6,
      background: hot ? 'var(--nba-red)' : '#283141',
      color: 'white',
      cursor: 'pointer',
      font: '900 16px Inter',
    }}>{label}</button>
  )
}
