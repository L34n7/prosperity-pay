import { ProductDetail } from "@/components/product-detail";
import { ProductDetailHero } from "@/components/product-detail-hero";
import legibility from "@/components/product-legibility.module.css";
import styles from "@/components/product-detail-shell.module.css";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <div className={`${styles.detailPage} ${legibility.scope}`}>
    <ProductDetailHero id={id}/>
    <ProductDetail id={id}/>
  </div>;
}
