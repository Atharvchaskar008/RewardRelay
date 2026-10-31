"use client";

import { useEffect } from "react";

/** On <html> while the keyboard is up; see the rules in styles/app.css. */
const TYPING_CLASS = "typing";
/** Leaves time for a tap on a button to land before the layout changes under it. */
const TYPING_END_DELAY_MS = 200;
/** Leaves time for the keyboard to open before measuring what it covers. */
const REVEAL_DELAY_MS = 300;

const NO_KEYBOARD_INPUTS = new Set([
  "button",
  "checkbox",
  "color",
  "date",
  "datetime-local",
  "file",
  "hidden",
  "image",
  "month",
  "radio",
  "range",
  "reset",
  "submit",
  "time",
  "week",
]);

/** A field that opens the on-screen keyboard. */
function isTextField(target: EventTarget | null): target is HTMLInputElement | HTMLTextAreaElement {
  const field =
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLInputElement && !NO_KEYBOARD_INPUTS.has(target.type));
  return field && !target.disabled && !target.readOnly;
}

/** Scrolls the field clear of the keyboard, which can cover about half of the screen. */
function reveal(field: HTMLElement): void {
  const visibleHeight = window.visualViewport?.height ?? window.innerHeight;
  const { top, bottom } = field.getBoundingClientRect();
  if (top < 72 || bottom > visibleHeight / 2) field.scrollIntoView({ block: "start" });
}

/**
 * Wallet in-app browsers (BridgeKey's WebView) are less forgiving than Chrome, more so with a screen
 * share or recorder running over them: a tap can fail to focus the field, and the keyboard can cover
 * the page without resizing it, so whatever is typed stays out of sight. Touch devices only.
 */
export function useKeyboardAssist(): void {
  useEffect(() => {
    if (!window.matchMedia("(pointer: coarse)").matches) return;
    const root = document.documentElement;
    let revealTimer: ReturnType<typeof setTimeout> | undefined;
    let typingEndTimer: ReturnType<typeof setTimeout> | undefined;

    const scheduleReveal = (field: HTMLElement) => {
      clearTimeout(revealTimer);
      revealTimer = setTimeout(() => reveal(field), REVEAL_DELAY_MS);
    };
    const onTap = (event: Event) => {
      if (isTextField(event.target) && document.activeElement !== event.target) {
        event.target.focus();
      }
    };
    const onFocusIn = (event: FocusEvent) => {
      if (!isTextField(event.target)) return;
      clearTimeout(typingEndTimer);
      root.classList.add(TYPING_CLASS);
      scheduleReveal(event.target);
    };
    const onFocusOut = (event: FocusEvent) => {
      if (isTextField(event.relatedTarget)) return;
      clearTimeout(revealTimer);
      typingEndTimer = setTimeout(() => root.classList.remove(TYPING_CLASS), TYPING_END_DELAY_MS);
    };
    const onViewportResize = () => {
      if (isTextField(document.activeElement)) scheduleReveal(document.activeElement);
    };

    document.addEventListener("pointerup", onTap, true);
    document.addEventListener("click", onTap, true);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    window.visualViewport?.addEventListener("resize", onViewportResize);
    return () => {
      clearTimeout(revealTimer);
      clearTimeout(typingEndTimer);
      root.classList.remove(TYPING_CLASS);
      document.removeEventListener("pointerup", onTap, true);
      document.removeEventListener("click", onTap, true);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
      window.visualViewport?.removeEventListener("resize", onViewportResize);
    };
  }, []);
}
