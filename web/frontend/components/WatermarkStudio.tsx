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
  | "TOP_RIGHT"
  | "CENTER"
  | "BOTTOM_LEFT"
  | "BOTTOM_RIGHT";

type WatermarkJobStatus = "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED";

interface WatermarkJobDto {
  id: string;
  productId: string;
  text: string;
  position: WatermarkPosition;
  opacity: number;
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
  { label: "Góc trên bên phải", value: "TOP_RIGHT" },
  { label: "Chính giữa", value: "CENTER" },
  { label: "Góc dưới bên trái", value: "BOTTOM_LEFT" },
  { label: "Góc dưới bên phải", value: "BOTTOM_RIGHT" },
];

export function WatermarkStudio() {
  const shopify = useAppBridge();
  const queryClient = useQueryClient();
  const [productId, setProductId] = useState("");
  const [text, setText] = useState("© My shop");
  const [position, setPosition] = useState<WatermarkPosition>("BOTTOM_RIGHT");
  const [opacityPercent, setOpacityPercent] = useState(70);
  const [previewPath, setPreviewPath] = useState<string | null>(null);

  const catalog = useQuery<CatalogResponse, Error>(
    ["catalogProducts"],
    () => fetchJson<CatalogResponse>("/api/catalog/products"),
    { refetchOnWindowFocus: false }
  );

  const jobs = useQuery<JobsResponse, Error>(
    ["watermarkJobs"],
    () => fetchJson<JobsResponse>("/api/watermarks/jobs"),
    { refetchOnWindowFocus: false }
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

  const createAndProcess = useMutation<WatermarkJobDto, Error>(
    async () => {
      const created = await fetchJson<JobResponse>("/api/watermarks/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId,
          text,
          position,
          opacity: opacityPercent / 100,
        }),
      });
      return (
        await fetchJson<JobResponse>(
          `/api/watermarks/jobs/${encodeURIComponent(created.job.id)}/process`,
          { method: "POST" }
        )
      ).job;
    },
    {
      onSuccess: (job) => {
        setPreviewPath(job.resultUrl);
        shopify.toast.show("Đã tạo ảnh watermark");
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

  const processExisting = useMutation<WatermarkJobDto, Error>(
    async (jobId: string) =>
      (
        await fetchJson<JobResponse>(
          `/api/watermarks/jobs/${encodeURIComponent(jobId)}/process`,
          { method: "POST" }
        )
      ).job,
    {
      onSuccess: (job) => {
        setPreviewPath(job.resultUrl);
        shopify.toast.show("Đã xử lý lại watermark");
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
        shopify.toast.show("Đã đưa ảnh watermark lên Shopify");
        await queryClient.invalidateQueries(["publishedMedia"]);
      },
      onError: (error) => {
        shopify.toast.show(`Không publish được ảnh: ${error.message}`, {
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
    Boolean(productId && text.trim()) && !createAndProcess.isLoading;
  const jobRows = (jobs.data?.jobs ?? []).map((job) => [
    new Date(job.createdAt).toLocaleString("vi-VN"),
    productTitle(job.productId, products),
    job.text,
    <Badge key={`${job.id}-status`} status={badgeStatus(job.status)}>
      {statusLabel(job.status)}
    </Badge>,
    job.resultUrl ? (
      <Stack key={`${job.id}-actions`} vertical spacing="extraTight">
        <Button plain onClick={() => setPreviewPath(job.resultUrl)}>
          Xem ảnh
        </Button>
        {publishedJobIds.has(job.id) ? (
          <Badge status="success">Đã lên Shopify</Badge>
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
          processExisting.isLoading && processExisting.variables === job.id
        }
        onClick={() => processExisting.mutate(job.id)}
      >
        Thử lại
      </Button>
    ) : (
      "—"
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
              <TextField
                label="Nội dung watermark"
                value={text}
                maxLength={100}
                autoComplete="off"
                showCharacterCount
                onChange={setText}
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
  }[status] as "success" | "attention" | "critical" | "info";
}
