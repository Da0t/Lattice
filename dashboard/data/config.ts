export const FOB_POSITION: [number, number] = [52.1, 32.9]
export const RELAY_COUNT = 10
export const RELAY_MIN_RADIUS_KM = 22
export const RELAY_MAX_RADIUS_KM = 32
// Range (km) assigned to a relay placed manually or via the ring.
export const RELAY_RANGE_MIN_KM = 22
export const RELAY_RANGE_SPREAD_KM = 8

export const DRONE_SPEED_KMH = 120
// Demo time-acceleration: real-world 120km/h would take ~20 min to cross the
// field, so scale drone movement up for a watchable simulation.
export const DRONE_SIM_SCALE = 400

// Swarm spawn ring distance from FOB (degrees) and detonation/intercept radius.
export const SWARM_SPAWN_RADIUS_DEG = 0.62
export const SWARM_DEFAULT_SIZE = 5
export const SWARM_MAX_SIZE = 12
export const INTERCEPT_RADIUS_KM = 6

// Packet travel time through the mesh (ms) and trail fade length (ms).
export const PACKET_DURATION_MS = 2500
export const PACKET_TRAIL_MS = 600

export const FOB_LINK_RANGE_KM = 36

// Signal-transmission pulse: each online relay emits an expanding "ping" ring on
// this period (ms), phase-offset per node so they aren't synchronized.
export const TRANSMIT_PERIOD_MS = 2400

export const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || ''
