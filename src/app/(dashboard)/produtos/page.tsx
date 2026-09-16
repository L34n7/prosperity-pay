import { ProductsView } from "@/components/products-view";
import styles from "./products-page.module.css";

export default function Page() {
  return <div className={styles.productsPage}><ProductsView/></div>;
}
