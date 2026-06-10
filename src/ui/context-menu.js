// ════════════════════════════════════════════════════════════════════════
// Lightweight right-click context menu. Pure view helper — caller passes an
// array of { label, action, disabled } or { separator: true } items.
// ════════════════════════════════════════════════════════════════════════

let activeContextMenu = null;
const CONTEXT_MENU_MARGIN = 8;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

/**
 * Position a context menu so it remains fully usable inside the viewport.
 * The menu must already be attached to the document so it can be measured.
 * @param {HTMLElement} menu
 * @param {number} x
 * @param {number} y
 */
export function positionContextMenu(menu, x, y) {
  const viewportWidth = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0);
  const viewportHeight = Math.max(document.documentElement.clientHeight || 0, window.innerHeight || 0);
  const maxWidth = Math.max(160, viewportWidth - CONTEXT_MENU_MARGIN * 2);
  const maxHeight = Math.max(96, viewportHeight - CONTEXT_MENU_MARGIN * 2);

  menu.style.maxWidth = `${maxWidth}px`;
  menu.style.maxHeight = `${maxHeight}px`;
  menu.style.overflowY = "auto";
  menu.style.left = `${Math.round(x)}px`;
  menu.style.top = `${Math.round(y)}px`;

  const rect = menu.getBoundingClientRect();
  const maxLeft = Math.max(CONTEXT_MENU_MARGIN, viewportWidth - rect.width - CONTEXT_MENU_MARGIN);
  const maxTop = Math.max(CONTEXT_MENU_MARGIN, viewportHeight - rect.height - CONTEXT_MENU_MARGIN);
  const nextLeft = clamp(x, CONTEXT_MENU_MARGIN, maxLeft);
  const nextTop = clamp(y, CONTEXT_MENU_MARGIN, maxTop);

  menu.style.left = `${Math.round(nextLeft)}px`;
  menu.style.top = `${Math.round(nextTop)}px`;
}

/** Close any open context menu and detach its dismiss listeners. */
export function closeContextMenu() {
  if (activeContextMenu) {
    activeContextMenu.remove();
    activeContextMenu = null;
    document.removeEventListener("click", closeContextMenu);
    document.removeEventListener("contextmenu", closeContextMenu);
    window.removeEventListener("blur", closeContextMenu);
  }
}

/**
 * Show a context menu at the event position.
 * @param {MouseEvent} event
 * @param {Array<{ label?: string, action?: () => void, disabled?: boolean, separator?: boolean }>} items
 */
export function showContextMenu(event, items) {
  event.preventDefault();
  event.stopPropagation();
  closeContextMenu();
  const menu = document.createElement("div");
  menu.className = "context-menu";
  items.forEach((item) => {
    if (item.separator) {
      const sep = document.createElement("div");
      sep.className = "context-menu-sep";
      menu.appendChild(sep);
      return;
    }
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "context-menu-item";
    btn.textContent = item.label;
    btn.disabled = Boolean(item.disabled);
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      closeContextMenu();
      item.action?.();
    });
    menu.appendChild(btn);
  });
  document.body.appendChild(menu);
  activeContextMenu = menu;
  positionContextMenu(menu, event.clientX, event.clientY);
  // Defer so the opening click doesn't immediately close it.
  setTimeout(() => {
    document.addEventListener("click", closeContextMenu);
    document.addEventListener("contextmenu", closeContextMenu);
    window.addEventListener("blur", closeContextMenu);
  }, 0);
}
