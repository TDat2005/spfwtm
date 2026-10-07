import { Banner, Spinner, Stack, Text } from "@shopify/polaris";
import { useEffect, useMemo, useState } from "react";
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

/** Một lớp watermark, cùng dạng với SerializedWatermarkLayer của backend. */
export interface PreviewLayer {
  enabled?: boolean;
  type: "TEXT" | "IMAGE";
  text: string | null;
  logoUrl: string | null;
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
  /** Các lớp theo thứ tự từ dưới lên. */
  layers?: PreviewLayer[];
  /** Cách dùng cũ: một cấu hình. */
  style?: WatermarkStyle;
  showWatermark?: boolean;
}

type LoadedImage =
  | { status: "idle" | "loading" | "error" }
  | { status: "loaded"; size: OverlaySize };

export function WatermarkPreview({
  imageUrl,
  productTitle,
  layers,
  style,
  showWatermark = true,
}: WatermarkPreviewProps) {
  const activeLayers = useMemo(
    () =>
      (layers ?? (style ? [{ ...style, type: style.watermarkType }] : [])).filter(
        (layer) => layer.enabled !== false
      ),
    [layers, style]
  );
  const image = useImageSize(imageUrl);
  const logoUrlsKey = activeLayers
    .flatMap((layer) =>
      layer.type === "IMAGE" && layer.logoUrl?.trim() ? [layer.logoUrl.trim()] : []
    )
    .join("\n");
  const debouncedLogoUrlsKey = useDebounced(logoUrlsKey, 400);
  const logos = useImageSizes(debouncedLogoUrlsKey);

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
  const overlays = showWatermark
    ? activeLayers.flatMap((layer, index) => {
        const overlay = buildOverlay(layer, width, logos);
        return overlay ? [{ layer, overlay, index }] : [];
      })
    : [];
  const failedLogo = activeLayers.some(
    (layer) =>
      layer.type === "IMAGE" &&
      layer.logoUrl &&
      logos.get(layer.logoUrl.trim())?.status === "error"
  );

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
          {overlays.map(({ layer, overlay, index }) =>
            overlayPlacements(layer.layout, width, height, overlay.bounds, layer).map(
              ({ left, top }) => (
                <svg
                  key={`${index}-${left}-${top}`}
                  x={left}
                  y={top}
                  width={overlay.bounds.width}
                  height={overlay.bounds.height}
                  overflow="hidden"
                >
                  <g
                    transform={`translate(${overlay.bounds.width / 2} ${overlay.bounds.height / 2}) rotate(${layer.rotation}) translate(${-overlay.content.width / 2} ${-overlay.content.height / 2})`}
                  >
                    {overlay.render()}
                  </g>
                </svg>
              )
            )
          )}
        </svg>
      </div>
      <Text as="p" variant="bodySm" color="subdued">
        {productTitle ? `${productTitle} · ` : ""}
        {width}×{height}px
      </Text>
      {failedLogo && (
        <Banner status="warning" title="Không tải được logo của một lớp" />
      )}
    </Stack>
  );
}

function buildOverlay(
  style: PreviewLayer,
  imageWidth: number,
  logos: ReadonlyMap<string, LoadedImage>
) {
  if (style.type === "TEXT") {
    const text = style.text?.trim() ? style.text : "";
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

  const logoUrl = style.logoUrl?.trim() ?? "";
  const logo = logos.get(logoUrl);
  if (!logo || logo.status !== "loaded") return null;
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

/** Kích thước của nhiều ảnh (logo), key là các URL nối bằng xuống dòng. */
function useImageSizes(urlsKey: string): ReadonlyMap<string, LoadedImage> {
  const [sizes, setSizes] = useState<ReadonlyMap<string, LoadedImage>>(new Map());

  useEffect(() => {
    const urls = [...new Set(urlsKey.split("\n").filter(Boolean))];
    let active = true;
    setSizes(new Map(urls.map((url) => [url, { status: "loading" as const }])));
    const elements = urls.map((url) => {
      const element = new Image();
      const update = (state: LoadedImage) => {
        if (!active) return;
        setSizes((current) => new Map(current).set(url, state));
      };
      element.onload = () =>
        update(
          element.naturalWidth > 0
            ? {
                status: "loaded",
                size: { width: element.naturalWidth, height: element.naturalHeight },
              }
            : { status: "error" }
        );
      element.onerror = () => update({ status: "error" });
      element.src = url;
      return element;
    });
    return () => {
      active = false;
      for (const element of elements) {
        element.onload = null;
        element.onerror = null;
      }
    };
  }, [urlsKey]);

  return sizes;
}

function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}
