function json(obj, status=200){
  return new Response(JSON.stringify(obj), { status, headers:{ "content-type":"application/json" } });
}

export default async (req) => {
  const cookie = req.headers.get("cookie") || "";
  const unlocked = cookie.includes("eng=1");
  return json({ ok:true, unlocked });
};
