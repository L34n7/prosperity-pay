import { createHmac, timingSafeEqual } from "node:crypto";

function compareHex(received: string, expected: string) {
  if (!/^[a-f0-9]{64}$/i.test(received)) return false;

  const receivedBuffer = Buffer.from(received, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");

  return receivedBuffer.length === expectedBuffer.length
    && timingSafeEqual(receivedBuffer, expectedBuffer);
}

export function verifyMercadoPagoSignature(input: {
  signature: string;
  requestId: string;
  dataId: string;
  secret: string;
}) {
  const parts = Object.fromEntries(
    input.signature.split(",").map((part) => {
      const [name, ...value] = part.trim().split("=");
      return [name, value.join("=").trim()];
    }),
  );

  const timestamp = String(parts.ts ?? "").trim();
  const signatureHash = String(parts.v1 ?? "").trim();

  if (!timestamp || !signatureHash) return false;

  // O Mercado Pago pode enviar identificadores alfanuméricos com letras
  // maiúsculas, mas usa a versão minúscula no manifesto de assinatura.
  // Testamos ambas as representações sem reduzir a segurança: em todos os
  // casos o HMAC precisa corresponder exatamente à chave secreta configurada.
  const dataIds = Array.from(new Set([
    input.dataId.trim(),
    input.dataId.trim().toLowerCase(),
  ].filter(Boolean)));

  for (const dataId of dataIds) {
    let manifest = "";

    if (dataId) {
      manifest += `id:${dataId};`;
    }

    // O SDK oficial omite pares ausentes do manifesto.
    if (input.requestId.trim()) {
      manifest += `request-id:${input.requestId.trim()};`;
    }

    manifest += `ts:${timestamp};`;

    const expected = createHmac("sha256", input.secret)
      .update(manifest)
      .digest("hex");

    if (compareHex(signatureHash, expected)) {
      return true;
    }
  }

  return false;
}
