import { ProductDetail } from "@/components/product-detail";
export default async function Page({ params }: { params: Promise<{ id: string }> }) { return <ProductDetail id={(await params).id}/>; }
