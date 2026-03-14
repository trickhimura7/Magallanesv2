// ============================================================
//  app.js — Magallanes Funeral Services v2
// ============================================================

"use strict";

// ── UTILITIES ─────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const $$ = sel => [...document.querySelectorAll(sel)];

function fmtMoney(n) {
  const v = Number(n) || 0;
  return "₱" + v.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtNum(n) {
  const v = Number(n) || 0;
  return v.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtDate(d) {
  if (!d) return "—";
  const dt = new Date(d + "T00:00:00");
  return dt.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
}
function todayStr() {
  return new Date().toISOString().slice(0, 10);
}
function monthKey(dateStr) {
  if (!dateStr) return "";
  return dateStr.slice(0, 7);
}
function monthLabel(key) {
  if (!key) return "";
  const [y, m] = key.split("-");
  return new Date(y, m - 1).toLocaleDateString("en-PH", { month: "long", year: "numeric" });
}

let _toastTimer = null;
function toast(msg, type = "info") {
  const el = $("toast");
  el.textContent = msg;
  el.className = "toast " + type;
  el.style.display = "block";
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => { el.style.display = "none"; }, 3200);
}

// ── MODAL ─────────────────────────────────────────────────────
const Modal = {
  open(title, bodyHtml, footerHtml = "", wide = false) {
    $("modalTitle").textContent = title;
    $("modalBody").innerHTML = bodyHtml;
    $("modalFooter").innerHTML = footerHtml;
    $("modalBox").className = "modal-box" + (wide ? " wide" : "");
    $("modal").style.display = "flex";
  },
  close() { $("modal").style.display = "none"; },
  body()  { return $("modalBody"); },
};
$("modalClose").addEventListener("click", Modal.close);
$("modal").addEventListener("click", e => { if (e.target === $("modal")) Modal.close(); });

// ── APP STATE ─────────────────────────────────────────────────
window.APP = {
  currentPage:    "dashboard",
  currentBranchId: null,
  currentBranch:  null,
  userProfile:    null,
  branches:       [],
  // Loaded data per branch
  contracts:      [],
  cashReceived:   [],
  cashExpense:    [],
  bankReceived:   [],
  bankExpense:    [],
  pnbDeposit:     [],
  dswd:           [],
  bai:            [],
  settings:       null,
};

// ── COMPUTED HELPERS ──────────────────────────────────────────
function computeContract(c, baiStore, dswdStore) {
  const totalPaid  = (Number(c.inhaus)||0) + (Number(c.bai)||0) + (Number(c.gl)||0)
                   + (Number(c.gcash)||0) + (Number(c.cash)||0);
  const discount   = Number(c.discount) || 0;

  // Find linked BAI
  const baiRec  = baiStore.filter(b => b.contract_no === c.contract_no && b.status === "Collected");
  const baiAmt  = baiRec.reduce((s, b) => s + (Number(b.amount)||0), 0);

  // Find linked DSWD
  const dswdRec      = dswdStore.filter(d => d.contract_no === c.contract_no);
  const dswdAfterTax = dswdRec.reduce((s, d) => s + (Number(d.after_tax)||0), 0);
  const dswdDiscount = dswdRec.reduce((s, d) => s + (Number(d.dswd_discount)||0), 0);

  const remaining = (Number(c.amount)||0) - totalPaid - discount - baiAmt - dswdAfterTax - dswdDiscount;
  return { totalPaid, discount, baiAmt, dswdAfterTax, dswdDiscount, remaining };
}

function contractStatus(remaining, lastPayment) {
  if (remaining <= 0.005) return "paid";
  if (!lastPayment || lastPayment === "—") return "active";
  const lp = new Date(lastPayment);
  const days = (Date.now() - lp) / 86400000;
  return days > 60 ? "overdue" : "active";
}

function computeCashBalance() {
  const open = Number(APP.settings?.cash_balance) || 0;
  const inc  = APP.cashReceived.reduce((s, r) => s + (Number(r.amount)||0), 0);
  const exp  = APP.cashExpense.reduce((s, r)  => s + (Number(r.amount)||0), 0);
  const dep  = APP.pnbDeposit.reduce((s, r)   => s + (Number(r.amount)||0), 0);
  return open + inc - exp - dep;
}

function computeBankBalance() {
  const open = Number(APP.settings?.bank_balance) || 0;
  const inc  = APP.bankReceived.reduce((s, r) => s + (Number(r.amount)||0), 0);
  const exp  = APP.bankExpense.reduce((s, r)  => s + (Number(r.withdraw)||0), 0);
  const dep  = APP.pnbDeposit.reduce((s, r)   => s + (Number(r.amount)||0), 0);
  return open + inc - exp + dep;
}

// ── LOAD ALL DATA FOR CURRENT BRANCH ──────────────────────────
async function loadBranchData() {
  const bid = APP.currentBranchId;
  if (!bid) return;
  showPageLoader(true);
  try {
    const [contracts, cr, ce, br, be, pnb, dswd, bai, settings] = await Promise.all([
      DB.getContracts(bid),     DB.getCashReceived(bid),
      DB.getCashExpense(bid),   DB.getBankReceived(bid),
      DB.getBankExpense(bid),   DB.getPnbDeposit(bid),
      DB.getDswd(bid),          DB.getBai(bid),
      DB.getSettings(bid),
    ]);
    APP.contracts    = contracts;
    APP.cashReceived = cr;
    APP.cashExpense  = ce;
    APP.bankReceived = br;
    APP.bankExpense  = be;
    APP.pnbDeposit   = pnb;
    APP.dswd         = dswd;
    APP.bai          = bai;
    APP.settings     = settings;
    renderCurrentPage();
    updateBalanceDisplays();
  } catch(e) {
    toast("Error loading data: " + e.message, "error");
  } finally {
    showPageLoader(false);
  }
}

function showPageLoader(on) {
  // Simple opacity toggle on page content
  $("pageTitle").style.opacity = on ? ".5" : "1";
}

function updateBalanceDisplays() {
  const cash = computeCashBalance();
  const bank = computeBankBalance();
  const cashEl = $("cashBalanceDisplay"); if(cashEl) cashEl.textContent = fmtMoney(cash);
  const bankEl = $("bankBalanceDisplay"); if(bankEl) bankEl.textContent = fmtMoney(bank);
}

function renderCurrentPage() {
  switch(APP.currentPage) {
    case "dashboard":     renderDashboard();    break;
    case "contracts":     renderContracts();    break;
    case "cash-received": renderCashReceived(); break;
    case "cash-expense":  renderCashExpense();  break;
    case "bank-received": renderBankReceived(); break;
    case "bank-expense":  renderBankExpense();  break;
    case "pnb-deposit":   renderPnbDeposit();   break;
    case "dswd":          renderDswd();         break;
    case "bai":           renderBai();          break;
    case "branches":      renderBranches();     break;
    case "users":         renderUsers();        break;
  }
}

// ── AUTH + BOOT ────────────────────────────────────────────────
async function boot() {
  const session = await Auth.getSession();
  if (session) {
    await onLogin();
  } else {
    showLogin();
  }
  Auth.onAuthChange(async s => {
    if (s) await onLogin();
    else showLogin();
  });
}

function showLogin() {
  $("loginOverlay").style.display = "flex";
  $("appShell").style.display = "none";
}

async function onLogin() {
  $("loginOverlay").style.display = "none";
  $("appShell").style.display = "flex";

  const user    = await Auth.getUser();
  const profile = await DB.getMyProfile();
  APP.userProfile = profile;

  // UI
  $("userName").textContent  = profile?.full_name || user?.email || "User";
  $("userRole").textContent  = profile?.role || "clerk";
  $("userAvatar").textContent = (profile?.full_name || user?.email || "?")[0].toUpperCase();

  // Apply role class to body
  document.body.className = "role-" + (profile?.role || "clerk");

  // Load branches
  APP.branches = await DB.getBranches();
  populateBranchSelect();

  // Set starting branch
  const savedBranch = localStorage.getItem("mf_branch_v2");
  const firstBranch = APP.branches.find(b => b.id === savedBranch)
                   || (profile?.branch_id ? APP.branches.find(b => b.id === profile.branch_id) : null)
                   || APP.branches[0];
  if (firstBranch) {
    APP.currentBranchId = firstBranch.id;
    APP.currentBranch   = firstBranch;
    $("branchSelect").value = firstBranch.id;
  }

  // Date display
  $("dateDisplay").textContent = new Date().toLocaleDateString("en-PH", { weekday:"short", month:"long", day:"numeric", year:"numeric" });

  await loadBranchData();
  navigateTo("dashboard");
  populateReportDropdowns();
}

function populateBranchSelect() {
  const sel = $("branchSelect");
  sel.innerHTML = "";
  const profile = APP.userProfile;
  const branches = profile?.role === "admin"
    ? APP.branches
    : APP.branches.filter(b => b.id === profile?.branch_id);
  branches.forEach(b => {
    const o = document.createElement("option");
    o.value = b.id; o.textContent = b.name;
    sel.appendChild(o);
  });
  // Hide branch selector for non-admins with only 1 branch
  $("branchSelectorWrap").style.display = branches.length <= 1 ? "none" : "";
}

$("branchSelect").addEventListener("change", async () => {
  const id = $("branchSelect").value;
  APP.currentBranchId = id;
  APP.currentBranch   = APP.branches.find(b => b.id === id);
  localStorage.setItem("mf_branch_v2", id);
  await loadBranchData();
});

// Login form
$("btnLogin").addEventListener("click", doLogin);
$("loginPassword").addEventListener("keydown", e => { if(e.key==="Enter") doLogin(); });
$("loginEmail").addEventListener("keydown",    e => { if(e.key==="Enter") $("loginPassword").focus(); });

async function doLogin() {
  const email    = $("loginEmail").value.trim();
  const password = $("loginPassword").value;
  if (!email || !password) { showLoginErr("Please enter your email and password."); return; }
  hideLoginErr();
  $("btnLogin").disabled = true;
  $("loginSpinner").style.display = "block";
  const { error } = await Auth.signIn(email, password);
  $("btnLogin").disabled = false;
  $("loginSpinner").style.display = "none";
  if (error) { showLoginErr(error.message); }
}
function showLoginErr(m) { const el=$("loginError"); el.textContent=m; el.style.display="block"; }
function hideLoginErr()  { $("loginError").style.display="none"; }

$("btnSignOut").addEventListener("click", async () => {
  await Auth.signOut();
  showLogin();
});

// ── NAVIGATION ─────────────────────────────────────────────────
function navigateTo(page) {
  APP.currentPage = page;
  $$(".page").forEach(p => p.classList.remove("active"));
  $$(".nav-item").forEach(n => n.classList.remove("active"));
  const pageEl = $("page-" + page.replace("/",""));
  if (pageEl) pageEl.classList.add("active");
  const navEl = document.querySelector(`.nav-item[data-page="${page}"]`);
  if (navEl) navEl.classList.add("active");

  const titles = {
    "dashboard":"Dashboard","contracts":"Contracts",
    "cash-received":"Cash Received","cash-expense":"Cash Expense",
    "bank-received":"Bank Received","bank-expense":"Bank Expense",
    "pnb-deposit":"PNB Deposit","dswd":"DSWD","bai":"BAI",
    "reports":"Reports","branches":"Branches","users":"Users & Audit",
    "migrate":"Import / Migrate","settings":"Settings",
  };
  $("pageTitle").textContent = titles[page] || page;

  // Mobile: close sidebar
  $("sidebar").classList.remove("mobile-open");

  renderCurrentPage();
  updateBalanceDisplays();
  localStorage.setItem("mf_page_v2", page);
}

$$(".nav-item").forEach(n => {
  n.addEventListener("click", () => navigateTo(n.dataset.page));
});

// Sidebar toggle (desktop collapse)
$("sidebarToggle").addEventListener("click", () => {
  $("sidebar").classList.toggle("collapsed");
});
$("mobileSidebarToggle").addEventListener("click", () => {
  $("sidebar").classList.toggle("mobile-open");
});

// ── DASHBOARD ──────────────────────────────────────────────────
function renderDashboard() {
  const cashBal = computeCashBalance();
  const bankBal = computeBankBalance();

  // Overdue contracts
  const overdueContracts = APP.contracts.filter(c => {
    const comp = computeContract(c, APP.bai, APP.dswd);
    return comp.remaining > 0.005 && contractStatus(comp.remaining, c.last_payment) === "overdue";
  });

  // Pending DSWD
  const pendingDswd = APP.dswd.filter(d => d.status === "Waiting").reduce((s,d)=>s+(Number(d.dswd_refund)||0),0);
  // Pending BAI
  const pendingBai  = APP.bai.filter(b => b.status === "Pending").reduce((s,b)=>s+(Number(b.amount)||0),0);

  const cards = [
    { label:"Cash Balance",       value: fmtMoney(cashBal), cls:"accent", sub:`Opening: ${fmtMoney(APP.settings?.cash_balance||0)}` },
    { label:"Bank Balance",       value: fmtMoney(bankBal), cls:"accent", sub:`Opening: ${fmtMoney(APP.settings?.bank_balance||0)}` },
    { label:"Total Contracts",    value: APP.contracts.length, cls:"", sub:"this branch" },
    { label:"Overdue Balances",   value: overdueContracts.length, cls: overdueContracts.length?"danger":"", sub:"60+ days" },
    { label:"Pending DSWD",       value: fmtMoney(pendingDswd), cls:"", sub:"waiting for government" },
    { label:"Uncollected BAI",    value: fmtMoney(pendingBai),  cls:"", sub:"applied but not collected" },
  ];

  $("summaryCards").innerHTML = cards.map(c => `
    <div class="summary-card ${c.cls}">
      <div class="sc-label">${c.label}</div>
      <div class="sc-value">${c.value}</div>
      <div class="sc-sub">${c.sub}</div>
    </div>`).join("");

  // Recent transactions (last 8 from all sources combined)
  const all = [
    ...APP.cashReceived.map(r=>({date:r.date,label:r.client||r.particular||"Cash received",amt:r.amount,type:"cash-in"})),
    ...APP.cashExpense.map(r=>({date:r.date,label:r.particular||"Cash expense",amt:r.amount,type:"cash-out"})),
    ...APP.bankReceived.map(r=>({date:r.date,label:r.client||"Bank received",amt:r.amount,type:"bank-in"})),
    ...APP.bankExpense.map(r=>({date:r.date,label:r.particular||"Bank expense",amt:r.withdraw,type:"bank-out"})),
  ].sort((a,b)=> b.date?.localeCompare(a.date||"")).slice(0,8);

  $("recentTxList").innerHTML = all.length ? all.map(r => `
    <div class="recent-tx-item">
      <div>
        <div class="rtx-label">${r.label||"—"}</div>
        <div class="rtx-sub">${fmtDate(r.date)} · ${r.type}</div>
      </div>
      <div class="rtx-amt" style="color:${r.type.endsWith("in")?"var(--success)":"var(--danger)"}">
        ${r.type.endsWith("in")?"+":"−"}${fmtMoney(r.amt)}
      </div>
    </div>`).join("") : `<div style="color:var(--text-3);font-size:13px;padding:12px">No transactions yet.</div>`;

  // Overdue list
  $("overdueCount").textContent = overdueContracts.length;
  $("overdueList").innerHTML = overdueContracts.length ? `
    <div class="table-wrap" style="margin-top:8px">
      <table class="data-table">
        <thead><tr><th>Contract #</th><th>Deceased</th><th class="num">Remaining</th><th>Last Payment</th></tr></thead>
        <tbody>${overdueContracts.map(c=>{
          const comp = computeContract(c, APP.bai, APP.dswd);
          return `<tr><td>${c.contract_no||"—"}</td><td>${c.deceased||"—"}</td>
            <td class="num" style="color:var(--danger)">${fmtMoney(comp.remaining)}</td>
            <td>${c.last_payment||"—"}</td></tr>`;
        }).join("")}</tbody>
      </table>
    </div>` : `<div style="color:var(--text-3);font-size:13px;padding:8px 0">No overdue balances.</div>`;

  // Balance chart
  buildBalanceChart();
}

let _balanceChart = null;
function buildBalanceChart() {
  const canvas = $("balanceChart");
  if (!canvas) return;
  if (_balanceChart) { _balanceChart.destroy(); _balanceChart = null; }

  const now   = new Date();
  const year  = now.getFullYear();
  const month = now.getMonth();
  const days  = new Date(year, month+1, 0).getDate();
  const labels = Array.from({length:days}, (_,i)=> i+1);

  const openCash = Number(APP.settings?.cash_balance) || 0;
  let running = openCash;
  const data = labels.map(d => {
    const dateStr = `${year}-${String(month+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
    const inc = APP.cashReceived.filter(r=>r.date===dateStr).reduce((s,r)=>s+(Number(r.amount)||0),0);
    const exp = APP.cashExpense.filter(r=>r.date===dateStr).reduce((s,r)=>s+(Number(r.amount)||0),0);
    const dep = APP.pnbDeposit.filter(r=>r.date===dateStr).reduce((s,r)=>s+(Number(r.amount)||0),0);
    running += inc - exp - dep;
    return running;
  });

  _balanceChart = new Chart(canvas, {
    type:"line",
    data: {
      labels,
      datasets:[{
        label:"Cash Balance",
        data,
        borderColor:"#1a2332",
        backgroundColor:"rgba(26,35,50,.07)",
        tension:.3, fill:true, pointRadius:2,
      }]
    },
    options:{
      responsive:true, maintainAspectRatio:true,
      plugins:{ legend:{ display:false }, tooltip:{
        callbacks:{ label: ctx => fmtMoney(ctx.raw) }
      }},
      scales:{
        x:{ grid:{display:false}, ticks:{ font:{size:11}, maxTicksLimit:10 } },
        y:{ grid:{color:"rgba(0,0,0,.05)"}, ticks:{
          callback: v => "₱"+Number(v).toLocaleString(), font:{size:11}
        }}
      }
    }
  });
}

// ── GENERIC TABLE BUILDER ──────────────────────────────────────
function buildTable(tbodyId, rows, colsFn, emptyMsg = "No records.") {
  const tb = $(tbodyId);
  if (!tb) return;
  if (!rows.length) {
    tb.innerHTML = `<tr><td colspan="99" style="text-align:center;color:var(--text-3);padding:20px">${emptyMsg}</td></tr>`;
    return;
  }
  tb.innerHTML = rows.map(colsFn).join("");
}

function actionBtns(id, editFn, deleteFn) {
  return `<td class="action-col">
    <button class="btn btn-sm btn-secondary" onclick="${editFn}('${id}')">Edit</button>
    <button class="btn btn-sm btn-danger" style="margin-top:3px" onclick="${deleteFn}('${id}')">Del</button>
  </td>`;
}

function canEdit() {
  return ["admin","manager","clerk"].includes(APP.userProfile?.role);
}

// ── CONTRACTS ─────────────────────────────────────────────────
function renderContracts() {
  const search  = ($("contractSearch")?.value||"").toLowerCase();
  const mFilter = $("contractMonthFilter")?.value || "";
  const sFilter = $("contractStatusFilter")?.value || "";

  // Populate month filter
  const months = [...new Set(APP.contracts.map(c=>monthKey(c.date)).filter(Boolean))].sort();
  const mSel   = $("contractMonthFilter");
  if (mSel && mSel.options.length <= 1) {
    months.forEach(m => { const o=document.createElement("option"); o.value=m; o.textContent=monthLabel(m); mSel.appendChild(o); });
  }

  let rows = APP.contracts.slice();
  if (search) rows = rows.filter(c =>
    (c.contract_no||"").toLowerCase().includes(search) ||
    (c.deceased||"").toLowerCase().includes(search) ||
    (c.casket||"").toLowerCase().includes(search) ||
    (c.address||"").toLowerCase().includes(search)
  );
  if (mFilter) rows = rows.filter(c => monthKey(c.date) === mFilter);
  if (sFilter) rows = rows.filter(c => {
    const comp = computeContract(c, APP.bai, APP.dswd);
    return contractStatus(comp.remaining, c.last_payment) === sFilter;
  });

  rows.sort((a,b) => (a.date||"").localeCompare(b.date||"") || (a.contract_no||"").localeCompare(b.contract_no||""));
  $("contractRowCount").textContent = rows.length + " record" + (rows.length!==1?"s":"");

  const tb = $("contractsTbody");
  if (!rows.length) {
    tb.innerHTML = `<tr><td colspan="19" style="text-align:center;color:var(--text-3);padding:20px">No records.</td></tr>`;
    return;
  }

  // Group by month
  const grouped = {};
  rows.forEach(c => {
    const k = monthKey(c.date) || "Unknown";
    if (!grouped[k]) grouped[k] = [];
    grouped[k].push(c);
  });

  let html = "";
  let grand = { amount:0, gcash:0, cash:0, dswdAfterTax:0, dswdDiscount:0, baiAmt:0, discount:0, totalPaid:0, remaining:0 };

  Object.keys(grouped).sort().forEach(key => {
    const gRows = grouped[key];
    html += `<tr class="group-row"><td colspan="19">${monthLabel(key)} — ${gRows.length} contract${gRows.length!==1?"s":""}</td></tr>`;
    let tot = { amount:0, gcash:0, cash:0, dswdAfterTax:0, dswdDiscount:0, baiAmt:0, discount:0, totalPaid:0, remaining:0 };

    gRows.forEach(c => {
      const comp   = computeContract(c, APP.bai, APP.dswd);
      const status = contractStatus(comp.remaining, c.last_payment);
      const badge  = status==="paid"?'<span class="badge badge-paid">Paid</span>'
                   : status==="overdue"?'<span class="badge badge-overdue">Overdue</span>'
                   : '<span class="badge badge-active">Active</span>';
      tot.amount      += Number(c.amount)||0;
      tot.gcash       += Number(c.gcash)||0;
      tot.cash        += Number(c.cash)||0;
      tot.dswdAfterTax+= comp.dswdAfterTax;
      tot.dswdDiscount+= comp.dswdDiscount;
      tot.baiAmt      += comp.baiAmt;
      tot.discount    += comp.discount;
      tot.totalPaid   += comp.totalPaid;
      tot.remaining   += comp.remaining;

      const rem = comp.remaining.toFixed(2);
      html += `<tr>
        <td>${fmtDate(c.date)}</td>
        <td><strong>${c.contract_no||"—"}</strong></td>
        <td>${c.deceased||"—"}</td>
        <td>${c.casket||"—"}</td>
        <td>${c.address||"—"}</td>
        <td class="num">${fmtNum(c.amount)}</td>
        <td class="num">${fmtNum(c.inhaus)}</td>
        <td class="num">${fmtNum(c.gcash)}</td>
        <td class="num">${fmtNum(c.cash)}</td>
        <td class="num">${fmtNum(c.gl)}</td>
        <td class="num">${fmtNum(comp.dswdAfterTax)}</td>
        <td class="num">${fmtNum(comp.dswdDiscount)}</td>
        <td class="num">${fmtNum(comp.baiAmt)}</td>
        <td class="num">${fmtNum(c.discount)}</td>
        <td class="num">${fmtNum(comp.totalPaid)}</td>
        <td class="num" style="color:${Number(rem)>0?"var(--danger)":"var(--success)"}">${fmtNum(rem)}</td>
        <td>${badge}</td>
        <td>${c.last_payment||"—"}</td>
        ${canEdit() ? actionBtns(c.id,"editContract","deleteContract") : "<td></td>"}
      </tr>`;
    });

    // Monthly total
    html += `<tr class="total-row">
      <td colspan="5">TOTAL — ${monthLabel(key)}</td>
      <td class="num">${fmtNum(tot.amount)}</td>
      <td></td>
      <td class="num">${fmtNum(tot.gcash)}</td>
      <td class="num">${fmtNum(tot.cash)}</td>
      <td></td>
      <td class="num">${fmtNum(tot.dswdAfterTax)}</td>
      <td class="num">${fmtNum(tot.dswdDiscount)}</td>
      <td class="num">${fmtNum(tot.baiAmt)}</td>
      <td class="num">${fmtNum(tot.discount)}</td>
      <td class="num">${fmtNum(tot.totalPaid)}</td>
      <td class="num">${fmtNum(tot.remaining)}</td>
      <td colspan="3"></td>
    </tr>`;

    for (const k in grand) grand[k] += tot[k];
  });

  // Grand total
  html += `<tr class="total-row" style="background:var(--gold);color:var(--navy)">
    <td colspan="5">GRAND TOTAL</td>
    <td class="num">${fmtNum(grand.amount)}</td>
    <td></td>
    <td class="num">${fmtNum(grand.gcash)}</td>
    <td class="num">${fmtNum(grand.cash)}</td>
    <td></td>
    <td class="num">${fmtNum(grand.dswdAfterTax)}</td>
    <td class="num">${fmtNum(grand.dswdDiscount)}</td>
    <td class="num">${fmtNum(grand.baiAmt)}</td>
    <td class="num">${fmtNum(grand.discount)}</td>
    <td class="num">${fmtNum(grand.totalPaid)}</td>
    <td class="num">${fmtNum(grand.remaining)}</td>
    <td colspan="3"></td>
  </tr>`;

  tb.innerHTML = html;
}

// Contracts search filter live
$("contractSearch")?.addEventListener("input", renderContracts);
$("contractMonthFilter")?.addEventListener("change", renderContracts);
$("contractStatusFilter")?.addEventListener("change", renderContracts);

// ── CONTRACT FORM ──────────────────────────────────────────────
window.editContract = function(id) {
  const c = APP.contracts.find(r=>r.id===id) || {};
  openContractForm(c);
};
window.deleteContract = async function(id) {
  if (!confirm("Delete this contract? This cannot be undone.")) return;
  await DB.deleteContract(id);
  APP.contracts = APP.contracts.filter(r=>r.id!==id);
  renderContracts();
  toast("Contract deleted.", "success");
};

$("btnAddContract")?.addEventListener("click", () => openContractForm({}));

function openContractForm(c = {}) {
  const isEdit = !!c.id;
  Modal.open(isEdit ? "Edit Contract" : "New Contract", `
    <div class="form-row">
      <div class="form-group"><label class="form-label">Date</label>
        <input id="cf_date" type="date" class="form-input" value="${c.date||todayStr()}"/></div>
      <div class="form-group"><label class="form-label">Contract #</label>
        <input id="cf_contract_no" type="text" class="form-input" value="${c.contract_no||""}"/></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Deceased</label>
        <input id="cf_deceased" type="text" class="form-input" value="${c.deceased||""}"/></div>
      <div class="form-group"><label class="form-label">Casket</label>
        <input id="cf_casket" type="text" class="form-input" value="${c.casket||""}"/></div>
    </div>
    <div class="form-group" style="margin-bottom:12px"><label class="form-label">Address</label>
      <input id="cf_address" type="text" class="form-input" value="${c.address||""}"/></div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Contract Amount (₱)</label>
        <input id="cf_amount" type="number" step="0.01" class="form-input" value="${c.amount||0}"/></div>
      <div class="form-group"><label class="form-label">In-Haus Payment (₱)</label>
        <input id="cf_inhaus" type="number" step="0.01" class="form-input" value="${c.inhaus||0}"/></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">BAI (₱)</label>
        <input id="cf_bai" type="number" step="0.01" class="form-input" value="${c.bai||0}"/></div>
      <div class="form-group"><label class="form-label">GL (₱)</label>
        <input id="cf_gl" type="number" step="0.01" class="form-input" value="${c.gl||0}"/></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">GCash (₱)</label>
        <input id="cf_gcash" type="number" step="0.01" class="form-input" value="${c.gcash||0}"/></div>
      <div class="form-group"><label class="form-label">Cash (₱)</label>
        <input id="cf_cash" type="number" step="0.01" class="form-input" value="${c.cash||0}"/></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Discount (₱)</label>
        <input id="cf_discount" type="number" step="0.01" class="form-input" value="${c.discount||0}"/></div>
      <div class="form-group"><label class="form-label">Last Payment Date</label>
        <input id="cf_last_payment" type="date" class="form-input" value="${c.last_payment&&c.last_payment!=='—'?c.last_payment:''}"/></div>
    </div>
  `, `
    <button class="btn btn-secondary" onclick="Modal.close()">Cancel</button>
    <button class="btn btn-primary" onclick="saveContractForm('${c.id||""}')">
      ${isEdit?"Save Changes":"Add Contract"}
    </button>
  `);
}

window.saveContractForm = async function(id) {
  const row = {
    id:           id || undefined,
    branch_id:    APP.currentBranchId,
    date:         $("cf_date")?.value || null,
    contract_no:  $("cf_contract_no")?.value || null,
    deceased:     $("cf_deceased")?.value || null,
    casket:       $("cf_casket")?.value || null,
    address:      $("cf_address")?.value || null,
    amount:       Number($("cf_amount")?.value) || 0,
    inhaus:       Number($("cf_inhaus")?.value) || 0,
    bai:          Number($("cf_bai")?.value) || 0,
    gl:           Number($("cf_gl")?.value) || 0,
    gcash:        Number($("cf_gcash")?.value) || 0,
    cash:         Number($("cf_cash")?.value) || 0,
    discount:     Number($("cf_discount")?.value) || 0,
    last_payment: $("cf_last_payment")?.value || "—",
  };
  if (!row.id) delete row.id;
  const saved = await DB.saveContract(row);
  if (!saved) { toast("Error saving contract.", "error"); return; }
  if (id) APP.contracts = APP.contracts.map(r=>r.id===id?saved:r);
  else    APP.contracts.push(saved);
  Modal.close();
  renderContracts();
  toast((id?"Updated":"Added")+" contract.", "success");
};

// ── GENERIC TRANSACTION RENDERER ──────────────────────────────
function renderTransactionTable(tbodyId, rows, colsFn, openingBal, netFn) {
  const tb = $(tbodyId);
  if (!tb) return;
  if (!rows.length) {
    tb.innerHTML = `<tr><td colspan="99" style="text-align:center;color:var(--text-3);padding:20px">No records.</td></tr>`;
    return;
  }
  let running = openingBal;
  let html = "";
  const sorted = rows.slice().sort((a,b)=>(a.date||"").localeCompare(b.date||""));
  sorted.forEach(r => {
    running += netFn(r);
    html += colsFn(r, running);
  });
  tb.innerHTML = html;
}

// ── CASH RECEIVED ──────────────────────────────────────────────
function renderCashReceived() {
  const search    = ($("crSearch")?.value||"").toLowerCase();
  const dateFilter= $("crDateFilter")?.value||"";
  let rows = APP.cashReceived.slice();
  if (search)     rows = rows.filter(r=>(r.client||r.particular||r.contract_no||"").toLowerCase().includes(search));
  if (dateFilter) rows = rows.filter(r=>r.date===dateFilter);
  rows.sort((a,b)=>(a.date||"").localeCompare(b.date||""));
  const openBal = Number(APP.settings?.cash_balance)||0;
  let running = openBal;
  // Running balance over ALL data (not just filtered) up to first filtered row date
  const allSorted = APP.cashReceived.slice().sort((a,b)=>(a.date||"").localeCompare(b.date||""));
  const allExp    = APP.cashExpense.slice().sort((a,b)=>(a.date||"").localeCompare(b.date||""));
  const allPnb    = APP.pnbDeposit.slice().sort((a,b)=>(a.date||"").localeCompare(b.date||""));

  const tb = $("crTbody");
  if (!rows.length) { tb.innerHTML=`<tr><td colspan="9" style="text-align:center;color:var(--text-3);padding:20px">No records.</td></tr>`; return; }
  running = openBal;
  let html = "";
  rows.forEach(r => {
    running += Number(r.amount)||0;
    html += `<tr>
      <td>${fmtDate(r.date)}</td><td>${r.contract_no||"—"}</td>
      <td>${r.receipt||"—"}</td><td>${r.client||"—"}</td>
      <td>${r.particular||"—"}</td>
      <td class="num" style="color:var(--success)">+${fmtNum(r.amount)}</td>
      <td class="num"><strong>${fmtNum(running)}</strong></td>
      <td style="font-size:11px;color:var(--text-3)">${r.created_by_email||""}</td>
      ${canEdit()?actionBtns(r.id,"editCR","deleteCR"):"<td></td>"}
    </tr>`;
  });
  tb.innerHTML = html;
}
$("crSearch")?.addEventListener("input", renderCashReceived);
$("crDateFilter")?.addEventListener("change", renderCashReceived);
$("btnAddCR")?.addEventListener("click", () => openSimpleForm("Cash Received", {}, "CR"));
window.editCR = id => { const r=APP.cashReceived.find(x=>x.id===id)||{}; openSimpleForm("Cash Received",r,"CR"); };
window.deleteCR = async id => {
  if (!confirm("Delete this entry?")) return;
  await DB.deleteCashReceived(id);
  APP.cashReceived = APP.cashReceived.filter(r=>r.id!==id);
  renderCashReceived(); updateBalanceDisplays(); toast("Deleted.","success");
};

// ── CASH EXPENSE ──────────────────────────────────────────────
function renderCashExpense() {
  const search    = ($("ceSearch")?.value||"").toLowerCase();
  const dateFilter= $("ceDateFilter")?.value||"";
  let rows = APP.cashExpense.slice();
  if (search)     rows = rows.filter(r=>(r.particular||"").toLowerCase().includes(search));
  if (dateFilter) rows = rows.filter(r=>r.date===dateFilter);
  rows.sort((a,b)=>(a.date||"").localeCompare(b.date||""));
  const tb = $("ceTbody");
  if (!rows.length) { tb.innerHTML=`<tr><td colspan="5" style="text-align:center;color:var(--text-3);padding:20px">No records.</td></tr>`; return; }
  tb.innerHTML = rows.map(r=>`<tr>
    <td>${fmtDate(r.date)}</td><td>${r.particular||"—"}</td>
    <td class="num" style="color:var(--danger)">−${fmtNum(r.amount)}</td>
    <td style="font-size:11px;color:var(--text-3)">${r.created_by_email||""}</td>
    ${canEdit()?actionBtns(r.id,"editCE","deleteCE"):"<td></td>"}
  </tr>`).join("");
}
$("ceSearch")?.addEventListener("input", renderCashExpense);
$("ceDateFilter")?.addEventListener("change", renderCashExpense);
$("btnAddCE")?.addEventListener("click", () => openExpenseForm({}, "CE"));
window.editCE = id => { const r=APP.cashExpense.find(x=>x.id===id)||{}; openExpenseForm(r,"CE"); };
window.deleteCE = async id => {
  if (!confirm("Delete this entry?")) return;
  await DB.deleteCashExpense(id);
  APP.cashExpense = APP.cashExpense.filter(r=>r.id!==id);
  renderCashExpense(); updateBalanceDisplays(); toast("Deleted.","success");
};

// ── BANK RECEIVED ─────────────────────────────────────────────
function renderBankReceived() {
  const search    = ($("brSearch")?.value||"").toLowerCase();
  const dateFilter= $("brDateFilter")?.value||"";
  let rows = APP.bankReceived.slice();
  if (search)     rows = rows.filter(r=>(r.client||r.contract_no||r.type||"").toLowerCase().includes(search));
  if (dateFilter) rows = rows.filter(r=>r.date===dateFilter);
  rows.sort((a,b)=>(a.date||"").localeCompare(b.date||""));
  const tb = $("brTbody");
  if (!rows.length) { tb.innerHTML=`<tr><td colspan="8" style="text-align:center;color:var(--text-3);padding:20px">No records.</td></tr>`; return; }
  const openBal = Number(APP.settings?.bank_balance)||0;
  let running = openBal;
  tb.innerHTML = rows.map(r=>{
    running += Number(r.amount)||0;
    return `<tr>
      <td>${fmtDate(r.date)}</td><td>${r.contract_no||"—"}</td>
      <td>${r.type||"—"}</td><td>${r.client||"—"}</td>
      <td class="num" style="color:var(--success)">+${fmtNum(r.amount)}</td>
      <td class="num"><strong>${fmtNum(running)}</strong></td>
      <td style="font-size:11px;color:var(--text-3)">${r.created_by_email||""}</td>
      ${canEdit()?actionBtns(r.id,"editBR","deleteBR"):"<td></td>"}
    </tr>`;
  }).join("");
}
$("brSearch")?.addEventListener("input", renderBankReceived);
$("brDateFilter")?.addEventListener("change", renderBankReceived);
$("btnAddBR")?.addEventListener("click", () => openSimpleForm("Bank Received",{},"BR"));
window.editBR = id => { const r=APP.bankReceived.find(x=>x.id===id)||{}; openSimpleForm("Bank Received",r,"BR"); };
window.deleteBR = async id => {
  if (!confirm("Delete?")) return;
  await DB.deleteBankReceived(id);
  APP.bankReceived = APP.bankReceived.filter(r=>r.id!==id);
  renderBankReceived(); updateBalanceDisplays(); toast("Deleted.","success");
};

// ── BANK EXPENSE ──────────────────────────────────────────────
function renderBankExpense() {
  const search    = ($("beSearch")?.value||"").toLowerCase();
  const dateFilter= $("beDateFilter")?.value||"";
  let rows = APP.bankExpense.slice();
  if (search)     rows = rows.filter(r=>(r.particular||r.cv||r.check_no||"").toLowerCase().includes(search));
  if (dateFilter) rows = rows.filter(r=>r.date===dateFilter);
  rows.sort((a,b)=>(a.date||"").localeCompare(b.date||""));
  const tb = $("beTbody");
  if (!rows.length) { tb.innerHTML=`<tr><td colspan="7" style="text-align:center;color:var(--text-3);padding:20px">No records.</td></tr>`; return; }
  const openBal = Number(APP.settings?.bank_balance)||0;
  let running = openBal + APP.bankReceived.reduce((s,r)=>s+(Number(r.amount)||0),0);
  tb.innerHTML = rows.map(r=>{
    running -= Number(r.withdraw)||0;
    return `<tr>
      <td>${fmtDate(r.date)}</td><td>${r.cv||"—"}</td>
      <td>${r.check_no||"—"}</td><td>${r.particular||"—"}</td>
      <td class="num" style="color:var(--danger)">−${fmtNum(r.withdraw)}</td>
      <td class="num"><strong>${fmtNum(running)}</strong></td>
      <td style="font-size:11px;color:var(--text-3)">${r.created_by_email||""}</td>
      ${canEdit()?actionBtns(r.id,"editBE","deleteBE"):"<td></td>"}
    </tr>`;
  }).join("");
}
$("beSearch")?.addEventListener("input", renderBankExpense);
$("beDateFilter")?.addEventListener("change", renderBankExpense);
$("btnAddBE")?.addEventListener("click", () => openBankExpenseForm({}));
window.editBE = id => { const r=APP.bankExpense.find(x=>x.id===id)||{}; openBankExpenseForm(r); };
window.deleteBE = async id => {
  if (!confirm("Delete?")) return;
  await DB.deleteBankExpense(id);
  APP.bankExpense = APP.bankExpense.filter(r=>r.id!==id);
  renderBankExpense(); updateBalanceDisplays(); toast("Deleted.","success");
};

// ── PNB DEPOSIT ───────────────────────────────────────────────
function renderPnbDeposit() {
  const dateFilter = $("pnbDateFilter")?.value||"";
  let rows = APP.pnbDeposit.slice();
  if (dateFilter) rows = rows.filter(r=>r.date===dateFilter);
  rows.sort((a,b)=>(a.date||"").localeCompare(b.date||""));
  const tb = $("pnbTbody");
  if (!rows.length) { tb.innerHTML=`<tr><td colspan="4" style="text-align:center;color:var(--text-3);padding:20px">No records.</td></tr>`; return; }
  tb.innerHTML = rows.map(r=>`<tr>
    <td>${fmtDate(r.date)}</td>
    <td class="num">${fmtNum(r.amount)}</td>
    <td style="font-size:11px;color:var(--text-3)">${r.created_by_email||""}</td>
    ${canEdit()?actionBtns(r.id,"editPNB","deletePNB"):"<td></td>"}
  </tr>`).join("");
}
$("pnbDateFilter")?.addEventListener("change", renderPnbDeposit);
$("btnAddPNB")?.addEventListener("click", () => openPnbForm({}));
window.editPNB = id => { const r=APP.pnbDeposit.find(x=>x.id===id)||{}; openPnbForm(r); };
window.deletePNB = async id => {
  if (!confirm("Delete?")) return;
  await DB.deletePnbDeposit(id);
  APP.pnbDeposit = APP.pnbDeposit.filter(r=>r.id!==id);
  renderPnbDeposit(); updateBalanceDisplays(); toast("Deleted.","success");
};

// ── DSWD ──────────────────────────────────────────────────────
function renderDswd() {
  const search  = ($("dswdSearch")?.value||"").toLowerCase();
  const sFil    = $("dswdStatusFilter")?.value||"";
  let rows = APP.dswd.slice();
  if (search) rows = rows.filter(r=>(r.deceased||r.contract_no||r.beneficiary||"").toLowerCase().includes(search));
  if (sFil)   rows = rows.filter(r=>r.status===sFil);
  rows.sort((a,b)=>(a.date||"").localeCompare(b.date||""));

  const pending = rows.filter(r=>r.status==="Waiting").reduce((s,r)=>s+(Number(r.dswd_refund)||0),0);
  const el = $("dswdPendingDisplay"); if(el) el.textContent = fmtMoney(pending);

  const tb = $("dswdTbody");
  if (!rows.length) { tb.innerHTML=`<tr><td colspan="15" style="text-align:center;color:var(--text-3);padding:20px">No records.</td></tr>`; return; }
  tb.innerHTML = rows.map(r=>{
    const badgeCls = r.status==="Released"?"badge-paid":r.status==="Received"?"badge-active":"badge-pending";
    return `<tr>
      <td>${fmtDate(r.date)}</td><td>${r.contract_no||"—"}</td><td>${r.deceased||"—"}</td>
      <td class="num">${fmtNum(r.contract_amt)}</td>
      <td class="num">${fmtNum(r.payment)}</td>
      <td class="num">${fmtNum(r.balance)}</td>
      <td class="num">${fmtNum(r.dswd_refund)}</td>
      <td class="num">${fmtNum(r.after_tax)}</td>
      <td>${fmtDate(r.date_received)}</td>
      <td class="num">${fmtNum(r.payable)}</td>
      <td>${fmtDate(r.date_release)}</td>
      <td>${r.beneficiary||"—"}</td>
      <td class="num">${fmtNum(r.dswd_discount)}</td>
      <td><span class="badge ${badgeCls}">${r.status}</span></td>
      ${canEdit()?actionBtns(r.id,"editDSWD","deleteDSWD"):"<td></td>"}
    </tr>`;
  }).join("");
}
$("dswdSearch")?.addEventListener("input", renderDswd);
$("dswdStatusFilter")?.addEventListener("change", renderDswd);
$("btnAddDSWD")?.addEventListener("click", () => openDswdForm({}));
window.editDSWD = id => { const r=APP.dswd.find(x=>x.id===id)||{}; openDswdForm(r); };
window.deleteDSWD = async id => {
  if (!confirm("Delete?")) return;
  await DB.deleteDswd(id);
  APP.dswd = APP.dswd.filter(r=>r.id!==id);
  renderDswd(); toast("Deleted.","success");
};

// ── BAI ───────────────────────────────────────────────────────
function renderBai() {
  const search = ($("baiSearch")?.value||"").toLowerCase();
  const sFil   = $("baiStatusFilter")?.value||"";
  let rows = APP.bai.slice();
  if (search) rows = rows.filter(r=>(r.contract_no||"").toLowerCase().includes(search));
  if (sFil)   rows = rows.filter(r=>r.status===sFil);
  rows.sort((a,b)=>(a.date_applied||"").localeCompare(b.date_applied||""));

  const pending = rows.filter(r=>r.status==="Pending").reduce((s,r)=>s+(Number(r.amount)||0),0);
  const el = $("baiPendingDisplay"); if(el) el.textContent = fmtMoney(pending);

  const tb = $("baiTbody");
  if (!rows.length) { tb.innerHTML=`<tr><td colspan="7" style="text-align:center;color:var(--text-3);padding:20px">No records.</td></tr>`; return; }
  tb.innerHTML = rows.map(r=>`<tr>
    <td>${fmtDate(r.date_applied)}</td><td>${r.contract_no||"—"}</td>
    <td class="num">${fmtNum(r.amount)}</td>
    <td>${fmtDate(r.date_completed)}</td>
    <td><span class="badge ${r.status==="Collected"?"badge-paid":"badge-pending"}">${r.status}</span></td>
    <td style="font-size:11px;color:var(--text-3)">${r.created_by_email||""}</td>
    ${canEdit()?actionBtns(r.id,"editBAI","deleteBAI"):"<td></td>"}
  </tr>`).join("");
}
$("baiSearch")?.addEventListener("input", renderBai);
$("baiStatusFilter")?.addEventListener("change", renderBai);
$("btnAddBAI")?.addEventListener("click", () => openBaiForm({}));
window.editBAI = id => { const r=APP.bai.find(x=>x.id===id)||{}; openBaiForm(r); };
window.deleteBAI = async id => {
  if (!confirm("Delete?")) return;
  await DB.deleteBai(id);
  APP.bai = APP.bai.filter(r=>r.id!==id);
  renderBai(); toast("Deleted.","success");
};

// ── FORM HELPERS ──────────────────────────────────────────────
function openSimpleForm(title, r, type) {
  const isCR = type === "CR";
  const isBR = type === "BR";
  Modal.open((r.id?"Edit ":"New ") + title, `
    <div class="form-row">
      <div class="form-group"><label class="form-label">Date</label>
        <input id="sf_date" type="date" class="form-input" value="${r.date||todayStr()}"/></div>
      ${isCR||isBR ? `<div class="form-group"><label class="form-label">Contract #</label>
        <input id="sf_contract" type="text" class="form-input" value="${r.contract_no||""}"/></div>` : ""}
    </div>
    ${isCR ? `<div class="form-row">
      <div class="form-group"><label class="form-label">Receipt #</label>
        <input id="sf_receipt" type="text" class="form-input" value="${r.receipt||""}"/></div>
      <div class="form-group"><label class="form-label">Client Name</label>
        <input id="sf_client" type="text" class="form-input" value="${r.client||""}"/></div>
    </div>
    <div class="form-group" style="margin-bottom:12px"><label class="form-label">Particular</label>
      <input id="sf_particular" type="text" class="form-input" value="${r.particular||""}"/></div>` : ""}
    ${isBR ? `<div class="form-row">
      <div class="form-group"><label class="form-label">Type</label>
        <input id="sf_type" type="text" class="form-input" value="${r.type||""}"/></div>
      <div class="form-group"><label class="form-label">Client Name</label>
        <input id="sf_client" type="text" class="form-input" value="${r.client||""}"/></div>
    </div>` : ""}
    <div class="form-group"><label class="form-label">Amount (₱)</label>
      <input id="sf_amount" type="number" step="0.01" class="form-input" value="${r.amount||0}"/></div>
  `, `
    <button class="btn btn-secondary" onclick="Modal.close()">Cancel</button>
    <button class="btn btn-primary" onclick="saveSimpleForm('${r.id||""}','${type}')">
      ${r.id?"Save Changes":"Add"}
    </button>
  `);
}

window.saveSimpleForm = async function(id, type) {
  const base = {
    id:        id||undefined,
    branch_id: APP.currentBranchId,
    date:      $("sf_date")?.value||null,
    amount:    Number($("sf_amount")?.value)||0,
  };
  if (!base.id) delete base.id;
  let saved, storeKey, renderFn, dbFn;
  if (type==="CR") {
    const row = { ...base, contract_no:$("sf_contract")?.value||null, receipt:$("sf_receipt")?.value||null,
      client:$("sf_client")?.value||null, particular:$("sf_particular")?.value||null };
    saved = await DB.saveCashReceived(row);
    if(id) APP.cashReceived=APP.cashReceived.map(r=>r.id===id?saved:r); else APP.cashReceived.push(saved);
    renderCashReceived();
  } else if (type==="BR") {
    const row = { ...base, contract_no:$("sf_contract")?.value||null,
      type:$("sf_type")?.value||null, client:$("sf_client")?.value||null };
    saved = await DB.saveBankReceived(row);
    if(id) APP.bankReceived=APP.bankReceived.map(r=>r.id===id?saved:r); else APP.bankReceived.push(saved);
    renderBankReceived();
  }
  if (!saved) { toast("Error saving.", "error"); return; }
  Modal.close(); updateBalanceDisplays(); toast("Saved.","success");
};

function openExpenseForm(r, type) {
  Modal.open((r.id?"Edit ":"New ") + (type==="CE"?"Cash Expense":"Expense"), `
    <div class="form-group" style="margin-bottom:12px"><label class="form-label">Date</label>
      <input id="ef_date" type="date" class="form-input" value="${r.date||todayStr()}"/></div>
    <div class="form-group" style="margin-bottom:12px"><label class="form-label">Particular</label>
      <input id="ef_particular" type="text" class="form-input" value="${r.particular||""}"/></div>
    <div class="form-group"><label class="form-label">Amount (₱)</label>
      <input id="ef_amount" type="number" step="0.01" class="form-input" value="${r.amount||0}"/></div>
  `, `
    <button class="btn btn-secondary" onclick="Modal.close()">Cancel</button>
    <button class="btn btn-primary" onclick="saveExpenseForm('${r.id||""}')">
      ${r.id?"Save Changes":"Add"}
    </button>
  `);
}
window.saveExpenseForm = async function(id) {
  const row = { id:id||undefined, branch_id:APP.currentBranchId,
    date:$("ef_date")?.value||null, particular:$("ef_particular")?.value||null,
    amount:Number($("ef_amount")?.value)||0 };
  if (!row.id) delete row.id;
  const saved = await DB.saveCashExpense(row);
  if (!saved) { toast("Error saving.","error"); return; }
  if(id) APP.cashExpense=APP.cashExpense.map(r=>r.id===id?saved:r); else APP.cashExpense.push(saved);
  Modal.close(); renderCashExpense(); updateBalanceDisplays(); toast("Saved.","success");
};

function openBankExpenseForm(r) {
  Modal.open((r.id?"Edit ":"New ")+"Bank Expense", `
    <div class="form-row">
      <div class="form-group"><label class="form-label">Date</label>
        <input id="bef_date" type="date" class="form-input" value="${r.date||todayStr()}"/></div>
      <div class="form-group"><label class="form-label">CV #</label>
        <input id="bef_cv" type="text" class="form-input" value="${r.cv||""}"/></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Check #</label>
        <input id="bef_check" type="text" class="form-input" value="${r.check_no||""}"/></div>
      <div class="form-group"><label class="form-label">Withdraw Amount (₱)</label>
        <input id="bef_withdraw" type="number" step="0.01" class="form-input" value="${r.withdraw||0}"/></div>
    </div>
    <div class="form-group"><label class="form-label">Particular</label>
      <input id="bef_particular" type="text" class="form-input" value="${r.particular||""}"/></div>
  `, `
    <button class="btn btn-secondary" onclick="Modal.close()">Cancel</button>
    <button class="btn btn-primary" onclick="saveBankExpenseForm('${r.id||""}')">
      ${r.id?"Save Changes":"Add"}
    </button>
  `);
}
window.saveBankExpenseForm = async function(id) {
  const row = { id:id||undefined, branch_id:APP.currentBranchId,
    date:$("bef_date")?.value||null, cv:$("bef_cv")?.value||null,
    check_no:$("bef_check")?.value||null, particular:$("bef_particular")?.value||null,
    withdraw:Number($("bef_withdraw")?.value)||0 };
  if (!row.id) delete row.id;
  const saved = await DB.saveBankExpense(row);
  if (!saved) { toast("Error saving.","error"); return; }
  if(id) APP.bankExpense=APP.bankExpense.map(r=>r.id===id?saved:r); else APP.bankExpense.push(saved);
  Modal.close(); renderBankExpense(); updateBalanceDisplays(); toast("Saved.","success");
};

function openPnbForm(r) {
  Modal.open((r.id?"Edit ":"New ")+"PNB Deposit", `
    <div class="form-row">
      <div class="form-group"><label class="form-label">Date</label>
        <input id="pf_date" type="date" class="form-input" value="${r.date||todayStr()}"/></div>
      <div class="form-group"><label class="form-label">Amount (₱)</label>
        <input id="pf_amount" type="number" step="0.01" class="form-input" value="${r.amount||0}"/></div>
    </div>
  `, `
    <button class="btn btn-secondary" onclick="Modal.close()">Cancel</button>
    <button class="btn btn-primary" onclick="savePnbForm('${r.id||""}')">
      ${r.id?"Save Changes":"Add"}
    </button>
  `);
}
window.savePnbForm = async function(id) {
  const row = { id:id||undefined, branch_id:APP.currentBranchId,
    date:$("pf_date")?.value||null, amount:Number($("pf_amount")?.value)||0 };
  if (!row.id) delete row.id;
  const saved = await DB.savePnbDeposit(row);
  if (!saved) { toast("Error saving.","error"); return; }
  if(id) APP.pnbDeposit=APP.pnbDeposit.map(r=>r.id===id?saved:r); else APP.pnbDeposit.push(saved);
  Modal.close(); renderPnbDeposit(); updateBalanceDisplays(); toast("Saved.","success");
};

function openDswdForm(r) {
  Modal.open((r.id?"Edit ":"New ")+"DSWD Record", `
    <div class="form-row">
      <div class="form-group"><label class="form-label">Date</label>
        <input id="dw_date" type="date" class="form-input" value="${r.date||todayStr()}"/></div>
      <div class="form-group"><label class="form-label">Contract #</label>
        <input id="dw_contract" type="text" class="form-input" value="${r.contract_no||""}"/></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Deceased</label>
        <input id="dw_deceased" type="text" class="form-input" value="${r.deceased||""}"/></div>
      <div class="form-group"><label class="form-label">Beneficiary</label>
        <input id="dw_beneficiary" type="text" class="form-input" value="${r.beneficiary||""}"/></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Contract Amt (₱)</label>
        <input id="dw_contract_amt" type="number" step="0.01" class="form-input" value="${r.contract_amt||0}"/></div>
      <div class="form-group"><label class="form-label">Payment (₱)</label>
        <input id="dw_payment" type="number" step="0.01" class="form-input" value="${r.payment||0}"/></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">DSWD Refund (₱)</label>
        <input id="dw_dswd_refund" type="number" step="0.01" class="form-input" value="${r.dswd_refund||0}"/></div>
      <div class="form-group"><label class="form-label">After Tax (₱)</label>
        <input id="dw_after_tax" type="number" step="0.01" class="form-input" value="${r.after_tax||0}"/></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Payable (₱)</label>
        <input id="dw_payable" type="number" step="0.01" class="form-input" value="${r.payable||0}"/></div>
      <div class="form-group"><label class="form-label">DSWD Discount (₱)</label>
        <input id="dw_dswd_discount" type="number" step="0.01" class="form-input" value="${r.dswd_discount||0}"/></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Date Received</label>
        <input id="dw_date_received" type="date" class="form-input" value="${r.date_received||""}"/></div>
      <div class="form-group"><label class="form-label">Date Released</label>
        <input id="dw_date_release" type="date" class="form-input" value="${r.date_release||""}"/></div>
    </div>
    <div class="form-group"><label class="form-label">Status</label>
      <select id="dw_status" class="form-input">
        <option value="Waiting" ${r.status==="Waiting"||!r.status?"selected":""}>Waiting</option>
        <option value="Received" ${r.status==="Received"?"selected":""}>Received</option>
        <option value="Released" ${r.status==="Released"?"selected":""}>Released</option>
      </select></div>
  `, `
    <button class="btn btn-secondary" onclick="Modal.close()">Cancel</button>
    <button class="btn btn-primary" onclick="saveDswdForm('${r.id||""}')">
      ${r.id?"Save Changes":"Add"}
    </button>
  `, true);
}
window.saveDswdForm = async function(id) {
  const row = { id:id||undefined, branch_id:APP.currentBranchId,
    date:$("dw_date")?.value||null, contract_no:$("dw_contract")?.value||null,
    deceased:$("dw_deceased")?.value||null, beneficiary:$("dw_beneficiary")?.value||null,
    contract_amt:Number($("dw_contract_amt")?.value)||0,
    payment:Number($("dw_payment")?.value)||0,
    balance:Number($("dw_contract_amt")?.value||0)-Number($("dw_payment")?.value||0),
    dswd_refund:Number($("dw_dswd_refund")?.value)||0,
    after_tax:Number($("dw_after_tax")?.value)||0,
    date_received:$("dw_date_received")?.value||null,
    payable:Number($("dw_payable")?.value)||0,
    date_release:$("dw_date_release")?.value||null,
    dswd_discount:Number($("dw_dswd_discount")?.value)||0,
    status:$("dw_status")?.value||"Waiting" };
  if (!row.id) delete row.id;
  const saved = await DB.saveDswd(row);
  if (!saved) { toast("Error saving.","error"); return; }
  if(id) APP.dswd=APP.dswd.map(r=>r.id===id?saved:r); else APP.dswd.push(saved);
  Modal.close(); renderDswd(); toast("Saved.","success");
};

function openBaiForm(r) {
  Modal.open((r.id?"Edit ":"New ")+"BAI Record", `
    <div class="form-row">
      <div class="form-group"><label class="form-label">Date Applied</label>
        <input id="bf_date_applied" type="date" class="form-input" value="${r.date_applied||todayStr()}"/></div>
      <div class="form-group"><label class="form-label">Contract #</label>
        <input id="bf_contract" type="text" class="form-input" value="${r.contract_no||""}"/></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Amount (₱)</label>
        <input id="bf_amount" type="number" step="0.01" class="form-input" value="${r.amount||0}"/></div>
      <div class="form-group"><label class="form-label">Date Completed</label>
        <input id="bf_date_completed" type="date" class="form-input" value="${r.date_completed||""}"/></div>
    </div>
    <div class="form-group"><label class="form-label">Status</label>
      <select id="bf_status" class="form-input">
        <option value="Pending" ${r.status==="Pending"||!r.status?"selected":""}>Pending</option>
        <option value="Collected" ${r.status==="Collected"?"selected":""}>Collected</option>
      </select></div>
  `, `
    <button class="btn btn-secondary" onclick="Modal.close()">Cancel</button>
    <button class="btn btn-primary" onclick="saveBaiForm('${r.id||""}')">
      ${r.id?"Save Changes":"Add"}
    </button>
  `);
}
window.saveBaiForm = async function(id) {
  const row = { id:id||undefined, branch_id:APP.currentBranchId,
    date_applied:$("bf_date_applied")?.value||null,
    contract_no:$("bf_contract")?.value||null,
    amount:Number($("bf_amount")?.value)||0,
    date_completed:$("bf_date_completed")?.value||null,
    status:$("bf_status")?.value||"Pending" };
  if (!row.id) delete row.id;
  const saved = await DB.saveBai(row);
  if (!saved) { toast("Error saving.","error"); return; }
  if(id) APP.bai=APP.bai.map(r=>r.id===id?saved:r); else APP.bai.push(saved);
  Modal.close(); renderBai(); toast("Saved.","success");
};

// ── BRANCHES PAGE ──────────────────────────────────────────────
function renderBranches() {
  const wrap = $("branchCards");
  if (!wrap) return;
  wrap.innerHTML = APP.branches.map(b => {
    const contractCount = 0; // would need cross-branch query for admin
    return `<div class="branch-card">
      <h3>${b.name}</h3>
      <p>${b.address||"No address set"}</p>
      <div class="branch-stat">
        <span>Contact: <strong>${b.contact||"—"}</strong></span>
        <span>Active: <strong>${b.active?"Yes":"No"}</strong></span>
      </div>
      <div style="display:flex;gap:6px;margin-top:12px">
        <button class="btn btn-sm btn-secondary" onclick="editBranchModal('${b.id}')">Edit</button>
      </div>
    </div>`;
  }).join("") + ``;
}

window.editBranchModal = function(id) {
  const b = APP.branches.find(x=>x.id===id)||{};
  Modal.open("Edit Branch", `
    <div class="form-group" style="margin-bottom:12px"><label class="form-label">Branch Name</label>
      <input id="bb_name" type="text" class="form-input" value="${b.name||""}"/></div>
    <div class="form-group" style="margin-bottom:12px"><label class="form-label">Address</label>
      <input id="bb_address" type="text" class="form-input" value="${b.address||""}"/></div>
    <div class="form-group"><label class="form-label">Contact</label>
      <input id="bb_contact" type="text" class="form-input" value="${b.contact||""}"/></div>
  `, `
    <button class="btn btn-secondary" onclick="Modal.close()">Cancel</button>
    <button class="btn btn-primary" onclick="saveBranchModal('${id}')">Save</button>
  `);
};
window.saveBranchModal = async function(id) {
  const row = { id, name:$("bb_name")?.value, address:$("bb_address")?.value, contact:$("bb_contact")?.value };
  const saved = await DB.saveBranch(row);
  if (!saved) { toast("Error saving.","error"); return; }
  APP.branches = APP.branches.map(b=>b.id===id?saved:b);
  Modal.close(); renderBranches(); populateBranchSelect(); toast("Branch updated.","success");
};

$("btnAddBranch")?.addEventListener("click", () => {
  Modal.open("Add Branch", `
    <div class="form-group" style="margin-bottom:12px"><label class="form-label">Branch Name</label>
      <input id="nb_name" type="text" class="form-input"/></div>
    <div class="form-group" style="margin-bottom:12px"><label class="form-label">Address</label>
      <input id="nb_address" type="text" class="form-input"/></div>
    <div class="form-group"><label class="form-label">Contact</label>
      <input id="nb_contact" type="text" class="form-input"/></div>
  `, `
    <button class="btn btn-secondary" onclick="Modal.close()">Cancel</button>
    <button class="btn btn-primary" onclick="addNewBranch()">Add Branch</button>
  `);
});
window.addNewBranch = async function() {
  const name = $("nb_name")?.value?.trim();
  if (!name) { toast("Branch name required.","error"); return; }
  const saved = await DB.saveBranch({ name, address:$("nb_address")?.value, contact:$("nb_contact")?.value, active:true });
  if (!saved) { toast("Error saving.","error"); return; }
  // Create settings for new branch
  await DB.saveSettings(saved.id, { cashBalance:0, bankBalance:0 });
  APP.branches.push(saved);
  Modal.close(); renderBranches(); populateBranchSelect(); toast("Branch added.","success");
};

// ── USERS PAGE ─────────────────────────────────────────────────
async function renderUsers() {
  const profiles = await DB.getUserProfiles();
  const tb = $("usersTbody");
  if (!tb) return;
  tb.innerHTML = profiles.map(p => {
    const branch = APP.branches.find(b=>b.id===p.branch_id);
    return `<tr>
      <td>${p.full_name||"—"}</td>
      <td style="font-size:12px">${p.id}</td>
      <td><select class="form-input" style="padding:3px 6px;font-size:12px" onchange="updateUserRole('${p.id}',this.value)">
        <option value="admin"      ${p.role==="admin"?"selected":""}>Admin</option>
        <option value="manager"    ${p.role==="manager"?"selected":""}>Finance Manager</option>
        <option value="accountant" ${p.role==="accountant"?"selected":""}>Accountant</option>
        <option value="clerk"      ${p.role==="clerk"?"selected":""}>Finance Clerk</option>
      </select></td>
      <td><select class="form-input" style="padding:3px 6px;font-size:12px" onchange="updateUserBranch('${p.id}',this.value)">
        ${APP.branches.map(b=>`<option value="${b.id}" ${p.branch_id===b.id?"selected":""}>${b.name}</option>`).join("")}
      </select></td>
      <td style="font-size:12px">—</td>
      <td><span class="badge ${p.active!==false?"badge-paid":"badge-overdue"}">${p.active!==false?"Active":"Inactive"}</span></td>
      <td class="action-col">
        <button class="btn btn-sm ${p.active!==false?"btn-secondary":"btn-primary"}" onclick="toggleUserActive('${p.id}',${p.active!==false})">
          ${p.active!==false?"Disable":"Enable"}
        </button>
      </td>
    </tr>`;
  }).join("");

  // Audit log
  const logs = await DB.getAuditLog();
  const atb  = $("auditTbody");
  if (atb) {
    atb.innerHTML = logs.map(l => `<tr>
      <td style="font-size:11px">${new Date(l.created_at).toLocaleString("en-PH")}</td>
      <td style="font-size:12px">${l.user_email||"—"}</td>
      <td><span class="badge ${l.action==="DELETE"?"badge-overdue":l.action==="INSERT"?"badge-paid":"badge-active"}">${l.action}</span></td>
      <td style="font-size:12px">${l.table_name||"—"}</td>
      <td style="font-size:11px;color:var(--text-3)">${JSON.stringify(l.details||{}).slice(0,60)}</td>
    </tr>`).join("");
  }
}

window.updateUserRole = async function(id, role) {
  await DB.saveUserProfile({ id, role });
  toast("Role updated.","success");
};
window.updateUserBranch = async function(id, branch_id) {
  await DB.saveUserProfile({ id, branch_id });
  toast("Branch updated.","success");
};
window.toggleUserActive = async function(id, currentlyActive) {
  await DB.saveUserProfile({ id, active: !currentlyActive });
  renderUsers(); toast("Status updated.","success");
};

$("btnInviteUser")?.addEventListener("click", () => {
  Modal.open("Invite New User", `
    <p style="font-size:13px;color:var(--text-2);margin-bottom:16px">
      To add a new user: go to your <strong>Supabase Dashboard → Authentication → Users → Invite User</strong>.
      After they accept the invite and log in once, they will appear in this list and you can assign their role and branch here.
    </p>
    <div class="info-panel" style="font-size:13px">
      Make sure the new user sets their password via the invite email, then come back to this page to assign their role.
    </div>
  `, `<button class="btn btn-primary" onclick="Modal.close()">Got it</button>`);
});

// ── SETTINGS ──────────────────────────────────────────────────
async function loadSettings() {
  const s = APP.settings;
  if ($("setCashBalance"))  $("setCashBalance").value  = Number(s?.cash_balance||0).toFixed(2);
  if ($("setBankBalance"))  $("setBankBalance").value  = Number(s?.bank_balance||0).toFixed(2);
  if ($("setFinanceClerk")) $("setFinanceClerk").value = s?.finance_clerk||"";
  if ($("setAccountant"))   $("setAccountant").value   = s?.accountant||"";
  if ($("setFinanceManager")) $("setFinanceManager").value = s?.finance_manager||"";
}

$("btnSaveSettings")?.addEventListener("click", async () => {
  await DB.saveSettings(APP.currentBranchId, {
    cashBalance:   Number($("setCashBalance")?.value)||0,
    bankBalance:   Number($("setBankBalance")?.value)||0,
    financeClerk:  $("setFinanceClerk")?.value||"",
    accountant:    $("setAccountant")?.value||"",
    financeManager: $("setFinanceManager")?.value||"",
  });
  APP.settings = await DB.getSettings(APP.currentBranchId);
  updateBalanceDisplays();
  toast("Settings saved.","success");
});

document.querySelector("[data-page='settings']")?.addEventListener("click", loadSettings);

$("btnDangerClear")?.addEventListener("click", async () => {
  const branch = APP.currentBranch?.name || "this branch";
  if (!confirm(`WARNING: This will permanently delete ALL data for "${branch}". Type DELETE to confirm.`)) return;
  const check = prompt(`Type DELETE to confirm clearing all data for "${branch}"`);
  if (check !== "DELETE") { toast("Cancelled — no data deleted."); return; }
  await DB.deleteAllForBranch(APP.currentBranchId);
  await loadBranchData();
  toast("All data cleared for this branch.","success");
});

// ── REPORTS ───────────────────────────────────────────────────
function populateReportDropdowns() {
  const now   = new Date();
  const years = [now.getFullYear(), now.getFullYear()-1, now.getFullYear()-2];

  // Monthly dropdown
  const mSel = $("rptMonthYear");
  if (mSel) {
    mSel.innerHTML = "";
    for (let y of years) {
      for (let m = 11; m >= 0; m--) {
        const d = new Date(y, m);
        const key  = `${y}-${String(m+1).padStart(2,"0")}`;
        const lbl  = d.toLocaleDateString("en-PH",{month:"long",year:"numeric"});
        const o    = document.createElement("option");
        o.value    = key; o.textContent = lbl;
        if (y===now.getFullYear() && m===now.getMonth()) o.selected = true;
        mSel.appendChild(o);
      }
    }
  }
  const bMSel = $("rptBranchMonthYear");
  if (bMSel) bMSel.innerHTML = mSel?.innerHTML || "";

  // Year dropdown
  const ySel = $("rptYear");
  if (ySel) {
    ySel.innerHTML = years.map(y=>`<option value="${y}" ${y===now.getFullYear()?"selected":""}>${y}</option>`).join("");
  }

  // Daily default
  if ($("rptDailyDate")) $("rptDailyDate").value = todayStr();
  if ($("rptWeeklyStart")) {
    const mon = new Date(); mon.setDate(mon.getDate()-mon.getDay()+1);
    $("rptWeeklyStart").value = mon.toISOString().slice(0,10);
  }
}

// ── PDF REPORT ─────────────────────────────────────────────────
function makePdf(title, subtitle, tableData, colWidths) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation:"landscape", unit:"pt", format:"letter" });
  const PW  = doc.internal.pageSize.getWidth();
  let y = 40;
  doc.setFontSize(16); doc.setFont("helvetica","bold");
  doc.text("MAGALLANES FUNERAL SERVICES", PW/2, y, {align:"center"}); y+=20;
  doc.setFontSize(13); doc.setFont("helvetica","normal");
  doc.text(title, PW/2, y, {align:"center"}); y+=16;
  doc.setFontSize(10);
  doc.text(subtitle, PW/2, y, {align:"center"}); y+=6;
  const branch = APP.currentBranch?.name||"";
  if (branch) { doc.text(branch, PW/2, y+10, {align:"center"}); y+=10; }
  doc.autoTable({
    startY: y+10,
    head: [tableData[0]],
    body: tableData.slice(1),
    styles:{ fontSize:8, cellPadding:3 },
    headStyles:{ fillColor:[26,35,50], textColor:255, fontStyle:"bold" },
    columnStyles: colWidths,
    margin:{ left:20, right:20 },
  });
  return doc;
}

$("btnRptDaily")?.addEventListener("click", () => {
  const date = $("rptDailyDate")?.value;
  if (!date) { toast("Pick a date first.","error"); return; }
  const label = fmtDate(date);
  const cashIn  = APP.cashReceived.filter(r=>r.date===date);
  const cashOut = APP.cashExpense.filter(r=>r.date===date);
  const bankIn  = APP.bankReceived.filter(r=>r.date===date);
  const bankOut = APP.bankExpense.filter(r=>r.date===date);
  const pnb     = APP.pnbDeposit.filter(r=>r.date===date);

  // Build two tables
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation:"landscape", unit:"pt", format:"letter" });
  const PW  = doc.internal.pageSize.getWidth();
  let y = 40;
  doc.setFontSize(14); doc.setFont("helvetica","bold");
  doc.text("MAGALLANES FUNERAL SERVICES — DAILY REPORT", PW/2, y, {align:"center"}); y+=18;
  doc.setFontSize(11); doc.setFont("helvetica","normal");
  doc.text(label + (APP.currentBranch?" · "+APP.currentBranch.name:""), PW/2, y, {align:"center"}); y+=8;

  const sig = APP.settings;
  const totCI = cashIn.reduce((s,r)=>s+(Number(r.amount)||0),0);
  const totCO = cashOut.reduce((s,r)=>s+(Number(r.amount)||0),0);
  const totBI = bankIn.reduce((s,r)=>s+(Number(r.amount)||0),0);
  const totBO = bankOut.reduce((s,r)=>s+(Number(r.withdraw)||0),0);
  const totPNB= pnb.reduce((s,r)=>s+(Number(r.amount)||0),0);
  const prevCash= Number(APP.settings?.cash_balance||0)
    + APP.cashReceived.filter(r=>r.date<date).reduce((s,r)=>s+(Number(r.amount)||0),0)
    - APP.cashExpense.filter(r=>r.date<date).reduce((s,r)=>s+(Number(r.amount)||0),0)
    - APP.pnbDeposit.filter(r=>r.date<date).reduce((s,r)=>s+(Number(r.amount)||0),0);
  const closeCash = prevCash + totCI - totCO - totPNB;

  doc.autoTable({
    startY: y+10,
    head:[["CASH RECEIVED","Contract#","Receipt","Client","Particular","Amount"]],
    body:[
      ...cashIn.map(r=>[fmtDate(r.date),r.contract_no||"",r.receipt||"",r.client||"",r.particular||"",fmtNum(r.amount)]),
      ["","","","","TOTAL", fmtNum(totCI)],
      ["","","","","Previous Cash Balance", fmtNum(prevCash)],
      ["","","","","Closing Cash Balance", fmtNum(closeCash)],
    ],
    styles:{fontSize:8, cellPadding:3},
    headStyles:{fillColor:[26,35,50],textColor:255},
    margin:{left:20,right:20},
  });

  doc.autoTable({
    startY: doc.lastAutoTable.finalY + 14,
    head:[["CASH EXPENSE","Particular","Amount"]],
    body:[
      ...cashOut.map(r=>[fmtDate(r.date),r.particular||"",fmtNum(r.amount)]),
      ["","TOTAL", fmtNum(totCO)],
    ],
    styles:{fontSize:8,cellPadding:3},
    headStyles:{fillColor:[26,35,50],textColor:255},
    margin:{left:20,right:20},
  });

  doc.autoTable({
    startY: doc.lastAutoTable.finalY + 14,
    head:[["BANK RECEIVED","Contract#","Type","Client","Amount"]],
    body:[
      ...bankIn.map(r=>[fmtDate(r.date),r.contract_no||"",r.type||"",r.client||"",fmtNum(r.amount)]),
      ["","","","TOTAL", fmtNum(totBI)],
    ],
    styles:{fontSize:8,cellPadding:3},
    headStyles:{fillColor:[26,35,50],textColor:255},
    margin:{left:20,right:20},
  });

  // Footer signatures
  const fy = doc.lastAutoTable.finalY + 40;
  if (sig) {
    doc.setFontSize(9);
    doc.text("Finance Clerk: " + (sig.finance_clerk||""), 40, fy);
    doc.text("Accountant: "   + (sig.accountant||""),     PW/2-80, fy);
    doc.text("Finance Manager: "+(sig.finance_manager||""), PW-200, fy);
  }

  doc.save("DailyReport_"+date+".pdf");
  toast("Daily report generated.","success");
});

$("btnRptClient")?.addEventListener("click", () => {
  const search = $("rptClientContract")?.value?.trim();
  if (!search) { toast("Enter a contract # or client name.","error"); return; }
  const contract = APP.contracts.find(c =>
    (c.contract_no||"").toLowerCase().includes(search.toLowerCase()) ||
    (c.deceased||"").toLowerCase().includes(search.toLowerCase())
  );
  if (!contract) { toast("Contract not found.","error"); return; }
  const comp = computeContract(contract, APP.bai, APP.dswd);
  const payments = [
    ...APP.cashReceived.filter(r=>r.contract_no===contract.contract_no).map(r=>["Cash",fmtDate(r.date),r.receipt||"",r.particular||"",fmtNum(r.amount)]),
    ...APP.bankReceived.filter(r=>r.contract_no===contract.contract_no).map(r=>["Bank",fmtDate(r.date),"",r.type||"",fmtNum(r.amount)]),
  ];
  const doc = makePdf(
    "Client Payment Report",
    `${contract.deceased||""}  ·  Contract # ${contract.contract_no||""}`,
    [["Type","Date","Receipt","Particular","Amount"],...payments,
     ["","","","Contract Amount", fmtNum(contract.amount)],
     ["","","","Total Paid",      fmtNum(comp.totalPaid)],
     ["","","","Remaining",       fmtNum(comp.remaining)]
    ], {}
  );
  doc.save("ClientReport_"+contract.contract_no+".pdf");
  toast("Client report generated.","success");
});

$("btnRptOverdue")?.addEventListener("click", () => {
  const days = Number($("rptOverdueDays")?.value)||60;
  const overdue = APP.contracts.filter(c=>{
    const comp = computeContract(c, APP.bai, APP.dswd);
    return comp.remaining > 0.005 && contractStatus(comp.remaining, c.last_payment)==="overdue";
  });
  if (!overdue.length) { toast("No overdue balances found.","error"); return; }
  const rows = overdue.map(c=>{
    const comp = computeContract(c, APP.bai, APP.dswd);
    return [c.contract_no||"", c.deceased||"", c.address||"",
            fmtNum(c.amount), fmtNum(comp.totalPaid), fmtNum(comp.remaining), c.last_payment||"—"];
  });
  const doc = makePdf("Overdue Balances Report",`As of ${fmtDate(todayStr())} · ${days}+ days without payment`,
    [["Contract#","Deceased","Address","Amount","Total Paid","Remaining","Last Payment"],...rows], {});
  doc.save("OverdueReport_"+todayStr()+".pdf");
  toast("Overdue report generated.","success");
});

$("btnRptWeekly")?.addEventListener("click", () => {
  const start = $("rptWeeklyStart")?.value;
  if (!start) { toast("Pick a week start date.","error"); return; }
  const end = new Date(start); end.setDate(end.getDate()+6);
  const endStr = end.toISOString().slice(0,10);
  const inRange = r => r.date >= start && r.date <= endStr;
  const totCI = APP.cashReceived.filter(inRange).reduce((s,r)=>s+(Number(r.amount)||0),0);
  const totCO = APP.cashExpense.filter(inRange).reduce((s,r)=>s+(Number(r.amount)||0),0);
  const totBI = APP.bankReceived.filter(inRange).reduce((s,r)=>s+(Number(r.amount)||0),0);
  const totBO = APP.bankExpense.filter(inRange).reduce((s,r)=>s+(Number(r.withdraw)||0),0);
  const doc = makePdf("Weekly Report", `${fmtDate(start)} — ${fmtDate(endStr)}`,
    [["Category","Total"],
     ["Cash Received", fmtNum(totCI)],["Cash Expense", fmtNum(totCO)],
     ["Net Cash", fmtNum(totCI-totCO)],
     ["Bank Received", fmtNum(totBI)],["Bank Expense", fmtNum(totBO)],
     ["Net Bank", fmtNum(totBI-totBO)],
    ], {});
  doc.save("WeeklyReport_"+start+"_"+endStr+".pdf");
  toast("Weekly report generated.","success");
});

$("btnRptMonthly")?.addEventListener("click", () => {
  const key = $("rptMonthYear")?.value;
  if (!key) { toast("Pick a month.","error"); return; }
  const inMonth = r => (r.date||"").startsWith(key);
  const totCI = APP.cashReceived.filter(inMonth).reduce((s,r)=>s+(Number(r.amount)||0),0);
  const totCO = APP.cashExpense.filter(inMonth).reduce((s,r)=>s+(Number(r.amount)||0),0);
  const totBI = APP.bankReceived.filter(inMonth).reduce((s,r)=>s+(Number(r.amount)||0),0);
  const totBO = APP.bankExpense.filter(inMonth).reduce((s,r)=>s+(Number(r.withdraw)||0),0);
  const contracts= APP.contracts.filter(inMonth).length;
  const doc = makePdf("Monthly Summary Report", monthLabel(key),
    [["Category","Total"],
     ["Contracts signed", contracts],
     ["Cash Received", fmtNum(totCI)],["Cash Expense", fmtNum(totCO)],["Net Cash", fmtNum(totCI-totCO)],
     ["Bank Received", fmtNum(totBI)],["Bank Expense", fmtNum(totBO)],["Net Bank", fmtNum(totBI-totBO)],
    ], {});
  doc.save("MonthlyReport_"+key+".pdf");
  toast("Monthly report generated.","success");
});

$("btnRptYearly")?.addEventListener("click", () => {
  const year = $("rptYear")?.value;
  if (!year) { toast("Pick a year.","error"); return; }
  const months = Array.from({length:12},(_,i)=>String(i+1).padStart(2,"0"));
  const rows = months.map(m => {
    const key = year+"-"+m;
    const inMonth = r => (r.date||"").startsWith(key);
    const ci = APP.cashReceived.filter(inMonth).reduce((s,r)=>s+(Number(r.amount)||0),0);
    const co = APP.cashExpense.filter(inMonth).reduce((s,r)=>s+(Number(r.amount)||0),0);
    const bi = APP.bankReceived.filter(inMonth).reduce((s,r)=>s+(Number(r.amount)||0),0);
    const bo = APP.bankExpense.filter(inMonth).reduce((s,r)=>s+(Number(r.withdraw)||0),0);
    const cnt= APP.contracts.filter(inMonth).length;
    return [monthLabel(key), cnt, fmtNum(ci), fmtNum(co), fmtNum(ci-co), fmtNum(bi), fmtNum(bo), fmtNum(bi-bo)];
  });
  const doc = makePdf("Yearly Summary Report", "Year "+year,
    [["Month","Contracts","Cash In","Cash Out","Net Cash","Bank In","Bank Out","Net Bank"],...rows], {});
  doc.save("YearlyReport_"+year+".pdf");
  toast("Yearly report generated.","success");
});

// ── XLSX EXPORTS ──────────────────────────────────────────────
function exportXLSX(data, sheetName, filename) {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(data);
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, filename);
}

$("btnExportContractsXLSX")?.addEventListener("click", () => {
  const headers = ["Date","Contract#","Deceased","Casket","Address","Amount","In-Haus","BAI","GL","GCash","Cash","Discount","DSWD After Tax","DSWD Discount","BAI Assist","Total Paid","Remaining","Last Payment"];
  const rows = APP.contracts.map(c=>{
    const comp = computeContract(c, APP.bai, APP.dswd);
    return [c.date,c.contract_no,c.deceased,c.casket,c.address,c.amount,c.inhaus,c.bai,c.gl,c.gcash,c.cash,c.discount,comp.dswdAfterTax,comp.dswdDiscount,comp.baiAmt,comp.totalPaid,comp.remaining,c.last_payment];
  });
  exportXLSX([headers,...rows], "Contracts", "Contracts_"+todayStr()+".xlsx");
  toast("XLSX exported.","success");
});

$("btnExportCRXLSX")?.addEventListener("click", () => {
  exportXLSX([["Date","Contract#","Receipt","Client","Particular","Amount"],...APP.cashReceived.map(r=>[r.date,r.contract_no,r.receipt,r.client,r.particular,r.amount])], "Cash Received", "CashReceived_"+todayStr()+".xlsx");
  toast("Exported.","success");
});
$("btnExportCEXLSX")?.addEventListener("click", () => {
  exportXLSX([["Date","Particular","Amount"],...APP.cashExpense.map(r=>[r.date,r.particular,r.amount])], "Cash Expense", "CashExpense_"+todayStr()+".xlsx");
  toast("Exported.","success");
});
$("btnExportBRXLSX")?.addEventListener("click", () => {
  exportXLSX([["Date","Contract#","Type","Client","Amount"],...APP.bankReceived.map(r=>[r.date,r.contract_no,r.type,r.client,r.amount])], "Bank Received", "BankReceived_"+todayStr()+".xlsx");
  toast("Exported.","success");
});
$("btnExportBEXLSX")?.addEventListener("click", () => {
  exportXLSX([["Date","CV","Check#","Particular","Withdraw"],...APP.bankExpense.map(r=>[r.date,r.cv,r.check_no,r.particular,r.withdraw])], "Bank Expense", "BankExpense_"+todayStr()+".xlsx");
  toast("Exported.","success");
});
$("btnExportPNBXLSX")?.addEventListener("click", () => {
  exportXLSX([["Date","Amount"],...APP.pnbDeposit.map(r=>[r.date,r.amount])], "PNB Deposit", "PNBDeposit_"+todayStr()+".xlsx");
  toast("Exported.","success");
});
$("btnExportDSWDXLSX")?.addEventListener("click", () => {
  exportXLSX([["Date","Contract#","Deceased","Contract Amt","Payment","Balance","DSWD Refund","After Tax","Date Received","Payable","Date Release","Beneficiary","DSWD Discount","Status"],
    ...APP.dswd.map(r=>[r.date,r.contract_no,r.deceased,r.contract_amt,r.payment,r.balance,r.dswd_refund,r.after_tax,r.date_received,r.payable,r.date_release,r.beneficiary,r.dswd_discount,r.status])],
    "DSWD", "DSWD_"+todayStr()+".xlsx");
  toast("Exported.","success");
});
$("btnExportBAIXLSX")?.addEventListener("click", () => {
  exportXLSX([["Date Applied","Contract#","Amount","Date Completed","Status"],...APP.bai.map(r=>[r.date_applied,r.contract_no,r.amount,r.date_completed,r.status])], "BAI", "BAI_"+todayStr()+".xlsx");
  toast("Exported.","success");
});

// Full backup
$("btnFullBackup")?.addEventListener("click", async () => {
  toast("Preparing backup…");
  const data = await DB.getAllDataForBackup();
  const wb   = XLSX.utils.book_new();
  const tables = ["branches","contracts","cash_received","cash_expense","bank_received","bank_expense","pnb_deposit","dswd","bai","settings"];
  tables.forEach(t => {
    if (data[t]?.length) {
      const headers = Object.keys(data[t][0]);
      const rows    = data[t].map(r=>headers.map(h=>r[h]));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([headers,...rows]), t.slice(0,31));
    }
  });
  XLSX.writeFile(wb, "MagallanesFull_Backup_"+todayStr()+".xlsx");
  toast("Full backup downloaded.","success");
});

$("btnFullBackupJSON")?.addEventListener("click", async () => {
  toast("Preparing JSON backup…");
  const data = await DB.getAllDataForBackup();
  const blob = new Blob([JSON.stringify(data,null,2)], {type:"application/json"});
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url; a.download = "MagallanesFull_Backup_"+todayStr()+".json";
  a.click(); URL.revokeObjectURL(url);
  toast("JSON backup downloaded.","success");
});

// ── MIGRATION / IMPORT ─────────────────────────────────────────
let _migrateData = null;

const dropZone  = $("dropZone");
const fileInput = $("fileInput");

dropZone?.addEventListener("click", () => fileInput?.click());
dropZone?.addEventListener("dragover", e=>{ e.preventDefault(); dropZone.classList.add("drag-over"); });
dropZone?.addEventListener("dragleave",  ()=> dropZone.classList.remove("drag-over"));
dropZone?.addEventListener("drop", e=>{
  e.preventDefault(); dropZone.classList.remove("drag-over");
  const f = e.dataTransfer.files[0];
  if (f) readMigrateFile(f);
});
fileInput?.addEventListener("change", () => {
  if (fileInput.files[0]) readMigrateFile(fileInput.files[0]);
});

function readMigrateFile(file) {
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const data = JSON.parse(e.target.result);
      _migrateData = data;
      showMigratePreview(data);
    } catch(err) {
      toast("Invalid JSON file: "+err.message, "error");
    }
  };
  reader.readAsText(file);
}

function showMigratePreview(data) {
  // Detect version
  const isV1 = !data._version || data._version < 2;
  const counts = {
    contracts:     (data.contracts||[]).length,
    cash_received: (data.cashReceived||data.cash_received||[]).length,
    cash_expense:  (data.cashExpense||data.cash_expense||[]).length,
    bank_received: (data.bankReceived||data.bank_received||[]).length,
    bank_expense:  (data.bankExpense||data.bank_expense||[]).length,
    pnb_deposit:   (data.pnbDeposit||data.pnb_deposit||[]).length,
    dswd:          (data.dswd||[]).length,
    bai:           (data.bai||[]).length,
  };

  $("migrateSummary").innerHTML = `
    <strong>File detected:</strong> ${isV1?"Old system (v1)":"New system backup (v2)"}<br/>
    ${Object.entries(counts).map(([k,v])=>`${k.replace(/_/g," ")}: <strong>${v} records</strong>`).join("<br/>")}
    ${isV1?"<br/><br/><em>Data will be automatically converted from the old format.</em>":""}
  `;

  // Branch target dropdown
  const sel = $("migrateBranchTarget");
  sel.innerHTML = APP.branches.map(b=>`<option value="${b.id}">${b.name}</option>`).join("");

  $("migratePreview").style.display = "block";
}

$("btnMigrateCancel")?.addEventListener("click", () => {
  $("migratePreview").style.display = "none";
  _migrateData = null;
  if (fileInput) fileInput.value = "";
});

$("btnMigrateConfirm")?.addEventListener("click", async () => {
  if (!_migrateData) return;
  const branchId = $("migrateBranchTarget")?.value;
  if (!branchId) { toast("Select a target branch.","error"); return; }

  $("btnMigrateConfirm").disabled = true;
  $("migrateProgress").style.display = "block";

  const data = _migrateData;
  const isV1 = !data._version || data._version < 2;

  // Helper: add branch_id and strip old id (let Supabase generate new UUIDs)
  function prep(rows, mapFn) {
    return (rows||[]).map(r => {
      const mapped = mapFn ? mapFn(r) : r;
      delete mapped.id;
      mapped.branch_id = branchId;
      return mapped;
    });
  }

  const tables = [
    { name:"contracts",    rows: prep(data.contracts, r=>({
    date:r.date||null,
    contract_no:r.contract||r.contract_no||null,
    deceased:r.deceased||null,
    casket:r.casket||null,
    address:r.address||null,
    amount:Number(r.amount)||0,
    inhaus:Number(r.inhaus)||0,
    bai:Number(r.bai)||0,
    gl:Number(r.gl)||0,
    gcash:Number(r.gcash)||0,
    cash:Number(r.cash)||0,
    discount:Number(r.discount)||0,
    last_payment:r.lastPayment||r.last_payment||"—",
  })) },
    { name:"cash_received",rows: prep(data.cashReceived||data.cash_received, r=>({
    date:r.date||null,
    contract_no:r.contract||r.contract_no||null,
    receipt:r.receipt||null,
    client:r.client||null,
    particular:r.particular||null,
    amount:Number(r.amount)||0,
  })) },
    { name:"cash_expense", rows: prep(data.cashExpense||data.cash_expense, r=>({
    date:r.date||null,
    particular:r.particular||null,
    amount:Number(r.amount)||0,
  })) },
    { name:"bank_received",rows: prep(data.bankReceived||data.bank_received, r=>({
    date:r.date||null,
    contract_no:r.contract||r.contract_no||null,
    type:r.type||null,
    client:r.client||null,
    amount:Number(r.amount)||0,
  })) },
    { name:"bank_expense", rows: prep(data.bankExpense||data.bank_expense, r=>({
    date:r.date||null,
    cv:r.cv||null,
    check_no:r.check||r.check_no||null,
    particular:r.particular||null,
    withdraw:Number(r.withdraw)||0,
  })) },
    { name:"pnb_deposit",  rows: prep(data.pnbDeposit||data.pnb_deposit, r=>({
    date:r.date||null,
    amount:Number(r.amount)||0,
  })) },
    { name:"dswd", rows: prep(data.dswd, r=>({
    date:r.date||null,
    contract_no:r.contract||r.contract_no||null,
    deceased:r.deceased||null,
    beneficiary:r.beneficiary||null,
    contract_amt:Number(r.contractAmt||r.contract_amt)||0,
    payment:Number(r.payment)||0,
    balance:Number(r.balance)||0,
    dswd_refund:Number(r.dswdRefund||r.dswd_refund)||0,
    after_tax:Number(r.afterTax||r.after_tax)||0,
    date_received:r.dateReceived||r.date_received||null,
    payable:Number(r.payable)||0,
    date_release:r.dateRelease||r.date_release||null,
    dswd_discount:Number(r.dswdDiscount||r.dswd_discount)||0,
    status:r.status||"Waiting",
  })) },
    { name:"bai", rows: prep(data.bai, r=>({
    date_applied:r.dateApplied||r.date_applied||null,
    contract_no:r.contract||r.contract_no||null,
    amount:Number(r.amount)||0,
    date_completed:r.dateCompleted||r.date_completed||null,
    status:r.status||"Pending",
  })) },
  ];

  let done = 0;
  const total = tables.length;
  try {
    for (const t of tables) {
      $("progressLabel").textContent = `Importing ${t.name} (${t.rows.length} records)…`;
      $("progressFill").style.width = Math.round((done/total)*100)+"%";
      if (t.rows.length) await DB.bulkInsert(t.name, t.rows);
      done++;
    }

    // Handle settings cash/bank balance from v1
    if (isV1 && data.settings) {
      await DB.saveSettings(branchId, {
        cashBalance:  data.settings.cash_balance||data.settings.cashBalance||0,
        bankBalance:  data.settings.bank_balance||data.settings.bankBalance||0,
        financeClerk: data.settings.finance_clerk||data.settings.financeClerk||"",
        accountant:   data.settings.accountant||"",
        financeManager: data.settings.finance_manager||data.settings.financeManager||"",
      });
    }

    $("progressFill").style.width = "100%";
    $("progressLabel").textContent = "Import complete!";
    $("btnMigrateConfirm").disabled = false;
    toast("Import successful! Reloading data…","success");
    setTimeout(async () => {
      await loadBranchData();
      $("migratePreview").style.display = "none";
      _migrateData = null;
      if (fileInput) fileInput.value = "";
      $("sigrateProgress").style.display = "none";
    }, 1200);
  } catch(err) {
    $("progressLabel").textContent = "Error: "+err.message;
    $("btnMigrateConfirm").disabled = false;
    toast("Import error: "+err.message, "error");
  }
});

// ── BOOT ──────────────────────────────────────────────────────
boot();
