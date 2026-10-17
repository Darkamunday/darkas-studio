// Music video track analysis: tempo, first beat and sections, on made-up tracks with known answers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { SAMPLE_RATE, analyseSamples, labelSections } from "@/lib/video/analyse";

/**
 * A made-up track: a click (a short burst of noise) on every beat, with a noise bed whose loudness
 * follows `loudness(bar)`. Deterministic noise so the test is repeatable.
 */
function clickTrack(bpm: number, offset: number, bars: number, loudness: (bar: number) => number): Float32Array {
  const beat = 60 / bpm;
  const duration = offset + bars * 4 * beat + 1;
  const out = new Float32Array(Math.round(duration * SAMPLE_RATE));
  let seed = 1;
  const noise = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
  for (let i = 0; i < out.length; i++) {
    const t = i / SAMPLE_RATE;
    const bar = Math.max(0, Math.floor((t - offset) / (4 * beat)));
    out[i] = 0.15 * loudness(bar) * noise();
  }
  for (let t = offset; t < duration; t += beat) {
    const bar = Math.floor((t - offset) / (4 * beat));
    const start = Math.round(t * SAMPLE_RATE);
    for (let k = 0; k < SAMPLE_RATE * 0.03 && start + k < out.length; k++) {
      out[start + k] += (0.3 + 0.6 * loudness(bar)) * noise() * Math.exp(-k / (SAMPLE_RATE * 0.008));
    }
  }
  return out;
}

test("finds 128.7 BPM and the first beat at 0.05 s (the tempo of a real finished video)", () => {
  const a = analyseSamples(clickTrack(128.7, 0.05, 48, () => 0.6));
  assert.ok(Math.abs(a.bpm - 128.7) <= 0.2, `bpm ${a.bpm}`);
  const beat = 60 / a.bpm;
  const phaseError = Math.min(Math.abs(a.offset - 0.05), Math.abs(a.offset - 0.05 - beat));
  assert.ok(phaseError <= 0.03, `offset ${a.offset}`);
  assert.ok(Math.abs(a.barSeconds - 1.865) < 0.01, `bar ${a.barSeconds}`);
});

test("other tempos across the range", () => {
  for (const [bpm, offset] of [[92, 0.3], [140, 0.12], [174, 0.2]] as const) {
    const a = analyseSamples(clickTrack(bpm, offset, 40, () => 0.6));
    assert.ok(Math.abs(a.bpm - bpm) <= 0.3, `${bpm} → ${a.bpm}`);
  }
});

test("sections follow the loudness: quiet intro, loud drop, quiet breakdown, loud drop, quiet outro", () => {
  const shape = (bar: number) => (bar < 16 ? 0.05 : bar < 32 ? 1 : bar < 40 ? 0.05 : bar < 56 ? 1 : 0.05);
  const a = analyseSamples(clickTrack(128, 0.1, 64, shape));
  assert.deepEqual(a.sections.map((s) => s.label), ["intro", "drop", "breakdown", "drop", "outro"]);
  assert.equal(a.sections[0].start, 0);
  assert.equal(a.sections.at(-1)!.end, a.duration);
  for (let i = 1; i < a.sections.length; i++) assert.equal(a.sections[i].start, a.sections[i - 1].end, "no gaps");
});

test("section labelling on an energy curve", () => {
  const energy = [...Array(8).fill(0.1), ...Array(8).fill(0.5), ...Array(8).fill(0.9), ...Array(8).fill(0.1)];
  const spans = labelSections(energy, 0, 2, 64);
  assert.deepEqual(spans.map((s) => s.label), ["intro", "build", "drop", "outro"]);
  assert.deepEqual(spans.map((s) => [s.start, s.end]), [[0, 16], [16, 32], [32, 48], [48, 64]]);
});
