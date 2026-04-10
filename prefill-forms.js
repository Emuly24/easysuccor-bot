// prefill-forms.js - Advanced Pre-filled Forms with AI Suggestions (UPDATED)
// Now supports full 18+ categories structure

const db = require('./database');
const documentGenerator = require('./document-generator');

class PrefillForms {
  constructor() {
    this.prefilledData = new Map();
    this.cacheTimeout = 86400000; // 24 hours
  }
  
  async getPrefilledData(clientId) {
    // Check cache first
    const cached = this.prefilledData.get(clientId);
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.data;
    }
    
    const orders = await db.getClientOrders(clientId);
    const lastOrder = orders.find(o => 
      o.service === 'new cv' || 
      o.service === 'editable cv' || 
      o.service === 'professional cv' ||
      o.service === 'student cv'
    );
    
    if (!lastOrder || !lastOrder.cv_data) {
      return null;
    }
    
    const cvData = lastOrder.cv_data;
    const personal = cvData.personal || {};
    const employment = cvData.employment || [];
    const education = cvData.education || [];
    const skills = cvData.skills || { technical: [], soft: [], tools: [] };
    const lastJob = employment[0];
    const highestEdu = education[0];
    
    // Extract all skills into a flat array
    const allSkills = [
      ...(skills.technical || []),
      ...(skills.soft || []),
      ...(skills.tools || [])
    ];
    
    // Detect industry for smart suggestions
    const industry = this.detectIndustryFromCV(cvData);
    
    // Build comprehensive prefill object with all 18+ categories
    const prefill = {
      // Personal Info
      full_name: personal.full_name || personal.name,
      email: personal.email,
      phone: personal.primary_phone || personal.phone,
      alternative_phone: personal.alternative_phone,
      location: personal.location,
      physical_address: personal.physical_address,
      nationality: personal.nationality,
      date_of_birth: personal.date_of_birth,
      linkedin: personal.linkedin,
      github: personal.github,
      portfolio_url: personal.portfolio_url,
      
      // Professional Summary
      professional_summary: cvData.professional_summary || '',
      
      // Employment
      last_job_title: lastJob?.title,
      last_company: lastJob?.company,
      last_job_duration: lastJob?.duration,
      last_job_responsibilities: lastJob?.responsibilities || [],
      last_job_achievements: lastJob?.achievements || [],
      total_jobs: employment.length,
      years_experience: this.calculateYearsExperience(employment),
      
      // Education
      highest_education: highestEdu?.level,
      education_field: highestEdu?.field,
      education_institution: highestEdu?.institution,
      education_year: highestEdu?.year,
      education_grade: highestEdu?.grade,
      total_education: education.length,
      
      // Skills (categorized)
      technical_skills: skills.technical || [],
      soft_skills: skills.soft || [],
      tools_skills: skills.tools || [],
      all_skills: allSkills,
      total_skills: allSkills.length,
      
      // Certifications (18+ category)
      certifications: cvData.certifications || [],
      total_certifications: (cvData.certifications || []).length,
      
      // Languages (18+ category)
      languages: cvData.languages || [],
      total_languages: (cvData.languages || []).length,
      
      // Projects (18+ category)
      projects: cvData.projects || [],
      total_projects: (cvData.projects || []).length,
      
      // Achievements (18+ category)
      achievements: cvData.achievements || [],
      total_achievements: (cvData.achievements || []).length,
      
      // Volunteer Experience (18+ category)
      volunteer: cvData.volunteer || [],
      total_volunteer: (cvData.volunteer || []).length,
      
      // Leadership Roles (18+ category)
      leadership: cvData.leadership || [],
      total_leadership: (cvData.leadership || []).length,
      
      // Awards (18+ category)
      awards: cvData.awards || [],
      total_awards: (cvData.awards || []).length,
      
      // Publications (18+ category)
      publications: cvData.publications || [],
      total_publications: (cvData.publications || []).length,
      
      // Conferences (18+ category)
      conferences: cvData.conferences || [],
      total_conferences: (cvData.conferences || []).length,
      
      // Referees (18+ category)
      referees: cvData.referees || [],
      total_referees: (cvData.referees || []).length,
      
      // Interests (18+ category)
      interests: cvData.interests || [],
      
      // Social Media (18+ category)
      social_media: cvData.social_media || {},
      
      // Portfolio (18+ category)
      portfolio: cvData.portfolio || [],
      
      // Metadata
      industry: industry,
      last_cv_date: new Date(lastOrder.created_at).toLocaleDateString(),
      last_cv_version: lastOrder.version || 1,
      cv_age_months: this.calculateCVAge(lastOrder.created_at),
      has_data: true,
      suggested_updates: await this.generateSuggestions(cvData, industry)
    };
    
    this.prefilledData.set(clientId, { data: prefill, timestamp: Date.now() });
    return prefill;
  }

  calculateYearsExperience(employment) {
    if (!employment || employment.length === 0) return 0;
    
    let totalYears = 0;
    for (const job of employment) {
      const duration = job.duration || '';
      const yearMatch = duration.match(/(\d+)\s*(?:year|yr)/i);
      if (yearMatch) {
        totalYears += parseInt(yearMatch[1]);
      }
    }
    return totalYears || employment.length * 2; // Estimate if no duration
  }

  calculateCVAge(createdAt) {
    const created = new Date(createdAt);
    const now = new Date();
    const months = (now.getFullYear() - created.getFullYear()) * 12 + 
                   (now.getMonth() - created.getMonth());
    return months;
  }

  detectIndustryFromCV(cvData) {
    const allText = [
      ...(cvData.employment?.map(j => `${j.title} ${j.company}`) || []),
      ...(cvData.skills?.technical || []),
      ...(cvData.skills?.soft || []),
      ...(cvData.skills?.tools || []),
      ...(cvData.education?.map(e => e.field) || []),
      cvData.professional_summary || ''
    ].join(' ').toLowerCase();
    
    if (allText.includes('carpenter') || allText.includes('joiner') || allText.includes('woodwork')) return 'carpentry';
    if (allText.includes('agriculture') || allText.includes('farm') || allText.includes('crop')) return 'agriculture';
    if (allText.includes('health') || allText.includes('medical') || allText.includes('nurse') || allText.includes('patient')) return 'healthcare';
    if (allText.includes('software') || allText.includes('developer') || allText.includes('programming') || allText.includes('code')) return 'technology';
    if (allText.includes('teach') || allText.includes('education') || allText.includes('instructor') || allText.includes('professor')) return 'education';
    if (allText.includes('project') || allText.includes('manager') || allText.includes('coordinate')) return 'project_management';
    if (allText.includes('account') || allText.includes('finance') || allText.includes('audit')) return 'finance';
    if (allText.includes('market') || allText.includes('sales') || allText.includes('business development')) return 'sales_marketing';
    return 'corporate';
  }

  async generateSuggestions(cvData, industry) {
    const suggestions = [];
    const employment = cvData.employment || [];
    const skills = cvData.skills || { technical: [], soft: [], tools: [] };
    const allSkills = [...(skills.technical || []), ...(skills.soft || []), ...(skills.tools || [])];
    
    const cvAge = this.calculateCVAge(cvData.updated_at || new Date());
    
    // Check if CV is older than 6 months
    if (cvAge > 6) {
      suggestions.push({
        type: 'update',
        category: 'general',
        priority: 'high',
        message: '📅 Your CV is over 6 months old. Consider updating it with your latest experience.',
        action: 'update_cv'
      });
    }
    
    // Suggest adding more recent experience
    if (employment.length > 0) {
      const hasCurrentJob = employment.some(j => 
        j.duration?.toLowerCase().includes('present') || 
        j.duration?.toLowerCase().includes('current')
      );
      if (!hasCurrentJob) {
        suggestions.push({
          type: 'add',
          category: 'employment',
          priority: 'high',
          message: '💼 Add your current role to show your latest experience.',
          action: 'add_current_job'
        });
      }
    }
    
    // Check for missing 18+ categories
    if (!cvData.certifications || cvData.certifications.length === 0) {
      suggestions.push({
        type: 'add',
        category: 'certifications',
        priority: 'medium',
        message: '📜 Add certifications to boost your credibility.',
        action: 'add_certifications'
      });
    }
    
    if (!cvData.languages || cvData.languages.length === 0) {
      suggestions.push({
        type: 'add',
        category: 'languages',
        priority: 'low',
        message: '🌐 Add languages you speak (even basic proficiency helps).',
        action: 'add_languages'
      });
    }
    
    if (!cvData.achievements || cvData.achievements.length === 0) {
      suggestions.push({
        type: 'add',
        category: 'achievements',
        priority: 'medium',
        message: '🏆 Add achievements to stand out from other candidates.',
        action: 'add_achievements'
      });
    }
    
    if (!cvData.volunteer || cvData.volunteer.length === 0) {
      suggestions.push({
        type: 'add',
        category: 'volunteer',
        priority: 'low',
        message: '🤝 Volunteer experience shows character and initiative.',
        action: 'add_volunteer'
      });
    }
    
    if (!cvData.projects || cvData.projects.length === 0) {
      suggestions.push({
        type: 'add',
        category: 'projects',
        priority: 'medium',
        message: '📁 Projects demonstrate practical skills and experience.',
        action: 'add_projects'
      });
    }
    
    if (!cvData.referees || cvData.referees.length === 0) {
      suggestions.push({
        type: 'add',
        category: 'referees',
        priority: 'medium',
        message: '👥 Add referees - employers expect at least 2-3 references.',
        action: 'add_referees'
      });
    }
    
    // Industry-specific skill suggestions
    const industrySkills = {
      technology: ['Cloud Computing', 'DevOps', 'AI/ML', 'Cybersecurity', 'Agile', 'CI/CD'],
      project_management: ['Agile', 'Scrum', 'JIRA', 'Risk Management', 'Stakeholder Management', 'Budgeting'],
      healthcare: ['Telehealth', 'EMR Systems', 'Patient Safety', 'HIPAA Compliance', 'Clinical Documentation'],
      education: ['EdTech', 'Online Teaching', 'Curriculum Design', 'Student Assessment', 'Classroom Management'],
      finance: ['Financial Analysis', 'Budgeting', 'Forecasting', 'QuickBooks', 'Excel Advanced'],
      sales_marketing: ['CRM', 'Lead Generation', 'Social Media Marketing', 'Content Strategy', 'SEO'],
      carpentry: ['Blueprint Reading', 'Cabinet Making', 'Framing', 'Finish Carpentry', 'Power Tools'],
      agriculture: ['Crop Management', 'Irrigation Systems', 'Soil Analysis', 'Pest Control', 'Harvesting']
    };
    
    const missingSkills = (industrySkills[industry] || []).filter(s => 
      !allSkills.some(existing => existing.toLowerCase().includes(s.toLowerCase()))
    ).slice(0, 3);
    
    if (missingSkills.length > 0) {
      suggestions.push({
        type: 'add',
        category: 'skills',
        priority: 'medium',
        message: `⚡ Add trending ${industry} skills: ${missingSkills.join(', ')}`,
        skills: missingSkills,
        action: 'add_skills'
      });
    }
    
    // Check for achievement metrics
    const hasMetrics = employment.some(j => 
      j.achievements?.some(a => /\d+%|\$\d+|\d+\s*(?:people|team|projects)/i.test(a))
    );
    if (!hasMetrics && employment.length > 0) {
      suggestions.push({
        type: 'enhance',
        category: 'achievements',
        priority: 'high',
        message: '📊 Add metrics to your achievements (e.g., "Increased sales by 25%").',
        action: 'add_metrics'
      });
    }
    
    // Sort by priority
    return suggestions.sort((a, b) => {
      const priorityOrder = { high: 0, medium: 1, low: 2 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });
  }
  
  async showPrefilledWelcome(ctx, client, session) {
    const prefill = await this.getPrefilledData(client.id);
    
    if (!prefill) {
      return false;
    }
    
    // Build suggestions display
    let suggestionsText = '';
    if (prefill.suggested_updates && prefill.suggested_updates.length > 0) {
      const highPriority = prefill.suggested_updates.filter(s => s.priority === 'high');
      if (highPriority.length > 0) {
        suggestionsText = '\n\n💡 *Priority Suggestions:*\n' + 
          highPriority.slice(0, 3).map(s => `• ${s.message}`).join('\n');
      }
    }
    
    // Build category summary
    const categorySummary = [
      prefill.total_jobs > 0 ? `💼 ${prefill.total_jobs} jobs` : null,
      prefill.total_education > 0 ? `🎓 ${prefill.total_education} education` : null,
      prefill.total_skills > 0 ? `⚡ ${prefill.total_skills} skills` : null,
      prefill.total_certifications > 0 ? `📜 ${prefill.total_certifications} certs` : null,
      prefill.total_projects > 0 ? `📁 ${prefill.total_projects} projects` : null,
      prefill.total_achievements > 0 ? `🏆 ${prefill.total_achievements} achievements` : null,
      prefill.total_volunteer > 0 ? `🤝 ${prefill.total_volunteer} volunteer` : null,
      prefill.total_leadership > 0 ? `👑 ${prefill.total_leadership} leadership` : null
    ].filter(Boolean).join(' • ');
    
    const message = `🎉 *Welcome back, ${prefill.full_name || client.first_name}!* 👋

I remember you from your last CV (${prefill.last_cv_date}):

━━━━━━━━━━━━━━━━━━━━━━━━━━━
📌 *Your Profile Summary*
━━━━━━━━━━━━━━━━━━━━━━━━━━━

• ${prefill.last_job_title ? `📌 ${prefill.last_job_title} at ${prefill.last_company}` : '📌 No previous job recorded'}
• 🎓 ${prefill.highest_education || 'No education'} in ${prefill.education_field || 'N/A'}
• 📍 Based in ${prefill.location || 'Unknown'}
• 🏭 Industry: ${prefill.industry || 'General'}
• ⏱️ ~${prefill.years_experience} years experience

━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 *18+ Categories Summary*
━━━━━━━━━━━━━━━━━━━━━━━━━━━

${categorySummary || 'No additional categories found'}

📈 *CV Completeness:* ${this.calculateCompleteness(prefill)}%${suggestionsText}

━━━━━━━━━━━━━━━━━━━━━━━━━━━
*What would you like to do?*
━━━━━━━━━━━━━━━━━━━━━━━━━━━

1️⃣ ✏️ *Update Existing CV* - I'll prefill ALL 18+ categories
2️⃣ 🆕 *Create New CV* - Start fresh (data still saved)
3️⃣ 💌 *Cover Letter Only* - For a specific job
4️⃣ 📋 *Quick Add* - Add missing categories only
5️⃣ 🔄 *Start Over* - Clear all saved data

*Quick tip:* Using your saved info saves 10-15 minutes! ⚡`;
    
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
          [{ text: "📋 Quick Add Missing Categories", callback_data: "prefill_quickadd" }],
          [{ text: "🔄 Start Over", callback_data: "prefill_startover" }]
        ]
      }
    });
    
    return true;
  }

  calculateCompleteness(prefill) {
    let score = 0;
    let total = 0;
    
    // Personal info (20%)
    const personalFields = ['full_name', 'email', 'phone', 'location'];
    total += personalFields.length;
    personalFields.forEach(f => { if (prefill[f]) score++; });
    
    // Employment (15%)
    total += 1;
    if (prefill.total_jobs > 0) score++;
    
    // Education (10%)
    total += 1;
    if (prefill.total_education > 0) score++;
    
    // Skills (15%)
    total += 1;
    if (prefill.total_skills > 3) score++;
    
    // 18+ Categories (40% total - 10 categories x 4% each)
    const categories = ['certifications', 'languages', 'projects', 'achievements', 
                       'volunteer', 'leadership', 'awards', 'publications', 
                       'conferences', 'referees'];
    categories.forEach(cat => {
      total += 1;
      if (prefill[`total_${cat}`] > 0) score++;
    });
    
    return Math.round((score / total) * 100);
  }
  
  async applyPrefillData(session, updateMode = false, categoriesOnly = []) {
    if (!session.data.prefill_data) {
      return null;
    }
    
    const prefill = session.data.prefill_data;
    
    // Initialize CV data structure with all 18+ categories
    if (!session.data.cv_data) {
      session.data.cv_data = this.getEmptyCVStructure();
    }
    
    const cvData = session.data.cv_data;
    
    if (!updateMode) {
      // Fresh CV - use all prefill data (18+ categories)
      
      // Personal Info
      cvData.personal = {
        full_name: prefill.full_name,
        email: prefill.email,
        primary_phone: prefill.phone,
        alternative_phone: prefill.alternative_phone,
        location: prefill.location,
        physical_address: prefill.physical_address,
        nationality: prefill.nationality,
        date_of_birth: prefill.date_of_birth,
        linkedin: prefill.linkedin,
        github: prefill.github,
        portfolio_url: prefill.portfolio_url
      };
      
      // Professional Summary
      cvData.professional_summary = prefill.professional_summary || '';
      
      // Education
      if (prefill.education_institution && prefill.highest_education) {
        cvData.education = [{
          level: prefill.highest_education,
          field: prefill.education_field || '',
          institution: prefill.education_institution,
          year: prefill.education_year || '',
          grade: prefill.education_grade || ''
        }];
      }
      
      // Skills (categorized)
      cvData.skills = {
        technical: prefill.technical_skills || [],
        soft: prefill.soft_skills || [],
        tools: prefill.tools_skills || []
      };
      
      // Employment
      if (prefill.last_job_title && prefill.last_company) {
        cvData.employment = [{
          title: prefill.last_job_title,
          company: prefill.last_company,
          duration: prefill.last_job_duration || 'Previous experience',
          responsibilities: prefill.last_job_responsibilities || [],
          achievements: prefill.last_job_achievements || []
        }];
      }
      
      // 18+ Categories - Preserve existing data
      cvData.certifications = prefill.certifications || [];
      cvData.languages = prefill.languages || [];
      cvData.projects = prefill.projects || [];
      cvData.achievements = prefill.achievements || [];
      cvData.volunteer = prefill.volunteer || [];
      cvData.leadership = prefill.leadership || [];
      cvData.awards = prefill.awards || [];
      cvData.publications = prefill.publications || [];
      cvData.conferences = prefill.conferences || [];
      cvData.referees = prefill.referees || [];
      cvData.interests = prefill.interests || [];
      cvData.social_media = prefill.social_media || {};
      cvData.portfolio = prefill.portfolio || [];
      
    } else if (categoriesOnly.length > 0) {
      // Only update specific categories
      for (const category of categoriesOnly) {
        if (prefill[category]) {
          cvData[category] = prefill[category];
        }
      }
    }
    
    return prefill;
  }

  getEmptyCVStructure() {
    return {
      personal: {},
      professional_summary: '',
      employment: [],
      education: [],
      skills: { technical: [], soft: [], tools: [] },
      certifications: [],
      languages: [],
      projects: [],
      achievements: [],
      volunteer: [],
      leadership: [],
      awards: [],
      publications: [],
      conferences: [],
      referees: [],
      interests: [],
      social_media: {},
      portfolio: []
    };
  }

  async getMissingCategories(prefill) {
    const missing = [];
    const categories = [
      { key: 'certifications', label: 'Certifications', priority: 'medium' },
      { key: 'languages', label: 'Languages', priority: 'low' },
      { key: 'projects', label: 'Projects', priority: 'medium' },
      { key: 'achievements', label: 'Achievements', priority: 'high' },
      { key: 'volunteer', label: 'Volunteer Experience', priority: 'low' },
      { key: 'leadership', label: 'Leadership Roles', priority: 'medium' },
      { key: 'awards', label: 'Awards', priority: 'low' },
      { key: 'publications', label: 'Publications', priority: 'low' },
      { key: 'conferences', label: 'Conferences', priority: 'low' },
      { key: 'referees', label: 'Referees', priority: 'medium' }
    ];
    
    for (const cat of categories) {
      const value = prefill[cat.key];
      if (!value || (Array.isArray(value) && value.length === 0)) {
        missing.push(cat);
      }
    }
    
    return missing;
  }
  
  async updatePrefillCache(clientId, newData) {
    const existing = this.prefilledData.get(clientId);
    if (existing) {
      existing.data = { 
        ...existing.data, 
        ...newData, 
        updated_at: new Date().toISOString() 
      };
      existing.timestamp = Date.now();
      this.prefilledData.set(clientId, existing);
    }
  }
  
  clearCache(clientId) {
    this.prefilledData.delete(clientId);
  }

  clearAllCache() {
    this.prefilledData.clear();
  }

  getCacheStats() {
    return {
      total_cached: this.prefilledData.size,
      clients: Array.from(this.prefilledData.keys())
    };
  }
}

module.exports = PrefillForms;