import { createClient } from '@supabase/supabase-js';
const url=process.env.SUPABASE_URL;
const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
if(!url||!key) throw new Error('Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no ambiente local.');
const supabase=createClient(url,key,{auth:{autoRefreshToken:false,persistSession:false}});
const users=[
 {email:'admin.demo@nexuscore.com.br',password:'NexusDemo#2026',full_name:'Jeferson Alves',role:'nexus_admin'},
 {email:'tecnico.demo@empresa-alfa.com.br',password:'SstDemo#2026',full_name:'Claudemir',role:'sst_technician'},
 {email:'diretor.demo@empresa-alfa.com.br',password:'DiretorDemo#2026',full_name:'Diretor Demo',role:'director'}
];
const {data:org,error:orgError}=await supabase.from('organizations').upsert({name:'Empresa Industrial Alfa',slug:'empresa-industrial-alfa'},{onConflict:'slug'}).select().single();
if(orgError) throw orgError;
for(const user of users){
 const {data,error}=await supabase.auth.admin.createUser({email:user.email,password:user.password,email_confirm:true,user_metadata:{full_name:user.full_name}});
 if(error && !String(error.message).includes('already')) throw error;
 const id=data?.user?.id;
 if(id){const {error:pError}=await supabase.from('profiles').upsert({id,organization_id:org.id,full_name:user.full_name,role:user.role});if(pError)throw pError;}
}
console.log('Usuários de demonstração criados.');
