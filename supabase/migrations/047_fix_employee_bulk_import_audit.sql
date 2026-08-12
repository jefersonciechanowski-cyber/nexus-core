begin;

-- A importação já fixa a organização por public.current_org_id(), valida todas as
-- referências dentro do tenant e continua sujeita aos triggers de vínculo e limite.
-- SECURITY DEFINER é usado apenas para permitir que a operação atômica conclua o
-- registro em audit_logs sem conceder INSERT direto nessa tabela aos usuários.
alter function public.import_employees_bulk(jsonb) security definer;

revoke all on function public.import_employees_bulk(jsonb) from public;
grant execute on function public.import_employees_bulk(jsonb) to authenticated;

comment on function public.import_employees_bulk(jsonb) is
  'Importa colaboradores em lote na empresa ativa de forma atômica. Executa como definer para registrar auditoria sem expor audit_logs; tenant, referências e limites continuam validados pela função e triggers.';

commit;
