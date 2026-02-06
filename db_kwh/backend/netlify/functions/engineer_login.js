exports.handler = async (event) => {
  try {
    // hanya izinkan POST
    if (event.httpMethod !== "POST") {
      return {
        statusCode: 405,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ok: false, error: "Method not allowed" }),
      };
    }

    const ENV_PASSWORD = (process.env.ENGINEER_PASSWORD || "").trim();
    if (!ENV_PASSWORD) {
      return {
        statusCode: 500,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ok: false,
          error: "ENGINEER_PASSWORD belum diset di Netlify"
        }),
      };
    }

    let body = {};
    try {
      body = JSON.parse(event.body || "{}");
    } catch {}

    const inputPassword = String(body.password || "").trim();

    if (!inputPassword) {
      return {
        statusCode: 400,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ok: false, error: "Password kosong" }),
      };
    }

    if (inputPassword !== ENV_PASSWORD) {
      return {
        statusCode: 401,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ok: false, error: "Password salah" }),
      };
    }

    // ✅ BERHASIL
    return {
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ok: true }),
    };

  } catch (err) {
    return {
      statusCode: 500,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ok: false, error: err.message }),
    };
  }
};
