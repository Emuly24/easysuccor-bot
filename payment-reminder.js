// payment-reminder.js - Automated Payment Reminders (Hybrid Payment Support)
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
      
      // Send reminder at 1 day, 3 days, 7 days, 14 days
      if (daysSince === 1 || daysSince === 3 || daysSince === 7 || daysSince === 14) {
        await this.sendReminder(order, daysSince);
      }
    }
  }
  
  async sendReminder(order, daysSince) {
    const client = await db.getClient(order.client_id);
    if (!client || !client.telegram_id) return;
    
    // Generate a reference for the order if not exists
    const reference = order.id ? order.id.slice(-8) : `ORD${Date.now().toString().slice(-6)}`;
    
    let message = `⏰ *PAYMENT REMINDER*

You requested a document on ${new Date(order.created_at).toLocaleDateString()} (${daysSince} days ago)
Amount due: ${order.total_charge}
Order ID: \`${order.id}\`

*Your document is ready and waiting for you!*

━━━━━━━━━━━━━━━━━━━━━━━━━━━
*💰 PAYMENT OPTIONS*
━━━━━━━━━━━━━━━━━━━━━━━━━━━

*1. 📱 Mobile Money with Reference*
   Send to: Airtel 0991295401 or Mpamba 0886928639
   Reference: \`${reference}\`
   → Type /confirm ${reference} after sending

*2. 📞 USSD Quick Pay*
   Airtel: \`*211*${order.total_charge?.replace('MK', '').replace(',', '') || '10000'}*0991295401*${reference}#\`
   Mpamba: \`*444*${order.total_charge?.replace('MK', '').replace(',', '') || '10000'}*0886928639*${reference}#\`
   → Instant payment with PIN

*3. 💳 Pay Later*
   → You already selected this option

*4. 💳 Visa/Mastercard*
   Account: 1005653618 (National Bank)

━━━━━━━━━━━━━━━━━━━━━━━━━━━

*After payment:* Type /confirm ${reference}

⚠️ *Reminder ${daysSince === 14 ? '(FINAL) ' : ''}*: Your document will be available for ${daysSince === 14 ? '7 more days' : '30 days'} before deletion.

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
    
    const reference = order.id ? order.id.slice(-8) : `ORD${Date.now().toString().slice(-6)}`;
    
    const message = `⏰ *PAYMENT REMINDER - URGENT*

Order: ${orderId}
Client: ${client.first_name} ${client.last_name || ''}
Amount: ${order.total_charge}
Created: ${new Date(order.created_at).toLocaleDateString()}

━━━━━━━━━━━━━━━━━━━━━━━━━━━
*💰 PAYMENT OPTIONS*
━━━━━━━━━━━━━━━━━━━━━━━━━━━

*1. 📱 Mobile Money with Reference*
   Airtel: 0991295401 | Mpamba: 0886928639
   Reference: \`${reference}\`

*2. 📞 USSD Quick Pay*
   Airtel: \`*211*${order.total_charge?.replace('MK', '').replace(',', '') || '10000'}*0991295401*${reference}#\`
   Mpamba: \`*444*${order.total_charge?.replace('MK', '').replace(',', '') || '10000'}*0886928639*${reference}#\`

*3. 💳 Visa/Mastercard*
   Account: 1005653618 (NBM)

━━━━━━━━━━━━━━━━━━━━━━━━━━━

Type /confirm ${reference} after payment.

Your document will be delivered immediately after confirmation.`;
    
    await this.bot.telegram.sendMessage(client.telegram_id, message, { parse_mode: 'Markdown' });
    await ctx.reply(`✅ Reminder sent to ${client.first_name}`);
  }
}

module.exports = PaymentReminder;