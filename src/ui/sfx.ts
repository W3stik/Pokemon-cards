// Zvuky a vibrace při otevírání balíčků. Zvuky se skládají za běhu (Web Audio API),
// aplikace tedy nepotřebuje žádné zvukové soubory. Prohlížeč zvuk pustí až po
// interakci uživatele, proto se zvuk „odemyká“ v obsluze klepnutí (unlockAudio).

export interface FxPrefs {
  sound: boolean;
  vibrate: boolean;
}

const PREFS_KEY = "pokemon-packs:fx";

let prefs: FxPrefs = (() => {
  try {
    return { sound: true, vibrate: true, ...JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") };
  } catch {
    return { sound: true, vibrate: true };
  }
})();

export const fxPrefs = (): FxPrefs => ({ ...prefs });

export function setFxPrefs(change: Partial<FxPrefs>) {
  prefs = { ...prefs, ...change };
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // nevadí
  }
}

// --- Zvuk --------------------------------------------------------------------

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noise: AudioBuffer | null = null;

/** Zavolat v obsluze klepnutí (pointerdown, click): připraví a odemkne zvuk. */
export function unlockAudio() {
  if (!prefs.sound || typeof AudioContext === "undefined") return;
  if (!ctx) {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = 0.6;
    master.connect(ctx.destination);
    noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === "suspended") ctx.resume().catch(() => undefined);
}

function audio(): { ctx: AudioContext; out: GainNode; noise: AudioBuffer } | null {
  return prefs.sound && ctx && master && noise ? { ctx, out: master, noise } : null;
}

/** Šum přes pásmový filtr s posunem frekvence a danou obálkou hlasitosti. */
function noiseSweep(from: number, to: number, duration: number, envelope: number[], q = 1.2) {
  const a = audio();
  if (!a) return;
  const t = a.ctx.currentTime;
  const src = a.ctx.createBufferSource();
  src.buffer = a.noise;
  const filter = a.ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.Q.value = q;
  filter.frequency.setValueAtTime(from, t);
  filter.frequency.exponentialRampToValueAtTime(to, t + duration);
  const gain = a.ctx.createGain();
  gain.gain.setValueCurveAtTime(Float32Array.from(envelope), t, duration);
  src.connect(filter).connect(gain).connect(a.out);
  src.start(t, Math.random() * 0.5, duration);
}

function tone(freq: number, delay: number, duration: number, volume: number, type: OscillatorType = "triangle") {
  const a = audio();
  if (!a) return;
  const t = a.ctx.currentTime + delay;
  const osc = a.ctx.createOscillator();
  osc.type = type;
  osc.frequency.value = freq;
  const gain = a.ctx.createGain();
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(volume, t + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  osc.connect(gain).connect(a.out);
  osc.start(t);
  osc.stop(t + duration + 0.05);
}

/** Drobné vysoké cinknutí na náhodných tónech (třpyt). */
function shimmer(count: number, delay: number, spread: number) {
  for (let i = 0; i < count; i++) {
    tone(2000 + Math.random() * 2500, delay + Math.random() * spread, 0.25, 0.05, "sine");
  }
}

// C dur: C5 E5 G5 C6 E6 G6 C7
const NOTES = [523.25, 659.25, 783.99, 1046.5, 1318.5, 1568, 2093];

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

/** Roztržení obalu: praskavý šum fólie, který klesá. */
export function sfxTear() {
  const crackle = Array.from({ length: 48 }, (_, i) => (1 - i / 48) * (0.35 + Math.random() * 0.65));
  crackle[crackle.length - 1] = 0;
  noiseSweep(3200, 900, 0.38, crackle, 0.9);
  vibrate(25);
}

/** Odhození karty: krátké švihnutí. */
export function sfxSwipe() {
  noiseSweep(700, 3200, 0.14, [0, 0.22, 0.16, 0.06, 0], 0.8);
}

/** Odhalení vzácné karty: čím vzácnější (rank z RARITIES), tím bohatší fanfára a delší vibrace. */
export function sfxHit(rank: number) {
  if (rank >= 9) {
    // Zlatá karta, Black White Rare: akord a stoupající arpeggio s třpytem.
    for (const f of [NOTES[0], NOTES[1], NOTES[2]]) tone(f, 0, 1.6, 0.07, "sawtooth");
    NOTES.forEach((f, i) => tone(f * 2, 0.12 + i * 0.07, 0.6, 0.12));
    shimmer(18, 0.4, 1.2);
    vibrate([80, 50, 80, 50, 200]);
  } else if (rank >= 8) {
    // Special Illustration Rare
    [3, 4, 5, 6].forEach((n, i) => tone(NOTES[n], i * 0.08, 0.7, 0.14));
    shimmer(10, 0.3, 0.8);
    vibrate([60, 40, 60, 40, 120]);
  } else if (rank >= 6) {
    // Illustration / Ultra Rare
    [3, 4, 5].forEach((n, i) => tone(NOTES[n], i * 0.08, 0.5, 0.13));
    shimmer(4, 0.25, 0.4);
    vibrate([40, 40, 60]);
  } else {
    // Double Rare apod.
    [3, 4].forEach((n, i) => tone(NOTES[n], i * 0.07, 0.35, 0.11));
    vibrate(30);
  }
}
