import {
  Badge,
  Banner,
  Button,
  ButtonGroup,
  Card,
  Checkbox,
  DataTable,
  FormLayout,
  Select,
  Stack,
  Text,
  TextField,
} from "@shopify/polaris";
import { useAppBridge } from "@shopify/app-bridge-react";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import type { SerializedWatermarkLayer } from "../../src/modules/watermark/domain/WatermarkDesign.ts";
import { fetchJson } from "../utils/fetchJson";

type RuleScope = "ALL" | "COLLECTION" | "PRODUCT_TYPE";

interface RuleDto {
  id: string;
  name: string;
  enabled: boolean;
  priority: number;
  scope: RuleScope;
  scopeValue: string | null;
  scopeLabel: string | null;
  onNewProduct: boolean;
  onPrimaryChanged: boolean;
  syncScope: boolean;
  autoPublish: boolean;
  restoreOnLeave: boolean;
  lastAppliedAt: string | null;
  design: { layers: SerializedWatermarkLayer[]; summary: string } | null;
}

interface CollectionDto {
  id: string;
  title: string;
  productsCount: number | null;
}

interface AutoWatermarkRulesProps {
  /** Thiết kế đang mở trong trình chỉnh sửa; rule mới dùng bản chụp của nó. */
  layers: SerializedWatermarkLayer[];
  designError: string | null;
  productTypes: Array<{ productType: string; withImageCount: number }>;
}

const RULES_KEY = ["autoWatermarkRules"];
const TYPE_PREFIX = "type:";

const emptyForm = {
  name: "",
  scope: "COLLECTION" as RuleScope,
  collectionId: "",
  productType: "",
  priority: "0",
  onNewProduct: true,
  onPrimaryChanged: true,
  syncScope: true,
  autoPublish: false,
  restoreOnLeave: false,
  applyNow: true,
};

export function AutoWatermarkRules({ layers, designError, productTypes }: AutoWatermarkRulesProps) {
  const shopify = useAppBridge();
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [collectionQuery, setCollectionQuery] = useState("");
  const debouncedQuery = useDebounced(collectionQuery, 400);
  const update = (patch: Partial<typeof emptyForm>) => setForm((current) => ({ ...current, ...patch }));

  const rules = useQuery(RULES_KEY, () => fetchJson<{ rules: RuleDto[] }>("/api/auto-watermark/rules"), {
    refetchOnWindowFocus: false,
    refetchInterval: 15_000,
  });
  const collections = useQuery(
    ["autoWatermarkCollections", debouncedQuery],
    () =>
      fetchJson<{ collections: CollectionDto[] }>(
        `/api/auto-watermark/collections?query=${encodeURIComponent(debouncedQuery)}`
      ),
    { enabled: showForm && form.scope === "COLLECTION", refetchOnWindowFocus: false }
  );

  const onError = (prefix: string) => (error: unknown) =>
    shopify.toast.show(`${prefix}: ${error instanceof Error ? error.message : String(error)}`, {
      isError: true,
    });
  const refresh = () => void queryClient.invalidateQueries(RULES_KEY);

  const createRule = useMutation(
    () =>
      fetchJson<{ rule: { id: string } }>("/api/auto-watermark/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          scope: form.scope,
          scopeValue:
            form.scope === "COLLECTION"
              ? form.collectionId
              : form.scope === "PRODUCT_TYPE"
                ? form.productType.slice(TYPE_PREFIX.length)
                : null,
          priority: Number(form.priority),
          onNewProduct: form.onNewProduct,
          onPrimaryChanged: form.onPrimaryChanged,
          syncScope: form.syncScope,
          autoPublish: form.autoPublish,
          restoreOnLeave: form.restoreOnLeave,
          applyNow: form.applyNow,
          layers,
        }),
      }),
    {
      onSuccess: () => {
        refresh();
        setShowForm(false);
        setForm(emptyForm);
        shopify.toast.show(
          form.applyNow
            ? "Đã tạo rule, đang áp cho sản phẩm trong phạm vi"
            : "Đã tạo rule"
        );
      },
      onError: onError("Không tạo được rule"),
    }
  );

  const patchRule = useMutation(
    ({ id, body }: { id: string; body: Record<string, unknown>; message: string }) =>
      fetchJson(`/api/auto-watermark/rules/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    {
      onSuccess: (_data, { message }) => {
        refresh();
        shopify.toast.show(message);
      },
      onError: onError("Không cập nhật được rule"),
    }
  );

  const applyRule = useMutation(
    (id: string) =>
      fetchJson(`/api/auto-watermark/rules/${encodeURIComponent(id)}/apply`, { method: "POST" }),
    {
      onSuccess: () => {
        refresh();
        shopify.toast.show("Đang áp rule cho sản phẩm trong phạm vi, theo dõi ở mục Tiến độ batch");
      },
      onError: onError("Không áp dụng được rule"),
    }
  );

  const deleteRule = useMutation(
    (id: string) =>
      fetchJson(`/api/auto-watermark/rules/${encodeURIComponent(id)}`, { method: "DELETE" }),
    {
      onSuccess: () => {
        refresh();
        shopify.toast.show("Đã xóa rule");
      },
      onError: onError("Không xóa được rule"),
    }
  );

  const busy = patchRule.isLoading || applyRule.isLoading || deleteRule.isLoading;
  const scopeReady =
    form.scope === "ALL" ||
    (form.scope === "COLLECTION" && form.collectionId !== "") ||
    (form.scope === "PRODUCT_TYPE" && form.productType !== "");
  const canCreate =
    form.name.trim() !== "" && scopeReady && designError === null && Number.isInteger(Number(form.priority));

  const rows = (rules.data?.rules ?? []).map((rule) => [
    <Stack key={`${rule.id}-name`} vertical spacing="extraTight">
      <Text as="span" variant="bodyMd" fontWeight="semibold">
        {rule.name}
      </Text>
      <Text as="span" variant="bodySm" color="subdued">
        {scopeText(rule)}
      </Text>
    </Stack>,
    rule.design?.summary ?? "—",
    triggerText(rule),
    String(rule.priority),
    <Stack key={`${rule.id}-status`} vertical spacing="extraTight">
      {rule.enabled ? <Badge status="success">Đang bật</Badge> : <Badge>Đang tắt</Badge>}
      {rule.lastAppliedAt && (
        <Text as="span" variant="bodySm" color="subdued">
          {`Áp lần cuối: ${new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short" }).format(new Date(rule.lastAppliedAt))}`}
        </Text>
      )}
    </Stack>,
    <ButtonGroup key={`${rule.id}-actions`}>
      <Button
        size="slim"
        disabled={busy}
        onClick={() =>
          patchRule.mutate({
            id: rule.id,
            body: { enabled: !rule.enabled },
            message: rule.enabled ? "Đã tắt rule" : "Đã bật rule",
          })
        }
      >
        {rule.enabled ? "Tắt" : "Bật"}
      </Button>
      <Button size="slim" disabled={busy || !rule.enabled} onClick={() => applyRule.mutate(rule.id)}>
        Áp dụng ngay
      </Button>
      <Button
        size="slim"
        disabled={busy || designError !== null}
        onClick={() =>
          patchRule.mutate({
            id: rule.id,
            body: { layers },
            message: "Đã cập nhật thiết kế; bấm Áp dụng ngay để đóng dấu lại sản phẩm",
          })
        }
      >
        Dùng thiết kế đang mở
      </Button>
      <Button size="slim" destructive disabled={busy} onClick={() => deleteRule.mutate(rule.id)}>
        Xóa
      </Button>
    </ButtonGroup>,
  ]);

  return (
    <Card sectioned title="Tự động đóng dấu (Rules)">
      <Stack vertical spacing="loose">
        <Text as="p" variant="bodySm" color="subdued">
          Mỗi sản phẩm chỉ thuộc về rule đang bật có độ ưu tiên cao nhất khớp với nó. Shopify không báo khi
          sản phẩm được thêm vào hoặc rời khỏi collection, nên hãy bật "Đồng bộ phạm vi" để app kiểm tra lại
          mỗi đêm. Sản phẩm có ảnh watermark bạn tự làm sẽ không bị rule đóng dấu đè khi đồng bộ.
        </Text>

        {rows.length > 0 ? (
          <DataTable
            columnContentTypes={["text", "text", "text", "numeric", "text", "text"]}
            headings={["Rule", "Thiết kế", "Khi nào chạy", "Ưu tiên", "Trạng thái", "Thao tác"]}
            rows={rows}
          />
        ) : (
          <Text as="p" variant="bodyMd" color="subdued">
            {rules.isLoading ? "Đang tải rule..." : "Chưa có rule nào."}
          </Text>
        )}

        {!showForm ? (
          <div>
            <Button onClick={() => setShowForm(true)}>Tạo rule từ thiết kế đang mở</Button>
          </div>
        ) : (
          <div style={{ padding: "12px", border: "1px solid #E1E3E5", borderRadius: "8px" }}>
            <FormLayout>
              <TextField
                label="Tên rule"
                value={form.name}
                onChange={(name) => update({ name })}
                autoComplete="off"
                placeholder="Ví dụ: Đóng dấu SALE cho collection Khuyến mãi"
              />
              <FormLayout.Group>
                <Select
                  label="Phạm vi"
                  options={[
                    { label: "Một collection", value: "COLLECTION" },
                    { label: "Một loại sản phẩm", value: "PRODUCT_TYPE" },
                    { label: "Toàn bộ cửa hàng", value: "ALL" },
                  ]}
                  value={form.scope}
                  onChange={(scope) => update({ scope: scope as RuleScope })}
                />
                <TextField
                  label="Độ ưu tiên"
                  type="number"
                  value={form.priority}
                  onChange={(priority) => update({ priority })}
                  autoComplete="off"
                  helpText="Số lớn hơn thắng khi sản phẩm khớp nhiều rule (-1000 đến 1000)"
                />
              </FormLayout.Group>

              {form.scope === "COLLECTION" && (
                <FormLayout.Group>
                  <TextField
                    label="Tìm collection"
                    value={collectionQuery}
                    onChange={setCollectionQuery}
                    autoComplete="off"
                    placeholder="Nhập tên collection..."
                  />
                  <Select
                    label="Collection"
                    options={[
                      {
                        label: collections.isLoading ? "Đang tải..." : "— Chọn collection —",
                        value: "",
                      },
                      ...(collections.data?.collections ?? []).map((collection) => ({
                        label:
                          collection.productsCount === null
                            ? collection.title
                            : `${collection.title} (${collection.productsCount})`,
                        value: collection.id,
                      })),
                    ]}
                    value={form.collectionId}
                    onChange={(collectionId) => update({ collectionId })}
                  />
                </FormLayout.Group>
              )}
              {form.scope === "PRODUCT_TYPE" && (
                <Select
                  label="Loại sản phẩm"
                  options={[
                    { label: "— Chọn loại sản phẩm —", value: "" },
                    // "" là nhóm chưa phân loại, nên value phải có tiền tố để khác "chưa chọn".
                    ...productTypes.map((type) => ({
                      label: `${type.productType || "Chưa phân loại"} (${type.withImageCount})`,
                      value: `${TYPE_PREFIX}${type.productType}`,
                    })),
                  ]}
                  value={form.productType}
                  onChange={(productType) => update({ productType })}
                />
              )}

              <Stack vertical spacing="extraTight">
                <Checkbox
                  label="Khi có sản phẩm mới"
                  checked={form.onNewProduct}
                  onChange={(onNewProduct) => update({ onNewProduct })}
                />
                <Checkbox
                  label="Khi merchant đổi ảnh chính"
                  checked={form.onPrimaryChanged}
                  onChange={(onPrimaryChanged) => update({ onPrimaryChanged })}
                />
                <Checkbox
                  label="Đồng bộ phạm vi: áp cho sản phẩm đang có, kiểm tra lại mỗi đêm"
                  checked={form.syncScope}
                  onChange={(syncScope) => update({ syncScope })}
                />
                <Checkbox
                  label="Tự đưa ảnh lên Shopify (thay ảnh watermark cũ của app)"
                  checked={form.autoPublish}
                  onChange={(autoPublish) => update({ autoPublish })}
                  helpText="Tắt thì ảnh chỉ được tạo trong app để bạn xem trước rồi tự xuất bản."
                />
                <Checkbox
                  label="Khi sản phẩm rời phạm vi: gỡ ảnh watermark của rule này trên Shopify"
                  checked={form.restoreOnLeave}
                  onChange={(restoreOnLeave) => update({ restoreOnLeave })}
                  helpText="Kiểm tra mỗi đêm. Chỉ gỡ ảnh do chính rule này đưa lên; ảnh bạn tự làm và ảnh gốc luôn được giữ."
                />
                <Checkbox
                  label="Áp ngay cho sản phẩm đang nằm trong phạm vi"
                  checked={form.applyNow}
                  onChange={(applyNow) => update({ applyNow })}
                />
              </Stack>

              {designError ? (
                <Banner status="critical" title={`Thiết kế đang mở chưa hợp lệ: ${designError}`} />
              ) : (
                <Text as="p" variant="bodySm" color="subdued">
                  {`Rule sẽ dùng thiết kế đang mở (${layers.filter((layer) => layer.enabled).length} lớp đang bật).`}
                </Text>
              )}

              <Stack distribution="trailing">
                <Button onClick={() => setShowForm(false)}>Hủy</Button>
                <Button
                  primary
                  loading={createRule.isLoading}
                  disabled={!canCreate || createRule.isLoading}
                  onClick={() => createRule.mutate()}
                >
                  Tạo rule
                </Button>
              </Stack>
            </FormLayout>
          </div>
        )}
      </Stack>
    </Card>
  );
}

function scopeText(rule: RuleDto): string {
  if (rule.scope === "ALL") return "Toàn bộ cửa hàng";
  if (rule.scope === "COLLECTION") return `Collection: ${rule.scopeLabel ?? rule.scopeValue}`;
  return `Loại sản phẩm: ${rule.scopeValue || "Chưa phân loại"}`;
}

function triggerText(rule: RuleDto): string {
  const parts = [
    rule.onNewProduct && "SP mới",
    rule.onPrimaryChanged && "Đổi ảnh chính",
    rule.syncScope && "Đồng bộ hằng đêm",
  ].filter(Boolean);
  const when = parts.length > 0 ? parts.join(", ") : "Chỉ khi bấm Áp dụng";
  return [
    when,
    rule.autoPublish && "Tự đưa lên Shopify",
    rule.restoreOnLeave && "Gỡ ảnh khi rời phạm vi",
  ]
    .filter(Boolean)
    .join(" · ");
}

function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}
