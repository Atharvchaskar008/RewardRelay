import {
    jsx as _jsx
} from "react/jsx-runtime";
import {
    addPropertyControls,
    ControlType,
    withCSS
} from "framer";
import Lenis from "lenis";
import {
    useEffect,
    useRef
} from "react";

function SmoothScrollComponent(props) {
    const {
        intensity
    } = props;
    const lenis = useRef(null);
    useEffect(() => {
        if (lenis.current) {
            try {
                lenis.current.scrollTo(0, {
                    immediate: true
                });
            } catch (error) {
                console.error("Error scrolling to top:", error);
            }
        }
    }, [lenis]); // Watch for stop scroll elements
    useEffect(() => {
        const checkForStopScroll = () => {
            try {
                const stopScrollElement = document.querySelector("[data-frameruni-stop-scroll]");
                const htmlElement = document.documentElement;
                const hasHiddenOverflow = htmlElement && htmlElement.style && htmlElement.style.overflow === "hidden";
                if (lenis.current) {
                    if (stopScrollElement || hasHiddenOverflow) {
                        lenis.current.stop();
                    } else {
                        lenis.current.start();
                    }
                }
            } catch (error) {
                console.error("Error in checkForStopScroll:", error);
            }
        }; // Initial check
        checkForStopScroll(); // Set up observers
        let stopScrollObserver;
        let htmlStyleObserver;
        try {
            stopScrollObserver = new MutationObserver(checkForStopScroll);
            htmlStyleObserver = new MutationObserver(checkForStopScroll); // Observe document for data-frameruni-stop-scroll attribute
            if (document && document.documentElement) {
                stopScrollObserver.observe(document.documentElement, {
                    childList: true,
                    subtree: true,
                    attributes: true,
                    attributeFilter: ["data-frameruni-stop-scroll"]
                }); // Observe only the HTML element for style changes
                htmlStyleObserver.observe(document.documentElement, {
                    attributes: true,
                    attributeFilter: ["style"]
                });
            }
        } catch (error) {
            console.error("Error setting up observers:", error);
        }
        return () => {
            try {
                if (stopScrollObserver) stopScrollObserver.disconnect();
                if (htmlStyleObserver) htmlStyleObserver.disconnect();
            } catch (error) {
                console.error("Error disconnecting observers:", error);
            }
        };
    }, []);
    useEffect(() => {
        try {
            if (!document) return;
            const allElements = document.getElementsByTagName("*");
            for (let i = 0; i < allElements.length; i++) {
                const element = allElements[i];
                if (!element) continue;
                try {
                    const computedStyle = window.getComputedStyle(element);
                    if (computedStyle && computedStyle.getPropertyValue("overflow") === "auto") {
                        element.setAttribute("data-lenis-prevent", "true");
                    }
                } catch (styleError) {
                    console.error("Error getting computed style:", styleError);
                }
            }
        } catch (error) {
            console.error("Error in overflow detection:", error);
        }
    }, []);
    useEffect(() => {
        try {
            if (typeof Lenis !== "function") {
                console.error("Lenis is not available");
                return;
            }
            lenis.current = new Lenis({
                duration: (intensity || 10) / 10
            });
            const raf = time => {
                if (lenis.current) {
                    try {
                        lenis.current.raf(time);
                        requestAnimationFrame(raf);
                    } catch (error) {
                        console.error("Error in animation frame:", error);
                    }
                }
            };
            const animationId = requestAnimationFrame(raf);
            return () => {
                cancelAnimationFrame(animationId);
                if (lenis.current) {
                    try {
                        lenis.current.destroy();
                        lenis.current = null;
                    } catch (error) {
                        console.error("Error destroying Lenis:", error);
                    }
                }
            };
        } catch (error) {
            console.error("Error initializing Lenis:", error);
            return () => {};
        }
    }, [intensity]); //https://github.com/darkroomengineering/lenis?tab=readme-ov-file#anchor-links
    useEffect(() => {
        try {
            if (!document || !lenis.current) return; // Get all anchor links and store click handlers with their targets
            const anchorLinksData = Array.from(document.querySelectorAll("a[href]") || []).filter(element => {
                if (!element) return false;
                const anchor = element;
                if (!anchor.href) return false; // Only handle internal anchor links
                const isInternalLink = anchor.href.startsWith(window.location.origin) || anchor.href.startsWith("./") || anchor.href.startsWith("/");
                const hasHash = anchor.href.includes("#");
                return isInternalLink && hasHash;
            }).map(anchor => {
                try {
                    const anchorElement = anchor;
                    const href = anchorElement.href.includes("#") ? `#${anchorElement.href.split("#").pop()}` : "";
                    const decodedHref = href ? decodeURIComponent(href) : "";
                    let scrollMargin = 0;
                    try {
                        if (decodedHref) {
                            const targetElement = document.querySelector(decodedHref);
                            if (targetElement) {
                                const marginStyle = window.getComputedStyle(targetElement).scrollMarginTop;
                                scrollMargin = marginStyle ? parseInt(marginStyle) || 0 : 0;
                            }
                        }
                    } catch (targetError) {
                        console.error("Error finding target element:", targetError);
                    }
                    return {
                        href,
                        scrollMargin,
                        anchorElement: anchorElement
                    };
                } catch (anchorError) {
                    console.error("Error processing anchor:", anchorError);
                    return null;
                }
            }).filter(Boolean);
            const handleClick = (e, href, scrollMargin) => {
                try {
                    if (e && e.preventDefault) e.preventDefault();
                    if (lenis.current && href) {
                        lenis.current.scrollTo(href, {
                            offset: -(scrollMargin || 0)
                        });
                    }
                } catch (error) {
                    console.error("Error in anchor click handler:", error);
                }
            };
            const handlers = anchorLinksData.map(({
                href,
                scrollMargin
            }) => e => handleClick(e, href, scrollMargin));
            anchorLinksData.forEach(({
                anchorElement
            }, index) => {
                if (anchorElement && handlers[index]) {
                    anchorElement.addEventListener("click", handlers[index]);
                }
            });
            return () => {
                anchorLinksData.forEach(({
                    anchorElement
                }, index) => {
                    if (anchorElement && handlers[index]) {
                        anchorElement.removeEventListener("click", handlers[index]);
                    }
                });
            };
        } catch (error) {
            console.error("Error setting up anchor links:", error);
            return () => {};
        }
    }, [lenis]);
    return /*#__PURE__*/ _jsx("div", {
        style: props.style
    });
}
/**
 * @framerSupportedLayoutWidth auto
 * @framerSupportedLayoutHeight auto
 *
 * @framerDisableUnlink
 */
const SmoothScroll = withCSS(SmoothScrollComponent, ["html.lenis { height: auto; }", ".lenis.lenis-smooth { scroll-behavior: auto !important; }", ".lenis.lenis-smooth [data-lenis-prevent] { overscroll-behavior: contain; }", ".lenis.lenis-stopped { overflow: hidden; }", ".lenis.lenis-scrolling iframe { pointer-events: none; }"], "");
export default SmoothScroll;
SmoothScroll.displayName = "Smooth Scroll";
addPropertyControls(SmoothScroll, {
    intensity: {
        title: "Intensity",
        type: ControlType.Number,
        defaultValue: 10,
        min: 0,
        description: "More components at [Framer University](https://frameruni.link/cc)."
    }
});
export const __FramerMetadata__ = {
    "exports": {
        "default": {
            "type": "reactComponent",
            "name": "SmoothScroll",
            "slots": [],
            "annotations": {
                "framerSupportedLayoutWidth": "auto",
                "framerDisableUnlink": "",
                "framerSupportedLayoutHeight": "auto",
                "framerContractVersion": "1"
            }
        },
        "__FramerMetadata__": {
            "type": "variable"
        }
    }
}
//# sourceMappingURL=./SmoothScroll_Prod.map