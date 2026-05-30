'use client'
import { useEffect, useState } from 'react'
import { useSimStore } from '../sim/state'

const SPEEDS = [0.5, 1, 2, 4]

const btnStyle: React.CSSProperties = {
  background: 'none',
  border: '1px solid #1a1b1e',
  color: '#5a5b5e',
  cursor: 'pointer',
  padding: '3px 9px',
  fontSize: '11px',
  fontFamily: 'inherit',
  lineHeight: 1.4,
}

export default function Timeline() {
  const playing = useSimStore(s => s.playing)
  const play = useSimStore(s => s.play)
  const pause = useSimStore(s => s.pause)
  const reset = useSimStore(s => s.reset)
  const speed = useSimStore(s => s.speed)
  const setSpeed = useSimStore(s => s.setSpeed)
  const launchSwarm = useSimStore(s => s.launchSwarm)
  const animationTime = useSimStore(s => s.animationTime)
  const droneCount = useSimStore(s => s.drones.filter(d => d.alive).length)

  const clock = formatClock(animationTime)

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        padding: '0 16px',
        height: '44px',
        borderTop: '1px solid #1a1b1e',
        background: '#0c0d0f',
        gap: '16px',
        flexShrink: 0,
      }}
    >
      {/* Transport */}
      <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
        <button onClick={reset} style={btnStyle} title="Reset">◄</button>
        <button onClick={playing ? pause : play} style={btnStyle} title={playing ? 'Pause' : 'Play'}>
          {playing ? '■' : '►'}
        </button>
      </div>

      {/* Speed */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
        <span style={{ fontSize: '10px', letterSpacing: '0.1em', color: '#3a3b3e', marginRight: '4px' }}>
          SPEED
        </span>
        {SPEEDS.map(s => (
          <button
            key={s}
            onClick={() => setSpeed(s)}
            style={{
              ...btnStyle,
              color: speed === s ? '#9a9b9e' : '#3a3b3e',
              borderColor: speed === s ? '#3a3b3e' : '#1a1b1e',
            }}
          >
            {s}×
          </button>
        ))}
      </div>

      {/* Activity strip */}
      <ActivityStrip active={droneCount > 0} clock={clock} />

      {/* Quick launch */}
      <button
        onClick={launchSwarm}
        style={{ ...btnStyle, color: '#7a6a3a', borderColor: '#1a1b1e' }}
      >
        LAUNCH SWARM
      </button>

      <span style={{ fontSize: '10px', letterSpacing: '0.1em', color: '#3a3b3e' }}>
        {droneCount > 0 ? `[${droneCount} INBOUND]` : '[NOMINAL]'}
      </span>
    </div>
  )
}

function ActivityStrip({ active, clock }: { active: boolean; clock: string }) {
  // Animated bars echoing the reference "waveform" timeline. Heights depend on
  // wall-clock time, so render a static baseline until mounted to avoid an
  // SSR/client hydration mismatch.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  const bars = 40
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: '2px', height: '20px', flex: 1, overflow: 'hidden' }}>
        {Array.from({ length: bars }).map((_, i) => {
          const h = !mounted
            ? 2
            : active
            ? 3 + Math.abs(Math.sin(i * 0.7 + Date.now() / 200)) * 16
            : 2 + Math.abs(Math.sin(i * 0.5)) * 3
          return (
            <div
              key={i}
              style={{
                width: '2px',
                height: `${Math.round(h * 10) / 10}px`,
                background: active ? '#3a5a4a' : '#1a1b1e',
                flexShrink: 0,
              }}
            />
          )
        })}
      </div>
      <span style={{ fontSize: '11px', color: '#5a5b5e', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
        {clock}
      </span>
    </div>
  )
}

function formatClock(ms: number) {
  const totalSec = Math.floor(ms / 1000)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `T+${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}
