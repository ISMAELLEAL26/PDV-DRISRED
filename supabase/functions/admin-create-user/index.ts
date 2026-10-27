const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

import { createClient } from "npm:@supabase/supabase-js@2.57.4";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) throw new Error("server configuration unavailable");

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return new Response(JSON.stringify({ error: "No autorizado" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const token = authHeader.replace(/^Bearer\s+/i, "");
    const { data: { user: actor } } = await admin.auth.getUser(token);
    if (!actor) return new Response(JSON.stringify({ error: "No autorizado" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { data: actorProfile } = await admin.from("profiles").select("role:roles(permissions)").eq("id", actor.id).maybeSingle();
    const permissions = (actorProfile?.role as { permissions?: string[] } | null)?.permissions ?? [];
    if (!permissions.includes("all")) return new Response(JSON.stringify({ error: "No autorizado" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const body = await req.json() as { email?: string; password?: string; fullName?: string; roleId?: string | null; branchId?: string | null; branchIds?: string[]; phone?: string | null; position?: string | null; avatarUrl?: string | null };
    const email = body.email?.trim().toLowerCase();
    const fullName = body.fullName?.trim();
    if (!email || !fullName || !body.password || body.password.length < 8) return new Response(JSON.stringify({ error: "Completa los datos requeridos" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { data: created, error: createError } = await admin.auth.admin.createUser({ email, password: body.password, email_confirm: true, user_metadata: { full_name: fullName } });
    if (createError || !created.user) {
      console.error("admin user creation failed", createError);
      return new Response(JSON.stringify({ error: "No se pudo crear el usuario" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const { error: profileError } = await admin.from("profiles").update({ full_name: fullName, role_id: body.roleId ?? null, branch_id: body.branchIds?.[0] ?? body.branchId ?? null, phone: body.phone?.trim() || null, position: body.position?.trim() || null, avatar_url: body.avatarUrl?.trim() || null, active: false }).eq("id", created.user.id);
    if (profileError) {
      console.error("admin profile setup failed", profileError);
      await admin.auth.admin.deleteUser(created.user.id);
      return new Response(JSON.stringify({ error: "No se pudo completar el registro" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const branchIds = [...new Set((body.branchIds ?? (body.branchId ? [body.branchId] : [])).filter((id): id is string => typeof id === "string" && id.length > 0))];
    if (branchIds.length > 0) {
      const { error: accessError } = await admin.from("user_branch_access").insert(branchIds.map((branchId) => ({ user_id: created.user.id, branch_id: branchId })));
      if (accessError) {
        console.error("admin branch access setup failed", accessError);
        await admin.auth.admin.deleteUser(created.user.id);
        return new Response(JSON.stringify({ error: "No se pudo completar el registro" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }
    return new Response(JSON.stringify({ id: created.user.id }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (cause) {
    console.error("admin-create-user failed", cause);
    return new Response(JSON.stringify({ error: "No se pudo completar el registro" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
