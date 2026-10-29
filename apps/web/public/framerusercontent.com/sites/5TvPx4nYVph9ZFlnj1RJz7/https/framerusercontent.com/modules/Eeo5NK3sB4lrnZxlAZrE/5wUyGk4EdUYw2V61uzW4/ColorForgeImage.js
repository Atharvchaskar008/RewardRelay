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
const DEFAULT_IMAGE = {
    src: "https://framerusercontent.com/images/0w0qwEFKa288EqQq2SBotntUpbE.png",
    alt: ""
};
const HIGHLIGHT = [245, 245, 245];
const EVENT_NAME = "arche-palette-change";
const STORAGE_KEY = "arche-live-accent";

function clamp(value, min = 0, max = 255) {
    return Math.max(min, Math.min(max, value));
}

function byte(value) {
    return Math.floor(clamp(value));
}

function smoothstep(value) {
    const x = clamp(value, 0, 1);
    return x * x * (3 - 2 * x);
}

function luminance(r, g, b) {
    return r * .2126 + g * .7152 + b * .0722;
}

function hexToRgb(hex) {
    const normalized = hex.replace("#", "");
    const full = normalized.length === 3 ? normalized.split("").map(character => character + character).join("") : normalized;
    const fallback = [7, 0, 255];
    if (!/^[0-9a-f]{6}$/i.test(full)) return fallback;
    return [Number.parseInt(full.slice(0, 2), 16), Number.parseInt(full.slice(2, 4), 16), Number.parseInt(full.slice(4, 6), 16)];
}

function normalizeColor(color, root) {
    if (/^#[0-9a-f]{6}$/i.test(color)) return color.toLowerCase();
    if (/^#[0-9a-f]{3}$/i.test(color)) {
        const [r, g, b] = color.slice(1).split("");
        return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
    }
    if (typeof document === "undefined") return "#0700ff";
    let candidate = color;
    if (root && color.includes("var(")) {
        const element = document.createElement("span");
        element.style.color = color;
        element.style.position = "absolute";
        element.style.visibility = "hidden";
        root.appendChild(element);
        candidate = window.getComputedStyle(element).color;
        element.remove();
    }
    const probe = document.createElement("canvas").getContext("2d");
    if (!probe) return "#0700ff";
    probe.fillStyle = "#0700ff";
    probe.fillStyle = candidate;
    const resolved = probe.fillStyle;
    return /^#[0-9a-f]{6}$/i.test(resolved) ? resolved.toLowerCase() : "#0700ff";
}

function recolorPixels(data, imageColor, backgroundColor) {
    const pixels = data.data;
    const shadow = hexToRgb(normalizeColor(imageColor));
    const highlight = hexToRgb(normalizeColor(backgroundColor));
    for (let index = 0; index < pixels.length; index += 4) {
        if (pixels[index + 3] === 0) continue;
        if (pixels[index] === HIGHLIGHT[0] && pixels[index + 1] === HIGHLIGHT[1] && pixels[index + 2] === HIGHLIGHT[2]) {
            pixels[index] = highlight[0];
            pixels[index + 1] = highlight[1];
            pixels[index + 2] = highlight[2];
            continue;
        }
        const mix = smoothstep(luminance(pixels[index], pixels[index + 1], pixels[index + 2]) / 255);
        pixels[index] = byte(shadow[0] * (1 - mix) + highlight[0] * mix);
        pixels[index + 1] = byte(shadow[1] * (1 - mix) + highlight[1] * mix);
        pixels[index + 2] = byte(shadow[2] * (1 - mix) + highlight[2] * mix);
    }
}

function alignmentForPosition(position) {
    const x = position.includes("left") ? 0 : position.includes("right") ? 1 : .5;
    const y = position.includes("top") ? 0 : position.includes("bottom") ? 1 : .5;
    return {
        x,
        y
    };
}

function cssPosition(position) {
    return position.replace("-", " ");
}

function drawFittedImage(context, image, width, height, fit, position) {
    if (fit === "stretch") {
        context.drawImage(image, 0, 0, width, height);
        return;
    }
    const scaleMethod = fit === "fit" ? Math.min : Math.max;
    const scale = scaleMethod(width / image.naturalWidth, height / image.naturalHeight);
    const drawWidth = image.naturalWidth * scale;
    const drawHeight = image.naturalHeight * scale;
    const alignment = alignmentForPosition(position);
    context.drawImage(image, (width - drawWidth) * alignment.x, (height - drawHeight) * alignment.y, drawWidth, drawHeight);
}
/**
 * ColorForge Image
 *
 * CPU/Canvas2D luminance recoloring derived from ColorForge Studio v0.4.
 * No WebGL, shaders, effects, motion, export tools, or image replacement UI.
 *
 * @framerIntrinsicWidth 800
 * @framerIntrinsicHeight 600
 * @framerSupportedLayoutWidth any-prefer-fixed
 * @framerSupportedLayoutHeight any-prefer-fixed
 */
export default function ColorForgeImage(props) {
    const {
        sourceImage = DEFAULT_IMAGE, altText, decorative = false, imageFit = "fill", imagePosition = "center", recolorEnabled = true, colorSource = "global", imageColor = "#000000", backgroundColor = "#f5f5f5", showPalette = true, accentColor = "#0700ff", style
    } = props;
    const rootRef = useRef(null);
    const canvasRef = useRef(null);
    const paletteRef = useRef(null);
    const [paletteOpen, setPaletteOpen] = useState(false);
    const [renderFailed, setRenderFailed] = useState(false);
    const [selectedColor, setSelectedColor] = useState(accentColor);
    const source = sourceImage ? .src || DEFAULT_IMAGE.src;
    const alt = decorative ? "" : altText ? ? sourceImage ? .alt ? ? "";
    const activeImageColor = colorSource === "custom" ? imageColor : selectedColor;
    useEffect(() => {
        if (typeof window === "undefined") return;
        const stored = window.sessionStorage.getItem(STORAGE_KEY);
        if (stored) startTransition(() => setSelectedColor(stored));
        else startTransition(() => setSelectedColor(accentColor));

        function handlePaletteChange(event) {
            const detail = event.detail;
            if (detail ? .color) {
                startTransition(() => setSelectedColor(detail.color));
            }
        }
        window.addEventListener(EVENT_NAME, handlePaletteChange);
        return () => window.removeEventListener(EVENT_NAME, handlePaletteChange);
    }, [accentColor]);
    useEffect(() => {
        if (!paletteOpen || typeof document === "undefined") return;

        function closeOnOutsidePress(event) {
            if (!paletteRef.current ? .contains(event.target)) {
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
    useEffect(() => {
        if (!recolorEnabled || !source || typeof window === "undefined") return;
        const root = rootRef.current;
        const canvas = canvasRef.current;
        if (!root || !canvas) return;
        const rootNode = root;
        const canvasNode = canvas;
        let cancelled = false;
        let animationFrame = 0;
        const image = new Image;
        image.crossOrigin = "anonymous";

        function render() {
            if (cancelled || !image.naturalWidth || !image.naturalHeight) return;
            const cssWidth = Math.max(1, rootNode.clientWidth);
            const cssHeight = Math.max(1, rootNode.clientHeight);
            const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
            let width = Math.max(1, Math.round(cssWidth * pixelRatio));
            let height = Math.max(1, Math.round(cssHeight * pixelRatio));
            const maxPixels = 4e6;
            if (width * height > maxPixels) {
                const scale = Math.sqrt(maxPixels / (width * height));
                width = Math.max(1, Math.round(width * scale));
                height = Math.max(1, Math.round(height * scale));
            }
            canvasNode.width = width;
            canvasNode.height = height;
            const context = canvasNode.getContext("2d", {
                willReadFrequently: true
            });
            if (!context) return;
            context.clearRect(0, 0, width, height);
            context.imageSmoothingEnabled = true;
            context.imageSmoothingQuality = "high";
            try {
                drawFittedImage(context, image, width, height, imageFit, imagePosition);
                const data = context.getImageData(0, 0, width, height);
                recolorPixels(data, normalizeColor(activeImageColor, rootNode), normalizeColor(backgroundColor, rootNode));
                context.putImageData(data, 0, 0);
                startTransition(() => setRenderFailed(false));
            } catch {
                startTransition(() => setRenderFailed(true));
            }
        }

        function scheduleRender() {
            window.cancelAnimationFrame(animationFrame);
            animationFrame = window.requestAnimationFrame(render);
        }
        image.onload = scheduleRender;
        image.onerror = () => startTransition(() => setRenderFailed(true));
        image.src = source;
        const observer = new ResizeObserver(scheduleRender);
        observer.observe(rootNode);
        return () => {
            cancelled = true;
            window.cancelAnimationFrame(animationFrame);
            observer.disconnect();
            image.onload = null;
            image.onerror = null;
        };
    }, [source, activeImageColor, backgroundColor, recolorEnabled, imageFit, imagePosition]);
    const chooseColor = useCallback(color => {
        const normalized = normalizeColor(color);
        if (typeof window !== "undefined") {
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
    const showOriginal = !recolorEnabled || renderFailed;
    return /*#__PURE__*/ _jsxs("div", {
        ref: rootRef,
        style: { ...style,
            position: "relative",
            width: "100%",
            height: "100%",
            overflow: "hidden",
            background: backgroundColor
        },
        children: [ /*#__PURE__*/ _jsx("img", {
            src: source,
            srcSet: sourceImage ? .srcSet,
            alt: alt,
            draggable: false,
            style: {
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                objectFit: imageFit === "fill" ? "cover" : imageFit === "fit" ? "contain" : "fill",
                objectPosition: cssPosition(imagePosition),
                display: "block",
                opacity: showOriginal ? 1 : 0,
                pointerEvents: "none",
                userSelect: "none"
            }
        }), /*#__PURE__*/ _jsx("canvas", {
            ref: canvasRef,
            "aria-hidden": "true",
            style: {
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                display: showOriginal ? "none" : "block"
            }
        }), recolorEnabled && colorSource === "global" && showPalette && !renderFailed && /*#__PURE__*/ _jsxs("div", {
            ref: paletteRef,
            style: {
                position: "absolute",
                top: 12,
                right: 12,
                zIndex: 3
            },
            children: [ /*#__PURE__*/ _jsx("button", {
                type: "button",
                "aria-label": paletteOpen ? "Close color palette" : "Open color palette",
                "aria-expanded": paletteOpen,
                onClick: () => startTransition(() => setPaletteOpen(open => !open)),
                style: {
                    width: 38,
                    height: 38,
                    padding: 0,
                    border: "none",
                    borderRadius: "50%",
                    background: "transparent",
                    boxShadow: "0 4px 16px rgba(0,0,0,.18)",
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
                "aria-label": "SAKAR color palette",
                style: {
                    position: "absolute",
                    top: 46,
                    right: 0,
                    width: 280,
                    maxWidth: "calc(100vw - 32px)",
                    display: "grid",
                    gridTemplateColumns: "repeat(8, minmax(0, 1fr))",
                    gap: 5,
                    padding: 8,
                    borderRadius: 8,
                    border: "1px solid rgba(255,255,255,.16)",
                    background: "#111111",
                    boxShadow: "0 12px 36px rgba(0,0,0,.28)"
                },
                children: BASIC_COLORS.map(color => {
                    const selected = color.toLowerCase() === selectedColor.toLowerCase();
                    return /*#__PURE__*/ _jsx("button", {
                        type: "button",
                        "aria-label": `Use ${color}`,
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
        })]
    });
}
addPropertyControls(ColorForgeImage, {
    sourceImage: {
        type: ControlType.ResponsiveImage,
        title: "Image"
    },
    altText: {
        type: ControlType.String,
        title: "Alt Text",
        defaultValue: "",
        displayTextArea: true,
        description: "Describe meaningful images for accessibility and search engines.",
        hidden: ({
            decorative
        }) => decorative === true
    },
    decorative: {
        type: ControlType.Boolean,
        title: "Decorative",
        defaultValue: false,
        description: "Hides decorative imagery from screen readers."
    },
    imageFit: {
        type: ControlType.Enum,
        title: "Fit",
        options: ["fill", "fit", "stretch"],
        optionTitles: ["Fill", "Fit", "Stretch"],
        defaultValue: "fill",
        displaySegmentedControl: true
    },
    imagePosition: {
        type: ControlType.Enum,
        title: "Position",
        options: ["center", "top", "bottom", "left", "right", "top-left", "top-right", "bottom-left", "bottom-right"],
        optionTitles: ["Center", "Top", "Bottom", "Left", "Right", "Top Left", "Top Right", "Bottom Left", "Bottom Right"],
        defaultValue: "center",
        hidden: ({
            imageFit
        }) => imageFit === "stretch"
    },
    recolorEnabled: {
        type: ControlType.Boolean,
        title: "Recolor",
        defaultValue: true
    },
    colorSource: {
        type: ControlType.Enum,
        title: "Image Color",
        options: ["global", "custom"],
        optionTitles: ["Global Palette", "Custom"],
        defaultValue: "global",
        displaySegmentedControl: true,
        hidden: ({
            recolorEnabled
        }) => !recolorEnabled
    },
    imageColor: {
        type: ControlType.Color,
        title: "Custom Color",
        defaultValue: "#000000",
        hidden: ({
            recolorEnabled,
            colorSource
        }) => !recolorEnabled || colorSource !== "custom"
    },
    backgroundColor: {
        type: ControlType.Color,
        title: "Background",
        defaultValue: "#f5f5f5"
    },
    showPalette: {
        type: ControlType.Boolean,
        title: "Live Palette",
        defaultValue: true,
        hidden: ({
            recolorEnabled,
            colorSource
        }) => !recolorEnabled || colorSource !== "global"
    },
    accentColor: {
        type: ControlType.Color,
        title: "Accent Style",
        defaultValue: "#0700ff",
        hidden: ({
            recolorEnabled,
            colorSource
        }) => !recolorEnabled || colorSource !== "global"
    }
});
export const __FramerMetadata__ = {
    "exports": {
        "default": {
            "type": "reactComponent",
            "name": "ColorForgeImage",
            "slots": [],
            "annotations": {
                "framerSupportedLayoutHeight": "any-prefer-fixed",
                "framerSupportedLayoutWidth": "any-prefer-fixed",
                "framerContractVersion": "1",
                "framerIntrinsicWidth": "800",
                "framerIntrinsicHeight": "600"
            }
        },
        "__FramerMetadata__": {
            "type": "variable"
        }
    }
}
//# sourceMappingURL=./ColorForgeImage.map