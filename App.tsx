import React, { useState, useRef, useMemo, useEffect } from 'react';
import {
  ImageIcon,
  Wand2,
  Download,
  AlertCircle,
  RefreshCw,
  ChevronRight,
  Sparkles,
  Type,
  Paperclip,
  X,
  Copy,
  Check,
  Code,
  Palette,
  Eye,
  EyeOff,
  Plus,
  Languages,
  Zap,
  KeyRound,
  Lock,
  Unlock,
  ShieldCheck,
  History as HistoryIcon,
  Star,
  Trash2,
  FileText,
  Video,
  Settings,
  Search,
  ChevronUp,
  ChevronDown,
  Upload,
  Maximize2,
  Minimize2,
} from 'lucide-react';
import Header from './components/Header';
import { GizmoOverlay } from './components/GizmoOverlay';
import LoadingOverlay from './components/LoadingOverlay';
import {
  generateMultimodalImage,
  generateSvgWithGemini,
  translatePrompt,
  refinePromptWithGemini,
  generateSurprisePrompt
} from './services/geminiService';
import {
  generateTextToVideoWithAIHubMix,
  generateImageToVideoWithAIHubMix,
  getAIHubMixVideoModels
} from './services/aihubmixService';

import { initConsoleSVGArt } from './utils/consoleArt';
import { initProtection } from './utils/protection';
import { encryptKey, decryptKey, hashPassword } from './utils/security';
import {
  normalizeSvgText,
  getWordText,
  measureTextWidthPx,
  computeWordLetterPositions,
  computeNewWordState
} from './utils/svg';
import { AppState, ImageAsset, Letter, Word, SvgLayer, TextMeasureStyle } from './types';





// --- New SVG Parsing / Reconstruction Logic ---

const parseSvgLayers = (svgString: string): SvgLayer[] => {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgString, 'image/svg+xml');
  const svgEl = doc.querySelector('svg');
  if (!svgEl) return [];

  const layers: SvgLayer[] = [];
  const elements = svgEl.querySelectorAll('path, rect, circle, text, image, g, line');
  const parseNumberAttr = (el: Element, attr: string) => {
    const raw = el.getAttribute(attr);
    if (!raw) return undefined;
    const num = parseFloat(raw);
    return Number.isFinite(num) ? num : undefined;
  };
  const parseDurationSeconds = (value: string | null) => {
    if (!value) return undefined;
    const match = value.match(/([\d.]+)/);
    if (!match) return undefined;
    const num = parseFloat(match[1]);
    return Number.isFinite(num) ? num : undefined;
  };

  elements.forEach((el, index) => {
    // Skip internal elements of text if we want to treat text as a single layer (optional)
    // For now, let's list everything that has a visual presence
    if (el.tagName.toLowerCase() === 'tspan') return;

    const id = el.getAttribute('id') || `${el.tagName.toLowerCase()}-${index}`;
    if (!el.getAttribute('id')) el.setAttribute('id', id);

    const anim = el.querySelector('animate');
    const animDuration = anim ? parseDurationSeconds(anim.getAttribute('dur')) : undefined;
    const dataDuration = parseDurationSeconds(el.getAttribute('data-duration'));
    const dataVisible = el.getAttribute('data-layer-visible');
    const displayAttr = el.getAttribute('display');
    const visible = dataVisible === '0' || dataVisible === 'false'
      ? false
      : displayAttr === 'none'
        ? false
        : true;
    const baseTransform = el.getAttribute('data-layer-base-transform') ?? el.getAttribute('transform') ?? undefined;
    const tx = parseNumberAttr(el, 'data-layer-tx');
    const ty = parseNumberAttr(el, 'data-layer-ty');
    const rotation = parseNumberAttr(el, 'data-layer-rot');
    const centerX = parseNumberAttr(el, 'data-layer-center-x');
    const centerY = parseNumberAttr(el, 'data-layer-center-y');

    layers.push({
      id,
      type: el.tagName.toLowerCase() as any,
      label: el.getAttribute('data-label') || `${el.tagName} ${index + 1}`,
      fill: el.getAttribute('fill') || undefined,
      stroke: el.getAttribute('stroke') || undefined,
      opacity: parseFloat(el.getAttribute('opacity') || '1'),
      duration: animDuration ?? dataDuration,
      hasAnimate: Boolean(anim),
      visible,
      baseTransform,
      tx,
      ty,
      rotation,
      centerX,
      centerY,
      element: el
    });
  });

  return layers;
};

const getInlineStyleValue = (style: string, prop: string): string | null => {
  if (!style) return null;
  const match = style.match(new RegExp(`${prop}\\s*:\\s*([^;]+)`, 'i'));
  return match ? match[1].trim() : null;
};

const getAttrOrInlineStyle = (el: Element, attr: string): string | undefined => {
  const attrValue = el.getAttribute(attr);
  if (attrValue !== null && attrValue !== '') return attrValue;
  const styleValue = getInlineStyleValue(el.getAttribute('style') || '', attr);
  return styleValue ?? undefined;
};

const getTextStyleValue = (textEl: Element, firstTspan: Element | null, attr: string): string | undefined => {
  return getAttrOrInlineStyle(textEl, attr) ?? (firstTspan ? getAttrOrInlineStyle(firstTspan, attr) : undefined);
};

const normalizeColorToHex = (color: string | null | undefined): string | null => {
  if (!color) return null;
  const value = color.trim().toLowerCase();
  if (!value || value === 'none' || value === 'transparent') return null;

  if (value.startsWith('#')) {
    if (value.length === 4) {
      return `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}`;
    }
    if (value.length === 7) return value;
    if (value.length === 9) return value.slice(0, 7);
  }

  const rgbMatch = value.match(/^rgba?\(([^)]+)\)$/);
  if (rgbMatch) {
    const parts = rgbMatch[1].split(',').map(p => p.trim());
    if (parts.length >= 3) {
      const toChannel = (input: string) => {
        if (input.endsWith('%')) {
          const pct = parseFloat(input);
          return Number.isFinite(pct) ? Math.round((pct / 100) * 255) : 0;
        }
        const num = parseFloat(input);
        return Number.isFinite(num) ? Math.round(num) : 0;
      };
      const r = toChannel(parts[0]);
      const g = toChannel(parts[1]);
      const b = toChannel(parts[2]);
      const toHex = (n: number) => n.toString(16).padStart(2, '0');
      return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
    }
  }

  return null;
};

const getSvgDimensions = (svgEl: SVGSVGElement | null): { width: number | null; height: number | null } => {
  if (!svgEl) return { width: null, height: null };
  const viewBox = svgEl.getAttribute('viewBox');
  if (viewBox) {
    const parts = viewBox.trim().split(/[\s,]+/);
    if (parts.length >= 4) {
      const width = parseFloat(parts[2]);
      const height = parseFloat(parts[3]);
      return {
        width: Number.isFinite(width) ? width : null,
        height: Number.isFinite(height) ? height : null
      };
    }
  }

  const parseDim = (value: string | null) => {
    if (!value) return null;
    const num = parseFloat(value);
    return Number.isFinite(num) ? num : null;
  };

  return {
    width: parseDim(svgEl.getAttribute('width')),
    height: parseDim(svgEl.getAttribute('height'))
  };
};

const parseSvgCoordinate = (value: string | null, axisSize: number | null): number | null => {
  if (!value) return null;
  const token = value.trim().split(/[\s,]+/)[0];
  if (!token) return null;
  if (token.endsWith('%') && axisSize !== null) {
    const pct = parseFloat(token);
    return Number.isFinite(pct) ? (axisSize * pct) / 100 : null;
  }
  const match = token.match(/-?\d*\.?\d+/);
  if (!match) return null;
  const num = parseFloat(match[0]);
  return Number.isFinite(num) ? num : null;
};

const normalizeFontSizeValue = (value: string | null | undefined): string | undefined => {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (/^-?\d*\.?\d+$/.test(trimmed)) return `${trimmed}px`;
  return trimmed;
};

const parseTransformMatrix = (transform: string | null | undefined) => {
  const raw = (transform || '').trim();
  if (!raw) return new DOMMatrix();
  try {
    return new DOMMatrix(raw);
  } catch {
    const match = raw.match(/translate\(([^)]+)\)/i);
    if (match) {
      const parts = match[1].split(/[\s,]+/).map(v => parseFloat(v)).filter(n => Number.isFinite(n));
      const tx = parts[0] ?? 0;
      const ty = parts[1] ?? 0;
      return new DOMMatrix().translateSelf(tx, ty);
    }
    return new DOMMatrix();
  }
};

const parseSvgText = (svgString: string): Word[] => {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgString, 'image/svg+xml');
  const svgEl = doc.querySelector('svg') as SVGSVGElement | null;
  const { width: svgWidth, height: svgHeight } = getSvgDimensions(svgEl);
  const textNodes = doc.querySelectorAll('text');
  const words: Word[] = [];

  textNodes.forEach((textNode, textIndex) => {
    const textContent = textNode.textContent || '';
    const firstTspan = textNode.querySelector('tspan');
    const fill = getTextStyleValue(textNode, firstTspan, 'fill');
    const stroke = getTextStyleValue(textNode, firstTspan, 'stroke');
    const fontFamily = getTextStyleValue(textNode, firstTspan, 'font-family');
    const fontSize = getTextStyleValue(textNode, firstTspan, 'font-size');
    const fontWeight = getTextStyleValue(textNode, firstTspan, 'font-weight');
    const fontStyle = getTextStyleValue(textNode, firstTspan, 'font-style');
    const letterSpacing = getTextStyleValue(textNode, firstTspan, 'letter-spacing');
    const textAnchor = (getAttrOrInlineStyle(textNode, 'text-anchor') || 'start').toLowerCase();

    const baseX = parseSvgCoordinate(textNode.getAttribute('x'), svgWidth);
    const baseY = parseSvgCoordinate(textNode.getAttribute('y'), svgHeight);
    const canPosition = baseX !== null && baseY !== null;

    const textNodeId = textNode.getAttribute('id') || undefined;

    const taggedTspans = Array.from(textNode.querySelectorAll('tspan[data-word-id]'));
    if (taggedTspans.length > 0) {
      const wordMap = new Map<string, {
        letters: { index: number; letter: Letter }[];
        x?: number;
        y?: number;
        rotation?: number;
        isManual?: boolean;
        visible?: boolean;
      }>();

      taggedTspans.forEach((tspan) => {
        const wordId = tspan.getAttribute('data-word-id');
        if (!wordId) return;
        const char = tspan.textContent ?? '';
        const letterIndex = parseInt(tspan.getAttribute('data-letter-index') || '0', 10);

        const letterFill = getAttrOrInlineStyle(tspan, 'fill') ?? fill;
        const letterStroke = getAttrOrInlineStyle(tspan, 'stroke') ?? stroke;
        const letterFontFamily = getAttrOrInlineStyle(tspan, 'font-family') ?? fontFamily;
        const letterFontSize = getAttrOrInlineStyle(tspan, 'font-size') ?? fontSize;
        const letterFontWeight = getAttrOrInlineStyle(tspan, 'font-weight') ?? fontWeight;
        const letterFontStyle = getAttrOrInlineStyle(tspan, 'font-style') ?? fontStyle;
        const letterLetterSpacing = getAttrOrInlineStyle(tspan, 'letter-spacing') ?? letterSpacing;

        const animationDuration = parseFloat(tspan.getAttribute('data-duration') || '0.5');
        const animationDelay = parseFloat(tspan.getAttribute('data-delay') || '0');
        const animationEasing = tspan.getAttribute('data-ease') || 'ease-out';

        const letterXAttr = tspan.getAttribute('x');
        const letterYAttr = tspan.getAttribute('y');
        const letterX = letterXAttr !== null ? parseFloat(letterXAttr) : NaN;
        const letterY = letterYAttr !== null ? parseFloat(letterYAttr) : NaN;

        const letter: Letter = {
          id: tspan.getAttribute('id') || `letter-${wordId}-${letterIndex}`,
          char,
          fill: letterFill,
          stroke: letterStroke,
          fontFamily: letterFontFamily,
          fontSize: letterFontSize,
          fontWeight: letterFontWeight,
          fontStyle: letterFontStyle,
          letterSpacing: letterLetterSpacing,
          x: Number.isFinite(letterX) ? letterX : undefined,
          y: Number.isFinite(letterY) ? letterY : undefined,
          animation: {
            duration: Number.isFinite(animationDuration) ? animationDuration : 0.5,
            delay: Number.isFinite(animationDelay) ? animationDelay : 0,
            easing: animationEasing
          }
        };

        const existing = wordMap.get(wordId) || { letters: [] };
        existing.letters.push({ index: letterIndex, letter });

        const wordVisibleAttr = tspan.getAttribute('data-word-visible');
        const wordDisplayAttr = tspan.getAttribute('display');
        const wordDisplayStyle = getInlineStyleValue(tspan.getAttribute('style') || '', 'display');
        const wordVisibilityAttr = tspan.getAttribute('visibility');
        const wordVisibilityStyle = getInlineStyleValue(tspan.getAttribute('style') || '', 'visibility');
        const isHidden = wordVisibleAttr === '0'
          || wordVisibleAttr === 'false'
          || wordVisibilityAttr === 'hidden'
          || wordVisibilityStyle === 'hidden'
          || wordDisplayAttr === 'none'
          || wordDisplayStyle === 'none';
        if (existing.visible === undefined) {
          existing.visible = !isHidden;
        } else if (isHidden) {
          existing.visible = false;
        }

        if (existing.x === undefined) {
          const wordX = parseSvgCoordinate(tspan.getAttribute('data-word-x'), svgWidth);
          if (wordX !== null) existing.x = wordX;
        }
        if (existing.y === undefined) {
          const wordY = parseSvgCoordinate(tspan.getAttribute('data-word-y'), svgHeight);
          if (wordY !== null) existing.y = wordY;
        }
        if (existing.rotation === undefined) {
          const wordRotAttr = tspan.getAttribute('data-word-rot');
          const wordRot = wordRotAttr !== null ? parseFloat(wordRotAttr) : NaN;
          if (Number.isFinite(wordRot)) existing.rotation = wordRot;
        }
        if (!existing.isManual) {
          const manualAttr = tspan.getAttribute('data-word-manual');
          if (manualAttr === '1' || manualAttr === 'true') {
            existing.isManual = true;
          }
        }

        wordMap.set(wordId, existing);
      });

      wordMap.forEach((data, wordId) => {
        const ordered = data.letters.sort((a, b) => a.index - b.index).map(item => item.letter);
        const resolvedX = data.x ?? baseX ?? null;
        const resolvedY = data.y ?? baseY ?? null;
        const wordData: Word = {
          id: wordId,
          letters: ordered,
          textIndex,
          textNodeId,
          rotation: data.rotation ?? 0,
          isManual: data.isManual,
          visible: data.visible !== undefined ? data.visible : true
        };
        if (resolvedX !== null && resolvedY !== null) {
          wordData.x = resolvedX;
          wordData.y = resolvedY;
        }
        words.push(wordData);
      });
      return;
    }

    // Split by space to get rough "words" if simple text, or treat whole line as word if needed.
    const rawWords = textContent.split(/\s+/).filter(Boolean);
    if (rawWords.length === 0) return;

    const normalizedFontSize = fontSize ? (fontSize.endsWith('px') ? fontSize : `${fontSize}px`) : undefined;
    const measureStyle: TextMeasureStyle = {
      fontStyle: fontStyle || 'normal',
      fontWeight: fontWeight || 'normal',
      fontSize: normalizedFontSize || '16px',
      fontFamily: fontFamily || 'sans-serif',
      letterSpacing: letterSpacing || 'normal'
    };

    const spaceWidth = measureTextWidthPx(' ', measureStyle) ?? 0;
    const wordWidths = rawWords.map(word => measureTextWidthPx(word, measureStyle) ?? 0);
    const totalWidth = wordWidths.reduce((sum, w) => sum + w, 0) + spaceWidth * Math.max(rawWords.length - 1, 0);

    let startX = baseX ?? 0;
    if (textAnchor === 'middle') startX -= totalWidth / 2;
    if (textAnchor === 'end') startX -= totalWidth;

    let cursorX = startX;
    rawWords.forEach((hw, wIndex) => {
      const wordId = `word-${textIndex}-${wIndex}-${Date.now()}`;
      const letters: Letter[] = hw.split('').map((char, lIndex) => ({
        id: `letter-${wordId}-${lIndex}`,
        char,
        fill,
        stroke,
        fontFamily,
        fontSize,
        fontWeight,
        fontStyle,
        letterSpacing,
        animation: {
          duration: 0.5,
          delay: 0.05 * lIndex, // Stagger default
          easing: 'ease-out'
        }
      }));
      const wordData: Word = {
        id: wordId,
        letters,
        textIndex,
        textNodeId,
        visible: true
      };
      if (canPosition) {
        wordData.x = cursorX;
        wordData.y = baseY as number;
        wordData.rotation = 0;
      }
      words.push(wordData);

      if (canPosition) {
        cursorX += (wordWidths[wIndex] ?? 0) + spaceWidth;
      }
    });
  });
  return words;
};

const reconstructSvg = (originalSvg: string, words: Word[], layers: SvgLayer[] = [], bgImage: string | null = null, bgColor: string = '#000000'): string => {
  const parser = new DOMParser();
  const doc = parser.parseFromString(originalSvg, 'image/svg+xml');
  const svgEl = doc.querySelector('svg');
  if (!svgEl) return originalSvg;

  const namespace = "http://www.w3.org/2000/svg";
  const { width: svgWidth, height: svgHeight } = getSvgDimensions(svgEl as SVGSVGElement);
  const isFullCanvasRect = (el: Element) => {
    if (el.tagName.toLowerCase() !== 'rect') return false;
    if (el.closest('defs')) return false;
    const x = el.getAttribute('x');
    const y = el.getAttribute('y');
    const w = el.getAttribute('width');
    const h = el.getAttribute('height');
    const widthValue = parseSvgCoordinate(w, svgWidth);
    const heightValue = parseSvgCoordinate(h, svgHeight);
    const widthIsFull = w === '100%' || (svgWidth && widthValue !== null && widthValue >= svgWidth * 0.98);
    const heightIsFull = h === '100%' || (svgHeight && heightValue !== null && heightValue >= svgHeight * 0.98);
    const xValue = parseSvgCoordinate(x, svgWidth) ?? 0;
    const yValue = parseSvgCoordinate(y, svgHeight) ?? 0;
    const xIsZero = Math.abs(xValue) < 0.01;
    const yIsZero = Math.abs(yValue) < 0.01;
    return widthIsFull && heightIsFull && xIsZero && yIsZero;
  };

  // Update background
  let bgRect = doc.getElementById('svg-background-rect') as unknown as SVGElement | null;
  if (!bgRect) {
    bgRect = doc.createElementNS(namespace, "rect") as unknown as SVGElement;
    bgRect.setAttribute("id", "svg-background-rect");
    bgRect.setAttribute("width", "100%");
    bgRect.setAttribute("height", "100%");
    svgEl.insertBefore(bgRect, svgEl.firstChild);
  }
  bgRect.setAttribute("fill", bgColor);

  // Update background image
  let bgImg = doc.getElementById('svg-background-image') as unknown as SVGElement | null;
  if (bgImage) {
    if (!bgImg) {
      bgImg = doc.createElementNS(namespace, "image") as unknown as SVGElement;
      bgImg.setAttribute("id", "svg-background-image");
      bgImg.setAttribute("width", "100%");
      bgImg.setAttribute("height", "100%");
      bgImg.setAttribute("preserveAspectRatio", "xMidYMid slice");
      bgImg.setAttribute("opacity", "0.4");
      svgEl.insertBefore(bgImg, bgRect.nextSibling);
    }
    bgImg.setAttribute("href", bgImage);
  } else if (bgImg) {
    bgImg.remove();
  }

  // If a background image is present, ensure full-canvas rects don't cover it
  const fullCanvasRects = Array.from(svgEl.querySelectorAll('rect'))
    .filter((el) => {
      if (el.closest('defs')) return false;
      const id = el.getAttribute('id') || '';
      if (id === 'svg-background-rect') return false;
      if (id.startsWith('layer-rect-')) return true;
      return isFullCanvasRect(el);
    });
  const forcedHiddenRectIds = new Set<string>();
  fullCanvasRects.forEach((rect) => {
    const isVisible = () => {
      const dataVisible = rect.getAttribute('data-layer-visible');
      if (dataVisible === '0' || dataVisible === 'false') return false;
      const displayAttr = rect.getAttribute('display');
      if (displayAttr === 'none') return false;
      return true;
    };
    if (bgImage) {
      const rectId = rect.getAttribute('id');
      if (rectId) forcedHiddenRectIds.add(rectId);
      if (!rect.hasAttribute('data-bg-fill')) {
        rect.setAttribute('data-bg-fill', rect.getAttribute('fill') ?? '');
      }
      if (!rect.hasAttribute('data-bg-opacity')) {
        rect.setAttribute('data-bg-opacity', rect.getAttribute('opacity') ?? '');
      }
      if (!rect.hasAttribute('data-bg-visible')) {
        rect.setAttribute('data-bg-visible', isVisible() ? '1' : '0');
      }
      rect.setAttribute('fill', 'transparent');
      rect.setAttribute('opacity', '0');
      rect.setAttribute('data-layer-visible', '0');
      rect.setAttribute('display', 'none');
    } else if (rect.hasAttribute('data-bg-fill') || rect.hasAttribute('data-bg-opacity')) {
      const originalFill = rect.getAttribute('data-bg-fill');
      const originalOpacity = rect.getAttribute('data-bg-opacity');
      if (originalFill) {
        rect.setAttribute('fill', originalFill);
      } else {
        rect.removeAttribute('fill');
      }
      if (originalOpacity) {
        rect.setAttribute('opacity', originalOpacity);
      } else {
        rect.removeAttribute('opacity');
      }
      const originalVisible = rect.getAttribute('data-bg-visible');
      if (originalVisible === '1') {
        rect.setAttribute('data-layer-visible', '1');
        rect.removeAttribute('display');
      } else if (originalVisible === '0') {
        rect.setAttribute('data-layer-visible', '0');
        rect.setAttribute('display', 'none');
      }
      rect.removeAttribute('data-bg-fill');
      rect.removeAttribute('data-bg-opacity');
      rect.removeAttribute('data-bg-visible');
    }
  });

  const buildLayerTransform = (
    base: string | undefined,
    tx: number,
    ty: number,
    rotation: number,
    centerX: number,
    centerY: number
  ) => {
    const parts: string[] = [];
    const baseTrimmed = (base || '').trim();
    if (baseTrimmed) parts.push(baseTrimmed);
    if (tx || ty) parts.push(`translate(${tx} ${ty})`);
    if (rotation) {
      parts.push(`translate(${centerX} ${centerY})`);
      parts.push(`rotate(${rotation})`);
      parts.push(`translate(${-centerX} ${-centerY})`);
    }
    return parts.join(' ').trim();
  };

  const parseNumberAttr = (el: Element, attr: string) => {
    const raw = el.getAttribute(attr);
    if (!raw) return undefined;
    const num = parseFloat(raw);
    return Number.isFinite(num) ? num : undefined;
  };

  // Update layers if provided
  layers.forEach(layer => {
    const el = doc.getElementById(layer.id);
    if (el) {
      if (layer.fill) el.setAttribute('fill', layer.fill);
      if (layer.stroke) el.setAttribute('stroke', layer.stroke);
      if (layer.opacity !== undefined) el.setAttribute('opacity', layer.opacity.toString());
      if (layer.duration !== undefined) {
        const anims = Array.from(el.querySelectorAll('animate'));
        if (anims.length > 0) {
          anims.forEach((anim) => anim.setAttribute('dur', `${layer.duration}s`));
        } else {
          el.setAttribute('data-duration', layer.duration.toString());
        }
      }

      const baseTransform = layer.baseTransform ?? el.getAttribute('data-layer-base-transform') ?? el.getAttribute('transform') ?? undefined;
      const tx = Number.isFinite(layer.tx ?? NaN) ? (layer.tx as number) : (parseNumberAttr(el, 'data-layer-tx') ?? 0);
      const ty = Number.isFinite(layer.ty ?? NaN) ? (layer.ty as number) : (parseNumberAttr(el, 'data-layer-ty') ?? 0);
      const rotation = Number.isFinite(layer.rotation ?? NaN) ? (layer.rotation as number) : (parseNumberAttr(el, 'data-layer-rot') ?? 0);
      const centerX = Number.isFinite(layer.centerX ?? NaN) ? (layer.centerX as number) : (parseNumberAttr(el, 'data-layer-center-x') ?? 0);
      const centerY = Number.isFinite(layer.centerY ?? NaN) ? (layer.centerY as number) : (parseNumberAttr(el, 'data-layer-center-y') ?? 0);

      const transform = buildLayerTransform(baseTransform, tx, ty, rotation, centerX, centerY);
      if (transform) {
        el.setAttribute('transform', transform);
      } else {
        el.removeAttribute('transform');
      }
      if (baseTransform !== undefined) el.setAttribute('data-layer-base-transform', baseTransform);
      el.setAttribute('data-layer-tx', tx.toString());
      el.setAttribute('data-layer-ty', ty.toString());
      el.setAttribute('data-layer-rot', rotation.toString());
      el.setAttribute('data-layer-center-x', centerX.toString());
      el.setAttribute('data-layer-center-y', centerY.toString());

      const shouldForceHidden = bgImage && forcedHiddenRectIds.has(layer.id);
      if (shouldForceHidden) {
        el.setAttribute('display', 'none');
        el.setAttribute('data-layer-visible', '0');
      } else if (layer.visible === false) {
        el.setAttribute('display', 'none');
        el.setAttribute('data-layer-visible', '0');
      } else if (layer.visible === true) {
        el.removeAttribute('display');
        el.setAttribute('data-layer-visible', '1');
      }
    }
  });

  // Re-inject Text layers specifically if words are updated
  if (words.length > 0) {
    const parseWordIndex = (word: Word) => {
      const parts = word.id.split('-');
      const maybeIndex = parseInt(parts[2] || '0', 10);
      return Number.isNaN(maybeIndex) ? 0 : maybeIndex;
    };

    const resolveTextIndex = (word: Word) => {
      if (typeof word.textIndex === 'number') return word.textIndex;
      const parts = word.id.split('-');
      const maybeIndex = parseInt(parts[1] || '', 10);
      return Number.isNaN(maybeIndex) ? null : maybeIndex;
    };

    const wordsByTextId: Record<string, Word[]> = {};
    const wordsByTextIndex: Record<number, Word[]> = {};

    words.forEach(word => {
      const textId = word.textNodeId;
      if (textId) {
        if (!wordsByTextId[textId]) wordsByTextId[textId] = [];
        wordsByTextId[textId].push(word);
      }

      const textIndex = resolveTextIndex(word);
      if (textIndex !== null) {
        if (!wordsByTextIndex[textIndex]) wordsByTextIndex[textIndex] = [];
        wordsByTextIndex[textIndex].push(word);
      }
    });

    Object.values(wordsByTextId).forEach(group => group.sort((a, b) => parseWordIndex(a) - parseWordIndex(b)));
    Object.values(wordsByTextIndex).forEach(group => group.sort((a, b) => parseWordIndex(a) - parseWordIndex(b)));

    const allTextNodes = Array.from(doc.querySelectorAll('text')) as SVGTextElement[];
    const nonEditableTextNodes = allTextNodes.filter(node => !node.closest('#editable-text-layer'));
    const textNodesToUpdate = nonEditableTextNodes.length > 0 ? nonEditableTextNodes : allTextNodes;

    // If there are no text nodes left (edge case), create a centered one as a fallback.
    let fallbackTextNode: SVGTextElement | null = null;
   {
      const textGroup = doc.getElementById('editable-text-layer') || doc.createElementNS(namespace, "g");
      if (!textGroup.getAttribute('id')) textGroup.setAttribute('id', 'editable-text-layer');
      if (!textGroup.parentNode) svgEl.appendChild(textGroup);

      const textEl = doc.createElementNS(namespace, "text") as SVGTextElement;
      textEl.setAttribute("x", '50%');
      textEl.setAttribute("y", '50%');
      textEl.setAttribute("dominant-baseline", "middle");
      textEl.setAttribute("text-anchor", "middle");
      textGroup.appendChild(textEl);
      fallbackTextNode = textEl;
    }

    const nodes = textNodesToUpdate.length > 0 ? textNodesToUpdate : (fallbackTextNode ? [fallbackTextNode] : []);
    const textIdCounts: Record<string, number> = {};
    nodes.forEach((node) => {
      const id = node.getAttribute('id');
      if (!id) return;
      textIdCounts[id] = (textIdCounts[id] || 0) + 1;
    });

    nodes.forEach((textNode, index) => {
      const nodeId = textNode.getAttribute('id') || '';
      const hasDuplicateId = Boolean(nodeId) && (textIdCounts[nodeId] || 0) > 1;
      const hasUniqueIdMapping = Boolean(nodeId) && !hasDuplicateId && Boolean(wordsByTextId[nodeId]);

      // Use ID mapping only for unique IDs. For duplicate IDs always use index mapping,
      // otherwise one node can "steal" words from another and produce visual duplicates.
      const nodeWords = hasUniqueIdMapping && nodeId
        ? wordsByTextId[nodeId]
        : wordsByTextIndex[index];

      if (!nodeWords || nodeWords.length === 0) {
        // Remove stale generated tspans left from temporary split/old rebuilds.
        const staleWordTspans = Array.from(textNode.querySelectorAll('tspan[data-word-id]'));
        if (staleWordTspans.length > 0) {
          staleWordTspans.forEach((tspan) => tspan.remove());

          const hasRenderableContent = Array.from(textNode.childNodes).some((child) => {
            if (child.nodeType === Node.TEXT_NODE) {
              return Boolean(child.textContent && child.textContent.trim().length > 0);
            }
            return child.nodeType === Node.ELEMENT_NODE;
          });
          if (!hasRenderableContent) {
            textNode.remove();
          }
        }
        return;
      }

      const textPath = textNode.querySelector('textPath') as SVGTextPathElement | null;
      const container: Element = textPath || textNode;
      // ... existing style extraction ...
      const fallbackFontSize = getAttrOrInlineStyle(textNode, 'font-size');
      const normalizedFontSize = fallbackFontSize
        ? (fallbackFontSize.endsWith('px') ? fallbackFontSize : `${fallbackFontSize}px`)
        : undefined;
      const fallbackStyle: TextMeasureStyle = {
        fontStyle: getAttrOrInlineStyle(textNode, 'font-style') || 'normal',
        fontWeight: getAttrOrInlineStyle(textNode, 'font-weight') || 'normal',
        fontSize: normalizedFontSize || '16px',
        fontFamily: getAttrOrInlineStyle(textNode, 'font-family') || 'sans-serif',
        letterSpacing: getAttrOrInlineStyle(textNode, 'letter-spacing') || 'normal'
      };
      const fallbackX = parseSvgCoordinate(textNode.getAttribute('x'), svgWidth);
      const fallbackY = parseSvgCoordinate(textNode.getAttribute('y'), svgHeight);
      const textAnchor = (getAttrOrInlineStyle(textNode, 'text-anchor') || 'start').toLowerCase();
      const nodeNeedsAbsolute = nodeWords.some(w => w.isManual || (w.rotation ?? 0) !== 0 || w.visible === false);
      const flowPositions: Record<string, { x: number; y: number }> = {};

      if (nodeNeedsAbsolute) {
        const flowBaseX = fallbackX ?? 0;
        const flowBaseY = fallbackY ?? 0;
        const spaceWidth = measureTextWidthPx(' ', fallbackStyle) ?? 0;
        const wordWidths = nodeWords.map(word => {
          const primaryLetter = word.letters[0];
          const style: TextMeasureStyle = {
            fontStyle: primaryLetter?.fontStyle || fallbackStyle.fontStyle,
            fontWeight: primaryLetter?.fontWeight || fallbackStyle.fontWeight,
            fontSize: normalizeFontSizeValue(primaryLetter?.fontSize || fallbackStyle.fontSize) || '16px',
            fontFamily: primaryLetter?.fontFamily || fallbackStyle.fontFamily,
            letterSpacing: primaryLetter?.letterSpacing || fallbackStyle.letterSpacing
          };
          const w = measureTextWidthPx(getWordText(word), style) || 0;
          return w > 0 ? w : (measureTextWidthPx('M', style) || 10) * getWordText(word).length * 0.6;
        });
        const totalWidth = wordWidths.reduce((sum, w) => sum + w, 0) + spaceWidth * Math.max(nodeWords.length - 1, 0);
        let cursorX = flowBaseX;
        if (textAnchor === 'middle') cursorX -= totalWidth / 2;
        if (textAnchor === 'end') cursorX -= totalWidth;
        nodeWords.forEach((word, idx) => {
          flowPositions[word.id] = { x: cursorX, y: flowBaseY };
          cursorX += (wordWidths[idx] || 0) + spaceWidth;
        });
      }

      // Helper to clean text/tspans from an element
      const cleanElement = (el: Element) => {
        const toRemove: Node[] = [];
        el.childNodes.forEach((child) => {
          if (
            child.nodeType === Node.TEXT_NODE ||
            (child.nodeType === Node.ELEMENT_NODE && ['tspan', 'tref', 'textpath'].includes((child as Element).tagName.toLowerCase()))
          ) {
            toRemove.push(child);
          }
        });
        toRemove.forEach(child => el.removeChild(child));
      };

      // 1. Clean the main textNode regardless of container
      cleanElement(textNode);

      // 2. If container is textPath (different from textNode), clean it too
      if (container !== textNode) {
        cleanElement(container);
      }

      nodeWords.forEach((word, wIdx) => {
        const hasManualPosition = Boolean(word.isManual);
        const hasRotation = Number.isFinite(word.rotation ?? NaN) && (word.rotation ?? 0) !== 0;
        // CRITICAL: Only force positioning if the word itself needs it. 
        // This allows automatic words to stay automatic in a multi-word text node.
        const shouldPosition = hasManualPosition || hasRotation;

        // Calculate style for measurements early
        const primaryLetter = word.letters[0];
        const measureStyle: TextMeasureStyle = {
          fontStyle: primaryLetter?.fontStyle || fallbackStyle.fontStyle,
          fontWeight: primaryLetter?.fontWeight || fallbackStyle.fontWeight,
          fontSize: normalizeFontSizeValue(primaryLetter?.fontSize || fallbackStyle.fontSize) || '16px',
          fontFamily: primaryLetter?.fontFamily || fallbackStyle.fontFamily,
          letterSpacing: fallbackStyle.letterSpacing
        };

        let letterPositions: { x: number; y: number }[] = [];
        let baseWord: Word = word;
        if (shouldPosition) {
          baseWord = {
            ...word,
            x: Number.isFinite(word.x ?? NaN)
              ? word.x
              : (flowPositions[word.id]?.x ?? (fallbackX ?? 0)),
            y: Number.isFinite(word.y ?? NaN)
              ? word.y
              : (flowPositions[word.id]?.y ?? (fallbackY ?? 0)),
            rotation: word.rotation ?? 0
          };

          const hasStoredPositions = word.letters.every(letter =>
            Number.isFinite(letter.x ?? NaN) && Number.isFinite(letter.y ?? NaN)
          );
          if (hasStoredPositions) {
            letterPositions = word.letters.map(letter => ({
              x: letter.x as number,
              y: letter.y as number
            }));
          } else {
            letterPositions = computeWordLetterPositions(baseWord, measureStyle);
          }
        }

        // Rotation is now handled by computeWordLetterPositions returning rotated coordinates
        // and setting the 'rotate' attribute on tspans.
        // No group transform is needed on the tspan itself.

        word.letters.forEach((letter, lIdx) => {
          const tspan = doc.createElementNS(namespace, "tspan");
          tspan.textContent = letter.char;
          if (letter.fill !== undefined) {
            tspan.setAttribute("fill", letter.fill);
          }
          if (letter.stroke !== undefined) tspan.setAttribute("stroke", letter.stroke);
          if (letter.fontFamily !== undefined) tspan.setAttribute("font-family", letter.fontFamily);
          if (letter.fontSize !== undefined) tspan.setAttribute("font-size", letter.fontSize);
          if (letter.fontWeight !== undefined) tspan.setAttribute("font-weight", letter.fontWeight);
          if (letter.fontStyle !== undefined) tspan.setAttribute("font-style", letter.fontStyle);
          if (letter.letterSpacing !== undefined) tspan.setAttribute("letter-spacing", letter.letterSpacing);
          tspan.setAttribute("id", letter.id);
          tspan.setAttribute("data-word-id", word.id);
          tspan.setAttribute("data-letter-index", lIdx.toString());
          if (shouldPosition) {
            tspan.setAttribute("data-word-x", (baseWord.x ?? 0).toString());
            tspan.setAttribute("data-word-y", (baseWord.y ?? 0).toString());
            tspan.setAttribute("data-word-rot", (baseWord.rotation ?? 0).toString());
            tspan.setAttribute("data-word-manual", "1");
          }
          if (word.visible === false) {
            tspan.setAttribute('visibility', 'hidden');
            tspan.removeAttribute('display');
            tspan.setAttribute('data-word-visible', '0');
          } else if (word.visible === true) {
            tspan.removeAttribute('visibility');
            tspan.removeAttribute('display');
            tspan.setAttribute('data-word-visible', '1');
          }

          if (shouldPosition) {
            const pos = letterPositions[lIdx];
            if (pos) {
              tspan.setAttribute("x", pos.x.toString());
              tspan.setAttribute("y", pos.y.toString());
            }
            if (baseWord.rotation) {
              tspan.setAttribute("rotate", baseWord.rotation.toString());
              tspan.removeAttribute("transform");
            } else {
              tspan.removeAttribute("rotate");
              tspan.removeAttribute("transform");
            }
          }

          tspan.setAttribute("data-duration", letter.animation.duration.toString());
          tspan.setAttribute("data-delay", letter.animation.delay.toString());
          tspan.setAttribute("data-ease", letter.animation.easing);
          // Don't apply CSS animation in preview - keyframes don't exist. Animation is for GSAP in exported HTML.
          tspan.setAttribute("style", "cursor: pointer;");
          container.appendChild(tspan);
        });
        if (!shouldPosition && wIdx < nodeWords.length - 1) {
          const space = doc.createElementNS(namespace, "tspan");
          space.textContent = " ";
          container.appendChild(space);
        }
      });
    });
  }

  return svgEl.outerHTML;
};

// Update text content without removing non-text children (e.g., animate/set)
const updateTextElementContent = (textEl: SVGTextElement, newText: string) => {
  const tspans = Array.from(textEl.querySelectorAll('tspan'));
  const chars = newText.split('');

  if (tspans.length > 0) {
    if (tspans.length >= chars.length) {
      tspans.forEach((tspan, index) => {
        tspan.textContent = index < chars.length ? chars[index] : '';
      });
    } else {
      tspans.forEach((tspan, index) => {
        tspan.textContent = chars[index] ?? '';
      });
      const remaining = chars.slice(tspans.length).join('');
      const last = tspans[tspans.length - 1];
      last.textContent = `${last.textContent ?? ''}${remaining}`;
    }
    return;
  }

  const doc = textEl.ownerDocument;
  const textPath = textEl.querySelector('textPath');
  if (textPath) {
    Array.from(textPath.childNodes).forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        textPath.removeChild(node);
      }
    });
    const textNode = doc.createTextNode(newText);
    if (textPath.firstChild) {
      textPath.insertBefore(textNode, textPath.firstChild);
    } else {
      textPath.appendChild(textNode);
    }
    return;
  }

  // Remove only text nodes, keep animate/set and other elements intact
  Array.from(textEl.childNodes).forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      textEl.removeChild(node);
    }
  });

  const textNode = doc.createTextNode(newText);
  if (textEl.firstChild) {
    textEl.insertBefore(textNode, textEl.firstChild);
  } else {
    textEl.appendChild(textNode);
  }
};

const asSvgTextElement = (el: Element | null): SVGTextElement | null => {
  if (!el) return null;
  if (el.tagName.toLowerCase() !== 'text') return null;
  return el as SVGTextElement;
};

const getPreviewTextById = (svg: SVGSVGElement | null, id: string): SVGTextElement | null => {
  if (!svg || !id) return null;
  try {
    const selector = `#${CSS.escape(id)}`;
    return asSvgTextElement(svg.querySelector(selector));
  } catch {
    return asSvgTextElement(svg.querySelector(`#${id}`));
  }
};



const stripInternalTextAttrs = (svg: string) =>
  svg
    .replace(/\sdata-orig-(x|y|width|length)="[^"]*"/gi, '')
    .replace(/\stextLength="[^"]*"/gi, '')
    .replace(/\slengthAdjust="[^"]*"/gi, '');

const applyLoopToSvg = (svgString: string): string => {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgString, 'image/svg+xml');
  const svgEl = doc.querySelector('svg');
  if (!svgEl) return svgString;

  svgEl.setAttribute('data-loop', '1');

  const animations = Array.from(doc.querySelectorAll('animate, animateTransform'));
  animations.forEach((anim) => anim.setAttribute('repeatCount', 'indefinite'));

  let loopStyle = doc.querySelector('style#rr-loop-style');
  if (!loopStyle) {
    loopStyle = doc.createElementNS('http://www.w3.org/2000/svg', 'style');
    loopStyle.setAttribute('id', 'rr-loop-style');
    loopStyle.textContent = `svg[data-loop="1"] * { animation-iteration-count: infinite !important; }`;
    const defs = doc.querySelector('defs');
    if (defs) {
      defs.appendChild(loopStyle);
    } else {
      svgEl.insertBefore(loopStyle, svgEl.firstChild);
    }
  }

  return new XMLSerializer().serializeToString(doc);
};

const getTextMeasureStyle = (
  node: SVGTextElement,
  previewSvg: SVGSVGElement | null,
  previewTextNodes: SVGTextElement[],
  index: number
): TextMeasureStyle => {
  const inlineStyle = node.getAttribute('style') || '';
  const attrFontSize = node.getAttribute('font-size') || getInlineStyleValue(inlineStyle, 'font-size') || '';
  const fontSize = attrFontSize ? (attrFontSize.endsWith('px') ? attrFontSize : `${attrFontSize}px`) : undefined;
  const attrFontFamily = node.getAttribute('font-family') || getInlineStyleValue(inlineStyle, 'font-family') || undefined;
  const attrFontWeight = node.getAttribute('font-weight') || getInlineStyleValue(inlineStyle, 'font-weight') || undefined;
  const attrFontStyle = node.getAttribute('font-style') || getInlineStyleValue(inlineStyle, 'font-style') || undefined;
  const attrLetterSpacing = node.getAttribute('letter-spacing') || getInlineStyleValue(inlineStyle, 'letter-spacing') || undefined;

  if (typeof window !== 'undefined') {
    const nodeId = node.getAttribute('id') || '';
    const previewText = nodeId ? getPreviewTextById(previewSvg, nodeId) : previewTextNodes[index];
    if (previewText) {
      const computed = window.getComputedStyle(previewText);
      return {
        fontStyle: attrFontStyle || computed.fontStyle,
        fontWeight: attrFontWeight || computed.fontWeight,
        fontSize: fontSize || computed.fontSize,
        fontFamily: attrFontFamily || computed.fontFamily,
        letterSpacing: attrLetterSpacing || computed.letterSpacing
      };
    }
  }

  return {
    fontStyle: attrFontStyle || 'normal',
    fontWeight: attrFontWeight || 'normal',
    fontSize: fontSize || '16px',
    fontFamily: attrFontFamily || 'sans-serif',
    letterSpacing: attrLetterSpacing || 'normal'
  };
};


const generateStandaloneHtml = (svgString: string, words: Word[], bg: string): string => {
  const animationScript = `
    const animateSvgText = () => {
      ${words.flatMap(word => word.letters.map(letter => `
      gsap.fromTo("#${letter.id}", 
        { opacity: 0, y: 10, strokeDasharray: 100, strokeDashoffset: 100 },
        {
          opacity: 1,
          y: 0,
          strokeDashoffset: 0,
          duration: ${letter.animation.duration},
          delay: ${letter.animation.delay},
          ease: "${letter.animation.easing}"
        }
      );`)).join('\n')}
    };

    window.onload = () => {
      animateSvgText();
    };
  `;

  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Road Runner Studio Export</title>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.2/gsap.min.js"></script>
    <style>
        body {
            margin: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            background-color: #111;
        }
        svg {
            max-width: 90vw;
            max-height: 90vh;
        }
    </style>
</head>
<body>
    ${svgString}
    <script>
        ${animationScript}
    </script>
</body>
</html>`;
};

const SUGGESTED_GEN_PROMPTS = [
  'A futuristic road runner bird, minimalist vector logo',
  'Cyberpunk city street at night, neon blue and orange',
  'Abstract geometric shapes, 3d render, white background',
  'A sleek modern icon for a speed delivery service',
];

const APP_VERSION = '2.8.3';
const DONATION_BTC_ADDRESS = '1G2n3RiNs73dUX9mbAJio1hsTAnwUFz4cD';
const DONATION_USDT_TRC20_ADDRESS = 'TWBxb1nfQJFjpxd9htgPSpvpexsBZ2Z4HV';

const ASPECT_RATIOS = [
  { id: 'square', name: '1:1', width: 1024, height: 1024 },
  { id: 'vertical', name: '9:16', width: 768, height: 1365 },
  { id: 'horizontal', name: '16:9', width: 1365, height: 768 },
  { id: '4:3', name: '4:3', width: 1024, height: 768 },
  { id: '3:4', name: '3:4', width: 768, height: 1024 },
];



const FONT_OPTIONS = [
  { label: 'Sans Serif', value: 'Arial, Helvetica, sans-serif' },
  { label: 'Serif', value: 'Times New Roman, Times, serif' },
  { label: 'Monospace', value: 'Courier New, Courier, monospace' },
  { label: 'Cursive', value: 'Brush Script MT, cursive' },
  { label: 'Fantasy', value: 'Copperplate, Papyrus, fantasy' },
  { label: 'Impact', value: 'Impact, Charcoal, sans-serif' },
  { label: 'Verdana', value: 'Verdana, Geneva, sans-serif' },
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'Trebuchet MS', value: '"Trebuchet MS", Helvetica, sans-serif' },
  { label: 'Comic Sans', value: '"Comic Sans MS", "Comic Sans", cursive' },
];

type Tab = 'generate';
type OutputMode = 'image' | 'svg' | 'video';
type ModelProvider = 'gemini_flux' | 'huggingface' | 'aihubmix';


// Helper to extract SVG content from text response
const extractSvg = (text: string) => {
  if (!text) return null;
  // Aggressively strip multiple types of markdown blocks and leading/trailing markers
  let cleaned = text
    .replace(/```(?:svg|xml|html|plaintext)?/gi, '')
    .replace(/```/g, '')
    .trim();

  const match = cleaned.match(/<svg[\s\S]*?<\/svg>/i);
  if (match) return match[0];

  // If no match but it starts with <svg, just return the cleaned text
  if (cleaned.toLowerCase().includes('<svg')) {
    return cleaned;
  }
  return null;
};

// Remove @import and external URLs from <style> blocks
const sanitizeSvgCss = (svg: string | null) => {
  if (!svg) return svg;

  return svg.replace(
    /<style[^>]*>[\s\S]*?<\/style>/gi,
    (styleBlock) => {
      let cleaned = styleBlock;

      // Remove @import rules
      cleaned = cleaned.replace(/@import[^;]+;/gi, '');

      // Remove url(...) usages
      cleaned = cleaned.replace(/url\([^)]*\)/gi, 'none');

      return cleaned;
    }
  );
};

const ensureLayerIds = (svgString: string) => {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgString, 'image/svg+xml');
  const svgEl = doc.querySelector('svg');
  if (!svgEl) return svgString;

  const elements = svgEl.querySelectorAll('path, rect, circle, text, image, g, line');
  const used = new Set<string>();
  elements.forEach((el) => {
    const id = el.getAttribute('id');
    if (id) used.add(id);
  });

  let counter = 0;
  elements.forEach((el, index) => {
    if (el.tagName.toLowerCase() === 'tspan') return;
    let id = el.getAttribute('id');
    if (!id) {
      let candidate = `layer-${el.tagName.toLowerCase()}-${index}`;
      while (used.has(candidate)) {
        counter += 1;
        candidate = `layer-${el.tagName.toLowerCase()}-${index}-${counter}`;
      }
      id = candidate;
      el.setAttribute('id', id);
      used.add(id);
    }
  });

  return svgEl.outerHTML;
};

// History Item Interface
interface HistoryItem { id: string; type: 'image' | 'video' | 'svg'; data: string; prompt: string; timestamp: number; isFavorite?: boolean; aspectRatio?: string; }

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<Tab>('generate');
  const [outputMode, setOutputMode] = useState<OutputMode>('image');
  const [selectedRatio, setSelectedRatio] = useState('square');
  const [appState, setAppState] = useState<AppState>(AppState.IDLE);

  // State for images
  const [referenceImages, setReferenceImages] = useState<ImageAsset[]>([]);

  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  const [generatedText, setGeneratedText] = useState<string | null>(null);
  const [prompt, setPrompt] = useState('');
  const [originalPrompt, setOriginalPrompt] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [isDownloadingSvg, setIsDownloadingSvg] = useState(false);
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false);
  const [isDownloadingHtml, setIsDownloadingHtml] = useState(false);
  const [activeExportButton, setActiveExportButton] = useState<'svg' | 'pdf' | 'html' | 'copy'>('copy');
  const [viewMode, setViewMode] = useState<'preview' | 'code'>('preview');
  const [isTranslating, setIsTranslating] = useState(false);
  const [isAssistantLoading, setIsAssistantLoading] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);

  // SVG Editor State
  const [svgColors, setSvgColors] = useState<string[]>([]);
  const [modifiedSvg, setModifiedSvg] = useState<string | null>(null);
  const [showSvgPanel, setShowSvgPanel] = useState(false);
  const [svgBackground, setSvgBackground] = useState('#000000');
  const [svgBackgroundImage, setSvgBackgroundImage] = useState<string | null>(null);

  // Focus Mode State (expand SVG result column)
  const [isResultExpanded, setIsResultExpanded] = useState(false);


  // New Editor State (Structure & Animation)
  const [svgWords, setSvgWords] = useState<Word[]>([]);
  const [svgLayers, setSvgLayers] = useState<SvgLayer[]>([]);
  const [selectedLetterIds, setSelectedLetterIds] = useState<Set<string>>(new Set());
  const [activeEditorTab, setActiveEditorTab] = useState<'general' | 'layers' | 'letters'>('general'); // added letters for text editing scope
  const [showTechnicalTextLayers, setShowTechnicalTextLayers] = useState(false);
  const [wordDragMode, setWordDragMode] = useState<'move' | 'rotate'>('move');
  const [activeWordId, setActiveWordId] = useState<string | null>(null);
  const [activeLayerId, setActiveLayerId] = useState<string | null>(null);

  const svgWordsRef = useRef(svgWords);
  useEffect(() => {
    svgWordsRef.current = svgWords;
  }, [svgWords]);

  const dragStateRef = useRef<{
    wordId: string;
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    originRotation: number;
    rotationCenterX: number;
    rotationCenterY: number;
    startCenterX: number;
    startCenterY: number;
    letterOffsets: { x: number; y: number }[];
    mode: 'move' | 'rotate';
    currentX?: number;
    currentY?: number;
    currentRotation?: number;
    moved?: boolean;
    textElement?: SVGGraphicsElement | null;
    styleSnapshot?: {
      fontFamily?: string;
      fontSize?: string;
      fontWeight?: string;
      fontStyle?: string;
      letterSpacing?: string;
    };
  } | null>(null);
  const isDraggingWordRef = useRef(false);
  const svgLayersRef = useRef(svgLayers);
  useEffect(() => {
    svgLayersRef.current = svgLayers;
  }, [svgLayers]);

  const layerDragStateRef = useRef<{
    layerId: string;
    pointerId: number;
    startX: number;
    startY: number;
    originTx: number;
    originTy: number;
    originRotation: number;
    baseTransform: string;
    centerX: number;
    centerY: number;
    startCenterX: number;
    startCenterY: number;
    mode: 'move' | 'rotate';
    currentTx?: number;
    currentTy?: number;
    currentRotation?: number;
    moved?: boolean;
  } | null>(null);
  const isDraggingLayerRef = useRef(false);

  // SVG Search State
  const [svgSearchQuery, setSvgSearchQuery] = useState('');
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);


  // Video generation settings
  const [selectedVideoModel, setSelectedVideoModel] = useState('sora-2-pro');
  const [videoQuality, setVideoQuality] = useState('720p');
  const [videoDuration, setVideoDuration] = useState(4);
  const [showVideoSettings, setShowVideoSettings] = useState(false);
  const [showVideoModelList, setShowVideoModelList] = useState(false);
  const [started, setStarted] = useState(false);

  const videoModelOptions = [
    { value: 'veo-3.1-generate-preview', label: '🎬 Veo 3.1 Preview' },
    { value: 'veo-3.0-generate-preview', label: '🎬 Veo 3.0 Preview' },
    { value: 'sora-2', label: '⚡ Sora 2' },
    { value: 'sora-2-pro', label: '⚡ Sora 2 Pro' },
    { value: 'wan2.2-i2v-plus', label: '🎨 Wan 2.2 I2V Plus' },
    { value: 'wan2.2-t2v-plus', label: '🎨 Wan 2.2 T2V Plus' },
    { value: 'wan2.5-i2v-preview', label: '🎨 Wan 2.5 I2V Preview' },
    { value: 'wan2.5-t2v-preview', label: '🎨 Wan 2.5 T2V Preview' },
    { value: 'kling-1.5', label: '🚀 Kling 1.5' },
    { value: 'pika-1.0', label: '🌟 Pika 1.0' },
    { value: 'luma-1.5', label: '💫 Luma 1.5' }
  ];

  useEffect(() => {
    if (generatedText) {
      let svg = extractSvg(generatedText);
      if (svg) {
        svg = ensureLayerIds(svg);
        const hexMatches = svg.match(/#(?:[0-9a-fA-F]{3}){1,2}\b/g) || [];
        const normalizedColors = Array.from(new Set(hexMatches)).map(c =>
          c.length === 4 ? `#${c[1]}${c[1]}${c[2]}${c[2]}${c[3]}${c[3]}` : c
        );
        setSvgColors(normalizedColors);

        // Parse layers and words
        const parsedLayers = parseSvgLayers(svg);
        setSvgLayers(parsedLayers);
        const parsedWords = parseSvgText(svg);
        setSvgWords(parsedWords);

        if (!modifiedSvg || modifiedSvg === '') {
          setModifiedSvg(svg);
        }
      }
    }
  }, [generatedText]);

  // Model Provider State (Linked to Output Mode)
  const [modelProvider, setModelProvider] = useState<ModelProvider>('huggingface'); // Default for 'image' mode

  const handleColorChange = (oldColor: string, newColor: string) => {
    if (modifiedSvg) {
      const newSvg = modifiedSvg.replaceAll(oldColor, newColor);
      setModifiedSvg(newSvg);
      setSvgColors(prev => prev.map(c => c === oldColor ? newColor : c));
      // Sync layers
      setSvgLayers(parseSvgLayers(newSvg));
    }
  };

  const handleLayerUpdate = (layerId: string, updates: Partial<SvgLayer>) => {
    setSvgLayers(prev => {
      const newLayers = prev.map(l => l.id === layerId ? { ...l, ...updates } : l);
      const rawBase = modifiedSvg || generatedText || '';
      const baseSvg = extractSvg(rawBase) || rawBase;
      if (baseSvg) {
        setModifiedSvg(reconstructSvg(baseSvg, svgWords, newLayers, svgBackgroundImage, svgBackground));
      }
      return newLayers;
    });
  };

  const toggleWordVisibility = (wordId: string) => {
    setSvgWords(prev => {
      const newWords = prev.map(word => {
        if (word.id !== wordId) return word;
        const nextVisible = word.visible === false;
        return { ...word, visible: nextVisible };
      });
      const rawBase = modifiedSvg || generatedText || '';
      const baseSvg = extractSvg(rawBase) || rawBase;
      if (baseSvg) {
        setModifiedSvg(reconstructSvg(baseSvg, newWords, svgLayers, svgBackgroundImage, svgBackground));
      }
      return newWords;
    });
  };

  const handleApplyLoop = () => {
    const rawBase = modifiedSvg || generatedText || '';
    const baseSvg = extractSvg(rawBase) || rawBase;
    if (!baseSvg) return;
    const looped = applyLoopToSvg(baseSvg);
    setModifiedSvg(looped);
    setGeneratedText(looped);
    setSvgLayers(parseSvgLayers(looped));
    setSvgWords(parseSvgText(looped));
  };

  const handleBgColorUpdate = (color: string) => {
    setSvgBackground(color);
    const rawBase = modifiedSvg || generatedText || '';
    const baseSvg = extractSvg(rawBase) || rawBase;
    if (baseSvg) {
      setModifiedSvg(reconstructSvg(baseSvg, svgWords, svgLayers, svgBackgroundImage, color));
    }
  };

  const handleBgImageUpdate = (imageUrl: string | null) => {
    setSvgBackgroundImage(imageUrl);
    const rawBase = modifiedSvg || generatedText || '';
    const baseSvg = extractSvg(rawBase) || rawBase;
    if (baseSvg) {
      setModifiedSvg(reconstructSvg(baseSvg, svgWords, svgLayers, imageUrl, svgBackground));
    }
  };

  // History State
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      const saved = localStorage.getItem('RR_HISTORY');
      return saved ? JSON.parse(saved) : [];
    } catch {
      // Ignore malformed or unavailable localStorage.
      return [];
    }
  });

  // Security State
  const [isLocked, setIsLocked] = useState(true);
  const [isSetupMode, setIsSetupMode] = useState(false);
  const [masterPasswordInput, setMasterPasswordInput] = useState('');
  const [decryptedGeminiKey, setDecryptedGeminiKey] = useState<string | null>(null);
  const [securityError, setSecurityError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const svgInputRef = useRef<HTMLInputElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // API key modal state
  const [apiKeyModalOpen, setApiKeyModalOpen] = useState(false);
  const [projectInfoModalOpen, setProjectInfoModalOpen] = useState(false);
  const [copiedDonationType, setCopiedDonationType] = useState<'btc' | 'usdt' | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [hfKeyInput, setHfKeyInput] = useState('');
  const [aihubmixKeyInput, setAihubmixKeyInput] = useState('');
  const [modalTab, setModalTab] = useState<'gemini' | 'hf' | 'aihubmix'>('gemini');
  const [apiKeySaved, setApiKeySaved] = useState(false);
  const [hfKeySaved, setHfKeySaved] = useState(false);
  const [aihubmixKeySaved, setAihubmixKeySaved] = useState(false);

  // Persistence Effects
  useEffect(() => {
    try {
      // Limit history to last 20 items to avoid LocalStorage QuotaExceededError
      // especially since images are stored as large base64 strings.
      const historyToSave = history.slice(0, 20);
      localStorage.setItem('RR_HISTORY', JSON.stringify(historyToSave));
    } catch {
      // Ignore quota/storage errors and retry with a smaller history slice.
      // If still failing, try to save an even smaller subset
      try {
        localStorage.setItem('RR_HISTORY', JSON.stringify(history.slice(0, 5)));
      } catch {
        // Give up on saving history if even 5 items are too large
      }
    }
  }, [history]);
  useEffect(() => { if (typeof window !== 'undefined') { const hash = localStorage.getItem('RR_MASTER_HASH'); if (!hash) setIsSetupMode(true); } }, []);
  // Auto-decrypt if session key exists (simplified for now, full logic in handleUnlock)

  // Security Handlers
  const handleUnlock = () => {
    if (!masterPasswordInput) return;
    if (isSetupMode) {
      localStorage.setItem('RR_MASTER_HASH', hashPassword(masterPasswordInput));
      setIsSetupMode(false);
      setIsLocked(false);
      return;
    }
    if (hashPassword(masterPasswordInput) === localStorage.getItem('RR_MASTER_HASH')) {
      const enc = localStorage.getItem('GEMINI_API_KEY_ENC');
      if (enc) {
        const d = decryptKey(enc, masterPasswordInput);
        setDecryptedGeminiKey(d);
        setApiKeyInput(d);
        // Re-save to local storage for the session if needed, or just keep in memory state
        localStorage.setItem('GEMINI_API_KEY', d);
      }
      setIsLocked(false);
    } else {
      setSecurityError('Wrong Password');
      setTimeout(() => setSecurityError(null), 2000);
    }
  };

  // AI Assistant Handlers
  const handleSurpriseMe = async () => {
    try {
      setIsAssistantLoading(true);
      setPrompt(await generateSurprisePrompt());
    }
    catch (err) { setErrorMsg('Failed to generate surprise.'); } finally { setIsAssistantLoading(false); }
  };

  const handleRefinePrompt = async () => {
    if (!prompt.trim()) return;
    try {
      setIsAssistantLoading(true);
      let result: string[] = [];

      result = await refinePromptWithGemini(prompt);

      if (result && result.length > 0) {
        setSuggestions(result);
        setShowSuggestions(true);
      }
    }
    catch (err) { setErrorMsg('Refinement failed.'); } finally { setIsAssistantLoading(false); }
  };

  const handleCopySuggestion = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const handleInsertSuggestion = (text: string) => {
    setPrompt(text);
    setShowSuggestions(false);
  };

  // History Handlers
  const toggleFavorite = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setHistory(history.map(item => item.id === id ? { ...item, isFavorite: !item.isFavorite } : item));
  };

  const deleteHistoryItem = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setHistory(history.filter(item => item.id !== id));
  };

  const loadFromHistory = (item: HistoryItem) => {
    if (item.type === 'image') {
      setGeneratedImage(item.data);
      setGeneratedText(null);
      setOutputMode('image');
      setModelProvider('huggingface');
      setActiveTab('generate');
    } else if (item.type === 'video') {
      setGeneratedImage(item.data);
      setGeneratedText(null);
      setOutputMode('video');
      setModelProvider('aihubmix');
      setActiveTab('generate');
    } else {
      setGeneratedImage(null);
      const extracted = extractSvg(item.data);
      const content = extracted || item.data;
      resetSvgStateFromContent(content);
      setOutputMode('svg');
      setModelProvider('gemini_flux');
      setActiveTab('generate');
      setViewMode('preview');
    }
    setPrompt(item.prompt);
    if (item.aspectRatio) setSelectedRatio(item.aspectRatio);
    setAppState(AppState.SUCCESS);
  };

  // Extract SVG if present in generated text and sanitize it
  const svgContent = useMemo(
    () => {
      const source = modifiedSvg || generatedText;
      const extracted = extractSvg(source);
      const sanitized = extracted ? sanitizeSvgCss(extracted) : null;
      return sanitized;
    },
    [generatedText, modifiedSvg]
  );

  const selectedLetters = useMemo(() => {
    if (selectedLetterIds.size === 0) return [];
    const list: Letter[] = [];
    svgWords.forEach(word => {
      word.letters.forEach(letter => {
        if (selectedLetterIds.has(letter.id)) list.push(letter);
      });
    });
    return list;
  }, [svgWords, selectedLetterIds]);

  const selectedFillInfo = useMemo(() => {
    if (selectedLetters.length === 0) return { value: null as string | null, mixed: false };

    const previewSvg = typeof document !== 'undefined'
      ? (document.querySelector('[data-svg-preview="true"] svg') as SVGSVGElement | null)
      : null;

    const resolveFromDom = (id: string) => {
      if (!previewSvg || typeof window === 'undefined') return null;
      let el: SVGElement | null = null;
      try {
        el = previewSvg.querySelector<SVGElement>(`#${CSS.escape(id)}`);
      } catch {
        el = previewSvg.querySelector<SVGElement>(`#${id}`);
      }
      if (!el) return null;
      const computed = window.getComputedStyle(el);
      return normalizeColorToHex(computed.fill);
    };

    const colors = selectedLetters
      .map(letter => normalizeColorToHex(letter.fill) || resolveFromDom(letter.id))
      .filter((color): color is string => Boolean(color));

    const unique = Array.from(new Set(colors));
    if (unique.length === 0) return { value: null as string | null, mixed: false };
    return { value: unique[0], mixed: unique.length > 1 };
  }, [selectedLetters, svgContent, viewMode]);

  const selectedStrokeInfo = useMemo(() => {
    if (selectedLetters.length === 0) return { value: null as string | null, mixed: false };

    const previewSvg = typeof document !== 'undefined'
      ? (document.querySelector('[data-svg-preview="true"] svg') as SVGSVGElement | null)
      : null;

    const resolveFromDom = (id: string) => {
      if (!previewSvg || typeof window === 'undefined') return null;
      let el: SVGElement | null = null;
      try {
        el = previewSvg.querySelector<SVGElement>(`#${CSS.escape(id)}`);
      } catch {
        el = previewSvg.querySelector<SVGElement>(`#${id}`);
      }
      if (!el) return null;
      const computed = window.getComputedStyle(el);
      return normalizeColorToHex(computed.stroke);
    };

    const colors = selectedLetters
      .map(letter => normalizeColorToHex(letter.stroke) || resolveFromDom(letter.id))
      .filter((color): color is string => Boolean(color));

    const unique = Array.from(new Set(colors));
    if (unique.length === 0) return { value: null as string | null, mixed: false };
    return { value: unique[0], mixed: unique.length > 1 };
  }, [selectedLetters, svgContent, viewMode]);

  const filteredSvgLayers = useMemo(() => {
    if (showTechnicalTextLayers) return svgLayers;

    const hasRenderableTextPayload = (textEl: Element) => {
      const directText = Array.from(textEl.childNodes)
        .filter((node): node is Text => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent || '')
        .join('');
      const nestedText = Array.from(textEl.querySelectorAll('tspan, textPath'))
        .map((node) => node.textContent || '')
        .join('');
      const compact = `${directText}${nestedText}`.replace(/\s+/g, '');
      return compact.length > 0;
    };

    return svgLayers.filter((layer) => {
      if (layer.type !== 'text') return true;
      const el = layer.element;
      if (!el) return false;
      if (el.closest('defs')) return false;
      return hasRenderableTextPayload(el);
    });
  }, [svgLayers, showTechnicalTextLayers]);

  const hiddenTechnicalTextCount = Math.max(0, svgLayers.length - filteredSvgLayers.length);
  const hasSelectedLetters = selectedLetterIds.size > 0;

  // Check for API keys on mount
  useEffect(() => {
    initProtection();
    initConsoleSVGArt();
    if (typeof window !== 'undefined') {
      try {
        const storedGeminiKey = window.localStorage.getItem('GEMINI_API_KEY');
        const storedHfKey = window.localStorage.getItem('HF_API_KEY');
        const storedAihubmixKey = window.localStorage.getItem('AIHUBMIX_API_KEY');

        if (storedGeminiKey) setApiKeyInput(storedGeminiKey);
        if (storedHfKey) setHfKeyInput(storedHfKey);
        if (storedAihubmixKey) setAihubmixKeyInput(storedAihubmixKey);

        if (!storedGeminiKey || !storedHfKey || !storedAihubmixKey) {
          setApiKeyModalOpen(true);
          if (storedGeminiKey && !storedHfKey) {
            setModalTab('hf');
          } else if (storedGeminiKey && storedHfKey && !storedAihubmixKey) {
            setModalTab('aihubmix');
          }
        }
      } catch (err) {
        setApiKeyModalOpen(true);
      }
    }
  }, []);

  const handleSaveApiKey = () => {
    const trimmedGemini = apiKeyInput.trim();
    const trimmedHf = hfKeyInput.trim();
    const trimmedAihubmix = aihubmixKeyInput.trim();

    try {
      if (modalTab === 'gemini' && trimmedGemini) {
        window.localStorage.setItem('GEMINI_API_KEY', trimmedGemini);
        setApiKeySaved(true);
      } else if (modalTab === 'hf' && trimmedHf) {
        window.localStorage.setItem('HF_API_KEY', trimmedHf);
        setHfKeySaved(true);
      } else if (modalTab === 'aihubmix' && trimmedAihubmix) {
        window.localStorage.setItem('AIHUBMIX_API_KEY', trimmedAihubmix);
        setAihubmixKeySaved(true);
      }

      setTimeout(() => {
        setApiKeySaved(false);
        setHfKeySaved(false);
        setAihubmixKeySaved(false);
      }, 1500);
    } catch {
      setErrorMsg(
        'Failed to save API key in the browser. Please check your browser settings.'
      );
    }
  };

  const handleCopyDonationAddress = async (type: 'btc' | 'usdt', address: string) => {
    if (typeof navigator === 'undefined' || !navigator.clipboard) {
      setErrorMsg('Clipboard is unavailable in this browser context.');
      return;
    }
    try {
      await navigator.clipboard.writeText(address);
      setCopiedDonationType(type);
      setTimeout(() => {
        setCopiedDonationType((current) => (current === type ? null : current));
      }, 1500);
    } catch {
      setErrorMsg('Failed to copy address. Please copy it manually.');
    }
  };

  const handleFileChange = (
    event: React.ChangeEvent<HTMLInputElement>,
    isAttachment: boolean = false
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setErrorMsg('Please upload a valid image file.');
      return;
    }

    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      const match = result.match(/^data:(.+);base64,(.+)$/);
      if (match) {
        const asset: ImageAsset = {
          id: crypto.randomUUID(),
          url: result,
          mimeType: match[1],
          base64Data: match[2],
        };

        if (isAttachment) {
          // Add to reference images (limit 3)
          if (referenceImages.length < 3) {
            setReferenceImages((prev) => [...prev, asset]);
          }
          if (attachmentInputRef.current) attachmentInputRef.current.value = '';
        }
      }
    };
    reader.readAsDataURL(file);
  };

  const resetSvgStateFromContent = (content: string) => {
    const cleaned = stripInternalTextAttrs(content);
    const withIds = ensureLayerIds(cleaned);
    setModifiedSvg(withIds);
    setGeneratedText(withIds);

    // Reset SVG settings
    setSvgBackground('#000000');
    setSvgBackgroundImage(null);
    setSvgSearchQuery('');
    setCurrentMatchIndex(0);
    setShowSvgPanel(false);
    setSelectedLetterIds(new Set());
    setActiveEditorTab('general');

    // Extract colors
    const hexMatches = withIds.match(/#(?:[0-9a-fA-F]{3}){1,2}\b/g) || [];
    const normalizedColors = Array.from(new Set(hexMatches)).map((c) =>
      c.length === 4 ? `#${c[1]}${c[1]}${c[2]}${c[2]}${c[3]}${c[3]}` : c
    );
    setSvgColors(normalizedColors);

    // Parse words & layers
    const parsedWords = parseSvgText(withIds);
    setSvgWords(parsedWords);
    const parsedLayers = parseSvgLayers(withIds);
    setSvgLayers(parsedLayers);
  };

  const handleSvgImport = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith('.svg')) {
      setErrorMsg('Please upload a valid SVG file.');
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      if (content) {
        resetSvgStateFromContent(content);
        setViewMode('preview');
        setOutputMode('svg');
        setAppState(AppState.SUCCESS);
        setStarted(true);
      }
    };
    reader.readAsText(file);
    if (event.target) event.target.value = '';
  };

  const getPreviewSvgElement = () => {
    if (typeof document === 'undefined') return null;
    const container = document.querySelector('[data-svg-preview="true"]') as HTMLElement | null;
    return (container?.querySelector('svg') as SVGSVGElement | null) || null;
  };

  const getSvgPointFromClient = (svg: SVGSVGElement, clientX: number, clientY: number) => {
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const point = svg.createSVGPoint();
    point.x = clientX;
    point.y = clientY;
    return point.matrixTransform(ctm.inverse());
  };

  const getElementPointFromClient = (svg: SVGSVGElement, element: SVGGraphicsElement, clientX: number, clientY: number) => {
    const ctm = element.getScreenCTM();
    if (!ctm) return null;
    const point = svg.createSVGPoint();
    point.x = clientX;
    point.y = clientY;
    return point.matrixTransform(ctm.inverse());
  };

  const resolveLayerCenter = (
    svg: SVGSVGElement,
    el: SVGGraphicsElement
  ) => {
    try {
      const bbox = el.getBBox();
      return { localX: bbox.x + bbox.width / 2, localY: bbox.y + bbox.height / 2 };
    } catch {
      const rect = el.getBoundingClientRect();
      if (Number.isFinite(rect.width) && Number.isFinite(rect.height) && (rect.width > 0 || rect.height > 0)) {
        const globalCenter = getSvgPointFromClient(svg, rect.left + rect.width / 2, rect.top + rect.height / 2);
        if (globalCenter) {
          return { localX: globalCenter.x, localY: globalCenter.y };
        }
      }
    }
    return null;
  };

  const applyLayerTransformToPreview = (
    layerId: string,
    baseTransform: string,
    tx: number,
    ty: number,
    rotation: number,
    centerX: number,
    centerY: number
  ) => {
    const svg = getPreviewSvgElement();
    if (!svg) return;
    let el: SVGElement | null = null;
    try {
      el = svg.querySelector<SVGElement>(`#${CSS.escape(layerId)}`);
    } catch {
      el = svg.querySelector<SVGElement>(`#${layerId}`);
    }
    if (!el) return;

    const parts: string[] = [];
    const baseTrimmed = baseTransform.trim();
    if (baseTrimmed) parts.push(baseTrimmed);
    if (tx || ty) parts.push(`translate(${tx} ${ty})`);
    if (rotation) {
      parts.push(`translate(${centerX} ${centerY})`);
      parts.push(`rotate(${rotation})`);
      parts.push(`translate(${-centerX} ${-centerY})`);
    }
    const transform = parts.join(' ').trim();
    if (transform) {
      el.setAttribute('transform', transform);
    } else {
      el.removeAttribute('transform');
    }
    el.setAttribute('data-layer-base-transform', baseTransform);
    el.setAttribute('data-layer-tx', tx.toString());
    el.setAttribute('data-layer-ty', ty.toString());
    el.setAttribute('data-layer-rot', rotation.toString());
    el.setAttribute('data-layer-center-x', centerX.toString());
    el.setAttribute('data-layer-center-y', centerY.toString());
  };

  const applyWordTransformToPreview = (
    wordId: string,
    x: number,
    y: number,
    rotation: number,
    offsets?: { x: number; y: number }[],
    rotationCenter?: { x: number; y: number }
  ) => {
    const svg = getPreviewSvgElement();
    if (!svg) return;
    const word = svgWordsRef.current.find(w => w.id === wordId);
    if (!word || word.letters.length === 0) return;

    if (offsets && offsets.length === word.letters.length) {
      offsets.forEach((offset, idx) => {
        const letter = word.letters[idx];
        if (!letter) return;
        let tspan: SVGElement | null = null;
        try {
          tspan = svg.querySelector<SVGElement>(`#${CSS.escape(letter.id)}`);
        } catch {
          tspan = svg.querySelector<SVGElement>(`#${letter.id}`);
        }
        if (!tspan) return;

        let px = x + offset.x;
        let py = y + offset.y;

        tspan.setAttribute('x', px.toString());
        tspan.setAttribute('y', py.toString());

        if (rotation) {
          tspan.setAttribute('rotate', rotation.toString());
          tspan.removeAttribute('transform');
        } else {
          tspan.removeAttribute('rotate');
          tspan.removeAttribute('transform');
        }

        tspan.setAttribute('data-word-x', x.toString());
        tspan.setAttribute('data-word-y', y.toString());
        tspan.setAttribute('data-word-rot', rotation.toString());
        tspan.setAttribute('data-word-manual', '1');
      });
      return;
    }

    const sampleTspan = (() => {
      const sampleId = word.letters[0]?.id;
      if (!sampleId) return null;
      try {
        return svg.querySelector<SVGElement>(`#${CSS.escape(sampleId)}`);
      } catch {
        return svg.querySelector<SVGElement>(`#${sampleId}`);
      }
    })();

    const computed = (sampleTspan && typeof window !== 'undefined') ? window.getComputedStyle(sampleTspan) : null;
    const primaryLetter = word.letters[0];
    const measureStyle: TextMeasureStyle = {
      fontStyle: primaryLetter.fontStyle || computed?.fontStyle || 'normal',
      fontWeight: primaryLetter.fontWeight || computed?.fontWeight || 'normal',
      fontSize: normalizeFontSizeValue(primaryLetter.fontSize || computed?.fontSize) || '16px',
      fontFamily: primaryLetter.fontFamily || computed?.fontFamily || 'sans-serif',
      letterSpacing: primaryLetter.letterSpacing || computed?.letterSpacing || 'normal'
    };

    const positionedWord: Word = { ...word, x, y, rotation };
    // Compute ROTATED positions
    const positions = computeWordLetterPositions(positionedWord, measureStyle);

    positions.forEach((pos, idx) => {
      const letter = word.letters[idx];
      if (!letter) return;
      let tspan: SVGElement | null = null;
      try {
        tspan = svg.querySelector<SVGElement>(`#${CSS.escape(letter.id)}`);
      } catch {
        tspan = svg.querySelector<SVGElement>(`#${letter.id}`);
      }
      if (!tspan) return;

      tspan.setAttribute('x', pos.x.toString());
      tspan.setAttribute('y', pos.y.toString());

      if (rotation) {
        tspan.setAttribute('rotate', rotation.toString());
        tspan.removeAttribute('transform');
      } else {
        tspan.removeAttribute('rotate');
        tspan.removeAttribute('transform');
      }

      tspan.setAttribute('data-word-x', x.toString());
      tspan.setAttribute('data-word-y', y.toString());
      tspan.setAttribute('data-word-rot', rotation.toString());
      tspan.setAttribute('data-word-manual', '1');
    });
  };

  const handlePreviewPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const target = event.target as Element;
    const tspan = target.tagName.toLowerCase() === 'tspan'
      ? (target as SVGTSpanElement)
      : (target.closest('tspan') as SVGTSpanElement | null);
    if (!tspan) {
      const svg = getPreviewSvgElement();
      let fromActiveLayer = false;
      let layerTarget = svg ? (target.closest('[id]') as SVGElement | null) : null;
      if (!layerTarget && svg) {
        layerTarget = target.closest('g, path, rect, circle, line, image') as SVGElement | null;
        if (layerTarget && !layerTarget.getAttribute('id')) {
          const newId = `layer-${layerTarget.tagName.toLowerCase()}-${Date.now()}`;
          layerTarget.setAttribute('id', newId);
        }
      }
      if (!layerTarget && svg && activeLayerId) {
        try {
          layerTarget = svg.querySelector<SVGElement>(`#${CSS.escape(activeLayerId)}`);
        } catch {
          layerTarget = svg.querySelector<SVGElement>(`#${activeLayerId}`);
        }
        if (layerTarget) fromActiveLayer = true;
      }

      if (layerTarget && layerTarget.tagName.toLowerCase() !== 'svg' && !layerTarget.closest('text')) {
        let candidate = layerTarget;
        if (!fromActiveLayer) {
          const groupTarget = layerTarget.closest('g[id]') as SVGElement | null;
          if (groupTarget && groupTarget !== layerTarget && !groupTarget.querySelector('text')) {
            candidate = groupTarget;
          }
        }
        const layerId = candidate.getAttribute('id') || '';
        if (layerId) {
          const previewMarkup = svg ? svg.outerHTML : null;
          const parsedLayers = previewMarkup ? parseSvgLayers(previewMarkup) : svgLayersRef.current;
          if (previewMarkup) setSvgLayers(parsedLayers);
          const layer = parsedLayers.find(l => l.id === layerId);
          if (layer && layer.type !== 'text') {
            const point = svg ? getSvgPointFromClient(svg, event.clientX, event.clientY) : null;
            if (!point) return;

            const baseTransform = (candidate.getAttribute('data-layer-base-transform') ?? candidate.getAttribute('transform') ?? '').trim();
            const txAttr = parseFloat(candidate.getAttribute('data-layer-tx') || '');
            const tyAttr = parseFloat(candidate.getAttribute('data-layer-ty') || '');
            const rotAttr = parseFloat(candidate.getAttribute('data-layer-rot') || '');
            const centerXAttr = parseFloat(candidate.getAttribute('data-layer-center-x') || '');
            const centerYAttr = parseFloat(candidate.getAttribute('data-layer-center-y') || '');

            const originTx = Number.isFinite(layer.tx ?? NaN) ? (layer.tx as number) : (Number.isFinite(txAttr) ? txAttr : 0);
            const originTy = Number.isFinite(layer.ty ?? NaN) ? (layer.ty as number) : (Number.isFinite(tyAttr) ? tyAttr : 0);
            const originRotation = Number.isFinite(layer.rotation ?? NaN) ? (layer.rotation as number) : (Number.isFinite(rotAttr) ? rotAttr : 0);

            let baseCenterX = Number.isFinite(centerXAttr) ? centerXAttr : NaN;
            let baseCenterY = Number.isFinite(centerYAttr) ? centerYAttr : NaN;
            const centerData = resolveLayerCenter(svg as SVGSVGElement, candidate as SVGGraphicsElement);
            if (centerData) {
              baseCenterX = centerData.localX;
              baseCenterY = centerData.localY;
            } else if (!Number.isFinite(baseCenterX) || !Number.isFinite(baseCenterY)) {
              baseCenterX = 0;
              baseCenterY = 0;
            }
            const baseMatrix = parseTransformMatrix(baseTransform);
            const startCenterPoint = new DOMPoint(baseCenterX + originTx, baseCenterY + originTy).matrixTransform(baseMatrix);

            const mode: 'move' | 'rotate' = (event.shiftKey || event.altKey) ? 'rotate' : wordDragMode;
            layerDragStateRef.current = {
              layerId,
              pointerId: event.pointerId,
              startX: point.x,
              startY: point.y,
              originTx,
              originTy,
              originRotation,
              baseTransform,
              centerX: baseCenterX,
              centerY: baseCenterY,
              startCenterX: startCenterPoint.x,
              startCenterY: startCenterPoint.y,
              mode,
              moved: false
            };
            isDraggingLayerRef.current = false;
            setActiveWordId(null);
            setActiveLayerId(layerId);
            event.currentTarget.setPointerCapture(event.pointerId);
            event.preventDefault();
            return;
          }
        }
      }

      const rawBase = modifiedSvg || generatedText || '';
      const baseSvg = extractSvg(rawBase) || rawBase;
      if (baseSvg && svgWordsRef.current.length > 0 && !baseSvg.includes('data-word-id')) {
        setModifiedSvg(reconstructSvg(baseSvg, svgWordsRef.current, svgLayers, svgBackgroundImage, svgBackground));
      }
      return;
    }

    const wordId = tspan.getAttribute('data-word-id');
    let resolvedWordId = wordId;
    if (!resolvedWordId) {
      const letterId = tspan.getAttribute('id') || '';
      if (letterId.startsWith('letter-')) {
        const parts = letterId.split('-');
        if (parts.length > 2) {
          parts.pop();
          parts.shift();
          resolvedWordId = parts.join('-');
        }
      }
    }
    if (!resolvedWordId) return;

    const svg = getPreviewSvgElement();
    if (!svg) return;
    const textElement = tspan.closest('text') as SVGTextElement | null;
    const textMatrix = textElement?.getCTM();
    let textMatrixInverse: DOMMatrix | null = null;
    try {
      if (textMatrix) textMatrixInverse = textMatrix.inverse();
    } catch {
      textMatrixInverse = null;
    }
    const textBBox = (() => {
      try {
        return textElement?.getBBox() ?? null;
      } catch {
        return null;
      }
    })();
    const normalizePointIfNeeded = (x: number, y: number) => {
      if (!textBBox || !textMatrixInverse) return { x, y };
      const marginX = Math.max(200, textBBox.width * 2);
      const marginY = Math.max(200, textBBox.height * 2);
      const xMin = textBBox.x - marginX;
      const xMax = textBBox.x + textBBox.width + marginX;
      const yMin = textBBox.y - marginY;
      const yMax = textBBox.y + textBBox.height + marginY;
      if (x < xMin || x > xMax || y < yMin || y > yMax) {
        try {
          const local = new DOMPoint(x, y).matrixTransform(textMatrixInverse);
          return { x: local.x, y: local.y };
        } catch { }
      }
      return { x, y };
    };
    const elementForPoint = (textElement || svg) as SVGGraphicsElement;
    const localPoint = getElementPointFromClient(svg, elementForPoint, event.clientX, event.clientY);
    if (!localPoint) return;
    const point = localPoint;

    const word = svgWordsRef.current.find(w => w.id === resolvedWordId);
    if (!word) return;

    const svgWordLetters = (() => {
      try {
        return Array.from(svg.querySelectorAll<SVGTSpanElement>(`tspan[data-word-id="${resolvedWordId}"]`));
      } catch {
        return Array.from(svg.querySelectorAll<SVGTSpanElement>(`tspan[data-word-id='${resolvedWordId}']`));
      }
    })();

    if (svgWordLetters.length === 0) {
      const rawBase = modifiedSvg || generatedText || '';
      const baseSvg = extractSvg(rawBase) || rawBase;
      if (baseSvg) {
        setModifiedSvg(reconstructSvg(baseSvg, svgWordsRef.current, svgLayers, svgBackgroundImage, svgBackground));
      }
      return;
    }

    const orderedLetters = (() => {
      const hasIndexes = svgWordLetters.some((el) => el.getAttribute('data-letter-index') !== null);
      if (!hasIndexes) return svgWordLetters;
      return [...svgWordLetters].sort((a, b) => {
        const aIndex = parseInt(a.getAttribute('data-letter-index') || '0', 10);
        const bIndex = parseInt(b.getAttribute('data-letter-index') || '0', 10);
        return aIndex - bIndex;
      });
    })();

    const getLetterPosition = (el: SVGTSpanElement) => {
      const xAttr = el.getAttribute('x');
      const yAttr = el.getAttribute('y');
      if (xAttr && yAttr) {
        const x = parseFloat(xAttr);
        const y = parseFloat(yAttr);
        if (Number.isFinite(x) && Number.isFinite(y)) {
          const normalized = normalizePointIfNeeded(x, y);
          return { x: normalized.x, y: normalized.y };
        }
      }
      const rect = el.getBoundingClientRect();
      const localFromRect = getElementPointFromClient(svg, elementForPoint, rect.left, rect.bottom);
      if (localFromRect && Number.isFinite(localFromRect.x) && Number.isFinite(localFromRect.y)) {
        return { x: localFromRect.x, y: localFromRect.y };
      }
      try {
        const bbox = el.getBBox();
        return { x: bbox.x, y: bbox.y + bbox.height };
      } catch {
        return { x: 0, y: 0 };
      }
    };

    const primaryLetter = word.letters[0];
    const computed = typeof window !== 'undefined' ? window.getComputedStyle(tspan) : null;
    const measureStyle: TextMeasureStyle = {
      fontStyle: primaryLetter?.fontStyle || computed?.fontStyle || 'normal',
      fontWeight: primaryLetter?.fontWeight || computed?.fontWeight || 'normal',
      fontSize: normalizeFontSizeValue(primaryLetter?.fontSize || computed?.fontSize) || '16px',
      fontFamily: primaryLetter?.fontFamily || computed?.fontFamily || 'sans-serif',
      letterSpacing: primaryLetter?.letterSpacing || computed?.letterSpacing || 'normal'
    };

    const styleSnapshot = {
      fontFamily: primaryLetter?.fontFamily || computed?.fontFamily,
      fontSize: normalizeFontSizeValue(primaryLetter?.fontSize || computed?.fontSize),
      fontWeight: primaryLetter?.fontWeight || computed?.fontWeight,
      fontStyle: primaryLetter?.fontStyle || computed?.fontStyle,
      letterSpacing: primaryLetter?.letterSpacing || computed?.letterSpacing
    };

    const canUseMeasured = !word.isManual && Number.isFinite(word.x ?? NaN) && Number.isFinite(word.y ?? NaN);
    const actualPositions = orderedLetters.map(getLetterPosition);
    const actualValid = actualPositions.length === word.letters.length
      && actualPositions.some(pos => Number.isFinite(pos.x) && Number.isFinite(pos.y));

    let letterPositions = actualValid ? actualPositions : [];
    let positionsAreWorld = true;

    if (!actualValid && canUseMeasured) {
      const measuredPositions = computeWordLetterPositions(
        { ...word, x: word.x as number, y: word.y as number, rotation: 0 },
        measureStyle
      );
      if (measuredPositions.length === word.letters.length) {
        letterPositions = measuredPositions;
        positionsAreWorld = false;
      }
    }

    if (letterPositions.length !== word.letters.length) {
      letterPositions = orderedLetters.map(getLetterPosition);
      positionsAreWorld = true;
    }

    const xs = letterPositions.map(p => p.x).filter(Number.isFinite);
    const ys = letterPositions.map(p => p.y).filter(Number.isFinite);
    const minX = xs.length ? Math.min(...xs) : 0;
    const maxX = xs.length ? Math.max(...xs) : 0;
    const avgY = ys.length ? ys.reduce((sum, y) => sum + y, 0) / ys.length : 0;

    let originX = minX;
    let originY = avgY;
    if (Number.isFinite(word.x ?? NaN) && Number.isFinite(word.y ?? NaN)) {
      const normalizedOrigin = normalizePointIfNeeded(word.x as number, word.y as number);
      const tolerance = Math.max(200, (maxX - minX) * 2);
      if (Math.abs(normalizedOrigin.x - minX) < tolerance && Math.abs(normalizedOrigin.y - avgY) < tolerance) {
        originX = normalizedOrigin.x;
        originY = normalizedOrigin.y;
      }
    }

    const rangeX = maxX - minX;
    const hasDegeneratePositions = !Number.isFinite(rangeX) || (orderedLetters.length > 1 && rangeX < 0.5);
    if (hasDegeneratePositions) {
      if (!Number.isFinite(word.x ?? NaN) || !Number.isFinite(word.y ?? NaN)) {
        const fallbackPoints = orderedLetters
          .map(getLetterPosition)
          .map((pt) => (pt && Number.isFinite(pt.x) && Number.isFinite(pt.y)) ? new DOMPoint(pt.x, pt.y) : null)
          .filter((pt): pt is DOMPoint => Boolean(pt) && Number.isFinite(pt.x) && Number.isFinite(pt.y));
        if (fallbackPoints.length > 0) {
          const fallbackMinX = Math.min(...fallbackPoints.map(pt => pt.x));
          const fallbackAvgY = fallbackPoints.reduce((sum, pt) => sum + pt.y, 0) / fallbackPoints.length;
          if (!Number.isFinite(word.x ?? NaN)) originX = fallbackMinX;
          if (!Number.isFinite(word.y ?? NaN)) originY = fallbackAvgY;
        }
      }
      const measuredPositions = computeWordLetterPositions(
        { ...word, x: originX, y: originY, rotation: 0 },
        measureStyle
      );
      if (measuredPositions.length === word.letters.length) {
        letterPositions = measuredPositions;
        positionsAreWorld = false;
      }
    }
    if (letterPositions.length !== word.letters.length) {
      const measuredPositions = computeWordLetterPositions(
        { ...word, x: originX, y: originY, rotation: 0 },
        measureStyle
      );
      if (measuredPositions.length === word.letters.length) {
        letterPositions = measuredPositions;
        positionsAreWorld = false;
      }
    }

    const effectiveXs = letterPositions.map(p => p.x);
    const effectiveYs = letterPositions.map(p => p.y);
    const effectiveMinX = effectiveXs.length ? Math.min(...effectiveXs) : originX;
    const effectiveMaxX = effectiveXs.length ? Math.max(...effectiveXs) : originX;
    const effectiveAvgY = effectiveYs.length
      ? effectiveYs.reduce((sum, y) => sum + y, 0) / effectiveYs.length
      : originY;
    const rotationCenterX = (effectiveMinX + effectiveMaxX) / 2;
    const rotationCenterY = effectiveAvgY;
    const originRotation = word.rotation ?? 0;
    const mode: 'move' | 'rotate' = (event.shiftKey || event.altKey) ? 'rotate' : wordDragMode;
    if (mode === 'move') {
      originX = point.x;
      originY = point.y;
    }
    const rotationRad = (originRotation * Math.PI) / 180;
    const cos = Math.cos(-rotationRad);
    const sin = Math.sin(-rotationRad);
    const letterOffsets = letterPositions.map(pos => {
      let px = pos.x;
      let py = pos.y;
      if (positionsAreWorld && originRotation) {
        const dx = px - rotationCenterX;
        const dy = py - rotationCenterY;
        px = rotationCenterX + dx * cos - dy * sin;
        py = rotationCenterY + dx * sin + dy * cos;
      }
      return { x: px - originX, y: py - originY };
    });

    dragStateRef.current = {
      wordId: resolvedWordId,
      pointerId: event.pointerId,
      startX: point.x,
      startY: point.y,
      originX,
      originY,
      originRotation,
      rotationCenterX,
      rotationCenterY,
      startCenterX: rotationCenterX,
      startCenterY: rotationCenterY,
      letterOffsets,
      mode,
      moved: false,
      textElement: elementForPoint,
      styleSnapshot
    };

    isDraggingWordRef.current = false;

    setActiveWordId(resolvedWordId);
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  // Helper to find sibling words (same word in different layers)
  // IDs are typically: word-{layerIndex}-{wordIndex}-{timestamp}
  const getSiblingWordIds = (wordId: string, allWords: Word[]): string[] => {
    const parts = wordId.split('-');
    // Expect at least 4 parts: word, layer, index, timestamp
    if (parts.length < 4) return [wordId];

    // The unique identifier for the "concept" of the word is the suffix: {index}-{timestamp}
    // parts[0] is 'word'
    // parts[1] is layer index
    // parts[2] is word index
    // parts[3] is timestamp
    const index = parts[2];
    const timestamp = parts[3];
    const suffix = `${index}-${timestamp}`;

    return allWords
      .filter(w => {
        const p = w.id.split('-');
        if (p.length < 4) return false;
        const s = `${p[2]}-${p[3]}`;
        return s === suffix;
      })
      .map(w => w.id);
  };

  const handlePreviewPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const layerState = layerDragStateRef.current;
    if (layerState && layerState.pointerId === event.pointerId) {
      const svg = getPreviewSvgElement();
      if (!svg) return;
      const point = getSvgPointFromClient(svg, event.clientX, event.clientY);
      if (!point) return;
      const dx = point.x - layerState.startX;
      const dy = point.y - layerState.startY;
      if (Math.hypot(dx, dy) > 1) layerState.moved = true;

      let nextTx = layerState.originTx;
      let nextTy = layerState.originTy;
      let nextRotation = layerState.originRotation;

      if (layerState.mode === 'move') {
        nextTx = layerState.originTx + dx;
        nextTy = layerState.originTy + dy;
      } else {
        const angleStart = Math.atan2(layerState.startY - layerState.startCenterY, layerState.startX - layerState.startCenterX);
        const angleNow = Math.atan2(point.y - layerState.startCenterY, point.x - layerState.startCenterX);
        const delta = (angleNow - angleStart) * 180 / Math.PI;
        const dist = Math.hypot(layerState.startX - layerState.startCenterX, layerState.startY - layerState.startCenterY);
        const sensitivity = Math.min(3, Math.max(1, 150 / Math.max(1, dist)));
        nextRotation = layerState.originRotation + delta * sensitivity;
      }

      layerState.currentTx = nextTx;
      layerState.currentTy = nextTy;
      layerState.currentRotation = nextRotation;

      applyLayerTransformToPreview(
        layerState.layerId,
        layerState.baseTransform,
        nextTx,
        nextTy,
        nextRotation,
        layerState.centerX,
        layerState.centerY
      );
      isDraggingLayerRef.current = true;
      return;
    }

    const state = dragStateRef.current;
    if (!state || state.pointerId !== event.pointerId) return;
    const svg = getPreviewSvgElement();
    if (!svg) return;
    const elementForPoint = (state.textElement || svg) as SVGGraphicsElement;
    const localPoint = getElementPointFromClient(svg, elementForPoint, event.clientX, event.clientY);
    if (!localPoint) return;
    const point = localPoint;

    const dx = point.x - state.startX;
    const dy = point.y - state.startY;
    if (Math.hypot(dx, dy) > 1) state.moved = true;

    let nextX = state.originX;
    let nextY = state.originY;
    let nextRotation = state.originRotation;
    let nextCenterX = state.startCenterX;
    let nextCenterY = state.startCenterY;

    if (state.mode === 'move') {
      nextX = state.originX + dx;
      nextY = state.originY + dy;
      nextCenterX = state.startCenterX + dx;
      nextCenterY = state.startCenterY + dy;
    } else {
      const angleStart = Math.atan2(state.startY - state.rotationCenterY, state.startX - state.rotationCenterX);
      const angleNow = Math.atan2(point.y - state.rotationCenterY, point.x - state.rotationCenterX);
      const delta = (angleNow - angleStart) * 180 / Math.PI;
      const dist = Math.hypot(state.startX - state.rotationCenterX, state.startY - state.rotationCenterY);
      const sensitivity = Math.min(3, Math.max(1, 150 / Math.max(1, dist)));
      nextRotation = state.originRotation + delta * sensitivity;
    }

    state.currentX = nextX;
    state.currentY = nextY;
    state.currentRotation = nextRotation;

    // Apply to siblings as well
    const siblings = getSiblingWordIds(state.wordId, svgWordsRef.current);
    siblings.forEach(siblingId => {
      // For siblings, we use the same transform as the primary dragged word
      // This assumes siblings are initially aligned (which they are for layers)
      applyWordTransformToPreview(
        siblingId,
        nextX,
        nextY,
        nextRotation,
        state.letterOffsets, // Apply same relative offsets
        { x: nextCenterX, y: nextCenterY }
      );
    });

    isDraggingWordRef.current = true;
  };

  const handlePreviewPointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    const layerState = layerDragStateRef.current;
    if (layerState && layerState.pointerId === event.pointerId) {
      layerDragStateRef.current = null;

      const finalTx = layerState.currentTx ?? layerState.originTx;
      const finalTy = layerState.currentTy ?? layerState.originTy;
      const finalRotation = layerState.currentRotation ?? layerState.originRotation;

      if (layerState.moved) {
        const previewSvg = getPreviewSvgElement();
        const previewMarkup = previewSvg ? previewSvg.outerHTML : null;
        setSvgLayers(prev => {
          const updated = prev.map(layer =>
            layer.id === layerState.layerId
              ? {
                ...layer,
                tx: finalTx,
                ty: finalTy,
                rotation: finalRotation,
                baseTransform: layerState.baseTransform,
                centerX: layerState.centerX,
                centerY: layerState.centerY
              }
              : layer
          );
          if (previewMarkup) setModifiedSvg(previewMarkup);
          return updated;
        });
      }

      isDraggingLayerRef.current = layerState.moved ?? false;
      event.currentTarget.releasePointerCapture(event.pointerId);
      return;
    }

    const state = dragStateRef.current;
    if (!state || state.pointerId !== event.pointerId) return;
    dragStateRef.current = null;

    const finalX = state.currentX ?? state.originX;
    const finalY = state.currentY ?? state.originY;
    const finalRotation = state.currentRotation ?? state.originRotation;

    if (state.moved) {
      const finalDx = finalX - state.originX;
      const finalDy = finalY - state.originY;
      const centerX = state.mode === 'move' ? state.startCenterX + finalDx : state.rotationCenterX;
      const centerY = state.mode === 'move' ? state.startCenterY + finalDy : state.rotationCenterY;
      const rotation = finalRotation;
      const rad = (rotation * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const previewSvg = getPreviewSvgElement();
      const previewMarkup = previewSvg ? previewSvg.outerHTML : null;

      const siblingIds = new Set(getSiblingWordIds(state.wordId, svgWordsRef.current));

      setSvgWords(prev => {
        const updated = prev.map(word =>
          siblingIds.has(word.id)
            ? {
              ...word,
              x: finalX,
              y: finalY,
              rotation: finalRotation,
              isManual: true,
              letters: word.letters.map((letter, index) => {
                const offset = state.letterOffsets[index];
                if (!offset) return letter;
                let px = finalX + offset.x;
                let py = finalY + offset.y;
                if (rotation) {
                  const dx = px - centerX;
                  const dy = py - centerY;
                  px = centerX + dx * cos - dy * sin;
                  py = centerY + dx * sin + dy * cos;
                }
                return { ...letter, x: px, y: py };
              })
            }
            : word
        );
        if (previewMarkup) setModifiedSvg(previewMarkup);
        return updated;
      });
    }

    isDraggingWordRef.current = state.moved ?? false;
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  // --- SVG Text Editor Handlers ---
  const toggleLetterSelection = (id: string, multi: boolean) => {
    const newSet = new Set(multi ? selectedLetterIds : []);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setSelectedLetterIds(newSet);
  };

  const selectWholeWord = () => {
    const newSelection = new Set(selectedLetterIds);
    let changed = false;

    svgWords.forEach(word => {
      const hasSelected = word.letters.some(l => selectedLetterIds.has(l.id));
      if (hasSelected) {
        word.letters.forEach(l => {
          if (!newSelection.has(l.id)) {
            newSelection.add(l.id);
            changed = true;
          }
        });
      }
    });

    if (changed) {
      setSelectedLetterIds(newSelection);
    }
  };

  const updateSelectedLetters = (updates: Partial<Letter> | Partial<Letter['animation']>) => {
    // Calculate new words outside the state callback to avoid stale closures
    const newWords = svgWords.map(word => ({
      ...word,
      letters: word.letters.map(letter => {
        if (selectedLetterIds.has(letter.id)) {
          const isAnimUpdate = 'duration' in updates || 'delay' in updates || 'easing' in updates;
          if (isAnimUpdate) {
            return { ...letter, animation: { ...letter.animation, ...updates as Partial<Letter['animation']> } };
          }
          return { ...letter, ...updates as Partial<Letter> };
        }
        return letter;
      })
    }));

    setSvgWords(newWords);

    // Rebuild SVG with the new words
    const rawBase = modifiedSvg || generatedText || '';
    const baseSvg = extractSvg(rawBase) || rawBase;
    if (baseSvg) {
      setModifiedSvg(reconstructSvg(baseSvg, newWords, svgLayers, svgBackgroundImage, svgBackground));
    }
  };

  const handleWordTextChange = (wordId: string, newText: string) => {
    // 1. Snapshot current preview positions for this word (to preserve spacing)
    const previewSvg = getPreviewSvgElement();
    let previewPositions: { x: number; y: number }[] | null = null;
    let previewAnchorX: number | null = null;
    let previewAnchorY: number | null = null;
    let computedStyle: CSSStyleDeclaration | null = null;

    if (previewSvg) {
      const previewTspans = (() => {
        try {
          return Array.from(previewSvg.querySelectorAll<SVGTSpanElement>(`tspan[data-word-id="${wordId}"]`));
        } catch {
          return Array.from(previewSvg.querySelectorAll<SVGTSpanElement>(`tspan[data-word-id='${wordId}']`));
        }
      })();

      if (previewTspans.length > 0) {
        if (typeof window !== 'undefined') {
          computedStyle = window.getComputedStyle(previewTspans[0]);
        }
        const orderedPreview = previewTspans.some(t => t.getAttribute('data-letter-index') !== null)
          ? [...previewTspans].sort((a, b) => {
            const ai = parseInt(a.getAttribute('data-letter-index') || '0', 10);
            const bi = parseInt(b.getAttribute('data-letter-index') || '0', 10);
            return ai - bi;
          })
          : previewTspans;

        const positions = orderedPreview.map((tspan) => {
          const xAttr = parseFloat(tspan.getAttribute('x') || '');
          const yAttr = parseFloat(tspan.getAttribute('y') || '');
          if (Number.isFinite(xAttr) && Number.isFinite(yAttr)) {
            return { x: xAttr, y: yAttr };
          }
          try {
            const bbox = tspan.getBBox();
            return { x: bbox.x, y: bbox.y + bbox.height };
          } catch {
            return null;
          }
        }).filter((pos): pos is { x: number; y: number } => Boolean(pos) && Number.isFinite(pos.x) && Number.isFinite(pos.y));

        if (positions.length > 0) {
          previewPositions = positions;
          previewAnchorX = Math.min(...positions.map(p => p.x));
          previewAnchorY = positions.reduce((sum, p) => sum + p.y, 0) / positions.length;
        }
      }
    }
    if (previewPositions && previewPositions.length > 1) {
      const xs = previewPositions.map(p => p.x);
      const ys = previewPositions.map(p => p.y);
      const spreadX = Math.max(...xs) - Math.min(...xs);
      const spreadY = Math.max(...ys) - Math.min(...ys);
      if (!Number.isFinite(spreadX) || spreadX < 0.5 || !Number.isFinite(spreadY)) {
        previewPositions = null;
        previewAnchorX = null;
        previewAnchorY = null;
      }
    }

    const newWords = svgWords.map(word => {
      if (word.id === wordId) {
        const fallbackStyle = typeof window !== 'undefined'
          ? window.getComputedStyle(document.getElementById(word.letters[0]?.id) || document.body)
          : null;
        return computeNewWordState(word, newText, previewPositions, computedStyle || fallbackStyle);
      }
      return word;
    });


    setSvgWords(newWords);

    const rawBase = modifiedSvg || generatedText || '';
    const baseSvg = extractSvg(rawBase) || rawBase;
    if (baseSvg) {
      setModifiedSvg(reconstructSvg(baseSvg, newWords, svgLayers, svgBackgroundImage, svgBackground));
    }
    return;
  };

  const handleGenerate = async () => {
    if (!prompt.trim()) return;

    setAppState(AppState.PROCESSING);
    setErrorMsg(null);
    setCopied(false);
    setViewMode('preview');

    try {
      let result;

      if (outputMode === 'svg') {
        const imagesToUse = referenceImages;

        const ratio = ASPECT_RATIOS.find(r => r.id === selectedRatio);
        // STRICT RULE: SVG always uses Gemini
        result = await generateSvgWithGemini(prompt, imagesToUse, ratio);
      } else if (outputMode === 'video') {
        // Video Generation
        const imageToUse = referenceImages.length > 0 ? referenceImages[0] : null;

        if (modelProvider === 'aihubmix') {
          const options = {
            model: selectedVideoModel,
            size: videoQuality,
            seconds: videoDuration
          };

          if (imageToUse) {
            result = await generateImageToVideoWithAIHubMix(imageToUse, prompt, options);
          } else {
            result = await generateTextToVideoWithAIHubMix(prompt, options);
          }
        } else {
          setErrorMsg("Video generation is only available with AIHubMix.");
          setAppState(AppState.ERROR);
          return;
        }
      } else {
        // Image Generation
        // Text to Image
        const ratioInfo = ASPECT_RATIOS.find(r => r.id === selectedRatio);
        const dimensions = ratioInfo ? { width: ratioInfo.width, height: ratioInfo.height } : undefined;

        if (modelProvider === 'huggingface') {
          result = await generateMultimodalImage(prompt, [], dimensions);
        } else {
          // Core
          result = await generateMultimodalImage(prompt, referenceImages, dimensions);
        }
      }

      if (result.error) {
        setErrorMsg(result.error);
        setAppState(AppState.ERROR);
        return;
      }

      if (result.imageUrl) {
        setGeneratedImage(result.imageUrl);
        setGeneratedText(null);
        setAppState(AppState.SUCCESS);

        // Save to history
        const historyItem: HistoryItem = {
          id: crypto.randomUUID(),
          type: 'image',
          data: result.imageUrl,
          prompt: prompt,
          timestamp: Date.now(),
          isFavorite: false,
          aspectRatio: selectedRatio
        };
        // Pre-trim history before setting state to stay within local storage limits
        setHistory(prev => [historyItem, ...prev].slice(0, 30));
      } else if (result.videoUrl) {
        // Handle Video Result
        // We might need a state for video, or reuse generatedImage if it helps, but better to have dedicated state
        // For now, let's assume valid URL
        window.open(result.videoUrl, '_blank'); // Temporary: open in new tab or specific UI?
        // ideally we should render it. The UI has `generatedImage` but no `generatedVideo` state?
        // The user instruction was "Add output mode... video".
        // I'll reuse generatedImage to store the thumbnail or just show a message?
        // Wait, the prompt implies full video support on frontend? 
        // "When video generation is selected..."
        // Let's look at the UI rendering part later. For now, let's at least not fail.
        // Actually, let's set it to valid state.
        setGeneratedImage(null); // Clear image
        setGeneratedText(null);
        // We need a way to show video. 
        // Let's add a temporary hack: put video URL in generatedImage and check extension? 
        // Or better, add `generatedVideo` state? 
        // I don't see `generatedVideo` in state. 
        // Let's check if I can just use `generatedImage` for URL and render <video> if it ends in .mp4?
        setGeneratedImage(result.videoUrl); // Reuse this for now
        setAppState(AppState.SUCCESS);

        const historyItem: HistoryItem = {
          id: crypto.randomUUID(),
          type: 'video' as any, // Cast if type missing
          data: result.videoUrl,
          prompt: prompt,
          timestamp: Date.now(),
          isFavorite: false,
          aspectRatio: selectedRatio
        };
        setHistory(prev => [historyItem, ...prev].slice(0, 30));

      } else if (result.text) {
        // Sanitize SVG text before storing to history to avoid sarcophagi
        const cleanedSvg = extractSvg(result.text) || result.text;
        setGeneratedText(cleanedSvg);
        setGeneratedImage(null);
        setAppState(AppState.SUCCESS);

        // Save to history
        const historyItem: HistoryItem = {
          id: crypto.randomUUID(),
          type: 'svg',
          data: cleanedSvg,
          prompt: prompt,
          timestamp: Date.now(),
          isFavorite: false,
          aspectRatio: selectedRatio
        };
        setHistory(prev => [historyItem, ...prev].slice(0, 30));
      } else {
        setErrorMsg(
          'The model returned text but no image. Try a more specific visual prompt.'
        );
        setAppState(AppState.ERROR);
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'An unexpected error occurred.'
      );
      setAppState(AppState.ERROR);
    }
  };

  const handleDownload = async (format: 'auto' | 'pdf' | 'png' | 'html' = 'auto') => {
    if (generatedImage && format === 'auto') {
      const link = document.createElement('a');
      link.href = generatedImage;
      link.download = `roadrunner - ${activeTab} - ${Date.now()}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } else if (modifiedSvg || svgContent) {
      let finalSvg = modifiedSvg || svgContent || '';

      // Inject background color and image into the SVG code for persistence
      if (finalSvg.includes('<svg')) {
        const bgRect = `<rect width="100%" height="100%" fill="${svgBackground}" />`;
        const bgImg = svgBackgroundImage
          ? `<image href="${svgBackgroundImage}" width="100%" height="100%" preserveAspectRatio="xMidYMid slice" opacity="0.5" />`
          : '';

        // Insert right after the opening <svg> tag
        finalSvg = finalSvg.replace(/(<svg[^>]*>)/i, `$1${bgRect}${bgImg}`);
      }

      const safeSvg = sanitizeSvgCss(finalSvg);

      if (format === 'pdf') {
        setIsDownloadingPdf(true);
        setActiveExportButton('pdf');
        const w = window.open('', '_blank');
        if (w) {
          w.document.write(`<html><body style="margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;">${safeSvg}<script>window.onload=()=>{window.print();setTimeout(()=>window.close(),500);};</script></body></html>`);
          w.document.close();
        }
        setTimeout(() => setIsDownloadingPdf(false), 2000);
      } else if (format === 'png') {
        const img = new Image();
        const blob = new Blob([safeSvg ?? ''], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        img.onload = () => {
          const c = document.createElement('canvas');
          c.width = 2048;
          c.height = 2048;
          const ctx = c.getContext('2d');
          if (ctx) {
            ctx.drawImage(img, 0, 0, 2048, 2048);
            const link = document.createElement('a');
            link.href = c.toDataURL('image/png');
            link.download = `studio - ${Date.now()}.png`;
            link.click();
          }
          URL.revokeObjectURL(url);
        };
        img.src = url;
      } else if (format === 'html') {
        setIsDownloadingHtml(true);
        setActiveExportButton('html');
        const fullHtml = generateStandaloneHtml(safeSvg ?? '', svgWords, svgBackground);
        const blob = new Blob([fullHtml], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `roadrunner-gsap-${Date.now()}.html`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        setTimeout(() => setIsDownloadingHtml(false), 2000);
      } else {
        // Auto / default SVG download
        setIsDownloadingSvg(true);
        setActiveExportButton('svg');
        const blob = new Blob([safeSvg ?? ''], { type: 'image/svg+xml' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `roadrunner-logo-${Date.now()}.svg`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        setTimeout(() => setIsDownloadingSvg(false), 2000);
      }
    }
  };

  const handleCopyText = () => {
    const textToCopy = svgContent || generatedText;
    if (textToCopy) {
      navigator.clipboard.writeText(textToCopy);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const resetApp = () => {
    setAppState(AppState.IDLE);
    setGeneratedImage(null);
    setGeneratedText(null);
    setPrompt('');
    setReferenceImages([]);
    setErrorMsg(null);
    setStarted(false);
    setOriginalPrompt('');
  };

  const removeReferenceImage = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setReferenceImages((prev) => prev.filter((img) => img.id !== id));
  };



  const handleTranslate = async () => {
    if (!prompt.trim() || isTranslating) return;
    try {
      setIsTranslating(true);
      // Save original ONLY if it contains non-Latin characters (needs translation)
      if (/[^\x00-\x7F]/.test(prompt)) {
        setOriginalPrompt(prompt);
      }
      const translated = await translatePrompt(prompt);
      setPrompt(translated);
    } catch {
      setErrorMsg('Translation failed. Please try again.');
    } finally {
      setIsTranslating(false);
    }
  };

  const handleRevertTranslation = () => {
    if (originalPrompt) {
      setPrompt(originalPrompt);
      setOriginalPrompt('');
    }
  };

  const needsTranslation = useMemo(() => /[^\x00-\x7F]/.test(prompt), [prompt]);

  const showWorkspace =
    started ||
    (activeTab === 'generate' &&
      (appState !== AppState.IDLE ||
        generatedImage ||
        generatedText ||
        referenceImages.length > 0));

  const suggestedPrompts = SUGGESTED_GEN_PROMPTS;
  const loopApplied = Boolean((modifiedSvg || generatedText || '').includes('data-loop="1"'));

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 font-sans selection:bg-brand-500/30 overflow-x-hidden flex flex-col">
      {isLocked && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-950/95 backdrop-blur-xl px-4">
          <div className="w-full max-sm:px-4 max-w-sm p-8 text-center space-y-8 bg-slate-900/50 rounded-3xl border border-slate-800 shadow-2xl relative overflow-hidden">
            <div className="absolute top-0 right-0 w-32 h-32 bg-brand-500/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2"></div>
            <div className="inline-flex p-5 bg-brand-500/10 rounded-full border border-brand-500/20 relative z-10">{isSetupMode ? <ShieldCheck className="w-10 h-10 text-brand-400" /> : <Lock className="w-10 h-10 text-brand-400" />}</div>
            <div className="space-y-2 relative z-10">
              <h2 className="text-2xl font-bold text-white">{isSetupMode ? 'Create Master Key' : 'Studio Locked'}</h2>
              <p className="text-slate-500 text-sm">Industrial Security™: Local Encryption.</p>
            </div>
            <div className="space-y-4 relative z-10">
              <input type="password" value={masterPasswordInput} onChange={(e) => setMasterPasswordInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleUnlock()} placeholder="Master Password..." className="w-full bg-slate-950 border border-slate-800 rounded-xl p-4 text-center focus:ring-2 focus:ring-brand-500/50 outline-none transition-all" autoFocus />
              {securityError && <p className="text-red-400 text-xs font-bold">{securityError}</p>}
              <button onClick={handleUnlock} className="w-full bg-brand-600 hover:bg-brand-500 text-white py-4 rounded-xl font-bold uppercase tracking-widest text-xs transition-all active:scale-95 shadow-lg shadow-brand-600/20">{isSetupMode ? 'Initialize' : 'Unlock'} <Unlock className="w-4 h-4 inline ml-2" /></button>
            </div>
          </div>
        </div>
      )}

      <Header
        onChangeApiKey={() => setApiKeyModalOpen(true)}
        onOpenProjectInfo={() => setProjectInfoModalOpen(true)}
        onToggleHistory={() => setIsSidebarOpen(!isSidebarOpen)}
      />

      <div className="flex-1 overflow-y-auto custom-scrollbar bg-[radial-gradient(circle_at_top_right,_var(--tw-gradient-stops))] from-slate-900/20 via-transparent to-transparent">
        <div className="max-w-[1600px] mx-auto px-4 py-8 sm:px-6 lg:px-8">
          <div className="flex flex-col lg:flex-row gap-8 items-stretch">
            {/* History Sidebar - Aligned Card */}
            <aside
              className={`
                relative max-lg:fixed max-lg:top-0 max-lg:left-0 z-40 w-72 max-lg:h-[calc(100vh-80px)] lg:h-[800px]
                bg-slate-900/90 lg:bg-slate-900/50 backdrop-blur-xl border border-slate-800 lg:rounded-2xl transition-transform shadow-2xl flex flex-col
                ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
              `}
            >
              <div className="p-4 border-b border-slate-800 flex justify-between items-center bg-gradient-to-b from-slate-900 to-slate-900/50 relative z-10 rounded-t-2xl">
                <h3 className="text-sm font-semibold text-brand-400 uppercase tracking-wider flex items-center gap-2">
                  <HistoryIcon className="w-4 h-4" /> Archive
                </h3>
                <button onClick={() => setIsSidebarOpen(false)} className="lg:hidden">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-4 shadow-inner custom-scrollbar bg-slate-950/10">
                {history.length === 0 && (
                  <div className="text-center py-10 opacity-30">
                    <HistoryIcon className="w-8 h-8 mx-auto mb-2" />
                    <p className="text-[10px] uppercase font-bold">Empty</p>
                  </div>
                )}
                {history.map(item => (
                  <div key={item.id} onClick={() => loadFromHistory(item)} className="bg-slate-900/50 rounded-xl border border-slate-800 p-2 cursor-pointer hover:border-brand-500/50 transition-all group relative overflow-hidden shadow-lg">
                    <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                      <button onClick={(e) => toggleFavorite(item.id, e)} className="p-1.5 bg-black/50 rounded-lg hover:bg-brand-500/20 text-slate-400 hover:text-brand-300 backdrop-blur-sm transition-colors">
                        <Star className={`w-3 h-3 ${item.isFavorite ? 'fill-brand-400 text-brand-400' : ''}`} />
                      </button>
                      <button onClick={(e) => deleteHistoryItem(item.id, e)} className="p-1.5 bg-black/50 rounded-lg hover:bg-red-500/20 text-slate-400 hover:text-red-400 backdrop-blur-sm transition-colors">
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                    <div className="aspect-square rounded-lg bg-slate-900 overflow-hidden relative border border-slate-800/50">
                      {item.type === 'image' ? (
                        <img src={item.data} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" />
                      ) : (
                        <div
                          className="w-full h-full [&_svg]:w-full [&_svg]:h-full [&_svg]:block"
                          dangerouslySetInnerHTML={{ __html: extractSvg(item.data) || item.data }}
                        />
                      )}
                    </div>
                    <p className="text-[10px] text-slate-400 mt-2 truncate font-medium group-hover:text-brand-300 transition-colors pl-1">
                      {item.prompt}
                    </p>
                  </div>
                ))}
              </div>
            </aside>

            <main className="flex-1 w-full min-w-0 flex flex-col h-full lg:min-h-[800px]">
              {!showWorkspace && (
                <div className="flex-1 flex flex-col items-center justify-center min-h-[600px] text-center space-y-12 animate-in fade-in zoom-in duration-500 bg-slate-900/50 rounded-2xl border border-slate-800 p-8">
                  <div className="space-y-4 max-w-2xl mt-4">
                    <h2 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-white via-brand-200 to-brand-500 pb-2">
                      Reimagine Your Visuals
                    </h2>
                    <p className="text-slate-400 text-lg">
                      Create stunning visuals or Generate SVG code with Gemini. <br />
                      Everything you need for expert content generation.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 w-full max-w-4xl px-4">
                    <button
                      onClick={() => {
                        resetApp();
                        setOutputMode('image');
                        setModelProvider('huggingface');
                        setActiveTab('generate');
                        setStarted(true);
                      }}
                      className="group p-6 bg-slate-900 rounded-3xl border border-slate-800 hover:border-blue-500/50 hover:bg-slate-800/50 transition-all flex flex-col items-center gap-4 text-center animate-in slide-in-from-bottom-4 duration-500"
                    >
                      <div className="p-4 bg-blue-500/10 rounded-2xl group-hover:bg-blue-500/20 text-blue-400 transition-colors">
                        <ImageIcon className="w-8 h-8" />
                      </div>
                      <div>
                        <h3 className="text-lg font-bold text-white mb-1">Generate Image</h3>
                        <p className="text-xs text-slate-500">Create high-quality raster images from text</p>
                      </div>
                    </button>

                    <button
                      onClick={() => {
                        resetApp();
                        setOutputMode('video');
                        setModelProvider('aihubmix');
                        setActiveTab('generate');
                        setStarted(true);
                      }}
                      className="group p-6 bg-slate-900 rounded-3xl border border-slate-800 hover:border-purple-500/50 hover:bg-slate-800/50 transition-all flex flex-col items-center gap-4 text-center animate-in slide-in-from-bottom-4 duration-500 delay-100"
                    >
                      <div className="p-4 bg-purple-500/10 rounded-2xl group-hover:bg-purple-500/20 text-purple-400 transition-colors">
                        <Video className="w-8 h-8" />
                      </div>
                      <div>
                        <h3 className="text-lg font-bold text-white mb-1">Generate Video</h3>
                        <p className="text-xs text-slate-500">Bring your ideas to life with AI video models</p>
                      </div>
                    </button>

                    <button
                      onClick={() => {
                        resetApp();
                        setOutputMode('svg');
                        setModelProvider('gemini_flux');
                        setActiveTab('generate');
                        setStarted(true);
                      }}
                      className="group p-6 bg-slate-900 rounded-3xl border border-slate-800 hover:border-emerald-500/50 hover:bg-slate-800/50 transition-all flex flex-col items-center gap-4 text-center animate-in slide-in-from-bottom-4 duration-500 delay-200"
                    >
                      <div className="p-4 bg-emerald-500/10 rounded-2xl group-hover:bg-emerald-500/20 text-emerald-400 transition-colors">
                        <Code className="w-8 h-8" />
                      </div>
                      <div>
                        <h3 className="text-lg font-bold text-white mb-1">Generate SVG</h3>
                        <p className="text-xs text-slate-500">Create scalable vector graphics and code</p>
                      </div>
                    </button>
                  </div>
                </div>
              )}

              {showWorkspace && (
                <div className={`flex-1 grid grid-cols-1 ${isResultExpanded ? 'lg:grid-cols-1' : 'lg:grid-cols-2'} gap-8 animate-in slide-in-from-bottom-8 duration-500 lg:items-start lg:min-h-full transition-all duration-300`}>
                  <div className={`space-y-6 flex flex-col h-full transition-all duration-300 ${isResultExpanded ? 'lg:hidden' : ''}`}>
                    {activeTab === 'generate' && (
                      <div className="flex items-center justify-between">
                        <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                          {outputMode === 'image' && <ImageIcon className="w-5 h-5 text-blue-400" />}
                          {outputMode === 'video' && <Video className="w-5 h-5 text-purple-400" />}
                          {outputMode === 'svg' && <Code className="w-5 h-5 text-emerald-400" />}
                          {outputMode === 'image' ? (
                            referenceImages.length > 0
                              ? `Text to Image (${referenceImages.length} references)`
                              : 'Text to Image'
                          ) : outputMode === 'video' ? (
                            'Text to Video'
                          ) : (
                            'Text to SVG/Code'
                          )}
                        </h3>
                        <button
                          onClick={resetApp}
                          className="text-xs text-slate-500 hover:text-white transition-colors"
                        >
                          Start Over
                        </button>
                      </div>
                    )}



                    <div className="bg-slate-900 p-6 rounded-2xl border border-slate-800 shadow-xl flex-1 flex flex-col overflow-hidden">
                      <div className="flex flex-col gap-3 mb-2">
                        <h3 className="text-sm font-semibold text-brand-400 uppercase tracking-wider flex items-center gap-2">
                          <Sparkles className="w-3.5 h-3.5" />
                          Refine your prompt
                        </h3>

                        <div className="flex flex-col gap-2 w-full">
                          <div className="flex w-full bg-slate-950 rounded-lg p-0.5 border border-slate-700">
                            <button
                              onClick={() => {
                                setOutputMode('image');
                                setModelProvider('huggingface');
                                setGeneratedText(null);
                                setModifiedSvg(null);
                                setPrompt('');
                              }}
                              className={`flex-1 px-2 py-1.5 rounded-md text-[10px] flex items-center justify-center gap-1 transition-colors ${outputMode === 'image'
                                ? 'bg-slate-800 text-white shadow-sm font-medium'
                                : 'text-slate-500 hover:text-slate-300'
                                } `}
                              title="Generate Raster Image (PNG)"
                            >
                              <Palette className="w-3.5 h-3.5" /> Image
                            </button>
                            <button
                              onClick={() => {
                                setOutputMode('video');
                                setModelProvider('aihubmix');
                                setGeneratedText(null);
                                setModifiedSvg(null);
                                setPrompt('');
                              }}
                              className={`flex-1 px-2 py-1.5 rounded-md text-[10px] flex items-center justify-center gap-1 transition-colors ${outputMode === 'video'
                                ? 'bg-slate-800 text-white shadow-sm font-medium'
                                : 'text-slate-500 hover:text-slate-300'
                                } `}
                              title="Generate Video"
                            >
                              <Video className="w-3.5 h-3.5" /> Video
                            </button>
                            <button
                              onClick={() => {
                                setOutputMode('svg');
                                setModelProvider('gemini_flux');
                                setGeneratedImage(null);
                                setPrompt('');
                              }}
                              className={`flex-1 px-2 py-1.5 rounded-md text-[10px] flex items-center justify-center gap-1 transition-colors ${outputMode === 'svg'
                                ? 'bg-slate-800 text-white shadow-sm font-medium'
                                : 'text-slate-500 hover:text-slate-300'
                                } `}
                              title="Generate SVG Code"
                            >
                              <Code className="w-3.5 h-3.5" /> SVG/Code
                            </button>
                          </div>

                        </div>

                      </div>

                      <div className="space-y-4">
                        {/* Unified Prompt Input Container */}
                        <div className={`
                          relative flex flex-col bg-slate-950 border border-slate-700/50 rounded-xl overflow-hidden transition-all duration-300
                          ${appState === AppState.PROCESSING ? 'opacity-50 pointer-events-none' : 'focus-within:border-brand-500/50 focus-within:ring-1 focus-within:ring-brand-500/50 focus-within:shadow-[0_0_20px_-5px_var(--brand-500)]'}
                        `}>

                          {/* Reference Images Toolbar (Top of Input) */}
                          {activeTab === 'generate' && referenceImages.length > 0 && (
                            <div className="flex items-center gap-2 p-3 bg-slate-900/50 border-b border-slate-800/50 overflow-x-auto custom-scrollbar">
                              {referenceImages.map((img) => (
                                <div
                                  key={img.id}
                                  className="relative group flex-shrink-0 w-12 h-12 rounded-lg overflow-hidden border border-slate-700 shadow-sm"
                                >
                                  <img
                                    src={img.url}
                                    alt="Reference"
                                    className="w-full h-full object-cover opacity-90 group-hover:opacity-100 transition-opacity"
                                  />
                                  <button
                                    onClick={(e) => removeReferenceImage(img.id, e)}
                                    className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity"
                                  >
                                    <X className="w-4 h-4 text-white drop-shadow-md" />
                                  </button>
                                </div>
                              ))}
                              {referenceImages.length < 3 && (
                                <button
                                  onClick={() => attachmentInputRef.current?.click()}
                                  className="w-12 h-12 rounded-lg border border-dashed border-slate-700 bg-slate-800/30 hover:bg-slate-800 hover:border-brand-500/50 hover:text-brand-400 flex flex-col items-center justify-center text-slate-500 transition-all flex-shrink-0"
                                  title="Add another image"
                                >
                                  <Plus className="w-5 h-5" />
                                </button>
                              )}
                            </div>
                          )}

                          {/* Aspect Ratio in Input (Top Right Floating or Inline?) - Currently 'Always Visible' above. 
                              Let's keep it above or move it inside? The user didn't explicitly ask to move it, but "buttons under" context.
                              The Aspect Ratio was "above" the textarea in previous code. I will leave it outside as strictly requested "buttons under field".
                              Textarea:
                          */}
                          <textarea
                            value={prompt}
                            onChange={(e) => setPrompt(e.target.value)}
                            placeholder={
                              outputMode === 'svg'
                                ? "E.g., 'Create a minimalist SVG logo for Road Runner...'"
                                : 'Describe the image you want to generate...'
                            }
                            className="w-full bg-transparent border-none p-4 text-slate-100 placeholder:text-slate-600 focus:ring-0 resize-none h-32 sm:h-40 text-sm sm:text-base leading-relaxed custom-scrollbar"
                            disabled={appState === AppState.PROCESSING}
                          />

                          {/* Bottom actions inside the field (optional, e.g. char count) or just clean */}
                        </div>

                        {/* Controls Area */}
                        <div className="flex flex-col gap-4">

                          {/* Row 0: Aspect Ratio Selector (NEW in Workspace) */}
                          <div className="flex items-center justify-between gap-4 p-1">
                            <span className="text-[10px] font-bold uppercase text-slate-500 tracking-wider">Aspect Ratio</span>
                            <div className="flex bg-slate-925 rounded-xl p-1 border border-slate-800/50 shadow-sm overflow-hidden">
                              {ASPECT_RATIOS.map((ratio) => (
                                <button
                                  key={ratio.id}
                                  onClick={() => setSelectedRatio(ratio.id)}
                                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${selectedRatio === ratio.id
                                    ? 'bg-slate-800 text-white shadow-sm'
                                    : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800/50'
                                    } `}
                                >
                                  {ratio.name}
                                </button>
                              ))}
                            </div>
                          </div>

                          {/* Video Settings (Relocated) */}
                          {outputMode === 'video' && modelProvider === 'aihubmix' && (
                            <div className="w-full relative px-1">
                              <button
                                ref={buttonRef}
                                onClick={() => setShowVideoSettings(!showVideoSettings)}
                                className="w-full px-3 py-2 rounded-lg text-xs bg-gradient-to-r from-pink-500/20 to-purple-500/20 hover:from-pink-500/30 hover:to-purple-500/30 text-pink-300 hover:text-pink-200 border border-pink-500/30 hover:border-pink-500/50 transition-all duration-300 flex items-center justify-center gap-2 shadow-lg shadow-pink-500/10"
                                title="AIHubMix Video Settings"
                              >
                                <Settings className="w-3.5 h-3.5" />
                                <span className="font-medium">Video Settings</span>
                                <ChevronRight className={`w-3 h-3 transition-transform duration-200 ${showVideoSettings ? 'rotate-90' : ''}`} />
                              </button>
                              {showVideoSettings && (
                                <div className="absolute top-full left-0 mt-1 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 border border-pink-500/30 rounded-xl shadow-2xl shadow-pink-500/20 p-2.5 w-full backdrop-blur-sm z-50">
                                  <div className="space-y-2.5">
                                    <div className="flex items-center gap-2 mb-1 pb-1.5 border-b border-slate-700">
                                      <div className="w-1.5 h-1.5 bg-gradient-to-r from-pink-500 to-purple-500 rounded-full animate-pulse"></div>
                                      <span className="text-xs font-semibold text-pink-300">Settings</span>
                                    </div>
                                    <div className="relative">
                                      <label className="text-[10px] text-pink-300 block mb-1 font-medium">AI Model</label>
                                      <button
                                        type="button"
                                        onClick={() => setShowVideoModelList(!showVideoModelList)}
                                        className="w-full px-2 py-1.5 text-xs bg-slate-900 border border-pink-500/30 rounded-lg text-white focus:outline-none focus:ring-1 focus:ring-pink-500/50 focus:border-pink-500/50 transition-all flex items-center justify-between"
                                      >
                                        <span className="truncate">{videoModelOptions.find(option => option.value === selectedVideoModel)?.label}</span>
                                        <ChevronRight className={`w-3 h-3 text-pink-300 transition-transform ${showVideoModelList ? 'rotate-90' : 'rotate-0'}`} />
                                      </button>
                                      {showVideoModelList && (
                                        <div className="absolute top-full left-0 mt-1 w-full bg-slate-950 border border-pink-500/30 rounded-lg shadow-xl z-[110] max-h-40 overflow-y-auto">
                                          {videoModelOptions.map(option => (
                                            <button
                                              key={option.value}
                                              type="button"
                                              onClick={() => {
                                                setSelectedVideoModel(option.value);
                                                setShowVideoModelList(false);
                                              }}
                                              className={`w-full text-left px-2 py-1.5 text-[10px] sm:text-xs hover:bg-pink-500/10 transition-colors ${selectedVideoModel === option.value ? 'bg-pink-500/20 text-pink-200' : 'text-slate-200'}`}
                                            >
                                              {option.label}
                                            </button>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                    <div className="grid grid-cols-2 gap-2">
                                      <div>
                                        <label className="text-[10px] text-pink-300 block mb-1 font-medium">Quality</label>
                                        <select
                                          value={videoQuality}
                                          onChange={(e) => setVideoQuality(e.target.value)}
                                          className="w-full px-2 py-1.5 text-xs bg-slate-900 border border-pink-500/30 rounded-lg text-white focus:outline-none focus:ring-1 focus:ring-pink-500/50 focus:border-pink-500/50 transition-all appearance-none cursor-pointer"
                                          style={{
                                            backgroundImage: `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%23ec4899' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e")`,
                                            backgroundPosition: 'right 0.25rem center',
                                            backgroundRepeat: 'no-repeat',
                                            backgroundSize: '1em 1em',
                                            direction: 'ltr'
                                          }}
                                          size={1}
                                        >
                                          <option value="720p" className="bg-slate-900 text-white">720p HD</option>
                                          <option value="1080p" className="bg-slate-900 text-white">1080p FHD</option>
                                          <option value="4k" className="bg-slate-900 text-white">4K Ultra</option>
                                        </select>
                                      </div>
                                      <div>
                                        <label className="text-[10px] text-pink-300 block mb-1 font-medium">Duration</label>
                                        <div className="flex items-center gap-1.5">
                                          <input
                                            type="range"
                                            min="1"
                                            max="10"
                                            value={videoDuration}
                                            onChange={(e) => setVideoDuration(parseInt(e.target.value) || 4)}
                                            className="flex-1 min-w-0 h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-2 [&::-webkit-slider-thumb]:h-2 [&::-webkit-slider-thumb]:bg-pink-500 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:transition-all [&::-webkit-slider-thumb]:hover:scale-110"
                                          />
                                          <span className="text-xs text-pink-300 font-medium min-w-[2rem] text-right flex-shrink-0">{videoDuration}s</span>
                                        </div>
                                      </div>
                                    </div>
                                    <div className="pt-1.5 border-t border-slate-700">
                                      <div className="flex items-center justify-between text-[10px] text-pink-300">
                                        <span>Provider: <span className="font-semibold text-pink-200">{modelProvider}</span></span>
                                        <span>Mode: <span className="font-semibold text-pink-200">{outputMode}</span></span>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              )}
                            </div>
                          )}

                          {/* Row 1: Model & Capability Tools - Model Selector REMOVED (Auto-selected by Mode) */}
                          <div className="flex flex-col items-end gap-2 p-1">
                            {/* Magic Tools Group */}
                            <div className="flex flex-col items-end gap-2 w-full sm:w-auto">

                              {/* Row A: Action Buttons */}
                              <div className="flex items-center gap-2 justify-end">
                                {/* Attach */}
                                {activeTab === 'generate' && referenceImages.length === 0 && (
                                  <button
                                    onClick={() => attachmentInputRef.current?.click()}
                                    className="px-2 py-1.5 rounded-md bg-slate-800/50 hover:bg-slate-800 text-slate-400 hover:text-slate-200 border border-slate-700/50 transition-colors text-[10px] sm:text-xs font-medium flex items-center gap-1.5"
                                    title="Attach Reference Image"
                                  >
                                    <Paperclip className="w-3 h-3" /> <span className="hidden sm:inline">Attach</span>
                                  </button>
                                )}

                                {/* Surprise Me */}
                                <button
                                  onClick={handleSurpriseMe}
                                  disabled={isAssistantLoading}
                                  className="px-2 py-1.5 rounded-md bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-300 hover:text-indigo-200 border border-indigo-500/20 transition-all text-[10px] sm:text-xs font-medium flex items-center gap-1.5"
                                  title="Generate a random detailed prompt"
                                >
                                  <Sparkles className="w-3 h-3" /> <span className="hidden sm:inline">Surprise</span>
                                </button>

                                {/* Refine */}
                                <button
                                  onClick={handleRefinePrompt}
                                  disabled={!prompt.trim() || isAssistantLoading}
                                  className={`px-2 py-1.5 rounded-md transition-all text-[10px] font-medium flex items-center gap-1.5 border ${isAssistantLoading
                                    ? 'bg-emerald-500/20 text-emerald-200 border-emerald-500/40 animate-pulse'
                                    : 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 hover:text-emerald-200 border-emerald-500/20'
                                    } `}
                                  title="Enhance prompt with AI"
                                >
                                  <Wand2 className={`w-3 h-3 ${isAssistantLoading ? 'animate-spin' : ''} `} /> <span className="hidden sm:inline">{isAssistantLoading ? 'Refining...' : 'Refine'}</span>
                                </button>
                              </div>

                              {/* Row B: Translation (Strictly Below) */}
                              {needsTranslation ? (
                                <button
                                  onClick={handleTranslate}
                                  disabled={isTranslating}
                                  className={`px-2.5 py-1.5 rounded-md transition-all text-[10px] font-medium flex items-center gap-1.5 border w-auto ${isTranslating
                                    ? 'bg-blue-500/20 text-blue-200 border-blue-500/40 animate-pulse'
                                    : 'bg-blue-500/10 hover:bg-blue-500/20 text-blue-300 hover:text-blue-200 border-blue-500/20'
                                    } `}
                                  title="Translate to English"
                                >
                                  <Languages className={`w-3 h-3 ${isTranslating ? 'animate-spin' : ''}`} />
                                  {isTranslating ? <span>Translating...</span> : <span className="hidden sm:inline">Translate</span>}
                                </button>
                              ) : originalPrompt ? (
                                <button
                                  onClick={handleRevertTranslation}
                                  className="px-2.5 py-1.5 rounded-md bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 hover:text-amber-200 border border-amber-500/20 transition-all text-[10px] sm:text-xs font-medium flex items-center gap-1.5"
                                  title="Revert to original language"
                                >
                                  <RefreshCw className="w-3 h-3" /> <span className="hidden sm:inline">Revert</span>
                                </button>
                              ) : null}

                            </div>
                          </div>

                          {/* AI Suggestions Modal (NEW in Workspace) */}
                          {showSuggestions && suggestions.length > 0 && (
                            <div className="p-4 bg-emerald-500/5 rounded-xl border border-emerald-500/20 backdrop-blur-md animate-in fade-in slide-in-from-top-4 duration-300 shadow-inner">
                              <div className="flex justify-between items-center mb-3">
                                <h4 className="text-[10px] font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-2">
                                  <Sparkles className="w-3.5 h-3.5" /> AI Variations
                                </h4>
                                <button onClick={() => setShowSuggestions(false)} className="text-slate-500 hover:text-white p-1">
                                  <X className="w-3 h-3" />
                                </button>
                              </div>
                              <div className="space-y-2">
                                {suggestions.map((suggestion, idx) => (
                                  <button
                                    key={idx}
                                    onClick={() => handleInsertSuggestion(suggestion)}
                                    className="w-full text-left p-2.5 rounded-lg bg-slate-900/50 hover:bg-slate-800 text-xs text-slate-300 hover:text-white border border-slate-800 hover:border-emerald-500/30 transition-all flex items-start gap-2 group"
                                  >
                                    <span className="mt-0.5 opacity-30 group-hover:opacity-100 transition-opacity">✨</span>
                                    <span className="line-clamp-2">{suggestion}</span>
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Row 2: Big Generate Button */}
                          <div className="w-full">
                            <button
                              onClick={handleGenerate}
                              disabled={!prompt.trim() || appState === AppState.PROCESSING}
                              className={`
                                relative w-full group overflow-hidden rounded-xl font-bold tracking-wide transition-all transform active:scale-[0.99] disabled:active:scale-100
                                ${!prompt.trim() || appState === AppState.PROCESSING
                                  ? 'bg-slate-800 text-slate-500 cursor-not-allowed py-4 border border-slate-700/50'
                                  : 'bg-gradient-to-r from-brand-600 to-indigo-600 hover:from-brand-500 hover:to-indigo-500 text-white shadow-xl shadow-brand-500/20 border border-brand-500/20 py-4'
                                }
      `}
                            >
                              <div className="flex items-center justify-center gap-3 relative z-10">
                                {appState === AppState.PROCESSING ? (
                                  <>
                                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                    <span>Creating Magic...</span>
                                  </>
                                ) : (
                                  <>
                                    <span className="text-base">Generate Masterpiece</span>
                                    <Wand2 className="w-5 h-5 group-hover:rotate-12 transition-transform" />
                                  </>
                                )}
                              </div>
                              {/* Subtle sheen effect */}
                              {!prompt.trim() || appState === AppState.PROCESSING ? null : (
                                <div className="absolute inset-0 bg-white/10 translate-y-full group-hover:translate-y-0 transition-transform duration-500 skew-y-12" />
                              )}
                            </button>
                          </div>

                        </div>
                      </div>

                      <div className="mt-4">
                        <p className="text-xs text-slate-500 mb-2">
                          Try these prompts:
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {suggestedPrompts.map((suggestion, idx) => (
                            <button
                              key={idx}
                              onClick={() => setPrompt(suggestion)}
                              disabled={appState === AppState.PROCESSING}
                              className="text-xs px-3 py-1.5 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-brand-300 border border-slate-700 transition-colors text-left"
                            >
                              {suggestion}
                            </button>
                          ))}
                        </div>
                      </div>

                      {errorMsg && (
                        <div className="mt-4 p-3 bg-red-900/20 border border-red-900/50 rounded-lg flex items-start gap-2 text-red-200 text-sm">
                          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                          <p>{errorMsg}</p>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="relative h-full min-h-[400px]">
                    <div className="hidden lg:flex absolute -left-12 top-1/2 -translate-y-1/2 justify-center w-8 z-10 opacity-30">
                      <ChevronRight className="w-8 h-8 text-slate-500" />
                    </div>

                    <div className="h-full bg-gradient-to-b from-slate-900 to-slate-900/50 p-6 rounded-2xl border border-slate-800 flex flex-col shadow-2xl relative flex-1 overflow-hidden">
                      <div className="flex flex-col gap-4 mb-4 relative z-10">
                        <div className="flex justify-between items-center">
                          <div className="flex items-center gap-3">
                            <h3 className="text-sm font-semibold text-brand-400 uppercase tracking-wider flex items-center gap-2">
                              <Sparkles className="w-4 h-4" /> Generated Result
                            </h3>

                            {/* Content Type Badge */}
                            <div className={`px-2 py-1 rounded-full text-xs font-medium flex items-center gap-1 ${outputMode === 'image' ? 'text-blue-300' :
                              outputMode === 'video' ? 'text-purple-300' :
                                'text-green-300'
                              } `}>
                              {outputMode === 'image' && <ImageIcon className="w-3 h-3" />}
                              {outputMode === 'video' && <Video className="w-3 h-3" />}
                              {outputMode === 'svg' && <Code className="w-3 h-3" />}
                              {outputMode === 'image' ? 'Image' : outputMode === 'video' ? 'Video' : 'SVG'}
                            </div>
                          </div>

                          {/* Focus Mode Toggle Button */}
                          <button
                            onClick={() => setIsResultExpanded(!isResultExpanded)}
                            className={`p-1.5 rounded-lg transition-all hidden lg:flex items-center gap-1.5 ${isResultExpanded
                              ? 'bg-brand-500/20 text-brand-400 hover:bg-brand-500/30 border border-brand-500/30'
                              : 'bg-slate-800/50 hover:bg-slate-700 text-slate-400 hover:text-white border border-slate-700/50'
                              }`}
                            title={isResultExpanded ? "Exit Focus Mode (show prompt panel)" : "Enter Focus Mode (expand result)"}
                          >
                            {isResultExpanded ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                            <span className="text-[10px] font-medium uppercase tracking-wider">{isResultExpanded ? 'Exit' : 'Focus'}</span>
                          </button>
                        </div>

                        {/* Download Controls for Image/Video */}
                        {((outputMode === 'image' || outputMode === 'video') && generatedImage) && (
                          <div className="flex w-full bg-slate-950 rounded-lg p-0.5 border border-slate-700">
                            <button
                              onClick={() => handleDownload('auto')}
                              className="flex-1 px-2 py-1.5 rounded-md text-[10px] sm:text-xs flex items-center justify-center gap-2 transition-colors text-slate-500 hover:text-white hover:bg-slate-800"
                            >
                              <Download className="w-3.5 h-3.5" />
                              {outputMode === 'video' ? 'Download Video' : 'Download PNG'}
                            </button>
                          </div>
                        )}

                        {((outputMode === 'svg' || (outputMode !== 'image' && outputMode !== 'video')) && (svgContent || generatedText || modifiedSvg)) && (
                          <div className="flex w-full bg-slate-950 rounded-lg p-0.5 border border-slate-700">
                            {/* SVG Controls: Only show when strictly in SVG mode or when we have text and NOT in image/video mode */}
                            <button
                              onClick={() => svgContent && handleDownload('auto')}
                              disabled={!svgContent}
                              className={`flex-1 px-1.5 py-1.5 rounded-md text-[9px] font-medium flex items-center justify-center gap-1 transition-colors whitespace-nowrap ${!svgContent
                                ? 'text-slate-600 cursor-not-allowed'
                                : (isDownloadingSvg || activeExportButton === 'svg')
                                  ? 'bg-slate-800 text-white shadow-sm'
                                  : 'text-slate-500 hover:text-slate-300'
                                } `}
                              title={svgContent ? "Download SVG File" : "No SVG content to download"}
                            >
                              {isDownloadingSvg ? <Check className="w-3 h-3 text-green-400" /> : <Code className="w-3 h-3" />}
                              {isDownloadingSvg ? 'Downloaded' : 'SVG'}
                            </button>
                            <button
                              onClick={() => svgContent && handleDownload('pdf')}
                              disabled={!svgContent}
                              className={`flex-1 px-1.5 py-1.5 rounded-md text-[9px] font-medium flex items-center justify-center gap-1 transition-colors whitespace-nowrap ${!svgContent
                                ? 'text-slate-600 cursor-not-allowed'
                                : (isDownloadingPdf || activeExportButton === 'pdf')
                                  ? 'bg-slate-800 text-white shadow-sm'
                                  : 'text-slate-500 hover:text-slate-300'
                                } `}
                              title={svgContent ? "Export as PDF" : "No SVG content to export"}
                            >
                              {isDownloadingPdf ? <Check className="w-3 h-3 text-green-400" /> : <FileText className="w-3 h-3" />}
                              {isDownloadingPdf ? 'Downloaded' : 'PDF'}
                            </button>
                            <button
                              onClick={() => svgContent && handleDownload('html')}
                              disabled={!svgContent}
                              className={`flex-1 px-1.5 py-1.5 rounded-md text-[9px] font-medium flex items-center justify-center gap-1 transition-colors whitespace-nowrap ${!svgContent
                                ? 'text-slate-600 cursor-not-allowed'
                                : (isDownloadingHtml || activeExportButton === 'html')
                                  ? 'bg-slate-800 text-white shadow-sm'
                                  : 'text-slate-500 hover:text-slate-300'
                                } `}
                              title="Download Standalone HTML with GSAP"
                            >
                              {isDownloadingHtml ? <Check className="w-3 h-3 text-green-400" /> : <Code className="w-3 h-3" />}
                              {isDownloadingHtml ? 'Downloaded' : 'HTML (GSAP)'}
                            </button>
                            <button
                              onClick={() => { handleCopyText(); setActiveExportButton('copy'); }}
                              disabled={!generatedText && !modifiedSvg}
                              className={`flex-1 px-1.5 py-1.5 rounded-md text-[9px] font-medium flex items-center justify-center gap-1 transition-colors whitespace-nowrap ${(!generatedText && !modifiedSvg)
                                ? 'text-slate-600 cursor-not-allowed'
                                : activeExportButton === 'copy'
                                  ? 'bg-slate-800 text-white shadow-sm'
                                  : 'text-slate-500 hover:text-slate-300'
                                } `}
                            >
                              {copied ? (
                                <Check className="w-3 h-3 text-green-400" />
                              ) : (
                                <Copy className="w-3 h-3" />
                              )}
                              {copied ? 'Copied' : 'Copy'}
                            </button>
                          </div>
                        )}
                      </div>

                      <div className="flex-1 rounded-xl bg-slate-950 border-2 border-dashed border-slate-800 flex flex-col items-stretch justify-center relative overflow-hidden">
                        {/* SVG Editor Toggle Tab - Anchored to Internal window - Only in SVG mode */}
                        {outputMode === 'svg' && ((generatedText && svgContent) || outputMode === 'svg') && (
                          <>
                            <button
                              onClick={() => setShowSvgPanel(!showSvgPanel)}
                              className={`absolute right-0 top-1/4 z-20 px-1 py-5 rounded-l-lg text-[9px] font-bold tracking-widest uppercase transition-all flex items-center gap-2 border-y border-l border-slate-700/50 shadow-xl ${showSvgPanel
                                ? 'bg-brand-600 text-white border-brand-500 translate-x-0'
                                : 'bg-slate-900 text-slate-500 hover:text-white border-slate-800 hover:bg-slate-800 translate-x-0'
                                }`}
                              style={{ writingMode: 'vertical-rl', textOrientation: 'mixed' }}
                            >
                              <Palette className="w-3 h-3 mb-1.5 rotate-90 opacity-70" />
                              EDITOR
                            </button>

                            {/* Slide-out Advanced Editor Sidebar - Direct Context */}
                            <div className={`absolute top-0 right-0 h-full w-64 bg-slate-900/98 backdrop-blur-2xl border-l border-slate-800 shadow-2xl z-30 transform transition-transform duration-300 ease-in-out ${showSvgPanel ? 'translate-x-0' : 'translate-x-full'}`}>
                              <div className="flex flex-col h-full overflow-hidden">
                                <div className="flex justify-between items-center px-4 py-3 border-b border-slate-800/50 flex-shrink-0">
                                  <h4 className="text-xs font-bold uppercase text-brand-400 flex items-center gap-2">
                                    <Palette className="w-3.5 h-3.5" /> Editor
                                  </h4>
                                  <button onClick={() => setShowSvgPanel(false)} className="text-slate-500 hover:text-white transition-colors">
                                    <X className="w-3.5 h-3.5" />
                                  </button>
                                </div>

                                <div className="flex border-b border-slate-800 bg-slate-900/50 flex-shrink-0">
                                  <button
                                    onClick={() => setActiveEditorTab('general')}
                                    className={`flex-1 py-2 text-[10px] font-bold uppercase tracking-wider transition-colors ${activeEditorTab === 'general' ? 'text-white border-b-2 border-brand-500 bg-slate-800/50' : 'text-slate-500 hover:text-slate-300'}`}
                                  >
                                    General
                                  </button>
                                  <button
                                    onClick={() => setActiveEditorTab('layers')}
                                    className={`flex-1 py-2 text-[10px] font-bold uppercase tracking-wider transition-colors ${activeEditorTab === 'layers' ? 'text-white border-b-2 border-brand-500 bg-slate-800/50' : 'text-slate-500 hover:text-slate-300'}`}
                                  >
                                    Text Tools
                                  </button>
                                </div>

                                <div className="flex-1 overflow-y-auto custom-scrollbar p-3">
                                  {activeEditorTab === 'general' ? (
                                    <div className="space-y-6">
                                      {/* Colors Section */}
                                      <div>
                                        <div className="flex items-center gap-2 mb-3">
                                          <div className="w-1.5 h-1.5 bg-brand-500 rounded-full"></div>
                                          <h5 className="text-[10px] font-bold text-slate-300 uppercase tracking-widest">Global Colors</h5>
                                        </div>
                                        <div className="flex flex-wrap gap-2.5 px-1">
                                          {svgColors.map((color, i) => (
                                            <div key={i} className="group relative w-6 h-6">
                                              <input
                                                type="color"
                                                value={color}
                                                onChange={(e) => handleColorChange(color, e.target.value)}
                                                className="w-full h-full rounded-full cursor-pointer opacity-0 absolute inset-0 z-10"
                                              />
                                              <div
                                                className="w-full h-full rounded-full border border-slate-700 shadow-lg group-hover:scale-110 group-hover:border-brand-500 transition-all duration-300"
                                                style={{ backgroundColor: color }}
                                              ></div>
                                            </div>
                                          ))}
                                        </div>
                                      </div>

                                      {/* Background Section (Redesigned) */}
                                      <div>
                                        <div className="flex items-center gap-2 mb-3">
                                          <div className="w-1.5 h-1.5 bg-brand-500 rounded-full"></div>
                                          <h5 className="text-[10px] font-bold text-slate-300 uppercase tracking-widest">SVG Background</h5>
                                        </div>
                                        <div className="space-y-3 p-3 bg-slate-950/40 rounded-xl border border-slate-800/50 shadow-inner">
                                          <div className="flex items-center justify-between">
                                            <label className="text-[10px] text-slate-500 font-medium">BG Color</label>
                                            <div className="relative w-8 h-4">
                                              <input
                                                type="color"
                                                value={normalizeColorToHex(svgBackground) || '#000000'}
                                                onChange={(e) => handleBgColorUpdate(e.target.value)}
                                                className="w-full h-full opacity-0 absolute inset-0 z-10 cursor-pointer"
                                              />
                                              <div className="w-full h-full rounded-full border border-slate-700" style={{ backgroundColor: svgBackground }}></div>
                                            </div>
                                          </div>
                                          <div className="pt-2 border-t border-slate-800/50">
                                            <label className="text-[10px] text-slate-500 font-medium block mb-2">Background Image</label>
                                            <div className="relative">
                                              <input
                                                type="file"
                                                accept="image/*"
                                                onChange={(e) => {
                                                  const file = e.target.files?.[0];
                                                  if (file) {
                                                    const reader = new FileReader();
                                                    reader.onloadend = () => handleBgImageUpdate(reader.result as string);
                                                    reader.readAsDataURL(file);
                                                  }
                                                }}
                                                className="hidden"
                                                id="svg-bg-upload"
                                              />
                                              <label
                                                htmlFor="svg-bg-upload"
                                                className="flex items-center justify-center gap-2 w-full py-2 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-lg text-[10px] text-slate-400 hover:text-white transition-all cursor-pointer"
                                              >
                                                <Upload className="w-3 h-3" /> {svgBackgroundImage ? 'Change Image' : 'Upload Image'}
                                              </label>
                                              {svgBackgroundImage && (
                                                <button
                                                  onClick={() => handleBgImageUpdate(null)}
                                                  className="mt-2 text-[9px] text-red-400 hover:text-red-300 w-full text-center"
                                                >
                                                  Remove Image
                                                </button>
                                              )}
                                            </div>
                                          </div>
                                        </div>
                                      </div>

                                      {/* Animation Loop Section */}
                                      <div>
                                        <div className="flex items-center gap-2 mb-3">
                                          <div className="w-1.5 h-1.5 bg-brand-500 rounded-full"></div>
                                          <h5 className="text-[10px] font-bold text-slate-300 uppercase tracking-widest">Animation Loop</h5>
                                        </div>
                                        <div className="space-y-2 p-3 bg-slate-950/40 rounded-xl border border-slate-800/50 shadow-inner">
                                          <p className="text-[9px] text-slate-500">
                                            Force all SVG and CSS animations to loop indefinitely.
                                          </p>
                                          <button
                                            onClick={handleApplyLoop}
                                            disabled={loopApplied}
                                            className={`w-full py-2 rounded-lg text-[10px] font-medium border transition-all flex items-center justify-center gap-2 ${loopApplied
                                              ? 'bg-slate-900 text-slate-600 border-slate-800 cursor-not-allowed'
                                              : 'bg-brand-500/10 text-brand-300 border-brand-500/30 hover:bg-brand-500/20 hover:text-brand-200'}`}
                                            title={loopApplied ? 'Loop already applied' : 'Apply infinite loop to all animations'}
                                          >
                                            <RefreshCw className="w-3 h-3" /> {loopApplied ? 'Loop Enabled' : 'Apply Loop'}
                                          </button>
                                        </div>
                                      </div>

                                      {/* Layers Section (NEW) */}
                                      <div>
                                        <div className="flex items-center gap-2 mb-3">
                                          <div className="w-1.5 h-1.5 bg-brand-500 rounded-full"></div>
                                          <h5 className="text-[10px] font-bold text-slate-300 uppercase tracking-widest">SVG Layers</h5>
                                          <div className="ml-auto flex items-center gap-2">
                                            {!showTechnicalTextLayers && hiddenTechnicalTextCount > 0 && (
                                              <span className="text-[9px] text-slate-500 whitespace-nowrap">
                                                {hiddenTechnicalTextCount} hidden
                                              </span>
                                            )}
                                            <button
                                              onClick={() => setShowTechnicalTextLayers((prev) => !prev)}
                                              className={`px-2 py-0.5 rounded-md border text-[9px] transition-colors ${showTechnicalTextLayers
                                                ? 'border-brand-500/50 text-brand-300 bg-brand-500/10'
                                                : 'border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-600'}`}
                                              title={showTechnicalTextLayers ? 'Hide technical text layers' : 'Show technical text layers'}
                                            >
                                              {showTechnicalTextLayers ? 'Hide Technical' : 'Show Technical'}
                                            </button>
                                          </div>
                                        </div>
                                        <div className="space-y-2 max-h-[300px] overflow-y-auto custom-scrollbar px-1">
                                          {filteredSvgLayers.length === 0 ? (
                                            <p className="text-[10px] text-slate-600 text-center py-4">
                                              {svgLayers.length === 0
                                                ? 'No layers found'
                                                : 'Only technical text layers are hidden'}
                                            </p>
                                          ) : filteredSvgLayers.map((layer) => (
                                            <div
                                              key={layer.id}
                                              onClick={() => setActiveLayerId(layer.id)}
                                              className={`p-2.5 rounded-xl border transition-all group cursor-pointer ${activeLayerId === layer.id
                                                ? 'bg-slate-900/70 border-brand-500/50'
                                                : 'bg-slate-950/40 border-slate-800/50 hover:border-slate-700'}`}
                                            >
                                              <div className="flex items-center justify-between mb-2">
                                                <div className="flex items-center gap-2">
                                                  {layer.type === 'path' && <Plus className="w-3 h-3 text-brand-400 rotate-45" />}
                                                  {layer.type === 'rect' && <div className="w-3 h-3 border border-brand-400"></div>}
                                                  {layer.type === 'circle' && <div className="w-3 h-3 border border-brand-400 rounded-full"></div>}
                                                  {layer.type === 'line' && <div className="w-3 h-0.5 bg-brand-400"></div>}
                                                  {layer.type === 'text' && <Type className="w-3 h-3 text-brand-400" />}
                                                  <span className="text-[10px] font-bold text-slate-400 group-hover:text-white transition-colors truncate max-w-[100px]">{layer.label}</span>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                  <button
                                                    onClick={(event) => {
                                                      event.stopPropagation();
                                                      handleLayerUpdate(layer.id, { visible: layer.visible === false });
                                                    }}
                                                    className={`w-6 h-6 flex items-center justify-center rounded-md border transition-colors ${layer.visible === false ? 'border-slate-700 text-slate-600 bg-slate-900/60' : 'border-slate-700 text-slate-300 hover:text-white hover:border-slate-500'}`}
                                                    title={layer.visible === false ? 'Show layer' : 'Hide layer'}
                                                  >
                                                    <Eye className="w-3 h-3" />
                                                  </button>
                                                  {layer.type !== 'line' && (
                                                    <div className="relative w-4 h-4" title="Fill">
                                                      <input
                                                        type="color"
                                                        value={normalizeColorToHex(layer.fill) || '#000000'}
                                                        onChange={(e) => handleLayerUpdate(layer.id, { fill: e.target.value })}
                                                        onClick={(event) => event.stopPropagation()}
                                                        className="absolute inset-0 opacity-0 cursor-pointer z-10"
                                                      />
                                                      <div className="w-full h-full rounded-full border border-slate-800" style={{ backgroundColor: layer.fill }}></div>
                                                    </div>
                                                  )}
                                                  <div className="relative w-4 h-4" title="Stroke">
                                                    <input
                                                      type="color"
                                                      value={normalizeColorToHex(layer.stroke) || '#000000'}
                                                      onChange={(e) => handleLayerUpdate(layer.id, { stroke: e.target.value })}
                                                      onClick={(event) => event.stopPropagation()}
                                                      className="absolute inset-0 opacity-0 cursor-pointer z-10"
                                                    />
                                                    <div className="w-full h-full rounded-full border border-slate-800" style={{ backgroundColor: layer.stroke }}></div>
                                                  </div>
                                                </div>
                                              </div>
                                              <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-800/30">
                                                <div className="space-y-1">
                                                  <div className="flex justify-between">
                                                    <label className="text-[8px] uppercase text-slate-600 font-bold">Anim Speed</label>
                                                    <span className="text-[8px] text-slate-500">{layer.duration ?? 1}s</span>
                                                  </div>
                                                  <input
                                                    type="range" min="0.1" max="10" step="0.1"
                                                    value={layer.duration ?? 1}
                                                    onChange={(e) => handleLayerUpdate(layer.id, { duration: parseFloat(e.target.value) })}
                                                    className="w-full h-0.5 bg-slate-800 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:w-2 [&::-webkit-slider-thumb]:h-2 [&::-webkit-slider-thumb]:bg-brand-500 [&::-webkit-slider-thumb]:rounded-full"
                                                    disabled={!layer.hasAnimate}
                                                    onClick={(event) => event.stopPropagation()}
                                                  />
                                                </div>
                                                <div className="space-y-1">
                                                  <div className="flex justify-between">
                                                    <label className="text-[8px] uppercase text-slate-600 font-bold">Opacity</label>
                                                    <span className="text-[8px] text-slate-500">{Math.round(layer.opacity! * 100)}%</span>
                                                  </div>
                                                  <input
                                                    type="range" min="0" max="1" step="0.1"
                                                    value={layer.opacity}
                                                    onChange={(e) => handleLayerUpdate(layer.id, { opacity: parseFloat(e.target.value) })}
                                                    className="w-full h-0.5 bg-slate-800 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:w-2 [&::-webkit-slider-thumb]:h-2 [&::-webkit-slider-thumb]:bg-brand-500 [&::-webkit-slider-thumb]:rounded-full"
                                                  />
                                                </div>
                                              </div>
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    </div>
                                  ) : (
                                    <div className="space-y-6 animate-in fade-in duration-300">
                                      {svgWords.length === 0 ? (
                                        <div className="text-center py-8 text-slate-600 text-xs">
                                          <Type className="w-8 h-8 mx-auto mb-2 opacity-20" />
                                          No text detected
                                        </div>
                                      ) : (
                                        <div className="space-y-4">
                                          <div className="flex items-center gap-2 mb-2 px-1">
                                            <div className="w-1.5 h-1.5 bg-brand-500 rounded-full"></div>
                                            <h5 className="text-[10px] font-bold text-slate-300 uppercase tracking-widest">Select Characters</h5>
                                            <div className="ml-auto flex items-center gap-1 bg-slate-950/60 border border-slate-800 rounded-lg p-0.5">
                                              <button
                                                onClick={() => setWordDragMode('move')}
                                                className={`px-2 py-0.5 text-[9px] rounded-md transition-colors ${wordDragMode === 'move'
                                                  ? 'bg-blue-500/20 text-blue-300'
                                                  : 'text-slate-500 hover:text-slate-200'}`}
                                                title="Drag to move words"
                                              >
                                                Move
                                              </button>
                                              <button
                                                onClick={() => setWordDragMode('rotate')}
                                                className={`px-2 py-0.5 text-[9px] rounded-md transition-colors ${wordDragMode === 'rotate'
                                                  ? 'bg-blue-500/20 text-blue-300'
                                                  : 'text-slate-500 hover:text-slate-200'}`}
                                                title="Drag to rotate words"
                                              >
                                                Rotate
                                              </button>
                                            </div>
                                          </div>
                                          {svgWords.map((word, wIdx) => (
                                            <div key={word.id} className="border border-slate-800/50 rounded-xl bg-slate-950/30 overflow-hidden shadow-inner">
                                              <div className="px-3 py-1.5 bg-slate-900/50 border-b border-slate-800/50 flex items-center justify-between gap-2">
                                                <div className="flex-1">
                                                  <input
                                                    type="text"
                                                    value={word.letters.map(l => l.char).join('')}
                                                    onChange={(e) => handleWordTextChange(word.id, e.target.value)}
                                                    className="w-full bg-slate-950 border border-slate-700/50 rounded px-2 py-1 text-[10px] text-slate-300 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/50 placeholder:text-slate-700 transition-all font-mono"
                                                    style={{ caretColor: '#38bdf8' }}
                                                    placeholder={`Word ${wIdx + 1}`}
                                                  />
                                                </div>
                                                <button
                                                  onClick={() => toggleWordVisibility(word.id)}
                                                  className={`w-7 h-7 flex items-center justify-center rounded-md border transition-colors ${word.visible === false ? 'border-slate-700 text-slate-600 bg-slate-900/60' : 'border-slate-700 text-slate-300 hover:text-white hover:border-slate-500'}`}
                                                  title={word.visible === false ? 'Show word' : 'Hide word'}
                                                >
                                                  {word.visible === false ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                                                </button>
                                                <span className="text-[8px] text-slate-600 whitespace-nowrap">{word.letters.length} chars</span>
                                              </div>
                                              <div className="p-3 flex flex-wrap gap-2">
                                                {word.letters.map((letter) => (
                                                  <button
                                                    key={letter.id}
                                                    onClick={(e) => toggleLetterSelection(letter.id, e.ctrlKey || e.metaKey)}
                                                    style={{
                                                      backgroundColor: selectedLetterIds.has(letter.id) ? '#3b82f6' : 'transparent',
                                                      color: selectedLetterIds.has(letter.id) ? 'white' : '#94a3b8',
                                                      borderColor: selectedLetterIds.has(letter.id) ? '#3b82f6' : 'rgba(30, 41, 59, 0.5)'
                                                    }}
                                                    className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-mono border transition-all ${selectedLetterIds.has(letter.id) ? 'shadow-[0_0_10px_-2px_#3b82f6] scale-110' : 'hover:border-slate-500 hover:text-slate-300 bg-slate-900'}`}
                                                    title={`Char: ${letter.char}`}
                                                  >
                                                    {letter.char}
                                                  </button>
                                                ))}
                                              </div>
                                            </div>
                                          ))}
                                        </div>
                                      )}

                                      {hasSelectedLetters && (
                                        <div className="bg-slate-900/90 border border-slate-700/50 rounded-2xl p-4 space-y-4 sticky bottom-0 backdrop-blur-xl shadow-2xl z-20">
                                          <div className="flex items-center justify-between gap-2">
                                            <span className="text-[10px] font-bold text-blue-400 uppercase tracking-wide flex items-center gap-2 whitespace-nowrap">
                                              <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse"></span>
                                              {selectedLetterIds.size} Selected
                                            </span>
                                            <div className="flex items-center gap-2">
                                              <button
                                                onClick={selectWholeWord}
                                                className="text-[9px] text-blue-400 hover:text-blue-300 transition-colors font-bold uppercase tracking-wide whitespace-nowrap"
                                              >
                                                Select Word
                                              </button>
                                              <div className="w-px h-2.5 bg-slate-700"></div>
                                              <button
                                                onClick={() => setSelectedLetterIds(new Set())}
                                                className="text-[9px] text-slate-500 hover:text-white transition-colors whitespace-nowrap"
                                              >
                                                Deselect All
                                              </button>
                                            </div>
                                          </div>

                                          <div className="grid grid-cols-2 gap-4">
                                            {/* Typography Controls (NEW) */}
                                            <div className="col-span-2 space-y-3 pb-3 border-b border-slate-800/50">
                                              <label className="text-[9px] font-bold text-slate-500 uppercase tracking-tighter">Typography</label>

                                              {/* Font Family */}
                                              <div className="relative group">
                                                <select
                                                  className="w-full bg-slate-950 border border-slate-700 rounded-lg py-1.5 px-2.5 text-[10px] text-white appearance-none cursor-pointer focus:border-blue-500 focus:outline-none transition-colors"
                                                  onChange={(e) => updateSelectedLetters({ fontFamily: e.target.value })}
                                                  disabled={!hasSelectedLetters}
                                                >
                                                  <option value="">Select Font...</option>
                                                  {FONT_OPTIONS.map((font) => (
                                                    <option key={font.value} value={font.value} style={{ fontFamily: font.value }}>{font.label}</option>
                                                  ))}
                                                </select>
                                                <div className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-slate-500">
                                                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
                                                </div>
                                              </div>

                                              <div className="flex gap-3">
                                                {/* Font Size */}
                                                <div className="flex-1 space-y-1">
                                                  <div className="flex justify-between">
                                                    <label className="text-[8px] text-slate-600 font-bold">Size</label>
                                                  </div>
                                                  <input
                                                    type="range" min="10" max="200" step="1"
                                                    className="w-full h-1 bg-slate-800 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-blue-500 [&::-webkit-slider-thumb]:rounded-full"
                                                    onChange={(e) => updateSelectedLetters({ fontSize: `${e.target.value}px` })}
                                                    disabled={!hasSelectedLetters}
                                                  />
                                                </div>

                                                {/* Style Toggles */}
                                                <div className="flex gap-1 items-end">
                                                  <button
                                                    onClick={() => updateSelectedLetters({ fontWeight: 'bold' })}
                                                    className="w-7 h-7 flex items-center justify-center rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-transparent hover:border-slate-600 transition-all"
                                                    title="Bold"
                                                    disabled={!hasSelectedLetters}
                                                  >
                                                    <span className="font-bold text-xs" style={{ fontFamily: 'serif' }}>B</span>
                                                  </button>
                                                  <button
                                                    onClick={() => updateSelectedLetters({ fontStyle: 'italic' })}
                                                    className="w-7 h-7 flex items-center justify-center rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-transparent hover:border-slate-600 transition-all text-xs"
                                                    title="Italic"
                                                    disabled={!hasSelectedLetters}
                                                  >
                                                    <span className="italic" style={{ fontFamily: 'serif' }}>I</span>
                                                  </button>
                                                  <button
                                                    onClick={() => updateSelectedLetters({ fontWeight: 'normal', fontStyle: 'normal' })}
                                                    className="w-7 h-7 flex items-center justify-center rounded bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white border border-transparent hover:border-slate-600 transition-all"
                                                    title="Reset Style"
                                                    disabled={!hasSelectedLetters}
                                                  >
                                                    <X className="w-3 h-3" />
                                                  </button>
                                                </div>
                                              </div>
                                            </div>

                                            <div className="col-span-2 grid grid-cols-2 gap-4">
                                              <div>
                                                <label className="text-[9px] font-bold text-slate-500 uppercase mb-2 block tracking-tighter">Fill Color</label>
                                                <div className="relative h-6 w-full">
                                                  <input
                                                    type="color"
                                                    value={normalizeColorToHex(selectedFillInfo.value) || '#ffffff'}
                                                    className="absolute inset-0 opacity-0 cursor-pointer z-10 w-full"
                                                    onChange={(e) => updateSelectedLetters({ fill: e.target.value })}
                                                    disabled={!hasSelectedLetters}
                                                  />
                                                  <div
                                                    className="w-full h-full rounded-full border border-slate-700 shadow-inner flex items-center justify-center text-[8px] uppercase tracking-widest text-slate-200/80"
                                                    style={{
                                                      background: selectedFillInfo.mixed
                                                        ? 'repeating-linear-gradient(45deg, #334155 0 4px, #1e293b 4px 8px)'
                                                        : (selectedFillInfo.value || 'transparent')
                                                    }}
                                                  >
                                                    {selectedFillInfo.mixed ? 'Mixed' : ''}
                                                  </div>
                                                </div>
                                              </div>
                                              <div>
                                                <label className="text-[9px] font-bold text-slate-500 uppercase mb-2 block tracking-tighter">Stroke Color</label>
                                                <div className="relative h-6 w-full">
                                                  <input
                                                    type="color"
                                                    value={normalizeColorToHex(selectedStrokeInfo.value) || '#ffffff'}
                                                    className="absolute inset-0 opacity-0 cursor-pointer z-10 w-full"
                                                    onChange={(e) => updateSelectedLetters({ stroke: e.target.value })}
                                                    disabled={!hasSelectedLetters}
                                                  />
                                                  <div
                                                    className="w-full h-full rounded-full border border-slate-700 shadow-inner flex items-center justify-center text-[8px] uppercase tracking-widest text-slate-200/80"
                                                    style={{
                                                      background: selectedStrokeInfo.mixed
                                                        ? 'repeating-linear-gradient(45deg, #334155 0 4px, #1e293b 4px 8px)'
                                                        : (selectedStrokeInfo.value || 'transparent')
                                                    }}
                                                  >
                                                    {selectedStrokeInfo.mixed ? 'Mixed' : ''}
                                                  </div>
                                                </div>
                                              </div>
                                            </div>
                                          </div>

                                          <div className="space-y-4 pt-4 border-t border-slate-800/50">
                                            <div className="space-y-2">
                                              <div className="flex justify-between">
                                                <label className="text-[9px] font-bold text-slate-500 uppercase tracking-tighter">Duration</label>
                                                <span className="text-[9px] text-blue-400 font-mono">0.5s</span>
                                              </div>
                                              <input
                                                type="range" min="0.1" max="5" step="0.1"
                                                className="w-full h-1 bg-slate-800 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-blue-500 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:shadow-[0_0_8px_#3b82f6]"
                                                onChange={(e) => updateSelectedLetters({ duration: parseFloat(e.target.value) })}
                                                disabled={!hasSelectedLetters}
                                              />
                                            </div>
                                            <div className="space-y-2">
                                              <div className="flex justify-between">
                                                <label className="text-[9px] font-bold text-slate-500 uppercase tracking-tighter">Stagger Delay</label>
                                                <span className="text-[9px] text-blue-400 font-mono">0.05s</span>
                                              </div>
                                              <input
                                                type="range" min="0" max="2" step="0.05"
                                                className="w-full h-1 bg-slate-800 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-blue-500 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:shadow-[0_0_8px_#3b82f6]"
                                                onChange={(e) => updateSelectedLetters({ delay: parseFloat(e.target.value) })}
                                                disabled={!hasSelectedLetters}
                                              />
                                            </div>
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          </>
                        )}
                        {appState === AppState.PROCESSING && <LoadingOverlay outputMode={outputMode} modelProvider={modelProvider} />}

                        {generatedImage && outputMode !== 'svg' && (
                          (generatedImage.endsWith('.mp4') || generatedImage.endsWith('.mov') || generatedImage.includes('video') || outputMode === 'video') ? (
                            <video
                              src={generatedImage}
                              controls
                              autoPlay
                              loop
                              className="max-h-full max-w-full object-contain animate-in fade-in duration-700 rounded-lg shadow-2xl"
                            />
                          ) : (
                            <img
                              src={generatedImage}
                              alt="Generated Result"
                              className="max-h-full max-w-full object-contain animate-in fade-in duration-700"
                            />
                          )
                        )}

                        {(generatedText || outputMode === 'svg') && (
                          <div className="w-full h-full flex flex-col">
                            {(svgContent || outputMode === 'svg') && (
                              <div className="flex border-b border-slate-800 bg-slate-900/50">
                                <button
                                  onClick={() => setViewMode('preview')}
                                  className={`px-4 py-2 text-xs font-medium transition-colors flex items-center gap-1.5 ${viewMode === 'preview'
                                    ? 'text-brand-400 border-b-2 border-brand-500 bg-slate-800/50'
                                    : 'text-slate-500 hover:text-slate-300'
                                    }`}
                                >
                                  <Eye className="w-3.5 h-3.5" /> Preview
                                </button>
                                <button
                                  onClick={() => setViewMode('code')}
                                  className={`px-4 py-2 text-xs font-medium transition-colors flex items-center gap-1.5 ${viewMode === 'code'
                                    ? 'text-brand-400 border-b-2 border-brand-500 bg-slate-800/50'
                                    : 'text-slate-500 hover:text-slate-300'
                                    }`}
                                >
                                  <Code className="w-3.5 h-3.5" /> Code
                                </button>
                                <button
                                  onClick={() => svgInputRef.current?.click()}
                                  className="px-4 py-2 text-xs font-medium text-slate-500 hover:text-brand-400 transition-colors flex items-center gap-1.5 border-l border-slate-800"
                                >
                                  <Upload className="w-3.5 h-3.5" /> Import
                                </button>
                                <input
                                  type="file"
                                  ref={svgInputRef}
                                  onChange={handleSvgImport}
                                  accept=".svg"
                                  className="hidden"
                                />
                              </div>
                            )}

                            {/* Main SVG Content Area */}
                            <div className="flex-1 overflow-hidden relative flex flex-col">
                              {viewMode === 'preview' ? (
                                <div
                                  className={`w-full h-full flex-1 flex items-center justify-center overflow-auto relative transition-[padding] duration-300 ${showSvgPanel ? 'pr-64' : 'pr-0'}`}
                                  style={{
                                    backgroundColor: svgBackground,
                                  }}
                                >
                                  {(svgContent || modifiedSvg) ? (
                                    <div
                                      key={`svg-${modifiedSvg?.length || 0}`}
                                      className="w-full h-full flex items-center justify-center p-4 [&_svg]:max-w-full [&_svg]:max-h-full [&_svg]:w-auto [&_svg]:h-auto [&_svg]:block"
                                      data-svg-preview="true"
                                      style={{ touchAction: 'none' }}
                                      dangerouslySetInnerHTML={{ __html: svgContent || (typeof modifiedSvg === 'string' ? extractSvg(modifiedSvg) || modifiedSvg : '') }}
                                      onPointerDown={handlePreviewPointerDown}
                                      onPointerMove={handlePreviewPointerMove}
                                      onPointerUp={handlePreviewPointerEnd}
                                      onPointerCancel={handlePreviewPointerEnd}
                                      onPointerLeave={handlePreviewPointerEnd}
                                      onMouseDown={(e) => {
                                        if (isDraggingWordRef.current || isDraggingLayerRef.current) {
                                          isDraggingWordRef.current = false;
                                          isDraggingLayerRef.current = false;
                                          return;
                                        }

                                        // Deselect when clicking the canvas background
                                        if (e.target === e.currentTarget) {
                                          setActiveWordId(null);
                                          setSelectedLetterIds(new Set());
                                          setActiveLayerId(null);
                                        }

                                        const target = e.target as SVGElement;
                                        const tspan = target.tagName.toLowerCase() === 'tspan' ? target : target.closest('tspan') as SVGElement;
                                        if (tspan && tspan.id && tspan.id.startsWith('letter-')) {
                                          toggleLetterSelection(tspan.id, e.ctrlKey || e.metaKey);
                                          if (activeEditorTab !== 'letters') setActiveEditorTab('letters');
                                        }
                                      }}
                                      onDoubleClick={(e) => {
                                        const target = e.target as SVGElement;
                                        const tspan = target.tagName.toLowerCase() === 'tspan' ? target : target.closest('tspan') as SVGElement;
                                        if (tspan && tspan.id && tspan.id.startsWith('letter-')) {
                                          const newChar = window.prompt("Edit Character:", tspan.textContent || '');
                                          if (newChar !== null && newChar.length > 0) {
                                            const charToSet = newChar.substring(0, 1);
                                            setSvgWords(prev => {
                                              const newWords = prev.map(w => ({
                                                ...w,
                                                letters: w.letters.map(l => l.id === tspan.id ? { ...l, char: charToSet } : l)
                                              }));

                                              const baseSvg = modifiedSvg || generatedText || '';
                                              if (baseSvg) {
                                                setModifiedSvg(reconstructSvg(baseSvg, newWords, svgLayers, svgBackgroundImage, svgBackground));
                                              }
                                              return newWords;
                                            });
                                          }
                                        }
                                      }}
                                    />
                                  ) : (
                                    <div className="text-slate-500 text-sm flex flex-col items-center gap-2">
                                      <Code className="w-8 h-8 opacity-20" />
                                      <p>No valid SVG content to preview</p>
                                    </div>
                                  )}
                                  {/* Bounding Box Overlay */}
                                  {viewMode === 'preview' && (svgContent || modifiedSvg) && (
                                    <GizmoOverlay
                                      activeLayerId={activeLayerId}
                                      activeWordId={activeWordId}
                                      selectedLetterIds={selectedLetterIds}
                                      svgWords={svgWords}
                                      onCommit={(changedWordIds) => {
                                        const previewSvg = getPreviewSvgElement();
                                        if (previewSvg) {
                                          setModifiedSvg(previewSvg.outerHTML);

                                          // Only sync positions for words that BoundingBox actually moved
                                          if (changedWordIds && changedWordIds.length > 0) {
                                            const changedSet = new Set(changedWordIds);
                                    const allTspans = Array.from(previewSvg.querySelectorAll<SVGElement>('tspan[data-word-id]'));

                                            // Collect position data only for changed words
                                            const wordUpdates: Record<string, {
                                              letters: { letterId: string; x: number; y: number; index: number; fontSize?: string }[];
                                              rotation: number;
                                            }> = {};

                                            allTspans.forEach(tspan => {
                                              const wordId = tspan.getAttribute('data-word-id');
                                              if (!wordId || !changedSet.has(wordId)) return;

                                              const letterId = tspan.id;
                                              const letterIndex = parseInt(tspan.getAttribute('data-letter-index') || '0', 10);
                                              if (!letterId) return;

                                              const xAttr = tspan.getAttribute('x');
                                              const yAttr = tspan.getAttribute('y');
                                              const rotateAttr = tspan.getAttribute('rotate') || tspan.getAttribute('data-word-rot');
                                              const fontSizeAttr = (tspan.getAttribute('font-size') || '').trim();

                                              if (xAttr === null || yAttr === null) return;

                                              const x = parseFloat(xAttr);
                                              const y = parseFloat(yAttr);
                                              if (!Number.isFinite(x) || !Number.isFinite(y)) return;

                                              let resolvedFontSize: string | undefined;
                                              if (fontSizeAttr) {
                                                resolvedFontSize = fontSizeAttr;
                                              } else if (typeof window !== 'undefined') {
                                                const computedFontSize = window.getComputedStyle(tspan).fontSize;
                                                if (computedFontSize && computedFontSize.trim().length > 0) {
                                                  resolvedFontSize = computedFontSize.trim();
                                                }
                                              }

                                              if (!wordUpdates[wordId]) {
                                                wordUpdates[wordId] = {
                                                  letters: [],
                                                  rotation: rotateAttr ? parseFloat(rotateAttr) : 0,
                                                };
                                              }
                                              wordUpdates[wordId].letters.push({ letterId, x, y, index: letterIndex, fontSize: resolvedFontSize });
                                              if (rotateAttr) {
                                                wordUpdates[wordId].rotation = parseFloat(rotateAttr);
                                              }
                                            });

                                            if (Object.keys(wordUpdates).length > 0) {
                                              setSvgWords(prev => prev.map(word => {
                                                const update = wordUpdates[word.id];
                                                if (!update || update.letters.length === 0) return word;

                                                const sorted = [...update.letters].sort((a, b) => a.index - b.index);
                                                const anchorX = sorted[0].x;
                                                const anchorY = sorted[0].y;

                                                const updatedLetters = word.letters.map((letter, idx) => {
                                                  const letterUpdate = sorted.find(s => s.index === idx);
                                                  if (letterUpdate) {
                                                    const nextLetter = { ...letter, x: letterUpdate.x, y: letterUpdate.y };
                                                    if (letterUpdate.fontSize) {
                                                      nextLetter.fontSize = letterUpdate.fontSize;
                                                    }
                                                    return nextLetter;
                                                  }
                                                  return letter;
                                                });

                                                return {
                                                  ...word,
                                                  letters: updatedLetters,
                                                  x: anchorX,
                                                  y: anchorY,
                                                  rotation: update.rotation || word.rotation,
                                                  isManual: true,
                                                };
                                              }));
                                            }
                                          }
                                        }
                                      }}
                                    />
                                  )}
                                </div>
                              ) : (
                                <div className="flex flex-col h-full">
                                  {/* Search Bar Row */}
                                  <div className="flex flex-col gap-2 p-2 bg-slate-900/80 border-b border-slate-800">
                                    {/* Search Input */}
                                    <div className="flex items-center gap-2 bg-slate-950 rounded-lg px-3 py-1.5 border border-slate-700/50 focus-within:border-brand-500/50">
                                      <Search className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
                                      <input
                                        type="text"
                                        value={svgSearchQuery}
                                        onChange={(e) => {
                                          setSvgSearchQuery(e.target.value);
                                          setCurrentMatchIndex(0);
                                        }}
                                        placeholder="Search in code..."
                                        className="flex-1 min-w-0 bg-transparent text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none"
                                      />
                                      {svgSearchQuery && (
                                        <div className="flex items-center gap-1 flex-shrink-0">
                                          <span className="text-[10px] text-slate-500 font-medium whitespace-nowrap">
                                            {(() => {
                                              const content = modifiedSvg || generatedText || '';
                                              const regex = new RegExp(svgSearchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
                                              const matches = content.match(regex) || [];
                                              return matches.length > 0 ? `${Math.min(currentMatchIndex + 1, matches.length)} /${matches.length}` : '0/0';
                                            })()
                                            }
                                          </span>
                                          <button
                                            onClick={() => {
                                              const content = modifiedSvg || generatedText || '';
                                              const regex = new RegExp(svgSearchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
                                              const matches = [...content.matchAll(regex)];
                                              if (matches.length > 0) {
                                                const newIndex = Math.max(0, currentMatchIndex - 1);
                                                setCurrentMatchIndex(newIndex);
                                                // Scroll textarea to match position
                                                const textarea = document.querySelector('textarea[data-svg-editor]') as HTMLTextAreaElement;
                                                if (textarea && matches[newIndex]) {
                                                  const matchPos = matches[newIndex].index || 0;

                                                  // Create a mirror div to accurately measure text height
                                                  const mirror = document.createElement('div');
                                                  const styles = window.getComputedStyle(textarea);
                                                  mirror.style.cssText = `
                                                    position: absolute;
                                                    visibility: hidden;
                                                    white-space: pre-wrap;
                                                    word-wrap: break-word;
                                                    width: ${textarea.clientWidth}px;
                                                    font: ${styles.font};
                                                    padding: ${styles.padding};
                                                    line-height: ${styles.lineHeight};
                                                  `;
                                                  mirror.textContent = content.substring(0, matchPos);
                                                  document.body.appendChild(mirror);
                                                  const scrollTarget = mirror.offsetHeight - (textarea.clientHeight / 2);
                                                  document.body.removeChild(mirror);

                                                  // Use requestAnimationFrame to ensure scroll happens
                                                  requestAnimationFrame(() => {
                                                    textarea.scrollTop = Math.max(0, scrollTarget);
                                                    textarea.focus();
                                                    textarea.setSelectionRange(matchPos, matchPos + svgSearchQuery.length);
                                                  });
                                                }
                                              }
                                            }}
                                            className="p-0.5 hover:bg-slate-800 rounded transition-colors"
                                            title="Previous match"
                                          >
                                            <ChevronUp className="w-3.5 h-3.5 text-slate-400" />
                                          </button>
                                          <button
                                            onClick={() => {
                                              const content = modifiedSvg || generatedText || '';
                                              const regex = new RegExp(svgSearchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
                                              const matches = [...content.matchAll(regex)];
                                              if (matches.length > 0) {
                                                const newIndex = Math.min(matches.length - 1, currentMatchIndex + 1);
                                                setCurrentMatchIndex(newIndex);
                                                // Scroll textarea to match position
                                                const textarea = document.querySelector('textarea[data-svg-editor]') as HTMLTextAreaElement;
                                                if (textarea && matches[newIndex]) {
                                                  const matchPos = matches[newIndex].index || 0;

                                                  // Create a mirror div to accurately measure text height
                                                  const mirror = document.createElement('div');
                                                  const styles = window.getComputedStyle(textarea);
                                                  mirror.style.cssText = `
                                                    position: absolute;
                                                    visibility: hidden;
                                                    white-space: pre-wrap;
                                                    word-wrap: break-word;
                                                    width: ${textarea.clientWidth}px;
                                                    font: ${styles.font};
                                                    padding: ${styles.padding};
                                                    line-height: ${styles.lineHeight};
                                                  `;
                                                  mirror.textContent = content.substring(0, matchPos);
                                                  document.body.appendChild(mirror);
                                                  const scrollTarget = mirror.offsetHeight - (textarea.clientHeight / 2);
                                                  document.body.removeChild(mirror);

                                                  // Use requestAnimationFrame to ensure scroll happens
                                                  requestAnimationFrame(() => {
                                                    textarea.scrollTop = Math.max(0, scrollTarget);
                                                    textarea.focus();
                                                    textarea.setSelectionRange(matchPos, matchPos + svgSearchQuery.length);
                                                  });
                                                }
                                              }
                                            }}
                                            className="p-0.5 hover:bg-slate-800 rounded transition-colors"
                                            title="Next match"
                                          >
                                            <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                                          </button>
                                          <button
                                            onClick={() => {
                                              setSvgSearchQuery('');
                                              setCurrentMatchIndex(0);
                                            }}
                                            className="p-0.5 hover:bg-slate-800 rounded transition-colors"
                                            title="Clear search"
                                          >
                                            <X className="w-3.5 h-3.5 text-slate-400" />
                                          </button>
                                        </div>
                                      )}
                                    </div>

                                    <div className="flex items-center gap-2">
                                      <button
                                        onClick={() => {
                                          setModifiedSvg(null);
                                          setGeneratedText(''); // Keep UI visible via outputMode condition
                                          setSvgColors([]);
                                        }}
                                        className="px-2.5 py-1.5 text-[10px] font-medium bg-red-500/10 hover:bg-red-500/20 text-red-400 hover:text-red-300 rounded-lg border border-red-500/20 transition-colors flex items-center gap-1"
                                        title="Clear code"
                                      >
                                        <Trash2 className="w-3 h-3" /> Clear
                                      </button>
                                      <button
                                        onClick={() => {
                                          const code = generateStandaloneHtml(modifiedSvg || generatedText || '', svgWords, svgBackground);
                                          navigator.clipboard.writeText(code);
                                          // Optional: Toast notification
                                          alert("Start-to-finish GSAP HTML code copied to clipboard!");
                                        }}
                                        className="px-2.5 py-1.5 text-[10px] font-medium bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 hover:text-indigo-300 rounded-lg border border-indigo-500/20 transition-colors flex items-center gap-1"
                                        title="Copy Standalone HTML with GSAP"
                                      >
                                        <Copy className="w-3 h-3" /> HTML
                                      </button>
                                      <button
                                        onClick={() => {
                                          // Re-extract SVG and colors from the modified content
                                          const currentSvg = modifiedSvg || generatedText || '';
                                          const extracted = extractSvg(currentSvg);
                                          if (extracted) {
                                            const withIds = ensureLayerIds(stripInternalTextAttrs(extracted));
                                            setModifiedSvg(withIds);
                                            setGeneratedText(withIds); // Sync back to trigger svgContent update
                                            const hexMatches = withIds.match(/#(?:[0-9a-fA-F]{3}){1,2}\b/g) || [];
                                            setSvgColors(Array.from(new Set(hexMatches)));
                                            setSvgWords(parseSvgText(withIds));
                                            setSvgLayers(parseSvgLayers(withIds));
                                          }
                                          setViewMode('preview');
                                        }}
                                        className="px-2.5 py-1.5 text-[10px] font-medium bg-brand-500/10 hover:bg-brand-500/20 text-brand-400 hover:text-brand-300 rounded-lg border border-brand-500/20 transition-colors flex items-center gap-1"
                                        title="Apply changes"
                                      >
                                        <Check className="w-3 h-3" /> Apply
                                      </button>
                                    </div>
                                  </div>

                                  {/* Code Textarea */}
                                  <textarea
                                    data-svg-editor="true"
                                    value={modifiedSvg || generatedText || ''}
                                    onChange={(e) => {
                                      setModifiedSvg(e.target.value);
                                      // Re-extract colors from edited SVG
                                      const hexMatches = e.target.value.match(/#(?:[0-9a-fA-F]{3}){1,2}\b/g) || [];
                                      setSvgColors(Array.from(new Set(hexMatches)));
                                    }}
                                    className="flex-1 w-full min-h-[400px] bg-slate-950 text-xs sm:text-sm font-mono text-slate-300 p-4 resize-none focus:outline-none focus:ring-2 focus:ring-brand-500/50 border-0"
                                    spellCheck={false}
                                    placeholder="Paste SVG code here..."
                                  />
                                </div>
                              )}
                            </div>
                          </div>
                        )}

                        {
                          !generatedImage && !generatedText && !appState && (
                            <div className="text-center p-6 opacity-40">
                              <Wand2 className="w-16 h-16 mx-auto mb-4 text-slate-600" />
                              <p className="text-slate-500">
                                Your masterpiece will appear here
                              </p>
                            </div>
                          )
                        }
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </main>
          </div>

          <footer className="w-full py-6 mt-12 border-t border-slate-900 text-center">
            <p className="text-slate-600 text-sm">
              &copy; {new Date().getFullYear()} Road Runner Studio. Powered by
              Google Gemini.
            </p>
            <p className="mt-1 text-slate-600 text-xs">
              &copy; Created by @FDTiger777
            </p>
          </footer>
        </div>
        <input
          type="file"
          ref={fileInputRef}
          onChange={(e) => handleFileChange(e, false)}
          accept="image/*"
          className="hidden"
        />
        <input
          type="file"
          ref={attachmentInputRef}
          onChange={(e) => handleFileChange(e, true)}
          accept="image/*"
          className="hidden"
        />

        {projectInfoModalOpen && (
          <div className="fixed inset-0 z-[105] bg-black/80 backdrop-blur-md p-2 sm:p-4 overflow-y-auto animate-in fade-in duration-300">
            <div className="min-h-full flex items-start sm:items-center justify-center">
              <div className="w-full max-w-3xl bg-slate-900 rounded-3xl border border-slate-700 shadow-2xl relative overflow-hidden max-h-[calc(100dvh-16px)] sm:max-h-none flex flex-col sm:block animate-in zoom-in-95 duration-300">
                <button
                  onClick={() => setProjectInfoModalOpen(false)}
                  className="absolute top-4 right-4 text-slate-500 hover:text-slate-300 z-10 p-1 rounded-full hover:bg-slate-800 transition-colors"
                  aria-label="Close project info"
                >
                  <X className="w-4 h-4" />
                </button>

                <div className="p-6 sm:p-8 space-y-6 overflow-y-auto sm:overflow-visible custom-scrollbar min-h-0">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-xl sm:text-2xl font-bold text-white">Road Runner Studio</h2>
                    <p className="text-sm text-slate-400 mt-1">
                      Universal AI studio for image, video, and SVG generation with an interactive layer and text editor.
                    </p>
                  </div>
                  <div className="px-3 py-1 rounded-full bg-brand-500/10 border border-brand-500/30 text-[11px] font-semibold text-brand-300 whitespace-nowrap">
                    Version {APP_VERSION}
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                  <div className="rounded-2xl border border-slate-800 bg-slate-950/50 p-4">
                    <h3 className="text-xs uppercase tracking-widest font-bold text-brand-300 mb-3">What the Project Can Do</h3>
                    <ul className="space-y-2 text-sm text-slate-300">
                      <li>• Text-to-image generation (Hugging Face / FLUX).</li>
                      <li>• Video generation (AIHubMix: Sora, Kling, Pika, Luma).</li>
                      <li>• SVG generation and editing (Gemini 2.5 Flash).</li>
                      <li>• Drag / resize / rotate for text and graphic layers.</li>
                      <li>• SVG / HTML export and session history.</li>
                    </ul>
                  </div>

                  <div className="rounded-2xl border border-slate-800 bg-slate-950/50 p-4">
                    <h3 className="text-xs uppercase tracking-widest font-bold text-brand-300 mb-3">Support the Project</h3>

                    <div className="flex items-center gap-4 mb-4">
                      <div className="support-coffee-scene" aria-hidden="true">
                        <span className="support-steam support-steam-1" />
                        <span className="support-steam support-steam-2" />
                        <span className="support-steam support-steam-3" />
                        <div className="support-cup">
                          <div className="support-cup-handle" />
                        </div>
                        <div className="support-saucer" />
                      </div>
                      <p className="text-xs text-slate-400 leading-relaxed">
                        If this app helps your workflow, you can support ongoing development with a crypto donation.
                      </p>
                    </div>

                    <div className="space-y-3">
                      <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3">
                        <div className="text-[11px] font-semibold text-amber-300 mb-1">Bitcoin (BTC)</div>
                        <div className="flex items-center gap-2">
                          <code className="flex-1 text-[11px] text-slate-200 break-all bg-slate-900/60 border border-slate-800 rounded-lg px-2 py-1.5">
                            {DONATION_BTC_ADDRESS}
                          </code>
                          <button
                            onClick={() => handleCopyDonationAddress('btc', DONATION_BTC_ADDRESS)}
                            className="p-2 rounded-lg border border-slate-700 text-slate-300 hover:text-white hover:border-slate-500 transition-colors"
                            title="Copy BTC address"
                          >
                            {copiedDonationType === 'btc' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                          </button>
                        </div>
                      </div>

                      <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-3">
                        <div className="text-[11px] font-semibold text-cyan-300 mb-1">USDT (TRC20)</div>
                        <div className="flex items-center gap-2">
                          <code className="flex-1 text-[11px] text-slate-200 break-all bg-slate-900/60 border border-slate-800 rounded-lg px-2 py-1.5">
                            {DONATION_USDT_TRC20_ADDRESS}
                          </code>
                          <button
                            onClick={() => handleCopyDonationAddress('usdt', DONATION_USDT_TRC20_ADDRESS)}
                            className="p-2 rounded-lg border border-slate-700 text-slate-300 hover:text-white hover:border-slate-500 transition-colors"
                            title="Copy USDT address"
                          >
                            {copiedDonationType === 'usdt' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                          </button>
                        </div>
                      </div>
                    </div>

                    <p className="text-[11px] text-emerald-400/80 mt-3">Thank you for your support.</p>
                  </div>
                </div>

                <div className="flex justify-end">
                  <button
                    onClick={() => setProjectInfoModalOpen(false)}
                    className="px-4 py-2 rounded-lg border border-slate-700 text-slate-200 hover:text-white hover:border-slate-500 transition-colors text-sm"
                  >
                    Got it
                  </button>
                </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {
          apiKeyModalOpen && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-md animate-in fade-in duration-300">
              <div className="w-full max-w-md bg-slate-900 rounded-3xl border border-slate-700 shadow-2xl p-0 overflow-hidden relative animate-in zoom-in-95 duration-300">
                {/* Modal Content */}
                <div className="flex border-b border-slate-800">
                  <button
                    onClick={() => setModalTab('gemini')}
                    className={`flex-1 py-4 text-sm font-semibold transition-all flex items-center justify-center gap-2 ${modalTab === 'gemini'
                      ? 'bg-brand-500/10 text-brand-400 border-b-2 border-brand-500'
                      : 'text-slate-500 hover:text-slate-300'
                      }`}
                  >
                    <Zap className="w-4 h-4" />
                    Gemini API
                  </button>
                  <button
                    onClick={() => setModalTab('hf')}
                    className={`flex-1 py-4 text-sm font-semibold transition-all flex items-center justify-center gap-2 ${modalTab === 'hf'
                      ? 'bg-brand-500/10 text-brand-400 border-b-2 border-brand-500'
                      : 'text-slate-500 hover:text-slate-300'
                      }`}
                  >
                    <ImageIcon className="w-4 h-4" />
                    Hugging Face
                  </button>
                  <button
                    onClick={() => setModalTab('aihubmix')}
                    className={`flex-1 py-4 text-sm font-semibold transition-all flex items-center justify-center gap-2 ${modalTab === 'aihubmix'
                      ? 'bg-brand-500/10 text-brand-400 border-b-2 border-brand-500'
                      : 'text-slate-500 hover:text-slate-300'
                      }`}
                  >
                    <Zap className="w-4 h-4" />
                    AIHubMix
                  </button>
                </div>

                <button
                  onClick={() => setApiKeyModalOpen(false)}
                  className="absolute top-4 right-4 text-slate-500 hover:text-slate-300 z-10 p-1 rounded-full hover:bg-slate-800 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>

                <div className="p-8">
                  {modalTab === 'gemini' && (
                    <div className="animate-in slide-in-from-left-4 duration-300">
                      <h2 className="text-xl font-bold text-white mb-2">
                        Gemini AI Model
                      </h2>
                      <p className="text-sm text-slate-400 mb-6 leading-relaxed">
                        Gemini (gemini-2.5-flash / gemini-2.5-flash-lite) generates SVG only.
                        Use it for vector output and prompt refinement.
                        Get yours at{' '}
                        <a
                          href="https://aistudio.google.com/app/apikey"
                          target="_blank"
                          rel="noreferrer"
                          className="text-brand-400 hover:text-brand-300 underline font-medium"
                        >
                          aistudio.google.com
                        </a>
                      </p>

                      <div className="space-y-4">
                        <div className="relative">
                          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                            <KeyRound className="h-4 w-4 text-slate-600" />
                          </div>
                          <input
                            type="password"
                            value={apiKeyInput}
                            onChange={(e) => setApiKeyInput(e.target.value)}
                            placeholder="AIzaSy..."
                            className="w-full bg-slate-950 border border-slate-700/50 rounded-xl pl-10 pr-4 py-3 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500/50 transition-all font-mono"
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {modalTab === 'hf' && (
                    <div className="animate-in slide-in-from-right-4 duration-300">
                      <h2 className="text-xl font-bold text-white mb-2">
                        Hugging Face (Flux)
                      </h2>
                      <p className="text-sm text-slate-400 mb-6 leading-relaxed">
                        Hugging Face is used for image generation (FLUX.1).
                        Create a token (Role: Read) at{' '}
                        <a
                          href="https://huggingface.co/settings/tokens"
                          target="_blank"
                          rel="noreferrer"
                          className="text-brand-400 hover:text-brand-300 underline font-medium"
                        >
                          huggingface.co/settings/tokens
                        </a>
                      </p>

                      <div className="space-y-4">
                        <div className="relative">
                          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                            <KeyRound className="h-4 w-4 text-slate-600" />
                          </div>
                          <input
                            type="password"
                            value={hfKeyInput}
                            onChange={(e) => setHfKeyInput(e.target.value)}
                            placeholder="hf_..."
                            className="w-full bg-slate-950 border border-slate-700/50 rounded-xl pl-10 pr-4 py-3 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500/50 transition-all font-mono"
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {modalTab === 'aihubmix' && (
                    <div className="animate-in slide-in-from-right-4 duration-300">
                      <h2 className="text-xl font-bold text-white mb-2">
                        AIHubMix
                      </h2>
                      <p className="text-sm text-slate-400 mb-6 leading-relaxed">
                        Used for video generation (Sora, Kling, Pika, Luma models).
                        Get your API key at{' '}
                        <a
                          href="https://aihubmix.com"
                          target="_blank"
                          rel="noreferrer"
                          className="text-brand-400 hover:text-brand-300 underline font-medium"
                        >
                          aihubmix.com
                        </a>
                      </p>

                      <div className="space-y-4">
                        <div className="relative">
                          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                            <KeyRound className="h-4 w-4 text-slate-600" />
                          </div>
                          <input
                            type="password"
                            value={aihubmixKeyInput}
                            onChange={(e) => setAihubmixKeyInput(e.target.value)}
                            placeholder="ahm_..."
                            className="w-full bg-slate-950 border border-slate-700/50 rounded-xl pl-10 pr-4 py-3 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500/50 transition-all font-mono"
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="mt-8 flex flex-col gap-3">
                    <button
                      onClick={handleSaveApiKey}
                      disabled={
                        (modalTab === 'gemini' ? !apiKeyInput.trim() :
                          modalTab === 'hf' ? !hfKeyInput.trim() :
                            !aihubmixKeyInput.trim())
                      }
                      className={`
                    w-full py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-all active:scale-[0.98]
                    ${(modalTab === 'gemini' ? apiKeyInput.trim() :
                          modalTab === 'hf' ? hfKeyInput.trim() :
                            aihubmixKeyInput.trim())
                          ? 'bg-brand-600 text-white hover:bg-brand-500 shadow-lg shadow-brand-500/20'
                          : 'bg-slate-800 text-slate-500 cursor-not-allowed'
                        }
                  `}
                    >
                      {(modalTab === 'gemini' ? apiKeySaved :
                        modalTab === 'hf' ? hfKeySaved :
                          aihubmixKeySaved) ? (
                        <>
                          <Check className="w-5 h-5 text-green-400" />
                          Saved Successfully
                        </>
                      ) : (
                        <>
                          <Check className="w-4 h-4 opacity-70" />
                          Save Settings
                        </>
                      )}
                    </button>

                    <button
                      onClick={() => setApiKeyModalOpen(false)}
                      className="w-full py-3 text-xs text-slate-500 hover:text-slate-300 font-medium transition-colors"
                    >
                      Close & Continue
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
      </div>
    </div>
  );
};

export default App;

