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
}) {
  const name = escapeHtml(params.name || "cliente");
  const link = escapeHtml(params.link);
  const paragraphs = params.paragraphs
    .map(
      (paragraph) =>
        `<p style="margin:0 0 18px;color:#475569;font-size:15px;line-height:1.7;">${paragraph}</p>`,
    )
    .join("");

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
                  <p style="margin:0;color:#64748b;font-size:13px;line-height:1.7;">Por segurança, não compartilhe este link. Ele concede acesso temporário para concluir a configuração da sua conta.</p>
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
    console.error("[RESEND_AUTH] Falha ao enviar e-mail.", {
      status: response.status,
      name: body?.name,
      message: body?.message,
    });

    throw new Error(
      "Não foi possível enviar o e-mail de acesso agora. Tente novamente em alguns minutos.",
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
