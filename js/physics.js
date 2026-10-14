// N-body gravity in SI units. No DOM access here, so this file can be tested headless.
// Massive bodies (Sun, planets, dwarf planets, moons, comets) all pull on each other.
// Test particles (asteroids, Trojans, meteor-stream debris) feel the Sun and planets but pull on nothing.

const TRAIL_POINTS = 240;
const GROUP_BELT = 0, GROUP_TROJAN = 1, GROUP_STREAM = 2;   // stream k uses group 2 + k

let bodies = [];
let simTime = 0;          // seconds since J2000
let onMerge = null;       // optional callback (survivor, absorbed) for the UI
let particles = null;     // { n, x, y, z, vx, vy, vz, ax, ay, az, group, alive }
let streams = [];         // { name, parent, group, orbit (Float64Array of x,y,z in AU, Sun-relative) }

// Small seeded random generator so Reset rebuilds the same asteroid belt
function seededRandom(seed) {
  return () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// Orbital elements → position and velocity relative to the central body.
// Solves Kepler's equation M = E − e·sin E, then rotates the orbit plane into ecliptic coordinates.
function elementsToState([aAU, e, I, L, varpi, Omega], mu) {
  const a = aAU * AU;
  I *= DEG; L *= DEG; varpi *= DEG; Omega *= DEG;
  const w = varpi - Omega;                                  // argument of perihelion
  const M = (((L - varpi) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);  // mean anomaly

  let E = e < 0.8 ? M : Math.PI;                            // Newton's method for Kepler's equation
  for (let k = 0; k < 50; k++) {
    const dE = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    E -= dE;
    if (Math.abs(dE) < 1e-14) break;
  }

  const cosE = Math.cos(E), sinE = Math.sin(E);
  const b = a * Math.sqrt(1 - e * e);
  const xp = a * (cosE - e), yp = b * sinE;                 // position in orbit plane
  const n = Math.sqrt(mu / (a * a * a));                    // mean motion (Kepler's third law)
  const Edot = n / (1 - e * cosE);
  const vxp = -a * sinE * Edot, vyp = b * cosE * Edot;      // speed satisfies vis-viva: v² = μ(2/r − 1/a)

  const cw = Math.cos(w), sw = Math.sin(w), cO = Math.cos(Omega), sO = Math.sin(Omega), cI = Math.cos(I), sI = Math.sin(I);
  const rot = (x, y) => [
    (cw * cO - sw * sO * cI) * x + (-sw * cO - cw * sO * cI) * y,
    (cw * sO + sw * cO * cI) * x + (-sw * sO + cw * cO * cI) * y,
    (sw * sI) * x + (cw * sI) * y,
  ];
  return { pos: rot(xp, yp), vel: rot(vxp, vyp), period: 2 * Math.PI / n };
}

function moonElements(m) {
  return [m.aKm * 1000 / AU, m.e, m.i, m.M + m.peri + m.node, m.peri + m.node, m.node];
}

function makeBody(d, kind, pos, vel, trailEvery, spinPeriod) {
  return {
    name: d.name, kind, data: d, color: d.color, parent: d.parent || null,
    mass: d.mass, baseMass: d.mass, radius: d.radius, baseRadius: d.radius,
    x: pos[0], y: pos[1], z: pos[2], vx: vel[0], vy: vel[1], vz: vel[2],
    ax: 0, ay: 0, az: 0,
    trail: [], trailEvery, trailT: 0, noTrail: kind === 'moon',
    spinPeriod,
  };
}

// A planet (or dwarf planet) together with its moons. The orbital elements describe the system's
// barycenter, so the planet and moons are placed around it with zero net offset.
function addSystem(d, kind) {
  const moons = MOON_DATA.filter(m => m.parent === d.name);
  const mSys = d.mass + moons.reduce((s, m) => s + m.mass, 0);
  const s = elementsToState(d.el, G * (SUN_DATA.mass + mSys));
  const rel = moons.map(m => ({ m, st: elementsToState(moonElements(m), G * (d.mass + m.mass)) }));

  const bp = [0, 0, 0], bv = [0, 0, 0];
  for (const { m, st } of rel) for (let k = 0; k < 3; k++) {
    bp[k] += m.mass * st.pos[k] / mSys;
    bv[k] += m.mass * st.vel[k] / mSys;
  }

  const trailEvery = kind === 'comet' ? Math.min(s.period / TRAIL_POINTS, 10 * DAY) : s.period / TRAIL_POINTS;
  bodies.push(makeBody(d, kind, s.pos.map((c, k) => c - bp[k]), s.vel.map((c, k) => c - bv[k]), trailEvery, d.spinDays * DAY));
  for (const { m, st } of rel) {
    bodies.push(makeBody(m, 'moon',
      s.pos.map((c, k) => c + st.pos[k] - bp[k]),
      s.vel.map((c, k) => c + st.vel[k] - bv[k]),
      Infinity, st.period));                                 // tidally locked: one spin per orbit
  }
}

function initParticles() {
  const rand = seededRandom(20000101);
  const muSun = G * SUN_DATA.mass;
  const list = [];   // [pos, vel, group]

  // Main belt, avoiding the Kirkwood gaps cleared by resonances with Jupiter
  while (list.length < BELT_COUNT) {
    const a = 2.1 + rand() * 1.2;
    if (KIRKWOOD_GAPS.some(g => Math.abs(a - g) < 0.03)) continue;
    const s = elementsToState(classic(a, rand() * 0.18, rand() * rand() * 22, rand() * 360, rand() * 360, rand() * 360), muSun);
    list.push([s.pos, s.vel, GROUP_BELT]);
  }

  // Jupiter Trojans: share Jupiter's orbit, 60° ahead (L4) and behind (L5)
  const jup = PLANET_DATA.find(p => p.name === 'Jupiter').el;
  for (let k = 0; k < TROJAN_COUNT; k++) {
    const side = k % 2 ? 60 : -60;
    const el = [jup[0] * (1 + (rand() - 0.5) * 0.02), rand() * 0.08, rand() * rand() * 25,
                jup[3] + side + (rand() - 0.5) * 30, rand() * 360, rand() * 360];
    const s = elementsToState(el, muSun);
    list.push([s.pos, s.vel, GROUP_TROJAN]);
  }

  // Meteor streams: debris spread along the parent comet's orbit
  streams = STREAM_DATA.map((sd, k) => {
    const [a, e, i, , varpi, node] = COMET_DATA.find(c => c.name === sd.parent).el;
    for (let j = 0; j < sd.count; j++) {
      const el = [a * (1 + (rand() - 0.5) * 0.03), Math.min(0.995, e + (rand() - 0.5) * 0.006), i + (rand() - 0.5) * 0.8,
                  varpi + rand() * 360, varpi + (rand() - 0.5) * 0.8, node + (rand() - 0.5) * 0.8];
      const s = elementsToState(el, muSun);
      list.push([s.pos, s.vel, GROUP_STREAM + k]);
    }
    return { name: sd.name, parent: sd.parent, range: sd.range, group: GROUP_STREAM + k, orbit: orbitPolyline(COMET_DATA.find(c => c.name === sd.parent).el) };
  });

  const n = list.length;
  const f = () => new Float64Array(n);
  particles = { n, x: f(), y: f(), z: f(), vx: f(), vy: f(), vz: f(), ax: f(), ay: f(), az: f(),
                group: new Uint8Array(n), alive: new Uint8Array(n).fill(1) };
  list.forEach(([p, v, g], k) => {
    particles.x[k] = p[0]; particles.y[k] = p[1]; particles.z[k] = p[2];
    particles.vx[k] = v[0]; particles.vy[k] = v[1]; particles.vz[k] = v[2];
    particles.group[k] = g;
  });
}

// Points along an orbit, in AU relative to the Sun (used to detect meteor showers).
// Sampled evenly in true anomaly ν with r = a(1 − e²) / (1 + e·cos ν), so points stay dense near perihelion.
function orbitPolyline([a, e, I, , varpi, Omega], points = 2880) {
  I *= DEG; varpi *= DEG; Omega *= DEG;
  const w = varpi - Omega, p = a * (1 - e * e);
  const cw = Math.cos(w), sw = Math.sin(w), cO = Math.cos(Omega), sO = Math.sin(Omega), cI = Math.cos(I), sI = Math.sin(I);
  const out = new Float64Array(points * 3);
  for (let k = 0; k < points; k++) {
    const nu = k / points * 2 * Math.PI;
    const r = p / (1 + e * Math.cos(nu));
    const x = r * Math.cos(nu), y = r * Math.sin(nu);
    out[k * 3]     = (cw * cO - sw * sO * cI) * x + (-sw * cO - cw * sO * cI) * y;
    out[k * 3 + 1] = (cw * sO + sw * cO * cI) * x + (-sw * sO + cw * cO * cI) * y;
    out[k * 3 + 2] = (sw * sI) * x + (cw * sI) * y;
  }
  return out;
}

function initialState() {
  simTime = 0;
  bodies = [makeBody(SUN_DATA, 'star', [0, 0, 0], [0, 0, 0], 20 * DAY, SUN_DATA.spinDays * DAY)];
  for (const p of PLANET_DATA) addSystem(p, 'planet');
  for (const d of DWARF_DATA) addSystem(d, 'dwarf');
  for (const c of COMET_DATA) addSystem(c, 'comet');
  initParticles();

  // Move everything (particles too) to the center-of-mass frame so total momentum is zero
  let M = 0, cx = 0, cy = 0, cz = 0, px = 0, py = 0, pz = 0;
  for (const b of bodies) {
    M += b.mass;
    cx += b.mass * b.x; cy += b.mass * b.y; cz += b.mass * b.z;
    px += b.mass * b.vx; py += b.mass * b.vy; pz += b.mass * b.vz;
  }
  cx /= M; cy /= M; cz /= M; px /= M; py /= M; pz /= M;
  for (const b of bodies) {
    b.x -= cx; b.y -= cy; b.z -= cz;
    b.vx -= px; b.vy -= py; b.vz -= pz;
  }
  const P = particles;
  for (let k = 0; k < P.n; k++) {
    P.x[k] -= cx; P.y[k] -= cy; P.z[k] -= cz;
    P.vx[k] -= px; P.vy[k] -= py; P.vz[k] -= pz;
  }
  accelerations();
  particleAccelerations();
}

// Newton's law of universal gravitation: a_i = Σ G·m_j·(r_j − r_i) / |r_j − r_i|³
function accelerations() {
  for (const b of bodies) { b.ax = 0; b.ay = 0; b.az = 0; }
  for (let i = 0; i < bodies.length; i++) {
    const bi = bodies[i];
    for (let j = i + 1; j < bodies.length; j++) {
      const bj = bodies[j];
      const dx = bj.x - bi.x, dy = bj.y - bi.y, dz = bj.z - bi.z;
      const r2 = dx * dx + dy * dy + dz * dz;
      const inv = G / (r2 * Math.sqrt(r2));
      const fi = inv * bj.mass, fj = inv * bi.mass;
      bi.ax += dx * fi; bi.ay += dy * fi; bi.az += dz * fi;
      bj.ax -= dx * fj; bj.ay -= dy * fj; bj.az -= dz * fj;
    }
  }
}

// Test particles feel only the star and planets. A particle that hits one is removed.
function particleAccelerations() {
  const P = particles;
  const attract = bodies.filter(b => b.kind === 'star' || b.kind === 'planet');
  for (let k = 0; k < P.n; k++) {
    if (!P.alive[k]) continue;
    let ax = 0, ay = 0, az = 0;
    for (const b of attract) {
      const dx = b.x - P.x[k], dy = b.y - P.y[k], dz = b.z - P.z[k];
      const r2 = dx * dx + dy * dy + dz * dz;
      if (r2 < b.radius * b.radius) { P.alive[k] = 0; break; }
      const inv = G * b.mass / (r2 * Math.sqrt(r2));
      ax += dx * inv; ay += dy * inv; az += dz * inv;
    }
    P.ax[k] = ax; P.ay[k] = ay; P.az[k] = az;
  }
}

// Velocity Verlet (kick–drift–kick): symplectic, so energy stays bounded over long runs
function step(dt) {
  const h = 0.5 * dt, P = particles;
  for (const b of bodies) {
    b.vx += h * b.ax; b.vy += h * b.ay; b.vz += h * b.az;
    b.x += dt * b.vx; b.y += dt * b.vy; b.z += dt * b.vz;
  }
  for (let k = 0; k < P.n; k++) {
    if (!P.alive[k]) continue;
    P.vx[k] += h * P.ax[k]; P.vy[k] += h * P.ay[k]; P.vz[k] += h * P.az[k];
    P.x[k] += dt * P.vx[k]; P.y[k] += dt * P.vy[k]; P.z[k] += dt * P.vz[k];
  }
  accelerations();
  particleAccelerations();
  for (const b of bodies) {
    b.vx += h * b.ax; b.vy += h * b.ay; b.vz += h * b.az;
  }
  for (let k = 0; k < P.n; k++) {
    if (!P.alive[k]) continue;
    P.vx[k] += h * P.ax[k]; P.vy[k] += h * P.ay[k]; P.vz[k] += h * P.az[k];
  }
  handleCollisions(dt);
  simTime += dt;

  for (const b of bodies) {
    if (b.noTrail) continue;
    b.trailT += dt;
    if (b.trailT >= b.trailEvery) {
      b.trailT = 0;
      b.trail.push([b.x, b.y, b.z]);
      if (b.trail.length > TRAIL_POINTS) b.trail.shift();
    }
  }
}

// Bodies that came closer than the sum of their real radii during the last step merge.
// The check uses the closest approach along the step, so a fast body can't jump straight
// through another between two steps. Mass adds, momentum is conserved, density is kept:
// r = (r₁³ + r₂³)^(1/3).
function handleCollisions(dt) {
  let merged = false;
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      const a = bodies[i], b = bodies[j];
      const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
      const vx = b.vx - a.vx, vy = b.vy - a.vy, vz = b.vz - a.vz;
      const v2 = vx * vx + vy * vy + vz * vz;
      const s = v2 > 0 ? Math.min(Math.max((dx * vx + dy * vy + dz * vz) / v2, 0), dt) : 0;
      const cx = dx - vx * s, cy = dy - vy * s, cz = dz - vz * s;
      const rr = a.radius + b.radius;
      if (cx * cx + cy * cy + cz * cz >= rr * rr) continue;

      const big = a.mass >= b.mass ? a : b, small = big === a ? b : a;
      const m = big.mass + small.mass;
      big.x  = (big.mass * big.x  + small.mass * small.x)  / m;
      big.y  = (big.mass * big.y  + small.mass * small.y)  / m;
      big.z  = (big.mass * big.z  + small.mass * small.z)  / m;
      big.vx = (big.mass * big.vx + small.mass * small.vx) / m;
      big.vy = (big.mass * big.vy + small.mass * small.vy) / m;
      big.vz = (big.mass * big.vz + small.mass * small.vz) / m;
      big.radius = Math.cbrt(big.radius ** 3 + small.radius ** 3);
      big.mass = m;                        // baseMass stays the real value, so the slider can still return to 1×
      bodies.splice(bodies.indexOf(small), 1);
      for (const o of bodies) if (o.parent === small.name) o.parent = big.name;
      if (onMerge) onMerge(big, small);
      merged = true;
      i = -1; break;                       // restart scan after the array changed
    }
  }
  if (merged) accelerations();
}

// Total mechanical energy of the massive bodies: kinetic + gravitational potential
function totalEnergy() {
  let K = 0, U = 0;
  for (let i = 0; i < bodies.length; i++) {
    const a = bodies[i];
    K += 0.5 * a.mass * (a.vx * a.vx + a.vy * a.vy + a.vz * a.vz);
    for (let j = i + 1; j < bodies.length; j++) {
      const b = bodies[j];
      U -= G * a.mass * b.mass / Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    }
  }
  return K + U;
}

// Which meteor stream Earth is passing through right now (or null).
// Earth is "in" a stream when it is within the stream's `range` (AU) of the parent comet's orbit.
function activeShower() {
  const earth = bodies.find(b => b.name === 'Earth'), sun = bodies.find(b => b.name === 'Sun');
  if (!earth || !sun) return null;
  const ex = (earth.x - sun.x) / AU, ey = (earth.y - sun.y) / AU, ez = (earth.z - sun.z) / AU;
  for (const s of streams) {
    const o = s.orbit, range = s.range;
    for (let k = 0; k < o.length; k += 3) {
      const dx = o[k] - ex, dy = o[k + 1] - ey, dz = o[k + 2] - ez;
      if (dx * dx + dy * dy + dz * dz < range * range) return s.name;
    }
  }
  return null;
}
