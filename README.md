# SAKAR Landing Page

A static landing page for SAKAR - a trusted marketplace for unused rewards on MST Blockchain.

## Project Structure

```
frontend/
├── index.html              # Main landing page
├── style.css               # Global styles
├── footer.css              # Footer-specific styles
├── footer.js               # ASCII fire footer animation
├── ascii-eye.js            # ASCII eye animation component
├── text-scramble-nav.js    # Navbar text scramble effect
├── hero_art.png            # Hero section background image
├── assets/
│   └── images/             # Reference images and screenshots
├── docs/                   # Integration docs and guides
├── scripts/                # Build/utility scripts (if any)
└── _archive/               # Unused/prototype files
    ├── prototypes/         # HTML prototypes
    └── reference/          # Text references and inspiration
```

## Getting Started

### Prerequisites
- Any modern web browser
- Python 3 (for local development server)

### Local Development

1. Start a local server:
```bash
python -m http.server 8000
```

2. Open browser to:
```
http://localhost:8000
```

## Features

- **Animated ASCII Fire Footer** - Real-time fire simulation using ASCII characters
- **ASCII Eye Animation** - MST logo reveal with eye-to-space transition
- **Text Scramble Effect** - Animated navbar hover effects
- **Full-Bleed Hero** - Background image with dotted artwork
- **Responsive Design** - Mobile-first, works from 320px+

## Tech Stack

- Pure HTML5, CSS3, JavaScript (ES6+)
- No build tools or frameworks required
- Vanilla implementations of all animations

## Components

### Footer (`footer.js`)
Self-contained ASCII fire animation with configurable:
- Fire intensity, wind direction, turbulence
- Color palette (warm fire colors)
- Particle system (embers and sparks)

### ASCII Eye (`ascii-eye.js`)
Canvas-based animation featuring:
- Eye opening sequence
- Zoom through space
- MST logo reveal
- 15-second loop cycle

### Text Scramble (`text-scramble-nav.js`)
Navbar text animation that:
- Scrambles characters on hover
- Resolves back to original text
- Configurable speed and characters

## Browser Support

- Chrome/Edge 90+
- Firefox 88+
- Safari 14+

## Authors

© 2026 Atharv Chaskar & Bhavjot Singh

Built on MST Blockchain.

## License

See parent repository for license information.
