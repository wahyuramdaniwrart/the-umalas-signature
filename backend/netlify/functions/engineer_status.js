function json(obj, status=200){
  return new Response(JSON.stringify(obj), {
    status,
    headers:{ "content-type":"application/json", "cache-control":"no-store" }
  });
}

export default async (req) => {
  const cookie = req.headers.get("cookie") || "";
  const unlocked = /(?:^|;\s*)eng=1(?:;|$)/.test(cookie);
  return json({ ok:true, unlocked });
};
