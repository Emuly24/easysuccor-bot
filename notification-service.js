// notification-service.js - Telegram + Email only
const nodemailer = require('nodemailer');

class NotificationService {
  constructor() {
    this.adminEmail = 'blessingsemulyn@gmail.com';
  }

  // Send Email
  async sendEmail(to, subject, message) {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { 
        user: process.env.EMAIL_USER, 
        pass: process.env.EMAIL_PASS 
      }
    });
    
    try {
      await transporter.sendMail({
        from: `"EasySuccor Bot" <${process.env.EMAIL_USER}>`,
        to: to,
        subject: subject,
        text: message,
        html: `<div style="font-family: Arial, sans-serif;">${message.replace(/\n/g, '<br>')}</div>`
      });
      console.log(`📧 Email sent to ${to}`);
      return { success: true };
    } catch (error) {
      console.error('Email failed:', error.message);
      return { success: false };
    }
  }

  // Send Telegram
  async sendTelegram(chatId, message, bot) {
    try {
      await bot.telegram.sendMessage(chatId, message, { parse_mode: 'Markdown' });
      console.log(`💬 Telegram sent to ${chatId}`);
      return { success: true };
    } catch (error) {
      console.error('Telegram failed:', error.message);
      return { success: false };
    }
  }

  // Alert Admin via BOTH channels
  async alertAdmin(subject, message, bot) {
    const adminChatId = process.env.ADMIN_CHAT_ID;
    const results = {
      telegram: false,
      email: false
    };
    
    // 1. Telegram (instant)
    if (adminChatId) {
      results.telegram = await this.sendTelegram(adminChatId, message, bot);
    }
    
    // 2. Email (backup)
    results.email = await this.sendEmail(this.adminEmail, subject, message);
    
    console.log(`📢 Alert sent: ${subject}`);
    console.log(`   Telegram: ${results.telegram.success ? '✅' : '❌'}`);
    console.log(`   Email: ${results.email.success ? '✅' : '❌'}`);
    
    return results;
  }

  // Send confirmation to client via Telegram
  async sendClientConfirmation(chatId, message, bot) {
    return await this.sendTelegram(chatId, message, bot);
  }
}

module.exports = new NotificationService();