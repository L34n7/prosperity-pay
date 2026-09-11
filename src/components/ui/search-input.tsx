import { Search, X } from "lucide-react";

type SearchInputProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
};

export function SearchInput({ value, onChange, placeholder = "Buscar" }: SearchInputProps) {
  return (
    <label className="search-input">
      <Search size={17} aria-hidden="true" />
      <span className="sr-only">{placeholder}</span>
      <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
      {value && (
        <button type="button" onClick={() => onChange("")} aria-label="Limpar busca">
          <X size={15} />
        </button>
      )}
    </label>
  );
}
