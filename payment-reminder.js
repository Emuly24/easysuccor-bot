// payment-reminder.js - Automated Smart Payment Reminder System
const cron = require('node-cron');
const db = require('./database');
const notificationService = require('./notification-service');

class PaymentReminder {
  constructor(bot) {
    this.bot = bot;
    this.reminderHistory = new Map();
    this.startReminderScheduler();
    this.startOverdueScheduler();
  }
  
  startReminderScheduler() {
    // Run every 4 hours
    cron.schedule('0 */4 * * *', async () => {
      await this.sendReminders();
      await this.escalateOverduePayments();
    });
  }
  
  startOverdueScheduler() {
    // Run daily at 9 AM
    cron.schedule('0 9 * * *', async () => {
      await this.sendOverdueReports();
    });
  }
  
  async sendReminders() {
    const pendingOrders = await db.getPendingPaymentOrders();
    const now = new Date();
    
    for (const order of pendingOrders) {
      const orderDate = new Date(order.created_at);
      const daysSince = Math.floor((now - orderDate) / (1000 * 60 * 60 * 24));
      const lastReminder = this.reminderHistory.get(order.id);
      const hoursSinceLastReminder = lastReminder ? (now - lastReminder) / (1000 * 60 * 60) : 24;
      
      // Smart reminder scheduling
      let shouldRemind = false;
      let urgency = 'normal';
      
      if (daysSince === 1 && (!lastReminder || hoursSinceLastReminder > 12)) {
        shouldRemind = true;
        urgency = 'normal';
      } else if (daysSince === 3 && (!lastReminder || hoursSinceLastReminder > 24)) {
        shouldRemind = true;
        urgency = 'urgent';
      } else if (daysSince === 7 && (!lastReminder || hoursSinceLastReminder > 48)) {
        shouldRemind = true;
        urgency = 'high';
      } else if (daysSince === 14 && (!lastReminder || hoursSinceLastReminder > 72)) {
        shouldRemind = true;
        urgency = 'final';
      } else if (daysSince > 14 && daysSince % 7 === 0) {
        shouldRemind = true;
        urgency = 'overdue';
      }
      
      if (shouldRemind) {
        await this.sendReminder(order, daysSince, urgency);
        this.reminderHistory.set(order.id, now);
      }
    }
  }
  
  async sendReminder(order, daysSince, urgency) {
    const client = await db.getClient(order.client_id);
    if (!client || !client.telegram_id) return;
    
    const urgencyMessages = {
      normal: '⏰ *PAYMENT REMINDER*',
      urgent: '⚠️ *URGENT PAYMENT REMINDER*',
      high: '🔴 *HIGH PRIORITY - PAYMENT NEEDED*',
      final: '❗ *FINAL REMINDER - ACTION REQUIRED*',
      overdue: '🚨 *OVERDUE PAYMENT - IMMEDIATE ACTION REQUIRED*'
    };
    
    const urgencyColors = {
      normal: '🔵',
      urgent: '🟠',
      high: '🔴',
      final: '⛔',
      overdue: '⚠️'
    };
    
    const message = `${urgencyMessages[urgency]}

━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 *ORDER DETAILS*
━━━━━━━━━━━━━━━━━━━━━━━━━━━

Order ID: \`${order.id}\`
Service: ${order.service}
Amount Due: ${order.total_charge}
Days Since Order: ${daysSince}
${urgency === 'overdue' ? `Days Overdue: ${daysSince - 14}` : ''}

━━━━━━━━━━━━━━━━━━━━━━━━━━━
💳 *PAYMENT METHODS*
━━━━━━━━━━━━━━━━━━━━━━━━━━━

• Airtel Money: 0991295401
• TNM Mpamba: 0886928639
• National Bank: 1005653618 (NBM)

━━━━━━━━━━━━━━━━━━━━━━━━━━━
📌 *INSTRUCTIONS*
━━━━━━━━━━━━━━━━━━━━━━━━━━━

1️⃣ Send exactly ${order.total_charge} to any account above
2️⃣ Use order ID \`${order.id}\` as reference
3️⃣ After payment, type: \`/pay\`

━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️ *IMPORTANT NOTES*
━━━━━━━━━━━━━━━━━━━━━━━━━━━

${urgency === 'final' ? '• This is your final reminder before order cancellation\n' : ''}
${urgency === 'overdue' ? '• Your order may be cancelled if payment is not received within 7 days\n' : ''}
• Your document is ready and waiting for you
• Delivery time starts after payment confirmation

Need help? Contact support: +265 991 295 401`;
    
    await this.bot.telegram.sendMessage(client.telegram_id, message, { parse_mode: 'Markdown' });
    
    // Update reminder count in database
    await db.updatePaymentReminder(order.id, daysSince);
    
    // Notify admin for high urgency cases
    if (urgency === 'high' || urgency === 'final' || urgency === 'overdue') {
      await notificationService.alertAdmin(
        `${urgencyColors[urgency]} Urgent Payment Reminder Sent`,
        `Order: ${order.id}\nClient: ${client.first_name}\nDays Since: ${daysSince}\nUrgency: ${urgency}`,
        this.bot
      );
    }
  }
  
  async escalateOverduePayments() {
    const pendingOrders = await db.getPendingPaymentOrders();
    const now = new Date();
    const thirtyDaysAgo = new Date(now.setDate(now.getDate() - 30));
    
    for (const order of pendingOrders) {
      const orderDate = new Date(order.created_at);
      if (orderDate < thirtyDaysAgo) {
        // Order is 30+ days overdue - escalate to admin
        const client = await db.getClient(order.client_id);
        await notificationService.alertAdmin(
          `🚨 CRITICAL: Order ${order.id} is 30+ days overdue`,
          `Order: ${order.id}\nClient: ${client?.first_name || 'Unknown'}\nAmount: ${order.total_charge}\nCreated: ${orderDate.toLocaleDateString()}\n\nAction required: Cancel or follow up manually.`,
          this.bot
        );
      }
    }
  }
  
  async sendOverdueReports() {
    const pendingOrders = await db.getPendingPaymentOrders();
    const overdueOrders = [];
    const now = new Date();
    
    for (const order of pendingOrders) {
      const orderDate = new Date(order.created_at);
      const daysSince = Math.floor((now - orderDate) / (1000 * 60 * 60 * 24));
      if (daysSince > 7) {
        const client = await db.getClient(order.client_id);
        overdueOrders.push({
          ...order,
          client_name: client?.first_name || 'Unknown',
          days_overdue: daysSince - 7
        });
      }
    }
    
    if (overdueOrders.length > 0) {
      let report = `📊 *DAILY OVERDUE PAYMENTS REPORT*\n\n`;
      for (const order of overdueOrders) {
        report += `• Order: ${order.id}\n`;
        report += `  Client: ${order.client_name}\n`;
        report += `  Amount: ${order.total_charge}\n`;
        report += `  Days Overdue: ${order.days_overdue}\n`;
        report += `  Created: ${new Date(order.created_at).toLocaleDateString()}\n\n`;
      }
      
      await notificationService.alertAdmin(`📊 Overdue Payments Report - ${overdueOrders.length} orders`, report, this.bot);
    }
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
    
    const orderDate = new Date(order.created_at);
    const daysSince = Math.floor((Date.now() - orderDate) / (1000 * 60 * 60 * 24));
    
    const message = `⏰ *MANUAL PAYMENT REMINDER - URGENT*

━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 *ORDER DETAILS*
━━━━━━━━━━━━━━━━━━━━━━━━━━━

Order: \`${order.id}\`
Client: ${client.first_name} ${client.last_name || ''}
Amount: ${order.total_charge}
Created: ${orderDate.toLocaleDateString()}
Days Since: ${daysSince}

━━━━━━━━━━━━━━━━━━━━━━━━━━━
💳 *PAYMENT METHODS*
━━━━━━━━━━━━━━━━━━━━━━━━━━━

• Airtel Money: 0991295401
• TNM Mpamba: 0886928639
• National Bank: 1005653618 (NBM)

━━━━━━━━━━━━━━━━━━━━━━━━━━━
📌 *INSTRUCTIONS*
━━━━━━━━━━━━━━━━━━━━━━━━━━━

1️⃣ Send exactly ${order.total_charge} to any account above
2️⃣ Use order ID \`${order.id}\` as reference
3️⃣ After payment, type: \`/pay\`

Please complete your payment to receive your document.

Need help? Contact support: +265 991 295 401`;
    
    await this.bot.telegram.sendMessage(client.telegram_id, message, { parse_mode: 'Markdown' });
    await ctx.reply(`✅ Reminder sent to ${client.first_name}`);
  }
  
  async getReminderStats() {
    const pendingOrders = await db.getPendingPaymentOrders();
    const stats = {
      total_pending: pendingOrders.length,
      by_days: {
        '1-3': 0,
        '4-7': 0,
        '8-14': 0,
        '15-30': 0,
        '30+': 0
      },
      total_amount_pending: 0
    };
    
    const now = new Date();
    for (const order of pendingOrders) {
      const orderDate = new Date(order.created_at);
      const daysSince = Math.floor((now - orderDate) / (1000 * 60 * 60 * 24));
      const amount = parseInt(order.total_charge?.replace('MK', '').replace(',', '') || 0);
      stats.total_amount_pending += amount;
      
      if (daysSince <= 3) stats.by_days['1-3']++;
      else if (daysSince <= 7) stats.by_days['4-7']++;
      else if (daysSince <= 14) stats.by_days['8-14']++;
      else if (daysSince <= 30) stats.by_days['15-30']++;
      else stats.by_days['30+']++;
    }
    
    return stats;
  }
}

module.exports = PaymentReminder;