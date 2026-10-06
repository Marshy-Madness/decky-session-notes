// Jumping to a Tome on the Desk (the Tome list's "Go to it").

const tomeElements = new Map<string, HTMLElement>();

export function registerTomeElement(id: string, el: HTMLElement | null) {
  if (el) tomeElements.set(id, el);
  else tomeElements.delete(id);
}

/** Scrolls a Tome into view and gives it the focus. */
export function jumpToTome(id: string) {
  // Give a just-added or just-unfolded Tome a frame to draw first.
  setTimeout(() => {
    const el = tomeElements.get(id);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    (el.querySelector("[data-tome-head]") as HTMLElement | null)?.focus?.();
  }, 80);
}
