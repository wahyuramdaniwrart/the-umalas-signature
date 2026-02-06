import { el, setMsg, hide } from "./ui.js";
import { normalizeToken, resolveRoomOrCode, sortByDenah } from "./denah.js";

/* ================= CSV PARSER (simple, supports quotes) ================= */
function parseCSV(text){
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  text = String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  for (let i = 0; i < text.length; i++){
    const ch = text[i];
    const next = text[i + 1];

    if (ch === '"'){
      if (inQuotes && next === '"'){
        cell += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === "," && !inQuotes){
      row.push(cell);
      cell = "";
      continue;
    }

    if (ch === "\n" && !inQuotes){
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }

    cell += ch;
  }

  row.push(cell);
  if (row.length > 1 || (row.length === 1 && row[0].trim() !== "")){
    rows.push(row);
  }

  return rows;
}

/* ========== find column index by header text (scan first 10 rows) ========== */
function findColumnIndexByHeader(rows, headerName){
  const normHeader = String(headerName || "").trim().toLowerCase();
  const maxScan = Math.min(rows.length, 10);

  for (let i = 0; i < maxScan; i++){
    const r = rows[i];
    if (!r || !r.length) continue;

    for (let j = 0; j < r.length; j++){
      const cell = String(r[j] ?? "").trim().toLowerCase();

      // fleksibel: "Room Number", "ROOM NUMBER", "RoomNumber"
      const cellNoSpace = cell.replace(/\s+/g, "");
      const headerNoSpace = normHeader.replace(/\s+/g, "");

      if (cell === normHeader || cellNoSpace === headerNoSpace){
        return j;
      }
    }
  }

  return -1;
}

/* ========== extract rooms from CSV using header "Room Number" ========== */
function extractRoomsFromCSV(csvText){
  const rows = parseCSV(csvText);

  let colIndex = findColumnIndexByHeader(rows, "Room Number");
  if (colIndex < 0){
    // fallback lama: kolom D (index 3) supaya masih kompatibel
    colIndex = 3;
  }

  const tokens = [];

  for (let i = 0; i < rows.length; i++){
    const r = rows[i];
    if (!r || r.length <= colIndex) continue;

    const raw = String(r[colIndex] ?? "").trim();
    if (!raw) continue;

    // skip header kalau kebawa
    if (/room\s*number/i.test(raw)) continue;

    const token = normalizeToken(raw);

    // hanya A-Z0-9 (buang simbol aneh)
    if (!/^[A-Z0-9]+$/.test(token)) continue;

    // ✅ buang yang tidak punya angka (RP, OWNER, BAR, RO, LGSTAY, dll)
    // tapi tetap izinkan kemungkinan kode baru yang ada angka
    if (!/\d/.test(token)) continue;

    tokens.push(token);
  }

  // dedup
  const seen = new Set();
  const uniq = [];
  for (const t of tokens){
    if (!t || seen.has(t)) continue;
    seen.add(t);
    uniq.push(t);
  }

  return { tokens: uniq, colIndex };
}

/* ========== textarea helpers ========== */
function tokensFromTextarea(text){
  return (text || "")
    .replaceAll("/", " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(normalizeToken)
    .filter(Boolean);
}

function mergeToTextarea(textareaEl, newTokens){
  const existing = tokensFromTextarea(textareaEl.value);
  const all = [...existing, ...(newTokens || [])];

  const seen = new Set();
  const merged = [];
  for (const x of all){
    if (!x || seen.has(x)) continue;
    seen.add(x);
    merged.push(x);
  }

  textareaEl.value = merged.join("\n");
}

/* ================= MODE 2 ================= */
export function mountMode2(mount){
  const root = el(`
    <div>
      <label>ROOM / KODE</label>

      <input
        id="csv"
        type="file"
        accept=".csv,text/csv"
        style="margin:6px 0 10px; width:100%;"
      />

      <textarea id="input" placeholder="Bisa paste manual atau upload CSV..."></textarea>

      <div class="row">
        <button id="go">Urutkan</button>
        <button class="secondary" id="clr">Clear</button>
        <button class="secondary" id="copy">Copy</button>
      </div>

      <div id="out" class="msg" style="display:none;"></div>
    </div>
  `);

  const input = root.querySelector("#input");
  const fileEl = root.querySelector("#csv");
  const out = root.querySelector("#out");

  /* ===== AUTO IMPORT SAAT FILE DIPILIH ===== */
  fileEl.addEventListener("change", async () => {
    hide(out);

    const file = fileEl.files && fileEl.files[0];
    if (!file) return;

    try{
      const text = await file.text();

      const { tokens, colIndex } = extractRoomsFromCSV(text);

      if (!tokens.length){
        setMsg(out, "⚠️ Tidak menemukan data valid di kolom 'Room Number' (atau fallback kolom D).");
        return;
      }

      mergeToTextarea(input, tokens);
      setMsg(out, `✅ ${tokens.length} data dari CSV ditambahkan. (kolom: ${colIndex + 1})`);
    } catch(e){
      setMsg(out, `❌ Gagal baca CSV: ${e.message}`);
    }
  });

  function doSort(){
    hide(out);

    const tokens = tokensFromTextarea(input.value);
    if (!tokens.length){
      setMsg(out, "⚠️ Masukkan data dulu atau upload CSV.");
      return;
    }

    // resolve semua token (yang tidak ada di denah akan jadi unknown)
    const items = tokens.map(t => resolveRoomOrCode(t));

    const sorted = sortByDenah(items);

    const ok = sorted.filter(x => !x.unknown);
    const missing = sorted.filter(x => x.unknown);

    let text = ok.map(x => `${x.room} / ${x.code}`).join("\n");

    // tampilkan missing (tapi yg missing ini sudah pasti ada angka, karena filter input)
    if (missing.length){
      const uniqMissing = [...new Set(missing.map(x => x.room))];
      text += `\n\n⚠️ ROOM/KODE TIDAK ADA DI DENAH:\n`;
      text += uniqMissing.map(x => `- ${x}`).join("\n");
    }

    setMsg(out, text || "⚠️ Tidak ada hasil.");
  }

  root.querySelector("#go").addEventListener("click", doSort);

  root.querySelector("#clr").addEventListener("click", () => {
    input.value = "";
    fileEl.value = "";
    hide(out);
  });

  root.querySelector("#copy").addEventListener("click", async () => {
    try{
      await navigator.clipboard.writeText(out.textContent || "");
      // tidak perlu pesan tambahan biar simpel
    } catch {}
  });

  mount.innerHTML = "";
  mount.appendChild(root);
}
