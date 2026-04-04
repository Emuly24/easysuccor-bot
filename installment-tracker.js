// installment-tracker.js - 2-Part Installment Payment Tracking
const db = require('./database');
const notificationService = require('./notification-service');

class InstallmentTracker {
  constructor(bot) {
    this.bot = bot;
    this.installments = new Map();
    this.startReminderScheduler();
  }

  startReminderScheduler() {
    const cron = require('node-cron');
    // Run every day at 9 AM
    cron.schedule('0 9 * * *', async () => {
      await this.sendDueReminders();
    });
  }

  // Create a new installment plan (2 parts only)
  async createInstallmentPlan(orderId, clientId, totalAmount, clientName, clientPhone) {
    const firstInstallment = Math.ceil(totalAmount / 2);
    const secondInstallment = totalAmount - firstInstallment;
    
    const installments = [
      { 
        number: 1, 
        amount: firstInstallment, 
        status: 'pending', 
        due_date: this.getDueDate(0), 
        paid_date: null, 
        reference: null,
        description: 'Start CV creation'
      },
      { 
        number: 2, 
        amount: secondInstallment, 
        status: 'pending', 
        due_date: this.getDueDate(7), 
        paid_date: null, 
        reference: null,
        description: 'Receive final CV'
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
      cv_status: 'not_started',
      created_at: new Date().toISOString()
    };
    
    this.installments.set(orderId, installmentData);
    await this.saveToDatabase(installmentData);
    
    return installmentData;
  }

  getDueDate(daysFromNow) {
    const date = new Date();
    date.setDate(date.getDate() + daysFromNow);
    return date.toISOString().split('T')[0];
  }

  async saveToDatabase(installmentData) {
    await db.run(`
      INSERT OR REPLACE INTO installments 
      (order_id, client_id, data, status, created_at)
      VALUES (?, ?, ?, ?, ?)
    `, [installmentData.orderId, installmentData.clientId, JSON.stringify(installmentData), installmentData.status, installmentData.created_at]);
  }

  async loadFromDatabase(orderId) {
    const record = await db.get('SELECT * FROM installments WHERE order_id = ?', [orderId]);
    if (record && record.data) {
      this.installments.set(orderId, JSON.parse(record.data));
      return this.installments.get(orderId);
    }
    return null;
  }

  async processInstallmentPayment(orderId, amount, reference, paymentMethod, ctx) {
    const installment = this.installments.get(orderId);
    
    if (!installment) {
      return { success: false, error: "No installment plan found for this order" };
    }
    
    const currentInstallment = installment.installments[installment.current_installment - 1];
    
    if (amount !== currentInstallment.amount) {
      return { 
        success: false, 
        error: `Expected payment of ${currentInstallment.amount}, but received ${amount}. Please pay the correct amount.` 
      };
    }
    
    currentInstallment.status = 'paid';
    currentInstallment.paid_date = new Date().toISOString();
    currentInstallment.reference = reference;
    
    installment.paid_amount += amount;
    installment.remaining_amount -= amount;
    
    if (installment.current_installment === 1) {
      installment.cv_status = 'in_progress';
      await this.notifyClient(installment, `✅ *First payment received!*

Amount: ${amount}
Remaining: ${installment.remaining_amount}

Your CV creation has started. You will receive the final CV after the second payment.

*Next payment:* ${installment.installments[1].amount}
*Due date:* ${installment.installments[1].due_date}

Thank you for choosing EasySuccor! 🙏`);
    } else if (installment.current_installment === 2) {
      installment.cv_status = 'completed';
      await this.notifyClient(installment, `✅ *Final payment received!*

Total paid: ${installment.paid_amount}

Your completed CV will be delivered within 24 hours.

Thank you for choosing EasySuccor! 🎉`);
    }
    
    if (installment.current_installment < 2) {
      installment.current_installment++;
    } else {
      installment.status = 'completed';
    }
    
    this.installments.set(orderId, installment);
    await this.saveToDatabase(installment);
    
    await notificationService.alertAdmin(
      `💰 Installment Payment Received`,
      `Order: ${orderId}\nInstallment: ${installment.current_installment - 1}/2\nAmount: ${amount}\nRemaining: ${installment.remaining_amount}\nClient: ${installment.clientName}`,
      this.bot
    );
    
    return {
      success: true,
      message: currentInstallment.number === 1 ? 
        `✅ First payment received! CV creation started. Second payment of ${installment.installments[1].amount} due on ${installment.installments[1].due_date}` :
        `✅ Final payment received! Your CV will be delivered within 24 hours.`,
      cv_status: installment.cv_status
    };
  }

  async sendDueReminders() {
    for (const [orderId, installment] of this.installments) {
      if (installment.status !== 'active') continue;
      
      const currentInstallment = installment.installments[installment.current_installment - 1];
      const dueDate = new Date(currentInstallment.due_date);
      const today = new Date();
      const daysUntilDue = Math.ceil((dueDate - today) / (1000 * 60 * 60 * 24));
      
      if (daysUntilDue === 3 || daysUntilDue === 0 || daysUntilDue === -3) {
        await this.sendReminder(installment, currentInstallment, daysUntilDue);
      }
    }
  }

  async sendReminder(installment, currentInstallment, daysUntilDue) {
    const client = await db.getClient(installment.clientId);
    if (!client || !client.telegram_id) return;
    
    let urgency = '';
    if (daysUntilDue < 0) urgency = '⚠️ *OVERDUE* ⚠️\n';
    else if (daysUntilDue === 0) urgency = '⚠️ *DUE TODAY* ⚠️\n';
    else if (daysUntilDue <= 3) urgency = '⏰ *REMINDER* ⏰\n';
    
    const message = `${urgency}📋 *Installment Payment Reminder*

Order: ${installment.orderId}
Installment ${currentInstallment.number} of 2
Amount Due: ${currentInstallment.amount}
Due Date: ${currentInstallment.due_date}

*Payment Methods:*
• Airtel Money: 0991295401
• TNM Mpamba: 0886928639
• Visa: 1005653618 (NBM)

*Reference:* Use your order ID: ${installment.orderId}

After payment, type /pay to confirm.

Your CV will continue once payment is received.`;
    
    await this.bot.telegram.sendMessage(client.telegram_id, message, { parse_mode: 'Markdown' });
  }

  async notifyClient(installment, message) {
    const client = await db.getClient(installment.clientId);
    if (client && client.telegram_id) {
      await this.bot.telegram.sendMessage(client.telegram_id, message, { parse_mode: 'Markdown' });
    }
  }

  async isInstallmentOrder(orderId) {
    const installment = this.installments.get(orderId) || await this.loadFromDatabase(orderId);
    return !!installment;
  }

  async getCurrentInstallment(orderId) {
    const installment = this.installments.get(orderId) || await this.loadFromDatabase(orderId);
    if (!installment) return null;
    return installment.current_installment;
  }
}

module.exports = InstallmentTracker;