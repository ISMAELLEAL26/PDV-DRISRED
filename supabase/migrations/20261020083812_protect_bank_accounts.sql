/*
  # Lock bank accounts to administrators

  1. Policies
    - bank_accounts: active staff read (needed to pick a destination account
      at checkout); insert/update/delete administrators only.
*/

DROP POLICY IF EXISTS "auth_select_bank_accounts" ON public.bank_accounts;
DROP POLICY IF EXISTS "auth_insert_bank_accounts" ON public.bank_accounts;
DROP POLICY IF EXISTS "auth_update_bank_accounts" ON public.bank_accounts;
DROP POLICY IF EXISTS "auth_delete_bank_accounts" ON public.bank_accounts;

CREATE POLICY "staff_select_bank_accounts" ON public.bank_accounts FOR SELECT TO authenticated USING (public.is_active_staff());
CREATE POLICY "admin_insert_bank_accounts" ON public.bank_accounts FOR INSERT TO authenticated WITH CHECK (public.is_admin());
CREATE POLICY "admin_update_bank_accounts" ON public.bank_accounts FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "admin_delete_bank_accounts" ON public.bank_accounts FOR DELETE TO authenticated USING (public.is_admin());
