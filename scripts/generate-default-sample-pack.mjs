import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PACK_DIR = path.join(ROOT, "assets", "audio", "sample-pack");
const SAMPLE_RATE = 44100;
const LOOP_BPM = 118;
const BEAT_SECONDS = 60 / LOOP_BPM;
const BAR_SECONDS = BEAT_SECONDS * 4;
const LOOP_SECONDS = BAR_SECONDS * 4;
const TAU = Math.PI * 2;

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clampSample(value) {
  return Math.max(-1, Math.min(1, Number.isFinite(value) ? value : 0));
}

function env(t, start, decay) {
  if (t < start) return 0;
  return Math.exp(-(t - start) / decay);
}

function pulse(t, start, length) {
  if (t < start || t > start + length) return 0;
  return 1 - (t - start) / length;
}

function sineSweep(t, start, length, high, low) {
  if (t < start || t > start + length) return 0;
  const local = t - start;
  const phase = local / length;
  const freq = high + (low - high) * phase;
  return Math.sin(TAU * freq * local) * Math.exp(-phase * 8);
}

function writeStereoWav(filePath, seconds, sampleFn) {
  const frames = Math.max(1, Math.round(seconds * SAMPLE_RATE));
  const channels = 2;
  const bytesPerSample = 2;
  const dataBytes = frames * channels * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataBytes);

  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  buffer.writeUInt32LE(SAMPLE_RATE * channels * bytesPerSample, 28);
  buffer.writeUInt16LE(channels * bytesPerSample, 32);
  buffer.writeUInt16LE(bytesPerSample * 8, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataBytes, 40);

  for (let i = 0; i < frames; i += 1) {
    const t = i / SAMPLE_RATE;
    const [left, right] = sampleFn(t, i);
    const l = Math.round(clampSample(left) * 32767);
    const r = Math.round(clampSample(right) * 32767);
    const offset = 44 + i * channels * bytesPerSample;
    buffer.writeInt16LE(l, offset);
    buffer.writeInt16LE(r, offset + 2);
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, buffer);
}

function drumVoice(t, rng, pattern, flavor = 0) {
  let value = 0;
  const sixteenth = BEAT_SECONDS / 4;
  const totalSteps = 64;
  for (let step = 0; step < totalSteps; step += 1) {
    const start = step * sixteenth;
    const kick = pattern.kicks.includes(step) ? 1 : 0;
    const snare = pattern.snares.includes(step) ? 1 : 0;
    const hat = pattern.hats.includes(step) ? 1 : 0;
    const perc = pattern.perc.includes(step) ? 1 : 0;
    if (kick) {
      value += 0.82 * sineSweep(t, start, 0.42, 110 + flavor * 3, 42 + flavor);
      value += 0.12 * Math.sin(TAU * 53 * (t - start)) * env(t, start, 0.18);
    }
    if (snare) {
      const e = pulse(t, start, 0.22);
      value += e * (rng() * 2 - 1) * 0.34;
      value += Math.sin(TAU * 180 * (t - start)) * e * 0.12;
    }
    if (hat) {
      const e = pulse(t, start, 0.055 + flavor * 0.003);
      value += e * (rng() * 2 - 1) * 0.16;
    }
    if (perc) {
      const e = pulse(t, start, 0.11);
      value += Math.sin(TAU * (420 + flavor * 17) * (t - start)) * e * 0.16;
    }
  }
  return value;
}

function bassVoice(t, flavor = 0) {
  const notes = [0, 0, 3, 5, 7, 5, 3, -2];
  const step = Math.floor(t / BEAT_SECONDS);
  const note = notes[(step + flavor) % notes.length];
  const local = t % BEAT_SECONDS;
  const freq = 55 * Math.pow(2, note / 12);
  const gate = local < BEAT_SECONDS * 0.76 ? Math.exp(-local / 0.9) : 0;
  return (
    Math.sin(TAU * freq * t) * 0.22 +
    Math.sin(TAU * freq * 2.01 * t) * 0.06
  ) * gate;
}

function chordVoice(t, flavor = 0) {
  const roots = [220, 196, 261.63, 174.61];
  const root = roots[Math.floor(t / BAR_SECONDS + flavor) % roots.length];
  const local = t % BAR_SECONDS;
  const swell = Math.min(1, local / 1.8) * Math.min(1, (BAR_SECONDS - local) / 1.2);
  const detune = 1 + flavor * 0.002;
  return (
    Math.sin(TAU * root * detune * t) +
    Math.sin(TAU * root * 1.25 * t) * 0.55 +
    Math.sin(TAU * root * 1.5 * t) * 0.42
  ) * 0.035 * swell;
}

function makeLoop(index) {
  const seed = 1000 + index * 97;
  const pattern = {
    kicks: [0, 10, 24, 32, 42, 48].filter((step) => (step + index) % 11 !== 0),
    snares: [16, 40, index % 3 === 0 ? 55 : 56],
    hats: Array.from({ length: 32 }, (_, i) => i * 2).filter((step) => (step + index) % 7 !== 0),
    perc: [6, 14, 27, 35, 51, 60].filter((step) => (step + index) % 5 !== 0)
  };
  writeStereoWav(
    path.join(PACK_DIR, "loops", `ra_loop_${String(index).padStart(2, "0")}_${LOOP_BPM}bpm.wav`),
    LOOP_SECONDS,
    (t, frame) => {
      const rng = mulberry32(seed + frame);
      const drum = drumVoice(t, rng, pattern, index % 7);
      const bass = bassVoice(t, index % 5);
      const chord = chordVoice(t, index % 4);
      const shimmer = Math.sin(TAU * (660 + index * 3) * t) * 0.025 * (0.5 + 0.5 * Math.sin(TAU * t / BAR_SECONDS));
      const pan = Math.sin(TAU * t / (LOOP_SECONDS / 2) + index) * 0.18;
      const mono = drum + bass + chord + shimmer;
      return [mono * (1 - pan), mono * (1 + pan)];
    }
  );
}

function makeHit(name, seconds, seed, sampleFn) {
  writeStereoWav(path.join(PACK_DIR, "drums", `${name}.wav`), seconds, (t, frame) => {
    const rng = mulberry32(seed + frame);
    const mono = sampleFn(t, rng);
    return [mono, mono];
  });
}

function makeTexture(index) {
  const seed = 5000 + index * 131;
  const seconds = 6;
  writeStereoWav(path.join(PACK_DIR, "textures", `ra_texture_${String(index).padStart(2, "0")}.wav`), seconds, (t, frame) => {
    const rng = mulberry32(seed + frame);
    const drift = 0.35 + 0.15 * Math.sin(TAU * t / seconds);
    const tone = Math.sin(TAU * (110 + index * 13) * t + Math.sin(TAU * 0.18 * t) * 2.2) * 0.18;
    const air = (rng() * 2 - 1) * 0.08 * drift;
    const pulseTone = Math.sin(TAU * (330 + index * 19) * t) * pulse(t, (index % 4) * 0.8, seconds - 0.4) * 0.04;
    return [(tone + air + pulseTone) * 0.45, (tone - air + pulseTone) * 0.45];
  });
}

function generate() {
  fs.mkdirSync(PACK_DIR, { recursive: true });
  for (const dir of ["drums", "loops", "textures"]) {
    fs.rmSync(path.join(PACK_DIR, dir), { recursive: true, force: true });
  }

  for (let i = 1; i <= 32; i += 1) makeLoop(i);

  makeHit("ra_kick_deep", 0.9, 2101, (t) => sineSweep(t, 0, 0.65, 118, 38) * 1.05);
  makeHit("ra_kick_soft", 0.7, 2102, (t) => sineSweep(t, 0, 0.52, 92, 45) * 0.78);
  makeHit("ra_snare_dust", 0.8, 2103, (t, rng) => (rng() * 2 - 1) * pulse(t, 0, 0.24) * 0.66 + Math.sin(TAU * 190 * t) * pulse(t, 0, 0.2) * 0.22);
  makeHit("ra_snare_tight", 0.6, 2104, (t, rng) => (rng() * 2 - 1) * pulse(t, 0, 0.16) * 0.5 + Math.sin(TAU * 230 * t) * pulse(t, 0, 0.14) * 0.2);
  makeHit("ra_hat_closed", 0.35, 2105, (t, rng) => (rng() * 2 - 1) * pulse(t, 0, 0.08) * 0.42);
  makeHit("ra_hat_open", 0.9, 2106, (t, rng) => (rng() * 2 - 1) * env(t, 0, 0.28) * 0.26);
  makeHit("ra_rim_wood", 0.4, 2107, (t) => Math.sin(TAU * 720 * t) * pulse(t, 0, 0.09) * 0.48);
  makeHit("ra_click_glass", 0.35, 2108, (t) => Math.sin(TAU * 1240 * t) * pulse(t, 0, 0.06) * 0.32);
  makeHit("ra_tom_low", 0.9, 2109, (t) => sineSweep(t, 0, 0.7, 82, 54) * 0.74);
  makeHit("ra_tom_high", 0.7, 2110, (t) => sineSweep(t, 0, 0.45, 148, 92) * 0.58);
  makeHit("ra_clap_room", 0.85, 2111, (t, rng) => {
    const flams = pulse(t, 0.01, 0.05) + pulse(t, 0.045, 0.06) + pulse(t, 0.09, 0.12);
    return (rng() * 2 - 1) * flams * 0.34;
  });
  makeHit("ra_sub_drop", 1.4, 2112, (t) => sineSweep(t, 0, 1.2, 70, 24) * 0.8);

  for (let i = 1; i <= 4; i += 1) makeTexture(i);
}

generate();
console.log(`Generated default sample pack in ${PACK_DIR}`);
