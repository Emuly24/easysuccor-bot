// database.js - Updated for Railway with Error Reports
const fs = require('fs');
const path = require('path');

let db;
let dbType = 'sqlite';

async function initDatabase() {
    // Railway sets NODE_ENV=production automatically
    const isProduction = process.env.NODE_ENV === 'production';
    
    if (isProduction) {
        // Use PostgreSQL on Railway
        const { Pool } = require('pg');
        
        const connectionString = process.env.DATABASE_URL;
        
        if (!connectionString) {
            throw new Error('DATABASE_URL environment variable is not set on Railway');
        }
        
        const pool = new Pool({
            connectionString: connectionString,
            ssl: { rejectUnauthorized: false }
        });
        
        // Test connection
        await pool.query('SELECT NOW()');
        console.log('✅ PostgreSQL database connected on Railway');
        
        await createTablesPostgres(pool);
        
        db = pool;
        dbType = 'postgres';
        return db;
    } else {
        // Use SQLite locally for development
        const sqlite3 = require('sqlite3');
        const { open } = require('sqlite');
        
        const dataDir = path.join(__dirname, 'data');
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }
        
        const sqliteDb = await open({
            filename: path.join(dataDir, 'easysuccor.db'),
            driver: sqlite3.Database
        });
        
        console.log('✅ SQLite database connected (local development)');
        
        await createTablesSQLite(sqliteDb);
        
        db = sqliteDb;
        dbType = 'sqlite';
        return db;
    }
}

// PostgreSQL table creation
async function createTablesPostgres(pool) {
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
            physical_address TEXT,
            nationality TEXT,
            special_documents TEXT,
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
            payment_type TEXT DEFAULT 'standard',
            installment_status TEXT,
            pay_later_status TEXT,
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
            client_id INTEGER,
            order_id TEXT,
            rating INTEGER,
            feedback TEXT,
            liked_most TEXT,
            improvement_suggestions TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (client_id) REFERENCES clients(id),
            FOREIGN KEY (order_id) REFERENCES orders(id)
        )
    `);
    
    await pool.query(`
        CREATE TABLE IF NOT EXISTS testimonials (
            id SERIAL PRIMARY KEY,
            client_id INTEGER,
            name TEXT,
            text TEXT,
            rating INTEGER,
            position TEXT,
            company TEXT,
            approved BOOLEAN DEFAULT FALSE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            approved_at TIMESTAMP,
            FOREIGN KEY (client_id) REFERENCES clients(id)
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
    
    await pool.query(`
        CREATE TABLE IF NOT EXISTS pay_later (
            id SERIAL PRIMARY KEY,
            order_id TEXT UNIQUE,
            client_id INTEGER,
            data TEXT,
            status TEXT DEFAULT 'pending',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP,
            FOREIGN KEY (order_id) REFERENCES orders(id),
            FOREIGN KEY (client_id) REFERENCES clients(id)
        )
    `);
    
    await pool.query(`
        CREATE TABLE IF NOT EXISTS admin_logs (
            id SERIAL PRIMARY KEY,
            admin_id TEXT,
            action TEXT,
            details TEXT,
            timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);
    
    await pool.query(`
        CREATE TABLE IF NOT EXISTS document_reviews (
            id SERIAL PRIMARY KEY,
            order_id TEXT,
            version INTEGER,
            document_path TEXT,
            status TEXT,
            review_type TEXT,
            feedback TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (order_id) REFERENCES orders(id)
        )
    `);
    
    await pool.query(`
        CREATE TABLE IF NOT EXISTS error_reports (
            id SERIAL PRIMARY KEY,
            client_id INTEGER,
            file_id TEXT,
            description TEXT,
            status TEXT DEFAULT 'pending',
            resolution_notes TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            resolved_at TIMESTAMP,
            FOREIGN KEY (client_id) REFERENCES clients(id)
        )
    `);
    
    console.log('✅ PostgreSQL tables created');
}

// SQLite table creation (for local development)
async function createTablesSQLite(db) {
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
            physical_address TEXT,
            nationality TEXT,
            special_documents TEXT,
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
        )
    `);
    
    await db.exec(`
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
        )
    `);
    
    await db.exec(`
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
            payment_type TEXT DEFAULT 'standard',
            installment_status TEXT,
            pay_later_status TEXT,
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
        )
    `);
    
    await db.exec(`
        CREATE TABLE IF NOT EXISTS cv_versions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_id TEXT,
            version_number INTEGER,
            cv_data TEXT,
            changes TEXT,
            is_current INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (order_id) REFERENCES orders(id)
        )
    `);
    
    await db.exec(`
        CREATE TABLE IF NOT EXISTS feedback (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            client_id INTEGER,
            order_id TEXT,
            rating INTEGER,
            feedback TEXT,
            liked_most TEXT,
            improvement_suggestions TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (client_id) REFERENCES clients(id),
            FOREIGN KEY (order_id) REFERENCES orders(id)
        )
    `);
    
    await db.exec(`
        CREATE TABLE IF NOT EXISTS testimonials (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            client_id INTEGER,
            name TEXT,
            text TEXT,
            rating INTEGER,
            position TEXT,
            company TEXT,
            approved BOOLEAN DEFAULT FALSE,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            approved_at DATETIME,
            FOREIGN KEY (client_id) REFERENCES clients(id)
        )
    `);
    
    await db.exec(`
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
        )
    `);
    
    await db.exec(`
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
        )
    `);
    
    await db.exec(`
        CREATE TABLE IF NOT EXISTS pay_later (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_id TEXT UNIQUE,
            client_id INTEGER,
            data TEXT,
            status TEXT DEFAULT 'pending',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME,
            FOREIGN KEY (order_id) REFERENCES orders(id),
            FOREIGN KEY (client_id) REFERENCES clients(id)
        )
    `);
    
    await db.exec(`
        CREATE TABLE IF NOT EXISTS admin_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            admin_id TEXT,
            action TEXT,
            details TEXT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
    
    await db.exec(`
        CREATE TABLE IF NOT EXISTS document_reviews (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_id TEXT,
            version INTEGER,
            document_path TEXT,
            status TEXT,
            review_type TEXT,
            feedback TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (order_id) REFERENCES orders(id)
        )
    `);
    
    await db.exec(`
        CREATE TABLE IF NOT EXISTS error_reports (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            client_id INTEGER,
            file_id TEXT,
            description TEXT,
            status TEXT DEFAULT 'pending',
            resolution_notes TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            resolved_at DATETIME,
            FOREIGN KEY (client_id) REFERENCES clients(id)
        )
    `);
    
    console.log('✅ SQLite tables created');
}

// ============ EXPORT ALL FUNCTIONS ============
module.exports = {
    initDatabase,
    
    // Client functions
    getClient: async (telegramId) => {
        if (dbType === 'postgres') {
            const result = await db.query('SELECT * FROM clients WHERE telegram_id = $1', [telegramId]);
            return result.rows[0];
        } else {
            return await db.get('SELECT * FROM clients WHERE telegram_id = ?', [telegramId]);
        }
    },
    
    getClientByEmail: async (email) => {
        if (dbType === 'postgres') {
            const result = await db.query('SELECT * FROM clients WHERE email = $1', [email]);
            return result.rows[0];
        } else {
            return await db.get('SELECT * FROM clients WHERE email = ?', [email]);
        }
    },
    
    getClientByPhone: async (phone) => {
        if (dbType === 'postgres') {
            const result = await db.query('SELECT * FROM clients WHERE phone = $1', [phone]);
            return result.rows[0];
        } else {
            return await db.get('SELECT * FROM clients WHERE phone = ?', [phone]);
        }
    },
    
    getClientByReferralCode: async (referralCode) => {
        if (dbType === 'postgres') {
            const result = await db.query('SELECT * FROM clients WHERE referral_code = $1', [referralCode]);
            return result.rows[0];
        } else {
            return await db.get('SELECT * FROM clients WHERE referral_code = ?', [referralCode]);
        }
    },
    
    createClient: async (telegramId, username, firstName, lastName) => {
        const referralCode = Math.random().toString(36).substring(2, 10).toUpperCase();
        
        if (dbType === 'postgres') {
            const result = await db.query(
                `INSERT INTO clients (telegram_id, username, first_name, last_name, referral_code, last_active) 
                 VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
                [telegramId, username, firstName, lastName, referralCode, new Date().toISOString()]
            );
            return result.rows[0];
        } else {
            const result = await db.run(
                `INSERT INTO clients (telegram_id, username, first_name, last_name, referral_code, last_active) 
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [telegramId, username, firstName, lastName, referralCode, new Date().toISOString()]
            );
            return await db.get('SELECT * FROM clients WHERE id = ?', [result.lastID]);
        }
    },
    
    getClientById: async (clientId) => {
        if (dbType === 'postgres') {
            const result = await db.query('SELECT * FROM clients WHERE id = $1', [clientId]);
            return result.rows[0];
        } else {
            return await db.get('SELECT * FROM clients WHERE id = ?', [clientId]);
        }
    },
    
    getClientByName: async (name) => {
        if (dbType === 'postgres') {
            const result = await db.query('SELECT * FROM clients WHERE first_name ILIKE $1 OR last_name ILIKE $1 LIMIT 1', [`%${name}%`]);
            return result.rows[0];
        } else {
            return await db.get('SELECT * FROM clients WHERE first_name LIKE ? OR last_name LIKE ? LIMIT 1', [`%${name}%`, `%${name}%`]);
        }
    },
    
    updateClient: async (clientId, data) => {
        const fields = [];
        const values = [];
        let paramIndex = 1;
        
        for (const [key, value] of Object.entries(data)) {
            if (value !== undefined && value !== null) {
                if (dbType === 'postgres') {
                    fields.push(`${key} = $${paramIndex}`);
                } else {
                    fields.push(`${key} = ?`);
                }
                values.push(value);
                paramIndex++;
            }
        }
        values.push(new Date().toISOString(), clientId);
        
        if (dbType === 'postgres') {
            await db.query(
                `UPDATE clients SET ${fields.join(', ')}, last_active = $${paramIndex} WHERE id = $${paramIndex + 1}`,
                values
            );
        } else {
            await db.run(
                `UPDATE clients SET ${fields.join(', ')}, last_active = ? WHERE id = ?`,
                values
            );
        }
    },
    
    getAllClients: async () => {
        if (dbType === 'postgres') {
            const result = await db.query('SELECT * FROM clients ORDER BY created_at DESC');
            return result.rows;
        } else {
            return await db.all('SELECT * FROM clients ORDER BY created_at DESC');
        }
    },
    
    deleteClientData: async (clientId) => {
        if (dbType === 'postgres') {
            await db.query('DELETE FROM error_reports WHERE client_id = $1', [clientId]);
            await db.query('DELETE FROM orders WHERE client_id = $1', [clientId]);
            await db.query('DELETE FROM sessions WHERE client_id = $1', [clientId]);
            await db.query('DELETE FROM feedback WHERE client_id = $1', [clientId]);
            await db.query('DELETE FROM referrals WHERE referrer_id = $1 OR referred_id = $1', [clientId]);
            await db.query('DELETE FROM clients WHERE id = $1', [clientId]);
        } else {
            await db.run('DELETE FROM error_reports WHERE client_id = ?', [clientId]);
            await db.run('DELETE FROM orders WHERE client_id = ?', [clientId]);
            await db.run('DELETE FROM sessions WHERE client_id = ?', [clientId]);
            await db.run('DELETE FROM feedback WHERE client_id = ?', [clientId]);
            await db.run('DELETE FROM referrals WHERE referrer_id = ? OR referred_id = ?', [clientId, clientId]);
            await db.run('DELETE FROM clients WHERE id = ?', [clientId]);
        }
    },
    
    clearAllData: async () => {
        if (dbType === 'postgres') {
            const tables = ['orders', 'sessions', 'feedback', 'referrals', 'clients', 'admin_logs', 'document_reviews', 'cv_versions', 'testimonials', 'installments', 'pay_later', 'error_reports'];
            for (const table of tables) {
                await db.query(`DELETE FROM ${table}`);
            }
            await db.query('ALTER SEQUENCE clients_id_seq RESTART WITH 1');
            await db.query('ALTER SEQUENCE sessions_id_seq RESTART WITH 1');
            await db.query('ALTER SEQUENCE feedback_id_seq RESTART WITH 1');
            await db.query('ALTER SEQUENCE referrals_id_seq RESTART WITH 1');
            await db.query('ALTER SEQUENCE testimonials_id_seq RESTART WITH 1');
            await db.query('ALTER SEQUENCE installments_id_seq RESTART WITH 1');
            await db.query('ALTER SEQUENCE pay_later_id_seq RESTART WITH 1');
            await db.query('ALTER SEQUENCE admin_logs_id_seq RESTART WITH 1');
            await db.query('ALTER SEQUENCE document_reviews_id_seq RESTART WITH 1');
            await db.query('ALTER SEQUENCE cv_versions_id_seq RESTART WITH 1');
            await db.query('ALTER SEQUENCE error_reports_id_seq RESTART WITH 1');
            console.log('✅ All data cleared');
        } else {
            await db.run('DELETE FROM orders');
            await db.run('DELETE FROM sessions');
            await db.run('DELETE FROM feedback');
            await db.run('DELETE FROM referrals');
            await db.run('DELETE FROM clients');
            await db.run('DELETE FROM admin_logs');
            await db.run('DELETE FROM document_reviews');
            await db.run('DELETE FROM cv_versions');
            await db.run('DELETE FROM testimonials');
            await db.run('DELETE FROM installments');
            await db.run('DELETE FROM pay_later');
            await db.run('DELETE FROM error_reports');
            await db.run('DELETE FROM sqlite_sequence');
            console.log('✅ All data cleared');
        }
    },
    
    // Session functions
    getActiveSession: async (clientId) => {
        if (dbType === 'postgres') {
            const result = await db.query(
                `SELECT * FROM sessions WHERE client_id = $1 AND is_paused = 0 ORDER BY created_at DESC LIMIT 1`,
                [clientId]
            );
            return result.rows[0];
        } else {
            return await db.get(
                `SELECT * FROM sessions WHERE client_id = ? AND is_paused = 0 ORDER BY created_at DESC LIMIT 1`,
                [clientId]
            );
        }
    },
    
    getPausedSession: async (clientId) => {
        if (dbType === 'postgres') {
            const result = await db.query(
                `SELECT * FROM sessions WHERE client_id = $1 AND is_paused = 1 ORDER BY updated_at DESC LIMIT 1`,
                [clientId]
            );
            return result.rows[0];
        } else {
            return await db.get(
                `SELECT * FROM sessions WHERE client_id = ? AND is_paused = 1 ORDER BY updated_at DESC LIMIT 1`,
                [clientId]
            );
        }
    },
    
    saveSession: async (clientId, stage, currentSection, data, isPaused = 0) => {
        if (dbType === 'postgres') {
            await db.query(`UPDATE sessions SET is_paused = 1 WHERE client_id = $1 AND is_paused = 0`, [clientId]);
            const result = await db.query(
                `INSERT INTO sessions (client_id, stage, current_section, data, is_paused, updated_at)
                 VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
                [clientId, stage, currentSection, JSON.stringify(data), isPaused ? 1 : 0, new Date().toISOString()]
            );
            return result.rows[0].id;
        } else {
            await db.run(`UPDATE sessions SET is_paused = 1 WHERE client_id = ? AND is_paused = 0`, [clientId]);
            const result = await db.run(
                `INSERT INTO sessions (client_id, stage, current_section, data, is_paused, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [clientId, stage, currentSection, JSON.stringify(data), isPaused ? 1 : 0, new Date().toISOString()]
            );
            return result.lastID;
        }
    },
    
    updateSession: async (sessionId, stage, currentSection, data, isPaused = 0) => {
        if (dbType === 'postgres') {
            await db.query(
                `UPDATE sessions SET stage = $1, current_section = $2, data = $3, is_paused = $4, updated_at = $5 WHERE id = $6`,
                [stage, currentSection, JSON.stringify(data), isPaused ? 1 : 0, new Date().toISOString(), sessionId]
            );
        } else {
            await db.run(
                `UPDATE sessions SET stage = ?, current_section = ?, data = ?, is_paused = ?, updated_at = ? WHERE id = ?`,
                [stage, currentSection, JSON.stringify(data), isPaused ? 1 : 0, new Date().toISOString(), sessionId]
            );
        }
    },
    
    endSession: async (clientId) => {
        if (dbType === 'postgres') {
            await db.query(`UPDATE sessions SET is_paused = 1 WHERE client_id = $1 AND is_paused = 0`, [clientId]);
        } else {
            await db.run(`UPDATE sessions SET is_paused = 1 WHERE client_id = ? AND is_paused = 0`, [clientId]);
        }
    },
    
    // Order functions
    createOrder: async (orderData) => {
        if (dbType === 'postgres') {
            await db.query(
                `INSERT INTO orders (id, client_id, service, category, delivery_option, delivery_time, base_price, delivery_fee, total_charge, payment_status, payment_type, cv_data, certificates_appendix, portfolio_links, status)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
                [orderData.id, orderData.client_id, orderData.service, orderData.category,
                 orderData.delivery_option, orderData.delivery_time, orderData.base_price,
                 orderData.delivery_fee, orderData.total_charge, orderData.payment_status,
                 orderData.payment_type || 'standard', JSON.stringify(orderData.cv_data), 
                 orderData.certificates_appendix, orderData.portfolio_links || '[]', 'pending']
            );
            
            await db.query(
                `UPDATE clients SET total_orders = total_orders + 1, total_spent = total_spent + $1 WHERE id = $2`,
                [parseInt(String(orderData.total_charge).replace(/[^0-9]/g, '')), orderData.client_id]
            );
        } else {
            await db.run(
                `INSERT INTO orders (id, client_id, service, category, delivery_option, delivery_time, base_price, delivery_fee, total_charge, payment_status, payment_type, cv_data, certificates_appendix, portfolio_links, status)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [orderData.id, orderData.client_id, orderData.service, orderData.category,
                 orderData.delivery_option, orderData.delivery_time, orderData.base_price,
                 orderData.delivery_fee, orderData.total_charge, orderData.payment_status,
                 orderData.payment_type || 'standard', JSON.stringify(orderData.cv_data), 
                 orderData.certificates_appendix, orderData.portfolio_links || '[]', 'pending']
            );
            
            await db.run(
                `UPDATE clients SET total_orders = total_orders + 1, total_spent = total_spent + ? WHERE id = ?`,
                [parseInt(String(orderData.total_charge).replace(/[^0-9]/g, '')), orderData.client_id]
            );
        }
        return orderData.id;
    },
    
    getOrder: async (orderId) => {
        if (dbType === 'postgres') {
            const result = await db.query('SELECT * FROM orders WHERE id = $1', [orderId]);
            const order = result.rows[0];
            if (order && order.cv_data) order.cv_data = JSON.parse(order.cv_data);
            return order;
        } else {
            const order = await db.get('SELECT * FROM orders WHERE id = ?', [orderId]);
            if (order && order.cv_data) order.cv_data = JSON.parse(order.cv_data);
            return order;
        }
    },
    
    getClientOrders: async (clientId) => {
        if (dbType === 'postgres') {
            const result = await db.query('SELECT * FROM orders WHERE client_id = $1 ORDER BY created_at DESC', [clientId]);
            return result.rows;
        } else {
            return await db.all('SELECT * FROM orders WHERE client_id = ? ORDER BY created_at DESC', [clientId]);
        }
    },
    
    getAllOrders: async () => {
        if (dbType === 'postgres') {
            const result = await db.query('SELECT * FROM orders ORDER BY created_at DESC');
            return result.rows;
        } else {
            return await db.all('SELECT * FROM orders ORDER BY created_at DESC');
        }
    },
    
    getPendingPaymentOrders: async () => {
        if (dbType === 'postgres') {
            const result = await db.query("SELECT * FROM orders WHERE payment_status = 'pending' AND status != 'cancelled' ORDER BY created_at ASC");
            return result.rows;
        } else {
            return await db.all("SELECT * FROM orders WHERE payment_status = 'pending' AND status != 'cancelled' ORDER BY created_at ASC");
        }
    },
    
    updateOrderStatus: async (orderId, status) => {
        if (dbType === 'postgres') {
            await db.query(
                `UPDATE orders SET status = $1, delivered_at = $2 WHERE id = $3`,
                [status, status === 'delivered' ? new Date().toISOString() : null, orderId]
            );
        } else {
            await db.run(
                `UPDATE orders SET status = ?, delivered_at = ? WHERE id = ?`,
                [status, status === 'delivered' ? new Date().toISOString() : null, orderId]
            );
        }
    },
    
    updateOrderPaymentStatus: async (orderId, status) => {
        if (dbType === 'postgres') {
            await db.query(`UPDATE orders SET payment_status = $1 WHERE id = $2`, [status, orderId]);
        } else {
            await db.run(`UPDATE orders SET payment_status = ? WHERE id = ?`, [status, orderId]);
        }
    },
    
    updatePaymentReminder: async (orderId, daysSince) => {
        if (dbType === 'postgres') {
            await db.query(
                `UPDATE orders SET reminder_sent = reminder_sent + 1, last_reminder = $1 WHERE id = $2`,
                [`${daysSince} days`, orderId]
            );
        } else {
            await db.run(
                `UPDATE orders SET reminder_sent = reminder_sent + 1, last_reminder = ? WHERE id = ?`,
                [`${daysSince} days`, orderId]
            );
        }
    },
    
    // Document Reviews
    saveDocumentReview: async (data) => {
        if (dbType === 'postgres') {
            const result = await db.query(
                `INSERT INTO document_reviews (order_id, version, document_path, status, review_type, feedback, created_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
                [data.order_id, data.version, data.document_path, data.status, data.review_type, data.feedback || null, new Date().toISOString()]
            );
            return result.rows[0].id;
        } else {
            const result = await db.run(
                `INSERT INTO document_reviews (order_id, version, document_path, status, review_type, feedback, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [data.order_id, data.version, data.document_path, data.status, data.review_type, data.feedback || null, new Date().toISOString()]
            );
            return result.lastID;
        }
    },
    
    getDocumentReviews: async (orderId) => {
        if (dbType === 'postgres') {
            const result = await db.query(`SELECT * FROM document_reviews WHERE order_id = $1 ORDER BY version ASC`, [orderId]);
            return result.rows;
        } else {
            return await db.all(`SELECT * FROM document_reviews WHERE order_id = ? ORDER BY version ASC`, [orderId]);
        }
    },
    
    // Admin logs
    logAdminAction: async (data) => {
        if (dbType === 'postgres') {
            await db.query(
                `INSERT INTO admin_logs (admin_id, action, details, timestamp) VALUES ($1, $2, $3, $4)`,
                [data.admin_id, data.action, data.details, data.timestamp || new Date().toISOString()]
            );
        } else {
            await db.run(
                `INSERT INTO admin_logs (admin_id, action, details, timestamp) VALUES (?, ?, ?, ?)`,
                [data.admin_id, data.action, data.details, data.timestamp || new Date().toISOString()]
            );
        }
    },
    
    getAdminLogs: async (limit = 100) => {
        if (dbType === 'postgres') {
            const result = await db.query(`SELECT * FROM admin_logs ORDER BY timestamp DESC LIMIT $1`, [limit]);
            return result.rows;
        } else {
            return await db.all(`SELECT * FROM admin_logs ORDER BY timestamp DESC LIMIT ?`, [limit]);
        }
    },
    
    // Referral functions
    recordReferral: async (referrerId, referredId, referralCode) => {
        if (dbType === 'postgres') {
            await db.query(
                `INSERT INTO referrals (referrer_id, referred_id, referral_code, status, created_at)
                 VALUES ($1, $2, $3, 'pending', $4)`,
                [referrerId, referredId, referralCode, new Date().toISOString()]
            );
            await db.query(`UPDATE clients SET referred_by = $1 WHERE id = $2`, [referrerId, referredId]);
        } else {
            await db.run(
                `INSERT INTO referrals (referrer_id, referred_id, referral_code, status, created_at)
                 VALUES (?, ?, ?, 'pending', ?)`,
                [referrerId, referredId, referralCode, new Date().toISOString()]
            );
            await db.run(`UPDATE clients SET referred_by = ? WHERE id = ?`, [referrerId, referredId]);
        }
    },
    
    getPendingReferral: async (referrerId, referredId) => {
        if (dbType === 'postgres') {
            const result = await db.query(
                `SELECT * FROM referrals WHERE referrer_id = $1 AND referred_id = $2 AND status = 'pending'`,
                [referrerId, referredId]
            );
            return result.rows[0];
        } else {
            return await db.get(
                `SELECT * FROM referrals WHERE referrer_id = ? AND referred_id = ? AND status = 'pending'`,
                [referrerId, referredId]
            );
        }
    },
    
    getReferrerOfReferrer: async (userId) => {
        if (dbType === 'postgres') {
            const result = await db.query(`SELECT referred_by FROM clients WHERE id = $1`, [userId]);
            if (result.rows[0]?.referred_by) {
                const referrerResult = await db.query(`SELECT referred_by FROM clients WHERE id = $1`, [result.rows[0].referred_by]);
                return referrerResult.rows[0];
            }
            return null;
        } else {
            const client = await db.get(`SELECT referred_by FROM clients WHERE id = ?`, [userId]);
            if (client?.referred_by) {
                return await db.get(`SELECT referred_by FROM clients WHERE id = ?`, [client.referred_by]);
            }
            return null;
        }
    },
    
    updateReferralStatus: async (referralId, status) => {
        if (dbType === 'postgres') {
            await db.query(
                `UPDATE referrals SET status = $1, completed_at = $2 WHERE id = $3`,
                [status, status === 'completed' ? new Date().toISOString() : null, referralId]
            );
        } else {
            await db.run(
                `UPDATE referrals SET status = ?, completed_at = ? WHERE id = ?`,
                [status, status === 'completed' ? new Date().toISOString() : null, referralId]
            );
        }
    },
    
    getUserReferrals: async (userId) => {
        if (dbType === 'postgres') {
            const result = await db.query(
                `SELECT r.*, c.first_name as referred_name 
                 FROM referrals r 
                 JOIN clients c ON r.referred_id = c.id 
                 WHERE r.referrer_id = $1 
                 ORDER BY r.created_at DESC`,
                [userId]
            );
            return result.rows;
        } else {
            return await db.all(
                `SELECT r.*, c.first_name as referred_name 
                 FROM referrals r 
                 JOIN clients c ON r.referred_id = c.id 
                 WHERE r.referrer_id = ? 
                 ORDER BY r.created_at DESC`,
                [userId]
            );
        }
    },
    
    getReferralInfo: async (userId) => {
        const referrals = await module.exports.getUserReferrals(userId);
        const completed = referrals.filter(r => r.status === 'completed').length;
        const pending = referrals.filter(r => r.status === 'pending').length;
        const client = await module.exports.getClientById(userId);
        
        return {
            referral_code: client?.referral_code || 'N/A',
            total_referrals: referrals.length,
            completed_referrals: completed,
            pending_referrals: pending,
            pending_reward: completed * 2000,
            available_credit: client?.referral_credit || 0
        };
    },
    
    addReferralCredit: async (userId, amount) => {
        if (dbType === 'postgres') {
            await db.query(
                `UPDATE clients SET referral_credit = COALESCE(referral_credit, 0) + $1 WHERE id = $2`,
                [amount, userId]
            );
        } else {
            await db.run(
                `UPDATE clients SET referral_credit = COALESCE(referral_credit, 0) + ? WHERE id = ?`,
                [amount, userId]
            );
        }
    },
    getAllTestimonials: async () => {
    if (dbType === 'postgres') {
        const result = await db.query('SELECT * FROM testimonials ORDER BY created_at DESC');
        return result.rows;
    } else {
        return await db.all('SELECT * FROM testimonials ORDER BY created_at DESC');
    }
},
    
    // Installment functions
    getAllInstallmentPlans: async () => {
        if (dbType === 'postgres') {
            const result = await db.query(`SELECT * FROM installments ORDER BY created_at DESC`);
            return result.rows.map(row => ({ ...row, ...JSON.parse(row.data || '{}') }));
        } else {
            const rows = await db.all(`SELECT * FROM installments ORDER BY created_at DESC`);
            return rows.map(row => ({ ...row, ...JSON.parse(row.data || '{}') }));
        }
    },
    
    // Pay Later functions
    getAllPayLaterPlans: async () => {
        if (dbType === 'postgres') {
            const result = await db.query(`SELECT * FROM pay_later ORDER BY created_at DESC`);
            return result.rows.map(row => ({ ...row, ...JSON.parse(row.data || '{}') }));
        } else {
            const rows = await db.all(`SELECT * FROM pay_later ORDER BY created_at DESC`);
            return rows.map(row => ({ ...row, ...JSON.parse(row.data || '{}') }));
        }
    },
    
    // Error Reports functions
    saveErrorReport: async (data) => {
        if (dbType === 'postgres') {
            const result = await db.query(
                `INSERT INTO error_reports (client_id, file_id, description, status, created_at)
                 VALUES ($1, $2, $3, $4, $5) RETURNING id`,
                [data.client_id, data.file_id, data.description, data.status || 'pending', new Date().toISOString()]
            );
            return result.rows[0].id;
        } else {
            const result = await db.run(
                `INSERT INTO error_reports (client_id, file_id, description, status, created_at)
                 VALUES (?, ?, ?, ?, ?)`,
                [data.client_id, data.file_id, data.description, data.status || 'pending', new Date().toISOString()]
            );
            return result.lastID;
        }
    },
    
    getErrorReports: async (status = null, limit = 50) => {
        if (dbType === 'postgres') {
            const query = status 
                ? 'SELECT * FROM error_reports WHERE status = $1 ORDER BY created_at DESC LIMIT $2'
                : 'SELECT * FROM error_reports ORDER BY created_at DESC LIMIT $1';
            const params = status ? [status, limit] : [limit];
            const result = await db.query(query, params);
            return result.rows;
        } else {
            const query = status 
                ? 'SELECT * FROM error_reports WHERE status = ? ORDER BY created_at DESC LIMIT ?'
                : 'SELECT * FROM error_reports ORDER BY created_at DESC LIMIT ?';
            const params = status ? [status, limit] : [limit];
            return await db.all(query, params);
        }
    },
    
    getErrorReportById: async (id) => {
        if (dbType === 'postgres') {
            const result = await db.query('SELECT * FROM error_reports WHERE id = $1', [id]);
            return result.rows[0];
        } else {
            return await db.get('SELECT * FROM error_reports WHERE id = ?', [id]);
        }
    },
    
    updateErrorReportStatus: async (id, status, resolutionNotes = null) => {
        if (dbType === 'postgres') {
            await db.query(
                `UPDATE error_reports 
                 SET status = $1, resolution_notes = $2, resolved_at = $3 
                 WHERE id = $4`,
                [status, resolutionNotes, status === 'resolved' ? new Date().toISOString() : null, id]
            );
        } else {
            await db.run(
                `UPDATE error_reports 
                 SET status = ?, resolution_notes = ?, resolved_at = ? 
                 WHERE id = ?`,
                [status, resolutionNotes, status === 'resolved' ? new Date().toISOString() : null, id]
            );
        }
    },
    
    getPendingErrorReportsCount: async () => {
        if (dbType === 'postgres') {
            const result = await db.query("SELECT COUNT(*) FROM error_reports WHERE status = 'pending'");
            return parseInt(result.rows[0].count);
        } else {
            const result = await db.get("SELECT COUNT(*) as count FROM error_reports WHERE status = 'pending'");
            return result.count;
        }
    },
    
    logReferralEvent: async (data) => {
        if (dbType === 'postgres') {
            await db.query(
                `INSERT INTO admin_logs (admin_id, action, details, timestamp) VALUES ($1, $2, $3, $4)`,
                ['referral_system', data.event, JSON.stringify(data), new Date().toISOString()]
            );
        } else {
            await db.run(
                `INSERT INTO admin_logs (admin_id, action, details, timestamp) VALUES (?, ?, ?, ?)`,
                ['referral_system', data.event, JSON.stringify(data), new Date().toISOString()]
            );
        }
    }
};