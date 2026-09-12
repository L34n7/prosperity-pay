import { NextResponse } from "next/server";

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function jsonError(error: unknown) {
  if (error instanceof HttpError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }

  console.error(error);
  return NextResponse.json(
    { error: "Nao foi possivel concluir a operacao." },
    { status: 500 },
  );
}

export function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "Corpo da requisicao invalido.");
  }
  return value as Record<string, unknown>;
}

export function requiredString(
  input: Record<string, unknown>,
  key: string,
  maxLength = 255,
) {
  const value = input[key];
  if (typeof value !== "string" || !value.trim() || value.length > maxLength) {
    throw new HttpError(400, `Campo ${key} invalido.`);
  }
  return value.trim();
}

export function optionalString(
  input: Record<string, unknown>,
  key: string,
  maxLength = 255,
) {
  const value = input[key];
  if (value == null || value === "") return undefined;
  if (typeof value !== "string" || value.length > maxLength) {
    throw new HttpError(400, `Campo ${key} invalido.`);
  }
  return value.trim();
}

export function requiredInteger(
  input: Record<string, unknown>,
  key: string,
  minimum = 0,
) {
  const value = input[key];
  if (!Number.isSafeInteger(value) || Number(value) < minimum) {
    throw new HttpError(400, `Campo ${key} invalido.`);
  }
  return Number(value);
}
