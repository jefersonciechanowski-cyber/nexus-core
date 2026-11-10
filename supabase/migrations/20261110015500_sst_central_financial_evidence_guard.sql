-- Nexus Central commercial data: the browser may edit lead notes/stages with
-- MFA, but must NEVER manufacture a provider checkout, paid receipt or
-- subscription for another party. Provider fields are server-owned.
begin;

create or replace function public.guard_nexus_sales_financial_evidence()
returns trigger language plpgsql security invoker set search_path=''
as $$
declare
 v_field text;
 v_protected text[] := array[
   'source','provider','environment','return_origin','external_reference',
   'asaas_customer_id','asaas_checkout_id','asaas_checkout_url',
   'asaas_subscription_id','provider_customer_id','provider_checkout_id',
   'provider_checkout_url','provider_subscription_id','organization_id','user_id',
   'paid_at','provisioned_at','checkout_amount_cents','billing_mode','billing_cycle_months'
 ];
begin
 if current_user not in ('authenticated','anon') then
   return coalesce(new,old); -- only finance backend / migrations can write proof
 end if;
 if tg_op='DELETE' then
   if old.sale_status in ('paid','provisioned','checkout_created')
     or old.provider_checkout_id is not null or old.asaas_checkout_id is not null
     or old.paid_at is not null
   then raise exception 'Comprovantes financeiros não podem ser apagados pela Central.'
     using errcode='42501'; end if;
   return old;
 end if;

 if tg_op='INSERT' then
   if new.sale_status in ('paid','provisioned','checkout_created')
     or new.paid_at is not null or new.provisioned_at is not null
     or new.provider_checkout_id is not null or new.asaas_checkout_id is not null
     or new.provider_checkout_url is not null or new.asaas_checkout_url is not null
     or new.provider_subscription_id is not null or new.asaas_subscription_id is not null
   then raise exception 'Apenas o provedor financeiro pode registrar pagamentos e checkouts.'
     using errcode='42501'; end if;
   return new;
 end if;

 foreach v_field in array v_protected loop
   if (to_jsonb(old)->v_field) is distinct from (to_jsonb(new)->v_field) then
     raise exception 'Campo financeiro reservado ao backend: %',v_field using errcode='42501';
   end if;
 end loop;
 if new.sale_status is distinct from old.sale_status
    and new.sale_status in ('paid','provisioned','checkout_created')
 then raise exception 'Somente a confirmação financeira pode validar uma venda.'
   using errcode='42501'; end if;
 return new;
end;
$$;

drop trigger if exists nexus_sales_financial_evidence_guard on public.nexus_sales;
create trigger nexus_sales_financial_evidence_guard
 before insert or update or delete on public.nexus_sales
 for each row execute function public.guard_nexus_sales_financial_evidence();
revoke all on function public.guard_nexus_sales_financial_evidence()
 from public,anon,authenticated;

create or replace function public.guard_sst_paid_entitlement_evidence()
returns trigger language plpgsql security invoker set search_path=''
as $$
declare
 v_product_code text;
 v_field text;
 v_protected text[] := array[
   'billing_provider','provider_customer_id','provider_subscription_id',
   'asaas_customer_id','asaas_subscription_id','last_payment_status',
   'last_payment_at','last_payment_due_date','provider_state_event_id',
   'provider_state_event_type','provider_state_event_created_at'
 ];
begin
 if current_user not in ('authenticated','anon') then return coalesce(new,old); end if;
 select product.code into v_product_code
   from public.nexus_products product
   where product.id=coalesce(new.product_id,old.product_id);
 if v_product_code<>'sst' then return coalesce(new,old); end if;

 if tg_op='INSERT' then
   if new.subscription_status='active' or new.provider_subscription_id is not null
     or new.asaas_subscription_id is not null
   then raise exception 'O acesso pago SST deve ser criado pela confirmação do provedor.'
     using errcode='42501'; end if;
   return new;
 end if;
 if tg_op='DELETE' then return old; end if;

 foreach v_field in array v_protected loop
   if (to_jsonb(old)->v_field) is distinct from (to_jsonb(new)->v_field) then
     raise exception 'Identificadores de cobrança SST são exclusivos do backend.'
       using errcode='42501';
   end if;
 end loop;

 if (new.subscription_status='active' and old.subscription_status is distinct from 'active')
   or (old.subscription_status='active' and old.access_status<>'active'
       and new.access_status='active')
   or (old.subscription_status='active'
       and (new.renews_at is distinct from old.renews_at
         or new.contracted_price_cents is distinct from old.contracted_price_cents))
 then raise exception 'Reativação e renovação do SST exigem pagamento validado.'
   using errcode='42501'; end if;
 return new;
end;
$$;

drop trigger if exists nexus_sst_paid_entitlement_evidence_guard
 on public.organization_product_access;
create trigger nexus_sst_paid_entitlement_evidence_guard
 before insert or update or delete on public.organization_product_access
 for each row execute function public.guard_sst_paid_entitlement_evidence();
revoke all on function public.guard_sst_paid_entitlement_evidence()
 from public,anon,authenticated;

commit;
