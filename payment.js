// payment.js - Payment processing with reference system
const crypto = require('crypto');
const notificationService = require('./notification-service');

const paymentReferences = new Map();

function generatePaymentReference() {
  const timestamp = Date.now().toString().slice(-6);
  const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `EASY${timestamp}${random}`;
}

async function initiatePayment(amount, orderId, clientId, clientName, clientPhone, ctx) {
  const reference = generatePaymentReference();
  
  paymentReferences.set(reference, {
    orderId, clientId, clientName, clientPhone, amount,
    status: 'pending', createdAt: new Date().toISOString(), reminderCount: 0
  });

  const adminMessage = `🚨 *NEW PAYMENT PENDING*

Reference: \`${reference}\`
Client: ${clientName}
Phone: ${clientPhone}
Amount: ${amount}
Order: ${orderId}

To verify: /verify ${reference}`;

  await notificationService.alertAdmin(`💰 Payment Pending: ${reference}`, adminMessage, ctx.bot);

  setTimeout(async () => {
    const payment = paymentReferences.get(reference);
    if (payment && payment.status === 'pending') {
      payment.status = 'expired';
      paymentReferences.set(reference, payment);
      await notificationService.alertAdmin(`⏰ Payment Expired: ${reference}`, `Payment ${reference} expired. Client: ${clientName}`, ctx.bot);
    }
  }, 48 * 60 * 60 * 1000);

  return {
    reference,
    message: `💰 *Payment Required*

Amount: ${amount}
Reference: \`${reference}\`

*Send payment to:*
📱 Airtel Money: 0991295401
📱 TNM Mpamba: 0886928639
💳 National Bank: 1005653618

*Instructions:*
1. Send exactly ${amount} to any account above
2. Use reference \`${reference}\` as payment reference
3. After sending, type: \`/confirm ${reference}\`

⏰ Reference expires in 48 hours`
  };
}

async function confirmPayment(reference, ctx) {
  const payment = paymentReferences.get(reference);
  if (!payment) return { success: false, error: "Reference not found." };
  if (payment.status === 'confirmed') return { success: false, error: "Payment already confirmed." };
  if (payment.status === 'expired') return { success: false, error: "Reference expired. Please start a new payment." };

  payment.status = 'pending_verification';
  payment.confirmedAt = new Date().toISOString();
  paymentReferences.set(reference, payment);

  const adminMessage = `🚨 *URGENT: PAYMENT NEEDS VERIFICATION*

Reference: \`${reference}\`
Client: ${payment.clientName}
Phone: ${payment.clientPhone}
Amount: ${payment.amount}
Order: ${payment.orderId}

To verify: /verify ${reference}`;

  await notificationService.alertAdmin(`🚨 Payment Verification Needed: ${reference}`, adminMessage, ctx.bot);

  for (const admin of notificationService.adminNumbers) {
    await notificationService.sendSMS(admin.number, `EasySuccor: Verify payment ${reference} for ${payment.clientName} - ${payment.amount}`);
  }

  return {
    success: true,
    message: `✅ Payment confirmation received! Reference: \`${reference}\`

Our team has been notified and will verify shortly. You will receive confirmation once verified.

⏱️ Expected: 5-10 minutes`
  };
}

async function verifyPayment(reference, ctx) {
  const payment = paymentReferences.get(reference);
  if (!payment) return { success: false, error: "Reference not found" };
  if (payment.status === 'confirmed') return { success: false, error: "Payment already confirmed" };
  if (payment.status === 'expired') return { success: false, error: "Reference expired" };

  payment.status = 'confirmed';
  payment.verifiedAt = new Date().toISOString();
  paymentReferences.set(reference, payment);

  if (payment.clientPhone) {
    await notificationService.sendClientConfirmation(payment.clientPhone,
      `✅ EasySuccor: Payment confirmed! Reference: ${reference}. Your order is being processed. Thank you!`);
  }

  await notificationService.alertAdmin(`✅ Payment Verified: ${reference}`,
    `✅ Payment ${reference} VERIFIED.\nClient: ${payment.clientName}\nAmount: ${payment.amount}\nOrder: ${payment.orderId}`, ctx.bot);

  return { success: true, orderId: payment.orderId, message: `✅ Payment verified for ${reference}` };
}

function getPaymentStatus(reference) {
  const payment = paymentReferences.get(reference);
  if (!payment) return { status: 'not_found' };
  return { status: payment.status, amount: payment.amount, createdAt: payment.createdAt };
}

module.exports = { initiatePayment, confirmPayment, verifyPayment, getPaymentStatus, generatePaymentReference };