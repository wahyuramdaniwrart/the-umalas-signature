import { mountMode1 } from "./mode1.js";
import { mountMode2 } from "./mode2.js";
import { mountMode3 } from "./mode3.js";
import { mountMode4 } from "./mode4.js";
import { API } from "./config.js";

const dot = document.getElementById("dot");
const engBadge = document.getElementById("engBadge");

const engLoginCard = document.getElementById("engLoginCard");
const engTools = document.getElementById("engTools");

const engPass = document.getElementById("engPass");
const btnEngLogin = document.getElementById("btnEngLogin");
const engMsg = document.getElementById("engMsg");

let engineerUnlocked = false;

function setEngineerUI(unlocked){
  engineerUnlocked = unlocked;

  if (unlocked){
    dot.className = "dot open";      // 🟢
    engLoginCard.classList.add("hidden");
    engTools.classList.remove("hidden");
    switchEngineerTab("mode2");
  } else {
    dot.className = "dot locked";    // 🔴
    engLoginCard.classList.remove("hidden");
    engTools.classList.add("hidden");
  }
}

function switchTab(tab){
  document.querySelectorAll(".tab[data-tab]").forEach(b => b.classList.remove("active"));
  document.querySelectorAll(".section").forEach(s => s.classList.remove("active"));
  document.querySelector(`.tab[data-tab="${tab}"]`)?.classList.add("active");
  document.getElementById(tab)?.classList.add("active");
}

document.querySelectorAll(".tab[data-tab]").forEach(btn => {
  btn.addEventListener("click", () => switchTab(btn.dataset.tab));
});

function switchEngineerTab(which){
  document.querySelectorAll(".tab[data-engtab]").forEach(b => b.classList.remove("active"));
  document.querySelector(`.tab[data-engtab="${which}"]`)?.classList.add("active");

  ["mode2","mode3","mode4"].forEach(m => {
    document.getElementById(`eng_${m}`)?.classList.add("hidden");
  });

  document.getElementById(`eng_${which}`)?.classList.remove("hidden");
}

document.querySelectorAll(".tab[data-engtab]").forEach(btn => {
  btn.addEventListener("click", () => {
    if (engineerUnlocked) switchEngineerTab(btn.dataset.engtab);
  });
});

btnEngLogin.addEventListener("click", async () => {
  engMsg.style.display = "none";

  const password = engPass.value.trim();
  if (!password) return;

  try{
    const res = await fetch(API.engineerLogin, {
      method:"POST",
      headers:{ "content-type":"application/json" },
      body: JSON.stringify({ password })
    });

    const json = await res.json().catch(() => ({}));
    if (!json.ok) throw new Error(json.error || "Password salah");

    setEngineerUI(true);
    switchTab("eng");
  } catch(e){
    engMsg.textContent = "❌ " + (e.message || "Password salah");
    engMsg.style.display = "block";
    setEngineerUI(false);
  }
});

/* ✅ Logout via klik dot hijau */
async function doLogout(){
  try{ await fetch(API.engineerLogout, { method:"POST" }); } catch {}
  engPass.value = "";
  setEngineerUI(false);
  switchTab("m1");
}

engBadge?.addEventListener("click", async () => {
  // hanya logout kalau sedang terbuka (dot hijau)
  if (!engineerUnlocked) return;

  // ✅ langsung logout (tanpa confirm)
  await doLogout();
});

mountMode1(document.getElementById("mode1Mount"));
mountMode2(document.getElementById("mode2Mount"));
mountMode3(document.getElementById("mode3Mount"));
mountMode4(document.getElementById("mode4Mount"));

setEngineerUI(false);
switchTab("m1");
