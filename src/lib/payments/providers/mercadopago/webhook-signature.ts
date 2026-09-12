import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyMercadoPagoSignature(input: {
  signature: string;
  requestId: string;
  dataId: string;
  secret: string;
}) {
  const parts = Object.fromEntries(
    input.signature.split(",").map((part) => {
      const [name, ...value] = part.trim().split("=");
      return [name, value.join("=")];
    }),
  );
  if (!parts.ts || !parts.v1) return false;

  const manifest = `id:${input.dataId};request-id:${input.requestId};ts:${parts.ts};`;
  const expected = createHmac("sha256", input.secret).update(manifest).digest("hex");
  const receivedBuffer = Buffer.from(parts.v1, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  return receivedBuffer.length === expectedBuffer.length
    && timingSafeEqual(receivedBuffer, expectedBuffer);
}
