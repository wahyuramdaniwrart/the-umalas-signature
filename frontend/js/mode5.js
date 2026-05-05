import { API } from "./config.js";
import { el, setMsg, hide } from "./ui.js";
import { normalizeToken, resolveRoomOrCode, codeByRoom } from "./denah.js";
import { getRoomType, getChecklistTemplate } from "./checklistMaster.js";

function escapeHtml(text){
  return String(text || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function mountMode5(mount){
  const root = el(`
    <div>
      <div class="mode5-top">
        <div>
          <label>ROOM / KODE</label>
          <input id="q" type="text" placeholder="Contoh: 2108 atau BG15" />
        </div>
      </div>

      <div class="row">
        <button id="btnLoad">Load Checklist</button>
        <button class="secondary" id="btnClear">Clear</button>
        <button class="secondary" id="btnSave" disabled>Simpan Checklist</button>
      </div>

      <div id="msg" class="msg" style="display:none;"></div>
      <div id="meta" class="outBox" style="display:none;"></div>
      <div id="tableWrap"></div>
    </div>
  `);

  const q = root.querySelector("#q");
  const msg = root.querySelector("#msg");
  const meta = root.querySelector("#meta");
  const tableWrap = root.querySelector("#tableWrap");
  const btnLoad = root.querySelector("#btnLoad");
  const btnClear = root.querySelector("#btnClear");
  const btnSave = root.querySelector("#btnSave");

  let current = null;

  function todayLocal(){
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function reset(){
    current = null;
    tableWrap.innerHTML = "";
    meta.style.display = "none";
    meta.innerHTML = "";
    hide(msg);
    btnSave.disabled = true;
  }

  function renderMeta(data){
    meta.style.display = "block";
    meta.classList.remove("msgText");
    meta.innerHTML = `
      <div class="summary">
        <div class="summaryMain">
          <div class="summaryLabel">CHECKLIST ROOM</div>
          <div class="summaryValue">${escapeHtml(data.room)}/${escapeHtml(data.code)}</div>
        </div>
        <div class="summaryGrid">
          <div><div class="k">Type Room</div><div class="v">${escapeHtml(data.room_type)}</div></div>
          <div><div class="k">Checklist Date</div><div class="v">${escapeHtml(data.checklist_date)}</div></div>
          <div><div class="k">Baris</div><div class="v">${data.rows.length}</div></div>
          <div><div class="k">Default</div><div class="v">${data.is_template ? "Template Excel" : "Data Database"}</div></div>
        </div>
      </div>
    `;
  }

  function renderTable(rows){
    tableWrap.innerHTML = `
      <div class="tableWrap mode5ChecklistWrap">
        <div class="tableFrame checklistTableFrame">
          <table class="checklistTable mode5ChecklistTable">
            <thead>
              <tr>
                <th>No</th>
                <th>Area</th>
                <th>Utility</th>
                <th>Kondisi</th>
                <th>Keterangan</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map((r, i) => `
                <tr>
                  <td>${i + 1}</td>
                  <td>${escapeHtml(r.area)}</td>
                  <td class="utilityCell">${escapeHtml(r.utility)}</td>
                  <td>
                    <select data-index="${i}" data-field="condition">
                      <option value="NORMAL" ${r.condition === "NORMAL" ? "selected" : ""}>NORMAL</option>
                      <option value="DEFECT" ${r.condition === "DEFECT" ? "selected" : ""}>DEFECT</option>
                    </select>
                  </td>
                  <td>
                    <input
                      type="text"
                      data-index="${i}"
                      data-field="notes"
                      value="${escapeHtml(r.notes || "")}" 
                      placeholder="Keterangan..."
                    />
                  </td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      </div>
    `;

    tableWrap.querySelectorAll("select[data-field='condition']").forEach((node) => {
      node.addEventListener("change", () => {
        const index = Number(node.dataset.index);
        current.rows[index].condition = node.value === "DEFECT" ? "DEFECT" : "NORMAL";
      });
    });

    tableWrap.querySelectorAll("input[data-field='notes']").forEach((node) => {
      node.addEventListener("input", () => {
        const index = Number(node.dataset.index);
        current.rows[index].notes = node.value;
      });
    });
  }

  async function loadChecklist(){
    reset();

    const token = normalizeToken(q.value);
    const checklistDate = todayLocal();

    if (!token) {
      setMsg(msg, "⚠️ Isi ROOM / KODE dulu.");
      return;
    }

    const resolved = resolveRoomOrCode(token);
    if (!resolved || resolved.unknown || !resolved.room) {
      setMsg(msg, "⚠️ ROOM / KODE tidak ditemukan di denah.");
      return;
    }

    const room = resolved.room;
    const code = codeByRoom.get(room) || resolved.code || "-";
    const roomType = getRoomType(room) || getRoomType(code);

    if (!roomType) {
      setMsg(msg, `⚠️ Type room untuk ${room}/${code} belum ada di master checklist Excel.`);
      return;
    }

    btnLoad.disabled = true;
    try {
      const res = await fetch(
        `${API.roomChecklist}?room=${encodeURIComponent(room)}&date=${encodeURIComponent(checklistDate)}`
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) throw new Error(json.error || "Gagal load checklist");

      const dbRows = Array.isArray(json.rows) ? json.rows : [];
      const rows = dbRows.length
        ? dbRows.map((r, index) => ({
            sort_no: Number(r.sort_no) || index + 1,
            area: r.area || "",
            utility: r.utility || "",
            condition: String(r.condition || "NORMAL").toUpperCase() === "DEFECT" ? "DEFECT" : "NORMAL",
            notes: r.notes || "",
            update_smarthome: !!r.update_smarthome
          }))
        : getChecklistTemplate(roomType).map((r, index) => ({
            ...r,
            sort_no: index + 1
          }));

      current = {
        room,
        code,
        room_type: roomType,
        checklist_date: checklistDate,
        is_template: dbRows.length === 0,
        rows
      };

      renderMeta(current);
      renderTable(current.rows);
      btnSave.disabled = false;

      setMsg(
        msg,
        dbRows.length
          ? "✅ Data checklist dari database berhasil dimuat."
          : "✅ Template checklist dari Excel berhasil dimuat."
      );
    } catch (e) {
      setMsg(msg, `❌ ${e.message}`);
    } finally {
      btnLoad.disabled = false;
    }
  }

  async function saveChecklist(){
    if (!current) return;

    btnSave.disabled = true;
    const oldText = btnSave.textContent;
    btnSave.textContent = "Menyimpan...";

    try {
      const res = await fetch(API.roomChecklist, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "replace_for_room_date",
          room: current.room,
          code: current.code,
          room_type: current.room_type,
          checklist_date: current.checklist_date,
          rows: current.rows.map((r, index) => ({
            sort_no: index + 1,
            area: r.area,
            utility: r.utility,
            condition: r.condition,
            notes: r.notes,
            update_smarthome: !!r.update_smarthome
          }))
        })
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) throw new Error(json.error || "Gagal simpan checklist");

      current.is_template = false;
      renderMeta(current);
      setMsg(msg, `✅ Checklist berhasil disimpan (${json.inserted || current.rows.length} baris).`);
    } catch (e) {
      setMsg(msg, `❌ ${e.message}`);
    } finally {
      btnSave.textContent = oldText;
      btnSave.disabled = false;
    }
  }

  btnLoad.addEventListener("click", loadChecklist);

  btnClear.addEventListener("click", () => {
    q.value = "";
    reset();
  });

  btnSave.addEventListener("click", saveChecklist);

  q.addEventListener("keydown", (e) => {
    if (e.key === "Enter") loadChecklist();
  });

  mount.innerHTML = "";
  mount.appendChild(root);
}
