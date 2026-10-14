// Panel, keyboard and the main loop.

const $ = id => document.getElementById(id);
const SUP = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '-': '⁻' };
function sci(v, unit) {
  const [m, e] = v.toExponential(3).split('e');
  return `${m} × 10${String(+e).replace(/./g, c => SUP[c])} ${unit}`;
}
function fmt(v, digits) { return v.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits }); }

const KIND_LABEL = { star: 'Star', planet: 'Planet', dwarf: 'Dwarf planet', moon: 'Moon', comet: 'Comet' };
const MAX_DAYS_PER_SECOND = 730;          // 2 years per second
const PHYSICS_BUDGET_MS = 12;             // per frame, so slower computers stay smooth

let paused = false;
let daysPerSecond = 20;
let cpuLimited = false;
let E0 = 0;

const ui = {
  selected: null,
  select(b) {
    this.selected = b;
    $('mass').value = Math.log10(b.mass / b.baseMass).toFixed(2);
    $('goto').value = b.name;
    updatePanel();
  },
};

function resetEnergyBaseline() { E0 = totalEnergy(); }

function updatePanel() {
  $('date').textContent = new Date(J2000 + simTime * 1000).toISOString().slice(0, 10);
  const drift = (totalEnergy() - E0) / Math.abs(E0) * 100;
  $('drift').textContent = `${drift >= 0 ? '+' : ''}${drift.toFixed(6)} %`;
  $('count').textContent = `${bodies.length} + ${particles.alive.reduce((s, a) => s + a, 0)} small`;

  const shower = activeShower();
  $('shower').hidden = !shower;
  if (shower) $('shower').textContent = `Earth is passing through the ${shower} meteor stream: a meteor shower on Earth.`;

  $('unfollow').hidden = !view.follow;
  $('hint2d').hidden = view.mode !== '2d';
  $('hint3d').hidden = view.mode !== '3d';
  $('speedOut').textContent = speedLabel() + (cpuLimited ? ' (CPU limit)' : '');

  const b = ui.selected;
  if (!b || !bodies.includes(b)) return;
  $('selName').textContent = b.name;
  $('selKind').textContent = KIND_LABEL[b.kind] + (b.kind === 'moon' && b.parent ? ` of ${b.parent}` : '');
  $('selDot').style.background = b.color;
  const mult = b.mass / b.baseMass;
  $('massOut').textContent = `${fmt(mult, mult < 10 ? 2 : 0)}×`;
  $('selMass').textContent = sci(b.mass, 'kg');
  const em = b.mass / EARTH_MASS;
  $('selEarths').textContent = em < 0.001 ? em.toExponential(2) : fmt(em, em < 10 ? 3 : 1);
  $('selRadius').textContent = `${fmt(b.radius / 1000, b.radius < 1e5 ? 1 : 0)} km`;
  const sun = bodies.find(o => o.name === 'Sun');
  $('selDist').textContent = sun && sun !== b ? `${fmt(Math.hypot(b.x - sun.x, b.y - sun.y, b.z - sun.z) / AU, 3)} AU` : '–';
  $('selSpeed').textContent = `${fmt(Math.hypot(b.vx, b.vy, b.vz) / 1000, 2)} km/s`;
}

function fillGotoList() {
  const sel = $('goto');
  sel.innerHTML = '';
  const groups = [['star', 'Sun'], ['planet', 'Planets'], ['dwarf', 'Dwarf planets'], ['moon', 'Moons'], ['comet', 'Comets']];
  for (const [kind, label] of groups) {
    const og = document.createElement('optgroup');
    og.label = label;
    for (const b of bodies.filter(o => o.kind === kind)) {
      const o = document.createElement('option');
      o.value = o.textContent = b.name;
      og.appendChild(o);
    }
    if (og.children.length) sel.appendChild(og);
  }
  if (ui.selected) sel.value = ui.selected.name;
}

onMerge = (big, small) => {
  flashes.push({ body: big, t: performance.now() });
  if (ui.selected === small) ui.selected = big;
  if (view.follow === small) view.follow = big;
  if (ui.selected === big) $('mass').value = Math.log10(big.mass / big.baseMass).toFixed(2);
  resetEnergyBaseline();      // a merge is an inelastic collision, so energy legitimately changes
  fillGotoList();
};

// ---------------- Controls ----------------
$('mass').addEventListener('input', () => {
  const b = ui.selected;
  if (!b) return;
  const mult = 10 ** +$('mass').value;
  b.mass = b.baseMass * mult;
  b.radius = b.baseRadius * Math.cbrt(mult);     // same density, so r ∝ m^(1/3)
  accelerations();
  particleAccelerations();
  resetEnergyBaseline();
  updatePanel();
});

function speedLabel() {
  return daysPerSecond >= 365 ? `${fmt(daysPerSecond / 365.25, 1)} years/s` : `${daysPerSecond} days/s`;
}
function updateSpeed() {
  daysPerSecond = Math.max(1, Math.round(10 ** (+$('speed').value / 100 * Math.log10(MAX_DAYS_PER_SECOND))));
  cpuLimited = false;
  $('speedOut').textContent = speedLabel();
}
$('speed').addEventListener('input', updateSpeed);

function setMode(mode) {
  view.mode = mode;
  $('mode2d').setAttribute('aria-pressed', mode === '2d');
  $('mode3d').setAttribute('aria-pressed', mode === '3d');
  updatePanel();
}
$('mode2d').addEventListener('click', () => setMode('2d'));
$('mode3d').addEventListener('click', () => setMode('3d'));

function togglePause() { paused = !paused; $('play').textContent = paused ? 'Play' : 'Pause'; }
function fitAll() { stopFollow(); view.target = [0, 0, 0]; view.span = 210; }
function reset() {
  initialState();
  resetEnergyBaseline();
  flashes = [];
  stopFollow();
  rebuildVisuals();
  fillGotoList();
  ui.select(bodies.find(b => b.name === 'Earth'));
}
$('play').addEventListener('click', togglePause);
$('reset').addEventListener('click', reset);
$('fit').addEventListener('click', fitAll);
$('focus').addEventListener('click', () => ui.selected && startFocus(ui.selected));
$('unfollow').addEventListener('click', () => { stopFollow(); updatePanel(); });
$('goto').addEventListener('change', () => {
  const b = bodies.find(o => o.name === $('goto').value);
  if (b) { ui.select(b); startFocus(b); }
});
$('truesize').addEventListener('change', e => { display.trueSize = e.target.checked; });
const LAYER_IDS = { layMoons: 'moons', layDwarfs: 'dwarfs', layComets: 'comets', layAsteroids: 'asteroids', layTrails: 'trails', layLabels: 'labels' };
for (const [id, key] of Object.entries(LAYER_IDS)) {
  $(id).addEventListener('change', e => { display.layers[key] = e.target.checked; });
}

window.addEventListener('keydown', e => {
  const tag = e.target.tagName;
  if (tag === 'SELECT' || (tag === 'INPUT' && e.target.type !== 'checkbox' && e.key !== ' ')) return;
  const k = e.key.toLowerCase();
  if (e.key === ' ') { e.preventDefault(); togglePause(); }
  else if (k === 'r') reset();
  else if (k === 'f') fitAll();
  else if (k === 'v') setMode(view.mode === '2d' ? '3d' : '2d');
  else if (k === 'g' && ui.selected) startFocus(ui.selected);
  else if (e.key === 'Escape') { stopFollow(); updatePanel(); }
});

window.addEventListener('resize', resizeRenderer);

// ---------------- Main loop ----------------
let lastFrame = performance.now(), simDebt = 0, lastPanel = 0;

function frame(now) {
  const real = Math.min((now - lastFrame) / 1000, 0.1);
  lastFrame = now;
  if (!paused) {
    simDebt += real * daysPerSecond * DAY;
    const start = performance.now();
    while (simDebt >= DT) {
      step(DT);
      simDebt -= DT;
      if (performance.now() - start > PHYSICS_BUDGET_MS) { cpuLimited = simDebt > DT * 2; simDebt = 0; break; }
    }
  }
  updateScene();
  if (now - lastPanel > 250) { updatePanel(); lastPanel = now; }
  requestAnimationFrame(frame);
}

// Optional start view from the link, e.g. index.html#3d/Saturn
function applyHash() {
  for (const part of decodeURIComponent(location.hash.slice(1)).split('/')) {
    if (part === '2d' || part === '3d') setMode(part);
    const b = bodies.find(o => o.name.toLowerCase() === part.toLowerCase());
    if (b) { ui.select(b); startFocus(b); view.fly.t0 -= 2000; }
  }
}

$('localNote').hidden = PHOTOS;
resizeRenderer();
updateSpeed();
reset();
applyHash();
requestAnimationFrame(frame);
