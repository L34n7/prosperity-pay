import Link from "next/link";

type BrandProps = {
  compact?: boolean;
  href?: string;
};

export function Brand({ compact = false, href = "/dashboard" }: BrandProps) {
  return (
    <Link href={href} className="brand" aria-label="Prosperity Pay">
      <span className="brand-mark" aria-hidden="true">
        <svg viewBox="0 0 34 34" role="img">
          <path d="M8 25.5V8.5h9.5c5.4 0 8.5 2.7 8.5 7.3 0 4.5-3.1 7.2-8.5 7.2H13v2.5H8Zm5-7h4.2c2.5 0 3.8-.9 3.8-2.7s-1.3-2.8-3.8-2.8H13v5.5Z" />
          <path className="brand-spark" d="m24.4 22.7 3.2-2.1-1.1 3.7 2.7 2.6-3.8.1-1.7 3.4-1.3-3.6-3.7-.6 3-2.3-.6-3.8 3.3 1.6Z" />
        </svg>
      </span>
      {!compact && (
        <span className="brand-wordmark">
          <strong>Prosperity</strong>
          <span>PAY</span>
        </span>
      )}
    </Link>
  );
}
