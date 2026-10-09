import { Autocomplete, Text } from "@shopify/polaris";
import { useEffect, useState } from "react";
import { useQuery } from "react-query";
import { fetchJson } from "../utils/fetchJson";
import { useDebounced } from "../utils/useDebounced";
import {
  NO_FILTER,
  studioProductsUrl,
  type StudioProductDto,
  type StudioProductsResponse,
} from "../utils/studioProducts";

const SUGGESTION_COUNT = 20;

interface ProductPickerProps {
  label: string;
  selected: StudioProductDto | null;
  onSelect(product: StudioProductDto): void;
}

/** Chọn một sản phẩm bằng cách tìm theo tên trên server, không tải cả catalog về. */
export function ProductPicker({ label, selected, onSelect }: ProductPickerProps) {
  const [input, setInput] = useState(selected?.title ?? "");
  // Chỉ hỏi server khi merchant thật sự mở ô chọn.
  const [active, setActive] = useState(false);

  useEffect(() => {
    setInput(selected?.title ?? "");
  }, [selected?.id, selected?.title]);

  const debounced = useDebounced(input.trim(), 300);
  // Ô đang hiện tên sản phẩm đã chọn: gợi ý danh sách chung thay vì đúng một kết quả.
  const search = selected && debounced === selected.title.trim() ? "" : debounced;

  const suggestions = useQuery<StudioProductsResponse, Error>(
    ["catalogProducts", "picker", search],
    () =>
      fetchJson<StudioProductsResponse>(
        studioProductsUrl({ ...NO_FILTER, search }, 1, SUGGESTION_COUNT)
      ),
    { enabled: active, keepPreviousData: true, refetchOnWindowFocus: false, staleTime: 30_000 }
  );

  return (
    <Autocomplete
      options={(suggestions.data?.products ?? []).map((product) => ({
        value: product.id,
        label: product.title,
      }))}
      selected={selected ? [selected.id] : []}
      onSelect={([id]) => {
        const product = suggestions.data?.products.find((item) => item.id === id);
        if (!product) return;
        onSelect(product);
        setInput(product.title);
      }}
      loading={suggestions.isFetching}
      emptyState={
        <Text as="p" variant="bodySm" color="subdued">
          {suggestions.isError
            ? `Không tải được danh sách: ${suggestions.error.message}`
            : "Không tìm thấy kết quả"}
        </Text>
      }
      textField={
        <Autocomplete.TextField
          label={label}
          value={input}
          onChange={setInput}
          onFocus={() => setActive(true)}
          placeholder="Nhập tên để tìm..."
          autoComplete="off"
          clearButton
          onClearButtonClick={() => setInput("")}
        />
      }
    />
  );
}
