function json(obj, status=200, headers={}){
  return new Response(JSON.stringify(obj), { status, headers:{ "content-type":"application/json", ...headers } });
}

export default async (req) => {
  if (req.method !== "POST") return json({ ok:false, error:"Method Not Allowed" }, 405);
  const cookie = "eng=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0";
  return json({ ok:true }, 200, { "set-cookie": cookie });
};
