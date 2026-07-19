-- ============================================================
-- 1. CLIENTS & WEB USERS
-- ============================================================
CREATE TABLE IF NOT EXISTS clients (
    id INT AUTO_INCREMENT PRIMARY KEY,
    telegram_id VARCHAR(255) UNIQUE,
    username VARCHAR(255),
    first_name VARCHAR(255),
    last_name VARCHAR(255),
    phone VARCHAR(50),
    email VARCHAR(255),
    location VARCHAR(255),
    physical_address TEXT,
    nationality VARCHAR(100),
    special_documents JSON,
    referral_code VARCHAR(50) UNIQUE,
    referred_by INT,
    referral_credit INT DEFAULT 0,
    total_orders INT DEFAULT 0,
    total_spent INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_active TIMESTAMP,
    INDEX (telegram_id),
    INDEX (email),
    INDEX (referral_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS web_users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(255),
    client_id INT,
    role ENUM('user','admin') DEFAULT 'user',
    twofa_secret VARCHAR(255),
    last_login TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- 2. SESSIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS sessions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    client_id INT NOT NULL,
    stage VARCHAR(100),
    current_section VARCHAR(100),
    data JSON,
    is_paused TINYINT(1) DEFAULT 0,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
    INDEX (client_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- 3. ORDERS, WITHDRAWALS, REFERRALS & TESTIMONIALS
-- ============================================================
CREATE TABLE IF NOT EXISTS orders (
    id VARCHAR(50) PRIMARY KEY,
    client_id INT NOT NULL,
    service VARCHAR(100),
    category VARCHAR(100),
    delivery_option VARCHAR(50),
    delivery_time VARCHAR(50),
    base_price INT,
    delivery_fee INT,
    total_charge VARCHAR(50),
    payment_status VARCHAR(50),
    payment_type VARCHAR(50),
    installment_data JSON,
    pay_later_data JSON,
    cv_data JSON,
    portfolio_links JSON,
    status VARCHAR(50) DEFAULT 'pending',
    version INT DEFAULT 1,
    payment_reference VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    delivered_at TIMESTAMP NULL,
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
    INDEX (client_id),
    INDEX (payment_status),
    INDEX (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS withdrawals (
    id INT AUTO_INCREMENT PRIMARY KEY,
    client_id INT NOT NULL,
    amount INT NOT NULL,
    method VARCHAR(50),
    account_details TEXT,
    status ENUM('pending','approved','rejected') DEFAULT 'pending',
    admin_notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    processed_at TIMESTAMP NULL,
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
    INDEX (client_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS referrals (
    id INT AUTO_INCREMENT PRIMARY KEY,
    referrer_id INT NOT NULL,
    referred_id INT NOT NULL,
    referral_code VARCHAR(50),
    status VARCHAR(50) DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP NULL,
    FOREIGN KEY (referrer_id) REFERENCES clients(id) ON DELETE CASCADE,
    FOREIGN KEY (referred_id) REFERENCES clients(id) ON DELETE CASCADE,
    INDEX (referrer_id),
    INDEX (referred_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS testimonials (
    id INT AUTO_INCREMENT PRIMARY KEY,
    client_id INT,
    name VARCHAR(255),
    text TEXT,
    rating INT,
    approved BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- 4. ADMIN LOGS & DOCUMENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS admin_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    admin_id VARCHAR(100),
    action VARCHAR(255),
    details TEXT,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS client_documents (
    id INT AUTO_INCREMENT PRIMARY KEY,
    client_id INT,
    document_type VARCHAR(100),
    file_path TEXT NOT NULL,
    enhanced_path TEXT,
    file_hash VARCHAR(64),
    original_filename VARCHAR(255),
    mime_type VARCHAR(100),
    file_size INT,
    uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT TRUE,
    notes TEXT,
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
    INDEX (client_id),
    INDEX (file_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS cv_versions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    order_id VARCHAR(50) NOT NULL,
    version_number INT,
    cv_data JSON,
    changes TEXT,
    is_current BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    INDEX (order_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS feedback (
    id INT AUTO_INCREMENT PRIMARY KEY,
    client_id INT,
    order_id VARCHAR(50),
    rating INT,
    feedback TEXT,
    liked_most TEXT,
    improvement_suggestions TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- 5. VACANCY LIBRARY & MATCHES
-- ============================================================
CREATE TABLE IF NOT EXISTS vacancy_library (
    id INT AUTO_INCREMENT PRIMARY KEY,
    position TEXT NOT NULL,
    company TEXT NOT NULL,
    location TEXT,
    department TEXT,
    job_type TEXT,
    experience_required TEXT,
    education_required TEXT,
    salary_range TEXT,
    deadline TEXT,
    requirements JSON,
    responsibilities JSON,
    benefits JSON,
    contact_email TEXT,
    contact_phone TEXT,
    application_link TEXT,
    source TEXT,
    hash VARCHAR(64) UNIQUE,
    usage_count INT DEFAULT 1,
    success_count INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX (hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS vacancy_matches (
    id INT AUTO_INCREMENT PRIMARY KEY,
    vacancy_id INT NOT NULL,
    client_id INT NOT NULL,
    order_id VARCHAR(50),
    matched_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    used BOOLEAN DEFAULT TRUE,
    FOREIGN KEY (vacancy_id) REFERENCES vacancy_library(id) ON DELETE CASCADE,
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- 6. BLOG, FAQ & ANALYTICS (CMS)
-- ============================================================
CREATE TABLE IF NOT EXISTS blog_posts (
    id INT AUTO_INCREMENT PRIMARY KEY,
    title VARCHAR(255),
    slug VARCHAR(255) UNIQUE,
    content TEXT,
    excerpt VARCHAR(500),
    author VARCHAR(100),
    published BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS faqs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    question TEXT,
    answer TEXT,
    category VARCHAR(100),
    sort_order INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS analytics_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    page_url VARCHAR(255),
    visitor_ip VARCHAR(45),
    user_agent TEXT,
    session_id VARCHAR(255),
    event_type ENUM('pageview','click','conversion') DEFAULT 'pageview',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX (page_url),
    INDEX (event_type),
    INDEX (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- 7. SUPPORT TICKETS & REPLIES
-- ============================================================
CREATE TABLE IF NOT EXISTS support_tickets (
    id INT AUTO_INCREMENT PRIMARY KEY,
    web_user_id INT NOT NULL,
    subject VARCHAR(255),
    message TEXT,
    status ENUM('open','in_progress','closed') DEFAULT 'open',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (web_user_id) REFERENCES web_users(id) ON DELETE CASCADE,
    INDEX (web_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ticket_replies (
    id INT AUTO_INCREMENT PRIMARY KEY,
    ticket_id INT NOT NULL,
    web_user_id INT NULL,
    reply TEXT,
    is_admin BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (ticket_id) REFERENCES support_tickets(id) ON DELETE CASCADE,
    FOREIGN KEY (web_user_id) REFERENCES web_users(id) ON DELETE SET NULL,
    INDEX (ticket_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;