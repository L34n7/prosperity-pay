alter type public.allocation_type
  add value if not exists 'accredited' after 'affiliate';

alter type public.ledger_entry_type
  add value if not exists 'accredited_commission' after 'affiliate_commission';
