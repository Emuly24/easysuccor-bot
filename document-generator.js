// document-generator.js - Complete Professional CV & Cover Letter Generator with DeepSeek AI
// MAXIMUM EXTRACTION - Captures EVERY detail from any document

const { Document, Packer, Paragraph, TextRun, AlignmentType, BorderStyle, ImageRun } = require('docx');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const axios = require('axios');
const { OpenAI } = require('openai');

class DocumentGenerator {
  constructor() {
    // Base paths
    this.exportsPath = path.join(__dirname, 'exports');
    this.cvPath = path.join(this.exportsPath, 'cv');
    this.coverPath = path.join(this.exportsPath, 'coverletters');
    this.uploadsPath = path.join(__dirname, 'uploads');
    this.convertedPath = path.join(this.uploadsPath, 'converted');
    this.clientArchivePath = path.join(this.exportsPath, 'client_archives');
    this.tempPath = path.join(__dirname, 'temp');
    
    // Create all directories
    [this.cvPath, this.coverPath, this.convertedPath, this.clientArchivePath, this.tempPath].forEach(p => {
      if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
    });
    
    // Client document registry
    this.clientRegistryPath = path.join(this.exportsPath, 'client_registry.json');
    this.clientRegistry = this.loadClientRegistry();
    
    // Initialize DeepSeek AI client
    this.deepseek = new OpenAI({
      apiKey: process.env.DEEPSEEK_API_KEY,
      baseURL: 'https://api.deepseek.com/v1'
    });
  }

  loadClientRegistry() {
    if (fs.existsSync(this.clientRegistryPath)) {
      return JSON.parse(fs.readFileSync(this.clientRegistryPath, 'utf8'));
    }
    return {};
  }

  saveClientRegistry() {
    fs.writeFileSync(this.clientRegistryPath, JSON.stringify(this.clientRegistry, null, 2));
  }

  // ============ APTOS FONT STYLES ============
  getAptosStyles(colors) {
    return {
      default: { document: { run: { font: "Aptos", size: 24 } } },
      paragraphStyles: [
        { id: "name", name: "Name", basedOn: "Normal", run: { font: "Aptos", size: 48, bold: true, color: colors.primary }, paragraph: { spacing: { after: 80 }, alignment: AlignmentType.CENTER } },
        { id: "title", name: "Title", basedOn: "Normal", run: { font: "Aptos", size: 28, bold: true, italics: true, color: colors.secondary }, paragraph: { spacing: { after: 120 }, alignment: AlignmentType.CENTER } },
        { id: "sectionHeading", name: "Section Heading", basedOn: "Normal", run: { font: "Aptos", size: 32, bold: true, color: colors.primary }, paragraph: { spacing: { before: 240, after: 80 }, border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: colors.accent } } } },
        { id: "subsectionHeading", name: "Subsection Heading", basedOn: "Normal", run: { font: "Aptos", size: 28, bold: true, color: colors.secondary }, paragraph: { spacing: { before: 120, after: 40 } } },
        { id: "companyDate", name: "Company and Date", basedOn: "Normal", run: { font: "Aptos", size: 24, bold: true }, paragraph: { spacing: { after: 20 } } },
        { id: "bodyText", name: "Body Text", basedOn: "Normal", run: { font: "Aptos", size: 24 }, paragraph: { spacing: { after: 80 } } },
        { id: "bulletPoint", name: "Bullet Point", basedOn: "Normal", run: { font: "Aptos", size: 24 }, paragraph: { spacing: { after: 40 }, indent: { left: 480 } } },
        { id: "contactInfo", name: "Contact Info", basedOn: "Normal", run: { font: "Aptos", size: 22, color: "666666" }, paragraph: { spacing: { after: 60 }, alignment: AlignmentType.CENTER } },
        { id: "refereeName", name: "Referee Name", basedOn: "Normal", run: { font: "Aptos", size: 26, bold: true }, paragraph: { spacing: { after: 20 } } },
        { id: "refereeDetails", name: "Referee Details", basedOn: "Normal", run: { font: "Aptos", size: 22, color: "555555" }, paragraph: { spacing: { after: 40 } } }
      ]
    };
  }

  getIndustryColors(industry) {
    const colors = {
      'carpentry': { primary: '2C3E50', secondary: '7F8C8D', accent: 'D35400' },
      'agriculture': { primary: '27AE60', secondary: '2ECC71', accent: 'F39C12' },
      'healthcare': { primary: '2980B9', secondary: '3498DB', accent: 'E74C3C' },
      'technology': { primary: '8E44AD', secondary: '9B59B6', accent: '3498DB' },
      'education': { primary: '1ABC9C', secondary: '16A085', accent: 'F1C40F' },
      'project_management': { primary: '2C3E50', secondary: '34495E', accent: 'E67E22' },
      'corporate': { primary: '1F4E78', secondary: '2C7DA0', accent: 'FF6B6B' },
      'default': { primary: '2C3E50', secondary: '7F8C8D', accent: 'E67E22' }
    };
    return colors[industry] || colors.default;
  }

  // ============ DEEPSEEK AI EXTRACTION (PRIMARY METHOD - MAXIMUM DETAIL) ============
  
  async extractWithDeepSeek(filePath, fileType = 'cv') {
    try {
      const rawText = await this.extractTextFromFile(filePath);
      
      if (!rawText || rawText.length < 50) {
        return { success: false, error: "Could not extract enough text from document" };
      }
      
      const systemPrompt = `You are an expert CV parser with 99% accuracy. Extract EVERY piece of information from the CV text below. Be thorough - capture everything.

Extract ALL of the following as a JSON object:

1. personal: { full_name, email, phone, alternative_phone, whatsapp_phone, location, physical_address, nationality, linkedin, github, portfolio, professional_title, date_of_birth, gender, marital_status, driving_license }

2. professional_summary: The complete career summary paragraph

3. employment: Array with for each job: { title, company, location, start_date, end_date, duration, responsibilities (array of strings), achievements (array of strings), technologies_used (array), team_size, reporting_to, key_projects (array) }

4. education: Array with for each: { level, field, institution, location, start_date, graduation_date, gpa, achievements, courses (array) }

5. skills: Object with { technical (array), soft (array), tools (array), languages (array), certifications (array) }

6. certifications: Array of { name, issuer, date, expiry_date, credential_id, url }

7. languages: Array of { name, proficiency, certification }

8. projects: Array of { name, description, technologies, role, team_size, duration, link, outcome }

9. achievements: Array of { title, description, date, issuer }

10. volunteer: Array of { role, organization, duration, responsibilities }

11. leadership: Array of { role, organization, duration, impact }

12. publications: Array of { title, publisher, date, url, authors }

13. conferences: Array of { name, role, date, location }

14. awards: Array of { name, issuer, date, description }

15. referees: Array of { name, position, company, email, phone, relationship }

16. interests: Array of interests/hobbies

17. social_media: { twitter, facebook, instagram, youtube }

18. additional_sections: Any other sections found (as array of { title, content })

Return ONLY valid JSON. If a field is not found, use null or empty array. DO NOT skip any section.`;

      const userPrompt = `Extract EVERYTHING from this CV. Be thorough and don't miss any detail:\n\n${rawText.substring(0, 15000)}`;

      const response = await this.deepseek.chat.completions.create({
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.1,
        max_tokens: 12000,
        response_format: { type: 'json_object' }
      });

      const extractedData = JSON.parse(response.choices[0].message.content);
      const summary = this.generateDeepSeekSummary(extractedData);
      
      return {
        success: true,
        data: extractedData,
        summary: summary,
        method: 'deepseek_ai',
        tokens_used: response.usage?.total_tokens || 0,
        raw_text_length: rawText.length
      };
      
    } catch (error) {
      console.error('DeepSeek extraction error:', error);
      const fallbackResult = await this.extractFullCVData(filePath, fileType);
      return { ...fallbackResult, method: 'local_fallback', error: error.message };
    }
  }

  generateDeepSeekSummary(extractedData) {
    const personal = extractedData.personal || {};
    const employment = extractedData.employment || [];
    const education = extractedData.education || [];
    const skills = extractedData.skills || {};
    const certifications = extractedData.certifications || [];
    const languages = extractedData.languages || [];
    const projects = extractedData.projects || [];
    const achievements = extractedData.achievements || [];
    const referees = extractedData.referees || [];
    const volunteer = extractedData.volunteer || [];
    const leadership = extractedData.leadership || [];
    const publications = extractedData.publications || [];
    const awards = extractedData.awards || [];
    const conferences = extractedData.conferences || [];
    const additional = extractedData.additional_sections || [];
    
    const allSkills = [...(skills.technical || []), ...(skills.soft || []), ...(skills.tools || [])];
    
    let summary = `📄 *DEEPSEEK AI EXTRACTION SUMMARY - MAXIMUM DETAIL*\n\n`;
    summary += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    summary += `👤 *PERSONAL INFORMATION*\n`;
    summary += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    summary += `• Name: ${personal.full_name || 'Not found'}\n`;
    summary += `• Email: ${personal.email || 'Not found'}\n`;
    summary += `• Primary Phone: ${personal.phone || personal.primary_phone || 'Not found'}\n`;
    if (personal.alternative_phone) summary += `• Alternative Phone: ${personal.alternative_phone}\n`;
    if (personal.whatsapp_phone) summary += `• WhatsApp: ${personal.whatsapp_phone}\n`;
    summary += `• Location: ${personal.location || 'Not found'}\n`;
    if (personal.physical_address) summary += `• Address: ${personal.physical_address}\n`;
    if (personal.nationality) summary += `• Nationality: ${personal.nationality}\n`;
    summary += `• LinkedIn: ${personal.linkedin || 'Not found'}\n`;
    if (personal.github) summary += `• GitHub: ${personal.github}\n`;
    if (personal.portfolio) summary += `• Portfolio: ${personal.portfolio}\n`;
    if (personal.professional_title) summary += `• Title: ${personal.professional_title}\n`;
    if (personal.date_of_birth) summary += `• Date of Birth: ${personal.date_of_birth}\n`;
    summary += `\n`;
    
    summary += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    summary += `💼 *WORK EXPERIENCE* (${employment.length} entries)\n`;
    summary += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    for (const job of employment.slice(0, 3)) {
      summary += `• *${job.title}* at ${job.company || 'Unknown'}\n`;
      if (job.duration) summary += `  📅 ${job.duration}\n`;
      if (job.location) summary += `  📍 ${job.location}\n`;
      if (job.achievements && job.achievements.length > 0) {
        summary += `  🏆 Achievements:\n`;
        for (const ach of job.achievements.slice(0, 2)) {
          summary += `    ✓ ${ach.substring(0, 60)}${ach.length > 60 ? '...' : ''}\n`;
        }
      }
      if (job.responsibilities && job.responsibilities.length > 0) {
        summary += `  📋 Key responsibilities: ${job.responsibilities.length} items\n`;
      }
      if (job.technologies_used && job.technologies_used.length > 0) {
        summary += `  🔧 Technologies: ${job.technologies_used.slice(0, 5).join(', ')}\n`;
      }
    }
    if (employment.length > 3) summary += `  + ${employment.length - 3} more positions\n`;
    summary += `\n`;
    
    summary += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    summary += `🎓 *EDUCATION* (${education.length} entries)\n`;
    summary += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    for (const edu of education.slice(0, 2)) {
      summary += `• ${edu.level}${edu.field ? ` in ${edu.field}` : ''}\n`;
      if (edu.institution) summary += `  🏛️ ${edu.institution}\n`;
      if (edu.graduation_date) summary += `  📅 ${edu.graduation_date}\n`;
      if (edu.gpa) summary += `  📊 GPA: ${edu.gpa}\n`;
      if (edu.courses && edu.courses.length > 0) {
        summary += `  📚 Key courses: ${edu.courses.slice(0, 3).join(', ')}\n`;
      }
    }
    summary += `\n`;
    
    summary += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    summary += `⚡ *SKILLS* (${allSkills.length} total)\n`;
    summary += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    if (skills.technical && skills.technical.length > 0) {
      summary += `• Technical: ${skills.technical.slice(0, 10).join(', ')}${skills.technical.length > 10 ? '...' : ''}\n`;
    }
    if (skills.soft && skills.soft.length > 0) {
      summary += `• Soft: ${skills.soft.slice(0, 6).join(', ')}${skills.soft.length > 6 ? '...' : ''}\n`;
    }
    if (skills.tools && skills.tools.length > 0) {
      summary += `• Tools: ${skills.tools.slice(0, 6).join(', ')}${skills.tools.length > 6 ? '...' : ''}\n`;
    }
    if (skills.certifications && skills.certifications.length > 0) {
      summary += `• Certifications: ${skills.certifications.slice(0, 4).join(', ')}\n`;
    }
    summary += `\n`;
    
    if (certifications.length > 0) {
      summary += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
      summary += `📜 *CERTIFICATIONS* (${certifications.length})\n`;
      summary += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
      for (const cert of certifications.slice(0, 4)) {
        summary += `• ${cert.name}${cert.issuer ? ` (${cert.issuer})` : ''}${cert.date ? `, ${cert.date}` : ''}\n`;
      }
      summary += `\n`;
    }
    
    if (languages.length > 0) {
      summary += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
      summary += `🌍 *LANGUAGES* (${languages.length})\n`;
      summary += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
      for (const lang of languages) {
        summary += `• ${lang.name} (${lang.proficiency || 'Professional'})\n`;
      }
      summary += `\n`;
    }
    
    if (projects.length > 0) {
      summary += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
      summary += `📁 *PROJECTS* (${projects.length})\n`;
      summary += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
      for (const proj of projects.slice(0, 3)) {
        summary += `• ${proj.name}\n`;
        if (proj.technologies) summary += `  🔧 ${proj.technologies}\n`;
        if (proj.role) summary += `  👤 Role: ${proj.role}\n`;
      }
      summary += `\n`;
    }
    
    if (achievements.length > 0) {
      summary += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
      summary += `🏆 *ACHIEVEMENTS & AWARDS* (${achievements.length + (awards || []).length})\n`;
      summary += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
      for (const ach of achievements.slice(0, 3)) {
        summary += `• ${typeof ach === 'string' ? ach.substring(0, 70) : ach.title?.substring(0, 70)}${ach.length > 70 ? '...' : ''}\n`;
      }
      for (const award of (awards || []).slice(0, 2)) {
        summary += `• 🏅 ${award.name}${award.issuer ? ` - ${award.issuer}` : ''}\n`;
      }
      summary += `\n`;
    }
    
    if (volunteer.length > 0) {
      summary += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
      summary += `🤝 *VOLUNTEER EXPERIENCE* (${volunteer.length})\n`;
      summary += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
      for (const vol of volunteer.slice(0, 2)) {
        summary += `• ${vol.role} at ${vol.organization}\n`;
      }
      summary += `\n`;
    }
    
    if (leadership.length > 0) {
      summary += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
      summary += `👔 *LEADERSHIP ROLES* (${leadership.length})\n`;
      summary += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
      for (const lead of leadership.slice(0, 2)) {
        summary += `• ${lead.role} at ${lead.organization}\n`;
      }
      summary += `\n`;
    }
    
    if (publications.length > 0) {
      summary += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
      summary += `📖 *PUBLICATIONS* (${publications.length})\n`;
      summary += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
      for (const pub of publications.slice(0, 2)) {
        summary += `• ${pub.title} - ${pub.publisher || ''}\n`;
      }
      summary += `\n`;
    }
    
    if (conferences.length > 0) {
      summary += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
      summary += `🎤 *CONFERENCES* (${conferences.length})\n`;
      summary += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
      for (const conf of conferences.slice(0, 2)) {
        summary += `• ${conf.name} - ${conf.role || 'Attendee'}\n`;
      }
      summary += `\n`;
    }
    
    if (referees.length > 0) {
      summary += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
      summary += `👥 *REFEREES* (${referees.length})\n`;
      summary += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
      for (const ref of referees.slice(0, 2)) {
        summary += `• ${ref.name}${ref.position ? ` - ${ref.position}` : ''}\n`;
        if (ref.company) summary += `  🏢 ${ref.company}\n`;
      }
      summary += `\n`;
    }
    
    if (additional.length > 0) {
      summary += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
      summary += `📎 *ADDITIONAL SECTIONS* (${additional.length})\n`;
      summary += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
      for (const section of additional.slice(0, 3)) {
        summary += `• ${section.title}\n`;
      }
      summary += `\n`;
    }
    
    summary += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    summary += `✨ *EXTRACTION COMPLETE*\n`;
    summary += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    summary += `Powered by DeepSeek AI\n`;
    summary += `✅ ${employment.length} jobs | ${education.length} degrees | ${allSkills.length} skills\n`;
    summary += `✅ ${certifications.length} certs | ${languages.length} languages | ${projects.length} projects\n`;
    summary += `✅ ${achievements.length} achievements | ${referees.length} referees\n\n`;
    summary += `Type *CONTINUE* to proceed with delivery options, or\n`;
    summary += `type *EDIT* followed by what you want to change.`;
    
    return summary;
  }

  // ============ EXTRACT FULL CV DATA FROM URL ============

  async extractFullCVDataFromUrl(fileUrl, fileName) {
    try {
      const tempFilePath = path.join(this.tempPath, `temp_${Date.now()}_${fileName}`);
      await this.downloadFile(fileUrl, tempFilePath);
      const result = await this.extractWithDeepSeek(tempFilePath, 'cv');
      fs.unlinkSync(tempFilePath);
      return result;
    } catch (error) {
      console.error('extractFullCVDataFromUrl error:', error);
      const tempFilePath = path.join(this.tempPath, `temp_${Date.now()}_${fileName}`);
      await this.downloadFile(fileUrl, tempFilePath);
      const fallbackResult = await this.extractFullCVData(tempFilePath, 'cv');
      fs.unlinkSync(tempFilePath);
      return { ...fallbackResult, method: 'local_fallback' };
    }
  }

  async downloadFile(url, outputPath) {
    const response = await axios({ method: 'GET', url: url, responseType: 'stream' });
    const writer = fs.createWriteStream(outputPath);
    response.data.pipe(writer);
    return new Promise((resolve, reject) => {
      writer.on('finish', () => resolve(outputPath));
      writer.on('error', reject);
    });
  }

  // ============ LOCAL EXTRACTION (FALLBACK) ============

  async extractFullCVData(filePath, fileType = 'cv') {
    try {
      const rawText = await this.extractTextFromFile(filePath);
      const structuredData = this.intelligentlyParseCVText(rawText, fileType);
      return { success: true, data: structuredData };
    } catch (error) {
      console.error('Extraction error:', error);
      return { success: false, error: error.message };
    }
  }

  async extractTextFromFile(filePath) {
    const fileExt = path.extname(filePath).toLowerCase();
    let text = '';
    
    if (fileExt === '.txt') {
      text = fs.readFileSync(filePath, 'utf8');
    } else if (fileExt === '.pdf') {
      try {
        const txtPath = filePath.replace('.pdf', '.txt');
        await execPromise(`pdftotext -layout "${filePath}" "${txtPath}"`);
        text = fs.readFileSync(txtPath, 'utf8');
        fs.unlinkSync(txtPath);
      } catch (error) {
        console.error('PDF extraction error:', error);
        text = '';
      }
    } else if (fileExt === '.docx') {
      try {
        const txtPath = filePath.replace('.docx', '.txt');
        await execPromise(`docx2txt "${filePath}" "${txtPath}"`);
        text = fs.readFileSync(txtPath, 'utf8');
        fs.unlinkSync(txtPath);
      } catch (error) {
        console.error('DOCX extraction error:', error);
        text = '';
      }
    } else if (['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'].includes(fileExt)) {
      const Tesseract = require('tesseract.js');
      const result = await Tesseract.recognize(filePath, 'eng');
      text = result.data.text;
      console.log(`OCR extracted ${text.length} characters from image`);
    }
    
    return text;
  }

  intelligentlyParseCVText(text, fileType) {
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    
    const cvData = {
      personal: { full_name: '', email: '', primary_phone: '', alternative_phone: '', whatsapp_phone: '', location: '', physical_address: '', nationality: '', linkedin: '', github: '', portfolio: '', professional_title: '' },
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
      referees: []
    };

    for (const line of lines.slice(0, 10)) {
      if (line.length < 50 && !line.includes('@') && !line.match(/[\d-]{10,}/) && line.match(/[A-Z][a-z]+ [A-Z][a-z]+/)) {
        cvData.personal.full_name = line;
        break;
      }
    }
    
    const emailMatch = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
    if (emailMatch) cvData.personal.email = emailMatch[0];
    
    const phoneMatches = text.match(/\+?265[0-9]{9}|0[987][0-9]{8}/g);
    if (phoneMatches) {
      cvData.personal.primary_phone = phoneMatches[0];
      if (phoneMatches[1]) cvData.personal.alternative_phone = phoneMatches[1];
    }
    
    const locationMatch = text.match(/(?:Lilongwe|Blantyre|Mzuzu|Zomba|Malawi)/i);
    if (locationMatch) cvData.personal.location = locationMatch[0];
    
    const linkedinMatch = text.match(/linkedin\.com\/in\/[a-zA-Z0-9-]+/i);
    if (linkedinMatch) cvData.personal.linkedin = linkedinMatch[0];
    
    return cvData;
  }

  // ============ VACANCY EXTRACTION ============
  
  async extractVacancyFromFile(fileUrl, fileName) {
    try {
      const tempFilePath = path.join(this.tempPath, `vacancy_${Date.now()}_${fileName}`);
      await this.downloadFile(fileUrl, tempFilePath);
      const rawText = await this.extractTextFromFile(tempFilePath);
      fs.unlinkSync(tempFilePath);
      
      if (!rawText || rawText.length < 50) {
        return { success: false, error: "Could not extract text from vacancy" };
      }
      
      const systemPrompt = `You are an expert job vacancy parser. Extract ALL information from the job vacancy text and return as JSON with:
- company, position, location, salary, deadline, job_type
- experience_required, education_required
- requirements (array), responsibilities (array), benefits (array)
- contact_person, contact_email, contact_phone, application_method
- skills_required (array), nice_to_have (array)

Return ONLY valid JSON.`;

      const response = await this.deepseek.chat.completions.create({
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: rawText.substring(0, 8000) }
        ],
        temperature: 0.1,
        max_tokens: 4000,
        response_format: { type: 'json_object' }
      });

      const vacancyData = JSON.parse(response.choices[0].message.content);
      vacancyData.has_vacancy = true;
      return vacancyData;
      
    } catch (error) {
      console.error('Vacancy extraction error:', error);
      return { has_vacancy: false, error: error.message };
    }
  }

  // ============ CV GENERATION ============
  
  async generateCV(cvData, industry = null, format = 'docx', vacancyData = null, certificatesData = null) {
    const detectedIndustry = industry || this.detectIndustry(cvData);
    const colors = this.getIndustryColors(detectedIndustry);
    const styles = this.getAptosStyles(colors);
    
    const content = this.buildCVContent(cvData, colors);
    
    if (content.length === 0) {
      return { success: false, error: "No CV data provided" };
    }
    
    const doc = new Document({ styles, sections: [{
      properties: { page: { margin: { top: 720, bottom: 720, left: 720, right: 720 } } },
      children: content
    }] });
    
    const fileName = `CV_${cvData.personal?.full_name?.replace(/\s/g, '_') || 'Candidate'}_${Date.now()}.docx`;
    const filePath = path.join(this.cvPath, fileName);
    const buffer = await Packer.toBuffer(doc);
    fs.writeFileSync(filePath, buffer);
    
    return { success: true, filePath, fileName, industry: detectedIndustry };
  }

  buildCVContent(cvData, colors) {
    const personal = cvData.personal || {};
    const content = [];
    
    if (!personal.full_name) return [];
    
    content.push(new Paragraph({ text: personal.full_name.toUpperCase(), style: "name" }));
    
    if (personal.professional_title) {
      content.push(new Paragraph({ text: personal.professional_title, style: "title" }));
    }
    
    const contactParts = [];
    if (personal.email) contactParts.push(`✉️ ${personal.email}`);
    if (personal.primary_phone) contactParts.push(`📞 ${personal.primary_phone}`);
    if (personal.location) contactParts.push(`📍 ${personal.location}`);
    if (contactParts.length) {
      content.push(new Paragraph({ text: contactParts.join(' | '), style: "contactInfo" }));
    }
    
    if (personal.linkedin) content.push(new Paragraph({ text: `🔗 ${personal.linkedin}`, style: "contactInfo" }));
    if (personal.github) content.push(new Paragraph({ text: `💻 ${personal.github}`, style: "contactInfo" }));
    
    if (cvData.professional_summary) {
      content.push(new Paragraph({ text: "Professional Summary", style: "sectionHeading" }));
      content.push(new Paragraph({ text: cvData.professional_summary.substring(0, 600), style: "bodyText" }));
    }
    
    // Skills section
    const allSkills = [];
    if (cvData.skills) {
      if (cvData.skills.technical) allSkills.push(...cvData.skills.technical);
      if (cvData.skills.soft) allSkills.push(...cvData.skills.soft);
      if (cvData.skills.tools) allSkills.push(...cvData.skills.tools);
    }
    if (allSkills.length > 0) {
      content.push(new Paragraph({ text: "Core Competencies", style: "sectionHeading" }));
      content.push(new Paragraph({ text: allSkills.join(' • '), style: "bodyText" }));
    }
    
    // Work Experience
    if (cvData.employment?.length) {
      content.push(new Paragraph({ text: "Work Experience", style: "sectionHeading" }));
      for (const job of cvData.employment) {
        const titleLine = job.title + (job.company ? ` | ${job.company}` : '');
        content.push(new Paragraph({ text: titleLine, style: "subsectionHeading" }));
        if (job.duration) content.push(new Paragraph({ text: job.duration, style: "companyDate" }));
        if (job.location) content.push(new Paragraph({ text: job.location, style: "companyDate" }));
        if (job.achievements?.length) {
          for (const ach of job.achievements) {
            content.push(new Paragraph({ text: `✓ ${ach}`, style: "bulletPoint" }));
          }
        }
        if (job.responsibilities?.length) {
          for (const resp of job.responsibilities) {
            content.push(new Paragraph({ text: `• ${resp}`, style: "bulletPoint" }));
          }
        }
        content.push(new Paragraph({ text: "" }));
      }
    }
    
    // Education
    if (cvData.education?.length) {
      content.push(new Paragraph({ text: "Education", style: "sectionHeading" }));
      for (const edu of cvData.education) {
        const eduLine = edu.level + (edu.field ? ` in ${edu.field}` : '');
        content.push(new Paragraph({ text: eduLine, style: "subsectionHeading" }));
        if (edu.institution) content.push(new Paragraph({ text: edu.institution, style: "companyDate" }));
        if (edu.graduation_date) content.push(new Paragraph({ text: edu.graduation_date, style: "bodyText" }));
        if (edu.gpa) content.push(new Paragraph({ text: `GPA: ${edu.gpa}`, style: "bodyText" }));
        content.push(new Paragraph({ text: "" }));
      }
    }
    
    // Certifications
    if (cvData.certifications?.length) {
      content.push(new Paragraph({ text: "Certifications", style: "sectionHeading" }));
      for (const cert of cvData.certifications) {
        let certText = cert.name;
        if (cert.issuer) certText += ` - ${cert.issuer}`;
        if (cert.date) certText += ` (${cert.date})`;
        content.push(new Paragraph({ text: `• ${certText}`, style: "bulletPoint" }));
      }
      content.push(new Paragraph({ text: "" }));
    }
    
    // Languages
    if (cvData.languages?.length) {
      content.push(new Paragraph({ text: "Languages", style: "sectionHeading" }));
      for (const lang of cvData.languages) {
        content.push(new Paragraph({ text: `• ${lang.name} (${lang.proficiency || 'Professional'})`, style: "bulletPoint" }));
      }
      content.push(new Paragraph({ text: "" }));
    }
    
    // Projects
    if (cvData.projects?.length) {
      content.push(new Paragraph({ text: "Key Projects", style: "sectionHeading" }));
      for (const proj of cvData.projects.slice(0, 5)) {
        content.push(new Paragraph({ text: `• ${proj.name}`, style: "subsectionHeading" }));
        if (proj.description) content.push(new Paragraph({ text: proj.description.substring(0, 200), style: "bodyText" }));
        if (proj.technologies) content.push(new Paragraph({ text: `Technologies: ${proj.technologies}`, style: "companyDate" }));
        content.push(new Paragraph({ text: "" }));
      }
    }
    
    // Volunteer
    if (cvData.volunteer?.length) {
      content.push(new Paragraph({ text: "Volunteer Experience", style: "sectionHeading" }));
      for (const vol of cvData.volunteer) {
        content.push(new Paragraph({ text: `${vol.role} at ${vol.organization}`, style: "subsectionHeading" }));
        if (vol.duration) content.push(new Paragraph({ text: vol.duration, style: "companyDate" }));
        content.push(new Paragraph({ text: "" }));
      }
    }
    
    // Referees
    if (cvData.referees?.length) {
      content.push(new Paragraph({ text: "Referees", style: "sectionHeading" }));
      for (const ref of cvData.referees) {
        if (ref.name) content.push(new Paragraph({ text: ref.name, style: "refereeName" }));
        if (ref.position) content.push(new Paragraph({ text: ref.position, style: "refereeDetails" }));
        if (ref.company) content.push(new Paragraph({ text: ref.company, style: "refereeDetails" }));
        if (ref.contact) content.push(new Paragraph({ text: `📞 ${ref.contact}`, style: "refereeDetails" }));
        if (ref.email) content.push(new Paragraph({ text: `✉️ ${ref.email}`, style: "refereeDetails" }));
        content.push(new Paragraph({ text: "" }));
      }
    }
    
    return content;
  }

  async generateCoverLetter(coverData, cvData, personalData = null, hasCertificates = false) {
    const personal = personalData || cvData.personal || {};
    const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
    const industry = this.detectIndustry(cvData);
    const colors = this.getIndustryColors(industry);
    const styles = this.getAptosStyles(colors);
    
    const content = this.buildCoverLetterContent(cvData, coverData, personal, today);
    
    const doc = new Document({ styles, sections: [{
      properties: { page: { margin: { top: 720, bottom: 720, left: 720, right: 720 } } },
      children: content
    }] });
    
    const fileName = `CoverLetter_${personal.full_name?.replace(/\s/g, '_') || 'Candidate'}_${Date.now()}.docx`;
    const filePath = path.join(this.coverPath, fileName);
    const buffer = await Packer.toBuffer(doc);
    fs.writeFileSync(filePath, buffer);
    
    return { success: true, filePath, fileName };
  }

  buildCoverLetterContent(cvData, coverData, personal, today) {
    const employment = cvData.employment || [];
    const skills = cvData.skills || {};
    const allSkills = [...(skills.technical || []), ...(skills.soft || []), ...(skills.tools || [])];
    const vacancyPosition = coverData.position || '';
    const vacancyCompany = coverData.company || '';
    
    const content = [];
    
    if (personal.full_name) {
      content.push(new Paragraph({ text: personal.full_name.toUpperCase(), style: "name" }));
    }
    
    const contactParts = [];
    if (personal.email) contactParts.push(`✉️ ${personal.email}`);
    if (personal.primary_phone) contactParts.push(`📞 ${personal.primary_phone}`);
    if (contactParts.length) {
      content.push(new Paragraph({ text: contactParts.join(' | '), style: "contactInfo" }));
    }
    
    content.push(new Paragraph({ text: today, alignment: AlignmentType.RIGHT, spacing: { after: 200 } }));
    content.push(new Paragraph({ text: `The Hiring Manager`, style: "bodyText" }));
    if (vacancyCompany) content.push(new Paragraph({ text: vacancyCompany, style: "bodyText" }));
    content.push(new Paragraph({ text: "", style: "bodyText" }));
    content.push(new Paragraph({ text: `Dear Hiring Manager,`, style: "bodyText" }));
    content.push(new Paragraph({ text: "", style: "bodyText" }));
    
    if (vacancyPosition) {
      content.push(new Paragraph({ text: `RE: Application for ${vacancyPosition}`, style: "bodyText" }));
      content.push(new Paragraph({ text: "", style: "bodyText" }));
    }
    
    let openingText = `I am writing to express my strong interest in the ${vacancyPosition || 'position'} at ${vacancyCompany || 'your organization'}.`;
    if (employment.length > 0) {
      openingText += ` With my background as ${employment[0].title}, I am confident in my ability to contribute effectively to your team.`;
    }
    content.push(new Paragraph({ text: openingText, style: "bodyText" }));
    content.push(new Paragraph({ text: "", style: "bodyText" }));
    
    if (employment.length > 0 && employment[0].achievements?.length) {
      content.push(new Paragraph({ text: `A key achievement I'm particularly proud of: ${employment[0].achievements[0]}`, style: "bodyText" }));
      content.push(new Paragraph({ text: "", style: "bodyText" }));
    }
    
    if (allSkills.length > 0 && vacancyPosition) {
      content.push(new Paragraph({ text: `My expertise in ${allSkills.slice(0, 3).join(', ')} aligns perfectly with the requirements of this role.`, style: "bodyText" }));
      content.push(new Paragraph({ text: "", style: "bodyText" }));
    }
    
    content.push(new Paragraph({ text: `Thank you for considering my application. I look forward to the opportunity to discuss how my skills and experiences would be a good fit for this position.`, style: "bodyText" }));
    content.push(new Paragraph({ text: "", style: "bodyText" }));
    content.push(new Paragraph({ text: `Yours faithfully,`, style: "bodyText" }));
    content.push(new Paragraph({ text: "", style: "bodyText" }));
    content.push(new Paragraph({ text: personal.full_name || 'Your Name', style: "bodyText" }));
    if (personal.primary_phone) content.push(new Paragraph({ text: personal.primary_phone, style: "bodyText" }));
    if (personal.email) content.push(new Paragraph({ text: personal.email, style: "bodyText" }));
    
    return content;
  }

  detectIndustry(cvData) {
    const allText = [
      ...(cvData.employment?.map(j => `${j.title} ${j.company}`) || []),
      ...((cvData.skills?.technical || [])),
      ...((cvData.skills?.soft || [])),
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

  async convertLegacyDocument(filePath, clientId, documentType = 'cv') {
    try {
      const extractedData = await this.extractFullCVData(filePath, documentType);
      let result;
      if (documentType === 'cv') {
        result = await this.generateCV(extractedData.data);
      } else {
        result = await this.generateCoverLetter({}, extractedData.data);
      }
      return result.success ? result : { success: false, error: result.error };
    } catch (error) {
      console.error('Conversion error:', error);
      return { success: false, error: error.message };
    }
  }
}

module.exports = new DocumentGenerator();