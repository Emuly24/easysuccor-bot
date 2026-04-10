// payment-reminder.js - Automated Smart Payment Reminder System (UPDATED)
// Now supports Installment Plans, Pay Later, and 18+ categories

const cron = require('node-cron');
const db = require('./database');
const notificationService = require('./notification-service');

class PaymentReminder {
  constructor(bot) {
    this.bot = bot;
    this.reminderHistory = new Map();
    this.installmentReminderHistory = new Map();
    this.payLaterReminderHistory = new Map();
    this.startReminderScheduler();
    this.startOverdueScheduler();
    this.startInstallmentReminderScheduler();
    this.startPayLaterReminderScheduler();
  }
  
  startReminderScheduler() {
    // Run every 4 hours for regular orders
    cron.schedule('0 */4 * * *', async () => {
      console.log('🔄 Running payment reminder check...');
      await this.sendReminders();
      await this.escalateOverduePayments();
    });
  }
  
  startOverdueScheduler() {
    // Run daily at 9 AM
    cron.schedule('0 9 * * *', async () => {
      console.log('📊 Running overdue payments report...');
      await this.sendOverdueReports();
    });
  }

  startInstallmentReminderScheduler() {
    // Run every 6 hours for installment reminders
    cron.schedule('0 */6 * * *', async () => {
      console.log('🔄 Running installment reminder check...');
      await this.sendInstallmentReminders();
    });
  }

  startPayLaterReminderScheduler() {
    // Run daily at 10 AM for Pay Later reminders
    cron.schedule('0 10 * * *', async () => {
      console.log('🔄 Running Pay Later reminder check...');
      await this.sendPayLaterReminders();
    });
  }
  
  async sendReminders() {
    const pendingOrders = await db.getPendingPaymentOrders();
    const now = new Date();
    
    for (const order of pendingOrders) {
      // Skip if this is an installment order (handled separately)
      if (order.payment_type === 'installment') continue;
      if (order.payment_type === 'pay_later') continue;
      
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

  // NEW: Installment-specific reminders
  async sendInstallmentReminders() {
    const installmentPlans = await db.getAllInstallmentPlans?.() || [];
    const now = new Date();
    
    for (const plan of installmentPlans) {
      if (plan.status !== 'active') continue;
      
      const currentInstallment = plan.installments?.[plan.current_installment - 1];
      if (!currentInstallment || currentInstallment.status === 'paid') continue;
      
      const dueDate = new Date(currentInstallment.due_date);
      const daysUntilDue = Math.ceil((dueDate - now) / (1000 * 60 * 60 * 24));
      const daysOverdue = daysUntilDue < 0 ? Math.abs(daysUntilDue) : 0;
      
      const lastReminder = this.installmentReminderHistory.get(`${plan.orderId}_${plan.current_installment}`);
      const hoursSinceLastReminder = lastReminder ? (now - lastReminder) / (1000 * 60 * 60) : 24;
      
      let shouldRemind = false;
      let urgency = 'normal';
      
      // Before due date
      if (daysUntilDue === 3 && hoursSinceLastReminder > 12) {
        shouldRemind = true;
        urgency = 'warning';
      } else if (daysUntilDue === 1 && hoursSinceLastReminder > 6) {
        shouldRemind = true;
        urgency = 'urgent';
      } else if (daysUntilDue === 0 && hoursSinceLastReminder > 3) {
        shouldRemind = true;
        urgency = 'due_today';
      } 
      // After due date (overdue)
      else if (daysOverdue === 1 && hoursSinceLastReminder > 12) {
        shouldRemind = true;
        urgency = 'overdue_1';
      } else if (daysOverdue === 3 && hoursSinceLastReminder > 24) {
        shouldRemind = true;
        urgency = 'overdue_3';
      } else if (daysOverdue === 7 && hoursSinceLastReminder > 48) {
        shouldRemind = true;
        urgency = 'overdue_7';
      } else if (daysOverdue > 7 && daysOverdue % 3 === 0 && hoursSinceLastReminder > 48) {
        shouldRemind = true;
        urgency = 'overdue_critical';
      }
      
      if (shouldRemind) {
        await this.sendInstallmentReminder(plan, currentInstallment, daysUntilDue, urgency);
        this.installmentReminderHistory.set(`${plan.orderId}_${plan.current_installment}`, now);
      }
    }
  }

  async sendInstallmentReminder(plan, installment, daysUntilDue, urgency) {
    const client = await db.getClientById(plan.clientId);
    if (!client || !client.telegram_id) return;
    
    const urgencyMessages = {
      warning: '⏰ *INSTALLMENT REMINDER*',
      urgent: '⚠️ *URGENT INSTALLMENT REMINDER*',
      due_today: '🔴 *INSTALLMENT DUE TODAY*',
      overdue_1: '❗ *INSTALLMENT OVERDUE - 1 DAY*',
      overdue_3: '🚨 *INSTALLMENT OVERDUE - 3 DAYS*',
      overdue_7: '⚠️ *INSTALLMENT OVERDUE - 7 DAYS (PENALTY APPLIED)*',
      overdue_critical: '🔴 *CRITICAL - INSTALLMENT LONG OVERDUE*'
    };
    
    const isOverdue = daysUntilDue < 0;
    const daysDisplay = isOverdue ? Math.abs(daysUntilDue) : daysUntilDue;
    
    const message = `${urgencyMessages[urgency]}

━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 *INSTALLMENT DETAILS*
━━━━━━━━━━━━━━━━━━━━━━━━━━━

Order: \`${plan.orderId}\`
Installment: ${plan.current_installment} of 2
Amount Due: ${installment.amount}
Due Date: ${installment.due_date}
${isOverdue ? `Days Overdue: ${daysDisplay}` : `Days Remaining: ${daysDisplay}`}
Total Remaining: ${plan.remaining_amount}

━━━━━━━━━━━━━━━━━━━━━━━━━━━
💳 *PAYMENT METHODS*
━━━━━━━━━━━━━━━━━━━━━━━━━━━

• Airtel Money: 0991295401
• TNM Mpamba: 0886928639
• MO626 Bank: 1005653618

━━━━━━━━━━━━━━━━━━━━━━━━━━━
📌 *INSTRUCTIONS*
━━━━━━━━━━━━━━━━━━━━━━━━━━━

1️⃣ Send exactly ${installment.amount} to any account above
2️⃣ Use order ID \`${plan.orderId}\` as reference
3️⃣ Click the button below after payment

${plan.current_installment === 1 ? '• First payment starts CV creation\n• Final CV delivered after second payment' : '• Final payment releases your completed CV'}
${isOverdue && daysDisplay >= 7 ? '⚠️ A 10% late fee has been applied to your balance' : ''}

━━━━━━━━━━━━━━━━━━━━━━━━━━━`;

    await this.bot.telegram.sendMessage(client.telegram_id, message, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[
          { text: "✅ I Have Made Payment", callback_data: `confirm_installment_${plan.orderId}` }
        ]]
      }
    });
    
    // Notify admin for overdue installments
    if (urgency.includes('overdue')) {
      await notificationService.alertAdmin(
        `📊 Installment ${urgency}`,
        `Order: ${plan.orderId}\nClient: ${plan.clientName}\nInstallment: ${plan.current_installment}/2\nAmount: ${installment.amount}\nDays ${isOverdue ? 'Overdue' : 'Until Due'}: ${daysDisplay}`,
        this.bot
      );
    }
  }

  // NEW: Pay Later reminders
  async sendPayLaterReminders() {
    const payLaterPlans = await db.getAllPayLaterPlans?.() || [];
    const now = new Date();
    
    for (const plan of payLaterPlans) {
      if (plan.status !== 'pending') continue;
      
      const dueDate = new Date(plan.due_date);
      const daysUntilDue = Math.ceil((dueDate - now) / (1000 * 60 * 60 * 24));
      const daysOverdue = daysUntilDue < 0 ? Math.abs(daysUntilDue) : 0;
      
      const lastReminder = this.payLaterReminderHistory.get(plan.orderId);
      const hoursSinceLastReminder = lastReminder ? (now - lastReminder) / (1000 * 60 * 60) : 24;
      
      let shouldRemind = false;
      let urgency = 'normal';
      
      if (daysUntilDue === 3 && hoursSinceLastReminder > 12) {
        shouldRemind = true;
        urgency = 'warning';
      } else if (daysUntilDue === 1 && hoursSinceLastReminder > 6) {
        shouldRemind = true;
        urgency = 'urgent';
      } else if (daysUntilDue === 0 && hoursSinceLastReminder > 3) {
        shouldRemind = true;
        urgency = 'due_today';
      } else if (daysOverdue === 1 && hoursSinceLastReminder > 12) {
        shouldRemind = true;
        urgency = 'overdue_1';
      } else if (daysOverdue === 3 && hoursSinceLastReminder > 24) {
        shouldRemind = true;
        urgency = 'overdue_3';
      } else if (daysOverdue === 7 && hoursSinceLastReminder > 48) {
        shouldRemind = true;
        urgency = 'overdue_7';
      }
      
      if (shouldRemind) {
        await this.sendPayLaterReminder(plan, daysUntilDue, urgency);
        this.payLaterReminderHistory.set(plan.orderId, now);
      }
    }
  }

  async sendPayLaterReminder(plan, daysUntilDue, urgency) {
    const client = await db.getClientById(plan.clientId);
    if (!client || !client.telegram_id) return;
    
    const urgencyMessages = {
      warning: '⏰ *PAY LATER REMINDER*',
      urgent: '⚠️ *URGENT PAY LATER REMINDER*',
      due_today: '🔴 *PAY LATER DUE TODAY*',
      overdue_1: '❗ *PAY LATER OVERDUE - 1 DAY*',
      overdue_3: '🚨 *PAY LATER OVERDUE - 3 DAYS*',
      overdue_7: '⚠️ *PAY LATER OVERDUE - 7 DAYS*'
    };
    
    const isOverdue = daysUntilDue < 0;
    const daysDisplay = isOverdue ? Math.abs(daysUntilDue) : daysUntilDue;
    
    const message = `${urgencyMessages[urgency]}

━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 *PAY LATER DETAILS*
━━━━━━━━━━━━━━━━━━━━━━━━━━━

Order: \`${plan.orderId}\`
Amount Due: ${plan.amount}
Reference: \`${plan.reference}\`
Due Date: ${plan.due_date}
${isOverdue ? `Days Overdue: ${daysDisplay}` : `Days Remaining: ${daysDisplay}`}

━━━━━━━━━━━━━━━━━━━━━━━━━━━
💳 *PAYMENT METHODS*
━━━━━━━━━━━━━━━━━━━━━━━━━━━

• Airtel Money: 0991295401
• TNM Mpamba: 0886928639
• MO626 Bank: 1005653618

━━━━━━━━━━━━━━━━━━━━━━━━━━━
📌 *INSTRUCTIONS*
━━━━━━━━━━━━━━━━━━━━━━━━━━━

1️⃣ Send exactly ${plan.amount} to any account above
2️⃣ Use reference: \`${plan.reference}\`
3️⃣ Click the button below after payment

Your document will be delivered AFTER payment confirmation.
${isOverdue && daysDisplay >= 7 ? '⚠️ A 10% late fee has been applied' : ''}

━━━━━━━━━━━━━━━━━━━━━━━━━━━`;

    await this.bot.telegram.sendMessage(client.telegram_id, message, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[
          { text: "✅ I Have Made Payment", callback_data: `confirm_paylater_${plan.orderId}` }
        ]]
      }
    });
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
    
    // Determine document type for 18+ categories reference
    const documentType = order.service || 'document';
    const hasCVData = order.cv_data ? true : false;
    
    const message = `${urgencyMessages[urgency]}

━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 *ORDER DETAILS*
━━━━━━━━━━━━━━━━━━━━━━━━━━━

Order ID: \`${order.id}\`
Service: ${order.service}
Document Type: ${documentType}
${hasCVData ? '✅ CV data received (18+ categories)' : '⏳ CV data pending'}
Amount Due: ${order.total_charge}
Days Since Order: ${daysSince}
${urgency === 'overdue' ? `Days Overdue: ${daysSince - 14}` : ''}

━━━━━━━━━━━━━━━━━━━━━━━━━━━
💳 *PAYMENT METHODS*
━━━━━━━━━━━━━━━━━━━━━━━━━━━

• Airtel Money: 0991295401
• TNM Mpamba: 0886928639
• MO626 Bank: 1005653618

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
    
    await this.bot.telegram.sendMessage(client.telegram_id, message, { 
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[
          { text: "💳 I've Made Payment", callback_data: `confirm_payment_${order.id}` }
        ]]
      }
    });
    
    // Update reminder count in database
    await db.updatePaymentReminder(order.id, daysSince);
    
    // Notify admin for high urgency cases
    if (urgency === 'high' || urgency === 'final' || urgency === 'overdue') {
      await notificationService.alertAdmin(
        `${urgencyColors[urgency]} Urgent Payment Reminder Sent`,
        `Order: ${order.id}\nClient: ${client.first_name}\nDays Since: ${daysSince}\nUrgency: ${urgency}\nHas CV Data: ${hasCVData ? 'Yes (18+ categories)' : 'No'}`,
        this.bot
      );
    }
  }
  
  async escalateOverduePayments() {
    const pendingOrders = await db.getPendingPaymentOrders();
    const now = new Date();
    const thirtyDaysAgo = new Date(now.setDate(now.getDate() - 30));
    
    for (const order of pendingOrders) {
      // Skip installment and pay later orders (handled separately)
      if (order.payment_type === 'installment' || order.payment_type === 'pay_later') continue;
      
      const orderDate = new Date(order.created_at);
      if (orderDate < thirtyDaysAgo) {
        const client = await db.getClient(order.client_id);
        await notificationService.alertAdmin(
          `🚨 CRITICAL: Order ${order.id} is 30+ days overdue`,
          `Order: ${order.id}\nClient: ${client?.first_name || 'Unknown'}\nAmount: ${order.total_charge}\nCreated: ${orderDate.toLocaleDateString()}\n\nAction required: Cancel or follow up manually.`,
          this.bot
        );
      }
    }
    
    // Also check installment plans
    const installmentPlans = await db.getAllInstallmentPlans?.() || [];
    for (const plan of installmentPlans) {
      if (plan.status !== 'active') continue;
      
      const currentInstallment = plan.installments?.[plan.current_installment - 1];
      if (!currentInstallment || currentInstallment.status === 'paid') continue;
      
      const dueDate = new Date(currentInstallment.due_date);
      const daysOverdue = Math.floor((now - dueDate) / (1000 * 60 * 60 * 24));
      
      if (daysOverdue >= 14) {
        await notificationService.alertAdmin(
          `🚨 CRITICAL: Installment ${plan.orderId} is ${daysOverdue} days overdue`,
          `Order: ${plan.orderId}\nClient: ${plan.clientName}\nInstallment: ${plan.current_installment}/2\nAmount: ${currentInstallment.amount}\nDays Overdue: ${daysOverdue}`,
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
      // Skip installment/pay later
      if (order.payment_type === 'installment' || order.payment_type === 'pay_later') continue;
      
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
    
    // Add installment overdue to report
    const installmentPlans = await db.getAllInstallmentPlans?.() || [];
    const overdueInstallments = [];
    for (const plan of installmentPlans) {
      if (plan.status !== 'active') continue;
      const installment = plan.installments?.[plan.current_installment - 1];
      if (!installment || installment.status === 'paid') continue;
      
      const dueDate = new Date(installment.due_date);
      const daysOverdue = Math.floor((now - dueDate) / (1000 * 60 * 60 * 24));
      if (daysOverdue > 0) {
        overdueInstallments.push({
          orderId: plan.orderId,
          client_name: plan.clientName,
          amount: installment.amount,
          installment_num: plan.current_installment,
          days_overdue: daysOverdue
        });
      }
    }
    
    // Add Pay Later overdue
    const payLaterPlans = await db.getAllPayLaterPlans?.() || [];
    const overduePayLater = [];
    for (const plan of payLaterPlans) {
      if (plan.status !== 'pending') continue;
      const dueDate = new Date(plan.due_date);
      const daysOverdue = Math.floor((now - dueDate) / (1000 * 60 * 60 * 24));
      if (daysOverdue > 0) {
        overduePayLater.push({
          orderId: plan.orderId,
          client_name: plan.clientName,
          amount: plan.amount,
          days_overdue: daysOverdue
        });
      }
    }
    
    const totalOverdue = overdueOrders.length + overdueInstallments.length + overduePayLater.length;
    
    if (totalOverdue > 0) {
      let report = `📊 *DAILY OVERDUE PAYMENTS REPORT*\n\n`;
      report += `*Summary:* ${totalOverdue} overdue items\n`;
      report += `- Regular Orders: ${overdueOrders.length}\n`;
      report += `- Installments: ${overdueInstallments.length}\n`;
      report += `- Pay Later: ${overduePayLater.length}\n\n`;
      
      if (overdueOrders.length > 0) {
        report += `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
        report += `📋 *REGULAR ORDERS*\n`;
        report += `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
        for (const order of overdueOrders.slice(0, 10)) {
          report += `• Order: ${order.id}\n`;
          report += `  Client: ${order.client_name}\n`;
          report += `  Amount: ${order.total_charge}\n`;
          report += `  Days Overdue: ${order.days_overdue}\n\n`;
        }
        if (overdueOrders.length > 10) {
          report += `... and ${overdueOrders.length - 10} more\n\n`;
        }
      }
      
      if (overdueInstallments.length > 0) {
        report += `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
        report += `💰 *INSTALLMENTS*\n`;
        report += `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
        for (const inst of overdueInstallments.slice(0, 10)) {
          report += `• Order: ${inst.orderId}\n`;
          report += `  Client: ${inst.client_name}\n`;
          report += `  Installment: ${inst.installment_num}/2\n`;
          report += `  Amount: ${inst.amount}\n`;
          report += `  Days Overdue: ${inst.days_overdue}\n\n`;
        }
      }
      
      await notificationService.alertAdmin(`📊 Overdue Payments Report - ${totalOverdue} items`, report, this.bot);
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
• MO626 Bank: 1005653618

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
      by_type: {
        regular: 0,
        installment: 0,
        pay_later: 0
      },
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
      const amount = parseInt(order.total_charge?.replace(/[^0-9]/g, '') || 0);
      stats.total_amount_pending += amount;
      
      // Count by type
      if (order.payment_type === 'installment') stats.by_type.installment++;
      else if (order.payment_type === 'pay_later') stats.by_type.pay_later++;
      else stats.by_type.regular++;
      
      // Count by days
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