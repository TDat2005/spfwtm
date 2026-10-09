import {
  Autocomplete,
  Badge,
  Banner,
  Button,
  ButtonGroup,
  Card,
  Checkbox,
  DataTable,
  FormLayout,
  IndexTable,
  IndexTableSelectionType,
  Layout,
  Pagination,
  ProgressBar,
  RangeSlider,
  Select,
  Spinner,
  Stack,
  Tabs,
  Text,
  TextField,
  Thumbnail,
} from "@shopify/polaris";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import { useToast } from "./providers/ToastProvider";
import { ProductPicker } from "./ProductPicker";
import { StandaloneImageUploader } from "./StandaloneImageUploader";
import { WatermarkPreview } from "./WatermarkPreview";
import { fetchJson } from "../utils/fetchJson";
import { useDebounced } from "../utils/useDebounced";
import {
  studioProductsUrl,
  type StudioProductDto,
  type StudioProductsResponse,
} from "../utils/studioProducts";
import { isShopify } from "../platform";
import {
  MAX_LOGO_LAYERS,
  MAX_TILED_LAYERS,
  MAX_WATERMARK_LAYERS,
  WatermarkDesign,
  type SerializedWatermarkDesign,
  type SerializedWatermarkLayer,
} from "../../src/modules/watermark/domain/WatermarkDesign.ts";
import {
  CATALOG_SCOPES,
  type CatalogFilter,
  type CatalogScope,
} from "../../src/modules/watermark/domain/CatalogFilter.ts";
import {
  FILTER_BATCH_SIZE,
  MAX_FILTER_JOBS,
} from "../../src/modules/watermark/application/CreateFilteredWatermarkBatches.ts";

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

/** Một dòng của GET /api/watermarks/jobs (lịch sử, mới nhất trước). */
interface WatermarkJobHistoryDto extends WatermarkJobDto {
  productTitle: string;
  /** Ảnh kết quả đang là ảnh đã đưa lên Shopify. */
  published: boolean;
}

interface JobsResponse {
  jobs: WatermarkJobHistoryDto[];
  total: number;
  page: number;
  pageSize: number;
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

interface CollectionDto {
  id: string;
  title: string;
  productsCount: number | null;
}

interface CollectionsResponse {
  collections: CollectionDto[];
}

interface CreatedBatchDto {
  id: string;
  totalJobs: number;
  skippedProducts: number;
  createdAt: string;
}

interface CreateBatchResponse {
  batch: CreatedBatchDto;
  /** "Chọn tất cả khớp bộ lọc" hơn 5.000 sản phẩm được chia thành nhiều batch. */
  batches?: CreatedBatchDto[];
}

interface PublishedMediaDto {
  id: string;
  watermarkJobId: string;
  productId: string;
  shopifyMediaId: string;
  imageUrl: string | null;
  createdAt: string;
}

interface SuccessResponse {
  success: boolean;
}

interface RestoreSelectedResponse {
  success: boolean;
  queuedCount: number;
  /** Sản phẩm được chọn nhưng không có ảnh watermark của app. */
  skippedCount: number;
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
/** Ở chế độ độc lập mỗi "sản phẩm" là một ảnh tải lên. */
const ITEM = isShopify ? "sản phẩm" : "ảnh";
const typeValue = (productType: string) => `type:${productType}`;
const typeFromValue = (value: string) => value.slice("type:".length);
/** Bảng sản phẩm và lịch sử lấy từng trang từ server; "chọn tất cả khớp bộ lọc" vẫn áp dụng cho mọi trang. */
const PRODUCTS_PAGE_SIZE = 50;
const HISTORY_PAGE_SIZE = 20;
/** Batch chọn tay tối đa ngần này sản phẩm (cùng giới hạn của server). */
const MAX_MANUAL_SELECTION = 1_000;
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
  const toast = useToast();
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

  // --- Sản phẩm xem mẫu, cũng là sản phẩm của tab "Watermark 1 sản phẩm" ---
  const [focusedProduct, setFocusedProduct] = useState<StudioProductDto | null>(null);
  const [previewWithWatermark, setPreviewWithWatermark] = useState(true);

  // --- Application Tab: 0 = Bulk (Hàng loạt), 1 = Single (Đơn lẻ) ---
  const [selectedTab, setSelectedTab] = useState(0);

  // --- Bulk Filter & Selection State ---
  const [scope, setScope] = useState("all");
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounced(search, 300);
  const [typeFilter, setTypeFilter] = useState(ALL_TYPES);
  const [collectionFilter, setCollectionFilter] = useState<CollectionDto | null>(null);
  const [collectionInput, setCollectionInput] = useState("");
  const collectionQuery = useDebounced(collectionInput, 400);

  // --- Single Mode State ---
  const [activeSingleJobId, setActiveSingleJobId] = useState<string | null>(null);

  // --- Lịch sử watermark ---
  const [historyPage, setHistoryPage] = useState(1);

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

  // Bộ lọc đang xem. Server lọc và phân trang theo đúng bộ lọc này, và dùng lại
  // nó khi merchant "chọn tất cả sản phẩm khớp bộ lọc".
  const catalogFilter = useMemo<CatalogFilter>(
    () => ({
      scope: (CATALOG_SCOPES as readonly string[]).includes(scope)
        ? (scope as CatalogScope)
        : "all",
      productType: typeFilter === ALL_TYPES ? null : typeFromValue(typeFilter),
      collectionId: collectionFilter?.id ?? null,
      search: debouncedSearch,
    }),
    [scope, typeFilter, collectionFilter, debouncedSearch]
  );

  // Trang đang xem và lựa chọn gắn với bộ lọc: đổi bộ lọc thì về trang 1 và bỏ
  // chọn, không giữ sản phẩm merchant không còn thấy trên bảng.
  const [bulkState, setBulkState] = useState(() => initialBulkState(catalogFilter));
  const bulk = bulkState.filter === catalogFilter ? bulkState : initialBulkState(catalogFilter);
  const updateBulk = (update: (current: BulkState) => Partial<BulkState>) =>
    setBulkState((stored) => {
      const current = stored.filter === catalogFilter ? stored : initialBulkState(catalogFilter);
      return { ...current, ...update(current) };
    });
  const selectAllMatching = bulk.allMatching;
  const selectedProductIds = useMemo(() => [...bulk.selectedIds], [bulk.selectedIds]);

  const products = useQuery<StudioProductsResponse, Error>(
    ["catalogProducts", catalogFilter, bulk.page],
    () =>
      fetchJson<StudioProductsResponse>(
        studioProductsUrl(catalogFilter, bulk.page, PRODUCTS_PAGE_SIZE)
      ),
    // Ảnh mới từ webhook và kết quả publish chạy nền chỉ thấy được nhờ polling;
    // mỗi lần chỉ tải một trang nên nhẹ.
    { refetchOnWindowFocus: false, keepPreviousData: true, refetchInterval: 10_000 }
  );
  const pageProducts = useMemo(() => products.data?.products ?? [], [products.data]);
  const pageIds = useMemo(() => pageProducts.map((product) => product.id), [pageProducts]);
  // Dữ liệu cũ của bộ lọc trước (đang tải bộ lọc mới) không được dùng để tạo batch.
  const productsCurrent = products.data !== undefined && !products.isPreviousData;
  const matchingCount = products.data?.total ?? 0;
  const productPageCount = Math.max(1, Math.ceil(matchingCount / PRODUCTS_PAGE_SIZE));

  // Sản phẩm rời khỏi bộ lọc (ví dụ vừa được watermark) có thể làm mất trang cuối.
  useEffect(() => {
    if (productsCurrent && bulk.page > productPageCount) {
      updateBulk(() => ({ page: productPageCount }));
    }
  }, [productsCurrent, bulk.page, productPageCount]);

  const productTypes = useQuery<ProductTypesResponse, Error>(
    ["catalogProductTypes"],
    () => fetchJson<ProductTypesResponse>("/api/catalog/product-types"),
    { refetchOnWindowFocus: false }
  );

  // Collection chỉ có trên Shopify; thành viên collection hỏi trực tiếp Shopify,
  // không lưu trong catalog.
  const collections = useQuery<CollectionsResponse, Error>(
    ["catalogCollections", collectionQuery],
    () =>
      fetchJson<CollectionsResponse>(
        `/api/catalog/collections?query=${encodeURIComponent(collectionQuery)}`
      ),
    { enabled: isShopify, refetchOnWindowFocus: false, keepPreviousData: true }
  );

  const syncStatus = useQuery<CatalogSyncState, Error>(
    ["catalogSyncStatus"],
    () => fetchJson<CatalogSyncState>("/api/catalog/sync"),
    {
      enabled: isShopify,
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
    ["watermarkJobs", historyPage],
    () =>
      fetchJson<JobsResponse>(
        `/api/watermarks/jobs?page=${historyPage}&pageSize=${HISTORY_PAGE_SIZE}`
      ),
    // Kết quả xử lý và publish chạy nền nên vẫn polling, nhưng chỉ trang đang xem.
    { refetchOnWindowFocus: false, keepPreviousData: true, refetchInterval: 5_000 }
  );
  const historyPageCount = Math.max(
    1,
    Math.ceil((jobs.data?.total ?? 0) / HISTORY_PAGE_SIZE)
  );
  useEffect(() => {
    if (jobs.data && !jobs.isPreviousData && historyPage > historyPageCount) {
      setHistoryPage(historyPageCount);
    }
  }, [jobs.data, jobs.isPreviousData, historyPage, historyPageCount]);

  // Job đơn lẻ vừa tạo: hỏi riêng job đó thay vì dò trong lịch sử (có thể đang ở trang khác).
  const activeSingleJob = useQuery<JobResponse, Error>(
    ["watermarkJob", activeSingleJobId],
    () =>
      fetchJson<JobResponse>(
        `/api/watermarks/jobs/${encodeURIComponent(activeSingleJobId ?? "")}`
      ),
    { enabled: activeSingleJobId !== null, refetchOnWindowFocus: false, refetchInterval: 1_500 }
  );

  // Bản mới nhất của sản phẩm đang xem nếu nó nằm trên trang hiện tại.
  const freshFocusedProduct = focusedProduct
    ? pageProducts.find((product) => product.id === focusedProduct.id) ?? focusedProduct
    : null;
  const singleProduct = freshFocusedProduct ?? pageProducts[0] ?? null;

  // Đang tick sản phẩm ở tab hàng loạt thì xem mẫu sản phẩm tick đầu tiên trên trang.
  const activePreviewProduct =
    (selectedTab === 0
      ? pageProducts.find((product) => bulk.selectedIds.has(product.id))
      : undefined) ?? singleProduct;

  const handleSelectionChange = (
    selectionType: IndexTableSelectionType,
    selecting: boolean,
    selection?: string | [number, number]
  ) =>
    updateBulk((current) => {
      // Đang "chọn tất cả khớp bộ lọc" mà tick tay: bắt đầu từ các dòng đang thấy.
      const next = new Set(current.allMatching ? pageIds : current.selectedIds);
      const changed =
        selectionType === IndexTableSelectionType.Single && typeof selection === "string"
          ? [selection]
          : selectionType === IndexTableSelectionType.Multi && Array.isArray(selection)
            ? pageIds.slice(selection[0], selection[1] + 1)
            : pageIds;
      for (const id of changed) {
        if (selecting) next.add(id);
        else next.delete(id);
      }
      return { selectedIds: next, allMatching: false };
    });
  const clearBulkSelection = () =>
    updateBulk(() => ({ selectedIds: new Set<string>(), allMatching: false }));
  const pageSelectedCount = pageIds.filter((id) => bulk.selectedIds.has(id)).length;

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
          toast.show("Đã tải logo lên thành công");
        } catch (err: unknown) {
          toast.show(
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
        toast.show(`Đồng bộ thất bại: ${err.message}`, {
          isError: true,
        }),
    }
  );

  // Shop chưa từng đồng bộ catalog (chỉ có sản phẩm đến lẻ tẻ qua webhook, có thể
  // thiếu rất nhiều): tự đồng bộ toàn bộ lần đầu mở app.
  const autoSyncRequested = useRef(false);
  useEffect(() => {
    const state = syncStatus.data;
    if (!isShopify || !state || autoSyncRequested.current) return;
    if (state.status !== "IDLE" || state.syncId !== null) return;
    autoSyncRequested.current = true;
    syncCatalog.mutate();
    toast.show("Đang đồng bộ catalog lần đầu từ Shopify...");
  }, [syncStatus.data, syncCatalog, toast]);

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
      void queryClient.invalidateQueries(["catalogProducts"]);
      void queryClient.invalidateQueries(["catalogProductTypes"]);
      toast.show(`Đã đồng bộ ${state.syncedCount} sản phẩm`);
    } else if (state.status === "FAILED") {
      toast.show(
        `Đồng bộ thất bại: ${state.error ?? "Lỗi không rõ"}`,
        { isError: true }
      );
    }
  }, [syncStatus.data, queryClient, toast]);

  // --- Single Watermark Creation Mutation ---
  const createSingleJob = useMutation<JobResponse, Error>(
    async () => {
      return await fetchJson<JobResponse>("/api/watermarks/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId: singleProduct?.id,
          layers: toPayload(layers),
        }),
      });
    },
    {
      onSuccess: ({ job }) => {
        setActiveSingleJobId(job.id);
        void queryClient.invalidateQueries(["watermarkJobs"]);
        toast.show("Đã tạo yêu cầu, đang xử lý watermark ngầm...");
      },
      onError: (err) => {
        toast.show(`Tạo watermark thất bại: ${err.message}`, {
          isError: true,
        });
      },
    }
  );

  // Monitor single job completion
  useEffect(() => {
    if (!activeSingleJobId) return;
    const targetJob = activeSingleJob.data?.job;
    if (targetJob?.id !== activeSingleJobId) return;

    if (targetJob.status === "COMPLETED") {
      void queryClient.invalidateQueries(["watermarkJobs"]);
      toast.show("Đã xử lý xong ảnh watermark");
      setActiveSingleJobId(null);
    } else if (targetJob.status === "FAILED") {
      toast.show(
        `Xử lý watermark thất bại: ${
          targetJob.errorMessage ?? "Lỗi không xác định"
        }`,
        { isError: true }
      );
      setActiveSingleJobId(null);
    }
  }, [activeSingleJob.data, activeSingleJobId, queryClient, toast]);

  // --- Bulk Watermark Batch Creation Mutation ---
  const createBatch = useMutation<
    CreateBatchResponse,
    Error,
    {
      productIds?: string[];
      productType?: string;
      collectionId?: string;
      filter?: CatalogFilter;
    }
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
      onSuccess: async ({ batch, batches }) => {
        clearBulkSelection();
        await Promise.all([
          queryClient.invalidateQueries(["watermarkBatches"]),
          queryClient.invalidateQueries(["watermarkJobs"]),
          queryClient.invalidateQueries(["catalogProducts"]),
        ]);
        const created = batches ?? [batch];
        const totalJobs = created.reduce((sum, item) => sum + item.totalJobs, 0);
        const skipped = created.reduce((sum, item) => sum + item.skippedProducts, 0);
        const summary =
          created.length > 1
            ? `Đã tạo ${created.length} batch, tổng ${totalJobs.toLocaleString("vi-VN")} ảnh`
            : `Đã tạo batch ${totalJobs.toLocaleString("vi-VN")} ảnh`;
        toast.show(
          skipped > 0
            ? `${summary}, bỏ qua ${skipped} sản phẩm chưa đồng bộ hoặc không có ảnh`
            : `${summary}, đang xử lý ngầm`
        );
      },
      onError: (error) => {
        toast.show(`Không tạo được batch: ${error.message}`, {
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
        toast.show("Đã hủy các ảnh còn đang chờ trong batch");
      },
      onError: (err) =>
        toast.show(`Không hủy được batch: ${err.message}`, {
          isError: true,
        }),
    }
  );

  // Sản phẩm chọn qua ô tìm kiếm không nằm trên trang hiện tại nên không được
  // polling làm mới: cập nhật tay trạng thái watermark sau thao tác của chính merchant.
  const markFocusedWatermarked = (productId: string, isWatermarked: boolean) =>
    setFocusedProduct((current) =>
      current?.id === productId ? { ...current, isWatermarked } : current
    );

  // --- Publish to Shopify Mutation ---
  const publishToShopify = useMutation<PublishedMediaDto, Error, WatermarkJobDto>(
    (job) =>
      fetchJson<PublishedMediaDto>(
        `/api/publications/jobs/${encodeURIComponent(job.id)}`,
        { method: "POST" }
      ),
    {
      onSuccess: (_published, job) => {
        markFocusedWatermarked(job.productId, true);
        void queryClient.invalidateQueries(["watermarkJobs"]);
        void queryClient.invalidateQueries(["catalogProducts"]);
        toast.show("Đã đặt làm ảnh chính trên Shopify");
      },
      onError: (err) =>
        toast.show(`Không đưa được lên Shopify: ${err.message}`, {
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
        void queryClient.invalidateQueries(["watermarkJobs"]);
        void queryClient.invalidateQueries(["catalogProducts"]);
        toast.show("Đã khôi phục ảnh gốc trên Shopify thành công");
      },
      onError: (err) =>
        toast.show(`Không khôi phục được ảnh: ${err.message}`, {
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
      onSuccess: (_result, productId) => {
        markFocusedWatermarked(productId, false);
        void queryClient.invalidateQueries(["watermarkJobs"]);
        void queryClient.invalidateQueries(["catalogProducts"]);
        toast.show("Đã khôi phục ảnh gốc trên Shopify thành công");
      },
      onError: (err) =>
        toast.show(`Không khôi phục được ảnh: ${err.message}`, {
          isError: true,
        }),
    }
  );

  // --- Restore All Products Original Images Mutation (chạy nền trên server) ---
  const restoreAllProducts = useMutation<{ success: boolean; queuedCount: number }, Error, void>(
    () =>
      fetchJson<{ success: boolean; queuedCount: number }>("/api/publications/restore-all", {
        method: "POST",
      }),
    {
      onSuccess: ({ queuedCount }) => {
        void queryClient.invalidateQueries(["watermarkJobs"]);
        void queryClient.invalidateQueries(["catalogProducts"]);
        toast.show(
          queuedCount > 0
            ? `Đang khôi phục ảnh gốc cho ${queuedCount.toLocaleString("vi-VN")} sản phẩm (chạy ngầm)`
            : "Không có sản phẩm nào đang có ảnh watermark"
        );
      },
      onError: (err) =>
        toast.show(`Không thể khôi phục tất cả: ${err.message}`, {
          isError: true,
        }),
    }
  );

  // --- Khôi phục ảnh gốc các sản phẩm đã chọn (chạy nền trên server) ---
  const restoreSelected = useMutation<RestoreSelectedResponse, Error, void>(
    () =>
      fetchJson<RestoreSelectedResponse>("/api/publications/products/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          selectAllMatching ? { filter: catalogFilter } : { productIds: selectedProductIds }
        ),
      }),
    {
      onSuccess: ({ queuedCount, skippedCount }) => {
        clearBulkSelection();
        void queryClient.invalidateQueries(["catalogProducts"]);
        void queryClient.invalidateQueries(["watermarkJobs"]);
        const skipped =
          skippedCount > 0 ? `, bỏ qua ${skippedCount} ${ITEM} không có watermark` : "";
        toast.show(
          queuedCount > 0
            ? `Đang khôi phục ảnh gốc cho ${queuedCount.toLocaleString("vi-VN")} ${ITEM} (chạy ngầm)${skipped}`
            : `Các ${ITEM} đã chọn không có ảnh watermark nào để khôi phục`
        );
      },
      onError: (err) =>
        toast.show(`Không khôi phục được: ${err.message}`, { isError: true }),
    }
  );

  // --- Bulk Publish Batch Mutation ---
  const publishBatch = useMutation<
    { success: boolean; queuedCount: number; pendingCount?: number },
    Error,
    string
  >(
    (batchId) =>
      fetchJson<{ success: boolean; queuedCount: number; pendingCount?: number }>(
        `/api/publications/batches/${encodeURIComponent(batchId)}/publish-all`,
        { method: "POST" }
      ),
    {
      onSuccess: (data) => {
        void queryClient.invalidateQueries(["watermarkJobs"]);
        void queryClient.invalidateQueries(["catalogProducts"]);
        void queryClient.invalidateQueries(["watermarkBatches"]);
        const parts = [
          ...(data.queuedCount > 0
            ? [`Đã đưa ${data.queuedCount} ảnh vào hàng đợi xuất bản lên Shopify`]
            : []),
          // Server ghi nhận yêu cầu trên batch: ảnh xong sau lúc bấm cũng tự publish.
          ...(data.pendingCount
            ? [`${data.pendingCount} ảnh còn đang xử lý sẽ tự xuất bản khi xong`]
            : []),
        ];
        toast.show(
          parts.length > 0
            ? parts.join("; ")
            : "Không còn ảnh nào cần xuất bản trong batch này"
        );
      },
      onError: (err) =>
        toast.show(`Không thể xuất bản: ${err.message}`, {
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
        toast.show(
          `Đã giải phóng ${mb} MB (${data.deletedAssetsCount} file tạm trên server)!`
        );
      },
      onError: (err: unknown) =>
        toast.show(
          `Lỗi dọn dẹp: ${err instanceof Error ? err.message : String(err)}`,
          { isError: true }
        ),
    }
  );

  // --- Chế độ độc lập: xóa ảnh đã tải lên ---
  const refreshUploadedImages = () => {
    void queryClient.invalidateQueries(["catalogProducts"]);
    void queryClient.invalidateQueries(["catalogProductTypes"]);
  };

  const removeImage = useMutation<SuccessResponse, Error, string>(
    (productId) =>
      fetchJson<SuccessResponse>(
        `/api/standalone/images/${encodeURIComponent(productId)}`,
        { method: "DELETE" }
      ),
    {
      onSuccess: () => {
        refreshUploadedImages();
        toast.show("Đã xóa ảnh");
      },
      onError: (err) =>
        toast.show(`Không xóa được ảnh: ${err.message}`, { isError: true }),
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
        toast.show(`Đã lưu mẫu "${template.name}" thành công!`);
      },
      onError: (err: unknown) =>
        toast.show(
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
        toast.show("Đã xóa mẫu watermark");
      },
      onError: (err: unknown) =>
        toast.show(
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
      toast.show(
        `Không áp dụng được mẫu: ${error instanceof Error ? error.message : String(error)}`,
        { isError: true }
      );
      return;
    }
    setLayers(loaded);
    setSelectedLayerId(loaded[0].id);
    toast.show(`Đã áp dụng mẫu "${tmpl.name}"`);
  };

  const selectedType =
    typeFilter === ALL_TYPES
      ? null
      : (productTypes.data?.productTypes ?? []).find(
          (type) => typeValue(type.productType) === typeFilter
        ) ?? null;

  const canCreateBatch =
    selectedProductIds.length > 0 &&
    selectedProductIds.length <= MAX_MANUAL_SELECTION &&
    configurationValid;

  const filterBatchCount = Math.ceil(matchingCount / FILTER_BATCH_SIZE);
  const canCreateForFilter =
    productsCurrent &&
    matchingCount > 0 &&
    matchingCount <= MAX_FILTER_JOBS &&
    configurationValid;

  const canCreateForType =
    selectedType !== null &&
    selectedType.withImageCount > 0 &&
    selectedType.withImageCount <= 5_000 &&
    configurationValid;

  // Sản phẩm có ảnh trong catalog thuộc collection: đúng số job server sẽ tạo.
  const collectionWithImageCount = productsCurrent
    ? products.data?.collectionCount ?? null
    : null;
  const canCreateForCollection =
    collectionFilter !== null &&
    collectionWithImageCount !== null &&
    collectionWithImageCount > 0 &&
    collectionWithImageCount <= 5_000 &&
    configurationValid;

  const reviewCount = products.data?.reviewCount ?? 0;
  const isSyncing =
    syncCatalog.isLoading || syncStatus.data?.status === "RUNNING";

  // Khôi phục dùng chung lựa chọn với tab hàng loạt (cùng bảng, cùng bộ lọc).
  const selectedCount = selectAllMatching ? matchingCount : selectedProductIds.length;
  const canRestoreSelected = selectAllMatching
    ? productsCurrent && matchingCount > 0
    : selectedProductIds.length > 0 && selectedProductIds.length <= MAX_MANUAL_SELECTION;
  const restoreSelectedButton = (
    <Button
      destructive
      loading={restoreSelected.isLoading}
      disabled={!canRestoreSelected || restoreSelected.isLoading}
      onClick={() => restoreSelected.mutate()}
    >
      {selectedCount > 0
        ? `Khôi phục ảnh gốc ${selectedCount.toLocaleString("vi-VN")} ${ITEM} đã chọn`
        : `Khôi phục ảnh gốc (chọn ${ITEM} ở dưới)`}
    </Button>
  );

  const selectionBar = (
    <Stack distribution="equalSpacing" alignment="center">
      <Text as="span" variant="bodyMd" fontWeight="semibold">
        {selectAllMatching
          ? `Đã chọn tất cả ${matchingCount.toLocaleString("vi-VN")} ${ITEM} khớp bộ lọc`
          : `Đã chọn ${selectedProductIds.length.toLocaleString("vi-VN")} / ${matchingCount.toLocaleString("vi-VN")} ${ITEM}`}
      </Text>
      <ButtonGroup>
        <Button
          size="slim"
          disabled={!productsCurrent || matchingCount === 0 || selectAllMatching}
          onClick={() => updateBulk(() => ({ allMatching: true }))}
        >
          {`Chọn tất cả ${matchingCount.toLocaleString("vi-VN")} ${ITEM} khớp bộ lọc`}
        </Button>
        <Button
          size="slim"
          disabled={!selectAllMatching && selectedProductIds.length === 0}
          onClick={clearBulkSelection}
        >
          Bỏ chọn
        </Button>
      </ButtonGroup>
    </Stack>
  );
  const filterActive =
    catalogFilter.scope !== "all" ||
    catalogFilter.productType !== null ||
    catalogFilter.collectionId !== null ||
    catalogFilter.search.trim() !== "";

  // Bulk table rows
  const bulkRows = pageProducts.map((product, index) => {
    const isWatermarked = product.isWatermarked;
    return (
      <IndexTable.Row
        id={product.id}
        key={product.id}
        position={index}
        selected={selectAllMatching || bulk.selectedIds.has(product.id)}
      >
        <IndexTable.Cell>
          <Stack spacing="tight" alignment="center">
            <Thumbnail
              source={product.imageUrl}
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
            {!isShopify ? (
              <Badge>{product.productType || "Ảnh tải lên"}</Badge>
            ) : product.needsReview ? (
              <Badge status="attention">Ảnh mới – cần duyệt</Badge>
            ) : (
              <Badge status="success">{`Đã đồng bộ (v${product.sourceVersion})`}</Badge>
            )}
          </Stack>
        </IndexTable.Cell>
        <IndexTable.Cell>
          {/* Bấm nút trong dòng không được tick/bỏ tick dòng (click nổi lên tới Row). */}
          <div onClick={(event) => event.stopPropagation()}>
            <Stack spacing="extraTight" alignment="center">
              <Button
                plain
                size="slim"
                onClick={() => setFocusedProduct(product)}
              >
                Xem mẫu
              </Button>
              {!isShopify && (
                <Button
                  plain
                  destructive
                  size="slim"
                  loading={removeImage.isLoading && removeImage.variables === product.id}
                  disabled={removeImage.isLoading}
                  onClick={() => removeImage.mutate(product.id)}
                >
                  Xóa ảnh
                </Button>
              )}
              {isShopify && isWatermarked && (
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
          </div>
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
        {isShopify && batch.completedJobs > 0 && (
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
        {(!isShopify || batch.completedJobs === 0) &&
          batch.status !== "QUEUED" &&
          batch.status !== "RUNNING" && (
          <Text as="span" variant="bodySm" color="subdued">—</Text>
        )}
      </Stack>,
    ];
  });

  // History job rows
  const jobRows = (jobs.data?.jobs ?? []).map((job) => {
    const title = job.productTitle;
    const isJobPublished = job.published;

    return [
      new Intl.DateTimeFormat("vi-VN", {
        dateStyle: "short",
        timeStyle: "medium",
      }).format(new Date(job.createdAt)),
      title,
      job.summary || "—",
      jobStatusBadge(job.status),
      job.resultUrl && !isShopify ? (
        <Stack key={`${job.id}-actions`} spacing="tight" alignment="center">
          <Button plain url={job.resultUrl} external>
            Xem ảnh
          </Button>
          {/* SharpWatermarkProcessor luôn xuất WebP. */}
          <Button size="slim" url={job.resultUrl} external download={`${title}-watermark.webp`}>
            Tải về
          </Button>
        </Stack>
      ) : job.resultUrl ? (
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
              {isShopify
                ? "Tùy chỉnh watermark và áp dụng cho từng sản phẩm hoặc hàng loạt trên cửa hàng Shopify."
                : "Tải ảnh lên, tùy chỉnh watermark rồi áp dụng cho từng ảnh hoặc hàng loạt và tải kết quả về."}
            </Text>
          </Stack>
          {isShopify && (
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
          )}
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

      {!isShopify && <StandaloneImageUploader onUploaded={refreshUploadedImages} />}

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
                <ProductPicker
                  label={isShopify ? "Chọn sản phẩm xem mẫu" : "Chọn ảnh xem mẫu"}
                  selected={activePreviewProduct}
                  onSelect={setFocusedProduct}
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
                        {isShopify ? "Ảnh gốc trên Shopify" : "Ảnh gốc"}
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
                    : isShopify
                      ? "✅ Đang hiển thị ảnh gốc thực tế trên Shopify (không có watermark)."
                      : "✅ Đang hiển thị ảnh gốc bạn đã tải lên (không có watermark)."}
                </Text>

                {isShopify && activePreviewProduct && (
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
                          {activePreviewProduct.isWatermarked
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
              content: isShopify ? "Watermark 1 sản phẩm" : "Watermark 1 ảnh",
              panelID: "single-panel",
            },
            // Khôi phục ảnh gốc là thao tác trên cửa hàng Shopify.
            ...(isShopify
              ? [
                  {
                    id: "restore-tab",
                    content: "Khôi phục ảnh gốc (Hoàn tác)",
                    panelID: "restore-panel",
                  },
                ]
              : []),
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
                {/* Trạng thái duyệt / đã lên Shopify và thư viện ảnh chỉ có ở catalog Shopify. */}
                {isShopify && (
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
                )}
                {isShopify && (
                  <Select
                    label="Phạm vi ảnh áp dụng"
                    options={[
                      { label: "Ảnh đại diện chính (Primary)", value: "PRIMARY" },
                      { label: "Tất cả ảnh thư viện (Gallery)", value: "ALL" },
                    ]}
                    value={targetMediaScope}
                    onChange={(val) => setTargetMediaScope(val as "PRIMARY" | "ALL")}
                  />
                )}
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
                {isShopify && (
                  <Autocomplete
                    options={(collections.data?.collections ?? []).map((collection) => ({
                      value: collection.id,
                      label:
                        collection.productsCount === null
                          ? collection.title
                          : `${collection.title} (${collection.productsCount})`,
                    }))}
                    selected={collectionFilter ? [collectionFilter.id] : []}
                    onSelect={([id]) => {
                      const collection =
                        collections.data?.collections.find((c) => c.id === id) ?? null;
                      setCollectionFilter(collection);
                      setCollectionInput(collection?.title ?? "");
                    }}
                    loading={collections.isFetching}
                    emptyState={
                      <Text as="p" variant="bodySm" color="subdued">
                        {collections.isError
                          ? `Không tải được collection: ${collections.error.message}`
                          : "Không tìm thấy collection"}
                      </Text>
                    }
                    textField={
                      <Autocomplete.TextField
                        label="Collection"
                        value={collectionInput}
                        onChange={(value) => {
                          setCollectionInput(value);
                          // Sửa chữ nghĩa là đang tìm collection khác: bỏ lọc cũ.
                          if (collectionFilter && value !== collectionFilter.title) {
                            setCollectionFilter(null);
                          }
                        }}
                        placeholder="Tất cả collection"
                        autoComplete="off"
                        clearButton
                        onClearButtonClick={() => {
                          setCollectionInput("");
                          setCollectionFilter(null);
                        }}
                      />
                    }
                  />
                )}
                <TextField
                  label={`Tìm ${ITEM}`}
                  value={search}
                  autoComplete="off"
                  onChange={setSearch}
                  placeholder={`Nhập tên ${ITEM}...`}
                  clearButton
                  onClearButtonClick={() => setSearch("")}
                />
              </Stack>

              {selectionBar}
              {(selectedProductIds.length > MAX_MANUAL_SELECTION || isSyncing) && (
                <Text as="p" variant="bodySm" color="subdued">
                  {[
                    selectedProductIds.length > MAX_MANUAL_SELECTION
                      ? `Chọn tay tối đa ${MAX_MANUAL_SELECTION.toLocaleString("vi-VN")} ${ITEM} mỗi batch; nhiều hơn thì dùng "Chọn tất cả … khớp bộ lọc".`
                      : null,
                    isSyncing
                      ? "Catalog đang đồng bộ nên số sản phẩm còn tăng; batch lấy đủ sản phẩm có tại lúc bấm tạo."
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" ")}
                </Text>
              )}
              {products.isError && (
                <Banner
                  status="critical"
                  title={`Không tải được danh sách ${ITEM}: ${products.error.message}`}
                />
              )}

              {/* Products Table: mỗi lần một trang từ server; lựa chọn giữ qua các trang */}
              <IndexTable
                resourceName={{ singular: ITEM, plural: ITEM }}
                itemCount={pageProducts.length}
                selectedItemsCount={selectAllMatching ? "All" : pageSelectedCount}
                onSelectionChange={handleSelectionChange}
                headings={[
                  { title: "Sản phẩm" },
                  { title: "Trạng thái ảnh" },
                  { title: "Thao tác" },
                ]}
                loading={products.isLoading || (products.isFetching && products.isPreviousData)}
              >
                {bulkRows}
              </IndexTable>
              <PageControls
                page={bulk.page}
                pageCount={productPageCount}
                label={`Trang ${bulk.page}/${productPageCount} · ${matchingCount.toLocaleString("vi-VN")} ${ITEM}`}
                onChange={(page) => updateBulk(() => ({ page }))}
              />

              {/* Action Buttons for Batch */}
              <Stack distribution="equalSpacing" alignment="center">
                <Text as="span" variant="bodySm" color="subdued">
                  {isShopify
                    ? "Ảnh hoàn tất được lưu trong app. Bạn có thể xem kết quả rồi chọn đưa lên Shopify."
                    : "Ảnh hoàn tất được lưu trong app. Xem và tải về ở mục Lịch sử watermark bên dưới."}
                </Text>
                <Stack spacing="tight">
                  {collectionFilter && (
                    <Button
                      loading={createBatch.isLoading}
                      disabled={!canCreateForCollection || createBatch.isLoading}
                      onClick={() =>
                        createBatch.mutate({ collectionId: collectionFilter.id })
                      }
                    >
                      {collectionWithImageCount !== null
                        ? `Watermark cả collection "${collectionFilter.title}" (${collectionWithImageCount})`
                        : `Watermark cả collection "${collectionFilter.title}"`}
                    </Button>
                  )}
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
                  {isShopify && restoreSelectedButton}
                  <Button
                    primary
                    size="large"
                    loading={createBatch.isLoading}
                    disabled={
                      (selectAllMatching ? !canCreateForFilter : !canCreateBatch) ||
                      createBatch.isLoading
                    }
                    onClick={() =>
                      createBatch.mutate(
                        selectAllMatching
                          ? { filter: catalogFilter }
                          : { productIds: selectedProductIds }
                      )
                    }
                  >
                    {selectAllMatching
                      ? `Tạo batch watermark (${matchingCount.toLocaleString("vi-VN")} ${ITEM}${
                          filterBatchCount > 1 ? `, chia ${filterBatchCount} batch` : ""
                        })`
                      : selectedProductIds.length > 0
                        ? `Tạo batch watermark (${selectedProductIds.length} ${ITEM})`
                        : `Tạo batch watermark (chọn ${ITEM} ở trên)`}
                  </Button>
                </Stack>
              </Stack>
            </Stack>
          ) : selectedTab === 1 ? (
            /* TAB 1: SINGLE WATERMARK */
            <Stack vertical spacing="loose">
              <ProductPicker
                label={`Chọn ${ITEM} áp dụng`}
                selected={singleProduct}
                onSelect={setFocusedProduct}
              />

              {isShopify && (() => {
                if (!singleProduct?.isWatermarked) return null;
                return (
                  <Banner
                    status="info"
                    title="Sản phẩm này đang dùng ảnh Watermark trên Shopify"
                    action={{
                      content: "Khôi phục ảnh gốc trên Shopify",
                      destructive: true,
                      loading:
                        restoreProduct.isLoading &&
                        restoreProduct.variables === singleProduct.id,
                      disabled: restoreProduct.isLoading,
                      onAction: () => restoreProduct.mutate(singleProduct.id),
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
                  disabled={!configurationValid || !singleProduct}
                  onClick={() => createSingleJob.mutate()}
                >
                  {`Tạo watermark cho ${ITEM} này`}
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
                <ButtonGroup>
                  {restoreSelectedButton}
                  <Button
                    destructive
                    loading={restoreAllProducts.isLoading}
                    disabled={restoreAllProducts.isLoading}
                    onClick={() => restoreAllProducts.mutate()}
                  >
                    Khôi phục tất cả sản phẩm
                  </Button>
                </ButtonGroup>
              </Stack>

              {selectionBar}
              {filterActive && (
                <Text as="p" variant="bodySm" color="subdued">
                  Danh sách đang theo bộ lọc ở tab "Watermark hàng loạt"; lựa chọn dùng chung giữa hai tab.
                </Text>
              )}

              <IndexTable
                resourceName={{ singular: "sản phẩm", plural: "sản phẩm" }}
                itemCount={pageProducts.length}
                selectedItemsCount={selectAllMatching ? "All" : pageSelectedCount}
                onSelectionChange={handleSelectionChange}
                headings={[
                  { title: "Sản phẩm" },
                  { title: "Trạng thái ảnh" },
                  { title: "Thao tác" },
                ]}
                loading={products.isLoading || (products.isFetching && products.isPreviousData)}
              >
                {pageProducts.map((product, index) => {
                  const isWatermarked = product.isWatermarked;
                  return (
                    // id phải là GID thật: Polaris trả id này khi tick dòng.
                    <IndexTable.Row
                      id={product.id}
                      key={`restore-${product.id}`}
                      position={index}
                      selected={selectAllMatching || bulk.selectedIds.has(product.id)}
                    >
                      <IndexTable.Cell>
                        <Stack spacing="tight" alignment="center">
                          <Thumbnail
                            source={product.imageUrl}
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
                        <div onClick={(event) => event.stopPropagation()}>
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
                        </div>
                      </IndexTable.Cell>
                    </IndexTable.Row>
                  );
                })}
              </IndexTable>
              <PageControls
                page={bulk.page}
                pageCount={productPageCount}
                label={`Trang ${bulk.page}/${productPageCount} · ${matchingCount.toLocaleString("vi-VN")} ${ITEM}`}
                onChange={(page) => updateBulk(() => ({ page }))}
              />
            </Stack>
          )}
        </Card.Section>
      </Card>

      {/* Card Rules (components/AutoWatermarkRules.tsx) đang tạm ẩn; backend auto-watermark vẫn giữ nguyên. */}

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
        ) : jobs.isError ? (
          <Banner status="critical" title={`Không tải được lịch sử: ${jobs.error.message}`} />
        ) : jobRows.length === 0 ? (
          <p>Chưa có watermark job nào hoàn tất.</p>
        ) : (
          <>
            <DataTable
              columnContentTypes={["text", "text", "text", "text", "text"]}
              headings={["Thời gian", "Sản phẩm", "Nội dung", "Trạng thái", "Kết quả / Thao tác"]}
              rows={jobRows}
            />
            <PageControls
              page={historyPage}
              pageCount={historyPageCount}
              label={`Trang ${historyPage}/${historyPageCount} · ${(jobs.data?.total ?? 0).toLocaleString("vi-VN")} job`}
              onChange={setHistoryPage}
            />
          </>
        )}
      </Card>
    </Stack>
  );
}

interface BulkState {
  /** Bộ lọc mà trang và lựa chọn này thuộc về. */
  filter: CatalogFilter;
  page: number;
  /** Sản phẩm tick tay, giữ qua các trang của cùng bộ lọc. */
  selectedIds: ReadonlySet<string>;
  /** "Chọn tất cả sản phẩm khớp bộ lọc": gửi bộ lọc lên server thay vì danh sách ID. */
  allMatching: boolean;
}

function initialBulkState(filter: CatalogFilter): BulkState {
  return { filter, page: 1, selectedIds: new Set(), allMatching: false };
}

function PageControls({
  page,
  pageCount,
  label,
  onChange,
}: {
  page: number;
  pageCount: number;
  label: string;
  onChange(page: number): void;
}) {
  if (pageCount <= 1) return null;
  return (
    <div style={{ display: "flex", justifyContent: "center", paddingTop: "12px" }}>
      <Pagination
        label={label}
        hasPrevious={page > 1}
        onPrevious={() => onChange(page - 1)}
        hasNext={page < pageCount}
        onNext={() => onChange(page + 1)}
      />
    </div>
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
