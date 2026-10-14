// Textures generated in code. Used for bodies with no real map, and as a fallback whenever
// the photo textures can't be used (for example when the page is opened as a local file).
// Noise is sampled in 3D on the sphere, so the maps have no seam at the date line or poles.

function hash3(x, y, z) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function noise3(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const lerp = (a, b, t) => a + (b - a) * t;
  const c = (dx, dy, dz) => hash3(xi + dx, yi + dy, zi + dz);
  return lerp(
    lerp(lerp(c(0, 0, 0), c(1, 0, 0), u), lerp(c(0, 1, 0), c(1, 1, 0), u), v),
    lerp(lerp(c(0, 0, 1), c(1, 0, 1), u), lerp(c(0, 1, 1), c(1, 1, 1), u), v), w);
}

function fbm(x, y, z, octaves = 5) {
  let sum = 0, amp = 0.5, f = 1, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise3(x * f, y * f, z * f);
    norm += amp; amp *= 0.5; f *= 2.03;
  }
  return sum / norm;
}

const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const scale = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
const clamp01 = t => Math.max(0, Math.min(1, t));
const smooth = (e0, e1, x) => { const t = clamp01((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };

// Paint an equirectangular map. fn(x, y, z, lat, lon) returns [r, g, b].
function paintSphere(w, h, fn) {
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(w, h);
  for (let j = 0; j < h; j++) {
    const lat = (0.5 - (j + 0.5) / h) * Math.PI;
    const cl = Math.cos(lat), sl = Math.sin(lat);
    for (let i = 0; i < w; i++) {
      const lon = ((i + 0.5) / w) * 2 * Math.PI - Math.PI;
      const c = fn(cl * Math.cos(lon), cl * Math.sin(lon), sl, lat, lon);
      const k = (j * w + i) * 4;
      img.data[k] = c[0]; img.data[k + 1] = c[1]; img.data[k + 2] = c[2]; img.data[k + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

// Craters: dark floor, bright rim. Widened toward the poles to match the map projection.
function paintCraters(canvas, count, rand, dark = 'rgba(0,0,0,0.35)', rim = 'rgba(255,255,255,0.18)') {
  const ctx = canvas.getContext('2d'), w = canvas.width, h = canvas.height;
  for (let n = 0; n < count; n++) {
    const lat = Math.asin(2 * rand() - 1);
    const u = rand() * w, v = (0.5 - lat / Math.PI) * h;
    const r = (0.004 + 0.03 * rand() ** 3) * h;
    const sx = 1 / Math.max(Math.cos(lat), 0.15);
    for (const off of [0, -w, w]) {
      ctx.save();
      ctx.translate(u + off, v); ctx.scale(sx, 1);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
      g.addColorStop(0, dark); g.addColorStop(0.7, dark); g.addColorStop(0.85, rim); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  }
}

function generateTexture(recipe, w = 512, h = 256) {
  const rand = seededRandom(recipe.type.length * 977 + (recipe.base ? recipe.base[0] * 31 + recipe.base[1] : 7));
  const t = recipe.type;

  if (t === 'sun') {
    return paintSphere(w, h, (x, y, z) => {
      const n = fbm(x * 6, y * 6, z * 6, 5), g = fbm(x * 40, y * 40, z * 40, 2);
      return mix([255, 236, 150], [240, 120, 30], clamp01(n * 1.2 - 0.1 + (g - 0.5) * 0.5));
    });
  }

  if (t === 'rocky') {
    const c = paintSphere(w, h, (x, y, z, lat) => {
      let col = scale(recipe.base, 0.72 + 0.56 * fbm(x * 4 + 3, y * 4, z * 4, 6));
      if (recipe.patches && fbm(x * 2, y * 2 + 5, z * 2, 4) > 0.55) col = scale(col, 1.3);
      if (recipe.cap) col = mix(col, recipe.cap, smooth(1.0, 1.35, lat) * 0.85);
      return col;
    });
    paintCraters(c, recipe.craters || 100, rand);
    return c;
  }

  if (t === 'clouds') {
    return paintSphere(w, h, (x, y, z, lat) => {
      const n = fbm(x * 3, y * 3, z * 3, 5);
      const s = Math.sin(lat * 7 + n * 6);
      return scale(recipe.base, 0.85 + 0.12 * s + 0.1 * (fbm(x * 9, y * 9, z * 9, 3) - 0.5));
    });
  }

  if (t === 'earth') {
    return paintSphere(w, h, (x, y, z, lat) => {
      const n = fbm(x * 2.2 + 11, y * 2.2, z * 2.2, 6);
      const ice = Math.abs(lat) > 1.2 + 0.15 * (fbm(x * 5, y * 5, z * 5, 3) - 0.5);
      if (ice) return [235, 240, 245];
      if (n < 0.52) return mix([10, 35, 90], [25, 80, 150], smooth(0.35, 0.52, n));
      const dry = fbm(x * 3, y * 3 + 7, z * 3, 4) + (1 - Math.abs(Math.cos(lat * 2.2))) * 0.2;
      return mix([45, 100, 45], [170, 140, 90], smooth(0.45, 0.7, dry));
    });
  }

  if (t === 'mars') {
    return paintSphere(w, h, (x, y, z, lat) => {
      let col = scale([190, 95, 55], 0.8 + 0.4 * fbm(x * 5, y * 5, z * 5, 6));
      if (fbm(x * 2 + 4, y * 2, z * 2, 5) > 0.56) col = scale(col, 0.62);
      return mix(col, [240, 235, 230], smooth(1.3, 1.4, Math.abs(lat)));
    });
  }

  if (t === 'gas') {
    const B = recipe.bands;
    return paintSphere(w, h, (x, y, z, lat, lon) => {
      const turb = fbm(x * 3, y * 3, z * 12, 5);
      const v = (Math.sin(lat) * 6 + turb * 1.4 + 10) % B.length;
      const i = Math.floor(v), f = smooth(0.2, 0.8, v - i);
      let col = mix(B[i], B[(i + 1) % B.length], f);
      if (recipe.spot) {
        const d = (lon / 0.22) ** 2 + ((lat + 0.38) / 0.09) ** 2;
        const spotCol = recipe.spot === 'dark' ? scale(B[0], 0.5) : [190, 95, 65];
        col = mix(col, spotCol, smooth(1, 0.5, d) * 0.9);
      }
      return col;
    });
  }

  if (t === 'io') {
    const c = paintSphere(w, h, (x, y, z) => {
      const n = fbm(x * 4, y * 4, z * 4, 5);
      return mix(mix([235, 215, 110], [210, 150, 60], smooth(0.45, 0.65, n)), [245, 240, 215], smooth(0.6, 0.75, fbm(x * 3 + 9, y * 3, z * 3, 4)));
    });
    paintCraters(c, 70, rand, 'rgba(40,20,10,0.7)', 'rgba(200,90,40,0.4)');
    return c;
  }

  if (t === 'europa') {
    const c = paintSphere(w, h, (x, y, z) =>
      mix([228, 220, 205], [165, 125, 90], smooth(0.5, 0.75, fbm(x * 3, y * 3, z * 3, 5)) * 0.7));
    const ctx = c.getContext('2d');
    ctx.strokeStyle = 'rgba(130, 80, 50, 0.45)';
    for (let n = 0; n < 60; n++) {
      ctx.lineWidth = 0.5 + rand() * 1.5;
      ctx.beginPath();
      let px = rand() * w, py = rand() * h, ang = rand() * Math.PI * 2;
      ctx.moveTo(px, py);
      for (let s = 0; s < 40; s++) {
        ang += (rand() - 0.5) * 0.3;
        px += Math.cos(ang) * 6; py += Math.sin(ang) * 6;
        ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
    return c;
  }

  if (t === 'icy') {
    return paintSphere(w, h, (x, y, z) => scale(recipe.base, 0.88 + 0.2 * fbm(x * 4, y * 4, z * 4, 5)));
  }

  if (t === 'pluto') {
    // Tan surface, the bright nitrogen-ice "heart" (Tombaugh Regio) and the dark red Cthulhu region
    return paintSphere(w, h, (x, y, z, lat, lon) => {
      let col = scale([200, 170, 140], 0.8 + 0.35 * fbm(x * 4, y * 4, z * 4, 5));
      const heart = Math.min(Math.hypot(lon + 0.25, lat - 0.35) / 0.42, Math.hypot(lon - 0.28, lat - 0.28) / 0.36,
                             Math.hypot(lon, (lat + 0.05) * 1.6) / 0.35);
      col = mix(col, [242, 234, 220], smooth(1, 0.8, heart));
      const dark = lon > 1.0 && lon < 2.9 && lat > -0.45 && lat < 0.25 + 0.2 * fbm(x * 3, y * 3, z * 3, 3);
      if (dark) col = mix(col, [105, 55, 40], 0.8);
      return mix(col, [175, 140, 120], smooth(1.1, 1.4, lat));
    });
  }

  if (t === 'comet') {
    return paintSphere(w, h, (x, y, z) => scale([75, 70, 65], 0.7 + 0.6 * fbm(x * 5, y * 5, z * 5, 5)));
  }

  return paintSphere(w, h, () => [128, 128, 128]);
}

// Starry sky (equirectangular). Uses the Milky Way photo when given, otherwise draws one.
function makeSkyCanvas(img) {
  const w = 2048, h = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);
  if (img) {
    ctx.globalAlpha = 0.55;
    ctx.drawImage(img, 0, 0, w, h);
    ctx.globalAlpha = 1;
    return canvas;
  }
  // Milky Way glow along a tilted great circle, drawn small then scaled up
  const glow = paintSphere(256, 128, (x, y, z) => {
    const tilt = 1.05;
    const d = Math.abs(z * Math.cos(tilt) - y * Math.sin(tilt));
    const n = fbm(x * 4, y * 4, z * 4, 4);
    const k = Math.max(0, 1 - d / 0.28) * (0.4 + n) * 55;
    return [k * 0.95, k * 0.9, k];
  });
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(glow, 0, 0, w, h);
  const rand = seededRandom(42);
  for (let n = 0; n < 7000; n++) {
    const lat = Math.asin(2 * rand() - 1);
    const x = rand() * w, y = (0.5 - lat / Math.PI) * h;
    const b = rand() ** 3;
    const temp = rand();
    const col = temp < 0.15 ? [255, 210, 170] : temp > 0.85 ? [180, 200, 255] : [255, 250, 240];
    ctx.fillStyle = `rgba(${col[0]},${col[1]},${col[2]},${0.25 + 0.75 * b})`;
    const s = 0.5 + b * 0.8;
    ctx.fillRect(x, y, s, s);
  }
  return canvas;
}

// Soft radial glow for the Sun and comet comas
function makeGlowCanvas(rgb, size = 256) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  const [r, gg, b] = rgb;
  g.addColorStop(0, `rgba(${r},${gg},${b},1)`);
  g.addColorStop(0.2, `rgba(${r},${gg},${b},0.45)`);
  g.addColorStop(0.5, `rgba(${r},${gg},${b},0.12)`);
  g.addColorStop(1, `rgba(${r},${gg},${b},0)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return canvas;
}

// Ring profile along the radius (u = 0 at the inner edge, 1 at the outer edge).
// Saturn: C ring, bright B ring, Cassini Division, A ring with the Encke Gap. Others: a few thin rings.
function makeRingCanvas(spec, isSaturn) {
  const w = 1024, h = 4;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  const [r, g, b] = spec.color;
  for (let i = 0; i < w; i++) {
    const rr = spec.inner + (spec.outer - spec.inner) * (i / w);   // radius in planet radii
    let a;
    if (isSaturn) {
      a = rr < 1.53 ? 0.25 : rr < 1.95 ? 0.85 : rr < 2.03 ? 0.05 : rr < 2.21 || rr > 2.215 ? 0.6 : 0.05;
      a *= 0.85 + 0.3 * noise3(i * 0.15, 0, 0);
    } else {
      a = [0.1, 0.45, 0.8, 0.97].some(p => Math.abs(i / w - p) < 0.008) ? 0.9 : 0.04;
    }
    ctx.fillStyle = `rgba(${r},${g},${b},${a})`;
    ctx.fillRect(i, 0, 1, h);
  }
  return canvas;
}
