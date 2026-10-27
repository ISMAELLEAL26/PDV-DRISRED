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
    const { data: { user } } = await admin.auth.getUser(token);
    if (!user) return new Response(JSON.stringify({ error: "No autorizado" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const body = await req.json() as { to?: string; subject?: string; text?: string; folio?: string; storeName?: string };
    const to = body.to?.trim();
    if (!to || !body.text) return new Response(JSON.stringify({ error: "Faltan datos" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    // Read email config from settings table
    const { data: settingsRows } = await admin.from("settings").select("key, value").in("key", ["email_sender", "email_password", "email_template", "email_logo_url"]);
    const settings: Record<string, string> = {};
    (settingsRows ?? []).forEach((r: { key: string; value: string }) => { settings[r.key] = r.value; });

    const senderEmail = settings.email_sender ?? "";
    const senderPassword = settings.email_password ?? "";
    if (!senderEmail || !senderPassword) {
      return new Response(JSON.stringify({ error: "Correo emisor no configurado" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const template = settings.email_template ?? "{ticket}";
    const emailBody = template.replace("{ticket}", body.text).replace("{folio}", body.folio ?? "").replace("{storeName}", body.storeName ?? "");
    const logoUrl = settings.email_logo_url ?? "";

    // Build MIME multipart message
    const boundary = "boundary_" + crypto.randomUUID().replace(/-/g, "");
    const subject = body.subject ?? `Ticket ${body.folio ?? ""}`;
    const encodedSubject = `=?UTF-8?B?${btoa(unescape(encodeURIComponent(subject)))}?=`;

    let mimeBody = `From: ${body.storeName ?? "Tienda"} <${senderEmail}>\r\n`;
    mimeBody += `To: <${to}>\r\n`;
    mimeBody += `Subject: ${encodedSubject}\r\n`;
    mimeBody += `MIME-Version: 1.0\r\n`;
    if (logoUrl) {
      mimeBody += `Content-Type: multipart/related; boundary="${boundary}"\r\n\r\n`;
      mimeBody += `--${boundary}\r\n`;
      mimeBody += `Content-Type: text/html; charset=UTF-8\r\n`;
      mimeBody += `Content-Transfer-Encoding: 8bit\r\n\r\n`;
      mimeBody += `<html><body style="font-family:Arial,sans-serif;"><img src="cid:logo" style="max-width:200px;margin-bottom:16px"/><pre style="font-family:Courier New,monospace;font-size:13px;white-space:pre-wrap;">${escapeHtml(emailBody)}</pre></body></html>\r\n\r\n`;
      mimeBody += `--${boundary}\r\n`;
      mimeBody += `Content-Type: image/png\r\n`;
      mimeBody += `Content-Transfer-Encoding: base64\r\n`;
      mimeBody += `Content-ID: <logo>\r\n`;
      mimeBody += `Content-Disposition: inline; filename="logo.png"\r\n\r\n`;
      const logoRes = await fetch(logoUrl);
      if (logoRes.ok) {
        const logoBuf = new Uint8Array(await logoRes.arrayBuffer());
        const logoB64 = btoa(String.fromCharCode(...logoBuf));
        mimeBody += logoB64 + "\r\n";
      }
      mimeBody += `--${boundary}--\r\n`;
    } else {
      mimeBody += `Content-Type: text/html; charset=UTF-8\r\n`;
      mimeBody += `Content-Transfer-Encoding: 8bit\r\n\r\n`;
      mimeBody += `<html><body style="font-family:Arial,sans-serif;"><pre style="font-family:Courier New,monospace;font-size:13px;white-space:pre-wrap;">${escapeHtml(emailBody)}</pre></body></html>\r\n`;
    }

    // Send via Gmail SMTP using Deno's built-in fetch to an SMTP relay
    // Since Deno doesn't have native SMTP, we use a simple SMTP client via TCP socket
    const sent = await sendGmail(senderEmail, senderPassword, to, mimeBody);
    if (!sent) {
      return new Response(JSON.stringify({ error: "No se pudo enviar el correo" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ success: true }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (cause) {
    console.error("send-ticket-email failed", cause);
    return new Response(JSON.stringify({ error: "No se pudo enviar el correo" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function sendGmail(user: string, pass: string, to: string, mimeBody: string): Promise<boolean> {
  const conn = await Deno.connect({ hostname: "smtp.gmail.com", port: 465 });
  try {
    const writer = new WritableStream<Uint8Array>({ write: (chunk) => conn.write(chunk) });
    const reader = new ReadableStream<Uint8Array>({ start: (controller) => { readLoop(conn, controller); } });
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    let buf = "";

    const readLine = async (): Promise<string> => {
      while (!buf.includes("\r\n")) {
        const chunk = new Uint8Array(1024);
        const n = await conn.read(chunk);
        if (n === null) break;
        buf += decoder.decode(chunk.subarray(0, n));
      }
      const idx = buf.indexOf("\r\n");
      const line = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      return line;
    };
    const sendCmd = (cmd: string) => conn.write(encoder.encode(cmd + "\r\n"));

    await readLine(); // 220 greeting
    await sendCmd("EHLO localhost");
    await readLine(); // may read multiple lines
    await sendCmd("AUTH LOGIN");
    await readLine();
    await sendCmd(btoa(user));
    await readLine();
    await sendCmd(btoa(pass));
    const authResp = await readLine();
    if (!authResp.startsWith("235")) return false;
    await sendCmd(`MAIL FROM:<${user}>`);
    await readLine();
    await sendCmd(`RCPT TO:<${to}>`);
    await readLine();
    await sendCmd("DATA");
    await readLine();
    await sendCmd(mimeBody + "\r\n.");
    const dataResp = await readLine();
    await sendCmd("QUIT");
    return dataResp.startsWith("250");
  } catch {
    return false;
  } finally {
    conn.close();
  }
}

async function readLoop(conn: Deno.Conn, controller: ReadableStreamDefaultController<Uint8Array>) {
  try {
    while (true) {
      const chunk = new Uint8Array(1024);
      const n = await conn.read(chunk);
      if (n === null) break;
      controller.enqueue(chunk.subarray(0, n));
    }
  } catch {
    // connection closed
  }
  controller.close();
}
