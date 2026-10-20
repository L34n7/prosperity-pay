import { getProviderAccessToken } from "@/lib/payments/provider-credentials";
import { createAdminClient } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createAdminClient>;
type RawObject = Record<string, unknown>;

const META_KEY = "prosperity_ml_operation_reconciliation";
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

type ReconciliationMeta = {
  source?: string;
  task_id?: string;
  task_status?: string;
  file_name?: string;
  operation_id?: string;
  checked_at?: string;
  error?: string;
};

type SettlementReport = {
  id?: number | string;
  begin_date?: string;
  end_date?: string;
  file_name?: string;
  status?: string;
  created_from?: string;
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

  // Metadados da estratégia antiga devem ser reprocessados imediatamente
  // pela rotina somente-leitura, sem aguardar a janela de retry.
  if (meta.source !== "mercadopago_existing_settlement_report") return true;

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

export function reportRangeForPayment(createdAt: string) {
  const timestamp = Date.parse(createdAt);
  if (!Number.isFinite(timestamp)) {
    throw new Error("Data do pagamento inválida para conciliação Mercado Pago.");
  }
  const startMs = Math.floor(timestamp / 3600000) * 3600000;
  const endMs = startMs + 3600000 - 1;
  return {
    key: `${new Date(startMs).toISOString()}|${new Date(endMs).toISOString()}`,
    gte: new Date(startMs).toISOString(),
    lte: new Date(endMs).toISOString(),
  };
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

    if (char === '"') quoted = true;
    else if (char === delimiter) {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field.replace(/\r$/, ""));
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
      field = "";
    } else field += char;
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
  const selected = new Map<string, { operationId: string; score: number }>();

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

async function mpRequest<T>(token: string, path: string): Promise<T> {
  const response = await fetch(`https://api.mercadopago.com${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
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
    throw new MercadoPagoReportError(
      response.status,
      `Mercado Pago HTTP ${response.status} · GET · ${path}`,
      body,
    );
  }

  return body as T;
}

async function listSettlementReports(token: string) {
  return mpRequest<SettlementReport[]>(
    token,
    "/v1/account/settlement_report/list",
  );
}

async function downloadSettlementReport(token: string, fileName: string) {
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
      `Mercado Pago HTTP ${response.status} ao baixar relatório existente.`,
    );
  }

  return response.text();
}

function reportCoversPayment(report: SettlementReport, payment: OperationReconciliationPayment) {
  if (report.status?.toLowerCase() !== "processed" || !report.file_name) return false;
  const paymentAt = Date.parse(providerCreatedAt(payment));
  const begin = Date.parse(report.begin_date ?? "");
  const end = Date.parse(report.end_date ?? "");
  return (
    Number.isFinite(paymentAt) &&
    Number.isFinite(begin) &&
    Number.isFinite(end) &&
    paymentAt >= begin &&
    paymentAt <= end
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
      source: "mercadopago_existing_settlement_report",
    },
  };

  const { error: updateError } = await admin
    .from("payments")
    .update({ raw_provider_data: mergedRaw as never })
    .eq("id", payment.id);
  if (updateError) throw updateError;
  payment.raw_provider_data = mergedRaw;
}

function errorSummary(error: unknown) {
  return error instanceof Error
    ? error.message.slice(0, 900)
    : String(error).slice(0, 900);
}

async function reconcileConnection(input: {
  admin: AdminClient;
  token: string;
  payments: OperationReconciliationPayment[];
}) {
  const { admin, token, payments } = input;
  const reports = await listSettlementReports(token);
  const reportCache = new Map<string, Map<string, string>>();
  let resolved = 0;

  for (const payment of payments) {
    const report = [...reports]
      .filter((item) => reportCoversPayment(item, payment))
      .sort(
        (a, b) =>
          Date.parse(b.end_date ?? "") - Date.parse(a.end_date ?? ""),
      )[0];

    if (!report?.file_name) {
      await mergePaymentMetadata(admin, payment, {
        task_status: "not_available",
        checked_at: new Date().toISOString(),
        error: "Nenhum relatório existente cobre a data deste pagamento.",
      });
      continue;
    }

    let operationIds = reportCache.get(report.file_name);
    if (!operationIds) {
      const csv = await downloadSettlementReport(token, report.file_name);
      operationIds = operationIdByExternalReference(csv);
      reportCache.set(report.file_name, operationIds);
    }

    const operationId = [...candidateReferences(payment)]
      .map((reference) => operationIds?.get(reference))
      .find((value): value is string => Boolean(value));

    await mergePaymentMetadata(admin, payment, {
      task_id: report.id == null ? undefined : String(report.id),
      task_status: "processed",
      file_name: report.file_name,
      operation_id: operationId ?? "",
      checked_at: new Date().toISOString(),
      error: operationId
        ? ""
        : "SOURCE_ID não encontrado no relatório existente para esta referência.",
    });

    if (operationId) resolved += 1;
  }

  return { resolved, checked: payments.length };
}

export async function reconcileMercadoPagoOperationIds(input: {
  admin: AdminClient;
  payments: OperationReconciliationPayment[];
  groupLimit?: number;
}) {
  const eligible = input.payments.filter(
    (payment) =>
      Boolean(payment.connection_id) &&
      ["approved", "refunded", "charged_back"].includes(payment.status) &&
      !manualPayment(payment) &&
      shouldRetry(payment.raw_provider_data),
  );

  const byConnection = new Map<string, OperationReconciliationPayment[]>();
  for (const payment of eligible) {
    const connectionId = payment.connection_id as string;
    const group = byConnection.get(connectionId) ?? [];
    group.push(payment);
    byConnection.set(connectionId, group);
  }

  let processedGroups = 0;
  let resolved = 0;
  let failed = 0;

  for (const [connectionId, payments] of [...byConnection.entries()].slice(
    0,
    Math.max(1, input.groupLimit ?? 3),
  )) {
    processedGroups += 1;
    try {
      const token = await getProviderAccessToken(connectionId);
      const result = await reconcileConnection({
        admin: input.admin,
        token,
        payments,
      });
      resolved += result.resolved;
    } catch (error) {
      failed += payments.length;
      const summary = errorSummary(error);
      console.error("[ML TRANSACTION ID] Falha ao consultar relatórios existentes", {
        connectionId,
        paymentIds: payments.map((payment) => payment.id),
        error: summary,
      });
    }
  }

  return { processedGroups, resolved, pending: 0, failed };
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
