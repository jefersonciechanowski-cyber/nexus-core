begin;

-- O contador de abuso é exclusivamente interno. A política explícita mantém
-- anon/authenticated em deny-all e documenta o desenho para o advisor.
drop policy if exists "deny direct access to public request limits"
  on public.nexus_public_request_limits;
create policy "deny direct access to public request limits"
  on public.nexus_public_request_limits
  for all
  to anon, authenticated
  using (false)
  with check (false);

create or replace function public.create_managed_organization(
  p_name text,
  p_registration_type text default null,
  p_registration_number text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_current_org uuid;
  v_account_id uuid;
  v_account_type text;
  v_account_status text;
  v_billing_org uuid;
  v_org_limit integer;
  v_account_role text;
  v_count integer;
  v_new_org uuid := gen_random_uuid();
  v_slug_base text;
  v_slug text;
  v_registration_type text := nullif(upper(btrim(coalesce(p_registration_type,''))), '');
  v_registration_number text := null;
begin
  if auth.uid() is null then raise exception 'Sessão inválida.' using errcode = 'P0001'; end if;

  if not exists (
    select 1
    from public.profiles profile
    where profile.id = auth.uid()
      and profile.active = true
      and profile.role in ('nexus_admin', 'org_admin')
  ) then
    raise exception 'Apenas administradores podem criar empresas gerenciadas.' using errcode = '42501';
  end if;

  select organization_id into v_current_org
  from public.profiles
  where id = auth.uid() and active = true;

  select account.id, account.account_type, account.status, account.billing_organization_id,
         account.organization_limit, account_user.account_role
    into v_account_id, v_account_type, v_account_status, v_billing_org, v_org_limit, v_account_role
  from public.nexus_account_organizations account_org
  join public.nexus_accounts account on account.id = account_org.account_id
  join public.nexus_account_users account_user on account_user.account_id = account.id
  where account_org.organization_id = v_current_org
    and account_org.active = true
    and account_user.user_id = auth.uid()
    and account_user.active = true
  limit 1;

  if v_account_id is null or v_account_status <> 'active' then raise exception 'Conta Nexus indisponível.' using errcode = 'P0001'; end if;
  if v_account_type <> 'consultancy' then raise exception 'Sua conta não possui gestão multiempresa.' using errcode = 'P0001'; end if;
  if v_account_role not in ('owner','manager') then raise exception 'Você não possui permissão para criar empresas nesta conta.' using errcode = 'P0001'; end if;
  if nullif(btrim(p_name), '') is null or char_length(btrim(p_name)) > 160 then raise exception 'Informe um nome de empresa válido.' using errcode = 'P0001'; end if;
  if v_registration_type is not null and v_registration_type not in ('CNPJ','CPF') then raise exception 'Tipo de documento inválido.' using errcode = 'P0001'; end if;

  if p_registration_number is not null and nullif(btrim(p_registration_number),'') is not null then
    if v_registration_type = 'CPF' then
      v_registration_number := regexp_replace(p_registration_number, '[^0-9]', '', 'g');
    else
      v_registration_number := upper(regexp_replace(p_registration_number, '[^0-9A-Za-z]', '', 'g'));
    end if;
  end if;

  if v_registration_number is not null and (
    v_registration_type is null
    or (v_registration_type = 'CPF' and v_registration_number !~ '^[0-9]{11}$')
    or (v_registration_type = 'CNPJ' and v_registration_number !~ '^[0-9A-Z]{14}$')
  ) then raise exception 'Documento da empresa inválido.' using errcode = 'P0001'; end if;

  select count(*)::integer into v_count
  from public.nexus_account_organizations
  where account_id = v_account_id and active = true;

  if v_count >= v_org_limit then raise exception 'Limite de % empresas atingido para esta conta.', v_org_limit using errcode = 'P0001'; end if;

  v_slug_base := trim(both '-' from regexp_replace(lower(btrim(p_name)), '[^a-z0-9]+', '-', 'g'));
  if v_slug_base = '' then v_slug_base := 'empresa'; end if;
  v_slug := left(v_slug_base, 52) || '-' || substr(v_new_org::text, 1, 8);

  insert into public.organizations (id,name,slug,status,trade_name,registration_type,registration_number)
  values (v_new_org,btrim(p_name),v_slug,'active',btrim(p_name),v_registration_type,v_registration_number);

  insert into public.nexus_account_organizations (account_id,organization_id,relationship_type,active)
  values (v_account_id,v_new_org,'managed',true);

  insert into public.organization_memberships (organization_id,user_id,role,active)
  select
    v_new_org,
    account_user.user_id,
    case
      when billing_membership.role = 'nexus_admin'::public.app_role then 'nexus_admin'::public.app_role
      when account_user.account_role in ('owner','manager') then 'org_admin'::public.app_role
      else 'viewer'::public.app_role
    end,
    true
  from public.nexus_account_users account_user
  left join public.organization_memberships billing_membership
    on billing_membership.organization_id = v_billing_org
   and billing_membership.user_id = account_user.user_id
   and billing_membership.active = true
  where account_user.account_id = v_account_id and account_user.active = true
  on conflict (organization_id,user_id) do nothing;

  insert into public.organization_product_access (
    organization_id,product_id,access_status,subscription_status,plan_name,starts_at,renews_at,
    plan_id,contracted_price_cents,contracted_currency,billing_mode,billing_cycle_months
  )
  select v_new_org, access.product_id, access.access_status, access.subscription_status,
         'Incluído na conta multiempresa', access.starts_at, access.renews_at, access.plan_id,
         null, access.contracted_currency, access.billing_mode, access.billing_cycle_months
  from public.organization_product_access access
  where access.organization_id = v_billing_org and access.access_status = 'active'
  on conflict (organization_id,product_id) do nothing;

  insert into public.audit_logs (organization_id,user_id,action,entity,entity_id,metadata)
  values (v_new_org,auth.uid(),'CREATE_MANAGED_ORGANIZATION','organization',v_new_org::text,jsonb_build_object('account_id',v_account_id));

  return v_new_org;
end;
$$;

revoke all on function public.create_managed_organization(text,text,text) from public, anon;
grant execute on function public.create_managed_organization(text,text,text) to authenticated;

comment on function public.create_managed_organization(text,text,text) is 'Cria empresa gerenciada; preserva nexus_admin global e concede org_admin apenas a owner/manager comuns.';

create or replace function public.import_employees_bulk(p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid := public.current_org_id();
  v_row jsonb;
  v_count integer := 0;
  v_unit_id uuid;
  v_sector_id uuid;
  v_job_role_id uuid;
  v_full_name text;
  v_shift text;
  v_cpf text;
  v_birth_date date;
  v_worker_type text;
  v_registration text;
  v_category text;
  v_start_date date;
  v_end_date date;
begin
  if auth.uid() is null or v_org is null then
    raise exception 'Sessão autenticada inválida.' using errcode = 'P0001';
  end if;

  if not exists (
    select 1
    from public.profiles profile
    where profile.id = auth.uid()
      and profile.active = true
      and profile.role in ('nexus_admin', 'org_admin')
  ) then
    raise exception 'Apenas administradores podem executar importações em lote.' using errcode = '42501';
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'Nenhum colaborador válido foi enviado para importação.' using errcode = 'P0001';
  end if;

  if jsonb_array_length(p_rows) > 1000 then
    raise exception 'Cada importação pode conter no máximo 1000 colaboradores.' using errcode = 'P0001';
  end if;

  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    v_full_name := nullif(btrim(v_row ->> 'full_name'), '');
    if v_full_name is null or char_length(v_full_name) > 160 then
      raise exception 'Existe uma linha com nome de colaborador inválido.' using errcode = 'P0001';
    end if;

    begin
      v_unit_id := nullif(v_row ->> 'unit_id', '')::uuid;
      v_sector_id := nullif(v_row ->> 'sector_id', '')::uuid;
      v_job_role_id := nullif(v_row ->> 'job_role_id', '')::uuid;
    exception when invalid_text_representation then
      raise exception 'Existe uma linha com referência de unidade, setor ou função inválida.' using errcode = 'P0001';
    end;

    if v_unit_id is null or not exists (
      select 1 from public.units
      where id = v_unit_id and organization_id = v_org
    ) then
      raise exception 'A unidade de % não pertence à empresa selecionada.', v_full_name using errcode = 'P0001';
    end if;

    if v_sector_id is null or not exists (
      select 1 from public.sectors
      where id = v_sector_id and unit_id = v_unit_id and organization_id = v_org
    ) then
      raise exception 'O setor de % não pertence à unidade informada.', v_full_name using errcode = 'P0001';
    end if;

    if v_job_role_id is null or not exists (
      select 1 from public.job_roles
      where id = v_job_role_id and organization_id = v_org
    ) then
      raise exception 'A função de % não pertence à empresa selecionada.', v_full_name using errcode = 'P0001';
    end if;

    v_shift := nullif(btrim(v_row ->> 'shift'), '');
    if v_shift is not null and char_length(v_shift) > 80 then
      raise exception 'O turno de % possui mais de 80 caracteres.', v_full_name using errcode = 'P0001';
    end if;

    v_cpf := nullif(regexp_replace(coalesce(v_row ->> 'cpf', ''), '[^0-9]', '', 'g'), '');
    if v_cpf is not null and v_cpf !~ '^[0-9]{11}$' then
      raise exception 'O CPF de % é inválido.', v_full_name using errcode = 'P0001';
    end if;

    v_worker_type := nullif(upper(btrim(v_row ->> 'esocial_worker_type')), '');
    if v_worker_type is not null and v_worker_type not in ('VINCULO', 'TSVE') then
      raise exception 'O tipo eSocial de % deve ser VINCULO ou TSVE.', v_full_name using errcode = 'P0001';
    end if;

    v_registration := nullif(btrim(v_row ->> 'esocial_registration'), '');
    if v_registration is not null and char_length(v_registration) > 30 then
      raise exception 'A matrícula eSocial de % possui mais de 30 caracteres.', v_full_name using errcode = 'P0001';
    end if;

    v_category := nullif(regexp_replace(coalesce(v_row ->> 'esocial_category_code', ''), '[^0-9]', '', 'g'), '');
    if v_category is not null and v_category !~ '^[0-9]{3}$' then
      raise exception 'A categoria eSocial de % deve possuir 3 dígitos.', v_full_name using errcode = 'P0001';
    end if;
    if v_category is not null and v_worker_type is distinct from 'TSVE' then
      raise exception 'A categoria eSocial só pode ser informada para trabalhador TSVE (%).', v_full_name using errcode = 'P0001';
    end if;

    begin
      v_birth_date := nullif(v_row ->> 'birth_date', '')::date;
      v_start_date := nullif(v_row ->> 'relationship_start_date', '')::date;
      v_end_date := nullif(v_row ->> 'relationship_end_date', '')::date;
    exception when invalid_datetime_format or datetime_field_overflow then
      raise exception 'Existe uma data inválida na linha de %.', v_full_name using errcode = 'P0001';
    end;

    if v_birth_date is not null and v_birth_date > current_date then
      raise exception 'A data de nascimento de % não pode estar no futuro.', v_full_name using errcode = 'P0001';
    end if;
    if v_end_date is not null and v_start_date is not null and v_end_date < v_start_date then
      raise exception 'A data final de % não pode ser anterior à data inicial.', v_full_name using errcode = 'P0001';
    end if;

    insert into public.employees (
      organization_id,
      unit_id,
      sector_id,
      job_role_id,
      full_name,
      shift,
      active,
      cpf,
      birth_date,
      esocial_worker_type,
      esocial_registration,
      esocial_category_code,
      relationship_start_date,
      relationship_end_date
    ) values (
      v_org,
      v_unit_id,
      v_sector_id,
      v_job_role_id,
      v_full_name,
      v_shift,
      true,
      v_cpf,
      v_birth_date,
      v_worker_type,
      v_registration,
      v_category,
      v_start_date,
      v_end_date
    );

    v_count := v_count + 1;
  end loop;

  insert into public.audit_logs (organization_id, user_id, action, entity, metadata)
  values (
    v_org,
    auth.uid(),
    'IMPORT_EMPLOYEES',
    'employees',
    jsonb_build_object('imported_count', v_count)
  );

  return jsonb_build_object(
    'imported', v_count,
    'organizationId', v_org
  );
exception
  when unique_violation then
    raise exception 'A importação contém uma matrícula eSocial que já existe nesta empresa ou está repetida no arquivo.' using errcode = 'P0001';
end;
$$;

revoke all on function public.import_employees_bulk(jsonb) from public;
grant execute on function public.import_employees_bulk(jsonb) to authenticated;

comment on function public.import_employees_bulk(jsonb) is
  'Importa colaboradores em lote na empresa ativa. A função é transacional e reutiliza RLS, vínculos organizacionais e limite comercial de colaboradores.';

create or replace function public.import_exam_records_bulk(p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid := public.current_org_id();
  v_row jsonb;
  v_count integer := 0;
  v_cpf text;
  v_employee public.employees%rowtype;
  v_employee_count integer;
  v_exam public.exam_catalog%rowtype;
  v_exam_count integer;
  v_rule public.exam_evaluation_rules%rowtype;
  v_collection_number integer;
  v_collected_at date;
  v_numeric_value numeric;
  v_qualitative_result text;
  v_status text;
begin
  if auth.uid() is null or v_org is null then
    raise exception 'Sessão autenticada inválida.' using errcode = 'P0001';
  end if;

  if not exists (
    select 1
    from public.profiles profile
    where profile.id = auth.uid()
      and profile.active = true
      and profile.role in ('nexus_admin', 'org_admin')
  ) then
    raise exception 'Apenas administradores podem executar importações em lote.' using errcode = '42501';
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'Nenhuma coleta válida foi enviada para importação.' using errcode = 'P0001';
  end if;

  if jsonb_array_length(p_rows) > 1000 then
    raise exception 'Cada importação pode conter no máximo 1000 coletas.' using errcode = 'P0001';
  end if;

  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    v_cpf := nullif(regexp_replace(coalesce(v_row ->> 'cpf', ''), '[^0-9]', '', 'g'), '');
    if v_cpf is null or v_cpf !~ '^[0-9]{11}$' then
      raise exception 'Toda coleta importada exige CPF válido do colaborador.' using errcode = 'P0001';
    end if;

    select count(*) into v_employee_count
    from public.employees
    where organization_id = v_org and cpf = v_cpf;

    if v_employee_count = 0 then
      raise exception 'O CPF % não está cadastrado na empresa selecionada. Cadastre o colaborador antes de importar.', v_cpf using errcode = 'P0001';
    elsif v_employee_count > 1 then
      raise exception 'O CPF % está duplicado na empresa selecionada. Corrija os cadastros antes de importar.', v_cpf using errcode = 'P0001';
    end if;

    select * into v_employee
    from public.employees
    where organization_id = v_org and cpf = v_cpf;

    if v_employee.sector_id is null then
      raise exception 'O colaborador de CPF % não possui setor definido.', v_cpf using errcode = 'P0001';
    end if;

    if nullif(btrim(v_row ->> 'exam_name'), '') is null then
      raise exception 'Toda coleta importada exige o nome do exame.' using errcode = 'P0001';
    end if;

    select count(*) into v_exam_count
    from public.exam_catalog
    where organization_id = v_org
      and active = true
      and lower(btrim(name)) = lower(btrim(v_row ->> 'exam_name'));

    if v_exam_count = 0 then
      raise exception 'O exame % não está cadastrado ou ativo nesta empresa.', btrim(v_row ->> 'exam_name') using errcode = 'P0001';
    elsif v_exam_count > 1 then
      raise exception 'Existem exames ativos duplicados com o nome %. Corrija o catálogo antes de importar.', btrim(v_row ->> 'exam_name') using errcode = 'P0001';
    end if;

    select * into v_exam
    from public.exam_catalog
    where organization_id = v_org
      and active = true
      and lower(btrim(name)) = lower(btrim(v_row ->> 'exam_name'));

    if not exists (
      select 1
      from public.sector_exam_requirements requirement
      where requirement.organization_id = v_org
        and requirement.sector_id = v_employee.sector_id
        and requirement.exam_id = v_exam.id
        and requirement.active = true
    ) then
      raise exception 'O exame % não está vinculado ao setor atual do colaborador de CPF %.', v_exam.name, v_cpf using errcode = 'P0001';
    end if;

    begin
      v_collection_number := nullif(btrim(v_row ->> 'collection_number'), '')::integer;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'O número da coleta deve ser um inteiro maior ou igual a 1.' using errcode = 'P0001';
    end;
    if v_collection_number is null or v_collection_number < 1 then
      raise exception 'O número da coleta deve ser um inteiro maior ou igual a 1.' using errcode = 'P0001';
    end if;

    begin
      v_collected_at := nullif(btrim(v_row ->> 'collected_at'), '')::date;
    exception when invalid_datetime_format or datetime_field_overflow then
      raise exception 'Existe uma data de coleta inválida.' using errcode = 'P0001';
    end;
    if v_collected_at is null then
      raise exception 'A data da coleta é obrigatória.' using errcode = 'P0001';
    end if;
    if v_collected_at > current_date then
      raise exception 'A data da coleta não pode estar no futuro.' using errcode = 'P0001';
    end if;

    v_numeric_value := null;
    v_qualitative_result := nullif(btrim(v_row ->> 'qualitative_result'), '');
    v_status := null;

    if v_exam.result_type = 'NUMERIC' then
      if v_qualitative_result is not null then
        raise exception 'O exame % é numérico e não aceita resultado qualitativo.', v_exam.name using errcode = 'P0001';
      end if;
      begin
        v_numeric_value := nullif(btrim(v_row ->> 'numeric_value'), '')::numeric;
      exception when invalid_text_representation or numeric_value_out_of_range then
        raise exception 'O resultado de % deve ser numérico.', v_exam.name using errcode = 'P0001';
      end;
      if v_numeric_value is null then
        raise exception 'O exame % exige resultado numérico.', v_exam.name using errcode = 'P0001';
      end if;

      select * into v_rule
      from public.exam_evaluation_rules
      where exam_id = v_exam.id;

      if not found or v_rule.evaluation_mode = 'NONE' then
        v_status := 'SEM PARÂMETRO';
      elsif v_rule.evaluation_mode = 'LOWER_IS_BETTER' then
        if v_rule.good_max is null or v_rule.attention_max is null then
          v_status := 'SEM PARÂMETRO';
        elsif v_numeric_value <= v_rule.good_max then
          v_status := 'BOM';
        elsif v_numeric_value <= v_rule.attention_max then
          v_status := 'ATENÇÃO';
        else
          v_status := 'CRÍTICO';
        end if;
      elsif v_rule.evaluation_mode = 'HIGHER_IS_BETTER' then
        if v_rule.good_min is null or v_rule.attention_min is null then
          v_status := 'SEM PARÂMETRO';
        elsif v_numeric_value >= v_rule.good_min then
          v_status := 'BOM';
        elsif v_numeric_value >= v_rule.attention_min then
          v_status := 'ATENÇÃO';
        else
          v_status := 'CRÍTICO';
        end if;
      elsif v_rule.evaluation_mode = 'TARGET_RANGE' then
        if v_rule.good_min is null or v_rule.good_max is null or v_rule.attention_min is null or v_rule.attention_max is null then
          v_status := 'SEM PARÂMETRO';
        elsif v_numeric_value between v_rule.good_min and v_rule.good_max then
          v_status := 'BOM';
        elsif v_numeric_value between v_rule.attention_min and v_rule.attention_max then
          v_status := 'ATENÇÃO';
        else
          v_status := 'CRÍTICO';
        end if;
      else
        v_status := 'SEM PARÂMETRO';
      end if;
    elsif v_exam.result_type = 'QUALITATIVE' then
      if nullif(btrim(v_row ->> 'numeric_value'), '') is not null then
        raise exception 'O exame % é qualitativo e não aceita resultado numérico.', v_exam.name using errcode = 'P0001';
      end if;
      if v_qualitative_result is null then
        raise exception 'O exame % exige resultado qualitativo.', v_exam.name using errcode = 'P0001';
      end if;
      -- O trigger de integridade transforma a opção qualitativa configurada no status correto.
      v_numeric_value := null;
      v_status := null;
    else
      raise exception 'O tipo de resultado do exame % não é suportado.', v_exam.name using errcode = 'P0001';
    end if;

    if exists (
      select 1 from public.exam_records existing
      where existing.organization_id = v_org
        and existing.employee_id = v_employee.id
        and existing.exam_id = v_exam.id
        and extract(year from existing.collected_at) = extract(year from v_collected_at)
        and existing.collection_number = v_collection_number
    ) then
      raise exception 'Já existe % para o CPF %, no ano % e coleta nº %.', v_exam.name, v_cpf, extract(year from v_collected_at)::integer, v_collection_number using errcode = 'P0001';
    end if;

    insert into public.exam_records (
      organization_id,
      employee_id,
      exam_id,
      collection_number,
      collected_at,
      value,
      qualitative_result,
      status
    ) values (
      v_org,
      v_employee.id,
      v_exam.id,
      v_collection_number,
      v_collected_at,
      v_numeric_value,
      v_qualitative_result,
      v_status
    );

    v_count := v_count + 1;
  end loop;

  insert into public.audit_logs (organization_id, user_id, action, entity, metadata)
  values (
    v_org,
    auth.uid(),
    'IMPORT_EXAM_RECORDS',
    'exam_records',
    jsonb_build_object('imported_count', v_count)
  );

  return jsonb_build_object('imported', v_count, 'organizationId', v_org);
exception
  when unique_violation then
    raise exception 'A importação contém uma coleta duplicada. Revise CPF, exame, ano e número da coleta.' using errcode = 'P0001';
end;
$$;

revoke all on function public.import_exam_records_bulk(jsonb) from public;
revoke all on function public.import_exam_records_bulk(jsonb) from anon;
grant execute on function public.import_exam_records_bulk(jsonb) to authenticated;

comment on function public.import_exam_records_bulk(jsonb) is
  'Importa coletas por CPF na empresa ativa. O lote é atômico e reutiliza os triggers de integridade, snapshots e vínculo setor-exame do Nexus SST.';

create or replace function public.import_epis_bulk(
  p_catalog jsonb default '[]'::jsonb,
  p_purchases jsonb default '[]'::jsonb,
  p_deliveries jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
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

  if not exists (
    select 1
    from public.profiles profile
    where profile.id = auth.uid()
      and profile.active = true
      and profile.role in ('nexus_admin', 'org_admin')
  ) then
    raise exception 'Apenas administradores podem executar importações em lote.' using errcode = '42501';
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

-- pg_net foi habilitado apenas para reparos temporários de onboarding.
-- Não há fila, cron job ou função da aplicação dependente; sem CASCADE, a
-- migration falha de forma segura se surgir qualquer dependência externa.
drop extension if exists pg_net;

alter default privileges in schema public
  revoke execute on functions from public, anon;

comment on table public.nexus_public_request_limits is
  'Contadores efêmeros de abuso. Acesso direto negado a anon/authenticated; consumo exclusivo pelo service_role.';

commit;
