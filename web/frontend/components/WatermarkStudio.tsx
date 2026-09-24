import {
  Badge,
  Banner,
  Button,
  Card,
  DataTable,
  Form,
  FormLayout,
  RangeSlider,
  Select,
  Spinner,
  Stack,
  Text,
  TextField,
  Thumbnail,
} from "@shopify/polaris";
import { useAppBridge } from "@shopify/app-bridge-react";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";

interface ProductDto {
  id: string;
  title: string;
  status: "ACTIVE" | "DRAFT" | "ARCHIVED";
  imageUrl: string | null;
  imageAltText: string | null;
}

interface CatalogResponse {
  products: ProductDto[];
}

type WatermarkPosition =
  | "TOP_LEFT"
  | "TOP_CENTER"
  | "TOP_RIGHT"
  | "MIDDLE_LEFT"
  | "CENTER"
  | "MIDDLE_RIGHT"
  | "BOTTOM_LEFT"
  | "BOTTOM_CENTER"
  | "BOTTOM_RIGHT";

type WatermarkJobStatus =
  | "PENDING"
  | "PROCESSING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";

interface WatermarkJobDto {
  id: string;
  productId: string;
  watermarkType?: "TEXT" | "IMAGE";
  text: string | null;
  logoUrl: string | null;
  logoScale?: number;
  position: WatermarkPosition;
  opacity: number;
  layout: "SINGLE" | "TILED";
  rotation: number;
  offsetX: number;
  offsetY: number;
  fontFamily: string;
  fontSize: number;
  textColor: string;
  strokeColor: string;
  strokeWidth: number;
  status: WatermarkJobStatus;
  resultMediaId: string | null;
  resultUrl: string | null;
  errorMessage: string | null;
  createdAt: string;
}

interface JobsResponse {
  jobs: WatermarkJobDto[];
}

interface JobResponse {
  job: WatermarkJobDto;
}

interface PublishedMediaDto {
  id: string;
  watermarkJobId: string;
  productId: string;
  shopifyMediaId: string;
  imageUrl: string | null;
  createdAt: string;
}

interface PublicationsResponse {
  publications: PublishedMediaDto[];
}

interface PublicationResponse {
  publishedMedia: PublishedMediaDto;
}

const positionOptions = [
  { label: "Góc trên bên trái", value: "TOP_LEFT" },
  { label: "Phía trên chính giữa", value: "TOP_CENTER" },
  { label: "Góc trên bên phải", value: "TOP_RIGHT" },
  { label: "Chính giữa bên trái", value: "MIDDLE_LEFT" },
  { label: "Chính giữa", value: "CENTER" },
  { label: "Chính giữa bên phải", value: "MIDDLE_RIGHT" },
  { label: "Góc dưới bên trái", value: "BOTTOM_LEFT" },
  { label: "Phía dưới chính giữa", value: "BOTTOM_CENTER" },
  { label: "Góc dưới bên phải", value: "BOTTOM_RIGHT" },
];

const fontOptions = ["Arial", "Helvetica", "Georgia", "Times New Roman", "Courier New"].map(
  (font) => ({ label: font, value: font })
);

export function WatermarkStudio() {
  const shopify = useAppBridge();
  const queryClient = useQueryClient();
  const [productId, setProductId] = useState("");
  const [watermarkType, setWatermarkType] = useState<"TEXT" | "IMAGE">("TEXT");
  const [text, setText] = useState("© My shop");
  const [logoUrl, setLogoUrl] = useState("");
  const [logoScalePercent, setLogoScalePercent] = useState(20);
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);
  const [position, setPosition] = useState<WatermarkPosition>("BOTTOM_RIGHT");
  const [opacityPercent, setOpacityPercent] = useState(70);
  const [layout, setLayout] = useState<"SINGLE" | "TILED">("SINGLE");
  const [rotation, setRotation] = useState(0);
  const [offsetXPercent, setOffsetXPercent] = useState(0);
  const [offsetYPercent, setOffsetYPercent] = useState(0);
  const [fontFamily, setFontFamily] = useState("Arial");
  const [fontSizePercent, setFontSizePercent] = useState(4.5);
  const [textColor, setTextColor] = useState("#FFFFFF");
  const [strokeColor, setStrokeColor] = useState("#000000");
  const [strokeWidth, setStrokeWidth] = useState(2);
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);

  const catalog = useQuery<CatalogResponse, Error>(
    ["catalogProducts"],
    () => fetchJson<CatalogResponse>("/api/catalog/products"),
    { refetchOnWindowFocus: false }
  );

  const jobs = useQuery<JobsResponse, Error>(
    ["watermarkJobs"],
    () => fetchJson<JobsResponse>("/api/watermarks/jobs"),
    {
      refetchInterval: (data) => {
        const hasPending = data?.jobs.some(
          (j) => j.status === "PENDING" || j.status === "PROCESSING"
        );
        return hasPending ? 1000 : false;
      },
      refetchOnWindowFocus: false,
    }
  );

  const publications = useQuery<PublicationsResponse, Error>(
    ["publishedMedia"],
    () => fetchJson<PublicationsResponse>("/api/publications"),
    { refetchOnWindowFocus: false }
  );

  const products = useMemo(
    () => (catalog.data?.products ?? []).filter((product) => product.imageUrl),
    [catalog.data]
  );

  useEffect(() => {
    if (!productId && products[0]) setProductId(products[0].id);
  }, [productId, products]);

  useEffect(() => {
    if (!activeJobId) {
      if (!previewPath) {
        const firstCompleted = jobs.data?.jobs.find(
          (j) => j.status === "COMPLETED" && j.resultUrl
        );
        if (firstCompleted?.resultUrl) {
          setPreviewPath(firstCompleted.resultUrl);
        }
      }
      return;
    }

    const targetJob = jobs.data?.jobs.find((j) => j.id === activeJobId);
    if (!targetJob) return;

    if (targetJob.status === "COMPLETED" && targetJob.resultUrl) {
      setPreviewPath(targetJob.resultUrl);
      shopify.toast.show("Đã xử lý xong ảnh watermark");
      setActiveJobId(null);
    } else if (targetJob.status === "FAILED") {
      shopify.toast.show(
        `Xử lý watermark thất bại: ${
          targetJob.errorMessage ?? "Lỗi không xác định"
        }`,
        { isError: true }
      );
      setActiveJobId(null);
    } else if (targetJob.status === "CANCELLED") {
      setActiveJobId(null);
    }
  }, [jobs.data, activeJobId, previewPath]);

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setIsUploadingLogo(true);
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const res = await fetchJson<{ assetId: string; url: string }>(
            "/api/media/upload",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ dataUrl: reader.result as string }),
            }
          );
          setLogoUrl(res.url);
          shopify.toast.show("Đã tải logo lên thành công");
        } catch (err: unknown) {
          shopify.toast.show(
            `Không tải được logo: ${
              err instanceof Error ? err.message : String(err)
            }`,
            { isError: true }
          );
        } finally {
          setIsUploadingLogo(false);
        }
      };
      reader.readAsDataURL(file);
    } catch {
      setIsUploadingLogo(false);
    }
  };

  const createAndProcess = useMutation<WatermarkJobDto, Error>(
    async () => {
      const payload: Record<string, unknown> = {
        productId,
        watermarkType,
        position,
        opacity: opacityPercent / 100,
        layout,
        rotation,
        offsetX: offsetXPercent / 100,
        offsetY: offsetYPercent / 100,
      };
      if (watermarkType === "TEXT") {
        payload.text = text;
        payload.fontFamily = fontFamily;
        payload.fontSize = fontSizePercent / 100;
        payload.textColor = textColor;
        payload.strokeColor = strokeColor;
        payload.strokeWidth = strokeWidth;
      } else {
        payload.logoUrl = logoUrl;
        payload.logoScale = logoScalePercent / 100;
      }

      const created = await fetchJson<JobResponse>("/api/watermarks/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      return created.job;
    },
    {
      onSuccess: (job) => {
        setActiveJobId(job.id);
        if (job.resultUrl) {
          setPreviewPath(job.resultUrl);
        }
        shopify.toast.show("Đã tạo yêu cầu, đang xử lý watermark ngầm...");
      },
      onError: (error) => {
        shopify.toast.show(`Không tạo được watermark: ${error.message}`, {
          isError: true,
        });
      },
      onSettled: async () => {
        await queryClient.invalidateQueries(["watermarkJobs"]);
      },
    }
  );

  const retryJob = useMutation<WatermarkJobDto, Error, string>(
    async (jobId: string) =>
      (
        await fetchJson<JobResponse>(
          `/api/watermarks/jobs/${encodeURIComponent(jobId)}/retry`,
          { method: "POST" }
        )
      ).job,
    {
      onSuccess: (job) => {
        setActiveJobId(job.id);
        shopify.toast.show("Đã đưa job trở lại hàng đợi");
      },
      onError: (error) => {
        shopify.toast.show(`Xử lý lại thất bại: ${error.message}`, {
          isError: true,
        });
      },
      onSettled: async () => {
        await queryClient.invalidateQueries(["watermarkJobs"]);
      },
    }
  );

  const cancelJob = useMutation<WatermarkJobDto, Error, string>(
    async (jobId: string) =>
      (
        await fetchJson<JobResponse>(
          `/api/watermarks/jobs/${encodeURIComponent(jobId)}/cancel`,
          { method: "POST" }
        )
      ).job,
    {
      onSuccess: () => {
        shopify.toast.show("Đã hủy watermark job");
      },
      onError: (error) => {
        shopify.toast.show(`Không hủy được job: ${error.message}`, {
          isError: true,
        });
      },
      onSettled: async () => {
        await queryClient.invalidateQueries(["watermarkJobs"]);
      },
    }
  );

  const publishToShopify = useMutation<
    PublishedMediaDto,
    Error,
    WatermarkJobDto
  >(
    async (job) =>
      (
        await fetchJson<PublicationResponse>(
          `/api/publications/jobs/${encodeURIComponent(job.id)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              altText: `${productTitle(
                job.productId,
                products
              )} with watermark`,
            }),
          }
        )
      ).publishedMedia,
    {
      onSuccess: async () => {
        shopify.toast.show(
          "Đã đưa ảnh watermark lên vị trí ảnh chính của Shopify"
        );
        await queryClient.invalidateQueries(["publishedMedia"]);
      },
      onError: (error) => {
        shopify.toast.show(`Không publish được ảnh: ${error.message}`, {
          isError: true,
        });
      },
    }
  );

  const restoreFromShopify = useMutation<
    { success: boolean },
    Error,
    WatermarkJobDto
  >(
    async (job) =>
      await fetchJson<{ success: boolean }>(
        `/api/publications/jobs/${encodeURIComponent(job.id)}/restore`,
        { method: "POST" }
      ),
    {
      onSuccess: async () => {
        shopify.toast.show("Đã khôi phục ảnh gốc trên Shopify thành công");
        await queryClient.invalidateQueries(["publishedMedia"]);
      },
      onError: (error) => {
        shopify.toast.show(`Không khôi phục được ảnh: ${error.message}`, {
          isError: true,
        });
      },
    }
  );

  const selectedProduct = products.find((product) => product.id === productId);
  const publishedJobIds = new Set(
    (publications.data?.publications ?? []).map(
      (publication) => publication.watermarkJobId
    )
  );
  const canSubmit =
    Boolean(
      productId && (watermarkType === "TEXT" ? text.trim() : logoUrl.trim())
    ) && !createAndProcess.isLoading;

  const jobRows = (jobs.data?.jobs ?? []).map((job) => [
    new Date(job.createdAt).toLocaleString("vi-VN"),
    productTitle(job.productId, products),
    job.watermarkType === "IMAGE" ? (
      <Text as="span" variant="bodyMd">
        🖼️ [Logo]
      </Text>
    ) : (
      job.text ?? "—"
    ),
    <Badge key={`${job.id}-status`} status={badgeStatus(job.status)}>
      {statusLabel(job.status)}
    </Badge>,
    job.resultUrl ? (
      <Stack key={`${job.id}-actions`} vertical spacing="extraTight">
        <Button plain onClick={() => setPreviewPath(job.resultUrl)}>
          Xem ảnh
        </Button>
        {publishedJobIds.has(job.id) ? (
          <Stack spacing="extraTight">
            <Badge status="success">Đã lên Shopify</Badge>
            <Button
              size="slim"
              loading={
                publishToShopify.isLoading &&
                publishToShopify.variables?.id === job.id
              }
              disabled={
                publishToShopify.isLoading ||
                restoreFromShopify.isLoading
              }
              onClick={() => publishToShopify.mutate(job)}
            >
              Đặt làm ảnh chính
            </Button>
            <Button
              destructive
              size="slim"
              loading={
                restoreFromShopify.isLoading &&
                restoreFromShopify.variables?.id === job.id
              }
              disabled={
                restoreFromShopify.isLoading ||
                publishToShopify.isLoading
              }
              onClick={() => restoreFromShopify.mutate(job)}
            >
              Khôi phục ảnh gốc
            </Button>
          </Stack>
        ) : (
          <Button
            primary
            size="slim"
            loading={
              publishToShopify.isLoading &&
              publishToShopify.variables?.id === job.id
            }
            disabled={publishToShopify.isLoading}
            onClick={() => publishToShopify.mutate(job)}
          >
            Đưa lên Shopify
          </Button>
        )}
      </Stack>
    ) : job.status === "FAILED" ? (
      <Button
        key={`${job.id}-retry`}
        plain
        loading={
          retryJob.isLoading && retryJob.variables === job.id
        }
        onClick={() => retryJob.mutate(job.id)}
      >
        Thử lại
      </Button>
    ) : job.status === "PENDING" ? (
      <Button
        key={`${job.id}-cancel`}
        plain
        destructive
        loading={cancelJob.isLoading && cancelJob.variables === job.id}
        onClick={() => cancelJob.mutate(job.id)}
      >
        Hủy
      </Button>
    ) : job.status === "CANCELLED" ? (
      <Text as="span" variant="bodySm">Đã hủy</Text>
    ) : (
      <Stack spacing="extraTight" alignment="center">
        <Spinner size="small" />
        <Text as="span" variant="bodySm">Đang xử lý ngầm...</Text>
      </Stack>
    ),
  ]);

  return (
    <Stack vertical spacing="loose">
      <Card sectioned>
        <Stack vertical spacing="loose">
          <Text as="h2" variant="headingMd">
            Tạo watermark
          </Text>

          {catalog.isError && (
            <Banner status="critical" title="Không tải được catalog">
              <p>{catalog.error.message}</p>
            </Banner>
          )}

          {!catalog.isLoading && products.length === 0 && (
            <Banner status="warning" title="Chưa có sản phẩm có ảnh">
              <p>Hãy đồng bộ catalog trước khi tạo watermark.</p>
            </Banner>
          )}

          <Form
            onSubmit={() => {
              if (canSubmit) createAndProcess.mutate();
            }}
          >
            <FormLayout>
              <Select
                label="Sản phẩm"
                options={products.map((product) => ({
                  label: product.title,
                  value: product.id,
                }))}
                value={productId}
                disabled={products.length === 0}
                onChange={setProductId}
              />
              <Select
                label="Loại watermark"
                options={[
                  { label: "Văn bản (Text)", value: "TEXT" },
                  { label: "Hình ảnh / Logo (Image)", value: "IMAGE" },
                ]}
                value={watermarkType}
                onChange={(value) => setWatermarkType(value as "TEXT" | "IMAGE")}
              />
              {watermarkType === "TEXT" ? (
                <Stack vertical spacing="tight">
                  <TextField
                    label="Nội dung watermark"
                    value={text}
                    maxLength={100}
                    autoComplete="off"
                    showCharacterCount
                    onChange={setText}
                  />
                  <Select
                    label="Font chữ"
                    options={fontOptions}
                    value={fontFamily}
                    onChange={setFontFamily}
                  />
                  <TextField
                    label="Màu chữ"
                    value={textColor}
                    autoComplete="off"
                    helpText="Định dạng màu #RRGGBB, ví dụ #FFFFFF"
                    onChange={setTextColor}
                  />
                  <TextField
                    label="Màu viền"
                    value={strokeColor}
                    autoComplete="off"
                    helpText="Định dạng màu #RRGGBB, ví dụ #000000"
                    onChange={setStrokeColor}
                  />
                  <RangeSlider
                    label={`Kích thước chữ: ${fontSizePercent}% chiều rộng ảnh`}
                    min={1}
                    max={20}
                    step={0.5}
                    value={fontSizePercent}
                    output
                    onChange={(value) =>
                      setFontSizePercent(Array.isArray(value) ? value[0] : value)
                    }
                  />
                  <RangeSlider
                    label={`Độ dày viền: ${strokeWidth}px`}
                    min={0}
                    max={10}
                    step={1}
                    value={strokeWidth}
                    output
                    onChange={(value) =>
                      setStrokeWidth(Array.isArray(value) ? value[0] : value)
                    }
                  />
                </Stack>
              ) : (
                <Stack vertical spacing="tight">
                  <TextField
                    label="URL Logo"
                    value={logoUrl}
                    autoComplete="off"
                    onChange={setLogoUrl}
                    helpText="Nhập URL ảnh logo hoặc chọn file bên dưới để tải lên"
                  />
                  <div>
                    <label
                      style={{
                        display: "block",
                        marginBottom: "4px",
                        fontSize: "14px",
                      }}
                    >
                      Tải lên file Logo (PNG/JPG):
                    </label>
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      onChange={handleLogoUpload}
                      disabled={isUploadingLogo}
                    />
                    {isUploadingLogo && <Spinner size="small" />}
                  </div>
                  <RangeSlider
                    label={`Kích thước logo: ${logoScalePercent}%`}
                    min={5}
                    max={60}
                    step={5}
                    value={logoScalePercent}
                    output
                    onChange={(value) =>
                      setLogoScalePercent(
                        Array.isArray(value) ? value[0] : value
                      )
                    }
                  />
                </Stack>
              )}
              <Select
                label="Cách bố trí"
                options={[
                  { label: "Một watermark", value: "SINGLE" },
                  { label: "Lặp trên toàn ảnh", value: "TILED" },
                ]}
                value={layout}
                onChange={(value) => setLayout(value as "SINGLE" | "TILED")}
              />
              <Select
                label="Vị trí"
                options={positionOptions}
                value={position}
                onChange={(value) => setPosition(value as WatermarkPosition)}
              />
              <RangeSlider
                label={`Độ trong suốt: ${opacityPercent}%`}
                min={10}
                max={100}
                step={5}
                value={opacityPercent}
                output
                onChange={(value) =>
                  setOpacityPercent(Array.isArray(value) ? value[0] : value)
                }
              />
              <RangeSlider
                label={`Góc xoay: ${rotation}°`}
                min={-180}
                max={180}
                step={15}
                value={rotation}
                output
                onChange={(value) =>
                  setRotation(Array.isArray(value) ? value[0] : value)
                }
              />
              <RangeSlider
                label={`Dịch ngang: ${offsetXPercent}%`}
                min={-50}
                max={50}
                step={5}
                value={offsetXPercent}
                output
                onChange={(value) =>
                  setOffsetXPercent(Array.isArray(value) ? value[0] : value)
                }
              />
              <RangeSlider
                label={`Dịch dọc: ${offsetYPercent}%`}
                min={-50}
                max={50}
                step={5}
                value={offsetYPercent}
                output
                onChange={(value) =>
                  setOffsetYPercent(Array.isArray(value) ? value[0] : value)
                }
              />
              <Button
                submit
                primary
                loading={createAndProcess.isLoading}
                disabled={!canSubmit}
              >
                Tạo ảnh watermark
              </Button>
            </FormLayout>
          </Form>
        </Stack>
      </Card>

      <Card sectioned>
        <Stack vertical spacing="loose">
          <Text as="h2" variant="headingMd">
            Xem trước
          </Text>
          <PreviewImage
            path={previewPath}
            fallbackUrl={selectedProduct?.imageUrl ?? null}
            alt={
              selectedProduct?.imageAltText ??
              selectedProduct?.title ??
              "Watermark preview"
            }
          />
        </Stack>
      </Card>

      <Card sectioned>
        <Stack vertical spacing="loose">
          <Text as="h2" variant="headingMd">
            Lịch sử watermark
          </Text>
          {jobs.isLoading ? (
            <Spinner
              accessibilityLabel="Đang tải lịch sử watermark"
              size="small"
            />
          ) : jobs.isError ? (
            <Banner status="critical">
              <p>{jobs.error.message}</p>
            </Banner>
          ) : jobRows.length === 0 ? (
            <p>Chưa có watermark job nào.</p>
          ) : (
            <>
              {publications.isError && (
                <Banner status="warning">
                  <p>
                    Không tải được trạng thái publication:{" "}
                    {publications.error.message}
                  </p>
                </Banner>
              )}
              <DataTable
                columnContentTypes={["text", "text", "text", "text", "text"]}
                headings={[
                  "Thời gian",
                  "Sản phẩm",
                  "Nội dung",
                  "Trạng thái",
                  "Kết quả",
                ]}
                rows={jobRows}
              />
            </>
          )}
        </Stack>
      </Card>
    </Stack>
  );
}

function PreviewImage({
  path,
  fallbackUrl,
  alt,
}: {
  path: string | null;
  fallbackUrl: string | null;
  alt: string;
}) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!path) {
      setObjectUrl(null);
      setError(null);
      return;
    }
    let active = true;
    let nextObjectUrl: string | null = null;
    fetch(path)
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.blob();
      })
      .then((blob) => {
        if (!active) return;
        nextObjectUrl = URL.createObjectURL(blob);
        setObjectUrl(nextObjectUrl);
        setError(null);
      })
      .catch((reason: unknown) => {
        if (active)
          setError(
            reason instanceof Error ? reason.message : "Không tải được ảnh"
          );
      });
    return () => {
      active = false;
      if (nextObjectUrl) URL.revokeObjectURL(nextObjectUrl);
    };
  }, [path]);

  if (error)
    return (
      <Banner status="critical">
        <p>Không tải được preview: {error}</p>
      </Banner>
    );
  if (path && !objectUrl)
    return <Spinner accessibilityLabel="Đang tải ảnh preview" />;
  const source = objectUrl ?? fallbackUrl;
  if (!source) return <p>Chọn một sản phẩm có ảnh để xem trước.</p>;

  return (
    <div
      style={{ maxWidth: "640px", borderRadius: "12px", overflow: "hidden" }}
    >
      <img
        src={source}
        alt={alt}
        style={{ display: "block", width: "100%", height: "auto" }}
      />
    </div>
  );
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(body?.error ?? `HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

function productTitle(productId: string, products: ProductDto[]): string {
  return (
    products.find((product) => product.id === productId)?.title ?? productId
  );
}

function statusLabel(status: WatermarkJobStatus): string {
  return {
    PENDING: "Đang chờ",
    PROCESSING: "Đang xử lý",
    COMPLETED: "Hoàn thành",
    FAILED: "Thất bại",
    CANCELLED: "Đã hủy",
  }[status];
}

function badgeStatus(
  status: WatermarkJobStatus
): "success" | "attention" | "critical" | "info" {
  return {
    PENDING: "attention",
    PROCESSING: "info",
    COMPLETED: "success",
    FAILED: "critical",
    CANCELLED: "info",
  }[status] as "success" | "attention" | "critical" | "info";
}
