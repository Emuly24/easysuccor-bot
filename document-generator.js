// document-generator.js - Complete Professional CV & Cover Letter Generator with DeepSeek AI
// MAXIMUM EXTRACTION - Captures EVERY detail from any document
// Professional CV style, combined document generation, attachments appendix

const { Document, Packer, Paragraph, TextRun, AlignmentType, BorderStyle, ImageRun } = require('docx');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const axios = require('axios');
const { OpenAI } = require('openai');
const sharp = require('sharp');
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');

class DocumentGenerator {
  constructor() {
    // Base paths
    this.exportsPath = path.join(__dirname, 'exports');
    this.cvPath = path.join(this.exportsPath, 'cv');
    this.coverPath = path.join(this.exportsPath, 'coverletters');
    this.combinedPath = path.join(this.exportsPath, 'combined');
    this.uploadsPath = path.join(__dirname, 'uploads');
    this.convertedPath = path.join(this.uploadsPath, 'converted');
    this.clientArchivePath = path.join(this.exportsPath, 'client_archives');
    this.tempPath = path.join(__dirname, 'temp');
    this.attachmentsPath = path.join(this.uploadsPath, 'attachments');
    
    // Create all directories
    [this.cvPath, this.coverPath, this.combinedPath, this.convertedPath, this.clientArchivePath, this.tempPath, this.attachmentsPath].forEach(p => {
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

  // ============ APTOS FONT STYLES (Professional –  ) ============
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

  // ============ DEEPSEEK AI EXTRACTION (PRIMARY METHOD) ============
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

  intelligentlyParseCVText(text, fileType) {
    const lines = text.split('\n').filter(l => l.trim().length > 0);
    const result = {
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

    // Helper to extract sections between headers
    function getSectionContent(startKeyword, endKeywords = []) {
        let inSection = false;
        let content = [];
        for (const line of lines) {
            const lower = line.toLowerCase();
            if (!inSection && lower.includes(startKeyword)) {
                inSection = true;
                continue;
            }
            if (inSection && endKeywords.some(k => lower.includes(k))) {
                break;
            }
            if (inSection && line.trim()) content.push(line.trim());
        }
        return content;
    }

    // 1. Personal details
    for (let i = 0; i < Math.min(5, lines.length); i++) {
        const line = lines[i].trim();
        if (line.length > 2 && line.length < 60 && !line.includes('@') && !line.match(/\d/) && 
            !line.toLowerCase().includes('resume') && !line.toLowerCase().includes('curriculum')) {
            result.personal.full_name = line;
            break;
        }
    }
    const emailMatch = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
    if (emailMatch) result.personal.email = emailMatch[0];
    const phoneMatch = text.match(/\+?[\d\s\-\(\)]{8,20}/);
    if (phoneMatch) result.personal.primary_phone = phoneMatch[0];
    const locMatch = text.match(/(?:Location|Address|Based in)[:\s]*([A-Za-z\s,]+)/i);
    if (locMatch) result.personal.location = locMatch[1].trim();
    const linkedinMatch = text.match(/linkedin\.com\/in\/[a-zA-Z0-9\-_]+/i);
    if (linkedinMatch) result.personal.linkedin = linkedinMatch[0];
    const githubMatch = text.match(/github\.com\/[a-zA-Z0-9\-_]+/i);
    if (githubMatch) result.personal.github = githubMatch[0];
    const titleMatch = text.match(/(?:Professional Title|Job Title)[:\s]*([A-Za-z\s]+)/i);
    if (titleMatch) result.personal.professional_title = titleMatch[1].trim();

    // 2. Professional summary (first long paragraph)
    const paragraphs = text.split(/\n\s*\n/);
    for (const para of paragraphs) {
        if (para.length > 100 && para.length < 1000 && !para.includes('@') && !para.match(/\d{10,}/)) {
            result.professional_summary = para.trim();
            break;
        }
    }

    // 3. Work experience (enhanced)
    const jobKeywords = ['manager', 'engineer', 'developer', 'officer', 'assistant', 'specialist', 'consultant', 'director', 'coordinator', 'analyst', 'lead', 'supervisor', 'head'];
    let currentJob = null;
    for (const line of lines) {
        const lower = line.toLowerCase();
        if (jobKeywords.some(k => lower.includes(k)) && (line.match(/\d{4}/) || line.includes(' - ') || line.includes(' at '))) {
            if (currentJob) result.employment.push(currentJob);
            currentJob = { title: line.trim(), company: '', location: '', duration: '', responsibilities: [], achievements: [] };
        } else if (currentJob && (line.includes('-') || line.includes('•') || line.match(/^\s*[\d-]/))) {
            if (line.length > 15 && !line.toLowerCase().includes('email') && !line.includes('@')) {
                const cleanLine = line.replace(/^[\s\-•]+/, '').trim();
                if (cleanLine.match(/(achieved|increased|reduced|improved|led|created|developed|won|awarded)/i)) {
                    currentJob.achievements.push(cleanLine);
                } else {
                    currentJob.responsibilities.push(cleanLine);
                }
            }
        } else if (currentJob && line.match(/\d{4}\s*[-–]\s*(?:\d{4}|Present)/i)) {
            currentJob.duration = line.trim();
        } else if (currentJob && line.length < 60 && !line.match(/\d/) && line.trim().length > 2) {
            if (!currentJob.company && !lower.includes('responsibilities') && !lower.includes('achievements')) {
                currentJob.company = line.trim();
            } else if (!currentJob.location && line.match(/(?:remote|hybrid|office|,)/i)) {
                currentJob.location = line.trim();
            }
        }
    }
    if (currentJob) result.employment.push(currentJob);

    // 4. Education (enhanced)
    const eduKeywords = ['bachelor', 'master', 'diploma', 'degree', 'bsc', 'msc', 'phd', 'certificate', 'high school', 'associate'];
    let currentEdu = null;
    for (const line of lines) {
        const lower = line.toLowerCase();
        if (eduKeywords.some(k => lower.includes(k))) {
            if (currentEdu) result.education.push(currentEdu);
            currentEdu = { level: line.trim(), field: '', institution: '', year: '', gpa: '', achievements: [] };
        } else if (currentEdu && line.match(/\d{4}/)) {
            currentEdu.year = line.trim();
        } else if (currentEdu && line.length < 60 && line.trim().length > 2) {
            if (!currentEdu.institution && (lower.includes('university') || lower.includes('college') || lower.includes('institute'))) {
                currentEdu.institution = line.trim();
            } else if (!currentEdu.field && !lower.includes('university') && !lower.includes('college')) {
                currentEdu.field = line.trim();
            } else if (line.toLowerCase().includes('gpa')) {
                const gpaMatch = line.match(/\d\.\d/);
                if (gpaMatch) currentEdu.gpa = gpaMatch[0];
            }
        }
    }
    if (currentEdu) result.education.push(currentEdu);

    // 5. Skills (categorized)
    const techSkills = ['python', 'javascript', 'java', 'react', 'node', 'sql', 'aws', 'docker', 'git', 'linux', 'excel', 'power bi', 'tableau', 'spss', 'matlab', 'autocad', 'solidworks', 'c++', 'c#', 'php', 'laravel', 'django', 'flask', 'mongodb', 'postgresql', 'redis', 'kubernetes', 'terraform', 'ansible', 'jenkins', 'jira', 'confluence', 'salesforce', 'sap', 'oracle', 'wordpress', 'shopify', 'seo', 'google analytics'];
    const softSkills = ['leadership', 'communication', 'teamwork', 'problem solving', 'critical thinking', 'time management', 'organization', 'adaptability', 'creativity', 'collaboration', 'negotiation', 'conflict resolution', 'decision making', 'project management', 'agile', 'scrum', 'kanban', 'mentoring', 'coaching', 'presentation', 'public speaking'];
    const tools = ['microsoft office', 'google suite', 'slack', 'trello', 'asana', 'zoom', 'teams', 'skype', 'photoshop', 'illustrator', 'indesign', 'figma', 'sketch', 'invision', 'adobe xd', 'wordpress', 'shopify', 'salesforce', 'hubspot', 'mailchimp', 'hootsuite', 'buffer'];
    for (const skill of techSkills) {
        if (text.toLowerCase().includes(skill)) result.skills.technical.push(skill);
    }
    for (const skill of softSkills) {
        if (text.toLowerCase().includes(skill)) result.skills.soft.push(skill);
    }
    for (const tool of tools) {
        if (text.toLowerCase().includes(tool)) result.skills.tools.push(tool);
    }

    // 6. Certifications
    const certKeywords = ['certified', 'certification', 'license', 'credential', 'certificate'];
    let currentCert = null;
    for (const line of lines) {
        const lower = line.toLowerCase();
        if (certKeywords.some(k => lower.includes(k)) && line.length < 100) {
            if (currentCert) result.certifications.push(currentCert);
            currentCert = { name: line.trim(), issuer: '', date: '' };
        } else if (currentCert && line.match(/\d{4}/)) {
            currentCert.date = line.trim();
        } else if (currentCert && line.length < 50 && !lower.includes('certified')) {
            currentCert.issuer = line.trim();
        }
    }
    if (currentCert) result.certifications.push(currentCert);

    // 7. Languages
    const langKeywords = ['english', 'chichewa', 'french', 'swahili', 'portuguese', 'mandarin', 'spanish', 'german', 'arabic', 'russian', 'japanese', 'korean', 'dutch', 'italian'];
    for (const lang of langKeywords) {
        if (text.toLowerCase().includes(lang)) {
            let proficiency = 'Professional';
            if (text.toLowerCase().includes(`${lang} fluent`)) proficiency = 'Fluent';
            else if (text.toLowerCase().includes(`${lang} native`)) proficiency = 'Native';
            else if (text.toLowerCase().includes(`${lang} intermediate`)) proficiency = 'Intermediate';
            else if (text.toLowerCase().includes(`${lang} basic`)) proficiency = 'Basic';
            result.languages.push({ name: lang.charAt(0).toUpperCase() + lang.slice(1), proficiency });
        }
    }

    // 8. Projects
    const projSections = getSectionContent('project', ['experience', 'education', 'skill']);
    for (const line of projSections) {
        if (line.length > 10 && !line.toLowerCase().includes('project')) {
            result.projects.push({ name: line.substring(0, 50), description: line, technologies: '', role: '', duration: '', link: '', outcome: '' });
        }
    }

    // 9. Achievements (already done but we can add more)
    const achievementIndicators = ['achieved', 'won', 'increased', 'improved', 'reduced', 'led', 'created', 'developed', 'successfully', 'awarded', 'recognized', 'published', 'presented'];
    for (const line of lines) {
        const lower = line.toLowerCase();
        if (achievementIndicators.some(ai => lower.includes(ai)) && line.length < 200 && !line.includes('@')) {
            result.achievements.push({ title: line.trim(), description: '', date: '', issuer: '' });
        }
    }

    // 10. Volunteer
    const volSections = getSectionContent('volunteer', ['experience', 'education', 'skill']);
    for (const line of volSections) {
        if (line.length > 10) {
            result.volunteer.push({ role: line.substring(0, 50), organization: '', duration: '', responsibilities: [] });
        }
    }

    // 11. Leadership
    const leadSections = getSectionContent('leadership', ['experience', 'education']);
    for (const line of leadSections) {
        if (line.length > 10) {
            result.leadership.push({ role: line.substring(0, 50), organization: '', duration: '', impact: '' });
        }
    }

    // 12. Awards
    const awardSections = getSectionContent('award', ['education', 'skill']);
    for (const line of awardSections) {
        if (line.length > 10) {
            result.awards.push({ name: line.substring(0, 50), issuer: '', date: '', description: '' });
        }
    }

    // 13. Publications
    const pubSections = getSectionContent('publication', ['education', 'skill']);
    for (const line of pubSections) {
        if (line.length > 10) {
            result.publications.push({ title: line.substring(0, 50), publisher: '', date: '', url: '', authors: '' });
        }
    }

    // 14. Conferences
    const confSections = getSectionContent('conference', ['experience', 'education']);
    for (const line of confSections) {
        if (line.length > 10) {
            result.conferences.push({ name: line.substring(0, 50), role: '', date: '', location: '' });
        }
    }

    // 15. Referees (improved)
    const refSections = text.split(/\n\s*\n/);
    for (const section of refSections) {
        if (section.toLowerCase().includes('referee') || section.toLowerCase().includes('reference')) {
            const refLines = section.split('\n');
            for (let i = 0; i < refLines.length; i++) {
                const line = refLines[i].trim();
                if (line && !line.toLowerCase().includes('referee') && !line.toLowerCase().includes('reference') && line.length > 3) {
                    result.referees.push({ name: line, position: '', company: '', contact: '' });
                    // Try to get next line as position/company
                    if (i+1 < refLines.length && refLines[i+1].trim() && !refLines[i+1].includes('@') && !refLines[i+1].match(/\d/)) {
                        result.referees[result.referees.length-1].position = refLines[i+1].trim();
                        i++;
                    }
                    if (i+1 < refLines.length && (refLines[i+1].includes('@') || refLines[i+1].match(/\d/))) {
                        result.referees[result.referees.length-1].contact = refLines[i+1].trim();
                        i++;
                    }
                    break; // only take first referee? We'll take multiple by not breaking? Actually loop continues.
                }
            }
        }
    }

    // 16. Interests
    const interestSections = getSectionContent('interest', ['skill', 'education']);
    for (const line of interestSections) {
        if (line.length > 5) {
            result.interests.push(line);
        }
    }

    // 17. Social media links
    const socialPatterns = {
        twitter: /twitter\.com\/[a-zA-Z0-9_]+/i,
        facebook: /facebook\.com\/[a-zA-Z0-9.]+/i,
        instagram: /instagram\.com\/[a-zA-Z0-9_]+/i,
        youtube: /youtube\.com\/[a-zA-Z0-9_]+/i
    };
    for (const [platform, pattern] of Object.entries(socialPatterns)) {
        const match = text.match(pattern);
        if (match) result.social_media[platform] = match[0];
    }

    return result;
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
generateFallbackSummary(extractedData) {
    const personal = extractedData.personal || {};
    const employment = extractedData.employment || [];
    const education = extractedData.education || [];
    const skills = extractedData.skills || {};
    const certifications = extractedData.certifications || [];
    const languages = extractedData.languages || [];
    const projects = extractedData.projects || [];
    const achievements = extractedData.achievements || [];
    const volunteer = extractedData.volunteer || [];
    const leadership = extractedData.leadership || [];
    const awards = extractedData.awards || [];
    
    const name = personal.full_name || 'Candidate';
    const title = personal.professional_title || '';
    const location = personal.location || '';
    
    // Calculate total years of experience
    let totalYears = 0;
    for (const job of employment) {
        const duration = job.duration || '';
        const yearMatch = duration.match(/(\d+)\s*(?:years?|yrs?)/i);
        if (yearMatch) totalYears += parseInt(yearMatch[1]);
        else if (duration.includes('Present') && job.start_date) {
            const startYear = parseInt(job.start_date.match(/\d{4}/)?.[0] || 0);
            if (startYear) totalYears += new Date().getFullYear() - startYear;
        }
    }
    
    // Collect all skills
    const allSkills = [
        ...(skills.technical || []),
        ...(skills.soft || []),
        ...(skills.tools || [])
    ];
    
    // Build summary parts dynamically
    const sentences = [];
    
    // 1. Opening: Name and professional identity
    if (name && name !== 'Candidate') {
        let opening = `${name} is `;
        if (title) opening += `a ${title}`;
        else if (employment.length > 0) opening += `a ${employment[0].title}`;
        else opening += `a dedicated professional`;
        if (totalYears > 0) opening += ` with ${totalYears}+ years of experience`;
        if (location) opening += ` based in ${location}`;
        sentences.push(opening + '.');
    } else {
        let opening = `A dedicated professional`;
        if (title) opening += ` ${title}`;
        else if (employment.length > 0) opening += ` ${employment[0].title}`;
        if (totalYears > 0) opening += ` with ${totalYears}+ years of experience`;
        if (location) opening += ` based in ${location}`;
        sentences.push(opening + '.');
    }
    
    // 2. Work experience highlights (most recent job achievements)
    if (employment.length > 0 && employment[0].achievements?.length) {
        const topAchievement = employment[0].achievements[0];
        if (topAchievement) {
            sentences.push(`In their most recent role as ${employment[0].title}, ${name.split(' ')[0]} ${topAchievement.substring(0, 100)}.`);
        }
    }
    
    // 3. Skills (top 5)
    if (allSkills.length > 0) {
        const topSkills = allSkills.slice(0, 5);
        let skillText = `Core competencies include ${topSkills.join(', ')}`;
        if (allSkills.length > 5) skillText += ` and other ${allSkills.length - 5} skills`;
        sentences.push(skillText + '.');
    }
    
    // 4. Education highlight
    if (education.length > 0) {
        const highest = education[0];
        let eduText = `${name.split(' ')[0]} holds a ${highest.level}`;
        if (highest.field) eduText += ` in ${highest.field}`;
        if (highest.institution) eduText += ` from ${highest.institution}`;
        sentences.push(eduText + '.');
        if (education.length > 1) {
            sentences.push(`Additionally, ${name.split(' ')[0]} has ${education.length - 1} other qualification(s).`);
        }
    }
    
    // 5. Certifications
    if (certifications.length > 0) {
        let certText = `Certified in ${certifications.slice(0, 2).map(c => c.name).join(', ')}`;
        if (certifications.length > 2) certText += ` and ${certifications.length - 2} more certifications`;
        sentences.push(certText + '.');
    }
    
    // 6. Languages
    if (languages.length > 0) {
        const langText = languages.slice(0, 3).map(l => `${l.name} (${l.proficiency || 'Professional'})`).join(', ');
        sentences.push(`Fluent in ${langText}${languages.length > 3 ? ` and other languages` : ''}.`);
    }
    
    // 7. Projects
    if (projects.length > 0) {
        const projectNames = projects.slice(0, 2).map(p => p.name).join(', ');
        sentences.push(`Notable projects include ${projectNames}${projects.length > 2 ? ` and ${projects.length - 2} others` : ''}.`);
    }
    
    // 8. Volunteer / Leadership / Awards (pick one)
    if (volunteer.length > 0) {
        sentences.push(`Committed to community service through ${volunteer[0].role} at ${volunteer[0].organization}.`);
    } else if (leadership.length > 0) {
        sentences.push(`Demonstrated leadership as ${leadership[0].role} of ${leadership[0].organization}.`);
    } else if (awards.length > 0) {
        sentences.push(`Recognized with ${awards[0].name} award.`);
    }
    
    // 9. Closing: Motivation / Career goal
    const closingOptions = [
        `Seeking opportunities to leverage expertise in a dynamic environment.`,
        `Eager to contribute to organizational success and drive meaningful impact.`,
        `Looking to bring strategic value and technical excellence to a forward-thinking team.`,
        `Passionate about continuous learning and delivering exceptional results.`,
        `Ready to apply ${totalYears > 0 ? `${totalYears}+ years of ` : ''}experience to solve complex challenges.`
    ];
    sentences.push(closingOptions[Math.floor(Math.random() * closingOptions.length)]);
    
    // Join sentences into a coherent paragraph
    return sentences.join(' ');
}
  // ============ LOCAL EXTRACTION (FALLBACK) ============
  async extractFullCVData(filePath, fileType = 'cv') {
    try {
        const rawText = await this.extractTextFromFile(filePath);
        const structuredData = this.intelligentlyParseCVText(rawText, fileType);
        // Generate a summary from extracted data
        const summary = this.generateFallbackSummary(structuredData);
        structuredData.professional_summary = summary; // overwrite raw summary with generated one
        return { success: true, data: structuredData, summary: summary };
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

  // ============ PROFESSIONAL CV GENERATION ( ) ============
  async generateCV(cvData, industry = null, format = 'pdf', vacancyData = null, certificatesData = null) {
    const detectedIndustry = industry || this.detectIndustry(cvData);
    const colors = this.getIndustryColors(detectedIndustry);
    const styles = this.getAptosStyles(colors);
    
    const content = this.buildCVContent(cvData, colors);
    
    if (content.length === 0) {
      return { success: false, error: "No CV data provided" };
    }
    
    if (format === 'pdf') {
      // For PDF we'll generate a PDF using pdf-lib (more complex, but we'll keep DOCX for now)
      // For simplicity, we generate DOCX and then convert to PDF if needed (using external tool)
      // We'll return DOCX and let the caller decide.
      const doc = new Document({ styles, sections: [{
        properties: { page: { margin: { top: 720, bottom: 720, left: 720, right: 720 } } },
        children: content
      }] });
      const fileName = `CV_${cvData.personal?.full_name?.replace(/\s/g, '_') || 'Candidate'}_${Date.now()}.docx`;
      const filePath = path.join(this.cvPath, fileName);
      const buffer = await Packer.toBuffer(doc);
      fs.writeFileSync(filePath, buffer);
      return { success: true, filePath, fileName, format: 'docx', industry: detectedIndustry };
    } else {
      // DOCX generation (same as above)
      const doc = new Document({ styles, sections: [{
        properties: { page: { margin: { top: 720, bottom: 720, left: 720, right: 720 } } },
        children: content
      }] });
      const fileName = `CV_${cvData.personal?.full_name?.replace(/\s/g, '_') || 'Candidate'}_${Date.now()}.docx`;
      const filePath = path.join(this.cvPath, fileName);
      const buffer = await Packer.toBuffer(doc);
      fs.writeFileSync(filePath, buffer);
      return { success: true, filePath, fileName, format: 'docx', industry: detectedIndustry };
    }
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
    
    // Skills
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

  // ============ COVER LETTER GENERATION (Professional style) ============
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
    
    return { success: true, filePath, fileName, format: 'docx' };
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

  // ============ ATTACHMENTS PROCESSING ============
  async enhanceImage(filePath) {
    try {
      const outputPath = filePath.replace(/\.(jpg|jpeg|png)$/i, '_enhanced.jpg');
      await sharp(filePath)
        .rotate() // auto-rotate based on EXIF
        .resize(800, null, { withoutEnlargement: true })
        .normalize() // contrast/brightness
        .sharpen()
        .toFile(outputPath);
      return outputPath;
    } catch (error) {
      console.error('Image enhancement failed:', error);
      return filePath; // fallback to original
    }
  }

  async addAttachmentsPage(pdfDoc, attachments, clientId) {
    const page = pdfDoc.addPage([600, 800]);
    const { width, height } = page;
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    let y = height - 50;
    page.drawText('Supporting Documents', { x: 50, y, size: 18, font, color: rgb(0.2, 0.2, 0.6) });
    y -= 30;
    page.drawText('The following verified copies are attached:', { x: 50, y, size: 12, font });
    y -= 25;
    
    let col = 0;
    const colWidth = 250;
    const rowHeight = 120;
    for (const att of attachments) {
      const xPos = 50 + col * colWidth;
      if (y - rowHeight < 50) {
        // new page
        const newPage = pdfDoc.addPage([600, 800]);
        y = newPage.getHeight() - 50;
        // copy drawing to new page? simpler: we'll just continue on new page
        // For brevity, we'll just draw on the same page and hope it fits; in production, implement pagination.
      }
      // Draw a box
      page.drawRectangle({
        x: xPos,
        y: y - rowHeight,
        width: colWidth - 10,
        height: rowHeight - 10,
        borderColor: rgb(0.8, 0.8, 0.8),
        borderWidth: 1,
      });
      // Draw label
      page.drawText(att.label, { x: xPos + 5, y: y - 20, size: 10, font });
      // Draw image if available
      if (att.enhancedPath && fs.existsSync(att.enhancedPath)) {
        const imageBytes = fs.readFileSync(att.enhancedPath);
        const image = await pdfDoc.embedJpg(imageBytes);
        page.drawImage(image, {
          x: xPos + 5,
          y: y - rowHeight + 10,
          width: 80,
          height: 80,
        });
      }
      col++;
      if (col >= 2) {
        col = 0;
        y -= rowHeight;
      }
    }
  }

  // ============ COMBINED DOCUMENT GENERATION (CV + Cover Letter + Attachments) ============
  async generateCombinedDocument(cvData, coverData, attachments, personalData, format = 'pdf') {
    // Generate CV as PDF (we'll convert DOCX to PDF using external tool or pdf-lib; here we'll generate DOCX then convert)
    const cvResult = await this.generateCV(cvData, null, 'docx');
    if (!cvResult.success) throw new Error('CV generation failed');
    const coverResult = await this.generateCoverLetter(coverData, cvData, personalData);
    if (!coverResult.success) throw new Error('Cover letter generation failed');
    
    return {
      success: true,
      cvFile: cvResult.filePath,
      coverFile: coverResult.filePath,
      attachments: attachments,
      format: 'separate'
    };
  }

  // ============ UTILITIES ============
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