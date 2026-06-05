import { SECTION_BARS, normalizeSectionBars, phraseBeatModeForBar, shiftedAccentStepsForBar } from "./rhythm-config.js";

export function arrangementHitScale(hit, step, phraseBar) {
  if (phraseBar >= 8) return 1;
  if (phraseBar < 2) {
    if (hit === "kick") return step === 0 ? 0.76 : 0;
    if (hit === "hat") return [2, 8, 14].includes(step) ? 0.72 : 0;
    if (hit === "rim") return step === 15 ? 0.42 : 0;
    return 0;
  }
  if (phraseBar < 4) {
    if (hit === "kick") return [0, 10].includes(step) ? 0.86 : 0;
    if (hit === "hat") return [2, 5, 8, 11, 14].includes(step) ? 0.82 : 0;
    if (hit === "rim") return [7, 15].includes(step) ? 0.6 : 0;
    return 0;
  }
  if (phraseBar < 6) {
    if (hit === "snare" && step === 4) return 0;
    if (hit === "snare" && step === 12) return 0.72;
    if (hit === "rim") return 0.78;
    return 0.92;
  }
  if (hit === "snare" && step === 4) return 0.82;
  return 1;
}

export function rhythmicShiftScale(hit, step, phraseBar, sectionBars = SECTION_BARS) {
  const safeSectionBars = normalizeSectionBars(sectionBars);
  const mode = phraseBeatModeForBar(phraseBar, safeSectionBars);
  let scale = 1;
  if (mode === "twoFour") {
    if (hit === "kick" && (step === 0 || step === 8)) scale *= 0.9;
    if ((hit === "snare" || hit === "rim") && (step === 4 || step === 12)) scale *= 1.05;
    if (hit === "hat" && (step === 6 || step === 14)) scale *= 1.02;
  } else if (mode === "oneThree") {
    if (hit === "kick" && (step === 0 || step === 8)) scale *= 1.05;
    if (hit === "snare" && (step === 4 || step === 12)) scale *= 0.94;
    if (hit === "rim" && (step === 7 || step === 15)) scale *= 1.04;
  } else if (mode === "threeOnly") {
    if (hit === "kick" && step === 0) scale *= 0.84;
    if (hit === "kick" && step === 8) scale *= 1.06;
    if (hit === "snare" && step !== 8) scale *= 0.9;
    if ((hit === "snare" || hit === "rim") && step === 8) scale *= 1.06;
    if (hit === "hat" && step >= 8) scale *= 1.02;
  } else if (mode === "oneTwo") {
    if (hit === "kick" && (step === 0 || step === 4)) scale *= 1.05;
    if (hit === "snare" && step === 4) scale *= 1.04;
    if (hit === "snare" && step === 12) scale *= 0.94;
    if (hit === "rim" && (step === 3 || step === 11)) scale *= 1.03;
  }
  const localBuild = phraseBar % safeSectionBars;
  if (localBuild >= Math.max(0, safeSectionBars - 2) && hit === "hat" && step % 2 === 1) scale *= 1.02;
  if (localBuild === safeSectionBars - 1 && step >= 12 && hit !== "kick") scale *= 1.03;
  return scale;
}

export function shiftedAccentSteps(phraseBar, sectionBars = SECTION_BARS) {
  return shiftedAccentStepsForBar(phraseBar, sectionBars);
}

export function phraseVelocityScale(hit, step, phraseBar) {
  let scale = 1;
  if (phraseBar < 4) {
    if (hit === "kick") scale *= 0.68;
    if (hit === "snare") scale *= 0.52;
    if (hit === "hat") scale *= 0.8;
    if (hit === "rim") scale *= 0.45;
  } else if (phraseBar < 8) {
    if (hit === "hat") scale *= 0.9;
    if (hit === "rim") scale *= 0.72;
  } else if (phraseBar >= 16 && phraseBar < 24) {
    scale *= hit === "hat" ? 0.96 : 0.98;
  } else if (phraseBar >= 24 && phraseBar < 28) {
    scale *= 0.92;
  } else if (phraseBar >= 28) {
    scale *= hit === "snare" ? 1.02 : 0.98;
  }
  if ((phraseBar === 7 || phraseBar === 15 || phraseBar === 23 || phraseBar === 31) && step >= 12) {
    scale *= hit === "hat" ? 0.74 : 0.66;
  }
  return scale;
}
