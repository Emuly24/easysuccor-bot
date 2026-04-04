// database.js - SQLite database operations
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
      status TEXT DEFAULT 'pending',
      version INTEGER DEFAULT 1,
      parent_order_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      delivered_at DATETIME,
      reviewed_at DATETIME,
      FOREIGN KEY (client_id) REFERENCES clients(id)
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
      status TEXT DEFAULT 'pending',
      reward_claimed INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      completed_at DATETIME,
      FOREIGN KEY (referrer_id) REFERENCES clients(id),
      FOREIGN KEY (referred_id) REFERENCES clients(id)
    );
  `);

  console.log('✅ Database initialized');
  return db;
}

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

async function createOrder(orderData) {
  await db.run(
    `INSERT INTO orders (id, client_id, service, category, delivery_option, delivery_time, base_price, delivery_fee, total_charge, payment_status, cv_data, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [orderData.id, orderData.client_id, orderData.service, orderData.category,
     orderData.delivery_option, orderData.delivery_time, orderData.base_price,
     orderData.delivery_fee, orderData.total_charge, orderData.payment_status,
     JSON.stringify(orderData.cv_data), 'pending']
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

async function getReferralInfo(clientId) {
  const client = await db.get('SELECT referral_code FROM clients WHERE id = ?', [clientId]);
  const referrals = await db.all(
    `SELECT * FROM referrals WHERE referrer_id = ?`,
    [clientId]
  );
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

async function saveFeedback(orderId, rating, review) {
  await db.run(`INSERT INTO feedback (order_id, rating, review) VALUES (?, ?, ?)`, [orderId, rating, review]);
}

module.exports = {
  initDatabase,
  getClient,
  createClient,
  updateClient,
  getActiveSession,
  getPausedSession,
  saveSession,
  updateSession,
  createOrder,
  getOrder,
  getReferralInfo,
  applyReferral,
  saveFeedback
};