import { API } from "./config.js";
import { el, setMsg, hide } from "./ui.js";
import { normalizeToken, resolveRoomOrCode } from "./denah.js";

function isNumberLike(x){
  const s = String(x ?? "").trim().replace(",", ".");
  if (!s) return false;
  const n = Number(s);
  return Number.isFinite(n);
}
function normKwh(x){
  return String(x).trim().replace(",", ".");
}

function parseLine(line){
  // dukung:
  // 2111 47.3
  // A215 47.3
  // 2111/A215 47.3
  // 2111 A215 47.3
  const raw = String(line || "").trim();
  if (!raw) return null;

  const parts = raw.replace(/\s*\/\s*/g, " / ").trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return null;

  const last = parts[parts.length - 1];
  if (!isNumberLike(last)) return null;
  const kwh = Number(normKwh(last));

  const idTokens = parts.slice(0, parts.length - 1);

  // format ROOM/KODE
  const joined = idTokens.join(" ").replace(/\s*\/\s*/g, "/").trim();
  if (joined.includes("/")){
    const [roomRaw, codeRaw] = joined.split("/").map(x => x.trim());
    const room = normalizeToken(roomRaw);
    const code = normalizeToken(codeRaw);
    if (!room || !code) return null;
    return { room, code, kwh };
  }

  // format "ROOM KODE"
  if (idTokens.length >= 2){
    const room = normalizeToken(idTokens[0]);
    const code = normalizeToken(idTokens[1]);
    if (room && code) return { room, code, kwh };
  }

  // hanya 1 token => resolve dari denah (room saja / kode saja)
  const one = normalizeToken(idTokens[0]);
  const r = resolveRoomOrCode(one);
  if (!r || r.unknown) return null;

  return { room: r.room, code: r.code, kwh };
}

function fmtDDMMYYYY(yyyy_mm_dd){
  const s = String(yyyy_mm_dd || "").trim();
  if (!s) return "";
  const [y,m,d] = s.split("-");
  if (!y || !m || !d) return s;
  return `${d}/${m}/${y}`;
}

export function mountMode4(mount){
  const root = el(`
    <div>
      <div style="display:flex; gap:10px; align-items:flex-end; flex-wrap:wrap;">
        <div style="min-width:220px;">
          <label>Tanggal</label>
          <input id="date" type="date" />
        </div>

        <div class="row" style="margin:0; flex-wrap:wrap;">
          <button id="btnLoad">Load</button>
          <button class="secondary" id="btnDeleteChecked" disabled>Hapus</button>
          <button class="secondary" id="btnSaveChecked" disabled>Simpan</button>
        </div>
      </div>

      <div id="msg" class="msg" style="display:none; margin-top:10px;"></div>

      <div style="margin-top:12px;">
        <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap;">
          <label style="margin:0;">Data pada tanggal tersebut</label>

          <div class="row" style="margin:0;">
            <button class="secondary" id="btnCheckAll">Centang Semua</button>
            <button class="secondary" id="btnUncheckAll">Lepas Semua</button>
          </div>
        </div>

        <div id="tableWrap" class="tableWrap" style="margin-top:8px;"></div>
      </div>

      <div style="margin-top:14px;">
        <label>Input Data</label>
        <textarea id="inputData"></textarea>

        <div class="row">
          <button class="secondary" id="btnAdd">Tambah Data</button>
          <button class="secondary" id="btnReplace">Replace Semua</button>
          <button class="secondary" id="btnClear">Clear</button>
        </div>
      </div>
    </div>
  `);

  const dateEl = root.querySelector("#date");
  const msg = root.querySelector("#msg");

  const btnLoad = root.querySelector("#btnLoad");
  const btnDeleteChecked = root.querySelector("#btnDeleteChecked");
  const btnSaveChecked = root.querySelector("#btnSaveChecked");

  const btnCheckAll = root.querySelector("#btnCheckAll");
  const btnUncheckAll = root.querySelector("#btnUncheckAll");

  const tableWrap = root.querySelector("#tableWrap");

  const inputData = root.querySelector("#inputData");
  const btnAdd = root.querySelector("#btnAdd");
  const btnReplace = root.querySelector("#btnReplace");
  const btnClear = root.querySelector("#btnClear");

  let currentRows = [];

  function refreshActionButtons(){
    const checkedCount = tableWrap.querySelectorAll('input[type="checkbox"][data-id]:checked').length;
    const hasAny = currentRows.length > 0;

    btnDeleteChecked.disabled = checkedCount === 0;
    btnSaveChecked.disabled = checkedCount === 0;

    btnCheckAll.disabled = !hasAny;
    btnUncheckAll.disabled = !hasAny;
  }

  // ✅ Render tabel dibuat mirip mode 1:
  // - ROOM+KODE jadi 1 kolom teks (bukan input)
  // - WAKTU dipecah 2 baris biar hemat tempat
  // - SISA KWH tetap input kecil buat edit
  function renderTable(rows){
    tableWrap.innerHTML = "";

    const wrap = document.createElement("div");
    wrap.className = "tableFrame";
    wrap.innerHTML = `
      <table>
        <thead>
          <tr>
            <th style="width:40px;">✓</th>
            <th style="width:92px;">WAKTU</th>
            <th style="white-space:nowrap;">ROOM/KODE</th>
            <th style="text-align:right; width:84px; white-space:nowrap;">SISA KWH</th>
          </tr>
        </thead>
        <tbody></tbody>
      </table>
    `;

    const tbody = wrap.querySelector("tbody");

    for (const r of rows){
      const tr = document.createElement("tr");

      // checkbox
      const tdCk = document.createElement("td");
      const ck = document.createElement("input");
      ck.type = "checkbox";
      ck.dataset.id = r.id;
      ck.addEventListener("change", refreshActionButtons);
      tdCk.appendChild(ck);

      // waktu (backend sudah dd/mm/yyyy) — bikin 2 baris biar hemat tempat
      const tdTime = document.createElement("td");
      const rawTime = (r.created_at_local || r.created_at || "").toString().trim();
      tdTime.style.whiteSpace = "normal";
      tdTime.style.lineHeight = "1.15";
      if (rawTime.includes(" ")){
        const i = rawTime.indexOf(" ");
        tdTime.innerHTML = `${rawTime.slice(0, i)}<br>${rawTime.slice(i + 1)}`;
      } else {
        tdTime.textContent = rawTime;
      }

      // room/kode (1 kolom) — tampil seperti mode 1 (tanpa input)
      const tdRoomCode = document.createElement("td");
      const room = (r.room || "").toString().trim();
      const code = (r.code || "").toString().trim();
      tdRoomCode.textContent = room && code ? `${room}/${code}` : (room || code || "");

      // kwh editable (input kecil biar kolomnya kebaca di HP)
      const tdKwh = document.createElement("td");
      tdKwh.style.textAlign = "right";
      const inKwh = document.createElement("input");
      inKwh.type = "text";
      inKwh.value = (r.kwh ?? "").toString();
      inKwh.dataset.id = r.id;
      inKwh.dataset.field = "kwh";
      inKwh.style.textAlign = "right";
      inKwh.style.maxWidth = "84px";
      inKwh.style.width = "84px";
      inKwh.style.padding = "8px 10px";
      tdKwh.appendChild(inKwh);

      tr.appendChild(tdCk);
      tr.appendChild(tdTime);
      tr.appendChild(tdRoomCode);
      tr.appendChild(tdKwh);

      tbody.appendChild(tr);
    }

    tableWrap.appendChild(wrap);
    refreshActionButtons();
  }

  async function loadDate(){
    hide(msg);
    const d = dateEl.value;
    if (!d){
      setMsg(msg, "⚠️ Pilih tanggal dulu.");
      return;
    }

    btnLoad.disabled = true;
    try{
      const res = await fetch(`${API.kwhByDate}?date=${encodeURIComponent(d)}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) throw new Error(json.error || "Gagal load data");

      currentRows = json.rows || [];
      renderTable(currentRows);

      setMsg(msg, `✅ Loaded ${currentRows.length} data untuk tanggal ${fmtDDMMYYYY(d)}`);
    } catch(e){
      setMsg(msg, `❌ ${e.message}`);
    } finally {
      btnLoad.disabled = false;
    }
  }

  function getCheckedIds(){
    return Array.from(tableWrap.querySelectorAll('input[type="checkbox"][data-id]:checked'))
      .map(x => x.dataset.id)
      .filter(Boolean);
  }

  async function deleteChecked(){
    hide(msg);
    const d = dateEl.value;
    if (!d){
      setMsg(msg, "⚠️ Pilih tanggal dulu.");
      return;
    }

    const ids = getCheckedIds();
    if (!ids.length){
      setMsg(msg, "⚠️ Tidak ada yang dicentang.");
      return;
    }

    if (!confirm(`Hapus ${ids.length} data yang dicentang pada tanggal ${fmtDDMMYYYY(d)}?`)) return;

    btnDeleteChecked.disabled = true;
    try{
      const res = await fetch(API.kwhEdit, {
        method:"POST",
        headers:{ "content-type":"application/json" },
        body: JSON.stringify({
          action:"delete_some",
          date:d,
          rows: ids.map(id => ({ id }))
        })
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) throw new Error(json.error || "Delete gagal");

      setMsg(msg, `✅ Deleted ${json.deleted ?? ids.length} baris`);
      await loadDate();
    } catch(e){
      setMsg(msg, `❌ ${e.message}`);
    } finally {
      btnDeleteChecked.disabled = false;
    }
  }

  async function saveCheckedKwh(){
    hide(msg);
    const d = dateEl.value;
    if (!d){
      setMsg(msg, "⚠️ Pilih tanggal dulu.");
      return;
    }

    const ids = getCheckedIds();
    if (!ids.length){
      setMsg(msg, "⚠️ Tidak ada yang dicentang.");
      return;
    }

    const updates = [];
    for (const id of ids){
      const kwhEl = tableWrap.querySelector(`input[data-id="${id}"][data-field="kwh"]`);
      const kwhS = String(kwhEl?.value || "").trim().replace(",", ".");
      if (!isNumberLike(kwhS)){
        setMsg(msg, `❌ KWH invalid pada id ${id}.`);
        return;
      }
      updates.push({ id, kwh: Number(kwhS) });
    }

    btnSaveChecked.disabled = true;
    try{
      const res = await fetch(API.kwhEdit, {
        method:"POST",
        headers:{ "content-type":"application/json" },
        body: JSON.stringify({ action:"update_some", date:d, rows:updates })
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) throw new Error(json.error || "Update gagal");

      setMsg(msg, `✅ Updated ${json.updated ?? updates.length} baris`);
      await loadDate();
    } catch(e){
      setMsg(msg, `❌ ${e.message}`);
    } finally {
      btnSaveChecked.disabled = false;
    }
  }

  function checkAll(val){
    tableWrap.querySelectorAll('input[type="checkbox"][data-id]').forEach(cb => (cb.checked = val));
    refreshActionButtons();
  }

  function parseTextareaRows(){
    const lines = inputData.value.split(/\n+/).map(x => x.trim()).filter(Boolean);
    const rows = [];
    let skipped = 0;

    for (const line of lines){
      const p = parseLine(line);
      if (!p){
        skipped++;
        continue;
      }
      rows.push({ room: p.room, code: p.code, kwh: p.kwh });
    }

    return { rows, skipped, total: lines.length };
  }

  async function addData(){
    hide(msg);
    const d = dateEl.value;
    if (!d){
      setMsg(msg, "⚠️ Pilih tanggal dulu.");
      return;
    }

    const { rows, skipped } = parseTextareaRows();
    if (!rows.length){
      setMsg(msg, "❌ Tidak ada baris valid untuk ditambahkan.");
      return;
    }

    btnAdd.disabled = true;
    try{
      const res = await fetch(API.kwhEdit, {
        method:"POST",
        headers:{ "content-type":"application/json" },
        body: JSON.stringify({ action:"insert_some", date:d, rows })
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) throw new Error(json.error || "Tambah data gagal");

      const note = skipped ? ` (⚠️ ${skipped} baris invalid dilewati)` : "";
      setMsg(msg, `✅ Inserted ${json.inserted ?? rows.length} baris${note}`);
      await loadDate();
    } catch(e){
      setMsg(msg, `❌ ${e.message}`);
    } finally {
      btnAdd.disabled = false;
    }
  }

  async function replaceAll(){
    hide(msg);
    const d = dateEl.value;
    if (!d){
      setMsg(msg, "⚠️ Pilih tanggal dulu.");
      return;
    }

    const { rows, skipped } = parseTextareaRows();

    if (!confirm(`Replace semua data pada tanggal ${fmtDDMMYYYY(d)}?\nAkan HAPUS data lama lalu INSERT data baru.`)) return;

    btnReplace.disabled = true;
    try{
      const res = await fetch(API.kwhEdit, {
        method:"POST",
        headers:{ "content-type":"application/json" },
        body: JSON.stringify({ action:"replace_all", date:d, rows })
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) throw new Error(json.error || "Replace gagal");

      const note = skipped ? ` (⚠️ ${skipped} baris invalid dilewati)` : "";
      setMsg(msg, `✅ Replace OK. Inserted ${json.inserted ?? rows.length}${note}`);
      await loadDate();
    } catch(e){
      setMsg(msg, `❌ ${e.message}`);
    } finally {
      btnReplace.disabled = false;
    }
  }

  // events
  btnLoad.addEventListener("click", loadDate);
  btnDeleteChecked.addEventListener("click", deleteChecked);
  btnSaveChecked.addEventListener("click", saveCheckedKwh);

  btnCheckAll.addEventListener("click", () => checkAll(true));
  btnUncheckAll.addEventListener("click", () => checkAll(false));

  btnAdd.addEventListener("click", addData);
  btnReplace.addEventListener("click", replaceAll);
  btnClear.addEventListener("click", () => (inputData.value = ""));

  mount.innerHTML = "";
  mount.appendChild(root);
}
