"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, ChevronDown, LoaderCircle } from "lucide-react";
import styles from "@/app/(dashboard)/credenciados/gestao/producer-accredited.module.css";

export function ProducerAccreditedFilters({
  month, productId, products,
}: {
  month: string;
  productId: string;
  products: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selectedMonth, setMonth] = useState(month);
  const [selectedProduct, setProduct] = useState(productId);

  return (
    <form className={styles.filters} onSubmit={(event) => {
      event.preventDefault();
      const params = new URLSearchParams();
      params.set("mes", selectedMonth);
      if (selectedProduct !== "all") params.set("produto", selectedProduct);
      startTransition(() => router.push(`/credenciados/gestao?${params.toString()}`));
    }}>
      <label>
        <span><CalendarDays size={15} /> Mês de referência</span>
        <input
          type="month" value={selectedMonth}
          onChange={(event) => setMonth(event.target.value)}
          required min="2020-01" max="2100-12"
        />
      </label>
      <label>
        <span>Produto</span>
        <span className={styles.selectWrap}>
          <select value={selectedProduct} onChange={(event) => setProduct(event.target.value)}>
            <option value="all">Todos os meus produtos</option>
            {products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
          </select>
          <ChevronDown size={16} />
        </span>
      </label>
      <button className={styles.apply} type="submit" disabled={pending}>
        {pending ? <LoaderCircle className={styles.spinner} size={17} /> : <CalendarDays size={17} />}
        {pending ? "Consultando..." : "Aplicar filtros"}
      </button>
    </form>
  );
}
