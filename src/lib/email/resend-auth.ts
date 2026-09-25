import { env, requireEnv } from "@/lib/env";

type EmailPayload = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

function escapeHtml(value: string) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function prosperityPayTemplate(params: {
  eyebrow: string;
  title: string;
  subtitle: string;
  name: string;
  paragraphs: string[];
  buttonLabel: string;
  link: string;
  footer: string;
  details?: Array<{ label: string; value: string }>;
  notice?: string;
}) {
  const name = escapeHtml(params.name || "cliente");
  const link = escapeHtml(params.link);
  const paragraphs = params.paragraphs
    .map(
      (paragraph) =>
        `<p style="margin:0 0 18px;color:#475569;font-size:15px;line-height:1.7;">${paragraph}</p>`,
    )
    .join("");
  const details = params.details?.length
    ? `<div style="background:#f7faf8;border:1px solid #dce8e1;border-radius:16px;padding:4px 20px;margin:6px 0 24px;">${params.details
        .map(
          (detail) =>
            `<div style="display:flex;gap:16px;justify-content:space-between;padding:14px 0;border-bottom:1px solid #e6eee9;"><span style="color:#64748b;font-size:13px;">${escapeHtml(detail.label)}</span><strong style="color:#0f172a;font-size:13px;text-align:right;">${escapeHtml(detail.value)}</strong></div>`,
        )
        .join("")}</div>`
    : "";
  const notice = escapeHtml(
    params.notice ||
      "Por segurança, não compartilhe este link. Ele concede acesso temporário para concluir a configuração da sua conta.",
  );

  return `
  <!DOCTYPE html>
  <html lang="pt-BR">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>${escapeHtml(params.title)}</title>
    </head>
    <body style="margin:0;padding:0;background:#edf4f0;font-family:Arial,Helvetica,sans-serif;">
      <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#edf4f0;padding:40px 16px;">
        <tr>
          <td align="center">
            <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="max-width:620px;background:#ffffff;border-radius:24px;overflow:hidden;border:1px solid #dce8e1;box-shadow:0 20px 60px rgba(5,18,12,.13);">
              <tr>
                <td style="background:linear-gradient(135deg,#07130d 0%,#0a1a12 45%,#0d6549 100%);padding:38px 32px;text-align:center;">
                  <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
                    <tr>
                      <td align="center">
                        <div style="display:inline-block;margin:0 auto 17px;padding:10px 15px;border:1px solid rgba(67,238,177,.30);border-radius:13px;background:#10291d;color:#ffffff;font-size:18px;font-weight:800;letter-spacing:-.02em;">
                          Prosperity <span style="color:#f1cc6a;font-size:12px;letter-spacing:.14em;">PAY</span>
                        </div>
                        <div style="margin:0 0 9px;color:#54efb7;font-size:11px;font-weight:800;letter-spacing:.13em;text-transform:uppercase;">${escapeHtml(params.eyebrow)}</div>
                        <h1 style="margin:0;color:#ffffff;font-size:26px;line-height:1.25;font-weight:800;">${escapeHtml(params.title)}</h1>
                        <p style="margin:10px 0 0;color:#b9cfc5;font-size:15px;line-height:1.5;">${escapeHtml(params.subtitle)}</p>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
              <tr>
                <td style="padding:38px 34px 32px;">
                  <p style="margin:0 0 18px;color:#0f172a;font-size:18px;line-height:1.6;font-weight:800;">Olá, ${name}!</p>
                  ${paragraphs}
                  ${details}
                  <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
                    <tr>
                      <td align="center" style="padding:8px 0 32px;">
                        <a href="${link}" style="display:inline-block;background:linear-gradient(135deg,#22e6a1 0%,#18b982 100%);color:#042017;text-decoration:none;padding:16px 30px;border-radius:999px;font-size:15px;font-weight:800;box-shadow:0 10px 24px rgba(34,230,161,.24);">${escapeHtml(params.buttonLabel)}</a>
                      </td>
                    </tr>
                  </table>
                  <div style="background:#f7faf8;border:1px solid #dce8e1;border-radius:16px;padding:18px 20px;margin-bottom:24px;">
                    <p style="margin:0;color:#64748b;font-size:13px;line-height:1.6;">Se o botão não funcionar, copie e cole este link no navegador:</p>
                    <p style="margin:10px 0 0;color:#0c8f62;font-size:12px;line-height:1.6;word-break:break-all;">${link}</p>
                  </div>
                  <p style="margin:0;color:#64748b;font-size:13px;line-height:1.7;">${notice}</p>
                </td>
              </tr>
              <tr>
                <td style="background:#f7faf8;border-top:1px solid #dce8e1;padding:22px 32px;text-align:center;">
                  <p style="margin:0 0 7px;color:#0f172a;font-size:14px;font-weight:800;">Prosperity Pay</p>
                  <p style="margin:0;color:#94a3b8;font-size:12px;line-height:1.6;">${escapeHtml(params.footer)}</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
  </html>`;
}

async function sendEmail(payload: EmailPayload) {
  const apiKey = requireEnv(env.resendApiKey, "RESEND_API_KEY");
  const from = requireEnv(env.resendFromEmail, "RESEND_FROM_EMAIL");

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [payload.to],
      subject: payload.subject,
      html: payload.html,
      text: payload.text,
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    console.error("[RESEND_EMAIL] Falha ao enviar e-mail.", {
      status: response.status,
      name: body?.name,
      message: body?.message,
    });

    throw new Error(
      "Não foi possível enviar o e-mail agora. Tente novamente em alguns minutos.",
    );
  }
}

export async function sendFirstAccessEmail(params: {
  to: string;
  name: string;
  link: string;
  protectedAccess: boolean;
}) {
  const protectedNotice = params.protectedAccess
    ? "O link é individual, válido por <strong>24 horas</strong> e pode ser aberto em até <strong>3 vezes</strong>. A senha poderá ser cadastrada apenas uma vez."
    : "O link é individual e possui validade limitada. Abra-o assim que possível para concluir seu primeiro acesso.";

  const html = prosperityPayTemplate({
    eyebrow: "Primeiro acesso",
    title: "Seu acesso foi liberado",
    subtitle: "Bem-vindo ao Prosperity Pay",
    name: params.name,
    paragraphs: [
      "Sua conta no <strong>Prosperity Pay</strong> já está pronta.",
      "Para concluir o cadastro, autentique seu e-mail pelo botão abaixo e crie sua primeira senha de acesso.",
      protectedNotice,
    ],
    buttonLabel: "Criar senha e acessar",
    link: params.link,
    footer: `© ${new Date().getFullYear()} Prosperity Pay. Todos os direitos reservados.`,
  });

  const protectionText = params.protectedAccess
    ? "O link é válido por 24 horas, pode ser aberto em até 3 vezes e a senha só pode ser criada uma vez."
    : "O link possui validade limitada. Abra-o assim que possível.";

  await sendEmail({
    to: params.to,
    subject: "Seu acesso ao Prosperity Pay foi liberado",
    html,
    text: [
      `Olá, ${params.name}!`,
      "",
      "Sua conta no Prosperity Pay já está pronta.",
      "Abra o link abaixo para autenticar seu e-mail e criar sua primeira senha:",
      params.link,
      "",
      protectionText,
      "Por segurança, não compartilhe este link.",
    ].join("\n"),
  });
}

export async function sendPasswordRecoveryEmail(params: {
  to: string;
  name: string;
  link: string;
}) {
  const html = prosperityPayTemplate({
    eyebrow: "Segurança da conta",
    title: "Redefina sua senha",
    subtitle: "Recebemos uma solicitação de recuperação de acesso",
    name: params.name,
    paragraphs: [
      "Recebemos uma solicitação para redefinir a senha da sua conta no <strong>Prosperity Pay</strong>.",
      "Clique no botão abaixo para autenticar seu e-mail e escolher uma nova senha.",
      "Se você não solicitou esta alteração, ignore este e-mail. Sua senha atual continuará válida.",
    ],
    buttonLabel: "Redefinir minha senha",
    link: params.link,
    footer: `© ${new Date().getFullYear()} Prosperity Pay. Mensagem automática de segurança.`,
  });

  await sendEmail({
    to: params.to,
    subject: "Redefina sua senha • Prosperity Pay",
    html,
    text: [
      `Olá, ${params.name}!`,
      "",
      "Recebemos uma solicitação para redefinir sua senha no Prosperity Pay.",
      "Abra o link abaixo para escolher uma nova senha:",
      params.link,
      "",
      "Se você não solicitou esta alteração, ignore este e-mail.",
    ].join("\n"),
  });
}


export async function sendAffiliateInvitationEmail(params: {
  to: string;
  name: string;
  productName: string;
  link: string;
  partnerType?: "affiliate" | "accredited";
}) {
  const productName = escapeHtml(params.productName);
  const accredited = params.partnerType === "accredited";
  const roleLabel = accredited ? "Credenciado" : "Afiliado";
  const roleLabelLower = accredited ? "credenciado" : "afiliado";

  const html = prosperityPayTemplate({
    eyebrow: "Convite de parceria",
    title: `Você recebeu um convite para ser ${roleLabel}`,
    subtitle: "Uma nova oportunidade espera por você no Prosperity Pay",
    name: params.name,
    paragraphs: [
      `Você foi convidado para participar como <strong>${roleLabelLower}</strong> do produto <strong>${productName}</strong>.`,
      `Ao aceitar o convite, sua parceria será ativada e você poderá acessar seu código de indicação, links, clientes atribuídos e acompanhar as comissões pelo Prosperity Pay.`,
      "Clique no botão abaixo para abrir a página do convite e escolher se deseja aceitar ou recusar.",
    ],
    details: [
      { label: "Produto", value: params.productName },
      { label: "Participação", value: roleLabel },
    ],
    buttonLabel: "Ver e aceitar convite",
    link: params.link,
    notice:
      "Este convite é pessoal e está vinculado ao e-mail que o recebeu. Entre no Prosperity Pay com esta mesma conta para responder.",
    footer: `© ${new Date().getFullYear()} Prosperity Pay. Convite de parceria.`,
  });

  await sendEmail({
    to: params.to,
    subject: `Convite para ser ${roleLabelLower} de ${params.productName} • Prosperity Pay`,
    html,
    text: [
      `Olá, ${params.name}!`,
      "",
      `Você foi convidado para participar como ${roleLabelLower} do produto ${params.productName} no Prosperity Pay.`,
      "Abra o link abaixo para visualizar e responder ao convite:",
      params.link,
      "",
      "Entre com a mesma conta que recebeu este e-mail.",
    ].join("\n"),
  });
}

export async function sendCoproducerInvitationEmail(params: {
  to: string;
  name: string;
  productName: string;
  participationPercent: string;
  scopeLabel: string;
  link: string;
}) {
  const productName = escapeHtml(params.productName);
  const participationPercent = escapeHtml(params.participationPercent);

  const html = prosperityPayTemplate({
    eyebrow: "Convite de parceria",
    title: "Você recebeu um convite de coprodução",
    subtitle: "Participe de um produto dentro do Prosperity Pay",
    name: params.name,
    paragraphs: [
      `Você foi convidado para participar como <strong>coprodutor</strong> do produto <strong>${productName}</strong>.`,
      `A participação definida para este convite é de <strong>${participationPercent}</strong> sobre o escopo informado pelo produtor.`,
      "Clique no botão abaixo para acessar a página do convite e escolher se deseja aceitar ou recusar a coprodução.",
    ],
    details: [
      { label: "Produto", value: params.productName },
      { label: "Participação", value: params.participationPercent },
      { label: "Escopo", value: params.scopeLabel },
      { label: "Validade do convite", value: "7 dias" },
    ],
    buttonLabel: "Ver e aceitar coprodução",
    link: params.link,
    notice:
      "Este convite é pessoal, válido por 7 dias e está vinculado ao e-mail que o recebeu. Se ainda não tiver uma conta, cadastre-se com este mesmo e-mail antes de responder.",
    footer: `© ${new Date().getFullYear()} Prosperity Pay. Convite de coprodução.`,
  });

  await sendEmail({
    to: params.to,
    subject: `Convite de coprodução para ${params.productName} • Prosperity Pay`,
    html,
    text: [
      `Olá, ${params.name}!`,
      "",
      `Você foi convidado para participar como coprodutor do produto ${params.productName}.`,
      `Participação: ${params.participationPercent}.`,
      `Escopo: ${params.scopeLabel}.`,
      "Abra o link abaixo para visualizar e responder ao convite:",
      params.link,
      "",
      "O convite é válido por 7 dias e deve ser respondido usando o mesmo e-mail que o recebeu.",
    ].join("\n"),
  });
}


type PaymentNotificationRole = "producer" | "coproducer" | "affiliate";
type PaymentNotificationEvent = "pix_generated" | "payment_approved";

function paymentRoleLabel(role: PaymentNotificationRole) {
  if (role === "producer") return "Produtor";
  if (role === "coproducer") return "Coprodutor";
  return "Afiliado";
}

function paymentMethodLabel(method: "pix" | "card") {
  return method === "pix" ? "PIX" : "Cartão";
}

function emailMoney(cents: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(Number(cents || 0) / 100);
}

export async function sendPaymentNotificationEmail(params: {
  to: string;
  name: string;
  event: PaymentNotificationEvent;
  role: PaymentNotificationRole;
  buyerName: string;
  buyerEmail: string;
  productName: string;
  offerName: string;
  amountCents: number;
  method: "pix" | "card";
  orderNumber: number | null;
  link: string;
}) {
  const buyerName = escapeHtml(params.buyerName || "Comprador");
  const productName = escapeHtml(params.productName);
  const offerName = escapeHtml(params.offerName);
  const roleLabel = paymentRoleLabel(params.role);
  const methodLabel = paymentMethodLabel(params.method);
  const orderLabel = params.orderNumber ? `#${params.orderNumber}` : "—";

  const isPixGenerated = params.event === "pix_generated";
  const html = prosperityPayTemplate({
    eyebrow: isPixGenerated ? "Novo PIX" : "Venda confirmada",
    title: isPixGenerated ? "Um PIX foi gerado" : "Pagamento aprovado",
    subtitle: isPixGenerated
      ? "Uma nova cobrança está aguardando pagamento"
      : "Uma venda foi confirmada no Prosperity Pay",
    name: params.name,
    paragraphs: isPixGenerated
      ? [
          `Um cliente gerou um <strong>PIX</strong> para o produto <strong>${productName}</strong>.`,
          `Você está vinculado a esta venda como <strong>${escapeHtml(roleLabel)}</strong>. O pagamento ainda está aguardando confirmação.`,
          "Assim que o PIX for pago e aprovado, você receberá uma nova notificação.",
        ]
      : [
          `O pagamento da venda de <strong>${productName}</strong> foi <strong>aprovado</strong>.`,
          `Você está vinculado a esta venda como <strong>${escapeHtml(roleLabel)}</strong>.`,
          "Os valores e comissões seguem as regras financeiras configuradas para o produto e a oferta.",
        ],
    details: [
      { label: "Pedido", value: orderLabel },
      { label: "Comprador", value: params.buyerName || "Comprador" },
      { label: "E-mail do comprador", value: params.buyerEmail || "Não informado" },
      { label: "Produto", value: params.productName },
      { label: "Plano / oferta", value: params.offerName },
      { label: "Valor da venda", value: emailMoney(params.amountCents) },
      { label: "Forma de pagamento", value: methodLabel },
      { label: "Sua participação", value: roleLabel },
      { label: "Status", value: isPixGenerated ? "Aguardando pagamento" : "Aprovado" },
    ],
    buttonLabel: isPixGenerated ? "Acompanhar no Prosperity Pay" : "Ver venda no Prosperity Pay",
    link: params.link,
    notice: isPixGenerated
      ? "Este e-mail é apenas uma notificação. A venda só será considerada confirmada após a aprovação do pagamento."
      : "Este e-mail confirma a atualização registrada no Prosperity Pay. Consulte o painel para acompanhar saldo, comissões e detalhes financeiros.",
    footer: `© ${new Date().getFullYear()} Prosperity Pay. Notificação financeira automática.`,
  });

  await sendEmail({
    to: params.to,
    subject: isPixGenerated
      ? `PIX gerado • ${params.productName} • Prosperity Pay`
      : `Pagamento aprovado • ${params.productName} • Prosperity Pay`,
    html,
    text: [
      `Olá, ${params.name}!`,
      "",
      isPixGenerated
        ? `Um PIX foi gerado para ${params.productName} e está aguardando pagamento.`
        : `O pagamento de ${params.productName} foi aprovado.`,
      `Pedido: ${orderLabel}`,
      `Comprador: ${params.buyerName} (${params.buyerEmail})`,
      `Plano / oferta: ${params.offerName}`,
      `Valor: ${emailMoney(params.amountCents)}`,
      `Forma: ${methodLabel}`,
      `Participação: ${roleLabel}`,
      "",
      params.link,
    ].join("\n"),
  });
}


function formatBillingCurrency(cents: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(Math.max(0, Number(cents || 0)) / 100);
}

function formatBillingDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(value));
}

export async function sendSubscriptionBillingEmail(params: {
  to: string;
  name: string;
  productName: string;
  dueAt: string;
  lines: Array<{
    description: string;
    quantity: number;
    totalAmountCents: number;
  }>;
  totalAmountCents: number;
  pixCode: string;
  checkoutUrl: string;
}) {
  const name = escapeHtml(params.name || "cliente");
  const productName = escapeHtml(params.productName || "Assinatura");
  const checkoutUrl = escapeHtml(params.checkoutUrl);
  const pixCode = escapeHtml(params.pixCode);
  const dueDate = escapeHtml(formatBillingDate(params.dueAt));
  const total = escapeHtml(formatBillingCurrency(params.totalAmountCents));

  const rows = params.lines
    .filter((line) => Number(line.totalAmountCents || 0) >= 0)
    .map((line, index) => {
      const description = escapeHtml(line.description || "Item da mensalidade");
      const quantity = Math.max(1, Number(line.quantity || 1));
      const amount = escapeHtml(formatBillingCurrency(line.totalAmountCents));
      const quantityLabel = quantity > 1
        ? ` <span style="color:#6b7f76;font-weight:600;">× ${quantity}</span>`
        : "";
      const operator = index === 0 ? "" : "+";

      return `
        <tr>
          <td style="width:24px;padding:9px 0;color:#159474;font-size:15px;font-weight:900;">${operator}</td>
          <td style="padding:9px 8px;color:#18342c;font-size:14px;font-weight:750;">${description}${quantityLabel}</td>
          <td align="right" style="padding:9px 0;color:#102a23;font-size:14px;font-weight:850;white-space:nowrap;">${amount}</td>
        </tr>`;
    })
    .join("");

  const html = `
  <!DOCTYPE html>
  <html lang="pt-BR">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>Sua mensalidade está disponível</title>
    </head>
    <body style="margin:0;padding:0;background:#eef4f1;font-family:Arial,Helvetica,sans-serif;">
      <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#eef4f1;padding:34px 14px;">
        <tr>
          <td align="center">
            <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="max-width:640px;background:#ffffff;border:1px solid #d8e5df;border-radius:22px;overflow:hidden;box-shadow:0 24px 70px rgba(10,45,35,.12);">
              <tr>
                <td style="background:linear-gradient(135deg,#071a14 0%,#0a2c22 58%,#11674f 100%);padding:34px 32px;">
                  <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
                    <tr>
                      <td>
                        <div style="color:#6bf0bc;font-size:11px;font-weight:900;letter-spacing:.12em;text-transform:uppercase;margin-bottom:10px;">Cobrança de mensalidade</div>
                        <h1 style="margin:0;color:#ffffff;font-size:27px;line-height:1.22;font-weight:850;letter-spacing:-.03em;">Sua mensalidade está disponível</h1>
                        <p style="margin:10px 0 0;color:#c2d9cf;font-size:14px;line-height:1.55;">${productName} · vencimento em ${dueDate}</p>
                      </td>
                      <td align="right" valign="top" style="padding-left:20px;">
                        <div style="display:inline-block;padding:9px 12px;border:1px solid rgba(107,240,188,.28);border-radius:12px;background:rgba(8,28,21,.55);color:#ffffff;font-size:15px;font-weight:900;">
                          Prosperity <span style="color:#f2ce70;font-size:11px;letter-spacing:.1em;">PAY</span>
                        </div>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>

              <tr>
                <td style="padding:32px;">
                  <p style="margin:0 0 10px;color:#102a23;font-size:18px;line-height:1.5;font-weight:850;">Olá, ${name}!</p>
                  <p style="margin:0 0 24px;color:#5b6f67;font-size:14px;line-height:1.7;">
                    A cobrança do seu próximo ciclo já foi gerada. Você pode pagar pelo PIX abaixo ou abrir o checkout para concluir com cartão.
                  </p>

                  <div style="margin-bottom:24px;padding:18px 20px;border:1px solid #dbe8e2;border-radius:16px;background:#f8fbf9;">
                    <div style="margin-bottom:8px;color:#178465;font-size:10px;font-weight:900;letter-spacing:.11em;text-transform:uppercase;">Composição da mensalidade</div>
                    <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
                      ${rows}
                      <tr>
                        <td colspan="3" style="height:1px;background:#dce8e2;"></td>
                      </tr>
                      <tr>
                        <td colspan="2" style="padding-top:14px;color:#60736b;font-size:12px;font-weight:850;text-transform:uppercase;">Total</td>
                        <td align="right" style="padding-top:14px;color:#0d8e68;font-size:21px;font-weight:900;white-space:nowrap;">${total}</td>
                      </tr>
                    </table>
                  </div>

                  <div style="margin-bottom:24px;padding:18px 20px;border:1px solid #cce5da;border-radius:16px;background:#f2faf6;">
                    <div style="margin-bottom:7px;color:#126b53;font-size:12px;font-weight:900;">PIX Copia e Cola</div>
                    <p style="margin:0;color:#50675d;font-size:12px;line-height:1.55;">Copie o código abaixo e cole na área PIX do seu banco:</p>
                    <div style="margin-top:12px;padding:13px 14px;border:1px dashed #9ccab7;border-radius:11px;background:#ffffff;color:#173c31;font-family:Consolas,Monaco,monospace;font-size:11px;line-height:1.55;word-break:break-all;">${pixCode}</div>
                  </div>

                  <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
                    <tr>
                      <td align="center" style="padding:2px 0 26px;">
                        <a href="${checkoutUrl}" style="display:inline-block;background:linear-gradient(135deg,#0f8065 0%,#16a477 100%);color:#ffffff;text-decoration:none;padding:15px 25px;border-radius:12px;font-size:14px;font-weight:900;box-shadow:0 10px 24px rgba(15,128,101,.18);">
                          Pagar com cartão ou abrir checkout
                        </a>
                      </td>
                    </tr>
                  </table>

                  <div style="padding:15px 17px;border-radius:13px;background:#f8faf9;border:1px solid #e2eae6;">
                    <p style="margin:0;color:#72827b;font-size:12px;line-height:1.6;">
                      Você pode manter este PIX em aberto e, se preferir, abrir o checkout para pagar com cartão ou gerar um novo PIX. O ciclo só é renovado após a confirmação de um dos pagamentos.
                    </p>
                  </div>

                  <p style="margin:22px 0 0;color:#8a9992;font-size:11px;line-height:1.6;word-break:break-all;">
                    Link de pagamento: ${checkoutUrl}
                  </p>
                </td>
              </tr>

              <tr>
                <td style="background:#f7faf8;border-top:1px solid #dce8e1;padding:20px 30px;text-align:center;">
                  <p style="margin:0 0 5px;color:#17362d;font-size:13px;font-weight:900;">Prosperity Pay</p>
                  <p style="margin:0;color:#91a099;font-size:11px;line-height:1.5;">Cobrança segura processada pela Prosperity Pay.</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
  </html>`;

  const compositionText = params.lines
    .map((line, index) => {
      const quantity = Math.max(1, Number(line.quantity || 1));
      return `${index === 0 ? "" : "+ "}${line.description}${quantity > 1 ? ` x ${quantity}` : ""}: ${formatBillingCurrency(line.totalAmountCents)}`;
    })
    .join("\n");

  await sendEmail({
    to: params.to,
    subject: `Mensalidade disponível • ${params.productName}`,
    html,
    text: [
      `Olá, ${params.name}!`,
      "",
      `Sua mensalidade de ${params.productName} está disponível.`,
      `Vencimento: ${formatBillingDate(params.dueAt)}`,
      "",
      "Composição:",
      compositionText,
      `Total: ${formatBillingCurrency(params.totalAmountCents)}`,
      "",
      "PIX Copia e Cola:",
      params.pixCode,
      "",
      "Para pagar com cartão ou abrir o checkout:",
      params.checkoutUrl,
      "",
      "Prosperity Pay",
    ].join("\n"),
  });
}
