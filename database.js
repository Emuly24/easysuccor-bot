// database.js - Complete SQLite database operations
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const path = require('path');

let db;

async function initDatabase() {
  db = await open({
    filename: path.join(__dirname, 'data', 'easysuccor.db'),
    driver: sqlite3.Database
  });

  await db.exec(`
    CREATE TABLE IF NOT EXISTS clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_id TEXT UNIQUE,
      username TEXT,
      first_name TEXT,
      last_name TEXT,
      phone TEXT,
      email TEXT,
      location TEXT,
      industry TEXT,
      experience_years INTEGER,
      referral_code TEXT UNIQUE,
      referred_by INTEGER,
      wallet_balance INTEGER DEFAULT 0,
      referral_credit INTEGER DEFAULT 0,
      total_orders INTEGER DEFAULT 0,
      total_spent INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_active DATETIME
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER,
      stage TEXT,
      current_section TEXT,
      data TEXT,
      is_paused INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME,
      FOREIGN KEY (client_id) REFERENCES clients(id)
    );

    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      client_id INTEGER,
      service TEXT,
      category TEXT,
      industry TEXT,
      template_style TEXT,
      delivery_option TEXT,
      delivery_time TEXT,
      base_price INTEGER,
      delivery_fee INTEGER,
      total_charge TEXT,
      payment_status TEXT,
      payment_method TEXT,
      cv_data TEXT,
      portfolio_links TEXT,
      certificates_appendix TEXT,
      status TEXT DEFAULT 'pending',
      version INTEGER DEFAULT 1,
      parent_order_id TEXT,
      reminder_sent INTEGER DEFAULT 0,
      last_reminder TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      delivered_at DATETIME,
      reviewed_at DATETIME,
      FOREIGN KEY (client_id) REFERENCES clients(id)
    );

    CREATE TABLE IF NOT EXISTS cv_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id TEXT,
      version_number INTEGER,
      cv_data TEXT,
      changes TEXT,
      is_current INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (order_id) REFERENCES orders(id)
    );

    CREATE TABLE IF NOT EXISTS feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id TEXT,
      rating INTEGER,
      review TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (order_id) REFERENCES orders(id)
    );

    CREATE TABLE IF NOT EXISTS referrals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      referrer_id INTEGER,
      referred_id INTEGER,
      referral_code TEXT,
      status TEXT DEFAULT 'pending',
      reward_claimed INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      completed_at DATETIME,
      FOREIGN KEY (referrer_id) REFERENCES clients(id),
      FOREIGN KEY (referred_id) REFERENCES clients(id)
    );

    CREATE TABLE IF NOT EXISTS installments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id TEXT UNIQUE,
      client_id INTEGER,
      data TEXT,
      status TEXT DEFAULT 'active',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME,
      FOREIGN KEY (order_id) REFERENCES orders(id),
      FOREIGN KEY (client_id) REFERENCES clients(id)
    );
  `);

  console.log('✅ Database initialized');
  return db;
}

// ============ CLIENT FUNCTIONS ============
async function getClient(telegramId) {
  return await db.get('SELECT * FROM clients WHERE telegram_id = ?', [telegramId]);
}

async function createClient(telegramId, username, firstName, lastName) {
  const referralCode = Math.random().toString(36).substring(2, 10).toUpperCase();
  const result = await db.run(
    `INSERT INTO clients (telegram_id, username, first_name, last_name, referral_code, last_active) 
     VALUES (?, ?, ?, ?, ?, ?)`,
    [telegramId, username, firstName, lastName, referralCode, new Date().toISOString()]
  );
  return await db.get('SELECT * FROM clients WHERE id = ?', [result.lastID]);
}

async function updateClient(clientId, data) {
  const fields = [];
  const values = [];
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined && value !== null) {
      fields.push(`${key} = ?`);
      values.push(value);
    }
  }
  values.push(new Date().toISOString(), clientId);
  await db.run(`UPDATE clients SET ${fields.join(', ')}, last_active = ? WHERE id = ?`, values);
}

async function getAllClients() {
  return await db.all('SELECT * FROM clients ORDER BY created_at DESC');
}

// ============ SESSION FUNCTIONS ============
async function getActiveSession(clientId) {
  return await db.get(
    `SELECT * FROM sessions WHERE client_id = ? AND is_paused = 0 ORDER BY created_at DESC LIMIT 1`,
    [clientId]
  );
}

async function getPausedSession(clientId) {
  return await db.get(
    `SELECT * FROM sessions WHERE client_id = ? AND is_paused = 1 ORDER BY updated_at DESC LIMIT 1`,
    [clientId]
  );
}

async function saveSession(clientId, stage, currentSection, data, isPaused = 0) {
  await db.run(`UPDATE sessions SET is_paused = 1 WHERE client_id = ? AND is_paused = 0`, [clientId]);
  const result = await db.run(
    `INSERT INTO sessions (client_id, stage, current_section, data, is_paused, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [clientId, stage, currentSection, JSON.stringify(data), isPaused ? 1 : 0, new Date().toISOString()]
  );
  return result.lastID;
}

async function updateSession(sessionId, stage, currentSection, data, isPaused = 0) {
  await db.run(
    `UPDATE sessions SET stage = ?, current_section = ?, data = ?, is_paused = ?, updated_at = ? WHERE id = ?`,
    [stage, currentSection, JSON.stringify(data), isPaused ? 1 : 0, new Date().toISOString(), sessionId]
  );
}

// ============ ORDER FUNCTIONS ============
async function createOrder(orderData) {
  await db.run(
    `INSERT INTO orders (id, client_id, service, category, delivery_option, delivery_time, base_price, delivery_fee, total_charge, payment_status, cv_data, certificates_appendix, portfolio_links, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [orderData.id, orderData.client_id, orderData.service, orderData.category,
     orderData.delivery_option, orderData.delivery_time, orderData.base_price,
     orderData.delivery_fee, orderData.total_charge, orderData.payment_status,
     JSON.stringify(orderData.cv_data), orderData.certificates_appendix, 
     orderData.portfolio_links || '[]', 'pending']
  );
  await db.run(`UPDATE clients SET total_orders = total_orders + 1, total_spent = total_spent + ? WHERE id = ?`,
    [parseInt(orderData.total_charge.replace('MK', '').replace(',', '')), orderData.client_id]);
  return orderData.id;
}

async function getOrder(orderId) {
  const order = await db.get('SELECT * FROM orders WHERE id = ?', [orderId]);
  if (order && order.cv_data) order.cv_data = JSON.parse(order.cv_data);
  return order;
}

async function getClientOrders(clientId) {
  return await db.all('SELECT * FROM orders WHERE client_id = ? ORDER BY created_at DESC', [clientId]);
}

async function getAllOrders() {
  return await db.all('SELECT * FROM orders ORDER BY created_at DESC');
}

async function getPendingPaymentOrders() {
  return await db.all(`
    SELECT * FROM orders 
    WHERE payment_status = 'pending' 
    AND status != 'delivered'
    AND created_at <= datetime('now', '-3 days')
    ORDER BY created_at ASC
  `);
}

async function updateOrderStatus(orderId, status) {
  await db.run(`UPDATE orders SET status = ?, delivered_at = ? WHERE id = ?`, 
    [status, status === 'delivered' ? new Date().toISOString() : null, orderId]);
}

async function updateOrderCVData(orderId, cvData) {
  await db.run(`UPDATE orders SET cv_data = ?, updated_at = ? WHERE id = ?`, 
    [JSON.stringify(cvData), new Date().toISOString(), orderId]);
}

async function updatePaymentReminder(orderId, days) {
  await db.run(`UPDATE orders SET reminder_sent = ?, last_reminder = ? WHERE id = ?`, 
    [days, new Date().toISOString(), orderId]);
}

// ============ CV VERSIONING FUNCTIONS ============
async function saveCVVersion(orderId, cvData, versionNumber, changes) {
  await db.run(`UPDATE cv_versions SET is_current = 0 WHERE order_id = ?`, [orderId]);
  await db.run(
    `INSERT INTO cv_versions (order_id, version_number, cv_data, changes, is_current, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [orderId, versionNumber, JSON.stringify(cvData), changes, 1, new Date().toISOString()]
  );
}

async function getCVVersions(orderId) {
  return await db.all(
    `SELECT * FROM cv_versions WHERE order_id = ? ORDER BY version_number DESC`,
    [orderId]
  );
}

async function getCVVersion(orderId, versionNumber) {
  return await db.get(
    `SELECT * FROM cv_versions WHERE order_id = ? AND version_number = ?`,
    [orderId, versionNumber]
  );
}

// ============ FEEDBACK FUNCTIONS ============
async function saveFeedback(orderId, rating, review) {
  await db.run(`INSERT INTO feedback (order_id, rating, review) VALUES (?, ?, ?)`, [orderId, rating, review]);
}

async function getAllFeedback() {
  return await db.all('SELECT * FROM feedback ORDER BY created_at DESC');
}

// ============ REFERRAL FUNCTIONS ============
async function getReferralInfo(clientId) {
  const client = await db.get('SELECT referral_code FROM clients WHERE id = ?', [clientId]);
  const referrals = await db.all(`SELECT * FROM referrals WHERE referrer_id = ?`, [clientId]);
  const completedReferrals = referrals.filter(r => r.status === 'completed').length;
  const pendingReward = completedReferrals * (process.env.REFERRAL_DISCOUNT || 2000);
  return {
    referral_code: client.referral_code,
    total_referrals: referrals.length,
    completed_referrals: completedReferrals,
    pending_reward: pendingReward
  };
}

async function applyReferral(referredId, referralCode) {
  const referrer = await db.get('SELECT id FROM clients WHERE referral_code = ?', [referralCode]);
  if (referrer && referrer.id !== referredId) {
    await db.run(`INSERT INTO referrals (referrer_id, referred_id, status) VALUES (?, ?, ?)`,
      [referrer.id, referredId, 'pending']);
    return { success: true, referrer_id: referrer.id };
  }
  return { success: false };
}

async function getClientByReferralCode(referralCode) {
  return await db.get('SELECT * FROM clients WHERE referral_code = ?', [referralCode]);
}

async function getClientById(clientId) {
  return await db.get('SELECT * FROM clients WHERE id = ?', [clientId]);
}

async function recordReferral(referrerId, referredId, referralCode) {
  const result = await db.run(`
    INSERT INTO referrals (referrer_id, referred_id, referral_code, status, created_at)
    VALUES (?, ?, ?, 'pending', ?)
  `, [referrerId, referredId, referralCode, new Date().toISOString()]);
  
  await db.run(`UPDATE clients SET referred_by = ? WHERE id = ?`, [referrerId, referredId]);
  
  return result.lastID;
}

async function getPendingReferral(referrerId, referredId) {
  return await db.get(`
    SELECT * FROM referrals 
    WHERE referrer_id = ? AND referred_id = ? AND status = 'pending'
  `, [referrerId, referredId]);
}

async function updateReferralStatus(referralId, status) {
  await db.run(`
    UPDATE referrals SET status = ?, completed_at = ? WHERE id = ?
  `, [status, new Date().toISOString(), referralId]);
}

async function addReferralCredit(clientId, amount) {
  await db.run(`
    UPDATE clients SET referral_credit = COALESCE(referral_credit, 0) + ? WHERE id = ?
  `, [amount, clientId]);
}

async function getUserReferrals(clientId) {
  return await db.all(`
    SELECT r.*, c.first_name as referred_name, c.telegram_id
    FROM referrals r
    JOIN clients c ON r.referred_id = c.id
    WHERE r.referrer_id = ?
    ORDER BY r.created_at DESC
  `, [clientId]);
}

async function applyReferralDiscount(clientId, orderAmount) {
  const client = await db.get('SELECT referred_by FROM clients WHERE id = ?', [clientId]);
  
  if (client && client.referred_by) {
    const discount = Math.floor(orderAmount * 0.1);
    return { applied: true, discount, referrer_id: client.referred_by };
  }
  
  return { applied: false, discount: 0 };
}

// ============ INSTALLMENT FUNCTIONS ============
async function saveInstallment(installmentData) {
  await db.run(`
    INSERT OR REPLACE INTO installments 
    (order_id, client_id, data, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [installmentData.orderId, installmentData.clientId, JSON.stringify(installmentData), 
        installmentData.status, installmentData.created_at, new Date().toISOString()]);
}

async function getInstallment(orderId) {
  const record = await db.get('SELECT * FROM installments WHERE order_id = ?', [orderId]);
  if (record && record.data) {
    return JSON.parse(record.data);
  }
  return null;
}

async function updateInstallmentStatus(orderId, status) {
  await db.run(`
    UPDATE installments SET status = ?, updated_at = ? WHERE order_id = ?
  `, [status, new Date().toISOString(), orderId]);
}

// ============ EXPORT ALL FUNCTIONS ============
module.exports = {
  initDatabase,
  getClient,
  createClient,
  updateClient,
  getAllClients,
  getActiveSession,
  getPausedSession,
  saveSession,
  updateSession,
  createOrder,
  getOrder,
  getClientOrders,
  getAllOrders,
  getPendingPaymentOrders,
  updateOrderStatus,
  updateOrderCVData,
  updatePaymentReminder,
  saveCVVersion,
  getCVVersions,
  getCVVersion,
  saveFeedback,
  getAllFeedback,
  getReferralInfo,
  applyReferral,
  getClientByReferralCode,
  getClientById,
  recordReferral,
  getPendingReferral,
  updateReferralStatus,
  addReferralCredit,
  getUserReferrals,
  applyReferralDiscount,
  saveInstallment,
  getInstallment,
  updateInstallmentStatus
};