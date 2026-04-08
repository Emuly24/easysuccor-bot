// notification-service.js - Enterprise-Grade Multi-Channel Notification System
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');

class NotificationService {
  constructor() {
    this.adminEmail = process.env.ADMIN_EMAIL || 'blessingsemulyn@gmail.com';
    this.adminPhone = process.env.ADMIN_PHONE || '0991295401';
    this.retryCount = 5;
    this.retryDelay = 2000;
    this.maxRetryDelay = 30000;
    this.notificationQueue = [];
    this.isProcessing = false;
    
    // Email templates directory
    this.templatePath = path.join(__dirname, 'email_templates');
    if (!fs.existsSync(this.templatePath)) {
      fs.mkdirSync(this.templatePath, { recursive: true });
    }
    
    // Notification history
    this.historyPath = path.join(__dirname, 'data', 'notification_history.json');
    this.notificationHistory = this.loadHistory();
    
    // Start queue processor
    this.startQueueProcessor();
  }

  loadHistory() {
    try {
      if (fs.existsSync(this.historyPath)) {
        return JSON.parse(fs.readFileSync(this.historyPath, 'utf8'));
      }
    } catch (error) {
      console.error('Error loading notification history:', error);
    }
    return [];
  }

  saveHistory() {
    try {
      // Keep only last 1000 notifications
      const historyToSave = this.notificationHistory.slice(-1000);
      fs.writeFileSync(this.historyPath, JSON.stringify(historyToSave, null, 2));
    } catch (error) {
      console.error('Error saving notification history:', error);
    }
  }

  addToHistory(notification) {
    this.notificationHistory.push({
      ...notification,
      timestamp: new Date().toISOString()
    });
    this.saveHistory();
  }

  startQueueProcessor() {
    setInterval(async () => {
      if (this.notificationQueue.length > 0 && !this.isProcessing) {
        await this.processQueue();
      }
    }, 1000);
  }

  async processQueue() {
    this.isProcessing = true;
    while (this.notificationQueue.length > 0) {
      const notification = this.notificationQueue.shift();
      try {
        await this.sendNotificationWithRetry(notification);
      } catch (error) {
        console.error('Queue processing error:', error);
        // Re-queue with delay if failed
        if (notification.retryCount < this.retryCount) {
          notification.retryCount = (notification.retryCount || 0) + 1;
          setTimeout(() => {
            this.notificationQueue.push(notification);
          }, this.retryDelay * notification.retryCount);
        }
      }
    }
    this.isProcessing = false;
  }

  async sendNotificationWithRetry(notification) {
    const { type, to, subject, message, attachments, priority, channel } = notification;
    
    for (let attempt = 1; attempt <= this.retryCount; attempt++) {
      try {
        let result;
        if (channel === 'email' || type === 'email') {
          result = await this.sendEmailDirect(to, subject, message, attachments);
        } else if (channel === 'telegram' || type === 'telegram') {
          result = await this.sendTelegramDirect(to, message, notification.bot);
        } else {
          // Send to both
          result = await this.sendToBoth(to, subject, message, attachments, notification.bot);
        }
        
        if (result.success) {
          this.addToHistory({
            type: channel || 'both',
            to,
            subject,
            success: true,
            attempt,
            messageId: result.messageId
          });
          return result;
        }
        
        throw new Error(result.error);
      } catch (error) {
        console.error(`Attempt ${attempt} failed for ${channel}:`, error.message);
        
        if (attempt === this.retryCount) {
          this.addToHistory({
            type: channel || 'both',
            to,
            subject,
            success: false,
            attempt,
            error: error.message
          });
          return { success: false, error: error.message };
        }
        
        // Exponential backoff
        const delay = Math.min(this.retryDelay * Math.pow(2, attempt - 1), this.maxRetryDelay);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  // ============ EMAIL NOTIFICATION ============
  
  async sendEmail(to, subject, message, attachments = null, priority = 'normal') {
    return this.queueNotification({
      type: 'email',
      to,
      subject,
      message,
      attachments,
      priority,
      retryCount: 0
    });
  }

  async sendEmailDirect(to, subject, message, attachments = null) {
    // Validate email credentials
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
      console.error('❌ Email credentials missing');
      return { success: false, error: 'Email credentials not configured' };
    }

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { 
        user: process.env.EMAIL_USER, 
        pass: process.env.EMAIL_PASS 
      },
      connectionTimeout: 30000,
      greetingTimeout: 30000,
      socketTimeout: 30000,
      pool: true,
      maxConnections: 5,
      rateLimit: 10
    });
    
    try {
      const emailContent = this.formatEmailHTML(message, subject);
      const mailOptions = {
        from: `"EasySuccor Bot" <${process.env.EMAIL_USER}>`,
        to: to,
        subject: subject,
        text: message,
        html: emailContent,
        priority: priority === 'high' ? 'high' : 'normal',
        headers: {
          'X-Priority': priority === 'high' ? '1' : '3',
          'X-MSMail-Priority': priority === 'high' ? 'High' : 'Normal',
          'Importance': priority === 'high' ? 'high' : 'normal'
        }
      };
      
      if (attachments && Array.isArray(attachments)) {
        mailOptions.attachments = attachments;
      }
      
      const info = await transporter.sendMail(mailOptions);
      console.log(`📧 Email sent to ${to} - Message ID: ${info.messageId}`);
      return { success: true, messageId: info.messageId };
    } catch (error) {
      console.error('Email failed:', error.message);
      return { success: false, error: error.message };
    }
  }

  formatEmailHTML(message, subject) {
    const timestamp = new Date().toLocaleString();
    const year = new Date().getFullYear();
    
    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>EasySuccor Notification</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      padding: 20px;
    }
    .container {
      max-width: 600px;
      margin: 0 auto;
      background: white;
      border-radius: 20px;
      overflow: hidden;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
    }
    .header {
      background: linear-gradient(135deg, #2C7DA0, #1F5E7A);
      color: white;
      padding: 30px;
      text-align: center;
    }
    .header h1 {
      font-size: 28px;
      margin-bottom: 10px;
    }
    .header p {
      opacity: 0.9;
      font-size: 14px;
    }
    .content {
      padding: 30px;
    }
    .message-box {
      background: #f8f9fa;
      border-left: 4px solid #2C7DA0;
      padding: 20px;
      margin: 20px 0;
      border-radius: 8px;
      white-space: pre-wrap;
      font-family: 'Courier New', monospace;
      font-size: 14px;
    }
    .details {
      background: #e7f3ff;
      padding: 15px;
      border-radius: 10px;
      margin: 20px 0;
    }
    .detail-item {
      display: flex;
      padding: 8px 0;
      border-bottom: 1px solid #cce5ff;
    }
    .detail-label {
      font-weight: bold;
      width: 120px;
      color: #2C7DA0;
    }
    .detail-value {
      flex: 1;
      color: #333;
    }
    .button {
      display: inline-block;
      background: #2C7DA0;
      color: white;
      padding: 12px 24px;
      text-decoration: none;
      border-radius: 8px;
      margin: 20px 0;
      transition: background 0.3s;
    }
    .button:hover {
      background: #1F5E7A;
    }
    .footer {
      background: #f1f3f4;
      padding: 20px;
      text-align: center;
      font-size: 12px;
      color: #666;
    }
    .status-badge {
      display: inline-block;
      padding: 4px 12px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: bold;
    }
    .status-success { background: #d4edda; color: #155724; }
    .status-warning { background: #fff3cd; color: #856404; }
    .status-error { background: #f8d7da; color: #721c24; }
    @media (max-width: 480px) {
      .container { border-radius: 10px; }
      .header { padding: 20px; }
      .content { padding: 20px; }
      .detail-item { flex-direction: column; }
      .detail-label { width: 100%; margin-bottom: 5px; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>📧 EasySuccor</h1>
      <p>Professional CV & Cover Letter Service</p>
    </div>
    <div class="content">
      <h2 style="color: #2C7DA0; margin-bottom: 20px;">${this.escapeHtml(subject)}</h2>
      <div class="message-box">
        ${this.escapeHtml(message).replace(/\n/g, '<br>')}
      </div>
      <div class="details">
        <div class="detail-item">
          <div class="detail-label">📅 Sent:</div>
          <div class="detail-value">${timestamp}</div>
        </div>
        <div class="detail-item">
          <div class="detail-label">📧 From:</div>
          <div class="detail-value">EasySuccor Bot &lt;${process.env.EMAIL_USER}&gt;</div>
        </div>
      </div>
      <div style="text-align: center;">
        <a href="https://easysuccor-bot.onrender.com/admin.html" class="button">📊 Go to Admin Dashboard</a>
      </div>
    </div>
    <div class="footer">
      <p>&copy; ${year} EasySuccor. All rights reserved.</p>
      <p>Need help? Contact: +265 991 295 401 | ${process.env.EMAIL_USER}</p>
      <p>This is an automated message from EasySuccor Bot.</p>
    </div>
  </div>
</body>
</html>`;
  }

  escapeHtml(text) {
    if (!text) return '';
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ============ TELEGRAM NOTIFICATION ============
  
  async sendTelegram(chatId, message, bot, priority = 'normal') {
    return this.queueNotification({
      type: 'telegram',
      to: chatId,
      message,
      bot,
      priority,
      retryCount: 0
    });
  }

  async sendTelegramDirect(chatId, message, bot) {
    if (!bot || !bot.telegram || typeof bot.telegram.sendMessage !== 'function') {
      console.error('❌ Invalid bot instance');
      return { success: false, error: 'Invalid bot instance' };
    }
    
    if (!chatId) {
      console.error('❌ Chat ID is missing');
      return { success: false, error: 'Chat ID not provided' };
    }
    
    try {
      // Truncate message if too long (Telegram limit is 4096)
      const truncatedMessage = message.length > 4000 ? message.substring(0, 3900) + '\n\n... (truncated)' : message;
      
      await bot.telegram.sendMessage(chatId, truncatedMessage, { 
        parse_mode: 'Markdown',
        disable_web_page_preview: true
      });
      console.log(`💬 Telegram sent to ${chatId}`);
      return { success: true, messageId: Date.now().toString() };
    } catch (error) {
      console.error('Telegram failed:', error.message);
      return { success: false, error: error.message };
    }
  }

  // ============ MULTI-CHANNEL ALERTS ============
  
  async sendToBoth(to, subject, message, attachments = null, bot) {
    const emailResult = await this.sendEmailDirect(to, subject, message, attachments);
    const telegramResult = await this.sendTelegramDirect(to, message, bot);
    
    return {
      success: emailResult.success || telegramResult.success,
      email: emailResult,
      telegram: telegramResult
    };
  }

  async queueNotification(notification) {
    return new Promise((resolve) => {
      this.notificationQueue.push({ ...notification, resolve });
      if (!this.isProcessing) {
        this.processQueue();
      }
    });
  }

  // ============ ADMIN ALERTS (PRIORITY) ============
  
  async alertAdmin(subject, message, bot, priority = 'high') {
    const adminChatId = process.env.ADMIN_CHAT_ID;
    const adminEmail = this.adminEmail;
    
    console.log(`📢 Sending admin alert: ${subject}`);
    console.log(`   Priority: ${priority}`);
    console.log(`   Email: ${adminEmail}`);
    console.log(`   Telegram: ${adminChatId || 'Not configured'}`);
    
    const results = {
      email: { success: false, error: null },
      telegram: { success: false, error: null },
      timestamp: new Date().toISOString()
    };
    
    // Send both channels in parallel for high priority
    if (priority === 'high') {
      const [emailResult, telegramResult] = await Promise.all([
        this.sendEmail(adminEmail, `🔴 URGENT: ${subject}`, message, null, priority),
        adminChatId ? this.sendTelegram(adminChatId, message, bot, priority) : Promise.resolve({ success: false, error: 'No chat ID' })
      ]);
      results.email = emailResult;
      results.telegram = telegramResult;
    } else {
      // Send sequentially for normal priority
      results.email = await this.sendEmail(adminEmail, subject, message, null, priority);
      if (adminChatId) {
        results.telegram = await this.sendTelegram(adminChatId, message, bot, priority);
      }
    }
    
    console.log(`   Email: ${results.email.success ? '✅' : '❌'} ${results.email.error || ''}`);
    console.log(`   Telegram: ${results.telegram.success ? '✅' : '❌'} ${results.telegram.error || ''}`);
    
    // Log to history
    this.addToHistory({
      type: 'admin_alert',
      subject,
      priority,
      email_success: results.email.success,
      telegram_success: results.telegram.success,
      timestamp: results.timestamp
    });
    
    return results;
  }

  // ============ CLIENT NOTIFICATIONS ============
  
  async sendClientConfirmation(chatId, message, bot, clientEmail = null) {
    const telegramResult = await this.sendTelegram(chatId, message, bot);
    
    if (clientEmail) {
      await this.sendEmail(clientEmail, 'Your EasySuccor Order Update', message);
    }
    
    return telegramResult;
  }

  async sendPaymentConfirmation(client, order, reference, bot) {
    const clientMessage = `✅ *PAYMENT CONFIRMED!* 🎉

━━━━━━━━━━━━━━━━━━━━━━━━━━━
Order: \`${order.id}\`
Amount: ${order.total_charge}
Reference: \`${reference}\`

Your document will be delivered within ${order.delivery_time}.

Thank you for choosing EasySuccor! 🙏`;

    const adminMessage = `✅ *PAYMENT VERIFIED*

━━━━━━━━━━━━━━━━━━━━━━━━━━━
Order: ${order.id}
Client: ${client.first_name} ${client.last_name || ''}
Amount: ${order.total_charge}
Reference: ${reference}

Document has been sent to client.`;

    await this.sendTelegram(client.telegram_id, clientMessage, bot);
    await this.alertAdmin('Payment Verified - Document Sent', adminMessage, bot);
  }

  async sendOrderStatusUpdate(client, order, status, bot) {
    const statusMessages = {
      'pending': `⏳ Your order \`${order.id}\` is pending payment.`,
      'paid': `💰 Payment received for order \`${order.id}\`. We're working on your document!`,
      'processing': `⚙️ Your document for order \`${order.id}\` is being prepared.`,
      'review': `📝 Your document for order \`${order.id}\` is ready for review.`,
      'delivered': `📄 Your document for order \`${order.id}\` has been delivered! Check your chat.`,
      'completed': `✅ Order \`${order.id}\` is complete! Thank you for choosing EasySuccor!`
    };
    
    const message = statusMessages[status] || `Order ${order.id} status: ${status}`;
    await this.sendTelegram(client.telegram_id, message, bot);
  }

  // ============ BULK NOTIFICATIONS ============
  
  async sendBulkEmail(recipients, subject, message) {
    const results = [];
    for (const recipient of recipients) {
      const result = await this.sendEmail(recipient, subject, message);
      results.push({ recipient, ...result });
      // Rate limiting - wait between emails
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    return results;
  }

  async sendNewsletter(subject, message, bot) {
    // Get all clients with email
    const allClients = await db.getAllClients();
    const clientsWithEmail = allClients.filter(c => c.email);
    
    const results = [];
    for (const client of clientsWithEmail) {
      const result = await this.sendEmail(client.email, subject, message);
      results.push({ client: client.id, email: client.email, ...result });
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    // Also send to admin
    await this.sendEmail(this.adminEmail, `Newsletter Sent: ${subject}`, `Sent to ${results.length} clients.`);
    
    return results;
  }

  // ============ TEMPLATE MANAGEMENT ============
  
  async saveTemplate(name, subject, htmlContent, textContent) {
    const template = {
      name,
      subject,
      html: htmlContent,
      text: textContent,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    
    const templatePath = path.join(this.templatePath, `${name}.json`);
    fs.writeFileSync(templatePath, JSON.stringify(template, null, 2));
    return true;
  }

  async loadTemplate(name) {
    const templatePath = path.join(this.templatePath, `${name}.json`);
    if (fs.existsSync(templatePath)) {
      return JSON.parse(fs.readFileSync(templatePath, 'utf8'));
    }
    return null;
  }

  async sendWithTemplate(to, templateName, variables, bot) {
    const template = await this.loadTemplate(templateName);
    if (!template) {
      return { success: false, error: `Template ${templateName} not found` };
    }
    
    let subject = template.subject;
    let htmlContent = template.html;
    let textContent = template.text;
    
    // Replace variables
    for (const [key, value] of Object.entries(variables)) {
      const regex = new RegExp(`{{${key}}}`, 'g');
      subject = subject.replace(regex, value);
      htmlContent = htmlContent.replace(regex, value);
      textContent = textContent.replace(regex, value);
    }
    
    return this.sendEmail(to, subject, textContent, null);
  }

  // ============ STATISTICS & MONITORING ============
  
  getNotificationStats() {
    const last24h = this.notificationHistory.filter(n => {
      const date = new Date(n.timestamp);
      const hoursAgo = (Date.now() - date.getTime()) / (1000 * 60 * 60);
      return hoursAgo <= 24;
    });
    
    const successCount = last24h.filter(n => n.success).length;
    const failCount = last24h.filter(n => !n.success).length;
    
    return {
      total_24h: last24h.length,
      success_24h: successCount,
      fail_24h: failCount,
      success_rate_24h: last24h.length > 0 ? (successCount / last24h.length) * 100 : 0,
      by_type: {
        email: last24h.filter(n => n.type === 'email').length,
        telegram: last24h.filter(n => n.type === 'telegram').length,
        admin_alert: last24h.filter(n => n.type === 'admin_alert').length
      }
    };
  }

  async testAllChannels(bot) {
    const testMessage = '🧪 This is a test notification from EasySuccor Bot. If you received this, your notification channels are working correctly!';
    
    const results = {
      email: await this.sendEmail(this.adminEmail, 'Test Notification', testMessage),
      telegram: await this.sendTelegram(process.env.ADMIN_CHAT_ID, testMessage, bot)
    };
    
    return results;
  }
}

module.exports = new NotificationService();