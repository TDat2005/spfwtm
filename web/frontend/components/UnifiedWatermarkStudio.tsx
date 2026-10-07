import {
  Badge,
  Banner,
  Button,
  ButtonGroup,
  Card,
  Checkbox,
  DataTable,
  FormLayout,
  IndexTable,
  Layout,
  ProgressBar,
  RangeSlider,
  Select,
  Spinner,
  Stack,
  Tabs,
  Text,
  TextField,
  Thumbnail,
  useIndexResourceState,
} from "@shopify/polaris";
import { useAppBridge } from "@shopify/app-bridge-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import { AutoWatermarkRules } from "./AutoWatermarkRules";
import { WatermarkPreview } from "./WatermarkPreview";
import { fetchJson } from "../utils/fetchJson";
import {
  MAX_LOGO_LAYERS,
  MAX_TILED_LAYERS,
  MAX_WATERMARK_LAYERS,
  WatermarkDesign,
  type SerializedWatermarkDesign,
  type SerializedWatermarkLayer,
} from "../../src/modules/watermark/domain/WatermarkDesign.ts";

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

interface CatalogSyncState {
  syncId: string | null;
  status: "IDLE" | "RUNNING" | "COMPLETED" | "FAILED";
  syncedCount: number;
  error: string | null;
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

interface WatermarkJobDto {
  id: string;
  productId: string;
  layers: SerializedWatermarkLayer[];
  summary: string;
  status: "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED" | "CANCELLED";
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

interface SuccessResponse {
  success: boolean;
}

interface WatermarkTemplateDto {
  id: string;
  name: string;
  config: SerializedWatermarkDesign | null;
  isDefault: boolean;
  createdAt: string;
}

interface TemplatesResponse {
  templates: WatermarkTemplateDto[];
}

const ALL_TYPES = "all";
const typeValue = (productType: string) => `type:${productType}`;
const typeLabel = (productType: string) => productType || "Chưa phân loại";

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

/** Một lớp trong trình chỉnh sửa; `id` chỉ dùng cho React, không gửi lên server. */
type EditorLayer = SerializedWatermarkLayer & { id: string };

let layerSequence = 0;
const newLayerId = () => `layer-${Date.now()}-${++layerSequence}`;

function newTextLayer(): EditorLayer {
  return {
    id: newLayerId(),
    enabled: true,
    type: "TEXT",
    text: "© My Store",
    logoUrl: null,
    logoScale: 0.2,
    position: "BOTTOM_RIGHT",
    opacity: 0.7,
    layout: "SINGLE",
    rotation: 0,
    offsetX: 0,
    offsetY: 0,
    fontFamily: "Arial",
    fontSize: 0.045,
    textColor: "#FFFFFF",
    strokeColor: "#000000",
    strokeWidth: 2,
  };
}

function newLogoLayer(): EditorLayer {
  return { ...newTextLayer(), type: "IMAGE", text: null, logoUrl: "", position: "TOP_LEFT" };
}

function toPayload(layers: EditorLayer[]): SerializedWatermarkLayer[] {
  return layers.map(({ id: _id, ...layer }) => layer);
}

function layerLabel(layer: SerializedWatermarkLayer): string {
  if (layer.type === "IMAGE") return layer.logoUrl ? "Logo" : "Logo (chưa chọn ảnh)";
  return layer.text?.trim() ? `"${layer.text.trim()}"` : "Chữ (trống)";
}

const sliderValue = (value: number | [number, number]) =>
  Array.isArray(value) ? value[0] : value;

const fontOptions = [
  "Arial",
  "Helvetica",
  "Georgia",
  "Times New Roman",
  "Courier New",
].map((font) => ({ label: font, value: font }));

export function UnifiedWatermarkStudio() {
  const shopify = useAppBridge();
  const queryClient = useQueryClient();

  // --- Thiết kế watermark nhiều lớp (dùng chung cho Single và Bulk) ---
  const [layers, setLayers] = useState<EditorLayer[]>(() => [newTextLayer()]);
  const [selectedLayerId, setSelectedLayerId] = useState<string>(() => layers[0].id);
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);
  const selectedLayer =
    layers.find((layer) => layer.id === selectedLayerId) ?? layers[0];

  const updateLayer = (id: string, patch: Partial<SerializedWatermarkLayer>) =>
    setLayers((current) =>
      current.map((layer) => (layer.id === id ? { ...layer, ...patch } : layer))
    );
  const updateSelected = (patch: Partial<SerializedWatermarkLayer>) =>
    updateLayer(selectedLayer.id, patch);

  const addLayer = (layer: EditorLayer) => {
    setLayers((current) => [...current, layer]);
    setSelectedLayerId(layer.id);
  };
  const duplicateLayer = (id: string) => {
    const source = layers.find((layer) => layer.id === id);
    if (!source) return;
    const copy = { ...source, id: newLayerId() };
    setLayers((current) => {
      const index = current.findIndex((layer) => layer.id === id);
      return [...current.slice(0, index + 1), copy, ...current.slice(index + 1)];
    });
    setSelectedLayerId(copy.id);
  };
  const removeLayer = (id: string) => {
    if (layers.length <= 1) return;
    const remaining = layers.filter((layer) => layer.id !== id);
    setLayers(remaining);
    if (selectedLayerId === id) setSelectedLayerId(remaining[remaining.length - 1].id);
  };
  /** direction = 1: đưa lên trên (chồng lên lớp kế tiếp); -1: đưa xuống dưới. */
  const moveLayer = (id: string, direction: 1 | -1) =>
    setLayers((current) => {
      const index = current.findIndex((layer) => layer.id === id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });

  // --- Preview Product Selection ---
  const [previewProductId, setPreviewProductId] = useState<string>("");
  const [previewWithWatermark, setPreviewWithWatermark] = useState(true);

  // --- Application Tab: 0 = Bulk (Hàng loạt), 1 = Single (Đơn lẻ) ---
  const [selectedTab, setSelectedTab] = useState(0);

  // --- Bulk Filter & Selection State ---
  const [scope, setScope] = useState("all");
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState(ALL_TYPES);

  // --- Single Mode State ---
  const [singleProductId, setSingleProductId] = useState("");
  const [activeSingleJobId, setActiveSingleJobId] = useState<string | null>(null);

  // --- Templates & Presets State ---
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [newTemplateName, setNewTemplateName] = useState<string>("");
  const [showSaveTemplateModal, setShowSaveTemplateModal] = useState<boolean>(false);

  // --- Target Media Scope (Primary vs All Images) ---
  const [targetMediaScope, setTargetMediaScope] = useState<"PRIMARY" | "ALL">("PRIMARY");

  // --- Queries ---
  const templates = useQuery<TemplatesResponse, Error>(
    ["watermarkTemplates"],
    () => fetchJson<TemplatesResponse>("/api/watermarks/templates"),
    { refetchOnWindowFocus: false }
  );

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

  const syncStatus = useQuery<CatalogSyncState, Error>(
    ["catalogSyncStatus"],
    () => fetchJson<CatalogSyncState>("/api/catalog/sync"),
    {
      refetchOnWindowFocus: false,
      refetchInterval: (state) => (state?.status === "RUNNING" ? 2_000 : false),
    }
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

  const jobs = useQuery<JobsResponse, Error>(
    ["watermarkJobs"],
    () => fetchJson<JobsResponse>("/api/watermarks/jobs"),
    {
      refetchOnWindowFocus: false,
      refetchInterval: 5_000,
    }
  );

  const publications = useQuery<PublicationsResponse, Error>(
    ["publishedMedia"],
    () => fetchJson<PublicationsResponse>("/api/publications"),
    // publish-all chạy nền qua BullMQ nên cần polling để thấy kết quả.
    { refetchOnWindowFocus: false, refetchInterval: 5_000 }
  );

  const publishedByProductId = useMemo(() => {
    const map = new Map<string, PublishedMediaDto>();
    for (const p of publications.data?.publications ?? []) {
      map.set(p.productId, p);
    }
    return map;
  }, [publications.data]);

  // Products with valid images
  const productsWithImage = useMemo(
    () => (catalog.data?.products ?? []).filter((p) => p.imageUrl),
    [catalog.data]
  );

  // Filtered products for bulk selection
  const eligibleProducts = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase("vi");
    return productsWithImage
      .filter((product) => {
        if (scope === "review") return product.needsReview;
        if (scope === "unwatermarked")
          return !publishedByProductId.has(product.id) && !product.imageUrl?.includes("/wm-");
        if (scope === "watermarked")
          return publishedByProductId.has(product.id) || product.imageUrl?.includes("/wm-");
        return true;
      })
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
  }, [productsWithImage, scope, search, typeFilter, publishedByProductId]);

  const {
    selectedResources,
    allResourcesSelected,
    handleSelectionChange,
    clearSelection,
  } = useIndexResourceState(eligibleProducts, {
    resourceIDResolver: (product) => product.id,
  });

  const visibleIds = useMemo(
    () => new Set(eligibleProducts.map((p) => p.id)),
    [eligibleProducts]
  );
  const selectedProductIds = useMemo(
    () => selectedResources.filter((id) => visibleIds.has(id)),
    [selectedResources, visibleIds]
  );

  // Initialize preview and single product selections
  useEffect(() => {
    if (!previewProductId && productsWithImage[0]) {
      setPreviewProductId(productsWithImage[0].id);
    }
    if (!singleProductId && productsWithImage[0]) {
      setSingleProductId(productsWithImage[0].id);
    }
  }, [previewProductId, singleProductId, productsWithImage]);

  // Keep preview product updated when user selects in bulk or single
  const activePreviewProduct = useMemo(() => {
    if (selectedTab === 1 && singleProductId) {
      return productsWithImage.find((p) => p.id === singleProductId) ?? null;
    }
    if (selectedProductIds.length > 0) {
      return (
        productsWithImage.find((p) => p.id === selectedProductIds[0]) ?? null
      );
    }
    return (
      productsWithImage.find((p) => p.id === previewProductId) ??
      productsWithImage[0] ??
      null
    );
  }, [
    selectedTab,
    singleProductId,
    selectedProductIds,
    previewProductId,
    productsWithImage,
  ]);

  // Kiểm tra bằng đúng domain của backend để UI và server cùng một luật.
  const designError = useMemo(() => {
    try {
      new WatermarkDesign(toPayload(layers));
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }, [layers]);
  const configurationValid = designError === null;
  const activeLogoCount = layers.filter((l) => l.enabled && l.type === "IMAGE").length;
  const activeTiledCount = layers.filter((l) => l.enabled && l.layout === "TILED").length;

  // --- Logo File Upload ---
  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Giữ đúng lớp đang chọn lúc bắt đầu tải, kể cả khi người dùng đổi lớp giữa chừng.
    const targetLayerId = selectedLayer.id;
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
          updateLayer(targetLayerId, { logoUrl: res.url });
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

  // --- Catalog Sync Mutation ---
  const syncCatalog = useMutation<CatalogSyncState, Error>(
    () =>
      fetchJson<CatalogSyncState>("/api/catalog/sync", { method: "POST" }),
    {
      onSuccess: () => syncStatus.refetch(),
      onError: (err) =>
        shopify.toast.show(`Đồng bộ thất bại: ${err.message}`, {
          isError: true,
        }),
    }
  );

  const watchedSyncId = useRef<string | null>(null);
  useEffect(() => {
    const state = syncStatus.data;
    if (!state?.syncId) return;
    if (state.status === "RUNNING") {
      watchedSyncId.current = state.syncId;
      return;
    }
    if (watchedSyncId.current !== state.syncId) return;
    watchedSyncId.current = null;

    if (state.status === "COMPLETED") {
      void catalog.refetch();
      void queryClient.invalidateQueries(["catalogProductTypes"]);
      shopify.toast.show(`Đã đồng bộ ${state.syncedCount} sản phẩm`);
    } else if (state.status === "FAILED") {
      shopify.toast.show(
        `Đồng bộ thất bại: ${state.error ?? "Lỗi không rõ"}`,
        { isError: true }
      );
    }
  }, [syncStatus.data, catalog, queryClient, shopify]);

  // --- Single Watermark Creation Mutation ---
  const createSingleJob = useMutation<JobResponse, Error>(
    async () => {
      return await fetchJson<JobResponse>("/api/watermarks/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId: singleProductId,
          layers: toPayload(layers),
        }),
      });
    },
    {
      onSuccess: ({ job }) => {
        setActiveSingleJobId(job.id);
        void queryClient.invalidateQueries(["watermarkJobs"]);
        shopify.toast.show("Đã tạo yêu cầu, đang xử lý watermark ngầm...");
      },
      onError: (err) => {
        shopify.toast.show(`Tạo watermark thất bại: ${err.message}`, {
          isError: true,
        });
      },
    }
  );

  // Monitor single job completion
  useEffect(() => {
    if (!activeSingleJobId) return;
    const targetJob = jobs.data?.jobs.find((j) => j.id === activeSingleJobId);
    if (!targetJob) return;

    if (targetJob.status === "COMPLETED") {
      shopify.toast.show("Đã xử lý xong ảnh watermark");
      setActiveSingleJobId(null);
    } else if (targetJob.status === "FAILED") {
      shopify.toast.show(
        `Xử lý watermark thất bại: ${
          targetJob.errorMessage ?? "Lỗi không xác định"
        }`,
        { isError: true }
      );
      setActiveSingleJobId(null);
    }
  }, [jobs.data, activeSingleJobId, shopify]);

  // --- Bulk Watermark Batch Creation Mutation ---
  const createBatch = useMutation<
    CreateBatchResponse,
    Error,
    { productIds?: string[]; productType?: string }
  >(
    async (selection) => {
      return await fetchJson<CreateBatchResponse>("/api/watermarks/batches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...selection,
          layers: toPayload(layers),
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

  // --- Cancel Batch Mutation ---
  const cancelBatch = useMutation<SuccessResponse, Error, string>(
    async (batchId) => {
      return await fetchJson<SuccessResponse>(
        `/api/watermarks/batches/${batchId}/cancel`,
        { method: "POST" }
      );
    },
    {
      onSuccess: () => {
        void queryClient.invalidateQueries(["watermarkBatches"]);
        shopify.toast.show("Đã hủy các ảnh còn đang chờ trong batch");
      },
      onError: (err) =>
        shopify.toast.show(`Không hủy được batch: ${err.message}`, {
          isError: true,
        }),
    }
  );

  // --- Publish to Shopify Mutation ---
  const publishToShopify = useMutation<PublishedMediaDto, Error, WatermarkJobDto>(
    (job) =>
      fetchJson<PublishedMediaDto>(
        `/api/publications/jobs/${encodeURIComponent(job.id)}`,
        { method: "POST" }
      ),
    {
      onSuccess: () => {
        void queryClient.invalidateQueries(["publishedMedia"]);
        void queryClient.invalidateQueries(["catalogProducts"]);
        shopify.toast.show("Đã đặt làm ảnh chính trên Shopify");
      },
      onError: (err) =>
        shopify.toast.show(`Không đưa được lên Shopify: ${err.message}`, {
          isError: true,
        }),
    }
  );

  // --- Restore from Shopify Mutation (by Job) ---
  const restoreFromShopify = useMutation<SuccessResponse, Error, { id: string }>(
    (job) =>
      fetchJson<SuccessResponse>(
        `/api/publications/jobs/${encodeURIComponent(job.id)}/restore`,
        { method: "POST" }
      ),
    {
      onSuccess: () => {
        void queryClient.invalidateQueries(["publishedMedia"]);
        void queryClient.invalidateQueries(["catalogProducts"]);
        shopify.toast.show("Đã khôi phục ảnh gốc trên Shopify thành công");
      },
      onError: (err) =>
        shopify.toast.show(`Không khôi phục được ảnh: ${err.message}`, {
          isError: true,
        }),
    }
  );

  // --- Restore Product Original Image Mutation (by Product ID) ---
  const restoreProduct = useMutation<SuccessResponse, Error, string>(
    (productId) =>
      fetchJson<SuccessResponse>(
        `/api/publications/products/${encodeURIComponent(productId)}/restore`,
        { method: "POST" }
      ),
    {
      onSuccess: () => {
        void queryClient.invalidateQueries(["publishedMedia"]);
        void queryClient.invalidateQueries(["catalogProducts"]);
        shopify.toast.show("Đã khôi phục ảnh gốc trên Shopify thành công");
      },
      onError: (err) =>
        shopify.toast.show(`Không khôi phục được ảnh: ${err.message}`, {
          isError: true,
        }),
    }
  );

  // --- Restore All Products Original Images Mutation ---
  const restoreAllProducts = useMutation<SuccessResponse, Error, void>(
    () =>
      fetchJson<SuccessResponse>("/api/publications/restore-all", {
        method: "POST",
      }),
    {
      onSuccess: () => {
        void queryClient.invalidateQueries(["publishedMedia"]);
        void queryClient.invalidateQueries(["catalogProducts"]);
        shopify.toast.show("Đã khôi phục toàn bộ ảnh gốc trên Shopify");
      },
      onError: (err) =>
        shopify.toast.show(`Không thể khôi phục tất cả: ${err.message}`, {
          isError: true,
        }),
    }
  );

  // --- Bulk Publish Batch Mutation ---
  const publishBatch = useMutation<
    { success: boolean; queuedCount: number },
    Error,
    string
  >(
    (batchId) =>
      fetchJson<{ success: boolean; queuedCount: number }>(
        `/api/publications/batches/${encodeURIComponent(batchId)}/publish-all`,
        { method: "POST" }
      ),
    {
      onSuccess: (data) => {
        void queryClient.invalidateQueries(["publishedMedia"]);
        void queryClient.invalidateQueries(["catalogProducts"]);
        void queryClient.invalidateQueries(["watermarkBatches"]);
        shopify.toast.show(
          data.queuedCount > 0
            ? `Đã đưa ${data.queuedCount} ảnh vào hàng đợi xuất bản lên Shopify`
            : "Không còn ảnh nào cần xuất bản trong batch này"
        );
      },
      onError: (err) =>
        shopify.toast.show(`Không thể xuất bản: ${err.message}`, {
          isError: true,
        }),
    }
  );

  // --- Storage Cleanup Mutation ---
  const cleanupStorageMutation = useMutation(
    () =>
      fetchJson<{ success: boolean; deletedAssetsCount: number; freedBytes: number }>(
        "/api/media/cleanup",
        { method: "POST" }
      ),
    {
      onSuccess: (data) => {
        const mb = (data.freedBytes / (1024 * 1024)).toFixed(2);
        shopify.toast.show(
          `Đã giải phóng ${mb} MB (${data.deletedAssetsCount} file tạm trên server)!`
        );
      },
      onError: (err: unknown) =>
        shopify.toast.show(
          `Lỗi dọn dẹp: ${err instanceof Error ? err.message : String(err)}`,
          { isError: true }
        ),
    }
  );

  // --- Watermark Template Mutations ---
  const saveTemplateMutation = useMutation(
    async () => {
      return await fetchJson<{ template: WatermarkTemplateDto }>("/api/watermarks/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newTemplateName.trim(),
          config: { version: 2, layers: toPayload(layers) },
        }),
      });
    },
    {
      onSuccess: ({ template }) => {
        void queryClient.invalidateQueries(["watermarkTemplates"]);
        setSelectedTemplateId(template.id);
        setShowSaveTemplateModal(false);
        setNewTemplateName("");
        shopify.toast.show(`Đã lưu mẫu "${template.name}" thành công!`);
      },
      onError: (err: unknown) =>
        shopify.toast.show(
          `Lỗi lưu mẫu: ${err instanceof Error ? err.message : String(err)}`,
          { isError: true }
        ),
    }
  );

  const deleteTemplateMutation = useMutation(
    async (id: string) => {
      return await fetchJson<SuccessResponse>(`/api/watermarks/templates/${id}`, {
        method: "DELETE",
      });
    },
    {
      onSuccess: () => {
        void queryClient.invalidateQueries(["watermarkTemplates"]);
        setSelectedTemplateId("");
        shopify.toast.show("Đã xóa mẫu watermark");
      },
      onError: (err: unknown) =>
        shopify.toast.show(
          `Lỗi xóa mẫu: ${err instanceof Error ? err.message : String(err)}`,
          { isError: true }
        ),
    }
  );

  const handleSelectTemplate = (templateId: string) => {
    setSelectedTemplateId(templateId);
    if (!templateId) return;
    const tmpl = templates.data?.templates.find((t) => t.id === templateId);
    if (!tmpl) return;
    let loaded: EditorLayer[];
    try {
      if (!tmpl.config) throw new Error("Mẫu không hợp lệ");
      loaded = WatermarkDesign.fromJSON(tmpl.config)
        .toJSON()
        .layers.map((layer) => ({ ...layer, id: newLayerId() }));
    } catch (error) {
      shopify.toast.show(
        `Không áp dụng được mẫu: ${error instanceof Error ? error.message : String(error)}`,
        { isError: true }
      );
      return;
    }
    setLayers(loaded);
    setSelectedLayerId(loaded[0].id);
    shopify.toast.show(`Đã áp dụng mẫu "${tmpl.name}"`);
  };

  const selectedType =
    typeFilter === ALL_TYPES
      ? null
      : (productTypes.data?.productTypes ?? []).find(
          (type) => typeValue(type.productType) === typeFilter
        ) ?? null;

  const canCreateBatch =
    selectedProductIds.length > 0 &&
    selectedProductIds.length <= 1_000 &&
    configurationValid;

  const canCreateForType =
    selectedType !== null &&
    selectedType.withImageCount > 0 &&
    selectedType.withImageCount <= 5_000 &&
    configurationValid;

  const publishedJobIds = useMemo(
    () => new Set((publications.data?.publications ?? []).map((p) => p.watermarkJobId)),
    [publications.data]
  );

  const reviewCount = productsWithImage.filter((p) => p.needsReview).length;
  const isSyncing =
    syncCatalog.isLoading || syncStatus.data?.status === "RUNNING";

  // Bulk table rows
  const bulkRows = eligibleProducts.map((product, index) => {
    const publishedInfo = publishedByProductId.get(product.id);
    const isWatermarked = Boolean(
      publishedInfo || product.imageUrl?.includes("/wm-")
    );
    return (
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
          <Stack spacing="extraTight">
            {isWatermarked && <Badge status="info">Đang có watermark</Badge>}
            {product.needsReview ? (
              <Badge status="attention">Ảnh mới – cần duyệt</Badge>
            ) : (
              <Badge status="success">{`Đã đồng bộ (v${product.sourceVersion})`}</Badge>
            )}
          </Stack>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Stack spacing="extraTight" alignment="center">
            <Button
              plain
              size="slim"
              onClick={() => {
                setPreviewProductId(product.id);
                setSingleProductId(product.id);
              }}
            >
              Xem mẫu
            </Button>
            {isWatermarked && (
              <Button
                plain
                destructive
                size="slim"
                loading={
                  restoreProduct.isLoading &&
                  restoreProduct.variables === product.id
                }
                disabled={restoreProduct.isLoading}
                onClick={() => restoreProduct.mutate(product.id)}
              >
                Khôi phục gốc
              </Button>
            )}
          </Stack>
        </IndexTable.Cell>
      </IndexTable.Row>
    );
  });

  // Batch progress rows
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
      <div key={`${batch.id}-progress`} style={{ minWidth: "160px" }}>
        <ProgressBar progress={progress} size="small" />
        <div style={{ marginTop: "4px" }}>
          <Text as="span" variant="bodySm" color="subdued">
            {batch.completedJobs} xong · {batch.processingJobs} chạy ·{" "}
            {batch.failedJobs} lỗi
          </Text>
        </div>
      </div>,
      batchStatusBadge(batch.status),
      <Stack key={`${batch.id}-actions`} spacing="extraTight" alignment="center">
        {batch.completedJobs > 0 && (
          <Button
            primary
            size="slim"
            loading={publishBatch.isLoading && publishBatch.variables === batch.id}
            disabled={publishBatch.isLoading}
            onClick={() => publishBatch.mutate(batch.id)}
          >
            {`Xuất bản lên Shopify (${batch.completedJobs})`}
          </Button>
        )}
        {(batch.status === "QUEUED" || batch.status === "RUNNING") && (
          <Button
            size="slim"
            destructive
            loading={cancelBatch.isLoading && cancelBatch.variables === batch.id}
            onClick={() => cancelBatch.mutate(batch.id)}
          >
            Hủy
          </Button>
        )}
        {batch.completedJobs === 0 && batch.status !== "QUEUED" && batch.status !== "RUNNING" && (
          <Text as="span" variant="bodySm" color="subdued">—</Text>
        )}
      </Stack>,
    ];
  });

  // History job rows
  const jobRows = (jobs.data?.jobs ?? []).map((job) => {
    const matchedProduct = productsWithImage.find((p) => p.id === job.productId);
    const title = matchedProduct?.title ?? job.productId;
    const isJobPublished = publishedJobIds.has(job.id);

    return [
      new Intl.DateTimeFormat("vi-VN", {
        dateStyle: "short",
        timeStyle: "medium",
      }).format(new Date(job.createdAt)),
      title,
      job.summary || "—",
      jobStatusBadge(job.status),
      job.resultUrl ? (
        <Stack key={`${job.id}-actions`} vertical spacing="extraTight">
          <Button plain url={job.resultUrl} external>
            Xem ảnh
          </Button>
          {isJobPublished ? (
            <Stack spacing="extraTight" alignment="center">
              <Badge status="success">Đã lên Shopify</Badge>
              <Button
                destructive
                size="slim"
                loading={
                  restoreFromShopify.isLoading &&
                  restoreFromShopify.variables?.id === job.id
                }
                disabled={
                  restoreFromShopify.isLoading || publishToShopify.isLoading
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
              disabled={
                publishToShopify.isLoading || restoreFromShopify.isLoading
              }
              onClick={() => publishToShopify.mutate(job)}
            >
              Đưa lên Shopify
            </Button>
          )}
        </Stack>
      ) : (
        job.errorMessage ?? "—"
      ),
    ];
  });

  return (
    <Stack vertical spacing="loose">
      {/* Top Header / Sync Bar */}
      <Card sectioned>
        <Stack distribution="equalSpacing" alignment="center">
          <Stack vertical spacing="extraTight">
            <Text as="h1" variant="headingLg">
              Watermark Studio
            </Text>
            <Text as="p" variant="bodyMd" color="subdued">
              Tùy chỉnh watermark và áp dụng cho từng sản phẩm hoặc hàng loạt trên cửa hàng Shopify.
            </Text>
          </Stack>
          <Stack spacing="tight" alignment="center">
            {syncStatus.data?.status === "RUNNING" && (
              <Text as="span" variant="bodySm" color="subdued">
                {`Đang đồng bộ... (${syncStatus.data.syncedCount} SP)`}
              </Text>
            )}
            <Button
              size="slim"
              loading={cleanupStorageMutation.isLoading}
              disabled={cleanupStorageMutation.isLoading}
              onClick={() => cleanupStorageMutation.mutate()}
            >
              Dọn dẹp ảnh tạm
            </Button>
            <Button
              loading={isSyncing}
              disabled={isSyncing}
              onClick={() => syncCatalog.mutate()}
            >
              Đồng bộ catalog từ Shopify
            </Button>
          </Stack>
        </Stack>
        {reviewCount > 0 && (
          <div style={{ marginTop: "12px" }}>
            <Banner
              status="warning"
              title={`${reviewCount} sản phẩm có ảnh mới cần duyệt`}
            >
              <p>
                Phát hiện ảnh mới trên Shopify chưa được đóng dấu watermark. Hãy chọn các sản phẩm này để cập nhật.
              </p>
            </Banner>
          </div>
        )}
      </Card>

      {/* SECTION 1: Cấu hình Watermark & 1 KHUNG XEM TRƯỚC DUY NHẤT (Side-by-side) */}
      <Layout>
        <Layout.Section>
          <Card sectioned title="Cấu hình Watermark">
            {/* Presets Toolbar & Auto-watermark */}
            <div
              style={{
                marginBottom: "20px",
                padding: "12px",
                background: "#FAFBFB",
                borderRadius: "8px",
                border: "1px solid #E1E3E5",
              }}
            >
              <Stack vertical spacing="tight">
                <Stack distribution="equalSpacing" alignment="center">
                  <Text as="h3" variant="headingSm">
                    🎨 Mẫu thiết kế (Presets)
                  </Text>
                  <ButtonGroup>
                    <Button
                      size="slim"
                      onClick={() => setShowSaveTemplateModal(!showSaveTemplateModal)}
                    >
                      {showSaveTemplateModal ? "Đóng" : "Lưu làm mẫu mới"}
                    </Button>
                    {selectedTemplateId && (
                      <Button
                        size="slim"
                        destructive
                        loading={deleteTemplateMutation.isLoading}
                        onClick={() => deleteTemplateMutation.mutate(selectedTemplateId)}
                      >
                        Xóa mẫu
                      </Button>
                    )}
                  </ButtonGroup>
                </Stack>

                <Select
                  label="Chọn mẫu đã lưu để áp dụng nhanh"
                  options={[
                    { label: "— Chọn mẫu đã lưu để áp dụng nhanh —", value: "" },
                    ...(templates.data?.templates ?? []).map((t) => ({
                      label: t.name,
                      value: t.id,
                    })),
                  ]}
                  value={selectedTemplateId}
                  onChange={handleSelectTemplate}
                />

                {showSaveTemplateModal && (
                  <div
                    style={{
                      background: "#FFFFFF",
                      padding: "12px",
                      borderRadius: "6px",
                      border: "1px solid #C9CCCF",
                      marginTop: "6px",
                    }}
                  >
                    <FormLayout>
                      <TextField
                        label="Tên mẫu thiết kế"
                        value={newTemplateName}
                        onChange={setNewTemplateName}
                        placeholder="Ví dụ: Logo góc phải 20%, Bản quyền trung tâm..."
                        autoComplete="off"
                      />
                      <Stack distribution="trailing">
                        <Button size="slim" onClick={() => setShowSaveTemplateModal(false)}>
                          Hủy
                        </Button>
                        <Button
                          primary
                          size="slim"
                          loading={saveTemplateMutation.isLoading}
                          disabled={!newTemplateName.trim()}
                          onClick={() => saveTemplateMutation.mutate()}
                        >
                          Lưu mẫu
                        </Button>
                      </Stack>
                    </FormLayout>
                  </div>
                )}

              </Stack>
            </div>

            {/* Danh sách lớp: lớp trên cùng hiển thị đầu tiên, giống trình chỉnh sửa ảnh */}
            <div style={{ marginBottom: "20px" }}>
              <Stack vertical spacing="tight">
                <Stack distribution="equalSpacing" alignment="center">
                  <Text as="h3" variant="headingSm">
                    {`Các lớp watermark (${layers.length}/${MAX_WATERMARK_LAYERS})`}
                  </Text>
                  <ButtonGroup>
                    <Button
                      size="slim"
                      disabled={layers.length >= MAX_WATERMARK_LAYERS}
                      onClick={() => addLayer(newTextLayer())}
                    >
                      + Lớp chữ
                    </Button>
                    <Button
                      size="slim"
                      disabled={
                        layers.length >= MAX_WATERMARK_LAYERS ||
                        activeLogoCount >= MAX_LOGO_LAYERS
                      }
                      onClick={() => addLayer(newLogoLayer())}
                    >
                      + Lớp logo
                    </Button>
                  </ButtonGroup>
                </Stack>
                <Text as="p" variant="bodySm" color="subdued">
                  {`Lớp ở trên nằm đè lên lớp ở dưới. Tối đa ${MAX_LOGO_LAYERS} lớp logo và ${MAX_TILED_LAYERS} lớp lặp toàn ảnh đang bật.`}
                </Text>
                {layers
                  .map((layer, index) => ({ layer, index }))
                  .reverse()
                  .map(({ layer, index }) => {
                    const selected = layer.id === selectedLayer.id;
                    return (
                      <div
                        key={layer.id}
                        onClick={() => setSelectedLayerId(layer.id)}
                        style={{
                          cursor: "pointer",
                          padding: "8px 12px",
                          borderRadius: "6px",
                          border: selected ? "2px solid #2C6ECB" : "1px solid #E1E3E5",
                          background: selected ? "#F2F7FE" : "#FFFFFF",
                          opacity: layer.enabled ? 1 : 0.55,
                        }}
                      >
                        <Stack distribution="equalSpacing" alignment="center">
                          <Stack spacing="tight" alignment="center">
                            <Badge>{`Lớp ${index + 1}`}</Badge>
                            <Text as="span" variant="bodyMd" fontWeight={selected ? "semibold" : "regular"}>
                              {layerLabel(layer)}
                            </Text>
                            {layer.layout === "TILED" && <Badge status="info">Lặp</Badge>}
                            {!layer.enabled && <Badge>Đang ẩn</Badge>}
                          </Stack>
                          <div onClick={(event) => event.stopPropagation()}>
                            <ButtonGroup segmented>
                              <Button
                                size="slim"
                                accessibilityLabel="Đưa lên trên"
                                disabled={index === layers.length - 1}
                                onClick={() => moveLayer(layer.id, 1)}
                              >
                                ↑
                              </Button>
                              <Button
                                size="slim"
                                accessibilityLabel="Đưa xuống dưới"
                                disabled={index === 0}
                                onClick={() => moveLayer(layer.id, -1)}
                              >
                                ↓
                              </Button>
                              <Button
                                size="slim"
                                onClick={() => updateLayer(layer.id, { enabled: !layer.enabled })}
                              >
                                {layer.enabled ? "Ẩn" : "Hiện"}
                              </Button>
                              <Button
                                size="slim"
                                disabled={layers.length >= MAX_WATERMARK_LAYERS}
                                onClick={() => duplicateLayer(layer.id)}
                              >
                                Nhân bản
                              </Button>
                              <Button
                                size="slim"
                                destructive
                                disabled={layers.length <= 1}
                                onClick={() => removeLayer(layer.id)}
                              >
                                Xóa
                              </Button>
                            </ButtonGroup>
                          </div>
                        </Stack>
                      </div>
                    );
                  })}
                {designError && <Banner status="critical" title={designError} />}
              </Stack>
            </div>

            <Text as="h3" variant="headingSm">
              {`Chỉnh sửa lớp ${layers.findIndex((layer) => layer.id === selectedLayer.id) + 1}`}
            </Text>
            <div style={{ marginTop: "8px" }}>
            <FormLayout>
              <Select
                label="Loại lớp"
                options={[
                  { label: "Văn bản (Text)", value: "TEXT" },
                  { label: "Hình ảnh (Logo)", value: "IMAGE" },
                ]}
                value={selectedLayer.type}
                onChange={(val) =>
                  updateSelected(
                    val === "IMAGE"
                      ? { type: "IMAGE", logoUrl: selectedLayer.logoUrl ?? "" }
                      : { type: "TEXT", text: selectedLayer.text ?? "© My Store" }
                  )
                }
              />

              {selectedLayer.type === "TEXT" ? (
                <>
                  <TextField
                    label="Nội dung"
                    value={selectedLayer.text ?? ""}
                    autoComplete="off"
                    onChange={(val) => updateSelected({ text: val })}
                    helpText="Tối đa 100 ký tự"
                  />
                  <FormLayout.Group>
                    <Select
                      label="Font chữ"
                      options={fontOptions}
                      value={selectedLayer.fontFamily}
                      onChange={(val) =>
                        updateSelected({ fontFamily: val as SerializedWatermarkLayer["fontFamily"] })
                      }
                    />
                    <TextField
                      label="Màu chữ"
                      value={selectedLayer.textColor}
                      autoComplete="off"
                      onChange={(val) => updateSelected({ textColor: val })}
                      helpText="Mã màu HEX, ví dụ: #FFFFFF"
                    />
                  </FormLayout.Group>
                  <FormLayout.Group>
                    <TextField
                      label="Màu viền"
                      value={selectedLayer.strokeColor}
                      autoComplete="off"
                      onChange={(val) => updateSelected({ strokeColor: val })}
                      helpText="Mã màu HEX, ví dụ: #000000"
                    />
                    <RangeSlider
                      label={`Độ dày viền: ${selectedLayer.strokeWidth}px`}
                      min={0}
                      max={10}
                      value={selectedLayer.strokeWidth}
                      output
                      onChange={(val) => updateSelected({ strokeWidth: sliderValue(val) })}
                    />
                  </FormLayout.Group>
                  <RangeSlider
                    label={`Kích thước chữ: ${Number((selectedLayer.fontSize * 100).toFixed(1))}% chiều rộng ảnh`}
                    min={1}
                    max={20}
                    step={0.5}
                    value={Number((selectedLayer.fontSize * 100).toFixed(1))}
                    output
                    onChange={(val) => updateSelected({ fontSize: sliderValue(val) / 100 })}
                  />
                </>
              ) : (
                <>
                  <Stack vertical spacing="extraTight">
                    <Text as="span" variant="bodyMd">
                      Tải ảnh logo lên
                    </Text>
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/svg+xml"
                      disabled={isUploadingLogo}
                      onChange={handleLogoUpload}
                    />
                  </Stack>
                  <TextField
                    label="Hoặc nhập URL logo (HTTPS)"
                    value={selectedLayer.logoUrl ?? ""}
                    autoComplete="off"
                    onChange={(val) => updateSelected({ logoUrl: val })}
                  />
                  <RangeSlider
                    label={`Kích thước logo: ${Math.round(selectedLayer.logoScale * 100)}% chiều rộng ảnh`}
                    min={5}
                    max={100}
                    step={5}
                    value={Math.round(selectedLayer.logoScale * 100)}
                    output
                    onChange={(val) => updateSelected({ logoScale: sliderValue(val) / 100 })}
                  />
                </>
              )}

              <FormLayout.Group>
                <Select
                  label="Vị trí"
                  options={positionOptions}
                  value={selectedLayer.position}
                  onChange={(val) =>
                    updateSelected({ position: val as SerializedWatermarkLayer["position"] })
                  }
                />
                <Select
                  label="Cách bố trí"
                  options={[
                    { label: "Một watermark", value: "SINGLE" },
                    {
                      label: "Lặp toàn bộ ảnh (Tiled)",
                      value: "TILED",
                      disabled:
                        selectedLayer.layout !== "TILED" &&
                        selectedLayer.enabled &&
                        activeTiledCount >= MAX_TILED_LAYERS,
                    },
                  ]}
                  value={selectedLayer.layout}
                  onChange={(val) => updateSelected({ layout: val as "SINGLE" | "TILED" })}
                />
              </FormLayout.Group>

              <RangeSlider
                label={`Độ trong suốt: ${Math.round(selectedLayer.opacity * 100)}%`}
                min={10}
                max={100}
                step={5}
                value={Math.round(selectedLayer.opacity * 100)}
                output
                onChange={(val) => updateSelected({ opacity: sliderValue(val) / 100 })}
              />

              <RangeSlider
                label={`Góc xoay: ${selectedLayer.rotation}°`}
                min={-180}
                max={180}
                step={5}
                value={selectedLayer.rotation}
                output
                onChange={(val) => updateSelected({ rotation: sliderValue(val) })}
              />
              <FormLayout.Group>
                <RangeSlider
                  label={`Dịch ngang (X): ${Math.round(selectedLayer.offsetX * 100)}%`}
                  min={-50}
                  max={50}
                  value={Math.round(selectedLayer.offsetX * 100)}
                  output
                  onChange={(val) => updateSelected({ offsetX: sliderValue(val) / 100 })}
                />
                <RangeSlider
                  label={`Dịch dọc (Y): ${Math.round(selectedLayer.offsetY * 100)}%`}
                  min={-50}
                  max={50}
                  value={Math.round(selectedLayer.offsetY * 100)}
                  output
                  onChange={(val) => updateSelected({ offsetY: sliderValue(val) / 100 })}
                />
              </FormLayout.Group>
            </FormLayout>
            </div>
          </Card>
        </Layout.Section>

        {/* Khung Xem trước trực tiếp DUY NHẤT */}
        <Layout.Section secondary>
          <div style={{ position: "sticky", top: "16px" }}>
            <Card sectioned title="Xem trước trực tiếp (Live Preview)">
              <Stack vertical spacing="tight">
                <Select
                  label="Chọn sản phẩm xem mẫu"
                  options={productsWithImage.map((p) => ({
                    label: p.title,
                    value: p.id,
                  }))}
                  value={activePreviewProduct?.id ?? ""}
                  onChange={(val) => {
                    setPreviewProductId(val);
                    setSingleProductId(val);
                  }}
                />

                <div style={{ marginTop: "4px" }}>
                  <Stack distribution="equalSpacing" alignment="center">
                    <Text as="span" variant="bodySm" fontWeight="semibold">
                      Chế độ xem:
                    </Text>
                    <ButtonGroup segmented>
                      <Button
                        size="slim"
                        pressed={!previewWithWatermark}
                        onClick={() => setPreviewWithWatermark(false)}
                      >
                        Ảnh gốc trên Shopify
                      </Button>
                      <Button
                        size="slim"
                        pressed={previewWithWatermark}
                        onClick={() => setPreviewWithWatermark(true)}
                      >
                        Xem thử Watermark
                      </Button>
                    </ButtonGroup>
                  </Stack>
                </div>

                <div style={{ marginTop: "8px" }}>
                  <WatermarkPreview
                    imageUrl={activePreviewProduct?.imageUrl ?? null}
                    productTitle={activePreviewProduct?.title}
                    layers={layers}
                    showWatermark={previewWithWatermark}
                  />
                </div>

                <Text as="p" variant="bodySm" color="subdued">
                  {previewWithWatermark
                    ? "ℹ️ Đang hiển thị lớp watermark mô phỏng theo cấu hình bên trái."
                    : "✅ Đang hiển thị ảnh gốc thực tế trên Shopify (không có watermark)."}
                </Text>

                {activePreviewProduct && (
                  <div
                    style={{
                      marginTop: "12px",
                      paddingTop: "12px",
                      borderTop: "1px solid #E1E3E5",
                    }}
                  >
                    <Stack distribution="equalSpacing" alignment="center">
                      <Stack spacing="extraTight" vertical>
                        <Text as="span" variant="bodySm" fontWeight="semibold">
                          {activePreviewProduct.imageUrl?.includes("/wm-") ||
                          publishedByProductId.has(activePreviewProduct.id)
                            ? "Đang có watermark trên Shopify"
                            : "Ảnh hiện tại trên Shopify"}
                        </Text>
                      </Stack>
                      <Button
                        destructive
                        size="slim"
                        loading={
                          restoreProduct.isLoading &&
                          restoreProduct.variables === activePreviewProduct.id
                        }
                        disabled={restoreProduct.isLoading}
                        onClick={() => restoreProduct.mutate(activePreviewProduct.id)}
                      >
                        Khôi phục ảnh gốc
                      </Button>
                    </Stack>
                  </div>
                )}
              </Stack>
            </Card>
          </div>
        </Layout.Section>
      </Layout>

      {/* SECTION 2: ÁP DỤNG WATERMARK (Tabs: Hàng loạt vs 1 sản phẩm) */}
      <Card>
        <Tabs
          tabs={[
            {
              id: "bulk-tab",
              content: "Watermark hàng loạt (Bulk)",
              panelID: "bulk-panel",
            },
            {
              id: "single-tab",
              content: "Watermark 1 sản phẩm",
              panelID: "single-panel",
            },
            {
              id: "restore-tab",
              content: "Khôi phục ảnh gốc (Hoàn tác)",
              panelID: "restore-panel",
            },
          ]}
          selected={selectedTab}
          onSelect={setSelectedTab}
        />

        <Card.Section>
          {selectedTab === 0 ? (
            /* TAB 0: BULK WATERMARK */
            <Stack vertical spacing="loose">
              {/* Filter controls */}
              <Stack distribution="fillEvenly">
                <Select
                  label="Bộ lọc sản phẩm"
                  options={[
                    { label: "Tất cả sản phẩm có ảnh", value: "all" },
                    { label: "Chỉ ảnh mới cần duyệt", value: "review" },
                    { label: "Chưa có watermark", value: "unwatermarked" },
                    { label: "Đang có watermark", value: "watermarked" },
                  ]}
                  value={scope}
                  onChange={setScope}
                />
                <Select
                  label="Phạm vi ảnh áp dụng"
                  options={[
                    { label: "Ảnh đại diện chính (Primary)", value: "PRIMARY" },
                    { label: "Tất cả ảnh thư viện (Gallery)", value: "ALL" },
                  ]}
                  value={targetMediaScope}
                  onChange={(val) => setTargetMediaScope(val as "PRIMARY" | "ALL")}
                />
                <Select
                  label="Loại sản phẩm"
                  options={[
                    { label: "Tất cả các loại", value: ALL_TYPES },
                    ...(productTypes.data?.productTypes ?? []).map((t) => ({
                      label: `${typeLabel(t.productType)} (${t.withImageCount})`,
                      value: typeValue(t.productType),
                    })),
                  ]}
                  value={typeFilter}
                  onChange={setTypeFilter}
                />
                <TextField
                  label="Tìm sản phẩm"
                  value={search}
                  autoComplete="off"
                  onChange={setSearch}
                  placeholder="Nhập tên sản phẩm..."
                  clearButton
                  onClearButtonClick={() => setSearch("")}
                />
              </Stack>

              {/* Selection Bar with Quick Actions */}
              <Stack distribution="equalSpacing" alignment="center">
                <Text as="span" variant="bodyMd" fontWeight="semibold">
                  {`Đã chọn ${selectedProductIds.length.toLocaleString("vi-VN")} / ${eligibleProducts.length.toLocaleString("vi-VN")} sản phẩm`}
                </Text>
                <ButtonGroup>
                  <Button
                    size="slim"
                    onClick={() => {
                      // Select all eligible products
                      eligibleProducts.forEach((p) => {
                        if (!selectedResources.includes(p.id)) {
                          handleSelectionChange("single", true, p.id);
                        }
                      });
                    }}
                  >
                    Chọn tất cả danh sách
                  </Button>
                  <Button
                    size="slim"
                    disabled={selectedProductIds.length === 0}
                    onClick={clearSelection}
                  >
                    Bỏ chọn
                  </Button>
                </ButtonGroup>
              </Stack>

              {/* Products Table */}
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
                  { title: "Thao tác" },
                ]}
                loading={catalog.isLoading}
              >
                {bulkRows}
              </IndexTable>

              {/* Action Buttons for Batch */}
              <Stack distribution="equalSpacing" alignment="center">
                <Text as="span" variant="bodySm" color="subdued">
                  Ảnh hoàn tất được lưu trong app. Bạn có thể xem kết quả rồi chọn đưa lên Shopify.
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
                      {`Watermark cả loại "${typeLabel(selectedType.productType)}" (${selectedType.withImageCount})`}
                    </Button>
                  )}
                  <Button
                    primary
                    size="large"
                    loading={createBatch.isLoading}
                    disabled={!canCreateBatch || createBatch.isLoading}
                    onClick={() =>
                      createBatch.mutate({ productIds: selectedProductIds })
                    }
                  >
                    {selectedProductIds.length > 0
                      ? `Tạo batch watermark (${selectedProductIds.length} sản phẩm)`
                      : "Tạo batch watermark (Chọn SP ở trên)"}
                  </Button>
                </Stack>
              </Stack>
            </Stack>
          ) : selectedTab === 1 ? (
            /* TAB 1: SINGLE WATERMARK */
            <Stack vertical spacing="loose">
              <Select
                label="Chọn sản phẩm áp dụng"
                options={productsWithImage.map((p) => ({
                  label: p.title,
                  value: p.id,
                }))}
                value={singleProductId}
                onChange={(val) => {
                  setSingleProductId(val);
                  setPreviewProductId(val);
                }}
              />

              {(() => {
                const isWm =
                  Boolean(singleProductId && publishedByProductId.has(singleProductId)) ||
                  activePreviewProduct?.imageUrl?.includes("/wm-");
                if (!isWm || !singleProductId) return null;
                return (
                  <Banner
                    status="info"
                    title="Sản phẩm này đang dùng ảnh Watermark trên Shopify"
                    action={{
                      content: "Khôi phục ảnh gốc trên Shopify",
                      destructive: true,
                      loading:
                        restoreProduct.isLoading &&
                        restoreProduct.variables === singleProductId,
                      disabled: restoreProduct.isLoading,
                      onAction: () => restoreProduct.mutate(singleProductId),
                    }}
                  >
                    <p>
                      Ảnh watermark hiện đang là ảnh đại diện chính của sản phẩm này trên Shopify. Bạn có thể nhấn nút khôi phục để gỡ ảnh watermark và hiển thị lại ảnh gốc ban đầu.
                    </p>
                  </Banner>
                );
              })()}

              <Stack distribution="equalSpacing" alignment="center">
                <Text as="span" variant="bodyMd" color="subdued">
                  Kiểm tra khung xem trước ở góc phải để xem vị trí và kích thước watermark trước khi tạo.
                </Text>
                <Button
                  primary
                  size="large"
                  loading={createSingleJob.isLoading || activeSingleJobId !== null}
                  disabled={!configurationValid || !singleProductId}
                  onClick={() => createSingleJob.mutate()}
                >
                  Tạo watermark cho sản phẩm này
                </Button>
              </Stack>
            </Stack>
          ) : (
            /* TAB 2: KHÔI PHỤC ẢNH GỐC */
            <Stack vertical spacing="loose">
              <Stack distribution="equalSpacing" alignment="center">
                <Stack vertical spacing="extraTight">
                  <Text as="h2" variant="headingMd">
                    Khôi phục ảnh gốc các sản phẩm trên Shopify
                  </Text>
                  <Text as="p" variant="bodyMd" color="subdued">
                    Gỡ bỏ ảnh watermark trên cửa hàng Shopify và đưa ảnh gốc ban đầu trở lại làm ảnh đại diện chính.
                  </Text>
                </Stack>
                <Button
                  destructive
                  loading={restoreAllProducts.isLoading}
                  disabled={restoreAllProducts.isLoading}
                  onClick={() => restoreAllProducts.mutate()}
                >
                  Khôi phục tất cả sản phẩm
                </Button>
              </Stack>

              <IndexTable
                resourceName={{ singular: "sản phẩm", plural: "sản phẩm" }}
                itemCount={eligibleProducts.length}
                selectedItemsCount={0}
                headings={[
                  { title: "Sản phẩm" },
                  { title: "Trạng thái ảnh" },
                  { title: "Thao tác" },
                ]}
              >
                {eligibleProducts.map((product, index) => {
                  const isWatermarked = Boolean(
                    publishedByProductId.has(product.id) ||
                    product.imageUrl?.includes("/wm-")
                  );
                  return (
                    <IndexTable.Row
                      id={`restore-${product.id}`}
                      key={`restore-${product.id}`}
                      position={index}
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
                        {isWatermarked ? (
                          <Badge status="attention">Đang có watermark</Badge>
                        ) : (
                          <Badge status="success">Ảnh gốc ban đầu</Badge>
                        )}
                      </IndexTable.Cell>
                      <IndexTable.Cell>
                        <Button
                          destructive
                          size="slim"
                          loading={
                            restoreProduct.isLoading &&
                            restoreProduct.variables === product.id
                          }
                          disabled={restoreProduct.isLoading}
                          onClick={() => restoreProduct.mutate(product.id)}
                        >
                          Khôi phục ảnh gốc
                        </Button>
                      </IndexTable.Cell>
                    </IndexTable.Row>
                  );
                })}
              </IndexTable>
            </Stack>
          )}
        </Card.Section>
      </Card>

      {/* Tự động đóng dấu theo rule (collection / loại sản phẩm / toàn shop) */}
      <AutoWatermarkRules
        layers={toPayload(layers)}
        designError={designError}
        productTypes={productTypes.data?.productTypes ?? []}
      />

      {/* SECTION 3: TIẾN ĐỘ BATCH (Nếu có batch) */}
      {(batches.data?.batches ?? []).length > 0 && (
        <Card sectioned title="Tiến độ các Batch gần đây">
          <DataTable
            columnContentTypes={["text", "numeric", "text", "text", "text"]}
            headings={["Thời gian", "Tổng số", "Tiến độ", "Trạng thái", "Thao tác"]}
            rows={batchRows}
          />
        </Card>
      )}

      {/* SECTION 4: LỊCH SỬ WATERMARK (Xem ảnh / Publish / Restore) */}
      <Card sectioned title="Lịch sử watermark">
        {jobs.isLoading ? (
          <Spinner accessibilityLabel="Đang tải lịch sử watermark" size="small" />
        ) : jobRows.length === 0 ? (
          <p>Chưa có watermark job nào hoàn tất.</p>
        ) : (
          <DataTable
            columnContentTypes={["text", "text", "text", "text", "text"]}
            headings={["Thời gian", "Sản phẩm", "Nội dung", "Trạng thái", "Kết quả / Thao tác"]}
            rows={jobRows}
          />
        )}
      </Card>
    </Stack>
  );
}

function batchStatusBadge(status: BatchStatus) {
  switch (status) {
    case "COMPLETED":
      return <Badge status="success">Hoàn thành</Badge>;
    case "RUNNING":
      return <Badge status="info">Đang chạy</Badge>;
    case "QUEUED":
      return <Badge status="attention">Đang chờ</Badge>;
    case "PARTIAL_FAILED":
      return <Badge status="warning">Lỗi một phần</Badge>;
    case "FAILED":
      return <Badge status="critical">Thất bại</Badge>;
    case "CANCELLED":
      return <Badge>Đã hủy</Badge>;
    default:
      return <Badge>{status}</Badge>;
  }
}

function jobStatusBadge(status: string) {
  switch (status) {
    case "COMPLETED":
      return <Badge status="success">Hoàn thành</Badge>;
    case "PROCESSING":
      return <Badge status="info">Đang xử lý</Badge>;
    case "PENDING":
      return <Badge status="attention">Đang chờ</Badge>;
    case "FAILED":
      return <Badge status="critical">Thất bại</Badge>;
    case "CANCELLED":
      return <Badge>Đã hủy</Badge>;
    default:
      return <Badge>{status}</Badge>;
  }
}
