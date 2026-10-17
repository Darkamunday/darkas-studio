import "server-only";
import { spawn } from "node:child_process";
import { BEATS_PER_BAR, MAX_BPM, MIN_BPM, type Section } from "@/config/video";

// Track analysis for music videos: tempo (BPM), where the beats fall (offset of the first beat), and the
// song's sections (intro, build, drop, breakdown, outro) from its energy. ffmpeg decodes the audio; the
// maths is plain TypeScript so it can be tested on made-up tracks.

export const SAMPLE_RATE = 11_025;
const FRAME = 512;
const HOP = 256;
const FRAMES_PER_SECOND = SAMPLE_RATE / HOP;

export type SectionSpan = { label: Section; start: number; end: number };

export type Analysis = {
  duration: number;
  bpm: number;
  /** Time of the first beat (seconds); bars start here, one every `barSeconds`. */
  offset: number;
  barSeconds: number;
  sections: SectionSpan[];
  /** Loudness of each bar, 0–1 (for the timeline). */
  barEnergy: number[];
};

/** Decode any audio file to mono 32-bit float samples at SAMPLE_RATE. */
export function decodeAudio(file: string): Promise<Float32Array> {
  return new Promise((resolve, reject) => {
    const ff = spawn("ffmpeg", ["-v", "error", "-i", file, "-ac", "1", "-ar", String(SAMPLE_RATE), "-f", "f32le", "-"]);
    const chunks: Buffer[] = [];
    let err = "";
    ff.stdout.on("data", (c: Buffer) => chunks.push(c));
    ff.stderr.on("data", (c: Buffer) => (err += c));
    ff.on("error", reject);
    ff.on("close", (code) => {
      if (code !== 0) return reject(new Error(`ffmpeg couldn't read the track: ${err.trim().slice(0, 300)}`));
      const buf = Buffer.concat(chunks);
      resolve(new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4)));
    });
  });
}

// ---- onset strength (spectral flux) ------------------------------------------------------------

/** In-place radix-2 FFT (re/im of length power of two). */
function fft(re: Float64Array, im: Float64Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const wr = Math.cos(ang * k), wi = Math.sin(ang * k);
        const ar = re[i + k + len / 2], ai = im[i + k + len / 2];
        const tr = ar * wr - ai * wi, ti = ar * wi + ai * wr;
        re[i + k + len / 2] = re[i + k] - tr;
        im[i + k + len / 2] = im[i + k] - ti;
        re[i + k] += tr;
        im[i + k] += ti;
      }
    }
  }
}

/** How much new sound starts in each frame (positive change in log spectrum), one value per HOP. */
export function onsetEnvelope(samples: Float32Array): Float64Array {
  const frames = Math.max(0, Math.floor((samples.length - FRAME) / HOP) + 1);
  const out = new Float64Array(frames);
  const window = Float64Array.from({ length: FRAME }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / FRAME));
  let prev = new Float64Array(FRAME / 2);
  const re = new Float64Array(FRAME), im = new Float64Array(FRAME);
  for (let f = 0; f < frames; f++) {
    for (let i = 0; i < FRAME; i++) {
      re[i] = samples[f * HOP + i] * window[i];
      im[i] = 0;
    }
    fft(re, im);
    const mag = new Float64Array(FRAME / 2);
    let flux = 0;
    for (let k = 0; k < FRAME / 2; k++) {
      mag[k] = Math.log1p(1000 * Math.hypot(re[k], im[k]));
      flux += Math.max(0, mag[k] - prev[k]);
    }
    out[f] = flux;
    prev = mag;
  }
  // Take away the slowly-moving average, so beats stand out from loud passages.
  const smooth = movingAverage(out, Math.round(FRAMES_PER_SECOND / 2));
  for (let f = 0; f < frames; f++) out[f] = Math.max(0, out[f] - smooth[f]);
  return out;
}

function movingAverage(x: Float64Array, half: number): Float64Array {
  const out = new Float64Array(x.length);
  let sum = 0, lo = 0, hi = -1;
  for (let i = 0; i < x.length; i++) {
    while (hi < Math.min(x.length - 1, i + half)) sum += x[++hi];
    while (lo < i - half) sum -= x[lo++];
    out[i] = sum / (hi - lo + 1);
  }
  return out;
}

/** Onset strength at a time in seconds (linear between frames). */
const at = (env: Float64Array, t: number) => {
  const x = t * FRAMES_PER_SECOND;
  const i = Math.floor(x);
  if (i < 0 || i + 1 >= env.length) return 0;
  return env[i] + (env[i + 1] - env[i]) * (x - i);
};

/** How well beats every `period` seconds starting at `phase` line up with the onsets. */
function alignment(env: Float64Array, period: number, phase: number, duration: number): number {
  let sum = 0, n = 0;
  for (let t = phase; t < duration; t += period, n++) sum += at(env, t);
  return n ? sum / n : 0;
}

/** The best beat start for a period (searched in 10 ms steps). */
function bestPhase(env: Float64Array, period: number, duration: number): { phase: number; score: number } {
  let best = { phase: 0, score: -1 };
  for (let phase = 0; phase < period; phase += 0.01) {
    const score = alignment(env, period, phase, duration);
    if (score > best.score) best = { phase, score };
  }
  return best;
}

/** Tempo and first-beat time from the onset envelope. */
export function findTempo(env: Float64Array, duration: number): { bpm: number; offset: number } {
  // Coarse: autocorrelation over the tempo range, also crediting the double period (avoids octave errors).
  const ac = (lag: number) => {
    let s = 0;
    for (let i = 0; i + lag < env.length; i++) s += env[i] * env[i + lag];
    return s / (env.length - lag);
  };
  let coarse = 120, bestScore = -1;
  for (let bpm = MIN_BPM; bpm <= MAX_BPM; bpm += 0.5) {
    const lag = Math.round((60 / bpm) * FRAMES_PER_SECOND);
    const score = ac(lag) + 0.5 * ac(lag * 2);
    if (score > bestScore) [coarse, bestScore] = [bpm, score];
  }
  // Fine: the tempo whose beat grid lines up best across the whole track, in 0.05 BPM steps. The coarse
  // step is a whole frame of lag (about 6 BPM at 128), so search that far either side.
  let best = { bpm: coarse, phase: 0, score: -1 };
  const spread = coarse * 0.06;
  for (let bpm = Math.max(MIN_BPM, coarse - spread); bpm <= Math.min(MAX_BPM, coarse + spread); bpm += 0.05) {
    const { phase, score } = bestPhase(env, 60 / bpm, duration);
    if (score > best.score) best = { bpm, phase, score };
  }
  const bpm = Math.round(best.bpm * 10) / 10;
  // Re-find the start for the rounded tempo, to the nearest 10 ms.
  const offset = Math.round(bestPhase(env, 60 / bpm, duration).phase * 100) / 100;
  return { bpm, offset };
}

// ---- sections ------------------------------------------------------------------------------------

/** Loudness of each bar (RMS), scaled 0–1 by the track's own range. */
export function barEnergies(samples: Float32Array, offset: number, barSeconds: number): number[] {
  const bars: number[] = [];
  for (let start = offset; start + barSeconds / 2 < samples.length / SAMPLE_RATE; start += barSeconds) {
    const a = Math.floor(start * SAMPLE_RATE), b = Math.min(samples.length, Math.floor((start + barSeconds) * SAMPLE_RATE));
    let sum = 0;
    for (let i = a; i < b; i++) sum += samples[i] * samples[i];
    bars.push(Math.sqrt(sum / Math.max(1, b - a)));
  }
  const sorted = [...bars].sort((x, y) => x - y);
  const lo = sorted[Math.floor(sorted.length * 0.05)] ?? 0, hi = sorted[Math.floor(sorted.length * 0.95)] ?? 1;
  return bars.map((e) => Math.max(0, Math.min(1, (e - lo) / Math.max(1e-9, hi - lo))));
}

/**
 * Sections from bar loudness, in 4-bar blocks: loud = drop, quiet = breakdown, in between = build;
 * quiet blocks before the first loud part are the intro, and after the last loud part the outro.
 */
export function labelSections(energy: number[], offset: number, barSeconds: number, duration: number): SectionSpan[] {
  const BLOCK = 4;
  const blocks: number[] = [];
  for (let i = 0; i < energy.length; i += BLOCK) {
    const part = energy.slice(i, i + BLOCK);
    blocks.push(part.reduce((s, e) => s + e, 0) / part.length);
  }
  if (!blocks.length) return [{ label: "intro", start: 0, end: duration }];
  const label = (e: number): Section => (e >= 0.66 ? "drop" : e < 0.33 ? "breakdown" : "build");
  const labels = blocks.map(label);
  const firstLoud = labels.findIndex((l) => l !== "breakdown");
  const lastLoud = labels.length - 1 - [...labels].reverse().findIndex((l) => l !== "breakdown");
  for (let i = 0; i < labels.length; i++) {
    if (firstLoud >= 0 && i < firstLoud) labels[i] = "intro";
    else if (firstLoud >= 0 && i > lastLoud) labels[i] = "outro";
  }
  if (firstLoud < 0) labels.fill("intro");
  const spans: SectionSpan[] = [];
  labels.forEach((l, i) => {
    const start = i === 0 ? 0 : offset + i * BLOCK * barSeconds;
    const end = i === labels.length - 1 ? duration : offset + (i + 1) * BLOCK * barSeconds;
    const last = spans.at(-1);
    if (last && last.label === l) last.end = end;
    else spans.push({ label: l, start, end });
  });
  return spans.map((s) => ({ ...s, start: round2(s.start), end: round2(s.end) }));
}

const round2 = (x: number) => Math.round(x * 100) / 100;

/** Analyse decoded samples. */
export function analyseSamples(samples: Float32Array): Analysis {
  const duration = samples.length / SAMPLE_RATE;
  const env = onsetEnvelope(samples);
  const { bpm, offset } = findTempo(env, duration);
  const barSeconds = (BEATS_PER_BAR * 60) / bpm;
  const barEnergy = barEnergies(samples, offset, barSeconds);
  return {
    duration: round2(duration),
    bpm,
    offset,
    barSeconds: Math.round(barSeconds * 1000) / 1000,
    sections: labelSections(barEnergy, offset, barSeconds, duration),
    barEnergy: barEnergy.map((e) => Math.round(e * 100) / 100),
  };
}

/** Analyse an audio file. */
export async function analyseFile(file: string): Promise<Analysis> {
  return analyseSamples(await decodeAudio(file));
}
