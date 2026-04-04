// referral-tracker.js - Complete Referral Program with Multi-Level Support
const db = require('./database');

class ReferralTracker {
  constructor(bot) {
    this.bot = bot;
  }

  generateReferralCode(userId, username) {
    const code = `${username ? username.substring(0, 5) : 'user'}${userId.toString().slice(-4)}`.toUpperCase();
    return code.replace(/[^A-Z0-9]/g, '');
  }

  getReferralLink(botUsername, referralCode) {
    return `https://t.me/${botUsername}?start=ref_${referralCode}`;
  }

  getShortReferralLink(botUsername, referralCode) {
    return `t.me/${botUsername}?start=ref_${referralCode}`;
  }

  async processReferralStart(ctx, referralCode) {
    const referrer = await db.getClientByReferralCode(referralCode);
    
    if (!referrer) {
      return { success: false, error: "Invalid referral code" };
    }
    
    const newUser = await db.getClient(ctx.from.id);
    
    if (newUser.referred_by) {
      return { success: false, error: "You were already referred by someone" };
    }
    
    if (referrer.telegram_id === ctx.from.id) {
      return { success: false, error: "You cannot refer yourself" };
    }
    
    await db.recordReferral(referrer.id, newUser.id, referralCode);
    
    const newUserCode = this.generateReferralCode(newUser.id, ctx.from.username);
    await db.updateClient(newUser.id, { referral_code: newUserCode });
    
    await this.bot.telegram.sendMessage(
      referrer.telegram_id,
      `🎉 *New Referral!*

${ctx.from.first_name} joined using your referral link!

They will receive 10% off their first order.
You will receive MK2,000 when they complete their first order.

Your total referrals: ${await this.getReferralCount(referrer.id)}`,
      { parse_mode: 'Markdown' }
    );
    
    return { 
      success: true, 
      referrer_name: referrer.first_name,
      your_referral_code: newUserCode,
      message: `🎉 *Welcome!*

You were referred by ${referrer.first_name}!

As a thank you, you get 10% off your first order!

*Your referral code:* \`${newUserCode}\`

Share this link with friends: 
${this.getReferralLink(this.bot.botInfo.username, newUserCode)}

When they complete their first order, you get MK2,000 credit!

Type /referral to see your stats.

Type /start to begin your CV journey!`
    };
  }

  async completeReferral(referredUserId, orderAmount) {
    const client = await db.getClient(referredUserId);
    
    if (!client || !client.referred_by) {
      return { success: false, error: "No referral found" };
    }
    
    const referral = await db.getPendingReferral(client.referred_by, client.id);
    
    if (!referral) {
      return { success: false, error: "Referral not found" };
    }
    
    if (referral.status === 'completed') {
      return { success: false, error: "Referral already rewarded" };
    }
    
    await db.updateReferralStatus(referral.id, 'completed');
    
    const REFERRAL_REWARD = process.env.REFERRAL_REWARD || 2000;
    await db.addReferralCredit(client.referred_by, REFERRAL_REWARD);
    
    const referrer = await db.getClientById(client.referred_by);
    if (referrer && referrer.telegram_id) {
      await this.bot.telegram.sendMessage(
        referrer.telegram_id,
        `🎉 *Referral Reward Earned!*

${client.first_name} completed their first order!

You have earned MK${REFERRAL_REWARD.toLocaleString()} credit!

Your total credit: MK${(referrer.referral_credit + REFERRAL_REWARD).toLocaleString()}

Use your credit on your next order!`,
        { parse_mode: 'Markdown' }
      );
    }
    
    const discountAmount = Math.floor(orderAmount * 0.1);
    
    return { 
      success: true, 
      referrer_credit: REFERRAL_REWARD,
      referred_discount: discountAmount,
      message: `✅ Referral completed! ${referrer.first_name} received MK${REFERRAL_REWARD} credit.`
    };
  }

  async getReferralStats(userId) {
    const client = await db.getClient(userId);
    
    if (!client) return null;
    
    const referrals = await db.getUserReferrals(client.id);
    const completedReferrals = referrals.filter(r => r.status === 'completed');
    const pendingReferrals = referrals.filter(r => r.status === 'pending');
    
    const REFERRAL_REWARD = process.env.REFERRAL_REWARD || 2000;
    const earnedFromReferrals = completedReferrals.length * REFERRAL_REWARD;
    
    return {
      referral_code: client.referral_code,
      total_referrals: referrals.length,
      completed: completedReferrals.length,
      pending: pendingReferrals.length,
      earned_credit: (client.referral_credit || 0) + earnedFromReferrals,
      available_credit: client.referral_credit || 0,
      telegram_link: this.getReferralLink(this.bot.botInfo.username, client.referral_code),
      short_link: this.getShortReferralLink(this.bot.botInfo.username, client.referral_code),
      referrals_list: referrals.map(r => ({
        name: r.referred_name,
        status: r.status,
        date: r.created_at,
        completed_date: r.completed_at
      }))
    };
  }

  async getReferralCount(userId) {
    const client = await db.getClient(userId);
    if (!client) return 0;
    const referrals = await db.getUserReferrals(client.id);
    return referrals.length;
  }

  formatReferralStats(stats) {
    let pendingList = '';
    let completedList = '';
    
    if (stats.pending > 0) {
      pendingList = stats.referrals_list
        .filter(r => r.status === 'pending')
        .map(r => `  • ${r.name} - Joined ${new Date(r.date).toLocaleDateString()}`)
        .join('\n');
    }
    
    if (stats.completed > 0) {
      completedList = stats.referrals_list
        .filter(r => r.status === 'completed')
        .map(r => `  • ${r.name} - Completed ${new Date(r.completed_date).toLocaleDateString()}`)
        .join('\n');
    }
    
    let message = `🎁 *Your Referral Program*

Your code: \`${stats.referral_code}\`

━━━━━━━━━━━━━━━━━━━━━━━━━━━
*Share this link ANYWHERE*
━━━━━━━━━━━━━━━━━━━━━━━━━━━

📱 *Telegram:* ${stats.telegram_link}
📱 *WhatsApp/SMS/Facebook:* ${stats.short_link}

━━━━━━━━━━━━━━━━━━━━━━━━━━━
*Your Stats*
━━━━━━━━━━━━━━━━━━━━━━━━━━━

• Total referrals: ${stats.total_referrals}
• Completed: ${stats.completed}
• Pending: ${stats.pending}
• Your credit: MK${stats.available_credit.toLocaleString()}
• Total earned: MK${stats.earned_credit.toLocaleString()}

━━━━━━━━━━━━━━━━━━━━━━━━━━━
*Pending Referrals (${stats.pending})*
━━━━━━━━━━━━━━━━━━━━━━━━━━━
${pendingList || '  No pending referrals'}

━━━━━━━━━━━━━━━━━━━━━━━━━━━
*Completed Referrals (${stats.completed})*
━━━━━━━━━━━━━━━━━━━━━━━━━━━
${completedList || '  No completed referrals'}

━━━━━━━━━━━━━━━━━━━━━━━━━━━
*How it works*
━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. Share your link on WhatsApp, Facebook, SMS, or Telegram
2. Friend clicks link (opens EasySuccor bot)
3. Friend gets 10% off first order
4. You get MK2,000 credit when they complete an order
5. Your friend also gets their own referral link to share

*Share now:* ${stats.telegram_link}

Type /referral to see your stats anytime.`;
    
    return message;
  }

  async wasReferred(userId) {
    const client = await db.getClient(userId);
    return !!(client && client.referred_by);
  }

  async getReferrerInfo(userId) {
    const client = await db.getClient(userId);
    if (!client || !client.referred_by) return null;
    
    const referrer = await db.getClientById(client.referred_by);
    return {
      referrer_id: referrer.id,
      referrer_name: referrer.first_name,
      referrer_code: referrer.referral_code
    };
  }
}

module.exports = ReferralTracker;