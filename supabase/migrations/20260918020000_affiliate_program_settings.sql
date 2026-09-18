alter table public.affiliate_programs
  add column attribution_model text not null default 'last_click',
  add column customer_data_access boolean not null default false,
  add column marketplace_enabled boolean not null default false,
  add column support_email text,
  add column landing_page_url text,
  add column marketplace_description text,
  add column marketplace_tags text[] not null default '{}'::text[];

alter table public.affiliate_programs
  add constraint affiliate_programs_attribution_model_check check (attribution_model in ('last_click','first_click')),
  add constraint affiliate_programs_support_email_length_check check (support_email is null or char_length(support_email) <= 320),
  add constraint affiliate_programs_landing_page_url_length_check check (landing_page_url is null or char_length(landing_page_url) <= 2048),
  add constraint affiliate_programs_landing_page_url_protocol_check check (landing_page_url is null or landing_page_url ~* '^https?://'),
  add constraint affiliate_programs_marketplace_description_length_check check (marketplace_description is null or char_length(marketplace_description) <= 4000),
  add constraint affiliate_programs_marketplace_tags_count_check check (cardinality(marketplace_tags) <= 20);
