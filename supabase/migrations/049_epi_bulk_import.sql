begin;

create or replace function public.import_epis_bulk(
  p_catalog jsonb default '[]'::jsonb,
  p_purchases jsonb default '[]'::jsonb,
  p_deliveries jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.current_org_id();
  v_row jsonb;
  v_catalog_created integer := 0;
  v_catalog_reused integer := 0;
  v_purchases integer := 0;
  v_deliveries integer := 0;
  v_closed integer := 0;
  v_name text;
  v_code text;
  v_epi public.epi_catalog%rowtype;
  v_epi_count integer;
  v_purchased_at date;
  v_quantity integer;
  v_supplier text;
  v_invoice text;
  v_responsible text;
  v_cpf text;
  v_employee public.employees%rowtype;
  v_employee_count integer;
  v_delivered_at date;
  v_returned_at date;
  v_disposition text;
  v_reason text;
  v_delivery_id uuid;
begin
  if auth.uid() is null or v_org is null then
    raise exception 'Sessão autenticada inválida.' using errcode = 'P0001';
  end if;

  if coalesce(jsonb_typeof(p_catalog),'array') <> 'array'
     or coalesce(jsonb_typeof(p_purchases),'array') <> 'array'
     or coalesce(jsonb_typeof(p_deliveries),'array') <> 'array' then
    raise exception 'As abas de importação de EPI devem ser enviadas como listas.' using errcode = 'P0001';
  end if;

  if coalesce(jsonb_array_length(p_catalog),0) + coalesce(jsonb_array_length(p_purchases),0) + coalesce(jsonb_array_length(p_deliveries),0) = 0 then
    raise exception 'Nenhum dado de EPI foi enviado para importação.' using errcode = 'P0001';
  end if;

  if coalesce(jsonb_array_length(p_catalog),0) > 1000
     or coalesce(jsonb_array_length(p_purchases),0) > 1000
     or coalesce(jsonb_array_length(p_deliveries),0) > 1000 then
    raise exception 'Cada aba pode conter no máximo 1000 linhas por importação.' using errcode = 'P0001';
  end if;

  for v_row in select value from jsonb_array_elements(coalesce(p_catalog,'[]'::jsonb))
  loop
    v_name := nullif(btrim(v_row ->> 'name'),'');
    v_code := nullif(btrim(v_row ->> 'code'),'');
    if v_name is null or v_code is null then
      raise exception 'Toda linha do Catálogo exige Nome e Código/CA.' using errcode = 'P0001';
    end if;
    select count(*) into v_epi_count from public.epi_catalog
      where organization_id = v_org and lower(btrim(code)) = lower(v_code);
    if v_epi_count > 1 then
      raise exception 'O Código/CA % está duplicado no catálogo da empresa.', v_code using errcode = 'P0001';
    elsif v_epi_count = 1 then
      select * into v_epi from public.epi_catalog
        where organization_id = v_org and lower(btrim(code)) = lower(v_code);
      if lower(btrim(v_epi.name)) <> lower(v_name) then
        raise exception 'O Código/CA % já existe com o nome %. Corrija o Excel antes de importar.', v_code, v_epi.name using errcode = 'P0001';
      end if;
      if not v_epi.active then
        raise exception 'O EPI % (%), já existe mas está inativo.', v_epi.name, v_epi.code using errcode = 'P0001';
      end if;
      v_catalog_reused := v_catalog_reused + 1;
    else
      insert into public.epi_catalog(organization_id,name,code,active)
      values(v_org,v_name,v_code,true);
      v_catalog_created := v_catalog_created + 1;
    end if;
  end loop;

  for v_row in select value from jsonb_array_elements(coalesce(p_purchases,'[]'::jsonb))
  loop
    v_code := nullif(btrim(v_row ->> 'code'),'');
    if v_code is null then raise exception 'Toda compra exige Código/CA do EPI.' using errcode = 'P0001'; end if;
    select count(*) into v_epi_count from public.epi_catalog
      where organization_id = v_org and active = true and lower(btrim(code)) = lower(v_code);
    if v_epi_count = 0 then
      raise exception 'O Código/CA % não está cadastrado ou ativo nesta empresa.', v_code using errcode = 'P0001';
    elsif v_epi_count > 1 then
      raise exception 'O Código/CA % está duplicado no catálogo.', v_code using errcode = 'P0001';
    end if;
    select * into v_epi from public.epi_catalog
      where organization_id = v_org and active = true and lower(btrim(code)) = lower(v_code);
    begin v_purchased_at := nullif(btrim(v_row ->> 'purchased_at'),'')::date;
    exception when invalid_datetime_format or datetime_field_overflow then
      raise exception 'Existe uma data de compra inválida para o EPI %.', v_code using errcode = 'P0001'; end;
    if v_purchased_at is null or v_purchased_at > current_date then
      raise exception 'A data de compra de % é obrigatória e não pode estar no futuro.', v_code using errcode = 'P0001'; end if;
    begin v_quantity := nullif(btrim(v_row ->> 'quantity'),'')::integer;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'A quantidade da compra de % deve ser um inteiro positivo.', v_code using errcode = 'P0001'; end;
    if v_quantity is null or v_quantity <= 0 then
      raise exception 'A quantidade da compra de % deve ser maior que zero.', v_code using errcode = 'P0001'; end if;
    v_supplier := nullif(btrim(v_row ->> 'supplier'),'');
    v_invoice := nullif(btrim(v_row ->> 'invoice_number'),'');
    v_responsible := nullif(btrim(v_row ->> 'technical_responsible'),'');
    if v_responsible is null then raise exception 'A compra de % exige Responsável Técnico.', v_code using errcode = 'P0001'; end if;
    insert into public.epi_purchases(organization_id,epi_id,purchased_at,quantity,supplier,invoice_number,technical_responsible)
      values(v_org,v_epi.id,v_purchased_at,v_quantity,v_supplier,v_invoice,v_responsible);
    v_purchases := v_purchases + 1;
  end loop;

  for v_row in
    select value from jsonb_array_elements(coalesce(p_deliveries,'[]'::jsonb)) with ordinality as x(value,ord)
    order by nullif(btrim(value ->> 'delivered_at'),'')::date, ord
  loop
    v_cpf := nullif(regexp_replace(coalesce(v_row ->> 'cpf',''),'[^0-9]','','g'),'');
    if v_cpf is null or v_cpf !~ '^[0-9]{11}$' then
      raise exception 'Toda entrega importada exige CPF válido do colaborador.' using errcode = 'P0001'; end if;
    select count(*) into v_employee_count from public.employees where organization_id = v_org and cpf = v_cpf;
    if v_employee_count = 0 then
      raise exception 'O CPF % não está cadastrado na empresa. Cadastre o colaborador antes de importar EPIs.', v_cpf using errcode = 'P0001';
    elsif v_employee_count > 1 then raise exception 'O CPF % está duplicado na empresa.', v_cpf using errcode = 'P0001'; end if;
    select * into v_employee from public.employees where organization_id = v_org and cpf = v_cpf;
    if not v_employee.active then raise exception 'O colaborador de CPF % está inativo e não pode receber EPI.', v_cpf using errcode = 'P0001'; end if;
    v_code := nullif(btrim(v_row ->> 'code'),'');
    if v_code is null then raise exception 'Toda entrega exige Código/CA do EPI.' using errcode = 'P0001'; end if;
    select count(*) into v_epi_count from public.epi_catalog
      where organization_id = v_org and active = true and lower(btrim(code)) = lower(v_code);
    if v_epi_count = 0 then raise exception 'O Código/CA % não está cadastrado ou ativo nesta empresa.', v_code using errcode = 'P0001';
    elsif v_epi_count > 1 then raise exception 'O Código/CA % está duplicado no catálogo.', v_code using errcode = 'P0001'; end if;
    select * into v_epi from public.epi_catalog
      where organization_id = v_org and active = true and lower(btrim(code)) = lower(v_code);
    begin v_delivered_at := nullif(btrim(v_row ->> 'delivered_at'),'')::date;
    exception when invalid_datetime_format or datetime_field_overflow then
      raise exception 'Existe uma data de entrega inválida para o CPF %.', v_cpf using errcode = 'P0001'; end;
    if v_delivered_at is null or v_delivered_at > current_date then
      raise exception 'A data de entrega do CPF % é obrigatória e não pode estar no futuro.', v_cpf using errcode = 'P0001'; end if;
    insert into public.epi_deliveries(organization_id,employee_id,epi_id,delivered_at)
      values(v_org,v_employee.id,v_epi.id,v_delivered_at) returning id into v_delivery_id;
    v_deliveries := v_deliveries + 1;

    v_returned_at := null;
    if nullif(btrim(v_row ->> 'returned_at'),'') is not null then
      begin v_returned_at := btrim(v_row ->> 'returned_at')::date;
      exception when invalid_datetime_format or datetime_field_overflow then
        raise exception 'Existe uma data de encerramento inválida para o CPF %.', v_cpf using errcode = 'P0001'; end;
      if v_returned_at < v_delivered_at or v_returned_at > current_date then
        raise exception 'A data de encerramento do CPF % deve ser entre a entrega e hoje.', v_cpf using errcode = 'P0001'; end if;
      v_disposition := upper(nullif(btrim(v_row ->> 'final_disposition'),''));
      if v_disposition in ('DEVOLVIDO','DEVOLVIDO AO ESTOQUE','RETORNOU AO ESTOQUE','RETURNED_TO_STOCK') then v_disposition := 'RETURNED_TO_STOCK';
      elsif v_disposition in ('DESCARTADO','DESCARTE','DISCARDED') then v_disposition := 'DISCARDED';
      else raise exception 'Informe o destino final do EPI do CPF % como DEVOLVIDO AO ESTOQUE ou DESCARTADO.', v_cpf using errcode = 'P0001'; end if;
      v_reason := nullif(btrim(v_row ->> 'return_reason'),'');
      if v_disposition = 'DISCARDED' and v_reason is null then raise exception 'O descarte do EPI do CPF % exige um motivo.', v_cpf using errcode = 'P0001'; end if;
      update public.epi_deliveries set returned_at=v_returned_at,final_disposition=v_disposition,return_reason=v_reason where id=v_delivery_id;
      v_closed := v_closed + 1;
    elsif nullif(btrim(v_row ->> 'final_disposition'),'') is not null or nullif(btrim(v_row ->> 'return_reason'),'') is not null then
      raise exception 'Destino final e motivo exigem Data de Encerramento para o CPF %.', v_cpf using errcode = 'P0001';
    end if;
  end loop;

  insert into public.audit_logs(organization_id,user_id,action,entity,metadata)
  values(v_org,auth.uid(),'IMPORT_EPIS','epi_import',jsonb_build_object('catalog_created',v_catalog_created,'catalog_reused',v_catalog_reused,'purchases',v_purchases,'deliveries',v_deliveries,'closed_deliveries',v_closed));
  return jsonb_build_object('catalogCreated',v_catalog_created,'catalogReused',v_catalog_reused,'purchases',v_purchases,'deliveries',v_deliveries,'closedDeliveries',v_closed,'organizationId',v_org);
exception when unique_violation then
  raise exception 'A importação contém um Código/CA duplicado. Revise o Catálogo de EPIs.' using errcode = 'P0001';
end;
$$;

revoke all on function public.import_epis_bulk(jsonb,jsonb,jsonb) from public;
revoke all on function public.import_epis_bulk(jsonb,jsonb,jsonb) from anon;
grant execute on function public.import_epis_bulk(jsonb,jsonb,jsonb) to authenticated;

comment on function public.import_epis_bulk(jsonb,jsonb,jsonb) is
  'Importa catálogo, compras e histórico de entregas de EPI na empresa ativa. Reutiliza triggers de estoque, Matriz, validade, responsável técnico e isolamento do Nexus SST.';

commit;
