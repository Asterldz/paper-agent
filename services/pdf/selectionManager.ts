import type { PdfColumnMode, SelectionHighlight, TextSelection } from '@/types/pdf';

const CONTEXT_RADIUS = 500;
const normalizedLayerTextCache = new WeakMap<HTMLElement, string>();
const wordTokenCache = new WeakMap<HTMLElement, PdfWordToken[]>();
const pageColumnLayoutCache = new WeakMap<HTMLElement, { layout: DetectedColumnLayout | null; pageWidth: number }>();

export interface PdfWordAnchor {
  height: number;
  index: number;
  layer: HTMLElement;
  left: number;
  pageNumber: number;
  top: number;
  width: number;
}

interface PdfWordToken extends PdfWordAnchor {
  text: string;
}

function elementForNode(node: Node | null): Element | null {
  if (!node) return null;
  return node instanceof Element ? node : node.parentElement;
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function normalizeSelectedText(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n+/)
    .map((paragraph) => paragraph.replace(/[ \t]*\n[ \t]*/g, ' ').replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n\n');
}

export function primePdfSelectionLayer(layer: HTMLElement) {
  normalizedLayerTextCache.set(layer, normalizeText(layer.textContent ?? ''));
  wordTokenCache.delete(layer);
  pageColumnLayoutCache.delete(layer);
}

function textForLayer(layer: HTMLElement): string {
  const cached = normalizedLayerTextCache.get(layer);
  if (cached !== undefined) return cached;
  const text = normalizeText(layer.textContent ?? '');
  normalizedLayerTextCache.set(layer, text);
  return text;
}

export function wordAnchorAtPoint(root: HTMLElement, clientX: number, clientY: number): PdfWordAnchor | null {
  const layers = Array.from(root.querySelectorAll<HTMLElement>('.textLayer'))
    .filter((layer) => layer.textContent?.trim());
  if (!layers.length) return null;
  const layer = layers.reduce((closest, candidate) => {
    const closestDistance = distanceToRect(clientX, clientY, closest.getBoundingClientRect());
    const candidateDistance = distanceToRect(clientX, clientY, candidate.getBoundingClientRect());
    return candidateDistance < closestDistance ? candidate : closest;
  });
  const bounds = layer.getBoundingClientRect();
  const localX = clientX - bounds.left;
  const localY = clientY - bounds.top;
  const tokens = wordTokensForLayer(layer);
  const token = tokens.reduce<PdfWordToken | null>((closest, candidate) => {
    if (!closest) return candidate;
    return distanceToToken(localX, localY, candidate) < distanceToToken(localX, localY, closest) ? candidate : closest;
  }, null);
  return token ? anchorForToken(token) : null;
}

export function anchorsAreInDifferentColumns(
  anchor: PdfWordAnchor,
  focus: PdfWordAnchor,
  columnMode: PdfColumnMode = 'auto',
): boolean {
  if (anchor.layer !== focus.layer || anchor.pageNumber !== focus.pageNumber) return false;
  const tokens = wordTokensForLayer(anchor.layer);
  const pageWidth = anchor.layer.getBoundingClientRect().width;
  const gutter = columnGutterAt(tokens, pageWidth, anchor.top + anchor.height / 2, columnMode);
  if (gutter === null) return false;
  return (anchor.left + anchor.width / 2 < gutter) !== (focus.left + focus.width / 2 < gutter);
}

export function hasReachedColumnContinuationBoundary(
  root: HTMLElement,
  anchor: PdfWordAnchor,
  focus: PdfWordAnchor,
  columnMode: PdfColumnMode = 'auto',
): boolean {
  if (anchor.layer !== focus.layer || anchor.pageNumber !== focus.pageNumber) return false;
  const tokens = wordTokensForLayer(anchor.layer);
  const pageWidth = anchor.layer.getBoundingClientRect().width;
  const gutter = columnGutterAt(tokens, pageWidth, anchor.top + anchor.height / 2, columnMode);
  if (gutter === null) return false;
  const anchorIsLeft = anchor.left + anchor.width / 2 < gutter;
  const focusIsLeft = focus.left + focus.width / 2 < gutter;
  if (anchorIsLeft !== focusIsLeft) return false;

  const columnLines = paragraphBodyLines(root, tokens.filter((token) => (
    token.left + token.width / 2 < gutter
  ) === anchorIsLeft));
  const focusLineIndex = columnLines.findIndex((line) => line.some((token) => token.index === focus.index));
  if (focusLineIndex < 0) return false;

  // Reading order crosses from the bottom of the left column to the top of the
  // right column. Requiring the pointer to reach that boundary prevents a
  // small horizontal wobble from suddenly selecting both columns.
  const boundaryLineCount = Math.min(2, columnLines.length);
  return anchorIsLeft
    ? focusLineIndex >= columnLines.length - boundaryLineCount
    : focusLineIndex < boundaryLineCount;
}

export function paragraphAnchorsAtPoint(
  root: HTMLElement,
  clientX: number,
  clientY: number,
  columnMode: PdfColumnMode = 'auto',
): [PdfWordAnchor, PdfWordAnchor] | null {
  const hit = wordAnchorAtPoint(root, clientX, clientY);
  if (!hit) return null;
  const pageTokens = wordTokensForLayer(hit.layer);
  const pageWidth = hit.layer.getBoundingClientRect().width;
  const columnGutter = columnGutterAt(pageTokens, pageWidth, hit.top + hit.height / 2, columnMode);
  const usesTwoColumns = columnGutter !== null;
  const hitIsLeftColumn = columnGutter !== null && hit.left + hit.width / 2 < columnGutter;
  const tokens = columnGutter !== null
    ? pageTokens.filter((token) => (token.left + token.width / 2 < columnGutter) === hitIsLeftColumn)
    : pageTokens;
  const lines = paragraphBodyLines(root, tokens);
  const hitLineIndex = lines.findIndex((line) => line.some((token) => token.index === hit.index));
  if (hitLineIndex < 0) return [hit, hit];
  let startLine = hitLineIndex;
  let endLine = hitLineIndex;
  while (startLine > 0 && !isParagraphBoundary(lines[startLine - 1], lines[startLine])) startLine -= 1;
  while (endLine < lines.length - 1 && !isParagraphBoundary(lines[endLine], lines[endLine + 1])) endLine += 1;
  let first = lines[startLine][0];
  let last = lines[endLine].at(-1);

  // In a true two-column paper, a paragraph may finish at the bottom of the
  // left column and continue at the top of the right column. Preserve that
  // reading order when paragraph mode is used from either side.
  if (columnGutter !== null && hitIsLeftColumn && endLine === lines.length - 1) {
    const rightLines = paragraphBodyLines(root, pageTokens.filter((token) => token.left + token.width / 2 >= columnGutter));
    const rightFirstLine = rightLines[0];
    if (last && rightFirstLine && continuesAcrossPage(lines.at(-1) ?? lines[endLine], rightFirstLine)) {
      let rightEnd = 0;
      while (rightEnd < rightLines.length - 1 && !isParagraphBoundary(rightLines[rightEnd], rightLines[rightEnd + 1])) rightEnd += 1;
      last = rightLines[rightEnd].at(-1);
    }
  }

  if (columnGutter !== null && !hitIsLeftColumn && startLine === 0) {
    const leftLines = paragraphBodyLines(root, pageTokens.filter((token) => token.left + token.width / 2 < columnGutter));
    const leftLastLine = leftLines.at(-1);
    if (leftLastLine && continuesAcrossPage(leftLastLine, lines[0])) {
      let leftStart = leftLines.length - 1;
      while (leftStart > 0 && !isParagraphBoundary(leftLines[leftStart - 1], leftLines[leftStart])) leftStart -= 1;
      first = leftLines[leftStart][0];
    }
  }

  // A paragraph can continue across a page break. Expand only for single-column
  // pages and only when the text on both sides reads as a continuation.
  if (!usesTwoColumns && startLine === 0) {
    const previousLayer = root.querySelector<HTMLElement>(`.textLayer[data-page-number="${hit.pageNumber - 1}"]`);
    if (previousLayer) {
      const previousTokens = wordTokensForLayer(previousLayer);
      if (!pageUsesTwoColumns(previousTokens, previousLayer.getBoundingClientRect().width)) {
        const previousLines = paragraphBodyLines(root, previousTokens);
        const previousLastLine = previousLines.at(-1);
        if (previousLastLine && continuesAcrossPage(previousLastLine, lines[0])) {
          let previousStart = previousLines.length - 1;
          while (previousStart > 0 && !isParagraphBoundary(previousLines[previousStart - 1], previousLines[previousStart])) previousStart -= 1;
          first = previousLines[previousStart][0];
        }
      }
    }
  }

  if (!usesTwoColumns && endLine === lines.length - 1) {
    const nextLayer = root.querySelector<HTMLElement>(`.textLayer[data-page-number="${hit.pageNumber + 1}"]`);
    if (nextLayer) {
      const nextTokens = wordTokensForLayer(nextLayer);
      if (!pageUsesTwoColumns(nextTokens, nextLayer.getBoundingClientRect().width)) {
        const nextLines = paragraphBodyLines(root, nextTokens);
        const nextFirstLine = nextLines[0];
        if (last && nextFirstLine && continuesAcrossPage(lines.at(-1) ?? lines[endLine], nextFirstLine)) {
          let nextEnd = 0;
          while (nextEnd < nextLines.length - 1 && !isParagraphBoundary(nextLines[nextEnd], nextLines[nextEnd + 1])) nextEnd += 1;
          last = nextLines[nextEnd].at(-1);
        }
      }
    }
  }
  return last
    ? [anchorForToken(first), anchorForToken(last)]
    : [hit, hit];
}

function paragraphBodyLines(root: HTMLElement, tokens: PdfWordToken[]): PdfWordToken[][] {
  const repeatedHeaders = repeatedTopMarginLines(root);
  return groupTokensIntoLines(tokens).filter((line) => {
    const layer = line[0]?.layer;
    const pageHeight = layer?.getBoundingClientRect().height ?? 0;
    if (pageHeight <= 0) return true;
    const centerY = line.reduce((sum, token) => sum + token.top + token.height / 2, 0) / line.length;
    const text = lineText(line);
    if (centerY <= pageHeight * 0.095 && isRunningHeaderLine(text, repeatedHeaders)) return false;
    if (centerY >= pageHeight * 0.92 && /^(?:page\s*)?(?:\d{1,4}|[ivxlcdm]{1,8})$/i.test(text.trim())) return false;
    return true;
  });
}

function continuesAcrossPage(previousLine: PdfWordToken[], nextLine: PdfWordToken[]): boolean {
  const previous = lineText(previousLine).trim();
  const next = lineText(nextLine).trim();
  if (!previous || !next || looksLikeSectionHeading(nextLine)) return false;
  if (/[-‐‑‒–—]$/.test(previous)) return true;
  if (/^[a-zà-öø-ÿ]|^[,;:)}\]]/.test(next)) return true;
  return !/[.!?][\]})'”’\d]*$/.test(previous);
}

function looksLikeSectionHeading(line: PdfWordToken[]): boolean {
  const text = lineText(line).trim();
  if (!text || text.length > 120 || /[.!?]$/.test(text)) return false;
  const startsWithSectionNumber = /^\d+(?:\.\d+)*\s+\S/.test(text);
  const words = text.split(/\s+/).filter(Boolean);
  const titleCaseRatio = words.length
    ? words.filter((word) => /^[A-Z][A-Za-z-]*$/.test(word)).length / words.length
    : 0;
  return startsWithSectionNumber || (words.length <= 12 && titleCaseRatio >= 0.65);
}

export function readSnappedSelection(
  root: HTMLElement,
  anchor: PdfWordAnchor,
  focus: PdfWordAnchor,
  columnMode: PdfColumnMode = 'auto',
): TextSelection | null {
  const tokenSelection = tokensBetween(root, anchor, focus, columnMode);
  const tokens = tokenSelection.tokens;
  if (!tokens.length) return null;
  const selectedText = textFromTokens(tokens, tokenSelection.preserveReadingOrder);
  if (selectedText.length < 2) return null;
  const startLayer = tokens[0].layer;
  const endLayer = tokens.at(-1)?.layer ?? startLayer;
  const startPageText = textForLayerInReadingOrder(startLayer, anchor, columnMode);
  const endPageText = startLayer === endLayer ? '' : textForLayerInReadingOrder(endLayer, focus, columnMode);
  const pageText = normalizeText(`${startPageText} ${endPageText}`);
  const selectedTextForSearch = normalizeText(selectedText);
  const selectedIndex = pageText.toLocaleLowerCase().indexOf(selectedTextForSearch.toLocaleLowerCase());
  const contextStart = selectedIndex >= 0 ? Math.max(0, selectedIndex - CONTEXT_RADIUS) : 0;
  const contextEnd = selectedIndex >= 0
    ? Math.min(pageText.length, selectedIndex + selectedTextForSearch.length + CONTEXT_RADIUS)
    : Math.min(pageText.length, CONTEXT_RADIUS * 2);
  return {
    id: crypto.randomUUID(),
    selectedText,
    surroundingText: pageText.slice(contextStart, contextEnd),
    pageNumber: tokens[0].pageNumber,
    timestamp: Date.now(),
  };
}

export function readSnappedHighlights(
  root: HTMLElement,
  anchor: PdfWordAnchor,
  focus: PdfWordAnchor,
  columnMode: PdfColumnMode = 'auto',
): SelectionHighlight[] {
  const selectedTokens = tokensBetween(root, anchor, focus, columnMode).tokens;
  const byPage = new Map<number, SelectionHighlight['rects']>();
  for (const token of selectedTokens) {
    const rects = byPage.get(token.pageNumber) ?? [];
    rects.push({ height: token.height, left: token.left, top: token.top, width: token.width });
    byPage.set(token.pageNumber, rects);
  }
  return Array.from(byPage, ([pageNumber, rects]) => {
    const pageToken = selectedTokens.find((token) => token.pageNumber === pageNumber);
    const layer = pageToken?.layer;
    const reference = pageNumber === anchor.pageNumber ? anchor : pageNumber === focus.pageNumber ? focus : pageToken;
    const columnGutter = layer && reference
      ? columnGutterAt(
        wordTokensForLayer(layer),
        layer.getBoundingClientRect().width,
        reference.top + reference.height / 2,
        columnMode,
      )
      : null;
    return { pageNumber, rects: mergeLineRects(rects, columnGutter) };
  });
}

function wordTokensForLayer(layer: HTMLElement): PdfWordToken[] {
  const cached = wordTokenCache.get(layer);
  if (cached) return cached;
  const layerBounds = layer.getBoundingClientRect();
  const pageNumber = Number(layer.dataset.pageNumber);
  const tokens: PdfWordToken[] = [];
  const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    const parent = node.parentElement;
    if (parent?.closest('.textLayer') === layer && !parent.closest('[role="img"]')) {
      const value = node.textContent ?? '';
      for (const match of value.matchAll(/\S+/g)) {
        const start = match.index ?? 0;
        const range = document.createRange();
        range.setStart(node, start);
        range.setEnd(node, start + match[0].length);
        const rect = range.getBoundingClientRect();
        range.detach();
        if (rect.width < 0.5 || rect.height < 0.5) continue;
        tokens.push({
          height: rect.height,
          index: tokens.length,
          layer,
          left: rect.left - layerBounds.left,
          pageNumber,
          text: match[0],
          top: rect.top - layerBounds.top,
          width: rect.width,
        });
      }
    }
    node = walker.nextNode();
  }
  wordTokenCache.set(layer, tokens);
  return tokens;
}

interface SnappedTokenSelection {
  preserveReadingOrder: boolean;
  tokens: PdfWordToken[];
}

function tokensBetween(
  root: HTMLElement,
  anchor: PdfWordAnchor,
  focus: PdfWordAnchor,
  columnMode: PdfColumnMode,
): SnappedTokenSelection {
  if (anchor.layer === focus.layer && anchor.pageNumber === focus.pageNumber) {
    return tokensBetweenOnPage(wordTokensForLayer(anchor.layer), anchor, focus, columnMode);
  }
  const startKey = anchorKey(anchor);
  const endKey = anchorKey(focus);
  const low = Math.min(startKey, endKey);
  const high = Math.max(startKey, endKey);
  const [start, end] = startKey <= endKey ? [anchor, focus] : [focus, anchor];
  const selectedTokens = Array.from(root.querySelectorAll<HTMLElement>('.textLayer'))
    .flatMap((layer) => wordTokensForLayer(layer))
    .filter((token) => {
      const key = anchorKey(token);
      return key >= low && key <= high;
    })
    .sort((a, b) => anchorKey(a) - anchorKey(b));
  return { preserveReadingOrder: false, tokens: withoutCrossPageRunningMatter(root, selectedTokens, start, end) };
}

function withoutCrossPageRunningMatter(root: HTMLElement, tokens: PdfWordToken[], start: PdfWordAnchor, end: PdfWordAnchor): PdfWordToken[] {
  if (start.pageNumber === end.pageNumber) return tokens;
  const endPageHeight = end.layer.getBoundingClientRect().height;
  const endIsInHeader = endPageHeight > 0 && end.top + end.height / 2 <= endPageHeight * 0.085;
  const repeatedHeaders = repeatedTopMarginLines(root);
  const excluded = new Set<PdfWordToken>();
  const tokensByPage = new Map<number, PdfWordToken[]>();
  for (const token of tokens) {
    const pageTokens = tokensByPage.get(token.pageNumber) ?? [];
    pageTokens.push(token);
    tokensByPage.set(token.pageNumber, pageTokens);
  }
  for (const [pageNumber, pageTokens] of tokensByPage) {
    const pageHeight = pageTokens[0]?.layer.getBoundingClientRect().height ?? 0;
    if (pageHeight <= 0) continue;
    for (const line of groupTokensIntoLines(pageTokens)) {
      const text = lineText(line);
      const centerY = line.reduce((sum, token) => sum + token.top + token.height / 2, 0) / line.length;
      const isHeader = pageNumber > start.pageNumber
        && !(pageNumber === end.pageNumber && endIsInHeader)
        && centerY <= pageHeight * 0.095
        && isRunningHeaderLine(text, repeatedHeaders);
      const isFooterPageNumber = pageNumber < end.pageNumber
        && centerY >= pageHeight * 0.92
        && /^(?:page\s*)?(?:\d{1,4}|[ivxlcdm]{1,8})$/i.test(text.trim());
      if (isHeader || isFooterPageNumber) line.forEach((token) => excluded.add(token));
    }
  }
  return tokens.filter((token) => !excluded.has(token));
}

function repeatedTopMarginLines(root: HTMLElement): Set<string> {
  const pagesBySignature = new Map<string, Set<number>>();
  for (const layer of Array.from(root.querySelectorAll<HTMLElement>('.textLayer'))) {
    const pageHeight = layer.getBoundingClientRect().height;
    const pageNumber = Number(layer.dataset.pageNumber);
    if (pageHeight <= 0 || !Number.isInteger(pageNumber)) continue;
    for (const line of groupTokensIntoLines(wordTokensForLayer(layer))) {
      const centerY = line.reduce((sum, token) => sum + token.top + token.height / 2, 0) / line.length;
      if (centerY > pageHeight * 0.095) continue;
      const signature = runningMatterSignature(lineText(line));
      if (!signature) continue;
      const pages = pagesBySignature.get(signature) ?? new Set<number>();
      pages.add(pageNumber);
      pagesBySignature.set(signature, pages);
    }
  }
  return new Set(Array.from(pagesBySignature, ([signature, pages]) => pages.size >= 2 ? signature : '').filter(Boolean));
}

function isRunningHeaderLine(text: string, repeatedHeaders: Set<string>): boolean {
  const normalized = text.trim();
  if (!normalized || normalized.length > 220) return false;
  const signature = runningMatterSignature(normalized);
  if (repeatedHeaders.has(signature)) return true;
  return /\b(?:vol(?:ume)?|issue|journal|doi|issn)\b/i.test(normalized)
    || /(?:©|copyright)/i.test(normalized)
    || /\b(?:19|20)\d{2}\b.*\b(?:vol(?:ume)?|issue)\b/i.test(normalized);
}

function runningMatterSignature(text: string): string {
  return text
    .toLocaleLowerCase()
    .replace(/\b(?:page\s*)?\d{1,4}\b/g, '#')
    .replace(/[\s\p{P}\p{S}]+/gu, ' ')
    .trim();
}

function tokensBetweenOnPage(
  tokens: PdfWordToken[],
  anchor: PdfWordAnchor,
  focus: PdfWordAnchor,
  columnMode: PdfColumnMode,
): SnappedTokenSelection {
  const [start, end] = compareVisualPosition(anchor, focus) <= 0 ? [anchor, focus] : [focus, anchor];
  const startCenterY = start.top + start.height / 2;
  const endCenterY = end.top + end.height / 2;
  const startCenterX = start.left + start.width / 2;
  const endCenterX = end.left + end.width / 2;
  const anchorCenterX = anchor.left + anchor.width / 2;
  const lineTolerance = Math.max(start.height, end.height) * 0.55;
  const sameLine = Math.abs(startCenterY - endCenterY) <= lineTolerance;
  const pageWidth = start.layer.getBoundingClientRect().width;
  const columnGutter = columnGutterAt(tokens, pageWidth, anchor.top + anchor.height / 2, columnMode);
  const anchorIsLeftColumn = columnGutter !== null && anchorCenterX < columnGutter;
  const focusCenterX = focus.left + focus.width / 2;
  const focusIsLeftColumn = columnGutter !== null && focusCenterX < columnGutter;

  // Crossing the gutter is an explicit request to continue in publication
  // reading order: finish the left column, then continue at the right column's
  // top. A vertical drag that stays in one column remains locked to that column.
  if (columnGutter !== null && anchorIsLeftColumn !== focusIsLeftColumn) {
    const ordered = tokensInPageReadingOrder(tokens, columnGutter);
    const anchorIndex = ordered.findIndex((token) => token.index === anchor.index);
    const focusIndex = ordered.findIndex((token) => token.index === focus.index);
    if (anchorIndex >= 0 && focusIndex >= 0) {
      const low = Math.min(anchorIndex, focusIndex);
      const high = Math.max(anchorIndex, focusIndex);
      return { preserveReadingOrder: true, tokens: ordered.slice(low, high + 1) };
    }
  }

  return { preserveReadingOrder: false, tokens: tokens.filter((token) => {
    const centerY = token.top + token.height / 2;
    const centerX = token.left + token.width / 2;
    if (centerY < startCenterY - lineTolerance || centerY > endCenterY + lineTolerance) return false;
    // PDF text layers expose both columns as one page-wide stream. Once a drag
    // crosses the gutter, keeping both columns produces an interleaved, unusable
    // selection. Treat the column containing the pointer-down word as the scope.
    if (columnGutter !== null && (centerX < columnGutter) !== anchorIsLeftColumn) return false;
    const onStartLine = Math.abs(centerY - startCenterY) <= Math.max(lineTolerance, token.height * 0.55);
    const onEndLine = Math.abs(centerY - endCenterY) <= Math.max(lineTolerance, token.height * 0.55);
    if (sameLine) return centerX >= Math.min(startCenterX, endCenterX) - 1 && centerX <= Math.max(startCenterX, endCenterX) + 1;
    if (onStartLine && centerX < startCenterX - 1) return false;
    if (onEndLine && centerX > endCenterX + 1) return false;
    return true;
  }).sort(compareVisualPosition) };
}

function tokensInPageReadingOrder(tokens: PdfWordToken[], columnGutter: number): PdfWordToken[] {
  const pageHeight = tokens[0]?.layer.getBoundingClientRect().height ?? 0;
  const topMatter: PdfWordToken[] = [];
  const leftBody: PdfWordToken[] = [];
  const rightBody: PdfWordToken[] = [];
  const bottomMatter: PdfWordToken[] = [];
  for (const token of tokens) {
    const centerY = token.top + token.height / 2;
    const centerX = token.left + token.width / 2;
    if (pageHeight > 0 && centerY <= pageHeight * 0.08) topMatter.push(token);
    else if (pageHeight > 0 && centerY >= pageHeight * 0.92) bottomMatter.push(token);
    else if (centerX < columnGutter) leftBody.push(token);
    else rightBody.push(token);
  }
  return [
    ...topMatter.sort(compareVisualPosition),
    ...leftBody.sort(compareVisualPosition),
    ...rightBody.sort(compareVisualPosition),
    ...bottomMatter.sort(compareVisualPosition),
  ];
}

function textForLayerInReadingOrder(layer: HTMLElement, reference: PdfWordAnchor, columnMode: PdfColumnMode): string {
  const tokens = wordTokensForLayer(layer);
  const pageWidth = layer.getBoundingClientRect().width;
  const gutter = columnGutterAt(tokens, pageWidth, reference.top + reference.height / 2, columnMode);
  if (gutter === null) return textForLayer(layer);
  return normalizeText(textFromTokens(tokensInPageReadingOrder(tokens, gutter), true));
}

function anchorKey(anchor: PdfWordAnchor): number {
  return anchor.pageNumber * 1_000_000 + anchor.index;
}

function groupTokensIntoLines(tokens: PdfWordToken[], preserveReadingOrder = false): PdfWordToken[][] {
  const lines: PdfWordToken[][] = [];
  const orderedTokens = preserveReadingOrder ? tokens : [...tokens].sort(compareVisualPosition);
  for (const token of orderedTokens) {
    const previousLine = lines.at(-1);
    const representative = previousLine?.[0];
    if (!representative || Math.abs((representative.top + representative.height / 2) - (token.top + token.height / 2)) > Math.max(3, Math.min(representative.height, token.height) * 0.45)) {
      lines.push([token]);
    } else {
      previousLine.push(token);
    }
  }
  return lines;
}

function isParagraphBoundary(previousLine: PdfWordToken[], currentLine: PdfWordToken[]): boolean {
  const previous = previousLine[0];
  const current = currentLine[0];
  if (previous.pageNumber !== current.pageNumber) return true;
  const previousBottom = Math.max(...previousLine.map((token) => token.top + token.height));
  const verticalGap = current.top - previousBottom;
  const lineHeight = Math.max(previous.height, current.height);
  const indented = current.left - previous.left > lineHeight * 0.9;
  return verticalGap > Math.max(4, lineHeight * 0.55) || indented;
}

function textFromTokens(tokens: PdfWordToken[], preserveReadingOrder = false): string {
  const lines = groupTokensIntoLines(tokens, preserveReadingOrder);
  return lines.reduce((text, line, index) => {
    if (index === 0) return lineText(line);
    const previousLine = lines[index - 1];
    const wrapsToNextColumn = preserveReadingOrder
      && previousLine[0]?.pageNumber === line[0]?.pageNumber
      && lineCenterY(line) < lineCenterY(previousLine) - Math.max(lineHeight(previousLine), lineHeight(line)) * 2;
    const separator = wrapsToNextColumn && continuesAcrossPage(previousLine, line)
      ? ' '
      : isParagraphBoundary(previousLine, line) ? '\n\n' : ' ';
    return `${text}${separator}${lineText(line)}`;
  }, '').replace(/\s+([,.;:!?%)\]}])/g, '$1').replace(/([([{])\s+/g, '$1').trim();
}

function lineText(line: PdfWordToken[]): string {
  const sorted = [...line].sort((a, b) => a.left - b.left);
  return sorted.reduce((text, token, index) => {
    if (index === 0) return token.text;
    const previous = sorted[index - 1];
    const gap = token.left - (previous.left + previous.width);
    const touches = gap <= Math.max(1.5, Math.min(previous.height, token.height) * 0.16);
    const punctuation = /^[,.;:!?%)\]}]/.test(token.text) || /[(\[{]$/.test(previous.text);
    return `${text}${touches || punctuation ? '' : ' '}${token.text}`;
  }, '');
}

function anchorForToken(token: PdfWordToken): PdfWordAnchor {
  return {
    height: token.height,
    index: token.index,
    layer: token.layer,
    left: token.left,
    pageNumber: token.pageNumber,
    top: token.top,
    width: token.width,
  };
}

function compareVisualPosition(a: PdfWordAnchor, b: PdfWordAnchor): number {
  if (a.pageNumber !== b.pageNumber) return a.pageNumber - b.pageNumber;
  const sameLine = Math.abs((a.top + a.height / 2) - (b.top + b.height / 2)) <= Math.max(3, Math.min(a.height, b.height) * 0.45);
  return sameLine ? a.left - b.left : a.top - b.top;
}

function pageUsesTwoColumns(tokens: PdfWordToken[], pageWidth: number): boolean {
  return detectColumnGutter(tokens, pageWidth) !== null;
}

function columnGutterAt(
  tokens: PdfWordToken[],
  pageWidth: number,
  anchorY: number,
  columnMode: PdfColumnMode,
): number | null {
  if (columnMode === 'single') return null;
  if (columnMode === 'double') return pageWidth / 2;
  return detectColumnGutter(tokens, pageWidth, anchorY);
}

interface ColumnGapCandidate {
  center: number;
  leftEnd: number;
  rightStart: number;
  y: number;
}

interface DetectedColumnLayout {
  evidenceY: number[];
  gutter: number;
}

function detectColumnGutter(tokens: PdfWordToken[], pageWidth: number, anchorY?: number): number | null {
  if (tokens.length < 40 || pageWidth < 300) return null;
  const pageHeight = tokens[0]?.layer.getBoundingClientRect().height ?? 0;
  const bodyTokens = tokens.filter((token) => token.top > pageHeight * 0.08 && token.top < pageHeight * 0.92);
  const lines = groupTokensIntoLines(bodyTokens);
  if (lines.length < 6) return null;
  const typicalLineHeight = median(lines.map(lineHeight));
  const pageLayout = detectedPageColumnLayout(tokens, lines, pageWidth, typicalLineHeight);
  if (anchorY === undefined) return pageLayout?.gutter ?? null;

  const anchorLine = lines.reduce((closest, line) => (
    Math.abs(lineCenterY(line) - anchorY) < Math.abs(lineCenterY(closest) - anchorY) ? line : closest
  ));

  // Establish the page's columns once, then only decide whether the exact row
  // under the pointer is a full-width exception. This keeps titles, figures and
  // short lines from making the same page switch layout during a drag.
  if (pageLayout) {
    const evidenceStart = Math.min(...pageLayout.evidenceY);
    const evidenceEnd = Math.max(...pageLayout.evidenceY);
    const regionPadding = Math.max(pageHeight * 0.06, typicalLineHeight * 6);
    if (anchorY < evidenceStart - regionPadding || anchorY > evidenceEnd + regionPadding) return null;
    return lineFlowsThroughPosition(anchorLine, pageLayout.gutter, pageWidth)
      ? null
      : pageLayout.gutter;
  }

  // Pages dominated by a full-width figure or table can lack enough global
  // evidence. Fall back to a local region only when no page-level model exists.
  const localRadius = Math.max(pageHeight * 0.18, typicalLineHeight * 10);
  const scopedLines = lines.filter((line) => Math.abs(lineCenterY(line) - anchorY) <= localRadius);
  const localLayout = inferColumnLayout(scopedLines, pageWidth, typicalLineHeight);
  if (!localLayout || lineFlowsThroughPosition(anchorLine, localLayout.gutter, pageWidth)) return null;
  const closestEvidence = Math.min(...localLayout.evidenceY.map((y) => Math.abs(y - anchorY)));
  if (closestEvidence > Math.max(typicalLineHeight * 4.5, localRadius * 0.42)) return null;
  return localLayout.gutter;
}

function detectedPageColumnLayout(
  tokens: PdfWordToken[],
  lines: PdfWordToken[][],
  pageWidth: number,
  typicalLineHeight: number,
): DetectedColumnLayout | null {
  const layer = tokens[0]?.layer;
  if (!layer) return null;
  const cached = pageColumnLayoutCache.get(layer);
  if (cached && Math.abs(cached.pageWidth - pageWidth) < 0.5) return cached.layout;
  const layout = inferColumnLayout(lines, pageWidth, typicalLineHeight);
  pageColumnLayoutCache.set(layer, { layout, pageWidth });
  return layout;
}

function inferColumnLayout(
  lines: PdfWordToken[][],
  pageWidth: number,
  typicalLineHeight: number,
): DetectedColumnLayout | null {
  const substantiveLines = lines.filter((line) => line.length >= 6 && lineWidth(line) >= pageWidth * 0.48);
  if (substantiveLines.length < 5) return null;
  const candidates = substantiveLines
    .map((line) => centralGapForLine(line, pageWidth))
    .filter((candidate): candidate is ColumnGapCandidate => candidate !== null);
  if (candidates.length < 3) return null;

  const medianCenter = median(candidates.map((candidate) => candidate.center));
  const centerTolerance = Math.max(pageWidth * 0.024, typicalLineHeight * 1.4);
  const stable = candidates.filter((candidate) => Math.abs(candidate.center - medianCenter) <= centerTolerance);
  if (stable.length < 3) return null;

  const fullWidthLines = substantiveLines.filter((line) => isFullWidthFlowLine(line, pageWidth));
  if (stable.length / (stable.length + fullWidthLines.length) < 0.58) return null;

  // Real columns leave a shared empty corridor. Random large spaces within a
  // sentence do not normally overlap at the same horizontal position for rows.
  const corridorLeft = Math.max(...stable.map((candidate) => candidate.leftEnd));
  const corridorRight = Math.min(...stable.map((candidate) => candidate.rightStart));
  if (corridorRight - corridorLeft < pageWidth * 0.012) return null;
  return {
    evidenceY: stable.map((candidate) => candidate.y),
    gutter: (corridorLeft + corridorRight) / 2,
  };
}

function centralGapForLine(line: PdfWordToken[], pageWidth: number): ColumnGapCandidate | null {
  const sorted = [...line].sort((a, b) => a.left - b.left);
  const first = sorted[0];
  const last = sorted.at(-1);
  if (!first || !last) return null;
  const lineLeft = first.left;
  const lineRight = last.left + last.width;
  if (lineRight - lineLeft < pageWidth * 0.48) return null;
  // IEEE and ACM layouts often use a narrow 10-14 pt gutter. At normal page
  // scale that is only about 2% of the page width, so a percentage-only
  // threshold confuses the two columns with one continuous line. A real gutter
  // still remains noticeably wider than an ordinary word space and repeats at
  // the same horizontal position on many rows.
  const minimumGutter = Math.max(pageWidth * 0.008, lineHeight(line) * 0.62);
  let best: ColumnGapCandidate | null = null;
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1];
    const current = sorted[index];
    const leftEnd = previous.left + previous.width;
    const rightStart = current.left;
    const gap = rightStart - leftEnd;
    const center = (leftEnd + rightStart) / 2;
    if (gap < minimumGutter || center < pageWidth * 0.42 || center > pageWidth * 0.58) continue;
    if (leftEnd - lineLeft < pageWidth * 0.15 || lineRight - rightStart < pageWidth * 0.15) continue;
    const candidate = {
      center,
      leftEnd,
      rightStart,
      y: (lineCenterY(line) + previous.top + previous.height / 2 + current.top + current.height / 2) / 3,
    };
    if (!best || gap - Math.abs(center - pageWidth / 2) > (best.rightStart - best.leftEnd) - Math.abs(best.center - pageWidth / 2)) best = candidate;
  }
  return best;
}

function isFullWidthFlowLine(line: PdfWordToken[], pageWidth: number): boolean {
  if (line.length < 6) return false;
  const sorted = [...line].sort((a, b) => a.left - b.left);
  const first = sorted[0];
  const last = sorted.at(-1);
  if (!first || !last) return false;
  const right = last.left + last.width;
  return first.left < pageWidth * 0.43
    && right > pageWidth * 0.57
    && right - first.left >= pageWidth * 0.48
    && lineFlowsThroughPosition(line, pageWidth / 2, pageWidth);
}

function lineFlowsThroughPosition(line: PdfWordToken[], position: number, pageWidth: number): boolean {
  const sorted = [...line].sort((a, b) => a.left - b.left);
  const coveringToken = sorted.find((token) => token.left <= position && token.left + token.width >= position);
  if (coveringToken) return true;
  const leftToken = [...sorted].reverse().find((token) => token.left + token.width < position);
  const rightToken = sorted.find((token) => token.left > position);
  if (!leftToken || !rightToken) return false;
  const gap = rightToken.left - (leftToken.left + leftToken.width);
  const normalWordGap = Math.max(pageWidth * 0.005, Math.max(leftToken.height, rightToken.height) * 0.45);
  return gap <= normalWordGap;
}

function lineCenterY(line: PdfWordToken[]): number {
  return line.reduce((sum, token) => sum + token.top + token.height / 2, 0) / Math.max(line.length, 1);
}

function lineHeight(line: PdfWordToken[]): number {
  return Math.max(...line.map((token) => token.height), 1);
}

function lineWidth(line: PdfWordToken[]): number {
  const sorted = [...line].sort((a, b) => a.left - b.left);
  const first = sorted[0];
  const last = sorted.at(-1);
  return first && last ? last.left + last.width - first.left : 0;
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function distanceToRect(x: number, y: number, rect: DOMRect): number {
  const dx = Math.max(rect.left - x, 0, x - rect.right);
  const dy = Math.max(rect.top - y, 0, y - rect.bottom);
  return dx * dx + dy * dy;
}

function distanceToToken(x: number, y: number, token: PdfWordToken): number {
  const dx = Math.max(token.left - x, 0, x - token.left - token.width);
  const dy = Math.max(token.top - y, 0, y - token.top - token.height);
  return dx * dx + dy * dy;
}

export function readPdfSelection(selection: Selection | null, root?: HTMLElement): TextSelection | null {
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;

  const range = selection.getRangeAt(0);
  const startLayer = elementForNode(range.startContainer)?.closest<HTMLElement>('.textLayer');
  const endLayer = elementForNode(range.endContainer)?.closest<HTMLElement>('.textLayer');
  if (!startLayer || !endLayer) return null;
  if (root && (!root.contains(startLayer) || !root.contains(endLayer))) return null;

  const selectedText = normalizeSelectedText(selection.toString());
  if (selectedText.length < 2) return null;

  const pageNumber = Number(startLayer.dataset.pageNumber);
  if (!Number.isInteger(pageNumber) || pageNumber < 1) return null;

  const startPageText = textForLayer(startLayer);
  const endPageText = startLayer === endLayer ? '' : textForLayer(endLayer);
  const pageText = normalizeText(`${startPageText} ${endPageText}`);
  const selectedTextForSearch = normalizeText(selectedText);
  const selectedIndex = pageText.toLocaleLowerCase().indexOf(selectedTextForSearch.toLocaleLowerCase());
  const contextStart = selectedIndex >= 0 ? Math.max(0, selectedIndex - CONTEXT_RADIUS) : 0;
  const contextEnd = selectedIndex >= 0
    ? Math.min(pageText.length, selectedIndex + selectedTextForSearch.length + CONTEXT_RADIUS)
    : Math.min(pageText.length, CONTEXT_RADIUS * 2);

  return {
    id: crypto.randomUUID(),
    selectedText,
    surroundingText: pageText.slice(contextStart, contextEnd),
    pageNumber,
    timestamp: Date.now(),
  };
}

export function readSelectionHighlights(selection: Selection | null, root: HTMLElement): SelectionHighlight[] {
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return [];
  const range = selection.getRangeAt(0);
  const startLayer = elementForNode(range.startContainer)?.closest<HTMLElement>('.textLayer');
  const endLayer = elementForNode(range.endContainer)?.closest<HTMLElement>('.textLayer');
  if (!startLayer || !endLayer || !root.contains(startLayer) || !root.contains(endLayer)) return [];

  const pageShells = Array.from(root.querySelectorAll<HTMLElement>('.pdf-page-shell'));
  const byPage = new Map<number, SelectionHighlight['rects']>();
  for (const clientRect of Array.from(range.getClientRects())) {
    if (clientRect.width < 1 || clientRect.height < 1) continue;
    const pageShell = pageShells.find((shell) => {
      const bounds = shell.getBoundingClientRect();
      const centerX = clientRect.left + clientRect.width / 2;
      const centerY = clientRect.top + clientRect.height / 2;
      return centerX >= bounds.left && centerX <= bounds.right && centerY >= bounds.top && centerY <= bounds.bottom;
    });
    if (!pageShell) continue;
    const pageNumber = Number(pageShell.dataset.pageNumber);
    if (!Number.isInteger(pageNumber)) continue;
    const pageBounds = pageShell.getBoundingClientRect();
    const left = Math.max(clientRect.left, pageBounds.left);
    const right = Math.min(clientRect.right, pageBounds.right);
    const top = Math.max(clientRect.top, pageBounds.top);
    const bottom = Math.min(clientRect.bottom, pageBounds.bottom);
    const rect = { left: left - pageBounds.left, top: top - pageBounds.top, width: right - left, height: bottom - top };
    if (!isPlausibleTextRect(rect, pageBounds)) continue;
    const pageRects = byPage.get(pageNumber) ?? [];
    pageRects.push(rect);
    byPage.set(pageNumber, pageRects);
  }

  return Array.from(byPage, ([pageNumber, rects]) => ({ pageNumber, rects: mergeLineRects(rects) }));
}

function isPlausibleTextRect(
  rect: { height: number; left: number; top: number; width: number },
  pageBounds: DOMRect,
): boolean {
  if (rect.width < 1 || rect.height < 1) return false;
  const pageArea = pageBounds.width * pageBounds.height;
  const looksLikeContainer = rect.height > Math.max(72, pageBounds.height * 0.12)
    || rect.width * rect.height > pageArea * 0.06;
  return !looksLikeContainer;
}

function mergeLineRects(
  rects: SelectionHighlight['rects'],
  columnGutter: number | null = null,
): SelectionHighlight['rects'] {
  const lines: Array<SelectionHighlight['rects']> = [];
  const verticallySorted = [...rects].sort((a, b) => (
    a.top + a.height / 2 - (b.top + b.height / 2) || a.left - b.left
  ));
  for (const rect of verticallySorted) {
    const line = lines.at(-1);
    const representative = line?.[0];
    const sameLine = representative
      && Math.abs(
        representative.top + representative.height / 2 - (rect.top + rect.height / 2),
      ) <= Math.max(3, Math.min(representative.height, rect.height) * 0.35);
    if (line && sameLine) line.push(rect);
    else lines.push([rect]);
  }

  const merged: SelectionHighlight['rects'] = [];
  for (const line of lines) {
    let previous: SelectionHighlight['rects'][number] | undefined;
    for (const rect of [...line].sort((a, b) => a.left - b.left)) {
      if (!previous) {
        merged.push(rect);
        previous = rect;
        continue;
      }
      const gap = rect.left - (previous.left + previous.width);
      const maximumWordGap = Math.max(2, Math.min(previous.height, rect.height) * 0.55);
      const crossesColumnGutter = columnGutter !== null
        && (previous.left + previous.width / 2 < columnGutter) !== (rect.left + rect.width / 2 < columnGutter);
      if (gap > maximumWordGap || crossesColumnGutter) {
        merged.push(rect);
        previous = rect;
        continue;
      }
      const right = Math.max(previous.left + previous.width, rect.left + rect.width);
      const bottom = Math.max(previous.top + previous.height, rect.top + rect.height);
      previous.left = Math.min(previous.left, rect.left);
      previous.top = Math.min(previous.top, rect.top);
      previous.width = right - previous.left;
      previous.height = bottom - previous.top;
    }
  }
  return merged;
}
