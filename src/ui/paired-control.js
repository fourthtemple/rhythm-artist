// Small, dependency-free helpers for wiring paired range/number/output
// controls in the inspector. These are pure DOM utilities with no knowledge of
// editor state, so they live here to keep the main editor focused on behavior.

// Tracks which inputs are currently being actively dragged/typed by the user.
// setPairedControl skips writing to any input that is "locked" to avoid
// fighting the user's gesture mid-drag.
const lockedInputs = new WeakSet();

/**
 * Register a range or number input so that programmatic updates from
 * setPairedControl are suppressed while the user is actively manipulating it.
 * Call once per input element after the DOM is ready.
 */
export function registerInteractiveInput(input) {
  if (!input) return;
  const lock = () => lockedInputs.add(input);
  const unlock = () => lockedInputs.delete(input);
  input.addEventListener("pointerdown", lock);
  input.addEventListener("focus", lock);
  input.addEventListener("pointerup", unlock);
  input.addEventListener("pointercancel", unlock);
  input.addEventListener("blur", unlock);
}

/**
 * Mirror a single value across a paired range input, number input, and a text
 * output element, formatting the output via `formatter`.
 * Skips writing to any input currently locked by the user.
 */
export function setPairedControl(range, numberInput, output, value, formatter = (next) => String(next)) {
  const stringValue = String(value);
  if (!lockedInputs.has(range)) {
    range.value = stringValue;
  }
  range.__syncRotaryControl?.();
  if (!lockedInputs.has(numberInput)) {
    numberInput.value = stringValue;
  }
  output.textContent = formatter(value);
}

/**
 * Wire a number input so that `commit` runs on input, change, and Enter, while
 * ignoring transient empty values during typing.
 */
export function wireNumberControl(input, commit) {
  input.addEventListener("input", () => {
    if (input.value === "") return;
    commit(input.value);
  });
  input.addEventListener("change", () => commit(input.value));
  input.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    commit(input.value);
    input.blur();
  });
}
