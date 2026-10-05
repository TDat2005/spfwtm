import { Banner, Spinner, Stack, Text } from "@shopify/polaris";
import { useEffect, useState } from "react";
import {
  logoOverlaySize,
  overlayPlacements,
  rotatedOverlaySize,
  textOverlayMetrics,
  type OverlaySize,
} from "../../src/modules/watermark/domain/WatermarkGeometry.ts";

export interface WatermarkStyle {
  watermarkType: "TEXT" | "IMAGE";
  text: string;
  logoUrl: string;
  position: string;
  opacity: number;
  layout: "SINGLE" | "TILED";
  logoScale: number;
  rotation: number;
  offsetX: number;
  offsetY: number;
  fontFamily: string;
  fontSize: number;
  textColor: string;
  strokeColor: string;
  strokeWidth: number;
}

interface WatermarkPreviewProps {
  imageUrl: string | null;
  productTitle?: string;
  style: WatermarkStyle;
  showWatermark?: boolean;
}

type LoadedImage =
  | { status: "idle" | "loading" | "error" }
  | { status: "loaded"; size: OverlaySize };

export function WatermarkPreview({
  imageUrl,
  productTitle,
  style,
  showWatermark = true,
}: WatermarkPreviewProps) {
  const image = useImageSize(imageUrl);
  const debouncedLogoUrl = useDebounced(style.logoUrl.trim(), 400);
  const logo = useImageSize(
    style.watermarkType === "IMAGE" && debouncedLogoUrl ? debouncedLogoUrl : null
  );

  if (!imageUrl) {
    return (
      <div
        style={{
          width: "100%",
          maxWidth: "420px",
          height: "360px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "var(--p-surface-neutral-subdued, #f6f6f7)",
          border: "1px dashed var(--p-border-subdued, #e1e3e5)",
          borderRadius: "8px",
          padding: "16px",
          boxSizing: "border-box",
        }}
      >
        <Text as="p" variant="bodyMd" color="subdued">
          Chọn một sản phẩm có ảnh để xem trước watermark.
        </Text>
      </div>
    );
  }

  if (image.status === "error") {
    return (
      <div style={{ maxWidth: "420px" }}>
        <Banner status="warning" title="Không tải được ảnh sản phẩm để xem trước" />
      </div>
    );
  }

  if (image.status !== "loaded") {
    return (
      <div
        style={{
          width: "100%",
          maxWidth: "420px",
          height: "360px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "var(--p-surface-neutral-subdued, #f6f6f7)",
          border: "1px solid var(--p-border-subdued, #e1e3e5)",
          borderRadius: "8px",
          boxSizing: "border-box",
        }}
      >
        <Spinner accessibilityLabel="Đang tải ảnh xem trước" size="large" />
      </div>
    );
  }

  const { width, height } = image.size;
  const overlay = showWatermark
    ? buildOverlay(style, width, logo, debouncedLogoUrl)
    : null;

  return (
    <Stack vertical spacing="tight">
      <div
        style={{
          width: "100%",
          maxWidth: "420px",
          height: "360px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "var(--p-surface-neutral-subdued, #f6f6f7)",
          border: "1px solid var(--p-border-subdued, #e1e3e5)",
          borderRadius: "8px",
          overflow: "hidden",
          boxSizing: "border-box",
          padding: "12px",
        }}
      >
        <svg
          viewBox={`0 0 ${width} ${height}`}
          style={{
            maxWidth: "100%",
            maxHeight: "100%",
            width: "auto",
            height: "auto",
            aspectRatio: `${width} / ${height}`,
            display: "block",
            borderRadius: "4px",
            boxShadow: "0 1px 3px rgba(0, 0, 0, 0.12)",
          }}
          role="img"
          aria-label={`Xem trước watermark trên ${productTitle ?? "ảnh sản phẩm"}`}
        >
          <image href={imageUrl} width={width} height={height} />
          {overlay &&
            overlayPlacements(style.layout, width, height, overlay.bounds, style).map(
              ({ left, top }) => (
                <svg
                  key={`${left}-${top}`}
                  x={left}
                  y={top}
                  width={overlay.bounds.width}
                  height={overlay.bounds.height}
                  overflow="hidden"
                >
                  <g
                    transform={`translate(${overlay.bounds.width / 2} ${overlay.bounds.height / 2}) rotate(${style.rotation}) translate(${-overlay.content.width / 2} ${-overlay.content.height / 2})`}
                  >
                    {overlay.render()}
                  </g>
                </svg>
              )
            )}
        </svg>
      </div>
      <Text as="p" variant="bodySm" color="subdued">
        {productTitle ? `${productTitle} · ` : ""}
        {width}×{height}px
      </Text>
      {style.watermarkType === "IMAGE" && logo.status === "error" && (
        <Banner status="warning" title="Không tải được logo từ URL này" />
      )}
    </Stack>
  );
}

function buildOverlay(
  style: WatermarkStyle,
  imageWidth: number,
  logo: LoadedImage,
  logoUrl: string
) {
  if (style.watermarkType === "TEXT") {
    const text = style.text.trim() ? style.text : "";
    if (!text) return null;
    const metrics = textOverlayMetrics(
      text,
      style.fontSize,
      style.strokeWidth,
      imageWidth
    );
    return {
      content: metrics,
      bounds: rotatedOverlaySize(metrics, style.rotation),
      render: () => (
        <svg width={metrics.width} height={metrics.height} overflow="hidden">
          <text
            x="50%"
            y="50%"
            dominantBaseline="middle"
            textAnchor="middle"
            fontFamily={`${style.fontFamily}, sans-serif`}
            fontSize={metrics.fontSize}
            fontWeight={700}
            fill={style.textColor}
            fillOpacity={style.opacity}
            stroke={style.strokeColor}
            strokeOpacity={style.opacity}
            strokeWidth={style.strokeWidth}
          >
            {text}
          </text>
        </svg>
      ),
    };
  }

  if (logo.status !== "loaded") return null;
  const size = logoOverlaySize(logo.size, style.logoScale, imageWidth);
  return {
    content: size,
    bounds: rotatedOverlaySize(size, style.rotation),
    render: () => (
      <image
        href={logoUrl}
        width={size.width}
        height={size.height}
        opacity={style.opacity}
        preserveAspectRatio="none"
      />
    ),
  };
}

function useImageSize(url: string | null): LoadedImage {
  const [state, setState] = useState<LoadedImage>({ status: "idle" });

  useEffect(() => {
    if (!url) {
      setState({ status: "idle" });
      return;
    }
    let active = true;
    setState({ status: "loading" });
    const element = new Image();
    element.onload = () => {
      if (!active) return;
      setState(
        element.naturalWidth > 0
          ? {
              status: "loaded",
              size: { width: element.naturalWidth, height: element.naturalHeight },
            }
          : { status: "error" }
      );
    };
    element.onerror = () => active && setState({ status: "error" });
    element.src = url;
    return () => {
      active = false;
      element.onload = null;
      element.onerror = null;
    };
  }, [url]);

  return state;
}

function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}
