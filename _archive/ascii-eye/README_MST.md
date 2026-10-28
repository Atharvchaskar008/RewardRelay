# AsciiEye – Eye → Space (Logo Edition)

A generative ASCII-style animation of an eye that opens, blinks, and zooms into a starfield where a glowing **red triangular logo** (matching the MST logo) forms.

Ported from the original Python / Tkinter version for use on the web.

---

## Features

- Procedural eye (iris fibers, sclera, lids, catchlights)
- Timeline-driven animation (open → blink → zoom → space → logo)
- Twinkling starfield
- Red triangular logo nebula that morphs from a soft cloud into the logo shape
- Canvas-based for good performance
- Self-contained React component (no extra deps besides React)

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

- The component runs at ~28 fps with a character cell size of 7 px.
- The logo is approximated with a signed-distance triangular frame so it can be rendered procedurally and animated.
- Prefer placing it as a visual break / hero moment rather than a permanent global element.

---

## Restart example

```tsx
const [key, setKey] = useState(0);

return (
  <>
    <AsciiEye restartKey={key} width={720} height={480} />
    <button onClick={() => setKey(k => k + 1)}>Restart</button>
  </>
);
```
