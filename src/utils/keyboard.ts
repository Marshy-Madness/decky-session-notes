import { mainWindow } from "../steamWindow";

// Steam's own TextFields bring up the on-screen keyboard themselves; a plain <textarea> doesn't, so on a Deck
// without a physical keyboard there was no way to type into one. This focuses the box and opens Steam's
// keyboard, whose keys go to whatever has focus (the box).

const refs = new WeakMap<object, any>();

export function typeInto(el: HTMLTextAreaElement | HTMLInputElement | null | undefined) {
  if (!el) return;
  el.focus();
  try {
    const vkm = mainWindow()?.VirtualKeyboardManager;
    if (!vkm?.CreateVirtualKeyboardRef) return;
    let ref = refs.get(el);
    if (!ref) {
      ref = vkm.CreateVirtualKeyboardRef({ BIsElementValidForInput: () => el.isConnected });
      refs.set(el, ref);
    }
    ref.ShowVirtualKeyboard?.();
  } catch (e) {
    console.warn("Desk of Madness: no keyboard", e);
  }
}

