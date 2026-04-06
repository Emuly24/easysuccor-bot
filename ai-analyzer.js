// ai-analyzer.js - Smart data analysis, vacancy extraction, certificate processing
const Tesseract = require('tesseract.js');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

class AIAnalyzer {
  constructor() {
    this.tempPath = path.join(__dirname, 'temp');
    this.uploadsPath = path.join(__dirname, 'uploads');
    this.certificatesPath = path.join(this.uploadsPath, 'certificates');
    
    if (!fs.existsSync(this.tempPath)) fs.mkdirSync(this.tempPath, { recursive: true });
    if (!fs.existsSync(this.uploadsPath)) fs.mkdirSync(this.uploadsPath, { recursive: true });
    if (!fs.existsSync(this.certificatesPath)) fs.mkdirSync(this.certificatesPath, { recursive: true });

    this.skillTemplates = {
      carpenter: [
        "Furniture design and construction", "Joinery and wood finishing", "Blueprint reading and interpretation",
        "Precision measurement and cutting", "Installation of interior fittings", "Power tools operation",
        "Project planning and execution", "Quality control and inspection", "Safety compliance", "Team collaboration"
      ],
      agriculture: [
        "Crop rotation and management", "Post-harvest handling", "Agro-processing", "Farm operations management",
        "Irrigation systems", "Soil analysis", "Pest and disease control", "Supply chain coordination",
        "Quality assurance", "Food safety compliance", "Team supervision", "Record keeping"
      ],
      teacher: [
        "Curriculum development", "Lesson planning", "Student assessment", "Classroom management",
        "Parent communication", "Educational technology", "Differentiated instruction", "Special needs education"
      ],
      project_management: [
        "Project planning and execution", "Risk management", "Stakeholder engagement", "Budget management",
        "Team leadership", "Agile methodology", "Strategic planning", "Resource mobilization",
        "Cross-functional collaboration", "Performance monitoring", "Change management", "Quality assurance"
      ],
      technology: [
        "Software development", "System architecture", "Database management", "API integration",
        "Cloud computing", "DevOps", "Cybersecurity", "Technical documentation",
        "Agile development", "Code review", "Testing and debugging", "UI/UX design"
      ],
      generic: [
        "Strategic planning", "Project management", "Team leadership", "Communication", 
        "Problem solving", "Time management", "Attention to detail", "Customer service"
      ]
    };

    this.responsibilityTemplates = {
      carpenter: [
        "Read and interpreted blueprints and technical drawings to ensure accurate project execution",
        "Measured, cut, and shaped wood materials using various power tools and hand tools",
        "Assembled and installed furniture, cabinets, and custom woodwork according to specifications",
        "Conducted quality checks to ensure work met client expectations and industry standards",
        "Collaborated with team members to complete projects within deadlines and budget"
      ],
      agriculture: [
        "Managed crop production cycles from planting to harvest ensuring optimal yield",
        "Implemented sustainable farming practices to improve soil health and productivity",
        "Oversaw post-harvest handling including sorting, grading, and storage operations",
        "Coordinated distribution logistics ensuring timely delivery of agricultural products",
        "Supervised farm workers providing training on modern agricultural techniques"
      ],
      teacher: [
        "Developed and implemented comprehensive lesson plans aligned with curriculum standards",
        "Assessed student progress through regular evaluations and provided constructive feedback",
        "Created engaging learning materials accommodating diverse learning styles",
        "Maintained positive classroom environment promoting student engagement",
        "Communicated effectively with parents regarding student progress and concerns"
      ],
      project_management: [
        "Led cross-functional teams to deliver projects on time and within budget",
        "Developed project plans, timelines, and resource allocation strategies",
        "Identified and mitigated risks throughout the project lifecycle",
        "Managed stakeholder expectations and communicated project status regularly",
        "Ensured compliance with organizational policies and industry standards"
      ],
      technology: [
        "Developed and maintained software applications using modern frameworks",
        "Collaborated with cross-functional teams to deliver technical solutions",
        "Wrote clean, maintainable code following industry best practices",
        "Participated in code reviews and contributed to technical documentation",
        "Troubleshot technical issues and provided timely resolutions"
      ],
      generic: [
        "Managed daily operations ensuring efficient workflow and productivity",
        "Collaborated with cross-functional teams to achieve organizational goals",
        "Maintained accurate records and documentation for audit compliance",
        "Communicated effectively with stakeholders and clients",
        "Implemented process improvements resulting in increased efficiency"
      ]
    };
  }

  // ============ VACANCY EXTRACTION ============
  // Extract client information from document
async extractFromDocument(fileUrl, fileName) {
    const fileExt = fileName.split('.').pop().toLowerCase();
    let extractedText = '';
    
    // Extract text based on file type
    if (fileExt === 'pdf') {
        // Use pdf-parse or similar
        extractedText = await this.extractFromPDF(fileUrl);
    } else if (fileExt === 'docx') {
        // Use mammoth or similar
        extractedText = await this.extractFromDOCX(fileUrl);
    } else if (['jpg', 'jpeg', 'png'].includes(fileExt)) {
        // Use OCR
        const result = await Tesseract.recognize(fileUrl, 'eng');
        extractedText = result.data.text;
    }
    
    // Extract client information from text
    return {
        client_name: this.extractName(extractedText),
        client_email: this.extractEmail(extractedText),
        client_phone: this.extractPhone(extractedText),
        client_location: this.extractLocation(extractedText),
        position: this.extractPosition(extractedText),
        company: this.extractCompany(extractedText)
    };
}

extractName(text) {
    // Look for name patterns at the beginning of CV
    const lines = text.split('\n');
    for (const line of lines.slice(0, 10)) {
        const cleanLine = line.trim();
        if (cleanLine.length > 3 && cleanLine.length < 50 && /^[A-Z][a-z]+ [A-Z][a-z]+/.test(cleanLine)) {
            return cleanLine;
        }
    }
    return null;
}

extractEmail(text) {
    const emailMatch = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
    return emailMatch ? emailMatch[0] : null;
}

extractPhone(text) {
    const phoneMatch = text.match(/\+?265[0-9]{9}|0[987][0-9]{8}/);
    return phoneMatch ? phoneMatch[0] : null;
}

extractLocation(text) {
    const locations = ['Lilongwe', 'Blantyre', 'Mzuzu', 'Zomba', 'Malawi'];
    for (const loc of locations) {
        if (text.includes(loc)) return loc;
    }
    return null;
}

extractPosition(text) {
    const lines = text.split('\n');
    for (const line of lines.slice(0, 20)) {
        if (line.toLowerCase().includes('position') || line.toLowerCase().includes('role')) {
            return line.split(':').pop().trim();
        }
    }
    return null;
}

extractCompany(text) {
    const lines = text.split('\n');
    for (const line of lines.slice(0, 20)) {
        if (line.toLowerCase().includes('company') || line.toLowerCase().includes('at ')) {
            return line.split(':').pop().trim();
        }
    }
    return null;
}
  
  async extractVacancyFromFile(fileUrl, fileName) {
    const fileExt = fileName.split('.').pop().toLowerCase();
    const localPath = path.join(this.tempPath, `vacancy_${Date.now()}.${fileExt}`);
    
    const response = await axios({ url: fileUrl, responseType: 'arraybuffer' });
    fs.writeFileSync(localPath, response.data);
    
    let extractedText = '';
    
    if (fileExt === 'txt') {
      extractedText = fs.readFileSync(localPath, 'utf8');
    } else if (['jpg', 'jpeg', 'png', 'gif', 'bmp'].includes(fileExt)) {
      const result = await Tesseract.recognize(localPath, 'eng');
      extractedText = result.data.text;
    } else {
      extractedText = "Document processing for this format requires additional setup. Please paste text manually.";
    }
    
    fs.unlinkSync(localPath);
    return this.extractVacancyDetails(extractedText);
  }

  extractVacancyDetails(text) {
    let company = '', position = '', deadline = '', location = '', salary = '';
    const requirements = [];
    
    const companyPatterns = [
      /(?:company|organization|firm)[:\s]+([A-Z][A-Za-z\s&]+)/i,
      /(?:at|for)\s+([A-Z][A-Za-z\s&]+)(?:\n|\.|,)/
    ];
    for (const pattern of companyPatterns) {
      const match = text.match(pattern);
      if (match && match[1].length < 50) { company = match[1].trim(); break; }
    }
    
    const positionPatterns = [
      /(?:position|role|job title)[:\s]+([A-Za-z\s]+)/i,
      /hiring\s+([A-Za-z\s]+)/i,
      /we are looking for a\s+([A-Za-z\s]+)/i
    ];
    for (const pattern of positionPatterns) {
      const match = text.match(pattern);
      if (match && match[1].length < 50) { position = match[1].trim(); break; }
    }
    
    const reqSection = text.match(/(?:requirements|qualifications|skills)[:\s]+([\s\S]+?)(?:\n\s*\n|$)/i);
    if (reqSection) {
      const reqLines = reqSection[1].split('\n');
      for (const line of reqLines) {
        const clean = line.replace(/^[•\-*\d.]\s*/, '').trim();
        if (clean && clean.length > 5 && clean.length < 100) requirements.push(clean);
      }
    }
    
    const deadlinePatterns = [/deadline[:\s]+([0-9]{1,2}[-/][0-9]{1,2}[-/][0-9]{2,4})/i, /apply by[:\s]+([0-9]{1,2}[-/][0-9]{1,2}[-/][0-9]{2,4})/i];
    for (const pattern of deadlinePatterns) {
      const match = text.match(pattern);
      if (match) { deadline = match[1]; break; }
    }
    
    return {
      company: company || 'Not specified',
      position: position || 'Not specified',
      requirements: requirements.slice(0, 10),
      deadline: deadline || 'Not specified',
      location: location || 'Not specified',
      salary: salary || 'Not specified',
      has_vacancy: company !== 'Not specified' || position !== 'Not specified'
    };
  }

  // ============ CERTIFICATE PROCESSING ============
  
  async processCertificate(fileUrl, fileName, userId) {
    const fileExt = fileName.split('.').pop().toLowerCase();
    const localPath = path.join(this.tempPath, `${userId}_${Date.now()}.${fileExt}`);
    const outputDir = path.join(this.certificatesPath, userId);
    
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
    
    const response = await axios({ url: fileUrl, responseType: 'arraybuffer' });
    fs.writeFileSync(localPath, response.data);
    
    const imagePaths = [];
    let extractedText = '';
    
    if (['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp'].includes(fileExt)) {
      const imagePath = path.join(outputDir, `${Date.now()}_original.${fileExt}`);
      fs.copyFileSync(localPath, imagePath);
      imagePaths.push(imagePath);
      const ocrResult = await Tesseract.recognize(localPath, 'eng');
      extractedText = ocrResult.data.text;
    } else if (fileExt === 'pdf') {
      try {
        const outputPattern = path.join(outputDir, `page_%d.jpg`);
        await execPromise(`magick convert -density 150 "${localPath}" -quality 90 "${outputPattern}"`);
        const files = fs.readdirSync(outputDir);
        for (const file of files) {
          if (file.startsWith('page_') && file.endsWith('.jpg')) {
            imagePaths.push(path.join(outputDir, file));
          }
        }
      } catch (error) {
        imagePaths.push(localPath);
      }
    } else {
      imagePaths.push(localPath);
    }
    
    fs.unlinkSync(localPath);
    
    let finalImages = imagePaths;
    if (imagePaths.length > 1) {
      finalImages = await this.mergeImagesVertically(imagePaths);
    }
    
    const certInfo = this.extractCertificateInfo(extractedText, fileName);
    
    return {
      success: true,
      images: Array.isArray(finalImages) ? finalImages : [finalImages],
      originalPageCount: imagePaths.length,
      mergedToSinglePage: imagePaths.length > 1,
      certificateInfo: certInfo
    };
  }

  async mergeImagesVertically(imagePaths) {
    const images = [];
    for (const imgPath of imagePaths) {
      const metadata = await sharp(imgPath).metadata();
      images.push({ input: imgPath, height: metadata.height });
      fs.unlinkSync(imgPath);
    }
    
    const totalHeight = images.reduce((sum, img) => sum + img.height, 0);
    const maxWidth = 500;
    
    const compositeOptions = [];
    let currentTop = 0;
    for (const img of images) {
      const resizedBuffer = await sharp(img.input).resize(maxWidth, null, { fit: 'inside' }).toBuffer();
      compositeOptions.push({ input: resizedBuffer, top: currentTop, left: 0 });
      currentTop += (await sharp(resizedBuffer).metadata()).height + 10;
    }
    
    const mergedBuffer = await sharp({
      create: { width: maxWidth, height: currentTop, channels: 3, background: { r: 255, g: 255, b: 255 } }
    }).composite(compositeOptions).png().toBuffer();
    
    const mergedPath = path.join(path.dirname(imagePaths[0]), `merged_${Date.now()}.png`);
    fs.writeFileSync(mergedPath, mergedBuffer);
    return mergedPath;
  }

  extractCertificateInfo(text, fileName) {
    let name = '';
    const namePatterns = [
      /(?:certificate|diploma|degree)[:\s]+([A-Za-z\s]+)/i,
      /^([A-Za-z\s]{10,50})$/m
    ];
    for (const pattern of namePatterns) {
      const match = text.match(pattern);
      if (match && match[1] && match[1].length < 60) { name = match[1].trim(); break; }
    }
    
    let issuer = '';
    const issuerPatterns = [
      /(?:issued by|institution|organization)[:\s]+([A-Za-z\s]+)/i,
      /(?:from|at)\s+([A-Za-z\s]{5,40})/i
    ];
    for (const pattern of issuerPatterns) {
      const match = text.match(pattern);
      if (match && match[1] && match[1].length < 50) { issuer = match[1].trim(); break; }
    }
    
    let date = '';
    const datePatterns = [/([0-9]{4})/m, /(?:date|completed)[:\s]+([0-9]{4})/i];
    for (const pattern of datePatterns) {
      const match = text.match(pattern);
      if (match) { date = match[1]; break; }
    }
    
    return { name: name || path.basename(fileName, path.extname(fileName)), issuer: issuer || 'Not specified', date: date || 'Not specified' };
  }

  // ============ PROFESSIONAL SUMMARY GENERATION ============
  
  generateProfessionalSummary(cvData, vacancyData = null) {
    const employment = cvData.employment || [];
    const education = cvData.education || [];
    const skills = cvData.skills || [];
    const certifications = cvData.certifications || [];
    
    let totalYears = 0;
    employment.forEach(job => {
      const match = (job.duration || '').match(/(\d+)/);
      if (match) totalYears += parseInt(match[1]);
    });
    
    const primaryJob = employment[0]?.title || 'Professional';
    const highestEdu = education[0] || {};
    const industry = this.detectIndustry(cvData);
    
    if (industry === 'project_management') {
      return `Results-oriented and versatile professional with a strong foundation in ${highestEdu.field || 'Project Management'}, and ICT-driven innovation. Skilled in leading cross-functional teams, managing risk, and delivering technology solutions that tackle real-world challenges. Experienced in entrepreneurship and non-profit leadership, with a proven ability to build partnerships, mobilize resources, and implement projects. Adept at combining ${skills.slice(0, 3).join(', ')} and strategic leadership to drive sustainable impact. Passionate about leveraging technology, research, and innovation to foster inclusive growth and digital transformation.`;
    }
    
    if (industry === 'technology') {
      return `Innovative ${primaryJob} with ${totalYears}+ years of experience in ${skills.slice(0, 3).join(', ')}. Skilled in developing scalable solutions, leading technical teams, and delivering impactful projects. ${highestEdu.level ? `Holds ${highestEdu.level} in ${highestEdu.field}.` : ''} Committed to leveraging technology for social impact and business growth.`;
    }
    
    if (industry === 'carpentry') {
      return `Skilled ${primaryJob} with ${totalYears}+ years of hands-on experience in furniture making, joinery, and interior installations. Proficient in reading technical drawings, precision measurement, and delivering high-quality finishes. ${highestEdu.level ? `Holds ${highestEdu.level}${highestEdu.field ? ` in ${highestEdu.field}` : ''}.` : ''} Dedicated to safety, teamwork, and quality craftsmanship.`;
    }
    
    if (industry === 'agriculture') {
      return `Dedicated ${primaryJob} with ${totalYears}+ years of experience in crop production, post-harvest management, and agro-processing. Skilled in sustainable farming practices, quality control, and team supervision. ${highestEdu.level ? `${highestEdu.level} in ${highestEdu.field || 'Agriculture'}.` : ''} Committed to reducing post-harvest losses and improving food security.`;
    }
    
    return `Experienced ${primaryJob} with ${totalYears}+ years of expertise. Demonstrated success in delivering results. ${highestEdu.level ? `Holds ${highestEdu.level} in ${highestEdu.field}.` : ''} Strong ${skills.slice(0, 3).join(', ')} skills with proven track record. ${vacancyData?.position ? `Seeking to leverage expertise as ${vacancyData.position} at ${vacancyData.company || 'your organization'}.` : ''}`;
  }

  // ============ INTELLIGENT SKILLS EXTRAPOLATION ============
  
  extrapolateSkills(cvData, vacancyData = null) {
    let existingSkills = cvData.skills || [];
    const employment = cvData.employment || [];
    const allText = employment.map(j => `${j.title} ${j.company}`).join(' ').toLowerCase();
    
    let impliedSkills = [];
    if (allText.includes('carpenter') || allText.includes('joiner')) {
      impliedSkills = ['Furniture Design', 'Joinery', 'Blueprint Reading', 'Precision Measurement', 'Power Tools Operation'];
    } else if (allText.includes('agriculture') || allText.includes('farm')) {
      impliedSkills = ['Crop Production', 'Post-Harvest Management', 'Irrigation Systems', 'Farm Operations', 'Quality Control'];
    } else if (allText.includes('teach') || allText.includes('education')) {
      impliedSkills = ['Curriculum Development', 'Lesson Planning', 'Student Assessment', 'Classroom Management', 'Parent Communication'];
    } else if (allText.includes('project') || allText.includes('manager')) {
      impliedSkills = ['Project Planning', 'Risk Management', 'Stakeholder Engagement', 'Budget Management', 'Team Leadership', 'Strategic Planning'];
    } else if (allText.includes('software') || allText.includes('developer') || allText.includes('engineer')) {
      impliedSkills = ['Software Development', 'System Architecture', 'Database Management', 'API Integration', 'Agile Methodology'];
    }
    
    let vacancySkills = [];
    if (vacancyData?.requirements) {
      vacancySkills = vacancyData.requirements.filter(r => r.length < 40).slice(0, 5);
    }
    
    let allSkills = [...existingSkills, ...impliedSkills, ...vacancySkills];
    while (allSkills.length < 8) {
      allSkills.push('Professional Communication');
      allSkills.push('Team Collaboration');
    }
    
    return [...new Set(allSkills)];
  }

  // ============ RESPONSIBILITY ENHANCEMENT ============
  
  enhanceResponsibilities(jobTitle, existingResponsibilities, industry) {
    if (existingResponsibilities.length >= 4) return existingResponsibilities;
    
    const templates = this.responsibilityTemplates[industry] || this.responsibilityTemplates.generic;
    let enhanced = [...existingResponsibilities];
    const needed = Math.max(0, 4 - enhanced.length);
    
    for (let i = 0; i < needed && i < templates.length; i++) {
      const isDuplicate = enhanced.some(r => r.toLowerCase().includes(templates[i].toLowerCase().split(' ').slice(0, 3).join(' ')));
      if (!isDuplicate) enhanced.push(templates[i]);
    }
    return enhanced;
  }

  // ============ INDUSTRY DETECTION ============
  
  detectIndustry(cvData) {
    const allText = cvData.employment?.map(j => j.title).join(' ').toLowerCase() || '';
    if (allText.includes('carpenter') || allText.includes('joiner')) return 'carpentry';
    if (allText.includes('agriculture') || allText.includes('farm')) return 'agriculture';
    if (allText.includes('teach') || allText.includes('education')) return 'teacher';
    if (allText.includes('project') || allText.includes('manager') || allText.includes('coordinator')) return 'project_management';
    if (allText.includes('software') || allText.includes('developer') || allText.includes('engineer')) return 'technology';
    return 'generic';
  }

  // ============ ACHIEVEMENT EXTRACTION ============
  
  extractAchievements(employment) {
    const achievements = [];
    const keywords = ['increased', 'reduced', 'improved', 'managed', 'led', 'created', 'developed', 'designed', 'implemented', 'achieved', 'delivered', 'spearheaded'];
    
    for (const job of employment) {
      if (job.responsibilities) {
        for (const resp of job.responsibilities) {
          const lowerResp = resp.toLowerCase();
          for (const keyword of keywords) {
            if (lowerResp.includes(keyword)) {
              achievements.push(resp);
              break;
            }
          }
        }
      }
    }
    
    if (achievements.length === 0 && employment.length > 0) {
      achievements.push(`Successfully performed duties as ${employment[0].title}`);
    }
    
    return achievements.slice(0, 5);
  }

  // ============ COMPLETE CV DATA ENHANCEMENT ============
  
  async enhanceCVData(rawCvData, vacancyData = null) {
    const enhancedSkills = this.extrapolateSkills(rawCvData, vacancyData);
    const enhancedEmployment = (rawCvData.employment || []).map(job => {
      const industry = this.detectIndustry({ employment: [job] });
      return { ...job, responsibilities: this.enhanceResponsibilities(job.title, job.responsibilities || [], industry) };
    });
    const enhancedSummary = this.generateProfessionalSummary({ ...rawCvData, employment: enhancedEmployment, skills: enhancedSkills }, vacancyData);
    
    return {
      ...rawCvData,
      professional_summary: enhancedSummary,
      skills: enhancedSkills,
      employment: enhancedEmployment,
      ai_enhanced: true,
      enhancement_notes: {
        skills_added: enhancedSkills.filter(s => !(rawCvData.skills || []).includes(s)).length,
        responsibilities_enhanced: enhancedEmployment.filter((job, i) => job.responsibilities.length !== (rawCvData.employment?.[i]?.responsibilities?.length || 0)).length
      }
    };
  }
}

module.exports = new AIAnalyzer();