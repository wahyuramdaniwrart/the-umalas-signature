export function el(html){
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export function setMsg(node, text){
  node.style.display = "block";
  node.textContent = text;
}

export function hide(node){
  node.style.display = "none";
  node.textContent = "";
}

export function makeTable(container, columns){
  const wrap = document.createElement("div");
  wrap.className = "tableWrap";
  wrap.innerHTML = `
    <div class="tableFrame">
      <table>
        <thead><tr></tr></thead>
        <tbody></tbody>
      </table>
    </div>
  `;

  const tableEl = wrap.querySelector("table");
  const theadRow = wrap.querySelector("thead tr");
  const tbody = wrap.querySelector("tbody");

  columns.forEach(col => {
    const th = document.createElement("th");
    th.textContent = col.label;
    if (col.alignRight) th.style.textAlign = "right";
    theadRow.appendChild(th);
  });

  container.innerHTML = "";
  container.appendChild(wrap);

  return {
    wrap,
    frame: wrap.querySelector(".tableFrame"),
    tbody,
    setRows(rows){
      tbody.innerHTML = "";
      for (const r of rows){
        const tr = document.createElement("tr");
        for (const col of columns){
          const td = document.createElement("td");
          td.textContent = r[col.key] ?? "";
          if (col.alignRight) td.style.textAlign = "right";
          tr.appendChild(td);
        }
        tbody.appendChild(tr);
      }
    },
    // ✅ tambahan: supaya tidak error kalau ada code yang butuh getRows()
    getRows(){
      const rows = [];
      for (const tr of tbody.querySelectorAll("tr")){
        const tds = tr.querySelectorAll("td");
        const obj = {};
        columns.forEach((col, i) => {
          obj[col.key] = (tds[i]?.textContent ?? "").trim();
        });
        rows.push(obj);
      }
      return rows;
    },
    clear(){
      tbody.innerHTML = "";
    }
  };
}
