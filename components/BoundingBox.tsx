import React, { useEffect, useRef, useState, useLayoutEffect, useCallback } from 'react';

interface BoundingBoxProps {
    selectedElementIds: string[];
    svgElement: SVGSVGElement | null;
    onCommit: (changedWordIds?: string[]) => void;
}

export const BoundingBox: React.FC<BoundingBoxProps> = ({
    selectedElementIds,
    svgElement,
    onCommit
}) => {
    const uiGroupRef = useRef<SVGGElement>(null);
    const gizmoGroupRef = useRef<SVGGElement>(null);

    const [mode, setMode] = useState<'drag' | 'rotate' | 'resize' | null>(null);
    const [bbox, setBbox] = useState<{ x: number, y: number, width: number, height: number } | null>(null);
    const pointerCaptureRef = useRef<Element | null>(null);

    // Guard: prevent updateGizmo from resetting the gizmo during active tspan rotation
    const isRotatingTspans = useRef<boolean>(false);

    const dragState = useRef<{
        startPoint: { x: number, y: number };
        startClientPos: { x: number, y: number };
        startMatrix: DOMMatrix | null;
        transformOrigin: { x: number, y: number };
        startAngle: number;
        startDist: number;
        elements: SVGGraphicsElement[];
        startMatrices: DOMMatrix[];
        startPositions: { x: number, y: number, shouldMove: boolean }[];
        startFontSizes: number[];
        // For tspan rotation: parent <text> elements (possibly split) and their initial transforms
        parentTextElements: SVGGraphicsElement[];
        parentStartMatrices: DOMMatrix[];
        splitParentMappings: { tempText: SVGElement; originalText: SVGElement }[];
        // Frozen CTM snapshot taken at pointer-down to prevent feedback loops
        startScreenCTM: DOMMatrix | null;
        startCenterOnScreen: { x: number, y: number };
        currentAngle: number;
    }>({
        startPoint: { x: 0, y: 0 },
        startClientPos: { x: 0, y: 0 },
        startMatrix: null,
        transformOrigin: { x: 0, y: 0 },
        startAngle: 0,
        startDist: 0,
        elements: [],
        startMatrices: [],
        startPositions: [],
        startFontSizes: [],
        parentTextElements: [],
        parentStartMatrices: [],
        splitParentMappings: [],
        startScreenCTM: null,
        startCenterOnScreen: { x: 0, y: 0 },
        currentAngle: 0,
    });

    const cloneMatrix = (m: DOMMatrix) => {
        return new DOMMatrix([m.a, m.b, m.c, m.d, m.e, m.f]);
    };

    const ensureIdentityTransform = (el: SVGGraphicsElement) => {
        const transforms = el.transform.baseVal;
        if (transforms.length === 0 && svgElement) {
            const t = svgElement.createSVGTransform();
            transforms.appendItem(t);
        }
        if (transforms.length > 1) {
            transforms.consolidate();
        }
        if (transforms.length === 0 && svgElement) {
            const t = svgElement.createSVGTransform();
            transforms.appendItem(t);
        }
        if (transforms.length === 0) {
            return new DOMMatrix();
        }
        return cloneMatrix(transforms.getItem(0).matrix);
    };

    const matrixToString = (m: DOMMatrix) => `matrix(${m.a},${m.b},${m.c},${m.d},${m.e},${m.f})`;

    const applyMatrixToElement = (el: SVGGraphicsElement, m: DOMMatrix) => {
        try {
            ensureIdentityTransform(el);
            el.transform.baseVal.getItem(0).setMatrix(m);
        } catch {
            // Fallback path for cases where SVGTransformList is not writable.
        }
        el.setAttribute('transform', matrixToString(m));
    };

    const resolveElementById = (id: string): SVGGraphicsElement | null => {
        if (!id) return null;
        let el: SVGGraphicsElement | null = null;
        if (svgElement) {
            try {
                el = svgElement.querySelector<SVGGraphicsElement>(`#${CSS.escape(id)}`);
            } catch {
                el = svgElement.querySelector<SVGGraphicsElement>(`#${id}`);
            }
            // Ignore stale/disconnected nodes that may belong to a previous SVG tree.
            if (el && (!el.isConnected || (el.ownerSVGElement && el.ownerSVGElement !== svgElement))) {
                el = null;
            }
            if (el && el.closest('defs')) {
                let candidates: SVGGraphicsElement[] = [];
                try {
                    candidates = Array.from(svgElement.querySelectorAll<SVGGraphicsElement>(`#${CSS.escape(id)}`));
                } catch {
                    candidates = Array.from(svgElement.querySelectorAll<SVGGraphicsElement>(`#${id}`));
                }
                const visible = candidates.find(candidate => candidate.isConnected && !candidate.closest('defs'));
                if (visible) el = visible;
            }
        }
        if (!el) {
            el = document.getElementById(id) as unknown as SVGGraphicsElement;
        }
        if (el && !el.isConnected) {
            return null;
        }
        return el || null;
    };

    const getTargetElements = (): SVGGraphicsElement[] => {
        if (!selectedElementIds || selectedElementIds.length === 0) return [];
        const els: SVGGraphicsElement[] = [];
        for (const id of selectedElementIds) {
            const el = resolveElementById(id);
            if (el) els.push(el);
        }
        return els;
    };

    const areElementsTspans = (els: SVGGraphicsElement[]) => {
        return els.length > 0 && els.every(el => el.tagName.toLowerCase() === 'tspan');
    };

    // --- Split <text> element so selected tspans get their own parent ---
    // This allows rotating only the selected word without affecting siblings.
    const splitTextForRotation = (selectedEls: SVGGraphicsElement[]): {
        parentTextElements: SVGGraphicsElement[];
        splitParentMappings: { tempText: SVGElement; originalText: SVGElement }[];
    } => {
        if (!svgElement) {
            return { parentTextElements: [], splitParentMappings: [] };
        }

        // Group selected tspans by their parent <text> element
        const byParent = new Map<Element, SVGGraphicsElement[]>();
        selectedEls.forEach(el => {
            const parent = el.parentElement;
            if (!parent) return;
            if (!byParent.has(parent)) byParent.set(parent, []);
            byParent.get(parent)!.push(el);
        });

        const resultParents: SVGGraphicsElement[] = [];
        const splitParentMappings: { tempText: SVGElement; originalText: SVGElement }[] = [];

        byParent.forEach((selectedTspans, parentText) => {
            const allChildren = Array.from(parentText.childNodes);
            const selectedSet = new Set<Node>(selectedTspans);

            // Check if ALL children are selected — if so, no split needed
            const hasUnselected = allChildren.some(child => {
                if (child.nodeType === Node.ELEMENT_NODE && (child as Element).tagName.toLowerCase() === 'tspan') {
                    return !selectedSet.has(child);
                }
                return false; // ignore text nodes, spaces etc.
            });

            if (!hasUnselected) {
                // All tspans selected — rotate parent directly
                const textEl = parentText as SVGGraphicsElement;
                ensureIdentityTransform(textEl);
                resultParents.push(textEl);
                return;
            }

            // Need to split: give ALL tspans explicit positions before moving them
            const allTspans = allChildren.filter(
                c => c.nodeType === Node.ELEMENT_NODE && (c as Element).tagName.toLowerCase() === 'tspan'
            ) as SVGElement[];

            // Capture each tspan's actual position using getStartPositionOfChar
            allTspans.forEach(tspan => {
                if (tspan.hasAttribute('x') && tspan.hasAttribute('y')) return; // already explicit
                try {
                    const textContent = tspan as unknown as SVGTextContentElement;
                    if (textContent.getNumberOfChars && textContent.getNumberOfChars() > 0) {
                        const pos = textContent.getStartPositionOfChar(0);
                        tspan.setAttribute('x', String(pos.x));
                        tspan.setAttribute('y', String(pos.y));
                    }
                } catch (e) {
                    // Space tspans might fail — use parent text position as fallback
                    if (!tspan.hasAttribute('x')) {
                        tspan.setAttribute('x', parentText.getAttribute('x') || '0');
                    }
                    if (!tspan.hasAttribute('y')) {
                        tspan.setAttribute('y', parentText.getAttribute('y') || '0');
                    }
                }
            });

            // Create new <text> with same attributes (but no children)
            const newText = parentText.cloneNode(false) as SVGElement;
            // Remove any transform from cloned text (start fresh)
            newText.removeAttribute('transform');
            if (newText.hasAttribute('id')) {
                newText.removeAttribute('id');
            }

            // Move selected tspans to the new <text>
            selectedTspans.forEach(tspan => {
                newText.appendChild(tspan);
            });

            // Insert new <text> after original
            parentText.parentNode!.insertBefore(newText, parentText.nextSibling);

            // Ensure new text has an identity transform for rotation
            const textGraphics = newText as unknown as SVGGraphicsElement;
            ensureIdentityTransform(textGraphics);
            resultParents.push(textGraphics);
            splitParentMappings.push({
                tempText: newText,
                originalText: parentText as SVGElement
            });
        });

        return { parentTextElements: resultParents, splitParentMappings };
    };

    // --- CORE LOGIC: MATRIX PROJECTION ---
    const updateGizmo = useCallback(() => {
        // Don't recalculate during active tspan rotation — the gizmo is managed manually
        if (isRotatingTspans.current) return;

        if (!svgElement || selectedElementIds.length === 0 || !uiGroupRef.current || !gizmoGroupRef.current) {
            return;
        }

        const els = getTargetElements();
        if (els.length === 0) {
            setBbox(null);
            return;
        }

        try {
            let firstEl = els[0];
            if (firstEl.tagName.toLowerCase() === 'tspan' && firstEl.parentElement instanceof SVGGraphicsElement) {
                firstEl = firstEl.parentElement;
            }

            const firstElCTM = firstEl.getScreenCTM();
            const uiCTM = uiGroupRef.current.getScreenCTM();

            if (!firstElCTM || !uiCTM) return;

            const inverseFirstCTM = firstElCTM.inverse();
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

            els.forEach(el => {
                const elCTM = el.getScreenCTM();
                if (!elCTM) return;

                let corners: { x: number, y: number }[];

                if (el.tagName.toLowerCase() === 'tspan') {
                    const rect = el.getBoundingClientRect();
                    if (rect.width === 0 && rect.height === 0) return;

                    const invElCTM = elCTM.inverse();
                    const screenCorners = [
                        new DOMPoint(rect.left, rect.top).matrixTransform(invElCTM),
                        new DOMPoint(rect.right, rect.top).matrixTransform(invElCTM),
                        new DOMPoint(rect.right, rect.bottom).matrixTransform(invElCTM),
                        new DOMPoint(rect.left, rect.bottom).matrixTransform(invElCTM),
                    ];
                    const m = inverseFirstCTM.multiply(elCTM);
                    corners = screenCorners.map(c => {
                        const pt = svgElement.createSVGPoint();
                        pt.x = c.x; pt.y = c.y;
                        return pt.matrixTransform(m);
                    });
                } else {
                    const b = el.getBBox();
                    const m = inverseFirstCTM.multiply(elCTM);
                    corners = [
                        { x: b.x, y: b.y },
                        { x: b.x + b.width, y: b.y },
                        { x: b.x + b.width, y: b.y + b.height },
                        { x: b.x, y: b.y + b.height }
                    ].map(p => {
                        const pt = svgElement.createSVGPoint();
                        pt.x = p.x; pt.y = p.y;
                        return pt.matrixTransform(m);
                    });
                }

                corners.forEach(transP => {
                    minX = Math.min(minX, transP.x);
                    minY = Math.min(minY, transP.y);
                    maxX = Math.max(maxX, transP.x);
                    maxY = Math.max(maxY, transP.y);
                });
            });

            if (minX === Infinity) {
                setBbox(null);
                return;
            }

            const newBBox = { x: minX, y: minY, width: maxX - minX, height: maxY - minY };

            setBbox(prev => {
                if (prev &&
                    Math.abs(prev.x - newBBox.x) < 0.01 &&
                    Math.abs(prev.y - newBBox.y) < 0.01 &&
                    Math.abs(prev.width - newBBox.width) < 0.01 &&
                    Math.abs(prev.height - newBBox.height) < 0.01
                ) {
                    return prev;
                }
                return newBBox;
            });

            const m = uiCTM.inverse().multiply(firstElCTM);
            let matrixStr = `matrix(${m.a},${m.b},${m.c},${m.d},${m.e},${m.f})`;
            if (areElementsTspans(els)) {
                const rotations = els
                    .map(el => {
                        const raw = el.getAttribute('data-word-rot') || el.getAttribute('rotate') || '';
                        const value = parseFloat(raw);
                        return Number.isFinite(value) ? value : null;
                    })
                    .filter((value): value is number => value !== null);
                if (rotations.length > 0) {
                    const avgRotation = rotations.reduce((sum, value) => sum + value, 0) / rotations.length;
                    if (Math.abs(avgRotation) > 0.01) {
                        const cx = newBBox.x + newBBox.width / 2;
                        const cy = newBBox.y + newBBox.height / 2;
                        matrixStr += ` translate(${cx} ${cy}) rotate(${avgRotation}) translate(${-cx} ${-cy})`;
                    }
                }
            }
            gizmoGroupRef.current.setAttribute('transform', matrixStr);

        } catch (e) {
            console.warn('BoundingBox update error:', e);
        }
    }, [svgElement, selectedElementIds]);

    useLayoutEffect(() => {
        if (!svgElement) return;
        const update = () => updateGizmo();
        const ro = new ResizeObserver(update);
        ro.observe(svgElement);

        let frameId: number;
        const startTime = performance.now();
        const tick = () => {
            update();
            if (performance.now() - startTime < 2000) {
                frameId = requestAnimationFrame(tick);
            }
        };
        tick();

        return () => {
            ro.disconnect();
            cancelAnimationFrame(frameId);
        };
    }, [svgElement, selectedElementIds, updateGizmo]);

    useLayoutEffect(() => {
        updateGizmo();
    });

    useEffect(() => {
        const els = getTargetElements();
        if (els.length > 0) {
            const observer = new MutationObserver(updateGizmo);
            els.forEach(el => observer.observe(el, { attributes: true, attributeFilter: ['transform', 'x', 'y', 'font-size'] }));
            return () => observer.disconnect();
        }
    }, [selectedElementIds, svgElement]);

    useEffect(() => {
        window.addEventListener('resize', updateGizmo);
        window.addEventListener('scroll', updateGizmo, true);
        return () => {
            window.removeEventListener('resize', updateGizmo);
            window.removeEventListener('scroll', updateGizmo, true);
        };
    }, []);

    // --- INTERACTION LOGIC ---

    const getMouseInParentSpace = (clientX: number, clientY: number, el: SVGElement) => {
        if (!svgElement) return { x: 0, y: 0 };
        const pt = svgElement.createSVGPoint();
        pt.x = clientX;
        pt.y = clientY;
        const parent = el.parentNode as SVGGraphicsElement;
        const parentCTM = parent && parent.getScreenCTM ? parent.getScreenCTM() : svgElement.getScreenCTM();
        if (!parentCTM) {
            console.warn('getMouseInParentSpace: No parentCTM found for', el);
            return { x: 0, y: 0 };
        }
        return pt.matrixTransform(parentCTM.inverse());
    };

    const getMouseInElementSpace = (clientX: number, clientY: number, el: SVGGraphicsElement) => {
        if (!svgElement) return { x: 0, y: 0 };
        const pt = svgElement.createSVGPoint();
        pt.x = clientX;
        pt.y = clientY;
        const elCTM = el.getScreenCTM();
        if (!elCTM) return { x: 0, y: 0 };
        return pt.matrixTransform(elCTM.inverse());
    };

    // Freeze unselected sibling tspans so they don't follow selected ones during drag.
    // SVG text flow positions tspans without explicit x/y relative to the text cursor;
    // when the selected tspans move, the flow re-positions siblings. Freezing prevents this.
    const freezeSiblingTspanPositions = (selectedEls: SVGGraphicsElement[]) => {
        const selectedSet = new Set<Node>(selectedEls);
        const processedParents = new Set<Element>();

        selectedEls.forEach(el => {
            const parent = el.parentElement;
            if (!parent || processedParents.has(parent)) return;
            processedParents.add(parent);

            const allTspans = Array.from(parent.querySelectorAll('tspan'));
            allTspans.forEach(tspan => {
                if (selectedSet.has(tspan)) return; // skip selected ones
                if (tspan.hasAttribute('x') && tspan.hasAttribute('y')) return; // already frozen
                try {
                    const tc = tspan as unknown as SVGTextContentElement;
                    if (tc.getNumberOfChars && tc.getNumberOfChars() > 0) {
                        const pos = tc.getStartPositionOfChar(0);
                        tspan.setAttribute('x', String(pos.x));
                        tspan.setAttribute('y', String(pos.y));
                    }
                } catch {
                    // Fallback: use parent text position
                    if (!tspan.hasAttribute('x')) tspan.setAttribute('x', parent.getAttribute('x') || '0');
                    if (!tspan.hasAttribute('y')) tspan.setAttribute('y', parent.getAttribute('y') || '0');
                }
            });
        });
    };

    const handlePointerDown = (e: React.PointerEvent, tool: 'drag' | 'rotate' | 'resize') => {
        if (!svgElement || selectedElementIds.length === 0) return;
        e.stopPropagation();
        e.preventDefault();
        const captureEl = e.currentTarget as Element;
        if (captureEl && captureEl.setPointerCapture) {
            captureEl.setPointerCapture(e.pointerId);
            pointerCaptureRef.current = captureEl;
        }

        const els = getTargetElements();
        if (els.length === 0) return;

        setMode(tool);

        const isTspans = areElementsTspans(els);

        // Freeze sibling tspans BEFORE capturing start positions
        if (isTspans) {
            freezeSiblingTspanPositions(els);
        }

        const startMatrices = els.map(el => {
            if (el.tagName.toLowerCase() === 'tspan') {
                return new DOMMatrix(); // identity
            }
            return ensureIdentityTransform(el);
        });

        const startPositions = els.map((el) => {
            let x = 0, y = 0, shouldMove = false;

            if (el.tagName.toLowerCase() === 'tspan') {
                // Ensure this tspan has explicit x/y for independent movement
                if (el.hasAttribute('x') && el.hasAttribute('y')) {
                    x = parseFloat(el.getAttribute('x') || '0');
                    y = parseFloat(el.getAttribute('y') || '0');
                } else {
                    // Resolve actual position and set explicit attributes
                    try {
                        const tc = el as unknown as SVGTextContentElement;
                        if (tc.getNumberOfChars && tc.getNumberOfChars() > 0) {
                            const pos = tc.getStartPositionOfChar(0);
                            x = pos.x;
                            y = pos.y;
                            el.setAttribute('x', String(x));
                            el.setAttribute('y', String(y));
                        }
                    } catch {
                        const parent = el.parentElement as unknown as SVGElement;
                        if (parent && parent.tagName.toLowerCase() === 'text') {
                            x = parseFloat(parent.getAttribute('x') || '0');
                            y = parseFloat(parent.getAttribute('y') || '0');
                        }
                        el.setAttribute('x', String(x));
                        el.setAttribute('y', String(y));
                    }
                }
                shouldMove = true;
            } else if (el.hasAttribute('x') && el.hasAttribute('y')) {
                x = parseFloat(el.getAttribute('x') || '0');
                y = parseFloat(el.getAttribute('y') || '0');
                shouldMove = true;
            }
            return { x, y, shouldMove };
        });

        const startFontSizes = els.map(el => {
            const style = window.getComputedStyle(el);
            return parseFloat(style.fontSize || '16');
        });

        // For tspan rotation: split <text> elements so selected tspans
        // have their own parent, then rotate the parent via transform.
        let parentTextElements: SVGGraphicsElement[] = [];
        let parentStartMatrices: DOMMatrix[] = [];
        let splitParentMappings: { tempText: SVGElement; originalText: SVGElement }[] = [];
        if (isTspans && tool === 'rotate') {
            const splitResult = splitTextForRotation(els);
            parentTextElements = splitResult.parentTextElements;
            splitParentMappings = splitResult.splitParentMappings;
            parentStartMatrices = parentTextElements.map(textEl => {
                return ensureIdentityTransform(textEl);
            });
            isRotatingTspans.current = true;
        }

        const firstEl = els[0];
        const ptParent = getMouseInParentSpace(e.clientX, e.clientY, firstEl);
        const startPoint = { x: ptParent.x, y: ptParent.y };

        if (!bbox) return;
        const cx = bbox.x + bbox.width / 2;
        const cy = bbox.y + bbox.height / 2;
        const transformOrigin = { x: cx, y: cy };

        // Snapshot the reference element's CTM at pointer-down.
        // This prevents feedback loops where a changing CTM drifts the rotation center.
        const refEl = (isTspans && parentTextElements.length > 0)
            ? parentTextElements[0]
            : (firstEl.tagName.toLowerCase() === 'tspan' && firstEl.parentElement instanceof SVGGraphicsElement
                ? firstEl.parentElement
                : firstEl);
        const startScreenCTM = refEl.getScreenCTM() || null;

        let startAngle = 0;
        let startDist = 0;
        let startCenterOnScreen = { x: 0, y: 0 };

        if (startScreenCTM) {
            // Pre-compute center on screen using the frozen CTM
            const pt = svgElement.createSVGPoint();
            pt.x = transformOrigin.x; pt.y = transformOrigin.y;
            const cs = pt.matrixTransform(startScreenCTM);
            startCenterOnScreen = { x: cs.x, y: cs.y };
        }

        if (tool === 'rotate' && startScreenCTM) {
            // Use frozen center on screen for initial angle
            startAngle = Math.atan2(
                e.clientY - startCenterOnScreen.y,
                e.clientX - startCenterOnScreen.x
            );
        } else if (tool === 'resize' && startScreenCTM) {
            // Use frozen CTM to compute distance in element space
            const pt = svgElement.createSVGPoint();
            pt.x = e.clientX; pt.y = e.clientY;
            const ptEl = pt.matrixTransform(startScreenCTM.inverse());
            startDist = Math.hypot(ptEl.x - transformOrigin.x, ptEl.y - transformOrigin.y);
        }

        dragState.current = {
            startPoint,
            startClientPos: { x: e.clientX, y: e.clientY },
            startMatrix: startMatrices[0],
            startMatrices,
            startPositions,
            startFontSizes,
            transformOrigin,
            startAngle,
            startDist,
            elements: els,
            parentTextElements,
            parentStartMatrices,
            splitParentMappings,
            startScreenCTM,
            startCenterOnScreen,
            currentAngle: 0,
        };
    };

    const handlePointerMove = (e: React.PointerEvent) => {
        if (!mode || dragState.current.elements.length === 0 || !svgElement) return;
        e.preventDefault();
        e.stopPropagation();

        const { elements, startMatrices, startPositions, startFontSizes, startPoint,
            transformOrigin, startAngle, startDist, parentTextElements, parentStartMatrices } = dragState.current;

        const firstEl = elements[0];
        const isTspanGroup = areElementsTspans(elements);

        if (mode === 'drag') {
            const pt = getMouseInParentSpace(e.clientX, e.clientY, firstEl);
            const dx = pt.x - startPoint.x;
            const dy = pt.y - startPoint.y;

            if (isTspanGroup) {
                elements.forEach((el, i) => {
                    const startPos = startPositions[i];
                    if (startPos.shouldMove) {
                        el.setAttribute('x', String(startPos.x + dx));
                        el.setAttribute('y', String(startPos.y + dy));
                    }
                });
            } else {
                const screenDx = e.clientX - dragState.current.startClientPos.x;
                const screenDy = e.clientY - dragState.current.startClientPos.y;

                const parent = firstEl.parentNode as SVGGraphicsElement;
                const parentCTM = (parent && parent.getScreenCTM) ? parent.getScreenCTM() : svgElement.getScreenCTM();
                if (!parentCTM) return;

                const inv = parentCTM.inverse();
                const dx = inv.a * screenDx + inv.c * screenDy;
                const dy = inv.b * screenDx + inv.d * screenDy;

                elements.forEach((el, i) => {
                    const startM = startMatrices[i];
                    // Modify e/f directly — this translates in parent space
                    const newM = new DOMMatrix([startM.a, startM.b, startM.c, startM.d,
                    startM.e + dx, startM.f + dy]);
                    applyMatrixToElement(el, newM);
                });
            }

        } else if (mode === 'rotate') {
            // Use the frozen center-on-screen from pointer-down to avoid feedback loops.
            // The live CTM changes with each rotation increment, drifting the center.
            const frozenCenter = dragState.current.startCenterOnScreen;
            const angleNow = Math.atan2(e.clientY - frozenCenter.y, e.clientX - frozenCenter.x);
            const angleDeg = (angleNow - startAngle) * (180 / Math.PI);
            dragState.current.currentAngle = angleDeg;

            if (isTspanGroup && parentTextElements.length > 0) {
                // Tspan rotation via parent <text> transform.
                // Post-multiply: transformOrigin is in the element's LOCAL space.
                parentTextElements.forEach((textEl, i) => {
                    const startM = parentStartMatrices[i];
                    const m = startM
                        .translate(transformOrigin.x, transformOrigin.y)
                        .rotate(angleDeg)
                        .translate(-transformOrigin.x, -transformOrigin.y);
                    applyMatrixToElement(textEl, m);
                });

                // Sync gizmo visual to match
                if (gizmoGroupRef.current && uiGroupRef.current) {
                    const uiCTM = uiGroupRef.current.getScreenCTM();
                    const newParentCTM = parentTextElements[0].getScreenCTM();
                    if (uiCTM && newParentCTM) {
                        const m = uiCTM.inverse().multiply(newParentCTM);
                        gizmoGroupRef.current.setAttribute('transform',
                            `matrix(${m.a},${m.b},${m.c},${m.d},${m.e},${m.f})`
                        );
                    }
                }
            } else {
                // Non-tspan elements: rotate via their own transform.
                // Post-multiply: startM * T(origin) * R(angle) * T(-origin)
                // because transformOrigin is in the element's local space.
                elements.forEach((el, i) => {
                    const startM = startMatrices[i];
                    const m = startM
                        .translate(transformOrigin.x, transformOrigin.y)
                        .rotate(angleDeg)
                        .translate(-transformOrigin.x, -transformOrigin.y);
                    applyMatrixToElement(el, m);
                });
            }
        } else if (mode === 'resize') {
            // Use frozen CTM to compute current mouse position in element space
            const frozenCTM = dragState.current.startScreenCTM;
            let distNow = startDist;
            if (frozenCTM) {
                const pt = svgElement.createSVGPoint();
                pt.x = e.clientX; pt.y = e.clientY;
                const ptEl = pt.matrixTransform(frozenCTM.inverse());
                distNow = Math.hypot(ptEl.x - transformOrigin.x, ptEl.y - transformOrigin.y);
            }
            const scaleFactor = distNow / (startDist || 1);

            if (isTspanGroup) {
                elements.forEach((el, i) => {
                    const startSize = startFontSizes[i];
                    if (startSize > 0) {
                        el.setAttribute('font-size', String(startSize * scaleFactor));
                        const startPos = startPositions[i];
                        if (startPos.shouldMove) {
                            const relativeX = startPos.x - transformOrigin.x;
                            const relativeY = startPos.y - transformOrigin.y;
                            el.setAttribute('x', String(transformOrigin.x + relativeX * scaleFactor));
                            el.setAttribute('y', String(transformOrigin.y + relativeY * scaleFactor));
                        }
                    }
                });
            } else {
                // Post-multiply: startM * T(origin) * S(scale) * T(-origin)
                elements.forEach((el, i) => {
                    const startM = startMatrices[i];
                    const m = startM
                        .translate(transformOrigin.x, transformOrigin.y)
                        .scale(scaleFactor)
                        .translate(-transformOrigin.x, -transformOrigin.y);
                    applyMatrixToElement(el, m);
                });
            }
        }

        // Don't recalculate bbox during tspan rotation (gizmo is managed above)
        if (!isRotatingTspans.current) {
            updateGizmo();
        }
    };

    const handlePointerUp = (e: React.PointerEvent) => {
        if (mode) {
            const wasTspanRotation = isRotatingTspans.current;
            if (wasTspanRotation && svgElement) {
                const { elements, startPositions, transformOrigin, parentTextElements, parentStartMatrices, currentAngle } = dragState.current;
                const angleDeg = Number.isFinite(currentAngle) ? currentAngle : 0;
                const rad = (angleDeg * Math.PI) / 180;
                const cos = Math.cos(rad);
                const sin = Math.sin(rad);

                elements.forEach((el, i) => {
                    if (el.tagName.toLowerCase() !== 'tspan') return;
                    const startPos = startPositions[i];
                    if (!startPos || !startPos.shouldMove) return;
                    const dx = startPos.x - transformOrigin.x;
                    const dy = startPos.y - transformOrigin.y;
                    const nx = transformOrigin.x + dx * cos - dy * sin;
                    const ny = transformOrigin.y + dx * sin + dy * cos;
                    el.setAttribute('x', String(nx));
                    el.setAttribute('y', String(ny));

                    const startRotAttr = el.getAttribute('data-word-rot') || el.getAttribute('rotate');
                    const startRot = startRotAttr ? parseFloat(startRotAttr) : 0;
                    const baseRot = Number.isFinite(startRot) ? startRot : 0;
                    const nextRot = baseRot + angleDeg;
                    if (Number.isFinite(nextRot)) {
                        el.setAttribute('rotate', nextRot.toString());
                        el.setAttribute('data-word-rot', nextRot.toString());
                        el.setAttribute('data-word-manual', '1');
                    }
                });

                parentTextElements.forEach((textEl, i) => {
                    ensureIdentityTransform(textEl);
                    const startM = parentStartMatrices[i];
                    if (startM) {
                        applyMatrixToElement(textEl, startM);
                    }
                });

                // Merge temporary split nodes back into original <text> nodes.
                // If we leave split wrappers in DOM, later SVG rebuilds can keep stale
                // tspans alive and produce non-interactive visual duplicates.
                const { splitParentMappings } = dragState.current;
                splitParentMappings.forEach(({ tempText, originalText }) => {
                    if (!tempText.isConnected) return;
                    const children = Array.from(tempText.childNodes);
                    if (originalText.isConnected) {
                        children.forEach((child) => {
                            if (child.nodeType === Node.ELEMENT_NODE || child.nodeType === Node.TEXT_NODE) {
                                originalText.appendChild(child);
                            }
                        });
                    }
                    tempText.remove();
                });
                dragState.current.splitParentMappings = [];
            }
            isRotatingTspans.current = false;
            setMode(null);

            // Collect affected word IDs from selected elements
            const els = getTargetElements();
            const changedWordIds: string[] = [];
            const seen = new Set<string>();
            els.forEach(el => {
                const wid = el.getAttribute('data-word-id');
                if (wid && !seen.has(wid)) {
                    seen.add(wid);
                    changedWordIds.push(wid);
                }
            });

            onCommit(changedWordIds.length > 0 ? changedWordIds : undefined);
            const captureEl = pointerCaptureRef.current;
            if (captureEl && captureEl.releasePointerCapture) {
                try {
                    captureEl.releasePointerCapture(e.pointerId);
                } catch {
                    // no-op: pointer may have already been released
                }
            }
            pointerCaptureRef.current = null;
            if (wasTspanRotation) {
                updateGizmo();
            }
        }
    };

    // Render
    if (!selectedElementIds || selectedElementIds.length === 0) return null;

    return (
        <g
            ref={uiGroupRef}
            className="ui-layer"
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
        >
            <g ref={gizmoGroupRef}>
                {bbox && (
                    <>
                        <rect
                            x={bbox.x} y={bbox.y} width={bbox.width} height={bbox.height}
                            className="gizmo-rect"
                            style={{ pointerEvents: 'all' }}
                            onPointerDown={(e) => handlePointerDown(e, 'drag')}
                            onPointerMove={handlePointerMove}
                            onPointerUp={handlePointerUp}
                            onPointerCancel={handlePointerUp}
                        />
                        <line
                            x1={bbox.x + bbox.width / 2} y1={bbox.y} x2={bbox.x + bbox.width / 2} y2={bbox.y - 30}
                            stroke="#00aaff" vectorEffect="non-scaling-stroke"
                        />
                        <circle
                            cx={bbox.x + bbox.width / 2} cy={bbox.y - 30} r={5}
                            className="handle rotator"
                            style={{ pointerEvents: 'all' }}
                            onPointerDown={(e) => handlePointerDown(e, 'rotate')}
                            onPointerMove={handlePointerMove}
                            onPointerUp={handlePointerUp}
                            onPointerCancel={handlePointerUp}
                        />
                        <circle
                            cx={bbox.x + bbox.width} cy={bbox.y + bbox.height} r={5}
                            className="handle resizer"
                            style={{ pointerEvents: 'all' }}
                            onPointerDown={(e) => handlePointerDown(e, 'resize')}
                            onPointerMove={handlePointerMove}
                            onPointerUp={handlePointerUp}
                            onPointerCancel={handlePointerUp}
                        />
                    </>
                )}
            </g>
        </g>
    );
};
