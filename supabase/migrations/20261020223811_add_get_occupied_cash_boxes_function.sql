-- Returns the cash boxes currently occupied in a branch, with the operator's name.
-- Bypasses RLS on profiles so any authenticated cashier can see who operates each box.
CREATE OR REPLACE FUNCTION public.get_occupied_cash_boxes(p_branch_id uuid)
RETURNS TABLE (box_id uuid, user_name text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT r.cash_box_id AS box_id,
         COALESCE(p.full_name, 'Otro usuario') AS user_name
  FROM public.cash_registers r
  LEFT JOIN public.profiles p ON p.id = r.user_id
  WHERE r.branch_id = p_branch_id
    AND r.status = 'abierta'
    AND r.cash_box_id IS NOT NULL;
$$;

REVOKE ALL ON FUNCTION public.get_occupied_cash_boxes(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_occupied_cash_boxes(uuid) TO authenticated;