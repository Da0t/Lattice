# design.md — Iron Veil

> Living design doc. Kept in sync with the implementation. Sections marked
> **[v2]** changed when the dashboard became an interactive live sandbox
> (manual relay/FOB deployment, drone swarms, signal-transmission pulses).

## Visual Rules

No border-radius on anything. Every element is sharp-cornered: panels, buttons, badges, inputs, cards, map container. Zero rounded corners across the entire UI.

Color palette is muted. No saturated blues, no bright greens. Everything sits in the black-to-dark-gray range with desaturated accent colors at low opacity.

```
Background:
  page:           #08090a
  panel:          #0c0d0f
  panel-border:   #1a1b1e
  panel-hover:    #111214

Text:
  primary:        #9a9b9e
  secondary:      #5a5b5e
  label:          #3a3b3e
  dim:            #2a2b2e

Accents (muted, used sparingly):
  node-healthy:   #4a6a7a      (desaturated steel blue)
  node-glow:      #4a6a7a18    (same at 10% opacity)
  transmit-ring:  #4a6a7a      (signal pulse, alpha fades 45->0) [v2]
  connection:     #3a5a4a      (muted teal-green)
  connection-alt: #5a4a6a      (muted purple, rerouted paths only)
  threat-warn:    #7a6a3a      (dark amber)
  threat-kill:    #7a3a3a      (dark red)
  data-packet:    #4a7a5a      (muted green)
  destroyed:      #3a3a3a      (gray, dead node)
```

All accent colors are heavily desaturated. Nothing glows bright. The UI should feel like looking at a screen in a dark room with the brightness turned down.

Typography is monospaced everywhere. No sans-serif anywhere in the app.

```
font-family: 'JetBrains Mono', 'Fira Code', monospace
font-size:
  data values:    12px
  labels:         10px, uppercase, letter-spacing: 0.1em
  log entries:    11px
  phase title:    13px
  top bar:        11px
```

Borders are 1px solid #1a1b1e. Never thicker. Never brighter.

No shadows, no glows, no gradients, no blur effects.

**[v2] Motion exception — signal transmission.** The original rule forbade
"pulsing dots." That is relaxed for one purpose only: online relays emit an
expanding "ping" ring to show they are actively transmitting on the mesh. The
pulse is a 1px stroked ring, muted teal (#4a6a7a), alpha fading from ~45 to 0 as
it expands from the node out to its range. It is the single permitted ambient
animation; it must stay dim and must never read as a glow. No other pulsing,
blinking, or decorative motion is allowed.

---

## Layout

```
┌──────────────────────────────────────────────────────────┐
│  // IRON VEIL                                 10:24 UTC  │
├────────────────────────────────┬─────────────────────────┤
│                                │  CONTROLS          [v2] │
│                                │  ──────────────────     │
│                                │  [Deploy Ring] [Clear]  │
│                                │  Click places: Relay/FOB│
│      MAP (mapbox + deck.gl)    │  Swarm: − 5 + [Launch]  │
│      70% width                 │  relays/fobs/threats... │
│      pitch: 45                 ├─────────────────────────┤
│      dark basemap              │  EVENT LOG              │
│                                │  10:24:03 R-01 ONLINE   │
│                                │  ...                    │
│                                ├─────────────────────────┤
│                                │  MESH STATUS            │
│                                │  nodes 10/10  links 13  │
│                                │  latency 8ms health 1.00│
├────────────────────────────────┴─────────────────────────┤
│  ◄  ■   SPEED 0.5× 1× 2× 4×   ▁▃▅▂▆  T+00:42  [LAUNCH] │
└──────────────────────────────────────────────────────────┘
```

The right column is three stacked panels: **CONTROLS** (top), **EVENT LOG**
(middle, fills), **MESH STATUS** (bottom). The top bar is the project name
left-aligned and a UTC clock right-aligned. **[v2]** The bottom bar is a
transport: reset · play/pause · speed (0.5/1/2/4×) · an activity waveform that
animates when threats are inbound · mission clock (T+mm:ss) · quick Launch Swarm
· inbound readout.

No decorative elements beyond the transmit pulse and the activity waveform.

---

## Simulation Model **[v2 — replaces the scripted phase machine]**

The sim is a **free-running interactive sandbox**, not a scripted scene. Nothing
auto-plays a storyline; the operator drives it. A single
`requestAnimationFrame` loop calls `tick(dt)` on the zustand store every frame;
`dt` is scaled by the transport speed.

Operator actions:

- **Deploy Ring** — places a preset staggered ring of relays around the primary
  FOB; mesh links auto-form.
- **Click map (Relay mode)** — drops one relay at the clicked coordinate; links
  re-form to any in-range neighbor.
- **Click map (FOB mode)** — drops a new FOB at the clicked coordinate. Multiple
  FOBs are supported; a default FOB-1 always exists. **[v2]**
- **Click a relay** — destroys it and triggers mesh self-heal (rerouted links go
  muted purple). Works in any placement mode.
- **Launch Swarm** — spawns N hostile drones (size 1–12) from a random edge
  around the primary FOB. Each flies to the **nearest** FOB; relays detect them
  and route threat packets through the mesh; the FOB intercepts on close
  approach.
- **Transport** — play/pause, speed 0.5–4×, Clear/reset.

State is continuous: detection, packet propagation, interception, and self-heal
all happen live and concurrently for any number of drones.

---

## Mesh Algorithm

Relays are not manually connected to each other. They discover each other by
proximity and form bidirectional links autonomously. When a relay dies, the mesh
reroutes through survivors.

### Node Placement

```ts
interface Relay {
  id: string
  position: [number, number]  // [lng, lat]
  range: number               // km, detection + comm radius
  status: 'offline' | 'booting' | 'online' | 'destroyed'
  connections: string[]
  alert?: boolean             // true while a live threat is in range [v2]
}
```

Ring placement uses polar coordinates with jitter around a center (the primary
FOB). Config: `RELAY_MIN_RADIUS_KM = 22`, `RELAY_MAX_RADIUS_KM = 32`, relay
`range = 22 + rand*8` km. These values are tuned so the ring is reliably
connected (a sparse ring can't route to the FOB).

### Connection Formation

When relays are online, every pair within each other's range forms a
bidirectional link. Latency ≈ `dist * 0.3 + rand*5` ms.

### Mesh Self-Healing

On destroy: mark `destroyed`, drop all its links, clear it from neighbor arrays,
then re-run `formConnections()` on survivors. Connections that did not exist
before are marked `rerouted` and render muted purple (#5a4a6a).

### Shortest Path (packet routing) **[v2 — multi-FOB]**

BFS from the detecting relay to the **nearest reachable FOB**. A virtual SINK
node is connected to every FOB so one BFS finds the closest; the SINK is then
stripped, leaving `relay → … → FOB` waypoints. Relays within
`FOB_LINK_RANGE_KM = 36` of a FOB connect to it.

---

## FOBs **[v2]**

```ts
interface Fob { id: string; position: [number, number] }
```

- A default `FOB-1` exists at the configured center; operators add more by
  clicking the map in FOB mode.
- Drones target the nearest FOB and are intercepted within
  `INTERCEPT_RADIUS_KM = 6` of it.
- Rendered as the brightest element on the map (#9a9b9e), same ScatterplotLayer
  spec as before but data is now the FOB array.

---

## Drones & Swarms **[v2 — array, was a single scripted drone]**

```ts
interface Drone {
  id: string
  position: [number, number]
  heading: number
  alive: boolean
  detected: boolean
  track: [number, number][]
  killAt: number | null
}
```

Each frame, every live drone steps toward its nearest FOB at a
demo-accelerated speed (`DRONE_SPEED_KMH * DRONE_SIM_SCALE`, since real 120 km/h
would take ~20 min to cross). On first entering a relay's range it is detected
(spawns a packet, relay goes amber). Within the FOB intercept radius it is
killed (red intercept line, removed after ~1.2 s). Relay `alert` is recomputed
each frame from live threats in range.

---

## deck.gl Layer Specs

Render order (bottom → top): detection rings, **transmit pulses [v2]**, mesh
arcs, relay nodes, FOBs, drone tracks, drones, data packets, intercept lines.

### Relay Nodes — ScatterplotLayer
`getFillColor` by status: online `[74,106,122,180]` (amber `[122,106,58,220]`
when `alert`), booting dim, destroyed `[58,58,58,120]`. `pickable: true` so map
clicks can destroy a relay. Color/radius transitions 500/300 ms.

### Detection Rings — ScatterplotLayer (stroked)
Per online relay, radius = `range * 1000` m. Line color amber when alert, else
barely-visible steel `[74,106,122,25]`. Transparent fill.

### Transmit Pulses — ScatterplotLayer (stroked) **[v2 — new]**
Per online relay, an expanding ring showing active transmission. Phase =
`((animationTime / TRANSMIT_PERIOD_MS) + perNodeOffset) % 1`; radius =
`phase * range * 1000` m; line alpha = `(1 - phase) * 45` (×70 when alert).
`perNodeOffset` is hashed from the relay id so pulses are desynchronized.
`updateTriggers` keyed on `animationTime`. Color steel `#4a6a7a` (amber when
alert). `TRANSMIT_PERIOD_MS = 2400`.

### Mesh Connections — ArcLayer
Source/target colors muted teal `[58,90,74,160]`, or muted purple
`[90,74,106,160]` when `rerouted`. **[v2]** `getHeight: 1.0` (was 0.25) for the
tall sweeping arcs in the reference; `greatCircle: false`; `widthMinPixels: 1.5`,
`widthMaxPixels: 3`.

### Data Packets — TripsLayer
Per packet: `path` waypoints + absolute `timestamps`. `currentTime =
animationTime`; `trailLength = PACKET_TRAIL_MS (600)`. Color muted green
`[74,122,90,220]`. Multiple concurrent packets supported (each carries its own
start/end time). `PACKET_DURATION_MS = 2500`.

### Drone — IconLayer
Data is the live-drone array. `getAngle: -heading`, color muted amber
`[122,106,58,220]`, icon `/drone.svg` (chevron).

### Drone Track — PathLayer
One dashed faint-amber path per drone (`PathStyleExtension({ dash: true })`),
track capped at 60 points.

### Intercept Lines — LineLayer
Data is the active intercept-line array (FOB → drone), muted red
`[122,58,58,200]`, expire ~700 ms after firing.

### FOB — ScatterplotLayer
Data is the FOB array. Fill `[154,155,158,200]` — brightest element.

---

## Mapbox Configuration

```ts
const MAP_CONFIG = {
  style: 'mapbox://styles/mapbox/dark-v11',
  center: [52.1, 32.9],     // primary FOB
  zoom: 9,
  pitch: 45,
  bearing: -15,
}
```

On `style.load`: background and water → `#08090a`; all symbol label text →
`#2a2b2e` with `#08090a` halo; boundary/admin lines → `#1a1b1e` at 0.3 opacity.

DeckGL `controller: true`; `getCursor` is crosshair normally, pointer when
hovering a relay; top-level `onClick` routes to destroy (hit a relay) or place
(empty map, by mode). Requires `NEXT_PUBLIC_MAPBOX_TOKEN` in `.env.local`.

---

## File Structure

```
dashboard/
  app/            page.tsx, layout.tsx, globals.css
  components/     Map, Controls [v2], EventLog, MeshStatus, Timeline (transport [v2]), TopBar
  layers/         relays, rings (in relays.ts), transmit [v2], arcs, drone, packets, intercept (+ fob)
  sim/            state.ts (zustand sandbox store [v2]), mesh.ts, pathfinding.ts
  data/           config.ts
  public/         drone.svg
```

---

## CSS Baseline

`* { border-radius: 0 }` globally. Page/panel/border/text variables as in the
palette. JetBrains Mono everywhere, 12px base, antialiased. Log entries colored
by level (warn/alert amber, kill red). `.stat-value` uses tabular-nums.

---

## Dependencies

next ^14.2, react ^18.3, mapbox-gl ^3.4, react-map-gl ^8 (imported via
`react-map-gl/mapbox`), @deck.gl/{core,react,layers,geo-layers,extensions} ^9,
zustand ^4.5, tailwindcss ^3.4.
