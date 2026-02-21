/**
 * Road Runner Studio - Legal Notice
 * Non-blocking notice only: no keyboard/context menu/devtools blocking.
 */

export const initProtection = () => {
    if (typeof window === 'undefined') return;
    if ((window as any).__RR_LEGAL_NOTICE__) return;
    (window as any).__RR_LEGAL_NOTICE__ = true;

    console.log(
        "%cRoad Runner Studio%c  © 2026 @FDTiger777",
        "color:#3b82f6;font-weight:bold;font-size:13px",
        "color:#94a3b8;font-size:12px"
    );
    console.log(
        "%cAuthor:%c @FDTiger777",
        "color:#22c55e;font-size:12px;font-weight:bold;",
        "color:#60a5fa;font-size:12px;font-weight:bold"
    );
    console.log(
        "%cLegal Notice:%c Source code, brand assets and visual identity are proprietary. Unauthorized copying, resale, or redistribution is prohibited.",
        "color:#f59e0b;font-weight:bold;font-size:12px",
        "color:#cbd5e1;font-size:12px"
    );
};
