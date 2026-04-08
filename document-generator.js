// document-generator.js - Complete Professional CV & Cover Letter Generator with Deep Extraction
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
    this.uploadsPath = path.join(__dirname, 'uploads');
    this.convertedPath = path.join(this.uploadsPath, 'converted');
    this.clientArchivePath = path.join(this.exportsPath, 'client_archives');
    
    // Create all directories
    [this.cvPath, this.coverPath, this.convertedPath, this.clientArchivePath].forEach(p => {
      if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
    });
    
    // Client document registry
    this.clientRegistryPath = path.join(this.exportsPath, 'client_registry.json');
    this.clientRegistry = this.loadClientRegistry();
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
// ============ EXTRACT FULL CV DATA FROM URL (FOR BOT DRAFT UPLOAD) ============

async extractFullCVDataFromUrl(fileUrl, fileName) {
    try {
        // Create temp file path
        const tempDir = path.join(__dirname, 'temp');
        if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
        
        const tempFilePath = path.join(tempDir, `temp_${Date.now()}_${fileName}`);
        
        // Download file from URL
        await this.downloadFile(fileUrl, tempFilePath);
        
        // Extract data from the downloaded file
        const result = await this.extractFullCVData(tempFilePath, 'cv');
        
        // Clean up temp file
        fs.unlinkSync(tempFilePath);
        
        return result;
    } catch (error) {
        console.error('extractFullCVDataFromUrl error:', error);
        return { success: false, error: error.message };
    }
}

// ============ DOWNLOAD FILE FROM URL ============

async downloadFile(url, outputPath) {
    try {
        const axios = require('axios');
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
}// ============ EXTRACT FULL CV DATA FROM LOCAL FILE ============

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

  // ============ DEEP VACANCY EXTRACTION ============
  
  async extractVacancyFromFile(fileUrl, fileName) {
    const fileExt = fileName.split('.').pop().toLowerCase();
    const tempDir = path.join(__dirname, 'temp');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
    
    const localPath = path.join(tempDir, `vacancy_${Date.now()}.${fileExt}`);
    
    // Download file
    const response = await axios({ url: fileUrl, responseType: 'arraybuffer' });
    fs.writeFileSync(localPath, response.data);
    
    let extractedText = '';
    
    if (fileExt === 'txt') {
      extractedText = fs.readFileSync(localPath, 'utf8');
    } else if (['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp'].includes(fileExt)) {
      const Tesseract = require('tesseract.js');
      const result = await Tesseract.recognize(localPath, 'eng');
      extractedText = result.data.text;
    } else if (fileExt === 'pdf') {
      try {
        const txtPath = localPath.replace('.pdf', '.txt');
        await execPromise(`pdftotext -layout "${localPath}" "${txtPath}"`);
        extractedText = fs.readFileSync(txtPath, 'utf8');
        fs.unlinkSync(txtPath);
      } catch (error) {
        extractedText = '';
      }
    } else if (fileExt === 'docx') {
      try {
        const txtPath = localPath.replace('.docx', '.txt');
        await execPromise(`docx2txt "${localPath}" "${txtPath}"`);
        extractedText = fs.readFileSync(txtPath, 'utf8');
        fs.unlinkSync(txtPath);
      } catch (error) {
        extractedText = '';
      }
    }
    
    fs.unlinkSync(localPath);
    return this.deepExtractVacancyDetails(extractedText);
  }

  deepExtractVacancyDetails(text) {
    const vacancy = {
      company: '',
      position: '',
      location: '',
      salary: '',
      deadline: '',
      job_type: '',
      experience_required: '',
      education_required: '',
      requirements: [],
      responsibilities: [],
      benefits: [],
      contact_person: '',
      contact_email: '',
      contact_phone: '',
      application_method: '',
      raw_text: text
    };
    
    // ============ COMPANY EXTRACTION ============
    const companyPatterns = [
      /(?:company|organization|firm|employer|hiring)[:\s]+([A-Z][A-Za-z\s&.]+)(?:\n|\.|,)/i,
      /(?:at|for|with)\s+([A-Z][A-Za-z\s&.]+)(?:\n|\.|,)/i,
      /^([A-Z][A-Za-z\s&.]+)(?:\s+is\s+hiring|\s+seeks|\s+looking for)/im,
      /(?:about us|who we are)[:\s]+([A-Z][A-Za-z\s&.]+)/i,
      /(?:working for|join)\s+([A-Z][A-Za-z\s&.]+)/i
    ];
    for (const pattern of companyPatterns) {
      const match = text.match(pattern);
      if (match && match[1] && match[1].length < 60) {
        vacancy.company = match[1].trim();
        break;
      }
    }
    
    // ============ POSITION EXTRACTION ============
    const positionPatterns = [
      /(?:position|role|job title|vacancy)[:\s]+([A-Za-z\s/&]+)(?:\n|\.|,)/i,
      /(?:hiring|seeking|looking for|recruiting)[:\s]+([A-Za-z\s/&]+)/i,
      /(?:we are looking for a|we need a|wanted)[:\s]+([A-Za-z\s/&]+)/i,
      /^([A-Z][A-Za-z\s/&]+)(?:\s+at\s+|\s+-\s+)/im,
      /(?:title|designation)[:\s]+([A-Za-z\s/&]+)/i,
      /(?:job opportunity|career opportunity)[:\s]+([A-Za-z\s/&]+)/i
    ];
    for (const pattern of positionPatterns) {
      const match = text.match(pattern);
      if (match && match[1] && match[1].length < 80) {
        vacancy.position = match[1].trim();
        break;
      }
    }
    
    // ============ LOCATION EXTRACTION ============
    const locationPatterns = [
      /(?:location|work location|office|based in|site)[:\s]+([A-Za-z\s,]+)/i,
      /(?:in|at)\s+([A-Z][a-z]+(?:,\s*[A-Z][a-z]+)?)(?:\n|\.|,)/i,
      /(?:city|town|area|region)[:\s]+([A-Za-z\s]+)/i,
      /(?:Lilongwe|Blantyre|Mzuzu|Zomba|Mulanje|Dedza|Salima|Malawi)/gi
    ];
    for (const pattern of locationPatterns) {
      const match = text.match(pattern);
      if (match) {
        vacancy.location = match[1] || match[0];
        break;
      }
    }
    
    // ============ SALARY EXTRACTION ============
    const salaryPatterns = [
      /(?:salary|compensation|pay|wage|remuneration)[:\s]+([MKk\d\s,]+)/i,
      /(?:MK|MWK|K)\s*(\d[\d,]+)/i,
      /(\d[\d,]+)\s*(?:MK|MWK|kwacha)/i,
      /(?:between|from)\s+(\d[\d,]+)\s+(?:to|and)\s+(\d[\d,]+)/i,
      /(?:up to|maximum)\s+(\d[\d,]+)/i
    ];
    for (const pattern of salaryPatterns) {
      const match = text.match(pattern);
      if (match) {
        vacancy.salary = match[0].replace(/^[^:]+:/, '').trim();
        break;
      }
    }
    
    // ============ DEADLINE EXTRACTION ============
    const deadlinePatterns = [
      /(?:deadline|closing date|application deadline|apply by|cutoff)[:\s]+(\d{1,2}[-/]\d{1,2}[-/]\d{2,4})/i,
      /(?:deadline|closing date|application deadline|apply by|cutoff)[:\s]+([A-Za-z]+\s+\d{1,2},?\s+\d{4})/i,
      /(?:submit by|send by|closes on)[:\s]+(\d{1,2}[-/]\d{1,2}[-/]\d{2,4})/i,
      /(?:no later than|not later than)[:\s]+(\d{1,2}[-/]\d{1,2}[-/]\d{2,4})/i
    ];
    for (const pattern of deadlinePatterns) {
      const match = text.match(pattern);
      if (match) {
        vacancy.deadline = match[1];
        break;
      }
    }
    
    // ============ JOB TYPE EXTRACTION ============
    const jobTypePatterns = [
      /(?:job type|employment type|work type)[:\s]+(Full-time|Part-time|Contract|Temporary|Internship|Remote|Hybrid)/i,
      /(Full-time|Part-time|Contract|Temporary|Internship|Remote|Hybrid)/i
    ];
    for (const pattern of jobTypePatterns) {
      const match = text.match(pattern);
      if (match) {
        vacancy.job_type = match[1] || match[0];
        break;
      }
    }
    
    // ============ EXPERIENCE REQUIRED EXTRACTION ============
    const expPatterns = [
      /(?:experience required|years of experience)[:\s]+(\d+[\+]?\s*years?)/i,
      /(\d+[\+]?\s*years?)\s+(?:of|experience)/i,
      /(?:minimum|at least)\s+(\d+)\s*years?/i
    ];
    for (const pattern of expPatterns) {
      const match = text.match(pattern);
      if (match) {
        vacancy.experience_required = match[1] || match[0];
        break;
      }
    }
    
    // ============ EDUCATION REQUIRED EXTRACTION ============
    const eduPatterns = [
      /(?:education required|qualification|degree required)[:\s]+([A-Za-z\s]+)/i,
      /(?:Bachelor|Master|PhD|Diploma|Certificate|Degree)[:\s]*([A-Za-z\s]+)/i
    ];
    for (const pattern of eduPatterns) {
      const match = text.match(pattern);
      if (match) {
        vacancy.education_required = match[1] || match[0];
        break;
      }
    }
    
    // ============ REQUIREMENTS EXTRACTION ============
    const reqSection = text.match(/(?:requirements|qualifications|skills|what we need|candidate profile)[:\s]*([\s\S]+?)(?=\n\s*(?:responsibilities|benefits|how to apply|deadline|$))/i);
    if (reqSection) {
      const reqLines = reqSection[1].split(/[•\-*\n]/);
      for (const line of reqLines) {
        const clean = line.replace(/^[•\-*\d+.]\s*/, '').trim();
        if (clean && clean.length > 5 && clean.length < 150) {
          vacancy.requirements.push(clean);
        }
      }
    }
    
    // ============ RESPONSIBILITIES EXTRACTION ============
    const respSection = text.match(/(?:responsibilities|duties|what you'll do|role involves)[:\s]*([\s\S]+?)(?=\n\s*(?:requirements|benefits|how to apply|qualifications|$))/i);
    if (respSection) {
      const respLines = respSection[1].split(/[•\-*\n]/);
      for (const line of respLines) {
        const clean = line.replace(/^[•\-*\d+.]\s*/, '').trim();
        if (clean && clean.length > 5 && clean.length < 150) {
          vacancy.responsibilities.push(clean);
        }
      }
    }
    
    // ============ BENEFITS EXTRACTION ============
    const benSection = text.match(/(?:benefits|what we offer|perks)[:\s]*([\s\S]+?)(?=\n\s*(?:requirements|how to apply|deadline|$))/i);
    if (benSection) {
      const benLines = benSection[1].split(/[•\-*\n]/);
      for (const line of benLines) {
        const clean = line.replace(/^[•\-*\d+.]\s*/, '').trim();
        if (clean && clean.length > 5 && clean.length < 100) {
          vacancy.benefits.push(clean);
        }
      }
    }
    
    // ============ CONTACT INFORMATION EXTRACTION ============
    const contactEmailMatch = text.match(/(?:contact|send to|email)[:\s]+([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i);
    if (contactEmailMatch) vacancy.contact_email = contactEmailMatch[1];
    
    const contactPhoneMatch = text.match(/(?:contact|call|phone)[:\s]+([+\d\s-]{8,})/i);
    if (contactPhoneMatch) vacancy.contact_phone = contactPhoneMatch[1];
    
    const contactPersonMatch = text.match(/(?:contact person|hiring manager|recruiter)[:\s]+([A-Z][a-z]+\s+[A-Z][a-z]+)/i);
    if (contactPersonMatch) vacancy.contact_person = contactPersonMatch[1];
    
    // ============ APPLICATION METHOD EXTRACTION ============
    const appPatterns = [
      /(?:how to apply|to apply|application process)[:\s]+([\s\S]+?)(?=\n\s*(?:deadline|requirements|$))/i,
      /(?:send your|cv to|resume to|application to)[:\s]+([^\n]+)/i
    ];
    for (const pattern of appPatterns) {
      const match = text.match(pattern);
      if (match) {
        vacancy.application_method = match[1].trim();
        break;
      }
    }
    
    vacancy.has_vacancy = vacancy.company !== '' || vacancy.position !== '';
    vacancy.requirements = vacancy.requirements.slice(0, 15);
    vacancy.responsibilities = vacancy.responsibilities.slice(0, 10);
    
    return vacancy;
  }

  // ============ DEEP CV TEXT EXTRACTION ============
  
  async extractFullCVData(filePath, fileType = 'cv') {
    try {
      const rawText = await this.extractTextFromFile(filePath);
      const structuredData = this.deepParseCVText(rawText, fileType);
      this.enhanceExtractedData(structuredData);
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

  deepParseCVText(text, fileType) {
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    
    const cvData = {
      personal: { 
        full_name: '', email: '', primary_phone: '', alternative_phone: '', 
        whatsapp_phone: '', location: '', physical_address: '', 
        nationality: '', linkedin: '', portfolio: '', professional_title: '' 
      },
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

    // ============ ENHANCED PHONE EXTRACTION ============
    const phonePatterns = [
      /(\+?265|0)[1-9][0-9]{7,8}/g,
      /(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g,
      /(?:phone|tel|mobile|cell|whatsapp)[:\s]+([+\d\s-]{8,})/gi,
      /(?:contact|call me at)[:\s]+([+\d\s-]{8,})/gi,
      /[0-9]{3}[-.\s][0-9]{3}[-.\s][0-9]{4}/g,
      /[0-9]{4}[-.\s][0-9]{3}[-.\s][0-9]{3}/g,
      /(?:0[987]|265[987])[0-9]{7,8}/g
    ];
    
    // ============ ENHANCED EMAIL EXTRACTION ============
    const emailPatterns = [
      /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
      /(?:email|e-mail)[:\s]+([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/gi,
      /(?:contact|reach me at)[:\s]+([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/gi
    ];
    
    // ============ ENHANCED LOCATION EXTRACTION ============
    const locationPatterns = [
      /(?:location|address|based in|resides in|lives in)[:\s]+([A-Za-z\s,.-]+)/gi,
      /([A-Z][a-z]+,\s*[A-Z][a-z]+|[A-Z][a-z]+\s*-\s*[A-Z][a-z]+)/g,
      /(?:city|town|area)[:\s]+([A-Za-z\s]+)/gi,
      /(?:Malawi|Lilongwe|Blantyre|Mzuzu|Zomba|Mulanje|Dedza|Salima)/gi
    ];
    
    // ============ ENHANCED ADDRESS EXTRACTION ============
    const addressPatterns = [
      /(?:address|physical address|postal address|street)[:\s]+([A-Za-z0-9\s,.#-]{10,})/gi,
      /(?:P\.?O\.?\s*Box|PO Box)[:\s]*([0-9]+)/gi,
      /(?:house|plot|flat|unit|building)[:\s]*([A-Za-z0-9\s,.#-]+)/gi,
      /(?:area|section|estate)[:\s]+([A-Za-z\s]+)/gi
    ];
    
    // ============ NAME EXTRACTION ============
    const namePatterns = [
      /^(?:name|full name|applicant|candidate)[:\s]+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})/gim,
      /^([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})$/gm,
      /(?:my name is|i am|i'm)[:\s]+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})/gi
    ];
    
    // ============ NATIONALITY EXTRACTION ============
    const nationalityPatterns = [
      /(?:nationality|citizenship|from)[:\s]+([A-Z][a-z]+)/gi,
      /(?:Malawian|Zambian|Mozambican|South African|British|American|Indian|Chinese)/gi
    ];
    
    // Extract phones
    const phones = [];
    for (const pattern of phonePatterns) {
      const matches = text.match(pattern);
      if (matches) phones.push(...matches);
    }
    const uniquePhones = [...new Set(phones)];
    if (uniquePhones.length > 0) cvData.personal.primary_phone = uniquePhones[0];
    if (uniquePhones.length > 1) cvData.personal.alternative_phone = uniquePhones[1];
    
    // Extract emails
    const emails = [];
    for (const pattern of emailPatterns) {
      const matches = text.match(pattern);
      if (matches) emails.push(...matches);
    }
    const uniqueEmails = [...new Set(emails)];
    if (uniqueEmails.length > 0) cvData.personal.email = uniqueEmails[0];
    
    // Extract location
    for (const pattern of locationPatterns) {
      const match = text.match(pattern);
      if (match && match[1] && !cvData.personal.location) {
        cvData.personal.location = match[1].trim();
        break;
      }
    }
    
    // Extract address
    for (const pattern of addressPatterns) {
      const match = text.match(pattern);
      if (match && match[1] && !cvData.personal.physical_address) {
        cvData.personal.physical_address = match[1].trim();
        break;
      }
    }
    
    // Extract name
    for (const pattern of namePatterns) {
      const match = text.match(pattern);
      if (match && match[1] && !cvData.personal.full_name) {
        cvData.personal.full_name = match[1].trim();
        break;
      }
    }
    if (!cvData.personal.full_name && lines.length > 0) {
      cvData.personal.full_name = lines[0];
    }
    
    // Extract nationality
    for (const pattern of nationalityPatterns) {
      const match = text.match(pattern);
      if (match) {
        cvData.personal.nationality = match[1] || match[0];
        break;
      }
    }
    
    // Extract LinkedIn
    const linkedinMatch = text.match(/linkedin\.com\/in\/[a-zA-Z0-9-]+/i);
    if (linkedinMatch) cvData.personal.linkedin = linkedinMatch[0];
    
    // Extract professional summary
    const summarySection = this.extractTextSection(text, ['professional summary', 'executive summary', 'career objective', 'profile']);
    if (summarySection) {
      cvData.professional_summary = summarySection;
    }
    
    // Extract work experience
    const workSection = this.extractTextSection(text, ['work experience', 'employment history', 'professional experience', 'work history']);
    if (workSection) {
      cvData.employment = this.parseWorkExperience(workSection);
    }
    
    // Extract education
    const eduSection = this.extractTextSection(text, ['education', 'academic background', 'qualifications', 'training']);
    if (eduSection) {
      cvData.education = this.parseEducation(eduSection);
    }
    
    // Extract skills
    const skillsSection = this.extractTextSection(text, ['skills', 'core competencies', 'technical skills', 'expertise']);
    if (skillsSection) {
      cvData.skills = this.parseSkills(skillsSection);
    }
    
    // Extract certifications
    const certSection = this.extractTextSection(text, ['certifications', 'certificates', 'licenses']);
    if (certSection) {
      cvData.certifications = this.parseCertifications(certSection);
    }
    
    // Extract languages
    const langSection = this.extractTextSection(text, ['languages', 'language proficiency']);
    if (langSection) {
      cvData.languages = this.parseLanguages(langSection);
    }
    
    // Extract referees
    const refSection = this.extractTextSection(text, ['referees', 'references', 'recommendations']);
    if (refSection) {
      cvData.referees = this.parseReferees(refSection);
    }
    
    return cvData;
  }

  extractTextSection(text, sectionNames) {
    const lines = text.split('\n');
    let inSection = false;
    let sectionContent = [];
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].toLowerCase();
      
      for (const name of sectionNames) {
        if (line.includes(name.toLowerCase())) {
          inSection = true;
          continue;
        }
      }
      
      if (inSection && lines[i].match(/^[A-Z][a-z]+\s+[A-Za-z]+:/)) {
        break;
      }
      
      if (inSection && lines[i].trim().length > 0 && !lines[i].match(/^[A-Z][a-z]+:/)) {
        sectionContent.push(lines[i]);
      }
    }
    
    return sectionContent.join('\n');
  }

  parseWorkExperience(workSection) {
    const jobs = [];
    const lines = workSection.split('\n');
    let currentJob = null;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      
      const isJobTitle = line.match(/^[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*/) && 
                        (line.includes(' at ') || line.includes(' - ') || line.length < 60);
      
      if (isJobTitle && !line.toLowerCase().includes('experience')) {
        if (currentJob) jobs.push(currentJob);
        currentJob = { title: '', company: '', duration: '', responsibilities: [], achievements: [] };
        
        const atIndex = line.indexOf(' at ');
        const dashIndex = line.indexOf(' - ');
        
        if (atIndex > -1) {
          currentJob.title = line.substring(0, atIndex).trim();
          currentJob.company = line.substring(atIndex + 4).trim();
        } else if (dashIndex > -1) {
          currentJob.title = line.substring(0, dashIndex).trim();
          currentJob.company = line.substring(dashIndex + 3).trim();
        } else {
          currentJob.title = line;
        }
        
        if (lines[i+1] && lines[i+1].match(/\d{4}\s*[-–—]\s*\d{4}|\d{4}\s*[-–—]\s*Present/)) {
          currentJob.duration = lines[i+1].trim();
          i++;
        }
      } 
      else if (currentJob && (line.startsWith('•') || line.startsWith('-') || line.startsWith('*') || line.match(/^\d+\./))) {
        const cleanLine = line.replace(/^[•\-*\d+\.]\s*/, '');
        if (cleanLine.match(/\b\d+%\b|\bincreased\b|\breduced\b|\blaunched\b|\bmanaged\b|\bled\b|\bachieved\b/)) {
          currentJob.achievements.push(cleanLine);
        } else if (cleanLine.length > 5) {
          currentJob.responsibilities.push(cleanLine);
        }
      }
    }
    
    if (currentJob) jobs.push(currentJob);
    return jobs;
  }

  parseEducation(eduSection) {
    const education = [];
    const lines = eduSection.split('\n');
    let currentEdu = null;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      
      const isDegree = line.match(/Bachelor|Master|PhD|Diploma|Degree|Certificate|High School|Secondary|Associate/i);
      
      if (isDegree) {
        if (currentEdu) education.push(currentEdu);
        currentEdu = { level: line, field: '', institution: '', graduation_date: '' };
        
        for (let j = 1; j <= 3; j++) {
          if (lines[i+j] && !lines[i+j].match(/Bachelor|Master|PhD|Diploma|Degree|Certificate/i)) {
            if (lines[i+j].length > 3 && !lines[i+j].match(/\d{4}/)) {
              if (!currentEdu.institution) currentEdu.institution = lines[i+j].trim();
              else if (!currentEdu.field) currentEdu.field = lines[i+j].trim();
              break;
            }
          }
        }
      }
      else if (currentEdu && line.match(/\d{4}/)) {
        currentEdu.graduation_date = line;
      }
      else if (currentEdu && !currentEdu.field && line.length > 5 && !line.includes('@')) {
        currentEdu.field = line;
      }
    }
    
    if (currentEdu) education.push(currentEdu);
    return education;
  }

  parseSkills(skillsSection) {
    const skills = new Set();
    const lines = skillsSection.split('\n');
    
    for (const line of lines) {
      const items = line.split(/[•,•\-|;\n]/);
      for (const item of items) {
        const clean = item.trim();
        if (clean.length > 1 && clean.length < 40 && !clean.match(/^\d+$/)) {
          skills.add(clean);
        }
      }
    }
    
    return Array.from(skills).slice(0, 30);
  }

  parseCertifications(certSection) {
    const certifications = [];
    const lines = certSection.split('\n');
    
    for (const line of lines) {
      if (line.length > 5 && line.length < 100) {
        const yearMatch = line.match(/\b(19|20)[0-9]{2}\b/);
        certifications.push({
          name: line.replace(yearMatch ? yearMatch[0] : '', '').replace(/[,\-•]$/, '').trim(),
          year: yearMatch ? yearMatch[0] : ''
        });
      }
    }
    
    return certifications;
  }

  parseLanguages(langSection) {
    const languages = [];
    const lines = langSection.split('\n');
    
    for (const line of lines) {
      const langMatch = line.match(/([A-Za-z]+)\s*[–\-]\s*(Fluent|Native|Intermediate|Basic|Advanced|Professional|Conversational)/i);
      if (langMatch) {
        languages.push({ name: langMatch[1], proficiency: langMatch[2] });
      } else if (line.length < 30 && line.length > 2) {
        languages.push({ name: line, proficiency: 'Professional' });
      }
    }
    
    return languages;
  }

  parseReferees(refSection) {
    const referees = [];
    const lines = refSection.split('\n');
    let currentRef = null;
    
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      
      if (!trimmed.includes('@') && !trimmed.match(/[\d-]{10,}/) && trimmed.length < 40 && !currentRef) {
        if (currentRef) referees.push(currentRef);
        currentRef = { name: trimmed, position: '', contact: '', email: '', phone: '' };
      }
      else if (currentRef && trimmed.includes('@')) {
        currentRef.email = trimmed;
        currentRef.contact = trimmed;
      }
      else if (currentRef && trimmed.match(/[\d-]{10,}/)) {
        currentRef.phone = trimmed;
        currentRef.contact = trimmed;
      }
      else if (currentRef && trimmed.length < 60 && !trimmed.includes('@') && !trimmed.match(/[\d-]{10,}/)) {
        currentRef.position = trimmed;
      }
    }
    
    if (currentRef) referees.push(currentRef);
    return referees;
  }

  enhanceExtractedData(cvData) {
    if (cvData.personal.primary_phone) {
      cvData.personal.primary_phone = cvData.personal.primary_phone.replace(/[^0-9+]/g, '');
      if (cvData.personal.primary_phone.startsWith('0') && cvData.personal.primary_phone.length === 9) {
        cvData.personal.primary_phone = '+265' + cvData.personal.primary_phone.substring(1);
      }
    }
    
    if (cvData.personal.email) {
      cvData.personal.email = cvData.personal.email.toLowerCase();
    }
    
    if (cvData.personal.full_name) {
      cvData.personal.full_name = cvData.personal.full_name.split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ');
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
    
    if (cvData.professional_summary) {
      content.push(new Paragraph({ text: "Professional Summary", style: "sectionHeading" }));
      content.push(new Paragraph({ text: cvData.professional_summary, style: "bodyText" }));
    }
    
    if (cvData.skills?.length) {
      content.push(new Paragraph({ text: "Core Competencies", style: "sectionHeading" }));
      content.push(new Paragraph({ text: cvData.skills.join(' • '), style: "bodyText" }));
    }
    
    if (cvData.employment?.length) {
      content.push(new Paragraph({ text: "Work Experience", style: "sectionHeading" }));
      for (const job of cvData.employment) {
        const titleLine = job.title + (job.company ? ` | ${job.company}` : '');
        content.push(new Paragraph({ text: titleLine, style: "subsectionHeading" }));
        if (job.duration) content.push(new Paragraph({ text: job.duration, style: "companyDate" }));
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
    
    if (cvData.education?.length) {
      content.push(new Paragraph({ text: "Education", style: "sectionHeading" }));
      for (const edu of cvData.education) {
        const eduLine = edu.level + (edu.field ? ` in ${edu.field}` : '');
        content.push(new Paragraph({ text: eduLine, style: "subsectionHeading" }));
        if (edu.institution) content.push(new Paragraph({ text: edu.institution, style: "companyDate" }));
        if (edu.graduation_date) content.push(new Paragraph({ text: edu.graduation_date, style: "bodyText" }));
        content.push(new Paragraph({ text: "" }));
      }
    }
    
    if (cvData.certifications?.length) {
      content.push(new Paragraph({ text: "Certifications", style: "sectionHeading" }));
      for (const cert of cvData.certifications) {
        let certText = cert.name;
        if (cert.year) certText += ` (${cert.year})`;
        content.push(new Paragraph({ text: `• ${certText}`, style: "bulletPoint" }));
      }
      content.push(new Paragraph({ text: "" }));
    }
    
    if (cvData.languages?.length) {
      content.push(new Paragraph({ text: "Languages", style: "sectionHeading" }));
      for (const lang of cvData.languages) {
        content.push(new Paragraph({ text: `• ${lang.name} (${lang.proficiency})`, style: "bulletPoint" }));
      }
      content.push(new Paragraph({ text: "" }));
    }
    
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
    const skills = cvData.skills || [];
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

  detectIndustry(cvData) {
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