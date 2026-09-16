/**
 * Creates (or repairs) the admin console account.
 *
 *   pnpm create-admin [email] [password]
 *
 * The admin flag lives in app_metadata, which only the service role can set —
 * a signed-in user cannot grant it to themselves.
 */
import { createClient } from '@supabase/supabase-js';

async function main() {
  const email = process.argv[2] ?? process.env.ADMIN_EMAIL ?? 'admin@romisys.com';
  const password = process.argv[3] ?? process.env.ADMIN_PASSWORD;

  if (!password) {
    console.error('Provide a password: pnpm create-admin <email> <password>');
    process.exit(1);
  }

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const existing = list?.users.find((u) => u.email === email);

  if (existing) {
    const { error } = await admin.auth.admin.updateUserById(existing.id, {
      password,
      email_confirm: true,
      app_metadata: { ...existing.app_metadata, role: 'admin' },
    });
    if (error) throw error;
    console.log(`updated existing account ${email} and granted admin`);
    return;
  }

  const { error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { role: 'admin' },
  });
  if (error) throw error;
  console.log(`created admin account ${email}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
