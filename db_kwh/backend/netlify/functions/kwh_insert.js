function json(obj, status=200){
  return new Response(JSON.stringify(obj), { status, headers:{ "content-type":"application/json" } });
}

export default async (req) => {
  try{
    if (req.method !== "POST") return json({ ok:false, error:"Method Not Allowed" }, 405);

    const url = process.env.SUPABASE_URL || "";
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
    const table = process.env.SUPABASE_TABLE || "kwh_log";
    if (!url || !key) return json({ ok:false, error:"Server belum set SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY" }, 500);

    const body = await req.json().catch(() => ({}));
    const rows = Array.isArray(body.rows) ? body.rows : [];
    if (!rows.length) return json({ ok:false, error:"rows kosong" }, 400);

    const payload = rows.map(r => ({
      room: String(r.room || "").trim().toUpperCase(),
      code: String(r.code || "").trim().toUpperCase(),
      kwh: Number(r.kwh)
    }));

    const res = await fetch(`${url}/rest/v1/${table}`, {
      method: "POST",
      headers: {
        "apikey": key,
        "authorization": `Bearer ${key}`,
        "content-type": "application/json",
        "prefer": "return=representation"
      },
      body: JSON.stringify(payload)
    });

    const text = await res.text();
    if (!res.ok){
      return json({ ok:false, error:text }, 400);
    }

    let inserted = 0;
    try{ inserted = JSON.parse(text).length; } catch {}
    return json({ ok:true, inserted });

  } catch(e){
    return json({ ok:false, error:e.message }, 500);
  }
};
