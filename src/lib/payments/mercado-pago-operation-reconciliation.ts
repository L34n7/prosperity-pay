import { env, requireEnv } from "@/lib/env";
import { getProviderAccessToken } from "@/lib/payments/provider-credentials";
import { createAdminClient } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createAdminClient>;
type RawObject = Record<string, unknown>;

const REPORT_ID = "activities_collection";
const META_KEY = "prosperity_ml_operation_reconciliation";
const REPORT_COLUMNS = [
  "date_created",
  "operation_id",
  "external_reference",
  "status",
  "transaction_amount",
  "mercadopago_fee",
  "payment_type",
  "installments",
  "amount_refunded",
];
const REPORT_BUCKET_MS = 60 * 60 * 1000;
const RETRY_AFTER_MS = 6 * 60 * 60 * 1000;

export type OperationReconciliationPayment = {
  id: string;
  order_id: string;
  connection_id: string | null;
  status: string;
  external_payment_id: string | null;
  external_reference: string | null;
  gross_amount_cents: number;
  created_at: string;
  raw_provider_data: unknown;
};

type ReportRange = {
  key: string;
  gte: string;
  lte: string;
};

type ReconciliationMeta = {
  source?: string;
  range_key?: string;
  statement_id?: string;
  statement_status?: string;
  operation_id?: string;
  requested_at?: string;
  checked_at?: string;
  error?: string;
};

type ReportStatement = {
  id?: string;
  status?: string;
  origin?: {
    data?: {
      filters?: {
        creation_date?: {
          range?: {
            gte?: string;
            lte?: string;
          };
        };
      };
    };
  };
};

class MercadoPagoReportError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly body?: unknown,
  ) {
    super(message);
  }
}

function asObject(value: unknown): RawObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as RawObject)
    : {};
}

function nonEmptyText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function manualPayment(payment: OperationReconciliationPayment) {
  const raw = asObject(payment.raw_provider_data);
  const source = nonEmptyText(raw.source) ?? "";
  return (
    source.startsWith("manual_") ||
    raw.paid_outside_platform === true ||
    nonEmptyText(payment.external_payment_id)?.startsWith("manual-") === true ||
    nonEmptyText(payment.external_reference)?.startsWith("manual-") === true
  );
}

export function mercadoPagoOperationId(raw: unknown) {
  const meta = asObject(asObject(raw)[META_KEY]);
  return nonEmptyText(meta.operation_id);
}

function reconciliationMeta(raw: unknown): ReconciliationMeta {
  return asObject(asObject(raw)[META_KEY]) as ReconciliationMeta;
}

function shouldRetry(raw: unknown) {
  if (mercadoPagoOperationId(raw)) return false;
  const meta = reconciliationMeta(raw);
  if (meta.statement_status === "pending") return true;
  const checkedAt = Date.parse(meta.checked_at ?? "");
  if (!Number.isFinite(checkedAt)) return true;
  return Date.now() - checkedAt >= RETRY_AFTER_MS;
}

export function reportRangeForPayment(createdAt: string): ReportRange {
  const timestamp = Date.parse(createdAt);
  if (!Number.isFinite(timestamp)) {
    throw new Error("Data do pagamento inválida para conciliação Mercado Pago.");
  }
  const startMs = Math.floor(timestamp / REPORT_BUCKET_MS) * REPORT_BUCKET_MS;
  const endMs = startMs + REPORT_BUCKET_MS - 1;
  const gte = new Date(startMs).toISOString();
  const lte = new Date(endMs).toISOString();
  return { key: `${gte}|${lte}`, gte, lte };
}

function candidateReferences(payment: OperationReconciliationPayment) {
  const raw = asObject(payment.raw_provider_data);
  return new Set(
    [
      nonEmptyText(payment.external_reference),
      nonEmptyText(raw.external_reference),
      `prosperity-${payment.order_id}`,
    ].filter((value): value is string => Boolean(value)),
  );
}

export function parseCsv(csv: string) {
  const firstLine = csv.split(/\r?\n/, 1)[0] ?? "";
  const delimiter =
    (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0)
      ? ";"
      : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < csv.length; index += 1) {
    const char = csv[index];
    const next = csv[index + 1];

    if (quoted) {
      if (char === '"' && next === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === delimiter) {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field.replace(/\r$/, ""));
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  if (field.length || row.length) {
    row.push(field.replace(/\r$/, ""));
    if (row.some((value) => value.length > 0)) rows.push(row);
  }

  if (!rows.length) return [] as Record<string, string>[];
  const headers = rows[0].map((header) => header.trim().toLowerCase());
  return rows.slice(1).map((values) =>
    Object.fromEntries(headers.map((header, index) => [header, values[index]?.trim() ?? ""])),
  );
}

export function operationIdByExternalReference(csv: string) {
  const map = new Map<string, string>();
  for (const row of parseCsv(csv)) {
    const reference = row.external_reference?.trim();
    const operationId = row.operation_id?.trim();
    if (reference && operationId && !map.has(reference)) {
      map.set(reference, operationId);
    }
  }
  return map;
}

async function reportRequest<T>(
  token: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`https://api.mercadopago.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
    cache: "no-store",
  });
  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  if (!response.ok) {
    const message = nonEmptyText(asObject(body).message)
      ?? nonEmptyText(asObject(body).error)
      ?? `Mercado Pago respondeu HTTP ${response.status} na conciliação do número da transação.`;
    throw new MercadoPagoReportError(response.status, message, body);
  }
  return body as T;
}

async function reportDownload(token: string, statementId: string) {
  const response = await fetch(
    `https://api.mercadopago.com/v1/reporting/operations/${REPORT_ID}/statements/${encodeURIComponent(statementId)}/download?format=csv`,
    {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    },
  );
  if (!response.ok) {
    throw new MercadoPagoReportError(
      response.status,
      `Mercado Pago respondeu HTTP ${response.status} ao baixar relatório de transações.`,
    );
  }
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType.includes("zip")) {
    throw new Error("Relatório Mercado Pago foi compactado; janela de conciliação ficou grande demais.");
  }
  return response.text();
}

async function ensureReportConfiguration(token: string) {
  const configPath = `/v1/reporting/operations/${REPORT_ID}/config`;
  try {
    const config = await reportRequest<{
      structure?: {
        id?: string;
        name?: string;
        columns?: Array<{ key?: string }>;
        file_format?: unknown;
        display_timezone?: string;
      };
    }>(token, configPath);
    const structure = config.structure;
    if (!structure?.id) return;

    const currentColumns = (structure.columns ?? [])
      .map((column) => nonEmptyText(column.key))
      .filter((key): key is string => Boolean(key));
    const missingColumns = REPORT_COLUMNS.filter((key) => !currentColumns.includes(key));
    if (!missingColumns.length) return;

    await reportRequest(token, `${configPath}/${encodeURIComponent(structure.id)}`, {
      method: "PUT",
      body: JSON.stringify({
        structure: {
          name: structure.name || "Prosperity Pay - conciliação",
          columns: [...currentColumns, ...missingColumns].map((key) => ({ key })),
          ...(structure.file_format ? { file_format: structure.file_format } : {}),
          ...(structure.display_timezone
            ? { display_timezone: structure.display_timezone }
            : {}),
        },
      }),
    });
    return;
  } catch (error) {
    if (!(error instanceof MercadoPagoReportError) || error.status !== 404) {
      throw error;
    }
  }

  const appUrl = requireEnv(env.appUrl, "NEXT_PUBLIC_APP_URL").replace(/\/$/, "");
  const notifierKey = requireEnv(
    env.mercadoPagoWebhookSecret,
    "MERCADO_PAGO_WEBHOOK_SECRET",
  );

  try {
    await reportRequest(token, configPath, {
      method: "POST",
      body: JSON.stringify({
        structure: {
          name: "Prosperity Pay - conciliação",
          columns: REPORT_COLUMNS.map((key) => ({ key })),
          file_format: {
            column_separator: ",",
            decimal_separator: ".",
            date_format: "yyyy-MM-dd",
            name: "prosperity_pay_activities_collection",
            prefix: "prosperity_pay_",
          },
          display_timezone: "GMT-03",
        },
        notifiers: [
          {
            type: "webhook",
            data: {
              url: `${appUrl}/api/webhooks/mercadopago/reports`,
              key: notifierKey,
            },
            description: "Prosperity Pay - conciliação de transações",
          },
        ],
      }),
    });
  } catch (error) {
    if (!(error instanceof MercadoPagoReportError) || error.status !== 409) {
      throw error;
    }
  }
}

function statementRange(statement: ReportStatement) {
  return statement.origin?.data?.filters?.creation_date?.range;
}

async function findStatement(token: string, range: ReportRange) {
  const createdFrom = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const data = await reportRequest<{ results?: ReportStatement[] }>(
    token,
    `/v1/reporting/operations/${REPORT_ID}/statements?size=100&page=1&created_from=${encodeURIComponent(createdFrom)}`,
  );
  return (data.results ?? []).find((statement) => {
    const statementDateRange = statementRange(statement);
    return statementDateRange?.gte === range.gte && statementDateRange?.lte === range.lte;
  }) ?? null;
}

async function createOrFindStatement(token: string, range: ReportRange) {
  try {
    const result = await reportRequest<{ record_id?: string }>(
      token,
      `/v1/reporting/operations/${REPORT_ID}/statements`,
      {
        method: "POST",
        body: JSON.stringify({
          filters: {
            creation_date: {
              range: { gte: range.gte, lte: range.lte },
            },
          },
          file_format: "application/csv",
        }),
      },
    );
    if (result.record_id) return result.record_id;
  } catch (error) {
    if (!(error instanceof MercadoPagoReportError) || error.status !== 409) {
      throw error;
    }
  }

  const existing = await findStatement(token, range);
  return existing?.id ?? null;
}

async function statementStatus(token: string, statementId: string) {
  return reportRequest<ReportStatement>(
    token,
    `/v1/reporting/operations/${REPORT_ID}/statements/${encodeURIComponent(statementId)}`,
  );
}

async function mergePaymentMetadata(
  admin: AdminClient,
  payment: OperationReconciliationPayment,
  patch: ReconciliationMeta,
) {
  const { data, error } = await admin
    .from("payments")
    .select("raw_provider_data")
    .eq("id", payment.id)
    .single();
  if (error || !data) throw error ?? new Error("Pagamento não encontrado durante conciliação.");

  const latestRaw = asObject(data.raw_provider_data);
  const currentMeta = asObject(latestRaw[META_KEY]);
  const mergedRaw = {
    ...latestRaw,
    [META_KEY]: {
      ...currentMeta,
      ...patch,
      source: "mercadopago_activities_collection",
    },
  };
  const { error: updateError } = await admin
    .from("payments")
    .update({ raw_provider_data: mergedRaw as never })
    .eq("id", payment.id);
  if (updateError) throw updateError;
  payment.raw_provider_data = mergedRaw;
}

async function persistGroupMetadata(
  admin: AdminClient,
  payments: OperationReconciliationPayment[],
  patch: ReconciliationMeta,
) {
  for (const payment of payments) {
    await mergePaymentMetadata(admin, payment, patch);
  }
}

function groupStatementId(payments: OperationReconciliationPayment[], range: ReportRange) {
  for (const payment of payments) {
    const meta = reconciliationMeta(payment.raw_provider_data);
    if (meta.range_key === range.key && meta.statement_id) return meta.statement_id;
  }
  return null;
}

async function reconcileGroup(input: {
  admin: AdminClient;
  payments: OperationReconciliationPayment[];
  range: ReportRange;
  token: string;
}) {
  const { admin, payments, range, token } = input;
  await ensureReportConfiguration(token);

  let statementId = groupStatementId(payments, range);
  if (!statementId) {
    statementId = await createOrFindStatement(token, range);
    if (!statementId) {
      throw new Error("Mercado Pago não retornou identificador do relatório de transações.");
    }
    await persistGroupMetadata(admin, payments, {
      range_key: range.key,
      statement_id: statementId,
      statement_status: "pending",
      requested_at: new Date().toISOString(),
      error: "",
    });
  }

  const statement = await statementStatus(token, statementId);
  const status = statement.status ?? "pending";
  if (status === "pending") {
    await persistGroupMetadata(admin, payments, {
      range_key: range.key,
      statement_id: statementId,
      statement_status: "pending",
      checked_at: new Date().toISOString(),
      error: "",
    });
    return { resolved: 0, pending: payments.length };
  }

  if (status !== "available") {
    await persistGroupMetadata(admin, payments, {
      range_key: range.key,
      statement_id: statementId,
      statement_status: status,
      checked_at: new Date().toISOString(),
      error: status === "failed" ? "Mercado Pago não conseguiu gerar o relatório." : "",
    });
    return { resolved: 0, pending: 0 };
  }

  const csv = await reportDownload(token, statementId);
  const operationIds = operationIdByExternalReference(csv);
  let resolved = 0;

  for (const payment of payments) {
    const references = candidateReferences(payment);
    const operationId = [...references]
      .map((reference) => operationIds.get(reference))
      .find((value): value is string => Boolean(value));

    await mergePaymentMetadata(admin, payment, {
      range_key: range.key,
      statement_id: statementId,
      statement_status: "available",
      operation_id: operationId ?? "",
      checked_at: new Date().toISOString(),
      error: operationId ? "" : "Operação não encontrada no relatório desta janela.",
    });
    if (operationId) resolved += 1;
  }

  return { resolved, pending: 0 };
}

export async function reconcileMercadoPagoOperationIds(input: {
  admin: AdminClient;
  payments: OperationReconciliationPayment[];
  groupLimit?: number;
}) {
  const eligible = input.payments.filter((payment) => {
    if (!payment.connection_id) return false;
    if (!["approved", "refunded", "charged_back"].includes(payment.status)) return false;
    if (manualPayment(payment) || !shouldRetry(payment.raw_provider_data)) return false;
    return Date.parse(reportRangeForPayment(payment.created_at).lte) <= Date.now();
  });

  const groups = new Map<
    string,
    { payments: OperationReconciliationPayment[]; range: ReportRange; connectionId: string }
  >();
  for (const payment of eligible) {
    const connectionId = payment.connection_id as string;
    const range = reportRangeForPayment(payment.created_at);
    const key = `${connectionId}:${range.key}`;
    const group = groups.get(key) ?? { payments: [], range, connectionId };
    group.payments.push(payment);
    groups.set(key, group);
  }

  let processedGroups = 0;
  let resolved = 0;
  let pending = 0;
  let failed = 0;
  const tokenCache = new Map<string, string>();

  for (const group of [...groups.values()].slice(0, Math.max(1, input.groupLimit ?? 3))) {
    processedGroups += 1;
    try {
      let token = tokenCache.get(group.connectionId);
      if (!token) {
        token = await getProviderAccessToken(group.connectionId);
        tokenCache.set(group.connectionId, token);
      }
      const result = await reconcileGroup({
        admin: input.admin,
        payments: group.payments,
        range: group.range,
        token,
      });
      resolved += result.resolved;
      pending += result.pending;
    } catch (error) {
      failed += group.payments.length;
      console.error("[ML OPERATION ID] Falha na conciliação", {
        connectionId: group.connectionId,
        paymentIds: group.payments.map((payment) => payment.id),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { processedGroups, resolved, pending, failed };
}

export async function reconcileRecentMercadoPagoOperationIds(
  admin: AdminClient,
  options?: { paymentLimit?: number; groupLimit?: number },
) {
  const { data, error } = await admin
    .from("payments")
    .select(
      "id,order_id,connection_id,status,external_payment_id,external_reference,gross_amount_cents,created_at,raw_provider_data",
    )
    .in("status", ["approved", "refunded", "charged_back"])
    .not("connection_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(Math.max(1, options?.paymentLimit ?? 150));
  if (error) throw error;

  return reconcileMercadoPagoOperationIds({
    admin,
    payments: (data ?? []) as OperationReconciliationPayment[],
    groupLimit: options?.groupLimit ?? 6,
  });
}
