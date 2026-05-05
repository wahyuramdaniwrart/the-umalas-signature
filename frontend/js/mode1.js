import { API } from "./config.js";
import { el, makeTable } from "./ui.js";
import {
  normalizeToken,
  resolveRoomOrCode,
  orderMapRoom,
  codeByRoom,
  meterByRoom,
  lokasiAtsByRoom,
  getPosisiDetailByIndex
} from "./denah.js";
import { getRoomType, getChecklistTemplate } from "./checklistMaster.js";

function escapeHtml(text){
  return String(text || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

window.salinNomor = function(angka, tombol) {
  navigator.clipboard.writeText(angka).then(function() {
    let tulisanAsli = tombol.innerText;
    tombol.innerText = "Tersalin!";
    
    setTimeout(function() {
      tombol.innerText = tulisanAsli;
    }, 2000);
  }).catch(function(error) {
    console.error("Gagal menyalin: ", error);
    alert("Maaf, gagal menyalin nomor meteran.");
  });
};

function normalizeChecklistRows(rows){
  return (rows || []).map((r) => ({
    area: r.area || "",
    utility: r.utility || "",
    condition: String(r.condition || "NORMAL").toUpperCase() === "DEFECT" ? "DEFECT" : "NORMAL",
    notes: r.notes || ""
  }));
}

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
        <button class="secondary" id="dl" disabled style="display:none;">Download PNG</button>
      </div>

      <div id="out" class="outBox" style="display:none;"></div>
      <div id="tbl"></div>
    </div>
  `);

  const q = root.querySelector("#q");
  const date = root.querySelector("#date");
  const out = root.querySelector("#out");
  const tbl = root.querySelector("#tbl");
  const btnDL = root.querySelector("#dl");

  q.placeholder = "Contoh: 2108 atau BG15 atau 2108/BG15";
  q.addEventListener("keydown", (e) => {
    if (e.key === "Enter") search();
  });

  const table = makeTable(tbl, [
    { key: "created_at", label: "WAKTU" },
    { key: "room_code", label: "ROOM/KODE" },
    { key: "kwh", label: "SISA KWH", alignRight: true }
  ]);

  function setOutText(text){
    out.style.display = "block";
    out.classList.add("msgText");
    out.innerHTML = "";
    out.textContent = text;
  }

  function setOutHTML(html){
    out.style.display = "block";
    out.classList.remove("msgText");
    out.innerHTML = html;
  }

  function clearOut(){
    out.innerHTML = "";
    out.style.display = "none";
    out.classList.remove("msgText");
  }

  function resetDownload(){
    btnDL.disabled = true;
    btnDL.style.display = "none";
  }

  btnDL.addEventListener("click", async () => {
    btnDL.disabled = true;
    btnDL.textContent = "Downloading...";

    const frame = table.frame;
    const oldMaxHeight = frame.style.maxHeight;
    const oldOverflow = frame.style.overflow;

    frame.classList.add("export-compact");
    frame.style.maxHeight = "none";
    frame.style.overflow = "visible";

    try {
      const canvas = await html2canvas(frame, { backgroundColor: null, scale: 2 });
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

  function renderChecklistRows(rows){
    return rows.map((r) => `
      <tr>
        <td>${escapeHtml(r.area)}</td>
        <td class="utilityCell">${escapeHtml(r.utility)}</td>
        <td>
          <span class="checklistBadge ${String(r.condition).toUpperCase() === "DEFECT" ? "bad" : "good"}">
            ${escapeHtml(r.condition || "NORMAL")}
          </span>
        </td>
        <td>${escapeHtml(r.notes || "-")}</td>
      </tr>
    `).join("");
  }

  async function appendChecklistSummary(room, code){
    const roomType = getRoomType(room) || getRoomType(code) || "-";

    try {
      const res = await fetch(`${API.roomChecklist}?room=${encodeURIComponent(room)}&latest=1`);
      const json = await res.json().catch(() => ({}));
      const dbRows = res.ok && json.ok && Array.isArray(json.rows) ? normalizeChecklistRows(json.rows) : [];

      let rows = dbRows;
      let checklistDate = json.checklist_date || "-";
      let sourceText = "Template default Excel";

      if (dbRows.length) {
        sourceText = "Checklist terakhir database";
      } else {
        rows = normalizeChecklistRows(getChecklistTemplate(roomType));
        checklistDate = "Belum ada simpanan";
      }

      if (!rows.length) return;

      const hasDefect = rows.some((r) => String(r.condition || "").toUpperCase() === "DEFECT");
      const statusLabel = hasDefect ? "DEFECT" : "NORMAL";
      const statusClass = hasDefect ? "bad" : "good";

      out.insertAdjacentHTML("beforeend", `
        <div class="checklistSummaryBox">
          <div class="checklistSummaryHead compactHead">
            <div class="checklistTitleBlock">
              <div class="summaryLabel">Checklist Room Terakhir</div>
              <div class="summaryValue checklistDateValue">${escapeHtml(checklistDate)}</div>
              <div class="checklistSourceText">${escapeHtml(sourceText)}</div>
            </div>
            <div class="checklistStatRow compactStatRow">
              <span class="checklistPill ${statusClass}">${statusLabel}</span>
            </div>
          </div>

          <div class="tableWrap mode1ChecklistWrap">
            <div class="tableFrame checklistTableFrame">
              <table class="checklistTable compactChecklist mode1ChecklistTable">
                <thead>
                  <tr>
                    <th>Area</th>
                    <th>Utility</th>
                    <th>Kondisi</th>
                    <th>Keterangan</th>
                  </tr>
                </thead>
                <tbody>
                  ${renderChecklistRows(rows)}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      `);
    } catch {
      const rows = normalizeChecklistRows(getChecklistTemplate(roomType));
      if (!rows.length) return;

      const hasDefect = rows.some((r) => String(r.condition || "").toUpperCase() === "DEFECT");
      const statusLabel = hasDefect ? "DEFECT" : "NORMAL";
      const statusClass = hasDefect ? "bad" : "good";

      out.insertAdjacentHTML("beforeend", `
        <div class="checklistSummaryBox">
          <div class="checklistSummaryHead compactHead">
            <div class="checklistTitleBlock">
              <div class="summaryLabel">Checklist Room Terakhir</div>
              <div class="summaryValue checklistDateValue">Belum ada simpanan</div>
              <div class="checklistSourceText">Template default Excel</div>
            </div>
            <div class="checklistStatRow compactStatRow">
              <span class="checklistPill ${statusClass}">${statusLabel}</span>
            </div>
          </div>

          <div class="tableWrap mode1ChecklistWrap">
            <div class="tableFrame checklistTableFrame">
              <table class="checklistTable compactChecklist mode1ChecklistTable">
                <thead>
                  <tr>
                    <th>Area</th>
                    <th>Utility</th>
                    <th>Kondisi</th>
                    <th>Keterangan</th>
                  </tr>
                </thead>
                <tbody>
                  ${renderChecklistRows(rows)}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      `);
    }
  }

  function renderSummary({ roomCodeText, roomType, noMeteran, posisi, lokasiAts, lastKwh }){
    setOutHTML(`
      <div class="summary summaryMode1">
        <div class="summaryMode1Grid">
          <div>
            <div class="k">ROOM</div>
            <div class="v roomMain">${escapeHtml(roomCodeText)}</div>
          </div>
          <div>
          <div class="k">No Meteran</div>
          <div class="v">
            <span>${escapeHtml(noMeteran)}</span>
            <button onclick="salinNomor('${escapeHtml(noMeteran)}', this)" style="margin-left: 10px;">Copy</button>
          </div>
        </div>

          <div>
            <div class="k">Type Room</div>
            <div class="v">${escapeHtml(roomType)}</div>
          </div>
          <div>
            <div class="k">ATS</div>
            <div class="v">${escapeHtml(lokasiAts)}</div>
          </div>

          <div>
            <div class="k">Posisi</div>
            <div class="v">${escapeHtml(posisi)}</div>
          </div>
          <div>
            <div class="k">Last KWH</div>
            <div class="v big">${escapeHtml(lastKwh)}</div>
          </div>
        </div>
      </div>
    `);
  }

  async function search(){
    clearOut();
    table.setRows([]);
    resetDownload();

    const token = normalizeToken(q.value);
    const d = date.value;

    if (!token && d){
      try {
        const res = await fetch(`${API.kwhByDate}?date=${encodeURIComponent(d)}`);
        const json = await res.json().catch(() => ({}));

        if (!res.ok || !json.ok){
          setOutText(`❌ Gagal load data tanggal: ${json.error || "unknown"}`);
          return;
        }

        const rows = (json.rows || []).map((x) => ({
          created_at: x.created_at_local,
          room_code: `${x.room}/${x.code}`,
          kwh: String(x.kwh)
        }));

        if (!rows.length){
          setOutText(`⚠️ Tidak ada data pada tanggal ${d}`);
          return;
        }

        table.setRows(rows);
        setOutText(`✅ Menampilkan ${rows.length} data pada tanggal ${d}`);
        btnDL.style.display = "inline-block";
        btnDL.disabled = false;
      } catch (e) {
        setOutText(`❌ Error: ${e.message}`);
      }
      return;
    }

    if (!token && !d){
      setOutText("⚠️ Isi ROOM/KODE atau pilih tanggal.");
      return;
    }

    const resolved = resolveRoomOrCode(token);
    if (!resolved || resolved.unknown || !resolved.room){
      setOutText("⚠️ ROOM/KODE tidak ditemukan di denah.");
      return;
    }

    const idx = orderMapRoom.get(resolved.room);
    const posisi = idx !== undefined ? getPosisiDetailByIndex(idx) : "-";
    const kodeDariDenah = codeByRoom.get(resolved.room) ?? resolved.code ?? "-";
    const noMeteran = meterByRoom.get(resolved.room) ?? "-";
    const lokasiAts = lokasiAtsByRoom.get(resolved.room) ?? "-";
    const roomType = getRoomType(resolved.room) || getRoomType(kodeDariDenah) || "-";

    let rows = [];
    let onlineError = "";

    try {
      const res = await fetch(`${API.kwhLast10}?q=${encodeURIComponent(resolved.room)}&date=${encodeURIComponent(d || "")}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) throw new Error(json.error || "unknown");
      rows = Array.isArray(json.rows) ? json.rows : [];
    } catch (e) {
      onlineError = e.message || "unknown";
    }

    const last = rows[0];
    const lastKwh = last ? String(last.kwh) : "-";

    renderSummary({
      roomCodeText: `${resolved.room}/${kodeDariDenah}`,
      roomType,
      noMeteran,
      posisi,
      lokasiAts,
      lastKwh
    });

    table.setRows(rows.map((x) => ({
      created_at: x.created_at_local,
      room_code: `${x.room}/${x.code}`,
      kwh: String(x.kwh)
    })));

    if (onlineError){
      out.insertAdjacentHTML(
        "beforeend",
        `<div style="margin-top:10px; opacity:.9">❌ Gagal ambil data online: ${escapeHtml(onlineError)}</div>`
      );
    } else if (!rows.length){
      out.insertAdjacentHTML(
        "beforeend",
        `<div style="margin-top:10px; opacity:.9">❌ Belum ada data online untuk ${escapeHtml(token)}</div>`
      );
    }

    await appendChecklistSummary(resolved.room, kodeDariDenah);
  }

  root.querySelector("#btn").addEventListener("click", search);

  root.querySelector("#clr").addEventListener("click", () => {
    q.value = "";
    date.value = "";
    clearOut();
    table.setRows([]);
    resetDownload();
  });

  mount.innerHTML = "";
  mount.appendChild(root);
}