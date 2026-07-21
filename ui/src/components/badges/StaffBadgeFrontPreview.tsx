import React from 'react';

type StaffBadgeFrontPreviewProps = {
  templateSrc: string;
  badgeName: string;
  prefixEmoji?: string | null;
  suffixEmoji?: string | null;
  placeholder?: string;
  maxWidth?: number | string;
  ariaLabel?: string;
};

const BADGE_TEMPLATE_VIEWBOX = {
  width: 545.27,
  height: 485.13,
};

const BADGE_FRONT_EXPORT_VIEWBOX = {
  x: 102.29,
  y: 0.12,
  width: 297.64,
  height: 419.53,
};

const BADGE_FRONT_LABEL_WIDTH = 272.18;
const BADGE_FRONT_LABEL_CENTER_X = 253.03;
const BADGE_FRONT_LABEL_CENTER_Y = 305.41;
const BADGE_FRONT_LABEL_MAX_TEXT_WIDTH = BADGE_FRONT_LABEL_WIDTH - 26;

const buildBadgeFontSize = (badgeName: string, prefixEmoji: string, suffixEmoji: string): number => {
  const units = badgeName.length * 1.2 + (prefixEmoji ? 3 : 0) + (suffixEmoji ? 3 : 0);
  if (units <= 7) {
    return 41;
  }
  if (units <= 10) {
    return 38;
  }
  if (units <= 13) {
    return 35;
  }
  if (units <= 16) {
    return 31;
  }
  return 27;
};

const getEmojiCodepointSlug = (emoji: string): string =>
  Array.from(emoji.trim())
    .map((symbol) => symbol.codePointAt(0)?.toString(16))
    .filter((value): value is string => Boolean(value))
    .join('-');

const getEmojiSrc = (emoji: string): string | null => {
  const slug = getEmojiCodepointSlug(emoji);
  return slug ? `https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/${slug}.svg` : null;
};

type BadgePreviewPiece =
  | {
      kind: 'emoji';
      value: string;
      x: number;
      y: number;
      size: number;
    }
  | {
      kind: 'name';
      value: string;
      x: number;
      y: number;
      width: number;
      fontSize: number;
    };

const buildBadgePreviewPieces = (
  badgeName: string,
  prefixEmoji: string,
  suffixEmoji: string,
): BadgePreviewPiece[] => {
  const fontSize = buildBadgeFontSize(badgeName, prefixEmoji, suffixEmoji);
  const naturalNameWidth = Math.max(badgeName.length * fontSize * 0.68, fontSize * 1.8);
  const naturalEmojiSize = fontSize * 0.98;
  const naturalGap = fontSize * 0.2;
  const totalNaturalWidth =
    naturalNameWidth +
    (prefixEmoji ? naturalEmojiSize : 0) +
    (suffixEmoji ? naturalEmojiSize : 0) +
    (prefixEmoji && badgeName ? naturalGap : 0) +
    (suffixEmoji && badgeName ? naturalGap : 0);
  const scale = Math.min(1, BADGE_FRONT_LABEL_MAX_TEXT_WIDTH / totalNaturalWidth);
  const scaledFontSize = fontSize * scale;
  const scaledNameWidth = naturalNameWidth * scale;
  const scaledEmojiSize = naturalEmojiSize * scale;
  const scaledGap = naturalGap * scale;
  const totalWidth =
    scaledNameWidth +
    (prefixEmoji ? scaledEmojiSize : 0) +
    (suffixEmoji ? scaledEmojiSize : 0) +
    (prefixEmoji && badgeName ? scaledGap : 0) +
    (suffixEmoji && badgeName ? scaledGap : 0);
  const pieces: BadgePreviewPiece[] = [];
  let cursorX = BADGE_FRONT_LABEL_CENTER_X - totalWidth / 2;

  if (prefixEmoji) {
    pieces.push({
      kind: 'emoji',
      value: prefixEmoji,
      x: cursorX,
      y: BADGE_FRONT_LABEL_CENTER_Y - scaledEmojiSize / 2,
      size: scaledEmojiSize,
    });
    cursorX += scaledEmojiSize;
    if (badgeName) {
      cursorX += scaledGap;
    }
  }

  pieces.push({
    kind: 'name',
    value: badgeName,
    x: cursorX + scaledNameWidth / 2,
    y: BADGE_FRONT_LABEL_CENTER_Y,
    width: scaledNameWidth,
    fontSize: scaledFontSize,
  });

  cursorX += scaledNameWidth;
  if (suffixEmoji && badgeName) {
    cursorX += scaledGap;
  }

  if (suffixEmoji) {
    pieces.push({
      kind: 'emoji',
      value: suffixEmoji,
      x: cursorX,
      y: BADGE_FRONT_LABEL_CENTER_Y - scaledEmojiSize / 2,
      size: scaledEmojiSize,
    });
  }

  return pieces;
};

export function StaffBadgeFrontPreview({
  templateSrc,
  badgeName,
  prefixEmoji,
  suffixEmoji,
  placeholder = 'Your badge name',
  maxWidth = 420,
  ariaLabel = 'Staff badge front preview',
}: StaffBadgeFrontPreviewProps) {
  const normalizedName = badgeName.trim() || placeholder;
  const normalizedPrefixEmoji = prefixEmoji?.trim() ?? '';
  const normalizedSuffixEmoji = suffixEmoji?.trim() ?? '';
  const pieces = buildBadgePreviewPieces(normalizedName, normalizedPrefixEmoji, normalizedSuffixEmoji);

  return (
    <svg
      aria-label={ariaLabel}
      role="img"
      viewBox={`${BADGE_FRONT_EXPORT_VIEWBOX.x} ${BADGE_FRONT_EXPORT_VIEWBOX.y} ${BADGE_FRONT_EXPORT_VIEWBOX.width} ${BADGE_FRONT_EXPORT_VIEWBOX.height}`}
      style={{
        display: 'block',
        width: '100%',
        maxWidth,
        height: 'auto',
        marginInline: 'auto',
        overflow: 'hidden',
      }}
    >
      <image
        href={templateSrc}
        x={0}
        y={0}
        width={BADGE_TEMPLATE_VIEWBOX.width}
        height={BADGE_TEMPLATE_VIEWBOX.height}
        preserveAspectRatio="xMinYMin meet"
      />
      <g aria-label="badge-print-name">
        {pieces.map((piece, index) => {
          if (piece.kind === 'emoji') {
            const src = getEmojiSrc(piece.value);
            return src ? (
              <image
                key={`${piece.kind}-${index}`}
                href={src}
                x={piece.x}
                y={piece.y}
                width={piece.size}
                height={piece.size}
                preserveAspectRatio="xMidYMid meet"
              />
            ) : null;
          }

          return (
            <text
              key={`${piece.kind}-${index}`}
              x={piece.x}
              y={piece.y}
              textAnchor="middle"
              dominantBaseline="middle"
              fontFamily="'Montserrat', sans-serif"
              fontSize={piece.fontSize}
              fontWeight={900}
              fill="#111111"
              textLength={piece.width}
              lengthAdjust="spacingAndGlyphs"
            >
              {piece.value}
            </text>
          );
        })}
      </g>
    </svg>
  );
}
