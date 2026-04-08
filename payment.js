// payment.js - Enterprise Payment Processing with Multi-Provider Support
const crypto = require('crypto');
const notificationService = require('./notification-service');
const db = require('./database');

class PaymentProcessor {
  constructor() {
    this.paymentReferences = new Map();
    this.providers = {
      airtel: {
        name: 'Airtel Money',
        number: '0991295401',
        ussd: '*211#'
      },
      mpamba: {
        name: 'TNM Mpamba',
        number: '0886928639',
        ussd: '*444#'
      },
      bank: {
        name: 'National Bank',
        account: '1005653618',
        swift: 'NBMAMWMW'
      }
    };
  }

  generatePaymentReference() {
    const timestamp = Date.now().toString().slice(-6);
    const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
    const checksum = crypto.createHash('md5').update(`${timestamp}${random}`).digest('hex').slice(0, 4);
    return `EASY${timestamp}${random}${checksum}`;
  }

  async initiatePayment(amount, orderId, clientId, clientName, clientPhone, ctx, paymentMethod = null) {
    const reference = this.generatePaymentReference();
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);
    
    this.paymentReferences.set(reference, {
      orderId, clientId, clientName, clientPhone, amount,
      status: 'pending', 
      createdAt: new Date().toISOString(),
      expiresAt: expiresAt.toISOString(),
      reminderCount: 0,
      paymentMethod: paymentMethod || 'any',
      attempts: 0
    });

    // Schedule expiration reminder
    this.scheduleExpirationReminder(reference, expiresAt, ctx);

    // Send admin notification
    const adminMessage = `🚨 *NEW PAYMENT PENDING*

━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 *Payment Details*
━━━━━━━━━━━━━━━━━━━━━━━━━━━

Reference: \`${reference}\`
Client: ${clientName}
Phone: ${clientPhone}
Amount: ${amount}
Order: ${orderId}
Expires: ${expiresAt.toLocaleString()}

━━━━━━━━━━━━━━━━━━━━━━━━━━━
💳 *Action Required*
━━━━━━━━━━━━━━━━━━━━━━━━━━━

To verify: /verify ${reference}`;

    await notificationService.alertAdmin(`💰 Payment Pending: ${reference}`, adminMessage, ctx.bot);

    // Generate payment instructions based on method
    const paymentInstructions = this.generatePaymentInstructions(amount, reference, paymentMethod);
    
    return {
      reference,
      expiresAt: expiresAt.toISOString(),
      ...paymentInstructions
    };
  }

  generatePaymentInstructions(amount, reference, method) {
    const instructions = {
      reference,
      amount,
      message: `💰 *PAYMENT REQUIRED*

Amount: ${amount}
Reference: \`${reference}\`
Expires: 48 hours

━━━━━━━━━━━━━━━━━━━━━━━━━━━
💳 *PAYMENT OPTIONS*
━━━━━━━━━━━━━━━━━━━━━━━━━━━`
    };

    if (!method || method === 'any') {
      instructions.message += `

*1️⃣ Airtel Money*
   📱 Number: ${this.providers.airtel.number}
   📞 USSD: Dial ${this.providers.airtel.ussd}

*2️⃣ TNM Mpamba*
   📱 Number: ${this.providers.mpamba.number}
   📞 USSD: Dial ${this.providers.mpamba.ussd}

*3️⃣ Bank Transfer*
   🏦 ${this.providers.bank.name}
   💳 Account: ${this.providers.bank.account}
   🌐 SWIFT: ${this.providers.bank.swift}

━━━━━━━━━━━━━━━━━━━━━━━━━━━
📌 *INSTRUCTIONS*
━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. Send exactly ${amount} to any account above
2. Use reference \`${reference}\` as payment reference
3. After sending, type: \`/confirm ${reference}\`

⏰ Reference expires in 48 hours`;
    } else if (method === 'airtel') {
      instructions.message += `

📱 *Airtel Money*
   Number: ${this.providers.airtel.number}
   USSD: Dial ${this.providers.airtel.ussd}

Send exactly ${amount} to ${this.providers.airtel.number}
Use reference: \`${reference}\`

After payment, type: \`/confirm ${reference}\``;
    } else if (method === 'mpamba') {
      instructions.message += `

📱 *TNM Mpamba*
   Number: ${this.providers.mpamba.number}
   USSD: Dial ${this.providers.mpamba.ussd}

Send exactly ${amount} to ${this.providers.mpamba.number}
Use reference: \`${reference}\`

After payment, type: \`/confirm ${reference}\``;
    } else if (method === 'bank') {
      instructions.message += `

🏦 *Bank Transfer*
   Bank: ${this.providers.bank.name}
   Account: ${this.providers.bank.account}
   SWIFT: ${this.providers.bank.swift}

Send exactly ${amount} to the account above
Use reference: \`${reference}\`

After payment, type: \`/confirm ${reference}\``;
    }

    return instructions;
  }

  scheduleExpirationReminder(reference, expiresAt, ctx) {
    const timeUntilExpiry = expiresAt.getTime() - Date.now();
    const reminderTimes = [timeUntilExpiry - 24 * 60 * 60 * 1000, timeUntilExpiry - 6 * 60 * 60 * 1000];
    
    for (const reminderTime of reminderTimes) {
      if (reminderTime > 0) {
        setTimeout(async () => {
          const payment = this.paymentReferences.get(reference);
          if (payment && payment.status === 'pending') {
            await notificationService.alertAdmin(
              `⏰ Payment Expiring Soon: ${reference}`,
              `Payment ${reference} will expire in ${reminderTime === timeUntilExpiry - 24 * 60 * 60 * 1000 ? '24 hours' : '6 hours'}. Client: ${payment.clientName}`,
              ctx.bot
            );
          }
        }, reminderTime);
      }
    }
  }

  async confirmPayment(reference, ctx) {
    const payment = this.paymentReferences.get(reference);
    if (!payment) return { success: false, error: "Reference not found." };
    if (payment.status === 'confirmed') return { success: false, error: "Payment already confirmed." };
    if (payment.status === 'expired') return { success: false, error: "Reference expired. Please start a new payment." };
    
    payment.attempts++;
    payment.status = 'pending_verification';
    payment.confirmedAt = new Date().toISOString();
    this.paymentReferences.set(reference, payment);

    const adminMessage = `🚨 *URGENT: PAYMENT NEEDS VERIFICATION*

━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 *Payment Details*
━━━━━━━━━━━━━━━━━━━━━━━━━━━

Reference: \`${reference}\`
Client: ${payment.clientName}
Phone: ${payment.clientPhone}
Amount: ${payment.amount}
Order: ${payment.orderId}
Attempt: ${payment.attempts}

━━━━━━━━━━━━━━━━━━━━━━━━━━━
💳 *Action Required*
━━━━━━━━━━━━━━━━━━━━━━━━━━━

To verify: /verify ${reference}`;

    await notificationService.alertAdmin(`🚨 Payment Verification Needed: ${reference}`, adminMessage, ctx.bot);

    return {
      success: true,
      message: `✅ Payment confirmation received! Reference: \`${reference}\`

Our team has been notified and will verify shortly. You will receive confirmation once verified.

⏱️ Expected: 5-10 minutes`
    };
  }

  async verifyPayment(reference, ctx) {
    const payment = this.paymentReferences.get(reference);
    if (!payment) return { success: false, error: "Reference not found" };
    if (payment.status === 'confirmed') return { success: false, error: "Payment already confirmed" };
    if (payment.status === 'expired') return { success: false, error: "Reference expired" };

    payment.status = 'confirmed';
    payment.verifiedAt = new Date().toISOString();
    payment.verifiedBy = ctx.from.id;
    this.paymentReferences.set(reference, payment);

    // Update order status
    await db.updateOrderStatus(payment.orderId, 'paid');
    await db.updateOrderPaymentStatus(payment.orderId, 'completed');
    if (payment.paymentMethod) {
      await db.updateOrderPaymentMethod(payment.orderId, payment.paymentMethod);
    }

    // Send client confirmation
    const client = await db.getClientById(payment.clientId);
    if (client && client.telegram_id) {
      await ctx.telegram.sendMessage(client.telegram_id, 
        `✅ *PAYMENT CONFIRMED!*

Your payment of ${payment.amount} has been confirmed.

Reference: \`${reference}\`
Order: \`${payment.orderId}\`

Your document is now being prepared. You will receive it within the delivery timeframe.

Thank you for your trust in EasySuccor! 🙏`, 
        { parse_mode: 'Markdown' }
      );
    }

    await notificationService.alertAdmin(`✅ Payment Verified: ${reference}`,
      `✅ Payment ${reference} VERIFIED.\nClient: ${payment.clientName}\nAmount: ${payment.amount}\nOrder: ${payment.orderId}\nVerified by: ${ctx.from.first_name}`,
      ctx.bot);

    return { success: true, orderId: payment.orderId, message: `✅ Payment verified for ${reference}` };
  }

  getPaymentStatus(reference) {
    const payment = this.paymentReferences.get(reference);
    if (!payment) return { status: 'not_found' };
    return { 
      status: payment.status, 
      amount: payment.amount, 
      createdAt: payment.createdAt,
      expiresAt: payment.expiresAt,
      attempts: payment.attempts
    };
  }

  async getPendingPayments() {
    const pending = [];
    for (const [reference, payment] of this.paymentReferences) {
      if (payment.status === 'pending' || payment.status === 'pending_verification') {
        pending.push({ reference, ...payment });
      }
    }
    return pending;
  }

  async getPaymentStats() {
    const stats = {
      total: this.paymentReferences.size,
      pending: 0,
      confirmed: 0,
      expired: 0,
      total_amount: 0
    };
    
    for (const [, payment] of this.paymentReferences) {
      stats[payment.status]++;
      if (payment.status === 'confirmed') {
        stats.total_amount += payment.amount;
      }
    }
    
    return stats;
  }
}

module.exports = new PaymentProcessor();