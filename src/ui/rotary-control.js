const enhancedInputs = new WeakSet();

const clampNumber = (value, min, max, fallback = 0) => {
  const number = Number(value);
  return Math.max(min, Math.min(max, Number.isFinite(number) ? number : fallback));
};

const decimalPlaces = (value) => {
  const text = String(value);
  const match = text.match(/(?:\.(\d+))?(?:e-(\d+))?$/i);
  if (!match) return 0;
  return Math.max(match[1]?.length || 0, Number(match[2] || 0));
};

function rangeMeta(input) {
  const min = Number(input.min || 0);
  const max = Number(input.max || 1);
  const rawStep = input.step && input.step !== "any" ? Number(input.step) : 0;
  const step = Number.isFinite(rawStep) && rawStep > 0 ? rawStep : Math.max((max - min) / 100, 0.01);
  return { min, max, step, precision: decimalPlaces(step) };
}

function snapToStep(value, input) {
  const { min, max, step, precision } = rangeMeta(input);
  const snapped = Math.round((clampNumber(value, min, max, min) - min) / step) * step + min;
  return Number(clampNumber(snapped, min, max, min).toFixed(Math.min(6, precision + 2)));
}

function labelFor(input) {
  const label = input.closest("label");
  const text = label?.querySelector("span")?.textContent?.trim();
  return text || input.getAttribute("aria-label") || input.dataset.config || "Value";
}

function updateKnob(input, knob) {
  const { min, max } = rangeMeta(input);
  const value = clampNumber(input.value, min, max, min);
  const ratio = max > min ? (value - min) / (max - min) : 0;
  const angle = -135 + (ratio * 270);
  knob.style.setProperty("--rotary-angle", `${angle}deg`);
  knob.style.setProperty("--rotary-fill", `${ratio * 270}deg`);
  knob.setAttribute("aria-valuemin", String(min));
  knob.setAttribute("aria-valuemax", String(max));
  knob.setAttribute("aria-valuenow", String(value));
  knob.setAttribute("aria-valuetext", String(input.value));
  knob.disabled = input.disabled;
}

function shouldEnhanceInput(input) {
  if (input.closest(".pitch-control")) return false;
  return Boolean(
    input.closest(".control-panel")
    || input.closest(".selected-step")
    || input.closest(".track-inspector-extra-config")
  );
}

function emitValue(input, knob, value, emitChange = false) {
  input.value = String(snapToStep(value, input));
  updateKnob(input, knob);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  if (emitChange) input.dispatchEvent(new Event("change", { bubbles: true }));
  queueMicrotask(() => updateKnob(input, knob));
}

function enhanceInput(input) {
  if (enhancedInputs.has(input) || !shouldEnhanceInput(input)) return;
  enhancedInputs.add(input);
  input.classList.add("rotary-source");

  const label = input.closest("label");
  label?.classList.add("has-rotary");
  if (label?.querySelector(".selected-number")) label.classList.add("has-rotary-number");

  const knob = document.createElement("button");
  knob.type = "button";
  knob.className = "rotary-control";
  knob.setAttribute("role", "slider");
  knob.setAttribute("aria-label", labelFor(input));
  knob.title = `${labelFor(input)}: drag, scroll, or use arrow keys`;
  knob.innerHTML = '<span class="rotary-control__cap"></span><span class="rotary-control__pointer"></span>';
  input.before(knob);
  input.__rotaryKnob = knob;
  input.__syncRotaryControl = () => updateKnob(input, knob);
  updateKnob(input, knob);

  input.addEventListener("input", () => updateKnob(input, knob));
  input.addEventListener("change", () => updateKnob(input, knob));

  let dragStart = null;
  knob.addEventListener("pointerdown", (event) => {
    if (input.disabled) return;
    event.preventDefault();
    knob.setPointerCapture?.(event.pointerId);
    knob.classList.add("is-dragging");
    dragStart = {
      x: event.clientX,
      y: event.clientY,
      value: Number(input.value)
    };
  });

  knob.addEventListener("pointermove", (event) => {
    if (!dragStart) return;
    const { min, max } = rangeMeta(input);
    const travel = event.shiftKey ? 420 : 150;
    const delta = (dragStart.y - event.clientY) + ((event.clientX - dragStart.x) * 0.35);
    emitValue(input, knob, dragStart.value + ((delta / travel) * (max - min)));
  });

  const finishDrag = (event) => {
    if (!dragStart) return;
    dragStart = null;
    knob.classList.remove("is-dragging");
    knob.releasePointerCapture?.(event.pointerId);
    input.dispatchEvent(new Event("change", { bubbles: true }));
    queueMicrotask(() => updateKnob(input, knob));
  };
  knob.addEventListener("pointerup", finishDrag);
  knob.addEventListener("pointercancel", finishDrag);

  knob.addEventListener("wheel", (event) => {
    if (input.disabled) return;
    event.preventDefault();
    const { step } = rangeMeta(input);
    const multiplier = event.shiftKey ? 0.25 : 1;
    emitValue(input, knob, Number(input.value) + (event.deltaY < 0 ? step : -step) * multiplier, true);
  }, { passive: false });

  knob.addEventListener("keydown", (event) => {
    if (input.disabled) return;
    const { min, max, step } = rangeMeta(input);
    let next = Number(input.value);
    if (event.key === "ArrowUp" || event.key === "ArrowRight") next += step;
    else if (event.key === "ArrowDown" || event.key === "ArrowLeft") next -= step;
    else if (event.key === "PageUp") next += step * 10;
    else if (event.key === "PageDown") next -= step * 10;
    else if (event.key === "Home") next = min;
    else if (event.key === "End") next = max;
    else return;
    event.preventDefault();
    emitValue(input, knob, next, true);
  });
}

function rangeInputs(root) {
  const inputs = [];
  if (root instanceof HTMLInputElement && root.matches('input[type="range"]')) inputs.push(root);
  if (root.querySelectorAll) inputs.push(...root.querySelectorAll('input[type="range"]'));
  return inputs;
}

export function enhanceRotaryControls(root = document) {
  rangeInputs(root).forEach(enhanceInput);
}

export function syncRotaryControls(root = document) {
  enhanceRotaryControls(root);
  rangeInputs(root).forEach((input) => {
    const knob = input.__rotaryKnob;
    if (knob) updateKnob(input, knob);
  });
}

export function installRotaryControls(root = document) {
  enhanceRotaryControls(root);
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        if (node instanceof Element) enhanceRotaryControls(node);
      });
    });
  });
  observer.observe(root, { childList: true, subtree: true });
  return observer;
}
