alter table public.affiliate_programs
  add column if not exists attribution_model text not null default 'last_click',
  add column if not exists customer_data_access boolean not null default false,
  add column if not exists marketplace_enabled boolean not null default false,
  add column if not exists support_email text,
  add column if not exists landing_page_url text,
  add column if not exists marketplace_description text,
  add column if not exists marketplace_tags text[] not null default '{}'::text[];

alter table public.affiliate_programs
  drop constraint if exists affiliate_programs_attribution_model_check,
  add constraint affiliate_programs_attribution_model_check check (attribution_model in ('last_click','first_click')),
  drop constraint if exists affiliate_programs_support_email_length_check,
  add constraint affiliate_programs_support_email_length_check check (support_email is null or char_length(support_email) <= 320),
  drop constraint if exists affiliate_programs_landing_page_url_length_check,
  add constraint affiliate_programs_landing_page_url_length_check check (landing_page_url is null or char_length(landing_page_url) <= 2048),
  drop constraint if exists affiliate_programs_landing_page_url_protocol_check,
  add constraint affiliate_programs_landing_page_url_protocol_check check (landing_page_url is null or landing_page_url ~* '^https?://'),
  drop constraint if exists affiliate_programs_marketplace_description_length_check,
  add constraint affiliate_programs_marketplace_description_length_check check (marketplace_description is null or char_length(marketplace_description) <= 4000),
  drop constraint if exists affiliate_programs_marketplace_tags_count_check,
  add constraint affiliate_programs_marketplace_tags_count_check check (cardinality(marketplace_tags) <= 20);
