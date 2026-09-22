import { NextResponse } from "next/server";
import { HttpError, jsonError } from "@/lib/api/http";
import { requireUser } from "@/lib/auth/require-user";
import { MAX_PRODUCT_IMAGE_BYTES, PRODUCT_IMAGE_BUCKET, productImageUrl } from "@/lib/product-images";
import { createAdminClient } from "@/lib/supabase/admin";

type Context = { params: Promise<{ productId: string }> };

const imageTypes = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
} as const;

function matchesImageType(bytes: Uint8Array, type: keyof typeof imageTypes) {
  if (type === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (type === "image/png") return bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value);
  return bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
}

export async function POST(request: Request, context: Context) {
  try {
    const { productId } = await context.params;
    const { user, supabase } = await requireUser();
    const { data: product, error: productError } = await supabase.from("products")
      .select("image_path").eq("id", productId).eq("producer_id", user.id).maybeSingle();
    if (productError) throw productError;
    if (!product) throw new HttpError(404, "Produto não encontrado.");

    const image = (await request.formData()).get("image");
    if (!(image instanceof File)) throw new HttpError(400, "Selecione uma imagem para o produto.");
    if (!image.size || image.size > MAX_PRODUCT_IMAGE_BYTES) throw new HttpError(400, "A imagem deve ter até 3 MB.");
    if (!(image.type in imageTypes)) throw new HttpError(400, "Envie uma imagem JPEG, PNG ou WebP.");
    const imageType = image.type as keyof typeof imageTypes;
    const bytes = new Uint8Array(await image.arrayBuffer());
    if (!matchesImageType(bytes, imageType)) throw new HttpError(400, "O arquivo não corresponde ao formato de imagem informado.");

    const path = `${user.id}/${productId}/${crypto.randomUUID()}.${imageTypes[imageType]}`;
    const storage = createAdminClient().storage.from(PRODUCT_IMAGE_BUCKET);
    const { error: uploadError } = await storage.upload(path, bytes, { contentType: imageType, upsert: false });
    if (uploadError) {
      console.error("Falha no upload da imagem do produto", uploadError);
      throw new HttpError(500, "Não foi possível enviar a imagem. Tente novamente.");
    }

    const { error: updateError } = await supabase.from("products")
      .update({ image_path: path }).eq("id", productId).eq("producer_id", user.id).select("id").single();
    if (updateError) {
      await storage.remove([path]);
      throw updateError;
    }
    if (product.image_path) {
      const { error: removeError } = await storage.remove([product.image_path]);
      if (removeError) console.error("Falha ao remover imagem anterior do produto", removeError);
    }
    return NextResponse.json({ imagePath: path, imageUrl: productImageUrl(path) });
  } catch (error) { return jsonError(error); }
}

export async function DELETE(_: Request, context: Context) {
  try {
    const { productId } = await context.params;
    const { user, supabase } = await requireUser();
    const { data: product, error } = await supabase.from("products")
      .select("image_path").eq("id", productId).eq("producer_id", user.id).maybeSingle();
    if (error) throw error;
    if (!product) throw new HttpError(404, "Produto não encontrado.");
    if (product.image_path) {
      const { error: updateError } = await supabase.from("products")
        .update({ image_path: null }).eq("id", productId).eq("producer_id", user.id).select("id").single();
      if (updateError) throw updateError;
      const { error: removeError } = await createAdminClient().storage.from(PRODUCT_IMAGE_BUCKET).remove([product.image_path]);
      if (removeError) console.error("Falha ao remover imagem do produto", removeError);
    }
    return NextResponse.json({ imagePath: null, imageUrl: null });
  } catch (error) { return jsonError(error); }
}
