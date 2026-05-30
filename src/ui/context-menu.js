// ════════════════════════════════════════════════════════════════════════
// Lightweight right-click context menu. Pure view helper — caller passes an
// array of { label, action, disabled } or { separator: true } items.
// ════════════════════════════════════════════════════════════════════════

let activeContextMenu = null;

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
  menu.style.left = `${event.clientX}px`;
  menu.style.top = `${event.clientY}px`;
  document.body.appendChild(menu);
  activeContextMenu = menu;
  // Reposition if it overflows the viewport.
  const rect = menu.getBoundingClientRect();
  if (rect.right > window.innerWidth) menu.style.left = `${window.innerWidth - rect.width - 8}px`;
  if (rect.bottom > window.innerHeight) menu.style.top = `${window.innerHeight - rect.height - 8}px`;
  // Defer so the opening click doesn't immediately close it.
  setTimeout(() => {
    document.addEventListener("click", closeContextMenu);
    document.addEventListener("contextmenu", closeContextMenu);
    window.addEventListener("blur", closeContextMenu);
  }, 0);
}
