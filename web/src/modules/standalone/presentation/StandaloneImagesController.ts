import {
  Body,
  Controller,
  createParamDecorator,
  Delete,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
  type ExecutionContext,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import { resolveTenant, type TenantLocals } from "../../../shared/nest/Tenant.ts";
import { toHttpException } from "../../../shared/nest/toHttpException.ts";
import { RemoveImageProduct, UploadImageProduct } from "../application/UploadedImages.ts";
import { MAX_UPLOAD_BYTES } from "../domain/UploadedImage.ts";

/** Phần multer trả về mà controller dùng (không cần cài thêm @types/multer). */
interface UploadedImageFile {
  buffer: Buffer;
  originalname: string;
}

/** Shop của tài khoản độc lập; shop Shopify lấy ảnh qua đồng bộ catalog. */
const StandaloneShop = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string => {
    const response = context.switchToHttp().getResponse<Response<unknown, TenantLocals>>();
    const tenant = resolveTenant(response);
    if (tenant.platform !== "standalone") {
      throw new ForbiddenException({ error: "Chỉ dùng được ở chế độ độc lập" });
    }
    return tenant.shop;
  },
);

@Controller("api/standalone/images")
export class StandaloneImagesController {
  constructor(
    @Inject(UploadImageProduct) private readonly uploadImage: UploadImageProduct,
    @Inject(RemoveImageProduct) private readonly removeImage: RemoveImageProduct,
  ) {}

  @Post()
  @UseInterceptors(
    FileInterceptor("image", { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 4 } }),
  )
  async upload(
    @UploadedFile() file: UploadedImageFile | undefined,
    @Body("title") title: unknown,
    @Body("productType") productType: unknown,
    @StandaloneShop() shopDomain: string,
  ) {
    try {
      if (!file) throw new Error("Cần chọn một file ảnh (field `image`)");
      const product = await this.uploadImage.execute({
        shopDomain,
        bytes: file.buffer,
        title: typeof title === "string" && title.trim() ? title : file.originalname,
        productType,
      });
      return { product };
    } catch (error) {
      throw toHttpException("StandaloneImages", error, HttpStatus.BAD_REQUEST);
    }
  }

  @Delete(":productId")
  @HttpCode(HttpStatus.OK)
  async remove(@Param("productId") productId: string, @StandaloneShop() shopDomain: string) {
    try {
      await this.removeImage.execute(shopDomain, productId);
      return { success: true };
    } catch (error) {
      throw toHttpException("StandaloneImages", error, HttpStatus.NOT_FOUND);
    }
  }
}
