// installment-tracker.js - Enterprise Installment Payment Tracking System
const db = require('./database');
const notificationService = require('./notification-service');
const cron = require('node-cron');

class InstallmentTracker {
  constructor(bot) {
    this.bot = bot;
    this.installments = new Map();
    this.startReminderScheduler();
    this.startOverdueScheduler();
  }

  startReminderScheduler() {
    // Run every 6 hours
    cron.schedule('0 */6 * * *', async () => {
      await this.sendDueReminders();
    });
  }

  startOverdueScheduler() {
    // Run daily at 8 AM
    cron.schedule('0 8 * * *', async () => {
      await this.processOverdueInstallments();
    });
  }

  async createInstallmentPlan(orderId, clientId, totalAmount, clientName, clientPhone, deliveryTime) {
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
      penalty_amount: 0,
      extension_requests: 0,
      max_extensions: 2,
      created_at: new Date().toISOString(),
      last_reminder_sent: null
    };
    
    this.installments.set(orderId, installmentData);
    await this.saveToDatabase(installmentData);
    
    // Send initial confirmation
    await this.notifyClient(installmentData, `📋 *Installment Plan Created*

Order: ${orderId}
Total Amount: ${totalAmount}
First Payment: ${firstInstallment}
Second Payment: ${secondInstallment} (due in 7 days)

Your CV creation will begin after first payment.

Type /pay to make your first payment.`);
    
    return installmentData;
  }

  getDueDate(daysFromNow) {
    const date = new Date();
    date.setDate(date.getDate() + daysFromNow);
    return date.toISOString().split('T')[0];
  }

  async saveToDatabase(installmentData) {
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
  }

  async loadFromDatabase(orderId) {
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
    
    // Allow overpayment with change handling
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

Amount Paid: ${currentInstallment.amount}
Remaining: ${installment.remaining_amount}
${change > 0 ? `Change/Overpayment: ${change}\n` : ''}

Your CV creation has started!

*Next payment:* ${installment.installments[1].amount}
*Due date:* ${installment.installments[1].due_date}

You will receive your CV after the final payment.

Thank you for choosing EasySuccor! 🙏`;
      
      await this.notifyAdmin(installment, 'First installment payment received', currentInstallment.amount);
      
    } else if (installment.current_installment === 2) {
      installment.cv_status = 'completed';
      responseMessage = `✅ *Final Payment Received!*

Total Paid: ${installment.paid_amount}
${change > 0 ? `Change/Overpayment: ${change}\n` : ''}

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
      
      // Send reminders at specific intervals
      if (daysUntilDue === 3 && (!lastReminder || hoursSinceLastReminder > 12)) {
        await this.sendReminder(installment, currentInstallment, daysUntilDue, 'warning');
        installment.last_reminder_sent = now.toISOString();
      } else if (daysUntilDue === 1 && (!lastReminder || hoursSinceLastReminder > 6)) {
        await this.sendReminder(installment, currentInstallment, daysUntilDue, 'urgent');
        installment.last_reminder_sent = now.toISOString();
      } else if (daysUntilDue === 0 && (!lastReminder || hoursSinceLastReminder > 3)) {
        await this.sendReminder(installment, currentInstallment, daysUntilDue, 'due_today');
        installment.last_reminder_sent = now.toISOString();
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
        // Apply penalty after 7 days overdue
        if (daysOverdue >= 7) {
          const penalty = Math.floor(currentInstallment.amount * 0.1);
          currentInstallment.amount += penalty;
          installment.penalty_amount += penalty;
          currentInstallment.penalty_applied = true;
          
          await this.notifyClient(installment, `⚠️ *Late Payment Penalty Applied*

Your payment for installment ${currentInstallment.number} is ${daysOverdue} days overdue.

A late fee of ${penalty} has been added.
New amount due: ${currentInstallment.amount}

Please make your payment as soon as possible to avoid additional penalties.`);
          
          await this.notifyAdmin(installment, `Late payment penalty applied - ${daysOverdue} days overdue`, penalty);
        } else if (daysOverdue >= 3) {
          // Send overdue reminder
          await this.sendReminder(installment, currentInstallment, -daysOverdue, 'overdue');
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

📋 *Installment Payment Required*

Order: ${installment.orderId}
Installment ${currentInstallment.number} of 2
Amount Due: ${currentInstallment.amount}
Due Date: ${currentInstallment.due_date}
${daysUntilDue < 0 ? `Days Overdue: ${Math.abs(daysUntilDue)}` : `Days Remaining: ${daysUntilDue}`}

*Payment Methods:*
• Airtel Money: 0991295401
• TNM Mpamba: 0886928639
• Visa/NBM: 1005653618

*Reference:* Use your order ID: ${installment.orderId}

After payment, type /pay to confirm.

${urgency === 'overdue' ? 'Late fees may apply if payment is not received soon.' : 'Pay on time to avoid late fees.'}

Your CV will be delivered once payment is confirmed.`;
    
    await this.bot.telegram.sendMessage(client.telegram_id, message, { parse_mode: 'Markdown' });
  }

  async notifyClient(installment, message) {
    const client = await db.getClientById(installment.clientId);
    if (client && client.telegram_id) {
      await this.bot.telegram.sendMessage(client.telegram_id, message, { parse_mode: 'Markdown' });
    }
  }

  async notifyAdmin(installment, subject, amount) {
    const adminMessage = `💰 *Installment Update*

Order: ${installment.orderId}
Client: ${installment.clientName}
Event: ${subject}
Amount: ${amount}
Remaining: ${installment.remaining_amount}
Status: ${installment.cv_status}`;
    
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
    
    return {
      success: true,
      message: `✅ *Extension Granted*

Your due date has been extended by ${extensionDays} days.

New due date: ${currentInstallment.due_date}

Please make your payment by this date.`
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
}

module.exports = InstallmentTracker;