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

    // kalau lengkap ROOM & KODE → pakai yang diketik
    if (room && code) return { room, code, kwh };

    // kalau salah satu kosong, fallback resolve token yang ada
    const t = room || code;
    const resolved = resolveRoomOrCode(t);
    if (!resolved || resolved.unknown || !resolved.room || !resolved.code || resolved.code === "-") return null;
    return { room: resolved.room, code: resolved.code, kwh };
  }

  // kalau cuma 1 token, bisa room atau kode → harus ada di denah
  if (idTokens.length === 1){
    const t = normalizeToken(idTokens[0]);
    const resolved = resolveRoomOrCode(t);
    if (!resolved || resolved.unknown || !resolved.room || !resolved.code || resolved.code === "-") return null;
    return { room: resolved.room, code: resolved.code, kwh };
  }

  // kalau 2 token: ROOM KODE → pakai persis (normalize saja)
  const room = normalizeToken(idTokens[0]);
  const code = normalizeToken(idTokens[1]);
  if (!room || !code) return null;
  return { room, code, kwh };
}

function parseText(text){
  const lines = String(text || "").split("\n");
  const rows = [];
  let skipped = 0;

  for (const ln of lines){
    const raw = String(ln || "").trim();
    if (!raw) continue;

    const p = parseLine(raw);
    if (p) rows.push(p);
    else skipped++;
  }

  return { rows, skipped };
}

export function mountMode4(mount){
  const root = el(`
    <div class="mode4">
      <div style="display:flex; gap:10px; align-items:flex-end; flex-wrap:wrap;">
        <div style="min-width:220px;">
          <label>Tanggal</label>
          <input id="date" type="date" />
        </div>

        <div class="row" style="margin:0; flex-wrap:wrap;">
          <button id="btnLoad">Load</button>
          <button class="secondary" id="btnClearLoad">Clear</button>
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

        <div class="row mode4-actions" style="margin-top:10px; justify-content:flex-end; flex-wrap:wrap;">
          <button class="secondary" id="btnDeleteChecked" disabled>Hapus</button>
          <button class="secondary" id="btnSaveChecked" disabled>Simpan</button>
        </div>
      </div>

      <div style="margin-top:14px;">
        <label>Input Data</label>
        <textarea id="inputData"></textarea>

        <div class="row">
          <button id="btnAdd">Add</button>
          <button class="secondary" id="btnReplace">Replace Semua</button>
          <button class="secondary" id="btnClear">Clear</button>
        </div>
      </div>
    </div>
  `);

  const dateEl = root.querySelector("#date");
  const msg = root.querySelector("#msg");

  const btnLoad = root.querySelector("#btnLoad");
  const btnClearLoad = root.querySelector("#btnClearLoad");
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

  function clearLoaded(){
    currentRows = [];
    tableWrap.innerHTML = "";
    hide(msg);
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
      setMsg(msg, `✅ Loaded ${currentRows.length} data untuk tanggal ${json.date_label || d}`);
    } catch (e){
      setMsg(msg, `❌ ${e.message || "Gagal load data"}`);
      currentRows = [];
      tableWrap.innerHTML = "";
    } finally {
      btnLoad.disabled = false;
      refreshActionButtons();
    }
  }

  function getCheckedIds(){
    const ids = [];
    tableWrap.querySelectorAll('input[type="checkbox"][data-id]:checked').forEach(x => ids.push(x.dataset.id));
    return ids;
  }

  async function deleteChecked(){
    hide(msg);
    const d = dateEl.value;
    if (!d){
      setMsg(msg, "⚠️ Pilih tanggal dulu.");
      return;
    }
    const ids = getCheckedIds();
    if (ids.length === 0) return;

    btnDeleteChecked.disabled = true;
    try{
      const res = await fetch(API.kwhEdit, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ date: d, action: "delete_some", rows: ids.map(id => ({ id })) })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) throw new Error(json.error || "Gagal hapus");

      currentRows = currentRows.filter(r => !ids.includes(String(r.id)));
      renderTable(currentRows);
      setMsg(msg, `✅ Hapus ${json.deleted ?? ids.length} data.`);
    } catch (e){
      setMsg(msg, `❌ ${e.message || "Gagal hapus"}`);
    } finally {
      refreshActionButtons();
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
    if (ids.length === 0) return;

    // ambil nilai input per id
    const patches = [];
    for (const id of ids){
      const input = tableWrap.querySelector(`input[type="text"][data-id="${CSS.escape(id)}"]`);
      if (!input) continue;
      const val = input.value.trim();
      if (!isNumberLike(val)) continue;
      patches.push({ id, kwh: Number(normKwh(val)) });
    }

    if (patches.length === 0){
      setMsg(msg, "⚠️ Tidak ada nilai KWH valid untuk disimpan.");
      refreshActionButtons();
      return;
    }

    btnSaveChecked.disabled = true;
    try{
      const res = await fetch(API.kwhEdit, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ date: d, action: "update_some", rows: patches })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) throw new Error(json.error || "Gagal simpan");

      // update currentRows local biar tetap konsisten
      const map = new Map(patches.map(p => [String(p.id), p.kwh]));
      currentRows = currentRows.map(r => map.has(String(r.id)) ? { ...r, kwh: map.get(String(r.id)) } : r);

      setMsg(msg, `✅ Simpan ${json.updated ?? patches.length} data.`);
    } catch (e){
      setMsg(msg, `❌ ${e.message || "Gagal simpan"}`);
    } finally {
      refreshActionButtons();
    }
  }

  function checkAll(flag){
    tableWrap.querySelectorAll('input[type="checkbox"][data-id]').forEach(ck => {
      ck.checked = !!flag;
    });
    refreshActionButtons();
  }

  async function addData(){
    hide(msg);
    const d = dateEl.value;
    if (!d){
      setMsg(msg, "⚠️ Pilih tanggal dulu.");
      return;
    }

    const { rows, skipped } = parseText(inputData.value);
    if (rows.length === 0){
      setMsg(msg, "⚠️ Tidak ada data valid untuk ditambahkan.");
      return;
    }

    btnAdd.disabled = true;
    try{
      const res = await fetch(API.kwhEdit, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ date: d, action: "insert_some", rows })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) throw new Error(json.error || "Gagal add");

      const inserted = json.inserted ?? rows.length;
      const note = skipped ? ` (⚠️ ${skipped} baris dilewati)` : "";
      setMsg(msg, `✅ Add ${inserted} data.${note}`);
      inputData.value = "";
      await loadDate();
    } catch (e){
      setMsg(msg, `❌ ${e.message || "Gagal add"}`);
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

    const { rows, skipped } = parseText(inputData.value);
    if (rows.length === 0){
      setMsg(msg, "⚠️ Tidak ada data valid untuk replace.");
      return;
    }

    btnReplace.disabled = true;
    try{
      const res = await fetch(API.kwhEdit, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ date: d, action: "replace_all", rows })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) throw new Error(json.error || "Gagal replace");

      const inserted = json.inserted ?? rows.length;
      const note = skipped ? ` (⚠️ ${skipped} baris dilewati)` : "";
      setMsg(msg, `✅ Replace tanggal ${d} (${inserted} data).${note}`);
      inputData.value = "";
      await loadDate();
    } catch (e){
      setMsg(msg, `❌ ${e.message || "Gagal replace"}`);
    } finally {
      btnReplace.disabled = false;
    }
  }

  // init default date = today (local)
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  dateEl.value = `${yyyy}-${mm}-${dd}`;

  btnLoad.addEventListener("click", loadDate);
  btnClearLoad.addEventListener("click", clearLoaded);
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
