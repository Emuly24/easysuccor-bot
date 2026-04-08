// prefill-forms.js - Advanced Pre-filled Forms with AI Suggestions
const db = require('./database');
const documentGenerator = require('./document-generator');

class PrefillForms {
  constructor() {
    this.prefilledData = new Map();
    this.cacheTimeout = 86400000; // 24 hours
  }
  
  async getPrefilledData(clientId) {
    // Check cache
    const cached = this.prefilledData.get(clientId);
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.data;
    }
    
    const orders = await db.getClientOrders(clientId);
    const lastOrder = orders.find(o => o.service === 'new cv' || o.service === 'editable cv');
    
    if (!lastOrder || !lastOrder.cv_data) {
      return null;
    }
    
    const cvData = lastOrder.cv_data;
    const personal = cvData.personal || {};
    const employment = cvData.employment || [];
    const education = cvData.education || [];
    const skills = cvData.skills || [];
    const lastJob = employment[0];
    const highestEdu = education[0];
    
    // Detect industry for smart suggestions
    const industry = this.detectIndustryFromCV(cvData);
    
    const prefill = {
      full_name: personal.full_name,
      email: personal.email,
      phone: personal.primary_phone,
      location: personal.location,
      physical_address: personal.physical_address,
      nationality: personal.nationality,
      last_job_title: lastJob?.title,
      last_company: lastJob?.company,
      last_job_duration: lastJob?.duration,
      highest_education: highestEdu?.level,
      education_field: highestEdu?.field,
      education_institution: highestEdu?.institution,
      skills: skills.slice(0, 10),
      industry: industry,
      last_cv_date: new Date(lastOrder.created_at).toLocaleDateString(),
      last_cv_version: lastOrder.version || 1,
      has_data: true,
      suggested_updates: await this.generateSuggestions(cvData, industry)
    };
    
    this.prefilledData.set(clientId, { data: prefill, timestamp: Date.now() });
    return prefill;
  }

  detectIndustryFromCV(cvData) {
    const allText = [
      ...(cvData.employment?.map(j => `${j.title} ${j.company}`) || []),
      ...(cvData.skills || []),
      ...(cvData.education?.map(e => e.field) || [])
    ].join(' ').toLowerCase();
    
    if (allText.includes('carpenter') || allText.includes('joiner')) return 'carpentry';
    if (allText.includes('agriculture') || allText.includes('farm')) return 'agriculture';
    if (allText.includes('health') || allText.includes('medical')) return 'healthcare';
    if (allText.includes('software') || allText.includes('developer')) return 'technology';
    if (allText.includes('teach') || allText.includes('education')) return 'education';
    if (allText.includes('project') || allText.includes('manager')) return 'project_management';
    return 'corporate';
  }

  async generateSuggestions(cvData, industry) {
    const suggestions = [];
    const employment = cvData.employment || [];
    const skills = cvData.skills || [];
    const lastCvDate = new Date();
    
    // Check if CV is older than 6 months
    const cvAge = Math.floor((Date.now() - new Date(cvData.updated_at || lastCvDate)) / (1000 * 60 * 60 * 24 * 30));
    if (cvAge > 6) {
      suggestions.push({
        type: 'update',
        message: 'Your CV is over 6 months old. Consider updating it with your latest experience.'
      });
    }
    
    // Suggest adding more recent experience
    if (employment.length > 0 && !employment[0].duration?.includes('Present')) {
      suggestions.push({
        type: 'add',
        message: 'Add your current role to show your latest experience.'
      });
    }
    
    // Suggest adding more skills based on industry trends
    const industrySkills = {
      technology: ['Cloud Computing', 'DevOps', 'AI/ML', 'Cybersecurity'],
      project_management: ['Agile', 'Scrum', 'JIRA', 'Risk Management'],
      healthcare: ['Telehealth', 'EMR Systems', 'Patient Safety'],
      education: ['EdTech', 'Online Teaching', 'Curriculum Design']
    };
    
    const missingSkills = (industrySkills[industry] || []).filter(s => 
      !skills.some(existing => existing.toLowerCase().includes(s.toLowerCase()))
    ).slice(0, 3);
    
    if (missingSkills.length > 0) {
      suggestions.push({
        type: 'add',
        message: `Add trending skills: ${missingSkills.join(', ')}`
      });
    }
    
    return suggestions;
  }
  
  async showPrefilledWelcome(ctx, client, session) {
    const prefill = await this.getPrefilledData(client.id);
    
    if (!prefill) {
      return false;
    }
    
    let suggestionsText = '';
    if (prefill.suggested_updates && prefill.suggested_updates.length > 0) {
      suggestionsText = '\n\n💡 *Suggestions:*\n' + prefill.suggested_updates.map(s => `• ${s.message}`).join('\n');
    }
    
    const message = `🎉 *Welcome back, ${prefill.full_name || client.first_name}!* 👋

I remember you from your last visit (${prefill.last_cv_date}):

━━━━━━━━━━━━━━━━━━━━━━━━━━━
📌 *Your Profile*
━━━━━━━━━━━━━━━━━━━━━━━━━━━

• ${prefill.last_job_title ? `📌 ${prefill.last_job_title} at ${prefill.last_company}` : '📌 No previous job recorded'}
• 🎓 ${prefill.highest_education || 'No education'} in ${prefill.education_field || 'N/A'}
• 📍 Based in ${prefill.location || 'Unknown'}
• ⚡ ${prefill.skills?.length || 0} skills recorded
• 🏭 Industry: ${prefill.industry || 'General'}${suggestionsText}

━━━━━━━━━━━━━━━━━━━━━━━━━━━
*What would you like to do?*
━━━━━━━━━━━━━━━━━━━━━━━━━━━

1️⃣ ✏️ *Update Existing CV* - I'll prefill your saved info
2️⃣ 🆕 *Create New CV* - Start fresh
3️⃣ 💌 *Cover Letter Only* - For a specific job
4️⃣ 🔄 *Start Over* - Clear all saved data

*Quick tip:* Using your saved info will save you 5-10 minutes! ⚡`;
    
    // Store prefill data in session
    session.data.prefill_data = prefill;
    session.data.prefill_available = true;
    await db.updateSession(session.id, session.stage, session.current_section, session.data);
    
    await ctx.reply(message, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: "✏️ Update Existing CV", callback_data: "prefill_update" }],
          [{ text: "🆕 Create New CV", callback_data: "prefill_new" }],
          [{ text: "💌 Cover Letter Only", callback_data: "prefill_cover" }],
          [{ text: "🔄 Start Over", callback_data: "prefill_startover" }]
        ]
      }
    });
    
    return true;
  }
  
  async applyPrefillData(session, updateMode = false) {
    if (!session.data.prefill_data) {
      return null;
    }
    
    const prefill = session.data.prefill_data;
    
    // Initialize CV data structure
    if (!session.data.cv_data) {
      session.data.cv_data = { personal: {}, education: [], employment: [], skills: [] };
    }
    
    if (!updateMode) {
      // Fresh CV - use all prefill data
      session.data.cv_data.personal = {
        full_name: prefill.full_name,
        email: prefill.email,
        primary_phone: prefill.phone,
        location: prefill.location,
        physical_address: prefill.physical_address,
        nationality: prefill.nationality
      };
      
      if (prefill.education_institution && prefill.highest_education) {
        session.data.cv_data.education = [{
          level: prefill.highest_education,
          field: prefill.education_field,
          institution: prefill.education_institution,
          year: ''
        }];
      }
      
      if (prefill.skills && prefill.skills.length > 0) {
        session.data.cv_data.skills = prefill.skills;
      }
      
      if (prefill.last_job_title && prefill.last_company) {
        session.data.cv_data.employment = [{
          title: prefill.last_job_title,
          company: prefill.last_company,
          duration: prefill.last_job_duration || 'Previous experience',
          responsibilities: []
        }];
      }
    }
    
    return prefill;
  }
  
  async updatePrefillCache(clientId, newData) {
    const existing = this.prefilledData.get(clientId);
    if (existing) {
      existing.data = { ...existing.data, ...newData, updated_at: new Date().toISOString() };
      existing.timestamp = Date.now();
      this.prefilledData.set(clientId, existing);
    }
  }
  
  clearCache(clientId) {
    this.prefilledData.delete(clientId);
  }
}

module.exports = PrefillForms;