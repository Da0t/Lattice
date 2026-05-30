import { create } from 'zustand'
import type { Relay, Connection } from './mesh'
import {
  placeRelays,
  formConnections,
  destroyRelay,
  healMesh,
  distanceKm,
} from './mesh'
import { findPath } from './pathfinding'
import {
  FOB_POSITION,
  RELAY_COUNT,
  RELAY_MIN_RADIUS_KM,
  RELAY_MAX_RADIUS_KM,
  RELAY_RANGE_MIN_KM,
  RELAY_RANGE_SPREAD_KM,
  DRONE_SPEED_KMH,
  DRONE_SIM_SCALE,
  SWARM_SPAWN_RADIUS_DEG,
  SWARM_DEFAULT_SIZE,
  INTERCEPT_RADIUS_KM,
  PACKET_DURATION_MS,
  PACKET_TRAIL_MS,
  FOB_LINK_RANGE_KM,
} from '../data/config'

export interface Fob {
  id: string
  position: [number, number]
}

export type PlacementMode = 'relay' | 'fob'

export interface Drone {
  id: string
  position: [number, number]
  heading: number
  alive: boolean
  detected: boolean
  track: [number, number][]
  killAt: number | null
}

export interface Packet {
  id: string
  path: [number, number][]
  timestamps: number[]
  startTime: number
  endTime: number
  color: [number, number, number, number]
}

export interface InterceptLine {
  id: string
  from: [number, number]
  to: [number, number]
  expiry: number
}

export interface LogEntry {
  time: string
  text: string
  level: 'info' | 'warn' | 'alert' | 'kill'
}

export interface MeshHealth {
  nodes: number
  totalNodes: number
  links: number
  latency: number
  health: number
}

export interface SandboxState {
  relays: Relay[]
  connections: Connection[]
  fobs: Fob[]
  drones: Drone[]
  packets: Packet[]
  interceptLines: InterceptLine[]
  log: LogEntry[]
  meshHealth: MeshHealth
  playing: boolean
  speed: number
  swarmSize: number
  placementMode: PlacementMode
  animationTime: number
  threatsNeutralized: number
  _relaySeq: number
  _fobSeq: number
  _droneSeq: number
  _packetSeq: number
}

function now() {
  const d = new Date()
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}:${String(d.getUTCSeconds()).padStart(2, '0')}`
}

function pushLog(log: LogEntry[], text: string, level: LogEntry['level']): LogEntry[] {
  const next = [...log, { time: now(), text, level }]
  return next.length > 200 ? next.slice(next.length - 200) : next
}

function computeHealth(relays: Relay[], connections: Connection[]): MeshHealth {
  const online = relays.filter(r => r.status === 'online')
  const active = connections.filter(c => c.status === 'active' || c.status === 'rerouted')
  const avgLatency = active.length
    ? Math.round(active.reduce((s, c) => s + c.latency, 0) / active.length)
    : 0
  const standing = relays.filter(r => r.status !== 'destroyed').length
  const health = standing ? online.length / standing : 0
  return {
    nodes: online.length,
    totalNodes: standing,
    links: active.length,
    latency: avgLatency,
    health: Math.round(health * 100) / 100,
  }
}

function nearestFob(pos: [number, number], fobs: Fob[]): Fob | null {
  if (fobs.length === 0) return null
  let best = fobs[0]
  let bd = Infinity
  for (const f of fobs) {
    const d = distanceKm(pos, f.position)
    if (d < bd) { bd = d; best = f }
  }
  return best
}

// BFS a path relay -> nearest reachable FOB through the mesh. A virtual SINK is
// connected to every FOB so a single BFS finds the closest one; the SINK is then
// stripped, leaving relay -> ... -> FOB waypoints.
function routeToFob(
  fromRelayId: string,
  relays: Relay[],
  connections: Connection[],
  fobs: Fob[]
): [number, number][] | null {
  if (fobs.length === 0) return null
  const SINK = '__SINK__'
  const onlineRelays = relays.filter(r => r.status === 'online')
  const fobNodes = fobs.map(f => ({
    id: f.id, position: f.position, range: 999, status: 'online' as const, connections: [],
  }))
  const allNodes = [
    ...onlineRelays,
    ...fobNodes,
    { id: SINK, position: [0, 0] as [number, number], range: 999, status: 'online' as const, connections: [] },
  ]
  const fobLinks: Connection[] = []
  onlineRelays.forEach(r =>
    fobs.forEach(f => {
      if (distanceKm(r.position, f.position) < FOB_LINK_RANGE_KM) {
        fobLinks.push({ id: `${r.id}-${f.id}`, from: r.id, to: f.id, status: 'active', latency: 5 })
      }
    })
  )
  const sinkLinks: Connection[] = fobs.map(f => ({
    id: `${f.id}-SINK`, from: f.id, to: SINK, status: 'active', latency: 0,
  }))
  const allConns = [...connections, ...fobLinks, ...sinkLinks]
  const path = findPath(fromRelayId, SINK, allNodes, allConns)
  if (!path || path.length < 3) return null
  const trimmed = path.slice(0, path.length - 1) // drop SINK; ends at a FOB
  const posMap = new Map<string, [number, number]>()
  allNodes.forEach(n => posMap.set(n.id, n.position))
  return trimmed.map(id => posMap.get(id)!).filter(Boolean)
}

function makePacket(waypoints: [number, number][], startTime: number, seq: number): Packet {
  const total = waypoints.reduce((sum, wp, i) =>
    i === 0 ? 0 : sum + distanceKm(waypoints[i - 1], wp), 0) || 1
  let cum = 0
  const timestamps = waypoints.map((wp, i) => {
    if (i === 0) return startTime
    cum += distanceKm(waypoints[i - 1], wp)
    return startTime + (cum / total) * PACKET_DURATION_MS
  })
  return {
    id: `p${seq}`,
    path: waypoints,
    timestamps,
    startTime,
    endTime: startTime + PACKET_DURATION_MS,
    color: [74, 122, 90, 220],
  }
}

const DEFAULT_FOBS: Fob[] = [{ id: 'FOB-1', position: FOB_POSITION }]
const EMPTY_HEALTH: MeshHealth = { nodes: 0, totalNodes: 0, links: 0, latency: 0, health: 0 }

export interface SandboxStore extends SandboxState {
  tick: (dt: number) => void
  deployRing: () => void
  placeRelay: (lngLat: [number, number]) => void
  placeFob: (lngLat: [number, number]) => void
  placeAt: (lngLat: [number, number]) => void
  destroyRelayById: (id: string) => void
  launchSwarm: () => void
  setSwarmSize: (n: number) => void
  setSpeed: (s: number) => void
  setPlacementMode: (m: PlacementMode) => void
  play: () => void
  pause: () => void
  reset: () => void
}

const initialState: SandboxState = {
  relays: [],
  connections: [],
  fobs: DEFAULT_FOBS,
  drones: [],
  packets: [],
  interceptLines: [],
  log: [],
  meshHealth: EMPTY_HEALTH,
  playing: true,
  speed: 1,
  swarmSize: SWARM_DEFAULT_SIZE,
  placementMode: 'relay',
  animationTime: 0,
  threatsNeutralized: 0,
  _relaySeq: 0,
  _fobSeq: 1,
  _droneSeq: 0,
  _packetSeq: 0,
}

export const useSimStore = create<SandboxStore>((set, get) => ({
  ...initialState,

  play: () => set({ playing: true }),
  pause: () => set({ playing: false }),
  setSpeed: (s: number) => set({ speed: s }),
  setSwarmSize: (n: number) => set({ swarmSize: n }),
  setPlacementMode: (m: PlacementMode) => set({ placementMode: m }),

  reset: () => set({ ...initialState, fobs: [...DEFAULT_FOBS], log: [], animationTime: 0 }),

  deployRing: () => {
    const state = get()
    const center = state.fobs[0]?.position ?? FOB_POSITION
    const ring = placeRelays(center, RELAY_COUNT, RELAY_MIN_RADIUS_KM, RELAY_MAX_RADIUS_KM)
      .map((r, i) => ({ ...r, id: `R-${String(state._relaySeq + i + 1).padStart(2, '0')}`, status: 'online' as const }))
    const relays = [...state.relays, ...ring]
    const conns = formConnections(relays)
    set({
      relays,
      connections: conns,
      _relaySeq: state._relaySeq + RELAY_COUNT,
      meshHealth: computeHealth(relays, conns),
      log: pushLog(state.log, `RING DEPLOYED — ${ring.length} relays, ${conns.length} links`, 'info'),
    })
  },

  placeRelay: (lngLat: [number, number]) => {
    const state = get()
    const seq = state._relaySeq + 1
    const relay: Relay = {
      id: `R-${String(seq).padStart(2, '0')}`,
      position: lngLat,
      range: RELAY_RANGE_MIN_KM + Math.random() * RELAY_RANGE_SPREAD_KM,
      status: 'online',
      connections: [],
    }
    const relays = [...state.relays, relay]
    const conns = formConnections(relays)
    set({
      relays,
      connections: conns,
      _relaySeq: seq,
      meshHealth: computeHealth(relays, conns),
      log: pushLog(state.log, `${relay.id} DEPLOYED — ${conns.length} links`, 'info'),
    })
  },

  placeFob: (lngLat: [number, number]) => {
    const state = get()
    const seq = state._fobSeq + 1
    const fob: Fob = { id: `FOB-${seq}`, position: lngLat }
    // New FOB may give relays a shorter path — recolor mesh via heal pass.
    const conns = healMesh(state.relays, state.connections)
    set({
      fobs: [...state.fobs, fob],
      connections: conns,
      _fobSeq: seq,
      meshHealth: computeHealth(state.relays, conns),
      log: pushLog(state.log, `${fob.id} ESTABLISHED`, 'info'),
    })
  },

  placeAt: (lngLat: [number, number]) => {
    const mode = get().placementMode
    if (mode === 'fob') get().placeFob(lngLat)
    else get().placeRelay(lngLat)
  },

  destroyRelayById: (id: string) => {
    const state = get()
    const target = state.relays.find(r => r.id === id)
    if (!target || target.status === 'destroyed') return
    const { relays, connections } = destroyRelay(id, state.relays, state.connections)
    const healed = healMesh(relays, connections)
    const rerouted = healed.filter(c => c.status === 'rerouted').length
    set({
      relays,
      connections: healed,
      meshHealth: computeHealth(relays, healed),
      log: pushLog(
        pushLog(state.log, `${id} DESTROYED — mesh degraded`, 'kill'),
        rerouted ? `MESH self-healing — ${rerouted} paths rerouted` : 'MESH stable — no reroute needed',
        'warn'
      ),
    })
  },

  launchSwarm: () => {
    const state = get()
    const n = state.swarmSize
    const center = state.fobs[0]?.position ?? FOB_POSITION
    const bearing = Math.random() * Math.PI * 2
    const newDrones: Drone[] = []
    for (let i = 0; i < n; i++) {
      const spread = (i - (n - 1) / 2) * 0.045 + (Math.random() - 0.5) * 0.02
      const b = bearing + spread
      const r = SWARM_SPAWN_RADIUS_DEG + Math.random() * 0.08
      const pos: [number, number] = [center[0] + r * Math.cos(b), center[1] + r * Math.sin(b)]
      const dLng = center[0] - pos[0]
      const dLat = center[1] - pos[1]
      const heading = (Math.atan2(dLng, dLat) * 180) / Math.PI
      newDrones.push({
        id: `D-${state._droneSeq + i + 1}`,
        position: pos,
        heading,
        alive: true,
        detected: false,
        track: [pos],
        killAt: null,
      })
    }
    set({
      drones: [...state.drones, ...newDrones],
      _droneSeq: state._droneSeq + n,
      log: pushLog(state.log, `SWARM INBOUND — ${n} hostile UAV${n > 1 ? 's' : ''}`, 'warn'),
    })
  },

  tick: (dt: number) => {
    const state = get()
    if (!state.playing) return
    const sdt = dt * state.speed
    const at = state.animationTime + sdt
    const stepDeg = ((DRONE_SPEED_KMH * DRONE_SIM_SCALE) / 111) / 3600000 * sdt
    const fobs = state.fobs

    let relays = state.relays
    let log = state.log
    let packets = state.packets
    let interceptLines = state.interceptLines
    let packetSeq = state._packetSeq
    let kills = 0

    const drones: Drone[] = state.drones.map(d => {
      if (!d.alive) return d
      const target = nearestFob(d.position, fobs)
      const tgt = target ? target.position : FOB_POSITION
      const dLng = tgt[0] - d.position[0]
      const dLat = tgt[1] - d.position[1]
      const mag = Math.sqrt(dLng * dLng + dLat * dLat) || 1
      const newPos: [number, number] = [
        d.position[0] + (dLng / mag) * stepDeg,
        d.position[1] + (dLat / mag) * stepDeg,
      ]
      const heading = (Math.atan2(dLng, dLat) * 180) / Math.PI
      const track = d.track.length > 60 ? [...d.track.slice(-60), newPos] : [...d.track, newPos]
      let detected = d.detected

      if (!detected) {
        for (const relay of relays) {
          if (relay.status !== 'online') continue
          if (distanceKm(relay.position, newPos) <= relay.range) {
            detected = true
            const waypoints = routeToFob(relay.id, relays, state.connections, fobs)
            if (waypoints) {
              packetSeq += 1
              packets = [...packets, makePacket(waypoints, at, packetSeq)]
            }
            log = pushLog(log, `${relay.id}: THREAT DETECTED — routing to FOB`, 'alert')
            break
          }
        }
      }

      if (target && distanceKm(newPos, target.position) <= INTERCEPT_RADIUS_KM) {
        kills += 1
        interceptLines = [
          ...interceptLines,
          { id: `i${d.id}`, from: target.position, to: newPos, expiry: at + 700 },
        ]
        log = pushLog(log, `${d.id}: NEUTRALIZED by ${target.id} intercept`, 'kill')
        return { ...d, position: newPos, heading, track, detected, alive: false, killAt: at }
      }

      return { ...d, position: newPos, heading, track, detected }
    })

    relays = relays.map(r => {
      if (r.status !== 'online') return r
      const alert = drones.some(d => d.alive && distanceKm(d.position, r.position) <= r.range)
      return alert === !!r.alert ? r : { ...r, alert }
    })

    const liveDrones = drones.filter(d => d.alive || (d.killAt !== null && at - d.killAt < 1200))
    interceptLines = interceptLines.filter(l => l.expiry > at)
    packets = packets.filter(p => at - p.endTime < PACKET_TRAIL_MS)

    set({
      animationTime: at,
      drones: liveDrones,
      relays,
      packets,
      interceptLines,
      log,
      threatsNeutralized: state.threatsNeutralized + kills,
      _packetSeq: packetSeq,
    })
  },
}))
