import type { Database as GeneratedDatabase, Json } from "./database.types";

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

type SubscriptionTransparentColumns = {
  payment_profile_id: string | null;
};

type IntegrationWebhookRouteRow = {
  id: string;
  integration: string;
  offer_reference: string;
  active: boolean;
  metadata: Json;
  created_at: string;
  updated_at: string;
};

type IntegrationWebhookRouteTable = {
  Row: IntegrationWebhookRouteRow;
  Insert: {
    id?: string;
    integration: string;
    offer_reference: string;
    active?: boolean;
    metadata?: Json;
    created_at?: string;
    updated_at?: string;
  };
  Update: Partial<IntegrationWebhookRouteRow>;
  Relationships: [];
};

type IntegrationWebhookDeliveryRow = {
  id: string;
  event_id: string;
  integration: string;
  payment_id: string;
  event_type: string;
  payload: Json;
  status: "pending" | "delivered" | "failed";
  attempts: number;
  response_status: number | null;
  response_body: string | null;
  last_error: string | null;
  last_attempt_at: string | null;
  delivered_at: string | null;
  created_at: string;
  updated_at: string;
};

type IntegrationWebhookDeliveryTable = {
  Row: IntegrationWebhookDeliveryRow;
  Insert: {
    id?: string;
    event_id?: string;
    integration: string;
    payment_id: string;
    event_type: string;
    payload?: Json;
    status?: "pending" | "delivered" | "failed";
    attempts?: number;
    response_status?: number | null;
    response_body?: string | null;
    last_error?: string | null;
    last_attempt_at?: string | null;
    delivered_at?: string | null;
    created_at?: string;
    updated_at?: string;
  };
  Update: Partial<IntegrationWebhookDeliveryRow>;
  Relationships: [
    {
      foreignKeyName: "integration_webhook_deliveries_payment_id_fkey";
      columns: ["payment_id"];
      isOneToOne: false;
      referencedRelation: "payments";
      referencedColumns: ["id"];
    },
  ];
};

type PublicSchema = GeneratedDatabase["public"];
type GeneratedTables = PublicSchema["Tables"];
type GeneratedFunctions = PublicSchema["Functions"];

/**
 * Database type used by Supabase clients.
 *
 * The checked-in generated file predates the latest product/offer, transparent
 * checkout, platform bootstrap and CRM webhook integration migrations. This
 * layer keeps the client strictly typed against the live schema without
 * weakening mutations with `any`/`never` casts. When database.types.ts is
 * regenerated from Supabase, these additions can be folded back into it.
 */
export type Database = Omit<GeneratedDatabase, "public"> & {
  public: Omit<PublicSchema, "Tables" | "Functions"> & {
    Tables: Omit<GeneratedTables, "products" | "offers" | "subscriptions"> & {
      products: ExtendTable<GeneratedTables["products"], ProductCommercialColumns>;
      offers: ExtendTable<GeneratedTables["offers"], OfferCommercialColumns>;
      subscriptions: ExtendTable<GeneratedTables["subscriptions"], SubscriptionTransparentColumns>;
      integration_webhook_routes: IntegrationWebhookRouteTable;
      integration_webhook_deliveries: IntegrationWebhookDeliveryTable;
    };
    Functions: GeneratedFunctions & {
      bootstrap_initial_platform_admin: {
        Args: never;
        Returns: boolean;
      };
    };
  };
};
