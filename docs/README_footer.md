# ASCII Fire Footer

A beautiful animated ASCII fire footer component for React / Next.js.

Matches the dense orange fire look from the reference screenshot.

---

## Features

- Full animated ASCII fire background (same engine as the original AsciiFire)
- Tuned for footer use (height, thickness, turbulence)
- Soft top gradient so text stays readable
- Brand + tagline
- Product / Company / Legal link columns
- Copyright + social icons
- Fully responsive
- Respects `prefers-reduced-motion`
- Zero external dependencies (only React)

---

## Installation

1. Copy `Footer.tsx` into your project (e.g. `components/Footer.tsx`)
2. Make sure you have **Tailwind CSS** set up (the component uses Tailwind utility classes)
3. Import and use:

```tsx
import Footer from "@/components/Footer";

export default function Page() {
  return (
    <div className="min-h-screen bg-black">
      {/* your page content */}

      <Footer 
        brand="Your Brand" 
        tagline="Build with fire." 
      />
    </div>
  );
}
```

---

## Props

| Prop      | Type     | Default              | Description                    |
|-----------|----------|----------------------|--------------------------------|
| `brand`   | string   | `"Originkit"`        | Brand / site name              |
| `tagline` | string   | `"Build with fire."` | Short text under the brand     |
| `year`    | number   | current year         | Copyright year                 |
| `className` | string | `""`                 | Extra class on the `<footer>`  |

---

## Customizing the Fire

Open `Footer.tsx` and find the `<AsciiFire ... />` component.  
You can tweak these props:

| Prop          | Default | Effect                              |
|---------------|---------|-------------------------------------|
| `intensity`   | 92      | How bright / hot the fire is        |
| `thickness`   | 2.6     | How tall the base of the fire is    |
| `turbulence`  | 42      | How chaotic / wispy the flames are  |
| `windForce`   | 22      | How much the fire leans             |
| `charset`     | `"dense"` | Character set (dense matches screenshot) |

---

## Requirements

- React 18+
- Tailwind CSS (for the layout & text styles)

If you prefer a pure CSS version without Tailwind, let me know and I can provide one.

---

## License

Free to use in personal and commercial projects.
