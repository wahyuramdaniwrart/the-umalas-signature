function json(obj, status = 200){
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store"
    }
  });
}

function normStr(x){
  return String(x || "").trim().toUpperCase();
}

function safeText(x){
  return String(x || "").trim();
}

function getEnv(){
  const url = process.env.SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  const table = process.env.SUPABASE_CHECKLIST_TABLE || "room_checklist";
  return { url, key, table };
}

function isEngineer(req){
  const cookie = req.headers.get("cookie") || "";
  return /(?:^|;\s*)eng=1(?:;|$)/.test(cookie);
}

async function sbFetch(url, key, path, init = {}){
  const res = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      ...(init.headers || {})
    }
  });
  const text = await res.text();
  if (!res.ok) throw new Error(text || "Supabase error");
  return text;
}

async function getChecklistByRoomAndDate({ url, key, table, room, checklistDate }){
  const qs = [
    "select=id,room,code,room_type,checklist_date,area,utility,condition,notes,update_smarthome,sort_no,updated_at",
    `room=eq.${encodeURIComponent(room)}`,
    `checklist_date=eq.${encodeURIComponent(checklistDate)}`,
    "order=sort_no.asc.nullslast,id.asc"
  ].join("&");

  const text = await sbFetch(url, key, `${table}?${qs}`);
  return JSON.parse(text || "[]");
}

export default async (req) => {
  try {
    const { url, key, table } = getEnv();
    if (!url || !key) {
      return json({ ok: false, error: "Server belum set SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY" }, 500);
    }

    if (req.method === "GET") {
      const u = new URL(req.url);
      const room = normStr(u.searchParams.get("room") || u.searchParams.get("q") || "");
      const checklistDate = safeText(u.searchParams.get("date"));
      const latest = String(u.searchParams.get("latest") || "") === "1";

      if (!room) return json({ ok: false, error: "room kosong" }, 400);

      if (checklistDate) {
        const rows = await getChecklistByRoomAndDate({ url, key, table, room, checklistDate });
        return json({ ok: true, room, checklist_date: checklistDate, rows });
      }

      if (latest) {
        const qsLatest = [
          "select=checklist_date",
          `room=eq.${encodeURIComponent(room)}`,
          "order=checklist_date.desc",
          "limit=1"
        ].join("&");

        const textLatest = await sbFetch(url, key, `${table}?${qsLatest}`);
        const latestRows = JSON.parse(textLatest || "[]");
        const latestDate = latestRows[0]?.checklist_date || "";

        if (!latestDate) {
          return json({ ok: true, room, checklist_date: "", rows: [] });
        }

        const rows = await getChecklistByRoomAndDate({ url, key, table, room, checklistDate: latestDate });
        return json({ ok: true, room, checklist_date: latestDate, rows });
      }

      return json({ ok: false, error: "date atau latest=1 wajib diisi" }, 400);
    }

    if (req.method === "POST") {
      if (!isEngineer(req)) return json({ ok: false, error: "Unauthorized" }, 401);

      const body = await req.json().catch(() => ({}));
      const action = safeText(body.action);
      if (action !== "replace_for_room_date") {
        return json({ ok: false, error: "action tidak dikenal" }, 400);
      }

      const room = normStr(body.room);
      const code = normStr(body.code);
      const roomType = safeText(body.room_type);
      const checklistDate = safeText(body.checklist_date);
      const rows = Array.isArray(body.rows) ? body.rows : [];

      if (!room) return json({ ok: false, error: "room kosong" }, 400);
      if (!code) return json({ ok: false, error: "code kosong" }, 400);
      if (!roomType) return json({ ok: false, error: "room_type kosong" }, 400);
      if (!checklistDate) return json({ ok: false, error: "checklist_date kosong" }, 400);
      if (!rows.length) return json({ ok: false, error: "rows kosong" }, 400);

      const deleteQs = [
        `room=eq.${encodeURIComponent(room)}`,
        `checklist_date=eq.${encodeURIComponent(checklistDate)}`
      ].join("&");

      await sbFetch(url, key, `${table}?${deleteQs}`, {
        method: "DELETE",
        headers: { prefer: "return=minimal" }
      });

      const payload = rows.map((r, i) => ({
        room,
        code,
        room_type: roomType,
        checklist_date: checklistDate,
        area: safeText(r.area),
        utility: safeText(r.utility),
        condition: String(r.condition || "NORMAL").trim().toUpperCase() === "DEFECT" ? "DEFECT" : "NORMAL",
        notes: safeText(r.notes),
        update_smarthome: !!r.update_smarthome,
        sort_no: Number.isFinite(Number(r.sort_no)) ? Number(r.sort_no) : i + 1
      }));

      const insertedText = await sbFetch(url, key, table, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          prefer: "return=representation"
        },
        body: JSON.stringify(payload)
      });

      let inserted = 0;
      try { inserted = JSON.parse(insertedText).length; } catch {}
      return json({ ok: true, inserted });
    }

    return json({ ok: false, error: "Method Not Allowed" }, 405);
  } catch (e) {
    return json({ ok: false, error: e.message }, 500);
  }
};
