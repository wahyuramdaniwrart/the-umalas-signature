import { API } from "./config.js";
import { el, setMsg, hide, makeTable } from "./ui.js";
import {
  normalizeToken,
  resolveRoomOrCode,
  orderMapRoom,
  codeByRoom,
  meterByRoom,
  lokasiAtsByRoom,
  getPosisiDetailByIndex
} from "./denah.js";

export function mountMode1(mount){
  const root = el(`
    <div>
      <label>ROOM / KODE (optional)</label>
      <input id="q" type="text" />

      <label>Tanggal (optional)</label>
      <input id="date" type="date" />

      <div class="row">
        <button id="btn">Cari</button>
        <button class="secondary" id="clr">Clear</button>
        <button class="secondary" id="dl" disabled style="display:none;">
          Download PNG
        </button>
      </div>

      <div id="out" class="msg" style="display:none;"></div>
      <div id="tbl"></div>
    </div>
  `);

  const q = root.querySelector("#q");
  const date = root.querySelector("#date");
  const out = root.querySelector("#out");
  const tbl = root.querySelector("#tbl");
  const btnDL = root.querySelector("#dl");

  const table = makeTable(tbl, [
    { key:"created_at", label:"WAKTU" },
    { key:"room_code", label:"ROOM/KODE" },
    { key:"kwh", label:"SISA KWH", alignRight:true },
  ]);

  function resetDownload(){
    btnDL.disabled = true;
    btnDL.style.display = "none";
  }

  // ===== DOWNLOAD PNG (hanya saat mode tanggal) =====
  btnDL.addEventListener("click", async () => {
    btnDL.disabled = true;
    btnDL.textContent = "Downloading...";

    const frame = table.frame;
    const oldMaxHeight = frame.style.maxHeight;
    const oldOverflow = frame.style.overflow;

    frame.classList.add("export-compact");
    frame.style.maxHeight = "none";
    frame.style.overflow = "visible";

    try{
      const canvas = await html2canvas(frame, {
        backgroundColor: null,
        scale: 2
      });
      const link = document.createElement("a");
      link.download = `kwh_${date.value || "data"}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
    } finally {
      frame.classList.remove("export-compact");
      frame.style.maxHeight = oldMaxHeight;
      frame.style.overflow = oldOverflow;

      btnDL.textContent = "Download PNG";
      btnDL.disabled = false;
    }
  });

  async function search(){
    hide(out);
    table.setRows([]);
    resetDownload();

    const token = normalizeToken(q.value);
    const d = date.value;

    // ===============================
    // KASUS: HANYA TANGGAL
    // ===============================
    if (!token && d){
      try{
        const res = await fetch(`${API.kwhByDate}?date=${encodeURIComponent(d)}`);
        const json = await res.json().catch(() => ({}));

        if (!res.ok || !json.ok){
          setMsg(out, `❌ Gagal load data tanggal: ${json.error || "unknown"}`);
          return;
        }

        const rows = (json.rows || []).map(x => ({
          created_at: x.created_at_local,
          room_code: `${x.room}/${x.code}`,
          kwh: String(x.kwh),
        }));

        if (!rows.length){
          setMsg(out, `⚠️ Tidak ada data pada tanggal ${d}`);
          return;
        }

        table.setRows(rows);
        setMsg(out, `✅ Menampilkan ${rows.length} data pada tanggal ${d}`);

        btnDL.style.display = "inline-block";
        btnDL.disabled = false;

      } catch(e){
        setMsg(out, `❌ Error: ${e.message}`);
      }
      return;
    }

    // ===============================
    // KASUS: ROOM/KODE
    // ===============================
    if (!token && !d){
      setMsg(out, "⚠️ Isi ROOM/KODE atau pilih tanggal.");
      return;
    }

    // resolve room/code dari input
    const r = resolveRoomOrCode(token);
    const idx = r && !r.unknown ? orderMapRoom.get(r.room) : undefined;

    const posisi = (idx !== undefined) ? getPosisiDetailByIndex(idx) : "-";
    const kodeDariDenah = (idx !== undefined) ? (codeByRoom.get(r.room) ?? r.code ?? "-") : (r.code ?? "-");

    const noMeteran = (idx !== undefined) ? (meterByRoom.get(r.room) ?? "-") : "-";
    const lokasiAts = (idx !== undefined) ? (lokasiAtsByRoom.get(r.room) ?? "-") : "-";

    // ambil data terakhir dari DB (pakai last10, ambil baris pertama)
    try{
      const res = await fetch(
        `${API.kwhLast10}?q=${encodeURIComponent(token)}&date=${encodeURIComponent(d||"")}`
      );
      const json = await res.json().catch(() => ({}));

      if (!res.ok || !json.ok){
        setMsg(out, `❌ Gagal ambil data online: ${json.error || "unknown"}`);
        return;
      }

      const rows = (json.rows || []);

      const last = rows[0];
      const lastKwh = last ? String(last.kwh) : "-";

      // OUTPUT RINGKAS (Mode 1)
      const roomCodeText = `${r.room}/${kodeDariDenah}`;
      let text = "";
      text += `ROOM : ${roomCodeText}\n`;
      text += `No Meteran : ${noMeteran}\n`;
      text += `Posisi : ${posisi}\n`;
      text += `ATS : ${lokasiAts}\n`;
      text += `Last KWH : ${lastKwh}`;
      setMsg(out, text);

      // tampilkan tabel 10 data terakhir
      const tableRows = rows.map(x => ({
        created_at: x.created_at_local,
        room_code: `${x.room}/${x.code}`,
        kwh: String(x.kwh),
      }));
      table.setRows(tableRows);

      if (!rows.length){
        setMsg(out, text + `\n\n❌ Belum ada data online untuk ${token}`);
      }

    } catch(e){
      setMsg(out, `❌ Error online: ${e.message}`);
    }
  }

  root.querySelector("#btn").addEventListener("click", search);

  root.querySelector("#clr").addEventListener("click", () => {
    q.value = "";
    date.value = "";
    hide(out);
    table.setRows([]);
    resetDownload();
  });

  mount.innerHTML = "";
  mount.appendChild(root);
}
