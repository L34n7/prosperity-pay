import { ProductsView } from "@/components/products-view";
import legibility from "@/components/product-legibility.module.css";
import styles from "./products-page.module.css";

export default function Page() {
  return <div className={`${styles.productsPage} ${legibility.scope}`}><ProductsView/></div>;
}
