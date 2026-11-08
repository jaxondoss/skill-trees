/* FORGE room prototype: the WebGL2 lighting compositor (LIGHTING_SPEC v1.1, INTERFACES section 6).
 *
 * render.js fills the indexed framebuffer f.buf (palette indices, world res) and the aux buffer f.aux (depth,
 * flags, material ID per world pixel); frame(f, opts) lights them and returns a WebGL canvas of f.w * f.z by
 * f.h * f.z device px whose top-left is world (f.x0, f.y0). render.js draws that canvas where it would have
 * drawn its own framebuffer canvas. frame() returns null when the tier is Off, WebGL2 is missing or the context
 * is lost; render.js then keeps the v3.3 Canvas2D path (putImageData + drawLight).
 *
 * Passes (all light passes at world res, so light stays pixel crisp):
 *   P1 light    albedo * (ambient + key + practicals + sun patch) + rim + emissive + seam glow + glint + leaf
 *               transmission (multiply model). Static practicals come from a lightmap baked per view (always-on
 *               and night-only layers); up to 16 dynamic lights are evaluated live.
 *   CPU masks   cast + contact shadows and the sun patch, from the aux depth and floor flags; cached and only
 *               rebuilt on view, 0.5 degree sun bucket, scene (variant/dog) or framing changes.
 *   P2 floor    glossy floor: reflection about floor.backLine with per-plank jitter and streaks
 *   P3 shafts   window light shafts (half or quarter world res), dust motes drawn as 1 px points
 *   P4 bloom    dual-filter (Kawase) bloom at device res / 2 or / 4
 *   P5 grade    filmic shoulder, two generated 3D LUTs blended by keyframe, completion saturation and warmth,
 *               zone focus, vignette, engine-mark bypass, Bayer dither at world px (or retro palette snap)
 *   P6 output   nearest upscale to device px, bloom and grain (per world px) added
 *   P7 hero     v3.5 skill view: the hero's atlas rows (lit in P1..P5 with the room, at their world anchor) drawn
 *               at an integer zoom k at the hero's device rect, Bayer dissolve, grain per art texel
 *
 * v3.5 (PLAN 2.4, D4 3.3): every lighting term is framing independent: data lights are chosen from the whole view,
 * masks are built over the view's art rect, vignette and bounce are anchored to the view; dim and focus are values
 * (opts.dim, opts.focus.k) the navigation tweens, never state kept here.
 *
 * Coordinates: every world-res texture stores world row y at texel row y (y down); only P6 flips to the canvas.
 * Respects ROOM.state.reducedMotion: no flicker, no grain motion, no dust. No light strobes faster than 3 Hz.
 */
(function () {
  'use strict';
  var ROOM = typeof window !== 'undefined' ? (window.ROOM = window.ROOM || {}) : {};

  /* ------------------------------------------------------------------ tiers */
  var TIERS = {
    ultra: { lights: 16, reflTaps: 12, shaftSamples: 32, shaftDiv: 2, bloomLevels: 6, bloomDiv: 2, grain: true, leafRim: true, dust: 50 },
    high: { lights: 16, reflTaps: 8, shaftSamples: 24, shaftDiv: 2, bloomLevels: 5, bloomDiv: 2, grain: true, leafRim: true, dust: 40 },
    medium: { lights: 8, reflTaps: 6, shaftSamples: 16, shaftDiv: 4, bloomLevels: 4, bloomDiv: 4, grain: true, leafRim: true, dust: 30 },
    low: { lights: 4, reflTaps: 4, shaftSamples: 0, shaftDiv: 4, bloomLevels: 3, bloomDiv: 4, grain: false, leafRim: false, dust: 0 },
    off: null,
  };
  var TIER_ORDER = ['ultra', 'high', 'medium', 'low', 'off'];
  var MAX_LIGHTS = 16; // data lights (slots 4..19)
  var RESERVED = 4; // 0 hero SELECT, 1 hover SELECT, 2 zone/panel pool, 3 statue (PLAN R7)
  var SLOTS = MAX_LIGHTS + RESERVED;
  var LUT_N = 32;
  var AUTO_FRAMES = 60;
  var AUTO_P95_MS = 6;

  /** Effect gains (1 = as designed). The harness and the demo drawer drive these. */
  var gains = {
    exposure: 1, ambient: 1, key: 1, practical: 1, emissive: 1, rim: 1, shadow: 1, patch: 1, refl: 1, seam: 1,
    shafts: 1, dust: 1, bloom: 1, grain: 1, vignette: 1, glint: 1, transmission: 1, saturation: 1,
    // v3.5 flags (0 off): worldBloom = bloom at world res with a world-px radius (D4 3.3). ON since integration: stills
    // on/off differ by ~2/255 mean (grain level, same mean luma) and only world bloom passes the zone/wall framing check
    // (front el4 3.43 -> 2.52, back el4 3.31 -> 2.78 vs noise + 1 = 3.19 / 3.13). heroCache = the low-tier hero policy
    // (atlas shaded on light-key change only) at any tier
    worldBloom: 1, heroCache: 0,
  };

  /* ------------------------------------------------------------------ material tables */
  // TEXTURE_SPEC section 4: id: [emissive, rim, gloss, rough, transl, glint]
  var MATERIAL_IDS = {
    1: ['plaster', 0, 0.4, 0, 1.0, 0, 0],
    2: ['plaster_venetian', 0, 0.5, 0.15, 0.6, 0, 0],
    3: ['wood_floor', 0, 0.5, 0.35, 0.5, 0, 0.05],
    4: ['wood_furniture', 0, 0.7, 0.1, 0.7, 0, 0.05],
    5: ['wood_ceiling', 0, 0.3, 0, 1.0, 0, 0],
    6: ['fabric_cotton', 0, 0.4, 0, 1.0, 0.15, 0],
    7: ['fabric_velvet', 0, 0.9, 0, 1.0, 0, 0],
    8: ['rug_pile', 0, 0.3, 0, 1.0, 0, 0],
    9: ['paper', 0, 0.3, 0, 1.0, 0.2, 0],
    10: ['cork', 0, 0.2, 0, 1.0, 0, 0],
    11: ['metal_painted', 0, 0.6, 0.2, 0.5, 0, 0.2],
    12: ['metal_brushed', 0, 0.8, 0.3, 0.4, 0, 0.4],
    13: ['chrome', 0, 1.0, 0.6, 0.1, 0, 1.0],
    14: ['cast_iron', 0, 0.6, 0.1, 0.8, 0, 0.3],
    15: ['gold_metal', 0, 1.0, 0.4, 0.3, 0, 0.8],
    16: ['stone', 0, 0.5, 0, 1.0, 0, 0],
    17: ['glass_window', 0, 0.2, 0.8, 0.1, 1.0, 0.6],
    18: ['glass_crt', 0, 0.4, 0.7, 0.2, 0, 0.6],
    19: ['screen_emissive', 0.7, 0, 0, 1.0, 0, 0],
    20: ['plastic', 0, 0.6, 0.2, 0.4, 0, 0.5],
    21: ['leaf', 0, 0.8, 0.1, 0.6, 0.5, 0.1],
    22: ['soil', 0, 0.1, 0, 1.0, 0, 0],
    23: ['terracotta', 0, 0.6, 0, 0.9, 0, 0],
    24: ['ceramic', 0, 0.7, 0.4, 0.3, 0, 0.6],
    25: ['book_cloth', 0, 0.5, 0, 0.9, 0, 0.05],
    26: ['neon', 1.0, 0, 0, 1.0, 0, 0],
    27: ['bulb', 1.0, 0, 0, 1.0, 0, 0],
    28: ['flame', 1.0, 0, 0, 1.0, 0, 0],
    29: ['wet', 0, 0.3, 0.9, 0.05, 0, 1.0],
    30: ['sky', 0.8, 0, 0, 1.0, 0, 0],
  };
  var MAT_GOLD = 15, MAT_SKY = 30;

  /**
   * Palette-index fallback (LIGHTING_SPEC 3.3) by colour name: [emissive, rim, gloss, transl, rough, glint,
   * gold, emissiveOverride]. emissiveOverride is the strength a pixel gets when render.js sets the emissive flag
   * on it (window sun, bulbs, neon); emissive itself is the default without the flag (CRT, knight energy).
   */
  function paletteMaterial(name) {
    name = name || '';
    if (name === 'SUN' || name === 'CREAM') return [0, 0, 0, 0, 1, 0, 0, 1.0];
    if (name === 'GLOW' || name === 'AMBER') return [0, 0.6, 0, 0, 1, 0, 0, 0.8];
    if (/^CRT_/.test(name)) return [0.7, 0, 0, 0, 1, 0, 0, 0.8];
    if (/^ENERGY/.test(name)) return [0.35, 0.3, 0, 0, 1, 0, 0, 0.7];
    if (/^GOLD/.test(name)) return [0, 1.0, 0, 0, 0.3, name === 'GOLD_HI' || name === 'GOLD' ? 0.8 : 0.2, 1, 0.6];
    if (/^LEAF_/.test(name)) return [0, 0.8, 0, 0.5, 0.6, 0.1, 0, 0.6];
    if (/^(OAK|BROWN|TERRA)/.test(name)) return [0, 0.7, 0, 0, 0.7, 0.05, 0, 0.6];
    if (name === 'SLATE_2' || name === 'SLATE_3') return [0, 0.6, 0, 0, 0.3, 0.4, 0, 0.6];
    if (/^(SLATE|PLASTER|NAVY)/.test(name)) return [0, 0.5, 0, 0, 0.8, 0, 0, 0.6];
    if (/^(PLUM|ROSE|VIOLET)/.test(name)) return [0, 0.6, 0, 0, 1, 0, 0, 0.6];
    if (/^(PAPER)/.test(name)) return [0, 0.3, 0, 0.2, 1, 0, 0, 0.6];
    if (/^LINEN/.test(name)) return [0, 0.4, 0, 0.15, 1, 0, 0, 0.6];
    if (/^(COOL|GLASS|RAIN|HAZE)/.test(name)) return [0, 0.3, 0, 0, 0.4, 0.2, 0, 0.6];
    if (/^(VOID|INK)/.test(name)) return [0, 0.2, 0, 0, 1, 0, 0, 0.6];
    if (name === 'RIM' || name === 'ORANGE') return [0, 0.6, 0, 0, 1, 0, 0, 0.8];
    return [0, 0.5, 0, 0, 0.8, 0, 0, 0.6];
  }
  // TEXTURE_SPEC section 3: the 27 colours that extend the 37 to 64 (used for the retro snap when the bundle
  // palette is still the 37-colour one).
  var EXT_PALETTE = [
    '#2E1A12', '#C0864A', '#2A1B26', '#43303B', '#553C49', '#6B4C58', '#221E24', '#4A2E3A', '#F0B8C6', '#3F1312',
    '#2A3638', '#C4DADB', '#1E2632', '#2B3646', '#3D4A60', '#D9C9A6', '#A8987A', '#B7CE74', '#A47A30', '#F2D27A',
    '#5D7FA6', '#8FA9C9', '#C9DAEE', '#1A2228', '#BFAE95', '#8C7C6C', '#4A3F4C',
  ];
  var BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

  /* ------------------------------------------------------------------ GLSL */
  var HEAD = [
    '#version 300 es',
    'precision highp float;',
    'precision highp int;',
    'precision highp sampler2D;',
    'precision highp sampler3D;',
    'vec3 s2l(vec3 c){ return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c)); }',
    'vec3 l2s(vec3 c){ c = clamp(c, 0.0, 1.0); return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c)); }',
    'float lum(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }',
    'float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }',
    '',
  ].join('\n');

  var VS = ['#version 300 es', 'void main(){ vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)); gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }'].join('\n');

  // Practical lights: shared by P1 and the lightmap bake. Types: 0 point, 1 area (rect), 2 line, 3 cone; -1 empty.
  // v3.5 slots (PLAN R7): 0 hero SELECT, 1 hover SELECT (both bit6 only, see FS_LIGHT), 2 zone/panel pool,
  // 3 statue, 4.. data lights chosen from the whole view (framing independent).
  var LIGHTS_GLSL = [
    'uniform int uN;',
    'uniform vec4 uLP[' + SLOTS + '];', // x, y, radius, depth 0..1 (< 0: no facing test); SELECT: w = lift
    'uniform vec4 uLC[' + SLOTS + '];', // linear rgb * intensity, type
    'uniform vec4 uLX[' + SLOTS + '];', // area: half w, half h; line: x2, y2; z: vertical squash
    'uniform vec4 uLY[' + SLOTS + '];', // cone: dir x, dir y, cos outer, cos inner
    'vec3 practicalAt(vec2 p, float depth){',
    '  vec3 acc = vec3(0.0);',
    '  for (int i = 2; i < ' + SLOTS + '; i++) {',
    '    if (i >= uN) break;',
    '    vec4 P = uLP[i]; vec4 C = uLC[i]; vec4 X = uLX[i];',
    '    if (C.a < -0.5) continue;',
    '    int ty = int(C.a + 0.5);',
    '    vec2 d;',
    '    if (ty == 1) d = max(abs(p - P.xy) - X.xy, 0.0);',
    '    else if (ty == 2) { vec2 ab = X.xy - P.xy; float t = clamp(dot(p - P.xy, ab) / max(dot(ab, ab), 1e-3), 0.0, 1.0); d = p - (P.xy + ab * t); }',
    '    else d = p - P.xy;',
    '    d.y /= max(X.z, 0.05);',
    '    vec2 dn = d / P.z;',
    '    float a = clamp(1.0 - dot(dn, dn), 0.0, 1.0);',
    '    a *= a;',
    '    if (a <= 0.0) continue;',
    '    if (ty == 3) { vec2 v = p - P.xy; float l = length(v); float c = l > 0.75 ? dot(v / l, uLY[i].xy) : 1.0; a *= smoothstep(uLY[i].z, uLY[i].w, c); }',
    '    if (P.w >= 0.0 && depth + 0.05 < P.w) a *= 0.6;',
    '    acc += C.rgb * a;',
    '  }',
    '  return acc;',
    '}',
    '',
  ].join('\n');

  // v3.5 worldOf (D1 2.1): room texels map through uOrigin; atlas texels (rows >= uRoomH, the hero sprite) map to
  // the hero's world rect: world = (x, y - atlas.y) + atlas.off. uAtlas = (y, h, offX, offY), uAtlasOn 0/1.
  var WORLD_GLSL = [
    'uniform vec2 uOrigin; uniform int uRoomH; uniform vec4 uAtlas; uniform int uAtlasOn;',
    'bool isAtlas(ivec2 ip){ return uAtlasOn == 1 && ip.y >= uRoomH; }',
    'vec2 worldOf(ivec2 ip){ return isAtlas(ip) ? vec2(float(ip.x), float(ip.y) - uAtlas.x) + uAtlas.zw + 0.5 : uOrigin + vec2(ip) + 0.5; }',
    '',
  ].join('\n');
  // Shadow / patch mask: built once per view over the art rect (world coords), sampled by world position.
  var MASK_GLSL = [
    'uniform sampler2D uShadow; uniform vec2 uMaskO; uniform ivec2 uMaskS;',
    'vec2 maskAt(vec2 p){ ivec2 q = ivec2(floor(p - uMaskO)); if (q.x < 0 || q.y < 0 || q.x >= uMaskS.x || q.y >= uMaskS.y) return vec2(0.0); return texelFetch(uShadow, q, 0).rg; }',
    '',
  ].join('\n');

  var FS_BAKE = HEAD + LIGHTS_GLSL + [
    'uniform vec4 uRect; uniform vec2 uDst; uniform float uEnc;',
    'out vec4 o;',
    'void main(){ vec2 p = uRect.xy + gl_FragCoord.xy * (uRect.zw / uDst); o = vec4(practicalAt(p, -1.0) * uEnc, 1.0); }',
  ].join('\n');

  var FS_LIGHT = HEAD + LIGHTS_GLSL + WORLD_GLSL + MASK_GLSL + [
    'uniform sampler2D uIndex, uAux, uPal, uPalMat, uMatId, uLmA, uLmN;',
    'uniform ivec2 uSize; uniform float uEnc; uniform int uMode;',
    'uniform vec4 uLmRect; uniform float uLmNight;',
    'uniform vec3 uAmb; uniform float uCeil;',
    'uniform vec3 uKey; uniform vec2 uKeyC; uniform vec2 uKeyR; uniform float uKeyWall; uniform float uRimSpread;',
    'uniform vec3 uBounce; uniform vec2 uBounceY;',
    'uniform float uShadowK; uniform vec3 uRim; uniform float uStatueRim; uniform float uLeafRim;',
    'uniform vec3 uPatch; uniform vec3 uSeam; uniform vec3 uSkyTint; uniform float uSky; uniform float uEmis;',
    'uniform vec3 uGlint; uniform float uTransK; uniform vec4 uWin; uniform float uSelRim;',
    'out vec4 o;',
    // SELECT light (slot 0 hero on atlas texels, slot 1 hover on room texels): only bit6 texels receive it. The
    // light sits lift px toward the camera, so the falloff over the object is gentle (no hot spot).
    'vec3 selectAt(int s, vec2 p){ vec4 P = uLP[s]; vec4 C = uLC[s]; if (C.a < -0.5 || s >= uN) return vec3(0.0);',
    '  vec2 d = p - P.xy; float a = clamp(1.0 - (dot(d, d) + P.w * P.w) / max(P.z * P.z, 1.0), 0.0, 1.0); return C.rgb * a * a; }',
    'ivec2 gHi;', // neighbour clamp: room texels never read the atlas rows, atlas texels read their own rows
    'vec3 auxAt(ivec2 q){ q = clamp(q, ivec2(0), gHi); return floor(texelFetch(uAux, q, 0).rgb * 255.0 + 0.5); }',
    'float lumAt(ivec2 q){ q = clamp(q, ivec2(0), gHi); int i = int(texelFetch(uIndex, q, 0).r * 255.0 + 0.5); return lum(s2l(texelFetch(uPal, ivec2(i, 0), 0).rgb)); }',
    // 1 when the neighbour q is further back than depth dB (or is sky / window glass): a lit edge.
    'float edgeTo(ivec2 q, float dB){ vec3 a = auxAt(q); int f = int(a.g); if ((f & 8) != 0) return 1.0; if (a.b > 29.5 && a.b < 30.5) return 1.0; return (a.r < 254.5 && a.r + 2.0 < dB) ? 1.0 : 0.0; }',
    'void main(){',
    '  ivec2 ip = ivec2(gl_FragCoord.xy);',
    '  bool atl = isAtlas(ip);',
    '  gHi = atl ? uSize - 1 : ivec2(uSize.x - 1, min(uSize.y, uRoomH) - 1);',
    '  vec2 p = worldOf(ip);',
    '  int idx = int(texelFetch(uIndex, ip, 0).r * 255.0 + 0.5);',
    '  vec3 ax = floor(texelFetch(uAux, ip, 0).rgb * 255.0 + 0.5);',
    '  float dB = ax.r; int fl = int(ax.g); int mid = int(ax.b);',
    '  vec3 alb = s2l(texelFetch(uPal, ivec2(idx, 0), 0).rgb);',
    '  bool hasMat = mid > 0 && mid < 32;',
    '  vec4 m0 = hasMat ? texelFetch(uMatId, ivec2(mid, 0), 0) : texelFetch(uPalMat, ivec2(idx, 0), 0);',
    '  vec4 m1 = hasMat ? texelFetch(uMatId, ivec2(mid, 1), 0) : texelFetch(uPalMat, ivec2(idx, 1), 0);',
    '  bool fEm = (fl & 1) != 0, fFloor = (fl & 2) != 0, fSeam = (fl & 4) != 0, fWin = (fl & 8) != 0;',
    '  bool fMark = (fl & 16) != 0, fLeaf = (fl & 32) != 0, fHover = (fl & 64) != 0, fNoRim = (fl & 128) != 0;',
    '  bool isSky = fWin || (hasMat && m1.a > 0.5);',
    // material IDs carry their own emissive; on the palette fallback only flagged pixels glow, at the table strength
    '  float emis = hasMat ? (fEm ? max(m0.r, 0.6) : m0.r) : (fEm ? max(m0.r, m1.a) : 0.0);',
    '  bool ceil = dB > 254.5;',
    '  bool obj = dB > 0.5 && !ceil && !fFloor && !isSky;',
    '  vec2 sp = atl ? vec2(0.0) : maskAt(p);',
    '  float sh = clamp(sp.r * uShadowK, 0.0, 1.0);',
    // key: soft elliptical pool on the floor in front of the window; the wall around a backlit window gets less
    '  float kl = length((p - uKeyC) / uKeyR);',
    '  float kf = 1.0 - smoothstep(0.0, 1.0, kl); kf *= kf;',
    '  float wf = ceil ? 0.12 : (dB < 0.5 && !fFloor) ? uKeyWall : 1.0;',
    '  vec3 key = uKey * kf * wf * (1.0 - sh);',
    '  float by = clamp((p.y - uBounceY.x) / max(uBounceY.y - uBounceY.x, 1.0), 0.0, 1.0);',
    '  key += uBounce * mix(0.55, 1.0, by) * (ceil ? 0.35 : 1.0) * (1.0 - sh * 0.5);',
    '  vec2 lmuv = (p - uLmRect.xy) / uLmRect.zw;',
    '  vec3 prac = (texture(uLmA, lmuv).rgb + texture(uLmN, lmuv).rgb * uLmNight) / uEnc + practicalAt(p, dB / 255.0);',
    '  vec3 amb = uAmb * (ceil ? uCeil : 1.0);',
    '  vec3 patchL = fFloor ? uPatch * sp.g * (1.0 - sh) : vec3(0.0);',
    '  vec3 light = amb + key + prac + patchL;',
    '  if (fHover) light += selectAt(atl ? 0 : 1, p);',
    // rim: one world px on edges facing the key (and a weaker top rim), from the depth buffer
    '  vec3 rim = vec3(0.0); float edge = 0.0;',
    '  float rf = 1.0 - smoothstep(0.0, 1.0, kl / uRimSpread);',
    '  bool leafy = fLeaf || m0.a > 0.3;',
    '  if (obj && !fNoRim && !fMark && m0.g > 0.0 && (uLeafRim > 0.5 || !leafy)) {',
    '    vec2 tl = uKeyC - p; vec2 st = tl / max(max(abs(tl.x), abs(tl.y)), 1e-3);',
    '    ivec2 o1 = ivec2(round(st));',
    '    edge = max(edgeTo(ip + o1, dB), edgeTo(ip + ivec2(0, -1), dB) * 0.5);',
    '    float g = m0.g * (m1.b > 0.5 ? uStatueRim : 1.0) * (fHover ? uSelRim : 1.0);',
    '    rim = uRim * edge * g * rf * (1.0 - sh);',
    '  }',
    // leaf / translucent transmission when between the camera and the window
    '  vec3 trans = vec3(0.0);',
    '  float trn = max(m0.a, fLeaf ? 0.5 : 0.0);',
    '  if (obj && trn > 0.0 && edge <= 0.0) {',
    '    vec2 q = max(max(uWin.xy - p, p - (uWin.xy + uWin.zw)), 0.0);',
    '    float wp = uWin.z > 0.0 ? 1.0 - smoothstep(0.0, 48.0, length(q)) : 0.0;',
    '    trans = uKey * trn * uTransK * 0.3 * max(wp, rf) * vec3(0.75, 1.0, 0.42) * alb * 4.0;',
    '  }',
    // glint: single-pixel speculars on the top shade of glinty materials under a strong key
    '  vec3 glint = vec3(0.0);',
    '  if (obj && m1.g > 0.0) {',
    '    float la = lum(alb);',
    '    if (la > 0.25 && la > lumAt(ip + ivec2(-1, 0)) && la >= lumAt(ip + ivec2(0, -1)) && la >= lumAt(ip + ivec2(1, 0))) {',
    '      float ks = lum(uKey) * rf * (1.0 - sh);',
    '      glint = uGlint * m1.g * smoothstep(0.35, 0.9, ks);',
    '    }',
    '  }',
    '  vec3 seam = fSeam ? uSeam * (lum(uKey) * kf * 1.4 * (1.0 - sh) + lum(prac) * 0.8) : vec3(0.0);',
    '  vec3 lit;',
    '  if (fMark) lit = alb * light + alb * emis * 4.0 * uEmis;',
    '  else if (isSky) lit = alb * uSkyTint * uSky * 2.1 + alb * prac * 0.15;',
    '  else lit = alb * light + rim + alb * emis * 4.0 * uEmis + seam + glint + trans;',
    '  if (uMode == 1) lit = alb;',
    '  else if (uMode == 2) lit = (light + rim) * 0.5;',
    '  o = vec4(lit * uEnc, 1.0);',
    '}',
  ].join('\n');

  var FS_FLOOR = HEAD + WORLD_GLSL + [
    'uniform sampler2D uLit, uAux, uMatId;',
    'uniform ivec2 uSize; uniform float uEnc; uniform int uMode;',
    'uniform float uBack, uBottom, uSquash, uReflK; uniform int uTaps;',
    'out vec4 o;',
    'void main(){',
    '  ivec2 ip = ivec2(gl_FragCoord.xy);',
    '  vec4 c = texelFetch(uLit, ip, 0);',
    '  vec3 ax = floor(texelFetch(uAux, ip, 0).rgb * 255.0 + 0.5);',
    '  int fl = int(ax.g); int mid = int(ax.b);',
    '  if (isAtlas(ip) || (fl & 2) == 0 || (fl & 4) != 0 || (fl & 16) != 0) { o = uMode == 1 ? vec4(0.0, 0.0, 0.0, 1.0) : c; return; }',
    '  vec2 p = worldOf(ip);',
    '  float t = clamp((p.y - uBack) / max(uBottom - uBack, 1.0), 0.0, 1.0);',
    '  float sy = uBack - (p.y - uBack) * uSquash;',
    '  bool hasMat = mid > 0 && mid < 32;',
    '  float gloss = hasMat ? texelFetch(uMatId, ivec2(mid, 0), 0).b : 0.35;',
    '  float rough = hasMat ? texelFetch(uMatId, ivec2(mid, 1), 0).r : 0.5;',
    '  float j = floor(hash12(vec2(floor(p.x / 7.0), floor(p.y / 3.0))) * 3.0) - 1.0;',
    '  float len = mix(2.0, 12.0, t) * mix(0.35, 1.5, rough);',
    '  vec3 acc = vec3(0.0); float ws = 0.0;',
    '  for (int i = 0; i < 12; i++) {',
    '    if (i >= uTaps) break;',
    '    float u = (float(i) + 0.5) / float(uTaps);',
    '    ivec2 q = ivec2(int(floor(p.x - uOrigin.x + j)), int(floor(sy + (u - 0.25) * len - uOrigin.y)));',
    '    if (q.x < 0 || q.y < 0 || q.x >= uSize.x || q.y >= uSize.y) continue;',
    '    vec3 a2 = floor(texelFetch(uAux, q, 0).rgb * 255.0 + 0.5);',
    '    if ((int(a2.g) & 2) != 0) continue;',
    '    acc += texelFetch(uLit, q, 0).rgb; ws += 1.0;',
    '  }',
    '  vec3 refl = ws > 0.0 ? acc / ws / uEnc : vec3(0.0);',
    '  float bright = smoothstep(0.35, 0.9, lum(refl));',
    '  float fres = mix(0.55, 0.12, t);',
    '  vec3 add = refl * fres * gloss * bright * uReflK;',
    '  o = uMode == 1 ? vec4(add * uEnc, 1.0) : vec4(c.rgb + add * uEnc, 1.0);',
    '}',
  ].join('\n');

  var FS_SHAFT = HEAD + [
    'uniform sampler2D uAux;',
    'uniform vec2 uOrigin; uniform ivec2 uSize; uniform float uDiv;',
    'uniform vec2 uDir; uniform float uStep; uniform int uSamples; uniform float uDecay; uniform vec3 uCol; uniform vec4 uWin;',
    'out vec4 o;',
    'void main(){',
    '  vec2 p = uOrigin + gl_FragCoord.xy * uDiv;',
    '  ivec2 b0 = ivec2(floor(p - uOrigin));',
    '  float acc = 0.0, tr = 1.0, w = 1.0;',
    '  for (int i = 1; i <= 32; i++) {',
    '    if (i > uSamples) break;',
    '    vec2 q = p - uDir * (float(i) * uStep);',
    '    ivec2 b = ivec2(floor(q - uOrigin));',
    '    float glass = 0.0;',
    '    if (b.x >= 0 && b.y >= 0 && b.x < uSize.x && b.y < uSize.y) {',
    '      vec3 a = floor(texelFetch(uAux, b, 0).rgb * 255.0 + 0.5); int f = int(a.g);',
    '      if ((f & 8) != 0 || (a.b > 29.5 && a.b < 30.5)) glass = 1.0;',
    '      else if (a.r > 0.5 && a.r < 254.5 && (f & 2) == 0) tr *= 0.6;',
    '    } else if (q.x >= uWin.x && q.y >= uWin.y && q.x < uWin.x + uWin.z && q.y < uWin.y + uWin.w) glass = 1.0;',
    '    acc += glass * tr * w; w *= uDecay;',
    '  }',
    '  float self = 0.0;',
    '  if (b0.x >= 0 && b0.y >= 0 && b0.x < uSize.x && b0.y < uSize.y) { int f0 = int(floor(texelFetch(uAux, b0, 0).g * 255.0 + 0.5)); self = (f0 & 8) != 0 ? 1.0 : 0.0; }',
    '  o = vec4(uCol * acc * (4.2 / float(uSamples)) * (1.0 - self), 1.0);',
    '}',
  ].join('\n');

  var VS_DUST = [
    '#version 300 es',
    'precision highp float;',
    'uniform vec2 uOrigin; uniform ivec2 uSize; uniform float uTime; uniform vec4 uVol; uniform vec2 uDir;',
    'uniform sampler2D uShaft;',
    'out float vB;',
    'float h1(float n){ return fract(sin(n * 12.9898) * 43758.5453); }',
    'void main(){',
    '  float id = float(gl_VertexID) + 1.0;',
    '  float a = h1(id), b = h1(id + 17.31), c = h1(id + 41.7);',
    '  float speed = mix(2.0, 6.0, c);',
    '  float s = mod(b * uVol.w + uTime * speed, uVol.w);',
    '  vec2 pos = vec2(uVol.x + a * uVol.z, uVol.y) + uDir * s / max(uDir.y, 0.2);',
    '  pos.x += sin(uTime * (0.3 + 0.4 * c) + id * 2.1) * 2.5;',
    '  pos = floor(pos) + 0.5;',
    '  vec2 bp = pos - uOrigin;',
    '  vB = dot(texture(uShaft, bp / vec2(uSize)).rgb, vec3(0.2126, 0.7152, 0.0722)) * (0.6 + 0.4 * h1(id + 3.3));',
    '  gl_Position = vec4(bp / vec2(uSize) * 2.0 - 1.0, 0.0, 1.0);',
    '  gl_PointSize = 1.0;',
    '}',
  ].join('\n');
  var FS_DUST = HEAD + ['uniform vec3 uCol; uniform float uEnc; in float vB; out vec4 o;', 'void main(){ o = vec4(uCol * vB * uEnc, 1.0); }'].join('\n');

  var FS_PRE = HEAD + [
    'uniform sampler2D uHdr, uShaft, uAux;',
    'uniform vec2 uDst; uniform ivec2 uSize; uniform float uEnc, uShaftK, uThresh, uKnee, uVS;',
    'out vec4 o;',
    'void main(){',
    '  vec2 uv = gl_FragCoord.xy / uDst;',
    '  vec3 c = texture(uHdr, vec2(uv.x, uv.y * uVS)).rgb / uEnc + texture(uShaft, uv).rgb * uShaftK;',
    '  ivec2 wp = clamp(ivec2(uv * vec2(uSize)), ivec2(0), uSize - 1);',
    '  vec3 ax = floor(texelFetch(uAux, wp, 0).rgb * 255.0 + 0.5); int f = int(ax.g);',
    '  float l = lum(c);',
    '  float soft = clamp(l - uThresh + uKnee, 0.0, 2.0 * uKnee); soft = soft * soft / (4.0 * uKnee + 1e-4);',
    '  vec3 b = c * (max(soft, l - uThresh) / max(l, 1e-4));',
    '  if ((f & 1) != 0 || (f & 8) != 0 || (ax.b > 18.5 && ax.b < 19.5) || (ax.b > 25.5 && ax.b < 28.5)) b = c;',
    '  o = vec4(b * uEnc, 1.0);',
    '}',
  ].join('\n');

  var FS_DOWN = HEAD + [
    'uniform sampler2D uSrc; uniform vec2 uTexel; uniform vec2 uDst;',
    'out vec4 o;',
    'void main(){ vec2 uv = gl_FragCoord.xy / uDst; vec2 h = uTexel;',
    '  vec3 s = texture(uSrc, uv).rgb * 4.0 + texture(uSrc, uv - h).rgb + texture(uSrc, uv + h).rgb + texture(uSrc, uv + vec2(h.x, -h.y)).rgb + texture(uSrc, uv - vec2(h.x, -h.y)).rgb;',
    '  o = vec4(s / 8.0, 1.0); }',
  ].join('\n');

  var FS_UP = HEAD + [
    'uniform sampler2D uSrc, uAdd; uniform vec2 uTexel; uniform vec2 uDst; uniform float uAddK;',
    'out vec4 o;',
    'void main(){ vec2 uv = gl_FragCoord.xy / uDst; vec2 h = uTexel * 0.5;',
    '  vec3 s = texture(uSrc, uv + vec2(-h.x * 2.0, 0.0)).rgb + texture(uSrc, uv + vec2(-h.x, h.y)).rgb * 2.0',
    '    + texture(uSrc, uv + vec2(0.0, h.y * 2.0)).rgb + texture(uSrc, uv + vec2(h.x, h.y)).rgb * 2.0',
    '    + texture(uSrc, uv + vec2(h.x * 2.0, 0.0)).rgb + texture(uSrc, uv + vec2(h.x, -h.y)).rgb * 2.0',
    '    + texture(uSrc, uv + vec2(0.0, -h.y * 2.0)).rgb + texture(uSrc, uv + vec2(-h.x, -h.y)).rgb * 2.0;',
    '  o = vec4(s / 12.0 + texture(uAdd, uv).rgb * uAddK, 1.0); }',
  ].join('\n');

  // Debug views (P5): 0 final, 1 albedo, 2 light, 3 depth, 4 flags, 5 shadow, 6 refl, 7 bloom (P6)
  var DEBUG_IDS = { final: 0, albedo: 1, light: 2, depth: 3, flags: 4, shadow: 5, refl: 6, bloom: 7 };

  var FS_GRADE = HEAD + WORLD_GLSL + MASK_GLSL + [
    'uniform sampler2D uHdr, uShaft, uAux, uIndex, uPal;',
    'uniform sampler3D uLutA, uLutB;',
    'uniform ivec2 uSize; uniform vec2 uRoomS; uniform float uEnc; uniform int uDebug;',
    'uniform float uLutT, uExpo, uSat, uWarm, uShaftK, uDim;',
    'uniform vec4 uFocus; uniform float uFocusK; uniform vec4 uVig; uniform vec4 uVig2; uniform float uVigK;',
    // skill view halo (D1 3.2), world px: darkening + key halo (cx, cy, r, k), select pool and INK contact shadow
    'uniform vec4 uHalo; uniform vec4 uPool; uniform vec4 uShad; uniform vec3 uKeyS; uniform vec3 uInk;',
    'uniform int uRetro; uniform int uRetroN; uniform vec3 uRetroPal[64];',
    'out vec4 o;',
    'const float BAYER[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);',
    'vec3 tonemap(vec3 x){ const float k = 0.62; vec3 over = max(x - k, 0.0); return min(x, vec3(k)) + (1.0 - k) * (1.0 - exp(-over / (1.0 - k))); }',
    'vec3 hueRotate(vec3 c, float deg){',
    '  float a = radians(deg); float ca = cos(a), sa = sin(a);',
    '  vec3 yiq = vec3(dot(c, vec3(0.299, 0.587, 0.114)), dot(c, vec3(0.596, -0.274, -0.322)), dot(c, vec3(0.211, -0.523, 0.312)));',
    '  yiq.yz = vec2(yiq.y * ca - yiq.z * sa, yiq.y * sa + yiq.z * ca);',
    '  return vec3(dot(yiq, vec3(1.0, 0.956, 0.621)), dot(yiq, vec3(1.0, -0.272, -0.647)), dot(yiq, vec3(1.0, -1.106, 1.703)));',
    '}',
    'float ringOf(float t, float b){ return t >= 1.0 ? 0.0 : clamp(floor((1.0 - t) * 3.0 + b), 0.0, 3.0); }',
    'void main(){',
    '  ivec2 ip = ivec2(gl_FragCoord.xy);',
    '  bool atl = isAtlas(ip);',
    '  vec2 p = worldOf(ip);',
    '  vec3 ax = floor(texelFetch(uAux, ip, 0).rgb * 255.0 + 0.5); int fl = int(ax.g);',
    '  int idx = int(texelFetch(uIndex, ip, 0).r * 255.0 + 0.5);',
    '  vec3 palc = texelFetch(uPal, ivec2(idx, 0), 0).rgb;',
    '  if (uDebug == 3) { float d = ax.r / 255.0; o = vec4(ax.r < 0.5 ? vec3(0.05, 0.08, 0.3) : ax.r > 254.5 ? vec3(0.45, 0.1, 0.4) : vec3(d), 1.0); return; }',
    '  if (uDebug == 4) {',
    '    vec3 c = palc * 0.25;',
    '    if ((fl & 2) != 0) c = vec3(0.35, 0.22, 0.1); if ((fl & 4) != 0) c = vec3(1.0, 0.55, 0.1);',
    '    if ((fl & 8) != 0) c = vec3(0.2, 0.8, 1.0); if ((fl & 1) != 0) c = vec3(1.0, 1.0, 0.2);',
    '    if ((fl & 32) != 0) c = vec3(0.2, 0.9, 0.3); if ((fl & 128) != 0) c = mix(c, vec3(0.9, 0.2, 0.2), 0.6);',
    '    if ((fl & 64) != 0) c = vec3(1.0); if ((fl & 16) != 0) c = vec3(1.0, 0.2, 1.0);',
    '    o = vec4(c, 1.0); return; }',
    '  if (uDebug == 5) { vec2 s = atl ? vec2(0.0) : maskAt(p); vec3 c = palc * 0.35; c = mix(c, vec3(0.1, 0.2, 0.9), s.r); c = mix(c, vec3(1.0, 0.85, 0.2), s.g * 0.8); o = vec4(c, 1.0); return; }',
    '  vec3 hdr = texelFetch(uHdr, ip, 0).rgb / uEnc;',
    '  if (uDebug == 1 || uDebug == 2 || uDebug == 6) { o = vec4(l2s(uDebug == 6 ? hdr * 2.0 : hdr), 1.0); return; }',
    '  vec2 suv = (p - uOrigin) / uRoomS;',
    '  if (suv.x >= 0.0 && suv.y >= 0.0 && suv.x <= 1.0 && suv.y <= 1.0) hdr += texture(uShaft, suv).rgb * uShaftK;',
    '  bool mark = (fl & 16) != 0;',
    '  float outF = 0.0;',
    '  if (uFocusK > 0.0 && !atl) { float r = length((p - uFocus.xy) / uFocus.zw); float e = 6.0 / max(min(uFocus.z, uFocus.w), 6.0); outF = smoothstep(1.0, 1.0 + e, r) * uFocusK; }',
    '  hdr *= mix(1.0, 0.45, outF);',
    '  float dimK = (atl || mark) ? 0.0 : uDim;',
    '  vec3 s = l2s(tonemap(hdr * uExpo));',
    '  vec3 uvw = s * ((float(' + LUT_N + ') - 1.0) / float(' + LUT_N + ')) + 0.5 / float(' + LUT_N + ');',
    '  vec3 g = mix(texture(uLutA, uvw).rgb, texture(uLutB, uvw).rgb, uLutT);',
    '  g = mix(g, clamp(hueRotate(g, uWarm), 0.0, 1.0), smoothstep(0.3, 0.85, lum(g)));',
    '  float l = lum(g);',
    '  g = clamp(mix(vec3(l), g, uSat * mix(1.0, 0.7, outF) * (1.0 - 0.3 * dimK)), 0.0, 1.0);',
    '  g *= 1.0 - 0.6 * dimK;',
    '  ivec2 wq = ivec2(floor(p));',
    '  float b = (BAYER[(wq.y & 3) * 4 + (wq.x & 3)] + 0.5) / 16.0;',
    '  if (!atl) {',
    '    float vr = length((p - uVig.xy) / uVig.zw); float vt = clamp((vr - uVig2.x) / (1.0 - uVig2.x), 0.0, 1.0); float ve = vt * vt * (3.0 - 2.0 * vt);',
    '    g *= mix(vec3(1.0), uVig2.yzw, ve * uVigK);',
    '    if (uHalo.w > 0.0 && !mark) {',
    // display darkening behind the hero (x0.3 at the centre), then the key halo 10/6/3 %: 3 dithered rings
    '      float rh = ringOf(length(p - uHalo.xy) / max(uHalo.z, 1.0), b);',
    '      g *= mix(1.0, 0.3, rh / 3.0 * uHalo.w);',
    '      g = mix(g, uKeyS, (rh > 2.5 ? 0.10 : rh > 1.5 ? 0.06 : rh > 0.5 ? 0.03 : 0.0) * uHalo.w);',
    '      float rp = ringOf(length((p - uPool.xy) / max(uPool.zw, vec2(1.0))), b);',
    '      g = mix(g, uKeyS, (rp > 2.5 ? 0.26 : rp > 1.5 ? 0.16 : rp > 0.5 ? 0.08 : 0.0) * uHalo.w);',
    '      float rs = length((p - uShad.xy) / max(uShad.zw, vec2(1.0)));',
    '      if (rs < 1.0 && (rs < 0.75 || b > 0.5)) g = mix(g, uInk, 0.75 * uHalo.w);',
    '    }',
    '  }',
    '  if (uRetro == 1) {',
    '    vec3 gd = g + (b - 0.5) * 0.1; float best = 1e9; vec3 bc = g;',
    '    for (int i = 0; i < 64; i++) { if (i >= uRetroN) break; vec3 d = gd - uRetroPal[i]; float e2 = dot(d * vec3(0.30, 0.59, 0.11), d); if (e2 < best) { best = e2; bc = uRetroPal[i]; } }',
    '    g = mark ? palc : bc;',
    '  } else g = floor(g * 63.0 + b) / 63.0;',
    // A7: the 70 % mark floor goes last, after grade, vignette, halo and quantisation (FS_OUT skips grain on marks)
    '  if (mark) g = max(g, ceil(palc * 0.7 * 63.0) / 63.0);',
    '  o = vec4(g, 1.0);',
    '}',
  ].join('\n');

  var FS_OUT = HEAD + [
    'uniform sampler2D uLdr, uBloom, uAux;',
    'uniform vec2 uCanvas; uniform vec2 uZ; uniform vec2 uOrigin; uniform ivec2 uSize; uniform int uDebug;',
    'uniform float uBloomK, uGrain, uSeed, uEnc;',
    'out vec4 o;',
    'void main(){',
    '  vec2 dev = vec2(gl_FragCoord.x, uCanvas.y - gl_FragCoord.y);',
    '  ivec2 wp = clamp(ivec2(floor(dev / uZ)), ivec2(0), uSize - 1);',
    '  vec3 c = texelFetch(uLdr, wp, 0).rgb;',
    '  vec3 bl = texture(uBloom, dev / uCanvas).rgb / uEnc * uBloomK;',
    '  if (uDebug == 7) { o = vec4(l2s(bl * 2.0), 1.0); return; }',
    '  if (uDebug != 0) { o = vec4(c, 1.0); return; }',
    '  int f = int(floor(texelFetch(uAux, wp, 0).g * 255.0 + 0.5));',
    '  if ((f & 16) != 0) bl = min(bl, vec3(0.004));', // marks keep their contrast next to bright screens (linear)
    '  vec3 outc = l2s(s2l(c) + bl);',
    '  float n = hash12(floor(uOrigin) + vec2(wp) + vec2(uSeed * 7.13, uSeed * 3.71)) - 0.5;',
    '  if ((f & 16) == 0) outc += n * 2.0 * uGrain * (0.35 + 0.65 * lum(outc));',
    '  o = vec4(outc, 1.0);',
    '}',
  ].join('\n');

  // P7 hero (D1 2.1.4): after P6 on the same canvas. A quad at the hero device rect (scissored), texelFetch of the
  // graded atlas at integer k, empty texels (no bit6) discarded, grain per art texel (world anchored), Bayer 4x4
  // dissolve threshold uDst.w (heroK). uSrc is RT.ldr (rows uRow0..) or the low-tier hero cache (uRow0 = 0).
  var FS_HERO = HEAD + [
    'uniform sampler2D uSrc, uAux; uniform vec2 uCanvas; uniform vec4 uDst; uniform ivec2 uAt; uniform int uRow0, uAuxRow0;',
    'uniform vec2 uOff; uniform float uGrain, uSeed; uniform int uDebug;',
    'out vec4 o;',
    'const float BAYER[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);',
    'void main(){',
    '  vec2 dev = vec2(gl_FragCoord.x, uCanvas.y - gl_FragCoord.y);',
    '  ivec2 l = ivec2(floor((dev - uDst.xy) / uDst.z));',
    '  if (l.x < 0 || l.y < 0 || l.x >= uAt.x || l.y >= uAt.y) discard;',
    '  int f = int(floor(texelFetch(uAux, ivec2(l.x, uAuxRow0 + l.y), 0).g * 255.0 + 0.5));',
    '  if ((f & 64) == 0) discard;',
    '  if ((BAYER[(l.y & 3) * 4 + (l.x & 3)] + 0.5) / 16.0 > uDst.w) discard;',
    '  vec3 c = texelFetch(uSrc, ivec2(l.x, uRow0 + l.y), 0).rgb;',
    '  if (uDebug == 0) { float n = hash12(floor(uOff) + vec2(l) + vec2(uSeed * 7.13, uSeed * 3.71)) - 0.5; c += n * 2.0 * uGrain * (0.35 + 0.65 * lum(c)); }',
    '  o = vec4(c, 1.0);',
    '}',
  ].join('\n');

  /* ------------------------------------------------------------------ state */
  var canvas = null, gl = null, caps = null;
  var inited = false, isLost = false, supportedCache = null;
  var tierName = 'high', autoTier = true;
  var P = {}; // programs
  var T = {}; // textures
  var RT = {}; // render targets {tex, fb, w, h}
  var vao = null;
  var enc = 1; // HDR encode factor (1 with float targets, 0.25 on RGBA8)
  var hdrFmt = null;
  var palRGB = new Uint8Array(256 * 3);
  var palNames = [];
  var palCount = 0;
  var palMat = new Uint8Array(256 * 2 * 4);
  var matTable = new Uint8Array(32 * 2 * 4);
  var matOverrides = { byId: {}, byName: {} };
  var cur = { view: null, lighting: null, conf: null };
  var lightingCache = {};
  var lmCache = { key: '' };
  var maskCache = { key: '', data: null, w: 0, h: 0 };
  var timing = { ext: null, pending: [], samples: [], method: 'none', p95: 0, p50: 0, frames: 0, dropped: false };
  var debugView = 'final';
  var retro = false;
  var lastStats = {};
  var stateOverride = null;

  function reduced() {
    return !!(ROOM.state && ROOM.state.reducedMotion) || !!(ROOM.light && ROOM.light.flags && ROOM.light.flags.reducedMotion);
  }

  /* ------------------------------------------------------------------ support */
  /** True when WebGL2 can be created (and float or 8-bit HDR targets work). Cached. */
  function supported() {
    if (supportedCache !== null) return supportedCache;
    try {
      var c = document.createElement('canvas');
      var g = c.getContext('webgl2');
      supportedCache = !!g;
      if (g) {
        var lose = g.getExtension('WEBGL_lose_context');
        if (lose) lose.loseContext();
      }
    } catch {
      supportedCache = false;
    }
    return supportedCache;
  }

  /* ------------------------------------------------------------------ GL helpers */
  function compile(type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) {
      var log = gl.getShaderInfoLog(s);
      var lines = src.split('\n');
      var m = /0:(\d+)/.exec(log || '');
      var ctx = m ? lines.slice(Math.max(0, +m[1] - 3), +m[1] + 2).join('\n') : '';
      throw new Error('ROOM.gl shader: ' + log + '\n' + ctx);
    }
    return s;
  }
  function program(vs, fs) {
    var p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS) && !gl.isContextLost()) throw new Error('ROOM.gl link: ' + gl.getProgramInfoLog(p));
    var info = { p: p, loc: {}, units: {} };
    var n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    var unit = 0;
    for (var i = 0; i < n; i++) {
      var u = gl.getActiveUniform(p, i);
      var name = u.name.replace(/\[0\]$/, '');
      info.loc[name] = gl.getUniformLocation(p, u.name);
      if (u.type === gl.SAMPLER_2D || u.type === gl.SAMPLER_3D) info.units[name] = unit++;
    }
    gl.useProgram(p);
    Object.keys(info.units).forEach(function (k) {
      gl.uniform1i(info.loc[k], info.units[k]);
    });
    return info;
  }
  function tex2d(w, h, ifmt, fmt, type, data, filter) {
    var t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, ifmt, w, h, 0, fmt, type, data || null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter || gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter || gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    t.w = w;
    t.h = h;
    return t;
  }
  function target(w, h, filter) {
    w = Math.max(1, w | 0);
    h = Math.max(1, h | 0);
    var t = tex2d(w, h, hdrFmt.ifmt, gl.RGBA, hdrFmt.type, null, filter || gl.LINEAR);
    var fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    return { tex: t, fb: fb, w: w, h: h };
  }
  function target8(w, h) {
    var t = tex2d(w, h, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, null, gl.NEAREST);
    var fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    return { tex: t, fb: fb, w: w, h: h };
  }
  function freeTarget(r) {
    if (!r) return;
    gl.deleteTexture(r.tex);
    gl.deleteFramebuffer(r.fb);
  }
  /** Run a full-screen pass: bind textures by sampler name, set uniforms, draw into rt (null = canvas). */
  function pass(info, rt, w, h, textures, uniforms) {
    gl.useProgram(info.p);
    gl.bindFramebuffer(gl.FRAMEBUFFER, rt ? rt.fb : null);
    gl.viewport(0, 0, w, h);
    Object.keys(info.units).forEach(function (k) {
      var t = textures[k];
      gl.activeTexture(gl.TEXTURE0 + info.units[k]);
      if (t && t.is3d) {
        gl.bindTexture(gl.TEXTURE_2D, null);
        gl.bindTexture(gl.TEXTURE_3D, t);
      } else {
        gl.bindTexture(gl.TEXTURE_3D, null);
        gl.bindTexture(gl.TEXTURE_2D, t || T.black);
      }
    });
    setUniforms(info, uniforms);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  function setUniforms(info, u) {
    for (var k in u) {
      if (!Object.prototype.hasOwnProperty.call(u, k)) continue;
      var loc = info.loc[k];
      if (loc == null) continue;
      var v = u[k];
      if (typeof v === 'number') gl.uniform1f(loc, v);
      else if (v && v.i != null) gl.uniform1i(loc, v.i);
      else if (v && v.iv) gl.uniform2i(loc, v.iv[0], v.iv[1]);
      else if (v && v.v4) gl.uniform4fv(loc, v.v4);
      else if (v && v.v3) gl.uniform3fv(loc, v.v3);
      else if (v.length === 2) gl.uniform2f(loc, v[0], v[1]);
      else if (v.length === 3) gl.uniform3f(loc, v[0], v[1], v[2]);
      else if (v.length === 4) gl.uniform4f(loc, v[0], v[1], v[2], v[3]);
    }
  }
  function I(n) {
    return { i: n | 0 };
  }

  /* ------------------------------------------------------------------ init and context loss */
  /**
   * Create the WebGL2 canvas and every GPU resource. Returns true on success. Safe to call again (no-op).
   * opts.tier: initial tier name; opts.auto: auto-tiering (default true unless a tier is forced).
   */
  function init(opts) {
    opts = opts || {};
    if (inited && gl && !isLost) return true;
    if (!supported()) return false;
    var flags = (ROOM.light && ROOM.light.flags) || {};
    if (!inited) {
      tierName = opts.tier || flags.tier || 'high';
      autoTier = opts.auto != null ? !!opts.auto : !(opts.tier || flags.tier);
      if (flags.light) debugView = flags.light;
      if (flags.retro != null) retro = flags.retro;
    }
    canvas = canvas || document.createElement('canvas');
    if (!canvas.__roomGl) {
      canvas.__roomGl = true;
      canvas.addEventListener('webglcontextlost', function (e) {
        e.preventDefault();
        isLost = true;
        gl = null;
        if (ROOM.emit) ROOM.emit('gl', { lost: true });
      });
      canvas.addEventListener('webglcontextrestored', function () {
        isLost = false;
        inited = false;
        try {
          if (init()) {
            if (cur.view) setView(cur.view, cur.lighting);
          }
        } catch (err) {
          console.error('ROOM.gl restore failed', err);
        }
        if (ROOM.emit) ROOM.emit('gl', { lost: false });
        if (ROOM.invalidate) ROOM.invalidate();
      });
    }
    gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    if (!gl) return false;
    try {
      build();
    } catch (err) {
      console.error(err);
      gl = null;
      return false;
    }
    inited = true;
    return true;
  }

  function build() {
    caps = {
      floatRT: !!gl.getExtension('EXT_color_buffer_float'),
      halfRT: !!gl.getExtension('EXT_color_buffer_half_float'),
      timer: gl.getExtension('EXT_disjoint_timer_query_webgl2'),
    };
    if (caps.floatRT || caps.halfRT) {
      hdrFmt = { ifmt: gl.RGBA16F, type: gl.HALF_FLOAT };
      enc = 1;
    } else {
      hdrFmt = { ifmt: gl.RGBA8, type: gl.UNSIGNED_BYTE };
      enc = 0.25;
    }
    timing.ext = caps.timer || null;
    vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    P = {
      light: program(VS, FS_LIGHT),
      bake: program(VS, FS_BAKE),
      floor: program(VS, FS_FLOOR),
      shaft: program(VS, FS_SHAFT),
      dust: program(VS_DUST, FS_DUST),
      pre: program(VS, FS_PRE),
      down: program(VS, FS_DOWN),
      up: program(VS, FS_UP),
      grade: program(VS, FS_GRADE),
      out: program(VS, FS_OUT),
      hero: program(VS, FS_HERO),
    };
    T = {};
    RT = {};
    T.black = tex2d(1, 1, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
    T.pal = tex2d(256, 1, gl.RGB8, gl.RGB, gl.UNSIGNED_BYTE, palRGB);
    T.palMat = tex2d(256, 2, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, palMat);
    T.matId = tex2d(32, 2, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, matTable);
    T.luts = {};
    var L = ROOM.light;
    L.KEYFRAME_NAMES.forEach(function (n) {
      var t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_3D, t);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA8, LUT_N, LUT_N, LUT_N, 0, gl.RGBA, gl.UNSIGNED_BYTE, L.gradeLut(L.KEYFRAMES[n].grade, LUT_N));
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
      t.is3d = true;
      T.luts[n] = t;
    });
    lmCache = { key: '' };
    maskCache = { key: '', data: null, w: 0, h: 0 };
    if (!palCount && ROOM.art && ROOM.art.palette) setPalette(ROOM.art.palette.colors);
    else uploadPalette();
    rebuildMaterials();
  }

  /* ------------------------------------------------------------------ palette and materials */
  /**
   * Set the palette: an array of [name, '#RRGGBB'] (ROOM_ART.palette.colors), or of [r, g, b], or a flat
   * Uint8Array of 256 * 3. Names (when given) seed the palette-index material fallback.
   */
  function setPalette(colors) {
    palRGB = new Uint8Array(256 * 3);
    palNames = [];
    palCount = 0;
    if (colors && colors.length === 768 && typeof colors[0] === 'number') {
      palRGB.set(colors);
      palCount = 256;
    } else {
      (colors || []).forEach(function (c, i) {
        if (i > 255) return;
        var rgb;
        if (typeof c[1] === 'string') {
          palNames[i] = c[0];
          rgb = [parseInt(c[1].slice(1, 3), 16), parseInt(c[1].slice(3, 5), 16), parseInt(c[1].slice(5, 7), 16)];
        } else rgb = c;
        palRGB[i * 3] = rgb[0];
        palRGB[i * 3 + 1] = rgb[1];
        palRGB[i * 3 + 2] = rgb[2];
        palCount = i + 1;
      });
    }
    // index 255 (transparent) reads as the first colour (VOID)
    palRGB[255 * 3] = palRGB[0];
    palRGB[255 * 3 + 1] = palRGB[1];
    palRGB[255 * 3 + 2] = palRGB[2];
    uploadPalette();
    rebuildMaterials();
  }
  function uploadPalette() {
    if (!gl || !T.pal) return;
    gl.bindTexture(gl.TEXTURE_2D, T.pal);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 256, 1, gl.RGB, gl.UNSIGNED_BYTE, palRGB);
  }
  /** The retro snap palette: the bundle's colours, extended with the texture spec's 27 to 64. */
  function retroPalette() {
    var out = [];
    for (var i = 0; i < Math.min(palCount, 64); i++) out.push(palRGB[i * 3] / 255, palRGB[i * 3 + 1] / 255, palRGB[i * 3 + 2] / 255);
    for (var k = 0; out.length / 3 < 64 && k < EXT_PALETTE.length; k++) {
      var h = EXT_PALETTE[k];
      out.push(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);
    }
    return new Float32Array(out);
  }
  /**
   * Material responses. table may be:
   *   an array of rows {id, name?, emissive, rim, gloss, rough, translucency|transl, glint} (TEXTURE_SPEC 4), or
   *   {byId: {17: {...}}, byName: {LEAF_1: {translucency: 0.5}, ...}} (byName = palette colour names, the
   *   palette-index fallback; also fed from lighting.materials by setView).
   * Missing fields keep the TEXTURE_SPEC / LIGHTING_SPEC defaults.
   */
  function setMaterials(table) {
    if (Array.isArray(table)) {
      table.forEach(function (r) {
        if (r && r.id != null) matOverrides.byId[r.id] = r;
      });
    } else if (table) {
      Object.keys(table.byId || {}).forEach(function (k) {
        matOverrides.byId[k] = table.byId[k];
      });
      Object.keys(table.byName || table.byIndex || {}).forEach(function (k) {
        matOverrides.byName[k] = (table.byName || table.byIndex)[k];
      });
    }
    rebuildMaterials();
  }
  function rebuildMaterials() {
    function b(x) {
      return Math.max(0, Math.min(255, Math.round(x * 255)));
    }
    matTable = new Uint8Array(32 * 2 * 4);
    for (var id = 1; id < 32; id++) {
      var d = MATERIAL_IDS[id];
      if (!d) continue;
      var o = matOverrides.byId[id] || {};
      var e = o.emissive != null ? o.emissive : d[1], rim = o.rim != null ? o.rim : d[2], gloss = o.gloss != null ? o.gloss : d[3];
      var rough = o.rough != null ? o.rough : d[4], tr = o.translucency != null ? o.translucency : o.transl != null ? o.transl : d[5];
      var glint = o.glint != null ? o.glint : d[6];
      matTable.set([b(e), b(rim), b(gloss), b(tr)], id * 4);
      matTable.set([b(rough), b(glint), id === MAT_GOLD ? 255 : 0, id === MAT_SKY ? 255 : 0], (32 + id) * 4);
    }
    palMat = new Uint8Array(256 * 2 * 4);
    for (var i = 0; i < 256; i++) {
      var name = palNames[i] || (ROOM.colorNames && ROOM.colorNames[i]) || '';
      var m = paletteMaterial(name);
      var ov = matOverrides.byName[name] || matOverrides.byName[i] || null;
      var lov = cur.lighting && cur.lighting.materials ? cur.lighting.materials[name] : null;
      [ov, lov].forEach(function (x) {
        if (!x) return;
        if (x.emissive != null) m[0] = x.emissive;
        if (x.rim != null) m[1] = x.rim;
        if (x.gloss != null) m[2] = x.gloss;
        if (x.translucency != null) m[3] = x.translucency;
        if (x.transl != null) m[3] = x.transl;
        if (x.rough != null) m[4] = x.rough;
        if (x.glint != null) m[5] = x.glint;
        if (x.emissiveOverride != null) m[7] = x.emissiveOverride;
      });
      palMat.set([b(m[0]), b(m[1]), b(m[2]), b(m[3])], i * 4);
      palMat.set([b(m[4]), b(m[5]), m[6] ? 255 : 0, b(m[7])], (256 + i) * 4);
    }
    if (gl && T.palMat) {
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.bindTexture(gl.TEXTURE_2D, T.palMat);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 256, 2, gl.RGBA, gl.UNSIGNED_BYTE, palMat);
      gl.bindTexture(gl.TEXTURE_2D, T.matId);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 32, 2, gl.RGBA, gl.UNSIGNED_BYTE, matTable);
    }
  }

  /* ------------------------------------------------------------------ view */
  /**
   * Make viewId current with its lighting block (LIGHTING_SPEC section 8). lighting null or omitted: the
   * bundle's zones.views.<v>.lighting, else bootstrapped from the v3.3 glow list (ROOM.light.lightingFromV33).
   * 'front' and 'main' are the same view.
   */
  function setView(viewId, lighting) {
    var conf = ROOM.viewConf ? ROOM.viewConf(viewId === 'front' && !hasView('front') ? 'main' : viewId) : {};
    if (!lighting) {
      if (!lightingCache[viewId]) lightingCache[viewId] = ROOM.light.lightingFor(conf, viewId, ROOM.art ? ROOM.art.items : null);
      lighting = lightingCache[viewId];
    } else lightingCache[viewId] = lighting;
    var changed = cur.view !== viewId || cur.lighting !== lighting;
    cur = { view: viewId, lighting: lighting, conf: conf };
    if (changed) {
      lmCache = { key: '' };
      maskCache.key = '';
      rebuildMaterials();
    }
  }
  function hasView(v) {
    var Z = (ROOM.art && ROOM.art.zones) || {};
    return !!(Z.views && Z.views[v]);
  }

  /* ------------------------------------------------------------------ lights */
  function linRgb(rgb) {
    var f = ROOM.light.srgbToLinear;
    return [f(rgb[0] / 255), f(rgb[1] / 255), f(rgb[2] / 255)];
  }
  function whenLevel(l, st) {
    var w = l.when || 'always';
    var lv = 1;
    if (w === 'sunset' || w === 'lamps') lv = st.practicals.lamps;
    else if (w === 'desk' || w === 'dawn') lv = st.practicals.desk;
    else if (w === 'night') lv = st.nightness;
    else if (w === 'day') lv = 1 - st.practicals.lamps;
    lv = Math.max(lv, l.dayLevel || 0);
    // lighting.nightGain (the overview: its floor gathers every lamp at once) scales practicals by nightness
    var L = cur.lighting, ng = L && L.nightGain != null ? L.nightGain : cur.view === 'top' ? 0.6 : 1;
    return ng === 1 ? lv : lv * (1 + (ng - 1) * (st.nightness || 0));
  }
  function channelLevel(l, now) {
    if (!l.channel || reduced()) return 1;
    var an = cur.lighting && cur.lighting.anims && cur.lighting.anims[l.channel];
    if (!an || !an.seq || !an.seq.length) return 1;
    var fps = Math.min(15, an.fps || 4);
    var fr = an.seq[Math.floor((now / 1000) * fps) % an.seq.length];
    var g = l.flicker && l.flicker[fr] != null ? l.flicker[fr] : 1;
    return g;
  }
  function hash1(n) {
    var x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
  }
  /** Completion-driven neon: level by w, with an irregular dying flicker (under 2 Hz) below 25%. */
  function driveLevel(l, st, now) {
    if (l.drive !== 'completion') return 1;
    var v = st.neon;
    var low = st.p != null ? st.p < 25 : st.w < 0.28;
    if (low && !reduced()) {
      var slot = Math.floor(now / 620); // >= 620 ms per state: at most 1.6 changes a second
      if (hash1(slot) < 0.28) v *= 0.35;
    }
    return v;
  }
  /** Expand one lighting light into 1..n shader lights (polylines become segments). level multiplies intensity. */
  function expandLight(l, level, out) {
    var c = linRgb(l.rgb || [255, 190, 120]);
    var k = (l.intensity != null ? l.intensity : 1) * level;
    if (k <= 0.001) return;
    var depth = l.depth == null ? -1 : l.depth > 1 ? l.depth / 255 : l.depth;
    var sq = l.squash || 1;
    var r = l.radius || 40;
    var type = l.type || 'point';
    if (type === 'line') {
      var pts = l.points || [];
      var nseg = Math.max(1, pts.length - 1);
      var kk = k / Math.sqrt(nseg); // a long strand is not nseg times brighter where segments meet
      for (var i = 0; i + 1 < pts.length; i++) {
        out.push({ P: [pts[i][0], pts[i][1], r, depth], C: [c[0] * kk, c[1] * kk, c[2] * kk, 2], X: [pts[i + 1][0], pts[i + 1][1], sq, 0], Y: [0, 0, 0, 0], k: kk, bb: bbox(pts[i], pts[i + 1], r, sq) });
      }
      return;
    }
    if (type === 'area') {
      var rc = l.rect;
      out.push({ P: [rc[0] + rc[2] / 2, rc[1] + rc[3] / 2, r, depth], C: [c[0] * k, c[1] * k, c[2] * k, 1], X: [rc[2] / 2, rc[3] / 2, sq, 0], Y: [0, 0, 0, 0], k: k, bb: [rc[0] - r, rc[1] - r * sq, rc[0] + rc[2] + r, rc[1] + rc[3] + r * sq] });
      return;
    }
    var pos = l.pos || [0, 0];
    if (type === 'cone') {
      var dir = ((l.dir != null ? l.dir : 90) * Math.PI) / 180;
      var half = ((l.angle != null ? l.angle : 50) * Math.PI) / 360;
      var soft = (8 * Math.PI) / 180;
      out.push({ P: [pos[0], pos[1], r, depth], C: [c[0] * k, c[1] * k, c[2] * k, 3], X: [0, 0, sq, 0], Y: [Math.cos(dir), Math.sin(dir), Math.cos(Math.min(Math.PI, half + soft)), Math.cos(Math.max(0, half - soft))], k: k, bb: [pos[0] - r, pos[1] - r * sq, pos[0] + r, pos[1] + r * sq] });
      return;
    }
    out.push({ P: [pos[0], pos[1], r, depth], C: [c[0] * k, c[1] * k, c[2] * k, 0], X: [0, 0, sq, 0], Y: [0, 0, 0, 0], k: k, bb: [pos[0] - r, pos[1] - r * sq, pos[0] + r, pos[1] + r * sq] });
  }
  function bbox(a, b, r, sq) {
    return [Math.min(a[0], b[0]) - r, Math.min(a[1], b[1]) - r * sq, Math.max(a[0], b[0]) + r, Math.max(a[1], b[1]) + r * sq];
  }
  var EMPTY = { P: [0, 0, 1, -1], C: [0, 0, 0, -1], X: [0, 0, 1, 0], Y: [0, 0, 0, 0] };
  /** Pack the 4 reserved slots (entries or null) and up to MAX_LIGHTS data lights into the 20 uniform slots. */
  function packLights(reserved, list) {
    var n = Math.min(MAX_LIGHTS, list.length);
    var LP = new Float32Array(SLOTS * 4), LC = new Float32Array(SLOTS * 4), LX = new Float32Array(SLOTS * 4), LY = new Float32Array(SLOTS * 4);
    for (var i = 0; i < RESERVED + n; i++) {
      var l = i < RESERVED ? (reserved && reserved[i]) || EMPTY : list[i - RESERVED];
      LP.set(l.P, i * 4);
      LC.set(l.C, i * 4);
      LX.set(l.X, i * 4);
      LY.set(l.Y, i * 4);
    }
    return { uN: I(RESERVED + n), uLP: { v4: LP }, uLC: { v4: LC }, uLX: { v4: LX }, uLY: { v4: LY } };
  }

  /* ------------------------------------------------------------------ static lightmap */
  function lightmapRect() {
    var a = (cur.conf && cur.conf.art) || { x: -122, y: -116, w: 800, h: 480 };
    return [a.x, a.y, a.w, a.h];
  }
  /** Bake the static lights of the view into two layers: always on, and night-only (scaled by lamps at runtime). */
  function ensureLightmap() {
    var Lg = cur.lighting;
    var rect = lightmapRect();
    var key = cur.view + '|' + rect.join(',') + '|' + gains.practical;
    if (lmCache.key === key) return;
    if (lmCache.a) freeTarget(lmCache.a);
    if (lmCache.n) freeTarget(lmCache.n);
    var w = rect[2], h = rect[3];
    var A = target(w, h, gl.LINEAR), N = target(w, h, gl.LINEAR);
    var always = [], night = [];
    (Lg.lights || []).forEach(function (l) {
      if (!l.static) return;
      var w0 = l.when || 'always';
      if (w0 === 'always') expandLight(l, 1, always);
      else {
        var dl = l.dayLevel || 0;
        if (dl > 0) expandLight(l, dl, always);
        expandLight(l, 1 - dl, night);
      }
    });
    [[A, always], [N, night]].forEach(function (pair) {
      var rt = pair[0], list = pair[1];
      gl.bindFramebuffer(gl.FRAMEBUFFER, rt.fb);
      gl.viewport(0, 0, w, h);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      for (var i = 0; i < list.length; i += MAX_LIGHTS) {
        pass(P.bake, rt, w, h, {}, Object.assign({ uRect: rect, uDst: [w, h], uEnc: enc }, packLights(null, list.slice(i, i + MAX_LIGHTS))));
      }
      gl.disable(gl.BLEND);
    });
    lmCache = { key: key, a: A, n: N, rect: rect, count: always.length + night.length };
  }

  /* ------------------------------------------------------------------ CPU masks: shadows and sun patch */
  function sceneKeyOf(f) {
    if (f.sceneVersion != null) return 'v' + f.sceneVersion;
    // No scene version: a sparse hash of the depth bytes (cheap, catches variant and dog changes).
    var a = f.aux, h = 2166136261;
    for (var i = 0; i < a.length; i += 97) h = Math.imul(h ^ a[i], 16777619);
    return 'h' + (h >>> 0);
  }
  /**
   * Build the RG8 mask for the buffer: R = cast + contact shadow (0..255), G = sun (or moon) patch.
   * Only floor-flagged pixels receive either. Edges are a 1 px box blur through the world-anchored Bayer matrix.
   */
  function buildMasks(f, st) {
    var Lg = cur.lighting;
    var W = f.w, H = f.h, aux = f.aux, x0 = f.x0, y0 = f.y0;
    var N = W * H;
    var cast = new Float32Array(N), contact = new Float32Array(N), patch = new Float32Array(N);
    var dr = ROOM.light.depthRange(Lg, cur.conf);
    var top = dr[0], bot = dr[1];
    var back = (Lg.floor && Lg.floor.backLine) || 184;
    var src = (Lg.key && (Lg.key.floor || Lg.key.center)) || [W / 2 + x0, back];
    var len = st.shadowLength * ((Lg.key && Lg.key.shadowLength) || 1);
    var castK = st.castShadow;
    var maxLen = 140;
    function isFloor(i) {
      return (aux[i * 3 + 1] & 2) !== 0;
    }
    function put(arr, x, y, v) {
      var bx = Math.round(x) - x0, by = Math.round(y) - y0;
      if (bx < 0 || by < 0 || bx >= W || by >= H) return;
      var i = by * W + bx;
      if (!isFloor(i)) return;
      if (v > arr[i]) arr[i] = v;
    }
    function seg(arr, ax, ay, bx, by, v) {
      var n = Math.max(1, Math.ceil(Math.max(Math.abs(bx - ax), Math.abs(by - ay))));
      for (var s = 0; s <= n; s++) put(arr, ax + ((bx - ax) * s) / n, ay + ((by - ay) * s) / n, v);
    }
    var x, y, i, d, fl;
    var doCast = castK > 0.02 && (Lg.key == null || Lg.key.scale !== 0);
    for (y = 0; y < H; y++) {
      for (x = 0; x < W; x++) {
        i = y * W + x;
        d = aux[i * 3];
        fl = aux[i * 3 + 1];
        if (d === 0 || d === 255 || fl & (2 | 8 | 16)) continue;
        var yb = ROOM.light.yBaseOf(d, top, bot);
        if (yb < back - 2) continue; // wall-mounted
        var wx = x + x0 + 0.5, wy = y + y0;
        var hgt = yb - wy;
        // contact: the bottom pixel of an object column near its contact line
        var below = y + 1 < H ? (y + 1) * W + x : -1;
        var bottomPx = below < 0 || aux[below * 3] !== d || aux[below * 3 + 1] & 2;
        if (bottomPx && hgt <= 4) {
          for (var cy = -1; cy <= 1; cy++) {
            for (var cx = -2; cx <= 2; cx++) {
              var edge = Math.abs(cx) === 2 || cy === 1;
              var gx = Math.round(wx) + cx, gy = Math.round(yb) + cy;
              if (edge && BAYER[(gy & 3) * 4 + (gx & 3)] >= 8) continue;
              put(contact, gx, gy, 0.65);
            }
          }
        }
        if (!doCast || hgt < 0.5) continue;
        var dx = wx - src[0], dy = yb - src[1];
        var dl = Math.sqrt(dx * dx + dy * dy) || 1;
        dx /= dl;
        dy /= dl;
        var la = (hgt - 0.5) * len, lb = (hgt + 0.5) * len;
        if (la > maxLen) continue;
        var v = castK * (1 - 0.6 * Math.min(1, la / maxLen));
        seg(cast, wx + dx * la, yb + dy * la * 0.35, wx + dx * lb, yb + dy * lb * 0.35, v);
      }
    }
    // Sun / moon patch: project the window glass onto the floor (inverse of the cast shadow).
    var win = Lg.window && Lg.window.rect;
    if (win && st.patchIntensity > 0.01 && (Lg.key == null || Lg.key.scale !== 0)) {
      var base = Lg.window.base != null ? Lg.window.base : back;
      var thr = Lg.window.throw;
      var tx, ty;
      if (thr) {
        tx = thr[0];
        ty = thr[1];
      } else {
        var lat = Math.max(-60, Math.min(60, st.lateral || 0)) * (Lg.window.lateral != null ? Lg.window.lateral : 1);
        tx = -Math.tan((lat * Math.PI) / 180);
        ty = 1;
      }
      var plen = Math.min(2.5, st.shadowLength);
      var blinds = Lg.window.blinds || { rows: 0, open: 1 };
      var mull = Lg.window.mullions || [];
      for (var wyy = Math.floor(win[1]); wyy < win[1] + win[3]; wyy++) {
        if (blinds.rows > 0) {
          var band = win[3] / blinds.rows;
          var u = (wyy - win[1]) % band;
          if (u < band * (1 - blinds.open)) continue;
        }
        var h2 = base - wyy;
        if (h2 <= 0) continue;
        for (var wxx = Math.floor(win[0]); wxx < win[0] + win[2]; wxx++) {
          var bx2 = wxx - x0, by2 = wyy - y0;
          var glass;
          if (bx2 >= 0 && by2 >= 0 && bx2 < W && by2 < H) {
            var ii = by2 * W + bx2;
            glass = (aux[ii * 3 + 1] & 8) !== 0 || aux[ii * 3 + 2] === 30;
          } else {
            glass = true;
            for (var m = 0; m < mull.length; m++) {
              var M = mull[m];
              if (wxx >= M[0] && wxx < M[0] + M[2] && wyy >= M[1] && wyy < M[1] + M[3]) glass = false;
            }
          }
          if (!glass) continue;
          var ta = (h2 - 0.5) * plen, tb = (h2 + 0.5) * plen;
          seg(patch, wxx + 0.5 + tx * ta, base + ty * ta * 0.35, wxx + 0.5 + tx * tb, base + ty * tb * 0.35, 1);
        }
      }
    }
    // Soften: 1 px box blur of the coverage through the Bayer matrix; inside keeps the max value.
    var soft = st.shadowSoft > 0.5 ? 2 : 1;
    var out = new Uint8Array(N * 2);
    for (y = 0; y < H; y++) {
      for (x = 0; x < W; x++) {
        i = y * W + x;
        if (!(aux[i * 3 + 1] & 2)) continue;
        var cc = 0, cn = 0, cm = 0, pc = 0, pm = 0;
        for (var oy = -soft; oy <= soft; oy++) {
          var yy = y + oy;
          if (yy < 0 || yy >= H) continue;
          for (var ox = -soft; ox <= soft; ox++) {
            var xx = x + ox;
            if (xx < 0 || xx >= W) continue;
            var j = yy * W + xx;
            cn++;
            if (cast[j] > 0) {
              cc++;
              if (cast[j] > cm) cm = cast[j];
            }
            if (patch[j] > 0) {
              pc++;
              if (patch[j] > pm) pm = patch[j];
            }
          }
        }
        var th = (BAYER[((y + y0) & 3) * 4 + ((x + x0) & 3)] + 0.5) / 16;
        var sv = cn && cc / cn > th ? cm : 0;
        sv = Math.max(sv, contact[i]);
        var pv = cn && pc / cn > th ? pm : 0;
        out[i * 2] = Math.round(Math.min(1, sv) * 255);
        out[i * 2 + 1] = Math.round(Math.min(1, pv) * 255);
      }
    }
    return out;
  }
  /**
   * v3.5 (D4 3.3): the aux of the whole view (art rect, layers 0..5, no marks, parallax 0), drawn from the scene's
   * drawables, so the masks are identical at every framing. Cached by (view, sceneVersion, art rect). null when the
   * render module has no drawables for the view (the masks then fall back to the frame's own aux).
   */
  var viewAux = { key: '' };
  function viewAuxFor(view) {
    var R = ROOM.render;
    var a = cur.conf && cur.conf.art;
    if (!R || !R.blitAux || !a || !a.w || !a.h || !ROOM.viewOf) return null;
    var ds = R.drawables;
    var key = view + '|' + R.sceneVersion + '|' + [a.x, a.y, a.w, a.h].join(',');
    if (viewAux.key === key) return viewAux.f;
    var vf = { aux: new Uint8Array(a.w * a.h * 3), w: a.w, h: a.h, x0: a.x, y0: a.y };
    var n = 0;
    for (var i = 0; ds && i < ds.length; i++) {
      var d = ds[i];
      if (!d.img || d.layer >= 6 || (d.item && d.item.drift) || ROOM.viewOf(d.item) !== view) continue;
      R.blitAux(vf, d, d.img, d.x - a.x, d.y - a.y);
      n++;
    }
    for (var j = 1; j < vf.aux.length; j += 3) vf.aux[j] &= ~64; // hover is not part of the scene
    viewAux = { key: key, f: n ? vf : null };
    return viewAux.f;
  }
  function ensureMasks(f, st) {
    var src = viewAuxFor(cur.view) || f;
    var key = [cur.view, src === f ? 'f' + [f.x0, f.y0, f.w, f.h, sceneKeyOf(f)].join(',') : viewAux.key, st.bucket, Math.round(st.castShadow * 10), Math.round(st.shadowLength * 10), Math.round(st.patchIntensity > 0.01 ? 1 : 0), Math.round((st.lateral || 0) / 2), st.shadowSoft > 0.5 ? 1 : 0].join('|');
    if (maskCache.key === key) return false;
    var t0 = performance.now();
    var data = buildMasks(src, st);
    lastStats.maskMs = performance.now() - t0;
    if (!T.mask || T.mask.w !== src.w || T.mask.h !== src.h) {
      if (T.mask) gl.deleteTexture(T.mask);
      T.mask = tex2d(src.w, src.h, gl.RG8, gl.RG, gl.UNSIGNED_BYTE, data);
    } else {
      gl.bindTexture(gl.TEXTURE_2D, T.mask);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, src.w, src.h, gl.RG, gl.UNSIGNED_BYTE, data);
    }
    maskCache = { key: key, data: data, w: src.w, h: src.h, x0: src.x0, y0: src.y0 };
    return true;
  }

  /* ------------------------------------------------------------------ targets */
  function ensureTargets(w, h, hT, cw, ch, tier) {
    var wb = gains.worldBloom > 0;
    var key = [w, h, hT, cw, ch, tier.shaftDiv, tier.bloomDiv, tier.bloomLevels, wb ? 1 : 0].join('|');
    if (RT.key === key) return;
    ['lit', 'floor', 'shaft', 'ldr'].forEach(function (k) {
      freeTarget(RT[k]);
    });
    (RT.down || []).concat(RT.up || []).forEach(freeTarget);
    if (T.index) gl.deleteTexture(T.index);
    if (T.aux) gl.deleteTexture(T.aux);
    // index, aux, lit, floor and ldr hold the room rows plus the atlas rows (hT >= h); shafts and bloom the room only
    T.index = tex2d(w, hT, gl.R8, gl.RED, gl.UNSIGNED_BYTE, null);
    T.aux = tex2d(w, hT, gl.RGB8, gl.RGB, gl.UNSIGNED_BYTE, null);
    RT = { key: key, hT: hT };
    RT.lit = target(w, hT, gl.NEAREST);
    RT.floor = target(w, hT, gl.LINEAR);
    RT.shaft = target(Math.ceil(w / tier.shaftDiv), Math.ceil(h / tier.shaftDiv), gl.LINEAR);
    RT.ldr = target8(w, hT);
    RT.down = [];
    RT.up = [];
    // world-res bloom (D4 3.3, PLAN A1: behind the flag, off by default): world-px radius, the same at every zoom
    var bw = wb ? w : Math.max(1, Math.ceil(cw / tier.bloomDiv)), bh = wb ? h : Math.max(1, Math.ceil(ch / tier.bloomDiv));
    for (var i = 0; i < tier.bloomLevels; i++) {
      RT.down.push(target(bw, bh, gl.LINEAR));
      RT.up.push(target(bw, bh, gl.LINEAR));
      bw = Math.max(1, Math.ceil(bw / 2));
      bh = Math.max(1, Math.ceil(bh / 2));
    }
  }

  /* ------------------------------------------------------------------ timing and auto-tier */
  function timerBegin() {
    var ext = timing.ext;
    if (!ext || timing.frames >= AUTO_FRAMES * 4) return null;
    var q = gl.createQuery();
    gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
    return q;
  }
  function timerEnd(q) {
    if (!q) return;
    gl.endQuery(timing.ext.TIME_ELAPSED_EXT);
    timing.pending.push(q);
  }
  function timerPoll() {
    var ext = timing.ext;
    if (!ext) return;
    var disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
    while (timing.pending.length) {
      var q = timing.pending[0];
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
      var ns = gl.getQueryParameter(q, gl.QUERY_RESULT);
      timing.pending.shift();
      gl.deleteQuery(q);
      if (!disjoint) addSample(ns / 1e6, 'timer-query');
    }
  }
  function addSample(ms, method) {
    timing.method = method;
    timing.samples.push(ms);
    if (timing.samples.length > 240) timing.samples.shift();
    var s = timing.samples.slice().sort(function (a, b) {
      return a - b;
    });
    timing.p50 = s[Math.floor(s.length * 0.5)];
    timing.p95 = s[Math.min(s.length - 1, Math.floor(s.length * 0.95))];
    if (autoTier && !timing.dropped && timing.samples.length >= AUTO_FRAMES) {
      timing.dropped = true; // decide once on the first 60 frames; never raise automatically
      if (timing.p95 > AUTO_P95_MS) {
        var i = TIER_ORDER.indexOf(tierName);
        if (i >= 0 && i < TIER_ORDER.length - 2) pendingTier = TIER_ORDER[i + 1]; // applied on the next idle frame
      }
    }
  }

  /* ------------------------------------------------------------------ frame */
  var lastFrameT = 0;
  var pendingTier = null; // an auto-tier step waits for an idle frame (PLAN R21)
  var atlasRowsMax = 0; // grow-only atlas rows in the GPU targets (D1 2.1.1)
  var heroCache = { key: '', rt: null, w: 0, h: 0 };

  function clamp01(v) {
    return Math.max(0, Math.min(1, v));
  }
  /**
   * Pure (exported for tests): choose up to n data lights. cands: [{bb: [x0, y0, x1, y1], sk}] (expanded lights with
   * a stable strength key), art: the view's art rect [x, y, w, h] or null. Lights whose box misses the art rect are
   * dropped; the rest sort by sk (ties keep input order). The frame bbox never enters: the set is the same at every
   * framing (D4 3.3), and hover / pools / statue live in reserved slots, so they never evict a data light.
   */
  function selectLights(cands, art, n) {
    var a = art ? [art[0] - 4, art[1] - 4, art[0] + art[2] + 4, art[1] + art[3] + 4] : null;
    var keep = [];
    for (var i = 0; i < cands.length; i++) {
      var l = cands[i];
      if (a && !(l.bb[2] >= a[0] && l.bb[0] <= a[2] && l.bb[3] >= a[1] && l.bb[1] <= a[3])) continue;
      keep.push({ l: l, i: i });
    }
    keep.sort(function (p, q) {
      return q.l.sk - p.l.sk || p.i - q.i;
    });
    return keep.slice(0, Math.max(0, n)).map(function (e) {
      return e.l;
    });
  }
  /** The SELECT light entry (slot 0 or 1) for a world rect, at intensity k (PLAN R8). */
  function selectLight(rect, col, k) {
    var S = (ROOM.light && ROOM.light.SELECT) || { radiusK: 0.9, radiusPad: 6, lift: 24 };
    if (!rect || !(k > 0.001)) return null;
    var R = Math.max(rect.w, rect.h) * S.radiusK + S.radiusPad;
    return { P: [rect.x + rect.w / 2, rect.y + rect.h / 2, R, S.lift], C: [col[0] * k, col[1] * k, col[2] * k, 0], X: [0, 0, 1, 0], Y: [0, 0, 0, 0] };
  }
  /** The room-rest rect of the current view (world px) for the vignette: the same in room, zone and snapshots. */
  function restRect(f, opts) {
    var r = opts.restRect;
    if (r && r.w > 0) return r;
    var V = ROOM.render && ROOM.render.view, CAM = ROOM.camera;
    var a = cur.conf && cur.conf.art;
    if (cur.view === 'top' && a) return { x: a.x, y: a.y, w: a.w, h: a.h };
    if (V && V.Wd && CAM && CAM.roomCamera) {
      var c = CAM.roomCamera(V, null);
      var w = V.Wd / c.z, h = V.Hd / c.z;
      if (V.mode === 'pan' && CAM.CORE_W) return { x: 0, y: c.cy - h / 2, w: CAM.CORE_W, h: h }; // phone: the whole core
      return { x: c.cx - w / 2, y: c.cy - h / 2, w: w, h: h };
    }
    return { x: f.x0, y: f.y0, w: f.w, h: f.h };
  }
  function inkRgb() {
    var i = palNames.indexOf('INK');
    if (i < 0) return [0.08, 0.06, 0.1];
    return [palRGB[i * 3] / 255, palRGB[i * 3 + 1] / 255, palRGB[i * 3 + 2] / 255];
  }
  function atlasHash(f, at) {
    var h = 2166136261, w = f.w;
    for (var y = at.y; y < at.y + at.h; y++) {
      for (var x = 0; x < at.w; x++) {
        var i = y * w + x;
        h = Math.imul(h ^ f.buf[i], 16777619);
        h = Math.imul(h ^ f.aux[i * 3 + 1], 16777619);
      }
    }
    return h >>> 0;
  }
  /** Apply an auto-tier step that waited for an idle frame (R21); emits 'gltier' {tier}. */
  function applyPendingTier() {
    if (!pendingTier || (ROOM.nav && ROOM.nav.busy)) return;
    tierName = pendingTier;
    pendingTier = null;
    heroCache.key = '';
    if (ROOM.emit) {
      ROOM.emit('gltier', { tier: tierName });
      ROOM.emit('gl', { tier: tierName, auto: true, p95: timing.p95 });
    }
  }

  /**
   * Light the buffer. f: {buf, aux, w, h, x0, y0, now, z, org?, sceneVersion?}; buffers are w x (h + atlas rows).
   * opts (PLAN 2.4, all optional): dim 0..1 (bool accepted), focus {rect: {x,y,w,h}, k} (a bare rect = k 1),
   * hover rect or {rect, k}, pools [{x,y,r,a,rgb?,zone?}], statueBurst 0..1 | {x,y,k}, flash 0..1.8, state,
   * atlas {y, w, h, off: [dx, dy]} (off = world of the atlas top-left texel; atlas columns start at 0),
   * hero {x, y, k, K, selK} (device px of the target canvas f.org refers to; k integer zoom, K Bayer dissolve 0..1),
   * halo {cx, cy, r, k, pool: {cx,cy,rx,ry}, shadow: {cx,cy,rx,ry}} (world px), restRect {x,y,w,h} (vignette).
   * Returns the WebGL canvas, or null (tier Off, no WebGL2, context lost): use the Canvas2D path then.
   */
  function frame(f, opts) {
    opts = opts || {};
    if (tierName === 'off' || isLost) return null;
    if (!inited && !init()) return null;
    if (!gl || gl.isContextLost()) return null;
    applyPendingTier();
    var tier = TIERS[tierName];
    if (!tier) return null;
    var view = opts.view || cur.view || (ROOM.state && ROOM.state.view) || 'main';
    if (view !== cur.view || !cur.lighting) setView(view, null);
    var Lg = cur.lighting;
    var now = f.now != null ? f.now : performance.now();
    var st = opts.state || (stateOverride ? stateOverride() : ROOM.light.current());
    var z = f.z || 1;
    var cw = Math.max(1, Math.round(f.w * z)), ch = Math.max(1, Math.round(f.h * z));
    var tStart = performance.now();
    var syncTiming = !timing.ext && timing.frames < AUTO_FRAMES;
    timerPoll();
    var q = timerBegin();

    // ---- the hero atlas rows (D1 2.1): below the room rows, lit in the same passes
    var at = opts.atlas || null;
    var useAtlas = !!(at && at.w > 0 && at.h > 0 && at.y >= f.h && at.w <= f.w && f.buf.length >= f.w * (at.y + at.h) && f.aux && f.aux.length >= f.w * (at.y + at.h) * 3);
    if (useAtlas) atlasRowsMax = Math.max(atlasRowsMax, at.y + at.h - f.h);
    var hT = f.h + atlasRowsMax;
    var rows = useAtlas ? at.y + at.h : f.h;
    var off = useAtlas ? at.off || [0, 0] : [0, 0];

    if (canvas.width !== cw) canvas.width = cw;
    if (canvas.height !== ch) canvas.height = ch;
    ensureTargets(f.w, f.h, hT, cw, ch, tier);
    gl.bindVertexArray(vao);
    gl.disable(gl.BLEND);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.bindTexture(gl.TEXTURE_2D, T.index);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, f.w, rows, gl.RED, gl.UNSIGNED_BYTE, f.buf);
    var aux = f.aux;
    if (!aux || aux.length < f.w * f.h * 3) {
      aux = new Uint8Array(f.w * f.h * 3);
      f = Object.assign({}, f, { aux: aux });
    }
    gl.bindTexture(gl.TEXTURE_2D, T.aux);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, f.w, rows, gl.RGB, gl.UNSIGNED_BYTE, aux);

    ensureLightmap();
    ensureMasks(f, st);

    // ---- uniforms from the state (the light model never depends on dim or focus: the hero shares it)
    var G = gains;
    var dimK = typeof opts.dim === 'number' ? clamp01(opts.dim) : opts.dim ? 1 : 0;
    var flash = Math.max(0, Math.min(1.8, opts.flash || 0));
    var keyL = Lg.key || {};
    var keyScale = keyL.scale != null ? keyL.scale : 1;
    // weather.flash() is 0..1.8: at 1.8 the key light is 1.8x (TEXTURE_SPEC 7.1, LIGHTING_SPEC 12b)
    var flashMul = 1 + flash * (0.8 / 1.8);
    var kc = st.keyColor, kI = st.keyIntensity * G.key * flashMul;
    var keyCol = [kc[0] * kI * keyScale, kc[1] * kI * keyScale, kc[2] * kI * keyScale];
    if (flash > 0) {
      var fl = Math.min(1, flash / 1.8) * 0.6; // storm flashes are blue-white
      keyCol = [mix(keyCol[0], kI * 0.85, fl), mix(keyCol[1], kI * 0.9, fl), mix(keyCol[2], kI * 1.1, fl)];
    }
    var bounceCol = [kc[0] * kI, kc[1] * kI, kc[2] * kI];
    var amb = st.ambientColor.map(function (c) {
      return c * st.ambientIntensity * G.ambient;
    });
    var sunAnchor = linRgb([255, 229, 140]);
    var rimMix = 0.35 + 0.4 * (st.weights.golden + st.weights.sunset);
    var rimCol = [mix(kc[0], sunAnchor[0], rimMix), mix(kc[1], sunAnchor[1], rimMix), mix(kc[2], sunAnchor[2], rimMix)].map(function (c) {
      return c * st.keyIntensity * 0.6 * st.rimGain * G.rim * flashMul * Math.max(keyScale, 0.35);
    });
    var patchK = st.patchIntensity * G.patch * keyScale;
    var patchCol = [kc[0] * patchK, kc[1] * patchK, kc[2] * patchK];
    var seamRgb = linRgb([206, 132, 70]);
    var seamCol = seamRgb.map(function (c) {
      return c * G.seam * 0.9;
    });
    var glintCol = sunAnchor.map(function (c) {
      return c * 1.6 * G.glint;
    });
    var win = (Lg.window && Lg.window.rect) || [0, 0, 0, 0];
    var floorL = Lg.floor || { backLine: 184, bottom: 235, squash: 1 };
    var art = cur.conf && cur.conf.art;
    var artRect = art && art.w ? [art.x, art.y, art.w, art.h] : null;

    // ---- data lights: chosen from the whole view (stable key: no flicker), flicker applied after the choice
    var pg = st.practicalGain * G.practical;
    var cands = [];
    (Lg.lights || []).forEach(function (l) {
      if (l.static) return;
      var neon = l.drive === 'completion';
      var stable = whenLevel(l, st) * pg * (neon ? st.neon : 1);
      var vary = channelLevel(l, now) * (neon ? (st.neon > 0 ? driveLevel(l, st, now) / st.neon : 0) : 1);
      var n0 = cands.length;
      expandLight(l, stable, cands);
      for (var j = n0; j < cands.length; j++) {
        var e = cands[j];
        e.id = l.id;
        e.sk = e.k * (e.P[2] + 10);
        if (vary !== 1) e.C = [e.C[0] * vary, e.C[1] * vary, e.C[2] * vary, e.C[3]];
      }
    });
    // pools: the strongest (or the one flagged zone) takes reserved slot 2; night lamp pools compete as data lights
    var pools = (opts.pools || []).slice().sort(function (a, b) {
      return (b.zone ? 1 : 0) - (a.zone ? 1 : 0) || (b.a != null ? b.a : 0.34) - (a.a != null ? a.a : 0.34);
    });
    var res = [null, null, null, null];
    pools.forEach(function (p, i) {
      var tmp = [];
      expandLight({ type: 'point', pos: [p.x, p.y], radius: p.r || 30, rgb: p.rgb || [255, 190, 112], intensity: (p.a != null ? p.a : 0.34) * 2.5 }, 1, tmp);
      if (!tmp.length) return;
      if (i === 0) res[2] = tmp[0];
      else {
        tmp[0].id = 'pool';
        tmp[0].sk = tmp[0].k * (tmp[0].P[2] + 10);
        cands.push(tmp[0]);
      }
    });
    var sb = opts.statueBurst;
    if (sb) {
      var sk = typeof sb === 'number' ? sb : sb.k != null ? sb.k : 1;
      var spos = typeof sb === 'object' && sb.x != null ? [sb.x, sb.y] : Lg.statue;
      var tmp2 = [];
      if (spos && sk > 0) expandLight({ type: 'point', pos: spos, radius: 70, rgb: [255, 214, 120], intensity: 1.5 * sk }, 1, tmp2);
      res[3] = tmp2[0] || null;
    }
    // SELECT (R8): white mixed toward the key colour; slot 0 the hero (atlas texels), slot 1 hover/focus (room)
    var S = ROOM.light.SELECT;
    var kmax = Math.max(kc[0], kc[1], kc[2]) || 1;
    var kn = [kc[0] / kmax, kc[1] / kmax, kc[2] / kmax];
    var selCol = [mix(1, kn[0], S.tint), mix(1, kn[1], S.tint), mix(1, kn[2], S.tint)];
    var hero = opts.hero || null;
    var selK = hero && hero.selK != null ? clamp01(hero.selK) : 1;
    if (useAtlas) res[0] = selectLight({ x: off[0], y: off[1], w: at.w, h: at.h }, selCol, S.heroI * selK);
    var hv = opts.hover;
    if (hv) {
      var hr = hv.rect || hv;
      if (hr.w != null) res[1] = selectLight(hr, selCol, S.I * (hv.k != null ? clamp01(hv.k) : 1));
    }
    var lights = selectLights(cands, artRect, tier.lights);
    lastStats.lights = lights.length;
    lastStats.lightIds = lights.map(function (l) {
      return l.id;
    });
    lastStats.dynamicCandidates = cands.length;
    lastStats.reserved = res.map(function (r) {
      return !!r;
    });

    var dbg = DEBUG_IDS[debugView] || 0;
    var origin = [f.x0, f.y0];
    var size = { iv: [f.w, f.h] };
    var lm = lmCache;
    var world = { uOrigin: origin, uRoomH: I(f.h), uAtlas: [useAtlas ? at.y : 0, useAtlas ? at.h : 0, off[0], off[1]], uAtlasOn: I(useAtlas ? 1 : 0) };
    var maskU = { uMaskO: [maskCache.x0, maskCache.y0], uMaskS: { iv: [maskCache.w, maskCache.h] } };

    // ---- low tier (D1 2.1.3): the atlas is shaded only when the light key changes or on a flash
    var heroLow = useAtlas && (tierName === 'low' || G.heroCache > 0);
    var hKey = '';
    if (heroLow) {
      hKey = [cur.view, st.keyframe, st.bucket, Math.round(st.nightness * 50), Math.round(st.keyIntensity * 100), kc.map(function (c) {
        return Math.round(c * 100);
      }).join(','), Math.round(st.practicals.lamps * 50), Math.round(st.practicals.desk * 50), at.w, at.h, off.join(','), atlasHash(f, at), Math.round(selK * 32), dbg, flash > 0 ? now : 0, retro ? 1 : 0].join('|');
    }
    var cached = heroLow && heroCache.key === hKey && heroCache.rt && heroCache.w === at.w && heroCache.h === at.h;
    var passRows = useAtlas && !cached ? rows : f.h;
    lastStats.heroShaded = useAtlas && !cached;

    // ---- P1 light
    pass(P.light, RT.lit, f.w, passRows, { uIndex: T.index, uAux: T.aux, uPal: T.pal, uPalMat: T.palMat, uMatId: T.matId, uShadow: T.mask, uLmA: lm.a.tex, uLmN: lm.n.tex }, Object.assign({
      uSize: { iv: [f.w, passRows] }, uEnc: enc, uMode: I(dbg === 1 ? 1 : dbg === 2 ? 2 : 0),
      uLmRect: lm.rect, uLmNight: st.practicals.lamps,
      uAmb: amb, uCeil: 0.6,
      uKey: keyCol, uKeyC: keyL.center || [f.x0 + f.w / 2, floorL.backLine], uKeyR: keyL.radius || [200, 70], uKeyWall: keyL.wall != null ? keyL.wall : 0.25,
      uRimSpread: keyL.rimSpread || 2.2, uBounce: bounceCol.map(function (c) {
        return c * (keyL.bounce || 0);
      }), uBounceY: artRect ? [artRect[1], artRect[1] + artRect[3]] : [f.y0, f.y0 + f.h],
      uShadowK: st.shadowStrength * G.shadow, uRim: rimCol, uStatueRim: st.statueRim, uLeafRim: tier.leafRim ? 1 : 0,
      uPatch: patchCol, uSeam: seamCol, uSkyTint: st.skyTint, uSky: st.sky * (1 + flash * 0.6), uEmis: G.emissive,
      uGlint: glintCol, uTransK: G.transmission, uWin: win, uSelRim: S.rimGain,
    }, world, maskU, packLights(res, lights)));

    // ---- P2 floor
    pass(P.floor, RT.floor, f.w, passRows, { uLit: RT.lit.tex, uAux: T.aux, uMatId: T.matId }, Object.assign({
      uSize: size, uEnc: enc, uMode: I(dbg === 6 ? 1 : 0),
      uBack: floorL.backLine, uBottom: floorL.bottom || f.y0 + f.h, uSquash: floorL.squash || 1, uReflK: G.refl, uTaps: I(tier.reflTaps),
    }, world));

    // ---- P3 shafts and dust (room rows)
    var shaftK = st.shafts * G.shafts * (keyScale === 0 ? 0 : 1);
    var haveShafts = tier.shaftSamples > 0 && shaftK > 0.004 && win[2] > 0;
    var sdir = [0, 1];
    if (haveShafts) {
      var thr = Lg.window.throw;
      if (thr) sdir = [thr[0], Math.max(0.25, thr[1] * 2)];
      else {
        var latd = Math.max(-50, Math.min(50, st.lateral || 0)) * (Lg.window.lateral != null ? Lg.window.lateral : 1);
        sdir = [-Math.tan((latd * Math.PI) / 180) * 0.5, 1];
      }
      var sl = Math.sqrt(sdir[0] * sdir[0] + sdir[1] * sdir[1]);
      sdir = [sdir[0] / sl, sdir[1] / sl];
      var reach = Math.max(60, (floorL.backLine - win[1]) * 1.25);
      pass(P.shaft, RT.shaft, RT.shaft.w, RT.shaft.h, { uAux: T.aux }, {
        uOrigin: origin, uSize: size, uDiv: tier.shaftDiv, uDir: sdir, uStep: reach / tier.shaftSamples, uSamples: I(tier.shaftSamples),
        uDecay: 0.94 + (24 / tier.shaftSamples - 1) * -0.02, uCol: [kc[0] * shaftK, kc[1] * shaftK, kc[2] * shaftK], uWin: win,
      });
      var nd = reduced() ? 0 : Math.round(tier.dust * G.dust);
      if (nd > 0) {
        gl.useProgram(P.dust.p);
        gl.bindFramebuffer(gl.FRAMEBUFFER, RT.floor.fb);
        gl.viewport(0, 0, f.w, f.h);
        gl.activeTexture(gl.TEXTURE0 + P.dust.units.uShaft);
        gl.bindTexture(gl.TEXTURE_2D, RT.shaft.tex);
        setUniforms(P.dust, {
          uOrigin: origin, uSize: size, uTime: Math.floor(now / 33) * 0.033, uDir: sdir,
          uVol: [win[0] - 6, win[1] + win[3] * 0.3, win[2] + 12, Math.max(30, floorL.backLine - win[1] + 20)],
          uCol: [3.0, 2.6, 1.9], uEnc: enc,
        });
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE);
        gl.drawArrays(gl.POINTS, 0, nd);
        gl.disable(gl.BLEND);
      }
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, RT.shaft.fb);
      gl.viewport(0, 0, RT.shaft.w, RT.shaft.h);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }

    // ---- P4 bloom (dual filter; the room rows only, so the atlas never blooms)
    var bloomK = st.bloom * G.bloom * (1 - 0.45 * dimK);
    var lv = RT.down.length;
    pass(P.pre, RT.down[0], RT.down[0].w, RT.down[0].h, { uHdr: RT.floor.tex, uShaft: RT.shaft.tex, uAux: T.aux }, {
      uDst: [RT.down[0].w, RT.down[0].h], uSize: size, uEnc: enc, uShaftK: 1, uThresh: 0.8, uKnee: 0.2, uVS: f.h / RT.hT,
    });
    for (var i = 1; i < lv; i++) {
      var s = RT.down[i - 1], d = RT.down[i];
      pass(P.down, d, d.w, d.h, { uSrc: s.tex }, { uTexel: [1 / s.w, 1 / s.h], uDst: [d.w, d.h] });
    }
    var upSrc = RT.down[lv - 1];
    for (var k2 = lv - 2; k2 >= 0; k2--) {
      var dst = RT.up[k2];
      pass(P.up, dst, dst.w, dst.h, { uSrc: upSrc.tex, uAdd: RT.down[k2].tex }, { uTexel: [1 / upSrc.w, 1 / upSrc.h], uDst: [dst.w, dst.h], uAddK: k2 === 0 ? 0.25 : 1 }); // the sharpest level only a little: a halo, not a copy
      upSrc = dst;
    }
    var bloomTex = lv > 1 ? RT.up[0].tex : RT.down[0].tex;

    // ---- P5 grade: dim (float, D1 3.2), zone focus (explicit k), world-anchored vignette, skill-view halo
    var fo = opts.focus, frect = null, fk = 0;
    if (fo && fo.rect) {
      frect = fo.rect;
      fk = fo.k != null ? clamp01(fo.k) : 1;
    } else if (fo && fo.w != null) {
      frect = fo;
      fk = 1;
    }
    var focusU = frect ? [frect.x + frect.w / 2, frect.y + frect.h / 2, frect.w * 0.62 + 6, frect.h * 0.62 + 6] : [0, 0, 1, 1];
    var rr = restRect(f, opts);
    var vg = Lg.vignette || { x: rr.x + rr.w / 2, y: rr.y + rr.h / 2, rx: rr.w * 0.78, ry: rr.h * 1.1, inner: 0.42, c: [0.55, 0.5, 0.58] };
    var vc = vg.c || [0.55, 0.5, 0.58];
    var ha = opts.halo || null;
    var haK = ha ? clamp01(ha.k != null ? ha.k : 1) : 0;
    var hp = (ha && ha.pool) || { cx: 0, cy: 0, rx: 0, ry: 0 }, hs = (ha && ha.shadow) || { cx: 0, cy: -1e6, rx: 0, ry: 0 };
    var l2s = ROOM.light.linearToSrgb;
    var gr = st.grade;
    var rp = retroPalette();
    pass(P.grade, RT.ldr, f.w, passRows, { uHdr: RT.floor.tex, uShaft: RT.shaft.tex, uAux: T.aux, uIndex: T.index, uPal: T.pal, uShadow: T.mask, uLutA: T.luts[gr.a], uLutB: T.luts[gr.b] }, Object.assign({
      uSize: { iv: [f.w, passRows] }, uRoomS: [f.w, f.h], uEnc: enc, uDebug: I(dbg),
      uLutT: gr.t, uExpo: st.exposure * G.exposure, uSat: st.saturation * G.saturation, uWarm: st.warmth, uShaftK: haveShafts ? 1 : 0, uDim: dimK,
      uFocus: focusU, uFocusK: frect ? fk : 0, uVig: [vg.x, vg.y, vg.rx, vg.ry], uVig2: [vg.inner != null ? vg.inner : 0.42, vc[0], vc[1], vc[2]], uVigK: G.vignette,
      uHalo: ha ? [ha.cx, ha.cy, ha.r || 1, haK] : [0, 0, 1, 0], uPool: [hp.cx, hp.cy, hp.rx, hp.ry], uShad: [hs.cx, hs.cy, hs.rx, hs.ry],
      uKeyS: kn.map(function (c) {
        return l2s(c);
      }), uInk: inkRgb(),
      uRetro: I(retro ? 1 : 0), uRetroN: I(rp.length / 3), uRetroPal: { v3: rp },
    }, world, maskU));
    if (heroLow && !cached) {
      if (!heroCache.rt || heroCache.w !== at.w || heroCache.h !== at.h) {
        freeTarget(heroCache.rt);
        heroCache.rt = target8(at.w, at.h);
        heroCache.w = at.w;
        heroCache.h = at.h;
      }
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, RT.ldr.fb);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, heroCache.rt.fb);
      gl.blitFramebuffer(0, at.y, at.w, at.y + at.h, 0, 0, at.w, at.h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
      heroCache.key = hKey;
    }

    // ---- P6 output (skill view: bloom x0.25 so bright room objects do not glow through the darkening behind the hero)
    var grainOn = tier.grain && G.grain > 0;
    var seed = reduced() ? 1 : Math.floor(now / (1000 / 12)) % 997;
    pass(P.out, null, cw, ch, { uLdr: RT.ldr.tex, uBloom: bloomTex, uAux: T.aux }, {
      uCanvas: [cw, ch], uZ: [cw / f.w, ch / f.h], uOrigin: origin, uSize: size, uDebug: I(dbg),
      uBloomK: (bloomK / Math.max(1, lv * 0.6)) * (ha ? 1 - 0.75 * clamp01(ha.k) : 1), uGrain: grainOn ? st.grain * G.grain : 0, uSeed: seed, uEnc: enc,
    });

    // ---- P7 hero: integer k, integer device origin, Bayer dissolve heroK (D1 2.1.4)
    lastStats.hero = null;
    if (useAtlas && hero && (hero.K == null || hero.K > 0)) {
      var hk = Math.max(1, Math.round(hero.k || 1));
      var gx = hero.x, gy = hero.y;
      if (f.org) {
        gx += f.org.ox - f.x0 * z;
        gy += f.org.oy - f.y0 * z;
      }
      gx = Math.round(gx);
      gy = Math.round(gy);
      var hw = at.w * hk, hh = at.h * hk;
      var sx0 = Math.max(0, gx), sy0 = Math.max(0, ch - gy - hh), sx1 = Math.min(cw, gx + hw), sy1 = Math.min(ch, ch - gy);
      if (sx1 > sx0 && sy1 > sy0) {
        gl.enable(gl.SCISSOR_TEST);
        gl.scissor(sx0, sy0, sx1 - sx0, sy1 - sy0);
        pass(P.hero, null, cw, ch, { uSrc: cached || heroLow ? heroCache.rt.tex : RT.ldr.tex, uAux: T.aux }, {
          uCanvas: [cw, ch], uDst: [gx, gy, hk, hero.K != null ? clamp01(hero.K) : 1], uAt: { iv: [at.w, at.h] },
          uRow0: I(heroLow ? 0 : at.y), uAuxRow0: I(at.y), uOff: off, uGrain: grainOn ? st.grain * G.grain : 0, uSeed: seed, uDebug: I(dbg),
        });
        gl.disable(gl.SCISSOR_TEST);
      }
      lastStats.hero = { x: gx, y: gy, k: hk, w: hw, h: hh, cached: !!cached };
    }

    timerEnd(q);
    timing.frames++;
    if (syncTiming) {
      var px = new Uint8Array(4);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); // forces completion: CPU+GPU time of the frame
      addSample(performance.now() - tStart, 'sync-readpixels');
    }
    lastStats.cpuMs = performance.now() - tStart;
    lastStats.interval = lastFrameT ? now - lastFrameT : 0;
    lastFrameT = now;
    lastStats.keyframe = st.keyframe;
    return canvas;
  }
  function mix(a, b, t) {
    return a + (b - a) * t;
  }

  /* ------------------------------------------------------------------ scheduler hooks */
  /** v3.5: the compositor has no eased state of its own (dim and focus arrive as explicit k from nav.js). */
  function busy() {
    return false;
  }
  /**
   * A string that changes whenever the GPU look animates: light channels (<= 15 fps), the neon flicker, grain
   * (12 fps) and dust (30 fps). Empty under reduced motion. render.js can append it to its ambient key.
   */
  function ambientKey(now) {
    if (!inited || tierName === 'off' || reduced() || !cur.lighting) return '';
    var k = '';
    var anims = cur.lighting.anims || {};
    var chans = {};
    (cur.lighting.lights || []).forEach(function (l) {
      if (l.channel && !l.static) chans[l.channel] = 1;
      if (l.drive === 'completion') chans._neon = 1;
    });
    Object.keys(chans).forEach(function (c) {
      if (c === '_neon') k += Math.floor(now / 620) + ',';
      else if (anims[c]) k += Math.floor((now / 1000) * Math.min(15, anims[c].fps || 4)) + ',';
    });
    var tier = TIERS[tierName];
    if (tier && tier.grain && gains.grain > 0) k += 'g' + Math.floor(now / (1000 / 12));
    if (tier && tier.shaftSamples > 0 && tier.dust > 0 && gains.dust > 0) k += 'd' + Math.floor(now / 33);
    return k;
  }

  /* ------------------------------------------------------------------ public API */
  function setTier(name) {
    if (!(name in TIERS)) return tierName;
    tierName = name;
    autoTier = false;
    RT.key = '';
    if (ROOM.invalidate) ROOM.invalidate();
    return tierName;
  }

  ROOM.gl = {
    TIERS: TIERS,
    TIER_ORDER: TIER_ORDER,
    MATERIAL_IDS: MATERIAL_IDS,
    gains: gains,
    supported: supported,
    init: init,
    get tier() {
      return tierName;
    },
    set tier(n) {
      setTier(n);
    },
    get autoTier() {
      return autoTier;
    },
    setTier: setTier,
    setPalette: setPalette,
    setMaterials: setMaterials,
    setView: setView,
    frame: frame,
    get lost() {
      return isLost;
    },
    get canvas() {
      return canvas;
    },
    get debug() {
      return debugView;
    },
    set debug(v) {
      if (v in DEBUG_IDS) debugView = v;
    },
    get retro() {
      return retro;
    },
    set retro(v) {
      retro = !!v;
    },
    get lighting() {
      return cur.lighting;
    },
    get view() {
      return cur.view;
    },
    /** Use fn() (returning a ROOM.light.state) instead of the clock; null restores the clock. For the harness. */
    setStateSource: function (fn) {
      stateOverride = fn || null;
    },
    busy: busy,
    ambientKey: ambientKey,
    hasAmbient: function () {
      return ambientKey(0) !== '';
    },
    /** Timing and cache stats: {method, p50, p95, frames, samples, lights, maskMs, cpuMs, tier, caps}. */
    stats: function () {
      return Object.assign({}, lastStats, { method: timing.method, p50: timing.p50, p95: timing.p95, frames: timing.frames, samples: timing.samples.slice(), tier: tierName, autoTier: autoTier, caps: caps ? { floatRT: caps.floatRT, halfRT: caps.halfRT, timer: !!caps.timer } : null, lightmapLights: lmCache.count || 0 });
    },
    resetTiming: function () {
      timing.samples = [];
      timing.frames = 0;
      timing.p50 = timing.p95 = 0;
      timing.dropped = false;
    },
    /** Rebuild cached lightmaps and masks (after editing a lighting block in place). */
    invalidateCaches: function () {
      lmCache.key = '';
      maskCache.key = '';
    },
    lightingFromV33: function (viewConf, viewId, items) {
      return ROOM.light.lightingFromV33(viewConf, viewId, items);
    },
    selectLights: selectLights,
    SLOTS: { reserved: RESERVED, data: MAX_LIGHTS, HERO: 0, HOVER: 1, POOL: 2, STATUE: 3 },
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = { selectLights: selectLights };
})();
