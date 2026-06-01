// Step-grid and tab-strip builder controller.
//
// Owns the three DOM-build functions (buildStepGrid, buildLoopTabs,
// buildBarTabs) and the render-pass that syncs class state back onto existing
// elements (renderStepGrid). All event listeners attached to step-buttons and
// tab buttons are wired here too.
//
// It reaches the rest of the editor through the shared `state` object and a
// set of injected primitives. The editor keeps thin hoisted wrappers so
// existing call sites are unchanged.

/**
 * @param {object} deps
 * @param {object}   deps.state
 * @param {Element}  deps.stepGrid
 * @param {Element}  deps.barTabs
 * @param {Element}  deps.loopTabs
 * @param {Element|null} deps.loopCountInput
 * @param {Element}  deps.status
 * @param {number}   deps.LOOP_BAR_COUNT
 * @param {number}   deps.MAX_LOOP_COUNT
 * @param {Record<string,number>} deps.DEFAULT_VELOCITY
 * @param {() => Array<{id:string,label:string,type:string}>} deps.gridRows
 * @param {() => number} deps.loopCount
 * @param {(barIndex?:number) => number} deps.localBarIndex
 * @param {(loopIndex?:number) => number} deps.loopStartBar
 * @param {() => number} deps.activeLoopLength
 * @param {(start?:number, length?:number) => number} deps.clampLoopStart
 * @param {() => void} deps.syncActiveLoopToBar
 * @param {() => void} deps.clampActiveBar
 * @param {() => any}  deps.previewConfig
 * @param {() => void} deps.refreshLoopBarButton
 * @param {() => void} deps.clearPlayhead
 * @param {() => void} deps.renderSoloButtons
 * @param {(hit:string) => void} deps.toggleSolo
 * @param {(hit:string, event?:object) => void} deps.selectRowWithModifiers
 * @param {(hit:string) => void} deps.selectRowToggle
 * @param {(hit:string, step:number, mode?:string, barIndex?:number, pressure?:number, generated?:boolean) => void} deps.selectStep
 * @param {(hit:string, step:number, barIndex?:number) => any} deps.getHitData
 * @param {(hit:string, step:number, velocity:number, barIndex?:number) => void} deps.setHitVelocity
 * @param {(hit:string, step:number, options:any) => number} deps.displayedPitchForHit
 * @param {(pitch:number) => string} deps.formatPitch
 * @param {(pitch:number) => string} deps.noteNameForPitch
 * @param {(index:number, event:MouseEvent) => void} deps.toggleLoopMultiSelect
 * @param {(index:number, event:MouseEvent) => void} deps.toggleBarMultiSelect
 * @param {(event:MouseEvent, index:number) => void} deps.openLoopContextMenu
 * @param {(event:MouseEvent, index:number) => void} deps.openBarContextMenu
 * @param {(event:MouseEvent, hit:string) => void} deps.openTrackContextMenu
 * @param {() => void} deps.resetSelectedPanel
 * @param {() => void} [deps.onAfterBuild] Called after buildStepGrid rebuilds the DOM (e.g. to re-append loop lanes).
 */
export function createStepGridBuilder(deps) {
  const {
    state,
    stepGrid,
    barTabs,
    loopTabs,
    loopCountInput,
    status,
    LOOP_BAR_COUNT,
    MAX_LOOP_COUNT,
    DEFAULT_VELOCITY,
    gridRows,
    loopCount,
    localBarIndex,
    loopStartBar,
    activeLoopLength,
    clampLoopStart,
    syncActiveLoopToBar,
    clampActiveBar,
    previewConfig,
    refreshLoopBarButton,
    clearPlayhead,
    renderSoloButtons,
    toggleSolo,
    selectRowWithModifiers,
    selectRowToggle,
    selectStep,
    getHitData,
    setHitVelocity,
    displayedPitchForHit,
    formatPitch,
    noteNameForPitch,
    toggleLoopMultiSelect,
    toggleBarMultiSelect,
    openLoopContextMenu,
    openBarContextMenu,
    openTrackContextMenu,
    resetSelectedPanel
  } = deps;
  const onAfterBuild = deps.onAfterBuild ?? (() => {});

  function buildStepGrid() {
    const segments = state.segmentsCount ?? 2;
    const stepsPerRow = segments * 16;
    stepGrid.style.setProperty("--visible-steps", String(stepsPerRow));
    stepGrid.innerHTML = "";

    // Header row: "Track" corner + one header cell per step (global numbering).
    // First step of each segment gets a "is-bar-start" marker and a data-bar
    // attribute so renderStepGrid can update the bar number label.
    stepGrid.appendChild(Object.assign(document.createElement("div"), {
      className: "step-header step-header--corner",
      textContent: "Track"
    }));
    for (let seg = 0; seg < segments; seg += 1) {
      for (let step = 0; step < 16; step += 1) {
        const header = document.createElement("div");
        header.className = "step-header step-header--step";
        const globalStep = seg * 16 + step + 1;
        header.textContent = String(globalStep).padStart(2, "0");
        if (step === 0) {
          header.classList.add("is-bar-start");
          header.dataset.barSeg = String(seg); // used by renderStepGrid
          // bar label span — text updated by renderStepGrid
          const barSpan = document.createElement("span");
          barSpan.className = "step-header__bar-label";
          barSpan.textContent = `Bar ${state.activeBar + seg + 1}`;
          header.prepend(barSpan);
        }
        stepGrid.appendChild(header);
      }
    }

    gridRows().forEach(({ id: hit, label, type }) => {
      const rowLabel = document.createElement("div");
      rowLabel.className = `track-label ${type === "generated" ? "is-generated" : ""}`;
      rowLabel.dataset.hit = hit;
      rowLabel.dataset.type = type;
      rowLabel.tabIndex = 0;
      rowLabel.title = `Select ${label} row · Shift-click for a range · ⌘/Ctrl-click to toggle`;
      const rowText = document.createElement("span");
      rowText.textContent = label;
      rowText.title = label;
      const soloButton = document.createElement("button");
      soloButton.type = "button";
      soloButton.className = "solo-button";
      soloButton.dataset.soloTrack = hit;
      soloButton.textContent = "S";
      soloButton.title = `Solo ${label}`;
      soloButton.addEventListener("click", (event) => {
        event.stopPropagation();
        toggleSolo(hit);
      });
      rowLabel.addEventListener("click", (event) => {
        selectRowWithModifiers(hit, event);
        renderStepGrid();
      });
      rowLabel.addEventListener("contextmenu", (event) => {
        if (!state.selectedTracks.includes(hit)) {
          selectRowWithModifiers(hit, {});
          renderStepGrid();
        }
        openTrackContextMenu(event, hit);
      });
      rowLabel.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        selectRowToggle(hit);
        renderStepGrid();
      });
      rowLabel.append(rowText, soloButton);
      stepGrid.appendChild(rowLabel);

      for (let seg = 0; seg < segments; seg += 1) {
        for (let step = 0; step < 16; step += 1) {
          const button = document.createElement("button");
          button.type = "button";
          button.className = `step-button ${type === "generated" ? "is-generated-step" : ""}`;
          if (step === 0 && seg > 0) button.classList.add("is-bar-start");
          button.dataset.hit = hit;
          button.dataset.type = type;
          button.dataset.step = String(step);
          button.dataset.seg = String(seg);
          button.dataset.beat = step % 4 === 0 ? "1" : "0";
          button.setAttribute("aria-label", `${label} bar+${seg} step ${step + 1}`);
          button.addEventListener("mousedown", (event) => {
            event.preventDefault();
          });
          button.addEventListener("click", () => {
            const barIndex = state.activeBar + seg;
            const scrollLeft = stepGrid.scrollLeft;
            const scrollTop = stepGrid.scrollTop;
            if (state.selected
              && state.selected.hit === hit
              && state.selected.step === step
              && state.selected.bar === barIndex
              && state.selected.mode === "step") {
              resetSelectedPanel();
              renderStepGrid();
              stepGrid.scrollLeft = scrollLeft;
              stepGrid.scrollTop = scrollTop;
              return;
            }
            const current = getHitData(hit, step, barIndex);
            if (current.velocity <= 0.005) {
              setHitVelocity(hit, step, DEFAULT_VELOCITY[hit] ?? 0.5, barIndex);
            }
            selectStep(hit, step, "step", barIndex, state.intensity, type === "generated");
            renderStepGrid();
            stepGrid.scrollLeft = scrollLeft;
            stepGrid.scrollTop = scrollTop;
          });
          stepGrid.appendChild(button);
        }
      }
    });
    renderStepGrid();
    onAfterBuild();
  }

  function buildLoopTabs() {
    syncActiveLoopToBar();
    if (loopCountInput) {
      loopCountInput.max = String(MAX_LOOP_COUNT);
      loopCountInput.value = String(loopCount());
    }
    loopTabs.innerHTML = "";
    for (let index = 0; index < loopCount(); index += 1) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.loop = String(index);
      button.textContent = `Verse ${index + 1}`;
      button.title = `Bars ${index * LOOP_BAR_COUNT + 1}-${(index + 1) * LOOP_BAR_COUNT} · Shift-click to multi-select · Right-click to copy/paste`;
      button.classList.toggle("is-active", index === state.activeLoopIndex);
      button.classList.toggle("is-multi-selected", state.selectedLoops.includes(index));
      button.addEventListener("click", (event) => {
        if (event.shiftKey || event.metaKey || event.ctrlKey) {
          toggleLoopMultiSelect(index, event);
          return;
        }
        state.selectedLoops = [];
        state.loopAnchor = index;
        const local = localBarIndex(state.activeBar);
        state.activeLoopIndex = index;
        state.activeBar = loopStartBar(index) + local;
        clampActiveBar();
        if (activeLoopLength()) {
          state.loopBarIndex = clampLoopStart(state.activeBar, activeLoopLength());
          state.engine.setConfig(previewConfig());
          state.engine.seekToPhraseBar(state.activeBar, 0);
          state.playheadStep = 0;
          refreshLoopBarButton();
        } else if (state.playing) {
          state.engine.seekToPhraseBar(state.activeBar, 0);
          state.playheadStep = 0;
        }
        if (state.selected) {
          selectStep(state.selected.hit, state.selected.step, state.selected.mode || "step");
        }
        buildLoopTabs();
        buildBarTabs();
        renderStepGrid();
        status.textContent = state.playing || activeLoopLength()
          ? `Jumped to loop ${index + 1}`
          : `Editing loop ${index + 1}`;
      });
      button.addEventListener("contextmenu", (event) => {
        if (!state.selectedLoops.includes(index)) {
          state.selectedLoops = [index];
          state.loopAnchor = index;
          buildLoopTabs();
        }
        openLoopContextMenu(event, index);
      });
      loopTabs.appendChild(button);
    }
  }

  function buildBarTabs() {
    syncActiveLoopToBar();
    barTabs.innerHTML = "";
    for (let localIndex = 0; localIndex < LOOP_BAR_COUNT; localIndex += 1) {
      const index = loopStartBar() + localIndex;
      if (!state.config.patterns.jazz.bars[index]) continue;
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.bar = String(index);
      button.dataset.localBar = String(localIndex);
      button.dataset.section = String(Math.floor(localIndex / 8) + 1);
      button.textContent = String(localIndex + 1).padStart(2, "0");
      button.title = `Loop ${state.activeLoopIndex + 1}, bar ${localIndex + 1} (song bar ${index + 1}) · Shift-click to multi-select · Right-click to copy/paste`;
      button.classList.toggle("is-multi-selected", state.selectedBars.includes(index));
      button.addEventListener("click", (event) => {
        if (event.shiftKey || event.metaKey || event.ctrlKey) {
          toggleBarMultiSelect(index, event);
          return;
        }
        state.selectedBars = [];
        state.barAnchor = index;
        // Snap to segment boundary so the grid always shows a full segment window
        const segments = state.segmentsCount ?? 1;
        state.activeBar = Math.floor(index / segments) * segments;
        syncActiveLoopToBar();
        if (activeLoopLength()) {
          state.loopBarIndex = clampLoopStart(index, activeLoopLength());
          state.engine.setConfig(previewConfig());
          state.engine.seekToPhraseBar(index, 0);
          state.playheadStep = 0;
          refreshLoopBarButton();
        } else if (state.playing) {
          state.engine.seekToPhraseBar(index, 0);
          state.playheadStep = 0;
          status.textContent = `Jumped to bar ${String(index + 1).padStart(2, "0")}`;
        }
        if (state.selected) {
          selectStep(state.selected.hit, state.selected.step, state.selected.mode || "step");
        }
        clearPlayhead();
        buildBarTabs();
        renderStepGrid();
      });
      button.addEventListener("contextmenu", (event) => {
        if (!state.selectedBars.includes(index)) {
          state.selectedBars = [index];
          state.barAnchor = index;
          buildBarTabs();
        }
        openBarContextMenu(event, index);
      });
      barTabs.appendChild(button);
    }
  }

  function renderStepGrid() {
    syncActiveLoopToBar();
    // Refresh bar-start step headers to show current bar numbers
    stepGrid.querySelectorAll(".step-header--step[data-bar-seg]").forEach((header) => {
      const seg = Number(header.dataset.barSeg);
      const barLabel = header.querySelector(".step-header__bar-label");
      if (barLabel) barLabel.textContent = `Bar ${state.activeBar + seg + 1}`;
    });
    // Don't overwrite the loop-count input while user may be editing it.
    loopTabs.querySelectorAll("button").forEach((button) => {
      button.classList.toggle("is-active", Number(button.dataset.loop) === state.activeLoopIndex);
    });
    document.querySelectorAll(".bar-tabs button").forEach((button) => {
      const barIndex = Number(button.dataset.bar);
      const segments = state.segmentsCount ?? 1;
      const inWindow = barIndex >= state.activeBar && barIndex < state.activeBar + segments;
      button.classList.toggle("is-active", inWindow);
      button.classList.toggle("is-section-start", Number(button.dataset.localBar) % 8 === 0);
    });
    stepGrid.querySelectorAll(".step-button").forEach((button) => {
      const hit = button.dataset.hit;
      const step = Number(button.dataset.step);
      const seg = Number(button.dataset.seg ?? 0);
      const barIndex = state.activeBar + seg;
      const hitData = getHitData(hit, step, barIndex);
      const velocity = hitData.velocity;
      const isGeneratedRow = button.dataset.type === "generated";
      button.classList.toggle("is-on", velocity > 0);
      button.classList.toggle("is-generated-on", isGeneratedRow && hitData.generated && velocity > 0);
      button.classList.toggle("is-selected",
        state.selected?.hit === hit && state.selected?.step === step && (state.selected?.bar ?? state.activeBar) === barIndex);
      button.classList.toggle("is-row-selected", state.selected?.hit === hit && state.selected?.mode === "row");
      button.style.setProperty("--level", String(Math.min(1, velocity / 0.9)));
      const displayedPitch = displayedPitchForHit(hit, step, hitData.options, barIndex);
      button.dataset.note = "";
      const pitchLabel = `pitch ${formatPitch(displayedPitch)}`;
      button.title = `${hit} bar ${barIndex + 1} step ${step + 1}: ${velocity.toFixed(2)} ${pitchLabel} offset ${hitData.options.offsetMs}ms`;
    });
    stepGrid.querySelectorAll(".track-label").forEach((label) => {
      const isPrimary = state.selected?.hit === label.dataset.hit && state.selected?.mode === "row";
      const inSelection = state.selectedTracks.includes(label.dataset.hit);
      label.classList.toggle("is-selected-row", isPrimary || inSelection);
    });
    renderSoloButtons();
  }

  return { buildStepGrid, buildLoopTabs, buildBarTabs, renderStepGrid };
}
