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
import { WatermarkPreview, type WatermarkStyle } from "./WatermarkPreview";

interface ProductDto extends Record<string, unknown> {
  id: string;
  title: string;
  status: "ACTIVE" | "DRAFT" | "ARCHIVED";
  productType: string;
  imageUrl: string | null;
  imageAltText: string | null;
  needsReview: boolean;
  sourceVersion: number;
}

interface CatalogResponse {
  products: ProductDto[];
}

interface ProductTypeDto {
  productType: string;
  productCount: number;
  withImageCount: number;
}

interface ProductTypesResponse {
  productTypes: ProductTypeDto[];
}

type BatchSelection = { productIds: string[] } | { productType: string };

const ALL_TYPES = "all";
const typeValue = (productType: string) => `type:${productType}`;
const typeLabel = (productType: string) => productType || "Chưa phân loại";

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
    skippedProducts: number;
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

const DEFAULT_WATERMARK_STYLE: Omit<
  WatermarkStyle,
  "watermarkType" | "text" | "logoUrl" | "position" | "opacity"
> = {
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
};

export function BulkWatermarkStudio() {
  const shopify = useAppBridge();
  const queryClient = useQueryClient();
  const [scope, setScope] = useState("all");
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState(ALL_TYPES);
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
  const productTypes = useQuery<ProductTypesResponse, Error>(
    ["catalogProductTypes"],
    () => fetchJson<ProductTypesResponse>("/api/catalog/product-types"),
    { refetchOnWindowFocus: false }
  );
  const selectedType =
    typeFilter === ALL_TYPES
      ? null
      : (productTypes.data?.productTypes ?? []).find(
          (type) => typeValue(type.productType) === typeFilter
        ) ?? null;
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
          typeFilter === ALL_TYPES ||
          typeValue(product.productType) === typeFilter
      )
      .filter(
        (product) =>
          !normalizedSearch ||
          product.title.toLocaleLowerCase("vi").includes(normalizedSearch)
      )
      .slice(0, 1_000);
  }, [catalog.data?.products, scope, search, typeFilter]);

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

  const watermarkStyle: WatermarkStyle = {
    ...DEFAULT_WATERMARK_STYLE,
    watermarkType,
    text,
    logoUrl,
    position,
    opacity: opacityPercent / 100,
  };
  const previewProduct =
    eligibleProducts.find((product) => product.id === selectedProductIds[0]) ??
    eligibleProducts[0] ??
    null;

  const createBatch = useMutation<CreateBatchResponse, Error, BatchSelection>(
    async (selection) => {
      return await fetchJson<CreateBatchResponse>("/api/watermarks/batches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...selection,
          ...watermarkStyle,
          text: watermarkType === "TEXT" ? text : null,
          logoUrl: watermarkType === "IMAGE" ? logoUrl : null,
        }),
      });
    },
    {
      onSuccess: async ({ batch }) => {
        clearSelection();
        await Promise.all([
          queryClient.invalidateQueries(["watermarkBatches"]),
          queryClient.invalidateQueries(["watermarkJobs"]),
          queryClient.invalidateQueries(["catalogProducts"]),
        ]);
        shopify.toast.show(
          batch.skippedProducts > 0
            ? `Đã tạo batch ${batch.totalJobs} ảnh, bỏ qua ${batch.skippedProducts} sản phẩm không có ảnh`
            : `Đã tạo batch ${batch.totalJobs} ảnh, đang xử lý ngầm`
        );
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
  const canCreateForType =
    selectedType !== null &&
    selectedType.withImageCount > 0 &&
    selectedType.withImageCount <= 5_000 &&
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
              Chọn tối đa 1.000 sản phẩm, hoặc chọn một loại sản phẩm để
              watermark cả loại (tối đa 5.000). Ảnh hoàn tất chỉ được lưu trong
              app, chưa tự đăng lên Shopify.
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
            <Select
              label="Loại sản phẩm"
              options={[
                { label: "Tất cả loại", value: ALL_TYPES },
                ...(productTypes.data?.productTypes ?? []).map((type) => ({
                  label: `${typeLabel(type.productType)} (${type.withImageCount.toLocaleString("vi-VN")} có ảnh)`,
                  value: typeValue(type.productType),
                })),
              ]}
              value={typeFilter}
              onChange={(value) => {
                clearSelection();
                setTypeFilter(value);
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

          <Stack vertical spacing="extraTight">
            <Text as="h3" variant="headingSm">
              Xem trước
            </Text>
            <WatermarkPreview
              imageUrl={previewProduct?.imageUrl ?? null}
              productTitle={previewProduct?.title}
              style={watermarkStyle}
            />
          </Stack>

          <Stack distribution="equalSpacing" alignment="center">
            <Text as="span" variant="bodyMd">
              Đã chọn {selectedProductIds.length.toLocaleString("vi-VN")} /
              1.000 sản phẩm
            </Text>
            <Stack spacing="tight">
              {selectedType && (
                <Button
                  loading={createBatch.isLoading}
                  disabled={!canCreateForType || createBatch.isLoading}
                  onClick={() =>
                    createBatch.mutate({ productType: selectedType.productType })
                  }
                >
                  {`Watermark cả loại "${typeLabel(selectedType.productType)}" (${selectedType.withImageCount.toLocaleString("vi-VN")})`}
                </Button>
              )}
              <Button
                primary
                loading={createBatch.isLoading}
                disabled={!canCreate || createBatch.isLoading}
                onClick={() =>
                  createBatch.mutate({ productIds: selectedProductIds })
                }
              >
                Tạo batch watermark
              </Button>
            </Stack>
          </Stack>
          {selectedType && selectedType.withImageCount > 5_000 && (
            <Banner status="warning" title="Loại này có quá nhiều sản phẩm">
              <p>
                Mỗi batch theo loại tối đa 5.000 sản phẩm. Hãy chọn tay từng
                phần sản phẩm.
              </p>
            </Banner>
          )}
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
    }
    throw new Error(message);
  }
  return (await response.json()) as T;
}
