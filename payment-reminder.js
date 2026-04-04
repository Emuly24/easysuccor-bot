// payment-reminder.js - Automated Payment Reminders
const cron = require('node-cron');
const db = require('./database');
const notificationService = require('./notification-service');

class PaymentReminder {
  constructor(bot) {
    this.bot = bot;
    this.startReminderScheduler();
  }
  
  startReminderScheduler() {
    // Run every 6 hours
    cron.schedule('0 */6 * * *', async () => {
      await this.sendReminders();
    });
  }
  
  async sendReminders() {
    const pendingOrders = await db.getPendingPaymentOrders();
    const now = new Date();
    
    for (const order of pendingOrders) {
      const orderDate = new Date(order.created_at);
      const daysSince = Math.floor((now - orderDate) / (1000 * 60 * 60 * 24));
      
      // Send reminder at 3 days, 7 days, 14 days
      if (daysSince === 3 || daysSince === 7 || daysSince === 14) {
        await this.sendReminder(order, daysSince);
      }
    }
  }
  
  async sendReminder(order, daysSince) {
    const client = await db.getClient(order.client_id);
    if (!client || !client.telegram_id) return;
    
    const message = `⏰ *PAYMENT REMINDER*

You requested a CV on ${new Date(order.created_at).toLocaleDateString()} (${daysSince} days ago)
Amount due: ${order.total_charge}

*Your document is ready and waiting for you!*

💳 *Pay now via:*
• Airtel Money: 0991295401
• TNM Mpamba: 0886928639
• Visa: 1005653618 (National Bank)

*After payment:* Type /pay to confirm.

⚠️ *Reminder ${daysSince === 14 ? '(FINAL) ' : ''}*: Your document will be available for ${daysSince === 14 ? '7 more days' : '14 days'} before deletion.

Need help? Contact support: +265 991 295 401`;
    
    await this.bot.telegram.sendMessage(client.telegram_id, message, { parse_mode: 'Markdown' });
    
    // Update reminder count
    await db.updatePaymentReminder(order.id, daysSince);
  }
  
  async sendManualReminder(ctx, orderId) {
    const order = await db.getOrder(orderId);
    if (!order) {
      await ctx.reply("Order not found.");
      return;
    }
    
    const client = await db.getClient(order.client_id);
    if (!client) {
      await ctx.reply("Client not found.");
      return;
    }
    
    const message = `⏰ *PAYMENT REMINDER - URGENT*

Order: ${orderId}
Client: ${client.first_name} ${client.last_name || ''}
Amount: ${order.total_charge}
Created: ${new Date(order.created_at).toLocaleDateString()}

Please complete your payment to receive your document.

*Payment methods:*
• Airtel Money: 0991295401
• TNM Mpamba: 0886928639
• Visa: 1005653618 (NBM)

Type /pay after sending.`;
    
    await this.bot.telegram.sendMessage(client.telegram_id, message, { parse_mode: 'Markdown' });
    await ctx.reply(`✅ Reminder sent to ${client.first_name}`);
  }
}

module.exports = PaymentReminder;