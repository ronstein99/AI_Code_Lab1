// Physical constants and the catalogue of bodies.
// Everything physical is in SI units (m, kg, s); orbital elements use AU and degrees.

const G   = 6.6743e-11;        // gravitational constant, m³ kg⁻¹ s⁻²
const AU  = 1.495978707e11;    // astronomical unit, m
const DAY = 86400;             // s
const YEAR = 365.25 * DAY;
const DT  = 3600;              // integration step: 1 hour of simulated time
const DEG = Math.PI / 180;
const J2000 = Date.UTC(2000, 0, 1, 12);
const EARTH_MASS = 5.9722e24;

// Element tuples used by elementsToState():
//   [a (AU), e, i (deg), L mean longitude (deg), ϖ longitude of perihelion (deg), Ω longitude of ascending node (deg)]
// Some sources list (a, e, i, Ω, ω, M) instead; this converts.
function classic(a, e, i, node, peri, M) {
  return [a, e, i, M + peri + node, peri + node, node];
}

// Sources: masses/radii from the NASA Planetary and Satellite Fact Sheets.
// Planet and Pluto elements: JPL "Approximate Positions of the Planets", J2000.
// tex: image in textures/ (Solar System Scope, CC BY 4.0). gen: recipe for the generated fallback texture.
// tilt: axial tilt (deg). spinDays: rotation period, negative = retrograde.

const SUN_DATA = {
  name: 'Sun', kind: 'star', mass: 1.98847e30, radius: 6.957e8, color: '#ffcc55',
  tilt: 7.25, spinDays: 25.38, tex: '2k_sun.jpg', gen: { type: 'sun' },
};

const PLANET_DATA = [
  { name: 'Mercury', mass: 3.3011e23, radius: 2.4397e6, color: '#aaa39a', tilt: 0.03, spinDays: 58.646,
    el: [0.38709927, 0.20563593, 7.00497902, 252.25032350, 77.45779628, 48.33076593],
    tex: '2k_mercury.jpg', gen: { type: 'rocky', base: [150, 140, 130], craters: 160 } },
  { name: 'Venus', mass: 4.8675e24, radius: 6.0518e6, color: '#e8c57d', tilt: 177.4, spinDays: -243.02,
    el: [0.72333566, 0.00677672, 3.39467605, 181.97909950, 131.60246718, 76.67984255],
    tex: '2k_venus_atmosphere.jpg', gen: { type: 'clouds', base: [226, 196, 140] } },
  { name: 'Earth', mass: 5.9722e24, radius: 6.371e6, color: '#4f8fe0', tilt: 23.44, spinDays: 0.99727,
    el: [1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0.0],
    tex: '2k_earth_daymap.jpg', night: '2k_earth_nightmap.jpg', clouds: '2k_earth_clouds.jpg', atmosphere: '#6fa8ff',
    gen: { type: 'earth' } },
  { name: 'Mars', mass: 6.4171e23, radius: 3.3895e6, color: '#d2663e', tilt: 25.19, spinDays: 1.02596,
    el: [1.52371034, 0.09339410, 1.84969142, -4.55343205, -23.94362959, 49.55953891],
    tex: '2k_mars.jpg', gen: { type: 'mars' } },
  { name: 'Jupiter', mass: 1.89813e27, radius: 6.9911e7, color: '#d9a066', tilt: 3.13, spinDays: 0.41354,
    el: [5.20288700, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909],
    tex: '2k_jupiter.jpg', gen: { type: 'gas', bands: [[200, 170, 135], [230, 215, 190], [170, 120, 85], [235, 225, 205]], spot: true } },
  { name: 'Saturn', mass: 5.6834e26, radius: 5.8232e7, color: '#e3cf8f', tilt: 26.73, spinDays: 0.44401,
    el: [9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448],
    tex: '2k_saturn.jpg', rings: { inner: 1.24, outer: 2.27, tex: '2k_saturn_ring_alpha.png', color: [230, 210, 170], opacity: 1 },
    gen: { type: 'gas', bands: [[220, 200, 150], [235, 220, 180], [200, 175, 125], [240, 230, 200]] } },
  { name: 'Uranus', mass: 8.6810e25, radius: 2.5362e7, color: '#90d4e2', tilt: 97.77, spinDays: -0.71833,
    el: [19.18916464, 0.04725744, 0.77263783, 313.23810451, 170.95427630, 74.01692503],
    tex: '2k_uranus.jpg', rings: { inner: 1.64, outer: 2.0, color: [160, 170, 180], opacity: 0.25 },
    gen: { type: 'gas', bands: [[160, 215, 225], [170, 222, 230], [150, 205, 218], [175, 225, 232]] } },
  { name: 'Neptune', mass: 1.02413e26, radius: 2.4622e7, color: '#5574e8', tilt: 28.32, spinDays: 0.67125,
    el: [30.06992276, 0.00859048, 1.77004347, -55.12002969, 44.96476227, 131.78422574],
    tex: '2k_neptune.jpg', gen: { type: 'gas', bands: [[60, 90, 200], [80, 115, 225], [50, 75, 180], [90, 125, 230]], spot: 'dark' } },
];

// Dwarf planets. Pluto uses JPL elements; the others use (a, e, i, Ω, ω) from the JPL Small-Body
// Database with an approximate mean anomaly for 2000, so their starting point on the orbit is approximate.
const DWARF_DATA = [
  { name: 'Pluto', mass: 1.303e22, radius: 1.1883e6, color: '#c9a98a', tilt: 122.53, spinDays: -6.3872,
    el: [39.48211675, 0.24882730, 17.14001206, 238.92903833, 224.06891629, 110.30393684],
    gen: { type: 'pluto' } },
  { name: 'Ceres', mass: 9.393e20, radius: 4.697e5, color: '#9a958e', tilt: 4, spinDays: 0.3781,
    el: classic(2.7691, 0.0760, 10.59, 80.31, 73.60, 6.0),
    tex: '2k_ceres_fictional.jpg', gen: { type: 'rocky', base: [125, 120, 115], craters: 120 } },
  { name: 'Haumea', mass: 4.006e21, radius: 8.16e5, color: '#d8d4cc', tilt: 0, spinDays: 0.1631,
    el: classic(43.12, 0.1912, 28.21, 122.17, 239.04, 195.0),
    tex: '2k_haumea_fictional.jpg', gen: { type: 'icy', base: [220, 215, 205] } },
  { name: 'Makemake', mass: 3.1e21, radius: 7.15e5, color: '#c98f6a', tilt: 0, spinDays: 0.9511,
    el: classic(45.43, 0.1610, 28.98, 79.62, 294.80, 150.0),
    tex: '2k_makemake_fictional.jpg', gen: { type: 'icy', base: [200, 140, 105] } },
  { name: 'Eris', mass: 1.6466e22, radius: 1.163e6, color: '#e3e0da', tilt: 0, spinDays: 15.786,
    el: classic(67.86, 0.4361, 44.04, 35.95, 151.64, 197.0),
    tex: '2k_eris_fictional.jpg', gen: { type: 'icy', base: [230, 228, 222] } },
];

// Moons: real mass, radius, semi-major axis and eccentricity. The orbit plane follows the parent's
// equator (given here relative to the ecliptic) and the starting point on the orbit (M) is spread out,
// not the true 2000 position. All are tidally locked, so they spin once per orbit.
// Phobos and Deimos are left out: Phobos orbits every 7.6 h, too fast for the 1-hour time step.
const MOON_DATA = [
  { name: 'Moon',     parent: 'Earth',   mass: 7.342e22,   radius: 1.7374e6, aKm: 384400,  e: 0.0549, i: 5.145, node: 125.08, peri: 318.15, M: 135.27,
    color: '#c9c9c9', tex: '2k_moon.jpg', gen: { type: 'rocky', base: [140, 140, 138], craters: 200 } },
  { name: 'Io',       parent: 'Jupiter', mass: 8.9319e22,  radius: 1.8216e6, aKm: 421700,  e: 0.0041, i: 2.21, node: 337, peri: 0, M: 0,
    color: '#e8d26a', gen: { type: 'io' } },
  { name: 'Europa',   parent: 'Jupiter', mass: 4.7998e22,  radius: 1.5608e6, aKm: 671034,  e: 0.0090, i: 2.68, node: 337, peri: 0, M: 90,
    color: '#d9cbb0', gen: { type: 'europa' } },
  { name: 'Ganymede', parent: 'Jupiter', mass: 1.4819e23,  radius: 2.6341e6, aKm: 1070412, e: 0.0013, i: 2.40, node: 337, peri: 0, M: 200,
    color: '#a39a8c', gen: { type: 'rocky', base: [130, 120, 105], craters: 90, patches: true } },
  { name: 'Callisto', parent: 'Jupiter', mass: 1.0759e23,  radius: 2.4103e6, aKm: 1882709, e: 0.0074, i: 2.02, node: 337, peri: 0, M: 300,
    color: '#7d7468', gen: { type: 'rocky', base: [95, 85, 75], craters: 260 } },
  { name: 'Rhea',     parent: 'Saturn',  mass: 2.3065e21,  radius: 7.638e5,  aKm: 527108,  e: 0.0013, i: 27.1, node: 169.5, peri: 0, M: 40,
    color: '#d6d3cd', gen: { type: 'rocky', base: [200, 198, 192], craters: 180 } },
  { name: 'Titan',    parent: 'Saturn',  mass: 1.3452e23,  radius: 2.5747e6, aKm: 1221870, e: 0.0288, i: 27.7, node: 169.5, peri: 0, M: 250,
    color: '#e0a64e', atmosphere: '#e8a850', gen: { type: 'clouds', base: [215, 160, 80] } },
  { name: 'Titania',  parent: 'Uranus',  mass: 3.4e21,     radius: 7.889e5,  aKm: 435910,  e: 0.0011, i: 97.8, node: 167.6, peri: 0, M: 60,
    color: '#bdb5aa', gen: { type: 'rocky', base: [170, 160, 150], craters: 140 } },
  { name: 'Oberon',   parent: 'Uranus',  mass: 3.076e21,   radius: 7.614e5,  aKm: 583520,  e: 0.0014, i: 97.8, node: 167.6, peri: 0, M: 220,
    color: '#a89e93', gen: { type: 'rocky', base: [150, 138, 128], craters: 170 } },
  { name: 'Triton',   parent: 'Neptune', mass: 2.139e22,   radius: 1.3534e6, aKm: 354759,  e: 0.000016, i: 130.0, node: 177.6, peri: 0, M: 10,
    color: '#e6d6cc', gen: { type: 'icy', base: [225, 205, 195] } },
  { name: 'Charon',   parent: 'Pluto',   mass: 1.586e21,   radius: 6.06e5,   aKm: 19591,   e: 0.0002, i: 112.9, node: 227.4, peri: 0, M: 0,
    color: '#9c9894', gen: { type: 'rocky', base: [130, 127, 124], craters: 90, cap: [120, 70, 60] } },
];

// Comets: real orbits (JPL Small-Body Database). M is set from each comet's real perihelion date,
// so they start where they really were on 1 Jan 2000. Masses and nucleus sizes are estimates.
const COMET_DATA = [
  { name: 'Halley',        mass: 2.2e14, radius: 5.5e3,  el: classic(17.834, 0.96714, 162.26, 58.42, 111.33, 66.4) },
  { name: 'Encke',         mass: 9.2e13, radius: 2.4e3,  el: classic(2.2150, 0.8483, 11.78, 334.57, 186.54, 284.6) },
  { name: 'Hale-Bopp',     mass: 1.3e16, radius: 3.0e4,  el: classic(186.0, 0.9951, 89.43, 282.47, 130.59, 0.39) },
  { name: 'Swift-Tuttle',  mass: 1.2e16, radius: 1.3e4,  el: classic(26.09, 0.9632, 113.45, 139.38, 152.98, 19.0) },
  { name: 'Tempel-Tuttle', mass: 1.2e13, radius: 1.8e3,  el: classic(10.33, 0.9055, 162.49, 235.27, 172.50, 19.9) },
].map(c => ({ ...c, color: '#bfe3ff', tilt: 0, spinDays: 2, gen: { type: 'comet' } }));

// Meteor showers: debris spread along the parent comet's orbit. Earth meets the stream where the orbits cross.
// range: how close (AU) Earth must pass to the comet's orbit to count as inside the stream.
// (Halley's other shower, the Orionids, crosses about 0.15 AU away, so it is not flagged.)
const STREAM_DATA = [
  { name: 'Perseids', parent: 'Swift-Tuttle', count: 220, range: 0.08 },
  { name: 'Leonids',  parent: 'Tempel-Tuttle', count: 180, range: 0.05 },
  { name: 'Eta Aquariids', parent: 'Halley', count: 220, range: 0.08 },
];

const BELT_COUNT = 500;     // main-belt asteroids
const TROJAN_COUNT = 150;   // Jupiter Trojans at L4 / L5
const KIRKWOOD_GAPS = [2.502, 2.825, 2.958, 3.279];   // AU: 3:1, 5:2, 7:3, 2:1 resonances with Jupiter
