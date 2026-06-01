import { IconLayer, PathLayer } from '@deck.gl/layers'
import { PathStyleExtension } from '@deck.gl/extensions'
import type { Drone } from '../sim/state'

const ICON_URL: Record<Drone['kind'], string> = {
  AIR: '/drone.svg',
  WATER: '/vessel.svg',
  GROUND: '/vehicle.svg',
}

// Attacking hostiles render red for contrast; shape (chevron / diamond / square)
// tells the class apart. Slight shade variation keeps them distinguishable.
const HOSTILE_COLOR: Record<Drone['kind'], [number, number, number, number]> = {
  AIR: [235, 80, 70, 245],      // bright red
  WATER: [225, 95, 125, 245],   // red-pink (reads on blue water)
  GROUND: [205, 65, 55, 245],   // deep red
}

// Ambient patrollers are non-engaging — a muted slate-amber so they read as
// "tracked but passive," clearly distinct from the red attack threats.
const PATROL_COLOR: [number, number, number, number] = [150, 140, 96, 205]

const droneColor = (d: Drone): [number, number, number, number] =>
  d.behavior === 'patrol' ? PATROL_COLOR : HOSTILE_COLOR[d.kind]

export function buildDroneLayer(drones: Drone[]) {
  return new IconLayer({
    id: 'drones',
    data: drones.filter(d => d.alive),
    getPosition: (d: Drone) => d.position,
    getIcon: (d: Drone) => ({
      url: ICON_URL[d.kind],
      width: 64,
      height: 64,
      anchorY: 32,
      mask: true, // use the SVG as a shape mask so getColor tints it
    }),
    getSize: (d: Drone) => (d.kind === 'AIR' ? 26 : 24),
    // Ground/surface icons aren't directional chevrons, so only rotate the UAV.
    getAngle: (d: Drone) => (d.kind === 'AIR' ? -d.heading : 0),
    getColor: droneColor,
    updateTriggers: {
      getIcon: drones.map(d => d.kind).join(),
      getColor: drones.map(d => `${d.kind}-${d.behavior}`).join(),
    },
    pickable: false,
  })
}

interface TrackItem {
  positions: [number, number][]
  patrol: boolean
}

export function buildDroneTrackLayer(drones: Drone[]) {
  const data: TrackItem[] = drones
    .filter(d => d.track.length > 1)
    .map(d => ({ positions: d.track, patrol: d.behavior === 'patrol' }))
  return new PathLayer({
    id: 'drone-tracks',
    data,
    getPath: (d: TrackItem) => d.positions,
    // Patrol trails read faint and neutral; attack trails stay red.
    getColor: (d: TrackItem): [number, number, number, number] =>
      d.patrol ? [150, 140, 96, 55] : [210, 80, 70, 90],
    getWidth: 1,
    widthMinPixels: 1,
    getDashArray: [4, 4],
    dashJustified: true,
    updateTriggers: { getColor: data.map(d => d.patrol).join() },
    extensions: [new PathStyleExtension({ dash: true })],
    pickable: false,
  })
}
