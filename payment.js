// payment.js - Hybrid Payment Processing (USSD, Reference, Mobile Money, Pay Later, Installments)
const crypto = require('crypto');
const notificationService = require('./notification-service');

const paymentReferences = new Map();

const MERCHANT_ACCOUNTS = {
  airtel_money: {
    name: 'Airtel Money',
    number: '0991295401',
    account_name: 'EasySuccor Services'
  },
  tnm_mpamba: {
    name: 'TNM Mpamba',
    number: '0886928639',
    account_name: 'EasySuccor Services'
  },
  visa: {
    name: 'Visa / Mastercard',
    account: '1005653618',
    bank: 'National Bank of Malawi',
    merchant_id: 'EASYSUCCOR001'
  }
};

function generatePaymentReference() {
  const timestamp = Date.now().toString().slice(-6);
  const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `EASY${timestamp}${random}`;
}

function getPaymentStatus(reference) {
  const payment = paymentReferences.get(reference);
  if (!payment) return { status: 'not_found' };
  return {
    status: payment.status,
    amount: payment.amount,
    method: payment.method,
    createdAt: payment.createdAt
  };
}

class HybridPayment {
  static generateUSSDPayment(amount, reference) {
    const cleanAmount = amount.replace('MK', '').replace(',', '');
    return {
      airtel: `*211*${cleanAmount}*${MERCHANT_ACCOUNTS.airtel_money.number}*${reference}#`,
      mpamba: `*444*${cleanAmount}*${MERCHANT_ACCOUNTS.tnm_mpamba.number}*${reference}#`
    };
  }

  static async getPaymentOptions(amount, orderId, clientId, clientName, clientPhone) {
    const reference = generatePaymentReference();
    
    paymentReferences.set(reference, {
      orderId,
      clientId,
      clientName,
      clientPhone,
      amount,
      status: 'pending',
      createdAt: new Date().toISOString(),
      reminderCount: 0
    });
    
    const ussd = this.generateUSSDPayment(amount, reference);
    
    const message = `💰 *Payment Required*

Amount: ${amount}
Reference: \`${reference}\`

━━━━━━━━━━━━━━━━━━━━━━━━━━━
*📱 CHOOSE PAYMENT METHOD*
━━━━━━━━━━━━━━━━━━━━━━━━━━━

*1. 📱 Mobile Money with Reference*
   Send to: Airtel ${MERCHANT_ACCOUNTS.airtel_money.number} or Mpamba ${MERCHANT_ACCOUNTS.tnm_mpamba.number}
   Use reference: \`${reference}\`
   → Type /confirm ${reference} after sending

*2. 📞 USSD Quick Pay (Instant)*
   *Airtel:* \`${ussd.airtel}\`
   *Mpamba:* \`${ussd.mpamba}\`
   → Dial code, enter PIN, payment completes instantly
   → Then type /confirm ${reference}

*3. ⏳ Pay Later*
   → Get document first, pay within 7 days

*4. 📅 Installments (2 parts)*
   → Pay in 2 installments over 7 days

*5. 💳 Visa/Mastercard*
   Account: ${MERCHANT_ACCOUNTS.visa.account} (${MERCHANT_ACCOUNTS.visa.bank})

━━━━━━━━━━━━━━━━━━━━━━━━━━━

*Instructions:*
1. Choose a payment method
2. Complete payment using the instructions above
3. Type /confirm ${reference} after sending

*Reference expires in 48 hours*

Need help? Contact support: +265 991 295 401`;
    
    return { message, reference, ussd };
  }

  static async handlePaymentChoice(choice, amount, orderId, clientId, clientName, clientPhone, ctx) {
    const reference = generatePaymentReference();
    
    paymentReferences.set(reference, {
      orderId,
      clientId,
      clientName,
      clientPhone,
      amount,
      status: 'pending',
      createdAt: new Date().toISOString()
    });
    
    if (choice === '1') {
      return {
        type: 'reference',
        reference,
        message: `💰 *Mobile Money Payment*

Amount: ${amount}
Reference: \`${reference}\`

*Send payment to:*
📱 Airtel Money: ${MERCHANT_ACCOUNTS.airtel_money.number}
📱 TNM Mpamba: ${MERCHANT_ACCOUNTS.tnm_mpamba.number}

*Instructions:*
1. Send exactly ${amount} to either number
2. Use reference \`${reference}\` as payment reference
3. After sending, type: /confirm ${reference}

⚠️ Keep your transaction reference number.

Your document will be delivered after payment confirmation.`
      };
    } 
    else if (choice === '2') {
      const ussd = this.generateUSSDPayment(amount, reference);
      return {
        type: 'ussd',
        reference,
        message: `📞 *USSD Quick Pay*

Amount: ${amount}
Reference: \`${reference}\`

*Dial the code for your network:*

*Airtel Money:* \`${ussd.airtel}\`
*TNM Mpamba:* \`${ussd.mpamba}\`

*Instructions:*
1. Dial the USSD code
2. Enter your PIN when prompted
3. Payment completes instantly
4. Then type: /confirm ${reference}

⚠️ Keep your transaction reference number.

Your document will be delivered after payment confirmation.`
      };
    } 
    else if (choice === '3') {
      return {
        type: 'pay_later',
        reference,
        message: `⏳ *Pay Later Selected*

Amount Due: ${amount}
Reference: \`${reference}\`

*Your document will be created first.*

*Payment Instructions:*
Send payment to any of these accounts:

📱 Airtel Money: ${MERCHANT_ACCOUNTS.airtel_money.number}
📱 TNM Mpamba: ${MERCHANT_ACCOUNTS.tnm_mpamba.number}
💳 Visa/Mastercard: ${MERCHANT_ACCOUNTS.visa.account} (${MERCHANT_ACCOUNTS.visa.bank})

*After payment:* Type /confirm ${reference}

*You have 7 days to complete payment.*

Your document will be delivered after payment confirmation.`
      };
    }
    else if (choice === '4') {
      return {
        type: 'installment',
        reference,
        message: `📅 *Installment Plan Selected*

Total Amount: ${amount}
Reference: \`${reference}\`

Pay in 2 installments:
• Installment 1: ${Math.ceil(parseInt(amount.replace('MK', '').replace(',', '')) / 2)} - Due now
• Installment 2: ${Math.floor(parseInt(amount.replace('MK', '').replace(',', '')) / 2)} - Due in 7 days

*Your CV creation will start after the first payment.*

Please pay Installment 1 now using any method above.

After payment, type /confirm ${reference}`
      };
    }
    
    return {
      type: 'error',
      message: "❌ Invalid choice. Please select 1, 2, 3, 4, or 5."
    };
  }
}

async function initiatePayment(amount, orderId, clientId, clientName, clientPhone, ctx) {
  const result = await HybridPayment.getPaymentOptions(amount, orderId, clientId, clientName, clientPhone);
  
  const payment = paymentReferences.get(result.reference);
  if (payment) {
    payment.ctx = ctx;
    paymentReferences.set(result.reference, payment);
  }
  
  setTimeout(async () => {
    const payment = paymentReferences.get(result.reference);
    if (payment && payment.status === 'pending') {
      payment.status = 'expired';
      paymentReferences.set(result.reference, payment);
      
      await notificationService.alertAdmin(
        `⏰ Payment Expired: ${result.reference}`,
        `Payment reference ${result.reference} has expired.\nClient: ${clientName}\nAmount: ${amount}`,
        ctx.bot
      );
    }
  }, 48 * 60 * 60 * 1000);
  
  return result;
}

async function confirmPayment(reference, ctx) {
  const payment = paymentReferences.get(reference);
  
  if (!payment) {
    return { 
      success: false, 
      error: "Reference not found. Please check and try again." 
    };
  }
  
  if (payment.status === 'confirmed') {
    return { 
      success: false, 
      error: "Payment already confirmed for this reference." 
    };
  }
  
  if (payment.status === 'expired') {
    return { 
      success: false, 
      error: "Reference expired. Please start a new payment." 
    };
  }
  
  payment.status = 'pending_verification';
  payment.confirmedAt = new Date().toISOString();
  paymentReferences.set(reference, payment);
  
  const adminMessage = `🚨 *URGENT: PAYMENT NEEDS VERIFICATION*

Reference: \`${reference}\`
Client: ${payment.clientName}
Phone: ${payment.clientPhone}
Amount: ${payment.amount}
Order: ${payment.orderId}

⚠️ Client claims payment sent.

*Action Required:*
1. Check mobile money statement
2. Look for payment with reference: ${reference}
3. Verify amount: ${payment.amount}
4. Then type: /verify ${reference}

⏰ Time sensitive - client waiting.`;

  await notificationService.alertAdmin(
    `🚨 Payment Verification Needed: ${reference}`,
    adminMessage,
    ctx.bot
  );
  
  return {
    success: true,
    message: `✅ Payment confirmation received! Reference: \`${reference}\`

Our team has been notified and will verify your payment shortly.

You will receive confirmation once verified.

⏱️ Expected verification time: 5-10 minutes

Thank you for your patience! 🙏`
  };
}

async function verifyPayment(reference, ctx) {
  const payment = paymentReferences.get(reference);
  
  if (!payment) {
    return { success: false, error: "Reference not found" };
  }
  
  if (payment.status === 'confirmed') {
    return { success: false, error: "Payment already confirmed" };
  }
  
  if (payment.status === 'expired') {
    return { success: false, error: "Reference expired" };
  }
  
  payment.status = 'confirmed';
  payment.verifiedAt = new Date().toISOString();
  payment.verifiedBy = ctx.from.id;
  paymentReferences.set(reference, payment);
  
  await notificationService.alertAdmin(
    `✅ Payment Verified: ${reference}`,
    `✅ Payment for reference ${reference} has been VERIFIED.\nClient: ${payment.clientName}\nPhone: ${payment.clientPhone}\nAmount: ${payment.amount}\nOrder: ${payment.orderId}`,
    ctx.bot
  );
  
  if (payment.clientId) {
    try {
      await ctx.bot.telegram.sendMessage(
        payment.clientId,
        `✅ *Payment Confirmed!*

Your payment of ${payment.amount} has been verified.

Reference: \`${reference}\`

Your document is now being processed and will be delivered shortly.

Thank you for choosing EasySuccor! 🙏`,
        { parse_mode: 'Markdown' }
      );
    } catch (error) {
      console.error('Could not notify client:', error.message);
    }
  }
  
  return { 
    success: true, 
    orderId: payment.orderId,
    message: `✅ Payment verified for ${reference}`
  };
}

function getPaymentInstructions(amount) {
  return `💰 *Payment Instructions*

Total Amount: ${amount}

*Send payment to any of these accounts:*

📱 *Airtel Money:* ${MERCHANT_ACCOUNTS.airtel_money.number}
📱 *TNM Mpamba:* ${MERCHANT_ACCOUNTS.tnm_mpamba.number}
💳 *Visa/Mastercard:* ${MERCHANT_ACCOUNTS.visa.account} (${MERCHANT_ACCOUNTS.visa.bank})

*After sending, type /confirm followed by your reference number.*

*Need help?* Contact support: +265 991 295 401`;
}

function getUSSDInstructions(amount, reference) {
  const cleanAmount = amount.replace('MK', '').replace(',', '');
  return `📞 *USSD Quick Pay*

*Airtel Money:* \`*211*${cleanAmount}*${MERCHANT_ACCOUNTS.airtel_money.number}*${reference}#\`
*TNM Mpamba:* \`*444*${cleanAmount}*${MERCHANT_ACCOUNTS.tnm_mpamba.number}*${reference}#\`

Dial the code, enter your PIN, payment completes instantly.`;
}

module.exports = {
  initiatePayment,
  confirmPayment,
  verifyPayment,
  getPaymentStatus,
  generatePaymentReference,
  HybridPayment,
  getPaymentInstructions,
  getUSSDInstructions,
  MERCHANT_ACCOUNTS,
  paymentReferences
};