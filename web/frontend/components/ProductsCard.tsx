import {
  Badge,
  Banner,
  Button,
  Card,
  DataTable,
  Text,
  Thumbnail,
} from "@shopify/polaris";
import { useAppBridge } from "@shopify/app-bridge-react";
import { useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";

interface CatalogSyncState {
  syncId: string | null;
  status: "IDLE" | "RUNNING" | "COMPLETED" | "FAILED";
  syncedCount: number;
  error: string | null;
}

interface ProductDto {
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

export function ProductsCard() {
  const shopify = useAppBridge();
  const queryClient = useQueryClient();

  const { data, isLoading, isError, error, refetch } = useQuery<
    CatalogResponse,
    Error
  >(
    ["catalogProducts"],
    async () => {
      const response = await fetch("/api/catalog/products");

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      return await response.json();
    },
    {
      refetchOnWindowFocus: false,
      refetchInterval: 5_000,
    }
  );

  const syncStatus = useQuery<CatalogSyncState, Error>(
    ["catalogSyncStatus"],
    async () => {
      const response = await fetch("/api/catalog/sync");

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      return await response.json();
    },
    {
      refetchOnWindowFocus: false,
      refetchInterval: (state) => (state?.status === "RUNNING" ? 2_000 : false),
    }
  );

  const syncCatalog = useMutation<CatalogSyncState, Error>(
    async () => {
      const response = await fetch("/api/catalog/sync", {
        method: "POST",
      });

      if (!response.ok) {
        const message = await response.text();
        throw new Error(message || `HTTP ${response.status}`);
      }

      return await response.json();
    },
    {
      onSuccess: async () => {
        await syncStatus.refetch();
      },
      onError: (syncError) => {
        shopify.toast.show(`Đồng bộ thất bại: ${syncError.message}`, {
          isError: true,
        });
      },
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
      void refetch();
      void queryClient.invalidateQueries(["catalogProductTypes"]);
      shopify.toast.show(`Đã đồng bộ ${state.syncedCount} sản phẩm`);
    } else if (state.status === "FAILED") {
      shopify.toast.show(`Đồng bộ thất bại: ${state.error ?? "Lỗi không rõ"}`, {
        isError: true,
      });
    }
  }, [syncStatus.data, refetch, queryClient, shopify]);

  const isSyncing =
    syncCatalog.isLoading || syncStatus.data?.status === "RUNNING";

  if (isLoading) {
    return (
      <Card sectioned>
        <p>Đang tải catalog...</p>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card sectioned>
        <p>Không tải được catalog: {error.message}</p>
      </Card>
    );
  }

  const products = data?.products ?? [];

  const rows = products.map((product) => [
    product.imageUrl ? (
      <Thumbnail
        key={`${product.id}-image`}
        source={product.imageUrl}
        alt={product.imageAltText ?? product.title}
        size="small"
      />
    ) : (
      "Không có ảnh"
    ),

    <Text
      key={`${product.id}-title`}
      as="span"
      variant="bodyMd"
      fontWeight="semibold"
    >
      {product.title}
    </Text>,

    <Badge
      key={`${product.id}-status`}
      status={product.status === "ACTIVE" ? "success" : "attention"}
    >
      {product.status}
    </Badge>,

    product.needsReview ? (
      <Badge key={`${product.id}-source`} status="attention">
        Ảnh mới – cần duyệt
      </Badge>
    ) : (
      <Badge key={`${product.id}-source`} status="success">
        {`Đã đồng bộ (v${product.sourceVersion})`}
      </Badge>
    ),

    product.id,
  ]);

  const reviewCount = products.filter((product) => product.needsReview).length;

  return (
    <Card sectioned>
      <Text as="h2" variant="headingMd">
        Shopify catalog
      </Text>

      {reviewCount > 0 && (
        <div style={{ marginTop: "16px" }}>
          <Banner status="warning" title={`${reviewCount} sản phẩm có ảnh mới`}>
            <p>Chọn các sản phẩm này ở Bulk Watermark để tạo lại ảnh.</p>
          </Banner>
        </div>
      )}

      <div style={{ marginTop: "16px" }}>
        <Button
          primary
          loading={isSyncing}
          disabled={isSyncing}
          onClick={() => syncCatalog.mutate()}
        >
          Đồng bộ từ Shopify
        </Button>
        {syncStatus.data?.status === "RUNNING" && (
          <div style={{ marginTop: "8px" }}>
            <Text as="p" variant="bodySm" color="subdued">
              {`Đang đồng bộ... ${syncStatus.data.syncedCount} sản phẩm`}
            </Text>
          </div>
        )}
      </div>

      <div style={{ marginTop: "16px" }}>
        <DataTable
          columnContentTypes={["text", "text", "text", "text", "text"]}
          headings={[
            "Ảnh",
            "Tên sản phẩm",
            "Trạng thái",
            "Ảnh nguồn",
            "Shopify ID",
          ]}
          rows={rows}
        />
      </div>
    </Card>
  );
}
