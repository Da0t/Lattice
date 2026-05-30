import { ScatterplotLayer } from '@deck.gl/layers'
import type { Relay } from '../sim/mesh'

export function buildRelayLayer(relays: Relay[]) {
  return new ScatterplotLayer({
    id: 'relay-nodes',
    data: relays.filter(r => r.status !== 'offline'),
    getPosition: (d: Relay) => d.position,
    getRadius: 600,
    getFillColor: (d: Relay) => {
      switch (d.status) {
        case 'online':    return d.alert ? [122, 106, 58, 220] : [74, 106, 122, 180]
        case 'booting':   return [74, 106, 122, 80]
        case 'destroyed': return [58, 58, 58, 120]
        default:          return [74, 106, 122, 180]
      }
    },
    radiusMinPixels: 5,
    radiusMaxPixels: 11,
    transitions: { getFillColor: 500, getRadius: 300 },
    pickable: true,
  })
}

export function buildRingLayer(relays: Relay[]) {
  return new ScatterplotLayer({
    id: 'detection-rings',
    data: relays.filter(r => r.status === 'online'),
    getPosition: (d: Relay) => d.position,
    getRadius: (d: Relay) => d.range * 1000,
    getFillColor: [0, 0, 0, 0],
    getLineColor: (d: Relay) => d.alert
      ? [122, 106, 58, 60]
      : [74, 106, 122, 25],
    stroked: true,
    lineWidthMinPixels: 1,
    filled: false,
    pickable: false,
  })
}
