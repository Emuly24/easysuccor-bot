<?php
session_start();
require_once __DIR__ . '/vendor/autoload.php';
require_once __DIR__ . '/webhook.php';

// ========================================================================
// 1. ROUTER CONFIGURATION
// ========================================================================
$request_uri = strtok($_SERVER['REQUEST_URI'], '?');
$request_method = $_SERVER['REQUEST_METHOD'];

// Helper functions
function view(string $file, array $data = []) { extract($data); ob_start(); include __DIR__ . "/templates/$file.php"; return ob_get_clean(); }
function jsonResponse($data, $code = 200) { http_response_code($code); header('Content-Type: application/json'); echo json_encode($data); exit; }
function isLoggedIn(): bool { return isset($_SESSION['web_user_id']); }
function isAdmin(): bool { return isset($_SESSION['web_role']) && $_SESSION['web_role'] === 'admin'; }
function validateAdminKey(): void {
    $headers = apache_request_headers();
    $apiKey = $headers['x-admin-key'] ?? $_GET['key'] ?? '';
    if ($apiKey !== ADMIN_API_KEY) { jsonResponse(['error' => 'Unauthorized. Valid admin API key required.'], 401); }
}
function getClientForUser(): ?array {
    $pdo = Database::getInstance()->getPdo();
    $stmt = $pdo->prepare("SELECT c.* FROM clients c JOIN web_users w ON c.id = w.client_id WHERE w.id = ?");
    $stmt->execute([$_SESSION['web_user_id']]);
    return $stmt->fetch();
}

// ========================================================================
// 2. PUBLIC & AUTH ROUTES
// ========================================================================
if ($request_method === 'GET' && ($request_uri === '/' || $request_uri === '')) { echo file_get_contents(__DIR__ . '/index.html'); exit; }
if ($request_method === 'GET' && $request_uri === '/referral') { echo file_get_contents(__DIR__ . '/referral.html'); exit; }
if ($request_method === 'GET' && $request_uri === '/login') { echo view('login'); exit; }
if ($request_method === 'GET' && $request_uri === '/signup') { echo view('signup'); exit; }

if ($request_method === 'POST' && $request_uri === '/api/login') {
    $pdo = Database::getInstance()->getPdo();
    $stmt = $pdo->prepare("SELECT * FROM web_users WHERE email = ?");
    $stmt->execute([$_POST['email'] ?? '']);
    $user = $stmt->fetch();
    if ($user && password_verify($_POST['password'] ?? '', $user['password_hash'])) {
        // Check 2FA
        if (!empty($user['twofa_secret'])) {
            $_SESSION['2fa_pending_user_id'] = $user['id'];
            jsonResponse(['success' => true, 'redirect' => '/2fa-verify']);
        } else {
            $_SESSION['web_user_id'] = $user['id'];
            $_SESSION['web_role'] = $user['role'];
            $pdo->prepare("UPDATE web_users SET last_login = NOW() WHERE id = ?")->execute([$user['id']]);
            jsonResponse(['success' => true, 'redirect' => '/dashboard']);
        }
    } else { jsonResponse(['error' => 'Invalid email or password.'], 401); }
}

if ($request_method === 'GET' && $request_uri === '/2fa-verify') {
    if (!isset($_SESSION['2fa_pending_user_id'])) { header('Location: /login'); exit; }
    echo view('2fa_verify');
    exit;
}

if ($request_method === 'POST' && $request_uri === '/api/2fa-verify') {
    $pdo = Database::getInstance()->getPdo();
    $userId = $_SESSION['2fa_pending_user_id'] ?? null;
    if (!$userId) jsonResponse(['error' => 'Session expired.'], 401);
    $stmt = $pdo->prepare("SELECT twofa_secret FROM web_users WHERE id = ?");
    $stmt->execute([$userId]); $user = $stmt->fetch();
    if (!TwoFAHelper::verifyCode($user['twofa_secret'], $_POST['code'] ?? '')) jsonResponse(['error' => 'Invalid code.'], 401);
    
    $_SESSION['web_user_id'] = $userId;
    $_SESSION['web_role'] = $user['role'];
    unset($_SESSION['2fa_pending_user_id']);
    jsonResponse(['success' => true, 'redirect' => '/dashboard']);
}

if ($request_method === 'POST' && $request_uri === '/api/signup') {
    $email = trim($_POST['email'] ?? ''); $pass = $_POST['password'] ?? ''; $name = trim($_POST['full_name'] ?? '');
    if (!filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($pass) < 6) jsonResponse(['error' => 'Valid email and password (min 6 chars) required.'], 400);
    $pdo = Database::getInstance()->getPdo();
    $stmt = $pdo->prepare("SELECT id FROM web_users WHERE email = ?"); $stmt->execute([$email]);
    if ($stmt->fetch()) jsonResponse(['error' => 'Email already registered.'], 409);
    $hash = password_hash($pass, PASSWORD_DEFAULT);
    $pdo->prepare("INSERT INTO web_users (email, password_hash, full_name, role) VALUES (?, ?, ?, 'user')")->execute([$email, $hash, $name]);
    $id = $pdo->lastInsertId();
    $_SESSION['web_user_id'] = $id; $_SESSION['web_role'] = 'user';
    jsonResponse(['success' => true, 'redirect' => '/dashboard']);
}

if ($request_method === 'GET' && $request_uri === '/logout') { session_destroy(); header('Location: /login'); exit; }

// ========================================================================
// 3. CLIENT DASHBOARD ROUTES
// ========================================================================
if ($request_method === 'GET' && $request_uri === '/dashboard') {
    if (!isLoggedIn()) { header('Location: /login'); exit; }
    $pdo = Database::getInstance()->getPdo();
    $stmt = $pdo->prepare("SELECT c.id as client_id, c.telegram_id, w.id as web_id FROM web_users w LEFT JOIN clients c ON w.client_id = c.id WHERE w.id = ?");
    $stmt->execute([$_SESSION['web_user_id']]);
    $res = $stmt->fetch();
    echo view('client_dashboard', ['linked' => ($res && $res['client_id'])]);
    exit;
}

// Client API Endpoints
if (str_starts_with($request_uri, '/api/client/')) {
    if (!isLoggedIn()) jsonResponse(['error' => 'Unauthorized'], 401);
    $user = getClientForUser();
    $pdo = Database::getInstance()->getPdo();
    
    if ($request_uri === '/api/client/2fa-enable') {
        $secret = TwoFAHelper::generateSecret();
        $pdo->prepare("UPDATE web_users SET twofa_secret = ? WHERE id = ?")->execute([$secret, $_SESSION['web_user_id']]);
        jsonResponse(['success' => true, 'secret' => $secret, 'message' => 'Scan this secret in Google Authenticator.']);
    }

    if ($request_uri === '/api/client/profile') {
        $ref = new ReferralTracker(); $stats = $ref->getReferralStats($user['id'] ?? 0);
        jsonResponse(['client' => $user, 'stats' => $stats]);
    }
    if ($request_uri === '/api/client/orders') {
        $stmt = $pdo->prepare("SELECT id, service, status, total_charge, created_at FROM orders WHERE client_id = ? ORDER BY created_at DESC");
        $stmt->execute([$user['id']]); jsonResponse(['orders' => $stmt->fetchAll()]);
    }
    if ($request_uri === '/api/client/leaderboard') {
        $ref = new ReferralTracker(); $stats = $ref->getReferralStats($user['id'] ?? 0);
        jsonResponse(['leaderboard' => $stats['top_referrers'] ?? []]);
    }
    if ($request_uri === '/api/client/link-telegram') {
        $tid = trim($_POST['telegram_id'] ?? '');
        if (!$tid) jsonResponse(['error' => 'Telegram ID required'], 400);
        $stmt = $pdo->prepare("SELECT id FROM clients WHERE telegram_id = ?"); $stmt->execute([$tid]); $cl = $stmt->fetch();
        if (!$cl) jsonResponse(['error' => 'No client found with that Telegram ID.'], 400);
        $pdo->prepare("UPDATE web_users SET client_id = ? WHERE id = ?")->execute([$cl['id'], $_SESSION['web_user_id']]);
        jsonResponse(['success' => true]);
    }
    if ($request_uri === '/api/client/withdraw') {
        $amount = (int)($_POST['amount'] ?? 0); $method = trim($_POST['method'] ?? ''); $account = trim($_POST['account_details'] ?? '');
        if ($amount < 1000) jsonResponse(['error' => 'Minimum withdrawal is MK1,000.'], 400);
        if (!$method || !$account) jsonResponse(['error' => 'Please provide payment method and details.'], 400);
        if (($user['referral_credit'] ?? 0) < $amount) jsonResponse(['error' => 'Insufficient balance.'], 400);
        $pdo->beginTransaction();
        $pdo->prepare("UPDATE clients SET referral_credit = referral_credit - ? WHERE id = ?")->execute([$amount, $user['id']]);
        $pdo->prepare("INSERT INTO withdrawals (client_id, amount, method, account_details, status) VALUES (?, ?, ?, ?, 'pending')")->execute([$user['id'], $amount, $method, $account]);
        $pdo->commit(); jsonResponse(['success' => true]);
    }

    // Support Tickets for User
    if ($request_uri === '/api/client/tickets') {
        $stmt = $pdo->prepare("SELECT * FROM support_tickets WHERE web_user_id = ? ORDER BY created_at DESC");
        $stmt->execute([$_SESSION['web_user_id']]); jsonResponse(['tickets' => $stmt->fetchAll()]);
    }
    if ($request_uri === '/api/client/tickets' && $request_method === 'POST') {
        $data = json_decode(file_get_contents('php://input'), true);
        if (empty($data['subject']) || empty($data['message'])) jsonResponse(['error' => 'Subject and message required.'], 400);
        $pdo->prepare("INSERT INTO support_tickets (web_user_id, subject, message, status) VALUES (?, ?, ?, 'open')")->execute([$_SESSION['web_user_id'], $data['subject'], $data['message']]);
        jsonResponse(['success' => true]);
    }
    if (preg_match('/\/api\/client\/tickets\/(\d+)\/reply/', $request_uri, $m) && $request_method === 'POST') {
        $data = json_decode(file_get_contents('php://input'), true);
        $pdo->prepare("INSERT INTO ticket_replies (ticket_id, web_user_id, reply, is_admin) VALUES (?, ?, ?, 0)")->execute([$m[1], $_SESSION['web_user_id'], $data['reply']]);
        jsonResponse(['success' => true]);
    }
    jsonResponse(['error' => 'Unknown endpoint'], 404);
}

// ========================================================================
// 4. ADMIN API ROUTES (CMS, Support, Analytics, Pricing)
// ========================================================================
if (str_starts_with($request_uri, '/admin/')) {
    validateAdminKey(); // Every admin endpoint requires the API key header
    $pdo = Database::getInstance()->getPdo();

    // Analytics
    if ($request_uri === '/admin/analytics') {
        $pageviews = $pdo->query("SELECT COUNT(*) as count, DATE(created_at) as date FROM analytics_logs WHERE event_type='pageview' GROUP BY DATE(created_at) ORDER BY date DESC LIMIT 30")->fetchAll();
        $conversions = $pdo->query("SELECT COUNT(*) as count, DATE(created_at) as date FROM analytics_logs WHERE event_type='conversion' GROUP BY DATE(created_at) ORDER BY date DESC LIMIT 30")->fetchAll();
        $topPages = $pdo->query("SELECT page_url, COUNT(*) as views FROM analytics_logs WHERE event_type='pageview' GROUP BY page_url ORDER BY views DESC LIMIT 10")->fetchAll();
        jsonResponse(['pageviews' => $pageviews, 'conversions' => $conversions, 'top_pages' => $topPages]);
    }

    // Blog CMS
    if ($request_uri === '/admin/blog-posts' && $request_method === 'GET') {
        jsonResponse($pdo->query("SELECT * FROM blog_posts ORDER BY created_at DESC")->fetchAll());
    }
    if ($request_uri === '/admin/blog-posts' && $request_method === 'POST') {
        $d = json_decode(file_get_contents('php://input'), true);
        if (empty($d['title']) || empty($d['content'])) jsonResponse(['error' => 'Title and content required.'], 400);
        $slug = strtolower(trim(preg_replace('/[^A-Za-z0-9-]+/', '-', $d['title'])));
        $pdo->prepare("INSERT INTO blog_posts (title, slug, content, excerpt, author, published) VALUES (?, ?, ?, ?, ?, ?)")->execute([$d['title'], $slug, $d['content'], $d['excerpt'] ?? '', $d['author'] ?? 'Admin', $d['published'] ?? 1]);
        jsonResponse(['success' => true]);
    }
    if (preg_match('/\/admin\/blog-posts\/(\d+)/', $request_uri, $m)) {
        if ($request_method === 'POST') { $d = json_decode(file_get_contents('php://input'), true); $pdo->prepare("UPDATE blog_posts SET title=?, content=?, excerpt=?, published=? WHERE id=?")->execute([$d['title'], $d['content'], $d['excerpt'] ?? '', $d['published'] ?? 1, $m[1]]); jsonResponse(['success' => true]); }
        if ($request_method === 'DELETE') { $pdo->prepare("DELETE FROM blog_posts WHERE id = ?")->execute([$m[1]]); jsonResponse(['success' => true]); }
    }

    // FAQ CMS
    if ($request_uri === '/admin/faqs' && $request_method === 'GET') { jsonResponse($pdo->query("SELECT * FROM faqs ORDER BY sort_order ASC")->fetchAll()); }
    if ($request_uri === '/admin/faqs' && $request_method === 'POST') { $d = json_decode(file_get_contents('php://input'), true); $pdo->prepare("INSERT INTO faqs (question, answer, category, sort_order) VALUES (?, ?, ?, ?)")->execute([$d['question'], $d['answer'], $d['category'] ?? 'General', $d['sort_order'] ?? 0]); jsonResponse(['success' => true]); }
    if (preg_match('/\/admin\/faqs\/(\d+)/', $request_uri, $m)) {
        if ($request_method === 'POST') { $d = json_decode(file_get_contents('php://input'), true); $pdo->prepare("UPDATE faqs SET question=?, answer=?, category=?, sort_order=? WHERE id=?")->execute([$d['question'], $d['answer'], $d['category'] ?? 'General', $d['sort_order'] ?? 0, $m[1]]); jsonResponse(['success' => true]); }
        if ($request_method === 'DELETE') { $pdo->prepare("DELETE FROM faqs WHERE id = ?")->execute([$m[1]]); jsonResponse(['success' => true]); }
    }

    // Support Tickets (Admin)
    if ($request_uri === '/admin/tickets' && $request_method === 'GET') {
        $stmt = $pdo->query("SELECT t.*, w.full_name, w.email FROM support_tickets t LEFT JOIN web_users w ON t.web_user_id = w.id ORDER BY t.created_at DESC");
        jsonResponse(['tickets' => $stmt->fetchAll()]);
    }
    if (preg_match('/\/admin\/tickets\/(\d+)\/reply/', $request_uri, $m) && $request_method === 'POST') {
        $d = json_decode(file_get_contents('php://input'), true);
        $pdo->prepare("INSERT INTO ticket_replies (ticket_id, reply, is_admin) VALUES (?, ?, 1)")->execute([$m[1], $d['reply']]);
        $pdo->prepare("UPDATE support_tickets SET status = 'in_progress' WHERE id = ?")->execute([$m[1]]);
        jsonResponse(['success' => true]);
    }
    if (preg_match('/\/admin\/tickets\/(\d+)\/status/', $request_uri, $m) && $request_method === 'POST') {
        $d = json_decode(file_get_contents('php://input'), true);
        $pdo->prepare("UPDATE support_tickets SET status = ? WHERE id = ?")->execute([$d['status'], $m[1]]);
        jsonResponse(['success' => true]);
    }

    // Existing Admin Endpoints (Stats, Orders, Clients, Prices, etc.)
    if ($request_uri === '/admin/full-stats') { 
        $orders = $pdo->query("SELECT COUNT(*) as total FROM orders")->fetch();
        $clients = $pdo->query("SELECT COUNT(*) as total FROM clients")->fetch();
        $rev = $pdo->query("SELECT SUM(CAST(REPLACE(total_charge, 'MK', '') AS UNSIGNED)) as revenue FROM orders WHERE payment_status = 'completed'")->fetch();
        jsonResponse(['orders'=>$orders['total'], 'clients'=>$clients['total'], 'revenue'=>$rev['revenue']]); 
    }
    if ($request_uri === '/admin/orders') { jsonResponse(['orders' => $pdo->query("SELECT o.*, c.first_name, c.last_name FROM orders o JOIN clients c ON o.client_id = c.id ORDER BY o.created_at DESC")->fetchAll()]); }
    if ($request_uri === '/admin/clients') { jsonResponse(['clients' => $pdo->query("SELECT * FROM clients ORDER BY created_at DESC")->fetchAll()]); }
    if ($request_uri === '/admin/prices') { $p = file_exists('./price_config.json') ? json_decode(file_get_contents('./price_config.json'), true) : []; jsonResponse($p); }
    if ($request_uri === '/admin/update-prices' && $request_method === 'POST') { file_put_contents('./price_config.json', json_encode(json_decode(file_get_contents('php://input'), true), JSON_PRETTY_PRINT)); jsonResponse(['success' => true]); }
    
    jsonResponse(['error' => 'Unknown admin endpoint'], 404);
}

// ========================================================================
// 5. OTHER ENDPOINTS (Track Analytics)
// ========================================================================
if ($request_method === 'POST' && str_contains($request_uri, '/api/track')) {
    $data = json_decode(file_get_contents('php://input'), true);
    $analytics = new AnalyticsService();
    if ($data['type'] === 'pageview') $analytics->trackPageView($data['url'], $_SERVER['REMOTE_ADDR'] ?? '', $_SERVER['HTTP_USER_AGENT'] ?? '');
    if ($data['type'] === 'conversion') $analytics->trackConversion($data['url'], $_SERVER['REMOTE_ADDR'] ?? '');
    jsonResponse(['success' => true]);
}
if ($request_method === 'POST' && str_contains($request_uri, '/api/send-telegram-link')) {
    $data = json_decode(file_get_contents('php://input'), true);
    $notif = new NotificationService();
    
    // Use the welcome_email template instead of raw string
    $ok = $notif->sendWithTemplate(
        $data['email'], 
        'welcome_email', 
        [
            'name' => $data['name'] ?? 'Friend',
            'bot_link' => $data['link']
        ]
    );
    jsonResponse(['success' => $ok]);
}

// Default 404
http_response_code(404);
echo "404 Not Found";