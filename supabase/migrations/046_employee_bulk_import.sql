begin;

create or replace function public.import_employees_bulk(p_rows jsonb)
returns jsonb
language plpgsql
set search_path = public
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

commit;
