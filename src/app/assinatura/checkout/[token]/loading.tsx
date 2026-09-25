import styles from "@/components/checkout/transparent-checkout.module.css";

export default function Loading() {
  return (
    <main className={styles.checkoutLoadingPage}>
      <section
        className={styles.checkoutLoadingCard}
        role="status"
        aria-live="polite"
        aria-label="Carregando checkout"
      >
        <div className={styles.checkoutLoadingSpinner} aria-hidden="true" />
        <strong>Preparando seu checkout</strong>
        <span>
          Estamos carregando o plano, os adicionais e os dados seguros de pagamento.
        </span>
        <div className={styles.checkoutLoadingDots} aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
      </section>
    </main>
  );
}
