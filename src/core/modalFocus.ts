import { useEffect } from 'react';
/** Keep keyboard focus inside the topmost dialog, including lazy-loaded sheets. */
export function useModalFocus() {
  useEffect(() => {
    let active: HTMLElement | null = null;
    let previous: HTMLElement | null = null;
    const focusable = (modal: HTMLElement) => Array.from(modal.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),textarea,select,[tabindex="0"]')).filter(el => el.getClientRects().length > 0);
    const update = () => {
      const modals = Array.from(document.querySelectorAll<HTMLElement>('.modal-card'));
      const next = modals.sort((a, b) => Number(getComputedStyle(a.parentElement!).zIndex) - Number(getComputedStyle(b.parentElement!).zIndex)).slice(-1)[0] || null;
      if (next === active) return;
      if (!active) previous = document.activeElement as HTMLElement;
      active = next;
      if (!active) { if (previous?.isConnected) previous.focus(); return; }
      active.setAttribute('role', 'dialog'); active.setAttribute('aria-modal', 'true');
      const title = active.querySelector('h2,h3');
      if (title) { if (!title.id) title.id = `imicall-dialog-${modals.indexOf(active)}`; active.setAttribute('aria-labelledby', title.id); }
      if (!active.contains(document.activeElement)) focusable(active)[0]?.focus();
    };
    const keydown = (event: KeyboardEvent) => {
      if (!active) return;
      if (event.key === 'Escape') { active.parentElement?.click(); return; }
      if (event.key !== 'Tab') return;
      const nodes = focusable(active), first = nodes[0], last = nodes[nodes.length - 1];
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || !active.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !active.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    const observer = new MutationObserver(update);
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener('keydown', keydown); update();
    return () => { observer.disconnect(); document.removeEventListener('keydown', keydown); };
  }, []);
}
