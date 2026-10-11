"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";

export function SensitiveValue({
  concealed,
  revealed,
  className,
  buttonClassName,
}: {
  concealed: string;
  revealed?: string | null;
  className?: string;
  buttonClassName?: string;
}) {
  const [visible, setVisible] = useState(false);

  return (
    <span className={className}>
      <strong>{visible && revealed ? revealed : concealed}</strong>
      {revealed ? (
        <button
          type="button"
          className={buttonClassName}
          onClick={() => setVisible((current) => !current)}
          aria-label={visible ? "Ocultar valor" : "Exibir valor"}
        >
          {visible ? <EyeOff size={17} /> : <Eye size={17} />}
          {visible ? "Ocultar" : "Exibir"}
        </button>
      ) : null}
    </span>
  );
}
