import {
  Badge,
  Banner,
  Button,
  Card,
  DataTable,
  IndexTable,
  ProgressBar,
  RangeSlider,
  Select,
  Stack,
  Text,
  TextField,
  Thumbnail,
  useIndexResourceState,
} from "@shopify/polaris";
import { useAppBridge } from "@shopify/app-bridge-react";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";

interface ProductDto extends Record<string, unknown> {
  id: string;
  title: string;
  status: "ACTIVE" | "DRAFT" | "ARCHIVED";
  imageUrl: string | null;
  imageAltText: string | null;
  needsReview: boolean;
  sourceVersion: number;
}

interface CatalogResponse {
  products: ProductDto[];
}

type BatchStatus =
  | "QUEUED"
  | "RUNNING"
  | "COMPLETED"
  | "PARTIAL_FAILED"
  | "FAILED"
  | "CANCELLED";

interface WatermarkBatchDto {
  id: string;
  totalJobs: number;
  pendingJobs: number;
  processingJobs: number;
  completedJobs: number;
  failedJobs: number;
  cancelledJobs: number;
  status: BatchStatus;
  createdAt: string;
}

interface BatchesResponse {
  batches: WatermarkBatchDto[];
}

interface CreateBatchResponse {
  batch: {
    id: string;
    totalJobs: number;
    createdAt: string;
  };
}

interface SuccessResponse {
  success: boolean;
}

const positionOptions = [
  { label: "Góc trên trái", value: "TOP_LEFT" },
  { label: "Giữa phía trên", value: "TOP_CENTER" },
  { label: "Góc trên phải", value: "TOP_RIGHT" },
  { label: "Giữa bên trái", value: "MIDDLE_LEFT" },
  { label: "Chính giữa", value: "CENTER" },
  { label: "Giữa bên phải", value: "MIDDLE_RIGHT" },
  { label: "Góc dưới trái", value: "BOTTOM_LEFT" },
  { label: "Giữa phía dưới", value: "BOTTOM_CENTER" },
  { label: "Góc dưới phải", value: "BOTTOM_RIGHT" },
];

export function BulkWatermarkStudio() {
  const shopify = useAppBridge();
  const queryClient = useQueryClient();
  const [scope, setScope] = useState("all");
  const [search, setSearch] = useState("");
  const [watermarkType, setWatermarkType] = useState<"TEXT" | "IMAGE">("TEXT");
  const [text, setText] = useState("© My Store");
  const [logoUrl, setLogoUrl] = useState("");
  const [position, setPosition] = useState("BOTTOM_RIGHT");
  const [opacityPercent, setOpacityPercent] = useState(70);

  const catalog = useQuery<CatalogResponse, Error>(
    ["catalogProducts"],
    () => fetchJson<CatalogResponse>("/api/catalog/products"),
    { refetchOnWindowFocus: false, refetchInterval: 5_000 }
  );
  const batches = useQuery<BatchesResponse, Error>(
    ["watermarkBatches"],
    () => fetchJson<BatchesResponse>("/api/watermarks/batches"),
    {
      refetchOnWindowFocus: false,
      refetchInterval: (data) =>
        data?.batches.some(
          (batch) => batch.status === "QUEUED" || batch.status === "RUNNING"
        )
          ? 1_500
          : 5_000,
    }
  );

  const eligibleProducts = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase("vi");
    return (catalog.data?.products ?? [])
      .filter((product) => product.imageUrl)
      .filter((product) => scope === "all" || product.needsReview)
      .filter(
        (product) =>
          !normalizedSearch ||
          product.title.toLocaleLowerCase("vi").includes(normalizedSearch)
      )
      .slice(0, 1_000);
  }, [catalog.data?.products, scope, search]);

  const {
    selectedResources,
    allResourcesSelected,
    handleSelectionChange,
    clearSelection,
  } = useIndexResourceState(eligibleProducts, {
    resourceIDResolver: (product) => product.id,
  });
  const visibleIds = new Set(eligibleProducts.map((product) => product.id));
  const selectedProductIds = selectedResources.filter((id) =>
    visibleIds.has(id)
  );

  const createBatch = useMutation<CreateBatchResponse, Error>(
    async () => {
      return await fetchJson<CreateBatchResponse>("/api/watermarks/batches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productIds: selectedProductIds,
          watermarkType,
          text: watermarkType === "TEXT" ? text : null,
          logoUrl: watermarkType === "IMAGE" ? logoUrl : null,
          position,
          opacity: opacityPercent / 100,
          layout: "SINGLE",
          logoScale: 0.2,
          rotation: 0,
          offsetX: 0,
          offsetY: 0,
          fontFamily: "Arial",
          fontSize: 0.045,
          textColor: "#FFFFFF",
          strokeColor: "#000000",
          strokeWidth: 2,
        }),
      });
    },
    {
      onSuccess: async () => {
        clearSelection();
        await Promise.all([
          queryClient.invalidateQueries(["watermarkBatches"]),
          queryClient.invalidateQueries(["watermarkJobs"]),
          queryClient.invalidateQueries(["catalogProducts"]),
        ]);
        shopify.toast.show("Đã tạo batch watermark, đang xử lý ngầm");
      },
      onError: (error) => {
        shopify.toast.show(`Không tạo được batch: ${error.message}`, {
          isError: true,
        });
      },
    }
  );

  const cancelBatch = useMutation<SuccessResponse, Error, string>(
    async (batchId: string) => {
      return await fetchJson<SuccessResponse>(
        `/api/watermarks/batches/${batchId}/cancel`,
        { method: "POST" }
      );
    },
    {
      onSuccess: async () => {
        await queryClient.invalidateQueries(["watermarkBatches"]);
        shopify.toast.show("Đã hủy các ảnh còn đang chờ trong batch");
      },
      onError: (error) => {
        shopify.toast.show(`Không hủy được batch: ${error.message}`, {
          isError: true,
        });
      },
    }
  );

  const configurationValid =
    watermarkType === "TEXT"
      ? text.trim().length > 0
      : logoUrl.trim().length > 0;
  const canCreate =
    selectedProductIds.length > 0 &&
    selectedProductIds.length <= 1_000 &&
    configurationValid;

  const batchRows = (batches.data?.batches ?? []).map((batch) => {
    const finished =
      batch.completedJobs + batch.failedJobs + batch.cancelledJobs;
    const progress =
      batch.totalJobs > 0 ? (finished / batch.totalJobs) * 100 : 0;
    return [
      new Intl.DateTimeFormat("vi-VN", {
        dateStyle: "short",
        timeStyle: "short",
      }).format(new Date(batch.createdAt)),
      batch.totalJobs.toLocaleString("vi-VN"),
      <div key={`${batch.id}-progress`} style={{ minWidth: "180px" }}>
        <ProgressBar progress={progress} size="small" />
        <div style={{ marginTop: "4px" }}>
          <Text as="span" variant="bodySm" color="subdued">
            {batch.completedJobs} xong · {batch.processingJobs} đang chạy ·{" "}
            {batch.failedJobs} lỗi
          </Text>
        </div>
      </div>,
      batchStatusBadge(batch.status),
      batch.status === "QUEUED" || batch.status === "RUNNING" ? (
        <Button
          key={`${batch.id}-cancel`}
          size="slim"
          destructive
          loading={cancelBatch.isLoading && cancelBatch.variables === batch.id}
          onClick={() => cancelBatch.mutate(batch.id)}
        >
          Hủy phần đang chờ
        </Button>
      ) : (
        "—"
      ),
    ];
  });

  return (
    <Stack vertical spacing="loose">
      <Card sectioned>
        <Stack vertical spacing="loose">
          <div>
            <Text as="h2" variant="headingMd">
              Bulk Watermark
            </Text>
            <Text as="p" variant="bodyMd" color="subdued">
              Chọn tối đa 1.000 sản phẩm và xử lý theo batch. Ảnh hoàn tất chỉ
              được lưu trong app, chưa tự đăng lên Shopify.
            </Text>
          </div>

          <Banner status="info" title="Chế độ duyệt thủ công">
            <p>
              Bạn có thể xem kết quả ở phần Watermark đơn bên dưới rồi mới chọn
              đặt làm ảnh chính.
            </p>
          </Banner>

          {catalog.isError && (
            <Banner status="critical" title="Không tải được sản phẩm">
              <p>{catalog.error.message}</p>
            </Banner>
          )}

          <Stack distribution="fillEvenly" alignment="trailing">
            <Select
              label="Phạm vi"
              options={[
                { label: "Ảnh mới – cần duyệt", value: "review" },
                { label: "Tất cả sản phẩm có ảnh", value: "all" },
              ]}
              value={scope}
              onChange={(value) => {
                clearSelection();
                setScope(value);
              }}
            />
            <TextField
              label="Tìm sản phẩm"
              value={search}
              autoComplete="off"
              clearButton
              onClearButtonClick={() => setSearch("")}
              onChange={setSearch}
            />
          </Stack>

          <IndexTable
            resourceName={{ singular: "sản phẩm", plural: "sản phẩm" }}
            itemCount={eligibleProducts.length}
            selectedItemsCount={
              allResourcesSelected ? "All" : selectedProductIds.length
            }
            onSelectionChange={handleSelectionChange}
            headings={[
              { title: "Sản phẩm" },
              { title: "Trạng thái ảnh" },
              { title: "Shopify ID" },
            ]}
            loading={catalog.isLoading}
          >
            {eligibleProducts.map((product, index) => (
              <IndexTable.Row
                id={product.id}
                key={product.id}
                position={index}
                selected={selectedResources.includes(product.id)}
              >
                <IndexTable.Cell>
                  <Stack spacing="tight" alignment="center">
                    <Thumbnail
                      source={product.imageUrl!}
                      alt={product.imageAltText ?? product.title}
                      size="small"
                    />
                    <Text as="span" variant="bodyMd" fontWeight="semibold">
                      {product.title}
                    </Text>
                  </Stack>
                </IndexTable.Cell>
                <IndexTable.Cell>
                  {product.needsReview ? (
                    <Badge status="attention">Ảnh mới – cần duyệt</Badge>
                  ) : (
                    <Badge status="success">{`Đã đồng bộ (v${product.sourceVersion})`}</Badge>
                  )}
                </IndexTable.Cell>
                <IndexTable.Cell>{product.id}</IndexTable.Cell>
              </IndexTable.Row>
            ))}
          </IndexTable>

          {!catalog.isLoading && eligibleProducts.length === 0 && (
            <Banner status="warning" title="Không có sản phẩm phù hợp">
              <p>
                Đổi phạm vi sang “Tất cả sản phẩm có ảnh” hoặc đồng bộ catalog
                trước.
              </p>
            </Banner>
          )}

          <Stack distribution="fillEvenly" alignment="trailing">
            <Select
              label="Loại watermark"
              options={[
                { label: "Văn bản", value: "TEXT" },
                { label: "Logo từ URL", value: "IMAGE" },
              ]}
              value={watermarkType}
              onChange={(value) => setWatermarkType(value as "TEXT" | "IMAGE")}
            />
            {watermarkType === "TEXT" ? (
              <TextField
                label="Nội dung"
                value={text}
                maxLength={100}
                autoComplete="off"
                onChange={setText}
              />
            ) : (
              <TextField
                label="URL logo HTTPS"
                value={logoUrl}
                autoComplete="off"
                onChange={setLogoUrl}
              />
            )}
            <Select
              label="Vị trí"
              options={positionOptions}
              value={position}
              onChange={setPosition}
            />
          </Stack>

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

          <Stack distribution="equalSpacing" alignment="center">
            <Text as="span" variant="bodyMd">
              Đã chọn {selectedProductIds.length.toLocaleString("vi-VN")} /
              1.000 sản phẩm
            </Text>
            <Button
              primary
              loading={createBatch.isLoading}
              disabled={!canCreate || createBatch.isLoading}
              onClick={() => createBatch.mutate()}
            >
              Tạo batch watermark
            </Button>
          </Stack>
        </Stack>
      </Card>

      <Card sectioned>
        <Stack vertical spacing="loose">
          <Text as="h2" variant="headingMd">
            Tiến độ batch
          </Text>
          {batches.isError ? (
            <Banner status="critical">
              <p>{batches.error.message}</p>
            </Banner>
          ) : batchRows.length > 0 ? (
            <DataTable
              columnContentTypes={["text", "numeric", "text", "text", "text"]}
              headings={[
                "Thời gian",
                "Số ảnh",
                "Tiến độ",
                "Trạng thái",
                "Thao tác",
              ]}
              rows={batchRows}
            />
          ) : (
            <Text as="p" variant="bodyMd" color="subdued">
              Chưa có batch nào.
            </Text>
          )}
        </Stack>
      </Card>
    </Stack>
  );
}

function batchStatusBadge(status: BatchStatus) {
  const labels: Record<BatchStatus, string> = {
    QUEUED: "Đang chờ",
    RUNNING: "Đang xử lý",
    COMPLETED: "Hoàn tất",
    PARTIAL_FAILED: "Hoàn tất một phần",
    FAILED: "Thất bại",
    CANCELLED: "Đã hủy",
  };
  const badgeStatus =
    status === "COMPLETED"
      ? "success"
      : status === "FAILED" || status === "PARTIAL_FAILED"
      ? "critical"
      : status === "CANCELLED"
      ? "new"
      : "attention";
  return (
    <Badge key={`${status}-badge`} status={badgeStatus}>
      {labels[status]}
    </Badge>
  );
}

async function fetchJson<T = unknown>(
  url: string,
  init?: RequestInit
): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // Giữ lỗi HTTP khi body không phải JSON.
    }
    throw new Error(message);
  }
  return (await response.json()) as T;
}
