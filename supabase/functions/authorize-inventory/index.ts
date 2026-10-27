import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const DEFAULT_RECIPIENT = "dtb.igerencia@gmail.com";

type Body = {
  action?: "start" | "get" | "save_count" | "request_code" | "verify" | "verify_master_pin" | "cancel_authorization" | "test_email" | "apply_authorized" | "history" | "history_detail" | "save_observations";
  branchId?: string;
  sessionId?: string;
  productId?: string;
  physical?: number | null;
  code?: string;
  pin?: string;
  department?: string;
  categoryId?: string;
  authorizationId?: string;
  observations?: string;
  productIds?: string[];
  mode?: string;
};

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

    const body = (await req.json()) as Body;
    const action = body.action ?? "get";
    if (action === "start") return await startSession(admin, actor.id, body.branchId);
    if (action === "get") return await getSession(admin, actor.id, body.sessionId, body.branchId);
    if (action === "save_count") return await saveCount(admin, actor.id, body);
    if (action === "request_code") return await requestCode(admin, actor.id, body.sessionId, body.department, body.categoryId);
    if (action === "verify") return await verifyCode(admin, actor.id, body.sessionId, body.code, body.department, body.categoryId);
    if (action === "verify_master_pin") return await verifyMasterPin(admin, actor.id, body.sessionId, body.pin, body.department, body.categoryId);
    if (action === "apply_authorized") return await applyAuthorized(admin, actor.id, body);
    if (action === "cancel_authorization") return await cancelAuthorization(admin, actor.id, body.sessionId);
    if (action === "test_email") return await testEmail(admin);
    if (action === "history") return await getHistory(admin, actor.id, body.branchId);
    if (action === "history_detail") return await getHistoryDetail(admin, actor.id, body.sessionId);
    if (action === "save_observations") return await saveObservations(admin, actor.id, body);
    return json({ error: "Solicitud inválida." }, 500);
  } catch (error) {
    console.error("authorize-inventory failed", error);
    return json({ error: "No se pudo completar la operación." }, 500);
  }
});

async function getEmailConfig(admin: ReturnType<typeof createClient>): Promise<{ sender: string; password: string; recipient: string }> {
  const { data: settings } = await admin.from("settings").select("key, value").in("key", ["email_sender", "email_password", "email_recipient"]);
  const config: Record<string, string> = {};
  (settings ?? []).forEach((row: { key: string; value: string }) => { config[row.key] = row.value; });
  return {
    sender: config.email_sender ?? "",
    password: config.email_password ?? "",
    recipient: config.email_recipient || DEFAULT_RECIPIENT,
  };
}

async function canAccessBranch(admin: ReturnType<typeof createClient>, userId: string, branchId: string): Promise<boolean> {
  const [{ data: direct }, { data: profile }] = await Promise.all([
    admin.from("user_branch_access").select("branch_id").eq("user_id", userId).eq("branch_id", branchId).maybeSingle(),
    admin.from("profiles").select("branch_id, active, role:roles(permissions)").eq("id", userId).maybeSingle(),
  ]);
  if (!profile?.active) return false;
  const permissions = Array.isArray((profile.role as { permissions?: unknown } | null)?.permissions)
    ? (profile.role as { permissions: unknown[] }).permissions
    : [];
  return !!direct || profile.branch_id === branchId || permissions.includes("all");
}

type ProductIdRow = { id: string };

async function getActiveProducts(admin: ReturnType<typeof createClient>): Promise<ProductIdRow[] | null> {
  const products: ProductIdRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin.from("products").select("id").is("deleted_at", null).eq("active", true).range(from, from + 999);
    if (error) return null;
    products.push(...((data ?? []) as ProductIdRow[]));
    if ((data ?? []).length < 1000) return products;
  }
}

async function startSession(admin: ReturnType<typeof createClient>, userId: string, branchId?: string): Promise<Response> {
  if (!branchId || !(await canAccessBranch(admin, userId, branchId))) return json({ error: "No tienes acceso a esa sucursal." });

  const { data: existing } = await admin.from("inventory_sessions")
    .select("id, branch_id, status, started_at, authorization_requested_at, completed_at")
    .eq("branch_id", branchId).neq("status", "closed").order("started_at", { ascending: false }).limit(1).maybeSingle();
  if (existing) return getSession(admin, userId, existing.id, branchId);

  const { data: session, error: sessionError } = await admin.from("inventory_sessions")
    .insert({ branch_id: branchId, started_by: userId }).select("id, branch_id, status, started_at, authorization_requested_at, completed_at").single();
  if (sessionError || !session) return json({ error: "No se pudo iniciar el inventario." });

  const [products, { data: stock, error: stockError }] = await Promise.all([
    getActiveProducts(admin),
    admin.from("product_stock").select("product_id, quantity").eq("branch_id", branchId),
  ]);
  if (!products || stockError) return json({ error: "No se pudo preparar el inventario." });
  const stockMap = new Map((stock ?? []).map((row: { product_id: string; quantity: number }) => [row.product_id, Number(row.quantity)]));
  const rows = products.map((product) => ({
    session_id: session.id,
    product_id: product.id,
    branch_id: branchId,
    theoretical: stockMap.get(product.id) ?? 0,
  }));
  if (rows.length > 0) {
    const { error } = await admin.from("inventory_counts").insert(rows);
    if (error) return json({ error: "No se pudo preparar el inventario." });
  }
  return getSession(admin, userId, session.id, branchId);
}

async function getInventoryCountProductIds(admin: ReturnType<typeof createClient>, sessionId: string): Promise<string[] | null> {
  const productIds: string[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin.from("inventory_counts").select("product_id").eq("session_id", sessionId).range(from, from + 999);
    if (error) return null;
    productIds.push(...((data ?? []) as Array<{ product_id: string }>).map((row) => row.product_id));
    if ((data ?? []).length < 1000) return productIds;
  }
}

async function ensureInventoryCounts(admin: ReturnType<typeof createClient>, sessionId: string, branchId: string): Promise<string | null> {
  const [products, { data: stock, error: stockError }, existing] = await Promise.all([
    getActiveProducts(admin),
    admin.from("product_stock").select("product_id, quantity").eq("branch_id", branchId),
    getInventoryCountProductIds(admin, sessionId),
  ]);
  if (!products || stockError || !existing) {
    console.error("inventory count synchronization skipped", { productsError: !products, stockError, existingError: !existing });
    return null;
  }
  const existingIds = new Set(existing);
  const stockMap = new Map((stock ?? []).map((row: { product_id: string; quantity: number }) => [row.product_id, Number(row.quantity)]));
  const missingRows = products
    .filter((product) => !existingIds.has(product.id))
    .map((product) => ({ session_id: sessionId, product_id: product.id, branch_id: branchId, theoretical: stockMap.get(product.id) ?? 0 }));
  if (missingRows.length === 0) return null;
  const { error } = await admin.from("inventory_counts").insert(missingRows);
  return error ? "No se pudieron sincronizar los productos del inventario." : null;
}

async function getSession(admin: ReturnType<typeof createClient>, userId: string, sessionId?: string, branchId?: string): Promise<Response> {
  let query = admin.from("inventory_sessions").select("id, branch_id, status, started_at, authorization_requested_at, completed_at").neq("status", "closed").order("started_at", { ascending: false }).limit(1);
  if (sessionId) query = query.eq("id", sessionId);
  if (branchId) query = query.eq("branch_id", branchId);
  const { data: session, error } = await query.maybeSingle();
  if (error || !session || !(await canAccessBranch(admin, userId, session.branch_id))) return json({ session: null, counts: [] });
  const { data: counts, error: countError } = await admin.from("inventory_counts")
    .select("id, session_id, product_id, branch_id, theoretical, physical, difference, affected_by_operation, affected_quantity, last_operation_at, counted_at, product:products(name, sku, barcode, barcode_2, department, unit)")
    .eq("session_id", session.id).order("product_id");
  if (countError) return json({ error: "No se pudo cargar el inventario." });
  return json({ session, counts: counts ?? [] });
}

async function saveCount(admin: ReturnType<typeof createClient>, userId: string, body: Body): Promise<Response> {
  if (!body.sessionId || !body.productId || body.physical == null || !Number.isFinite(body.physical) || body.physical < 0) return json({ error: "Cantidad inválida." });
  const { data: session } = await admin.from("inventory_sessions").select("id, branch_id, status").eq("id", body.sessionId).maybeSingle();
  if (!session || session.status === "closed" || !(await canAccessBranch(admin, userId, session.branch_id))) return json({ error: "El inventario ya no está disponible." });
  let { data: row } = await admin.from("inventory_counts").select("theoretical").eq("session_id", body.sessionId).eq("product_id", body.productId).maybeSingle();
  if (!row) {
    const { data: stock } = await admin.from("product_stock").select("quantity").eq("product_id", body.productId).eq("branch_id", session.branch_id).maybeSingle();
    const { data: inserted, error: insertError } = await admin.from("inventory_counts").insert({
      session_id: body.sessionId,
      product_id: body.productId,
      branch_id: session.branch_id,
      theoretical: Number(stock?.quantity ?? 0),
    }).select("theoretical").maybeSingle();
    if (insertError || !inserted) return json({ error: "No se pudo preparar el producto para este inventario." });
    row = inserted;
  }
  const theoretical = Number(row.theoretical ?? 0);
  const { data: updated, error } = await admin.from("inventory_counts").update({
    physical: body.physical,
    difference: Number(body.physical) - theoretical,
    counted_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    affected_by_operation: false,
    affected_quantity: 0,
    last_operation_at: null,
  }).eq("session_id", body.sessionId).eq("product_id", body.productId).select("id").maybeSingle();
  if (error || !updated) return json({ error: "No se pudo guardar el conteo. El producto no está preparado en esta sesión." });
  return json({ success: true });
}

async function getFilteredProductIds(admin: ReturnType<typeof createClient>, branchId: string, department?: string, categoryId?: string): Promise<string[]> {
  const productIds: string[] = [];
  for (let from = 0; ; from += 1000) {
    let query = admin.from("products").select("id").is("deleted_at", null).eq("active", true).range(from, from + 999);
    if (department) query = query.eq("department", department);
    if (categoryId) query = query.eq("category_id", categoryId);
    const { data, error } = await query;
    if (error) return [];
    productIds.push(...((data ?? []) as ProductIdRow[]).map((row) => row.id));
    if ((data ?? []).length < 1000) return productIds;
  }
}

async function requestCode(admin: ReturnType<typeof createClient>, userId: string, sessionId?: string, department?: string, categoryId?: string): Promise<Response> {
  if (!sessionId) return json({ error: "Inventario inválido." });
  const { data: session } = await admin.from("inventory_sessions").select("*").eq("id", sessionId).maybeSingle();
  if (!session || !(await canAccessBranch(admin, userId, session.branch_id)) || session.status === "closed") return json({ error: "El inventario ya no está disponible." });
  const syncError = await ensureInventoryCounts(admin, session.id, session.branch_id);
  if (syncError) return json({ error: syncError });

  const productIds = await getFilteredProductIds(admin, session.branch_id, department, categoryId);
  if (productIds.length === 0) return json({ error: "No hay productos en el filtro seleccionado." });

  let pendingQuery = admin.from("inventory_counts").select("id").eq("session_id", sessionId).in("product_id", productIds).is("physical", null).limit(1);
  const { data: pending } = await pendingQuery;
  if ((pending ?? []).length > 0) return json({ error: "Faltan productos por contar en el filtro seleccionado." });

  const { data: allCounts } = await admin.from("inventory_counts")
    .select("product_id, counted_at").eq("session_id", sessionId).in("product_id", productIds);
  if ((allCounts ?? []).length !== productIds.length) return json({ error: "Hay productos del filtro que aún no están preparados. Captura nuevamente su existencia." });
  const countDates = new Map((allCounts ?? []).map((row: { product_id: string; counted_at: string | null }) => [row.product_id, row.counted_at]));

  const { data: operations } = await admin.from("sales")
    .select("created_at, status, sale_items(product_id, quantity)")
    .eq("branch_id", session.branch_id)
    .gt("created_at", session.started_at);
  const operationTotals = new Map<string, { quantity: number; lastAt: string }>();
  for (const sale of operations ?? []) {
    if (["cancelada", "cancelled"].includes(String((sale as { status?: string }).status ?? '').toLowerCase())) continue;
    for (const item of ((sale as { sale_items?: Array<{ product_id: string | null; quantity: number }> }).sale_items ?? [])) {
      if (!item.product_id) continue;
      const previous = operationTotals.get(item.product_id);
      operationTotals.set(item.product_id, { quantity: (previous?.quantity ?? 0) + Number(item.quantity), lastAt: String(sale.created_at) });
    }
  }

  await admin.from("inventory_counts").update({ affected_by_operation: false, affected_quantity: 0, last_operation_at: null, updated_at: new Date().toISOString() }).eq("session_id", sessionId).in("product_id", productIds);

  const staleAffected: string[] = [];
  for (const [productId, operation] of operationTotals) {
    if (!productIds.includes(productId)) continue;
    const countedAt = countDates.get(productId);
    if (!countedAt || new Date(countedAt) < new Date(operation.lastAt)) {
      staleAffected.push(productId);
      await admin.from("inventory_counts").update({ affected_by_operation: true, affected_quantity: operation.quantity, last_operation_at: operation.lastAt, updated_at: new Date().toISOString() }).eq("session_id", sessionId).eq("product_id", productId);
    }
  }
  if (staleAffected.length > 0) return json({ error: `Hay ${staleAffected.length} producto(s) con conteo desactualizado por ventas. Cuenta nuevamente esos productos.`, affectedProducts: staleAffected.length });

  const { sender, password, recipient } = await getEmailConfig(admin);
  if (!sender || !password) return json({ error: "El correo emisor no está configurado. Ve a Configuración → Correo y Alertas para configurarlo." });

  const code = String(Math.floor(100000 + Math.random() * 900000));
  const hash = await sha256(code);
  const expires = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  const { error: updateError } = await admin.from("inventory_sessions").update({ status: "authorization_requested", authorization_requested_at: new Date().toISOString(), verification_code_hash: hash, code_expires_at: expires, code_attempts: 0 }).eq("id", sessionId).in("status", ["open", "authorization_requested"]);
  if (updateError) return json({ error: "No se pudo solicitar la autorización." });

  const [{ data: branch }, { data: profile }, { data: countRows }] = await Promise.all([
    admin.from("branches").select("name").eq("id", session.branch_id).maybeSingle(),
    admin.from("profiles").select("full_name, email").eq("id", userId).maybeSingle(),
    admin.from("inventory_counts").select("product_id, theoretical, physical, difference, product:products(name, sku, cost_price, sale_price)").eq("session_id", sessionId).in("product_id", productIds),
  ]);
  const counts = countRows ?? [];
  const totalProducts = counts.length;
  const matched = counts.filter((r: { difference: number | null }) => Number(r.difference ?? 0) === 0).length;
  const discrepancies = counts.filter((r: { difference: number | null }) => Number(r.difference ?? 0) !== 0);
  const branchName = (branch as { name?: string } | null)?.name ?? "Sucursal";
  const userName = (profile as { full_name?: string } | null)?.full_name ?? "Usuario";
  const dateStr = new Date().toLocaleString("es-MX", { timeZone: "America/Mexico_City" });

  const html = buildAuthorizationEmail(code, branchName, dateStr, userName, totalProducts, matched, discrepancies.length, discrepancies as Array<{ product_id: string; theoretical: number; physical: number; difference: number; product: { name: string; sku: string | null; cost_price: number; sale_price: number } }>);

  const sent = await sendEmail(sender, password, recipient, `Autorización de Inventario - ${branchName} - Código ${code}`, html);
  if (!sent) return json({ error: "No se pudo enviar el código al correo autorizado. Verifica la configuración de correo en Ajustes." });
  return json({ success: true, expiresAt: expires });
}

function buildAuthorizationEmail(code: string, branch: string, date: string, user: string, total: number, matched: number, discrepancies: number, rows: Array<{ product_id: string; theoretical: number; physical: number; difference: number; product: { name: string; sku: string | null; cost_price: number; sale_price: number } }>): string {
  const rowsHtml = rows.map((r) => {
    const diff = Number(r.difference ?? 0);
    const value = diff * Number(r.product.cost_price ?? 0);
    const sign = diff > 0 ? "+" : "";
    const type = diff < 0 ? "Faltante" : "Sobrante";
    const color = diff < 0 ? "#dc2626" : "#16a34a";
    return `<tr><td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;">${escapeHtml(r.product.name)}</td><td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;color:#6b7280;">${escapeHtml(r.product.sku ?? "—")}</td><td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;text-align:right;">${r.theoretical}</td><td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;text-align:right;">${r.physical}</td><td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:600;color:${color};">${sign}${diff}</td><td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:600;color:${color};">${value.toFixed(2)}</td><td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;color:${color};">${type}</td></tr>`;
  }).join("");
  return `<!DOCTYPE html><html><body style="font-family:Arial,Helvetica,sans-serif;max-width:680px;margin:0 auto;padding:20px;color:#1e293b;">
<h1 style="font-size:22px;color:#0f172a;margin-bottom:4px;">Autorizaci&oacute;n de Inventario</h1>
<p style="color:#64748b;font-size:14px;margin-bottom:24px;">Se solicita autorizaci&oacute;n para cerrar y aplicar un ajuste de inventario.</p>
<div style="text-align:center;background:#f1f5f9;border-radius:12px;padding:24px;margin-bottom:24px;">
<p style="font-size:13px;color:#64748b;margin:0 0 8px 0;">C&oacute;digo de Autorizaci&oacute;n</p>
<p style="font-size:42px;font-weight:700;letter-spacing:12px;color:#0f172a;margin:0;">${code}</p>
<p style="font-size:12px;color:#94a3b8;margin:8px 0 0 0;">V&aacute;lido por 15 minutos &middot; Uso &uacute;nico</p>
</div>
<h2 style="font-size:16px;color:#0f172a;margin-bottom:12px;">Resumen del Inventario</h2>
<table style="width:100%;font-size:14px;border-collapse:collapse;margin-bottom:24px;">
<tr><td style="padding:8px 0;color:#64748b;">Sucursal:</td><td style="padding:8px 0;font-weight:600;">${escapeHtml(branch)}</td></tr>
<tr><td style="padding:8px 0;color:#64748b;">Fecha y hora:</td><td style="padding:8px 0;font-weight:600;">${escapeHtml(date)}</td></tr>
<tr><td style="padding:8px 0;color:#64748b;">Empleado:</td><td style="padding:8px 0;font-weight:600;">${escapeHtml(user)}</td></tr>
<tr><td style="padding:8px 0;color:#64748b;">Total de productos:</td><td style="padding:8px 0;font-weight:600;">${total}</td></tr>
<tr><td style="padding:8px 0;color:#64748b;">Coincidencias &#10003;:</td><td style="padding:8px 0;font-weight:600;color:#16a34a;">${matched}</td></tr>
<tr><td style="padding:8px 0;color:#64748b;">Discrepancias &#10007;:</td><td style="padding:8px 0;font-weight:600;color:#dc2626;">${discrepancies}</td></tr>
</table>
${discrepancies > 0 ? `<h2 style="font-size:16px;color:#0f172a;margin-bottom:12px;">Reporte Detallado de Diferencias</h2>
<table style="width:100%;font-size:13px;border-collapse:collapse;">
<thead><tr style="background:#f8fafc;"><th style="padding:8px 10px;text-align:left;border-bottom:2px solid #e5e7eb;">Producto</th><th style="padding:8px 10px;text-align:left;border-bottom:2px solid #e5e7eb;">SKU</th><th style="padding:8px 10px;text-align:right;border-bottom:2px solid #e5e7eb;">Te&oacute;rico</th><th style="padding:8px 10px;text-align:right;border-bottom:2px solid #e5e7eb;">F&iacute;sico</th><th style="padding:8px 10px;text-align:right;border-bottom:2px solid #e5e7eb;">Diferencia</th><th style="padding:8px 10px;text-align:right;border-bottom:2px solid #e5e7eb;">Monto</th><th style="padding:8px 10px;text-align:left;border-bottom:2px solid #e5e7eb;">Tipo</th></tr></thead>
<tbody>${rowsHtml}</tbody></table>` : `<p style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:12px;color:#15803d;font-size:14px;">No hay discrepancias. Todos los productos cuadran correctamente.</p>`}
<p style="margin-top:24px;font-size:12px;color:#94a3b8;">Este es un correo autom&aacute;tico del sistema de punto de venta.</p>
</body></html>`;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

async function verifyCode(admin: ReturnType<typeof createClient>, userId: string, sessionId?: string, code?: string, department?: string, categoryId?: string): Promise<Response> {
  if (!sessionId || !code || !/^\d{6}$/.test(code)) return json({ error: "Ingresa el código de seis dígitos." });
  const { data: session } = await admin.from("inventory_sessions").select("branch_id").eq("id", sessionId).maybeSingle();
  if (!session || !(await canAccessBranch(admin, userId, session.branch_id))) return json({ error: "El inventario ya no está disponible." });
  let productIds: string[] | null = null;
  if (department || categoryId) {
    productIds = await getFilteredProductIds(admin, session.branch_id, department, categoryId);
  }
  const { data, error } = await admin.rpc("authorize_inventory_session", { p_session_id: sessionId, p_code: code, p_actor: userId, p_product_ids: productIds });
  if (error) {
    const msg = error.message ?? "";
    if (msg.includes("afectados") || msg.includes("Faltan") || msg.includes("expir") || msg.includes("inválido") || msg.includes("coincide") || msg.includes("límite") || msg.includes("no coincide")) {
      return json({ error: msg });
    }
    return json({ error: "Código de autorización inválido o expirado." });
  }
  return json(data);
}

async function verifyMasterPin(admin: ReturnType<typeof createClient>, userId: string, sessionId?: string, pin?: string, department?: string, categoryId?: string): Promise<Response> {
  if (!sessionId || !pin || !/^\d{6}$/.test(pin)) return json({ error: "Ingresa la clave maestra de seis dígitos." });
  const { data: session } = await admin.from("inventory_sessions").select("branch_id").eq("id", sessionId).maybeSingle();
  if (!session || !(await canAccessBranch(admin, userId, session.branch_id))) return json({ error: "El inventario ya no está disponible." });
  const { data: setting } = await admin.from("app_settings").select("value").eq("key", "inventory_master_pin_hash").maybeSingle();
  const storedHash = (setting as { value?: string } | null)?.value ?? "";
  if (!storedHash) return json({ error: "La clave maestra no está configurada. Configúrala en Ajustes → Correo y Alertas." });
  const pinHash = await sha256(pin);
  if (pinHash !== storedHash) return json({ error: "Clave maestra incorrecta." });
  const newHash = await sha256(pin + ":" + sessionId);
  await admin.from("inventory_sessions").update({ verification_code_hash: newHash, code_expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(), code_attempts: 0 }).eq("id", sessionId);
  let productIds: string[] | null = null;
  if (department || categoryId) {
    productIds = await getFilteredProductIds(admin, session.branch_id, department, categoryId);
  }
  const { data, error } = await admin.rpc("authorize_inventory_session", { p_session_id: sessionId, p_code: pin + ":" + sessionId, p_actor: userId, p_product_ids: productIds });
  if (error) {
    const msg = error.message ?? "";
    if (msg.includes("afectados") || msg.includes("Faltan") || msg.includes("expir") || msg.includes("inválido") || msg.includes("coincide") || msg.includes("límite")) {
      return json({ error: msg });
    }
    return json({ error: "No se pudo autorizar con la clave maestra." });
  }
  return json(data);
}

async function applyAuthorized(admin: ReturnType<typeof createClient>, userId: string, body: Body): Promise<Response> {
  if (!body.sessionId || !body.authorizationId) return json({ error: "Faltan datos de la autorización." });
  const { data: session } = await admin.from("inventory_sessions").select("branch_id, status").eq("id", body.sessionId).maybeSingle();
  if (!session || !(await canAccessBranch(admin, userId, session.branch_id))) return json({ error: "El inventario ya no está disponible." });
  if (session.status === "closed") return json({ error: "El inventario ya fue cerrado." });
  const syncError = await ensureInventoryCounts(admin, body.sessionId, session.branch_id);
  if (syncError) return json({ error: syncError });

  const { data: authRow } = await admin.from("authorization_requests")
    .select("id, status, operation_type")
    .eq("id", body.authorizationId)
    .eq("operation_type", "inventory")
    .maybeSingle();
  if (!authRow) return json({ error: "La autorización no existe." });
  if ((authRow as { status?: string }).status !== "consumed") return json({ error: "La autorización aún no ha sido validada por gerencia." });

  let productIds: string[] | null = null;
  if (body.productIds && body.productIds.length > 0) {
    productIds = body.productIds;
  } else if (body.department || body.categoryId) {
    productIds = await getFilteredProductIds(admin, session.branch_id, body.department, body.categoryId);
  }
  const applyCode = `auth:${body.authorizationId}:${body.sessionId}`;
  const newHash = await sha256(applyCode);
  await admin.from("inventory_sessions").update({ status: "authorization_requested", verification_code_hash: newHash, code_expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(), code_attempts: 0, inventory_mode: body.mode ?? null, inventory_department: body.department ?? null, inventory_category_id: body.categoryId ?? null }).eq("id", body.sessionId);
  const { data, error } = await admin.rpc("apply_inventory_authorization", { p_session_id: body.sessionId, p_code: applyCode, p_actor: userId, p_product_ids: productIds });
  if (error) {
    const msg = error.message ?? "";
    return json({ error: msg || "No se pudo aplicar el inventario autorizado." });
  }
  return json(data);
}

async function cancelAuthorization(admin: ReturnType<typeof createClient>, userId: string, sessionId?: string): Promise<Response> {
  if (!sessionId) return json({ error: "Inventario inválido." });
  const { data: session } = await admin.from("inventory_sessions").select("branch_id").eq("id", sessionId).maybeSingle();
  if (!session || !(await canAccessBranch(admin, userId, session.branch_id))) return json({ error: "El inventario ya no está disponible." });
  const { error } = await admin.rpc("cancel_inventory_authorization", { p_session_id: sessionId, p_actor: userId });
  if (error) return json({ error: "No se pudo cancelar la autorización." });
  return json({ success: true });
}

async function testEmail(admin: ReturnType<typeof createClient>): Promise<Response> {
  const { sender, password, recipient } = await getEmailConfig(admin);
  if (!sender) return json({ error: "Falta configurar el correo emisor." });
  if (!password) return json({ error: "Falta configurar la contraseña de aplicación." });
  if (!recipient) return json({ error: "Falta configurar el correo receptor." });

  const html = `<!DOCTYPE html><html><body style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;padding:20px;color:#1e293b;">
<h1 style="font-size:20px;color:#16a34a;">Prueba de Conexión Exitosa</h1>
<p style="color:#64748b;font-size:14px;">Este es un mensaje de prueba desde el sistema de punto de venta.</p>
<p style="color:#64748b;font-size:14px;">Si recibiste este correo, la configuración de correo electrónico funciona correctamente.</p>
<p style="margin-top:24px;font-size:12px;color:#94a3b8;">Correo automático del sistema de inventario y ventas.</p>
</body></html>`;

  const sent = await sendEmail(sender, password, recipient, "Prueba de Conexión - Sistema de Punto de Venta", html);
  if (!sent) return json({ error: "No se pudo enviar el correo. Verifica las credenciales y el correo receptor." });
  return json({ success: true, recipient });
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sendEmail(user: string, pass: string, recipient: string, subject: string, html: string): Promise<boolean> {
  let conn: Deno.Conn = await Deno.connect({ hostname: "smtp.gmail.com", port: 587 });
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    const readResponse = async (): Promise<string> => {
      let response = "";
      while (true) {
        while (!buffer.includes("\r\n")) {
          const chunk = new Uint8Array(1024);
          const size = await conn.read(chunk);
          if (size === null) return response;
          buffer += decoder.decode(chunk.subarray(0, size));
        }
        const end = buffer.indexOf("\r\n");
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        response += `${line}\n`;
        if (line.length < 4 || line[3] !== "-") return response;
      }
    };
    const send = (command: string) => conn.write(encoder.encode(`${command}\r\n`));
    if (!(await readResponse()).startsWith("220")) return false;
    await send("EHLO localhost");
    if (!(await readResponse()).startsWith("250")) return false;
    await send("STARTTLS");
    if (!(await readResponse()).startsWith("220")) return false;
    conn = await Deno.startTls(conn, { hostname: "smtp.gmail.com" });
    await send("EHLO localhost");
    if (!(await readResponse()).startsWith("250")) return false;
    await send("AUTH LOGIN");
    if (!(await readResponse()).startsWith("334")) return false;
    await send(btoa(user));
    if (!(await readResponse()).startsWith("334")) return false;
    await send(btoa(pass));
    if (!(await readResponse()).startsWith("235")) return false;
    await send(`MAIL FROM:<${user}>`);
    if (!(await readResponse()).startsWith("250")) return false;
    await send(`RCPT TO:<${recipient}>`);
    if (!(await readResponse()).startsWith("250")) return false;
    await send("DATA");
    if (!(await readResponse()).startsWith("354")) return false;
    const message = `From: ${user}\r\nTo: ${recipient}\r\nSubject: ${subject}\r\nMIME-Version: 1.0\r\nContent-Type: text/html; charset=UTF-8\r\n\r\n${html}\r\n.`;
    await send(message);
    return (await readResponse()).startsWith("250");
  } catch (error) {
    console.error("inventory authorization email failed", error);
    return false;
  } finally {
    conn.close();
  }
}

type HistorySession = {
  id: string;
  folio: string | null;
  branch_id: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  authorized_at: string | null;
  authorized_by: string | null;
  authorized_by_name: string | null;
  started_by: string;
  observations: string | null;
  branch_name: string | null;
  started_by_name: string | null;
  inventory_mode: string | null;
  inventory_department: string | null;
  inventory_category_id: string | null;
  inventory_category_name: string | null;
  total_products: number;
  counted_products: number;
  discrepancies: number;
  total_loss: number;
  total_surplus: number;
  total_invested: number;
  total_gain: number;
};

async function getHistory(admin: ReturnType<typeof createClient>, userId: string, branchId?: string): Promise<Response> {
  const { data: profile } = await admin.from("profiles").select("branch_id, active, role:roles(permissions)").eq("id", userId).maybeSingle();
  if (!profile?.active) return json({ error: "No autorizado." }, 500);
  const permissions = Array.isArray((profile.role as { permissions?: unknown } | null)?.permissions) ? (profile.role as { permissions: unknown[] }).permissions : [];
  const isAdmin = permissions.includes("all") || permissions.includes("settings");

  let sessionQuery = admin.from("inventory_sessions").select("id, folio, branch_id, status, started_at, completed_at, authorized_at, authorized_by, authorized_by_name, started_by, observations, inventory_mode, inventory_department, inventory_category_id").eq("status", "closed").order("started_at", { ascending: false }).limit(200);
  if (branchId) {
    if (!(await canAccessBranch(admin, userId, branchId))) return json({ error: "No tienes acceso a esa sucursal." });
    sessionQuery = sessionQuery.eq("branch_id", branchId);
  } else if (!isAdmin) {
    sessionQuery = sessionQuery.eq("branch_id", profile.branch_id ?? "");
  }
  const { data: sessions, error } = await sessionQuery;
  if (error) return json({ error: "No se pudo cargar el historial." });

  const branchIds = Array.from(new Set((sessions ?? []).map((s: { branch_id: string }) => s.branch_id)));
  const userIds = Array.from(new Set((sessions ?? []).flatMap((s: { started_by: string; authorized_by: string | null }) => [s.started_by, s.authorized_by].filter(Boolean) as string[])));
  const sessionIds = (sessions ?? []).map((s: { id: string }) => s.id);
  const categoryIds = Array.from(new Set((sessions ?? []).map((s: { inventory_category_id: string | null }) => s.inventory_category_id).filter((id): id is string => Boolean(id))));

  const [branchesRes, profilesRes, countsRes, categoriesRes] = await Promise.all([
    branchIds.length > 0 ? admin.from("branches").select("id, name").in("id", branchIds) : Promise.resolve({ data: [], error: null }),
    userIds.length > 0 ? admin.from("profiles").select("id, full_name").in("id", userIds) : Promise.resolve({ data: [], error: null }),
    sessionIds.length > 0 ? admin.from("inventory_counts").select("session_id, physical, difference, product:products(cost_price, sale_price)").in("session_id", sessionIds).not("physical", "is", null) : Promise.resolve({ data: [], error: null }),
    categoryIds.length > 0 ? admin.from("categories").select("id, name").in("id", categoryIds) : Promise.resolve({ data: [], error: null }),
  ]);

  const categoryNameMap = new Map((categoriesRes.data ?? []).map((c: { id: string; name: string }) => [c.id, c.name]));

  const branchMap = new Map((branchesRes.data ?? []).map((b: { id: string; name: string }) => [b.id, b.name]));
  const profileMap = new Map((profilesRes.data ?? []).map((p: { id: string; full_name: string }) => [p.id, p.full_name]));
  const countsBySession = new Map<string, Array<{ physical: number | null; difference: number | null; product: { cost_price: number; sale_price: number } | null }>>();
  for (const c of (countsRes.data ?? []) as Array<{ session_id: string; physical: number | null; difference: number | null; product: { cost_price: number; sale_price: number } | null }>) {
    const arr = countsBySession.get(c.session_id) ?? [];
    arr.push(c);
    countsBySession.set(c.session_id, arr);
  }

  const result: HistorySession[] = (sessions ?? []).map((s: {
    id: string; folio: string | null; branch_id: string; status: string; started_at: string;
    completed_at: string | null; authorized_at: string | null; authorized_by: string | null;
    authorized_by_name: string | null; started_by: string; observations: string | null;
    inventory_mode: string | null; inventory_department: string | null; inventory_category_id: string | null;
  }) => {
    const counts = countsBySession.get(s.id) ?? [];
    const counted = counts.filter((c) => c.physical != null);
    const discrep = counted.filter((c) => Number(c.difference ?? 0) !== 0);
    let totalLoss = 0, totalSurplus = 0, totalInvested = 0, totalGain = 0;
    for (const c of discrep) {
      const diff = Number(c.difference ?? 0);
      const cost = Number(c.product?.cost_price ?? 0);
      const sale = Number(c.product?.sale_price ?? 0);
      const value = diff * cost;
      if (value < 0) totalLoss += Math.abs(value);
      else totalSurplus += value;
      totalInvested += Math.abs(diff) * cost;
      totalGain += Math.abs(diff) * sale;
    }
    return {
      id: s.id, folio: s.folio, branch_id: s.branch_id, status: s.status, started_at: s.started_at,
      completed_at: s.completed_at, authorized_at: s.authorized_at, authorized_by: s.authorized_by,
      authorized_by_name: s.authorized_by_name ?? (s.authorized_by ? (profileMap.get(s.authorized_by) ?? null) : null),
      started_by: s.started_by, observations: s.observations,
      branch_name: branchMap.get(s.branch_id) ?? null,
      started_by_name: profileMap.get(s.started_by) ?? null,
      inventory_mode: s.inventory_mode, inventory_department: s.inventory_department,
      inventory_category_id: s.inventory_category_id, inventory_category_name: s.inventory_category_id ? (categoryNameMap.get(s.inventory_category_id) ?? null) : null,
      total_products: counts.length, counted_products: counted.length, discrepancies: discrep.length,
      total_loss: totalLoss, total_surplus: totalSurplus, total_invested: totalInvested, total_gain: totalGain,
    };
  });
  return json({ sessions: result });
}

async function getHistoryDetail(admin: ReturnType<typeof createClient>, userId: string, sessionId?: string): Promise<Response> {
  if (!sessionId) return json({ error: "Inventario inv\u00e1lido." });
  const { data: session } = await admin.from("inventory_sessions").select("id, folio, branch_id, status, started_at, completed_at, authorized_at, authorized_by, authorized_by_name, started_by, observations, inventory_mode, inventory_department, inventory_category_id").eq("id", sessionId).maybeSingle();
  if (!session || !(await canAccessBranch(admin, userId, session.branch_id))) return json({ error: "El inventario no est\u00e1 disponible." });
  const [branchRes, startedByRes, authorizedByRes, countsRes] = await Promise.all([
    admin.from("branches").select("name, address, phone, street, exterior_number, neighborhood, municipality, state, postal_code").eq("id", session.branch_id).maybeSingle(),
    admin.from("profiles").select("full_name").eq("id", session.started_by).maybeSingle(),
    session.authorized_by ? admin.from("profiles").select("full_name").eq("id", session.authorized_by).maybeSingle() : Promise.resolve({ data: null, error: null }),
    admin.from("inventory_counts").select("product_id, theoretical, physical, difference, affected_by_operation, counted_at, product:products(name, sku, barcode, barcode_2, department, unit, cost_price, sale_price)").eq("session_id", sessionId).not("physical", "is", null).order("product_id"),
  ]);
  const counts = (countsRes.data ?? []) as Array<{ product_id: string; theoretical: number; physical: number | null; difference: number | null; affected_by_operation: boolean; counted_at: string | null; product: { name: string; sku: string | null; barcode: string | null; barcode_2: string | null; department: string | null; unit: string; cost_price: number; sale_price: number } | null }>;
  const categoryName = session.inventory_category_id ? ((await admin.from("categories").select("name").eq("id", session.inventory_category_id).maybeSingle()).data as { name?: string } | null)?.name ?? null : null;
  return json({
    session: {
      ...session,
      inventory_category_name: categoryName,
      branch_name: (branchRes.data as { name?: string } | null)?.name ?? null,
      branch: branchRes.data,
      started_by_name: (startedByRes.data as { full_name?: string } | null)?.full_name ?? null,
      authorized_by_name: session.authorized_by_name ?? ((authorizedByRes.data as { full_name?: string } | null)?.full_name ?? null),
    },
    counts,
  });
}

async function saveObservations(admin: ReturnType<typeof createClient>, userId: string, body: Body): Promise<Response> {
  if (!body.sessionId) return json({ error: "Inventario inv\u00e1lido." });
  const { data: session } = await admin.from("inventory_sessions").select("branch_id, status").eq("id", body.sessionId).maybeSingle();
  if (!session || !(await canAccessBranch(admin, userId, session.branch_id))) return json({ error: "El inventario no est\u00e1 disponible." });
  const { error } = await admin.from("inventory_sessions").update({ observations: body.observations ?? null }).eq("id", body.sessionId);
  if (error) return json({ error: "No se pudieron guardar las observaciones." });
  return json({ success: true });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
