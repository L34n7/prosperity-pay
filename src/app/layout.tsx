import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Prosperity Pay",
    template: "%s | Prosperity Pay",
  },
  description: "Gestão de pagamentos, assinaturas e parceiros da Prosperity.",
  applicationName: "Prosperity Pay",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#050907",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
