// Three.js rendering: one scene, two cameras (2D top-down orthographic, 3D perspective).
// Render units are AU. Positions are sent to the GPU relative to the camera target ("floating origin"),
// computed in double precision here, so zooming in on a moon 30 AU from the Sun does not jitter.

const glCanvas = document.getElementById('gl');
const overlay = document.getElementById('overlay');
const octx = overlay.getContext('2d');

const renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: true, logarithmicDepthBuffer: true });
renderer.outputEncoding = THREE.sRGBEncoding;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;

const scene = new THREE.Scene();
const FOV = 45;
const perspCam = new THREE.PerspectiveCamera(FOV, 1, 1e-9, 1e7);
perspCam.up.set(0, 0, 1);                                   // ecliptic north is up
const orthoCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 3e4);
orthoCam.up.set(0, 1, 0);

// Photos can't be used by WebGL when the page is opened as a local file, so use generated maps there
const PHOTOS = location.protocol !== 'file:';
const loader = new THREE.TextureLoader();

const sunLight = new THREE.PointLight(0xffffff, 3.2, 0, 0);
scene.add(sunLight);
scene.add(new THREE.AmbientLight(0x3a4152, 0.3));
const sunPosUniform = { value: new THREE.Vector3() };       // light position for the custom shaders

let W = 1, H = 1;
const view = {
  mode: '2d',
  target: [0, 0, 0],      // world position the camera looks at, in AU
  span: 13,               // visible height at the target, in AU
  theta: -Math.PI / 2,    // 3D orbit angles
  phi: 1.0,
  follow: null,           // body being followed
  fly: null,              // focus animation in progress
};
const display = { trueSize: false, layers: { moons: true, dwarfs: true, comets: true, asteroids: true, trails: true, labels: true } };
let flashes = [];

function camera() { return view.mode === '3d' ? perspCam : orthoCam; }

function resizeRenderer() {
  W = window.innerWidth; H = window.innerHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(dpr);
  renderer.setSize(W, H, false);
  overlay.width = Math.round(W * dpr); overlay.height = Math.round(H * dpr);
  octx.setTransform(dpr, 0, 0, dpr, 0, 0);
  updateSkyCrop();
}

// ---------------- Textures ----------------
const texCache = new Map();

function canvasTexture(canvas, srgb = true) {
  const t = new THREE.CanvasTexture(canvas);
  if (srgb) t.encoding = THREE.sRGBEncoding;
  t.anisotropy = 4;
  return t;
}

// Photo texture if available, otherwise (or if loading fails) a generated one
function colorTexture(file, recipe, w = 512, h = 256) {
  const key = (PHOTOS && file) || JSON.stringify(recipe) + w;
  if (texCache.has(key)) return texCache.get(key);
  let tex;
  if (PHOTOS && file) {
    tex = loader.load('textures/' + file, undefined, undefined, () => {
      tex.image = generateTexture(recipe, w, h);
      tex.needsUpdate = true;
    });
    tex.encoding = THREE.sRGBEncoding;
    tex.anisotropy = 8;
  } else {
    tex = canvasTexture(generateTexture(recipe, w, h));
  }
  texCache.set(key, tex);
  return tex;
}

function cloudTexture(file) {
  if (texCache.has('clouds')) return texCache.get('clouds');
  const gen = () => paintSphere(512, 256, (x, y, z) => {
    const v = 255 * smooth(0.5, 0.75, fbm(x * 3 + 2, y * 3, z * 6, 6));
    return [v, v, v];
  });
  let tex;
  if (PHOTOS && file) {
    tex = loader.load('textures/' + file, undefined, undefined, () => { tex.image = gen(); tex.needsUpdate = true; });
  } else {
    tex = canvasTexture(gen(), false);
  }
  texCache.set('clouds', tex);
  return tex;
}

const glowTexture = canvasTexture(makeGlowCanvas([255, 214, 140]));
const comaTexture = canvasTexture(makeGlowCanvas([190, 225, 255], 128));

// Sky: flat crop of the panorama in 2D, full panorama around the camera in 3D
let skyFlat, skyEquirect;
function setSky(canvas) {
  skyFlat = canvasTexture(canvas);
  skyEquirect = canvasTexture(canvas);
  skyEquirect.mapping = THREE.EquirectangularReflectionMapping;
  updateSkyCrop();
}
setSky(makeSkyCanvas(null));
if (PHOTOS) loader.load('textures/2k_stars_milky_way.jpg', t => setSky(makeSkyCanvas(t.image)));
function updateSkyCrop() {
  if (!skyFlat) return;
  const a = W / H;                    // the panorama is 2:1
  if (a < 2) { skyFlat.repeat.set(a / 2, 1); skyFlat.offset.set((1 - a / 2) / 2, 0); }
  else { skyFlat.repeat.set(1, 2 / a); skyFlat.offset.set(0, (1 - 2 / a) / 2); }
}

// ---------------- Materials ----------------
// Earth: daylight map, city lights only on the night side
function earthMaterial(d) {
  const mat = new THREE.MeshStandardMaterial({
    map: colorTexture(d.tex, d.gen), roughness: 0.9, metalness: 0,
    emissive: 0xffd9a0, emissiveIntensity: PHOTOS ? 1.4 : 0,
    emissiveMap: PHOTOS ? colorTexture(d.night, { type: 'icy', base: [0, 0, 0] }) : null,
  });
  mat.onBeforeCompile = shader => {
    shader.uniforms.sunPos = sunPosUniform;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWorldN;\nvarying vec3 vWorldP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWorldN = normalize(mat3(modelMatrix) * normal);\nvWorldP = (modelMatrix * vec4(position, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 sunPos;\nvarying vec3 vWorldN;\nvarying vec3 vWorldP;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance *= smoothstep(0.12, -0.18, dot(normalize(vWorldN), normalize(sunPos - vWorldP)));');
  };
  return mat;
}

// Thin glowing rim on the day side (Earth, Venus-like atmospheres, Titan)
function atmosphereMaterial(hex) {
  return new THREE.ShaderMaterial({
    uniforms: { glowColor: { value: new THREE.Color(hex) }, sunPos: sunPosUniform, ortho: { value: 0 } },
    vertexShader: `
      #include <common>
      #include <logdepthbuf_pars_vertex>
      varying vec3 vN; varying vec3 vView; varying vec3 vWorldN; varying vec3 vWorldP;
      uniform float ortho;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vView = ortho > 0.5 ? vec3(0.0, 0.0, 1.0) : normalize(-mv.xyz);
        vWorldN = normalize(mat3(modelMatrix) * normal);
        vWorldP = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * mv;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: `
      #include <common>
      #include <logdepthbuf_pars_fragment>
      uniform vec3 glowColor; uniform vec3 sunPos;
      varying vec3 vN; varying vec3 vView; varying vec3 vWorldN; varying vec3 vWorldP;
      void main() {
        #include <logdepthbuf_fragment>
        float rim = pow(1.0 - abs(dot(vN, vView)), 2.5);
        float day = smoothstep(-0.25, 0.35, dot(vWorldN, normalize(sunPos - vWorldP)));
        float a = rim * day;
        gl_FragColor = vec4(glowColor * a * 1.4, a);
      }`,
    blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
  });
}

function ringGeometry(inner, outer) {
  const g = new THREE.RingGeometry(inner, outer, 160, 1);
  const pos = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    uv.setXY(i, (Math.hypot(pos.getX(i), pos.getY(i)) - inner) / (outer - inner), 0.5);
  }
  return g;
}

// ---------------- Body visuals ----------------
const sphereGeo = new THREE.SphereGeometry(1, 64, 32);
const smallSphereGeo = new THREE.SphereGeometry(1, 32, 16);
const visuals = new Map();      // body → visual
const Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);

// Moon whose orbit plane marks the planet's equator (used to orient the planet and its rings)
const POLE_MOON = { Jupiter: 'Io', Saturn: 'Titan', Uranus: 'Titania', Pluto: 'Charon' };
function orbitNormal(iDeg, nodeDeg) {
  const i = iDeg * DEG, O = nodeDeg * DEG;
  return new THREE.Vector3(Math.sin(O) * Math.sin(i), -Math.cos(O) * Math.sin(i), Math.cos(i));
}
function poleOf(b) {
  const m = MOON_DATA.find(x => x.name === POLE_MOON[b.name]);
  if (m) return orbitNormal(m.i, m.node);
  // Tilted toward ecliptic longitude 90°, which gives Earth its real seasons (northern summer in June)
  return orbitNormal(b.data.tilt || 0, 180);
}

function createVisual(b) {
  const d = b.data;
  const group = new THREE.Group();
  scene.add(group);
  const small = b.kind === 'moon' || b.kind === 'comet';
  const geo = small ? smallSphereGeo : sphereGeo;
  const size = small ? [256, 128] : [512, 256];
  const v = { group, pole: poleOf(b) };
  v.poleQ = new THREE.Quaternion().setFromUnitVectors(Y, v.pole);

  let mat;
  if (b.kind === 'star') {
    mat = new THREE.MeshBasicMaterial({ map: colorTexture(d.tex, d.gen, ...size), toneMapped: false });
  } else if (d.night) {
    mat = earthMaterial(d);
  } else {
    mat = new THREE.MeshStandardMaterial({ map: colorTexture(d.tex, d.gen, ...size), roughness: 1, metalness: 0 });
  }
  v.mesh = new THREE.Mesh(geo, mat);
  group.add(v.mesh);

  if (b.kind === 'star') {
    // Glow and corona. Sized every frame in updateScene: they grow with the star but are capped in
    // screen pixels, so a very large star doesn't flood the whole view with yellow.
    v.glows = [[7, 70, 0.9], [18, 180, 0.35]].map(([k, maxPx, o]) => {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture, color: 0xffd9a0, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: o, toneMapped: false }));
      scene.add(sprite);
      return { sprite, k, maxPx };
    });
  }
  if (d.clouds) {
    v.clouds = new THREE.Mesh(sphereGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, alphaMap: cloudTexture(d.clouds), transparent: true, depthWrite: false, roughness: 1 }));
    v.clouds.scale.setScalar(1.008);
    group.add(v.clouds);
  }
  if (d.atmosphere) {
    v.atmo = new THREE.Mesh(sphereGeo, atmosphereMaterial(d.atmosphere));
    v.atmo.scale.setScalar(1.03);
    group.add(v.atmo);
  }
  if (d.rings) {
    const r = d.rings;
    const isSaturn = b.name === 'Saturn';
    let map;
    if (PHOTOS && r.tex) {
      map = loader.load('textures/' + r.tex, undefined, undefined, () => { map.image = makeRingCanvas(r, isSaturn); map.needsUpdate = true; });
      map.encoding = THREE.sRGBEncoding;
    } else {
      map = canvasTexture(makeRingCanvas(r, isSaturn));
    }
    // Rings scatter sunlight from both faces, so they are drawn unlit (both sides visible)
    v.ring = new THREE.Mesh(ringGeometry(r.inner, r.outer),
      new THREE.MeshBasicMaterial({ map, color: 0xd8d2c8, transparent: true, opacity: r.opacity, side: THREE.DoubleSide, depthWrite: false }));
    v.ring.quaternion.setFromUnitVectors(Z, v.pole);
    group.add(v.ring);
  }
  if (b.kind === 'comet') {
    v.coma = new THREE.Sprite(new THREE.SpriteMaterial({ map: comaTexture, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    scene.add(v.coma);
    v.tail = makeTail();
    scene.add(v.tail.points);
  }

  // Orbit trail: newest point bright, oldest fades out
  const tg = new THREE.BufferGeometry();
  const tpos = new Float32Array((TRAIL_POINTS + 1) * 3), tcol = new Float32Array((TRAIL_POINTS + 1) * 3);
  tg.setAttribute('position', new THREE.BufferAttribute(tpos, 3).setUsage(THREE.DynamicDrawUsage));
  tg.setAttribute('color', new THREE.BufferAttribute(tcol, 3).setUsage(THREE.DynamicDrawUsage));
  v.trail = new THREE.Line(tg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }));
  v.trail.frustumCulled = false;
  v.trailColor = new THREE.Color(b.color);
  v.trailCount = -1;
  scene.add(v.trail);

  visuals.set(b, v);
  return v;
}

function removeVisual(b) {
  const v = visuals.get(b);
  if (!v) return;
  scene.remove(v.group, v.trail);
  if (v.coma) scene.remove(v.coma, v.tail.points);
  if (v.glows) for (const g of v.glows) scene.remove(g.sprite);
  v.trail.geometry.dispose();
  visuals.delete(b);
}

// Comet tails: a straight blue ion tail pointing away from the Sun and a curved yellow-white dust tail
const TAIL_N = 90;
function makeTail() {
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array(TAIL_N * 2 * 3), col = new Float32Array(TAIL_N * 2 * 3);
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
  const points = new THREE.Points(g, new THREE.PointsMaterial({ size: 2.6, sizeAttenuation: false, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  points.frustumCulled = false;
  return { points, pos, col, g };
}

// ---------------- Particles (asteroids, Trojans, meteor streams) ----------------
let particleViews = [];
function buildParticleViews() {
  for (const pv of particleViews) scene.remove(pv.points);
  particleViews = [];
  const P = particles;
  const groups = [
    { layer: 'asteroids', test: g => g === GROUP_BELT || g === GROUP_TROJAN, size: 1.7 },
    { layer: 'comets', test: g => g >= GROUP_STREAM, size: 1.4 },
  ];
  const rand = seededRandom(7);
  for (const spec of groups) {
    const idx = [];
    for (let k = 0; k < P.n; k++) if (spec.test(P.group[k])) idx.push(k);
    const pos = new Float32Array(idx.length * 3), col = new Float32Array(idx.length * 3);
    idx.forEach((k, j) => {
      const g = P.group[k], s = 0.55 + rand() * 0.45;
      const c = g === GROUP_BELT ? [0.75, 0.68, 0.58] : g === GROUP_TROJAN ? [0.62, 0.7, 0.6] : [0.55, 0.75, 1.0];
      col[j * 3] = c[0] * s; col[j * 3 + 1] = c[1] * s; col[j * 3 + 2] = c[2] * s;
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const points = new THREE.Points(geo, new THREE.PointsMaterial({ size: spec.size, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false }));
    points.frustumCulled = false;
    scene.add(points);
    particleViews.push({ ...spec, idx, pos, geo, points });
  }
}

function rebuildVisuals() {
  for (const b of [...visuals.keys()]) removeVisual(b);
  for (const b of bodies) createVisual(b);
  buildParticleViews();
}

// ---------------- Sizes ----------------
// On-screen size comes from the real radius. A compressed pixel size keeps small bodies visible
// but still grows with radius, so changing mass (r ∝ m^(1/3)) visibly changes the size.
function pixelSize(b) {
  if (display.trueSize) return 1;
  return Math.max(1.5, 0.19 * Math.pow(b.radius / 1000, 0.35));
}

const tmpV = new THREE.Vector3();
function worldPerPixel(rx, ry, rz) {
  if (view.mode === '2d') return view.span / H;
  const c = perspCam.position;
  return Math.hypot(rx - c.x, ry - c.y, rz - c.z) * 2 * Math.tan(FOV * DEG / 2) / H;
}

function layerVisible(b) {
  const L = display.layers;
  return b.kind === 'moon' ? L.moons : b.kind === 'dwarf' ? L.dwarfs : b.kind === 'comet' ? L.comets : true;
}

// ---------------- Camera ----------------
function updateCamera() {
  const aspect = W / H;
  if (view.mode === '3d') {
    const d = view.span / (2 * Math.tan(FOV * DEG / 2));
    perspCam.aspect = aspect;
    perspCam.near = Math.max(d * 1e-5, 1e-11);
    perspCam.far = d * 1e5 + 2e3;
    perspCam.position.set(d * Math.sin(view.phi) * Math.cos(view.theta), d * Math.sin(view.phi) * Math.sin(view.theta), d * Math.cos(view.phi));
    perspCam.lookAt(0, 0, 0);
    perspCam.updateProjectionMatrix();
    scene.background = skyEquirect;
  } else {
    const h = view.span / 2;
    orthoCam.left = -h * aspect; orthoCam.right = h * aspect; orthoCam.top = h; orthoCam.bottom = -h;
    orthoCam.position.set(0, 0, 1e4);
    orthoCam.lookAt(0, 0, 0);
    orthoCam.updateProjectionMatrix();
    scene.background = skyFlat;
  }
  camera().updateMatrixWorld();
}

function bodyWorld(b) { return [b.x / AU, b.y / AU, b.z / AU]; }

function startFocus(b) {
  view.fly = { body: b, t0: performance.now(), from: [...view.target], span0: view.span, span1: Math.max(b.radius / AU * 8, 1e-7) };
  view.follow = null;
}

function stopFollow() { view.follow = null; view.fly = null; }

// ---------------- Per-frame update ----------------
const easeOut = t => 1 - (1 - t) ** 3;

function updateScene() {
  // Camera target: focus animation, follow, or free
  if (view.fly) {
    const f = view.fly;
    if (!bodies.includes(f.body)) { view.fly = null; }
    else {
      const t = Math.min(1, (performance.now() - f.t0) / 1300), e = easeOut(t);
      const p = bodyWorld(f.body);
      view.target = f.from.map((c, k) => c + (p[k] - c) * e);
      view.span = Math.exp(Math.log(f.span0) + (Math.log(f.span1) - Math.log(f.span0)) * e);
      if (t >= 1) { view.follow = f.body; view.fly = null; }
    }
  } else if (view.follow) {
    if (bodies.includes(view.follow)) view.target = bodyWorld(view.follow);
    else view.follow = null;
  }
  // Never let the camera end up inside (or right against) the body it is following
  if (view.follow) view.span = Math.max(view.span, view.follow.radius / AU * 3);
  updateCamera();
  const [ox, oy, oz] = view.target;
  const cam = camera();

  // Remove visuals of bodies that merged away
  for (const b of [...visuals.keys()]) if (!bodies.includes(b)) removeVisual(b);

  // Display radius and position (moons pushed just outside their enlarged parent, display only)
  const byName = new Map(bodies.map(b => [b.name, b]));
  for (const b of bodies) {
    const rx = b.x / AU - ox, ry = b.y / AU - oy, rz = b.z / AU - oz;
    b._wpp = worldPerPixel(rx, ry, rz);
    b._r = Math.max(b.radius / AU, pixelSize(b) * b._wpp);
    b._d = [rx, ry, rz];
  }
  for (const b of bodies) {
    if (b.kind !== 'moon' || !b.parent) continue;
    const p = byName.get(b.parent);
    if (!p) continue;
    const dx = b._d[0] - p._d[0], dy = b._d[1] - p._d[1], dz = b._d[2] - p._d[2];
    const dist = Math.hypot(dx, dy, dz);
    if (dist > 0.1) continue;                                // escaped: show where it really is
    const need = (p._r + b._r) * 1.4 + 3 * p._wpp;
    const k = Math.max(1, need / dist);
    b._d = [p._d[0] + dx * k, p._d[1] + dy * k, p._d[2] + dz * k];
  }

  // Light comes from the most massive body
  const star = bodies.reduce((a, b) => (b.mass > a.mass ? b : a), bodies[0]);
  sunLight.position.set(...star._d);
  sunPosUniform.value.set(...star._d);

  for (const b of bodies) {
    const v = visuals.get(b) || createVisual(b);
    const vis = layerVisible(b);
    v.group.visible = vis;
    v.group.position.set(...b._d);
    v.group.scale.setScalar(b._r);
    if (v.glows) for (const g of v.glows) {
      const size = Math.min(g.k * b._r, 2 * b._r + 2 * g.maxPx * b._wpp);   // diameter, AU
      g.sprite.visible = vis;
      g.sprite.position.set(...b._d);
      g.sprite.scale.set(size, size, 1);
    }
    const spin = 2 * Math.PI * ((simTime / Math.abs(b.spinPeriod)) % 1);
    v.mesh.quaternion.copy(v.poleQ).multiply(new THREE.Quaternion().setFromAxisAngle(Y, spin));
    if (v.clouds) v.clouds.quaternion.copy(v.poleQ).multiply(new THREE.Quaternion().setFromAxisAngle(Y, spin * 1.04));
    if (v.atmo) v.atmo.material.uniforms.ortho.value = view.mode === '2d' ? 1 : 0;

    updateTrail(b, v, ox, oy, oz, vis && display.layers.trails);
    if (v.tail) updateTail(b, v, star, vis);
  }

  // Particles
  const P = particles;
  for (const pv of particleViews) {
    pv.points.visible = display.layers[pv.layer];
    if (!pv.points.visible) continue;
    for (let j = 0; j < pv.idx.length; j++) {
      const k = pv.idx[j];
      if (P.alive[k]) {
        pv.pos[j * 3] = P.x[k] / AU - ox; pv.pos[j * 3 + 1] = P.y[k] / AU - oy; pv.pos[j * 3 + 2] = P.z[k] / AU - oz;
      } else {
        pv.pos[j * 3] = 1e9; pv.pos[j * 3 + 1] = 1e9; pv.pos[j * 3 + 2] = 1e9;
      }
    }
    pv.geo.attributes.position.needsUpdate = true;
  }

  renderer.render(scene, cam);
  drawOverlay();
}

function updateTrail(b, v, ox, oy, oz, visible) {
  v.trail.visible = visible && b.trail.length > 1;
  if (!v.trail.visible) return;
  const tr = b.trail, n = tr.length;
  const pos = v.trail.geometry.attributes.position, col = v.trail.geometry.attributes.color;
  for (let i = 0; i < n; i++) {
    pos.array[i * 3] = tr[i][0] / AU - ox; pos.array[i * 3 + 1] = tr[i][1] / AU - oy; pos.array[i * 3 + 2] = tr[i][2] / AU - oz;
  }
  pos.array[n * 3] = b.x / AU - ox; pos.array[n * 3 + 1] = b.y / AU - oy; pos.array[n * 3 + 2] = b.z / AU - oz;
  if (v.trailCount !== n) {
    for (let i = 0; i <= n; i++) {
      const f = ((i + 1) / (n + 1)) ** 1.5;
      col.array[i * 3] = v.trailColor.r * f; col.array[i * 3 + 1] = v.trailColor.g * f; col.array[i * 3 + 2] = v.trailColor.b * f;
    }
    col.needsUpdate = true;
    v.trailCount = n;
  }
  pos.needsUpdate = true;
  v.trail.geometry.setDrawRange(0, n + 1);
}

function updateTail(b, v, star, visible) {
  const sx = (b.x - star.x) / AU, sy = (b.y - star.y) / AU, sz = (b.z - star.z) / AU;
  const r = Math.hypot(sx, sy, sz);
  const bright = clamp01((5 - r) / 3);                       // tails appear inside ~5 AU
  v.tail.points.visible = v.coma.visible = visible && bright > 0;
  if (!v.tail.points.visible) return;
  const L = Math.min(0.9, 0.28 / (r * r));                   // tail length grows as 1/r² near the Sun
  const ax = sx / r, ay = sy / r, az = sz / r;
  const vs = Math.hypot(b.vx, b.vy, b.vz) || 1;
  const vx = b.vx / vs, vy = b.vy / vs, vz = b.vz / vs;
  const [cx, cy, cz] = b._d;
  const { pos, col, g } = v.tail;
  for (let k = 0; k < TAIL_N; k++) {
    const s = k / TAIL_N;
    // ion tail: straight away from the Sun
    let i = k * 3;
    pos[i] = cx + ax * L * s; pos[i + 1] = cy + ay * L * s; pos[i + 2] = cz + az * L * s;
    const fi = bright * (1 - s) ** 2;
    col[i] = 0.45 * fi; col[i + 1] = 0.7 * fi; col[i + 2] = 1.0 * fi;
    // dust tail: curves back along the orbit
    i = (TAIL_N + k) * 3;
    const back = 0.4 * s * s;
    pos[i] = cx + (ax * 0.75 * s - vx * back) * L; pos[i + 1] = cy + (ay * 0.75 * s - vy * back) * L; pos[i + 2] = cz + (az * 0.75 * s - vz * back) * L;
    const fd = bright * (1 - s) ** 1.4 * 0.9;
    col[i] = 1.0 * fd; col[i + 1] = 0.9 * fd; col[i + 2] = 0.72 * fd;
  }
  g.attributes.position.needsUpdate = true;
  g.attributes.color.needsUpdate = true;
  v.coma.position.set(cx, cy, cz);
  const cs = Math.max(L * 0.12, 14 * b._wpp) * bright;
  v.coma.scale.set(cs, cs, 1);
}

// ---------------- Overlay: labels, selection ring, merge flashes ----------------
function toScreen(d) {
  tmpV.set(d[0], d[1], d[2]).project(camera());
  if (tmpV.z > 1 || tmpV.z < -1) return null;
  return [(tmpV.x + 1) / 2 * W, (1 - tmpV.y) / 2 * H];
}

function drawOverlay() {
  octx.clearRect(0, 0, W, H);
  const shown = bodies.filter(layerVisible);
  const scr = new Map();
  for (const b of shown) {
    const s = toScreen(b._d);
    if (s) scr.set(b, { x: s[0], y: s[1], r: b._r / b._wpp });
  }
  for (const b of shown) b._screen = scr.get(b) || null;

  if (display.layers.labels) {
    octx.font = '12px system-ui, -apple-system, sans-serif';
    octx.textBaseline = 'middle';
    for (const [b, s] of scr) {
      if (b !== ui.selected) {
        if (b.kind === 'moon') {
          const p = scr.get(bodies.find(o => o.name === b.parent));
          if (p && Math.hypot(p.x - s.x, p.y - s.y) < p.r + 30) continue;
        } else {
          let crowded = false;
          for (const [o, so] of scr) {
            if (o !== b && o.kind !== 'moon' && o.mass > b.mass && Math.hypot(so.x - s.x, so.y - s.y) < so.r + 12) { crowded = true; break; }
          }
          if (crowded) continue;
        }
      }
      octx.fillStyle = b.kind === 'moon' ? 'rgba(200,205,220,0.75)' : b.kind === 'comet' ? 'rgba(170,215,255,0.9)' : 'rgba(225,230,240,0.92)';
      octx.fillText(b.name, s.x + s.r + 5, s.y);
    }
  }

  const sel = ui.selected && scr.get(ui.selected);
  if (sel && sel.r < 60) {                              // no ring once the body itself fills the view
    octx.strokeStyle = 'rgba(255,255,255,0.85)';
    octx.lineWidth = 1.2;
    octx.beginPath(); octx.arc(sel.x, sel.y, sel.r + 6, 0, Math.PI * 2); octx.stroke();
  }

  const now = performance.now();
  flashes = flashes.filter(f => now - f.t < 1400);
  for (const f of flashes) {
    if (!bodies.includes(f.body) || !scr.get(f.body)) continue;
    const s = scr.get(f.body), k = (now - f.t) / 1400;
    octx.strokeStyle = `rgba(255, 220, 150, ${1 - k})`;
    octx.lineWidth = 2;
    octx.beginPath(); octx.arc(s.x, s.y, s.r + 6 + k * 50, 0, Math.PI * 2); octx.stroke();
  }
}

function pickAt(x, y) {
  let best = null, bestD = Infinity;
  for (const b of bodies) {
    const s = b._screen;
    if (!s || !layerVisible(b)) continue;
    const d = Math.hypot(s.x - x, s.y - y);
    if (d < s.r + 10 && d < bestD) { best = b; bestD = d; }
  }
  return best;
}

// ---------------- Mouse / touch controls ----------------
const pointers = new Map();
let downAt = null, moved = false, pinch = null, lastTap = 0;

function camAxes() {
  const m = perspCam.matrixWorld.elements;
  return { right: [m[0], m[1], m[2]], up: [m[4], m[5], m[6]] };
}

function pan(dx, dy) {
  stopFollow();
  const wpp = view.span / H;
  if (view.mode === '2d') { view.target[0] -= dx * wpp; view.target[1] += dy * wpp; return; }
  const { right, up } = camAxes();
  for (let k = 0; k < 3; k++) view.target[k] += (-right[k] * dx + up[k] * dy) * wpp;
}

function zoomAt(factor, sx, sy) {
  const newSpan = Math.min(Math.max(view.span * factor, 1e-8), 4000);
  factor = newSpan / view.span;
  if (!view.follow && !view.fly) {
    // keep the point under the cursor fixed
    const wpp = view.span / H, ox = (sx - W / 2) * wpp, oy = -(sy - H / 2) * wpp;
    if (view.mode === '2d') { view.target[0] += ox * (1 - factor); view.target[1] += oy * (1 - factor); }
    else {
      const { right, up } = camAxes();
      for (let k = 0; k < 3; k++) view.target[k] += (right[k] * ox + up[k] * oy) * (1 - factor);
    }
  }
  view.span = newSpan;
}

glCanvas.addEventListener('contextmenu', e => e.preventDefault());

glCanvas.addEventListener('pointerdown', e => {
  glCanvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, button: e.button, shift: e.shiftKey });
  if (pointers.size === 1) { downAt = { x: e.clientX, y: e.clientY }; moved = false; }
  if (pointers.size === 2) {
    const [p, q] = [...pointers.values()];
    pinch = { d: Math.hypot(p.x - q.x, p.y - q.y), span: view.span };
    moved = true;
  }
  glCanvas.classList.add('dragging');
});

glCanvas.addEventListener('pointermove', e => {
  const prev = pointers.get(e.pointerId);
  if (!prev) return;
  const cur = { ...prev, x: e.clientX, y: e.clientY };
  pointers.set(e.pointerId, cur);
  const dx = cur.x - prev.x, dy = cur.y - prev.y;
  if (pointers.size === 1) {
    if (Math.hypot(cur.x - downAt.x, cur.y - downAt.y) > 4) moved = true;
    if (!moved) return;
    const rotate = view.mode === '3d' && prev.button === 0 && !prev.shift;
    if (rotate) {
      view.theta -= dx * 0.005;
      view.phi = Math.min(Math.max(view.phi - dy * 0.005, 0.02), Math.PI - 0.02);
    } else {
      pan(dx, dy);
    }
  } else if (pointers.size === 2 && pinch) {
    const [p, q] = [...pointers.values()];
    view.span = Math.min(Math.max(pinch.span * pinch.d / Math.max(Math.hypot(p.x - q.x, p.y - q.y), 1), 1e-8), 4000);
  }
});

function endPointer(e) {
  if (!pointers.has(e.pointerId)) return;
  if (pointers.size === 1 && !moved) {
    const b = pickAt(e.clientX, e.clientY);
    const now = performance.now();
    if (b) {
      ui.select(b);
      if (now - lastTap < 350) startFocus(b);   // double-click / double-tap to focus
    }
    lastTap = now;
  }
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinch = null;
  if (pointers.size === 0) glCanvas.classList.remove('dragging');
}
glCanvas.addEventListener('pointerup', endPointer);
glCanvas.addEventListener('pointercancel', endPointer);

glCanvas.addEventListener('wheel', e => {
  e.preventDefault();
  zoomAt(Math.exp(e.deltaY * 0.0015), e.clientX, e.clientY);
}, { passive: false });
