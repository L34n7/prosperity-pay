"use client";

import { Check, CheckCircle2, Clock3, Copy, LockKeyhole, ShieldCheck, Sparkles } from "lucide-react";
import { FormEvent, useState } from "react";
import { Brand } from "@/components/ui/brand";

const pixCode = "00020126580014BR.GOV.BCB.PIX0136prosperity-pay-demo-1375204000053039865406137.005802BR5914PROSPERITY PAY6009SAO PAULO62070503***6304A1B2";

const qrCells = Array.from({ length: 225 }, (_, index) => {
  const row = Math.floor(index / 15);
  const col = index % 15;
  const finder = (row < 5 && col < 5) || (row < 5 && col > 9) || (row > 9 && col < 5);
  return finder || ((row * 7 + col * 11 + row * col) % 5 < 2);
});

function CheckoutProgress({ paid = false }: { paid?: boolean }) {
  return (
    <div className="checkout-progress">
      {[
        { label: "Pedido criado", complete: true },
        { label: "Pagamento confirmado", complete: paid },
        { label: "Plano ativado", complete: paid },
      ].map((step, index) => (
        <div key={step.label} className={step.complete ? "complete" : ""}>
          <span>{step.complete ? <Check size={13} /> : index + 1}</span>
          <small>{step.label}</small>
        </div>
      ))}
    </div>
  );
}

export function CheckoutFlow({ affiliate }: { affiliate?: string }) {
  const [step, setStep] = useState<"form" | "pix">("form");
  const [copied, setCopied] = useState(false);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStep("pix");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function copyPix() {
    await navigator.clipboard.writeText(pixCode);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  return (
    <main className="checkout-page">
      <div className="checkout-glow checkout-glow-one" />
      <div className="checkout-glow checkout-glow-two" />
      <header className="checkout-header">
        <Brand href="/checkout/basico" />
        <span><LockKeyhole size={14} /> Ambiente seguro</span>
      </header>

      <div className="checkout-layout">
        <section className="checkout-product">
          <span className="checkout-badge"><Sparkles size={14} /> Plano Prosperity CRM</span>
          <h1>Transforme conversas<br />em <em>crescimento.</em></h1>
          <p>Atendimento, automação e gestão em um só lugar para sua empresa vender com mais previsibilidade.</p>
          <ul>
            <li><CheckCircle2 size={18} /> Automação de atendimento no WhatsApp</li>
            <li><CheckCircle2 size={18} /> CRM completo para organizar seus clientes</li>
            <li><CheckCircle2 size={18} /> Agendamentos e fluxos inteligentes</li>
            <li><CheckCircle2 size={18} /> Suporte especializado Prosperity</li>
          </ul>
          <div className="security-note"><ShieldCheck size={22} /><div><strong>Seus dados estão protegidos</strong><span>Pagamento processado em ambiente seguro.</span></div></div>
        </section>

        <section className="checkout-card">
          <div className="checkout-card-head">
            <div><span>{step === "form" ? "Resumo do pedido" : "Pagamento via PIX"}</span><h2>Plano Básico</h2></div>
            <div className="checkout-price"><strong>R$ 137</strong><span>/mês</span></div>
          </div>
          {affiliate && <div className="referral-note">Indicação <strong>{affiliate}</strong> aplicada</div>}

          {step === "form" ? (
            <form onSubmit={handleSubmit} className="checkout-form">
              <div className="checkout-divider"><span>Dados do comprador</span></div>
              <label>Nome completo<input name="name" placeholder="Como devemos chamar você?" required /></label>
              <label>E-mail<input name="email" type="email" placeholder="voce@empresa.com.br" required /></label>
              <label>CPF ou CNPJ<input name="document" inputMode="numeric" placeholder="Digite apenas números" required minLength={11} /></label>
              <button className="checkout-submit" type="submit">Continuar para pagamento <span>→</span></button>
              <p className="checkout-terms">Ao continuar, você concorda com os Termos de Uso e a Política de Privacidade.</p>
            </form>
          ) : (
            <div className="pix-step">
              <CheckoutProgress />
              <div className="pix-status"><Clock3 size={17} /><div><strong>Aguardando pagamento</strong><span>O pedido será atualizado automaticamente.</span></div></div>
              <div className="qr-shell">
                <div className="fake-qr" aria-label="QR Code PIX demonstrativo">
                  {qrCells.map((filled, index) => <i key={index} className={filled ? "filled" : ""} />)}
                  <span>P</span>
                </div>
                <small>QR Code demonstrativo</small>
              </div>
              <div className="pix-copy">
                <span>{pixCode}</span>
                <button onClick={copyPix} aria-label="Copiar código PIX">{copied ? <Check size={17} /> : <Copy size={17} />}</button>
              </div>
              <button className="checkout-submit" onClick={copyPix}>{copied ? "Código copiado" : "Copiar PIX"}</button>
              <button className="text-button" onClick={() => setStep("form")}>Voltar e editar dados</button>
            </div>
          )}

          <footer className="checkout-card-footer"><LockKeyhole size={13} /> Pagamento protegido e criptografado</footer>
        </section>
      </div>
      <footer className="checkout-footer"><span>© 2026 Prosperity Pay</span><span>Privacidade · Termos · Suporte</span></footer>
      {copied && <div className="checkout-toast"><Check size={16} /> Código PIX copiado</div>}
    </main>
  );
}
