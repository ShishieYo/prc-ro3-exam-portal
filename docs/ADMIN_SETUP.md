# Creating the first administrator

No default admin credentials exist. Role changes through the app require `users.manage`, so the first system administrator is bootstrapped once by the project owner:

1. Register normally at `/register` and verify the email.
2. In the Supabase SQL editor (runs as the project owner):
```sql
update profiles set account_status = 'active' where email = 'you@agency.gov.ph';
insert into user_roles (user_id, role)
select id, 'system_admin' from profiles where email = 'you@agency.gov.ph';
```
3. Sign in, open **Users & Roles**, and grant `admin`, `coordinator`, `attendance_officer`, `finance_officer`, `cpd_officer`, `supervisor`, `auditor` to the appropriate staff (each grant needs a reason and is audited). Grant yourself nothing further: you cannot change your own roles; ask a second system administrator.
4. Recommended: use two system administrators; give `finance_officer` and `admin` to different people (allowance approval requires a different person from the processor).

Demo data is **not** included in migrations. Never create demo accounts in production.
