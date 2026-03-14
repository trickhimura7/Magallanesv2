// ============================================================
//  supabase.js — Magallanes Funeral Services v2
//  Replace SUPABASE_URL and SUPABASE_KEY with your new project's values.
//  Find them in: Supabase Dashboard → Settings → API
// ============================================================

const SUPABASE_URL = "https://rslaiwxhvknkasiwdyzd.supabase.co";
const SUPABASE_KEY = "sb_publishable_aqLS435YLaMs7_yYGnQ8Pg_CWwZe88m";

const _sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
window._sb = _sb;

// ── AUTH ─────────────────────────────────────────────────────
window.Auth = {
  async signIn(email, password) {
    return _sb.auth.signInWithPassword({ email, password });
  },
  async signOut() {
    return _sb.auth.signOut();
  },
  async getSession() {
    const { data } = await _sb.auth.getSession();
    return data?.session || null;
  },
  async getUser() {
    const { data } = await _sb.auth.getUser();
    return data?.user || null;
  },
  onAuthChange(cb) {
    _sb.auth.onAuthStateChange((_event, session) => cb(session));
  }
};

// ── GENERIC HELPERS ───────────────────────────────────────────
async function dbSelect(table, filters = {}) {
  let q = _sb.from(table).select("*");
  for (const [col, val] of Object.entries(filters)) {
    if (val !== undefined && val !== null) q = q.eq(col, val);
  }
  q = q.order("created_at", { ascending: true });
  const { data, error } = await q;
  if (error) { console.error("dbSelect", table, error); return []; }
  return data || [];
}

async function dbUpsert(table, row) {
  const payload = { ...row };
  if (!payload.id) delete payload.id;
  const { data, error } = await _sb.from(table).upsert(payload, { onConflict: "id" }).select().single();
  if (error) { console.error("dbUpsert", table, error); return null; }
  return data;
}

async function dbDelete(table, id) {
  const { error } = await _sb.from(table).delete().eq("id", id);
  if (error) console.error("dbDelete", table, error);
  return !error;
}

async function dbDeleteWhere(table, col, val) {
  const { error } = await _sb.from(table).delete().eq(col, val);
  if (error) console.error("dbDeleteWhere", table, error);
  return !error;
}

// ── AUDIT LOG ─────────────────────────────────────────────────
async function logAudit(action, tableName, recordId, details = {}) {
  try {
    const user = await Auth.getUser();
    await _sb.from("audit_log").insert({
      branch_id:  window.APP?.currentBranchId || null,
      user_id:    user?.id || null,
      user_email: user?.email || null,
      action, table_name: tableName,
      record_id: recordId || null,
      details,
    });
  } catch (e) { console.warn("audit log failed", e); }
}

// ── PUBLIC DB API ─────────────────────────────────────────────
window.DB = {

  // Branches
  async getBranches()        { return dbSelect("branches"); },
  async saveBranch(r)        { return dbUpsert("branches", r); },
  async deleteBranch(id)     { return dbDelete("branches", id); },

  // User profiles
  async getUserProfiles()    { return dbSelect("user_profiles"); },
  async saveUserProfile(r)   { return dbUpsert("user_profiles", r); },
  async getMyProfile()       {
    const user = await Auth.getUser();
    if (!user) return null;
    const { data } = await _sb.from("user_profiles").select("*").eq("id", user.id).single();
    return data;
  },

  // Audit log
  async getAuditLog() {
    const { data } = await _sb.from("audit_log").select("*").order("created_at", { ascending: false }).limit(50);
    return data || [];
  },

  // Contracts
  async getContracts(branchId)      { return dbSelect("contracts",     { branch_id: branchId }); },
  async saveContract(r)              {
    const res = await dbUpsert("contracts", r);
    if (res) logAudit(r.id ? "UPDATE" : "INSERT", "contracts", res.id, { contract_no: r.contract_no });
    return res;
  },
  async deleteContract(id)           {
    logAudit("DELETE", "contracts", id);
    return dbDelete("contracts", id);
  },

  // Cash received
  async getCashReceived(branchId)    { return dbSelect("cash_received",  { branch_id: branchId }); },
  async saveCashReceived(r)          {
    const res = await dbUpsert("cash_received", r);
    if (res) logAudit(r.id ? "UPDATE" : "INSERT", "cash_received", res.id);
    return res;
  },
  async deleteCashReceived(id)       { logAudit("DELETE","cash_received",id); return dbDelete("cash_received", id); },

  // Cash expense
  async getCashExpense(branchId)     { return dbSelect("cash_expense",   { branch_id: branchId }); },
  async saveCashExpense(r)           {
    const res = await dbUpsert("cash_expense", r);
    if (res) logAudit(r.id ? "UPDATE" : "INSERT", "cash_expense", res.id);
    return res;
  },
  async deleteCashExpense(id)        { logAudit("DELETE","cash_expense",id); return dbDelete("cash_expense", id); },

  // Bank received
  async getBankReceived(branchId)    { return dbSelect("bank_received",  { branch_id: branchId }); },
  async saveBankReceived(r)          {
    const res = await dbUpsert("bank_received", r);
    if (res) logAudit(r.id ? "UPDATE" : "INSERT", "bank_received", res.id);
    return res;
  },
  async deleteBankReceived(id)       { logAudit("DELETE","bank_received",id); return dbDelete("bank_received", id); },

  // Bank expense
  async getBankExpense(branchId)     { return dbSelect("bank_expense",   { branch_id: branchId }); },
  async saveBankExpense(r)           {
    const res = await dbUpsert("bank_expense", r);
    if (res) logAudit(r.id ? "UPDATE" : "INSERT", "bank_expense", res.id);
    return res;
  },
  async deleteBankExpense(id)        { logAudit("DELETE","bank_expense",id); return dbDelete("bank_expense", id); },

  // PNB deposit
  async getPnbDeposit(branchId)      { return dbSelect("pnb_deposit",    { branch_id: branchId }); },
  async savePnbDeposit(r)            {
    const res = await dbUpsert("pnb_deposit", r);
    if (res) logAudit(r.id ? "UPDATE" : "INSERT", "pnb_deposit", res.id);
    return res;
  },
  async deletePnbDeposit(id)         { logAudit("DELETE","pnb_deposit",id); return dbDelete("pnb_deposit", id); },

  // DSWD
  async getDswd(branchId)            { return dbSelect("dswd",           { branch_id: branchId }); },
  async saveDswd(r)                  {
    const res = await dbUpsert("dswd", r);
    if (res) logAudit(r.id ? "UPDATE" : "INSERT", "dswd", res.id);
    return res;
  },
  async deleteDswd(id)               { logAudit("DELETE","dswd",id); return dbDelete("dswd", id); },

  // BAI
  async getBai(branchId)             { return dbSelect("bai",            { branch_id: branchId }); },
  async saveBai(r)                   {
    const res = await dbUpsert("bai", r);
    if (res) logAudit(r.id ? "UPDATE" : "INSERT", "bai", res.id);
    return res;
  },
  async deleteBai(id)                { logAudit("DELETE","bai",id); return dbDelete("bai", id); },

  // Settings
  async getSettings(branchId) {
    const { data } = await _sb.from("settings").select("*").eq("branch_id", branchId).maybeSingle();
    return data;
  },
  async saveSettings(branchId, obj) {
    const existing = await this.getSettings(branchId);
    const payload = {
      id:              existing?.id || undefined,
      branch_id:       branchId,
      cash_balance:    Number(obj.cashBalance)    || 0,
      bank_balance:    Number(obj.bankBalance)    || 0,
      finance_clerk:   obj.financeClerk   || "",
      accountant:      obj.accountant     || "",
      finance_manager: obj.financeManager || "",
      updated_at:      new Date().toISOString(),
    };
    if (!payload.id) delete payload.id;
    const { error } = await _sb.from("settings").upsert(payload, { onConflict: "id" });
    if (error) console.error("saveSettings", error);
  },

  // ── Full backup (admin — reads all branches) ──────────────
  async getAllDataForBackup() {
    const tables = ["contracts","cash_received","cash_expense","bank_received",
                    "bank_expense","pnb_deposit","dswd","bai","settings","branches"];
    const result = {};
    for (const t of tables) {
      const { data } = await _sb.from(t).select("*");
      result[t] = data || [];
    }
    result._exported_at = new Date().toISOString();
    result._version = 2;
    return result;
  },

  // ── Delete all data for a branch ──────────────────────────
  async deleteAllForBranch(branchId) {
    const tables = ["contracts","cash_received","cash_expense","bank_received",
                    "bank_expense","pnb_deposit","dswd","bai"];
    for (const t of tables) await dbDeleteWhere(t, "branch_id", branchId);
    const { error } = await _sb.from("settings")
      .upsert({ branch_id: branchId, cash_balance: 0, bank_balance: 0 }, { onConflict: "branch_id" });
    if (error) console.error("resetSettings", error);
  },

  // ── Migrate: insert array of rows into a table ────────────
  async bulkInsert(table, rows) {
    if (!rows || rows.length === 0) return;
    const CHUNK = 200;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      const { error } = await _sb.from(table).insert(chunk);
      if (error) { console.error("bulkInsert", table, error); throw error; }
    }
  },
};
