function json(obj, status=200){
  return new Response(JSON.stringify(obj), { status, headers:{ "content-type":"application/json" } });
}

const TZ = process.env.APP_TIMEZONE || "Asia/Makassar"; // WITA

function dayRangeInTZ(date){
  // date = "YYYY-MM-DD" (WITA)
  // 00:00 WITA = 16:00Z hari sebelumnya
  const startD = new Date(`${date}T00:00:00+08:00`);
  const endD = new Date(`${date}T00:00:00+08:00`);
  endD.setDate(endD.getDate() + 1);
  return { start: startD.toISOString(), end: endD.toISOString() };
}

function toLocalStringDDMMYYYY(iso){
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;

  const parts = new Intl.DateTimeFormat("id-ID", {
    timeZone: TZ,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(d);

  const get = (t) => parts.find(p => p.type === t)?.value || "";
  return `${get("day")}/${get("month")}/${get("year")} ${get("hour")}:${get("minute")}`;
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

    // optional date filter (ikuti boundary WITA biar konsisten dengan kwh_by_date)
    if (date){
      const { start, end } = dayRangeInTZ(date);
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
      created_at_local: toLocalStringDDMMYYYY(r.created_at),
    }));

    return json({ ok:true, rows });
  } catch(e){
    return json({ ok:false, error:e.message }, 500);
  }
};
