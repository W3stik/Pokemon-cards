// Skutečný 3D model balíčku (WebGL, bez knihovny) pro obrazovku otevírání.
//
// Obal je jedna uzavřená plocha ve tvaru „polštářku“: uprostřed vyboulený, k bočním
// hranám a k zataveným okrajům nahoře a dole se zplošťuje, přední a zadní strana se
// na krajích potkávají. Nemá žádné samostatné boční stěny, takže se z boku nerozpadá
// ani netřese (jako dřívější model poskládaný z CSS vrstev). Horní pruh je samostatná
// část se společnou hranou, při roztržení odletí.
//
// Přední strana je fotka obalu, zadní strana se kreslí do canvasu v barvách sady
// (šev, logo sady, drobný text, čárový kód). Světlo a lesk fólie počítá shader.
import { packProfile, packSize } from "../odds";
import type { SetInfo } from "../types";
import { h, prefersReducedMotion } from "./dom";
import { packArtUrl } from "./pack";

export interface PackModel {
  el: HTMLElement;
  /** Přehraje roztržení (pruh odletí, obal spadne); splní se po skončení animace. */
  tear(): Promise<void>;
  /**
   * Připraví model na další balíček téže sady (celý, neroztržený). Při „Otevřít další“
   * se tak nevytváří nový kontext WebGL ani se znovu nenahrávají textury.
   */
  reset(next: { hint?: number; onTear: () => void }): void;
  /** Model jde ještě použít (kontext WebGL nebyl uvolněn ani ztracen). */
  usable(): boolean;
}

interface Options {
  /** Síla tajného náznaku (jiskřička) 0–3. */
  hint?: number;
  /** Klepnutí na balíček nebo dotažený řez přes horní pruh. */
  onTear: () => void;
  /** Volá se při každém dotyku (např. odemčení zvuku). */
  onPointerDown?: () => void;
  /**
   * Obrazovka, na které model žije, pořád existuje. Když je plátno mimo stránku (karty,
   * přehled), smyčka se jen pozastaví; uvolní se až po odchodu z obrazovky.
   */
  alive?: () => boolean;
}

// Tvar obalu (výška obalu = 1).
const CUT_V = 0.095; // řez pod horním zataveným okrajem
const CRIMP_TOP = 0.075;
const CRIMP_BOTTOM = 0.955;
const BULGE = 0.05; // vyboulení uprostřed (polovina tloušťky)
const SEG_U = 36;
const SEG_V_TOP = 8;
const SEG_V_MAIN = 56;

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/** Polovina tloušťky obalu v bodě (u, v): 0 na krajích a v zatavených okrajích. */
function thickness(u: number, v: number): number {
  const across = Math.pow(Math.sin(Math.PI * clamp(u, 0, 1)), 0.45);
  const along = smoothstep(CRIMP_TOP, CRIMP_TOP + 0.12, v) * (1 - smoothstep(CRIMP_BOTTOM - 0.1, CRIMP_BOTTOM, v));
  return BULGE * across * along;
}

interface Mesh {
  buffer: WebGLBuffer;
  index: WebGLBuffer;
  count: number;
}

/** Přední i zadní plocha části obalu mezi v0 a v1 (atributy: poloha, normála, uv, strana, parametr). */
function buildPiece(ratio: number, v0: number, v1: number, segV: number): { data: Float32Array; indices: Uint16Array } {
  const verts: number[] = [];
  const idx: number[] = [];
  const e = 0.002;
  for (const side of [0, 1]) {
    const base = verts.length / 11;
    for (let j = 0; j <= segV; j++) {
      const v = v0 + ((v1 - v0) * j) / segV;
      for (let i = 0; i <= SEG_U; i++) {
        const u = i / SEG_U;
        const z = thickness(u, v);
        // normála z gradientu tloušťky
        const dzdu = (thickness(u + e, v) - thickness(u - e, v)) / (2 * e);
        const dzdv = (thickness(u, v + e) - thickness(u, v - e)) / (2 * e);
        // plocha (x, y, z) = ((u−½)·ratio, ½−v, z): normála ∝ (−dz/dx, −dz/dy, 1)
        let nx = -dzdu / ratio;
        let ny = dzdv;
        let nz = 1;
        const len = Math.hypot(nx, ny, nz);
        nx /= len;
        ny /= len;
        nz /= len;
        const sign = side === 0 ? 1 : -1;
        verts.push(
          (u - 0.5) * ratio,
          0.5 - v,
          z * sign,
          nx,
          ny,
          nz * sign,
          side === 0 ? u : 1 - u, // zadní strana se čte zezadu
          v,
          side,
          u,
          v,
        );
      }
    }
    const row = SEG_U + 1;
    for (let j = 0; j < segV; j++) {
      for (let i = 0; i < SEG_U; i++) {
        const a = base + j * row + i;
        const b = a + 1;
        const c = a + row;
        const d = c + 1;
        // přední strana proti směru hodinových ručiček zepředu, zadní zezadu
        if (side === 0) idx.push(a, c, b, b, c, d);
        else idx.push(a, b, c, b, d, c);
      }
    }
  }
  return { data: new Float32Array(verts), indices: new Uint16Array(idx) };
}

// --- Matice (sloupcové pořadí jako v WebGL) -------------------------------------

type Mat4 = Float32Array;
const mat = (...m: number[]) => new Float32Array(m);
function mul(a: Mat4, b: Mat4): Mat4 {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
  }
  return o;
}
const translate = (x: number, y: number, z: number) => mat(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1);
const rotX = (a: number) => mat(1, 0, 0, 0, 0, Math.cos(a), Math.sin(a), 0, 0, -Math.sin(a), Math.cos(a), 0, 0, 0, 0, 1);
const rotY = (a: number) => mat(Math.cos(a), 0, -Math.sin(a), 0, 0, 1, 0, 0, Math.sin(a), 0, Math.cos(a), 0, 0, 0, 0, 1);
const rotZ = (a: number) => mat(Math.cos(a), Math.sin(a), 0, 0, -Math.sin(a), Math.cos(a), 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);
function perspective(fovy: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / Math.tan(fovy / 2);
  return mat(f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, (2 * far * near) / (near - far), 0);
}
/** Horní 3×3 část (jen rotace a posun, takže slouží i pro normály). */
const normalMatrix = (m: Mat4) => new Float32Array([m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]]);
const DEG = Math.PI / 180;

// --- Shadery -------------------------------------------------------------------

const VERTEX = `
attribute vec3 aPos;
attribute vec3 aNormal;
attribute vec2 aUv;
attribute float aSide;
attribute vec2 aParam;
uniform mat4 uProj;
uniform mat4 uView;
uniform mat4 uModel;
uniform mat3 uNormalMat;
varying vec3 vNormal;
varying vec3 vPos;
varying vec2 vUv;
varying float vSide;
varying vec2 vParam;
void main() {
  vec4 world = uModel * vec4(aPos, 1.0);
  vPos = world.xyz;
  vNormal = uNormalMat * aNormal;
  vUv = aUv;
  vSide = aSide;
  vParam = aParam;
  gl_Position = uProj * uView * world;
}`;

const FRAGMENT = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform sampler2D uFront;
uniform sampler2D uBack;
uniform vec3 uLight;
uniform vec3 uEye;
uniform float uAlpha;
uniform float uCut;
uniform float uCutV;
uniform float uRatio;
uniform vec3 uSpark;
uniform vec3 uSparkColor;
varying vec3 vNormal;
varying vec3 vPos;
varying vec2 vUv;
varying float vSide;
varying vec2 vParam;
void main() {
  vec3 n = normalize(vNormal);
  vec3 base;
  if (gl_FrontFacing) {
    base = vSide < 0.5 ? texture2D(uFront, vUv).rgb : texture2D(uBack, vUv).rgb;
  } else {
    // vnitřek obalu (vidět po odtržení pruhu): stříbrná fólie
    n = -n;
    base = vec3(0.42, 0.44, 0.48);
  }
  vec3 l = normalize(uLight);
  vec3 v = normalize(uEye - vPos);
  vec3 hv = normalize(l + v);
  float diffuse = max(dot(n, l), 0.0);
  float spec = pow(max(dot(n, hv), 0.0), 48.0);
  float fresnel = pow(1.0 - max(dot(n, v), 0.0), 3.0);
  // lesklá fólie: bílý odlesk s jemným duhovým nádechem podle polohy na obalu
  vec3 foil = vec3(0.85 + 0.15 * sin(vParam.x * 9.0), 0.85 + 0.15 * sin(vParam.x * 9.0 + 2.1), 0.85 + 0.15 * sin(vParam.x * 9.0 + 4.2));
  vec3 color = base * (0.42 + 0.7 * diffuse) + foil * spec * 0.55 + vec3(fresnel * 0.12);
  // svítící řez při tahu prstem přes horní pruh
  float cutGlow = (1.0 - smoothstep(0.0, 0.007, abs(vParam.y - uCutV))) * step(vParam.x, uCut) * step(0.001, uCut);
  color = mix(color, vec3(1.0), cutGlow);
  // tajný náznak: jiskřička na přední straně
  if (vSide < 0.5 && gl_FrontFacing && uSpark.z > 0.0) {
    vec2 d = (vUv - uSpark.xy) * vec2(uRatio, 1.0);
    float r2 = dot(d, d);
    float star = exp(-r2 * 9000.0) * 1.6
      + exp(-abs(d.x) * 700.0) * exp(-abs(d.y) * 55.0)
      + exp(-abs(d.y) * 700.0) * exp(-abs(d.x) * 55.0);
    color += uSparkColor * uSpark.z * star;
  }
  gl_FragColor = vec4(color, uAlpha);
}`;

function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? "shader");
  return shader;
}

// --- Textury ---------------------------------------------------------------------

const TEX_W = 1024;
const TEX_H = 2048;

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(url));
    img.src = url;
  });
}

const hexRgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
/** Relativní jas barvy 0–1 (pro volbu světlého nebo tmavého textu). */
const luminance = (hex: string) => {
  const [r, g, b] = hexRgb(hex).map((v) => v / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** Jednoduchý generátor čísel ze jména sady (čárový kód vypadá u sady pokaždé stejně). */
function seeded(text: string) {
  let s = 0;
  for (const ch of text) s = (s * 31 + ch.charCodeAt(0)) | 0;
  return () => {
    s = (s * 1103515245 + 12345) | 0;
    return ((s >>> 16) & 0x7fff) / 0x7fff;
  };
}

function crimp(ctx: CanvasRenderingContext2D, y: number, height: number) {
  for (let x = 0; x < TEX_W; x += 12) {
    ctx.fillStyle = "rgb(255 255 255 / 0.18)";
    ctx.fillRect(x, y, 5, height);
    ctx.fillStyle = "rgb(0 0 0 / 0.22)";
    ctx.fillRect(x + 6, y, 6, height);
  }
}

/**
 * Zadní strana obalu v barvách sady (profil v odds.ts: tmavá základní a výrazná doplňková,
 * podle fotky obalu): zatavené okraje, šev, logo sady, drobný text a čárový kód.
 * Barvy přímo z fotky nefungovaly – převládala žlutá loga Pokémon a barvy postav.
 */
function drawBack(set: SetInfo, logo: HTMLImageElement | null): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = TEX_W;
  c.height = TEX_H;
  const ctx = c.getContext("2d")!;
  const [base, accent] = packProfile(set.id).colors;
  const light = luminance(base) > 0.55;
  const ink = (alpha: number) => (light ? `rgb(30 26 20 / ${alpha})` : `rgb(255 255 255 / ${alpha})`);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, TEX_W, TEX_H);
  // záře doplňkové barvy za logem a ztmavení ke spodku
  const glow = ctx.createRadialGradient(TEX_W * 0.5, TEX_H * 0.27, 20, TEX_W * 0.5, TEX_H * 0.32, TEX_H * 0.55);
  glow.addColorStop(0, accent);
  glow.addColorStop(1, "rgb(0 0 0 / 0)");
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, TEX_W, TEX_H);
  ctx.globalAlpha = 1;
  const shade = ctx.createLinearGradient(0, TEX_H * 0.5, 0, TEX_H);
  shade.addColorStop(0, "rgb(0 0 0 / 0)");
  shade.addColorStop(1, `rgb(0 0 0 / ${light ? 0.08 : 0.3})`);
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, TEX_W, TEX_H);
  // jemný lesk fólie
  const sheen = ctx.createRadialGradient(TEX_W * 0.5, TEX_H * 0.32, 40, TEX_W * 0.5, TEX_H * 0.4, TEX_H * 0.6);
  sheen.addColorStop(0, "rgb(255 255 255 / 0.16)");
  sheen.addColorStop(1, "rgb(255 255 255 / 0)");
  ctx.fillStyle = sheen;
  ctx.fillRect(0, 0, TEX_W, TEX_H);

  // lepený šev uprostřed
  const seam = ctx.createLinearGradient(TEX_W * 0.43, 0, TEX_W * 0.57, 0);
  seam.addColorStop(0, "rgb(0 0 0 / 0.28)");
  seam.addColorStop(0.5, "rgb(255 255 255 / 0.12)");
  seam.addColorStop(1, "rgb(0 0 0 / 0.28)");
  ctx.fillStyle = seam;
  ctx.fillRect(TEX_W * 0.43, 0, TEX_W * 0.14, TEX_H);

  // zatavené okraje
  crimp(ctx, 0, TEX_H * CRIMP_TOP);
  crimp(ctx, TEX_H * CRIMP_BOTTOM, TEX_H * (1 - CRIMP_BOTTOM));

  // logo sady
  if (logo) {
    const w = TEX_W * 0.66;
    const hgt = Math.min(TEX_H * 0.16, (w * logo.naturalHeight) / logo.naturalWidth);
    const lw = (hgt * logo.naturalWidth) / logo.naturalHeight;
    ctx.shadowColor = "rgb(0 0 0 / 0.5)";
    ctx.shadowBlur = 24;
    ctx.drawImage(logo, (TEX_W - lw) / 2, TEX_H * 0.17, lw, hgt);
    ctx.shadowBlur = 0;
  }

  ctx.fillStyle = ink(0.88);
  ctx.textAlign = "center";
  ctx.font = "800 46px system-ui, sans-serif";
  ctx.fillText(set.name.toUpperCase(), TEX_W / 2, TEX_H * 0.375);
  ctx.font = "700 34px system-ui, sans-serif";
  ctx.fillStyle = ink(0.7);
  ctx.fillText(`BOOSTER PACK · ${packSize(packProfile(set.id))} KARET`, TEX_W / 2, TEX_H * 0.405);

  // drobný text (jen naznačený řádky)
  const rnd = seeded(set.id);
  ctx.fillStyle = ink(0.32);
  for (let col = 0; col < 2; col++) {
    const x0 = col === 0 ? TEX_W * 0.1 : TEX_W * 0.6;
    for (let i = 0; i < 14; i++) {
      const w = TEX_W * (0.24 + rnd() * 0.06);
      ctx.fillRect(x0, TEX_H * 0.47 + i * 30, w, 12);
    }
  }

  // čárový kód
  const bx = TEX_W * 0.58;
  const by = TEX_H * 0.8;
  const bw = TEX_W * 0.32;
  const bh = TEX_H * 0.09;
  ctx.fillStyle = "rgb(255 255 255 / 0.92)";
  ctx.fillRect(bx, by, bw, bh);
  ctx.fillStyle = "#111";
  for (let x = bx + 16; x < bx + bw - 16; ) {
    const w = 2 + Math.floor(rnd() * 3) * 2;
    if (rnd() > 0.35) ctx.fillRect(x, by + 14, w, bh - 50);
    x += w + 3;
  }
  ctx.font = "600 22px ui-monospace, monospace";
  ctx.fillText(String(Math.floor(rnd() * 9e11)).padStart(12, "0"), bx + bw / 2, by + bh - 14);

  // kruhový štítek s věkem a názvem
  ctx.strokeStyle = ink(0.6);
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(TEX_W * 0.2, by + bh / 2, 52, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = ink(0.75);
  ctx.font = "800 44px system-ui, sans-serif";
  ctx.fillText("6+", TEX_W * 0.2, by + bh / 2 + 16);
  return c;
}

/** Přední strana bez fotky: barvy sady, logo a popisek. */
function drawFallbackFront(set: SetInfo, logo: HTMLImageElement | null): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = TEX_W;
  c.height = TEX_H;
  const ctx = c.getContext("2d")!;
  const [c1, c2] = packProfile(set.id).colors;
  const grad = ctx.createLinearGradient(0, 0, TEX_W, TEX_H);
  grad.addColorStop(0, c1);
  grad.addColorStop(1, c2);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, TEX_W, TEX_H);
  crimp(ctx, 0, TEX_H * CRIMP_TOP);
  crimp(ctx, TEX_H * CRIMP_BOTTOM, TEX_H * (1 - CRIMP_BOTTOM));
  if (logo) {
    const w = TEX_W * 0.8;
    const hgt = (w * logo.naturalHeight) / logo.naturalWidth;
    ctx.drawImage(logo, (TEX_W - w) / 2, TEX_H * 0.4 - hgt / 2, w, hgt);
  }
  ctx.fillStyle = "rgb(255 255 255 / 0.85)";
  ctx.textAlign = "center";
  ctx.font = "800 52px system-ui, sans-serif";
  ctx.fillText(set.series.toUpperCase(), TEX_W / 2, TEX_H * 0.2);
  ctx.fillText(`BOOSTER PACK · ${packSize(packProfile(set.id))} KARET`, TEX_W / 2, TEX_H * 0.72);
  return c;
}

/** Obrázek (nebo canvas) do textury s rozměry 2^n, aby šly mipmapy (ostré i zmenšené). */
function toPot(source: TexImageSource & { width: number; height: number }): HTMLCanvasElement {
  if (source instanceof HTMLCanvasElement && source.width === TEX_W && source.height === TEX_H) return source;
  const c = document.createElement("canvas");
  c.width = TEX_W;
  c.height = TEX_H;
  c.getContext("2d")!.drawImage(source as CanvasImageSource, 0, 0, TEX_W, TEX_H);
  return c;
}

// --- Model -----------------------------------------------------------------------

const RATIO_KEY = "pokemon-packs:pack-ratios";
function storedRatio(setId: string): number {
  try {
    return JSON.parse(localStorage.getItem(RATIO_KEY) ?? "{}")[setId] ?? 0.55;
  } catch {
    return 0.55;
  }
}

const SPARK_PERIOD = [0, 7.5, 5.5, 3.8];

/** Vytvoří 3D model balíčku; bez WebGL vrátí null (použije se CSS balíček). */
export function createPackModel(set: SetInfo, opts: Options): PackModel | null {
  const canvas = h("canvas", { class: "packgl__canvas" });
  const gl = canvas.getContext("webgl", { antialias: true, alpha: true, premultipliedAlpha: false });
  if (!gl) return null;

  let program: WebGLProgram;
  try {
    program = gl.createProgram()!;
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
  } catch {
    return null;
  }
  gl.useProgram(program);

  const el = h(
    "div",
    { class: "packgl", role: "img", "aria-label": `Balíček ${set.name}` },
    canvas,
    h("div", { class: "packgl__shadow" }),
  );

  const attr = (name: string) => gl.getAttribLocation(program, name);
  const uni = (name: string) => gl.getUniformLocation(program, name);
  const loc = {
    pos: attr("aPos"),
    normal: attr("aNormal"),
    uv: attr("aUv"),
    side: attr("aSide"),
    param: attr("aParam"),
  };
  const u = {
    proj: uni("uProj"),
    view: uni("uView"),
    model: uni("uModel"),
    normalMat: uni("uNormalMat"),
    front: uni("uFront"),
    back: uni("uBack"),
    light: uni("uLight"),
    eye: uni("uEye"),
    alpha: uni("uAlpha"),
    cut: uni("uCut"),
    cutV: uni("uCutV"),
    ratio: uni("uRatio"),
    spark: uni("uSpark"),
    sparkColor: uni("uSparkColor"),
  };

  // Geometrie (při změně poměru stran fotky se přestaví).
  let ratio = storedRatio(set.id);
  let top: Mesh | null = null;
  let main: Mesh | null = null;
  const upload = (piece: { data: Float32Array; indices: Uint16Array }, old: Mesh | null): Mesh => {
    if (old) {
      gl.deleteBuffer(old.buffer);
      gl.deleteBuffer(old.index);
    }
    const buffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, piece.data, gl.STATIC_DRAW);
    const index = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, index);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, piece.indices, gl.STATIC_DRAW);
    return { buffer, index, count: piece.indices.length };
  };
  const rebuild = () => {
    top = upload(buildPiece(ratio, 0, CUT_V, SEG_V_TOP), top);
    main = upload(buildPiece(ratio, CUT_V, 1, SEG_V_MAIN), main);
  };
  rebuild();

  // Textury: hned barevný podklad, pak fotka (malá z obchodu, potom velká) a rub.
  const anisotropy = gl.getExtension("EXT_texture_filter_anisotropic");
  const makeTexture = (unit: number) => {
    const tex = gl.createTexture()!;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([40, 44, 60, 255]));
    return tex;
  };
  const frontTex = makeTexture(0);
  const backTex = makeTexture(1);
  const setTexture = (tex: WebGLTexture, unit: number, source: HTMLCanvasElement) => {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (anisotropy) gl.texParameterf(gl.TEXTURE_2D, anisotropy.TEXTURE_MAX_ANISOTROPY_EXT, 8);
  };

  let logo: HTMLImageElement | null = null;
  let photo = false;
  const refreshBack = () => {
    try {
      setTexture(backTex, 1, drawBack(set, logo));
    } catch {
      // logo bez CORS by „znečistilo“ canvas a WebGL ho odmítne: rub bez loga
      logo = null;
      setTexture(backTex, 1, drawBack(set, null));
    }
  };
  const usePhoto = (img: HTMLImageElement) => {
    try {
      setTexture(frontTex, 0, toPot(img));
    } catch {
      return; // fotka bez CORS do WebGL nesmí; zůstane náhradní potisk
    }
    photo = true;
    const r = img.naturalWidth / img.naturalHeight;
    if (Math.abs(r - ratio) > 0.005) {
      ratio = r;
      rebuild();
    }
  };
  setTexture(frontTex, 0, drawFallbackFront(set, null));
  refreshBack();
  loadImage(set.logo)
    .then((img) => {
      logo = img;
      if (!photo) setTexture(frontTex, 0, drawFallbackFront(set, img));
      refreshBack();
    })
    .catch(() => undefined);
  const small = packArtUrl(set.id);
  const large = packArtUrl(set.id, true);
  if (small) loadImage(small).then(usePhoto).catch(() => undefined);
  if (large) loadImage(large).then(usePhoto).catch(() => undefined);

  // --- Pohyb ---------------------------------------------------------------
  let yaw = 0;
  let pitch = 0;
  let vyaw = 0;
  let vpitch = 0;
  let touched = false;
  let dragging: { x: number; y: number; t: number; startX: number; mode: "tear" | "spin"; moved: boolean } | null = null;
  let cut = 0;
  let cutTarget = 0;
  // vyhlazený náklon telefonu
  let gyaw = 0;
  let gpitch = 0;
  let gyawTarget = 0;
  let gpitchTarget = 0;
  const onOrientation = (e: DeviceOrientationEvent) => {
    if (e.beta === null || e.gamma === null) return;
    gyawTarget = clamp(e.gamma, -30, 30) * 0.5;
    gpitchTarget = clamp(e.beta - 40, -30, 30) * -0.35;
  };
  window.addEventListener("deviceorientation", onOrientation);

  // Roztržení
  let tearStart = 0;
  let tearDone: (() => void) | null = null;
  const TEAR_MS = 1150;

  // Jiskřička
  let hint = opts.hint ?? 0;
  let onTear = opts.onTear;
  let sparkPeriod = -1;
  let spark = [0.5, 0.5];
  const sparkOffset = Math.random() * 10;

  canvas.addEventListener("pointerdown", (e) => {
    opts.onPointerDown?.();
    if (tearStart) return;
    const r = canvas.getBoundingClientRect();
    // Horní pruh je zhruba horní třetina obalu (obal zabírá ~84 % výšky plátna).
    const relY = (e.clientY - r.top) / r.height;
    dragging = { x: e.clientX, y: e.clientY, t: performance.now(), startX: e.clientX, mode: relY < 0.08 + 0.84 * 0.3 ? "tear" : "spin", moved: false };
    touched = true;
    vyaw = vpitch = 0;
    canvas.setPointerCapture(e.pointerId);
    el.classList.add("is-dragging");
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!dragging || tearStart) return;
    const now = performance.now();
    const dx = e.clientX - dragging.x;
    const dy = e.clientY - dragging.y;
    if (Math.abs(e.clientX - dragging.startX) > 8) dragging.moved = true;
    if (dragging.mode === "tear") {
      cutTarget = clamp(Math.abs(e.clientX - dragging.startX) / (canvas.getBoundingClientRect().width * 0.6), 0, 1);
      cut = cutTarget;
      if (cut >= 1) {
        dragging = null;
        onTear();
      }
    } else {
      yaw += dx * 0.6;
      pitch = clamp(pitch - dy * 0.3, -35, 35);
      const dt = Math.max(1, now - dragging.t) / 16;
      vyaw = (dx * 0.6) / dt;
      vpitch = (-dy * 0.3) / dt;
    }
    if (dragging) {
      dragging.x = e.clientX;
      dragging.y = e.clientY;
      dragging.t = now;
    }
  });
  const release = () => {
    if (!dragging) return;
    const d = dragging;
    dragging = null;
    el.classList.remove("is-dragging");
    if (tearStart) return;
    if (!d.moved) {
      onTear();
      return;
    }
    if (d.mode === "tear") cutTarget = 0;
    if (performance.now() - d.t > 80) vyaw = vpitch = 0;
  };
  canvas.addEventListener("pointerup", release);
  canvas.addEventListener("pointercancel", release);

  // --- Vykreslování ---------------------------------------------------------
  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const hgt = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== hgt) {
      canvas.width = w;
      canvas.height = hgt;
    }
  };

  const bindMesh = (mesh: Mesh) => {
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.buffer);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.index);
    const stride = 11 * 4;
    const set3 = (l: number, size: number, offset: number) => {
      if (l < 0) return;
      gl.enableVertexAttribArray(l);
      gl.vertexAttribPointer(l, size, gl.FLOAT, false, stride, offset * 4);
    };
    set3(loc.pos, 3, 0);
    set3(loc.normal, 3, 3);
    set3(loc.uv, 2, 6);
    set3(loc.side, 1, 8);
    set3(loc.param, 2, 9);
  };

  const drawPiece = (mesh: Mesh, model: Mat4, alpha: number) => {
    if (alpha <= 0.01) return;
    bindMesh(mesh);
    gl.uniformMatrix4fv(u.model, false, model);
    gl.uniformMatrix3fv(u.normalMat, false, normalMatrix(model));
    gl.uniform1f(u.alpha, alpha);
    gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_SHORT, 0);
  };

  let started = performance.now();
  let frame = 0;
  let destroyed = false;
  let paused = false;
  /** Pozastavená smyčka: čeká, až se plátno vrátí na stránku, nebo až obrazovka zanikne. */
  const waitForReturn = () =>
    setTimeout(() => {
      if (destroyed || !paused) return;
      if (el.isConnected) {
        paused = false;
        frame = requestAnimationFrame(tick);
      } else if (!(opts.alive?.() ?? false)) destroy();
      else waitForReturn();
    }, 1000);
  const destroy = () => {
    destroyed = true;
    cancelAnimationFrame(frame);
    window.removeEventListener("deviceorientation", onOrientation);
    // Uvolnit grafickou paměť hned, ne až po úklidu prohlížeče.
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  };

  const tick = (now: number) => {
    if (destroyed) return;
    if (!el.isConnected) {
      // Hned po vytvoření ještě plátno na stránce být nemusí.
      if (now - started < 1000) {
        frame = requestAnimationFrame(tick);
        return;
      }
      if (!(opts.alive?.() ?? false)) {
        destroy();
        return;
      }
      paused = true;
      waitForReturn();
      return;
    }
    frame = requestAnimationFrame(tick);
    resize();
    const t = (now - started) / 1000;
    const reduced = prefersReducedMotion();

    // natočení: tažení, setrvačnost, nebo (než na balíček sáhneš) houpání
    if (!dragging) {
      if (Math.abs(vyaw) > 0.01 || Math.abs(vpitch) > 0.01) {
        yaw += vyaw;
        pitch = clamp(pitch + vpitch, -35, 35);
        vyaw *= 0.94;
        vpitch *= 0.94;
      } else if (!touched && !reduced) {
        yaw = Math.sin(t * 0.8) * 16;
        pitch = Math.sin(t * 0.6) * 4;
      }
      if (cutTarget === 0) cut += (0 - cut) * 0.2;
    }
    gyaw += (gyawTarget - gyaw) * 0.08;
    gpitch += (gpitchTarget - gpitch) * 0.08;
    const bob = touched || reduced ? 0 : Math.sin(t * 1.1) * 0.015;

    const aspect = canvas.width / canvas.height;
    const fov = 30 * DEG;
    // vzdálenost kamery, aby se obal vešel na výšku i na šířku s rezervou
    const fit = Math.max(0.5 / 0.84, (ratio * 0.5) / (0.84 * aspect));
    const dist = fit / Math.tan(fov / 2) + BULGE;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    gl.uniformMatrix4fv(u.proj, false, perspective(fov, aspect, 0.1, 20));
    gl.uniformMatrix4fv(u.view, false, translate(0, 0, -dist));
    gl.uniform3f(u.eye, 0, 0, dist);
    gl.uniform3f(u.light, -0.45, 0.65, 1.0);
    gl.uniform1i(u.front, 0);
    gl.uniform1i(u.back, 1);
    gl.uniform1f(u.cutV, CUT_V);
    gl.uniform1f(u.cut, tearStart ? 0 : cut);
    gl.uniform1f(u.ratio, ratio);

    // jiskřička (tajný náznak), jen před roztržením
    if (hint > 0 && !tearStart) {
      const period = SPARK_PERIOD[hint];
      const phaseT = t + sparkOffset;
      const n = Math.floor(phaseT / period);
      if (n !== sparkPeriod) {
        sparkPeriod = n;
        spark = [0.18 + Math.random() * 0.64, 0.22 + Math.random() * 0.6];
      }
      const phase = phaseT - n * period;
      const amount = phase < 0.7 ? Math.sin((Math.PI * phase) / 0.7) : 0;
      gl.uniform3f(u.spark, spark[0], spark[1], amount);
      const hue = (t * 120) % 360;
      const color =
        hint >= 3
          ? [0.5 + 0.5 * Math.cos(hue * DEG), 0.5 + 0.5 * Math.cos((hue - 120) * DEG), 0.5 + 0.5 * Math.cos((hue - 240) * DEG)]
          : hint === 2
            ? [1, 0.82, 0.35]
            : [1, 1, 1];
      gl.uniform3f(u.sparkColor, color[0], color[1], color[2]);
    } else {
      gl.uniform3f(u.spark, 0, 0, 0);
    }

    const base = mul(
      translate(0, bob, 0),
      mul(rotY((yaw + gyaw) * DEG), rotX((pitch + gpitch) * DEG)),
    );

    if (!tearStart) {
      drawPiece(main!, base, 1);
      drawPiece(top!, base, 1);
      return;
    }

    // animace roztržení: pruh odletí nahoru a do strany, obal pak spadne dolů
    const p = clamp((now - tearStart) / TEAR_MS, 0, 1);
    const pivotY = 0.5 - CUT_V / 2;
    const ps = Math.min(1, p / 0.55);
    const strip = mul(
      base,
      mul(
        translate(0.35 * ps, pivotY + 0.5 * ps, 0.2 * ps),
        mul(rotZ(-40 * ps * DEG), mul(rotX(-30 * ps * DEG), translate(0, -pivotY, 0))),
      ),
    );
    drawPiece(top!, strip, 1 - smoothstep(0.25, 0.55, p));
    const pm = clamp((p - 0.3) / 0.7, 0, 1);
    const body = mul(base, mul(translate(0, -1.6 * pm * pm, -0.3 * pm), rotX(12 * pm * DEG)));
    drawPiece(main!, body, 1 - smoothstep(0.55, 1, p));
    if (p >= 1 && tearDone) {
      const done = tearDone;
      tearDone = null;
      done();
    }
  };
  frame = requestAnimationFrame(tick);

  canvas.addEventListener("webglcontextlost", (e) => {
    e.preventDefault();
    destroyed = true;
  });

  return {
    el,
    tear: () =>
      new Promise<void>((resolve) => {
        if (tearStart) return resolve();
        dragging = null;
        el.classList.remove("is-dragging");
        tearStart = performance.now();
        tearDone = resolve;
        if (destroyed) resolve();
      }),
    reset: (next) => {
      hint = next.hint ?? 0;
      onTear = next.onTear;
      tearStart = 0;
      tearDone = null;
      cut = cutTarget = 0;
      dragging = null;
      touched = false;
      yaw = pitch = vyaw = vpitch = 0;
      sparkPeriod = -1;
      started = performance.now();
      el.classList.remove("is-dragging");
      if (paused && !destroyed) {
        paused = false;
        frame = requestAnimationFrame(tick);
      }
    },
    usable: () => !destroyed,
  };
}
