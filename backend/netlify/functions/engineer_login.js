function json(obj, status=200, headers={}){
  return new Response(JSON.stringify(obj), {
    status,
    headers:{ "content-type":"application/json", ...headers }
  });
}

function makeCookie({ value, maxAgeSec, secure }){
  const parts = [
    `eng=${value}`,
    `Path=/`,
    `Max-Age=${maxAgeSec}`,
    `HttpOnly`,
    `SameSite=Strict`
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export default async (req) => {
  try {
    if (req.method !== "POST") {
      return json({ ok:false, error:"Method Not Allowed" }, 405);
    }

    const ENV_PASSWORD = (process.env.ENGINEER_PASSWORD || "").trim();
    if (!ENV_PASSWORD) {
      return json({ ok:false, error:"ENGINEER_PASSWORD belum diset di Netlify" }, 500);
    }

    const body = await req.json().catch(() => ({}));
    const inputPassword = String(body.password || "").trim();

    if (!inputPassword) {
      return json({ ok:false, error:"Password kosong" }, 400);
    }

    if (inputPassword !== ENV_PASSWORD) {
      return json({ ok:false, error:"Password salah" }, 401);
    }

    // ✅ sukses → set cookie supaya status engineer bisa persist
    const isSecure = (() => {
      try { return new URL(req.url).protocol === "https:"; } catch { return true; }
    })();

    // default 12 jam
    const cookie = makeCookie({ value: "1", maxAgeSec: 60 * 60 * 1, secure: isSecure });
    return json({ ok:true }, 200, { "set-cookie": cookie });

  } catch (err) {
    return json({ ok:false, error: err?.message || String(err) }, 500);
  }
};
