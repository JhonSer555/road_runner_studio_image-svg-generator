
import { Word, Letter, TextMeasureStyle } from '../types';

export const normalizeFontSizeValue = (val: string | undefined | null): string | undefined => {
    if (!val) return undefined;
    return val.endsWith('px') ? val : `${val}px`;
};

export const normalizeSvgText = (text: string) => text.replace(/\s+/g, ' ').trim();

export const getWordText = (word: Word) => word.letters.map(letter => letter.char).join('');

export const measureTextWidthPx = (text: string, style: TextMeasureStyle): number | null => {
    if (typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const fontStyle = style.fontStyle || 'normal';
    const fontWeight = style.fontWeight || 'normal';
    const fontSize = style.fontSize || '16px';
    const fontFamily = style.fontFamily || 'sans-serif';
    ctx.font = `${fontStyle} ${fontWeight} ${fontSize} ${fontFamily}`;

    const metrics = ctx.measureText(text || '');
    let width = metrics.width;

    const letterSpacing = style.letterSpacing;
    if (letterSpacing && letterSpacing !== 'normal') {
        const spacing = parseFloat(letterSpacing);
        if (Number.isFinite(spacing) && text.length > 1) {
            width += spacing * (text.length - 1);
        }
    }

    return width;
};

export const computeWordLetterPositions = (word: Word, style: TextMeasureStyle): { x: number; y: number }[] => {
    const text = getWordText(word);
    const baseX = Number.isFinite(word.x ?? NaN) ? (word.x as number) : 0;
    const baseY = Number.isFinite(word.y ?? NaN) ? (word.y as number) : 0;
    const rotation = word.rotation ?? 0;
    const sx = word.scaleX ?? 1;
    const sy = word.scaleY ?? 1;

    const totalWidth = measureTextWidthPx(text, style) ?? 0;
    const cx = baseX + totalWidth / 2;
    const cy = baseY;

    const rad = (rotation * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);

    const positions: { x: number; y: number }[] = [];
    for (let i = 0; i < word.letters.length; i += 1) {
        const offset = measureTextWidthPx(text.slice(0, i), style) ?? 0;
        // Calculate unrotated position relative to center, then apply scale
        const dx = ((baseX + offset) - cx) * sx;
        const dy = (baseY - cy) * sy;

        // Rotate around center
        const x = cx + dx * cos - dy * sin;
        const y = cy + dx * sin + dy * cos;

        positions.push({ x, y });
    }

    return positions;
};

export const computeNewWordState = (
    word: Word,
    newText: string,
    currentPreviewPositions: { x: number; y: number }[] | null,
    computedStyle: CSSStyleDeclaration | null | undefined
): Word => {
    const baseLetter = word.letters.length > 0 ? word.letters[0] : null;
    const animation = baseLetter?.animation || { duration: 0.5, delay: 0.05, easing: 'ease-out' };
    const resolvedFontSize = normalizeFontSizeValue(computedStyle?.fontSize)
        || normalizeFontSizeValue(baseLetter?.fontSize)
        || '16px';

    const measureStyle: TextMeasureStyle = {
        fontStyle: baseLetter?.fontStyle || computedStyle?.fontStyle || 'normal',
        fontWeight: baseLetter?.fontWeight || computedStyle?.fontWeight || 'normal',
        fontSize: resolvedFontSize,
        fontFamily: baseLetter?.fontFamily || computedStyle?.fontFamily || 'sans-serif',
        letterSpacing: baseLetter?.letterSpacing || computedStyle?.letterSpacing || 'normal'
    };

    const rotation = word.rotation ?? 0;
    const rotationRad = (rotation * Math.PI) / 180;
    const dirX = Math.cos(rotationRad);
    const dirY = Math.sin(rotationRad);
    const advanceScale = word.scaleX ?? 1;

    const fallbackAnchorX = Number.isFinite(word.x ?? NaN) ? (word.x as number) : 0;
    const fallbackAnchorY = Number.isFinite(word.y ?? NaN) ? (word.y as number) : 0;
    const firstPreviewPos = currentPreviewPositions && currentPreviewPositions.length > 0
        ? currentPreviewPositions[0]
        : null;
    const firstLetterPos = word.letters.length > 0
        && Number.isFinite(word.letters[0].x ?? NaN)
        && Number.isFinite(word.letters[0].y ?? NaN)
        ? { x: word.letters[0].x as number, y: word.letters[0].y as number }
        : null;

    const anchorX = firstPreviewPos?.x ?? firstLetterPos?.x ?? fallbackAnchorX;
    const anchorY = firstPreviewPos?.y ?? firstLetterPos?.y ?? fallbackAnchorY;

    const styleSpacingRaw = parseFloat(measureStyle.letterSpacing as string);
    let tracking = Number.isFinite(styleSpacingRaw) ? styleSpacingRaw : 0;

    const sourcePositions = (() => {
        if (currentPreviewPositions && currentPreviewPositions.length >= 2) {
            return currentPreviewPositions;
        }
        const fromWord = word.letters
            .map((letter) => {
                if (!Number.isFinite(letter.x ?? NaN) || !Number.isFinite(letter.y ?? NaN)) return null;
                return { x: letter.x as number, y: letter.y as number };
            })
            .filter((pos): pos is { x: number; y: number } => Boolean(pos));
        return fromWord.length >= 2 ? fromWord : null;
    })();

    if (sourcePositions && word.letters.length > 1) {
        const inferredTracking: number[] = [];
        const limit = Math.min(sourcePositions.length - 1, word.letters.length - 1);

        for (let i = 0; i < limit; i += 1) {
            const p0 = sourcePositions[i];
            const p1 = sourcePositions[i + 1];
            const advance = ((p1.x - p0.x) * dirX) + ((p1.y - p0.y) * dirY);
            if (!Number.isFinite(advance) || Math.abs(advance) < 0.001) continue;

            const charWidth = measureTextWidthPx(word.letters[i].char, measureStyle) ?? 0;
            const gap = advance - charWidth;
            if (Number.isFinite(gap) && gap > -50 && gap < 100) {
                inferredTracking.push(gap);
            }
        }

        if (inferredTracking.length > 0) {
            tracking = inferredTracking.reduce((sum, value) => sum + value, 0) / inferredTracking.length;
        }
    }

    let cursorX = anchorX;
    let cursorY = anchorY;
    const timestamp = Date.now();
    const newLetters: Letter[] = newText.split('').map((char, i) => {
        const letterX = cursorX;
        const letterY = cursorY;

        const charWidth = measureTextWidthPx(char, measureStyle) ?? 10;
        const advance = (charWidth + tracking) * advanceScale;
        cursorX += dirX * advance;
        cursorY += dirY * advance;

        return {
            id: `letter-${word.id}-${i}-${timestamp}-${Math.random().toString(36).slice(2, 7)}`,
            char,
            x: letterX,
            y: letterY,
            fill: baseLetter?.fill,
            stroke: baseLetter?.stroke,
            fontFamily: baseLetter?.fontFamily || computedStyle?.fontFamily || undefined,
            fontSize: resolvedFontSize,
            fontWeight: baseLetter?.fontWeight || computedStyle?.fontWeight || undefined,
            fontStyle: baseLetter?.fontStyle || computedStyle?.fontStyle || undefined,
            letterSpacing: baseLetter?.letterSpacing || (computedStyle?.letterSpacing || undefined),
            animation: {
                ...animation,
                delay: i * 0.05
            }
        };
    });

    return {
        ...word,
        letters: newLetters,
        x: anchorX,
        y: anchorY,
        isManual: true
    };
};
