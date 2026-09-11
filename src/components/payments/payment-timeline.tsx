import { Check, Clock3 } from "lucide-react";

const events = [
  { title: "Checkout criado", time: "29/06/2026 às 14:30", complete: true },
  { title: "Pagamento PIX gerado", time: "29/06/2026 às 14:30", complete: true },
  { title: "Pagamento aprovado", time: "29/06/2026 às 14:32", complete: true },
  { title: "Comissão criada", time: "29/06/2026 às 14:32", complete: true },
  { title: "Comissão liberada", time: "Prevista para 06/07/2026", complete: false },
];

export function PaymentTimeline() {
  return (
    <ol className="payment-timeline">
      {events.map((event) => (
        <li key={event.title} className={event.complete ? "complete" : "pending"}>
          <span>{event.complete ? <Check size={13} /> : <Clock3 size={13} />}</span>
          <div><strong>{event.title}</strong><small>{event.time}</small></div>
        </li>
      ))}
    </ol>
  );
}
