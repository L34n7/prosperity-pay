import { getProviderAccessToken } from "@/lib/payments/provider-credentials";
import { createAdminClient } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createAdminClient>;
type RawObject = Record<string, unknown>;

const META_KEY = "prosperity_ml_operation_reconciliation";
const REQUIRED_COLUMNS = [
  "TRANSACTION_DATE",
  "SOURCE_ID",
  "EXTERNAL_REFERENCE",
  "TRANSACTION_TYPE",
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
  task_id?: string;
  task_status?: string;
  file_name?: string;
  operation_id?: string;
  requested_at?: string;
  checked_at?: string;
  error?: string;
};

type SettlementConfig = {
  file_name_prefix?: string;
  frequency?: {
    hour?: number;
    type?: string;
    value?: number;
  };
  columns?: Array<{ key?: string }>;
  separator?: string;
  display_timezone?: string;
  report_translation?: string;
  header_language?: string;
  include_withdraw?: boolean;
  include_withdrawal_at_end?: boolean;
  refund_detailed?: boolean;
  shipping_detail?: boolean;
  coupon_detailed?: boolean;
  show_chargeback_cancel?: boolean;
  show_fee_prevision?: boolean;
  execute_after_withdrawal?: boolean;
  check_available_balance?: boolean;
  compensate_detail?: boolean;
};

type SettlementTask = {
  id?: number | string;
  status?: string;
  file_name?: string;
};

class MercadoPagoReportError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string | null,
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

function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
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
  if (meta.task_status === "pending") return true;
  const checkedAt = Date.parse(meta.checked_at ?? "");
  if (!Number.isFinite(checkedAt)) return true;
  return Date.now() - checkedAt >= RETRY_AFTER_MS;
}

function providerCreatedAt(payment: OperationReconciliationPayment) {
  const raw = asObject(payment.raw_provider_data);
  return (
    nonEmptyText(raw.created_date) ??
    nonEmptyText(raw.date_created) ??
    payment.created_at
  );
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
      nonEmptyText(raw.external_reference),
      nonEmptyText(payment.external_reference),
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
    Object.fromEntries(
      headers.map((header, index) => [header, values[index]?.trim() ?? ""]),
    ),
  );
}

function transactionTypeScore(value: string | undefined) {
  const normalized = value?.trim().toUpperCase() ?? "";
  if (normalized === "SETTLEMENT") return 4;
  if (normalized === "PAYMENT") return 3;
  if (normalized === "REFUND") return 2;
  if (normalized === "CHARGEBACK") return 1;
  return 0;
}

export function operationIdByExternalReference(csv: string) {
  const selected = new Map<
    string,
    { operationId: string; score: number }
  >();

  for (const row of parseCsv(csv)) {
    const reference = row.external_reference?.trim();
    const operationId = row.source_id?.trim();
    if (!reference || !operationId) continue;

    const score = transactionTypeScore(row.transaction_type);
    const current = selected.get(reference);
    if (!current || score > current.score) {
      selected.set(reference, { operationId, score });
    }
  }

  return new Map(
    [...selected.entries()].map(([reference, value]) => [
      reference,
      value.operationId,
    ]),
  );
}

function apiErrorCode(body: unknown) {
  const root = asObject(body);
  return (
    nonEmptyText(root.error) ??
    nonEmptyText(root.code) ??
    nonEmptyText(root.error_code)
  );
}

function apiErrorMessage(body: unknown) {
  const root = asObject(body);
  return (
    nonEmptyText(root.message) ??
    nonEmptyText(root.error_description) ??
    apiErrorCode(body)
  );
}

async function settlementRequest<T>(
  token: string,
  path: string,
  init?: RequestInit,
  safePath = path,
): Promise<T> {
  const response = await fetch(`https://api.mercadopago.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
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
    const code = apiErrorCode(body);
    const providerMessage = apiErrorMessage(body);
    const message = [
      `Mercado Pago HTTP ${response.status}`,
      init?.method ?? "GET",
      safePath,
      code,
      providerMessage,
    ]
      .filter(Boolean)
      .join(" · ");
    throw new MercadoPagoReportError(response.status, code, message, body);
  }

  return body as T;
}

async function settlementDownload(token: string, fileName: string) {
  const response = await fetch(
    `https://api.mercadopago.com/v1/account/settlement_report/${encodeURIComponent(fileName)}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "text/csv,*/*",
      },
      cache: "no-store",
    },
  );

  if (!response.ok) {
    throw new MercadoPagoReportError(
      response.status,
      null,
      `Mercado Pago HTTP ${response.status} ao baixar relatório Dinheiro em conta.`,
    );
  }

  return response.text();
}

function missingConfiguration(error: unknown) {
  if (!(error instanceof MercadoPagoReportError)) return false;
  if (error.status === 404) return true;
  const code = (error.code ?? "").toLowerCase();
  return (
    code.includes("not_found") ||
    code.includes("configuration_not_found") ||
    code.includes("config_not_found")
  );
}

function validFrequency(value: unknown) {
  const frequency = asObject(value);
  const hour = numberValue(frequency.hour);
  const amount = numberValue(frequency.value);
  const type = nonEmptyText(frequency.type);
  if (hour == null || amount == null || !type) return null;
  return { hour, value: amount, type };
}

function configurationPayload(
  current?: SettlementConfig | null,
): Record<string, unknown> {
  const currentColumns = (current?.columns ?? [])
    .map((column) => nonEmptyText(column.key))
    .filter((key): key is string => Boolean(key));
  const columns = Array.from(new Set([...currentColumns, ...REQUIRED_COLUMNS]));

  const payload: Record<string, unknown> = {
    columns: columns.map((key) => ({ key })),
    file_name_prefix:
      nonEmptyText(current?.file_name_prefix) ?? "prosperity-pay-settlement",
    frequency:
      validFrequency(current?.frequency) ??
      ({ hour: 0, type: "monthly", value: 1 } as const),
  };

  const optionalKeys: Array<keyof SettlementConfig> = [
    "separator",
    "display_timezone",
    "report_translation",
    "header_language",
    "include_withdraw",
    "include_withdrawal_at_end",
    "refund_detailed",
    "shipping_detail",
    "coupon_detailed",
    "show_chargeback_cancel",
    "show_fee_prevision",
    "execute_after_withdrawal",
    "check_available_balance",
    "compensate_detail",
  ];

  for (const key of optionalKeys) {
    const value = current?.[key];
    if (value !== undefined && value !== null) payload[key] = value;
  }

  if (!current) {
    payload.separator = ";";
    payload.display_timezone = "GMT-03";
    payload.header_language = "pt";
  }

  return payload;
}

async function readSettlementConfiguration(token: string) {
  try {
    return await settlementRequest<SettlementConfig>(
      token,
      "/v1/account/settlement_report/config",
    );
  } catch (error) {
    if (missingConfiguration(error)) return null;
    throw error;
  }
}

async function ensureSettlementConfiguration(token: string) {
  const current = await readSettlementConfiguration(token);
  const currentColumns = (current?.columns ?? [])
    .map((column) => nonEmptyText(column.key))
    .filter((key): key is string => Boolean(key));
  const missingColumns = REQUIRED_COLUMNS.filter(
    (key) => !currentColumns.includes(key),
  );

  if (current && !missingColumns.length) return;

  const method = current ? "PUT" : "POST";
  try {
    await settlementRequest(
      token,
      "/v1/account/settlement_report/config",
      {
        method,
        body: JSON.stringify(configurationPayload(current)),
      },
    );
  } catch (error) {
    if (
      !current &&
      error instanceof MercadoPagoReportError &&
      error.status === 409
    ) {
      const recovered = await readSettlementConfiguration(token);
      if (recovered) {
        await settlementRequest(
          token,
          "/v1/account/settlement_report/config",
          {
            method: "PUT",
            body: JSON.stringify(configurationPayload(recovered)),
          },
        );
        return;
      }
    }
    throw error;
  }
}

async function createSettlementTask(token: string, range: ReportRange) {
  return settlementRequest<SettlementTask>(
    token,
    "/v1/account/settlement_report",
    {
      method: "POST",
      body: JSON.stringify({
        begin_date: range.gte,
        end_date: range.lte,
      }),
    },
  );
}

async function getSettlementTask(token: string, taskId: string) {
  const safePath = `/v1/account/settlement_report/task/${encodeURIComponent(taskId)}`;
  const path =
    `${safePath}?access_token=${encodeURIComponent(token)}`;
  return settlementRequest<SettlementTask>(token, path, undefined, safePath);
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
  if (error || !data) {
    throw error ?? new Error("Pagamento não encontrado durante conciliação.");
  }

  const latestRaw = asObject(data.raw_provider_data);
  const currentMeta = asObject(latestRaw[META_KEY]);
  const mergedRaw = {
    ...latestRaw,
    [META_KEY]: {
      ...currentMeta,
      ...patch,
      source: "mercadopago_settlement_report",
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

function groupTaskId(
  payments: OperationReconciliationPayment[],
  range: ReportRange,
) {
  for (const payment of payments) {
    const meta = reconciliationMeta(payment.raw_provider_data);
    if (meta.range_key === range.key && meta.task_id) return meta.task_id;
  }
  return null;
}

function errorSummary(error: unknown) {
  if (error instanceof MercadoPagoReportError) {
    return error.message.slice(0, 900);
  }
  return error instanceof Error
    ? error.message.slice(0, 900)
    : String(error).slice(0, 900);
}

async function reconcileGroup(input: {
  admin: AdminClient;
  payments: OperationReconciliationPayment[];
  range: ReportRange;
  token: string;
}) {
  const { admin, payments, range, token } = input;
  await ensureSettlementConfiguration(token);

  let taskId = groupTaskId(payments, range);
  if (!taskId) {
    const task = await createSettlementTask(token, range);
    if (task.id == null) {
      throw new Error(
        "Mercado Pago não retornou o identificador da tarefa do relatório.",
      );
    }
    taskId = String(task.id);
    await persistGroupMetadata(admin, payments, {
      range_key: range.key,
      task_id: taskId,
      task_status: task.status ?? "pending",
      requested_at: new Date().toISOString(),
      checked_at: new Date().toISOString(),
      error: "",
    });
  }

  const task = await getSettlementTask(token, taskId);
  const status = nonEmptyText(task.status)?.toLowerCase() ?? "pending";
  if (status === "pending") {
    await persistGroupMetadata(admin, payments, {
      range_key: range.key,
      task_id: taskId,
      task_status: "pending",
      checked_at: new Date().toISOString(),
      error: "",
    });
    return { resolved: 0, pending: payments.length };
  }

  if (status !== "processed" || !task.file_name) {
    await persistGroupMetadata(admin, payments, {
      range_key: range.key,
      task_id: taskId,
      task_status: status,
      checked_at: new Date().toISOString(),
      error:
        status === "failed"
          ? "Mercado Pago não conseguiu gerar o relatório Dinheiro em conta."
          : "",
    });
    return { resolved: 0, pending: 0 };
  }

  const csv = await settlementDownload(token, task.file_name);
  const operationIds = operationIdByExternalReference(csv);
  let resolved = 0;

  for (const payment of payments) {
    const operationId = [...candidateReferences(payment)]
      .map((reference) => operationIds.get(reference))
      .find((value): value is string => Boolean(value));

    await mergePaymentMetadata(admin, payment, {
      range_key: range.key,
      task_id: taskId,
      task_status: "processed",
      file_name: task.file_name,
      operation_id: operationId ?? "",
      checked_at: new Date().toISOString(),
      error: operationId
        ? ""
        : "SOURCE_ID não encontrado para a referência deste pagamento.",
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
    if (!["approved", "refunded", "charged_back"].includes(payment.status)) {
      return false;
    }
    if (manualPayment(payment) || !shouldRetry(payment.raw_provider_data)) {
      return false;
    }
    const range = reportRangeForPayment(providerCreatedAt(payment));
    return Date.parse(range.lte) <= Date.now();
  });

  const groups = new Map<
    string,
    {
      payments: OperationReconciliationPayment[];
      range: ReportRange;
      connectionId: string;
    }
  >();

  for (const payment of eligible) {
    const connectionId = payment.connection_id as string;
    const range = reportRangeForPayment(providerCreatedAt(payment));
    const key = `${connectionId}:${range.key}`;
    const group = groups.get(key) ?? {
      payments: [],
      range,
      connectionId,
    };
    group.payments.push(payment);
    groups.set(key, group);
  }

  let processedGroups = 0;
  let resolved = 0;
  let pending = 0;
  let failed = 0;
  const tokenCache = new Map<string, string>();

  for (const group of [...groups.values()].slice(
    0,
    Math.max(1, input.groupLimit ?? 3),
  )) {
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
      const summary = errorSummary(error);
      await persistGroupMetadata(input.admin, group.payments, {
        range_key: group.range.key,
        task_status: "error",
        checked_at: new Date().toISOString(),
        error: summary,
      }).catch((metadataError) => {
        console.error("[ML TRANSACTION ID] Falha ao persistir erro", {
          paymentIds: group.payments.map((payment) => payment.id),
          error: errorSummary(metadataError),
        });
      });

      console.error("[ML TRANSACTION ID] Falha na conciliação", {
        connectionId: group.connectionId,
        paymentIds: group.payments.map((payment) => payment.id),
        error: summary,
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
