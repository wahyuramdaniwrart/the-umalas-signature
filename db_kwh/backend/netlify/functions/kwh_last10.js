function json(obj, status=200){
  return new Response(JSON.stringify(obj), { status, headers:{ "content-type":"application/json" } });
}

function toLocalString(iso){
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = n => String(n).padStart(2,"0");
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default async (req) => {
  try{
    if (req.method !== "GET") return json({ ok:false, error:"Method Not Allowed" }, 405);

    const url = process.env.SUPABASE_URL || "";
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
    const table = process.env.SUPABASE_TABLE || "kwh_log";
    if (!url || !key) return json({ ok:false, error:"Server belum set SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY" }, 500);

    const u = new URL(req.url);
    const q = String(u.searchParams.get("q") || "").trim().toUpperCase();
    const date = String(u.searchParams.get("date") || "").trim(); // YYYY-MM-DD optional

    if (!q) return json({ ok:false, error:"q kosong" }, 400);

    // or=(room.eq.Q,code.eq.Q)
    let query = `select=room,code,kwh,created_at&or=(room.eq.${encodeURIComponent(q)},code.eq.${encodeURIComponent(q)})&order=created_at.desc&limit=10`;

    // optional date filter
    if (date){
      const start = `${date}T00:00:00Z`;
      const endDate = new Date(`${date}T00:00:00Z`);
      endDate.setUTCDate(endDate.getUTCDate()+1);
      const end = endDate.toISOString();

      query += `&created_at=gte.${encodeURIComponent(start)}&created_at=lt.${encodeURIComponent(end)}`;
    }

    const res = await fetch(`${url}/rest/v1/${table}?${query}`, {
      headers: {
        "apikey": key,
        "authorization": `Bearer ${key}`,
      }
    });

    const text = await res.text();
    if (!res.ok) return json({ ok:false, error:text }, 400);

    const rows = JSON.parse(text).map(r => ({
      room: r.room,
      code: r.code,
      kwh: r.kwh,
      created_at: r.created_at,
      created_at_local: toLocalString(r.created_at),
    }));

    return json({ ok:true, rows });
  } catch(e){
    return json({ ok:false, error:e.message }, 500);
  }
};
