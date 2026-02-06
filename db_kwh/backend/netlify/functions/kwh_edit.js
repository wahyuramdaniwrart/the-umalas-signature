function json(obj, status=200){
  return new Response(JSON.stringify(obj), { status, headers:{ "content-type":"application/json" } });
}

function dayRange(date){
  // date = "YYYY-MM-DD" (WITA)
  const startD = new Date(`${date}T00:00:00+08:00`);
  const endD = new Date(`${date}T00:00:00+08:00`);
  endD.setDate(endD.getDate() + 1);
  return { start: startD.toISOString(), end: endD.toISOString() };
}

function normStr(x){
  return String(x || "").trim().toUpperCase();
}

export default async (req) => {
  try{
    if (req.method !== "POST") return json({ ok:false, error:"Method Not Allowed" }, 405);

    const url = process.env.SUPABASE_URL || "";
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
    const table = process.env.SUPABASE_TABLE || "kwh_log";
    if (!url || !key) return json({ ok:false, error:"Server belum set SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY" }, 500);

    const body = await req.json().catch(() => ({}));
    const date = String(body.date || "").trim();
    const action = String(body.action || "").trim();

    if (!date) return json({ ok:false, error:"date kosong" }, 400);
    if (!action) return json({ ok:false, error:"action kosong" }, 400);

    const { start, end } = dayRange(date);

    async function deleteAll(){
      const delUrl =
        `${url}/rest/v1/${table}` +
        `?created_at=gte.${encodeURIComponent(start)}` +
        `&created_at=lt.${encodeURIComponent(end)}`;

      const res = await fetch(delUrl, {
        method: "DELETE",
        headers: {
          "apikey": key,
          "authorization": `Bearer ${key}`,
          "prefer": "return=minimal"
        }
      });

      const text = await res.text();
      if (!res.ok) throw new Error(text || "Delete gagal");
      return true;
    }

    if (action === "delete_all"){
      await deleteAll();
      return json({ ok:true, deleted_all:true });
    }

    if (action === "delete_some"){
      const rows = Array.isArray(body.rows) ? body.rows : [];
      if (!rows.length) return json({ ok:false, error:"rows kosong" }, 400);

      let deleted = 0;
      for (const r of rows){
        const id = r.id;
        if (id === undefined || id === null) continue;

        const res = await fetch(`${url}/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`, {
          method:"DELETE",
          headers:{
            "apikey": key,
            "authorization": `Bearer ${key}`,
            "prefer": "return=minimal"
          }
        });

        const text = await res.text();
        if (!res.ok) throw new Error(text || `Delete gagal untuk id ${id}`);
        deleted++;
      }

      return json({ ok:true, deleted });
    }

    if (action === "replace_all"){
      const rows = Array.isArray(body.rows) ? body.rows : [];
      await deleteAll();

      if (!rows.length){
        return json({ ok:true, replaced:true, inserted:0 });
      }

      // taruh jam 12:00 WITA agar aman di hari itu, lalu +1 detik per baris
      const base = new Date(`${date}T12:00:00+08:00`).getTime();

      const payload = rows.map((r, i) => ({
        room: normStr(r.room),
        code: normStr(r.code),
        kwh: Number(r.kwh),
        created_at: new Date(base + i * 1000).toISOString()
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
      if (!res.ok) return json({ ok:false, error:text }, 400);

      let inserted = 0;
      try{ inserted = JSON.parse(text).length; } catch {}
      return json({ ok:true, replaced:true, inserted });
    }

    if (action === "update_some"){
      const rows = Array.isArray(body.rows) ? body.rows : [];
      if (!rows.length) return json({ ok:false, error:"rows kosong" }, 400);

      let updated = 0;
      for (const r of rows){
        const id = r.id;
        if (id === undefined || id === null) continue;

        const patch = {};
        if (r.room !== undefined) patch.room = normStr(r.room);
        if (r.code !== undefined) patch.code = normStr(r.code);
        if (r.kwh !== undefined) patch.kwh = Number(r.kwh);

        const res = await fetch(`${url}/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`, {
          method: "PATCH",
          headers: {
            "apikey": key,
            "authorization": `Bearer ${key}`,
            "content-type": "application/json",
            "prefer": "return=minimal"
          },
          body: JSON.stringify(patch)
        });

        const text = await res.text();
        if (!res.ok) throw new Error(text || `Update gagal untuk id ${id}`);
        updated++;
      }

      return json({ ok:true, updated });
    }

    if (action === "insert_some"){
      const rows = Array.isArray(body.rows) ? body.rows : [];
      if (!rows.length) return json({ ok:false, error:"rows kosong" }, 400);

      // taruh jam 12:00 WITA agar aman di hari itu, lalu +1 detik per baris
      const base = new Date(`${date}T12:00:00+08:00`).getTime();

      const payload = rows.map((r, i) => ({
        room: normStr(r.room),
        code: normStr(r.code),
        kwh: Number(r.kwh),
        created_at: new Date(base + i * 1000).toISOString()
      }));

      const res = await fetch(`${url}/rest/v1/${table}`, {
        method:"POST",
        headers:{
          "apikey": key,
          "authorization": `Bearer ${key}`,
          "content-type":"application/json",
          "prefer":"return=representation"
        },
        body: JSON.stringify(payload)
      });

      const text = await res.text();
      if (!res.ok) return json({ ok:false, error:text }, 400);

      let inserted = 0;
      try{ inserted = JSON.parse(text).length; } catch {}
      return json({ ok:true, inserted });
    }

    return json({ ok:false, error:"action tidak dikenal" }, 400);

  } catch(e){
    return json({ ok:false, error:e.message }, 500);
  }
};
