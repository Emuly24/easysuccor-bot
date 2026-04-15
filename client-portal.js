// client-portal.js - Enterprise Client Portal for Telegram (UPDATED)
// Now integrated with 18+ categories, Installments, and Pay Later

const db = require('./database');
const notificationService = require('./notification-service');

// Mobile-friendly separator
const SEP = '\n┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅\n';

class ClientPortal {
  constructor(bot) {
    this.bot = bot;
    this.sessionCache = new Map();
  }

  async showPortal(ctx, client) {
    const orders = await db.getClientOrders(client.id);
    const lastOrder = orders[0];
    const referralStats = await this.getReferralStats(client.id);
    const stats = await this.getClientStats(client.id);
    const paymentSummary = await this.getPaymentSummary(client.id);
    const cvCompleteness = await this.getCVCompleteness(client.id);
    
    let portalMessage = `🏢 *EASYSUCCOR CLIENT PORTAL*

${SEP}
👤 *ACCOUNT INFORMATION*
${SEP}

• Name: ${client.first_name} ${client.last_name || ''}
• Phone: ${client.phone || '❌ Not set'}
• Email: ${client.email || '❌ Not set'}
• Location: ${client.location || '❌ Not set'}
• Member since: ${new Date(client.created_at).toLocaleDateString()}

${SEP}
📊 *YOUR STATISTICS*
${SEP}

• Total orders: ${stats.total_orders}
• Completed: ${stats.completed_orders}
• Pending: ${stats.pending_orders}
• Total spent: ${stats.total_spent}
• CV Completeness: ${cvCompleteness}%

${SEP}
💳 *PAYMENT SUMMARY*
${SEP}

• Active Installments: ${paymentSummary.active_installments}
• Pay Later Active: ${paymentSummary.active_pay_later}
• Pending Payments: ${paymentSummary.pending_payments}
• Available Credit: ${paymentSummary.available_credit}

${SEP}
🎁 *REFERRAL PROGRAM*
${SEP}

• Your code: \`${referralStats.referral_code}\`
• Tier: ${referralStats.tier}
• Friends joined: ${referralStats.total_referrals}
• Network size: ${referralStats.network_size}
• Your credit: MK${(referralStats.available_credit || 0).toLocaleString()}

${SEP}
📄 *RECENT DOCUMENTS*
${SEP}`;

    if (orders.length > 0) {
      portalMessage += orders.slice(0, 3).map((o, i) => {
        const statusIcon = this.getStatusIcon(o.status);
        const paymentType = o.payment_type ? `[${o.payment_type}]` : '';
        return `\n${i + 1}. ${statusIcon} *${o.service}* ${paymentType}
   📅 ${new Date(o.created_at).toLocaleDateString()}
   💰 ${o.total_charge} | Status: ${o.status}`;
      }).join('');
    } else {
      portalMessage += `\nNo documents yet. Start your first order with /start`;
    }
    
    portalMessage += `\n\n${SEP}
⚙️ *QUICK ACTIONS*
${SEP}

/mydocs - View all documents
/mypayments - Payment history & status
/myprofile - Update contact info
/referral - Share & earn
/feedback - Rate your experience
/support - Contact support

*Payment Methods Accepted:*
• Airtel Money: 0991295401
• TNM Mpamba: 0886928639
• MO626 Bank: 1005653618

Need help? Type /help anytime.`;

    const keyboard = {
      inline_keyboard: [
        [
          { text: "📄 My Documents", callback_data: "portal_docs" },
          { text: "💳 Payments", callback_data: "portal_payments" }
        ],
        [
          { text: "👤 Edit Profile", callback_data: "portal_profile" },
          { text: "🎁 Referral", callback_data: "portal_referral" }
        ],
        [
          { text: "📊 CV Completeness", callback_data: "portal_cv_status" },
          { text: "🆘 Support", callback_data: "portal_support" }
        ]
      ]
    };

    await ctx.reply(portalMessage, { 
      parse_mode: 'Markdown',
      reply_markup: keyboard
    });
  }

  getStatusIcon(status) {
    const icons = {
      'pending': '⏳',
      'paid': '💰',
      'processing': '⚙️',
      'review': '📝',
      'delivered': '✅',
      'completed': '✅',
      'cancelled': '❌'
    };
    return icons[status] || '📄';
  }

  async getClientStats(clientId) {
    const orders = await db.getClientOrders(clientId);
    const completedOrders = orders.filter(o => 
      o.status === 'delivered' || 
      o.status === 'completed' || 
      o.payment_status === 'completed'
    );
    const pendingOrders = orders.filter(o => 
      o.status === 'pending' || 
      o.payment_status === 'pending'
    );
    
    const totalSpent = completedOrders.reduce((sum, o) => {
      const amount = parseInt(String(o.total_charge).replace(/[^0-9]/g, '') || 0);
      return sum + amount;
    }, 0);
    
    const avgOrderValue = completedOrders.length > 0 
      ? Math.round(totalSpent / completedOrders.length) 
      : 0;
    
    return {
      total_orders: orders.length,
      completed_orders: completedOrders.length,
      pending_orders: pendingOrders.length,
      total_spent: `MK${totalSpent.toLocaleString()}`,
      avg_order_value: `MK${avgOrderValue.toLocaleString()}`,
      lifetime_value: `MK${totalSpent.toLocaleString()}`
    };
  }

  async getPaymentSummary(clientId) {
    const orders = await db.getClientOrders(clientId);
    
    const activeInstallments = orders.filter(o => 
      o.payment_type === 'installment' && 
      o.installment_status === 'active'
    ).length;
    
    const activePayLater = orders.filter(o => 
      o.payment_type === 'pay_later' && 
      o.pay_later_status === 'pending'
    ).length;
    
    const pendingPayments = orders.filter(o => 
      o.payment_status === 'pending' && 
      o.status !== 'cancelled'
    ).length;
    
    const client = await db.getClient(clientId);
    const availableCredit = client?.referral_credit || 0;
    
    return {
      active_installments: activeInstallments,
      active_pay_later: activePayLater,
      pending_payments: pendingPayments,
      available_credit: `MK${availableCredit.toLocaleString()}`
    };
  }

  async getCVCompleteness(clientId) {
    const orders = await db.getClientOrders(clientId);
    const lastCVOrder = orders.find(o => 
      o.service?.includes('cv') && o.cv_data
    );
    
    if (!lastCVOrder || !lastCVOrder.cv_data) {
      return 0;
    }
    
    const cvData = lastCVOrder.cv_data;
    let score = 0;
    let total = 0;
    
    const personalFields = ['full_name', 'email', 'primary_phone', 'location'];
    total += personalFields.length;
    personalFields.forEach(f => { if (cvData.personal?.[f]) score++; });
    
    total += 1;
    if (cvData.professional_summary) score++;
    
    total += 1;
    if (cvData.employment?.length > 0) score++;
    
    total += 1;
    if (cvData.education?.length > 0) score++;
    
    total += 1;
    const skills = cvData.skills || {};
    const totalSkills = (skills.technical?.length || 0) + (skills.soft?.length || 0) + (skills.tools?.length || 0);
    if (totalSkills > 3) score++;
    
    const categories = ['certifications', 'languages', 'projects', 'achievements', 
                       'volunteer', 'leadership', 'awards', 'publications', 
                       'conferences', 'referees'];
    categories.forEach(cat => {
      total += 1;
      if (cvData[cat]?.length > 0) score++;
    });
    
    return Math.round((score / total) * 100);
  }

  async getReferralStats(clientId) {
    const client = await db.getClient(clientId);
    if (!client) return { referral_code: 'N/A', tier: 'Bronze', total_referrals: 0 };
    
    const referrals = await db.getUserReferrals(client.id);
    const completedRefs = referrals.filter(r => r.status === 'completed').length;
    
    const secondLevel = await this.getSecondLevelCount(client.id);
    const thirdLevel = await this.getThirdLevelCount(client.id);
    
    const tier = this.getTierFromReferrals(completedRefs);
    
    return {
      referral_code: client.referral_code || 'N/A',
      tier: tier,
      total_referrals: referrals.length,
      completed_referrals: completedRefs,
      pending_referrals: referrals.filter(r => r.status === 'pending').length,
      network_size: completedRefs + secondLevel + thirdLevel,
      available_credit: client.referral_credit || 0
    };
  }

  async getSecondLevelCount(userId) {
    const directRefs = await db.getUserReferrals(userId);
    let count = 0;
    for (const ref of directRefs) {
      const refClient = await db.getClientByName(ref.referred_name);
      if (refClient) {
        const theirRefs = await db.getUserReferrals(refClient.id);
        count += theirRefs.filter(r => r.status === 'completed').length;
      }
    }
    return count;
  }

  async getThirdLevelCount(userId) {
    const directRefs = await db.getUserReferrals(userId);
    let count = 0;
    for (const ref of directRefs) {
      const refClient = await db.getClientByName(ref.referred_name);
      if (refClient) {
        const theirRefs = await db.getUserReferrals(refClient.id);
        for (const ref2 of theirRefs) {
          const ref2Client = await db.getClientByName(ref2.referred_name);
          if (ref2Client) {
            const theirRefs2 = await db.getUserReferrals(ref2Client.id);
            count += theirRefs2.filter(r => r.status === 'completed').length;
          }
        }
      }
    }
    return count;
  }

  getTierFromReferrals(count) {
    if (count >= 50) return '👑 Diamond';
    if (count >= 25) return '💎 Platinum';
    if (count >= 10) return '🥇 Gold';
    if (count >= 5) return '🥈 Silver';
    return '🥉 Bronze';
  }

  async showDocuments(ctx, client) {
    const orders = await db.getClientOrders(client.id);
    if (orders.length === 0) {
      await ctx.reply("📭 *No Documents Found*\n\nYou haven't created any documents yet.\n\nType /start to create your first CV!", { 
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[
            { text: "📝 Create New CV", callback_data: "start_new_cv" }
          ]]
        }
      });
      return;
    }
    
    let message = `📁 *YOUR DOCUMENT ARCHIVE*\n\n`;
    message += `${SEP}\n`;
    
    const active = orders.filter(o => o.status !== 'completed' && o.status !== 'cancelled');
    const completed = orders.filter(o => o.status === 'completed' || o.status === 'delivered');
    const cancelled = orders.filter(o => o.status === 'cancelled');
    
    if (active.length > 0) {
      message += `⏳ *ACTIVE ORDERS*\n`;
      message += `${SEP}\n`;
      for (const order of active) {
        message += this.formatOrderSummary(order);
      }
      message += `\n`;
    }
    
    if (completed.length > 0) {
      message += `✅ *COMPLETED DOCUMENTS*\n`;
      message += `${SEP}\n`;
      for (const order of completed.slice(0, 5)) {
        message += this.formatOrderSummary(order);
      }
      if (completed.length > 5) {
        message += `\n... and ${completed.length - 5} more documents\n`;
      }
    }
    
    message += `\n${SEP}\n`;
    message += `To request a new document, type /start`;
    
    const keyboard = {
      inline_keyboard: [
        [{ text: "📝 Create New CV", callback_data: "start_new_cv" }],
        [{ text: "💌 New Cover Letter", callback_data: "start_cover_letter" }],
        [{ text: "🔙 Back to Portal", callback_data: "portal_back" }]
      ]
    };
    
    await ctx.reply(message, { 
      parse_mode: 'Markdown',
      reply_markup: keyboard
    });
  }

  formatOrderSummary(order) {
    const statusIcon = this.getStatusIcon(order.status);
    const paymentType = order.payment_type ? ` [${order.payment_type.replace('_', ' ')}]` : '';
    const cvDataStatus = order.cv_data ? '✅' : '⏳';
    
    let summary = `\n${statusIcon} *${order.service}*${paymentType}\n`;
    summary += `   🆔 Order: \`${order.id}\`\n`;
    summary += `   📅 Date: ${new Date(order.created_at).toLocaleDateString()}\n`;
    summary += `   💰 Total: ${order.total_charge}\n`;
    summary += `   📊 Status: ${order.status}\n`;
    summary += `   📋 CV Data: ${cvDataStatus} ${order.cv_data ? '(18+ categories)' : '(Not started)'}\n`;
    
    if (order.delivered_at) {
      summary += `   📬 Delivered: ${new Date(order.delivered_at).toLocaleDateString()}\n`;
    }
    
    if (order.payment_type === 'installment' && order.installment_data) {
      const inst = order.installment_data;
      summary += `   💳 Installment: ${inst.current_installment}/2 (MK${inst.remaining_amount} remaining)\n`;
    }
    
    if (order.payment_type === 'pay_later' && order.pay_later_data) {
      const pl = order.pay_later_data;
      const dueDate = new Date(pl.due_date);
      const daysLeft = Math.ceil((dueDate - new Date()) / (1000 * 60 * 60 * 24));
      summary += `   ⏰ Pay Later: ${daysLeft > 0 ? `${daysLeft} days left` : 'OVERDUE'}\n`;
    }
    
    return summary;
  }

  async showPayments(ctx, client) {
    const orders = await db.getClientOrders(client.id);
    const paymentSummary = await this.getPaymentSummary(client.id);
    const referralCredit = client.referral_credit || 0;
    
    let message = `💳 *PAYMENT CENTER*\n\n`;
    message += `${SEP}\n`;
    message += `📊 *SUMMARY*\n`;
    message += `${SEP}\n\n`;
    message += `• Active Installments: ${paymentSummary.active_installments}\n`;
    message += `• Pay Later Active: ${paymentSummary.active_pay_later}\n`;
    message += `• Pending Payments: ${paymentSummary.pending_payments}\n`;
    message += `• Referral Credit: MK${referralCredit.toLocaleString()}\n\n`;
    
    message += `${SEP}\n`;
    message += `💳 *PAYMENT METHODS*\n`;
    message += `${SEP}\n\n`;
    message += `• Airtel Money: 0991295401\n`;
    message += `• TNM Mpamba: 0886928639\n`;
    message += `• MO626 Bank: 1005653618\n\n`;
    
    const pendingOrders = orders.filter(o => 
      o.payment_status === 'pending' && 
      o.status !== 'cancelled'
    );
    
    if (pendingOrders.length > 0) {
      message += `${SEP}\n`;
      message += `⏳ *PENDING PAYMENTS*\n`;
      message += `${SEP}\n\n`;
      for (const order of pendingOrders.slice(0, 5)) {
        message += `• Order: \`${order.id}\`\n`;
        message += `  Amount: ${order.total_charge}\n`;
        message += `  Type: ${order.payment_type || 'Standard'}\n`;
        message += `  Due: ${order.due_date || 'Upon order'}\n\n`;
      }
      message += `\nTo make a payment, type /pay\n`;
    }
    
    const installmentOrders = orders.filter(o => 
      o.payment_type === 'installment' && 
      o.installment_status === 'active'
    );
    
    if (installmentOrders.length > 0) {
      message += `${SEP}\n`;
      message += `💰 *ACTIVE INSTALLMENTS*\n`;
      message += `${SEP}\n\n`;
      for (const order of installmentOrders) {
        const inst = order.installment_data || {};
        message += `• Order: \`${order.id}\`\n`;
        message += `  Progress: ${inst.current_installment || 1}/2\n`;
        message += `  Next Payment: MK${inst.next_payment || inst.remaining_amount || 0}\n`;
        message += `  Due: ${inst.next_due_date || 'TBD'}\n\n`;
      }
    }
    
    const keyboard = {
      inline_keyboard: [
        [{ text: "💰 Make Payment", callback_data: "portal_pay" }],
        [{ text: "📋 Payment History", callback_data: "portal_payment_history" }],
        [{ text: "🔙 Back to Portal", callback_data: "portal_back" }]
      ]
    };
    
    await ctx.reply(message, { 
      parse_mode: 'Markdown',
      reply_markup: keyboard
    });
  }

  async showProfile(ctx, client) {
    const cvCompleteness = await this.getCVCompleteness(client.id);
    const orders = await db.getClientOrders(client.id);
    const lastOrder = orders[0];
    
    let message = `👤 *PROFILE SETTINGS*\n\n`;
    message += `${SEP}\n`;
    message += `📋 *CONTACT INFORMATION*\n`;
    message += `${SEP}\n\n`;
    message += `• Name: ${client.first_name} ${client.last_name || ''}\n`;
    message += `• Phone: ${client.phone || '❌ Not set'}\n`;
    message += `• Alternative Phone: ${client.alternative_phone || '❌ Not set'}\n`;
    message += `• Email: ${client.email || '❌ Not set'}\n`;
    message += `• Location: ${client.location || '❌ Not set'}\n`;
    message += `• Physical Address: ${client.physical_address || '❌ Not set'}\n`;
    message += `• Nationality: ${client.nationality || '❌ Not set'}\n\n`;
    
    message += `${SEP}\n`;
    message += `📊 *PROFILE STATS*\n`;
    message += `${SEP}\n\n`;
    message += `• CV Completeness: ${cvCompleteness}%\n`;
    message += `• Total Orders: ${orders.length}\n`;
    message += `• Member Since: ${new Date(client.created_at).toLocaleDateString()}\n`;
    message += `• Last Activity: ${lastOrder ? new Date(lastOrder.created_at).toLocaleDateString() : 'Never'}\n\n`;
    
    message += `${SEP}\n`;
    message += `✏️ *UPDATE OPTIONS*\n`;
    message += `${SEP}`;
    
    const keyboard = {
      inline_keyboard: [
        [
          { text: "📞 Phone", callback_data: "update_phone" },
          { text: "📧 Email", callback_data: "update_email" }
        ],
        [
          { text: "📍 Location", callback_data: "update_location" },
          { text: "🏠 Address", callback_data: "update_address" }
        ],
        [
          { text: "🌍 Nationality", callback_data: "update_nationality" },
          { text: "📱 Alt Phone", callback_data: "update_alt_phone" }
        ],
        [
          { text: "💳 Payment Methods", callback_data: "portal_payments" },
          { text: "🔙 Back", callback_data: "portal_back" }
        ]
      ]
    };
    
    await ctx.reply(message, { 
      parse_mode: 'Markdown',
      reply_markup: keyboard
    });
  }

  async showCVStatus(ctx, client) {
    const orders = await db.getClientOrders(client.id);
    const lastCVOrder = orders.find(o => o.service?.includes('cv') && o.cv_data);
    
    if (!lastCVOrder || !lastCVOrder.cv_data) {
      await ctx.reply("📋 *CV Status*\n\nYou haven't created a CV yet.\n\nType /start to create your first CV with 18+ professional categories!", {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[
            { text: "📝 Create CV Now", callback_data: "start_new_cv" }
          ]]
        }
      });
      return;
    }
    
    const cvData = lastCVOrder.cv_data;
    const completeness = await this.getCVCompleteness(client.id);
    
    let message = `📊 *CV COMPLETENESS REPORT*\n\n`;
    message += `${SEP}\n`;
    message += `Overall Score: ${completeness}%\n`;
    message += `${SEP}\n\n`;
    
    const personal = cvData.personal || {};
    message += `👤 *Personal Info* ${personal.full_name ? '✅' : '❌'}\n`;
    message += `   • Name: ${personal.full_name || 'Missing'}\n`;
    message += `   • Email: ${personal.email || 'Missing'}\n`;
    message += `   • Phone: ${personal.primary_phone || 'Missing'}\n`;
    message += `   • Location: ${personal.location || 'Missing'}\n\n`;
    
    message += `📝 *Professional Summary* ${cvData.professional_summary ? '✅' : '❌'}\n\n`;
    
    const employment = cvData.employment || [];
    message += `💼 *Employment* ${employment.length > 0 ? '✅' : '❌'}\n`;
    message += `   • ${employment.length} position(s) recorded\n\n`;
    
    const education = cvData.education || [];
    message += `🎓 *Education* ${education.length > 0 ? '✅' : '❌'}\n`;
    message += `   • ${education.length} qualification(s) recorded\n\n`;
    
    const skills = cvData.skills || {};
    const techSkills = skills.technical || [];
    const softSkills = skills.soft || [];
    const toolsSkills = skills.tools || [];
    const totalSkills = techSkills.length + softSkills.length + toolsSkills.length;
    message += `⚡ *Skills* ${totalSkills > 0 ? '✅' : '❌'}\n`;
    message += `   • Technical: ${techSkills.length}\n`;
    message += `   • Soft: ${softSkills.length}\n`;
    message += `   • Tools: ${toolsSkills.length}\n\n`;
    
    message += `${SEP}\n`;
    message += `📂 *18+ CATEGORIES*\n`;
    message += `${SEP}\n\n`;
    
    const categories = [
      { name: 'Certifications', data: cvData.certifications },
      { name: 'Languages', data: cvData.languages },
      { name: 'Projects', data: cvData.projects },
      { name: 'Achievements', data: cvData.achievements },
      { name: 'Volunteer', data: cvData.volunteer },
      { name: 'Leadership', data: cvData.leadership },
      { name: 'Awards', data: cvData.awards },
      { name: 'Publications', data: cvData.publications },
      { name: 'Conferences', data: cvData.conferences },
      { name: 'Referees', data: cvData.referees }
    ];
    
    for (const cat of categories) {
      const hasData = cat.data && cat.data.length > 0;
      message += `${hasData ? '✅' : '❌'} ${cat.name}: ${hasData ? cat.data.length + ' item(s)' : 'Missing'}\n`;
    }
    
    message += `\n${SEP}\n`;
    message += `💡 *Recommendations*\n`;
    message += `${SEP}\n\n`;
    
    if (completeness < 50) {
      message += `⚠️ Your CV needs significant improvement.\n`;
      message += `• Add missing personal information\n`;
      message += `• Include your work experience\n`;
      message += `• List your skills and education\n`;
    } else if (completeness < 80) {
      message += `📈 Your CV is good but could be better.\n`;
      message += `• Add more 18+ categories\n`;
      message += `• Include achievements and projects\n`;
      message += `• Add certifications if applicable\n`;
    } else {
      message += `🎉 Your CV is excellent!\n`;
      message += `• Keep it updated every 6 months\n`;
      message += `• Consider adding more achievements\n`;
    }
    
    const keyboard = {
      inline_keyboard: [
        [{ text: "✏️ Update CV", callback_data: "prefill_update" }],
        [{ text: "📋 Add Missing Categories", callback_data: "prefill_quickadd" }],
        [{ text: "🔙 Back to Portal", callback_data: "portal_back" }]
      ]
    };
    
    await ctx.reply(message, { 
      parse_mode: 'Markdown',
      reply_markup: keyboard
    });
  }

  async showReferralInfo(ctx, client) {
    const stats = await this.getReferralStats(client.id);
    const shareLink = `https://t.me/${ctx.botInfo.username}?start=ref_${stats.referral_code}`;
    const shortLink = `t.me/${ctx.botInfo.username}?start=ref_${stats.referral_code}`;
    
    const message = `🎁 *REFERRAL PROGRAM*

${SEP}
📋 *YOUR REFERRAL LINKS*
${SEP}

*Telegram:*
\`${shareLink}\`

*Short Link (WhatsApp/SMS):*
\`${shortLink}\`

${SEP}
📊 *YOUR STATISTICS*
${SEP}

• Tier: ${stats.tier}
• Direct Referrals: ${stats.completed_referrals}
• Pending Referrals: ${stats.pending_referrals}
• Level 2 Referrals: ${stats.network_size - stats.completed_referrals}
• Total Network: ${stats.network_size}
• Available Credit: MK${(stats.available_credit || 0).toLocaleString()}

${SEP}
💰 *REWARD TIERS*
${SEP}

🥉 Bronze (0-4): MK2,000/ref
🥈 Silver (5-9): MK2,500/ref + 5% bonus
🥇 Gold (10-24): MK3,000/ref + 10% bonus
💎 Platinum (25-49): MK4,000/ref + 15% bonus
👑 Diamond (50+): MK5,000/ref + 20% bonus

${SEP}
💡 *HOW IT WORKS*
${SEP}

1️⃣ Share your link with friends
2️⃣ Friend gets 10% off their first order
3️⃣ You earn credit when they complete an order
4️⃣ Earn from THEIR referrals too (3 levels!)

*Share now and earn unlimited credit!* 🚀`;

    const keyboard = {
      inline_keyboard: [
        [{ text: "📤 Share on WhatsApp", url: `https://wa.me/?text=${encodeURIComponent(`Get 10% off your professional CV at EasySuccor! Use my referral link: ${shortLink}`)}` }],
        [{ text: "📱 Share on Telegram", url: `https://t.me/share/url?url=${encodeURIComponent(shareLink)}&text=${encodeURIComponent('Get 10% off your CV!')}` }],
        [{ text: "📋 Copy Link", callback_data: "copy_referral_link" }],
        [{ text: "🔙 Back to Portal", callback_data: "portal_back" }]
      ]
    };
    
    await ctx.reply(message, { 
      parse_mode: 'Markdown',
      reply_markup: keyboard
    });
  }

  async updateContactInfo(ctx, client) {
    const session = await db.getActiveSession(client.id);
    if (!session) {
      await ctx.reply("Please start a session first with /start");
      return;
    }
    
    session.data.updating_contact = true;
    session.stage = 'updating_contact';
    await db.updateSession(session.id, session.stage, 'contact', session.data);
    
    await ctx.reply(`✏️ *UPDATE CONTACT INFORMATION*

Which would you like to update?

1️⃣ 📞 Phone Number
2️⃣ 📧 Email Address
3️⃣ 📍 Location
4️⃣ 🏠 Physical Address
5️⃣ 🌍 Nationality
6️⃣ 📱 Alternative Phone
7️⃣ 🔙 Back to Portal

Type the number of your choice or click below:`, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: "1️⃣ Phone", callback_data: "update_phone" },
            { text: "2️⃣ Email", callback_data: "update_email" }
          ],
          [
            { text: "3️⃣ Location", callback_data: "update_location" },
            { text: "4️⃣ Address", callback_data: "update_address" }
          ],
          [
            { text: "5️⃣ Nationality", callback_data: "update_nationality" },
            { text: "6️⃣ Alt Phone", callback_data: "update_alt_phone" }
          ],
          [
            { text: "🔙 Back", callback_data: "portal_back" }
          ]
        ]
      }
    });
  }

  async processContactUpdate(ctx, client, field, value) {
    const updateData = {};
    updateData[field] = value;
    await db.updateClient(client.id, updateData);
    
    this.sessionCache.delete(client.id);
    
    await ctx.reply(`✅ *${field.replace(/_/g, ' ').toUpperCase()} updated successfully!*

New value: ${value}

Type /portal to view your updated profile.`, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[
          { text: "🏢 Back to Portal", callback_data: "portal_back" }
        ]]
      }
    });
    
    const session = await db.getActiveSession(client.id);
    if (session) {
      session.data.updating_contact = false;
      session.stage = 'main_menu';
      await db.updateSession(session.id, session.stage, null, session.data);
    }
  }

  async showSupport(ctx, client) {
    const message = `🆘 *SUPPORT CENTER*

${SEP}
📞 *CONTACT INFORMATION*
${SEP}

• Phone: +265 991 295 401
• WhatsApp: +265 881 193 707
• Email: ${process.env.EMAIL_USER || 'easysuccor.bot@gmail.com'}

${SEP}
💳 *PAYMENT METHODS*
${SEP}

• Airtel Money: 0991295401
• TNM Mpamba: 0886928639
• MO626 Bank: 1005653618

${SEP}
⏰ *BUSINESS HOURS*
${SEP}

Monday - Friday: 8:00 AM - 8:00 PM
Saturday: 9:00 AM - 5:00 PM
Sunday: Closed

${SEP}
📋 *COMMON ISSUES*
${SEP}

• Payment issues? Type /pay
• Need your documents? Type /mydocs
• Update contact? Type /portal
• Reset session? Type /reset
• Referral questions? Type /referral

${SEP}
💬 *LIVE SUPPORT*
${SEP}

For urgent matters, please call or WhatsApp us directly.

We typically respond within 2 hours during business hours.`;

    const keyboard = {
      inline_keyboard: [
        [{ text: "📞 Call Support", url: "tel:+265991295401" }],
        [{ text: "💬 WhatsApp", url: "https://wa.me/265881193707" }],
        [{ text: "📧 Email", url: `mailto:${process.env.EMAIL_USER || 'easysuccor.bot@gmail.com'}` }],
        [{ text: "🔙 Back to Portal", callback_data: "portal_back" }]
      ]
    };
    
    await ctx.reply(message, { 
      parse_mode: 'Markdown',
      reply_markup: keyboard
    });
  }

  async handleCallback(ctx, client, action) {
    switch (action) {
      case 'portal_docs':
        await this.showDocuments(ctx, client);
        break;
      case 'portal_payments':
        await this.showPayments(ctx, client);
        break;
      case 'portal_profile':
        await this.showProfile(ctx, client);
        break;
      case 'portal_referral':
        await this.showReferralInfo(ctx, client);
        break;
      case 'portal_cv_status':
        await this.showCVStatus(ctx, client);
        break;
      case 'portal_support':
        await this.showSupport(ctx, client);
        break;
      case 'portal_back':
        await this.showPortal(ctx, client);
        break;
      default:
        await ctx.answerCbQuery('Action not recognized');
    }
  }
}

module.exports = ClientPortal;