import React, { useEffect, useState, useRef } from 'react';
import { BoundingBox } from './BoundingBox';

import { Word } from '../types';

interface GizmoOverlayProps {
    activeLayerId: string | null;
    activeWordId: string | null;
    selectedLetterIds: Set<string>;
    svgWords: Word[];
    onCommit: (changedWordIds?: string[]) => void;
}

export const GizmoOverlay: React.FC<GizmoOverlayProps> = ({
    activeLayerId,
    activeWordId,
    selectedLetterIds,
    svgWords,
    onCommit
}) => {
    // ... existing setup ...

    // State must come first
    const [viewBox, setViewBox] = useState<string>('0 0 100 100');
    const [svgElement, setSvgElement] = useState<SVGSVGElement | null>(null);
    const svgElementRef = useRef<SVGSVGElement | null>(null);

    // Sync viewBox with the content SVG
    useEffect(() => {
        const update = () => {
            const contentSvg = document.querySelector('[data-svg-preview="true"] svg') as SVGSVGElement;
            if (contentSvg) {
                setSvgElement(contentSvg);
                svgElementRef.current = contentSvg;
                const vb = contentSvg.getAttribute('viewBox');
                if (vb) {
                    setViewBox(prev => (vb !== prev ? vb : prev));
                }
            }
        };

        update();
        const observer = new MutationObserver(update);
        const contentContainer = document.querySelector('[data-svg-preview="true"]');
        if (contentContainer) {
            observer.observe(contentContainer, { childList: true, subtree: true, attributes: true });
        }

        window.addEventListener('resize', update);
        return () => {
            observer.disconnect();
            window.removeEventListener('resize', update);
        };
    }, []);

    // Determine what's selected — nothing? bail out.
    const hasActiveLayer = !!activeLayerId;
    const hasActiveWord = !!activeWordId;
    const hasSelectedLetters = selectedLetterIds.size > 0;

    if (!hasActiveLayer && !hasActiveWord && !hasSelectedLetters) return null;

    // Determine target element IDs
    let targetIds: string[] = [];

    if (hasSelectedLetters) {
        // Letter-level selection takes priority
        targetIds = Array.from(selectedLetterIds);
    } else if (hasActiveWord && activeWordId) {
        // Word selected — find the word in state and get its letter IDs
        const activeWord = svgWords.find(w => w.id === activeWordId);
        if (activeWord) {
            targetIds = activeWord.letters.map(l => l.id);
        } else {
            // Fallback: if somehow passing an ID not in state, try DOM query (legacy/safety)
            const contentSvg = svgElementRef.current || document.querySelector('[data-svg-preview="true"] svg') as SVGSVGElement;
            if (contentSvg) {
                const tspans = contentSvg.querySelectorAll<SVGElement>(`tspan[data-word-id="${activeWordId}"]`);
                targetIds = Array.from(tspans).map(el => el.id).filter(Boolean);
            }
        }

        // Final fallback: try the word ID directly
        if (targetIds.length === 0) {
            targetIds = [activeWordId];
        }
    } else if (hasActiveLayer) {
        // Layer (shape/path/group) selected
        const contentSvg = svgElementRef.current || document.querySelector('[data-svg-preview="true"] svg') as SVGSVGElement;
        if (contentSvg) {
            // Check if the id exists in the SVG (either direct id or data-layer-id)
            const el = contentSvg.getElementById(activeLayerId!) || contentSvg.querySelector(`[data-layer-id="${activeLayerId}"]`);
            targetIds = el ? [el.id] : [activeLayerId!];
        } else {
            targetIds = [activeLayerId!];
        }
    }

    if (targetIds.length === 0) return null;

    return (
        <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 50 }}>
            <svg
                width="100%"
                height="100%"
                viewBox={viewBox}
                style={{ overflow: 'visible' }}
            >
                <BoundingBox
                    selectedElementIds={targetIds}
                    svgElement={svgElement}
                    onCommit={onCommit}
                />
            </svg>
        </div>
    );
};
