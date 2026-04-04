// document-generator.js - Clean Professional CV and Cover Letter Generator
const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, BorderStyle, ImageRun } = require('docx');
const fs = require('fs');
const path = require('path');

class DocumentGenerator {
  constructor() {
    this.exportsPath = path.join(__dirname, 'exports');
    this.cvPath = path.join(this.exportsPath, 'cv');
    this.coverPath = path.join(this.exportsPath, 'coverletters');
    
    if (!fs.existsSync(this.cvPath)) fs.mkdirSync(this.cvPath, { recursive: true });
    if (!fs.existsSync(this.coverPath)) fs.mkdirSync(this.coverPath, { recursive: true });
  }

  // ============ STYLES ============
  
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

  // ============ CV GENERATION ============
  
  async generateCV(cvData, industry = null, format = 'docx', vacancyData = null, certificatesData = null) {
    const detectedIndustry = industry || this.detectIndustry(cvData);
    const colors = this.getIndustryColors(detectedIndustry);
    
    // Build content - only sections with data
    const content = this.buildCVContent(cvData, colors);
    
    // If no content, return error
    if (content.length === 0) {
      return { success: false, error: "No CV data provided" };
    }
    
    const doc = new Document({
      styles: {
        default: { document: { run: { font: "Calibri", size: 24 } } },
        paragraphStyles: [
          { id: "name", name: "Name", basedOn: "Normal", run: { font: "Calibri", size: 48, bold: true, color: colors.primary }, paragraph: { spacing: { after: 80 }, alignment: AlignmentType.CENTER } },
          { id: "title", name: "Title", basedOn: "Normal", run: { font: "Calibri", size: 28, bold: true, italics: true, color: colors.secondary }, paragraph: { spacing: { after: 120 }, alignment: AlignmentType.CENTER } },
          { id: "sectionHeading", name: "Section Heading", basedOn: "Normal", run: { font: "Calibri", size: 32, bold: true, color: colors.primary }, paragraph: { spacing: { before: 240, after: 80 }, border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: colors.accent } } } },
          { id: "subsectionHeading", name: "Subsection Heading", basedOn: "Normal", run: { font: "Calibri", size: 28, bold: true, color: colors.secondary }, paragraph: { spacing: { before: 120, after: 40 } } },
          { id: "companyDate", name: "Company and Date", basedOn: "Normal", run: { font: "Calibri", size: 24, bold: true }, paragraph: { spacing: { after: 20 } } },
          { id: "bodyText", name: "Body Text", basedOn: "Normal", run: { font: "Calibri", size: 24 }, paragraph: { spacing: { after: 80 } } },
          { id: "bulletPoint", name: "Bullet Point", basedOn: "Normal", run: { font: "Calibri", size: 24 }, paragraph: { spacing: { after: 40 }, indent: { left: 480 } } },
          { id: "contactInfo", name: "Contact Info", basedOn: "Normal", run: { font: "Calibri", size: 22, color: "666666" }, paragraph: { spacing: { after: 60 }, alignment: AlignmentType.CENTER } },
          { id: "refereeName", name: "Referee Name", basedOn: "Normal", run: { font: "Calibri", size: 26, bold: true }, paragraph: { spacing: { after: 20 } } },
          { id: "refereeDetails", name: "Referee Details", basedOn: "Normal", run: { font: "Calibri", size: 22, color: "555555" }, paragraph: { spacing: { after: 40 } } }
        ]
      },
      sections: [{
        properties: { page: { margin: { top: 720, bottom: 720, left: 720, right: 720 } } },
        children: content
      }]
    });
    
    const fileName = `CV_${cvData.personal?.full_name?.replace(/\s/g, '_') || 'Candidate'}_${Date.now()}.docx`;
    const filePath = path.join(this.cvPath, fileName);
    const buffer = await Packer.toBuffer(doc);
    fs.writeFileSync(filePath, buffer);
    
    let appendixPath = null;
    // Only generate appendix if certificates exist
    if (certificatesData && certificatesData.length > 0) {
      const appendix = await this.generateCertificatesAppendix(certificatesData, cvData.personal?.full_name);
      if (appendix.success) appendixPath = appendix.filePath;
    }
    
    return { success: true, filePath, fileName, appendixPath, industry: detectedIndustry };
  }

  buildCVContent(cvData, colors) {
    const personal = cvData.personal || {};
    const content = [];
    
    // === HEADER (Always present if name exists) ===
    if (personal.full_name) {
      content.push(new Paragraph({ text: personal.full_name.toUpperCase(), style: "name" }));
    } else {
      return []; // No name, no CV
    }
    
    // Professional Title
    const bioTitle = cvData.professional_bio || this.generateBioTitle(cvData);
    if (bioTitle) content.push(new Paragraph({ text: bioTitle, style: "title" }));
    
    // Location
    if (personal.location) {
      content.push(new Paragraph({ text: `📍 ${personal.location}`, style: "contactInfo" }));
    }
    
    // Contact Info - build only if exists
    const contactRow = this.createContactRow(personal);
    if (contactRow) content.push(contactRow);
    
    // LinkedIn
    if (personal.linkedin) {
      content.push(new Paragraph({ text: `🔗 ${personal.linkedin}`, style: "contactInfo" }));
    }
    
    // === PROFESSIONAL SUMMARY (Only if content exists) ===
    if (cvData.professional_summary && cvData.professional_summary.trim().length > 0) {
      content.push(new Paragraph({ text: "Professional Summary", style: "sectionHeading" }));
      content.push(new Paragraph({ text: cvData.professional_summary, style: "bodyText" }));
    }
    
    // === CORE COMPETENCIES / SKILLS (Only if skills exist) ===
    if (cvData.skills && cvData.skills.length > 0) {
      content.push(new Paragraph({ text: "Core Competencies", style: "sectionHeading" }));
      content.push(new Paragraph({ text: cvData.skills.join(' • '), style: "bodyText" }));
    }
    
    // === WORK EXPERIENCE (Only if exists) ===
    if (cvData.employment && cvData.employment.length > 0) {
      content.push(new Paragraph({ text: "Work Experience", style: "sectionHeading" }));
      for (const job of cvData.employment) {
        if (job.title && job.company) {
          content.push(new Paragraph({ text: `${job.title} | ${job.company}`, style: "subsectionHeading" }));
        } else if (job.title) {
          content.push(new Paragraph({ text: job.title, style: "subsectionHeading" }));
        }
        if (job.duration) content.push(new Paragraph({ text: job.duration, style: "companyDate" }));
        if (job.responsibilities && job.responsibilities.length > 0) {
          for (const resp of job.responsibilities) {
            if (resp && resp.trim().length > 0) {
              content.push(new Paragraph({ text: `• ${resp}`, style: "bulletPoint" }));
            }
          }
        }
        content.push(new Paragraph({ text: "", style: "bodyText" }));
      }
    }
    
    // === EDUCATION (Only if exists) ===
    if (cvData.education && cvData.education.length > 0) {
      content.push(new Paragraph({ text: "Education", style: "sectionHeading" }));
      for (const edu of cvData.education) {
        if (edu.level && edu.field) {
          content.push(new Paragraph({ text: `${edu.level} in ${edu.field}`, style: "subsectionHeading" }));
        } else if (edu.level) {
          content.push(new Paragraph({ text: edu.level, style: "subsectionHeading" }));
        }
        if (edu.institution) content.push(new Paragraph({ text: edu.institution, style: "companyDate" }));
        if (edu.year) content.push(new Paragraph({ text: edu.year, style: "bodyText" }));
        content.push(new Paragraph({ text: "", style: "bodyText" }));
      }
    }
    
    // === CERTIFICATIONS (Only if exists) ===
    if (cvData.certifications && cvData.certifications.length > 0) {
      content.push(new Paragraph({ text: "Certifications", style: "sectionHeading" }));
      for (const cert of cvData.certifications) {
        let certText = '';
        if (cert.name) certText += cert.name;
        if (cert.issuer) certText += ` - ${cert.issuer}`;
        if (cert.year) certText += `, ${cert.year}`;
        if (certText) content.push(new Paragraph({ text: `• ${certText}`, style: "bulletPoint" }));
      }
      content.push(new Paragraph({ text: "", style: "bodyText" }));
    }
    
    // === AWARDS (Only if exists) ===
    if (cvData.awards && cvData.awards.length > 0) {
      content.push(new Paragraph({ text: "Awards & Recognition", style: "sectionHeading" }));
      for (const award of cvData.awards) {
        let awardText = '';
        if (award.name) awardText += award.name;
        if (award.issuer) awardText += ` - ${award.issuer}`;
        if (award.year) awardText += ` (${award.year})`;
        if (awardText) content.push(new Paragraph({ text: `• ${awardText}`, style: "bulletPoint" }));
        if (award.description) content.push(new Paragraph({ text: `  ${award.description}`, style: "bulletPoint" }));
      }
      content.push(new Paragraph({ text: "", style: "bodyText" }));
    }
    
    // === VOLUNTEER WORK (Only if exists) ===
    if (cvData.volunteer && cvData.volunteer.length > 0) {
      content.push(new Paragraph({ text: "Volunteer Work & Affiliations", style: "sectionHeading" }));
      for (const vol of cvData.volunteer) {
        let volText = '';
        if (vol.role) volText += vol.role;
        if (vol.organization) volText += ` - ${vol.organization}`;
        if (vol.year) volText += `, ${vol.year}`;
        if (volText) content.push(new Paragraph({ text: `• ${volText}`, style: "bulletPoint" }));
      }
      content.push(new Paragraph({ text: "", style: "bodyText" }));
    }
    
    // === LEADERSHIP (Only if exists) ===
    if (cvData.leadership && cvData.leadership.length > 0) {
      content.push(new Paragraph({ text: "Leadership & Volunteer Roles", style: "sectionHeading" }));
      for (const lead of cvData.leadership) {
        if (lead.title && lead.organization) {
          content.push(new Paragraph({ text: `${lead.title} - ${lead.organization}${lead.duration ? ` (${lead.duration})` : ''}`, style: "subsectionHeading" }));
        }
        if (lead.description) content.push(new Paragraph({ text: lead.description, style: "bodyText" }));
      }
      content.push(new Paragraph({ text: "", style: "bodyText" }));
    }
    
    // === LANGUAGES (Only if exists) ===
    if (cvData.languages && cvData.languages.length > 0) {
      content.push(new Paragraph({ text: "Languages", style: "sectionHeading" }));
      for (const lang of cvData.languages) {
        if (lang.name && lang.proficiency) {
          content.push(new Paragraph({ text: `• ${lang.name} (${lang.proficiency})`, style: "bulletPoint" }));
        }
      }
      content.push(new Paragraph({ text: "", style: "bodyText" }));
    }
    
    // === REFEREES (Only if exists) ===
    if (cvData.referees && cvData.referees.length > 0) {
      content.push(new Paragraph({ text: "Referees", style: "sectionHeading" }));
      for (const ref of cvData.referees) {
        if (ref.name) content.push(new Paragraph({ text: ref.name, style: "refereeName" }));
        if (ref.position) content.push(new Paragraph({ text: ref.position, style: "refereeDetails" }));
        if (ref.contact) content.push(new Paragraph({ text: `📞 ${ref.contact}`, style: "refereeDetails" }));
        if (ref.email) content.push(new Paragraph({ text: `✉️ ${ref.email}`, style: "refereeDetails" }));
        content.push(new Paragraph({ text: "", style: "bodyText" }));
      }
    }
    
    return content;
  }

  generateBioTitle(cvData) {
    const jobTitles = cvData.employment?.map(j => j.title).filter(t => t) || [];
    const skills = cvData.skills?.slice(0, 3) || [];
    if (jobTitles.length > 0 && skills.length > 0) {
      return `${jobTitles[0]} | ${skills.join(' | ')}`;
    }
    if (jobTitles.length > 0) return jobTitles[0];
    return "";
  }

  createContactRow(personal) {
    const parts = [];
    if (personal.email) parts.push(new TextRun({ text: `✉️ ${personal.email}`, font: "Calibri", size: 22 }));
    if (personal.primary_phone) {
      if (parts.length) parts.push(new TextRun({ text: " | ", font: "Calibri", size: 22 }));
      parts.push(new TextRun({ text: `📞 ${personal.primary_phone}`, font: "Calibri", size: 22 }));
    }
    if (parts.length === 0) return null;
    return new Paragraph({ children: parts, style: "contactInfo" });
  }

  // ============ COVER LETTER GENERATION ============
  
  async generateCoverLetter(coverData, cvData, personalData, hasCertificates = false) {
    const personal = personalData || cvData.personal || {};
    const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
    const colors = this.getIndustryColors(this.detectIndustry(cvData));
    
    const content = this.buildCoverLetterContent(cvData, coverData, personal, today, colors, hasCertificates);
    
    const doc = new Document({
      styles: {
        default: { document: { run: { font: "Calibri", size: 24 } } },
        paragraphStyles: [
          { id: "name", name: "Name", basedOn: "Normal", run: { font: "Calibri", size: 48, bold: true, color: colors.primary }, paragraph: { spacing: { after: 80 }, alignment: AlignmentType.CENTER } },
          { id: "contactInfo", name: "Contact Info", basedOn: "Normal", run: { font: "Calibri", size: 22, color: "666666" }, paragraph: { spacing: { after: 60 }, alignment: AlignmentType.CENTER } },
          { id: "bodyText", name: "Body Text", basedOn: "Normal", run: { font: "Calibri", size: 24 }, paragraph: { spacing: { after: 120 } } },
          { id: "signature", name: "Signature", basedOn: "Normal", run: { font: "Calibri", size: 24 }, paragraph: { spacing: { before: 240, after: 40 } } }
        ]
      },
      sections: [{
        properties: { page: { margin: { top: 720, bottom: 720, left: 720, right: 720 } } },
        children: content
      }]
    });
    
    const fileName = `CoverLetter_${personal.full_name?.replace(/\s/g, '_') || 'Candidate'}_${Date.now()}.docx`;
    const filePath = path.join(this.coverPath, fileName);
    const buffer = await Packer.toBuffer(doc);
    fs.writeFileSync(filePath, buffer);
    
    return { success: true, filePath, fileName };
  }

  buildCoverLetterContent(cvData, coverData, personal, today, colors, hasCertificates) {
    const employment = cvData.employment || [];
    const skills = cvData.skills || [];
    const education = cvData.education || [];
    const vacancyPosition = coverData.position || '';
    const vacancyCompany = coverData.company || '';
    
    const content = [];
    
    // Header
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
    
    // Subject Line
    if (vacancyPosition) {
      content.push(new Paragraph({ text: `RE: Application for ${vacancyPosition}`, style: "bodyText" }));
      content.push(new Paragraph({ text: "", style: "bodyText" }));
    }
    
    // Opening Paragraph
    let openingText = `I am writing to express my strong interest in the ${vacancyPosition || 'position'} at ${vacancyCompany || 'your organization'}.`;
    if (employment.length > 0) {
      openingText += ` With my background as ${employment[0].title}, I am confident in my ability to contribute effectively to your team.`;
    }
    content.push(new Paragraph({ text: openingText, style: "bodyText" }));
    content.push(new Paragraph({ text: "", style: "bodyText" }));
    
    // Experience Paragraph
    if (employment.length > 0 && employment[0].responsibilities?.length > 0) {
      const relevantJob = employment[0];
      let expText = `In my current role${employment.length > 1 ? ' and previous positions' : ''}, I have developed strong skills in ${skills.slice(0, 3).join(', ')}. `;
      expText += `My experience includes ${relevantJob.responsibilities.slice(0, 2).join(', ').toLowerCase()}.`;
      content.push(new Paragraph({ text: expText, style: "bodyText" }));
      content.push(new Paragraph({ text: "", style: "bodyText" }));
    }
    
    // Skills Match Paragraph
    if (skills.length > 0 && vacancyPosition) {
      content.push(new Paragraph({ text: `I am particularly drawn to the ${vacancyPosition} position because it aligns with my expertise in ${skills.slice(0, 2).join(' and ')}. I am eager to bring my dedication and problem-solving abilities to ${vacancyCompany || 'your organization'}.`, style: "bodyText" }));
      content.push(new Paragraph({ text: "", style: "bodyText" }));
    }
    
    // Education Highlight
    if (education.length > 0 && education[0].level && education[0].field) {
      const highestEdu = education[0];
      content.push(new Paragraph({ text: `My educational background includes ${highestEdu.level} in ${highestEdu.field} from ${highestEdu.institution}, which has provided me with a strong foundation for this role.`, style: "bodyText" }));
      content.push(new Paragraph({ text: "", style: "bodyText" }));
    }
    
    // Certificates Note (if applicable)
    if (hasCertificates) {
      content.push(new Paragraph({ text: `I have attached copies of my relevant certificates and qualifications for your review. These documents verify my training and expertise in this field.`, style: "bodyText" }));
      content.push(new Paragraph({ text: "", style: "bodyText" }));
    }
    
    // Closing Paragraph
    content.push(new Paragraph({ text: `Thank you for considering my application. I look forward to the opportunity to discuss how my skills and experiences would be a good fit for this position. I am available for an interview at your earliest convenience.`, style: "bodyText" }));
    content.push(new Paragraph({ text: "", style: "bodyText" }));
    content.push(new Paragraph({ text: `Yours faithfully,`, style: "bodyText" }));
    content.push(new Paragraph({ text: "", style: "signature" }));
    content.push(new Paragraph({ text: personal.full_name || 'Your Name', style: "bodyText" }));
    if (personal.primary_phone) content.push(new Paragraph({ text: personal.primary_phone, style: "bodyText" }));
    if (personal.email) content.push(new Paragraph({ text: personal.email, style: "bodyText" }));
    
    return content;
  }

  // ============ CERTIFICATES APPENDIX (Separate Document) ============
  
  async generateCertificatesAppendix(certificatesData, personalName) {
    const allImages = [];
    for (const cert of certificatesData) {
      for (const imgPath of cert.images) {
        if (fs.existsSync(imgPath)) allImages.push(imgPath);
      }
    }
    
    if (allImages.length === 0) return { success: false };
    
    let mergedImage = allImages[0];
    if (allImages.length > 1) {
      const sharp = require('sharp');
      const images = [];
      for (const imgPath of allImages) {
        const metadata = await sharp(imgPath).metadata();
        images.push({ input: imgPath, height: metadata.height });
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
      const mergedBuffer = await sharp({ create: { width: maxWidth, height: currentTop, channels: 3, background: { r: 255, g: 255, b: 255 } } }).composite(compositeOptions).png().toBuffer();
      mergedImage = path.join(this.cvPath, `cert_collage_${Date.now()}.png`);
      fs.writeFileSync(mergedImage, mergedBuffer);
    }
    
    const doc = new Document({
      styles: {
        default: { document: { run: { font: "Calibri", size: 24 } } },
        paragraphStyles: [
          { id: "title", name: "Title", basedOn: "Normal", run: { font: "Calibri", size: 44, bold: true }, paragraph: { spacing: { after: 80 }, alignment: AlignmentType.CENTER } },
          { id: "sectionHeading", name: "Section Heading", basedOn: "Normal", run: { font: "Calibri", size: 32, bold: true }, paragraph: { spacing: { before: 240, after: 120 }, border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: "2C7DA0" } } } },
          { id: "bodyText", name: "Body Text", basedOn: "Normal", run: { font: "Calibri", size: 24 }, paragraph: { spacing: { after: 80 } } }
        ]
      },
      sections: [{
        properties: { page: { margin: { top: 720, bottom: 720, left: 720, right: 720 } } },
        children: [
          new Paragraph({ text: personalName?.toUpperCase() || 'CANDIDATE', style: "title" }),
          new Paragraph({ text: "Certificates & Qualifications", style: "sectionHeading" }),
          new Paragraph({ text: `This appendix contains ${certificatesData.length} verified certificate(s).`, style: "bodyText" }),
          new Paragraph({ children: [new ImageRun({ data: fs.readFileSync(mergedImage), transformation: { width: 450, height: 600 } })], alignment: AlignmentType.CENTER })
        ]
      }]
    });
    
    const fileName = `Certificates_${personalName?.replace(/\s/g, '_') || 'Candidate'}_${Date.now()}.docx`;
    const filePath = path.join(this.cvPath, fileName);
    const buffer = await Packer.toBuffer(doc);
    fs.writeFileSync(filePath, buffer);
    
    if (mergedImage !== allImages[0]) fs.unlinkSync(mergedImage);
    
    return { success: true, filePath, fileName, certificateCount: certificatesData.length };
  }
}

module.exports = new DocumentGenerator();