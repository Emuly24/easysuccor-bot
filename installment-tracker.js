// installment-tracker.js - Enterprise Installment Payment Tracking System (UPDATED)
const db = require('./database');
const notificationService = require('./notification-service');
const cron = require('node-cron');

class InstallmentTracker {
  constructor(bot) {
    this.bot = bot;
    this.installments = new Map();
    this.payLaterPlans = new Map();
    this.startReminderScheduler();
    this.startOverdueScheduler();
    this.startPayLaterReminderScheduler();
  }

  // Get database type safely
  getDbType() {
    return process.env.NODE_ENV === 'production' ? 'postgres' : 'sqlite';
  }

  startReminderScheduler() {
    // Run every 6 hours
    cron.schedule('0 */6 * * *', async () => {
      console.log('🔄 Running installment reminder check...');
      await this.sendDueReminders();
    });
  }

  startOverdueScheduler() {
    // Run daily at 8 AM
    cron.schedule('0 8 * * *', async () => {
      console.log('🔄 Running overdue installment check...');
      await this.processOverdueInstallments();
    });
  }

  startPayLaterReminderScheduler() {
    // Run daily at 10 AM for Pay Later reminders
    cron.schedule('0 10 * * *', async () => {
      console.log('🔄 Running Pay Later reminder check...');
      await this.sendPayLaterReminders();
    });
  }

  // ============ INSTALLMENT PLAN METHODS ============

  async createInstallmentPlan(orderId, clientId, totalAmount, clientName, clientPhone, deliveryTime, cvData = null) {
    const firstInstallment = Math.ceil(totalAmount * 0.5);
    const secondInstallment = totalAmount - firstInstallment;
    
    const installments = [
      { 
        number: 1, 
        amount: firstInstallment, 
        status: 'pending', 
        due_date: this.getDueDate(0), 
        paid_date: null, 
        reference: null,
        description: 'Down Payment - CV creation begins',
        penalty_applied: false
      },
      { 
        number: 2, 
        amount: secondInstallment, 
        status: 'pending', 
        due_date: this.getDueDate(7), 
        paid_date: null, 
        reference: null,
        description: 'Final Payment - Receive your CV',
        penalty_applied: false
      }
    ];
    
    const installmentData = {
      orderId,
      clientId,
      clientName,
      clientPhone,
      total_amount: totalAmount,
      remaining_amount: totalAmount,
      paid_amount: 0,
      installments: installments,
      current_installment: 1,
      status: 'active',
      cv_status: 'pending',
      delivery_time: deliveryTime,
      cv_data: cvData, // Store CV data with 18+ categories
      penalty_amount: 0,
      extension_requests: 0,
      max_extensions: 2,
      created_at: new Date().toISOString(),
      last_reminder_sent: null,
      reminders_sent: []
    };
    
    this.installments.set(orderId, installmentData);
    await this.saveToDatabase(installmentData);
    
    // Send initial confirmation
    await this.notifyClient(installmentData, `📋 *Installment Plan Created*

━━━━━━━━━━━━━━━━━━━━━━━━━━━
Order: ${orderId}
Total Amount: ${totalAmount}
First Payment: ${firstInstallment}
Second Payment: ${secondInstallment} (due in 7 days)
━━━━━━━━━━━━━━━━━━━━━━━━━━━

Your CV creation will begin after first payment.

Click below to make your first payment.`, {
      reply_markup: {
        inline_keyboard: [[
          { text: "💰 Make First Payment", callback_data: `pay_installment_${orderId}` }
        ]]
      }
    });
    
    return installmentData;
  }

  getDueDate(daysFromNow) {
    const date = new Date();
    date.setDate(date.getDate() + daysFromNow);
    return date.toISOString().split('T')[0];
  }

  async saveToDatabase(installmentData) {
    const dbType = this.getDbType();
    try {
      if (dbType === 'postgres') {
        await db.query(`
          INSERT INTO installments (order_id, client_id, data, status, created_at, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (order_id) DO UPDATE SET data = $3, status = $4, updated_at = $6
        `, [installmentData.orderId, installmentData.clientId, JSON.stringify(installmentData), 
            installmentData.status, installmentData.created_at, new Date().toISOString()]);
      } else {
        await db.run(`
          INSERT OR REPLACE INTO installments (order_id, client_id, data, status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `, [installmentData.orderId, installmentData.clientId, JSON.stringify(installmentData), 
            installmentData.status, installmentData.created_at, new Date().toISOString()]);
      }
      console.log(`✅ Installment plan saved for order ${installmentData.orderId}`);
    } catch (error) {
      console.error('Error saving installment plan:', error);
    }
  }

  async loadFromDatabase(orderId) {
    const dbType = this.getDbType();
    try {
      if (dbType === 'postgres') {
        const result = await db.query('SELECT * FROM installments WHERE order_id = $1', [orderId]);
        if (result.rows[0] && result.rows[0].data) {
          const data = JSON.parse(result.rows[0].data);
          this.installments.set(orderId, data);
          return data;
        }
      } else {
        const result = await db.get('SELECT * FROM installments WHERE order_id = ?', [orderId]);
        if (result && result.data) {
          const data = JSON.parse(result.data);
          this.installments.set(orderId, data);
          return data;
        }
      }
    } catch (error) {
      console.error('Error loading installment plan:', error);
    }
    return null;
  }

  async processInstallmentPayment(orderId, amount, reference, paymentMethod, ctx) {
    let installment = this.installments.get(orderId);
    if (!installment) {
      installment = await this.loadFromDatabase(orderId);
    }
    
    if (!installment) {
      return { success: false, error: "No installment plan found for this order" };
    }
    
    const currentInstallment = installment.installments[installment.current_installment - 1];
    
    if (amount < currentInstallment.amount) {
      return { 
        success: false, 
        error: `Insufficient payment. Expected ${currentInstallment.amount}, received ${amount}. Please pay the full amount.` 
      };
    }
    
    const change = amount - currentInstallment.amount;
    currentInstallment.status = 'paid';
    currentInstallment.paid_date = new Date().toISOString();
    currentInstallment.reference = reference;
    
    installment.paid_amount += currentInstallment.amount;
    installment.remaining_amount -= currentInstallment.amount;
    
    let responseMessage = '';
    
    if (installment.current_installment === 1) {
      installment.cv_status = 'in_progress';
      responseMessage = `✅ *First Payment Received!*

━━━━━━━━━━━━━━━━━━━━━━━━━━━
Amount Paid: ${currentInstallment.amount}
Remaining: ${installment.remaining_amount}
${change > 0 ? `Change/Overpayment: ${change}\n` : ''}
━━━━━━━━━━━━━━━━━━━━━━━━━━━

Your CV creation has started!

*Next payment:* ${installment.installments[1].amount}
*Due date:* ${installment.installments[1].due_date}

You will receive your CV after the final payment.

Thank you for choosing EasySuccor! 🙏`;
      
      await this.notifyAdmin(installment, 'First installment payment received', currentInstallment.amount);
      
    } else if (installment.current_installment === 2) {
      installment.cv_status = 'completed';
      responseMessage = `✅ *Final Payment Received!*

━━━━━━━━━━━━━━━━━━━━━━━━━━━
Total Paid: ${installment.paid_amount}
${change > 0 ? `Change/Overpayment: ${change}\n` : ''}
━━━━━━━━━━━━━━━━━━━━━━━━━━━

Your CV will be delivered within ${installment.delivery_time}.

Thank you for completing your payment! 🎉`;
      
      await this.notifyAdmin(installment, 'Final installment payment received - CV ready for delivery', currentInstallment.amount);
    }
    
    if (installment.current_installment < 2) {
      installment.current_installment++;
    } else {
      installment.status = 'completed';
    }
    
    this.installments.set(orderId, installment);
    await this.saveToDatabase(installment);
    
    await this.notifyClient(installment, responseMessage);
    
    // Update order status in database
    await db.updateOrderPaymentStatus(orderId, installment.status === 'completed' ? 'completed' : 'installment_first_paid');
    
    return {
      success: true,
      message: responseMessage,
      cv_status: installment.cv_status,
      remaining: installment.remaining_amount,
      change: change > 0 ? change : 0
    };
  }

  async sendDueReminders() {
    const now = new Date();
    
    for (const [orderId, installment] of this.installments) {
      if (installment.status !== 'active') continue;
      
      const currentInstallment = installment.installments[installment.current_installment - 1];
      const dueDate = new Date(currentInstallment.due_date);
      const daysUntilDue = Math.ceil((dueDate - now) / (1000 * 60 * 60 * 24));
      const lastReminder = installment.last_reminder_sent ? new Date(installment.last_reminder_sent) : null;
      const hoursSinceLastReminder = lastReminder ? (now - lastReminder) / (1000 * 60 * 60) : 24;
      
      // Check if reminder already sent for this interval
      if (installment.reminders_sent?.includes(daysUntilDue)) continue;
      
      if (daysUntilDue === 3 && (!lastReminder || hoursSinceLastReminder > 12)) {
        await this.sendReminder(installment, currentInstallment, daysUntilDue, 'warning');
        installment.last_reminder_sent = now.toISOString();
        if (!installment.reminders_sent) installment.reminders_sent = [];
        installment.reminders_sent.push(daysUntilDue);
      } else if (daysUntilDue === 1 && (!lastReminder || hoursSinceLastReminder > 6)) {
        await this.sendReminder(installment, currentInstallment, daysUntilDue, 'urgent');
        installment.last_reminder_sent = now.toISOString();
        installment.reminders_sent.push(daysUntilDue);
      } else if (daysUntilDue === 0 && (!lastReminder || hoursSinceLastReminder > 3)) {
        await this.sendReminder(installment, currentInstallment, daysUntilDue, 'due_today');
        installment.last_reminder_sent = now.toISOString();
        installment.reminders_sent.push(daysUntilDue);
      }
      
      this.installments.set(orderId, installment);
      await this.saveToDatabase(installment);
    }
  }

  async processOverdueInstallments() {
    const now = new Date();
    
    for (const [orderId, installment] of this.installments) {
      if (installment.status !== 'active') continue;
      
      const currentInstallment = installment.installments[installment.current_installment - 1];
      const dueDate = new Date(currentInstallment.due_date);
      const daysOverdue = Math.ceil((now - dueDate) / (1000 * 60 * 60 * 24));
      
      if (daysOverdue > 0 && !currentInstallment.penalty_applied) {
        if (daysOverdue >= 7) {
          const penaltyPercent = parseInt(process.env.INSTALLMENT_PENALTY_PERCENT) || 10;
          const penalty = Math.floor(currentInstallment.amount * (penaltyPercent / 100));
          currentInstallment.amount += penalty;
          installment.penalty_amount += penalty;
          currentInstallment.penalty_applied = true;
          
          await this.notifyClient(installment, `⚠️ *Late Payment Penalty Applied*

━━━━━━━━━━━━━━━━━━━━━━━━━━━
Your payment for installment ${currentInstallment.number} is ${daysOverdue} days overdue.

A late fee of ${penalty} has been added.
New amount due: ${currentInstallment.amount}
━━━━━━━━━━━━━━━━━━━━━━━━━━━

Please make your payment as soon as possible to avoid additional penalties.`);
          
          await this.notifyAdmin(installment, `Late payment penalty applied - ${daysOverdue} days overdue`, penalty);
        } else if (daysOverdue >= 3 && !installment.reminders_sent?.includes(`overdue_${daysOverdue}`)) {
          await this.sendReminder(installment, currentInstallment, -daysOverdue, 'overdue');
          if (!installment.reminders_sent) installment.reminders_sent = [];
          installment.reminders_sent.push(`overdue_${daysOverdue}`);
        }
        
        this.installments.set(orderId, installment);
        await this.saveToDatabase(installment);
      }
    }
  }

  async sendReminder(installment, currentInstallment, daysUntilDue, urgency) {
    const client = await db.getClientById(installment.clientId);
    if (!client || !client.telegram_id) return;
    
    const urgencyMessages = {
      warning: '⏰ *REMINDER*',
      urgent: '⚠️ *URGENT REMINDER*',
      due_today: '🔴 *DUE TODAY*',
      overdue: '❗ *OVERDUE*'
    };
    
    const message = `${urgencyMessages[urgency]}

━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 *Installment Payment Required*
━━━━━━━━━━━━━━━━━━━━━━━━━━━

Order: ${installment.orderId}
Installment ${currentInstallment.number} of 2
Amount Due: ${currentInstallment.amount}
Due Date: ${currentInstallment.due_date}
${daysUntilDue < 0 ? `Days Overdue: ${Math.abs(daysUntilDue)}` : `Days Remaining: ${daysUntilDue}`}

━━━━━━━━━━━━━━━━━━━━━━━━━━━
💳 *Payment Methods*
━━━━━━━━━━━━━━━━━━━━━━━━━━━

• Airtel Money: 0991295401
• TNM Mpamba: 0886928639
• MO626: 1005653618

*Reference:* Use your order ID: ${installment.orderId}

━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ After payment, click the button below:

${urgency === 'overdue' ? 'Late fees may apply if payment is not received soon.' : 'Pay on time to avoid late fees.'}

Your CV will be delivered once payment is confirmed.`;
    
    await this.bot.telegram.sendMessage(client.telegram_id, message, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[
          { text: "✅ I Have Made Payment", callback_data: `confirm_installment_${installment.orderId}` }
        ]]
      }
    });
  }

  async notifyClient(installment, message, extra = {}) {
    const client = await db.getClientById(installment.clientId);
    if (client && client.telegram_id) {
      await this.bot.telegram.sendMessage(client.telegram_id, message, { parse_mode: 'Markdown', ...extra });
    }
  }

  async notifyAdmin(installment, subject, amount) {
    const adminMessage = `💰 *Installment Update*

━━━━━━━━━━━━━━━━━━━━━━━━━━━
Order: ${installment.orderId}
Client: ${installment.clientName}
Event: ${subject}
Amount: ${amount}
Remaining: ${installment.remaining_amount}
Status: ${installment.cv_status}
━━━━━━━━━━━━━━━━━━━━━━━━━━━`;
    
    await notificationService.alertAdmin(`Installment: ${subject}`, adminMessage, this.bot);
  }

  async requestExtension(orderId, ctx) {
    const installment = this.installments.get(orderId) || await this.loadFromDatabase(orderId);
    
    if (!installment) {
      return { success: false, error: "No installment plan found" };
    }
    
    if (installment.extension_requests >= installment.max_extensions) {
      return { success: false, error: "Maximum extension requests reached. Please contact support." };
    }
    
    installment.extension_requests++;
    const extensionDays = 3;
    const currentInstallment = installment.installments[installment.current_installment - 1];
    const newDueDate = new Date(currentInstallment.due_date);
    newDueDate.setDate(newDueDate.getDate() + extensionDays);
    currentInstallment.due_date = newDueDate.toISOString().split('T')[0];
    
    this.installments.set(orderId, installment);
    await this.saveToDatabase(installment);
    
    await this.notifyAdmin(installment, `Extension requested - ${extensionDays} days added`, 0);
    
    await this.notifyClient(installment, `✅ *Extension Granted*

━━━━━━━━━━━━━━━━━━━━━━━━━━━
Your due date has been extended by ${extensionDays} days.

New due date: ${currentInstallment.due_date}

Please make your payment by this date to avoid penalties.
━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    
    return {
      success: true,
      message: `Extension granted. New due date: ${currentInstallment.due_date}`
    };
  }

  async getInstallmentStatus(orderId) {
    const installment = this.installments.get(orderId) || await this.loadFromDatabase(orderId);
    if (!installment) return null;
    
    const currentInstallment = installment.installments[installment.current_installment - 1];
    const dueDate = new Date(currentInstallment.due_date);
    const today = new Date();
    const daysUntilDue = Math.ceil((dueDate - today) / (1000 * 60 * 60 * 24));
    
    return {
      order_id: orderId,
      status: installment.status,
      current_installment: installment.current_installment,
      total_installments: 2,
      amount_paid: installment.paid_amount,
      amount_remaining: installment.remaining_amount,
      next_amount: currentInstallment.amount,
      next_due_date: currentInstallment.due_date,
      days_until_due: daysUntilDue,
      is_overdue: daysUntilDue < 0,
      penalty_amount: installment.penalty_amount,
      extensions_used: installment.extension_requests,
      extensions_remaining: installment.max_extensions - installment.extension_requests,
      cv_status: installment.cv_status
    };
  }

  async getAllInstallmentPlans() {
    const allPlans = [];
    for (const [orderId, plan] of this.installments) {
      allPlans.push(plan);
    }
    return allPlans;
  }

  // ============ PAY LATER METHODS ============

  async createPayLaterPlan(orderId, clientId, totalAmount, clientName, clientPhone, dueDays = 7) {
    const dueDate = this.getDueDate(dueDays);
    const reference = `PL_${orderId}_${Date.now()}`;
    
    const payLaterData = {
      orderId,
      clientId,
      clientName,
      clientPhone,
      amount: totalAmount,
      reference,
      status: 'pending',
      due_date: dueDate,
      created_at: new Date().toISOString(),
      penalty_applied: false,
      penalty_amount: 0,
      reminders_sent: [],
      extension_requests: 0,
      max_extensions: 2
    };
    
    this.payLaterPlans.set(orderId, payLaterData);
    await this.savePayLaterToDatabase(payLaterData);
    
    await this.notifyClient(payLaterData, `⏳ *Pay Later Plan Created*

━━━━━━━━━━━━━━━━━━━━━━━━━━━
Order: ${orderId}
Amount: ${totalAmount}
Reference: \`${reference}\`
Due Date: ${dueDate}
━━━━━━━━━━━━━━━━━━━━━━━━━━━

You have ${dueDays} days to complete your payment.

Your document will be delivered AFTER payment confirmation.

Click below when you make payment.`, {
      reply_markup: {
        inline_keyboard: [[
          { text: "✅ I Have Made Payment", callback_data: `confirm_paylater_${orderId}` }
        ]]
      }
    });
    
    return payLaterData;
  }

  async savePayLaterToDatabase(payLaterData) {
    const dbType = this.getDbType();
    try {
      if (dbType === 'postgres') {
        await db.query(`
          INSERT INTO pay_later (order_id, client_id, data, status, created_at, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (order_id) DO UPDATE SET data = $3, status = $4, updated_at = $6
        `, [payLaterData.orderId, payLaterData.clientId, JSON.stringify(payLaterData), 
            payLaterData.status, payLaterData.created_at, new Date().toISOString()]);
      } else {
        await db.run(`
          INSERT OR REPLACE INTO pay_later (order_id, client_id, data, status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `, [payLaterData.orderId, payLaterData.clientId, JSON.stringify(payLaterData), 
            payLaterData.status, payLaterData.created_at, new Date().toISOString()]);
      }
    } catch (error) {
      console.error('Error saving Pay Later plan:', error);
    }
  }

  async sendPayLaterReminders() {
    const now = new Date();
    
    for (const [orderId, plan] of this.payLaterPlans) {
      if (plan.status !== 'pending') continue;
      
      const dueDate = new Date(plan.due_date);
      const daysUntilDue = Math.ceil((dueDate - now) / (1000 * 60 * 60 * 24));
      
      if (daysUntilDue === 3 && !plan.reminders_sent.includes(3)) {
        await this.sendPayLaterReminder(plan, daysUntilDue, 'warning');
        plan.reminders_sent.push(3);
      } else if (daysUntilDue === 1 && !plan.reminders_sent.includes(1)) {
        await this.sendPayLaterReminder(plan, daysUntilDue, 'urgent');
        plan.reminders_sent.push(1);
      } else if (daysUntilDue === 0 && !plan.reminders_sent.includes(0)) {
        await this.sendPayLaterReminder(plan, daysUntilDue, 'due_today');
        plan.reminders_sent.push(0);
      } else if (daysUntilDue < 0 && !plan.reminders_sent.includes('overdue')) {
        await this.sendPayLaterReminder(plan, Math.abs(daysUntilDue), 'overdue');
        plan.reminders_sent.push('overdue');
        
        // Apply penalty after 7 days overdue
        if (Math.abs(daysUntilDue) >= 7 && !plan.penalty_applied) {
          const penalty = Math.floor(plan.amount * 0.1);
          plan.penalty_applied = true;
          plan.penalty_amount = penalty;
          plan.amount += penalty;
          
          await this.notifyClient(plan, `⚠️ *Late Payment Penalty Applied*

Your Pay Later payment is ${Math.abs(daysUntilDue)} days overdue.

A late fee of ${penalty} has been added.
New amount due: ${plan.amount}

Please make your payment as soon as possible.`);
        }
      }
      
      await this.savePayLaterToDatabase(plan);
    }
  }

  async sendPayLaterReminder(plan, daysUntilDue, urgency) {
    const client = await db.getClientById(plan.clientId);
    if (!client || !client.telegram_id) return;
    
    const urgencyMessages = {
      warning: '⏰ *REMINDER*',
      urgent: '⚠️ *URGENT REMINDER*',
      due_today: '🔴 *DUE TODAY*',
      overdue: '❗ *OVERDUE*'
    };
    
    const message = `${urgencyMessages[urgency]}

━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 *Pay Later Payment Required*
━━━━━━━━━━━━━━━━━━━━━━━━━━━

Order: ${plan.orderId}
Amount Due: ${plan.amount}
Due Date: ${plan.due_date}
${daysUntilDue < 0 ? `Days Overdue: ${Math.abs(daysUntilDue)}` : `Days Remaining: ${daysUntilDue}`}

━━━━━━━━━━━━━━━━━━━━━━━━━━━
💳 *Payment Methods*
━━━━━━━━━━━━━━━━━━━━━━━━━━━

• Airtel Money: 0991295401
• TNM Mpamba: 0886928639
• MO626: 1005653618

*Reference:* ${plan.reference}

━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ Click below when payment is made:`;
    
    await this.bot.telegram.sendMessage(client.telegram_id, message, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[
          { text: "✅ I Have Made Payment", callback_data: `confirm_paylater_${plan.orderId}` }
        ]]
      }
    });
  }

  async confirmPayLaterPayment(orderId, ctx) {
    const plan = this.payLaterPlans.get(orderId);
    if (!plan) {
      return { success: false, error: "No Pay Later plan found" };
    }
    
    if (plan.status === 'completed') {
      return { success: false, error: "Payment already completed" };
    }
    
    plan.status = 'completed';
    plan.paid_at = new Date().toISOString();
    await this.savePayLaterToDatabase(plan);
    
    await db.updateOrderPaymentStatus(orderId, 'completed');
    
    await this.notifyClient(plan, `✅ *Payment Confirmed!*

━━━━━━━━━━━━━━━━━━━━━━━━━━━
Your payment of ${plan.amount} has been confirmed.

Your document will be delivered within the specified timeframe.

Thank you for choosing EasySuccor! 🙏
━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    
    await this.notifyAdmin(plan, `Pay Later payment completed - ${plan.amount}`, plan.amount);
    
    return { success: true, message: "Payment confirmed" };
  }

  async getPayLaterStatus(orderId) {
    const plan = this.payLaterPlans.get(orderId);
    if (!plan) return null;
    
    const dueDate = new Date(plan.due_date);
    const today = new Date();
    const daysUntilDue = Math.ceil((dueDate - today) / (1000 * 60 * 60 * 24));
    
    return {
      order_id: orderId,
      status: plan.status,
      amount: plan.amount,
      due_date: plan.due_date,
      days_until_due: daysUntilDue,
      is_overdue: daysUntilDue < 0,
      penalty_amount: plan.penalty_amount,
      reference: plan.reference
    };
  }
}

module.exports = InstallmentTracker;