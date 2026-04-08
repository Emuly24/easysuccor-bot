// client-portal.js - Enterprise Client Portal for Telegram
const db = require('./database');
const notificationService = require('./notification-service');

class ClientPortal {
  constructor(bot) {
    this.bot = bot;
    this.sessionCache = new Map();
  }

  async showPortal(ctx, client) {
    const orders = await db.getClientOrders(client.id);
    const lastOrder = orders[0];
    const referralInfo = await db.getReferralInfo(client.id);
    const stats = await this.getClientStats(client.id);
    
    let portalMessage = `🏢 *EASYSUCCOR CLIENT PORTAL*

━━━━━━━━━━━━━━━━━━━━━━━━━━━
👤 *ACCOUNT INFORMATION*
━━━━━━━━━━━━━━━━━━━━━━━━━━━

• Name: ${client.first_name} ${client.last_name || ''}
• Phone: ${client.phone || '❌ Not set'}
• Email: ${client.email || '❌ Not set'}
• Member since: ${new Date(client.created_at).toLocaleDateString()}

━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 *YOUR STATISTICS*
━━━━━━━━━━━━━━━━━━━━━━━━━━━

• Total orders: ${stats.total_orders}
• Completed: ${stats.completed_orders}
• Pending: ${stats.pending_orders}
• Total spent: ${stats.total_spent}
• Lifetime value: ${stats.lifetime_value}

━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎁 *REFERRAL PROGRAM*
━━━━━━━━━━━━━━━━━━━━━━━━━━━

• Your code: \`${referralInfo.referral_code}\`
• Friends joined: ${referralInfo.total_referrals}
• Your credit: ${referralInfo.pending_reward}

━━━━━━━━━━━━━━━━━━━━━━━━━━━
📄 *RECENT DOCUMENTS*
━━━━━━━━━━━━━━━━━━━━━━━━━━━`;

    if (orders.length > 0) {
      portalMessage += orders.slice(0, 3).map((o, i) => 
        `\n${i + 1}. *${o.service}* - ${o.status}
   📅 ${new Date(o.created_at).toLocaleDateString()}
   💰 ${o.total_charge}`
      ).join('');
    } else {
      portalMessage += `\nNo documents yet. Start your first order with /start`;
    }
    
    portalMessage += `\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚙️ *QUICK ACTIONS*
━━━━━━━━━━━━━━━━━━━━━━━━━━━

• /mydocs - View all documents
• /referral - Share & earn
• /feedback - Rate your experience
• /support - Contact support

Need help? Type /help anytime.`;

    await ctx.reply(portalMessage, { parse_mode: 'Markdown' });
  }

  async getClientStats(clientId) {
    const orders = await db.getClientOrders(clientId);
    const completedOrders = orders.filter(o => o.status === 'delivered' || o.status === 'completed');
    const pendingOrders = orders.filter(o => o.status === 'pending' || o.payment_status === 'pending');
    
    const totalSpent = completedOrders.reduce((sum, o) => {
      const amount = parseInt(o.total_charge?.replace('MK', '').replace(',', '') || 0);
      return sum + amount;
    }, 0);
    
    return {
      total_orders: orders.length,
      completed_orders: completedOrders.length,
      pending_orders: pendingOrders.length,
      total_spent: `MK${totalSpent.toLocaleString()}`,
      lifetime_value: `MK${totalSpent.toLocaleString()}`
    };
  }

  async showDocuments(ctx, client) {
    const orders = await db.getClientOrders(client.id);
    if (orders.length === 0) {
      await ctx.reply("📭 *No Documents Found*\n\nYou haven't created any documents yet.\n\nType /start to create your first CV!", { parse_mode: 'Markdown' });
      return;
    }
    
    let message = `📁 *YOUR DOCUMENT ARCHIVE*\n\n`;
    for (const order of orders) {
      const statusIcon = order.status === 'delivered' ? '✅' : order.status === 'pending' ? '⏳' : '📝';
      message += `${statusIcon} *${order.service}* - ${order.status}\n`;
      message += `   🆔 Order: \`${order.id}\`\n`;
      message += `   📅 Date: ${new Date(order.created_at).toLocaleDateString()}\n`;
      message += `   💰 Total: ${order.total_charge}\n`;
      if (order.delivered_at) {
        message += `   📬 Delivered: ${new Date(order.delivered_at).toLocaleDateString()}\n`;
      }
      message += `\n`;
    }
    
    message += `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    message += `To request a new document, type /start`;
    
    await ctx.reply(message, { parse_mode: 'Markdown' });
  }

  async showReferralInfo(ctx, client) {
    const referralInfo = await db.getReferralInfo(client.id);
    const shareLink = `https://t.me/${ctx.botInfo.username}?start=ref_${referralInfo.referral_code}`;
    
    const message = `🎁 *REFERRAL PROGRAM*

━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 *YOUR REFERRAL LINK*
━━━━━━━━━━━━━━━━━━━━━━━━━━━

\`${shareLink}\`

━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 *YOUR STATISTICS*
━━━━━━━━━━━━━━━━━━━━━━━━━━━

• Total referrals: ${referralInfo.total_referrals}
• Completed: ${referralInfo.completed_referrals}
• Pending reward: ${referralInfo.pending_reward}

━━━━━━━━━━━━━━━━━━━━━━━━━━━
💡 *HOW IT WORKS*
━━━━━━━━━━━━━━━━━━━━━━━━━━━

1️⃣ Share your unique link with friends
2️⃣ Friend gets 10% off their first order
3️⃣ You earn ${process.env.REFERRAL_REWARD || 2000} credit when they complete an order
4️⃣ Use your credit on your next order!

━━━━━━━━━━━━━━━━━━━━━━━━━━━
📤 *SHARE NOW*
━━━━━━━━━━━━━━━━━━━━━━━━━━━

Tap and hold the link above to copy, then share on WhatsApp, Telegram, or Facebook!

Every referral brings you closer to a free CV! 🎉`;

    await ctx.reply(message, { parse_mode: 'Markdown' });
  }

  async updateContactInfo(ctx, client) {
    const session = await db.getActiveSession(client.id);
    session.data.updating_contact = true;
    await db.updateSession(session.id, 'updating_contact', 'contact', session.data);
    
    await ctx.reply(`✏️ *UPDATE CONTACT INFORMATION*

Which would you like to update?

1️⃣ 📞 Phone Number
2️⃣ 📧 Email Address
3️⃣ 📍 Location
4️⃣ 🏠 Physical Address
5️⃣ 🌍 Nationality
6️⃣ 🔙 Back to Portal

Type the number of your choice.`, {
      reply_markup: {
        inline_keyboard: [
          [{ text: "1️⃣ Phone", callback_data: "update_phone" }, { text: "2️⃣ Email", callback_data: "update_email" }],
          [{ text: "3️⃣ Location", callback_data: "update_location" }, { text: "4️⃣ Address", callback_data: "update_address" }],
          [{ text: "5️⃣ Nationality", callback_data: "update_nationality" }, { text: "🔙 Back", callback_data: "portal_back" }]
        ]
      }
    });
  }

  async processContactUpdate(ctx, client, field, value) {
    const updateData = {};
    updateData[field] = value;
    await db.updateClient(client.id, updateData);
    
    await ctx.reply(`✅ *${field.replace('_', ' ').toUpperCase()} updated successfully!*

New value: ${value}

Type /portal to view your updated profile.`);
    
    const session = await db.getActiveSession(client.id);
    session.data.updating_contact = false;
    await db.updateSession(session.id, 'main_menu', null, session.data);
  }

  async showSupport(ctx, client) {
    const message = `🆘 *SUPPORT CENTER*

━━━━━━━━━━━━━━━━━━━━━━━━━━━
📞 *CONTACT INFORMATION*
━━━━━━━━━━━━━━━━━━━━━━━━━━━

• Phone: +265 991 295 401
• WhatsApp: +265 881 193 707
• Email: ${process.env.EMAIL_USER || 'easysuccor.bot@gmail.com'}

━━━━━━━━━━━━━━━━━━━━━━━━━━━
⏰ *BUSINESS HOURS*
━━━━━━━━━━━━━━━━━━━━━━━━━━━

Monday - Friday: 8:00 AM - 8:00 PM
Saturday: 9:00 AM - 5:00 PM
Sunday: Closed

━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 *COMMON ISSUES*
━━━━━━━━━━━━━━━━━━━━━━━━━━━

• Payment issues? Type /pay
• Need your documents? Type /mydocs
• Update contact? Type /portal
• Reset session? Type /reset

━━━━━━━━━━━━━━━━━━━━━━━━━━━
💬 *LIVE SUPPORT*
━━━━━━━━━━━━━━━━━━━━━━━━━━━

For urgent matters, please call or WhatsApp us directly.

We typically respond within 2 hours during business hours.`;
    
    await ctx.reply(message, { parse_mode: 'Markdown' });
  }
}

module.exports = ClientPortal;