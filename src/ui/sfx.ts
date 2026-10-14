// Zvuky a vibrace při otevírání balíčků. Zvuky se skládají za běhu (Web Audio API),
// aplikace tedy nepotřebuje žádné zvukové soubory. Prohlížeč zvuk pustí až po
// interakci uživatele, proto se zvuk „odemyká“ v obsluze klepnutí (unlockAudio).
//
// Moderní zvuk dělají vrstvy a prostor, ne jednoduché tóny: FM „křišťálové“ zvonky,
// rozladěné syntezátorové plochy (supersaw), šumové švihy pohybující se ve stereu,
// hluboké dopady a společný dozvuk (konvoluce) s kompresorem na výstupu.

import { type Tier, tierOf } from "./reveal";

export interface FxPrefs {
  sound: boolean;
  vibrate: boolean;
  /** Hlasitost zvuků 0–1. */
  volume: number;
}

const PREFS_KEY = "pokemon-packs:fx";
const DEFAULTS: FxPrefs = { sound: true, vibrate: true, volume: 1 };

let prefs: FxPrefs = (() => {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") };
  } catch {
    return { ...DEFAULTS };
  }
})();

export const fxPrefs = (): FxPrefs => ({ ...prefs });

export function setFxPrefs(change: Partial<FxPrefs>) {
  prefs = { ...prefs, ...change };
  if (engine) engine.master.gain.value = prefs.volume;
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // nevadí
  }
}

// --- Zvukový řetězec ------------------------------------------------------------

/** Výstup pro jeden kontext: suchý vstup, vstup do dozvuku a společné zdroje. */
export interface Engine {
  ctx: BaseAudioContext;
  master: GainNode;
  dry: GainNode;
  wet: GainNode;
  noise: AudioBuffer;
  /** Křivka mírného zkreslení (dopady jsou díky alikvotům slyšet i z malého reproduktoru telefonu). */
  drive: Float32Array<ArrayBuffer>;
}

/**
 * Sestaví řetězec: zdroje → (suchý | dozvuk) → kompresor → hlasitost → výstup.
 * Funguje i nad OfflineAudioContext (vykreslení zvuků do souboru při ladění).
 */
export function createEngine(ctx: BaseAudioContext, volume = prefs.volume): Engine {
  const master = ctx.createGain();
  master.gain.value = volume;
  master.connect(ctx.destination);
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -18;
  comp.knee.value = 10;
  comp.ratio.value = 5;
  comp.attack.value = 0.002;
  comp.release.value = 0.2;
  comp.connect(master);

  const dry = ctx.createGain();
  dry.connect(comp);
  const wet = ctx.createGain();
  const preDelay = ctx.createDelay(0.1);
  preDelay.delayTime.value = 0.025;
  const reverb = ctx.createConvolver();
  reverb.buffer = impulse(ctx, 2.6);
  // dozvuk bez basů, jinak duní
  const lowCut = ctx.createBiquadFilter();
  lowCut.type = "highpass";
  lowCut.frequency.value = 200;
  const ret = ctx.createGain();
  ret.gain.value = 0.8;
  wet.connect(preDelay).connect(reverb).connect(lowCut).connect(ret).connect(comp);

  const noise = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate);
  const data = noise.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

  const drive = new Float32Array(1024);
  for (let i = 0; i < drive.length; i++) drive[i] = Math.tanh(((i / (drive.length - 1)) * 2 - 1) * 3);
  return { ctx, master, dry, wet, noise, drive };
}

/** Stereo odezva místnosti: šum, který slábne a postupně tmavne (výšky doznívají dřív). */
function impulse(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const len = Math.floor(seconds * ctx.sampleRate);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let y = 0;
    for (let i = 0; i < len; i++) {
      const p = i / len;
      y += (0.85 - 0.75 * p) * (Math.random() * 2 - 1 - y);
      d[i] = y * (1 - p) ** 3;
    }
  }
  return buf;
}

// --- Stavební kameny --------------------------------------------------------------

const midi = (m: number) => 440 * 2 ** ((m - 69) / 12);
const rand = (min: number, max: number) => min + Math.random() * (max - min);

interface Place {
  /** Poloha ve stereu −1 (vlevo) až 1 (vpravo); s `panTo` se během zvuku přesouvá. */
  pan?: number;
  panTo?: number;
  /** Kolik jde do dozvuku. */
  send?: number;
}

function place(e: Engine, node: AudioNode, t: number, dur: number, o: Place = {}) {
  const p = e.ctx.createStereoPanner();
  p.pan.setValueAtTime(o.pan ?? 0, t);
  if (o.panTo !== undefined) p.pan.linearRampToValueAtTime(o.panTo, t + dur);
  node.connect(p);
  p.connect(e.dry);
  if (o.send) {
    const s = e.ctx.createGain();
    s.gain.value = o.send;
    p.connect(s).connect(e.wet);
  }
}

/** Obálka hlasitosti: náběh za `attack`, pak exponenciální dozvuk za `decay`. */
function envelope(e: Engine, t: number, attack: number, decay: number, peak: number): GainNode {
  const g = e.ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  return g;
}

function noiseSource(e: Engine, t: number, dur: number): AudioBufferSourceNode {
  const src = e.ctx.createBufferSource();
  src.buffer = e.noise;
  src.start(t, rand(0, Math.max(0, e.noise.duration - dur - 0.05)), dur + 0.02);
  return src;
}

function filter(e: Engine, type: BiquadFilterType, freq: number, q = 1): BiquadFilterNode {
  const f = e.ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  return f;
}

function osc(e: Engine, type: OscillatorType, freq: number, t: number, dur: number): OscillatorNode {
  const o = e.ctx.createOscillator();
  o.type = type;
  o.frequency.value = freq;
  o.start(t);
  o.stop(t + dur + 0.05);
  return o;
}

/** Křišťálový zvonek (FM syntéza): jasný úder, který rychle změkne. */
function bell(e: Engine, t: number, freq: number, o: { dur?: number; vol?: number; ratio?: number; bright?: number } & Place = {}) {
  const dur = o.dur ?? 1.4;
  const vol = o.vol ?? 0.1;
  const mix = e.ctx.createGain();
  const carrier = osc(e, "sine", freq, t, dur);
  const mod = osc(e, "sine", freq * (o.ratio ?? 3.5), t, dur);
  const index = e.ctx.createGain();
  index.gain.setValueAtTime(freq * 2.2 * (o.bright ?? 1), t);
  index.gain.exponentialRampToValueAtTime(freq * 0.05 + 1, t + dur * 0.5);
  mod.connect(index).connect(carrier.frequency);
  carrier.connect(envelope(e, t, 0.004, dur, vol)).connect(mix);
  // oktávový alikvot: krátký třpyt na začátku
  osc(e, "sine", freq * 2.003, t, dur * 0.35)
    .connect(envelope(e, t, 0.002, dur * 0.35, vol * 0.25))
    .connect(mix);
  place(e, mix, t, dur, { send: 0.5, ...o });
}

/** Široká syntezátorová plocha: rozladěné pily (supersaw) přes otevírající se filtr. */
function pad(e: Engine, t: number, notes: number[], dur: number, o: { vol?: number; attack?: number; cutoff?: number; send?: number } = {}) {
  const attack = o.attack ?? 0.25;
  const detunes = [-14, -6, 0, 6, 14];
  const lp = filter(e, "lowpass", 300, 0.7);
  lp.frequency.setValueAtTime(300, t);
  lp.frequency.exponentialRampToValueAtTime(o.cutoff ?? 3000, t + attack + 0.2);
  lp.frequency.exponentialRampToValueAtTime(700, t + dur);
  const g = e.ctx.createGain();
  const peak = (o.vol ?? 0.05) / Math.sqrt(notes.length * detunes.length);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.setValueAtTime(peak, t + Math.max(attack, dur * 0.4));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  // každá druhá pila vlevo / vpravo: plocha je široká přes celé stereo
  const left = e.ctx.createStereoPanner();
  left.pan.value = -0.7;
  const right = e.ctx.createStereoPanner();
  right.pan.value = 0.7;
  left.connect(lp);
  right.connect(lp);
  let n = 0;
  for (const m of notes) {
    for (const cents of detunes) {
      const saw = osc(e, "sawtooth", midi(m), t, dur);
      saw.detune.value = cents + rand(-2, 2);
      saw.connect(n++ % 2 ? left : right);
    }
  }
  lp.connect(g);
  place(e, g, t, dur, { send: o.send ?? 0.6 });
}

/** Švih: šum přes pásmový filtr, který se posouvá; volitelně přelétne ve stereu. */
function whoosh(e: Engine, t: number, dur: number, o: { from: number; to: number; vol?: number; q?: number; peak?: number } & Place) {
  const bp = filter(e, "bandpass", o.from, o.q ?? 1);
  bp.frequency.setValueAtTime(o.from, t);
  bp.frequency.exponentialRampToValueAtTime(o.to, t + dur);
  const g = e.ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(o.vol ?? 0.2, t + dur * (o.peak ?? 0.5));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  noiseSource(e, t, dur).connect(bp).connect(g);
  place(e, g, t, dur, { send: 0.2, ...o });
}

/** Hluboký dopad: klesající sub s alikvoty, tlumený šum a ostrý začátek. */
function impact(e: Engine, t: number, o: { vol?: number; size?: number } = {}) {
  const size = o.size ?? 1;
  const vol = o.vol ?? 0.5;
  const sub = osc(e, "sine", 140, t, 0.6 * size);
  sub.frequency.setValueAtTime(140, t);
  sub.frequency.exponentialRampToValueAtTime(40, t + 0.3 * size);
  const drive = e.ctx.createWaveShaper();
  drive.curve = e.drive;
  sub.connect(drive).connect(envelope(e, t, 0.003, 0.55 * size, vol)).connect(e.dry);

  const lp = filter(e, "lowpass", 2500);
  lp.frequency.setValueAtTime(2500, t);
  lp.frequency.exponentialRampToValueAtTime(150, t + 0.3 * size);
  const body = envelope(e, t, 0.002, 0.3 * size, vol * 0.6);
  noiseSource(e, t, 0.4 * size).connect(lp).connect(body);
  place(e, body, t, 0.4 * size, { send: 0.4 });

  const click = envelope(e, t, 0.001, 0.025, vol * 0.5);
  noiseSource(e, t, 0.03).connect(filter(e, "highpass", 2500)).connect(click);
  place(e, click, t, 0.03, { send: 0.2 });
}

/** Činel: vysoký šum s dlouhým dozněním, rozložený do stran. */
function crash(e: Engine, t: number, dur: number, vol: number) {
  for (const pan of [-0.5, 0.5]) {
    const g = envelope(e, t, 0.005, dur, vol);
    noiseSource(e, t, dur).connect(filter(e, "highpass", 4500 + rand(-300, 300))).connect(g);
    place(e, g, t, dur, { pan, send: 0.6 });
  }
}

/** Stoupající napětí: pily s rezonančním filtrem, zrychlující tremolo a šum. */
function riser(e: Engine, t: number, dur: number, tier: number) {
  const base = midi(50);
  const end = base * 2 ** (1 + tier * 0.5);
  const lp = filter(e, "lowpass", 400, 2);
  lp.frequency.setValueAtTime(400, t);
  lp.frequency.exponentialRampToValueAtTime(2500 + tier * 1200, t + dur);
  for (const [ratio, cents] of [
    [1, -10],
    [1, 0],
    [1, 10],
    [1.5, 0],
  ]) {
    const saw = osc(e, "sawtooth", base * ratio, t, dur);
    saw.detune.value = cents;
    saw.frequency.setValueAtTime(base * ratio, t);
    saw.frequency.exponentialRampToValueAtTime(end * ratio, t + dur);
    saw.connect(lp);
  }
  // tremolo zrychluje k vrcholu
  const trem = e.ctx.createGain();
  trem.gain.value = 0.6;
  const lfo = osc(e, "sine", 5, t, dur);
  lfo.frequency.setValueAtTime(5, t);
  lfo.frequency.linearRampToValueAtTime(16 + tier * 4, t + dur);
  const depth = e.ctx.createGain();
  depth.gain.value = 0.4;
  lfo.connect(depth).connect(trem.gain);
  const g = e.ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.03 + tier * 0.012, t + dur * 0.95);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.04);
  lp.connect(trem).connect(g);
  place(e, g, t, dur, { send: 0.35 });
  whoosh(e, t, dur, { from: 500, to: 7000 + tier * 1500, vol: 0.04 + tier * 0.02, q: 1.2, peak: 0.97, send: 0.3 });
}

/** Úder srdce („lub-dub“), který slyšíš spíš břichem než ušima. */
function heartbeat(e: Engine, t: number, vol: number) {
  for (const [at, v] of [
    [0, vol],
    [0.15, vol * 0.65],
  ]) {
    const s = osc(e, "sine", 95, t + at, 0.25);
    s.frequency.setValueAtTime(95, t + at);
    s.frequency.exponentialRampToValueAtTime(48, t + at + 0.12);
    const drive = e.ctx.createWaveShaper();
    drive.curve = e.drive;
    s.connect(drive).connect(envelope(e, t + at, 0.004, 0.22, v)).connect(e.dry);
  }
}

/** Lusknutí karty. */
function snap(e: Engine, t: number, vol: number) {
  const g = envelope(e, t, 0.001, 0.035, vol);
  noiseSource(e, t, 0.04).connect(filter(e, "bandpass", 3200, 1.5)).connect(g);
  place(e, g, t, 0.04, { send: 0.15 });
}

/** Šustění fólie: desítky drobných prasknutí s náhodnou výškou a polohou. */
function crinkle(e: Engine, t: number, dur: number, grains: number, vol: number) {
  for (let i = 0; i < grains; i++) {
    const at = t + dur * Math.random() ** 1.4;
    const len = rand(0.006, 0.03);
    const g = envelope(e, at, 0.001, len, vol * rand(0.3, 1));
    noiseSource(e, at, len).connect(filter(e, "bandpass", rand(1800, 9000), rand(1.5, 5))).connect(g);
    place(e, g, at, len, { pan: rand(-0.7, 0.7), send: 0.15 });
  }
}

// D dur pentatonika (D E F# A B): náhodné tóny spolu vždy ladí
const PENTA = [62, 64, 66, 69, 71];

/** Třpyt: rozsypané vysoké zvonky po celém stereu. */
function sparkle(e: Engine, t: number, count: number, spread: number, vol = 0.03) {
  for (let i = 0; i < count; i++) {
    const note = PENTA[Math.floor(Math.random() * PENTA.length)] + 24 + (Math.random() < 0.3 ? 12 : 0);
    bell(e, t + spread * Math.random() ** 1.3, midi(note), {
      dur: rand(0.35, 0.9),
      vol: vol * rand(0.5, 1),
      bright: 0.6,
      pan: rand(-0.8, 0.8),
      send: 0.7,
    });
  }
}

/** Arpeggio zvonků zleva doprava. */
function arpeggio(e: Engine, t: number, notes: number[], step: number, o: { vol?: number; dur?: number } = {}) {
  notes.forEach((m, i) =>
    bell(e, t + i * step, midi(m), {
      dur: o.dur ?? 1.4,
      vol: o.vol ?? 0.08,
      pan: notes.length > 1 ? -0.5 + i / (notes.length - 1) : 0,
      send: 0.55,
    }),
  );
}

// Akordy: D maj9 jako „domov“, lydická stupnice (G#) zní kouzelně
const DMAJ9 = [50, 57, 61, 64, 66];
const LYDIAN = [74, 76, 78, 80, 81, 85, 86];

// --- Zvuky událostí ------------------------------------------------------------------

/** Všechny zvuky aplikace; `t` je čas spuštění v kontextu (ctx.currentTime). */
export const SOUNDS = {
  /** Roztržení obalu: šustění fólie, trhnutí a závan vzduchu. */
  tear(e: Engine, t: number) {
    crinkle(e, t, 0.42, 46, 0.5);
    whoosh(e, t + 0.02, 0.36, { from: 5200, to: 1100, vol: 0.45, q: 0.9, peak: 0.25, pan: -0.25, panTo: 0.3 });
    whoosh(e, t + 0.12, 0.5, { from: 300, to: 900, vol: 0.2, q: 0.7, peak: 0.4, send: 0.3 });
    bell(e, t + 0.18, midi(81), { dur: 0.9, vol: 0.025, bright: 0.5, send: 0.6 });
  },
  /** Karty vyjedou z balíčku: rychlé papírové švihy za sebou. */
  deal(e: Engine, t: number, count = 5) {
    for (let i = 0; i < count; i++) {
      whoosh(e, t + i * 0.045 + rand(0, 0.01), 0.16, {
        from: rand(1200, 1600),
        to: rand(3000, 4200),
        vol: 0.12,
        q: 1.1,
        peak: 0.4,
        pan: rand(-0.3, 0.3),
        send: 0.1,
      });
    }
    sparkle(e, t + 0.1, 3, 0.35, 0.02);
  },
  /** Odhození karty: švih, který odletí na stranu, kam karta letí. */
  swipe(e: Engine, t: number, dir = -1) {
    const k = rand(0.85, 1.15);
    whoosh(e, t, 0.2, { from: 800 * k, to: 4200 * k, vol: 0.5, q: 0.9, peak: 0.35, pan: 0, panTo: 0.85 * dir, send: 0.15 });
    snap(e, t, 0.08);
  },
  /** Nabíjení vzácné karty: stoupající napětí, u vzácnějších i zrychlující tlukot srdce. */
  charge(e: Engine, t: number, tier: number, ms: number) {
    const dur = Math.max(0.2, ms / 1000);
    riser(e, t, dur, tier);
    if (tier >= 2) {
      let gap = tier >= 3 ? 0.34 : 0.42;
      for (let at = 0; at < dur - 0.12; at += gap, gap *= 0.8) heartbeat(e, t + at, 0.08 + tier * 0.025);
    }
  },
  /** Otočení karty: nádech, který vyvrcholí ve chvíli, kdy se ukáže líc. */
  flip(e: Engine, t: number) {
    whoosh(e, t, 0.28, { from: 500, to: 6000, vol: 0.35, q: 0.8, peak: 0.92 });
    snap(e, t + 0.27, 0.1);
  },
  /** Odhalení vzácné karty podle úrovně rarity (1 = RR … 4 = zlatá / BWR). */
  hit(e: Engine, t: number, tier: Tier) {
    if (tier <= 1) {
      arpeggio(e, t, [74, 81], 0.07, { vol: 0.12, dur: 1.1 });
      sparkle(e, t + 0.1, 4, 0.5, 0.025);
    } else if (tier === 2) {
      impact(e, t, { vol: 0.3, size: 0.6 });
      arpeggio(e, t, [74, 78, 81, 86], 0.055, { vol: 0.08, dur: 1.3 });
      pad(e, t, DMAJ9, 1.6, { vol: 0.05, attack: 0.08, cutoff: 2600 });
      sparkle(e, t + 0.15, 8, 0.9, 0.028);
    } else if (tier === 3) {
      impact(e, t, { vol: 0.42, size: 1 });
      crash(e, t, 1.6, 0.045);
      pad(e, t, [...DMAJ9, 73], 2.6, { vol: 0.065, attack: 0.15, cutoff: 3600 });
      arpeggio(e, t + 0.05, LYDIAN, 0.06, { vol: 0.07, dur: 1.5 });
      sparkle(e, t + 0.3, 14, 1.6, 0.03);
    } else {
      impact(e, t, { vol: 0.55, size: 1.5 });
      crash(e, t, 2.4, 0.08);
      pad(e, t, [38, ...DMAJ9, 69, 73], 3.4, { vol: 0.075, attack: 0.12, cutoff: 4200 });
      arpeggio(e, t + 0.05, [...LYDIAN, ...LYDIAN.slice(1).map((m) => m + 12)], 0.05, { vol: 0.065, dur: 1.6 });
      sparkle(e, t + 0.35, 26, 2.2, 0.032);
    }
  },
  /** God pack: vlastní znělka (G maj9 → A add9 → D maj9) s dopadem a sprškou třpytu. */
  god(e: Engine, t: number) {
    const steps = [
      { at: 0, chord: [43, 55, 59, 62, 66, 69], melody: [83, 86, 90], dur: 0.9 },
      { at: 0.75, chord: [45, 57, 61, 64, 69, 71], melody: [85, 88, 93], dur: 0.9 },
      { at: 1.5, chord: [38, ...DMAJ9, 73], melody: [86, 90, 93, 98], dur: 3 },
    ];
    impact(e, t, { vol: 0.42, size: 1.1 });
    for (const s of steps) {
      pad(e, t + s.at, s.chord, s.dur, { vol: 0.065, attack: 0.06, cutoff: 3800 });
      arpeggio(e, t + s.at, s.melody, 0.09, { vol: 0.075, dur: s.dur > 1 ? 2 : 1.1 });
    }
    impact(e, t + 1.5, { vol: 0.55, size: 1.6 });
    crash(e, t + 1.5, 2.6, 0.09);
    sparkle(e, t + 1.6, 30, 2.4, 0.032);
  },
};

// --- Přehrávání ------------------------------------------------------------------

let engine: Engine | null = null;

/** Zavolat v obsluze klepnutí (pointerdown, click): připraví a odemkne zvuk. */
export function unlockAudio() {
  if (!prefs.sound || typeof AudioContext === "undefined") return;
  if (!engine) engine = createEngine(new AudioContext(), prefs.volume);
  const ctx = engine.ctx as AudioContext;
  if (ctx.state === "suspended") ctx.resume().catch(() => undefined);
}

/** Pustí zvuk, když je zapnutý a odemčený. */
function play(sound: (e: Engine, t: number) => void) {
  if (!prefs.sound || !engine) return;
  sound(engine, engine.ctx.currentTime + 0.01);
}

// --- Vibrace -------------------------------------------------------------------

function vibrate(pattern: number | number[]) {
  if (!prefs.vibrate || typeof navigator === "undefined" || !("vibrate" in navigator)) return;
  // Před prvním klepnutím prohlížeč vibraci zablokuje a zapíše chybu do konzole.
  if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
  try {
    navigator.vibrate(pattern);
  } catch {
    // nevadí
  }
}

// --- Události ------------------------------------------------------------------

export function sfxTear() {
  play(SOUNDS.tear);
  vibrate(25);
}

export function sfxDeal(count: number) {
  play((e, t) => SOUNDS.deal(e, t, count));
}

/** `dir`: −1 karta letí doleva, 1 doprava. */
export function sfxSwipe(dir = -1) {
  play((e, t) => SOUNDS.swipe(e, t, dir));
}

export function sfxCharge(tier: number, ms: number) {
  play((e, t) => SOUNDS.charge(e, t, tier, ms));
  // vibrace sílí: krátké pulzy se zkracujícími se mezerami
  const pulses = Math.round(2 + tier * 1.5);
  vibrate(Array.from({ length: pulses * 2 - 1 }, (_, i) => (i % 2 ? Math.max(20, 70 - i * 6) : 12 + tier * 4)));
}

export function sfxFlip() {
  play(SOUNDS.flip);
}

/** Odhalení vzácné karty: čím vzácnější (rank z RARITIES), tím bohatší zvuk a delší vibrace. */
export function sfxHit(rank: number) {
  const tier = tierOf(rank);
  play((e, t) => SOUNDS.hit(e, t, tier));
  vibrate(tier >= 4 ? [80, 50, 80, 50, 200] : tier === 3 ? [60, 40, 60, 40, 120] : tier === 2 ? [40, 40, 60] : 30);
}

export function sfxGodPack() {
  play(SOUNDS.god);
  vibrate([60, 40, 60, 40, 60, 120, 250]);
}
