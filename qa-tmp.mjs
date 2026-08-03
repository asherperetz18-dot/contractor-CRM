import { createClient } from '@supabase/supabase-js';
const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const email = `qa-mobile-${Date.now()}@example.com`;
const password = 'QaTest1234!verify';
const { data, error } = await s.auth.admin.createUser({ email, password, email_confirm: true });
if (error) { console.error(error.message); process.exit(1); }
const { data: c } = await s.from('companies').select('id').limit(1);
await s.from('profiles').update({ name: 'QA Mobile' }).eq('id', data.user.id);
await s.from('company_members').insert({ profile_id: data.user.id, company_id: c[0].id, roles: ['Office','Admin'], can_delete_leads: true, status: 'Active' });
console.log(JSON.stringify({ email, password, userId: data.user.id }));
