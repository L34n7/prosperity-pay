import type { Database as GeneratedDatabase } from "./database.types";

type TableDefinition = {
  Row: unknown;
  Insert: unknown;
  Update: unknown;
  Relationships: unknown;
};

type ExtendTable<Table extends TableDefinition, AddedRow extends object> = {
  Row: Table["Row"] & AddedRow;
  Insert: Table["Insert"] & Partial<AddedRow>;
  Update: Table["Update"] & Partial<AddedRow>;
  Relationships: Table["Relationships"];
};

type RecurrenceFrequency = "weekly" | "monthly" | "quarterly" | "semiannual" | "annual";

type ProductCommercialColumns = {
  payment_type: "one_time" | "recurring";
  product_type: "digital" | "physical";
  category: string | null;
  support_display_name: string | null;
  support_email: string | null;
  support_whatsapp: string | null;
  recurrence_frequency: RecurrenceFrequency | null;
  different_first_charge: boolean;
  first_charge_cents: number | null;
  recurring_price_cents: number | null;
  main_offer_price_cents: number | null;
};

type OfferCommercialColumns = {
  payment_card_enabled: boolean;
  payment_pix_enabled: boolean;
  primary_payment_method: "card" | "pix";
  first_charge_cents: number | null;
  affiliate_enabled: boolean;
};

type PublicSchema = GeneratedDatabase["public"];
type GeneratedTables = PublicSchema["Tables"];
type GeneratedFunctions = PublicSchema["Functions"];

/**
 * Database type used by Supabase clients.
 *
 * The checked-in generated file predates the latest product/offer and platform
 * bootstrap migrations. This layer keeps the client strictly typed against the
 * live schema without weakening mutations with `any`/`never` casts. When
 * database.types.ts is regenerated from Supabase, these additions can be folded
 * back into it.
 */
export type Database = Omit<GeneratedDatabase, "public"> & {
  public: Omit<PublicSchema, "Tables" | "Functions"> & {
    Tables: Omit<GeneratedTables, "products" | "offers"> & {
      products: ExtendTable<GeneratedTables["products"], ProductCommercialColumns>;
      offers: ExtendTable<GeneratedTables["offers"], OfferCommercialColumns>;
    };
    Functions: GeneratedFunctions & {
      bootstrap_initial_platform_admin: {
        Args: never;
        Returns: boolean;
      };
    };
  };
};
