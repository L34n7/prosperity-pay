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

type LooseTable<Row extends object> = {
  Row: Row;
  Insert: Partial<Row>;
  Update: Partial<Row>;
  Relationships: [];
};

type RecurrenceFrequency = "weekly" | "monthly" | "quarterly" | "semiannual" | "annual";

type ProductCommercialColumns = {
  payment_type: "one_time" | "recurring";
  billing_model: "prepaid" | "postpaid";
  product_type: "digital" | "physical";
  category: string | null;
  support_display_name: string | null;
  support_email: string | null;
  support_whatsapp: string | null;
  post_purchase_message: string | null;
  post_purchase_redirect_url: string | null;
  affiliate_funnel_base_url: string | null;
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

type AffiliateMembershipPartnerColumns = {
  partner_type: "affiliate" | "accredited";
};

type AffiliateProgramSettingsColumns = {
  attribution_model: "last_click" | "first_click";
  customer_data_access: boolean;
  marketplace_enabled: boolean;
  commission_addons: boolean;
  commission_prorated_changes: boolean;
  support_email: string | null;
  landing_page_url: string | null;
  marketplace_description: string | null;
  marketplace_tags: string[];
};

type SubscriptionTransparentColumns = {
  payment_profile_id: string | null;
  product_id: string;
  billing_model: "prepaid" | "postpaid";
  base_amount_cents: number;
  current_amount_cents: number;
  next_due_at: string | null;
  affiliate_membership_id: string | null;
  affiliate_link_id: string | null;
  metadata: Json;
  external_reference: string | null;
};

type OrderBillingColumns = {
  subscription_id: string | null;
  subscription_change_id: string | null;
  billing_reason: "purchase" | "subscription_initial" | "subscription_renewal" | "subscription_change";
};

type ProductAddonRow = {
  id: string;
  product_id: string;
  code: string;
  name: string;
  description: string | null;
  unit_amount_cents: number;
  currency: string;
  active: boolean;
  max_quantity: number | null;
  metadata: Json;
  created_at: string;
  updated_at: string;
};

type SubscriptionItemRow = {
  id: string;
  subscription_id: string;
  item_type: "base" | "addon";
  offer_id: string | null;
  addon_id: string | null;
  code: string;
  description: string;
  unit_amount_cents: number;
  quantity: number;
  status: "pending" | "active" | "ended";
  activated_at: string | null;
  ended_at: string | null;
  metadata: Json;
  created_at: string;
  updated_at: string;
};

type SubscriptionChangeRow = {
  id: string;
  subscription_id: string;
  change_type: "upgrade" | "downgrade" | "add_item" | "remove_item" | "increase_quantity" | "decrease_quantity";
  status: "quoted" | "awaiting_payment" | "payment_approved" | "scheduled" | "applying" | "applied" | "expired" | "cancelled" | "failed";
  from_offer_id: string | null;
  to_offer_id: string | null;
  addon_id: string | null;
  quantity_delta: number | null;
  quantity_before: number | null;
  quantity_after: number | null;
  base_amount_before_cents: number | null;
  base_amount_after_cents: number | null;
  current_amount_cents: number;
  quoted_target_amount_cents: number;
  applied_target_amount_cents: number | null;
  proration_amount_cents: number;
  commissionable_amount_cents: number;
  effective_mode: "immediately_after_payment" | "next_period_after_payment";
  effective_at: string | null;
  quote_expires_at: string | null;
  payment_order_id: string | null;
  paid_at: string | null;
  applied_at: string | null;
  cancelled_at: string | null;
  failure_reason: string | null;
  metadata: Json;
  created_at: string;
  updated_at: string;
};

type OrderItemRow = {
  id: string;
  order_id: string;
  subscription_id: string | null;
  subscription_item_id: string | null;
  line_type: "base" | "addon" | "proration";
  item_code: string;
  description: string;
  unit_amount_cents: number;
  quantity: number;
  total_amount_cents: number;
  commissionable_amount_cents: number;
  metadata: Json;
  created_at: string;
};

type SubscriptionCheckoutSessionRow = {
  id: string;
  token_hash: string;
  subscription_id: string;
  subscription_change_id: string | null;
  session_type: "subscription_change" | "subscription_renewal";
  amount_cents: number;
  currency: string;
  order_id: string | null;
  expires_at: string;
  consumed_at: string | null;
  metadata: Json;
  created_at: string;
  updated_at: string;
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


type PaymentEmailDeliveryRow = {
  id: string;
  payment_id: string;
  event_type: "pix_generated" | "payment_approved";
  recipient_user_id: string;
  recipient_email: string;
  recipient_role: "producer" | "coproducer" | "affiliate";
  status: "pending" | "sent" | "failed";
  attempts: number;
  last_error: string | null;
  sent_at: string | null;
  created_at: string;
  updated_at: string;
};

type PaymentEmailDeliveryTable = {
  Row: PaymentEmailDeliveryRow;
  Insert: {
    id?: string;
    payment_id: string;
    event_type: "pix_generated" | "payment_approved";
    recipient_user_id: string;
    recipient_email: string;
    recipient_role: "producer" | "coproducer" | "affiliate";
    status?: "pending" | "sent" | "failed";
    attempts?: number;
    last_error?: string | null;
    sent_at?: string | null;
    created_at?: string;
    updated_at?: string;
  };
  Update: Partial<PaymentEmailDeliveryRow>;
  Relationships: [
    {
      foreignKeyName: "payment_email_deliveries_payment_id_fkey";
      columns: ["payment_id"];
      isOneToOne: false;
      referencedRelation: "payments";
      referencedColumns: ["id"];
    },
    {
      foreignKeyName: "payment_email_deliveries_recipient_user_id_fkey";
      columns: ["recipient_user_id"];
      isOneToOne: false;
      referencedRelation: "profiles";
      referencedColumns: ["id"];
    },
  ];
};

type FirstAccessTokenRow = {
  id: string;
  auth_user_id: string;
  email: string;
  token_hash: string;
  expires_at: string;
  openings: number;
  max_openings: number;
  last_opened_at: string | null;
  password_set_at: string | null;
  invalidated_at: string | null;
  processing_at: string | null;
  created_at: string;
  updated_at: string;
};

type FirstAccessTokenTable = {
  Row: FirstAccessTokenRow;
  Insert: {
    id?: string;
    auth_user_id: string;
    email: string;
    token_hash: string;
    expires_at: string;
    openings?: number;
    max_openings?: number;
    last_opened_at?: string | null;
    password_set_at?: string | null;
    invalidated_at?: string | null;
    processing_at?: string | null;
    created_at?: string;
    updated_at?: string;
  };
  Update: Partial<FirstAccessTokenRow>;
  Relationships: [];
};

type FirstAccessOpenResult = {
  ok: boolean;
  reason: string;
  email: string | null;
  openings: number;
  max_openings: number;
  remaining_openings: number;
  expires_at: string | null;
};

type FirstAccessPasswordReservation = {
  ok: boolean;
  reason: string;
  auth_user_id: string | null;
  email: string | null;
};

type PublicSchema = GeneratedDatabase["public"];
type GeneratedTables = PublicSchema["Tables"];
type GeneratedFunctions = PublicSchema["Functions"];

/**
 * Database type used by Supabase clients.
 *
 * The checked-in generated file predates the latest product/offer, transparent
 * checkout, platform bootstrap, CRM webhook integration and first-access
 * migrations. This layer keeps the client strictly typed against the live
 * schema without weakening mutations with any/never casts. When
 * database.types.ts is regenerated from Supabase, these additions can be
 * folded back into it.
 */
export type Database = Omit<GeneratedDatabase, "public"> & {
  public: Omit<PublicSchema, "Tables" | "Functions"> & {
    Tables: Omit<
      GeneratedTables,
      "products" | "offers" | "subscriptions" | "affiliate_programs" | "affiliate_memberships" | "orders"
    > & {
      products: ExtendTable<GeneratedTables["products"], ProductCommercialColumns>;
      offers: ExtendTable<GeneratedTables["offers"], OfferCommercialColumns>;
      affiliate_programs: ExtendTable<
        GeneratedTables["affiliate_programs"],
        AffiliateProgramSettingsColumns
      >;
      affiliate_memberships: ExtendTable<
        GeneratedTables["affiliate_memberships"],
        AffiliateMembershipPartnerColumns
      >;
      subscriptions: ExtendTable<
        GeneratedTables["subscriptions"],
        SubscriptionTransparentColumns
      >;
      orders: ExtendTable<GeneratedTables["orders"], OrderBillingColumns>;
      product_addons: LooseTable<ProductAddonRow>;
      subscription_items: LooseTable<SubscriptionItemRow>;
      subscription_changes: LooseTable<SubscriptionChangeRow>;
      order_items: LooseTable<OrderItemRow>;
      subscription_checkout_sessions: LooseTable<SubscriptionCheckoutSessionRow>;
      integration_webhook_routes: IntegrationWebhookRouteTable;
      integration_webhook_deliveries: IntegrationWebhookDeliveryTable;
      payment_email_deliveries: PaymentEmailDeliveryTable;
      first_access_tokens: FirstAccessTokenTable;
    };
    Functions: GeneratedFunctions & {
      bootstrap_initial_platform_admin: {
        Args: never;
        Returns: boolean;
      };
      get_auth_user_id_by_email: {
        Args: { p_email: string };
        Returns: string | null;
      };
      register_first_access_open: {
        Args: { p_token_hash: string };
        Returns: FirstAccessOpenResult[];
      };
      reserve_first_access_password: {
        Args: { p_token_hash: string };
        Returns: FirstAccessPasswordReservation[];
      };
      complete_first_access_password: {
        Args: { p_token_hash: string };
        Returns: boolean;
      };
      release_first_access_password: {
        Args: { p_token_hash: string };
        Returns: undefined;
      };
      activate_prepaid_subscription: {
        Args: {
          target_subscription_id: string;
          target_payment_id: string;
          target_period_start: string;
          target_period_end: string;
        };
        Returns: Json;
      };
      apply_paid_subscription_change: {
        Args: { target_change_id: string; target_payment_id: string };
        Returns: number;
      };
      apply_prepaid_subscription_renewal: {
        Args: {
          target_subscription_id: string;
          target_payment_id: string;
          target_period_start: string;
          target_period_end: string;
        };
        Returns: Json;
      };
      claim_subscription_checkout_session: {
        Args: { target_session_id: string; target_order_id: string };
        Returns: string | null;
      };
      import_prepaid_subscription: {
        Args: {
          target_product_id: string;
          target_customer_id: string;
          target_offer_id: string;
          target_provider_id: string;
          target_external_reference: string;
          target_status: Database["public"]["Enums"]["subscription_status"];
          target_amount_cents: number;
          target_currency: string;
          target_period_start: string;
          target_period_end: string;
          target_affiliate_membership_id: string | null;
          target_affiliate_link_id: string | null;
          target_item_code: string;
          target_item_description: string;
          target_metadata: Json;
        };
        Returns: { subscription_id: string; imported: boolean }[];
      };
    };
  };
};
