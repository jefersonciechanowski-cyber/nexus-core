-- Restrict client profile visibility to the authenticated user's own profile.
-- Nexus administrators retain cross-profile access only when is_nexus_admin()
-- succeeds, which includes the recent AAL2/TOTP requirement.

drop policy if exists "read profiles in organization" on public.profiles;
drop policy if exists "nexus admin read all profiles" on public.profiles;

create policy "nexus admin read all profiles"
on public.profiles
for select
to authenticated
using ((select public.is_nexus_admin()));
