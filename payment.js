// payment.js - Enterprise Payment Processing with Multi-Provider Support
const crypto = require('crypto');
const notificationService = require('./notification-service');
const db = require('./database');

// Mobile-friendly separator
const SEP = '\n┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅\n';

class PaymentProcessor {
  constructor() {
    this.paymentReferences = new Map();
    this.installmentPlans = new Map();
    this.payLaterPlans = new Map();
    
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
        name: 'MO626',
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

  // ============ REGULAR PAYMENT ============
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

    this.scheduleExpirationReminder(reference, expiresAt, ctx);

    const adminMessage = `🚨 *NEW PAYMENT PENDING*

${SEP}
📋 *Payment Details*
${SEP}

Reference: \`${reference}\`
Client: ${clientName}
Phone: ${clientPhone}
Amount: ${amount}
Order: ${orderId}
Expires: ${expiresAt.toLocaleString()}

${SEP}
💳 *Action Required*
${SEP}

To verify: /verify ${reference}`;

    await notificationService.alertAdmin(`💰 Payment Pending: ${reference}`, adminMessage, ctx.bot);

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
      message: `💳 *COMPLETE YOUR PAYMENT*

${SEP}
📋 ORDER SUMMARY
${SEP}

Amount: *${amount}*
Reference: \`${reference}\`

${SEP}
💳 PAYMENT METHODS
${SEP}`
    };

    if (!method || method === 'any') {
      instructions.message += `

*1️⃣ Mobile Money (Airtel/Mpamba)*
   📱 Airtel: ${this.providers.airtel.number}
   📱 Mpamba: ${this.providers.mpamba.number}

*2️⃣ Bank Transfer (MO626)*
   🏦 Account: ${this.providers.bank.account}

*3️⃣ Pay Later* - 7 days to pay
*4️⃣ Installments* - 2 parts over 7 days

${SEP}
📌 NEXT STEPS
${SEP}

Choose your preferred payment method above.`;
    }

    return instructions;
  }

  // ============ PAY LATER ============
  async initiatePayLater(amount, orderId, clientId, clientName, clientPhone, ctx) {
    const reference = this.generatePaymentReference();
    const dueDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const reminderDates = [
      { daysBefore: 3, date: new Date(Date.now() + 4 * 24 * 60 * 60 * 1000) },
      { daysBefore: 1, date: new Date(Date.now() + 6 * 24 * 60 * 60 * 1000) },
      { daysBefore: 0, date: dueDate }
    ];
    
    const payLaterPlan = {
      orderId,
      clientId,
      clientName,
      clientPhone,
      amount,
      reference,
      status: 'pending',
      dueDate: dueDate.toISOString(),
      createdAt: new Date().toISOString(),
      penaltyApplied: false,
      penaltyAmount: 0,
      remindersSent: [],
      extensionRequests: 0,
      maxExtensions: 2
    };
    
    this.payLaterPlans.set(orderId, payLaterPlan);
    
    // Save to database
    await db.savePayLaterPlan(payLaterPlan);
    
    // Schedule reminders
    for (const reminder of reminderDates) {
      this.schedulePayLaterReminder(orderId, reminder.date, reminder.daysBefore, ctx);
    }
    
    const adminMessage = `⏳ *PAY LATER PLAN CREATED*

${SEP}
📋 DETAILS
${SEP}

Order: ${orderId}
Client: ${clientName}
Amount: ${amount}
Reference: \`${reference}\`
Due Date: ${dueDate.toLocaleDateString()}

${SEP}
✅ Status: Awaiting payment within 7 days`;

    await notificationService.alertAdmin(`⏳ Pay Later: ${orderId}`, adminMessage, ctx.bot);
    
    return {
      success: true,
      reference,
      dueDate: dueDate.toISOString(),
      message: `⏳ *PAY LATER PLAN ACTIVATED*

${SEP}
📋 ORDER DETAILS
${SEP}

Order: \`${orderId}\`
Amount: *${amount}*
Reference: \`${reference}\`

${SEP}
⏰ PAYMENT DEADLINE
${SEP}

*Due Date:* ${dueDate.toLocaleDateString()}
*Time Remaining:* 7 days

${SEP}
⚠️ IMPORTANT NOTES
${SEP}

• Your document will be delivered AFTER payment
• 10% penalty if payment is late
• Reminders will be sent before due date
• You can request a 3-day extension (max 2 times)

${SEP}
💳 WHEN READY TO PAY
${SEP}

Send *${amount}* to:
📱 Airtel: ${this.providers.airtel.number}
📱 Mpamba: ${this.providers.mpamba.number}
🏦 MO626: ${this.providers.bank.account}

Reference: \`${reference}\`

After payment, type: \`/confirm ${reference}\``
    };
  }

  schedulePayLaterReminder(orderId, reminderDate, daysBefore, ctx) {
    const timeUntilReminder = reminderDate.getTime() - Date.now();
    if (timeUntilReminder > 0) {
      setTimeout(async () => {
        const plan = this.payLaterPlans.get(orderId) || await db.getPayLaterPlan(orderId);
        if (plan && plan.status === 'pending') {
          await this.sendPayLaterReminder(orderId, daysBefore, ctx);
        }
      }, timeUntilReminder);
    }
  }

  async sendPayLaterReminder(orderId, daysBefore, ctx) {
    const plan = this.payLaterPlans.get(orderId) || await db.getPayLaterPlan(orderId);
    if (!plan || plan.status !== 'pending') return;
    
    if (plan.remindersSent.includes(daysBefore)) return;
    plan.remindersSent.push(daysBefore);
    await db.updatePayLaterPlan(orderId, { remindersSent: plan.remindersSent });
    
    const client = await db.getClientById(plan.clientId);
    if (!client || !client.telegram_id) return;
    
    let urgency = '';
    let message = '';
    
    if (daysBefore === 3) {
      urgency = '⏰ *REMINDER*';
      message = `Your payment of ${plan.amount} is due in 3 days.`;
    } else if (daysBefore === 1) {
      urgency = '⚠️ *URGENT REMINDER*';
      message = `Your payment of ${plan.amount} is due TOMORROW!`;
    } else if (daysBefore === 0) {
      urgency = '🔴 *DUE TODAY*';
      message = `Your payment of ${plan.amount} is due TODAY!`;
    }
    
    const reminderMessage = `${urgency}

${SEP}
📋 PAYMENT REMINDER
${SEP}

Order: \`${orderId}\`
Amount: *${plan.amount}*
Reference: \`${plan.reference}\`
Due Date: ${new Date(plan.dueDate).toLocaleDateString()}

${message}

${SEP}
💳 PAYMENT METHODS
${SEP}

📱 Airtel: ${this.providers.airtel.number}
📱 Mpamba: ${this.providers.mpamba.number}
🏦 MO626: ${this.providers.bank.account}

${SEP}
⏰ Need more time?
${SEP}

You can request a 3-day extension (max 2 times).

Type: \`/extend ${orderId}\``;

    await ctx.telegram.sendMessage(client.telegram_id, reminderMessage, { parse_mode: 'Markdown' });
    
    await notificationService.alertAdmin(
      `⏰ Pay Later Reminder: ${orderId}`,
      `Reminder sent to ${client.first_name} for payment of ${plan.amount}. Due in ${daysBefore} days.`,
      ctx.bot
    );
  }

  async requestExtension(orderId, ctx) {
    const plan = this.payLaterPlans.get(orderId) || await db.getPayLaterPlan(orderId);
    if (!plan) return { success: false, error: "No pay later plan found" };
    if (plan.status !== 'pending') return { success: false, error: "Payment already completed" };
    if (plan.extensionRequests >= plan.maxExtensions) {
      return { success: false, error: "Maximum extension requests reached. Please contact support." };
    }
    
    plan.extensionRequests++;
    const extensionDays = 3;
    const newDueDate = new Date(plan.dueDate);
    newDueDate.setDate(newDueDate.getDate() + extensionDays);
    plan.dueDate = newDueDate.toISOString();
    
    await db.updatePayLaterPlan(orderId, { 
      extensionRequests: plan.extensionRequests,
      dueDate: plan.dueDate
    });
    
    const client = await db.getClientById(plan.clientId);
    if (client && client.telegram_id) {
      await ctx.telegram.sendMessage(client.telegram_id, 
        `✅ *EXTENSION GRANTED*

Your payment due date has been extended by ${extensionDays} days.

New due date: ${newDueDate.toLocaleDateString()}

Please make your payment by this date to avoid penalties.`,
        { parse_mode: 'Markdown' }
      );
    }
    
    await notificationService.alertAdmin(
      `✅ Extension Granted: ${orderId}`,
      `Client: ${plan.clientName}\nNew due date: ${newDueDate.toLocaleDateString()}\nExtensions used: ${plan.extensionRequests}/${plan.maxExtensions}`,
      ctx.bot
    );
    
    return { success: true, message: `Extension granted. New due date: ${newDueDate.toLocaleDateString()}` };
  }

  async applyPayLaterPenalty(orderId) {
    const plan = this.payLaterPlans.get(orderId) || await db.getPayLaterPlan(orderId);
    if (!plan || plan.penaltyApplied) return null;
    
    const dueDate = new Date(plan.dueDate);
    const now = new Date();
    const daysOverdue = Math.ceil((now - dueDate) / (1000 * 60 * 60 * 24));
    
    if (daysOverdue >= 7 && !plan.penaltyApplied) {
      const penalty = Math.floor(plan.amount * 0.1);
      plan.penaltyApplied = true;
      plan.penaltyAmount = penalty;
      plan.amount += penalty;
      
      await db.updatePayLaterPlan(orderId, {
        penaltyApplied: true,
        penaltyAmount: penalty,
        amount: plan.amount
      });
      
      return { penalty, newAmount: plan.amount, daysOverdue };
    }
    
    return null;
  }

  // ============ INSTALLMENT PLAN ============
  async initiateInstallmentPlan(amount, orderId, clientId, clientName, clientPhone, ctx) {
    const reference = this.generatePaymentReference();
    const firstAmount = Math.ceil(amount / 2);
    const secondAmount = amount - firstAmount;
    const dueDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    
    const installmentPlan = {
      orderId,
      clientId,
      clientName,
      clientPhone,
      totalAmount: amount,
      firstAmount,
      secondAmount,
      reference,
      status: 'first_pending',
      firstPaid: false,
      secondPaid: false,
      dueDate: dueDate.toISOString(),
      createdAt: new Date().toISOString(),
      penaltyApplied: false,
      penaltyAmount: 0,
      extensionRequests: 0,
      maxExtensions: 2,
      remindersSent: []
    };
    
    this.installmentPlans.set(orderId, installmentPlan);
    
    await db.saveInstallmentPlan(installmentPlan);
    
    const adminMessage = `📅 *INSTALLMENT PLAN CREATED*

${SEP}
📋 DETAILS
${SEP}

Order: ${orderId}
Client: ${clientName}
Total: ${amount}
First Payment: ${firstAmount}
Second Payment: ${secondAmount}
Due Date: ${dueDate.toLocaleDateString()}

${SEP}
✅ Status: Awaiting first payment`;

    await notificationService.alertAdmin(`📅 Installment Plan: ${orderId}`, adminMessage, ctx.bot);
    
    return {
      success: true,
      reference,
      firstAmount,
      secondAmount,
      dueDate: dueDate.toISOString(),
      message: `📅 *INSTALLMENT PLAN ACTIVATED*

${SEP}
📋 ORDER DETAILS
${SEP}

Order: \`${orderId}\`
Total Amount: *${amount}*
Reference: \`${reference}\`

${SEP}
💳 PAYMENT SCHEDULE
${SEP}

*1st Payment (50%):* MK${firstAmount.toLocaleString()}
   ➜ Pay now to start CV creation

*2nd Payment (50%):* MK${secondAmount.toLocaleString()}
   ➜ Due by: ${dueDate.toLocaleDateString()}
   ➜ Receive your final document

${SEP}
📌 HOW IT WORKS
${SEP}

1️⃣ Make the first payment now
2️⃣ We start working on your CV immediately
3️⃣ You receive a preview within 24 hours
4️⃣ Make the second payment within 7 days
5️⃣ Receive your final downloadable document

${SEP}
⚠️ LATE PAYMENT POLICY
${SEP}

• 10% penalty if more than 7 days overdue
• Extensions available upon request

${SEP}
💳 MAKE FIRST PAYMENT
${SEP}

Send *MK${firstAmount.toLocaleString()}* to:

📱 Airtel: ${this.providers.airtel.number}
📱 Mpamba: ${this.providers.mpamba.number}
🏦 MO626: ${this.providers.bank.account}

*Reference:* \`${reference}_INST1\`

${SEP}
✅ AFTER FIRST PAYMENT
${SEP}

Click the button below to confirm:`
    };
  }

  async confirmFirstInstallment(orderId, reference, ctx) {
    const plan = this.installmentPlans.get(orderId) || await db.getInstallmentPlan(orderId);
    if (!plan) return { success: false, error: "No installment plan found" };
    if (plan.firstPaid) return { success: false, error: "First installment already confirmed" };
    
    plan.firstPaid = true;
    plan.status = 'first_paid';
    plan.firstPaidAt = new Date().toISOString();
    
    await db.updateInstallmentPlan(orderId, {
      firstPaid: true,
      status: 'first_paid',
      firstPaidAt: plan.firstPaidAt
    });
    
    this.scheduleSecondInstallmentReminder(orderId, new Date(plan.dueDate), ctx);
    
    const client = await db.getClientById(plan.clientId);
    if (client && client.telegram_id) {
      await ctx.telegram.sendMessage(client.telegram_id,
        `✅ *FIRST INSTALLMENT CONFIRMED!*

${SEP}
💰 PAYMENT RECEIVED
${SEP}

Amount Paid: *MK${plan.firstAmount.toLocaleString()}*
Remaining: *MK${plan.secondAmount.toLocaleString()}*

${SEP}
📋 WHAT HAPPENS NEXT
${SEP}

✅ Your CV creation has started!
⏰ You will receive a preview within 24 hours

${SEP}
📅 SECOND PAYMENT
${SEP}

Amount: *MK${plan.secondAmount.toLocaleString()}*
Due Date: *${new Date(plan.dueDate).toLocaleDateString()}*

${SEP}
⚠️ REMINDERS
${SEP}

• You will receive reminders before due date
• Late payments incur 10% penalty
• Extensions available on request

${SEP}
✅ AFTER FINAL PAYMENT
${SEP}

You will receive your downloadable document immediately.

Thank you for choosing EasySuccor! 🙏`,
        { parse_mode: 'Markdown' }
      );
    }
    
    await notificationService.alertAdmin(
      `✅ First Installment Paid: ${orderId}`,
      `Client: ${plan.clientName}\nAmount: MK${plan.firstAmount.toLocaleString()}\nRemaining: MK${plan.secondAmount.toLocaleString()}\nDue: ${new Date(plan.dueDate).toLocaleDateString()}`,
      ctx.bot
    );
    
    return { success: true, orderId };
  }

  async confirmSecondInstallment(orderId, reference, ctx) {
    const plan = this.installmentPlans.get(orderId) || await db.getInstallmentPlan(orderId);
    if (!plan) return { success: false, error: "No installment plan found" };
    if (!plan.firstPaid) return { success: false, error: "First installment not paid yet" };
    if (plan.secondPaid) return { success: false, error: "Second installment already confirmed" };
    
    const penalty = await this.applyInstallmentPenalty(orderId);
    let finalAmount = plan.secondAmount;
    let penaltyMessage = '';
    
    if (penalty) {
      finalAmount = penalty.newAmount;
      penaltyMessage = `\n\n⚠️ *Late Payment Penalty Applied*\nPenalty: MK${penalty.penalty.toLocaleString()}\nTotal Paid: MK${finalAmount.toLocaleString()}`;
    }
    
    plan.secondPaid = true;
    plan.status = 'completed';
    plan.secondPaidAt = new Date().toISOString();
    
    await db.updateInstallmentPlan(orderId, {
      secondPaid: true,
      status: 'completed',
      secondPaidAt: plan.secondPaidAt
    });
    
    const client = await db.getClientById(plan.clientId);
    if (client && client.telegram_id) {
      await ctx.telegram.sendMessage(client.telegram_id,
        `✅ *FINAL INSTALLMENT CONFIRMED!*

${SEP}
💰 PAYMENT COMPLETE
${SEP}

Total Paid: *MK${plan.totalAmount.toLocaleString()}*${penaltyMessage}

${SEP}
📄 YOUR DOCUMENT IS READY!
${SEP}

Your document will be delivered in this chat immediately.

Thank you for completing your payment! 🎉

${SEP}
⭐ *NEXT STEPS*
${SEP}

• Your document is being delivered
• You have 2 free revision requests
• Share your experience with /feedback

Thank you for choosing EasySuccor! 🙏`,
        { parse_mode: 'Markdown' }
      );
    }
    
    await notificationService.alertAdmin(
      `✅ Second Installment Paid: ${orderId}`,
      `Client: ${plan.clientName}\nTotal Amount: MK${plan.totalAmount.toLocaleString()}${penalty ? `\nPenalty Applied: MK${penalty.penalty.toLocaleString()}` : ''}\nInstallment plan completed!`,
      ctx.bot
    );
    
    return { success: true, orderId, penaltyApplied: !!penalty };
  }

  scheduleSecondInstallmentReminder(orderId, dueDate, ctx) {
    const reminderTimes = [
      { daysBefore: 3, time: dueDate.getTime() - 3 * 24 * 60 * 60 * 1000 },
      { daysBefore: 1, time: dueDate.getTime() - 1 * 24 * 60 * 60 * 1000 },
      { daysBefore: 0, time: dueDate.getTime() }
    ];
    
    for (const reminder of reminderTimes) {
      const timeUntilReminder = reminder.time - Date.now();
      if (timeUntilReminder > 0) {
        setTimeout(async () => {
          await this.sendSecondInstallmentReminder(orderId, reminder.daysBefore, ctx);
        }, timeUntilReminder);
      }
    }
  }

  async sendSecondInstallmentReminder(orderId, daysBefore, ctx) {
    const plan = this.installmentPlans.get(orderId) || await db.getInstallmentPlan(orderId);
    if (!plan || plan.secondPaid) return;
    
    if (plan.remindersSent.includes(daysBefore)) return;
    plan.remindersSent.push(daysBefore);
    await db.updateInstallmentPlan(orderId, { remindersSent: plan.remindersSent });
    
    const client = await db.getClientById(plan.clientId);
    if (!client || !client.telegram_id) return;
    
    let urgency = '';
    let message = '';
    
    if (daysBefore === 3) {
      urgency = '⏰ *REMINDER*';
      message = `Your second installment of ${plan.secondAmount} is due in 3 days.`;
    } else if (daysBefore === 1) {
      urgency = '⚠️ *URGENT REMINDER*';
      message = `Your second installment of ${plan.secondAmount} is due TOMORROW!`;
    } else if (daysBefore === 0) {
      urgency = '🔴 *DUE TODAY*';
      message = `Your second installment of ${plan.secondAmount} is due TODAY!`;
    }
    
    const reminderMessage = `${urgency}

${SEP}
📋 INSTALLMENT REMINDER
${SEP}

Order: \`${orderId}\`
Amount Due: *MK${plan.secondAmount.toLocaleString()}*
Due Date: ${new Date(plan.dueDate).toLocaleDateString()}

${message}

${SEP}
💳 PAYMENT METHODS
${SEP}

📱 Airtel: ${this.providers.airtel.number}
📱 Mpamba: ${this.providers.mpamba.number}
🏦 MO626: ${this.providers.bank.account}

Reference: \`${plan.reference}_INST2\`

${SEP}
⏰ Need more time?
${SEP}

You can request a 3-day extension (max 2 times).

Type: \`/extend_installment ${orderId}\``;

    await ctx.telegram.sendMessage(client.telegram_id, reminderMessage, { parse_mode: 'Markdown' });
  }

  async applyInstallmentPenalty(orderId) {
    const plan = this.installmentPlans.get(orderId) || await db.getInstallmentPlan(orderId);
    if (!plan || plan.penaltyApplied) return null;
    
    const dueDate = new Date(plan.dueDate);
    const now = new Date();
    const daysOverdue = Math.ceil((now - dueDate) / (1000 * 60 * 60 * 24));
    
    if (daysOverdue >= 7 && !plan.penaltyApplied) {
      const penalty = Math.floor(plan.secondAmount * 0.1);
      plan.penaltyApplied = true;
      plan.penaltyAmount = penalty;
      const newAmount = plan.secondAmount + penalty;
      
      await db.updateInstallmentPlan(orderId, {
        penaltyApplied: true,
        penaltyAmount: penalty,
        secondAmount: newAmount
      });
      
      return { penalty, newAmount, daysOverdue };
    }
    
    return null;
  }

  async requestInstallmentExtension(orderId, ctx) {
    const plan = this.installmentPlans.get(orderId) || await db.getInstallmentPlan(orderId);
    if (!plan) return { success: false, error: "No installment plan found" };
    if (plan.secondPaid) return { success: false, error: "Payment already completed" };
    if (plan.extensionRequests >= plan.maxExtensions) {
      return { success: false, error: "Maximum extension requests reached. Please contact support." };
    }
    
    plan.extensionRequests++;
    const extensionDays = 3;
    const newDueDate = new Date(plan.dueDate);
    newDueDate.setDate(newDueDate.getDate() + extensionDays);
    plan.dueDate = newDueDate.toISOString();
    
    await db.updateInstallmentPlan(orderId, {
      extensionRequests: plan.extensionRequests,
      dueDate: plan.dueDate
    });
    
    const client = await db.getClientById(plan.clientId);
    if (client && client.telegram_id) {
      await ctx.telegram.sendMessage(client.telegram_id,
        `✅ *INSTALLMENT EXTENSION GRANTED*

Your second payment due date has been extended by ${extensionDays} days.

New due date: ${newDueDate.toLocaleDateString()}

Please make your payment by this date to avoid penalties.`,
        { parse_mode: 'Markdown' }
      );
    }
    
    return { success: true, message: `Extension granted. New due date: ${newDueDate.toLocaleDateString()}` };
  }

  // ============ REGULAR PAYMENT METHODS ============
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

${SEP}
📋 *Payment Details*
${SEP}

Reference: \`${reference}\`
Client: ${payment.clientName}
Phone: ${payment.clientPhone}
Amount: ${payment.amount}
Order: ${payment.orderId}
Attempt: ${payment.attempts}

${SEP}
💳 *Action Required*
${SEP}

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

    await db.updateOrderStatus(payment.orderId, 'paid');
    await db.updateOrderPaymentStatus(payment.orderId, 'completed');
    if (payment.paymentMethod) {
      await db.updateOrderPaymentMethod(payment.orderId, payment.paymentMethod);
    }

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

  async getInstallmentStats() {
    const stats = {
      total: this.installmentPlans.size,
      first_pending: 0,
      first_paid: 0,
      completed: 0,
      total_amount: 0,
      collected_amount: 0
    };
    
    for (const [, plan] of this.installmentPlans) {
      stats[plan.status]++;
      stats.total_amount += plan.totalAmount;
      if (plan.firstPaid) stats.collected_amount += plan.firstAmount;
      if (plan.secondPaid) stats.collected_amount += plan.secondAmount;
    }
    
    return stats;
  }
}

module.exports = new PaymentProcessor();