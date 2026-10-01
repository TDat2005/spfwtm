export interface OverlaySize {
  width: number;
  height: number;
}

export interface OverlayPlacement {
  left: number;
  top: number;
}

export interface PlacementOptions {
  position: string;
  offsetX: number;
  offsetY: number;
}

export interface TextOverlayMetrics extends OverlaySize {
  fontSize: number;
}

export function textOverlayMetrics(
  text: string,
  fontSizeRatio: number,
  strokeWidth: number,
  imageWidth: number
): TextOverlayMetrics {
  const fontSize = Math.max(12, Math.round(imageWidth * fontSizeRatio));
  const padding = Math.max(10, Math.round(fontSize * 0.6));
  const width = Math.min(
    Math.round(imageWidth * 0.92),
    Math.max(120, Math.round(text.length * fontSize * 0.68 + padding * 2))
  );
  const height = fontSize + padding * 2 + Math.ceil(strokeWidth * 2);
  return { fontSize, width, height };
}

export function logoOverlaySize(
  logo: OverlaySize,
  logoScale: number,
  imageWidth: number
): OverlaySize {
  const targetWidth = Math.max(32, Math.round(imageWidth * logoScale));
  const width = Math.min(targetWidth, logo.width);
  return {
    width,
    height: Math.max(1, Math.round((logo.height * width) / logo.width)),
  };
}

export function rotatedOverlaySize(size: OverlaySize, rotation: number): OverlaySize {
  const radians = (rotation * Math.PI) / 180;
  const cos = Math.abs(Math.cos(radians));
  const sin = Math.abs(Math.sin(radians));
  return {
    width: Math.round(size.width * cos + size.height * sin),
    height: Math.round(size.width * sin + size.height * cos),
  };
}

export function singlePosition(
  imageWidth: number,
  imageHeight: number,
  overlay: OverlaySize,
  options: PlacementOptions
): OverlayPlacement {
  const margin = Math.max(8, Math.round(Math.min(imageWidth, imageHeight) * 0.02));
  const horizontal = options.position.endsWith("LEFT")
    ? margin
    : options.position.endsWith("RIGHT")
      ? imageWidth - overlay.width - margin
      : Math.round((imageWidth - overlay.width) / 2);
  const vertical = options.position.startsWith("TOP")
    ? margin
    : options.position.startsWith("BOTTOM")
      ? imageHeight - overlay.height - margin
      : Math.round((imageHeight - overlay.height) / 2);

  return {
    left: clamp(
      horizontal + Math.round(options.offsetX * imageWidth),
      0,
      Math.max(0, imageWidth - overlay.width)
    ),
    top: clamp(
      vertical + Math.round(options.offsetY * imageHeight),
      0,
      Math.max(0, imageHeight - overlay.height)
    ),
  };
}

export function tiledPositions(
  imageWidth: number,
  imageHeight: number,
  overlay: OverlaySize,
  options: PlacementOptions
): OverlayPlacement[] {
  const stepX = overlay.width + Math.max(Math.round(overlay.width * 0.6), Math.round(imageWidth * 0.06));
  const stepY = overlay.height + Math.max(Math.round(overlay.height * 0.8), Math.round(imageHeight * 0.06));
  const shiftX = Math.round(options.offsetX * imageWidth);
  const shiftY = Math.round(options.offsetY * imageHeight);
  const result: OverlayPlacement[] = [];

  for (let top = -stepY + shiftY; top < imageHeight; top += stepY) {
    const row = Math.floor((top - shiftY) / stepY);
    const rowShift = Math.abs(row % 2) * Math.round(stepX / 2);
    for (
      let left = -stepX + shiftX + rowShift;
      left < imageWidth;
      left += stepX
    ) {
      if (
        left + overlay.width > 0 &&
        top + overlay.height > 0 &&
        left < imageWidth &&
        top < imageHeight
      ) {
        result.push({ left: Math.max(0, left), top: Math.max(0, top) });
      }
    }
  }
  return result;
}

export function overlayPlacements(
  layout: string,
  imageWidth: number,
  imageHeight: number,
  overlay: OverlaySize,
  options: PlacementOptions
): OverlayPlacement[] {
  return layout === "TILED"
    ? tiledPositions(imageWidth, imageHeight, overlay, options)
    : [singlePosition(imageWidth, imageHeight, overlay, options)];
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
