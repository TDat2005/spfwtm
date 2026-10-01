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
import { useMutation, useQuery } from "react-query";

interface SyncCatalogResponse {
  syncedCount: number;
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

  const syncCatalog = useMutation<SyncCatalogResponse, Error>(
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
      onSuccess: async ({ syncedCount }) => {
        await refetch();
        shopify.toast.show(`Đã đồng bộ ${syncedCount} sản phẩm`);
      },
      onError: (syncError) => {
        shopify.toast.show(`Đồng bộ thất bại: ${syncError.message}`, {
          isError: true,
        });
      },
    }
  );

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
          loading={syncCatalog.isLoading}
          disabled={syncCatalog.isLoading}
          onClick={() => syncCatalog.mutate()}
        >
          Đồng bộ từ Shopify
        </Button>
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
