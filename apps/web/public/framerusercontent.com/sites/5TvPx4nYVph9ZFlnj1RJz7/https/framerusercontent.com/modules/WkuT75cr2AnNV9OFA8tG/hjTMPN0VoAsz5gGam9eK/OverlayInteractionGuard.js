import {
    jsx as _jsx
} from "react/jsx-runtime";
import {
    startTransition,
    useEffect,
    useState
} from "react";
const INTERACTION_DELAY_MS = 9400;
export function withDelayedOverlayInteraction(Component) {
    return function DelayedOverlayInteraction(props) {
        const [isInteractive, setIsInteractive] = useState(false);
        useEffect(() => {
            const timeoutId = window.setTimeout(() => {
                startTransition(() => setIsInteractive(true));
            }, INTERACTION_DELAY_MS);
            return () => window.clearTimeout(timeoutId);
        }, []);
        return /*#__PURE__*/ _jsx(Component, { ...props,
            "aria-hidden": !isInteractive,
            style: { ...props.style,
                pointerEvents: isInteractive ? "auto" : "none"
            }
        });
    };
}
export const __FramerMetadata__ = {
    "exports": {
        "withDelayedOverlayInteraction": {
            "type": "reactHoc",
            "name": "withDelayedOverlayInteraction",
            "annotations": {
                "framerContractVersion": "1"
            }
        },
        "__FramerMetadata__": {
            "type": "variable"
        }
    }
}
//# sourceMappingURL=./OverlayInteractionGuard.map