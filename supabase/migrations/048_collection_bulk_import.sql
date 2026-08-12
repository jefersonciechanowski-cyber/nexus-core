begin;

-- O CPF passa a ser a chave estável de associação para importações.
-- Registros legados sem CPF continuam permitidos, mas CPFs informados não podem se repetir na mesma empresa.
create unique index if not exists employees_organization_cpf_unique
  on public.employees (organization_id, cpf)
  where cpf is not null;

create or replace function public.import_exam_records_bulk(p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
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

commit;
