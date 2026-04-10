// referral-tracker.js - Advanced Multi-Level Referral Program with Analytics (UPDATED)
// Now integrated with 18+ categories and enhanced rewards

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
    this.tierRewards = {
      bronze: { min: 0, max: 4, reward: 2000, bonus: 0 },
      silver: { min: 5, max: 9, reward: 2500, bonus: 5 },
      gold: { min: 10, max: 24, reward: 3000, bonus: 10 },
      platinum: { min: 25, max: 49, reward: 4000, bonus: 15 },
      diamond: { min: 50, max: Infinity, reward: 5000, bonus: 20 }
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

━━━━━━━━━━━━━━━━━━━━━━━━━━━
${ctx.from.first_name} joined using your referral link!
━━━━━━━━━━━━━━━━━━━━━━━━━━━

They will receive 10% off their first order.
You will receive MK2,000 when they complete their first order.

*Your total referrals:* ${await this.getReferralCount(referrer.id)}

Keep sharing to unlock higher rewards! 🚀`,
      { parse_mode: 'Markdown' }
    );
    
    // Log referral for analytics
    await this.logReferralEvent(referrer.id, client.id, 'signup');
    
    return { 
      success: true, 
      referrer_name: referrer.first_name,
      your_referral_code: newUserCode,
      message: `🎉 *Welcome to EasySuccor!*

━━━━━━━━━━━━━━━━━━━━━━━━━━━
You were referred by ${referrer.first_name}!
━━━━━━━━━━━━━━━━━━━━━━━━━━━

As a thank you, you get *10% off* your first order!

*Your referral code:* \`${newUserCode}\`

📱 *Share this link with friends:*
${this.getReferralLink(this.bot.botInfo.username, newUserCode)}

━━━━━━━━━━━━━━━━━━━━━━━━━━━
💰 *What you earn:*
━━━━━━━━━━━━━━━━━━━━━━━━━━━

• MK2,000 per friend who orders
• MK500 from THEIR referrals
• MK250 from third-level referrals

That's *unlimited earning potential!* 🚀

Type /referral to see your stats.
Type /start to begin your CV journey!`
    };
  }

  async completeReferral(referredUserId, orderAmount, orderType = 'cv') {
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
    const rewards = await this.processMultiLevelRewards(client, orderAmount, orderType);
    
    const referrer = await db.getClientById(client.referred_by);
    if (referrer && referrer.telegram_id) {
      const tier = this.getTierFromReferrals(rewards.completed_referrals);
      
      await this.bot.telegram.sendMessage(
        referrer.telegram_id,
        `🎉 *Referral Reward Earned!*

━━━━━━━━━━━━━━━━━━━━━━━━━━━
${client.first_name} completed their first order!
━━━━━━━━━━━━━━━━━━━━━━━━━━━

You have earned *MK${rewards.direct_reward.toLocaleString()}* credit!

💰 Your total credit: MK${(referrer.referral_credit + rewards.direct_reward).toLocaleString()}

${rewards.upgrade_reward > 0 ? `🎁 *Bonus:* MK${rewards.upgrade_reward} added for reaching ${rewards.upgrade_level} referrals!` : ''}
${rewards.tier_changed ? `🏆 *Congratulations!* You've reached ${tier.toUpperCase()} tier! Your reward per referral is now MK${this.tierRewards[tier].reward}!` : ''}

*Next tier:* ${this.getNextTierInfo(rewards.completed_referrals)}

Use your credit on your next order! Type /referral to see your stats.`,
        { parse_mode: 'Markdown' }
      );
    }
    
    // Calculate discount for referred user
    const discountAmount = Math.floor(orderAmount * 0.1);
    
    // Log completion event
    await this.logReferralEvent(client.referred_by, client.id, 'complete', orderAmount);
    
    return { 
      success: true, 
      referrer_credit: rewards.direct_reward,
      referred_discount: discountAmount,
      total_rewards: rewards.total,
      message: `✅ Referral completed! ${referrer.first_name} received MK${rewards.direct_reward} credit.`
    };
  }

  async processMultiLevelRewards(client, orderAmount, orderType = 'cv') {
    let currentUserId = client.referred_by;
    let level = 1;
    let totalRewards = 0;
    let directReward = 0;
    let upgradeReward = 0;
    let upgradeLevel = 0;
    let completedReferrals = 0;
    let tierChanged = false;
    
    while (currentUserId && level <= 3) {
      const referrer = await db.getClientById(currentUserId);
      if (!referrer) break;
      
      // Get referrer's current tier
      const referralCount = await this.getReferralCount(currentUserId);
      const tier = this.getTierFromReferrals(referralCount);
      const baseReward = this.tierRewards[tier].reward;
      const bonusPercent = this.tierRewards[tier].bonus;
      
      // Calculate reward with tier bonus
      let rewardAmount = level === 1 ? baseReward : this.referralLevels[level].reward;
      
      // Add tier bonus for direct referrals
      if (level === 1 && bonusPercent > 0) {
        const bonus = Math.floor(rewardAmount * (bonusPercent / 100));
        rewardAmount += bonus;
      }
      
      await db.addReferralCredit(currentUserId, rewardAmount);
      totalRewards += rewardAmount;
      
      if (level === 1) {
        directReward = rewardAmount;
        completedReferrals = referralCount + 1;
        
        // Check if tier changed
        const oldTier = this.getTierFromReferrals(referralCount);
        const newTier = this.getTierFromReferrals(completedReferrals);
        tierChanged = oldTier !== newTier;
      }
      
      // Check for milestone bonus
      if (referralCount + 1 === 5 || referralCount + 1 === 10 || referralCount + 1 === 25 || referralCount + 1 === 50) {
        const bonusAmount = referralCount + 1 === 5 ? 1000 : 
                           referralCount + 1 === 10 ? 2500 : 
                           referralCount + 1 === 25 ? 5000 : 10000;
        await db.addReferralCredit(currentUserId, bonusAmount);
        upgradeReward = bonusAmount;
        upgradeLevel = referralCount + 1;
        totalRewards += bonusAmount;
      }
      
      // Get next level referrer
      const nextReferral = await db.getReferrerOfReferrer(currentUserId);
      currentUserId = nextReferral ? nextReferral.referred_by : null;
      level++;
    }
    
    return {
      direct_reward: directReward,
      upgrade_reward: upgradeReward,
      upgrade_level: upgradeLevel,
      completed_referrals: completedReferrals,
      tier_changed: tierChanged,
      total: totalRewards
    };
  }

  getTierFromReferrals(count) {
    for (const [tier, data] of Object.entries(this.tierRewards)) {
      if (count >= data.min && count <= data.max) {
        return tier;
      }
    }
    return 'bronze';
  }

  getNextTierInfo(currentCount) {
    for (const [tier, data] of Object.entries(this.tierRewards)) {
      if (currentCount < data.min) {
        const needed = data.min - currentCount;
        return `Need ${needed} more referral${needed > 1 ? 's' : ''} for ${tier.toUpperCase()} tier`;
      }
    }
    return '🎉 Maximum tier reached!';
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
    
    const tier = this.getTierFromReferrals(completedReferrals.length);
    const tierData = this.tierRewards[tier];
    
    // Calculate earned credit
    let earnedFromReferrals = 0;
    for (const ref of completedReferrals) {
      earnedFromReferrals += tierData.reward;
    }
    
    // Get multi-level stats
    const secondLevelRefs = await this.getSecondLevelReferrals(client.id);
    const thirdLevelRefs = await this.getThirdLevelReferrals(client.id);
    
    const stats = {
      referral_code: client.referral_code,
      tier: tier,
      tier_reward: tierData.reward,
      tier_bonus: tierData.bonus,
      total_referrals: referrals.length,
      completed: completedReferrals.length,
      pending: pendingReferrals.length,
      second_level_refs: secondLevelRefs.length,
      third_level_refs: thirdLevelRefs.length,
      next_tier_info: this.getNextTierInfo(completedReferrals.length),
      earned_credit: (client.referral_credit || 0) + earnedFromReferrals,
      available_credit: client.referral_credit || 0,
      telegram_link: this.getReferralLink(this.bot.botInfo.username, client.referral_code),
      short_link: this.getShortReferralLink(this.bot.botInfo.username, client.referral_code),
      referrals_list: referrals.map(r => ({
        name: r.referred_name,
        status: r.status,
        date: r.created_at,
        completed_date: r.completed_at,
        level: r.level || 1
      })),
      monthly_stats: await this.getMonthlyReferralStats(client.id),
      top_referrers: await this.getTopReferrers(10)
    };
    
    this.cache.set(`stats_${userId}`, { data: stats, timestamp: Date.now() });
    return stats;
  }

  async getSecondLevelReferrals(userId) {
    const directRefs = await db.getUserReferrals(userId);
    let secondLevel = [];
    for (const ref of directRefs) {
      const refClient = await db.getClientByName(ref.referred_name);
      if (refClient) {
        const theirRefs = await db.getUserReferrals(refClient.id);
        secondLevel.push(...theirRefs.map(r => ({ ...r, level: 2, via: ref.referred_name })));
      }
    }
    return secondLevel;
  }

  async getThirdLevelReferrals(userId) {
    const secondLevel = await this.getSecondLevelReferrals(userId);
    let thirdLevel = [];
    for (const ref of secondLevel) {
      const refClient = await db.getClientByName(ref.referred_name);
      if (refClient) {
        const theirRefs = await db.getUserReferrals(refClient.id);
        thirdLevel.push(...theirRefs.map(r => ({ ...r, level: 3, via: ref.referred_name })));
      }
    }
    return thirdLevel;
  }

  async getMonthlyReferralStats(userId) {
    const referrals = await db.getUserReferrals(userId);
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    
    const monthlyData = {};
    for (let i = 0; i < 6; i++) {
      const date = new Date(currentYear, currentMonth - i, 1);
      const monthKey = `${date.toLocaleString('default', { month: 'short' })} ${date.getFullYear()}`;
      monthlyData[monthKey] = referrals.filter(r => {
        const rDate = new Date(r.created_at);
        return rDate.getMonth() === date.getMonth() && rDate.getFullYear() === date.getFullYear();
      }).length;
    }
    
    return monthlyData;
  }

  async getTopReferrers(limit = 10) {
    const clients = await db.getAllClients();
    const referrersWithStats = [];
    
    for (const client of clients) {
      const refs = await db.getUserReferrals(client.id);
      const completed = refs.filter(r => r.status === 'completed').length;
      if (completed > 0) {
        referrersWithStats.push({
          name: client.first_name,
          referrals: completed,
          tier: this.getTierFromReferrals(completed)
        });
      }
    }
    
    return referrersWithStats
      .sort((a, b) => b.referrals - a.referrals)
      .slice(0, limit);
  }

  async getReferralCount(userId) {
    const client = await db.getClient(userId);
    if (!client) return 0;
    const referrals = await db.getUserReferrals(client.id);
    return referrals.filter(r => r.status === 'completed').length;
  }

  async logReferralEvent(referrerId, referredId, event, orderAmount = 0) {
    const eventData = {
      referrer_id: referrerId,
      referred_id: referredId,
      event: event,
      order_amount: orderAmount,
      timestamp: new Date().toISOString()
    };
    
    await db.logReferralEvent(eventData);
  }

  formatReferralStats(stats) {
    let pendingList = '';
    let completedList = '';
    
    if (stats.pending > 0) {
      pendingList = stats.referrals_list
        .filter(r => r.status === 'pending')
        .slice(0, 10)
        .map(r => `  • ${r.name} - Joined ${new Date(r.date).toLocaleDateString()}`)
        .join('\n');
    }
    
    if (stats.completed > 0) {
      completedList = stats.referrals_list
        .filter(r => r.status === 'completed')
        .slice(0, 10)
        .map(r => `  • ${r.name} - Completed ${new Date(r.completed_date).toLocaleDateString()}`)
        .join('\n');
    }
    
    let monthlyChart = '';
    if (stats.monthly_stats) {
      monthlyChart = '\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n*📊 Monthly Performance*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';
      for (const [month, count] of Object.entries(stats.monthly_stats)) {
        const bar = '█'.repeat(Math.min(count, 15));
        const empty = '░'.repeat(15 - Math.min(count, 15));
        monthlyChart += `  ${month}: ${bar}${empty} ${count}\n`;
      }
    }
    
    let topReferrersList = '';
    if (stats.top_referrers && stats.top_referrers.length > 0) {
      topReferrersList = '\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n*🏆 Top Referrers*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';
      stats.top_referrers.slice(0, 5).forEach((r, i) => {
        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
        topReferrersList += `  ${medal} ${r.name} - ${r.referrals} referrals (${r.tier})\n`;
      });
    }
    
    const tierEmoji = {
      bronze: '🥉',
      silver: '🥈',
      gold: '🥇',
      platinum: '💎',
      diamond: '👑'
    };
    
    let message = `🎁 *Your Referral Program* ${tierEmoji[stats.tier] || '🎁'}

━━━━━━━━━━━━━━━━━━━━━━━━━━━
*${stats.tier.toUpperCase()} TIER*
━━━━━━━━━━━━━━━━━━━━━━━━━━━

Your code: \`${stats.referral_code}\`
Reward per referral: *MK${stats.tier_reward.toLocaleString()}*
Tier bonus: ${stats.tier_bonus}%

━━━━━━━━━━━━━━━━━━━━━━━━━━━
*📱 Share this link ANYWHERE*
━━━━━━━━━━━━━━━━━━━━━━━━━━━

Telegram: ${stats.telegram_link}
Short link: ${stats.short_link}

━━━━━━━━━━━━━━━━━━━━━━━━━━━
*📊 Your Network Stats*
━━━━━━━━━━━━━━━━━━━━━━━━━━━

• Direct referrals: ${stats.completed} completed, ${stats.pending} pending
• Level 2 referrals: ${stats.second_level_refs}
• Level 3 referrals: ${stats.third_level_refs}
• Total network: ${stats.completed + stats.second_level_refs + stats.third_level_refs}

• Available credit: MK${stats.available_credit.toLocaleString()}
• Total earned: MK${stats.earned_credit.toLocaleString()}

• ${stats.next_tier_info}

${monthlyChart}
${topReferrersList}
━━━━━━━━━━━━━━━━━━━━━━━━━━━
*⏳ Pending (${stats.pending})*
━━━━━━━━━━━━━━━━━━━━━━━━━━━
${pendingList || '  No pending referrals'}

━━━━━━━━━━━━━━━━━━━━━━━━━━━
*✅ Completed (${stats.completed})*
━━━━━━━━━━━━━━━━━━━━━━━━━━━
${completedList || '  No completed referrals yet'}

━━━━━━━━━━━━━━━━━━━━━━━━━━━
*💰 Reward Tiers*
━━━━━━━━━━━━━━━━━━━━━━━━━━━

🥉 Bronze (0-4): MK2,000/ref
🥈 Silver (5-9): MK2,500/ref + 5% bonus
🥇 Gold (10-24): MK3,000/ref + 10% bonus
💎 Platinum (25-49): MK4,000/ref + 15% bonus
👑 Diamond (50+): MK5,000/ref + 20% bonus

━━━━━━━━━━━━━━━━━━━━━━━━━━━
*💡 Pro Tips*
━━━━━━━━━━━━━━━━━━━━━━━━━━━

• Share on WhatsApp, Facebook, LinkedIn
• Tell friends about our 18+ category CVs
• Mention the 10% discount for new users
• Your credit never expires!

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

  clearCache(userId) {
    this.cache.delete(`stats_${userId}`);
  }

  clearAllCache() {
    this.cache.clear();
  }
}

module.exports = ReferralTracker;