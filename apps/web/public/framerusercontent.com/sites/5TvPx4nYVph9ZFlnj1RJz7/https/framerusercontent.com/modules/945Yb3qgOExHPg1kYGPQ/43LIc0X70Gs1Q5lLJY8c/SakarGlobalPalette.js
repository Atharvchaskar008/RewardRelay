import {
    jsx as _jsx,
    jsxs as _jsxs
} from "react/jsx-runtime";
import {
    startTransition,
    useCallback,
    useEffect,
    useRef,
    useState
} from "react";
import {
    addPropertyControls,
    ControlType
} from "framer";
const BASIC_COLORS = ["#000000", "#c8102e", "#007a33", "#b55a00", "#00ad35", "#b7ad00", "#00eb31", "#b7ff19", "#0000d8", "#b0009e", "#006b97", "#aa4e77", "#00a78f", "#aaa98a", "#00d8a0", "#a9efb4", "#0700ff", "#d000cb", "#007fbd", "#c964a0", "#00bed4", "#c7bfd6", "#00f0d1", "#c0ffe0", "#870000", "#ff0017", "#666000", "#ff5b00", "#4fa800", "#ffad00", "#67ff00", "#f0ff00", "#7200a4", "#f000a9", "#676a98", "#f24991", "#65ac91", "#ffb294", "#5fffa7", "#fff7a8", "#5800da", "#f000e8", "#4b45ff", "#e856e8", "#4ea9e7", "#e9a9e8", "#52e9df", "#ffffff"];
const EVENT_NAME = "arche-palette-change";
const STORAGE_KEY = "arche-live-accent";
const ACCENT_TOKEN_VARIABLE = "--token-bac6f964-e06b-4a7a-93c6-f1df1cab0849";
const ACCENT_SOFT_TOKEN_VARIABLE = "--token-6575c0a6-024a-4083-a73b-e6084d9fcc79";
const RUNTIME_STYLE_ID = "arche-runtime-accent-styles";

function normalizeHex(color) {
    if (/^#[0-9a-f]{6}$/i.test(color)) return color.toLowerCase();
    if (/^#[0-9a-f]{3}$/i.test(color)) {
        const [r, g, b] = color.slice(1).split("");
        return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
    }
    return "#0700ff";
}

function hexToRgba(color, alpha) {
    const normalized = normalizeHex(color).slice(1);
    const red = Number.parseInt(normalized.slice(0, 2), 16);
    const green = Number.parseInt(normalized.slice(2, 4), 16);
    const blue = Number.parseInt(normalized.slice(4, 6), 16);
    return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function applyRuntimeAccent(color) {
    if (typeof document === "undefined") return;
    const normalized = normalizeHex(color);
    const softColor = hexToRgba(normalized, .4);
    document.documentElement.style.setProperty(ACCENT_TOKEN_VARIABLE, normalized);
    document.documentElement.style.setProperty(ACCENT_SOFT_TOKEN_VARIABLE, softColor);
}
/**
 * SAKAR Global Palette
 *
 * One site-level control for every ColorForge Image instance.
 * The component uses browser events and session storage only.
 *
 * @framerIntrinsicWidth 44
 * @framerIntrinsicHeight 44
 * @framerSupportedLayoutWidth fixed
 * @framerSupportedLayoutHeight fixed
 */
export default function SAKARGlobalPalette(props) {
    const {
        accentColor = "#0700ff", style
    } = props;
    const rootRef = useRef(null);
    const [paletteOpen, setPaletteOpen] = useState(false);
    const [selectedColor, setSelectedColor] = useState(accentColor);
    useEffect(() => {
        if (typeof window === "undefined") return;
        const stored = window.sessionStorage.getItem(STORAGE_KEY);
        const initialColor = normalizeHex(stored || accentColor);
        applyRuntimeAccent(initialColor);
        startTransition(() => setSelectedColor(initialColor));

        function handlePaletteChange(event) {
            const detail = event.detail;
            if (detail ? .color) {
                const nextColor = normalizeHex(detail.color);
                applyRuntimeAccent(nextColor);
                startTransition(() => setSelectedColor(nextColor));
            }
        }
        window.addEventListener(EVENT_NAME, handlePaletteChange);
        return () => window.removeEventListener(EVENT_NAME, handlePaletteChange);
    }, [accentColor]);
    useEffect(() => {
        if (!paletteOpen || typeof document === "undefined") return;

        function closeOnOutsidePress(event) {
            if (!rootRef.current ? .contains(event.target)) {
                startTransition(() => setPaletteOpen(false));
            }
        }

        function closeOnEscape(event) {
            if (event.key === "Escape") {
                startTransition(() => setPaletteOpen(false));
            }
        }
        document.addEventListener("pointerdown", closeOnOutsidePress);
        document.addEventListener("keydown", closeOnEscape);
        return () => {
            document.removeEventListener("pointerdown", closeOnOutsidePress);
            document.removeEventListener("keydown", closeOnEscape);
        };
    }, [paletteOpen]);
    const chooseColor = useCallback(color => {
        const normalized = normalizeHex(color);
        if (typeof window !== "undefined") {
            applyRuntimeAccent(normalized);
            window.sessionStorage.setItem(STORAGE_KEY, normalized);
            window.dispatchEvent(new CustomEvent(EVENT_NAME, {
                detail: {
                    color: normalized
                }
            }));
        } else {
            startTransition(() => setSelectedColor(normalized));
        }
    }, []);
    const normalizedSelectedColor = normalizeHex(selectedColor);
    const runtimeAccentStyles = `:root, body, body * { ${ACCENT_TOKEN_VARIABLE}: ${normalizedSelectedColor} !important; ${ACCENT_SOFT_TOKEN_VARIABLE}: ${hexToRgba(normalizedSelectedColor,.4)} !important; }`;
    return /*#__PURE__*/ _jsxs("div", {
        ref: rootRef,
        style: { ...style,
            position: "relative",
            width: 44,
            height: 44,
            minWidth: 44,
            minHeight: 44,
            marginLeft: "auto",
            overflow: "visible"
        },
        children: [ /*#__PURE__*/ _jsx("style", {
            id: RUNTIME_STYLE_ID,
            children: runtimeAccentStyles
        }), /*#__PURE__*/ _jsx("button", {
            type: "button",
            "aria-label": paletteOpen ? "Close site color palette" : "Open site color palette",
            "aria-expanded": paletteOpen,
            onClick: () => startTransition(() => setPaletteOpen(open => !open)),
            style: {
                width: "100%",
                height: "100%",
                padding: 0,
                border: "none",
                borderRadius: "50%",
                background: "transparent",
                boxShadow: "0 6px 20px rgba(0,0,0,.2)",
                cursor: "pointer"
            },
            children: /*#__PURE__*/ _jsx("span", {
                style: {
                    display: "block",
                    width: "100%",
                    height: "100%",
                    borderRadius: "50%",
                    background: selectedColor,
                    border: "none"
                }
            })
        }), paletteOpen && /*#__PURE__*/ _jsx("div", {
            role: "group",
            "aria-label": "SAKAR site color palette",
            style: {
                position: "absolute",
                top: 52,
                left: 0,
                width: 280,
                maxWidth: "calc(100vw - 32px)",
                display: "grid",
                gridTemplateColumns: "repeat(8, minmax(0, 1fr))",
                gap: 5,
                padding: 8,
                borderRadius: 8,
                border: "1px solid rgba(255,255,255,.16)",
                background: "#111111",
                boxShadow: "0 12px 36px rgba(0,0,0,.3)"
            },
            children: BASIC_COLORS.map(color => {
                const selected = color.toLowerCase() === selectedColor.toLowerCase();
                return /*#__PURE__*/ _jsx("button", {
                    type: "button",
                    "aria-label": `Use ${color} across the site`,
                    "aria-pressed": selected,
                    onClick: () => chooseColor(color),
                    style: {
                        width: "100%",
                        aspectRatio: "1 / 1",
                        minWidth: 0,
                        padding: 0,
                        borderRadius: 3,
                        border: "1px solid rgba(255,255,255,.18)",
                        background: color,
                        cursor: "pointer"
                    }
                }, color);
            })
        })]
    });
}
addPropertyControls(SAKARGlobalPalette, {
    accentColor: {
        type: ControlType.Color,
        title: "Accent Style",
        defaultValue: "#0700ff"
    }
});
export const __FramerMetadata__ = {
    "exports": {
        "default": {
            "type": "reactComponent",
            "name": "SAKARGlobalPalette",
            "slots": [],
            "annotations": {
                "framerSupportedLayoutHeight": "fixed",
                "framerIntrinsicWidth": "44",
                "framerContractVersion": "1",
                "framerIntrinsicHeight": "44",
                "framerSupportedLayoutWidth": "fixed"
            }
        },
        "__FramerMetadata__": {
            "type": "variable"
        }
    }
}
//# sourceMappingURL=./SAKARGlobalPalette.map