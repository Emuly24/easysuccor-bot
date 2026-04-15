// database.js - Complete Production Version for EasySuccor Bot
// Supports PostgreSQL (Railway) and SQLite (local development)
// Includes all tables: clients, orders, sessions, referrals, testimonials, error_reports, client_documents, etc.

const fs = require('fs');
const path = require('path');

let db;
let dbType = 'sqlite';

// ============ INITIALIZATION ============
async function initDatabase() {
    const isProduction = process.env.NODE_ENV === 'production';
    
    if (isProduction && process.env.DATABASE_URL) {
        const { Pool } = require('pg');
        const pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: { rejectUnauthorized: false },
            max: 20,
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 2000,
        });
        await pool.query('SELECT NOW()');
        console.log('✅ PostgreSQL database connected on Railway');
        await createTablesPostgres(pool);
        db = pool;
        dbType = 'postgres';
        return db;
    } else {
        const sqlite3 = require('sqlite3');
        const { open } = require('sqlite');
        const dataDir = path.join(__dirname, 'data');
        if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
        const sqliteDb = await open({
            filename: path.join(dataDir, 'easysuccor.db'),
            driver: sqlite3.Database
        });
        await sqliteDb.exec('PRAGMA foreign_keys = ON');
        await sqliteDb.exec('PRAGMA journal_mode = WAL');
        console.log('✅ SQLite database connected (local development)');
        await createTablesSQLite(sqliteDb);
        db = sqliteDb;
        dbType = 'sqlite';
        return db;
    }
}

// ============ TABLE CREATION ============
async function createTablesPostgres(pool) {
    // Clients table
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
    // Vacancy library
    await pool.query(`
        CREATE TABLE IF NOT EXISTS vacancy_library (
            id SERIAL PRIMARY KEY,
            position TEXT NOT NULL,
            company TEXT NOT NULL,
            location TEXT,
            department TEXT,
            job_type TEXT,
            experience_required TEXT,
            education_required TEXT,
            salary_range TEXT,
            deadline TEXT,
            requirements TEXT,
            responsibilities TEXT,
            benefits TEXT,
            contact_email TEXT,
            contact_phone TEXT,
            application_link TEXT,
            source TEXT,
            hash TEXT UNIQUE,
            usage_count INTEGER DEFAULT 1,
            success_count INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS vacancy_matches (
            id SERIAL PRIMARY KEY,
            vacancy_id INTEGER REFERENCES vacancy_library(id) ON DELETE CASCADE,
            client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
            order_id TEXT,
            matched_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            used BOOLEAN DEFAULT TRUE
        )
    `);
    // Sessions
    await pool.query(`
        CREATE TABLE IF NOT EXISTS sessions (
            id SERIAL PRIMARY KEY,
            client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
            stage TEXT,
            current_section TEXT,
            data TEXT,
            is_paused INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP
        )
    `);
    // Orders
    await pool.query(`
        CREATE TABLE IF NOT EXISTS orders (
            id TEXT PRIMARY KEY,
            client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
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
            payment_reference TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            delivered_at TIMESTAMP,
            reviewed_at TIMESTAMP
        )
    `);
    // CV versions
    await pool.query(`
        CREATE TABLE IF NOT EXISTS cv_versions (
            id SERIAL PRIMARY KEY,
            order_id TEXT REFERENCES orders(id) ON DELETE CASCADE,
            version_number INTEGER,
            cv_data TEXT,
            changes TEXT,
            is_current INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);
    // Feedback
    await pool.query(`
        CREATE TABLE IF NOT EXISTS feedback (
            id SERIAL PRIMARY KEY,
            client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
            order_id TEXT REFERENCES orders(id) ON DELETE CASCADE,
            rating INTEGER,
            feedback TEXT,
            liked_most TEXT,
            improvement_suggestions TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);
    // Testimonials
    await pool.query(`
        CREATE TABLE IF NOT EXISTS testimonials (
            id SERIAL PRIMARY KEY,
            client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
            name TEXT,
            text TEXT,
            rating INTEGER,
            position TEXT,
            company TEXT,
            approved BOOLEAN DEFAULT FALSE,
            is_hire_story BOOLEAN DEFAULT FALSE,
            anonymous BOOLEAN DEFAULT FALSE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            approved_at TIMESTAMP
        )
    `);
    // Referrals
    await pool.query(`
        CREATE TABLE IF NOT EXISTS referrals (
            id SERIAL PRIMARY KEY,
            referrer_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
            referred_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
            referral_code TEXT,
            status TEXT DEFAULT 'pending',
            reward_claimed INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            completed_at TIMESTAMP
        )
    `);
    // Installments
    await pool.query(`
        CREATE TABLE IF NOT EXISTS installments (
            id SERIAL PRIMARY KEY,
            order_id TEXT UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
            client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
            data TEXT,
            status TEXT DEFAULT 'active',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP
        )
    `);
    // Pay Later
    await pool.query(`
        CREATE TABLE IF NOT EXISTS pay_later (
            id SERIAL PRIMARY KEY,
            order_id TEXT UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
            client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
            data TEXT,
            status TEXT DEFAULT 'pending',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP
        )
    `);
    // Admin logs
    await pool.query(`
        CREATE TABLE IF NOT EXISTS admin_logs (
            id SERIAL PRIMARY KEY,
            admin_id TEXT,
            action TEXT,
            details TEXT,
            timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);
    // Document reviews
    await pool.query(`
        CREATE TABLE IF NOT EXISTS document_reviews (
            id SERIAL PRIMARY KEY,
            order_id TEXT REFERENCES orders(id) ON DELETE CASCADE,
            version INTEGER,
            document_path TEXT,
            status TEXT,
            review_type TEXT,
            feedback TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);
    // Error reports
    await pool.query(`
        CREATE TABLE IF NOT EXISTS error_reports (
            id SERIAL PRIMARY KEY,
            client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
            file_id TEXT,
            description TEXT,
            status TEXT DEFAULT 'pending',
            resolution_notes TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            resolved_at TIMESTAMP
        )
    `);
    // Client documents (NEW)
    await pool.query(`
        CREATE TABLE IF NOT EXISTS client_documents (
            id SERIAL PRIMARY KEY,
            client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
            document_type TEXT NOT NULL,
            file_path TEXT NOT NULL,
            enhanced_path TEXT,
            file_hash TEXT,
            original_filename TEXT,
            mime_type TEXT,
            file_size INTEGER,
            uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            is_active BOOLEAN DEFAULT TRUE,
            notes TEXT
        )
    `);
    // Indexes
    await pool.query('CREATE INDEX IF NOT EXISTS idx_clients_telegram_id ON clients(telegram_id)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_clients_email ON clients(email)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_clients_referral_code ON clients(referral_code)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_orders_client_id ON orders(client_id)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_orders_payment_status ON orders(payment_status)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_sessions_client_id ON sessions(client_id)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_error_reports_status ON error_reports(status)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_vacancy_library_hash ON vacancy_library(hash)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_client_documents_client_id ON client_documents(client_id)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_client_documents_hash ON client_documents(file_hash)');
    console.log('✅ PostgreSQL tables and indexes created');
}

// SQLite version
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
        CREATE TABLE IF NOT EXISTS vacancy_library (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            position TEXT NOT NULL,
            company TEXT NOT NULL,
            location TEXT,
            department TEXT,
            job_type TEXT,
            experience_required TEXT,
            education_required TEXT,
            salary_range TEXT,
            deadline TEXT,
            requirements TEXT,
            responsibilities TEXT,
            benefits TEXT,
            contact_email TEXT,
            contact_phone TEXT,
            application_link TEXT,
            source TEXT,
            hash TEXT UNIQUE,
            usage_count INTEGER DEFAULT 1,
            success_count INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
    await db.exec(`
        CREATE TABLE IF NOT EXISTS vacancy_matches (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            vacancy_id INTEGER,
            client_id INTEGER,
            order_id TEXT,
            matched_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            used BOOLEAN DEFAULT TRUE,
            FOREIGN KEY (vacancy_id) REFERENCES vacancy_library(id) ON DELETE CASCADE,
            FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
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
            FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
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
            payment_reference TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            delivered_at DATETIME,
            reviewed_at DATETIME,
            FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
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
            FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
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
            FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
            FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
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
            is_hire_story BOOLEAN DEFAULT FALSE,
            anonymous BOOLEAN DEFAULT FALSE,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            approved_at DATETIME,
            FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
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
            FOREIGN KEY (referrer_id) REFERENCES clients(id) ON DELETE CASCADE,
            FOREIGN KEY (referred_id) REFERENCES clients(id) ON DELETE CASCADE
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
            FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
            FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
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
            FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
            FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
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
            FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
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
            FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
        )
    `);
    await db.exec(`
        CREATE TABLE IF NOT EXISTS client_documents (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            client_id INTEGER,
            document_type TEXT NOT NULL,
            file_path TEXT NOT NULL,
            enhanced_path TEXT,
            file_hash TEXT,
            original_filename TEXT,
            mime_type TEXT,
            file_size INTEGER,
            uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            is_active INTEGER DEFAULT 1,
            notes TEXT,
            FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
        )
    `);
    // Indexes for SQLite
    await db.exec('CREATE INDEX IF NOT EXISTS idx_clients_telegram_id ON clients(telegram_id)');
    await db.exec('CREATE INDEX IF NOT EXISTS idx_clients_email ON clients(email)');
    await db.exec('CREATE INDEX IF NOT EXISTS idx_clients_referral_code ON clients(referral_code)');
    await db.exec('CREATE INDEX IF NOT EXISTS idx_orders_client_id ON orders(client_id)');
    await db.exec('CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at)');
    await db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_client_id ON sessions(client_id)');
    await db.exec('CREATE INDEX IF NOT EXISTS idx_error_reports_status ON error_reports(status)');
    await db.exec('CREATE INDEX IF NOT EXISTS idx_vacancy_library_hash ON vacancy_library(hash)');
    await db.exec('CREATE INDEX IF NOT EXISTS idx_client_documents_client_id ON client_documents(client_id)');
    await db.exec('CREATE INDEX IF NOT EXISTS idx_client_documents_hash ON client_documents(file_hash)');
    console.log('✅ SQLite tables and indexes created');
}

// ============ HELPER ============
function safeJSONParse(str, fallback = null) {
    if (!str) return fallback;
    try {
        return JSON.parse(str);
    } catch (e) {
        return fallback;
    }
}

// ============ CLIENT FUNCTIONS ============
async function getClient(telegramId) {
    if (dbType === 'postgres') {
        const result = await db.query('SELECT * FROM clients WHERE telegram_id = $1', [telegramId]);
        return result.rows[0];
    } else {
        return await db.get('SELECT * FROM clients WHERE telegram_id = ?', [telegramId]);
    }
}

async function getClientByEmail(email) {
    if (!email) return null;
    if (dbType === 'postgres') {
        const result = await db.query('SELECT * FROM clients WHERE email = $1', [email]);
        return result.rows[0];
    } else {
        return await db.get('SELECT * FROM clients WHERE email = ?', [email]);
    }
}

async function getClientByPhone(phone) {
    if (!phone) return null;
    if (dbType === 'postgres') {
        const result = await db.query('SELECT * FROM clients WHERE phone = $1', [phone]);
        return result.rows[0];
    } else {
        return await db.get('SELECT * FROM clients WHERE phone = ?', [phone]);
    }
}

async function getClientByReferralCode(referralCode) {
    if (dbType === 'postgres') {
        const result = await db.query('SELECT * FROM clients WHERE referral_code = $1', [referralCode]);
        return result.rows[0];
    } else {
        return await db.get('SELECT * FROM clients WHERE referral_code = ?', [referralCode]);
    }
}

async function createClient(telegramId, username, firstName, lastName) {
    const referralCode = Math.random().toString(36).substring(2, 10).toUpperCase();
    const now = new Date().toISOString();
    if (dbType === 'postgres') {
        const result = await db.query(
            `INSERT INTO clients (telegram_id, username, first_name, last_name, referral_code, last_active) 
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
            [telegramId, username, firstName, lastName, referralCode, now]
        );
        return result.rows[0];
    } else {
        const result = await db.run(
            `INSERT INTO clients (telegram_id, username, first_name, last_name, referral_code, last_active) 
             VALUES (?, ?, ?, ?, ?, ?)`,
            [telegramId, username, firstName, lastName, referralCode, now]
        );
        return await db.get('SELECT * FROM clients WHERE id = ?', [result.lastID]);
    }
}

async function getClientById(clientId) {
    const id = parseInt(clientId);
    if (isNaN(id)) return null;
    if (dbType === 'postgres') {
        const result = await db.query('SELECT * FROM clients WHERE id = $1', [id]);
        return result.rows[0];
    } else {
        return await db.get('SELECT * FROM clients WHERE id = ?', [id]);
    }
}

async function getClientByName(name) {
    if (!name) return null;
    if (dbType === 'postgres') {
        const result = await db.query('SELECT * FROM clients WHERE first_name ILIKE $1 OR last_name ILIKE $1 LIMIT 1', [`%${name}%`]);
        return result.rows[0];
    } else {
        return await db.get('SELECT * FROM clients WHERE first_name LIKE ? OR last_name LIKE ? LIMIT 1', [`%${name}%`, `%${name}%`]);
    }
}

async function updateClient(clientId, data) {
    const id = parseInt(clientId);
    if (isNaN(id)) throw new Error('Invalid client ID');
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
    if (fields.length === 0) return;
    values.push(new Date().toISOString(), id);
    if (dbType === 'postgres') {
        await db.query(`UPDATE clients SET ${fields.join(', ')}, last_active = $${paramIndex} WHERE id = $${paramIndex + 1}`, values);
    } else {
        await db.run(`UPDATE clients SET ${fields.join(', ')}, last_active = ? WHERE id = ?`, values);
    }
}

async function getAllClients() {
    if (dbType === 'postgres') {
        const result = await db.query('SELECT * FROM clients ORDER BY created_at DESC');
        return result.rows;
    } else {
        return await db.all('SELECT * FROM clients ORDER BY created_at DESC');
    }
}

// ============ VACANCY LIBRARY FUNCTIONS ============
async function getVacancyByHash(hash) {
    if (dbType === 'postgres') {
        const result = await db.query('SELECT * FROM vacancy_library WHERE hash = $1', [hash]);
        return result.rows[0];
    } else {
        return await db.get('SELECT * FROM vacancy_library WHERE hash = ?', [hash]);
    }
}

async function createVacancy(vacancy) {
    if (dbType === 'postgres') {
        const result = await db.query(`
            INSERT INTO vacancy_library (position, company, location, department, job_type, 
                experience_required, education_required, salary_range, deadline, 
                requirements, responsibilities, benefits, contact_email, contact_phone, 
                application_link, source, hash)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
            RETURNING id
        `, [vacancy.position, vacancy.company, vacancy.location, vacancy.department, vacancy.job_type,
            vacancy.experience_required, vacancy.education_required, vacancy.salary_range, vacancy.deadline,
            vacancy.requirements, vacancy.responsibilities, vacancy.benefits, vacancy.contact_email,
            vacancy.contact_phone, vacancy.application_link, vacancy.source, vacancy.hash]);
        return result.rows[0].id;
    } else {
        const result = await db.run(`
            INSERT INTO vacancy_library (position, company, location, department, job_type,
                experience_required, education_required, salary_range, deadline,
                requirements, responsibilities, benefits, contact_email, contact_phone,
                application_link, source, hash)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [vacancy.position, vacancy.company, vacancy.location, vacancy.department, vacancy.job_type,
            vacancy.experience_required, vacancy.education_required, vacancy.salary_range, vacancy.deadline,
            vacancy.requirements, vacancy.responsibilities, vacancy.benefits, vacancy.contact_email,
            vacancy.contact_phone, vacancy.application_link, vacancy.source, vacancy.hash]);
        return result.lastID;
    }
}

async function getAllVacancies() {
    if (dbType === 'postgres') {
        const result = await db.query('SELECT * FROM vacancy_library ORDER BY usage_count DESC, created_at DESC');
        return result.rows;
    } else {
        return await db.all('SELECT * FROM vacancy_library ORDER BY usage_count DESC, created_at DESC');
    }
}

async function getVacancyById(id) {
    const vid = parseInt(id);
    if (isNaN(vid)) return null;
    if (dbType === 'postgres') {
        const result = await db.query('SELECT * FROM vacancy_library WHERE id = $1', [vid]);
        return result.rows[0];
    } else {
        return await db.get('SELECT * FROM vacancy_library WHERE id = ?', [vid]);
    }
}

async function incrementVacancyUsage(id) {
    const vid = parseInt(id);
    if (isNaN(vid)) return;
    if (dbType === 'postgres') {
        await db.query('UPDATE vacancy_library SET usage_count = usage_count + 1, updated_at = NOW() WHERE id = $1', [vid]);
    } else {
        await db.run('UPDATE vacancy_library SET usage_count = usage_count + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [vid]);
    }
}

async function recordVacancyMatch(vacancyId, clientId, orderId = null) {
    const vId = parseInt(vacancyId);
    const cId = parseInt(clientId);
    if (isNaN(vId) || isNaN(cId)) return;
    if (dbType === 'postgres') {
        await db.query('INSERT INTO vacancy_matches (vacancy_id, client_id, order_id) VALUES ($1, $2, $3)', [vId, cId, orderId]);
    } else {
        await db.run('INSERT INTO vacancy_matches (vacancy_id, client_id, order_id) VALUES (?, ?, ?)', [vId, cId, orderId]);
    }
}

// ============ SESSION FUNCTIONS ============
async function getActiveSession(clientId) {
    const id = parseInt(clientId);
    if (isNaN(id)) return null;
    if (dbType === 'postgres') {
        const result = await db.query(`SELECT * FROM sessions WHERE client_id = $1 AND is_paused = 0 ORDER BY created_at DESC LIMIT 1`, [id]);
        return result.rows[0];
    } else {
        return await db.get(`SELECT * FROM sessions WHERE client_id = ? AND is_paused = 0 ORDER BY created_at DESC LIMIT 1`, [id]);
    }
}

async function getPausedSession(clientId) {
    const id = parseInt(clientId);
    if (isNaN(id)) return null;
    if (dbType === 'postgres') {
        const result = await db.query(`SELECT * FROM sessions WHERE client_id = $1 AND is_paused = 1 ORDER BY updated_at DESC LIMIT 1`, [id]);
        return result.rows[0];
    } else {
        return await db.get(`SELECT * FROM sessions WHERE client_id = ? AND is_paused = 1 ORDER BY updated_at DESC LIMIT 1`, [id]);
    }
}

async function saveSession(clientId, stage, currentSection, data, isPaused = 0) {
    const id = parseInt(clientId);
    if (isNaN(id)) throw new Error('Invalid client ID');
    if (dbType === 'postgres') {
        await db.query(`UPDATE sessions SET is_paused = 1 WHERE client_id = $1 AND is_paused = 0`, [id]);
        const result = await db.query(
            `INSERT INTO sessions (client_id, stage, current_section, data, is_paused, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
            [id, stage, currentSection, JSON.stringify(data), isPaused ? 1 : 0, new Date().toISOString()]
        );
        return result.rows[0].id;
    } else {
        await db.run(`UPDATE sessions SET is_paused = 1 WHERE client_id = ? AND is_paused = 0`, [id]);
        const result = await db.run(
            `INSERT INTO sessions (client_id, stage, current_section, data, is_paused, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [id, stage, currentSection, JSON.stringify(data), isPaused ? 1 : 0, new Date().toISOString()]
        );
        return result.lastID;
    }
}

async function updateSession(sessionId, stage, currentSection, data, isPaused = 0) {
    const sId = parseInt(sessionId);
    if (isNaN(sId)) throw new Error('Invalid session ID');
    if (dbType === 'postgres') {
        await db.query(
            `UPDATE sessions SET stage = $1, current_section = $2, data = $3, is_paused = $4, updated_at = $5 WHERE id = $6`,
            [stage, currentSection, JSON.stringify(data), isPaused ? 1 : 0, new Date().toISOString(), sId]
        );
    } else {
        await db.run(
            `UPDATE sessions SET stage = ?, current_section = ?, data = ?, is_paused = ?, updated_at = ? WHERE id = ?`,
            [stage, currentSection, JSON.stringify(data), isPaused ? 1 : 0, new Date().toISOString(), sId]
        );
    }
}

async function endSession(clientId) {
    const id = parseInt(clientId);
    if (isNaN(id)) return;
    if (dbType === 'postgres') {
        await db.query(`UPDATE sessions SET is_paused = 1 WHERE client_id = $1 AND is_paused = 0`, [id]);
    } else {
        await db.run(`UPDATE sessions SET is_paused = 1 WHERE client_id = ? AND is_paused = 0`, [id]);
    }
}

// ============ ORDER FUNCTIONS ============
async function createOrder(orderData) {
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
            [parseInt(String(orderData.total_charge).replace(/[^0-9]/g, '') || 0), orderData.client_id]
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
            [parseInt(String(orderData.total_charge).replace(/[^0-9]/g, '') || 0), orderData.client_id]
        );
    }
    return orderData.id;
}

async function getOrder(orderId) {
    if (dbType === 'postgres') {
        const result = await db.query('SELECT * FROM orders WHERE id = $1', [orderId]);
        const order = result.rows[0];
        if (order && order.cv_data) order.cv_data = safeJSONParse(order.cv_data, {});
        return order;
    } else {
        const order = await db.get('SELECT * FROM orders WHERE id = ?', [orderId]);
        if (order && order.cv_data) order.cv_data = safeJSONParse(order.cv_data, {});
        return order;
    }
}

async function getClientOrders(clientId) {
    const id = parseInt(clientId);
    if (isNaN(id)) return [];
    if (dbType === 'postgres') {
        const result = await db.query('SELECT * FROM orders WHERE client_id = $1 ORDER BY created_at DESC', [id]);
        return result.rows;
    } else {
        return await db.all('SELECT * FROM orders WHERE client_id = ? ORDER BY created_at DESC', [id]);
    }
}

async function getAllOrders() {
    if (dbType === 'postgres') {
        const result = await db.query('SELECT * FROM orders ORDER BY created_at DESC');
        return result.rows;
    } else {
        return await db.all('SELECT * FROM orders ORDER BY created_at DESC');
    }
}

async function getPendingPaymentOrders() {
    if (dbType === 'postgres') {
        const result = await db.query("SELECT * FROM orders WHERE payment_status = 'pending' AND status != 'cancelled' ORDER BY created_at ASC");
        return result.rows;
    } else {
        return await db.all("SELECT * FROM orders WHERE payment_status = 'pending' AND status != 'cancelled' ORDER BY created_at ASC");
    }
}

async function updateOrderStatus(orderId, status) {
    if (dbType === 'postgres') {
        await db.query(`UPDATE orders SET status = $1, delivered_at = $2 WHERE id = $3`, [status, status === 'delivered' ? new Date().toISOString() : null, orderId]);
    } else {
        await db.run(`UPDATE orders SET status = ?, delivered_at = ? WHERE id = ?`, [status, status === 'delivered' ? new Date().toISOString() : null, orderId]);
    }
}

async function updateOrderPaymentStatus(orderId, status) {
    if (dbType === 'postgres') {
        await db.query(`UPDATE orders SET payment_status = $1 WHERE id = $2`, [status, orderId]);
    } else {
        await db.run(`UPDATE orders SET payment_status = ? WHERE id = ?`, [status, orderId]);
    }
}

async function updateOrderPaymentReference(orderId, reference) {
    if (dbType === 'postgres') {
        await db.query(`UPDATE orders SET payment_reference = $1 WHERE id = $2`, [reference, orderId]);
    } else {
        await db.run(`UPDATE orders SET payment_reference = ? WHERE id = ?`, [reference, orderId]);
    }
}

async function updatePaymentReminder(orderId, daysSince) {
    if (dbType === 'postgres') {
        await db.query(`UPDATE orders SET reminder_sent = reminder_sent + 1, last_reminder = $1 WHERE id = $2`, [`${daysSince} days`, orderId]);
    } else {
        await db.run(`UPDATE orders SET reminder_sent = reminder_sent + 1, last_reminder = ? WHERE id = ?`, [`${daysSince} days`, orderId]);
    }
}

// ============ DOCUMENT REVIEWS ============
async function saveDocumentReview(data) {
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
}

async function getDocumentReviews(orderId) {
    if (dbType === 'postgres') {
        const result = await db.query(`SELECT * FROM document_reviews WHERE order_id = $1 ORDER BY version ASC`, [orderId]);
        return result.rows;
    } else {
        return await db.all(`SELECT * FROM document_reviews WHERE order_id = ? ORDER BY version ASC`, [orderId]);
    }
}

// ============ CV VERSIONING ============
async function saveCVVersion(orderId, versionNumber, cvData, changes) {
    if (dbType === 'postgres') {
        await db.query(
            `INSERT INTO cv_versions (order_id, version_number, cv_data, changes, created_at)
             VALUES ($1, $2, $3, $4, $5)`,
            [orderId, versionNumber, JSON.stringify(cvData), changes, new Date().toISOString()]
        );
    } else {
        await db.run(
            `INSERT INTO cv_versions (order_id, version_number, cv_data, changes, created_at)
             VALUES (?, ?, ?, ?, ?)`,
            [orderId, versionNumber, JSON.stringify(cvData), changes, new Date().toISOString()]
        );
    }
}

async function getCVVersions(orderId) {
    if (dbType === 'postgres') {
        const result = await db.query(`SELECT * FROM cv_versions WHERE order_id = $1 ORDER BY version_number ASC`, [orderId]);
        return result.rows.map(v => ({ ...v, cv_data: safeJSONParse(v.cv_data, {}) }));
    } else {
        const rows = await db.all(`SELECT * FROM cv_versions WHERE order_id = ? ORDER BY version_number ASC`, [orderId]);
        return rows.map(v => ({ ...v, cv_data: safeJSONParse(v.cv_data, {}) }));
    }
}

async function getCVVersion(orderId, versionNumber) {
    if (dbType === 'postgres') {
        const result = await db.query(`SELECT * FROM cv_versions WHERE order_id = $1 AND version_number = $2`, [orderId, versionNumber]);
        const version = result.rows[0];
        if (version) version.cv_data = safeJSONParse(version.cv_data, {});
        return version;
    } else {
        const version = await db.get(`SELECT * FROM cv_versions WHERE order_id = ? AND version_number = ?`, [orderId, versionNumber]);
        if (version) version.cv_data = safeJSONParse(version.cv_data, {});
        return version;
    }
}

async function updateOrderCVData(orderId, cvData) {
    if (dbType === 'postgres') {
        await db.query(`UPDATE orders SET cv_data = $1 WHERE id = $2`, [JSON.stringify(cvData), orderId]);
    } else {
        await db.run(`UPDATE orders SET cv_data = ? WHERE id = ?`, [JSON.stringify(cvData), orderId]);
    }
}

// ============ ADMIN LOGS ============
async function logAdminAction(data) {
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
}

async function getAdminLogs(limit = 100) {
    if (dbType === 'postgres') {
        const result = await db.query(`SELECT * FROM admin_logs ORDER BY timestamp DESC LIMIT $1`, [limit]);
        return result.rows;
    } else {
        return await db.all(`SELECT * FROM admin_logs ORDER BY timestamp DESC LIMIT ?`, [limit]);
    }
}

// ============ REFERRAL FUNCTIONS ============
async function recordReferral(referrerId, referredId, referralCode) {
    const rId = parseInt(referrerId);
    const refId = parseInt(referredId);
    if (isNaN(rId) || isNaN(refId)) throw new Error('Invalid IDs');
    if (dbType === 'postgres') {
        await db.query(
            `INSERT INTO referrals (referrer_id, referred_id, referral_code, status, created_at)
             VALUES ($1, $2, $3, 'pending', $4)`,
            [rId, refId, referralCode, new Date().toISOString()]
        );
        await db.query(`UPDATE clients SET referred_by = $1 WHERE id = $2`, [rId, refId]);
    } else {
        await db.run(
            `INSERT INTO referrals (referrer_id, referred_id, referral_code, status, created_at)
             VALUES (?, ?, ?, 'pending', ?)`,
            [rId, refId, referralCode, new Date().toISOString()]
        );
        await db.run(`UPDATE clients SET referred_by = ? WHERE id = ?`, [rId, refId]);
    }
}

async function getPendingReferral(referrerId, referredId) {
    const rId = parseInt(referrerId);
    const refId = parseInt(referredId);
    if (isNaN(rId) || isNaN(refId)) return null;
    if (dbType === 'postgres') {
        const result = await db.query(
            `SELECT * FROM referrals WHERE referrer_id = $1 AND referred_id = $2 AND status = 'pending'`,
            [rId, refId]
        );
        return result.rows[0];
    } else {
        return await db.get(
            `SELECT * FROM referrals WHERE referrer_id = ? AND referred_id = ? AND status = 'pending'`,
            [rId, refId]
        );
    }
}

async function getReferrerOfReferrer(userId) {
    const uId = parseInt(userId);
    if (isNaN(uId)) return null;
    if (dbType === 'postgres') {
        const result = await db.query(`SELECT referred_by FROM clients WHERE id = $1`, [uId]);
        if (result.rows[0]?.referred_by) {
            const referrerResult = await db.query(`SELECT referred_by FROM clients WHERE id = $1`, [result.rows[0].referred_by]);
            return referrerResult.rows[0];
        }
        return null;
    } else {
        const client = await db.get(`SELECT referred_by FROM clients WHERE id = ?`, [uId]);
        if (client?.referred_by) {
            return await db.get(`SELECT referred_by FROM clients WHERE id = ?`, [client.referred_by]);
        }
        return null;
    }
}

async function updateReferralStatus(referralId, status) {
    const rId = parseInt(referralId);
    if (isNaN(rId)) throw new Error('Invalid referral ID');
    if (dbType === 'postgres') {
        await db.query(
            `UPDATE referrals SET status = $1, completed_at = $2 WHERE id = $3`,
            [status, status === 'completed' ? new Date().toISOString() : null, rId]
        );
    } else {
        await db.run(
            `UPDATE referrals SET status = ?, completed_at = ? WHERE id = ?`,
            [status, status === 'completed' ? new Date().toISOString() : null, rId]
        );
    }
}

async function getUserReferrals(userId) {
    const uId = parseInt(userId);
    if (isNaN(uId)) return [];
    if (dbType === 'postgres') {
        const result = await db.query(
            `SELECT r.*, c.first_name as referred_name 
             FROM referrals r 
             JOIN clients c ON r.referred_id = c.id 
             WHERE r.referrer_id = $1 
             ORDER BY r.created_at DESC`,
            [uId]
        );
        return result.rows;
    } else {
        return await db.all(
            `SELECT r.*, c.first_name as referred_name 
             FROM referrals r 
             JOIN clients c ON r.referred_id = c.id 
             WHERE r.referrer_id = ? 
             ORDER BY r.created_at DESC`,
            [uId]
        );
    }
}

async function getReferralInfo(userId) {
    const referrals = await getUserReferrals(userId);
    const completed = referrals.filter(r => r.status === 'completed').length;
    const pending = referrals.filter(r => r.status === 'pending').length;
    const client = await getClientById(userId);
    return {
        referral_code: client?.referral_code || 'N/A',
        total_referrals: referrals.length,
        completed_referrals: completed,
        pending_referrals: pending,
        pending_reward: completed * 2000,
        available_credit: client?.referral_credit || 0
    };
}

async function addReferralCredit(userId, amount) {
    const uId = parseInt(userId);
    if (isNaN(uId) || isNaN(amount)) throw new Error('Invalid parameters');
    if (dbType === 'postgres') {
        await db.query(`UPDATE clients SET referral_credit = COALESCE(referral_credit, 0) + $1 WHERE id = $2`, [amount, uId]);
    } else {
        await db.run(`UPDATE clients SET referral_credit = COALESCE(referral_credit, 0) + ? WHERE id = ?`, [amount, uId]);
    }
}

// ============ TESTIMONIALS ============
async function getAllTestimonials() {
    if (dbType === 'postgres') {
        const result = await db.query('SELECT * FROM testimonials ORDER BY created_at DESC');
        return result.rows;
    } else {
        return await db.all('SELECT * FROM testimonials ORDER BY created_at DESC');
    }
}

async function getApprovedTestimonials(limit = 10) {
    if (dbType === 'postgres') {
        const result = await db.query('SELECT * FROM testimonials WHERE approved = true ORDER BY created_at DESC LIMIT $1', [limit]);
        return result.rows;
    } else {
        return await db.all('SELECT * FROM testimonials WHERE approved = 1 ORDER BY created_at DESC LIMIT ?', [limit]);
    }
}

async function saveTestimonial(data) {
    if (dbType === 'postgres') {
        await db.query(`
            INSERT INTO testimonials (client_id, name, text, rating, position, approved, is_hire_story, anonymous, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `, [data.client_id, data.name, data.text, data.rating || 5, data.position,
            data.approved || false, data.is_hire_story || false, data.anonymous || false, new Date().toISOString()]);
    } else {
        await db.run(`
            INSERT INTO testimonials (client_id, name, text, rating, position, approved, is_hire_story, anonymous, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [data.client_id, data.name, data.text, data.rating || 5, data.position,
            data.approved ? 1 : 0, data.is_hire_story ? 1 : 0, data.anonymous ? 1 : 0, new Date().toISOString()]);
    }
}

// ============ INSTALLMENT & PAY LATER (placeholder – full implementation in other modules) ============
async function getAllInstallmentPlans() {
    if (dbType === 'postgres') {
        const result = await db.query(`SELECT * FROM installments ORDER BY created_at DESC`);
        return result.rows.map(row => ({ ...row, ...safeJSONParse(row.data, {}) }));
    } else {
        const rows = await db.all(`SELECT * FROM installments ORDER BY created_at DESC`);
        return rows.map(row => ({ ...row, ...safeJSONParse(row.data, {}) }));
    }
}

async function getAllPayLaterPlans() {
    if (dbType === 'postgres') {
        const result = await db.query(`SELECT * FROM pay_later ORDER BY created_at DESC`);
        return result.rows.map(row => ({ ...row, ...safeJSONParse(row.data, {}) }));
    } else {
        const rows = await db.all(`SELECT * FROM pay_later ORDER BY created_at DESC`);
        return rows.map(row => ({ ...row, ...safeJSONParse(row.data, {}) }));
    }
}

// ============ ERROR REPORTS ============
async function saveErrorReport(data) {
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
}

async function getErrorReports(status = null, limit = 50) {
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
}

async function getErrorReportById(id) {
    const reportId = parseInt(id);
    if (isNaN(reportId)) return null;
    if (dbType === 'postgres') {
        const result = await db.query('SELECT * FROM error_reports WHERE id = $1', [reportId]);
        return result.rows[0];
    } else {
        return await db.get('SELECT * FROM error_reports WHERE id = ?', [reportId]);
    }
}

async function updateErrorReportStatus(id, status, resolutionNotes = null) {
    const reportId = parseInt(id);
    if (isNaN(reportId)) throw new Error('Invalid report ID');
    if (dbType === 'postgres') {
        await db.query(
            `UPDATE error_reports 
             SET status = $1, resolution_notes = $2, resolved_at = $3 
             WHERE id = $4`,
            [status, resolutionNotes, status === 'resolved' ? new Date().toISOString() : null, reportId]
        );
    } else {
        await db.run(
            `UPDATE error_reports 
             SET status = ?, resolution_notes = ?, resolved_at = ? 
             WHERE id = ?`,
            [status, resolutionNotes, status === 'resolved' ? new Date().toISOString() : null, reportId]
        );
    }
}

async function getPendingErrorReportsCount() {
    if (dbType === 'postgres') {
        const result = await db.query("SELECT COUNT(*) FROM error_reports WHERE status = 'pending'");
        return parseInt(result.rows[0].count);
    } else {
        const result = await db.get("SELECT COUNT(*) as count FROM error_reports WHERE status = 'pending'");
        return result.count;
    }
}

// ============ CLIENT DOCUMENTS (NEW) ============
async function saveClientDocument(data) {
    if (dbType === 'postgres') {
        const result = await db.query(
            `INSERT INTO client_documents (client_id, document_type, file_path, enhanced_path, file_hash, original_filename, mime_type, file_size, notes, uploaded_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
            [data.client_id, data.document_type, data.file_path, data.enhanced_path, data.file_hash,
             data.original_filename, data.mime_type, data.file_size, data.notes, new Date().toISOString()]
        );
        return result.rows[0].id;
    } else {
        const result = await db.run(
            `INSERT INTO client_documents (client_id, document_type, file_path, enhanced_path, file_hash, original_filename, mime_type, file_size, notes, uploaded_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [data.client_id, data.document_type, data.file_path, data.enhanced_path, data.file_hash,
             data.original_filename, data.mime_type, data.file_size, data.notes, new Date().toISOString()]
        );
        return result.lastID;
    }
}

async function getClientDocuments(clientId, documentType = null) {
    if (dbType === 'postgres') {
        const query = documentType
            ? 'SELECT * FROM client_documents WHERE client_id = $1 AND document_type = $2 AND is_active = true ORDER BY uploaded_at DESC'
            : 'SELECT * FROM client_documents WHERE client_id = $1 AND is_active = true ORDER BY uploaded_at DESC';
        const params = documentType ? [clientId, documentType] : [clientId];
        const result = await db.query(query, params);
        return result.rows;
    } else {
        const query = documentType
            ? 'SELECT * FROM client_documents WHERE client_id = ? AND document_type = ? AND is_active = 1 ORDER BY uploaded_at DESC'
            : 'SELECT * FROM client_documents WHERE client_id = ? AND is_active = 1 ORDER BY uploaded_at DESC';
        const params = documentType ? [clientId, documentType] : [clientId];
        return await db.all(query, params);
    }
}

async function getClientDocumentByHash(clientId, hash) {
    if (dbType === 'postgres') {
        const result = await db.query(
            'SELECT * FROM client_documents WHERE client_id = $1 AND file_hash = $2 AND is_active = true LIMIT 1',
            [clientId, hash]
        );
        return result.rows[0];
    } else {
        return await db.get(
            'SELECT * FROM client_documents WHERE client_id = ? AND file_hash = ? AND is_active = 1 LIMIT 1',
            [clientId, hash]
        );
    }
}

async function deleteClientDocument(docId) {
    if (dbType === 'postgres') {
        await db.query('UPDATE client_documents SET is_active = false WHERE id = $1', [docId]);
    } else {
        await db.run('UPDATE client_documents SET is_active = 0 WHERE id = ?', [docId]);
    }
}

// ============ HELPER FUNCTIONS FOR ADMIN DASHBOARD ============
async function getOrdersByDateRange(startDate, endDate) {
    if (dbType === 'postgres') {
        const result = await db.query(
            'SELECT * FROM orders WHERE created_at BETWEEN $1 AND $2 ORDER BY created_at',
            [startDate, endDate]
        );
        return result.rows;
    } else {
        return await db.all(
            'SELECT * FROM orders WHERE created_at BETWEEN ? AND ? ORDER BY created_at',
            [startDate, endDate]
        );
    }
}

async function getOrdersByYear(year) {
    const start = `${year}-01-01`;
    const end = `${year}-12-31`;
    return getOrdersByDateRange(start, end);
}

async function getOrdersByService(...services) {
    const placeholders = services.map((_, i) => (dbType === 'postgres' ? `$${i+1}` : '?')).join(',');
    if (dbType === 'postgres') {
        const result = await db.query(`SELECT * FROM orders WHERE service IN (${placeholders})`, services);
        return result.rows;
    } else {
        return await db.all(`SELECT * FROM orders WHERE service IN (${placeholders})`, services);
    }
}

async function getAllFeedback() {
    if (dbType === 'postgres') {
        const result = await db.query('SELECT * FROM feedback ORDER BY created_at DESC');
        return result.rows;
    } else {
        return await db.all('SELECT * FROM feedback ORDER BY created_at DESC');
    }
}

async function getAllDocuments() {
    if (dbType === 'postgres') {
        const result = await db.query(`
            SELECT o.id as order_id, o.cv_data, o.created_at, o.status, o.version,
                   c.first_name, c.last_name, c.id as client_id
            FROM orders o
            JOIN clients c ON o.client_id = c.id
            WHERE o.cv_data IS NOT NULL
            ORDER BY o.created_at DESC
        `);
        return result.rows;
    } else {
        return await db.all(`
            SELECT o.id as order_id, o.cv_data, o.created_at, o.status, o.version,
                   c.first_name, c.last_name, c.id as client_id
            FROM orders o
            JOIN clients c ON o.client_id = c.id
            WHERE o.cv_data IS NOT NULL
            ORDER BY o.created_at DESC
        `);
    }
}

// ============ DELETE & CLEAR ============
async function deleteClientData(clientId) {
    const id = parseInt(clientId);
    if (isNaN(id)) throw new Error('Invalid client ID');
    if (dbType === 'postgres') {
        await db.query('DELETE FROM error_reports WHERE client_id = $1', [id]);
        await db.query('DELETE FROM orders WHERE client_id = $1', [id]);
        await db.query('DELETE FROM sessions WHERE client_id = $1', [id]);
        await db.query('DELETE FROM feedback WHERE client_id = $1', [id]);
        await db.query('DELETE FROM referrals WHERE referrer_id = $1 OR referred_id = $1', [id]);
        await db.query('DELETE FROM client_documents WHERE client_id = $1', [id]);
        await db.query('DELETE FROM clients WHERE id = $1', [id]);
    } else {
        await db.run('DELETE FROM error_reports WHERE client_id = ?', [id]);
        await db.run('DELETE FROM orders WHERE client_id = ?', [id]);
        await db.run('DELETE FROM sessions WHERE client_id = ?', [id]);
        await db.run('DELETE FROM feedback WHERE client_id = ?', [id]);
        await db.run('DELETE FROM referrals WHERE referrer_id = ? OR referred_id = ?', [id, id]);
        await db.run('DELETE FROM client_documents WHERE client_id = ?', [id]);
        await db.run('DELETE FROM clients WHERE id = ?', [id]);
    }
}

async function clearAllData() {
    if (dbType === 'postgres') {
        const tables = ['error_reports', 'orders', 'sessions', 'feedback', 'referrals', 'testimonials', 'installments', 'pay_later', 'cv_versions', 'document_reviews', 'vacancy_matches', 'vacancy_library', 'admin_logs', 'client_documents', 'clients'];
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
        await db.query('ALTER SEQUENCE vacancy_library_id_seq RESTART WITH 1');
        await db.query('ALTER SEQUENCE client_documents_id_seq RESTART WITH 1');
        console.log('✅ All data cleared');
    } else {
        await db.run('DELETE FROM error_reports');
        await db.run('DELETE FROM orders');
        await db.run('DELETE FROM sessions');
        await db.run('DELETE FROM feedback');
        await db.run('DELETE FROM referrals');
        await db.run('DELETE FROM testimonials');
        await db.run('DELETE FROM installments');
        await db.run('DELETE FROM pay_later');
        await db.run('DELETE FROM cv_versions');
        await db.run('DELETE FROM document_reviews');
        await db.run('DELETE FROM vacancy_matches');
        await db.run('DELETE FROM vacancy_library');
        await db.run('DELETE FROM admin_logs');
        await db.run('DELETE FROM client_documents');
        await db.run('DELETE FROM clients');
        await db.run('DELETE FROM sqlite_sequence');
        console.log('✅ All data cleared');
    }
}

async function logReferralEvent(data) {
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

// ============ EXPORT ALL ============
module.exports = {
    initDatabase,
    getClient,
    getClientByEmail,
    getClientByPhone,
    getClientByReferralCode,
    createClient,
    getClientById,
    getClientByName,
    updateClient,
    getAllClients,
    getVacancyByHash,
    createVacancy,
    getAllVacancies,
    getVacancyById,
    incrementVacancyUsage,
    recordVacancyMatch,
    getActiveSession,
    getPausedSession,
    saveSession,
    updateSession,
    endSession,
    createOrder,
    getOrder,
    getClientOrders,
    getAllOrders,
    getPendingPaymentOrders,
    updateOrderStatus,
    updateOrderPaymentStatus,
    updateOrderPaymentReference,
    updatePaymentReminder,
    saveDocumentReview,
    getDocumentReviews,
    saveCVVersion,
    getCVVersions,
    getCVVersion,
    updateOrderCVData,
    logAdminAction,
    getAdminLogs,
    recordReferral,
    getPendingReferral,
    getReferrerOfReferrer,
    updateReferralStatus,
    getUserReferrals,
    getReferralInfo,
    addReferralCredit,
    getAllTestimonials,
    getApprovedTestimonials,
    saveTestimonial,
    getAllInstallmentPlans,
    getAllPayLaterPlans,
    saveErrorReport,
    getErrorReports,
    getErrorReportById,
    updateErrorReportStatus,
    getPendingErrorReportsCount,
    saveClientDocument,
    getClientDocuments,
    getClientDocumentByHash,
    deleteClientDocument,
    getOrdersByDateRange,
    getOrdersByYear,
    getOrdersByService,
    getAllFeedback,
    getAllDocuments,
    deleteClientData,
    clearAllData,
    logReferralEvent
};