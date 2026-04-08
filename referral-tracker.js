// referral-tracker.js - Advanced Multi-Level Referral Program with Analytics
const db = require('./database');
const notificationService = require('./notification-service');

class ReferralTracker {
  constructor(bot) {
    this.bot = bot;
    this.referralLevels = {
      1: { reward: 2000, discount: 10 },  // Direct referral
      2: { reward: 500, discount: 5 },    // Second level
      3: { reward: 250, discount: 3 }     // Third level
    };
    this.cache = new Map();
    this.cacheTimeout = 3600000; // 1 hour
  }

  generateReferralCode(userId, username) {
    const timestamp = Date.now().toString(36).slice(-4);
    const userPart = username ? username.substring(0, 4) : `user${userId.toString().slice(-4)}`;
    const code = `${userPart}${timestamp}`.toUpperCase();
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
    
    if (newUser && newUser.referred_by) {
      return { success: false, error: "You were already referred by someone" };
    }
    
    if (referrer.telegram_id === ctx.from.id) {
      return { success: false, error: "You cannot refer yourself" };
    }
    
    // Create or update user with referral
    let client;
    if (!newUser) {
      client = await db.createClient(ctx.from.id, ctx.from.username, ctx.from.first_name, ctx.from.last_name);
    } else {
      client = newUser;
    }
    
    await db.recordReferral(referrer.id, client.id, referralCode);
    
    // Generate referral code for new user
    const newUserCode = this.generateReferralCode(client.id, ctx.from.username);
    await db.updateClient(client.id, { referral_code: newUserCode });
    
    // Send notification to referrer
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
    
    // Calculate rewards for multi-level
    const rewards = await this.processMultiLevelRewards(client, orderAmount);
    
    const referrer = await db.getClientById(client.referred_by);
    if (referrer && referrer.telegram_id) {
      await this.bot.telegram.sendMessage(
        referrer.telegram_id,
        `🎉 *Referral Reward Earned!*

${client.first_name} completed their first order!

You have earned MK${rewards.direct_reward.toLocaleString()} credit!

Your total credit: MK${(referrer.referral_credit + rewards.direct_reward).toLocaleString()}

${rewards.upgrade_reward > 0 ? `🎁 Bonus: MK${rewards.upgrade_reward} added for your ${rewards.upgrade_level}th referral!` : ''}

Use your credit on your next order!`,
        { parse_mode: 'Markdown' }
      );
    }
    
    const discountAmount = Math.floor(orderAmount * 0.1);
    
    return { 
      success: true, 
      referrer_credit: rewards.direct_reward,
      referred_discount: discountAmount,
      total_rewards: rewards.total,
      message: `✅ Referral completed! ${referrer.first_name} received MK${rewards.direct_reward} credit.`
    };
  }

  async processMultiLevelRewards(client, orderAmount) {
    let currentUserId = client.referred_by;
    let level = 1;
    let totalRewards = 0;
    let directReward = 0;
    let upgradeReward = 0;
    let upgradeLevel = 0;
    
    while (currentUserId && level <= 3) {
      const referrer = await db.getClientById(currentUserId);
      if (!referrer) break;
      
      const rewardAmount = this.referralLevels[level].reward;
      await db.addReferralCredit(currentUserId, rewardAmount);
      totalRewards += rewardAmount;
      
      if (level === 1) directReward = rewardAmount;
      
      // Check for milestone bonus (5th, 10th, 25th referral)
      const referralCount = await this.getReferralCount(currentUserId);
      if (referralCount === 5 || referralCount === 10 || referralCount === 25) {
        const bonusAmount = referralCount === 5 ? 1000 : referralCount === 10 ? 2500 : 5000;
        await db.addReferralCredit(currentUserId, bonusAmount);
        upgradeReward = bonusAmount;
        upgradeLevel = referralCount;
        totalRewards += bonusAmount;
      }
      
      // Get next level referrer
      const nextReferral = await db.getPendingReferral(currentUserId, null);
      currentUserId = nextReferral ? nextReferral.referrer_id : null;
      level++;
    }
    
    return {
      direct_reward: directReward,
      upgrade_reward: upgradeReward,
      upgrade_level: upgradeLevel,
      total: totalRewards
    };
  }

  async getReferralStats(userId) {
    // Check cache
    const cached = this.cache.get(`stats_${userId}`);
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.data;
    }
    
    const client = await db.getClient(userId);
    
    if (!client) return null;
    
    const referrals = await db.getUserReferrals(client.id);
    const completedReferrals = referrals.filter(r => r.status === 'completed');
    const pendingReferrals = referrals.filter(r => r.status === 'pending');
    
    const REFERRAL_REWARD = process.env.REFERRAL_REWARD || 2000;
    const earnedFromReferrals = completedReferrals.length * REFERRAL_REWARD;
    
    // Calculate tier
    let tier = 'Bronze';
    let nextTierReferrals = 5;
    if (completedReferrals.length >= 25) {
      tier = 'Platinum';
      nextTierReferrals = 0;
    } else if (completedReferrals.length >= 10) {
      tier = 'Gold';
      nextTierReferrals = 15;
    } else if (completedReferrals.length >= 5) {
      tier = 'Silver';
      nextTierReferrals = 5;
    }
    
    const stats = {
      referral_code: client.referral_code,
      tier: tier,
      total_referrals: referrals.length,
      completed: completedReferrals.length,
      pending: pendingReferrals.length,
      needed_for_next_tier: nextTierReferrals,
      earned_credit: (client.referral_credit || 0) + earnedFromReferrals,
      available_credit: client.referral_credit || 0,
      telegram_link: this.getReferralLink(this.bot.botInfo.username, client.referral_code),
      short_link: this.getShortReferralLink(this.bot.botInfo.username, client.referral_code),
      referrals_list: referrals.map(r => ({
        name: r.referred_name,
        status: r.status,
        date: r.created_at,
        completed_date: r.completed_at
      })),
      monthly_stats: await this.getMonthlyReferralStats(client.id)
    };
    
    this.cache.set(`stats_${userId}`, { data: stats, timestamp: Date.now() });
    return stats;
  }

  async getMonthlyReferralStats(userId) {
    const referrals = await db.getUserReferrals(userId);
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    
    const monthlyData = {};
    for (let i = 0; i < 6; i++) {
      const date = new Date(currentYear, currentMonth - i, 1);
      const monthKey = `${date.getFullYear()}-${date.getMonth() + 1}`;
      monthlyData[monthKey] = referrals.filter(r => {
        const rDate = new Date(r.created_at);
        return rDate.getMonth() === date.getMonth() && rDate.getFullYear() === date.getFullYear();
      }).length;
    }
    
    return monthlyData;
  }

  async getReferralCount(userId) {
    const client = await db.getClient(userId);
    if (!client) return 0;
    const referrals = await db.getUserReferrals(client.id);
    return referrals.filter(r => r.status === 'completed').length;
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
    
    let monthlyChart = '';
    if (stats.monthly_stats) {
      monthlyChart = '\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n*Monthly Performance*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';
      for (const [month, count] of Object.entries(stats.monthly_stats)) {
        const bar = '█'.repeat(Math.min(count, 10));
        monthlyChart += `  ${month}: ${bar} ${count}\n`;
      }
    }
    
    let message = `🎁 *Your Referral Program - ${stats.tier} Tier*

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
• ${stats.needed_for_next_tier > 0 ? `Need ${stats.needed_for_next_tier} more for ${stats.tier === 'Silver' ? 'Gold' : stats.tier === 'Gold' ? 'Platinum' : 'Next'} tier` : '🎉 Maximum tier reached!'}
• Your credit: MK${stats.available_credit.toLocaleString()}
• Total earned: MK${stats.earned_credit.toLocaleString()}

${monthlyChart}
━━━━━━━━━━━━━━━━━━━━━━━━━━━
*Pending Referrals (${stats.pending})*
━━━━━━━━━━━━━━━━━━━━━━━━━━━
${pendingList || '  No pending referrals'}

━━━━━━━━━━━━━━━━━━━━━━━━━━━
*Completed Referrals (${stats.completed})*
━━━━━━━━━━━━━━━━━━━━━━━━━━━
${completedList || '  No completed referrals'}

━━━━━━━━━━━━━━━━━━━━━━━━━━━
*Reward Tiers*
━━━━━━━━━━━━━━━━━━━━━━━━━━━

Bronze (0-4): MK2,000/referral
Silver (5-9): MK2,500/referral + 5% bonus
Gold (10-24): MK3,000/referral + 10% bonus
Platinum (25+): MK4,000/referral + 15% bonus

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