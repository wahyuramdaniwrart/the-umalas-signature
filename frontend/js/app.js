import { mountMode1 } from "./mode1.js";
import { mountMode2 } from "./mode2.js";
import { mountMode3 } from "./mode3.js";
import { mountMode4 } from "./mode4.js";
import { mountMode5 } from "./mode5.js";
import { API } from "./config.js";

const dot = document.getElementById("dot");
const engBadge = document.getElementById("engBadge");

const engLoginCard = document.getElementById("engLoginCard");
const engTools = document.getElementById("engTools");

const engPass = document.getElementById("engPass");
const btnEngLogin = document.getElementById("btnEngLogin");
const engMsg = document.getElementById("engMsg");

engPass.addEventListener("keydown", (e) => {
  if (e.key === "Enter") btnEngLogin.click();
});

let engineerUnlocked = false;

function setEngineerUI(unlocked, { autoOpenEngineerTab = false } = {}){
  engineerUnlocked = !!unlocked;
  engBadge?.classList.remove("hidden");

  if (engineerUnlocked){
    engBadge.title = "Engineer (klik untuk logout)";
    dot.className = "dot open";
    engLoginCard.classList.add("hidden");
    engTools.classList.remove("hidden");
    switchEngineerTab("mode2");
    if (autoOpenEngineerTab) switchTab("eng");
  } else {
    engBadge.title = "Engineer (klik untuk login)";
    dot.className = "dot locked";
    engLoginCard.classList.remove("hidden");
    engTools.classList.add("hidden");
    if (autoOpenEngineerTab) switchTab("eng");
  }
}

function switchTab(tab){
  document.querySelectorAll(".tab[data-tab]").forEach((b) => b.classList.remove("active"));
  document.querySelectorAll(".section").forEach((s) => s.classList.remove("active"));
  document.querySelector(`.tab[data-tab="${tab}"]`)?.classList.add("active");
  document.getElementById(tab)?.classList.add("active");
}

document.querySelectorAll(".tab[data-tab]").forEach((btn) => {
  btn.addEventListener("click", () => switchTab(btn.dataset.tab));
});

function switchEngineerTab(which){
  document.querySelectorAll(".tab[data-engtab]").forEach((b) => b.classList.remove("active"));
  document.querySelector(`.tab[data-engtab="${which}"]`)?.classList.add("active");

  ["mode2", "mode3", "mode4", "mode5"].forEach((m) => {
    document.getElementById(`eng_${m}`)?.classList.add("hidden");
  });

  document.getElementById(`eng_${which}`)?.classList.remove("hidden");
}

document.querySelectorAll(".tab[data-engtab]").forEach((btn) => {
  btn.addEventListener("click", () => {
    if (engineerUnlocked) switchEngineerTab(btn.dataset.engtab);
  });
});

btnEngLogin.addEventListener("click", async () => {
  engMsg.style.display = "none";
  const password = engPass.value.trim();
  if (!password) return;

  try {
    const res = await fetch(API.engineerLogin, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password })
    });

    const json = await res.json().catch(() => ({}));
    if (!json.ok) throw new Error(json.error || "Password salah");
    setEngineerUI(true, { autoOpenEngineerTab: true });
  } catch (e) {
    engMsg.textContent = "❌ " + (e.message || "Password salah");
    engMsg.style.display = "block";
    setEngineerUI(false);
  }
});

async function doLogout(){
  try { await fetch(API.engineerLogout, { method: "POST" }); } catch {}
  engPass.value = "";
  setEngineerUI(false);
  switchTab("m1");
}

engBadge?.addEventListener("click", async () => {
  if (!engineerUnlocked){
    switchTab("eng");
    setTimeout(() => engPass?.focus(), 0);
    return;
  }
  await doLogout();
});

async function initEngineerStatus(){
  try {
    const res = await fetch(API.engineerStatus, { method: "GET" });
    const json = await res.json().catch(() => ({}));
    if (json && json.ok){
      setEngineerUI(!!json.unlocked);
      return;
    }
  } catch {}
  setEngineerUI(false);
}

mountMode1(document.getElementById("mode1Mount"));
mountMode2(document.getElementById("mode2Mount"));
mountMode3(document.getElementById("mode3Mount"));
mountMode4(document.getElementById("mode4Mount"));
mountMode5(document.getElementById("mode5Mount"));

initEngineerStatus();
switchTab("m1");
