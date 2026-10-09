import { Card, DropZone, ProgressBar, Stack, Text, TextField } from "@shopify/polaris";
import { useState } from "react";
import { fetchJson } from "../utils/fetchJson";
import { useToast } from "./providers/ToastProvider";

const ACCEPTED_TYPES = "image/jpeg,image/png,image/webp,image/gif";
const PARALLEL_UPLOADS = 3;

interface UploadProgress {
  finished: number;
  total: number;
}

/** Chế độ độc lập: ảnh tải lên thay cho catalog đồng bộ từ Shopify. */
export function StandaloneImageUploader({ onUploaded }: { onUploaded(): void }) {
  const toast = useToast();
  const [productType, setProductType] = useState("");
  const [progress, setProgress] = useState<UploadProgress | null>(null);

  const upload = async (files: File[]) => {
    if (files.length === 0 || progress) return;
    const errors: string[] = [];
    let finished = 0;
    setProgress({ finished, total: files.length });

    // Mỗi request một ảnh: báo lỗi riêng từng file và không chạm giới hạn kích thước request.
    const queue = [...files];
    const worker = async () => {
      for (let file = queue.shift(); file; file = queue.shift()) {
        const form = new FormData();
        form.append("title", file.name);
        form.append("productType", productType);
        form.append("image", file);
        try {
          await fetchJson("/api/standalone/images", { method: "POST", body: form });
        } catch (error) {
          errors.push(`${file.name}: ${error instanceof Error ? error.message : String(error)}`);
        }
        finished += 1;
        setProgress({ finished, total: files.length });
      }
    };
    await Promise.all(Array.from({ length: Math.min(PARALLEL_UPLOADS, files.length) }, worker));

    setProgress(null);
    onUploaded();
    const uploaded = files.length - errors.length;
    if (errors.length === 0) {
      toast.show(`Đã tải lên ${uploaded} ảnh`);
    } else {
      toast.show(`Đã tải lên ${uploaded}/${files.length} ảnh. Lỗi: ${errors[0]}`, { isError: true });
    }
  };

  return (
    <Card sectioned title="Tải ảnh lên">
      <Stack vertical spacing="tight">
        <TextField
          label="Loại sản phẩm (không bắt buộc)"
          value={productType}
          onChange={setProductType}
          autoComplete="off"
          placeholder="Ví dụ: Áo thun"
          helpText="Gắn loại để lọc hoặc watermark cả nhóm ảnh cùng loại."
          disabled={progress !== null}
        />
        <DropZone
          accept={ACCEPTED_TYPES}
          type="image"
          allowMultiple
          disabled={progress !== null}
          onDropAccepted={(files) => void upload(files)}
          onDropRejected={(files) =>
            toast.show(`Bỏ qua ${files.length} file không phải ảnh JPEG/PNG/WebP/GIF`, { isError: true })
          }
        >
          <DropZone.FileUpload
            actionTitle="Chọn ảnh"
            actionHint="Hoặc kéo thả nhiều ảnh vào đây. JPEG, PNG, WebP, GIF, tối đa 20 MB mỗi ảnh."
          />
        </DropZone>
        {progress && (
          <Stack vertical spacing="extraTight">
            <ProgressBar progress={(progress.finished / progress.total) * 100} size="small" />
            <Text as="span" variant="bodySm" color="subdued">
              {`Đang tải ${progress.finished}/${progress.total} ảnh...`}
            </Text>
          </Stack>
        )}
      </Stack>
    </Card>
  );
}
