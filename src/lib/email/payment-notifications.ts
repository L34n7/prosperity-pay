import { env, requireEnv } from "@/lib/env";
import { sendPaymentNotificationEmail } from "@/lib/email/resend-auth";
import { mercadoPagoPaymentMetadata } from "@/lib/payments/mercado-pago-payment-metadata";
import { createAdminClient } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createAdminClient>;
type PaymentNotificationRole = "producer" | "coproducer" | "affiliate";
type PaymentNotificationEvent = "pix_generated" | "payment_approved";
type PaymentMethod = "pix" | "card";

type Recipient = {
  userId: string;
  email: string;
  name: string;
  role: PaymentNotificationRole;
};

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function pixData(raw: unknown) {
  const root = asObject(raw);
  const pointOfInteraction = asObject(root?.point_of_interaction);
  const transactionData = asObject(pointOfInteraction?.transaction_data);

  const transactions = asObject(root?.transactions);
  const payments = Array.isArray(transactions?.payments)
    ? transactions?.payments
    : [];
  const firstPayment = asObject(payments[0]);
  const paymentMethod = asObject(firstPayment?.payment_method);

  return {
    code:
      stringValue(transactionData?.qr_code) ??
      stringValue(paymentMethod?.qr_code),
    ticketUrl:
      stringValue(transactionData?.ticket_url) ??
      stringValue(paymentMethod?.ticket_url),
  };
}

function notificationEvent(
  status: string,
  method: string,
  raw: unknown,
): { event: PaymentNotificationEvent; method: PaymentMethod } | null {
  if (status === "approved" && (method === "pix" || method === "card")) {
    return {
      event: "payment_approved",
      method,
    };
  }

  if (
    (status === "pending" || status === "processing") &&
    method === "pix"
  ) {
    const pix = pixData(raw);
    if (pix.code || pix.ticketUrl) {
      return {
        event: "pix_generated",
        method: "pix",
      };
    }
  }

  return null;
}

async function claimDelivery(
  admin: AdminClient,
  input: {
    paymentId: string;
    event: PaymentNotificationEvent;
    recipient: Recipient;
  },
) {
  const { data, error } = await admin
    .from("payment_email_deliveries")
    .insert({
      payment_id: input.paymentId,
      event_type: input.event,
      recipient_user_id: input.recipient.userId,
      recipient_email: input.recipient.email,
      recipient_role: input.recipient.role,
      status: "pending",
      attempts: 1,
    })
    .select("id")
    .single();

  if (!error && data) return data.id;
  if (error?.code !== "23505") throw error;

  const { data: existing, error: existingError } = await admin
    .from("payment_email_deliveries")
    .select("id,status,attempts,updated_at")
    .eq("payment_id", input.paymentId)
    .eq("event_type", input.event)
    .eq("recipient_user_id", input.recipient.userId)
    .eq("recipient_role", input.recipient.role)
    .single();

  if (existingError || !existing) {
    throw existingError ?? new Error("Entrega de e-mail não encontrada após conflito.");
  }
  if (existing.status === "sent") return null;

  const stalePending =
    existing.status === "pending" &&
    Date.now() - new Date(existing.updated_at).getTime() > 10 * 60 * 1000;

  if (existing.status !== "failed" && !stalePending) return null;

  const { data: retry, error: retryError } = await admin
    .from("payment_email_deliveries")
    .update({
      status: "pending",
      attempts: Number(existing.attempts) + 1,
      recipient_email: input.recipient.email,
      last_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", existing.id)
    .eq("status", existing.status)
    .select("id")
    .maybeSingle();

  if (retryError) throw retryError;
  return retry?.id ?? null;
}

async function hydrateNotification(admin: AdminClient, paymentId: string) {
  const { data: payment, error: paymentError } = await admin
    .from("payments")
    .select(
      "id,order_id,status,gross_amount_cents,currency,raw_provider_data",
    )
    .eq("id", paymentId)
    .single();

  if (paymentError || !payment) {
    throw paymentError ?? new Error("Pagamento não encontrado para notificação.");
  }

  const metadata = mercadoPagoPaymentMetadata(payment.raw_provider_data);
  const resolvedEvent = notificationEvent(
    String(payment.status),
    metadata.method,
    payment.raw_provider_data,
  );

  if (!resolvedEvent) {
    return null;
  }

  const { data: order, error: orderError } = await admin
    .from("orders")
    .select(
      "id,order_number,producer_id,customer_id,product_id,offer_id",
    )
    .eq("id", payment.order_id)
    .single();

  if (orderError || !order) {
    throw orderError ?? new Error("Pedido não encontrado para notificação.");
  }

  const [productResult, offerResult, customerResult, snapshotResult] =
    await Promise.all([
      admin.from("products").select("id,name,partner_payment_emails_enabled").eq("id", order.product_id).single(),
      admin.from("offers").select("id,name").eq("id", order.offer_id).single(),
      admin.from("customers").select("id,name,email").eq("id", order.customer_id).single(),
      admin.from("financial_snapshots").select("id").eq("order_id", order.id).maybeSingle(),
    ]);

  if (
    productResult.error ||
    offerResult.error ||
    customerResult.error ||
    snapshotResult.error
  ) {
    throw (
      productResult.error ??
      offerResult.error ??
      customerResult.error ??
      snapshotResult.error
    );
  }

  if (!productResult.data || !offerResult.data || !customerResult.data) {
    throw new Error("Dados da venda incompletos para notificação.");
  }

  if (productResult.data.partner_payment_emails_enabled === false) {
    return null;
  }

  const allocations = snapshotResult.data
    ? await admin
        .from("financial_allocations")
        .select("allocation_type,beneficiary_user_id,amount_cents")
        .eq("snapshot_id", snapshotResult.data.id)
        .in("allocation_type", ["affiliate", "coproducer"])
        .gt("amount_cents", 0)
    : { data: [], error: null };

  if (allocations.error) throw allocations.error;

  const recipientRoles = new Map<string, PaymentNotificationRole>();
  recipientRoles.set(order.producer_id, "producer");

  for (const allocation of allocations.data ?? []) {
    if (!allocation.beneficiary_user_id) continue;
    if (allocation.allocation_type === "affiliate") {
      recipientRoles.set(allocation.beneficiary_user_id, "affiliate");
    } else if (allocation.allocation_type === "coproducer") {
      recipientRoles.set(allocation.beneficiary_user_id, "coproducer");
    }
  }

  const userIds = [...recipientRoles.keys()];
  const { data: profiles, error: profilesError } = userIds.length
    ? await admin
        .from("profiles")
        .select("id,email,full_name")
        .in("id", userIds)
    : { data: [], error: null };

  if (profilesError) throw profilesError;

  const recipients: Recipient[] = (profiles ?? [])
    .filter((profile) => Boolean(profile.email))
    .map((profile) => ({
      userId: profile.id,
      email: profile.email,
      name: profile.full_name || profile.email.split("@")[0] || "parceiro",
      role: recipientRoles.get(profile.id) ?? "producer",
    }));

  return {
    payment,
    order,
    product: productResult.data,
    offer: offerResult.data,
    customer: customerResult.data,
    recipients,
    event: resolvedEvent.event,
    method: resolvedEvent.method,
  };
}

export async function dispatchPaymentEmailNotifications(
  admin: AdminClient,
  paymentId: string,
) {
  const hydrated = await hydrateNotification(admin, paymentId);

  if (!hydrated) {
    return {
      sent: 0,
      skipped: true as const,
    };
  }

  const appUrl = requireEnv(env.appUrl, "NEXT_PUBLIC_APP_URL");

  const results = await Promise.all(
    hydrated.recipients.map(async (recipient) => {
      const deliveryId = await claimDelivery(admin, {
        paymentId,
        event: hydrated.event,
        recipient,
      });

      if (!deliveryId) {
        return {
          userId: recipient.userId,
          role: recipient.role,
          sent: false,
          duplicate: true,
        };
      }

      const destination =
        hydrated.event === "payment_approved"
          ? recipient.role === "producer"
            ? "/pagamentos"
            : "/comissoes"
          : "/dashboard";
      const link = new URL(destination, appUrl).toString();

      try {
        await sendPaymentNotificationEmail({
          to: recipient.email,
          name: recipient.name,
          event: hydrated.event,
          role: recipient.role,
          buyerName: hydrated.customer.name || "Comprador",
          buyerEmail: hydrated.customer.email,
          productName: hydrated.product.name,
          offerName: hydrated.offer.name,
          amountCents: Number(hydrated.payment.gross_amount_cents),
          method: hydrated.method,
          orderNumber: hydrated.order.order_number,
          link,
        });

        const { error } = await admin
          .from("payment_email_deliveries")
          .update({
            status: "sent",
            sent_at: new Date().toISOString(),
            last_error: null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", deliveryId);

        if (error) throw error;

        return {
          userId: recipient.userId,
          role: recipient.role,
          sent: true,
          duplicate: false,
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message.slice(0, 1000) : String(error).slice(0, 1000);

        await admin
          .from("payment_email_deliveries")
          .update({
            status: "failed",
            last_error: message,
            updated_at: new Date().toISOString(),
          })
          .eq("id", deliveryId);

        console.error("[PAYMENT EMAIL] Falha ao enviar notificação.", {
          paymentId,
          event: hydrated.event,
          recipientUserId: recipient.userId,
          recipientRole: recipient.role,
          error: message,
        });

        return {
          userId: recipient.userId,
          role: recipient.role,
          sent: false,
          duplicate: false,
          error: message,
        };
      }
    }),
  );

  return {
    sent: results.filter((result) => result.sent).length,
    skipped: false as const,
    event: hydrated.event,
    results,
  };
}

export async function dispatchPaymentEmailNotificationsSafe(
  admin: AdminClient,
  paymentId: string,
) {
  try {
    return await dispatchPaymentEmailNotifications(admin, paymentId);
  } catch (error) {
    console.error("[PAYMENT EMAIL] Falha ao preparar notificações.", {
      paymentId,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      sent: 0,
      skipped: true as const,
      error: true as const,
    };
  }
}
