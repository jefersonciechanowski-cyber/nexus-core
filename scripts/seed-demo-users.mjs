import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const seedEnabled = process.env.NEXUS_DEMO_SEED_ENABLED === 'true';

if (!seedEnabled) {
  throw new Error('Seed de demonstração bloqueado. Defina NEXUS_DEMO_SEED_ENABLED=true somente em ambiente controlado.');
}
if (!url || !key) {
  throw new Error('Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no ambiente local.');
}

const required = (name) => {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`Defina ${name} antes de executar o seed de demonstração.`);
  return value;
};

const supabase = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const users = [
  {
    email: required('NEXUS_DEMO_ADMIN_EMAIL'),
    password: required('NEXUS_DEMO_ADMIN_PASSWORD'),
    full_name: 'Administrador Demo',
    role: 'nexus_admin',
  },
  {
    email: required('NEXUS_DEMO_TECH_EMAIL'),
    password: required('NEXUS_DEMO_TECH_PASSWORD'),
    full_name: 'Técnico Demo',
    role: 'sst_technician',
  },
  {
    email: required('NEXUS_DEMO_DIRECTOR_EMAIL'),
    password: required('NEXUS_DEMO_DIRECTOR_PASSWORD'),
    full_name: 'Diretor Demo',
    role: 'director',
  },
];

for (const user of users) {
  if (user.password.length < 14) {
    throw new Error(`A senha configurada para ${user.role} deve ter pelo menos 14 caracteres.`);
  }
}

const { data: org, error: orgError } = await supabase
  .from('organizations')
  .upsert({ name: 'Empresa Industrial Alfa', slug: 'empresa-industrial-alfa' }, { onConflict: 'slug' })
  .select()
  .single();
if (orgError) throw orgError;

for (const user of users) {
  const { data, error } = await supabase.auth.admin.createUser({
    email: user.email,
    password: user.password,
    email_confirm: true,
    user_metadata: { full_name: user.full_name },
  });
  if (error && !String(error.message).includes('already')) throw error;
  const id = data?.user?.id;
  if (id) {
    const { error: profileError } = await supabase
      .from('profiles')
      .upsert({ id, organization_id: org.id, full_name: user.full_name, role: user.role });
    if (profileError) throw profileError;
  }
}

console.log('Usuários de demonstração criados com credenciais fornecidas pelo ambiente.');
