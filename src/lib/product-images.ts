import { env } from "@/lib/env";

export const PRODUCT_IMAGE_BUCKET = "product-images";
export const MAX_PRODUCT_IMAGE_BYTES = 3 * 1024 * 1024;

export function productImageUrl(path: string | null | undefined) {
  if (!path || !env.supabaseUrl) return null;
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  return `${env.supabaseUrl}/storage/v1/object/public/${PRODUCT_IMAGE_BUCKET}/${encodedPath}`;
}
