import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

type OperationType = "inventory" | "sale_cancel" | "cash_cut";

interface RequestBody {
  action: "create" | "consume" | "reject" | "list";
  operation_type?: OperationType;
  requester_id?: string;
  branch_id?: string | null;
  summary?: string;
  payload?: Record<string, unknown>;
  request_id?: string;
  token?: string;
  status_filter?: "pending" | "history" | "rejected";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) return json({ error: "Servicio no disponible." }, 500);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "No autorizado." }, 500);
    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const token = authHeader.replace(/^Bearer\s+/i, "");
    const { data: authData } = await admin.auth.getUser(token);
    const actor = authData.user;
    if (!actor) return json({ error: "No autorizado." }, 500);

    const { data: profile } = await admin.from("profiles").select("id, active, role:roles(permissions)").eq("id", actor.id).maybeSingle();
    const isActive = (profile as { active?: boolean } | null)?.active === true;
    if (!isActive) return json({ error: "Tu cuenta no está activa." }, 403);
    const permissions = Array.isArray((profile as { role?: { permissions?: unknown[] } } | null)?.role?.permissions)
      ? (profile as { role: { permissions: unknown[] } }).role.permissions
      : [];
    const isAdmin = permissions.includes("all") || permissions.includes("settings");

    const body = (await req.json().catch(() => ({}))) as RequestBody;
    if (body.action === "create") return await createRequest(admin, actor.id, body, isAdmin);
    if (body.action === "consume") return await consumeRequest(admin, actor.id, body);
    if (body.action === "reject") return await rejectRequest(admin, actor.id, body, isAdmin);
    if (body.action === "list") return await listRequests(admin, body, isAdmin);
    return json({ error: "Solicitud inválida." }, 400);
  } catch (error) {
    console.error("authorization-center failed", error);
    return json({ error: "No se pudo completar la operación." }, 500);
  }
});

async function generateToken(): Promise<{ token: string; hash: string }> {
  const token = String(Math.floor(100000 + Math.random() * 900000));
  const hash = await sha256(token);
  return { token, hash };
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function createRequest(admin: ReturnType<typeof createClient>, actorId: string, body: RequestBody, _isAdmin: boolean): Promise<Response> {
  const operationType = body.operation_type;
  if (!operationType || !["inventory", "sale_cancel", "cash_cut"].includes(operationType)) {
    return json({ error: "Tipo de operación inválido." }, 400);
  }
  if (!body.summary || !body.summary.trim()) {
    return json({ error: "Falta el resumen de la solicitud." }, 400);
  }

  const { data: folioData, error: folioError } = await admin.rpc("next_authorization_folio", { p_type: operationType });
  if (folioError || !folioData) return json({ error: "No se pudo generar el folio." }, 500);
  const folio = String(folioData);

  const { token, hash } = await generateToken();

  const insertRow = {
    folio,
    operation_type: operationType,
    status: "pending",
    token,
    token_hash: hash,
    requester_id: actorId,
    branch_id: body.branch_id ?? null,
    summary: body.summary.trim(),
    payload: body.payload ?? {},
  };

  const { data, error } = await admin.from("authorization_requests")
    .insert(insertRow)
    .select("id, folio, operation_type, status, summary, token, created_at")
    .single();

  if (error || !data) return json({ error: "No se pudo crear la solicitud de autorización." }, 500);

  return json({ success: true, request: data, token });
}

async function consumeRequest(admin: ReturnType<typeof createClient>, actorId: string, body: RequestBody): Promise<Response> {
  if (!body.request_id || !body.token) return json({ error: "Faltan datos para validar el token." }, 400);
  const { data, error } = await admin.rpc("consume_authorization", {
    p_request_id: body.request_id,
    p_token: body.token,
    p_actor: actorId,
  });
  if (error) return json({ error: "No se pudo validar el token." }, 500);
  return json(data);
}

async function rejectRequest(admin: ReturnType<typeof createClient>, actorId: string, body: RequestBody, isAdmin: boolean): Promise<Response> {
  if (!isAdmin) return json({ error: "Solo gerencia puede rechazar solicitudes." }, 403);
  if (!body.request_id) return json({ error: "Falta el identificador de la solicitud." }, 400);
  const { data, error } = await admin.rpc("reject_authorization", {
    p_request_id: body.request_id,
    p_actor: actorId,
  });
  if (error) return json({ error: "No se pudo rechazar la solicitud." }, 500);
  return json(data);
}

async function listRequests(admin: ReturnType<typeof createClient>, body: RequestBody, isAdmin: boolean): Promise<Response> {
  const filter = body.status_filter ?? "pending";
  const tokenCol = filter === "pending" ? "token, " : "";
  let query = admin.from("authorization_requests")
    .select(`id, folio, operation_type, status, summary, payload, branch_id, requester_id, created_at, ${tokenCol}token_created_at, authorized_at, rejected_at, consumed_at`)
    .order("created_at", { ascending: false })
    .limit(100);

  if (filter === "pending") {
    query = query.eq("status", "pending");
  } else if (filter === "rejected") {
    query = query.eq("status", "rejected");
  } else {
    query = query.in("status", ["authorized", "consumed"]);
  }

  if (!isAdmin) {
    query = query.eq("requester_id", (await admin.auth.getUser()).data.user?.id ?? "");
  }

  const { data, error } = await query;
  if (error) {
    console.error("authorization-center list failed", error);
    return json({ error: "No se pudieron cargar las solicitudes." }, 500);
  }

  const rows = data ?? [];
  const requesterIds = [...new Set(rows.map((row) => row.requester_id).filter(Boolean))];
  const branchIds = [...new Set(rows.map((row) => row.branch_id).filter(Boolean))];
  const [{ data: profiles }, { data: branches }] = await Promise.all([
    requesterIds.length > 0 ? admin.from("profiles").select("id, full_name, email, phone").in("id", requesterIds) : Promise.resolve({ data: [] }),
    branchIds.length > 0 ? admin.from("branches").select("id, name").in("id", branchIds) : Promise.resolve({ data: [] }),
  ]);
  const profileMap = new Map((profiles ?? []).map((profile) => [profile.id, profile]));
  const branchMap = new Map((branches ?? []).map((branch) => [branch.id, branch]));
  const requests = rows.map((row) => ({
    ...row,
    requester: profileMap.get(row.requester_id) ?? null,
    branch: branchMap.get(row.branch_id) ?? null,
  }));
  return json({ success: true, requests });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
