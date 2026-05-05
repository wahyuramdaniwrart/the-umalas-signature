function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" }
  });
}

export default async () => {
  try {
    const url = process.env.SUPABASE_URL || "";
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
    const table = process.env.SUPABASE_TABLE || "kwh_log";

    if (!url || !key) {
      return json({ ok: false, error: "Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY" }, 500);
    }

    // cutoff = 31 hari yang lalu
    const cutoff = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();

    // REST delete: delete rows where created_at < cutoff
    const delUrl =
      `${url}/rest/v1/${table}?created_at=lt.${encodeURIComponent(cutoff)}`;

    const res = await fetch(delUrl, {
      method: "DELETE",
      headers: {
        apikey: key,
        authorization: `Bearer ${key}`,
        prefer: "return=minimal"
      }
    });

    const text = await res.text(); // biasanya kosong kalau sukses
    if (!res.ok) {
      return json({ ok: false, error: text || `HTTP ${res.status}` }, 400);
    }

    return json({ ok: true, cutoff });
  } catch (e) {
    return json({ ok: false, error: e.message }, 500);
  }
};
