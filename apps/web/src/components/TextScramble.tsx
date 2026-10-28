"use client";

import { useEffect, useRef } from "react";

interface TextScrambleProps {
  children: React.ReactNode;
  className?: string;
}

/**
 * TextScramble - Wraps children and applies scramble effect on hover to text elements
 */
export default function TextScramble({ children, className = "" }: TextScrambleProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const elements = containerRef.current.querySelectorAll("a, button");
    const instances: Array<{ element: HTMLElement; fx: TextScrambleEffect; original: string }> = [];

    elements.forEach((el) => {
      const element = el as HTMLElement;
      const original = element.textContent?.trim() || "";
      const fx = new TextScrambleEffect(element);

      const handleMouseEnter = () => {
        fx.setText(original);
      };

      element.addEventListener("mouseenter", handleMouseEnter);

      instances.push({ element, fx, original });
    });

    return () => {
      instances.forEach(({ element }) => {
        element.removeEventListener("mouseenter", () => {});
      });
    };
  }, []);

  return (
    <div ref={containerRef} className={className}>
      {children}
    </div>
  );
}

class TextScrambleEffect {
  private el: HTMLElement;
  private chars = "!<>-_\\/[]{}—=+*^?#________";
  private queue: Array<{
    from: string;
    to: string;
    start: number;
    end: number;
    char?: string;
  }> = [];
  private frameRequest = 0;
  private frame = 0;
  private resolve: (() => void) | null = null;

  constructor(el: HTMLElement) {
    this.el = el;
    this.update = this.update.bind(this);
  }

  setText(newText: string): Promise<void> {
    const oldText = this.el.innerText;
    const length = Math.max(oldText.length, newText.length);
    const promise = new Promise<void>((resolve) => (this.resolve = resolve));
    this.queue = [];

    for (let i = 0; i < length; i++) {
      const from = oldText[i] || "";
      const to = newText[i] || "";
      const start = Math.floor(Math.random() * 10);
      const end = start + Math.floor(Math.random() * 10);
      this.queue.push({ from, to, start, end });
    }

    cancelAnimationFrame(this.frameRequest);
    this.frame = 0;
    this.update();
    return promise;
  }

  private update(): void {
    let output = "";
    let complete = 0;

    for (let i = 0, n = this.queue.length; i < n; i++) {
      const { from, to, start, end } = this.queue[i];
      let { char } = this.queue[i];

      if (this.frame >= end) {
        complete++;
        output += to;
      } else if (this.frame >= start) {
        if (!char || Math.random() < 0.28) {
          char = this.randomChar();
          this.queue[i].char = char;
        }
        output += `<span class="scramble-dud" style="opacity: 0.5;">${char}</span>`;
      } else {
        output += from;
      }
    }

    this.el.innerHTML = output;

    if (complete === this.queue.length) {
      if (this.resolve) this.resolve();
    } else {
      this.frameRequest = requestAnimationFrame(() => this.update());
      this.frame++;
    }
  }

  private randomChar(): string {
    return this.chars[Math.floor(Math.random() * this.chars.length)];
  }
}

/**
 * useTextScramble - Hook version for programmatic control
 */
export function useTextScramble(elementRef: React.RefObject<HTMLElement>) {
  const fxRef = useRef<TextScrambleEffect | null>(null);

  useEffect(() => {
    if (!elementRef.current) return;
    fxRef.current = new TextScrambleEffect(elementRef.current);
  }, [elementRef]);

  const scramble = (text: string) => {
    if (fxRef.current) {
      return fxRef.current.setText(text);
    }
    return Promise.resolve();
  };

  return { scramble };
}
