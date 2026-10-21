"use client";

import { useState } from "react";
import {
  SALES_CASH_PRESETS,
  resolveSalesCashPreset,
  type SalesCashPreset,
  type SalesCashRangeFields,
} from "@/lib/sales/cash-control-presets";

export function SalesCashFilters({
  preset: initialPreset,
  fields: initialFields,
}: {
  preset: SalesCashPreset;
  fields: SalesCashRangeFields;
}) {
  const [preset, setPreset] = useState<SalesCashPreset>(initialPreset);
  const [fields, setFields] = useState(initialFields);

  function changePreset(value: string) {
    const next = value as SalesCashPreset;
    setPreset(next);
    if (next !== "custom") {
      setFields(resolveSalesCashPreset(next, new Date()));
    }
  }

  function changeField(
    key: keyof SalesCashRangeFields,
    value: string,
  ) {
    setPreset("custom");
    setFields((current) => ({ ...current, [key]: value }));
  }

  return (
    <form className="cash-control-filters" method="get">
      <input type="hidden" name="tab" value="caixa" />

      <label className="cash-control-preset">
        Filtro rápido
        <select
          name="preset"
          value={preset}
          onChange={(event) => changePreset(event.target.value)}
        >
          {preset === "custom" && <option value="custom">Personalizado</option>}
          {SALES_CASH_PRESETS.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
      </label>

      <label>
        Data inicial
        <input
          type="date"
          name="startDate"
          required
          value={fields.startDate}
          onChange={(event) => changeField("startDate", event.target.value)}
        />
      </label>

      <label>
        Hora inicial
        <input
          type="time"
          name="startTime"
          step="60"
          required
          value={fields.startTime}
          onChange={(event) => changeField("startTime", event.target.value)}
        />
      </label>

      <label>
        Data final
        <input
          type="date"
          name="endDate"
          required
          value={fields.endDate}
          onChange={(event) => changeField("endDate", event.target.value)}
        />
      </label>

      <label>
        Hora final
        <input
          type="time"
          name="endTime"
          step="60"
          required
          value={fields.endTime}
          onChange={(event) => changeField("endTime", event.target.value)}
        />
      </label>

      <div className="cash-control-actions">
        <button className="primary-button" type="submit">
          Aplicar
        </button>
      </div>
    </form>
  );
}
