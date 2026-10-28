# AsciiEye – Eye → Space (Web Component)

A generative ASCII-style animation of an eye that opens, blinks, and zooms into a starfield with a glowing heart nebula.

Ported from the original Python / Tkinter version for use on the web.

---

## Features

- Procedural eye (iris fibers, sclera, lids, lashes, catchlights)
- Timeline-driven animation (open → blink → zoom → space → heart)
- Twinkling starfield + soft heart nebula
- Canvas-based for good performance
- Self-contained React component (no extra deps besides React)
- Easy to drop into any Next.js / React project

---

## Usage

```tsx
import AsciiEye from "./AsciiEye";

export default function Page() {
  return (
    <div className="min-h-screen bg-black flex items-center justify-center">
      <AsciiEye width={720} height={480} />
    </div>
  );
}
```

### Props

| Prop         | Type              | Default | Description                          |
|--------------|-------------------|---------|--------------------------------------|
| `width`      | number            | 640     | Canvas width in pixels               |
| `height`     | number            | 420     | Canvas height in pixels              |
| `className`  | string            | ""      | Extra CSS class on the wrapper       |
| `style`      | CSSProperties     | —       | Inline styles on the wrapper         |
| `restartKey` | number \| string  | 0       | Change this value to restart the animation |

---

## Notes

- The component intentionally runs at ~28 fps and uses a character cell size of 7 px for a good balance of detail and performance.
- It is heavier than the fire footer. Prefer placing it on a dedicated section rather than as a permanent global element.
- For a pure text (`<pre>`) version or further optimisations, open an issue or ask the agent again.

---

## Controls (future ideas)

You can add a restart button easily:

```tsx
const [key, setKey] = useState(0);

return (
  <>
    <AsciiEye restartKey={key} width={720} height={480} />
    <button onClick={() => setKey(k => k + 1)}>Restart</button>
  </>
);
```
