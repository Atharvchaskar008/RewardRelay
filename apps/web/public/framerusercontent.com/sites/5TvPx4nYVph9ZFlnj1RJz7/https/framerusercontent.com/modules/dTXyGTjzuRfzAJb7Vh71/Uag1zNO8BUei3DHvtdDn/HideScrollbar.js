import {
    jsx as _jsx
} from "react/jsx-runtime";
import {
    useEffect
} from "react";
export function ThinGreyScrollbar(Component) {
    return props => {
        useEffect(() => {
            const id = "thin-grey-scrollbar-css";
            if (!document.getElementById(id)) {
                const style = document.createElement("style");
                style.id = id;
                style.innerHTML = `
                    .thin-grey-scrollbar {
                        scrollbar-width: thin;
                        scrollbar-color: #2B2B2B transparent;
                    }

                    .thin-grey-scrollbar::-webkit-scrollbar {
                        width: 4px;
                        height: 4px;
                    }

                    .thin-grey-scrollbar::-webkit-scrollbar-track {
                        background: transparent;
                    }

                    .thin-grey-scrollbar::-webkit-scrollbar-thumb {
                        background: linear-gradient(
                            to bottom,
                            transparent 0%,
                            transparent 25%,
                            #2B2B2B 25%,
                            #2B2B2B 75%,
                            transparent 75%,
                            transparent 100%
                        );
                        border-radius: 999px;
                    }

                    .thin-grey-scrollbar::-webkit-scrollbar-thumb:hover {
                        background: linear-gradient(
                            to bottom,
                            transparent 0%,
                            transparent 25%,
                            #2B2B2B 25%,
                            #2B2B2B 75%,
                            transparent 75%,
                            transparent 100%
                        );
                    }
                `;
                document.head.appendChild(style);
            }
        }, []);
        return /*#__PURE__*/ _jsx(Component, { ...props,
            className: `${props.className||""} thin-grey-scrollbar`,
            style: { ...props.style
            }
        });
    };
}
export const __FramerMetadata__ = {
    "exports": {
        "ThinGreyScrollbar": {
            "type": "reactHoc",
            "name": "ThinGreyScrollbar",
            "annotations": {
                "framerContractVersion": "1"
            }
        },
        "__FramerMetadata__": {
            "type": "variable"
        }
    }
}
//# sourceMappingURL=./HideScrollbar.map