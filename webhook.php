<?php
declare(strict_types=1);

// ========================================================================
// 0. CONFIGURATION (InfinityFree / Production)
// ========================================================================
define('BOT_TOKEN', '8612054816:AAFJJeZcZp-bHGVBedAVjE8UAT9bUjfsMDg');
define('ADMIN_API_KEY', '0.i45qbafdnui0.0b656qiu0v3');
define('DB_HOST', 'sql312.infinityfree.com');
define('DB_NAME', 'if0_42443340_easysuccor');
define('DB_USER', 'if0_42443340');
define('DB_PASS', '1nAKMIzwmh3Z3U');
define('ADMIN_CHAT_ID', '988576432');
define('ZOHO_SMTP_HOST', 'smtp.zoho.com');
define('ZOHO_SMTP_PORT', 465);
define('ZOHO_EMAIL', '265-881193707.705@zohomail.com');
define('ZOHO_PASS', 'JpDxY6L6WsAm');
define('PAYMENT_AIRTEL', '0991295401');
define('PAYMENT_TNM', '0886928639');
define('PAYMENT_MO626', '1005653618');
define('WEBHOOK_URL', 'https://easysuccor.ct.ws/webhook.php');
// ========================================================================
// 1. COMPOSER AUTOLOAD (Requires: smalot/pdfparser, phpmailer/phpmailer)
// ========================================================================
require_once __DIR__ . '/vendor/autoload.php';

use Smalot\PdfParser\Parser as PdfParser;
use PHPMailer\PHPMailer\PHPMailer;
use PHPMailer\PHPMailer\SMTP;
use PHPMailer\PHPMailer\Exception as MailException;

// ========================================================================
// 2. CORE: DATABASE CONNECTION (PDO Singleton)
// ========================================================================
class Database {
    private static ?Database $instance = null;
    private \PDO $pdo;
    private function __construct() {
        $dsn = "mysql:host=" . DB_HOST . ";dbname=" . DB_NAME . ";charset=utf8mb4";
        $this->pdo = new \PDO($dsn, DB_USER, DB_PASS);
        $this->pdo->setAttribute(\PDO::ATTR_ERRMODE, \PDO::ERRMODE_EXCEPTION);
        $this->pdo->setAttribute(\PDO::ATTR_DEFAULT_FETCH_MODE, \PDO::FETCH_ASSOC);
        $this->createTables();
    }
    public static function getInstance(): Database {
        if (self::$instance === null) self::$instance = new Database();
        return self::$instance;
    }
    public function getPdo(): \PDO { return $this->pdo; }

    private function createTables(): void {
        $sql = "
        CREATE TABLE IF NOT EXISTS clients (id INT AUTO_INCREMENT PRIMARY KEY, telegram_id VARCHAR(255) UNIQUE, username VARCHAR(255), first_name VARCHAR(255), last_name VARCHAR(255), phone VARCHAR(50), email VARCHAR(255), location VARCHAR(255), physical_address TEXT, nationality VARCHAR(100), special_documents JSON, referral_code VARCHAR(50) UNIQUE, referred_by INT, referral_credit INT DEFAULT 0, total_orders INT DEFAULT 0, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, last_active TIMESTAMP);
        CREATE TABLE IF NOT EXISTS sessions (id INT AUTO_INCREMENT PRIMARY KEY, client_id INT NOT NULL, stage VARCHAR(100), current_section VARCHAR(100), data JSON, is_paused TINYINT(1) DEFAULT 0, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE);
        CREATE TABLE IF NOT EXISTS orders (id VARCHAR(50) PRIMARY KEY, client_id INT NOT NULL, service VARCHAR(100), category VARCHAR(100), delivery_option VARCHAR(50), delivery_time VARCHAR(50), base_price INT, delivery_fee INT, total_charge VARCHAR(50), payment_status VARCHAR(50), payment_type VARCHAR(50), installment_data JSON, pay_later_data JSON, cv_data JSON, portfolio_links JSON, status VARCHAR(50), version INT DEFAULT 1, payment_reference VARCHAR(100), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, delivered_at TIMESTAMP NULL, FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE);
        CREATE TABLE IF NOT EXISTS referrals (id INT AUTO_INCREMENT PRIMARY KEY, referrer_id INT, referred_id INT, referral_code VARCHAR(50), status VARCHAR(50), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, completed_at TIMESTAMP NULL, FOREIGN KEY (referrer_id) REFERENCES clients(id) ON DELETE CASCADE, FOREIGN KEY (referred_id) REFERENCES clients(id) ON DELETE CASCADE);
        CREATE TABLE IF NOT EXISTS testimonials (id INT AUTO_INCREMENT PRIMARY KEY, client_id INT, name VARCHAR(255), text TEXT, rating INT, approved BOOLEAN DEFAULT FALSE, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE);
        CREATE TABLE IF NOT EXISTS admin_logs (id INT AUTO_INCREMENT PRIMARY KEY, admin_id VARCHAR(100), action VARCHAR(255), details TEXT, timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
        ";
        $this->pdo->exec($sql);
    }
}

// ========================================================================
// 3. TELEGRAM API WRAPPER
// ========================================================================
class TelegramApi {
    private string $token = BOT_TOKEN;
    public function request(string $method, array $params = []): ?array {
        $url = "https://api.telegram.org/bot{$this->token}/{$method}";
        $ch = curl_init();
        curl_setopt($ch, CURLOPT_URL, $url); curl_setopt($ch, CURLOPT_POST, true);
        curl_setopt($ch, CURLOPT_POSTFIELDS, $params); curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        $res = curl_exec($ch); curl_close($ch);
        $data = json_decode($res, true); return ($data['ok'] ?? false) ? $data['result'] : null;
    }
    public function sendMessage(string $chatId, string $text, array $extra = []): ?array {
        return $this->request('sendMessage', ['chat_id' => $chatId, 'text' => $text, 'parse_mode' => 'Markdown'] + $extra);
    }
    public function editMessageText(string $chatId, int $msgId, string $text, array $keyboard = []): ?array {
        return $this->request('editMessageText', ['chat_id' => $chatId, 'message_id' => $msgId, 'text' => $text, 'parse_mode' => 'Markdown', 'reply_markup' => json_encode($keyboard)]);
    }
    public function answerCallback(string $id, string $text = ''): void { $this->request('answerCallbackQuery', ['callback_query_id' => $id, 'text' => $text]); }
}

// ========================================================================
// 4. SERVICES: DOCUMENT PARSER (USING YOUR PROVEN EXTRACTION ENGINE)
// ========================================================================
class DocumentParser {
    // --- Helper functions from your book processor ---
    private function detectFileType(string $file_path): string|false {
        if (!file_exists($file_path)) return false;
        if (function_exists('mime_content_type')) {
            $mime = mime_content_type($file_path);
            if (str_contains($mime, 'pdf')) return 'pdf';
            if (str_contains($mime, 'word') || str_contains($mime, 'document')) return 'docx';
            if (str_contains($mime, 'epub')) return 'epub';
        }
        return strtolower(pathinfo($file_path, PATHINFO_EXTENSION));
    }

    private function fixEncoding(string $text): string {
        $detected = mb_detect_encoding($text, 'UTF-8, Windows-1252, ISO-8859-1, ASCII', true);
        if ($detected !== 'UTF-8' && $detected !== 'ASCII') {
            $text = mb_convert_encoding($text, 'UTF-8', $detected);
        }
        $replacements = [
            'â€œ' => '“', 'â€' => '”', 'â€™' => '’',
            'â€˜' => '‘', 'â€"’' => '—', 'â€”' => '—',
            'â€“' => '–', 'â€…' => '…', 'â€¢' => '•',
            'â€¹' => '‹', 'â€º' => '›', 'â‚¬' => '€',
            'â„¢' => '™', 'â€¡' => '‡', 'â€°' => '‰',
            'â€š' => '‚', 'â€ž' => '„'
        ];
        return str_replace(array_keys($replacements), array_values($replacements), trim($text));
    }

    private function extractPDF(string $file_path): string {
        // Option 1: use Smalot PdfParser (composer)
        if (class_exists('\\Smalot\\PdfParser\\Parser')) {
            $parser = new \Smalot\PdfParser\Parser();
            try {
                $pdf = $parser->parseFile($file_path);
                $text = $pdf->getText();
                if (empty(trim($text))) {
                    return '⚠️ This PDF appears to be a scan (no extractable text).';
                }
                return $this->fixEncoding($text);
            } catch (Exception $e) { /* fall through */ }
        }

        // Option 2: try pdftotext command line
        if (function_exists('exec')) {
            $txt_path = dirname($file_path) . '/' . pathinfo($file_path, PATHINFO_FILENAME) . '.txt';
            $pdftotext_path = defined('PDFTOTEXT_PATH') ? PDFTOTEXT_PATH : 'pdftotext';
            exec("$pdftotext_path -layout -enc UTF-8 '$file_path' '$txt_path' 2>&1", $output, $return_var);
            if ($return_var === 0 && file_exists($txt_path)) {
                $text = file_get_contents($txt_path);
                @unlink($txt_path);
                return $this->fixEncoding($text);
            }
        }

        // Option 3: fallback to manual include (if library path known)
        return '⚠️ Could not extract text from PDF. Please ensure pdftotext is installed or use a different format.';
    }

    private function extractDOCX(string $file_path): string {
        $zip = zip_open($file_path);
        if (!$zip || is_numeric($zip)) return '';
        $content = '';
        while ($zip_entry = zip_read($zip)) {
            if (zip_entry_name($zip_entry) == 'word/document.xml') {
                if (zip_entry_open($zip, $zip_entry, "r")) {
                    $xml = zip_entry_read($zip_entry, zip_entry_filesize($zip_entry));
                    $xml = strip_tags($xml, '<w:t>');
                    $xml = str_replace(['<w:t>', '</w:t>'], '', $xml);
                    $content .= html_entity_decode($xml);
                    zip_entry_close($zip_entry);
                    break;
                }
            }
        }
        zip_close($zip);
        return $this->fixEncoding($content);
    }

    private function extractEPUB(string $file_path): string {
        $zip = new ZipArchive();
        if ($zip->open($file_path) !== TRUE) return '';
        $html_content = '';
        $opf_path = null;
        for ($i = 0; $i < $zip->numFiles; $i++) {
            if (str_contains($zip->getNameIndex($i), '.opf')) {
                $opf_path = $zip->getNameIndex($i);
                break;
            }
        }
        if (!$opf_path) { $zip->close(); return ''; }
        $opf_xml = $zip->getFromName($opf_path);
        $opf = simplexml_load_string($opf_xml);
        $ns = $opf->getNamespaces(true);
        $opf->registerXPathNamespace('opf', $ns[''] ?? 'http://www.idpf.org/2007/opf');
        $items = $opf->xpath('//opf:manifest/opf:item[@media-type="application/xhtml+xml"]');
        $base_dir = dirname($opf_path) . '/';
        foreach ($items as $item) {
            $href = (string)$item['href'];
            $full_path = $base_dir . $href;
            $content = $zip->getFromName($full_path);
            if ($content) {
                $html_content .= $this->fixEncoding($content);
            }
        }
        $zip->close();
        return $html_content;
    }

    // --- Main extraction method ---
    public function extractText(string $file_path): string {
        if (!file_exists($file_path)) throw new \Exception("File not found.");
        $type = $this->detectFileType($file_path);
        if ($type === 'pdf') {
            $text = $this->extractPDF($file_path);
        } elseif ($type === 'epub') {
            $text = $this->extractEPUB($file_path);
        } elseif ($type === 'docx') {
            $text = $this->extractDOCX($file_path);
        } else {
            $text = file_get_contents($file_path);
        }
        if (str_starts_with($text, '⚠️')) {
            throw new \Exception($text);
        }
        return $this->fixEncoding($text);
    }

    // --- CV parsing (regex/dictionary based) ---
    private array $tech = ['python','javascript','java','react','node','sql','aws','docker','git','linux','excel','power bi','tableau','spss','matlab','autocad','solidworks','c++','c#','php','laravel','django','flask','mongodb','postgresql','redis','kubernetes','terraform','ansible','jenkins','jira','confluence','salesforce','sap','oracle','wordpress','shopify','seo','google analytics'];
    private array $soft = ['leadership','communication','teamwork','problem solving','critical thinking','time management','organization','adaptability','creativity','collaboration','negotiation','conflict resolution','decision making','project management','agile','scrum','kanban','mentoring','coaching','presentation','public speaking'];

    public function parseCV(string $text): array {
        $cv = ['personal'=>['full_name'=>'','email'=>'','phone'=>''], 'employment'=>[], 'education'=>[], 'skills'=>['technical'=>[],'soft'=>[],'tools'=>[]], 'certifications'=>[], 'languages'=>[], 'projects'=>[], 'achievements'=>[], 'volunteer'=>[], 'leadership'=>[], 'awards'=>[], 'publications'=>[], 'conferences'=>[], 'referees'=>[], 'interests'=>[], 'social_media'=>[], 'portfolio'=>[]];
        $lines = preg_split('/\r\n|\r|\n/', $text);
        $cv['personal']['full_name'] = trim($lines[0] ?? '');
        preg_match('/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/', $text, $e) && $cv['personal']['email'] = $e[0];
        preg_match('/\+?[0-9\s\-\(\)]{8,20}/', $text, $p) && $cv['personal']['phone'] = $p[0];
        $low = strtolower($text);
        foreach($this->tech as $s) { if(str_contains($low, $s)) $cv['skills']['technical'][] = ucwords($s); }
        foreach($this->soft as $s) { if(str_contains($low, $s)) $cv['skills']['soft'][] = ucwords($s); }
        $cv['skills']['technical'] = array_unique($cv['skills']['technical']);
        preg_match_all('/(.*?)\s+at\s+(.*?)(?:\n|\r)/i', $text, $jobs, PREG_SET_ORDER);
        foreach($jobs as $j) { if(trim($j[1]) && trim($j[2])) $cv['employment'][] = ['title'=>trim($j[1]),'company'=>trim($j[2]),'duration'=>'','responsibilities'=>[],'achievements'=>[]]; }
        preg_match('/(BSc|MSc|PhD|Bachelor|Master|Diploma)\s+in\s+(.*?)(?:\n|\r)/i', $text, $e) && $cv['education'][] = ['level'=>$e[1],'field'=>trim($e[2]),'institution'=>'','year'=>''];
        return $cv;
    }
}

// ========================================================================
// 5. SERVICES: INTELLIGENT UPDATE (NO AI)
// ========================================================================
class IntelligentUpdate {
    public function processUpdate(array $cv, string $req): array {
        $changes = []; $low = strtolower($req);
        if (str_contains($low, 'add') && str_contains($low, 'years') && str_contains($low, 'at')) {
            preg_match('/add\s+(\d+)\s+years?\s+as\s+(.*?)\s+at\s+(.*?)(?:\.|$)/i', $req, $m);
            if (count($m) === 4) { $cv['employment'][] = ['title'=>trim($m[2]),'company'=>trim($m[3]),'duration'=>"{$m[1]} years",'responsibilities'=>[],'achievements'=>[]]; $changes[] = "Added {$m[1]} years as {$m[2]} at {$m[3]}"; }
        }
        if (str_contains($low, 'update my phone')) { preg_match('/phone\s+to\s+([\d\s\+]+)/i', $req, $m); if(isset($m[1])) { $cv['personal']['phone'] = trim($m[1]); $changes[] = "Updated phone"; } }
        return ['success'=>(bool)$changes, 'updated_cv'=>$cv, 'changes_summary'=>$changes];
    }
}

// ========================================================================
// 6. SERVICES: NOTIFICATION & TEMPLATE ENGINE
// ========================================================================
class EmailTemplateEngine {
    private Database $db;
    public function __construct() { $this->db = Database::getInstance(); }

    // Loads template by name from the database
    public function loadTemplate(string $name): ?array {
        $pdo = $this->db->getPdo();
        $stmt = $pdo->prepare("SELECT subject, html_content, text_content FROM email_templates WHERE name = ?");
        $stmt->execute([$name]);
        $template = $stmt->fetch();
        return $template ? $template : null;
    }

    // Replaces {{key}} with values from the $data array
    public function render(string $content, array $data): string {
        foreach ($data as $key => $value) {
            $content = str_replace('{{' . $key . '}}', $value, $content);
        }
        return $content;
    }
}

class NotificationService {
    private EmailTemplateEngine $templates;
    public function __construct() {
        $this->templates = new EmailTemplateEngine();
    }

    // Sends a raw email (fallback for simple notifications)
    public function sendEmail(string $to, string $subject, string $body): bool {
        $mail = new PHPMailer(true);
        try {
            $mail->isSMTP(); $mail->Host = ZOHO_SMTP_HOST; $mail->SMTPAuth = true;
            $mail->Port = ZOHO_SMTP_PORT; $mail->SMTPSecure = PHPMailer::ENCRYPTION_SMTPS;
            $mail->Username = ZOHO_EMAIL; $mail->Password = ZOHO_PASS;
            $mail->setFrom(ZOHO_EMAIL, 'EasySuccor Bot');
            $mail->addAddress($to); $mail->Subject = $subject; $mail->Body = $body;
            return $mail->send();
        } catch (MailException $e) { error_log("Email Error: " . $mail->ErrorInfo); return false; }
    }

    // Sends an email using a loaded template and data variables
    public function sendWithTemplate(string $to, string $templateName, array $data): bool {
        $template = $this->templates->loadTemplate($templateName);
        if (!$template) {
            error_log("Template '$templateName' not found in database.");
            return false;
        }

        $subject = $this->templates->render($template['subject'], $data);
        $htmlBody = $this->templates->render($template['html_content'], $data);
        $textBody = $this->templates->render($template['text_content'], $data);

        $mail = new PHPMailer(true);
        try {
            $mail->isSMTP(); $mail->Host = ZOHO_SMTP_HOST; $mail->SMTPAuth = true;
            $mail->Port = ZOHO_SMTP_PORT; $mail->SMTPSecure = PHPMailer::ENCRYPTION_SMTPS;
            $mail->Username = ZOHO_EMAIL; $mail->Password = ZOHO_PASS;
            $mail->setFrom(ZOHO_EMAIL, 'EasySuccor Bot');
            $mail->addAddress($to);
            $mail->Subject = $subject;
            $mail->isHTML(true);
            $mail->Body = $htmlBody;
            $mail->AltBody = $textBody;
            return $mail->send();
        } catch (MailException $e) { error_log("Email Error: " . $mail->ErrorInfo); return false; }
    }

    // Helper to send admin alerts via Telegram (unchanged)
    public function alertAdmin(string $msg, TelegramApi $api): void { $api->sendMessage(ADMIN_CHAT_ID, "🔔 Admin Alert:\n{$msg}"); }
}

// ========================================================================
// 7. SERVICES: PAYMENT & TRACKER (Installment + Pay Later + Referral)
// ========================================================================
class PaymentProcessor {
    private Database $db; private TelegramApi $api;
    public function __construct() { $this->db = Database::getInstance(); $this->api = new TelegramApi(); }
    public function createInstallment(string $oid, int $cid, int $total): void {
        $first = ceil($total/2); $second = $total - $first; $due = date('Y-m-d', strtotime('+7 days'));
        $data = ['first_paid'=>false, 'second_paid'=>false, 'due'=>$due, 'first_amt'=>$first, 'second_amt'=>$second, 'reminders'=>[]];
        $pdo = $this->db->getPdo();
        $stmt = $pdo->prepare("UPDATE orders SET payment_type = 'installment', installment_data = ? WHERE id = ?");
        $stmt->execute([json_encode($data), $oid]);
    }
    public function confirmInstallment(string $oid, string $stage): void {
        $pdo = $this->db->getPdo();
        $stmt = $pdo->prepare("SELECT installment_data FROM orders WHERE id = ?");
        $stmt->execute([$oid]); $r = $stmt->fetch(); $data = json_decode($r['installment_data'], true);
        if ($stage === 'first') { $data['first_paid'] = true; }
        else { $data['second_paid'] = true; }
        $stmt = $pdo->prepare("UPDATE orders SET installment_data = ? WHERE id = ?");
        $stmt->execute([json_encode($data), $oid]);
    }
}
class ReferralTracker {
    private Database $db; private TelegramApi $api;
    public function __construct() { $this->db = Database::getInstance(); $this->api = new TelegramApi(); }
    public function processReferral(int $referrerId, int $newClientId, string $code): void {
        $pdo = $this->db->getPdo();
        $stmt = $pdo->prepare("INSERT INTO referrals (referrer_id, referred_id, referral_code, status, created_at) VALUES (?, ?, ?, 'pending', NOW())");
        $stmt->execute([$referrerId, $newClientId, $code]);
        $pdo->prepare("UPDATE clients SET referred_by = ? WHERE id = ?")->execute([$referrerId, $newClientId]);
    }
    public function completeReferral(int $referredId): void {
        $pdo = $this->db->getPdo();
        $stmt = $pdo->prepare("SELECT referrer_id FROM referrals WHERE referred_id = ? AND status = 'pending'");
        $stmt->execute([$referredId]); $r = $stmt->fetch();
        if ($r) {
            $pdo->prepare("UPDATE referrals SET status = 'completed', completed_at = NOW() WHERE referred_id = ?")->execute([$referredId]);
            $pdo->prepare("UPDATE clients SET referral_credit = referral_credit + 2000 WHERE id = ?")->execute([$r['referrer_id']]);
            $this->api->sendMessage((string)$r['referrer_id'], "🎉 Referral credited! +MK2,000 to your wallet.");
        }
    }
}

// ========================================================================
// 8. MAIN BOT HANDLER (Complete State Machine)
// ========================================================================
class BotHandler {
    private TelegramApi $api; private Database $db; private DocumentParser $parser; private PaymentProcessor $pay; private ReferralTracker $ref; private NotificationService $notif;
    private array $prices = ['student'=>['cv'=>6000,'editable_cv'=>8000,'cover'=>5000], 'professional'=>['cv'=>10000,'editable_cv'=>12000,'cover'=>6000]];
    private array $delivery = ['standard'=>['time'=>'6 hours','fee'=>0], 'express'=>['time'=>'2 hours','fee'=>3000], 'rush'=>['time'=>'1 hour','fee'=>5000]];
    private string $sep = "\n┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅\n";

    public function __construct() {
        $this->api = new TelegramApi(); $this->db = Database::getInstance(); $this->parser = new DocumentParser();
        $this->pay = new PaymentProcessor(); $this->ref = new ReferralTracker(); $this->notif = new NotificationService();
    }

    public function handle(array $update): void {
        if (isset($update['message'])) $this->handleMsg($update['message']);
        elseif (isset($update['callback_query'])) $this->handleCb($update['callback_query']);
    }

    // ---- MESSAGE HANDLER ----
    private function handleMsg(array $msg): void {
        $cid = (string)$msg['chat']['id']; $text = trim($msg['text'] ?? '');
        $pdo = $this->db->getPdo();
        // Get/Add Client
        $stmt = $pdo->prepare("SELECT * FROM clients WHERE telegram_id = ?");
        $stmt->execute([$cid]); $client = $stmt->fetch();
        if (!$client) {
            $code = strtoupper(substr(md5($cid.time()), 0, 8));
            $pdo->prepare("INSERT INTO clients (telegram_id, first_name, referral_code, last_active) VALUES (?, ?, ?, NOW())")->execute([$cid, $msg['from']['first_name']??'User', $code]);
            $client = $pdo->query("SELECT * FROM clients WHERE telegram_id = '$cid'")->fetch();
        } else { $pdo->prepare("UPDATE clients SET last_active = NOW() WHERE id = ?")->execute([$client['id']]); }
        // Get Session
        $stmt = $pdo->prepare("SELECT * FROM sessions WHERE client_id = ? AND is_paused = 0 ORDER BY id DESC LIMIT 1");
        $stmt->execute([$client['id']]); $s = $stmt->fetch();
        if (!$s) { $pdo->prepare("INSERT INTO sessions (client_id, stage, data) VALUES (?, 'start', '{}')")->execute([$client['id']]); $s = $pdo->query("SELECT * FROM sessions WHERE client_id = {$client['id']} ORDER BY id DESC LIMIT 1")->fetch(); }
        $data = json_decode($s['data'] ?? '{}', true);
        $stage = $s['stage'];

        // COMMANDS
        if ($text === '/start') { $this->welcome($cid, $client, $s); return; }
        if ($text === '/portal') { $this->showPortal($cid, $client); return; }
        if ($text === '/pay') { $this->api->sendMessage($cid, "💳 Use /pay [OrderID] to complete payment."); return; }
        if ($text === '/referral') { $this->showReferral($cid, $client); return; }
        if ($text === '/pause') { $pdo->prepare("UPDATE sessions SET is_paused = 1 WHERE id = ?")->execute([$s['id']]); $this->api->sendMessage($cid, "⏸️ Paused. Type /resume to continue."); return; }
        if ($text === '/resume') { $pdo->prepare("UPDATE sessions SET is_paused = 0 WHERE id = ?")->execute([$s['id']]); $this->api->sendMessage($cid, "▶️ Resumed. Continue where you left off."); return; }

        // STATE HANDLING
        $trigger = function($newStage, $newData) use ($pdo, $s) { $pdo->prepare("UPDATE sessions SET stage = ?, data = ? WHERE id = ?")->execute([$newStage, json_encode($newData), $s['id']]); };
        $respond = fn($msg) => $this->api->sendMessage($cid, $msg);

        if ($stage === 'collecting_portfolio' && $text !== '/skip') {
            $data['portfolio_links'] = array_filter(explode("\n", $text), fn($l) => filter_var(trim($l), FILTER_VALIDATE_URL));
            $data['cv_data']['portfolio'] = $data['portfolio_links'];
            $trigger('collecting_personal', $data);
            $respond("📁 Portfolio saved! Let's start with personal info.\n\nYour Full Name?");
            return;
        }
        if (str_starts_with($stage, 'collecting_personal')) {
            $cv = &$data['cv_data']; $step = $data['p_step'] ?? 0;
            $fields = ['full_name', 'email', 'primary_phone', 'location'];
            if ($step < count($fields)) { $cv['personal'][$fields[$step]] = $text; $data['p_step'] = $step + 1; $trigger($stage, $data); $respond($step+1 < count($fields) ? "Enter " . $fields[$step+1] : "Now, what is your highest level of education?"); }
            else { $trigger('collecting_education', $data); $respond("🎓 Enter your highest qualification (e.g. BSc in Computer Science):"); }
            return;
        }
        if ($stage === 'collecting_education') {
            $data['cv_data']['education'][] = ['level'=>$text, 'field'=>'', 'institution'=>'', 'year'=>''];
            $data['e_step'] = ($data['e_step']??0) + 1;
            $trigger('collecting_skills', $data);
            $respond("📚 Education saved. Now list your skills (comma separated):");
            return;
        }
        if ($stage === 'collecting_skills') {
            $skills = array_map('trim', explode(',', $text));
            $data['cv_data']['skills']['technical'] = $skills;
            $trigger('collecting_certifications', $data);
            $respond("📜 Add any certifications (or type /skip):");
            return;
        }
        if ($stage === 'collecting_certifications' && $text !== '/skip') {
            $data['cv_data']['certifications'][] = ['name'=>$text, 'issuer'=>'', 'date'=>''];
            $trigger($stage, $data); $respond("✅ Certification added. Add another or type /skip to continue.");
            return;
        }
        if ($stage === 'collecting_certifications' && $text === '/skip') {
            $trigger('collecting_projects', $data); $respond("📁 Share any projects (or /skip):");
            return;
        }
        if ($stage === 'collecting_projects' && $text !== '/skip') {
            $data['cv_data']['projects'][] = ['name'=>$text, 'description'=>'', 'technologies'=>''];
            $trigger($stage, $data); $respond("✅ Project added. Add another or type /skip to continue.");
            return;
        }
        if ($stage === 'collecting_projects' && $text === '/skip') {
            $trigger('collecting_achievements', $data); $respond("🏆 List your achievements (or /skip):");
            return;
        }
        if ($stage === 'collecting_achievements' && $text !== '/skip') {
            $data['cv_data']['achievements'][] = ['title'=>$text, 'description'=>'', 'date'=>''];
            $trigger($stage, $data); $respond("✅ Achievement added. Add another or type /skip to continue.");
            return;
        }
        if ($stage === 'collecting_achievements' && $text === '/skip') {
            $trigger('collecting_referees', $data); $respond("👥 Enter Referee 1 full name:");
            return;
        }
        if ($stage === 'collecting_referees') {
            $idx = ($data['r_idx'] ?? 0); $data['cv_data']['referees'][$idx]['name'] = $text; $data['r_idx'] = $idx + 1;
            if ($idx === 0) { $trigger($stage, $data); $respond("Enter Referee 1 position:"); }
            elseif ($idx === 1) { $trigger($stage, $data); $respond("Enter Referee 2 full name:"); }
            elseif ($idx === 2) { $trigger($stage, $data); $respond("Enter Referee 2 position:"); }
            else { $trigger('finalizing_cv', $data); $this->finalizeOrder($cid, $client, $data, $s['id']); }
            return;
        }

        // Intelligent Update
        if ($stage === 'awaiting_update_request') {
            $updater = new IntelligentUpdate(); $res = $updater->processUpdate($data['existing_cv'], $text);
            if ($res['success']) { $data['cv_data'] = $res['updated_cv']; $trigger('awaiting_payment', $data); $respond("✅ Update applied: " . implode("; ", $res['changes_summary']) . "\n\nType /pay to complete the order."); }
            else { $respond("❌ Could not parse update. Try 'Add 2 years as Manager at ABC Corp'"); }
            return;
        }
    }

    // ---- CALLBACK HANDLER (Buttons) ----
    private function handleCb(array $cb): void {
        $this->api->answerCallback($cb['id']);
        $data = $cb['data']; $cid = (string)$cb['message']['chat']['id']; $mid = $cb['message']['message_id'];
        $pdo = $this->db->getPdo();
        $stmt = $pdo->prepare("SELECT c.*, s.id as sid, s.stage, s.data FROM clients c JOIN sessions s ON c.id = s.client_id WHERE c.telegram_id = ? AND s.is_paused = 0");
        $stmt->execute([$cid]); $row = $stmt->fetch();
        if (!$row) return;
        $c = $row; $sesData = json_decode($c['data'], true); $sid = $c['sid'];
        $update = function($k, $v) use ($pdo, $sid) { $pdo->prepare("UPDATE sessions SET data = JSON_SET(data, ?, ?) WHERE id = ?")->execute([$k, $v, $sid]); };
        $stageSwitch = function($st) use ($pdo, $sid) { $pdo->prepare("UPDATE sessions SET stage = ? WHERE id = ?")->execute([$st, $sid]); };
        $respond = fn($msg) => $this->api->editMessageText($cid, $mid, $msg);

        // CATEGORY SELECTION
        if (str_starts_with($data, 'cat_')) {
            $cat = str_replace('cat_', '', $data);
            $sesData['category'] = $cat;
            $stageSwitch('selecting_service');
            $respond("✅ Category selected: {$cat}\nSelect service:", ['inline_keyboard'=>[[['text'=>"📄 New CV",'callback_data'=>"service_new"]]]]);
            return;
        }
        // SERVICE SELECTION
        if (str_starts_with($data, 'service_')) {
            $sesData['service'] = str_replace('service_', '', $data);
            $stageSwitch('selecting_build');
            $respond("📝 Build method:", ['inline_keyboard'=>[[['text'=>"📎 Upload Draft",'callback_data'=>"build_draft"], ['text'=>"✍️ Enter Manually",'callback_data'=>"build_manual"]]]]);
            return;
        }
        // BUILD METHOD
        if ($data === 'build_draft') { $stageSwitch('awaiting_draft'); $respond("📎 Please upload your CV (PDF/DOCX)."); return; }
        if ($data === 'build_manual') { $stageSwitch('collecting_portfolio'); $sesData['cv_data'] = []; $update('$.cv_data', json_encode([])); $respond("📁 Optional: Send portfolio links (or type /skip):"); return; }

        // PAYMENT CONFIRM
        if (str_starts_with($data, 'confirm_payment_')) {
            $oid = str_replace('confirm_payment_', '', $data);
            $pdo->prepare("UPDATE orders SET payment_status = 'completed', delivered_at = NOW() WHERE id = ?")->execute([$oid]);
            $this->ref->completeReferral($c['id']);
            $respond("✅ Payment confirmed! Your document will be delivered.");
            return;
        }
        // INSTALLMENT
        if (str_starts_with($data, 'inst_first_')) {
            $this->pay->confirmInstallment(str_replace('inst_first_', '', $data), 'first');
            $respond("✅ First installment confirmed. CV creation started.");
            return;
        }
    }

    // ---- CORE HELPERS ----
    private function welcome(string $cid, array $c, array $s): void {
        $key = ['inline_keyboard'=>[[['text'=>"🎓 Student",'callback_data'=>"cat_student"], ['text'=>"💼 Professional",'callback_data'=>"cat_professional"]]]];
        $this->api->sendMessage($cid, "📋 Welcome! Select your category:", ['reply_markup'=>json_encode($key)]);
        $pdo = $this->db->getPdo(); $pdo->prepare("UPDATE sessions SET stage = 'start' WHERE id = ?")->execute([$s['id']]);
    }

    private function finalizeOrder(string $cid, array $c, array $data, int $sid): void {
        $pdo = $this->db->getPdo();
        $base = $this->prices[$data['category']][$data['service']] ?? 6000;
        $del = $this->delivery[$data['delivery'] ?? 'standard'];
        $total = $base + $del['fee'];
        $oid = 'ORD_' . date('Ymd') . '_' . rand(1000, 9999);
        $stmt = $pdo->prepare("INSERT INTO orders (id, client_id, service, category, delivery_option, delivery_time, base_price, delivery_fee, total_charge, payment_status, cv_data, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
        $stmt->execute([$oid, $c['id'], $data['service'], $data['category'], 'standard', $del['time'], $base, $del['fee'], "MK{$total}", 'pending', json_encode($data['cv_data']), 'pending']);
        $pdo->prepare("UPDATE sessions SET stage = 'awaiting_payment' WHERE id = ?")->execute([$sid]);
        $this->api->sendMessage($cid, "📋 Order created: `{$oid}`\nTotal: MK{$total}\n\nSelect payment method:", ['reply_markup'=>json_encode(['inline_keyboard'=>[[['text'=>"📱 Mobile Money",'callback_data'=>"pay_mobile"], ['text'=>"📅 Installments",'callback_data'=>"pay_installment"]]]])]);
    }

    private function showPortal(string $cid, array $c): void {
        $pdo = $this->db->getPdo();
        $stmt = $pdo->query("SELECT COUNT(*) as c, SUM(CAST(REPLACE(total_charge, 'MK', '') AS UNSIGNED)) as s FROM orders WHERE client_id = {$c['id']} AND payment_status = 'completed'");
        $r = $stmt->fetch();
        $this->api->sendMessage($cid, "🏠 Portal\nName: {$c['first_name']}\nOrders: {$r['c']}\nTotal Spent: MK{$r['s']}\n/start to begin a new order.");
    }

    private function showReferral(string $cid, array $c): void {
        $pdo = $this->db->getPdo();
        $code = $c['referral_code']; $link = WEBHOOK_URL . "?ref={$code}";
        $this->api->sendMessage($cid, "🎁 Share your link:\n`{$link}`\n\nEarn MK2,000 per referral!");
    }
}

// ========================================================================
// 9. EXPRESS ROUTER REPLACEMENT (Pure PHP Webhook + Admin endpoints)
// ========================================================================
$uri = $_SERVER['REQUEST_URI']; $method = $_SERVER['REQUEST_METHOD'];

// Telegram Webhook
if ($method === 'POST' && str_contains($uri, '/webhook')) {
    $update = json_decode(file_get_contents('php://input'), true);
    if ($update) { (new BotHandler())->handle($update); }
    http_response_code(200); exit;
}

// Admin Dashboard API (Minimal)
if ($method === 'GET' && str_contains($uri, '/admin/stats')) {
    if (!isset($_SERVER['HTTP_X_ADMIN_KEY']) || $_SERVER['HTTP_X_ADMIN_KEY'] !== ADMIN_API_KEY) { http_response_code(401); exit; }
    $pdo = Database::getInstance()->getPdo();
    $orders = $pdo->query("SELECT COUNT(*) as total FROM orders")->fetch();
    $rev = $pdo->query("SELECT SUM(CAST(REPLACE(total_charge, 'MK', '') AS UNSIGNED)) as revenue FROM orders WHERE payment_status = 'completed'")->fetch();
    header('Content-Type: application/json');
    echo json_encode(['total_orders'=>$orders['total'], 'total_revenue'=>$rev['revenue']]);
    exit;
}
// ========================================================================
// 10. SERVICES: ANALYTICS & 2FA HELPER (PRODUCTION-READY)
// ========================================================================

class AnalyticsService {
    private Database $db;
    public function __construct() { $this->db = Database::getInstance(); }

    /**
     * Tracks an event on the website.
     * - Uses a cookie/session to identify unique visitors.
     * - Differentiates between pageviews, clicks, and conversions.
     */
    public function track(string $url, string $eventType = 'pageview'): void {
        $pdo = $this->db->getPdo();
        // Start a session if not already started to track unique visitors
        if (session_status() === PHP_SESSION_NONE) session_start();
        $sessionId = session_id();
        $ip = $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';
        $userAgent = $_SERVER['HTTP_USER_AGENT'] ?? '';

        $stmt = $pdo->prepare("INSERT INTO analytics_logs (page_url, visitor_ip, user_agent, session_id, event_type) VALUES (?, ?, ?, ?, ?)");
        $stmt->execute([$url, $ip, $userAgent, $sessionId, $eventType]);
    }

    /**
     * Retrieves aggregated analytics for the Admin Dashboard.
     */
    public function getStats(): array {
        $pdo = $this->db->getPdo();
        $today = date('Y-m-d');

        // Total Pageviews
        $pageviews = $pdo->query("SELECT COUNT(*) as count FROM analytics_logs WHERE event_type = 'pageview'")->fetch();
        // Unique Visitors (Session ID based)
        $uniqueVisitors = $pdo->query("SELECT COUNT(DISTINCT session_id) as count FROM analytics_logs")->fetch();
        
        // Today's Activity
        $todayPageviews = $pdo->query("SELECT COUNT(*) as count FROM analytics_logs WHERE DATE(created_at) = '$today' AND event_type = 'pageview'")->fetch();
        $todayClicks = $pdo->query("SELECT COUNT(*) as count FROM analytics_logs WHERE DATE(created_at) = '$today' AND event_type = 'click'")->fetch();
        $todayConversions = $pdo->query("SELECT COUNT(*) as count FROM analytics_logs WHERE DATE(created_at) = '$today' AND event_type = 'conversion'")->fetch();

        // Last 7 Days Pageviews
        $last7Days = $pdo->query("SELECT DATE(created_at) as date, COUNT(*) as count FROM analytics_logs WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) AND event_type = 'pageview' GROUP BY DATE(created_at) ORDER BY date ASC")->fetchAll();

        // Top Pages
        $topPages = $pdo->query("SELECT page_url, COUNT(*) as views, COUNT(DISTINCT session_id) as unique_visitors FROM analytics_logs WHERE event_type = 'pageview' GROUP BY page_url ORDER BY views DESC LIMIT 10")->fetchAll();

        // Conversion Rate (Total Conversions / Total Unique Visitors)
        $totalConvs = $pdo->query("SELECT COUNT(*) as count FROM analytics_logs WHERE event_type = 'conversion'")->fetch();
        $convRate = ($uniqueVisitors['count'] > 0) ? round(($totalConvs['count'] / $uniqueVisitors['count']) * 100, 2) : 0;

        return [
            'total_pageviews' => (int)$pageviews['count'],
            'unique_visitors' => (int)$uniqueVisitors['count'],
            'conversion_rate' => $convRate . '%',
            'today' => [
                'pageviews' => (int)$todayPageviews['count'],
                'clicks' => (int)$todayClicks['count'],
                'conversions' => (int)$todayConversions['count']
            ],
            'last_7_days' => $last7Days,
            'top_pages' => $topPages
        ];
    }
}


class TwoFAHelper {
    /**
     * Generates a cryptographically secure Base32 secret (16 chars)
     * Compatible with Google Authenticator and Authy.
     */
    public static function generateSecret(): string {
        $chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; // Base32 alphabet
        $secret = '';
        $bytes = random_bytes(10); // 10 bytes = 80 bits = 16 base32 chars
        for ($i = 0; $i < 10; $i++) {
            $byte = ord($bytes[$i]);
            // Split 8 bits into two 5-bit chunks
            $secret .= $chars[($byte >> 3) & 0x1F];
            $secret .= $chars[($byte & 0x07) << 2 | ((($i + 1) < 10 ? ord($bytes[$i + 1]) : 0) >> 6)];
        }
        return substr($secret, 0, 16);
    }

    /**
     * Decodes a Base32 encoded string into a binary string.
     */
    private static function base32Decode(string $secret): string {
        $alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
        $secret = strtoupper($secret);
        $bits = '';
        foreach (str_split($secret) as $char) {
            $val = strpos($alphabet, $char);
            if ($val === false) continue;
            $bits .= str_pad(decbin($val), 5, '0', STR_PAD_LEFT);
        }
        $bytes = '';
        for ($i = 0; $i < strlen($bits); $i += 8) {
            $byte = substr($bits, $i, 8);
            if (strlen($byte) < 8) break;
            $bytes .= chr(bindec($byte));
        }
        return $bytes;
    }

    /**
     * Generates a 6-digit TOTP code based on a 30-second time window.
     * Fully compliant with RFC 6238.
     */
    private static function generateTOTP(string $secret, int $timeSlice): string {
        $key = self::base32Decode($secret);
        // Pack the time counter into an 8-byte big-endian binary string
        $timeBytes = pack('J', $timeSlice);
        $hash = hash_hmac('sha1', $timeBytes, $key, true);
        $offset = ord($hash[19]) & 0x0F;
        $truncated = ((ord($hash[$offset + 0]) & 0x7F) << 24) |
                     ((ord($hash[$offset + 1]) & 0xFF) << 16) |
                     ((ord($hash[$offset + 2]) & 0xFF) << 8)  |
                      (ord($hash[$offset + 3]) & 0xFF);
        $code = $truncated % 1000000;
        return str_pad($code, 6, '0', STR_PAD_LEFT);
    }

    /**
     * Verifies a user-provided 6-digit code against the secret.
     * @param int $window Allows for clock drift (default +/- 1 step = 60 seconds).
     */
    public static function verifyCode(string $secret, string $code, int $window = 1): bool {
        if (!preg_match('/^\d{6}$/', $code)) return false;
        $counter = (int)floor(time() / 30);
        for ($i = -$window; $i <= $window; $i++) {
            if (self::generateTOTP($secret, $counter + $i) === $code) {
                return true;
            }
        }
        return false;
    }
}

// Serve Frontend HTML (Simple)
if ($method === 'GET' && $uri === '/') {
    echo "<h1>EasySuccor Bot</h1><p>Bot is running via Webhook.</p><a href='/admin'>Admin Dashboard</a>";
    exit;
}

// Default fallback
http_response_code(404);
echo "404 Not Found";