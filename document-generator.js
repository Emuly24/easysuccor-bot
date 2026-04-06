// document-generator.js - Complete Dynamic CV Generator with Smart Analysis
const { Document, Packer, Paragraph, TextRun, AlignmentType, BorderStyle, ImageRun } = require('docx');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const axios = require('axios');

class DocumentGenerator {
  constructor() {
    // Base paths
    this.exportsPath = path.join(__dirname, 'exports');
    this.cvPath = path.join(this.exportsPath, 'cv');
    this.coverPath = path.join(this.exportsPath, 'coverletters');
    this.pdfPath = path.join(this.exportsPath, 'pdf');
    this.uploadsPath = path.join(__dirname, 'uploads');
    this.convertedPath = path.join(this.uploadsPath, 'converted');
    this.reviewedPath = path.join(this.uploadsPath, 'reviewed');
    this.templatesPath = path.join(__dirname, 'templates');
    
    // Create all directories
    [this.cvPath, this.coverPath, this.pdfPath, this.convertedPath, this.reviewedPath, this.templatesPath].forEach(p => {
      if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
    });
    
    // Client document registry
    this.clientRegistryPath = path.join(this.exportsPath, 'client_registry.json');
    this.clientRegistry = this.loadClientRegistry();
    
    // Review learning data
    this.reviewLearningPath = path.join(this.exportsPath, 'review_learning.json');
    this.reviewLearning = this.loadReviewLearning();
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

  loadReviewLearning() {
    if (fs.existsSync(this.reviewLearningPath)) {
      return JSON.parse(fs.readFileSync(this.reviewLearningPath, 'utf8'));
    }
    return { admin_patterns: [], common_corrections: [], template_preferences: {} };
  }

  saveReviewLearning() {
    fs.writeFileSync(this.reviewLearningPath, JSON.stringify(this.reviewLearning, null, 2));
  }

  // ============ TEMPLATE SYSTEM ============
  getTemplateConfig(industry, templateType = 'professional') {
    const templates = {
      'technology': {
        name: 'tech_modern',
        colors: { primary: '8E44AD', secondary: '9B59B6', accent: '3498DB', background: 'F8F9FA' },
        fonts: { heading: 'Aptos', body: 'Aptos' },
        layout: 'two_column',
        features: ['skills_highlight', 'projects_section', 'github_integration']
      },
      'carpentry': {
        name: 'trade_skilled',
        colors: { primary: '2C3E50', secondary: '7F8C8D', accent: 'D35400', background: 'FFF8F0' },
        fonts: { heading: 'Aptos', body: 'Aptos' },
        layout: 'single_column',
        features: ['certifications_highlight', 'portfolio_gallery']
      },
      'agriculture': {
        name: 'rural_development',
        colors: { primary: '27AE60', secondary: '2ECC71', accent: 'F39C12', background: 'F5F9F0' },
        fonts: { heading: 'Aptos', body: 'Aptos' },
        layout: 'single_column',
        features: ['project_impact', 'community_engagement']
      },
      'healthcare': {
        name: 'medical_professional',
        colors: { primary: '2980B9', secondary: '3498DB', accent: 'E74C3C', background: 'F0F8FF' },
        fonts: { heading: 'Aptos', body: 'Aptos' },
        layout: 'single_column',
        features: ['certifications_section', 'licenses_display']
      },
      'education': {
        name: 'academic',
        colors: { primary: '1ABC9C', secondary: '16A085', accent: 'F1C40F', background: 'FFFFF0' },
        fonts: { heading: 'Aptos', body: 'Aptos' },
        layout: 'single_column',
        features: ['publications_section', 'teaching_experience']
      },
      'project_management': {
        name: 'executive',
        colors: { primary: '2C3E50', secondary: '34495E', accent: 'E67E22', background: 'FFFFFF' },
        fonts: { heading: 'Aptos', body: 'Aptos' },
        layout: 'single_column',
        features: ['achievements_metrics', 'stakeholder_management']
      },
      'corporate': {
        name: 'professional_standard',
        colors: { primary: '1F4E78', secondary: '2C7DA0', accent: 'FF6B6B', background: 'FFFFFF' },
        fonts: { heading: 'Aptos', body: 'Aptos' },
        layout: 'single_column',
        features: ['executive_summary', 'career_highlights']
      },
      'default': {
        name: 'marc_kampira_style',
        colors: { primary: '2C3E50', secondary: '7F8C8D', accent: 'E67E22', background: 'FFFFFF' },
        fonts: { heading: 'Aptos', body: 'Aptos' },
        layout: 'single_column',
        features: ['clean_professional', 'two_page_max']
      }
    };
    return templates[industry] || templates['default'];
  }

  // ============ APTOS FONT STYLES ============
  getAptosStyles(colors, templateConfig) {
    return {
      default: { document: { run: { font: templateConfig.fonts.body, size: 24 } } },
      paragraphStyles: [
        { id: "name", name: "Name", basedOn: "Normal", run: { font: templateConfig.fonts.heading, size: 48, bold: true, color: colors.primary }, paragraph: { spacing: { after: 80 }, alignment: AlignmentType.CENTER } },
        { id: "title", name: "Title", basedOn: "Normal", run: { font: templateConfig.fonts.heading, size: 28, bold: true, italics: true, color: colors.secondary }, paragraph: { spacing: { after: 120 }, alignment: AlignmentType.CENTER } },
        { id: "sectionHeading", name: "Section Heading", basedOn: "Normal", run: { font: templateConfig.fonts.heading, size: 32, bold: true, color: colors.primary }, paragraph: { spacing: { before: 240, after: 80 }, border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: colors.accent } } } },
        { id: "subsectionHeading", name: "Subsection Heading", basedOn: "Normal", run: { font: templateConfig.fonts.heading, size: 28, bold: true, color: colors.secondary }, paragraph: { spacing: { before: 120, after: 40 } } },
        { id: "companyDate", name: "Company and Date", basedOn: "Normal", run: { font: templateConfig.fonts.body, size: 24, bold: true }, paragraph: { spacing: { after: 20 } } },
        { id: "bodyText", name: "Body Text", basedOn: "Normal", run: { font: templateConfig.fonts.body, size: 24 }, paragraph: { spacing: { after: 80 } } },
        { id: "bulletPoint", name: "Bullet Point", basedOn: "Normal", run: { font: templateConfig.fonts.body, size: 24 }, paragraph: { spacing: { after: 40 }, indent: { left: 480 } } },
        { id: "contactInfo", name: "Contact Info", basedOn: "Normal", run: { font: templateConfig.fonts.body, size: 22, color: "666666" }, paragraph: { spacing: { after: 60 }, alignment: AlignmentType.CENTER } },
        { id: "refereeName", name: "Referee Name", basedOn: "Normal", run: { font: templateConfig.fonts.heading, size: 26, bold: true }, paragraph: { spacing: { after: 20 } } },
        { id: "refereeDetails", name: "Referee Details", basedOn: "Normal", run: { font: templateConfig.fonts.body, size: 22, color: "555555" }, paragraph: { spacing: { after: 40 } } }
      ]
    };
  }

  getIndustryColors(industry) {
    const template = this.getTemplateConfig(industry);
    return template.colors;
  }

  detectIndustry(cvData) {
    const allText = [
      ...(cvData.employment?.map(j => `${j.title} ${j.company}`) || []),
      ...(cvData.skills || []),
      ...(cvData.education?.map(e => e.field) || [])
    ].join(' ').toLowerCase();
    
    if (allText.includes('carpenter') || allText.includes('joiner') || allText.includes('wood')) return 'carpentry';
    if (allText.includes('agriculture') || allText.includes('farm') || allText.includes('crop')) return 'agriculture';
    if (allText.includes('health') || allText.includes('medical') || allText.includes('nurse') || allText.includes('doctor')) return 'healthcare';
    if (allText.includes('software') || allText.includes('developer') || allText.includes('engineer') || allText.includes('it ') || allText.includes('tech')) return 'technology';
    if (allText.includes('teach') || allText.includes('education') || allText.includes('school') || allText.includes('university')) return 'education';
    if (allText.includes('project') || allText.includes('manager') || allText.includes('coordinator')) return 'project_management';
    return 'corporate';
  }

  // ============ SMART ANALYSIS & EXTRAPOLATION ============
  analyzeAndExtrapolate(cvData, vacancyData = null) {
    const enhanced = { ...cvData };
    
    // Extrapolate skills from job descriptions if skills section is empty
    if (!enhanced.skills || enhanced.skills.length === 0) {
      enhanced.skills = this.extrapolateSkillsFromEmployment(enhanced.employment);
    }
    
    // Extrapolate job roles from company names and titles
    if (!enhanced.employment || enhanced.employment.length === 0) {
      enhanced.employment = this.extrapolateJobRolesFromEducation(enhanced.education);
    }
    
    // Generate professional summary if missing or too short
    if (!enhanced.professional_summary || enhanced.professional_summary.length < 100) {
      enhanced.professional_summary = this.generateProfessionalSummary(enhanced, vacancyData);
    }
    
    // Enhance job responsibilities if they're too vague
    for (const job of (enhanced.employment || [])) {
      if (!job.responsibilities || job.responsibilities.length === 0) {
        job.responsibilities = this.generateResponsibilities(job.title, job.company);
      }
    }
    
    return enhanced;
  }

  extrapolateSkillsFromEmployment(employment) {
    const skillsMap = {
      'project manager': ['Project Planning', 'Risk Management', 'Stakeholder Engagement', 'Budget Management', 'Team Leadership', 'Agile Methodology', 'Jira', 'MS Project'],
      'software engineer': ['JavaScript', 'Python', 'React', 'Node.js', 'Git', 'REST APIs', 'Database Design', 'Testing'],
      'developer': ['Coding', 'Debugging', 'Version Control', 'Problem Solving', 'Algorithm Design', 'System Architecture'],
      'carpenter': ['Woodworking', 'Blueprint Reading', 'Power Tools', 'Measuring', 'Safety Compliance', 'Finishing', 'Installation'],
      'farmer': ['Crop Management', 'Irrigation', 'Soil Analysis', 'Equipment Operation', 'Harvesting', 'Supply Chain'],
      'nurse': ['Patient Care', 'Vital Signs', 'Medical Records', 'Emergency Response', 'Medication Administration', 'Health Education'],
      'teacher': ['Lesson Planning', 'Classroom Management', 'Student Assessment', 'Curriculum Development', 'Parent Communication'],
      'manager': ['Team Leadership', 'Strategic Planning', 'Performance Management', 'Budgeting', 'Reporting', 'Decision Making'],
      'director': ['Strategic Direction', 'Policy Development', 'Stakeholder Relations', 'Resource Allocation', 'Governance'],
      'coordinator': ['Scheduling', 'Communication', 'Logistics', 'Reporting', 'Meeting Coordination', 'Documentation'],
      'analyst': ['Data Analysis', 'Reporting', 'Requirements Gathering', 'Process Improvement', 'Excel', 'SQL']
    };
    
    const skills = new Set();
    for (const job of (employment || [])) {
      const title = job.title?.toLowerCase() || '';
      for (const [keyword, skillList] of Object.entries(skillsMap)) {
        if (title.includes(keyword)) {
          skillList.forEach(s => skills.add(s));
        }
      }
    }
    
    return Array.from(skills).slice(0, 12);
  }

  extrapolateJobRolesFromEducation(education) {
    const roles = [];
    for (const edu of (education || [])) {
      const field = edu.field?.toLowerCase() || '';
      const level = edu.level?.toLowerCase() || '';
      
      if (field.includes('computer') || field.includes('software') || field.includes('it')) {
        roles.push({ title: 'Software Developer', company: 'Various Projects', duration: 'Academic Projects', responsibilities: [] });
      }
      if (field.includes('engineering') && level.includes('biomedical')) {
        roles.push({ title: 'Biomedical Engineer', company: 'Academic Research', duration: 'University Projects', responsibilities: [] });
      }
      if (field.includes('business') || field.includes('entrepreneurship')) {
        roles.push({ title: 'Business Analyst', company: 'Academic Projects', duration: 'University', responsibilities: [] });
      }
    }
    return roles;
  }

  generateProfessionalSummary(cvData, vacancyData) {
    const personal = cvData.personal || {};
    const employment = cvData.employment || [];
    const education = cvData.education || [];
    const skills = cvData.skills || [];
    
    let summary = '';
    
    // Start with role and experience
    if (employment.length > 0) {
      const latestJob = employment[0];
      const years = this.calculateTotalYears(employment);
      summary += `${latestJob.title} with ${years}+ years of experience. `;
    } else if (education.length > 0) {
      const latestEdu = education[0];
      summary += `${latestEdu.level} graduate in ${latestEdu.field || 'relevant field'}. `;
    }
    
    // Add skills
    if (skills.length > 0) {
      summary += `Skilled in ${skills.slice(0, 5).join(', ')}. `;
    }
    
    // Add achievements
    const achievements = this.extractAchievements(employment);
    if (achievements.length > 0) {
      summary += `Key achievements include ${achievements.slice(0, 2).join(' and ')}. `;
    }
    
    // Add alignment with vacancy if provided
    if (vacancyData && vacancyData.position) {
      summary += `Seeking ${vacancyData.position} position at ${vacancyData.company || 'your organization'} to leverage expertise and drive impact.`;
    } else {
      summary += `Passionate about leveraging expertise to drive organizational success and community impact.`;
    }
    
    return summary;
  }

  calculateTotalYears(employment) {
    let total = 0;
    for (const job of employment) {
      if (job.duration) {
        const years = job.duration.match(/(\d+)\s*years?|\d{4}\s*-\s*(\d{4})/i);
        if (years) total += parseInt(years[1]) || 1;
      }
    }
    return Math.max(total, 1);
  }

  extractAchievements(employment) {
    const achievements = [];
    for (const job of employment) {
      if (job.achievements) {
        for (const ach of job.achievements) {
          if (ach.length < 100) achievements.push(ach.toLowerCase());
        }
      }
      if (job.responsibilities) {
        for (const resp of job.responsibilities) {
          if (resp.match(/led|managed|created|developed|improved|increased|reduced/i) && resp.length < 100) {
            achievements.push(resp.toLowerCase());
          }
        }
      }
    }
    return [...new Set(achievements)].slice(0, 3);
  }

  generateResponsibilities(jobTitle, company) {
    const templates = {
      'project manager': [
        `Led cross-functional teams to deliver projects on time and within budget`,
        `Developed project plans, monitored progress, and reported to stakeholders`,
        `Identified and mitigated risks to ensure successful project completion`
      ],
      'software developer': [
        `Designed and implemented software solutions meeting client requirements`,
        `Wrote clean, maintainable code following best practices`,
        `Collaborated with team members to troubleshoot and resolve technical issues`
      ],
      'carpenter': [
        `Constructed and installed wooden structures according to specifications`,
        `Read and interpreted blueprints and technical drawings`,
        `Ensured all work complied with safety standards and building codes`
      ],
      'teacher': [
        `Developed and delivered engaging lesson plans for diverse learners`,
        `Assessed student progress and provided constructive feedback`,
        `Collaborated with parents and staff to support student success`
      ]
    };
    
    const title = jobTitle?.toLowerCase() || '';
    for (const [key, respList] of Object.entries(templates)) {
      if (title.includes(key)) {
        return respList;
      }
    }
    
    return [
      `Performed duties effectively in ${jobTitle || 'role'} at ${company || 'organization'}`,
      `Contributed to team success through dedicated performance`,
      `Maintained high standards of quality and professionalism`
    ];
  }

  // ============ DOWNLOAD & EXTRACTION ============
  async downloadFile(url, outputPath) {
    try {
      const response = await axios({
        method: 'GET',
        url: url,
        responseType: 'stream'
      });
      
      const writer = fs.createWriteStream(outputPath);
      response.data.pipe(writer);
      
      return new Promise((resolve, reject) => {
        writer.on('finish', () => resolve(outputPath));
        writer.on('error', reject);
      });
    } catch (error) {
      console.error('Download error:', error);
      throw error;
    }
  }

  async extractFullCVDataFromUrl(fileUrl, fileName) {
    try {
      const tempDir = path.join(__dirname, 'temp');
      if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
      
      const tempFilePath = path.join(tempDir, `temp_${Date.now()}_${fileName}`);
      await this.downloadFile(fileUrl, tempFilePath);
      const result = await this.extractFullCVData(tempFilePath, 'cv');
      fs.unlinkSync(tempFilePath);
      return result;
    } catch (error) {
      console.error('extractFullCVDataFromUrl error:', error);
      return { success: false, error: error.message };
    }
  }

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
    }
    return text;
  }

  intelligentlyParseCVText(text, fileType) {
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    
    const cvData = {
      personal: { full_name: '', email: '', primary_phone: '', location: '', linkedin: '', portfolio: '', professional_title: '' },
      professional_summary: '',
      employment: [],
      education: [],
      skills: [],
      certifications: [],
      languages: [],
      volunteer_experience: [],
      awards: [],
      leadership: [],
      extracurricular: [],
      conferences: [],
      publications: [],
      projects: [],
      achievements: [],
      referees: []
    };

    const sections = {
      personal: ['personal information', 'contact', 'profile', 'about me'],
      summary: ['professional summary', 'executive summary', 'career objective', 'profile summary'],
      experience: ['work experience', 'employment history', 'professional experience', 'work history'],
      education: ['education', 'academic background', 'qualifications', 'training'],
      skills: ['skills', 'core competencies', 'technical skills', 'expertise'],
      certifications: ['certifications', 'certificates', 'professional development', 'licenses'],
      languages: ['languages', 'language proficiency'],
      volunteer: ['volunteer', 'volunteering', 'community service', 'outreach'],
      awards: ['awards', 'recognition', 'honors', 'achievements'],
      leadership: ['leadership', 'executive', 'board member', 'committee'],
      extracurricular: ['extracurricular', 'activities', 'clubs', 'societies'],
      conferences: ['conferences', 'training', 'workshops', 'seminars'],
      publications: ['publications', 'articles', 'papers', 'research'],
      projects: ['projects', 'key projects', 'portfolio'],
      referees: ['referees', 'references', 'recommendations']
    };

    let currentSection = '';
    let currentJob = null;
    let currentEdu = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lowerLine = line.toLowerCase();

      for (const [section, patterns] of Object.entries(sections)) {
        if (patterns.some(p => lowerLine.includes(p))) {
          currentSection = section;
          break;
        }
      }

      // Extract personal info
      if (i < 15 && !currentSection) {
        if (!cvData.personal.full_name && line.length < 50 && !line.includes('@') && !line.match(/[\d-]{10,}/)) {
          cvData.personal.full_name = line;
        }
        const emailMatch = line.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
        if (emailMatch && !cvData.personal.email) cvData.personal.email = emailMatch[0];
        
        const phoneMatch = line.match(/[\+?\(?\d{1,4}\)?[\s\-]?\(?\d{3}\)?[\s\-]?\d{3}[\s\-]?\d{4,5}/);
        if (phoneMatch && !cvData.personal.primary_phone) cvData.personal.primary_phone = phoneMatch[0];
        
        if (line.match(/linkedin\.com\/in\//) && !cvData.personal.linkedin) cvData.personal.linkedin = line;
        
        const locationMatch = line.match(/([A-Z][a-z]+,\s*[A-Z][a-z]+|[A-Z][a-z]+\s*-\s*[A-Z][a-z]+)/);
        if (locationMatch && !cvData.personal.location && line.length < 40) {
          cvData.personal.location = locationMatch[0];
        }
      }

      // Extract summary
      if (currentSection === 'summary' && !lowerLine.includes('summary') && line.length > 50) {
        cvData.professional_summary += line + ' ';
      }

      // Extract work experience
      if (currentSection === 'experience') {
        const isJobTitle = line.match(/^(Senior|Junior|Lead|Head|Manager|Director|Consultant|Specialist|Engineer|Developer|Analyst|Coordinator|Officer|Assistant|Carpenter|Farmer|Nurse|Teacher|Executive)/i) ||
                          line.includes(' at ') || line.includes(' - ') || line.includes('|');
        
        if (isJobTitle && !lowerLine.includes('experience') && !lowerLine.includes('work')) {
          if (currentJob) cvData.employment.push(currentJob);
          currentJob = { title: '', company: '', duration: '', responsibilities: [], achievements: [] };
          
          const atIndex = line.indexOf(' at ');
          const pipeIndex = line.indexOf('|');
          const dashIndex = line.indexOf(' - ');
          
          if (atIndex > -1) {
            currentJob.title = line.substring(0, atIndex).trim();
            currentJob.company = line.substring(atIndex + 4).trim();
          } else if (pipeIndex > -1) {
            currentJob.title = line.substring(0, pipeIndex).trim();
            currentJob.company = line.substring(pipeIndex + 1).trim();
          } else if (dashIndex > -1) {
            currentJob.title = line.substring(0, dashIndex).trim();
            currentJob.company = line.substring(dashIndex + 3).trim();
          } else {
            currentJob.title = line;
          }
          
          let nextLine = lines[i+1] || '';
          const dateMatch = nextLine.match(/\d{4}\s*[-–—]\s*\d{4}|\d{4}\s*[-–—]\s*Present|\d{4}\s*[-–—]\s*Current|\d{2}\/\d{4}|\(?\d{4}\s*-\s*\d{4}\)?/i);
          if (dateMatch) {
            currentJob.duration = dateMatch[0];
            i++;
          }
        } else if (currentJob && (line.startsWith('•') || line.startsWith('-') || line.startsWith('*') || line.match(/^\d+\./))) {
          let cleanLine = line.replace(/^[•\-*\d+\.]\s*/, '');
          if (cleanLine.match(/\b\d+%\b|\bincreased\b|\breduced\b|\blaunched\b|\bmanaged\b|\bled\b|\bachieved\b|\bimproved\b|\bdeveloped\b|\bcreated\b/i)) {
            currentJob.achievements.push(cleanLine);
          } else if (cleanLine.length > 5) {
            currentJob.responsibilities.push(cleanLine);
          }
        }
      }
      if (currentJob && i === lines.length - 1) cvData.employment.push(currentJob);

      // Extract education
      if (currentSection === 'education') {
        if (line.match(/Bachelor|Master|PhD|Diploma|Degree|Certificate|High School|Secondary|Associate/i)) {
          if (currentEdu) cvData.education.push(currentEdu);
          currentEdu = { level: line, field: '', institution: '', graduation_date: '' };
          
          let j = 1;
          while (lines[i+j] && !lines[i+j].match(/Bachelor|Master|PhD|Diploma|Degree|Certificate/i) && j < 4) {
            if (lines[i+j].length > 3 && !lines[i+j].match(/\d{4}/) && !lines[i+j].includes('@')) {
              if (!currentEdu.institution) currentEdu.institution = lines[i+j];
              else if (!currentEdu.field) currentEdu.field = lines[i+j];
              break;
            }
            j++;
          }
        } else if (currentEdu && line.match(/\d{4}/)) {
          currentEdu.graduation_date = line;
        }
      }
      if (currentEdu && i === lines.length - 1) cvData.education.push(currentEdu);

      // Extract skills
      if (currentSection === 'skills' && !lowerLine.includes('skill') && line.length > 5) {
        const skillsList = line.split(/[ ,•\-|]+/).filter(s => s.length > 1 && s.length < 40);
        cvData.skills.push(...skillsList);
      }

      // Extract volunteer experience
      if (currentSection === 'volunteer' && line.length > 10 && !lowerLine.includes('volunteer')) {
        cvData.volunteer_experience.push(line);
      }

      // Extract awards
      if (currentSection === 'awards' && line.length > 10 && !lowerLine.includes('award')) {
        cvData.awards.push(line);
      }

      // Extract leadership
      if (currentSection === 'leadership' && line.length > 10 && !lowerLine.includes('leadership')) {
        cvData.leadership.push(line);
      }

      // Extract extracurricular
      if (currentSection === 'extracurricular' && line.length > 10 && !lowerLine.includes('extracurricular')) {
        cvData.extracurricular.push(line);
      }

      // Extract conferences
      if (currentSection === 'conferences' && line.length > 10 && !lowerLine.includes('conference')) {
        cvData.conferences.push(line);
      }

      // Extract publications
      if (currentSection === 'publications' && line.length > 10 && !lowerLine.includes('publication')) {
        cvData.publications.push(line);
      }

      // Extract certifications
      if (currentSection === 'certifications' && !lowerLine.includes('certification') && line.length > 5) {
        const yearMatch = line.match(/(\d{4})/);
        cvData.certifications.push({
          name: line.replace(yearMatch ? yearMatch[0] : '', '').replace(/[,\-]$/, '').trim(),
          year: yearMatch ? yearMatch[0] : ''
        });
      }

      // Extract languages
      if (currentSection === 'languages' && !lowerLine.includes('language') && line.length > 3) {
        const langMatch = line.match(/([A-Za-z]+)\s*\(([^)]+)\)/);
        if (langMatch) {
          cvData.languages.push({ name: langMatch[1], proficiency: langMatch[2] });
        } else {
          cvData.languages.push({ name: line.split('(')[0].trim(), proficiency: 'Professional' });
        }
      }

      // Extract projects
      if (currentSection === 'projects' && line.length > 10 && !lowerLine.includes('project')) {
        cvData.projects.push({ name: line, description: lines[i+1] || '' });
      }

      // Extract referees
      if (currentSection === 'referees' && !lowerLine.includes('referee') && line.length > 10) {
        const emailMatch = line.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
        const phoneMatch = line.match(/[\+?\(?\d{1,4}\)?[\s\-]?\(?\d{3}\)?[\s\-]?\d{3}[\s\-]?\d{4,5}/);
        
        if (line.length < 50 && !line.includes('@') && !line.match(/[\d-]{10,}/)) {
          cvData.referees.push({ name: line, position: '', contact: '' });
        } else if (emailMatch && cvData.referees.length > 0) {
          cvData.referees[cvData.referees.length-1].email = emailMatch[0];
        } else if (phoneMatch && cvData.referees.length > 0) {
          cvData.referees[cvData.referees.length-1].contact = phoneMatch[0];
        }
      }
    }

    return cvData;
  }

  // ============ DYNAMIC CV GENERATION ============
  async generateCV(cvData, industry = null, format = 'docx', vacancyData = null, certificatesData = null, version = 1, previousVersionPath = null) {
    // First, analyze and extrapolate missing data
    const enhancedData = this.analyzeAndExtrapolate(cvData, vacancyData);
    
    const detectedIndustry = industry || this.detectIndustry(enhancedData);
    const templateConfig = this.getTemplateConfig(detectedIndustry);
    const colors = templateConfig.colors;
    const styles = this.getAptosStyles(colors, templateConfig);
    
    const content = this.buildDynamicCVContent(enhancedData, colors, templateConfig);
    
    if (content.length === 0) {
      return { success: false, error: "No CV data provided" };
    }
    
    const doc = new Document({ styles, sections: [{
      properties: { page: { margin: { top: 720, bottom: 720, left: 720, right: 720 } } },
      children: content
    }] });
    
    const versionSuffix = version > 1 ? `_v${version}` : '';
    const fileName = `CV_${enhancedData.personal?.full_name?.replace(/\s/g, '_') || 'Candidate'}${versionSuffix}_${Date.now()}.docx`;
    const filePath = path.join(this.cvPath, fileName);
    const buffer = await Packer.toBuffer(doc);
    fs.writeFileSync(filePath, buffer);
    
    // Generate PDF if requested
    let pdfPath = null;
    if (format === 'pdf' || format === 'both') {
      pdfPath = await this.convertToPDF(filePath);
    }
    
    return { 
      success: true, 
      filePath, 
      pdfPath,
      fileName, 
      industry: detectedIndustry, 
      template: templateConfig.name, 
      version,
      enhanced: true,
      summary_generated: enhancedData.professional_summary !== cvData.professional_summary
    };
  }

  buildDynamicCVContent(cvData, colors, templateConfig) {
    const personal = cvData.personal || {};
    const content = [];
    
    if (!personal.full_name) return [];
    
    // Header
    content.push(new Paragraph({ text: personal.full_name.toUpperCase(), style: "name" }));
    
    if (personal.professional_title) {
      content.push(new Paragraph({ text: personal.professional_title, style: "title" }));
    } else {
      const bioTitle = this.generateBioTitle(cvData);
      if (bioTitle) content.push(new Paragraph({ text: bioTitle, style: "title" }));
    }
    
    if (personal.location) {
      content.push(new Paragraph({ text: `📍 ${personal.location}`, style: "contactInfo" }));
    }
    
    const contactRow = this.createContactRow(personal);
    if (contactRow) content.push(contactRow);
    
    if (personal.linkedin) {
      content.push(new Paragraph({ text: `🔗 ${personal.linkedin}`, style: "contactInfo" }));
    }
    
    // Professional Summary (always include if available)
    if (cvData.professional_summary?.trim()) {
      content.push(new Paragraph({ text: "Professional Summary", style: "sectionHeading" }));
      content.push(new Paragraph({ text: cvData.professional_summary.substring(0, 600), style: "bodyText" }));
    }
    
    // Core Competencies / Skills
    if (cvData.skills?.length) {
      content.push(new Paragraph({ text: "Core Competencies", style: "sectionHeading" }));
      content.push(new Paragraph({ text: cvData.skills.slice(0, 20).join(' • '), style: "bodyText" }));
    }
    
    // Work Experience
    if (cvData.employment?.length) {
      content.push(new Paragraph({ text: "Work Experience", style: "sectionHeading" }));
      for (const job of cvData.employment) {
        const titleLine = job.title + (job.company ? ` | ${job.company}` : '');
        content.push(new Paragraph({ text: titleLine, style: "subsectionHeading" }));
        if (job.duration) content.push(new Paragraph({ text: job.duration, style: "companyDate" }));
        if (job.achievements?.length) {
          for (const ach of job.achievements) {
            if (ach?.trim()) content.push(new Paragraph({ text: `✓ ${ach}`, style: "bulletPoint" }));
          }
        }
        if (job.responsibilities?.length) {
          for (const resp of job.responsibilities) {
            if (resp?.trim()) content.push(new Paragraph({ text: `• ${resp}`, style: "bulletPoint" }));
          }
        }
        content.push(new Paragraph({ text: "" }));
      }
    }
    
    // Education
    if (cvData.education?.length) {
      content.push(new Paragraph({ text: "Education History", style: "sectionHeading" }));
      for (const edu of cvData.education) {
        const eduLine = edu.level + (edu.field ? ` in ${edu.field}` : '');
        content.push(new Paragraph({ text: eduLine, style: "subsectionHeading" }));
        if (edu.institution) content.push(new Paragraph({ text: edu.institution, style: "companyDate" }));
        if (edu.graduation_date) content.push(new Paragraph({ text: edu.graduation_date, style: "bodyText" }));
        content.push(new Paragraph({ text: "" }));
      }
    }
    
    // Leadership Experience
    if (cvData.leadership?.length) {
      content.push(new Paragraph({ text: "Leadership Experience", style: "sectionHeading" }));
      for (const lead of cvData.leadership) {
        content.push(new Paragraph({ text: `• ${lead}`, style: "bulletPoint" }));
      }
      content.push(new Paragraph({ text: "" }));
    }
    
    // Volunteer Experience
    if (cvData.volunteer_experience?.length) {
      content.push(new Paragraph({ text: "Volunteer Experience", style: "sectionHeading" }));
      for (const vol of cvData.volunteer_experience) {
        content.push(new Paragraph({ text: `• ${vol}`, style: "bulletPoint" }));
      }
      content.push(new Paragraph({ text: "" }));
    }
    
    // Certifications
    if (cvData.certifications?.length) {
      content.push(new Paragraph({ text: "Certifications", style: "sectionHeading" }));
      for (const cert of cvData.certifications) {
        let certText = cert.name;
        if (cert.year) certText += `, ${cert.year}`;
        content.push(new Paragraph({ text: `• ${certText}`, style: "bulletPoint" }));
      }
      content.push(new Paragraph({ text: "" }));
    }
    
    // Awards & Recognition
    if (cvData.awards?.length) {
      content.push(new Paragraph({ text: "Awards & Recognition", style: "sectionHeading" }));
      for (const award of cvData.awards.slice(0, 8)) {
        content.push(new Paragraph({ text: `• ${award.substring(0, 150)}`, style: "bulletPoint" }));
      }
      content.push(new Paragraph({ text: "" }));
    }
    
    // Conferences & Training
    if (cvData.conferences?.length) {
      content.push(new Paragraph({ text: "Conferences & Training", style: "sectionHeading" }));
      for (const conf of cvData.conferences) {
        content.push(new Paragraph({ text: `• ${conf}`, style: "bulletPoint" }));
      }
      content.push(new Paragraph({ text: "" }));
    }
    
    // Publications
    if (cvData.publications?.length) {
      content.push(new Paragraph({ text: "Publications", style: "sectionHeading" }));
      for (const pub of cvData.publications) {
        content.push(new Paragraph({ text: `• ${pub}`, style: "bulletPoint" }));
      }
      content.push(new Paragraph({ text: "" }));
    }
    
    // Projects
    if (cvData.projects?.length) {
      content.push(new Paragraph({ text: "Key Projects", style: "sectionHeading" }));
      for (const proj of cvData.projects) {
        content.push(new Paragraph({ text: `• ${proj.name}`, style: "bulletPoint" }));
        if (proj.description) content.push(new Paragraph({ text: `  ${proj.description.substring(0, 100)}`, style: "bulletPoint" }));
      }
      content.push(new Paragraph({ text: "" }));
    }
    
    // Extracurricular Activities
    if (cvData.extracurricular?.length) {
      content.push(new Paragraph({ text: "Extracurricular Activities", style: "sectionHeading" }));
      for (const activity of cvData.extracurricular) {
        content.push(new Paragraph({ text: `• ${activity}`, style: "bulletPoint" }));
      }
      content.push(new Paragraph({ text: "" }));
    }
    
    // Languages
    if (cvData.languages?.length) {
      content.push(new Paragraph({ text: "Languages", style: "sectionHeading" }));
      for (const lang of cvData.languages) {
        content.push(new Paragraph({ text: `• ${lang.name} (${lang.proficiency})`, style: "bulletPoint" }));
      }
      content.push(new Paragraph({ text: "" }));
    }
    
    // Referees
    if (cvData.referees?.length) {
      content.push(new Paragraph({ text: "Referees", style: "sectionHeading" }));
      for (const ref of cvData.referees) {
        if (ref.name) content.push(new Paragraph({ text: ref.name, style: "refereeName" }));
        if (ref.position) content.push(new Paragraph({ text: ref.position, style: "refereeDetails" }));
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
    const templateConfig = this.getTemplateConfig(industry);
    const colors = templateConfig.colors;
    const styles = this.getAptosStyles(colors, templateConfig);
    
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
    const skills = cvData.skills || [];
    const vacancyPosition = coverData.position || '';
    const vacancyCompany = coverData.company || '';
    
    const content = [];
    
    if (personal.full_name) {
      content.push(new Paragraph({ text: personal.full_name.toUpperCase(), style: "name" }));
    }
    
    const contactRow = this.createContactRow(personal);
    if (contactRow) content.push(contactRow);
    
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
    
    if (skills.length > 0 && vacancyPosition) {
      content.push(new Paragraph({ text: `My expertise in ${skills.slice(0, 3).join(', ')} aligns perfectly with the requirements of this role.`, style: "bodyText" }));
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

  // ============ PDF CONVERSION ============
  async convertToPDF(docxPath) {
    try {
      const pdfPath = docxPath.replace('.docx', '.pdf');
      // This requires libreoffice to be installed
      await execPromise(`libreoffice --headless --convert-to pdf "${docxPath}" --outdir "${path.dirname(pdfPath)}"`);
      return pdfPath;
    } catch (error) {
      console.error('PDF conversion error:', error);
      return null;
    }
  }

  // ============ LEGACY DOCUMENT CONVERSION ============
  async convertLegacyDocument(filePath, clientId, documentType = 'cv') {
    try {
      const extractedData = await this.extractFullCVData(filePath, documentType);
      
      let result;
      if (documentType === 'cv') {
        result = await this.generateCV(extractedData.data);
      } else {
        result = await this.generateCoverLetter({}, extractedData.data);
      }
      
      if (result.success && clientId) {
        this.registerClientDocument(clientId, documentType, path.basename(filePath), result.filePath, 'legacy_upload');
      }
      
      return result.success ? result : { success: false, error: result.error };
    } catch (error) {
      console.error('Conversion error:', error);
      return { success: false, error: error.message };
    }
  }

  registerClientDocument(clientId, documentType, originalName, convertedPath, generatedFrom, version = 1, parentVersionId = null) {
    if (!this.clientRegistry[clientId]) {
      this.clientRegistry[clientId] = {
        client_name: '',
        documents: [],
        created_at: new Date().toISOString()
      };
    }
    
    this.clientRegistry[clientId].documents.push({
      document_type: documentType,
      original_name: originalName,
      stored_path: convertedPath,
      generated_from: generatedFrom,
      generated_at: new Date().toISOString(),
      version: version,
      parent_version_id: parentVersionId,
      status: 'pending_review'
    });
    
    this.saveClientRegistry();
  }

  // ============ REVIEW LEARNING SYSTEM ============
  async learnFromAdminReview(originalPath, reviewedPath, corrections) {
    const learningEntry = {
      timestamp: new Date().toISOString(),
      original_file: originalPath,
      reviewed_file: reviewedPath,
      corrections_made: corrections,
      patterns: this.extractCorrectionPatterns(corrections)
    };
    
    this.reviewLearning.admin_patterns.push(learningEntry);
    
    if (this.reviewLearning.admin_patterns.length > 100) {
      this.reviewLearning.admin_patterns = this.reviewLearning.admin_patterns.slice(-100);
    }
    
    this.saveReviewLearning();
    return true;
  }

  extractCorrectionPatterns(corrections) {
    const patterns = [];
    const lowerCorrections = corrections.toLowerCase();
    
    if (lowerCorrections.includes('font') || lowerCorrections.includes('size')) patterns.push('font_adjustment');
    if (lowerCorrections.includes('color') || lowerCorrections.includes('colour')) patterns.push('color_change');
    if (lowerCorrections.includes('spacing') || lowerCorrections.includes('margin')) patterns.push('spacing_adjustment');
    if (lowerCorrections.includes('bullet') || lowerCorrections.includes('point')) patterns.push('bullet_style');
    if (lowerCorrections.includes('section') || lowerCorrections.includes('order')) patterns.push('section_reorder');
    if (lowerCorrections.includes('date') || lowerCorrections.includes('timeline')) patterns.push('date_format');
    if (lowerCorrections.includes('title') || lowerCorrections.includes('heading')) patterns.push('heading_style');
    
    return patterns;
  }

  getSuggestedAutoCorrections(cvData, industry) {
    const patterns = this.reviewLearning.admin_patterns;
    if (patterns.length === 0) return null;
    
    const patternCounts = {};
    for (const pattern of patterns) {
      for (const p of pattern.patterns) {
        patternCounts[p] = (patternCounts[p] || 0) + 1;
      }
    }
    
    const sorted = Object.entries(patternCounts).sort((a, b) => b[1] - a[1]);
    return sorted.slice(0, 5).map(([pattern]) => pattern);
  }

  // ============ HELPER METHODS ============
  generateBioTitle(cvData) {
    const jobTitles = cvData.employment?.map(j => j.title).filter(t => t) || [];
    const skills = cvData.skills?.slice(0, 3) || [];
    if (jobTitles.length > 0 && skills.length > 0) return `${jobTitles[0]} | ${skills.join(' | ')}`;
    if (jobTitles.length > 0) return jobTitles[0];
    return "";
  }

  createContactRow(personal) {
    const parts = [];
    if (personal.email) parts.push(new TextRun({ text: `✉️ ${personal.email}`, font: "Aptos", size: 22 }));
    if (personal.primary_phone) {
      if (parts.length) parts.push(new TextRun({ text: " | ", font: "Aptos", size: 22 }));
      parts.push(new TextRun({ text: `📞 ${personal.primary_phone}`, font: "Aptos", size: 22 }));
    }
    if (parts.length === 0) return null;
    return new Paragraph({ children: parts, style: "contactInfo" });
  }
}

module.exports = new DocumentGenerator();