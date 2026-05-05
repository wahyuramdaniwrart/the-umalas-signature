function json(obj, status=200, headers={}){
  return new Response(JSON.stringify(obj), { status, headers:{ "content-type":"application/json", ...headers } });
}

export default async (req) => {
  if (req.method !== "POST") return json({ ok:false, error:"Method Not Allowed" }, 405);
  const isSecure = (() => {
    try { return new URL(req.url).protocol === "https:"; } catch { return true; }
  })();

  const parts = [
    "eng=",
    "Path=/",
    "Max-Age=0",
    "HttpOnly",
    "SameSite=Strict"
  ];
  if (isSecure) parts.push("Secure");

  const cookie = parts.join("; ");
  return json({ ok:true }, 200, { "set-cookie": cookie, "cache-control":"no-store" });
};
