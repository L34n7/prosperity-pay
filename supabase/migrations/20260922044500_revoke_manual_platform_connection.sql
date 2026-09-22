-- Manual bookkeeping connections do not process checkout payments.
-- Keep historical payment FKs intact but remove the manual connection from
-- the set of active Prosperity Balance collectors.

update public.payment_provider_connections ppc
set status = 'revoked',
    updated_at = now()
from public.payment_providers pp
where ppc.provider_id = pp.id
  and pp.code = 'manual'
  and ppc.connection_kind = 'prosperity_balance'
  and ppc.status = 'active';
