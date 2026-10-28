/**
 * Text Scramble Effect for Navbar
 * Scrambles text through random characters on hover
 */

(function() {
  'use strict';

  class TextScramble {
    constructor(el) {
      this.el = el;
      this.chars = '!<>-_\\/[]{}—=+*^?#________';
      this.update = this.update.bind(this);
    }

    setText(newText) {
      const oldText = this.el.innerText;
      const length = Math.max(oldText.length, newText.length);
      const promise = new Promise((resolve) => (this.resolve = resolve));
      this.queue = [];

      for (let i = 0; i < length; i++) {
        const from = oldText[i] || '';
        const to = newText[i] || '';
        const start = Math.floor(Math.random() * 10);
        const end = start + Math.floor(Math.random() * 10);
        this.queue.push({ from, to, start, end });
      }

      cancelAnimationFrame(this.frameRequest);
      this.frame = 0;
      this.update();
      return promise;
    }

    update() {
      let output = '';
      let complete = 0;

      for (let i = 0, n = this.queue.length; i < n; i++) {
        let { from, to, start, end, char } = this.queue[i];

        if (this.frame >= end) {
          complete++;
          output += to;
        } else if (this.frame >= start) {
          if (!char || Math.random() < 0.28) {
            char = this.randomChar();
            this.queue[i].char = char;
          }
          output += `<span class="scramble-dud">${char}</span>`;
        } else {
          output += from;
        }
      }

      this.el.innerHTML = output;

      if (complete === this.queue.length) {
        this.resolve();
      } else {
        this.frameRequest = requestAnimationFrame(this.update);
        this.frame++;
      }
    }

    randomChar() {
      return this.chars[Math.floor(Math.random() * this.chars.length)];
    }
  }

  function initTextScramble() {
    // Apply scramble on hover to every link & button inside the navbar
    document.querySelectorAll('#nav.hoverchar a, #nav.hoverchar button').forEach((el) => {
      const original = el.textContent.trim();
      const fx = new TextScramble(el);

      el.addEventListener('mouseenter', () => {
        fx.setText(original);
      });

      // Optional: scramble again when mouse leaves (commented out)
      // el.addEventListener('mouseleave', () => {
      //   fx.setText(original);
      // });
    });
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initTextScramble);
  } else {
    initTextScramble();
  }

  // Expose for manual re-initialization if needed
  window.initTextScramble = initTextScramble;
  window.TextScramble = TextScramble;
})();
