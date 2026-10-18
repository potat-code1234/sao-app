// Renders a Minecraft item model made of boxes ("elements", e.g. a 3D helmet) into a PNG icon, the way it
// looks in the inventory. No dependencies: includes a small PNG reader/writer and a software rasterizer.
// Used by import-textures.js.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// ---------------------------------------------------------------- PNG
function decodePng(buf) {
  let width, height, depth, type, palette, trns;
  const idat = [];
  for (let pos = 8; pos < buf.length; ) {
    const len = buf.readUInt32BE(pos);
    const kind = buf.toString('latin1', pos + 4, pos + 8);
    const body = buf.subarray(pos + 8, pos + 8 + len);
    if (kind === 'IHDR') {
      [width, height, depth, type] = [body.readUInt32BE(0), body.readUInt32BE(4), body[8], body[9]];
      if (body[12]) throw new Error('interlaced PNG');
    } else if (kind === 'PLTE') palette = body;
    else if (kind === 'tRNS') trns = body;
    else if (kind === 'IDAT') idat.push(body);
    else if (kind === 'IEND') break;
    pos += 12 + len;
  }
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type];
  const bitsPerPixel = channels * depth;
  const stride = Math.ceil((width * bitsPerPixel) / 8);
  const bpp = Math.max(1, bitsPerPixel >> 3);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const px = Buffer.alloc(stride * height);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = px.subarray(y * stride, (y + 1) * stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      let v = line[i];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const [pa, pb, pc] = [Math.abs(p - a), Math.abs(p - b), Math.abs(p - c)];
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[i] = v & 255;
    }
    prev = cur;
  }
  // sample n of the pixel at x in row y, scaled to 0..255
  const sample = (y, x, n) => {
    const row = y * stride;
    if (depth === 8) return px[row + x * channels + n];
    if (depth === 16) return px[row + (x * channels + n) * 2];
    const bit = (x * channels + n) * depth;
    const v = (px[row + (bit >> 3)] >> (8 - depth - (bit & 7))) & ((1 << depth) - 1);
    return type === 3 ? v : Math.round((v * 255) / ((1 << depth) - 1));
  };
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      if (type === 3) {
        const i = sample(y, x, 0);
        rgba.set([palette[i * 3], palette[i * 3 + 1], palette[i * 3 + 2], trns && i < trns.length ? trns[i] : 255], o);
      } else if (type === 0 || type === 4) {
        const g = sample(y, x, 0);
        rgba.set([g, g, g, type === 4 ? sample(y, x, 1) : 255], o);
      } else rgba.set([sample(y, x, 0), sample(y, x, 1), sample(y, x, 2), type === 6 ? sample(y, x, 3) : 255], o);
    }
  }
  return { width, height, rgba };
}

const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  const chunk = (kind, data) => {
    const body = Buffer.concat([Buffer.from(kind, 'latin1'), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body), body.length + 4);
    return out;
  };
  const head = Buffer.alloc(13);
  head.writeUInt32BE(width, 0);
  head.writeUInt32BE(height, 4);
  head.set([8, 6, 0, 0, 0], 8); // 8-bit RGBA
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// ---------------------------------------------------------------- models
const splitRef = (ref) => (ref.includes(':') ? ref.split(':') : ['minecraft', ref]);

/** A model with its parents' textures and display merged in, and the elements of the nearest model that has them. */
function loadModel(assets, file) {
  let model = JSON.parse(fs.readFileSync(file, 'utf8'));
  let textures = { ...model.textures };
  let display = { ...model.display };
  let elements = model.elements;
  for (let depth = 0; !elements && model.parent && depth < 8; depth++) {
    const [ns, rel] = splitRef(model.parent);
    const parentFile = path.join(assets, ns, 'models', `${rel}.json`);
    if (!fs.existsSync(parentFile)) break;
    model = JSON.parse(fs.readFileSync(parentFile, 'utf8'));
    textures = { ...model.textures, ...textures };
    display = { ...model.display, ...display };
    elements = model.elements;
  }
  return { textures, display, elements: elements || [] };
}

// Texture for a face's "#key", read once; animated textures (vertical strips) use their first frame.
function textureLoader(assets, textures) {
  const cache = new Map();
  return (key) => {
    let ref = key;
    for (let i = 0; i < 8 && ref?.startsWith('#'); i++) ref = textures[ref.slice(1)];
    if (!ref || ref.startsWith('#')) return null;
    if (!cache.has(ref)) {
      const [ns, rel] = splitRef(ref);
      const file = path.join(assets, ns, 'textures', `${rel}.png`);
      let tex = null;
      if (fs.existsSync(file)) {
        tex = decodePng(fs.readFileSync(file));
        if (tex.height > tex.width && tex.height % tex.width === 0) tex.height = tex.width;
      }
      cache.set(ref, tex);
    }
    return cache.get(ref);
  };
}

// The four corners of a face as seen from outside: top-left, top-right, bottom-right, bottom-left. They get the
// face's uv corners (u1,v1) (u2,v1) (u2,v2) (u1,v2), as in Minecraft and Blockbench.
function faceCorners(dir, [x0, y0, z0], [x1, y1, z1]) {
  return {
    north: [[x1, y1, z0], [x0, y1, z0], [x0, y0, z0], [x1, y0, z0]],
    south: [[x0, y1, z1], [x1, y1, z1], [x1, y0, z1], [x0, y0, z1]],
    east: [[x1, y1, z1], [x1, y1, z0], [x1, y0, z0], [x1, y0, z1]],
    west: [[x0, y1, z0], [x0, y1, z1], [x0, y0, z1], [x0, y0, z0]],
    up: [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]],
    down: [[x0, y0, z1], [x1, y0, z1], [x1, y0, z0], [x0, y0, z0]],
  }[dir];
}

// Minecraft's default uv when a face doesn't give one.
function defaultUv(dir, [x0, y0, z0], [x1, y1, z1]) {
  return {
    down: [x0, 16 - z1, x1, 16 - z0],
    up: [x0, z0, x1, z1],
    north: [16 - x1, 16 - y1, 16 - x0, 16 - y0],
    south: [x0, 16 - y1, x1, 16 - y0],
    west: [z0, 16 - y1, z1, 16 - y0],
    east: [16 - z1, 16 - y1, 16 - z0, 16 - y0],
  }[dir];
}

const SHADE = { up: 1, down: 0.5, north: 0.8, south: 0.8, east: 0.62, west: 0.62 };
const rad = (d) => (d * Math.PI) / 180;

function rotateAxis([x, y, z], axis, deg) {
  const [c, s] = [Math.cos(rad(deg)), Math.sin(rad(deg))];
  if (axis === 'x') return [x, y * c - z * s, y * s + z * c];
  if (axis === 'y') return [x * c + z * s, y, -x * s + z * c];
  return [x * c - y * s, x * s + y * c, z];
}

/** PNG icon (size x size) of the item model in `file`, or null when it has nothing to draw. */
function renderItemModel(assets, file, size = 128) {
  const { textures, display, elements } = loadModel(assets, file);
  const texture = textureLoader(assets, textures);
  const gui = display.gui || { rotation: [30, 225, 0], scale: [0.625, 0.625, 0.625] }; // Minecraft's default for 3D items
  const [rx, ry, rz] = gui.rotation || [0, 0, 0];
  const toView = (p) => {
    // model space (0..16) -> centred, then the GUI rotation (X, then Y, then Z, applied as Rx·Ry·Rz)
    let v = [(p[0] - 8) / 16, (p[1] - 8) / 16, (p[2] - 8) / 16];
    v = rotateAxis(rotateAxis(rotateAxis(v, 'z', rz), 'y', ry), 'x', rx);
    return [v[0], -v[1], v[2]]; // screen: y down; z towards the viewer
  };

  const quads = [];
  for (const el of elements) {
    for (const [dir, face] of Object.entries(el.faces || {})) {
      const tex = texture(face.texture);
      if (!tex) continue;
      let pts = faceCorners(dir, el.from, el.to);
      if (el.rotation?.angle) {
        const o = el.rotation.origin || [8, 8, 8];
        pts = pts.map((p) => rotateAxis([p[0] - o[0], p[1] - o[1], p[2] - o[2]], el.rotation.axis, el.rotation.angle)).map((p) => [p[0] + o[0], p[1] + o[1], p[2] + o[2]]);
      }
      const [u1, v1, u2, v2] = face.uv || defaultUv(dir, el.from, el.to);
      let uvs = [[u1, v1], [u2, v1], [u2, v2], [u1, v2]];
      const turns = ((face.rotation || 0) / 90) % 4;
      uvs = uvs.map((_, i) => uvs[(i - turns + 4) % 4]);
      const v = pts.map(toView);
      // keep faces turned towards the viewer: clockwise on screen (y down) when seen from outside
      const area = v.reduce((s, p, i) => s + (p[0] * v[(i + 1) % 4][1] - v[(i + 1) % 4][0] * p[1]), 0);
      if (area <= 1e-9) continue;
      quads.push({ v, uv: uvs, tex, shade: SHADE[dir] ?? 1 });
    }
  }
  if (!quads.length) return null;

  // fit everything in the image with a small margin
  const all = quads.flatMap((q) => q.v);
  const [minX, maxX] = [Math.min(...all.map((p) => p[0])), Math.max(...all.map((p) => p[0]))];
  const [minY, maxY] = [Math.min(...all.map((p) => p[1])), Math.max(...all.map((p) => p[1]))];
  const scale = (size * 0.92) / Math.max(maxX - minX, maxY - minY, 1e-6);
  const ox = (size - (maxX - minX) * scale) / 2 - minX * scale;
  const oy = (size - (maxY - minY) * scale) / 2 - minY * scale;

  const out = new Uint8Array(size * size * 4);
  const zbuf = new Float32Array(size * size).fill(-Infinity);
  for (const q of quads) {
    const s = q.v.map((p) => [p[0] * scale + ox, p[1] * scale + oy, p[2]]);
    for (const [a, b, c] of [[0, 1, 2], [0, 2, 3]]) {
      const [A, B, C] = [s[a], s[b], s[c]];
      const den = (B[1] - C[1]) * (A[0] - C[0]) + (C[0] - B[0]) * (A[1] - C[1]);
      if (Math.abs(den) < 1e-9) continue;
      const x0 = Math.max(0, Math.floor(Math.min(A[0], B[0], C[0])));
      const x1 = Math.min(size - 1, Math.ceil(Math.max(A[0], B[0], C[0])));
      const y0 = Math.max(0, Math.floor(Math.min(A[1], B[1], C[1])));
      const y1 = Math.min(size - 1, Math.ceil(Math.max(A[1], B[1], C[1])));
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const [px, py] = [x + 0.5, y + 0.5];
          const w0 = ((B[1] - C[1]) * (px - C[0]) + (C[0] - B[0]) * (py - C[1])) / den;
          const w1 = ((C[1] - A[1]) * (px - C[0]) + (A[0] - C[0]) * (py - C[1])) / den;
          const w2 = 1 - w0 - w1;
          if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
          const z = w0 * A[2] + w1 * B[2] + w2 * C[2];
          const i = y * size + x;
          if (z <= zbuf[i]) continue;
          const u = w0 * q.uv[a][0] + w1 * q.uv[b][0] + w2 * q.uv[c][0];
          const v = w0 * q.uv[a][1] + w1 * q.uv[b][1] + w2 * q.uv[c][1];
          const tx = Math.min(q.tex.width - 1, Math.max(0, Math.floor((u / 16) * q.tex.width)));
          const ty = Math.min(q.tex.height - 1, Math.max(0, Math.floor((v / 16) * q.tex.height)));
          const t = (ty * q.tex.width + tx) * 4;
          if (q.tex.rgba[t + 3] < 128) continue; // cut-out transparency, as Minecraft draws items
          zbuf[i] = z;
          out.set([q.tex.rgba[t] * q.shade, q.tex.rgba[t + 1] * q.shade, q.tex.rgba[t + 2] * q.shade, 255], i * 4);
        }
      }
    }
  }
  return encodePng(size, size, out);
}

module.exports = { renderItemModel, decodePng, encodePng };
