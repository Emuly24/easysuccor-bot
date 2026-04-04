// prefill-forms.js - Pre-filled Forms for Returning Clients
const db = require('./database');

class PrefillForms {
  constructor() {
    this.prefilledData = new Map();
  }
  
  async getPrefilledData(clientId) {
    const orders = await db.getClientOrders(clientId);
    const lastOrder = orders[0];
    
    if (!lastOrder || !lastOrder.cv_data) {
      return null;
    }
    
    const cvData = lastOrder.cv_data;
    const personal = cvData.personal || {};
    const employment = cvData.employment || [];
    const lastJob = employment[0];
    
    return {
      full_name: personal.full_name,
      email: personal.email,
      phone: personal.primary_phone,
      location: personal.location,
      last_job_title: lastJob?.title,
      last_company: lastJob?.company,
      last_cv_date: new Date(lastOrder.created_at).toLocaleDateString(),
      has_data: true
    };
  }
  
  async showPrefilledWelcome(ctx, client, session) {
    const prefill = await this.getPrefilledData(client.id);
    
    if (!prefill) {
      return false;
    }
    
    const message = `🎉 *Welcome back, ${prefill.full_name || client.first_name}!* 👋

I remember you:
• ${prefill.last_job_title ? `📌 ${prefill.last_job_title} at ${prefill.last_company}` : '📌 No previous job recorded'}
• 📍 Based in ${prefill.location || 'Unknown'}
• 📅 Last CV created: ${prefill.last_cv_date}

*Would you like to:*

1️⃣ Update your existing CV
2️⃣ Create a completely new CV
3️⃣ Just get a cover letter

Or type 'START OVER' to begin fresh.

*Quick tip:* Using your saved info will save you time! ⚡`;
    
    // Store prefill data in session
    session.data.prefill_data = prefill;
    session.data.prefill_available = true;
    await db.updateSession(session.id, session.stage, session.current_section, session.data);
    
    await ctx.reply(message, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: "1️⃣ Update Existing CV", callback_data: "prefill_update" }],
          [{ text: "2️⃣ Create New CV", callback_data: "prefill_new" }],
          [{ text: "3️⃣ Cover Letter Only", callback_data: "prefill_cover" }],
          [{ text: "🔄 Start Over", callback_data: "prefill_startover" }]
        ]
      }
    });
    
    return true;
  }
  
  async applyPrefillData(session) {
    if (!session.data.prefill_data) {
      return null;
    }
    
    const prefill = session.data.prefill_data;
    
    // Pre-fill personal data
    if (!session.data.cv_data) {
      session.data.cv_data = { personal: {}, education: [], employment: [], skills: [] };
    }
    
    session.data.cv_data.personal = {
      full_name: prefill.full_name,
      email: prefill.email,
      primary_phone: prefill.phone,
      location: prefill.location
    };
    
    return prefill;
  }
}

module.exports = PrefillForms;