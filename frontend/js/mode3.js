import { API } from "./config.js";
import { el, setMsg, hide } from "./ui.js";
import { normalizeToken, resolveRoomOrCode } from "./denah.js";

function splitRoomCode(room_code){
  const s = String(room_code || "").trim();
  const norm = s.replace(/\s*\/\s*/g, "/").replace(/\s+/g, " ").trim();

  if (norm.includes("/")){
    const [room, code] = norm.split("/").map(x => x.trim());
    return { room, code };
  }

  const parts = norm.split(" ").filter(Boolean);
  if (parts.length >= 2) return { room: parts[0], code: parts[1] };

  return { room: "", code: "" };
}

function isNumberLike(x){
  if (x === null || x === undefined) return false;
  const s = String(x).trim().replace(",", ".");
  if (!s) return false;
  const n = Number(s);
  return Number.isFinite(n);
}

function normalizeKwh(x){
  return String(x).trim().replace(",", ".");
}

/**
 * Parse 1 baris input:
 * - "2111 47.3"
 * - "A215 47.3"
 * - "2111/A215 47.3"
 * - "2111 A215 47.3"
 */
function parseLineToRow(line){
  const raw = String(line || "").trim();
  if (!raw) return null;

  const parts = raw.replace(/\s*\/\s*/g, " / ").trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return null;

  const last = parts[parts.length - 1];
  if (!isNumberLike(last)) return null;

  const kwh = normalizeKwh(last);
  const idTokens = parts.slice(0, parts.length - 1);

  // CASE A: ada 2+ token sebelum kwh => coba split jadi ROOM/KODE
  if (idTokens.length >= 2){
    const firstPart = idTokens.join(" "); // "2111 / A215" atau "2111 A215"
    const { room, code } = splitRoomCode(firstPart);

    if (room && code){
      return {
        room: normalizeToken(room),
        code: normalizeToken(code),
        kwh
      };
    }

    // fallback: token pertama saja => resolve denah
    const one = normalizeToken(idTokens[0]);
    const r = resolveRoomOrCode(one);
    if (r && !r.unknown && r.room && r.code){
      return { room: normalizeToken(r.room), code: normalizeToken(r.code), kwh };
    }
    return null;
  }

  // CASE B: hanya 1 token sebelum kwh => resolve dari denah
  const one = normalizeToken(idTokens[0]);
  const r = resolveRoomOrCode(one);
  if (!r || r.unknown || !r.room || !r.code) return null;

  return {
    room: normalizeToken(r.room),
    code: normalizeToken(r.code),
    kwh
  };
}

export function mountMode3(mount){
  const root = el(`
    <div>
      <label>DATA / ROOM/KODE + KWH</label>
      <textarea id="data"></textarea>

      <div class="row">
        <button id="btnBuild">Buat Tabel</button>
        <button class="secondary" id="btnClear">Clear</button>
        <button class="secondary" id="btnSave" disabled>Simpan Online</button>
        <button class="secondary" id="btnExport" disabled>Export PNG</button>
      </div>

      <div id="msg" class="msg" style="display:none;"></div>
      <div id="tbl" style="margin-top:12px;"></div>
    </div>
  `);

  const ta = root.querySelector("#data");
  const msg = root.querySelector("#msg");
  const tbl = root.querySelector("#tbl");

  const btnBuild  = root.querySelector("#btnBuild");
  const btnSave   = root.querySelector("#btnSave");
  const btnExport = root.querySelector("#btnExport");
  const btnClear  = root.querySelector("#btnClear");

  let savingOnline = false;
  let currentRows = []; // sumber data untuk simpan/export (tidak bergantung ui.js)

  function renderTable(rows){
    // tabel dibuat mirip Mode 1
    tbl.innerHTML = `
      <div class="tableWrap">
        <div class="tableFrame" id="mode3Frame">
          <table>
            <thead>
              <tr>
                <th>ROOM/KODE</th>
                <th class="right">SISA KWH</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map(r => `
                <tr>
                  <td>${r.room_code}</td>
                  <td class="right">${r.kwh}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  // =========================
  // BUILD TABEL
  // =========================
  btnBuild.onclick = () => {
    hide(msg);
    tbl.innerHTML = "";
    currentRows = [];

    const lines = ta.value.split(/\n+/).map(l => l.trim()).filter(Boolean);
    if (!lines.length){
      setMsg(msg, "⚠️ Masukkan data dulu.");
      btnSave.disabled = true;
      btnExport.disabled = true;
      return;
    }

    const rows = [];
    let skipped = 0;

    for (const line of lines){
      const parsed = parseLineToRow(line);
      if (!parsed){
        skipped++;
        continue;
      }

      rows.push({
        room_code: `${parsed.room}/${parsed.code}`,
        kwh: String(parsed.kwh)
      });
    }

    if (!rows.length){
      setMsg(msg, "❌ Format data salah. Gunakan: ROOM KWH / KODE KWH / ROOM-KODE KWH");
      btnSave.disabled = true;
      btnExport.disabled = true;
      return;
    }

    currentRows = rows;
    renderTable(currentRows);

    btnSave.disabled = false;
    btnExport.disabled = false;

    const note = skipped ? ` (⚠️ ${skipped} baris dilewati karena format tidak valid / tidak ada di denah)` : "";
    setMsg(msg, `✅ ${rows.length} data siap diproses${note}`);
  };

  // =========================
  // SIMPAN ONLINE (ANTI DOUBLE CLICK)
  // =========================
  btnSave.onclick = async () => {
    if (savingOnline) return;
    savingOnline = true;

    const oldText = btnSave.textContent;
    btnSave.disabled = true;
    btnSave.textContent = "Menyimpan...";

    try{
      const rows = currentRows.map(r => {
        const { room, code } = splitRoomCode(r.room_code);
        return {
          room: normalizeToken(room),
          code: normalizeToken(code),
          kwh: Number(String(r.kwh).replace(",", "."))
        };
      }).filter(r => r.room && r.code && Number.isFinite(r.kwh));

      if (!rows.length) throw new Error("Data tabel kosong / format salah");

      const res = await fetch(API.kwhInsert, {
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        body: JSON.stringify({ rows })
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) throw new Error(json.error || "Gagal simpan");

      setMsg(msg, `✅ Data berhasil disimpan online (${json.inserted ?? rows.length} baris)`);
    } catch(e){
      setMsg(msg, `❌ Gagal simpan: ${e.message}`);
    } finally {
      btnSave.disabled = false;
      btnSave.textContent = oldText;
      savingOnline = false;
    }
  };

  // =========================
  // EXPORT PNG (pakai html2canvas)
  // =========================
  btnExport.onclick = async () => {
    try{
      btnExport.disabled = true;

      const frame = root.querySelector("#mode3Frame");
      if (!frame) throw new Error("Tabel belum dibuat.");

      const oldMaxHeight = frame.style.maxHeight;
      const oldOverflow = frame.style.overflow;

      frame.classList.add("export-compact");
      frame.style.maxHeight = "none";
      frame.style.overflow = "visible";

      if (typeof html2canvas !== "function"){
        throw new Error("html2canvas belum dimuat. Pastikan script html2canvas ada di index.html");
      }

      const canvas = await html2canvas(frame, { backgroundColor: null, scale: 2 });

      const a = document.createElement("a");
      a.download = "tabel_kwh.png";
      a.href = canvas.toDataURL("image/png");
      a.click();

      frame.classList.remove("export-compact");
      frame.style.maxHeight = oldMaxHeight;
      frame.style.overflow = oldOverflow;
    } catch(e){
      setMsg(msg, `❌ Export gagal: ${e.message}`);
    } finally {
      btnExport.disabled = false;
    }
  };

  // =========================
  // CLEAR
  // =========================
  btnClear.onclick = () => {
    ta.value = "";
    hide(msg);
    tbl.innerHTML = "";
    currentRows = [];
    btnSave.disabled = true;
    btnExport.disabled = true;
  };

  mount.innerHTML = "";
  mount.appendChild(root);
}
