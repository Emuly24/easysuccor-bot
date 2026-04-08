// notification-service.js - Email-first notification system
const nodemailer = require('nodemailer');

class NotificationService {
  constructor() {
    this.adminEmail = 'blessingsemulyn@gmail.com';
    this.retryCount = 3;
    this.retryDelay = 2000;
  }

  // Send Email with retry logic (PRIORITY)
  async sendEmail(to, subject, message, retry = 0) {
    // Validate email credentials
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
      console.error('❌ Email credentials missing. Set EMAIL_USER and EMAIL_PASS');
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
      socketTimeout: 30000
    });
    
    try {
      const info = await transporter.sendMail({
        from: `"EasySuccor Bot" <${process.env.EMAIL_USER}>`,
        to: to,
        subject: subject,
        text: message,
        html: this.formatEmailHTML(message, subject)
      });
      console.log(`📧 Email sent to ${to} - Message ID: ${info.messageId}`);
      return { success: true, messageId: info.messageId };
    } catch (error) {
      console.error(`Email failed (attempt ${retry + 1}/${this.retryCount}):`, error.message);
      
      // Retry logic for temporary failures
      if (retry < this.retryCount - 1 && 
          (error.message.includes('ETIMEDOUT') || 
           error.message.includes('ECONNRESET') ||
           error.message.includes('socket'))) {
        await new Promise(resolve => setTimeout(resolve, this.retryDelay * (retry + 1)));
        return this.sendEmail(to, subject, message, retry + 1);
      }
      
      return { success: false, error: error.message };
    }
  }

  // Format email as beautiful HTML
  formatEmailHTML(message, subject) {
    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #2C7DA0, #1F5E7A); color: white; padding: 20px; text-align: center; border-radius: 10px 10px 0 0; }
    .content { background: #f9f9f9; padding: 20px; border-radius: 0 0 10px 10px; border: 1px solid #ddd; border-top: none; }
    .footer { text-align: center; padding: 15px; font-size: 12px; color: #666; }
    .alert { background: #e74c3c; color: white; padding: 10px; border-radius: 5px; text-align: center; }
    .success { background: #27ae60; color: white; padding: 10px; border-radius: 5px; text-align: center; }
    .info { background: #3498db; color: white; padding: 10px; border-radius: 5px; text-align: center; }
    hr { border: none; border-top: 1px solid #ddd; margin: 20px 0; }
    pre { background: #2d2d2d; color: #f8f8f2; padding: 15px; border-radius: 5px; overflow-x: auto; font-family: monospace; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h2>📧 EasySuccor Notification</h2>
      <p>${subject}</p>
    </div>
    <div class="content">
      <div style="white-space: pre-wrap; font-family: Arial, sans-serif;">${message.replace(/\n/g, '<br>')}</div>
    </div>
    <div class="footer">
      <p>EasySuccor Bot - Professional CV & Cover Letter Service</p>
      <p>Contact: +265 991 295 401 | Email: ${process.env.EMAIL_USER}</p>
      <p>Sent at: ${new Date().toLocaleString()}</p>
    </div>
  </div>
</body>
</html>`;
  }

  // Send Telegram (fallback/secondary)
  async sendTelegram(chatId, message, bot, retry = 0) {
    if (!bot || !bot.telegram || typeof bot.telegram.sendMessage !== 'function') {
      console.error('❌ Invalid bot instance');
      return { success: false, error: 'Invalid bot instance' };
    }
    
    if (!chatId) {
      console.error('❌ Chat ID is missing');
      return { success: false, error: 'Chat ID not provided' };
    }
    
    try {
      await bot.telegram.sendMessage(chatId, message, { parse_mode: 'Markdown' });
      console.log(`💬 Telegram sent to ${chatId}`);
      return { success: true };
    } catch (error) {
      console.error(`Telegram failed (attempt ${retry + 1}/${this.retryCount}):`, error.message);
      
      if (retry < this.retryCount - 1 && 
          (error.message.includes('ETIMEDOUT') || error.message.includes('ECONNRESET'))) {
        await new Promise(resolve => setTimeout(resolve, this.retryDelay));
        return this.sendTelegram(chatId, message, bot, retry + 1);
      }
      
      return { success: false, error: error.message };
    }
  }

  // Alert Admin - EMAIL FIRST, Telegram as backup
  async alertAdmin(subject, message, bot) {
    const adminEmail = this.adminEmail;
    const adminChatId = process.env.ADMIN_CHAT_ID;
    
    console.log(`📢 Sending admin alert: ${subject}`);
    console.log(`   Email: ${adminEmail}`);
    console.log(`   Telegram: ${adminChatId || 'Not configured'}`);
    
    const results = {
      email: { success: false, error: null },
      telegram: { success: false, error: null }
    };
    
    // 1. Send EMAIL first (priority)
    results.email = await this.sendEmail(adminEmail, subject, message);
    console.log(`   Email: ${results.email.success ? '✅' : '❌'} ${results.email.error || ''}`);
    
    // 2. Send Telegram as backup (if email fails or as additional notification)
    if (adminChatId) {
      results.telegram = await this.sendTelegram(adminChatId, message, bot);
      console.log(`   Telegram: ${results.telegram.success ? '✅' : '❌'} ${results.telegram.error || ''}`);
    } else {
      console.log('   Telegram: ⚠️ ADMIN_CHAT_ID not set');
    }
    
    // Log final status
    if (results.email.success) {
      console.log(`✅ Admin alert emailed successfully`);
    } else {
      console.error(`❌ Email failed: ${results.email.error}`);
      if (results.telegram.success) {
        console.log(`✅ Telegram backup delivered`);
      } else {
        console.error(`❌ All notification channels failed`);
      }
    }
    
    return results;
  }

  // Send confirmation to client (email optional, Telegram primary)
  async sendClientConfirmation(chatId, message, bot, email = null) {
    // Always send Telegram
    const telegramResult = await this.sendTelegram(chatId, message, bot);
    
    // Optionally send email if provided
    if (email) {
      await this.sendEmail(email, 'Your EasySuccor Document Update', message);
    }
    
    return telegramResult;
  }

  // Send email only (for admin)
  async sendAdminEmail(subject, message) {
    return await this.sendEmail(this.adminEmail, subject, message);
  }
}

module.exports = new NotificationService();