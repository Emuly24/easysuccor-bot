// database.js - PostgreSQL version for Render
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

let pool;

async function initDatabase() {
    // Get connection string from environment variable
    const connectionString = process.env.DATABASE_URL;
    
    if (!connectionString) {
        throw new Error('DATABASE_URL environment variable is not set');
    }
    
    pool = new Pool({
        connectionString: connectionString,
        ssl: {
            rejectUnauthorized: false  // Required for Render PostgreSQL
        }
    });
    
    // Test connection
    await pool.query('SELECT NOW()');
    console.log('✅ PostgreSQL database connected');
    
    // Create tables
    await createTables();
    
    return pool;
}

async function createTables() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS clients (
            id SERIAL PRIMARY KEY,
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
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            last_active TIMESTAMP
        )
    `);
    
    await pool.query(`
        CREATE TABLE IF NOT EXISTS sessions (
            id SERIAL PRIMARY KEY,
            client_id INTEGER,
            stage TEXT,
            current_section TEXT,
            data TEXT,
            is_paused INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP,
            FOREIGN KEY (client_id) REFERENCES clients(id)
        )
    `);
    
    await pool.query(`
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
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            delivered_at TIMESTAMP,
            reviewed_at TIMESTAMP,
            FOREIGN KEY (client_id) REFERENCES clients(id)
        )
    `);
    
    await pool.query(`
        CREATE TABLE IF NOT EXISTS cv_versions (
            id SERIAL PRIMARY KEY,
            order_id TEXT,
            version_number INTEGER,
            cv_data TEXT,
            changes TEXT,
            is_current INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (order_id) REFERENCES orders(id)
        )
    `);
    
    await pool.query(`
        CREATE TABLE IF NOT EXISTS feedback (
            id SERIAL PRIMARY KEY,
            order_id TEXT,
            rating INTEGER,
            review TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (order_id) REFERENCES orders(id)
        )
    `);
    
    await pool.query(`
        CREATE TABLE IF NOT EXISTS referrals (
            id SERIAL PRIMARY KEY,
            referrer_id INTEGER,
            referred_id INTEGER,
            referral_code TEXT,
            status TEXT DEFAULT 'pending',
            reward_claimed INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            completed_at TIMESTAMP,
            FOREIGN KEY (referrer_id) REFERENCES clients(id),
            FOREIGN KEY (referred_id) REFERENCES clients(id)
        )
    `);
    
    await pool.query(`
        CREATE TABLE IF NOT EXISTS installments (
            id SERIAL PRIMARY KEY,
            order_id TEXT UNIQUE,
            client_id INTEGER,
            data TEXT,
            status TEXT DEFAULT 'active',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP,
            FOREIGN KEY (order_id) REFERENCES orders(id),
            FOREIGN KEY (client_id) REFERENCES clients(id)
        )
    `);
    
    console.log('✅ All tables created');
}

// ============ CLIENT FUNCTIONS ============
async function getClient(telegramId) {
    const result = await pool.query('SELECT * FROM clients WHERE telegram_id = $1', [telegramId]);
    return result.rows[0];
}

async function createClient(telegramId, username, firstName, lastName) {
    const referralCode = Math.random().toString(36).substring(2, 10).toUpperCase();
    const result = await pool.query(
        `INSERT INTO clients (telegram_id, username, first_name, last_name, referral_code, last_active) 
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [telegramId, username, firstName, lastName, referralCode, new Date().toISOString()]
    );
    return result.rows[0];
}

async function updateClient(clientId, data) {
    const fields = [];
    const values = [];
    let paramIndex = 1;
    
    for (const [key, value] of Object.entries(data)) {
        if (value !== undefined && value !== null) {
            fields.push(`${key} = $${paramIndex}`);
            values.push(value);
            paramIndex++;
        }
    }
    values.push(new Date().toISOString(), clientId);
    
    await pool.query(
        `UPDATE clients SET ${fields.join(', ')}, last_active = $${paramIndex} WHERE id = $${paramIndex + 1}`,
        values
    );
}

async function getAllClients() {
    const result = await pool.query('SELECT * FROM clients ORDER BY created_at DESC');
    return result.rows;
}

// ============ SESSION FUNCTIONS ============
async function getActiveSession(clientId) {
    const result = await pool.query(
        `SELECT * FROM sessions WHERE client_id = $1 AND is_paused = 0 ORDER BY created_at DESC LIMIT 1`,
        [clientId]
    );
    return result.rows[0];
}

async function getPausedSession(clientId) {
    const result = await pool.query(
        `SELECT * FROM sessions WHERE client_id = $1 AND is_paused = 1 ORDER BY updated_at DESC LIMIT 1`,
        [clientId]
    );
    return result.rows[0];
}

async function saveSession(clientId, stage, currentSection, data, isPaused = 0) {
    await pool.query(`UPDATE sessions SET is_paused = 1 WHERE client_id = $1 AND is_paused = 0`, [clientId]);
    const result = await pool.query(
        `INSERT INTO sessions (client_id, stage, current_section, data, is_paused, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [clientId, stage, currentSection, JSON.stringify(data), isPaused ? 1 : 0, new Date().toISOString()]
    );
    return result.rows[0].id;
}

async function updateSession(sessionId, stage, currentSection, data, isPaused = 0) {
    await pool.query(
        `UPDATE sessions SET stage = $1, current_section = $2, data = $3, is_paused = $4, updated_at = $5 WHERE id = $6`,
        [stage, currentSection, JSON.stringify(data), isPaused ? 1 : 0, new Date().toISOString(), sessionId]
    );
}

// ============ ORDER FUNCTIONS ============
async function createOrder(orderData) {
    await pool.query(
        `INSERT INTO orders (id, client_id, service, category, delivery_option, delivery_time, base_price, delivery_fee, total_charge, payment_status, cv_data, certificates_appendix, portfolio_links, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
        [orderData.id, orderData.client_id, orderData.service, orderData.category,
         orderData.delivery_option, orderData.delivery_time, orderData.base_price,
         orderData.delivery_fee, orderData.total_charge, orderData.payment_status,
         JSON.stringify(orderData.cv_data), orderData.certificates_appendix, 
         orderData.portfolio_links || '[]', 'pending']
    );
    
    await pool.query(
        `UPDATE clients SET total_orders = total_orders + 1, total_spent = total_spent + $1 WHERE id = $2`,
        [parseInt(orderData.total_charge.replace('MK', '').replace(',', '')), orderData.client_id]
    );
    return orderData.id;
}

async function getOrder(orderId) {
    const result = await pool.query('SELECT * FROM orders WHERE id = $1', [orderId]);
    const order = result.rows[0];
    if (order && order.cv_data) order.cv_data = JSON.parse(order.cv_data);
    return order;
}

async function getClientOrders(clientId) {
    const result = await pool.query('SELECT * FROM orders WHERE client_id = $1 ORDER BY created_at DESC', [clientId]);
    return result.rows;
}

async function getAllOrders() {
    const result = await pool.query('SELECT * FROM orders ORDER BY created_at DESC');
    return result.rows;
}

async function getPendingPaymentOrders() {
    const result = await pool.query(`
        SELECT * FROM orders 
        WHERE payment_status = 'pending' 
        AND status != 'delivered'
        AND created_at <= NOW() - INTERVAL '3 days'
        ORDER BY created_at ASC
    `);
    return result.rows;
}

async function updateOrderStatus(orderId, status) {
    await pool.query(
        `UPDATE orders SET status = $1, delivered_at = $2 WHERE id = $3`,
        [status, status === 'delivered' ? new Date().toISOString() : null, orderId]
    );
}

async function updateOrderCVData(orderId, cvData) {
    await pool.query(
        `UPDATE orders SET cv_data = $1, updated_at = $2 WHERE id = $3`,
        [JSON.stringify(cvData), new Date().toISOString(), orderId]
    );
}

async function updatePaymentReminder(orderId, days) {
    await pool.query(
        `UPDATE orders SET reminder_sent = $1, last_reminder = $2 WHERE id = $3`,
        [days, new Date().toISOString(), orderId]
    );
}

// ============ CV VERSIONING FUNCTIONS ============
async function saveCVVersion(orderId, cvData, versionNumber, changes) {
    await pool.query(`UPDATE cv_versions SET is_current = 0 WHERE order_id = $1`, [orderId]);
    await pool.query(
        `INSERT INTO cv_versions (order_id, version_number, cv_data, changes, is_current, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [orderId, versionNumber, JSON.stringify(cvData), changes, 1, new Date().toISOString()]
    );
}

async function getCVVersions(orderId) {
    const result = await pool.query(
        `SELECT * FROM cv_versions WHERE order_id = $1 ORDER BY version_number DESC`,
        [orderId]
    );
    return result.rows;
}

async function getCVVersion(orderId, versionNumber) {
    const result = await pool.query(
        `SELECT * FROM cv_versions WHERE order_id = $1 AND version_number = $2`,
        [orderId, versionNumber]
    );
    return result.rows[0];
}

// ============ FEEDBACK FUNCTIONS ============
async function saveFeedback(orderId, rating, review) {
    await pool.query(
        `INSERT INTO feedback (order_id, rating, review) VALUES ($1, $2, $3)`,
        [orderId, rating, review]
    );
}

async function getAllFeedback() {
    const result = await pool.query('SELECT * FROM feedback ORDER BY created_at DESC');
    return result.rows;
}

// ============ REFERRAL FUNCTIONS ============
async function getReferralInfo(clientId) {
    const clientResult = await pool.query('SELECT referral_code FROM clients WHERE id = $1', [clientId]);
    const referralsResult = await pool.query(`SELECT * FROM referrals WHERE referrer_id = $1`, [clientId]);
    const completedReferrals = referralsResult.rows.filter(r => r.status === 'completed').length;
    const pendingReward = completedReferrals * (process.env.REFERRAL_DISCOUNT || 2000);
    return {
        referral_code: clientResult.rows[0]?.referral_code,
        total_referrals: referralsResult.rows.length,
        completed_referrals: completedReferrals,
        pending_reward: pendingReward
    };
}

async function applyReferral(referredId, referralCode) {
    const referrerResult = await pool.query('SELECT id FROM clients WHERE referral_code = $1', [referralCode]);
    const referrer = referrerResult.rows[0];
    if (referrer && referrer.id !== referredId) {
        await pool.query(
            `INSERT INTO referrals (referrer_id, referred_id, status) VALUES ($1, $2, $3)`,
            [referrer.id, referredId, 'pending']
        );
        return { success: true, referrer_id: referrer.id };
    }
    return { success: false };
}

async function getClientByReferralCode(referralCode) {
    const result = await pool.query('SELECT * FROM clients WHERE referral_code = $1', [referralCode]);
    return result.rows[0];
}

async function getClientById(clientId) {
    const result = await pool.query('SELECT * FROM clients WHERE id = $1', [clientId]);
    return result.rows[0];
}

async function recordReferral(referrerId, referredId, referralCode) {
    await pool.query(
        `INSERT INTO referrals (referrer_id, referred_id, referral_code, status, created_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [referrerId, referredId, referralCode, 'pending', new Date().toISOString()]
    );
    await pool.query(`UPDATE clients SET referred_by = $1 WHERE id = $2`, [referrerId, referredId]);
}

async function getPendingReferral(referrerId, referredId) {
    const result = await pool.query(
        `SELECT * FROM referrals WHERE referrer_id = $1 AND referred_id = $2 AND status = 'pending'`,
        [referrerId, referredId]
    );
    return result.rows[0];
}

async function updateReferralStatus(referralId, status) {
    await pool.query(
        `UPDATE referrals SET status = $1, completed_at = $2 WHERE id = $3`,
        [status, new Date().toISOString(), referralId]
    );
}

async function addReferralCredit(clientId, amount) {
    await pool.query(
        `UPDATE clients SET referral_credit = COALESCE(referral_credit, 0) + $1 WHERE id = $2`,
        [amount, clientId]
    );
}

async function getUserReferrals(clientId) {
    const result = await pool.query(`
        SELECT r.*, c.first_name as referred_name, c.telegram_id
        FROM referrals r
        JOIN clients c ON r.referred_id = c.id
        WHERE r.referrer_id = $1
        ORDER BY r.created_at DESC
    `, [clientId]);
    return result.rows;
}

async function applyReferralDiscount(clientId, orderAmount) {
    const clientResult = await pool.query('SELECT referred_by FROM clients WHERE id = $1', [clientId]);
    const client = clientResult.rows[0];
    if (client && client.referred_by) {
        const discount = Math.floor(orderAmount * 0.1);
        return { applied: true, discount, referrer_id: client.referred_by };
    }
    return { applied: false, discount: 0 };
}

// ============ INSTALLMENT FUNCTIONS ============
async function saveInstallment(installmentData) {
    await pool.query(
        `INSERT OR REPLACE INTO installments (order_id, client_id, data, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [installmentData.orderId, installmentData.clientId, JSON.stringify(installmentData),
         installmentData.status, installmentData.created_at, new Date().toISOString()]
    );
}

async function getInstallment(orderId) {
    const result = await pool.query('SELECT * FROM installments WHERE order_id = $1', [orderId]);
    if (result.rows[0] && result.rows[0].data) {
        return JSON.parse(result.rows[0].data);
    }
    return null;
}

async function updateInstallmentStatus(orderId, status) {
    await pool.query(
        `UPDATE installments SET status = $1, updated_at = $2 WHERE order_id = $3`,
        [status, new Date().toISOString(), orderId]
    );
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