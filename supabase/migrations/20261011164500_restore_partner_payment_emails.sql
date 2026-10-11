update public.products
set
  partner_payment_emails_enabled = true,
  updated_at = now()
where lower(trim(name)) = 'crm prosperity';
