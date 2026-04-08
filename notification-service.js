// notification-service.js - Reliable Telegram + Email with fallbacks
const nodemailer = require('nodemailer');

class NotificationService {
  constructor() {
    this.adminEmail = 'blessingsemulyn@gmail.com';
    this.retryCount = 3;
    this.retryDelay = 2000;
  }

  // Send Email with retry logic
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
      // Add timeout to prevent hanging
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000
    });
    
    try {
      await transporter.sendMail({
        from: `"EasySuccor Bot" <${process.env.EMAIL_USER}>`,
        to: to,
        subject: subject,
        text: message,
        html: `<div style="font-family: Arial, sans-serif; padding: 20px;">
                <h2 style="color: #2C7DA0;">📧 EasySuccor Notification</h2>
                <hr>
                <div style="white-space: pre-wrap;">${message.replace(/\n/g, '<br>')}</div>
                <hr>
                <p style="color: #666; font-size: 12px;">Sent from EasySuccor Bot</p>
               </div>`
      });
      console.log(`📧 Email sent to ${to}`);
      return { success: true };
    } catch (error) {
      console.error(`Email failed (attempt ${retry + 1}/${this.retryCount}):`, error.message);
      
      // Retry logic for temporary failures
      if (retry < this.retryCount - 1 && 
          (error.message.includes('ETIMEDOUT') || 
           error.message.includes('ECONNRESET') ||
           error.message.includes('socket'))) {
        await new Promise(resolve => setTimeout(resolve, this.retryDelay));
        return this.sendEmail(to, subject, message, retry + 1);
      }
      
      return { success: false, error: error.message };
    }
  }

  // Send Telegram with retry logic
  async sendTelegram(chatId, message, bot, retry = 0) {
    // Validate bot instance
    if (!bot) {
      console.error('❌ Bot instance is undefined');
      return { success: false, error: 'Bot instance not provided' };
    }
    
    if (!bot.telegram || typeof bot.telegram.sendMessage !== 'function') {
      console.error('❌ Invalid bot instance - missing telegram.sendMessage');
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
      
      // Retry for network errors
      if (retry < this.retryCount - 1 && 
          (error.message.includes('ETIMEDOUT') || 
           error.message.includes('ECONNRESET') ||
           error.message.includes('socket'))) {
        await new Promise(resolve => setTimeout(resolve, this.retryDelay));
        return this.sendTelegram(chatId, message, bot, retry + 1);
      }
      
      return { success: false, error: error.message };
    }
  }

  // Alert Admin via BOTH channels with guaranteed delivery
  async alertAdmin(subject, message, bot) {
    const adminChatId = process.env.ADMIN_CHAT_ID;
    const adminEmail = this.adminEmail;
    
    console.log(`📢 Sending admin alert: ${subject}`);
    
    const results = {
      telegram: { success: false, error: null },
      email: { success: false, error: null }
    };
    
    // 1. Send Telegram alert (priority)
    if (adminChatId) {
      results.telegram = await this.sendTelegram(adminChatId, message, bot);
      console.log(`   Telegram: ${results.telegram.success ? '✅' : '❌'} ${results.telegram.error || ''}`);
    } else {
      console.log('   Telegram: ⚠️ ADMIN_CHAT_ID not set');
      results.telegram.error = 'ADMIN_CHAT_ID not configured';
    }
    
    // 2. Send Email alert (backup)
    results.email = await this.sendEmail(adminEmail, subject, message);
    console.log(`   Email: ${results.email.success ? '✅' : '❌'} ${results.email.error || ''}`);
    
    // Log final status
    const anySuccess = results.telegram.success || results.email.success;
    if (anySuccess) {
      console.log(`✅ Admin alert delivered successfully`);
    } else {
      console.error(`❌ Admin alert failed completely: Telegram: ${results.telegram.error}, Email: ${results.email.error}`);
    }
    
    return results;
  }

  // Send confirmation to client via Telegram
  async sendClientConfirmation(chatId, message, bot) {
    return await this.sendTelegram(chatId, message, bot);
  }
}

module.exports = new NotificationService();