/**
 * Hit-data access layer.
 *
 * All reads and writes to the pattern bar hit entries go through here.
 * No DOM touches — pure state + config mutations only.
 *
 * @param {object} deps - injected dependencies (see factory call in main file)
 */
export function createHitData(deps) {
  const {
    state,
    PATTERN_ROW_IDS,
    ROW_LABELS,
    clamp,
    normalizeStepOptions,
    readStoredHit,
    commitHitEntry,
    generatedSynthEventsForStep,
    applyConfig,
    pushEditHistory = null
  } = deps;

  function patternBar(index = state.activeBar) {
    return state.config.patterns.jazz.bars[index];
  }

  function generatedEventsAtStep(step, barIndex = state.activeBar, pressure = state.intensity) {
    return generatedSynthEventsForStep({
      phraseBar: barIndex,
      step,
      pressure,
      config: state.config
    });
  }

  function getGeneratedHitData(hit, step, barIndex = state.activeBar, pressure = state.intensity) {
    const events = generatedEventsAtStep(step, barIndex, pressure).filter((e) => e.track === hit);
    if (!events.length) {
      return { step, velocity: 0, options: normalizeStepOptions(), generated: true, label: "" };
    }
    const strongest = events.reduce((best, e) => (e.velocity > best.velocity ? e : best), events[0]);
    return {
      step,
      velocity: clamp(strongest.velocity, 0, 1, 0),
      options: normalizeStepOptions({ pitch: strongest.pitch || 0 }),
      generated: true,
      label: strongest.label || hit
    };
  }

  function getHitData(hit, step, barIndex = state.activeBar) {
    const isGeneratedRow = !PATTERN_ROW_IDS.has(hit);
    const existing = readStoredHit(state.config.patterns.jazz.bars[barIndex], hit, step);
    if (existing) {
      return {
        ...existing,
        generated: isGeneratedRow,
        label: isGeneratedRow ? ROW_LABELS[hit] || hit : ""
      };
    }
    if (isGeneratedRow && state.config.generatedRowsEditable < 0.5) {
      return getGeneratedHitData(hit, step, barIndex);
    }
    return { step, velocity: 0, options: normalizeStepOptions(), generated: isGeneratedRow, label: "" };
  }

  function setHitData(hit, step, patch, barIndex = state.activeBar) {
    const bar = state.config.patterns.jazz.bars[barIndex];
    if (!bar) return;
    const current = getHitData(hit, step, barIndex);
    const merged = {
      ...current,
      velocity: patch.velocity ?? current.velocity,
      options: normalizeStepOptions({ ...current.options, ...(patch.options || {}) })
    };
    merged.step = step;
    merged.velocity = clamp(merged.velocity, 0, 1, 0);
    const historyField = patch.options
      ? Object.keys(patch.options).sort().join(",") || "options"
      : "velocity";
    const currentComparable = {
      velocity: current.velocity <= 0.005 ? 0 : Number(current.velocity.toFixed(4)),
      options: normalizeStepOptions(current.options)
    };
    const mergedComparable = {
      velocity: merged.velocity <= 0.005 ? 0 : Number(merged.velocity.toFixed(4)),
      options: normalizeStepOptions(merged.options)
    };
    if (JSON.stringify(currentComparable) === JSON.stringify(mergedComparable)) return;
    pushEditHistory?.({
      label: `${hit} ${historyField}`,
      groupKey: `hit:${barIndex}:${hit}:${step}:${historyField}`
    });
    commitHitEntry(bar, hit, step, merged.velocity <= 0.005 ? null : merged);
    applyConfig();
  }

  function setHitVelocity(hit, step, velocity, barIndex = state.activeBar) {
    setHitData(hit, step, { velocity: Number(velocity) }, barIndex);
  }

  function getHitVelocity(hit, step, barIndex = state.activeBar) {
    return getHitData(hit, step, barIndex).velocity || 0;
  }

  return { patternBar, getHitData, setHitData, setHitVelocity, getHitVelocity, getGeneratedHitData, generatedEventsAtStep };
}
