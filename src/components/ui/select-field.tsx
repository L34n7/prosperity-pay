import { ChevronDown } from "lucide-react";
import type { SelectHTMLAttributes } from "react";

export function SelectField(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <label className="select-field">
      <select {...props} />
      <ChevronDown size={15} aria-hidden="true" />
    </label>
  );
}
