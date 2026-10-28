# Project Structure

## Overview
This is a static website for SAKAR - a marketplace for unused rewards on MST Blockchain.

## Directory Layout

```
frontend/
│
├── index.html                  # Main landing page (entry point)
├── style.css                   # Global styles
├── footer.css                  # Footer component styles
├── hero_art.png               # Hero section background image
│
├── footer.js                   # ASCII fire footer animation
├── ascii-eye.js               # ASCII eye → space → logo animation
├── text-scramble-nav.js       # Navbar text scramble effect
│
├── README.md                   # Project documentation
├── .gitignore                 # Git ignore rules
├── STRUCTURE.md               # This file
│
├── assets/                     # Static assets
│   └── images/                # Reference images and screenshots
│       ├── ALEXANDER_ASCII.png
│       ├── changes_in_hero.png
│       └── IDEATION_FRONT_END.png
│
├── docs/                       # Documentation
│   ├── ASCII_EYE_INTEGRATION.md
│   ├── FOOTER_INTEGRATION.md
│   ├── README_footer.md
│   ├── TEXT_SCRAMBLE_INTEGRATION.md
│   └── new_footer.md
│
├── scripts/                    # Build/utility scripts (empty for now)
│
└── _archive/                   # Archived/unused files
    ├── README.md              # Archive inventory
    ├── prototypes/            # HTML prototypes
    │   └── ALEXANDER_ASCIII.html
    ├── reference/             # Text references
    │   ├── AINO_ASCII_NAVBAR.txt
    │   ├── ARCHE_INSPO.txt
    │   ├── ASCII_flame.txt
    │   └── PLUSH_MST_TILE.txt
    ├── ascii-eye/             # React component versions
    │   ├── AsciiEye.tsx
    │   ├── AsciiEye_MST.tsx
    │   ├── README_ASCII_eye.md
    │   └── README_MST.md
    └── eyeTutorial-main/      # Python tutorial
        ├── eye.py
        ├── Glossary.txt
        ├── README.md
        └── .gitattributes
```

## File Purposes

### Root Files (Production)
These files make up the active website:

- **index.html** - Single-page landing with hero, features, use cases, CTA
- **style.css** - Layout, typography, responsive grid, component styles
- **footer.css** - Footer-specific styles including fire animation container
- **footer.js** - Real-time ASCII fire simulation (600+ lines)
- **ascii-eye.js** - Canvas-based eye animation with MST logo reveal
- **text-scramble-nav.js** - Navbar hover animation
- **hero_art.png** - Hero background with dotted rider artwork

### Assets
- **images/** - Screenshots and reference images used during development

### Documentation
- **ASCII_EYE_INTEGRATION.md** - How the eye animation works
- **FOOTER_INTEGRATION.md** - Footer component integration guide
- **README_footer.md** - Footer API documentation
- **TEXT_SCRAMBLE_INTEGRATION.md** - Text scramble setup
- **new_footer.md** - Notes on Glyph Ember component

### Archive
Files preserved for reference but not used in production:
- **prototypes/** - Early HTML experiments
- **reference/** - Text-based inspiration and ASCII art references
- **ascii-eye/** - Original React/TypeScript versions (converted to vanilla JS)
- **eyeTutorial-main/** - External Python tutorial for learning concepts

## Dependencies

**None!** This is a dependency-free static site using:
- Vanilla JavaScript (ES6+)
- CSS3 with CSS Grid and Flexbox
- HTML5 Canvas API
- Google Fonts (DM Mono, Instrument Serif) via CDN

## Running Locally

```bash
# Python 3
python -m http.server 8000

# Or any static server
npx serve .
```

Then visit: `http://localhost:8000`

## Browser Requirements
- ES6+ JavaScript support
- Canvas API
- CSS Grid and Flexbox
- Modern font rendering

Works on:
- Chrome/Edge 90+
- Firefox 88+
- Safari 14+

## Performance Notes

- **No build step required** - everything runs directly in the browser
- **Small footprint** - ~50KB total (HTML + CSS + JS)
- **Efficient animations** - RequestAnimationFrame-based, respects prefers-reduced-motion
- **One HTTP request** for hero image, fonts from CDN

## Future Additions

If the project grows, consider:
- `scripts/` - Build or deployment scripts
- `public/` - If migrating to a framework
- `tests/` - If adding automated testing
- `config/` - For environment-specific settings

---

Last updated: 2026-10-28
