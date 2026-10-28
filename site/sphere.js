/* Puzzle sphere - generated from _brand/sphere.ts; do not edit. */
(function () {
/**
 * The puzzle sphere: a twisty-puzzle ball, drawn in 3D without a 3D library.
 *
 * Three layers stacked along the vertical axis (top cap, middle band, bottom cap), each cut into
 * eight wedges, with a small pole cap at each end and a dark core that shows through the seams.
 * "Solved" means every column of wedges is one color from pole to pole. Twisting a layer turns it
 * around the vertical axis, which is the only axis this puzzle twists on.
 *
 * Rendering is two passes:
 *  1. Geometry. Each wedge's outline is sampled on the unit sphere, rotated and orthographically
 *     projected. Outline points on the far side are pushed out to the silhouette, which clips the
 *     wedge at the horizon - so a wedge turning out of view slides around the edge instead of
 *     popping. Each wedge is one flat-colored polygon.
 *  2. Light. One set of gradients over the whole ball: a soft key light, a gloss spot and a shadow
 *     toward the rim. The light stays put while the layers turn under it, as it would in life.
 *
 * Both passes are plain data, so the same code draws SVG (the logo, the favicon) and canvas (the
 * loader). Pure TypeScript with no imports, so it also runs under plain Node.
 */

const SPHERE_PURPLES = {
  deep: '#4b22b8',
  mid: '#7140ea',
  light: '#a07cff',
  pale: '#d4c4ff',
  core: '#1a0b45',
  pole: '#2d1580',
}         

/** Wedge colors around a solved column, starting at the front. Alternating depth keeps seams readable. */
const COLUMN_COLORS = [
  SPHERE_PURPLES.deep,
  SPHERE_PURPLES.light,
  SPHERE_PURPLES.mid,
  SPHERE_PURPLES.pale,
  SPHERE_PURPLES.deep,
  SPHERE_PURPLES.light,
  SPHERE_PURPLES.mid,
  SPHERE_PURPLES.pale,
]

const WEDGES = COLUMN_COLORS.length
const WEDGE_DEG = 360 / WEDGES

/** Latitude bounds of each layer, top to bottom, in degrees. Beyond ±78° are the pole caps. */
const LAYERS = [
  { from: 78, to: 30 },
  { from: 30, to: -30 },
  { from: -30, to: -78 },
]         
const POLE_LAT = 78

/** Seam width, in degrees of arc. */
const GAP_LON = 2.4
const GAP_LAT = 2.4

/** Outline samples per edge: enough that a clipped horizon reads as a curve, not a chord. */
const LON_SAMPLES = 14
const LAT_SAMPLES = 10

                              
                                                                  
             
                                                                                      
                                           
                                                                                   
               
 

                        
                            
              
 

                              
            
            
           
                 
 

/** One wedge twist; the static logo sits exactly one of these away from solved. */
const TWIST = WEDGE_DEG

/**
 * The lighting pass, in fractions of the ball's bounding box. Radial gradients: centre, radius and
 * color stops. Drawn in order over the pieces.
 */
const SPHERE_LIGHT = [
  // Key light from the upper left.
  { cx: 0.34, cy: 0.28, r: 0.7, stops: [[0, 'rgba(255,255,255,0.42)'], [0.35, 'rgba(255,255,255,0.12)'], [0.7, 'rgba(255,255,255,0)']] },
  // Form shadow: the far side of the ball turns away from the light.
  { cx: 0.4, cy: 0.34, r: 0.78, stops: [[0.42, 'rgba(14,4,46,0)'], [0.8, 'rgba(14,4,46,0.32)'], [1, 'rgba(14,4,46,0.62)']] },
  // Gloss spot.
  { cx: 0.33, cy: 0.24, r: 0.13, stops: [[0, 'rgba(255,255,255,0.75)'], [1, 'rgba(255,255,255,0)']] },
]         

/** Builds one frame: the ball's circle and every visible piece, projected into a `size`×`size` box. */
function sphereFrame(state             , size = 100)              {
  const c = size / 2
  const R = size * 0.46
  const tilt = ((state.tilt ?? 22) * Math.PI) / 180
  const ct = Math.cos(tilt)
  const st = Math.sin(tilt)

  /** Screen point for (lat, lon), and whether it faces the viewer. */
  const project = (latDeg        , lonDeg        )                                          => {
    const lat = (latDeg * Math.PI) / 180
    const lon = (lonDeg * Math.PI) / 180
    const x = Math.cos(lat) * Math.sin(lon)
    const y0 = Math.sin(lat)
    const z0 = Math.cos(lat) * Math.cos(lon)
    let y = y0 * ct - z0 * st
    const z = y0 * st + z0 * ct
    let px = x
    if (z < 0) {
      // Behind the horizon: slide out to the silhouette along the same bearing.
      const len = Math.hypot(x, y) || 1
      px = x / len
      y = y / len
    }
    return { p: [+(c + R * px).toFixed(2), +(c - R * y).toFixed(2)], front: z > 0.001 }
  }

  /** A lat/lon rectangle as an outline polygon; null when none of it faces the viewer. */
  const patch = (lat0        , lat1        , lon0        , lon1        , fill        )               => {
    const outline                                            = []
    for (let i = 0; i <= LON_SAMPLES; i++) outline.push(project(lat0, lon0 + ((lon1 - lon0) * i) / LON_SAMPLES))
    for (let i = 1; i <= LAT_SAMPLES; i++) outline.push(project(lat0 + ((lat1 - lat0) * i) / LAT_SAMPLES, lon1))
    for (let i = 1; i <= LON_SAMPLES; i++) outline.push(project(lat1, lon1 - ((lon1 - lon0) * i) / LON_SAMPLES))
    for (let i = 1; i < LAT_SAMPLES; i++) outline.push(project(lat1 - ((lat1 - lat0) * i) / LAT_SAMPLES, lon0))
    if (!outline.some((o) => o.front)) return null
    return { points: outline.map((o) => o.p), fill }
  }

  const pieces          = []
  LAYERS.forEach((layer, li) => {
    const turn = state.yaw + state.twists[li]
    const top = layer.from - GAP_LAT / 2
    const bottom = layer.to + GAP_LAT / 2
    for (let w = 0; w < WEDGES; w++) {
      const lon0 = w * WEDGE_DEG + turn + GAP_LON / 2
      const piece = patch(top, bottom, lon0, lon0 + WEDGE_DEG - GAP_LON, COLUMN_COLORS[w])
      if (piece) pieces.push(piece)
    }
  })

  // Pole caps: a ring of samples at the cap's edge. Only the top one is ever in view at this tilt.
  for (const sign of [1, -1]) {
    const ring = Array.from({ length: 48 }, (_, i) => project(sign * (POLE_LAT + GAP_LAT / 2), state.yaw + i * 7.5))
    if (ring.some((o) => o.front)) pieces.push({ points: ring.map((o) => o.p), fill: SPHERE_PURPLES.pole })
  }

  return { cx: c, cy: c, r: R, pieces }
}

const pathData = (points                    ) => 'M' + points.map((p) => p.join(' ')).join('L') + 'Z'

/**
 * The frame as SVG markup (no outer <svg>). `id` prefixes the gradient ids: give each inline copy
 * its own, or a copy inside a hidden element can break the others' gradients.
 */
function sphereSvgBody(state             , size = 100, id = 'sphere')         {
  const { cx, cy, r, pieces } = sphereFrame(state, size)
  const defs = SPHERE_LIGHT.map(
    (g, i) =>
      `<radialGradient id="${id}-l${i}" cx="${g.cx}" cy="${g.cy}" r="${g.r}">` +
      g.stops.map(([o, col]) => `<stop offset="${o}" stop-color="${col}"/>`).join('') +
      '</radialGradient>',
  ).join('')
  return [
    `<defs>${defs}</defs>`,
    `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${SPHERE_PURPLES.core}"/>`,
    ...pieces.map((p) => `<path d="${pathData(p.points)}" fill="${p.fill}"/>`),
    ...SPHERE_LIGHT.map((_, i) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#${id}-l${i})"/>`),
  ].join('')
}

/**
 * Draws one frame onto a 2D canvas context whose drawing area is `size`×`size` user units.
 * `clear: false` draws over what is there, for layering motion-blur samples.
 */
function drawSphere(ctx                          , state             , size        , clear = true)       {
  const { cx, cy, r, pieces } = sphereFrame(state, size)
  if (clear) ctx.clearRect(0, 0, size, size)
  const disc = () => {
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
  }
  disc()
  ctx.fillStyle = SPHERE_PURPLES.core
  ctx.fill()
  for (const piece of pieces) {
    ctx.beginPath()
    piece.points.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)))
    ctx.closePath()
    ctx.fillStyle = piece.fill
    ctx.fill()
  }
  // The SVG gradients use the ball's bounding box; mirror that here.
  const box = { x: cx - r, y: cy - r, d: r * 2 }
  for (const g of SPHERE_LIGHT) {
    const gx = box.x + g.cx * box.d
    const gy = box.y + g.cy * box.d
    const gradient = ctx.createRadialGradient(gx, gy, 0, gx, gy, g.r * box.d)
    for (const [offset, color] of g.stops) gradient.addColorStop(offset, color)
    disc()
    ctx.fillStyle = gradient
    ctx.fill()
  }
}

/** The logo's fixed pose: a three-quarter view, the middle band one twist off solved. */
const LOGO_POSE              = { yaw: 18, twists: [0, TWIST, 0], tilt: 22 }

/*
  The loader: wind up, let go, settle.
    1. Charge - a slow quarter-ish turn clockwise (seen from above), easing in like a spring loading.
    2. Release - a fast spin the other way for one second, three full turns, braking hard at the end.
    3. Rest - back exactly where it started, a beat of stillness, and again.
  Clockwise from above is negative yaw: the front of the ball drifts left.
*/
const CHARGE_MS = 800
const RELEASE_MS = 1000
const REST_MS = 500
const LOADER_CYCLE_MS = CHARGE_MS + RELEASE_MS + REST_MS
const CHARGE_DEG = -60
const RELEASE_TURNS = 3

const easeInOutSine = (p        ) => -(Math.cos(Math.PI * p) - 1) / 2
/** Starts at full speed and brakes: the spin is fastest the instant it is released. */
const easeOutQuart = (p        ) => 1 - Math.pow(1 - p, 4)

/** The loader's pose at `ms` since it started. Ends each cycle exactly on its starting pose. */
function loaderPose(ms        )              {
  const t = ms % LOADER_CYCLE_MS
  let yaw = 0
  if (t < CHARGE_MS) {
    yaw = CHARGE_DEG * easeInOutSine(t / CHARGE_MS)
  } else if (t < CHARGE_MS + RELEASE_MS) {
    const p = easeOutQuart((t - CHARGE_MS) / RELEASE_MS)
    yaw = CHARGE_DEG + (RELEASE_TURNS * 360 - CHARGE_DEG) * p
  }
  return { yaw, twists: [0, 0, 0], tilt: 22 }
}

/** Degrees of turn per motion-blur sample: below this a frame is drawn once, above it it is smeared. */
const BLUR_STEP_DEG = 4
const MAX_BLUR_SAMPLES = 14

/**
 * Draws the loader for the frame that ends at `ms`, with motion blur across the time since
 * `prevMs`. A fast spin covers more than a wedge per frame, which strobes - or reads as spinning
 * backwards - unless the frame shows the whole sweep. The sweep is drawn as equal-weight samples:
 * sample k goes down at alpha 1/k, which leaves every sample contributing the same share.
 */
function drawLoaderFrame(ctx                          , ms        , prevMs        , size        )       {
  const now = loaderPose(ms)
  const sweep = Math.abs(now.yaw - loaderPose(prevMs).yaw)
  // Across a cycle boundary the yaw jumps back by whole turns; that is not motion.
  const samples = sweep > 720 ? 1 : Math.min(MAX_BLUR_SAMPLES, Math.max(1, Math.ceil(sweep / BLUR_STEP_DEG)))
  if (samples === 1) {
    drawSphere(ctx, now, size)
    return
  }
  ctx.save()
  for (let k = 1; k <= samples; k++) {
    const t = prevMs + ((ms - prevMs) * k) / samples
    ctx.globalAlpha = 1 / k
    drawSphere(ctx, loaderPose(t), size, k === 1)
  }
  ctx.restore()
}

window.PuzzleSphere = { drawSphere: drawSphere, drawLoaderFrame: drawLoaderFrame, loaderPose: loaderPose, LOGO_POSE: LOGO_POSE };
})();
