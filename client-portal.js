// client-portal.js - Client Portal for Telegram
const db = require('./database');

class ClientPortal {
  constructor(bot) {
    this.bot = bot;
  }

  async showPortal(ctx, client) {
    const orders = await db.getClientOrders(client.id);
    const lastOrder = orders[0];
    const referralInfo = await db.getReferralInfo(client.id);
    
    let portalMessage = `🏠 *YOUR EASYSUCCOR PORTAL*

👤 *Account:*
• Name: ${client.first_name} ${client.last_name || ''}
• Phone: ${client.phone || 'Not set'}
• Email: ${client.email || 'Not set'}
• Member since: ${new Date(client.created_at).toLocaleDateString()}

📊 *Your Stats:*
• Total orders: ${client.total_orders || 0}
• Total spent: MK${(client.total_spent || 0).toLocaleString()}
• Last order: ${lastOrder ? new Date(lastOrder.created_at).toLocaleDateString() : 'Never'}

🎁 *Referral Program:*
• Your code: \`${referralInfo.referral_code}\`
• Friends joined: ${referralInfo.total_referrals}
• Your credit: MK${referralInfo.pending_reward.toLocaleString()}

📄 *Recent Documents:`
    
    if (orders.length > 0) {
      portalMessage += `\n${orders.slice(0, 3).map((o, i) => 
        `${i + 1}. ${o.service} - ${new Date(o.created_at).toLocaleDateString()} - ${o.status}`
      ).join('\n')}`;
    } else {
      portalMessage += `\nNo documents yet. Type /start to create your first CV!`;
    }
    
    portalMessage += `\n\n⚙️ *What would you like to do?*
    
1️⃣ View my documents
2️⃣ Order history
3️⃣ Referral info
4️⃣ Update my contact info
5️⃣ Get support

Type the number of your choice.`;
    
    await ctx.reply(portalMessage, { parse_mode: 'Markdown' });
  }
  
  async showDocuments(ctx, client) {
    const orders = await db.getClientOrders(client.id);
    if (orders.length === 0) {
      await ctx.reply("You don't have any documents yet. Type /start to create your first CV!");
      return;
    }
    
    let message = `📄 *YOUR DOCUMENTS*\n\n`;
    for (const order of orders) {
      message += `📌 *${order.service}* - ${order.status}\n`;
      message += `   Order: ${order.id}\n`;
      message += `   Date: ${new Date(order.created_at).toLocaleDateString()}\n`;
      message += `   Total: ${order.total_charge}\n\n`;
    }
    await ctx.reply(message, { parse_mode: 'Markdown' });
  }
  
  async showReferralInfo(ctx, client) {
    const referralInfo = await db.getReferralInfo(client.id);
    await ctx.reply(`🎁 *REFERRAL PROGRAM*

Your code: \`${referralInfo.referral_code}\`

*Share this link:*
https://t.me/${ctx.botInfo.username}?start=ref_${referralInfo.referral_code}

*Your Stats:*
• Total referrals: ${referralInfo.total_referrals}
• Completed: ${referralInfo.completed_referrals}
• Pending reward: MK${referralInfo.pending_reward.toLocaleString()}

*How it works:*
• Friend uses your code → gets 10% off
• You get MK2,000 credit when they complete an order

*Share with friends and earn!* 🎉`, { parse_mode: 'Markdown' });
  }
  
  async updateContactInfo(ctx, client) {
    await ctx.reply(`✏️ *UPDATE CONTACT INFO*

Which would you like to update?

1️⃣ Phone number
2️⃣ Email address
3️⃣ Location
4️⃣ Back to portal

Type the number.`);
    // This would store the user's intention and wait for input
  }
}

module.exports = ClientPortal;