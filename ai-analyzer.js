// ai-analyzer.js - Advanced AI Analysis with Machine Learning Capabilities
const Tesseract = require('tesseract.js');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const documentGenerator = require('./document-generator');
const natural = require('natural');
const { TfIdf, WordTokenizer, SentimentAnalyzer, PorterStemmer } = natural;

const tokenizer = new WordTokenizer();
const sentimentAnalyzer = new SentimentAnalyzer('English', natural.PorterStemmer, 'afinn');

class AIAnalyzer {
    constructor() {
        this.tempPath = path.join(__dirname, 'temp');
        this.uploadsPath = path.join(__dirname, 'uploads');
        this.certificatesPath = path.join(this.uploadsPath, 'certificates');
        
        if (!fs.existsSync(this.tempPath)) fs.mkdirSync(this.tempPath, { recursive: true });
        if (!fs.existsSync(this.uploadsPath)) fs.mkdirSync(this.uploadsPath, { recursive: true });
        if (!fs.existsSync(this.certificatesPath)) fs.mkdirSync(this.certificatesPath, { recursive: true });

        // Advanced skill templates with weights
        this.skillTemplates = {
            carpenter: {
                skills: [
                    "Furniture design and construction", "Joinery and wood finishing", "Blueprint reading and interpretation",
                    "Precision measurement and cutting", "Installation of interior fittings", "Power tools operation",
                    "Project planning and execution", "Quality control and inspection", "Safety compliance", "Team collaboration"
                ],
                weight: 1.0
            },
            agriculture: {
                skills: [
                    "Crop rotation and management", "Post-harvest handling", "Agro-processing", "Farm operations management",
                    "Irrigation systems", "Soil analysis", "Pest and disease control", "Supply chain coordination",
                    "Quality assurance", "Food safety compliance", "Team supervision", "Record keeping"
                ],
                weight: 1.0
            },
            teacher: {
                skills: [
                    "Curriculum development", "Lesson planning", "Student assessment", "Classroom management",
                    "Parent communication", "Educational technology", "Differentiated instruction", "Special needs education",
                    "Learning analytics", "Student engagement strategies"
                ],
                weight: 1.0
            },
            project_management: {
                skills: [
                    "Project planning and execution", "Risk management", "Stakeholder engagement", "Budget management",
                    "Team leadership", "Agile methodology", "Strategic planning", "Resource mobilization",
                    "Cross-functional collaboration", "Performance monitoring", "Change management", "Quality assurance",
                    "JIRA", "MS Project", "Scrum", "Kanban"
                ],
                weight: 1.0
            },
            technology: {
                skills: [
                    "Software development", "System architecture", "Database management", "API integration",
                    "Cloud computing", "DevOps", "Cybersecurity", "Technical documentation",
                    "Agile development", "Code review", "Testing and debugging", "UI/UX design",
                    "Python", "JavaScript", "React", "Node.js", "AWS", "Docker", "Kubernetes"
                ],
                weight: 1.0
            },
            healthcare: {
                skills: [
                    "Patient care", "Medical documentation", "Emergency response", "Clinical procedures",
                    "Health assessment", "Care coordination", "Medical terminology", "Electronic health records",
                    "Vital signs monitoring", "Medication administration", "Infection control", "Patient education"
                ],
                weight: 1.0
            },
            generic: {
                skills: [
                    "Strategic planning", "Project management", "Team leadership", "Communication", 
                    "Problem solving", "Time management", "Attention to detail", "Customer service",
                    "Critical thinking", "Adaptability", "Collaboration", "Data analysis"
                ],
                weight: 0.8
            }
        };

        // Advanced responsibility templates with industry context
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
            healthcare: [
                "Provided comprehensive patient care including assessment, planning, and evaluation",
                "Administered medications and treatments following established protocols",
                "Documented patient conditions, treatments, and responses accurately",
                "Collaborated with interdisciplinary healthcare teams for optimal patient outcomes",
                "Educated patients and families on health management and preventive care"
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

    // ============ ADVANCED CLIENT INFORMATION EXTRACTION ============
    
    async extractFromDocument(fileUrl, fileName) {
        try {
            const fileExt = fileName.split('.').pop().toLowerCase();
            const localPath = path.join(this.tempPath, `client_${Date.now()}.${fileExt}`);
            
            const response = await axios({ url: fileUrl, responseType: 'arraybuffer' });
            fs.writeFileSync(localPath, response.data);
            
            // Enhanced extraction with multiple passes
            let extractedData = await documentGenerator.extractFullCVData(localPath, 'cv');
            
            // Second pass for missed data using OCR if needed
            if (!extractedData.success || !extractedData.data.personal?.email) {
                const ocrText = await this.enhanceWithOCR(localPath);
                if (ocrText) {
                    const ocrExtracted = await this.extractFromText(ocrText);
                    extractedData.data = this.mergeExtractedData(extractedData.data, ocrExtracted);
                }
            }
            
            fs.unlinkSync(localPath);
            
            if (!extractedData.success) {
                return this.getDefaultExtraction();
            }
            
            const data = extractedData.data;
            
            return {
                client_name: data.personal?.full_name || null,
                client_email: data.personal?.email || null,
                client_phone: data.personal?.primary_phone || null,
                client_location: data.personal?.location || null,
                client_physical_address: data.personal?.physical_address || null,
                client_nationality: data.personal?.nationality || null,
                position: data.personal?.professional_title || null,
                company: data.employment?.[0]?.company || null,
                skills: data.skills || [],
                experience_years: this.calculateTotalExperience(data.employment),
                education_level: this.getHighestEducationLevel(data.education)
            };
        } catch (error) {
            console.error('Extract from document error:', error);
            return this.getDefaultExtraction();
        }
    }

    async enhanceWithOCR(filePath) {
        try {
            const result = await Tesseract.recognize(filePath, 'eng', {
                logger: m => console.log(m)
            });
            return result.data.text;
        } catch (error) {
            console.error('OCR enhancement error:', error);
            return null;
        }
    }

    extractFromText(text) {
        // Fallback extraction from raw text
        const emailMatch = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
        const phoneMatch = text.match(/\+?265[0-9]{9}|0[987][0-9]{8}/);
        const nameMatch = text.match(/^([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})$/m);
        
        return {
            personal: {
                email: emailMatch ? emailMatch[0] : null,
                primary_phone: phoneMatch ? phoneMatch[0] : null,
                full_name: nameMatch ? nameMatch[1] : null
            }
        };
    }

    mergeExtractedData(original, newData) {
        if (!original.personal) original.personal = {};
        if (!original.personal.email && newData.personal?.email) original.personal.email = newData.personal.email;
        if (!original.personal.primary_phone && newData.personal?.primary_phone) original.personal.primary_phone = newData.personal.primary_phone;
        if (!original.personal.full_name && newData.personal?.full_name) original.personal.full_name = newData.personal.full_name;
        return original;
    }

    getDefaultExtraction() {
        return {
            client_name: null,
            client_email: null,
            client_phone: null,
            client_location: null,
            client_physical_address: null,
            client_nationality: null,
            position: null,
            company: null,
            skills: [],
            experience_years: 0,
            education_level: null
        };
    }

    calculateTotalExperience(employment) {
        let totalYears = 0;
        for (const job of (employment || [])) {
            if (job.duration) {
                const yearMatch = job.duration.match(/(\d+)\s*years?|\d{4}\s*[-–—]\s*(\d{4})/i);
                if (yearMatch) {
                    totalYears += parseInt(yearMatch[1]) || (parseInt(yearMatch[2]) - parseInt(yearMatch[0]?.match(/\d{4}/)?.[0] || 0));
                }
            }
        }
        return Math.max(totalYears, 1);
    }

    getHighestEducationLevel(education) {
        const levels = ['PhD', 'Master', 'Bachelor', 'Diploma', 'Certificate', 'High School'];
        for (const level of levels) {
            if (education?.some(e => e.level?.includes(level))) {
                return level;
            }
        }
        return null;
    }

    // ============ ADVANCED VACANCY EXTRACTION ============
    
    async extractVacancyFromFile(fileUrl, fileName) {
        const fileExt = fileName.split('.').pop().toLowerCase();
        const localPath = path.join(this.tempPath, `vacancy_${Date.now()}.${fileExt}`);
        
        const response = await axios({ url: fileUrl, responseType: 'arraybuffer' });
        fs.writeFileSync(localPath, response.data);
        
        let extractedText = '';
        
        if (fileExt === 'txt') {
            extractedText = fs.readFileSync(localPath, 'utf8');
        } else if (['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp'].includes(fileExt)) {
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
            company: this.extractCompany(text),
            position: this.extractPosition(text),
            location: this.extractLocation(text),
            salary: this.extractSalary(text),
            deadline: this.extractDeadline(text),
            job_type: this.extractJobType(text),
            experience_required: this.extractExperienceRequired(text),
            education_required: this.extractEducationRequired(text),
            requirements: this.extractRequirements(text),
            responsibilities: this.extractResponsibilities(text),
            benefits: this.extractBenefits(text),
            contact_person: this.extractContactPerson(text),
            contact_email: this.extractContactEmail(text),
            contact_phone: this.extractContactPhone(text),
            application_method: this.extractApplicationMethod(text),
            has_vacancy: true,
            match_score: null,
            sentiment: this.analyzeSentiment(text),
            keywords: this.extractKeywords(text)
        };
        
        vacancy.has_vacancy = vacancy.company !== 'Not specified' || vacancy.position !== 'Not specified';
        return vacancy;
    }

    extractCompany(text) {
        const patterns = [
            /(?:company|organization|firm|employer|hiring)[:\s]+([A-Z][A-Za-z\s&.]+)(?:\n|\.|,)/i,
            /(?:at|for|with)\s+([A-Z][A-Za-z\s&.]+)(?:\n|\.|,)/i,
            /^([A-Z][A-Za-z\s&.]+)(?:\s+is\s+hiring|\s+seeks|\s+looking for)/im,
            /(?:about us|who we are)[:\s]+([A-Z][A-Za-z\s&.]+)/i
        ];
        for (const pattern of patterns) {
            const match = text.match(pattern);
            if (match && match[1] && match[1].length < 60) return match[1].trim();
        }
        return 'Not specified';
    }

    extractPosition(text) {
        const patterns = [
            /(?:position|role|job title|vacancy)[:\s]+([A-Za-z\s/&]+)(?:\n|\.|,)/i,
            /(?:hiring|seeking|looking for|recruiting)[:\s]+([A-Za-z\s/&]+)/i,
            /^([A-Z][A-Za-z\s/&]+)(?:\s+at\s+|\s+-\s+)/im,
            /(?:title|designation)[:\s]+([A-Za-z\s/&]+)/i
        ];
        for (const pattern of patterns) {
            const match = text.match(pattern);
            if (match && match[1] && match[1].length < 80) return match[1].trim();
        }
        return 'Not specified';
    }

    extractLocation(text) {
        const patterns = [
            /(?:location|work location|office|based in|site)[:\s]+([A-Za-z\s,]+)/i,
            /(?:Lilongwe|Blantyre|Mzuzu|Zomba|Mulanje|Dedza|Salima|Malawi)/gi
        ];
        for (const pattern of patterns) {
            const match = text.match(pattern);
            if (match) return match[1] || match[0];
        }
        return 'Not specified';
    }

    extractSalary(text) {
        const patterns = [
            /(?:salary|compensation|pay|wage|remuneration)[:\s]+([MKk\d\s,]+)/i,
            /(?:MK|MWK|K)\s*(\d[\d,]+)/i,
            /(\d[\d,]+)\s*(?:MK|MWK|kwacha)/i
        ];
        for (const pattern of patterns) {
            const match = text.match(pattern);
            if (match) return match[0].replace(/^[^:]+:/, '').trim();
        }
        return 'Not specified';
    }

    extractDeadline(text) {
        const patterns = [
            /(?:deadline|closing date|application deadline|apply by|cutoff)[:\s]+(\d{1,2}[-/]\d{1,2}[-/]\d{2,4})/i,
            /(?:deadline|closing date|application deadline|apply by|cutoff)[:\s]+([A-Za-z]+\s+\d{1,2},?\s+\d{4})/i
        ];
        for (const pattern of patterns) {
            const match = text.match(pattern);
            if (match) return match[1];
        }
        return 'Not specified';
    }

    extractJobType(text) {
        const patterns = [
            /(?:job type|employment type|work type)[:\s]+(Full-time|Part-time|Contract|Temporary|Internship|Remote|Hybrid)/i,
            /(Full-time|Part-time|Contract|Temporary|Internship|Remote|Hybrid)/i
        ];
        for (const pattern of patterns) {
            const match = text.match(pattern);
            if (match) return match[1] || match[0];
        }
        return 'Not specified';
    }

    extractExperienceRequired(text) {
        const patterns = [
            /(?:experience required|years of experience)[:\s]+(\d+[\+]?\s*years?)/i,
            /(\d+[\+]?\s*years?)\s+(?:of|experience)/i,
            /(?:minimum|at least)\s+(\d+)\s*years?/i
        ];
        for (const pattern of patterns) {
            const match = text.match(pattern);
            if (match) return match[1] || match[0];
        }
        return 'Not specified';
    }

    extractEducationRequired(text) {
        const patterns = [
            /(?:education required|qualification|degree required)[:\s]+([A-Za-z\s]+)/i,
            /(?:Bachelor|Master|PhD|Diploma|Certificate|Degree)[:\s]*([A-Za-z\s]+)/i
        ];
        for (const pattern of patterns) {
            const match = text.match(pattern);
            if (match) return match[1] || match[0];
        }
        return 'Not specified';
    }

    extractRequirements(text) {
        const requirements = [];
        const reqSection = text.match(/(?:requirements|qualifications|skills|what we need|candidate profile)[:\s]*([\s\S]+?)(?=\n\s*(?:responsibilities|benefits|how to apply|deadline|$))/i);
        if (reqSection) {
            const reqLines = reqSection[1].split(/[•\-*\n]/);
            for (const line of reqLines) {
                const clean = line.replace(/^[•\-*\d+.]\s*/, '').trim();
                if (clean && clean.length > 5 && clean.length < 150) {
                    requirements.push(clean);
                }
            }
        }
        return requirements.slice(0, 15);
    }

    extractResponsibilities(text) {
        const responsibilities = [];
        const respSection = text.match(/(?:responsibilities|duties|what you'll do|role involves)[:\s]*([\s\S]+?)(?=\n\s*(?:requirements|benefits|how to apply|qualifications|$))/i);
        if (respSection) {
            const respLines = respSection[1].split(/[•\-*\n]/);
            for (const line of respLines) {
                const clean = line.replace(/^[•\-*\d+.]\s*/, '').trim();
                if (clean && clean.length > 5 && clean.length < 150) {
                    responsibilities.push(clean);
                }
            }
        }
        return responsibilities.slice(0, 10);
    }

    extractBenefits(text) {
        const benefits = [];
        const benSection = text.match(/(?:benefits|what we offer|perks)[:\s]*([\s\S]+?)(?=\n\s*(?:requirements|how to apply|deadline|$))/i);
        if (benSection) {
            const benLines = benSection[1].split(/[•\-*\n]/);
            for (const line of benLines) {
                const clean = line.replace(/^[•\-*\d+.]\s*/, '').trim();
                if (clean && clean.length > 5 && clean.length < 100) {
                    benefits.push(clean);
                }
            }
        }
        return benefits;
    }

    extractContactPerson(text) {
        const match = text.match(/(?:contact person|hiring manager|recruiter)[:\s]+([A-Z][a-z]+\s+[A-Z][a-z]+)/i);
        return match ? match[1] : null;
    }

    extractContactEmail(text) {
        const match = text.match(/(?:contact|send to|email)[:\s]+([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i);
        return match ? match[1] : null;
    }

    extractContactPhone(text) {
        const match = text.match(/(?:contact|call|phone)[:\s]+([+\d\s-]{8,})/i);
        return match ? match[1] : null;
    }

    extractApplicationMethod(text) {
        const patterns = [
            /(?:how to apply|to apply|application process)[:\s]+([\s\S]+?)(?=\n\s*(?:deadline|requirements|$))/i,
            /(?:send your|cv to|resume to|application to)[:\s]+([^\n]+)/i
        ];
        for (const pattern of patterns) {
            const match = text.match(pattern);
            if (match) return match[1].trim();
        }
        return null;
    }

    analyzeSentiment(text) {
        const tokens = tokenizer.tokenize(text.toLowerCase());
        return sentimentAnalyzer.getSentiment(tokens);
    }

    extractKeywords(text) {
        const keywords = [];
        const commonKeywords = ['remote', 'flexible', 'bonus', 'training', 'development', 'growth', 'leadership', 'innovative'];
        for (const keyword of commonKeywords) {
            if (text.toLowerCase().includes(keyword)) {
                keywords.push(keyword);
            }
        }
        return keywords;
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
        
        return { 
            name: name || path.basename(fileName, path.extname(fileName)), 
            issuer: issuer || 'Not specified', 
            date: date || 'Not specified' 
        };
    }

    // ============ ADVANCED CV ENHANCEMENT ============
    
    async enhanceCVData(rawCvData, vacancyData = null) {
        const industry = this.detectIndustry(rawCvData);
        const enhancedSkills = this.extrapolateSkillsAdvanced(rawCvData, vacancyData, industry);
        const enhancedEmployment = await this.enhanceEmploymentAdvanced(rawCvData.employment || [], industry);
        const enhancedSummary = this.generateProfessionalSummaryAdvanced(rawCvData, vacancyData, industry);
        const enhancedAchievements = this.extractAchievementsAdvanced(enhancedEmployment);
        
        // Calculate match score with vacancy
        let matchScore = null;
        if (vacancyData && vacancyData.has_vacancy) {
            matchScore = this.calculateAdvancedMatchScore(rawCvData, vacancyData);
        }
        
        return {
            ...rawCvData,
            professional_summary: enhancedSummary,
            skills: enhancedSkills,
            employment: enhancedEmployment,
            achievements: enhancedAchievements,
            ai_enhanced: true,
            detected_industry: industry,
            match_score: matchScore,
            enhancement_notes: {
                skills_added: enhancedSkills.filter(s => !(rawCvData.skills || []).includes(s)).length,
                responsibilities_enhanced: enhancedEmployment.filter((job, i) => 
                    job.responsibilities.length !== (rawCvData.employment?.[i]?.responsibilities?.length || 0)
                ).length,
                achievements_added: enhancedAchievements.filter(a => !(rawCvData.achievements || []).includes(a)).length
            }
        };
    }

    detectIndustry(cvData) {
        const allText = [
            ...(cvData.employment?.map(j => `${j.title} ${j.company}`) || []),
            ...(cvData.skills || []),
            ...(cvData.education?.map(e => e.field) || [])
        ].join(' ').toLowerCase();
        
        if (allText.includes('carpenter') || allText.includes('joiner') || allText.includes('wood')) return 'carpentry';
        if (allText.includes('agriculture') || allText.includes('farm') || allText.includes('crop')) return 'agriculture';
        if (allText.includes('health') || allText.includes('medical') || allText.includes('nurse') || allText.includes('patient')) return 'healthcare';
        if (allText.includes('software') || allText.includes('developer') || allText.includes('engineer') || allText.includes('it')) return 'technology';
        if (allText.includes('teach') || allText.includes('education') || allText.includes('school') || allText.includes('university')) return 'education';
        if (allText.includes('project') || allText.includes('manager') || allText.includes('coordinator') || allText.includes('agile')) return 'project_management';
        return 'corporate';
    }

    extrapolateSkillsAdvanced(cvData, vacancyData, industry) {
        let existingSkills = cvData.skills || [];
        const employment = cvData.employment || [];
        const allText = employment.map(j => `${j.title} ${j.company}`).join(' ').toLowerCase();
        
        // Get industry-specific skills
        const industrySkills = this.skillTemplates[industry]?.skills || this.skillTemplates.generic.skills;
        let impliedSkills = [...industrySkills];
        
        // Add job-specific skills based on titles
        for (const job of employment) {
            const title = job.title?.toLowerCase() || '';
            if (title.includes('manager') || title.includes('director')) {
                impliedSkills.push('Strategic Planning', 'Budget Management', 'Team Leadership', 'Performance Management');
            }
            if (title.includes('developer') || title.includes('engineer')) {
                impliedSkills.push('Code Review', 'Debugging', 'System Design', 'Technical Documentation');
            }
            if (title.includes('teacher') || title.includes('lecturer')) {
                impliedSkills.push('Curriculum Design', 'Student Assessment', 'Classroom Technology', 'Parent Communication');
            }
        }
        
        // Add vacancy requirements as skills
        let vacancySkills = [];
        if (vacancyData?.requirements) {
            vacancySkills = vacancyData.requirements
                .filter(r => r.length < 40 && r.length > 3)
                .slice(0, 8);
        }
        
        // Combine all skills
        let allSkills = [...existingSkills, ...impliedSkills, ...vacancySkills];
        
        // Remove duplicates (case insensitive)
        const uniqueSkills = [];
        const seen = new Set();
        for (const skill of allSkills) {
            const lower = skill.toLowerCase();
            if (!seen.has(lower)) {
                seen.add(lower);
                uniqueSkills.push(skill);
            }
        }
        
        // Ensure minimum 8 skills
        while (uniqueSkills.length < 8) {
            uniqueSkills.push('Professional Communication');
            if (uniqueSkills.length < 8) uniqueSkills.push('Team Collaboration');
            if (uniqueSkills.length < 8) uniqueSkills.push('Problem Solving');
        }
        
        return uniqueSkills;
    }

    async enhanceEmploymentAdvanced(employment, industry) {
        const templates = this.responsibilityTemplates[industry] || this.responsibilityTemplates.generic;
        
        return employment.map(job => {
            const enhancedJob = { ...job };
            
            // Enhance responsibilities if needed
            if (!enhancedJob.responsibilities || enhancedJob.responsibilities.length < 3) {
                const suggested = this.getSuggestedResponsibilities(job.title, templates);
                enhancedJob.responsibilities = [...(enhancedJob.responsibilities || []), ...suggested];
                enhancedJob.responsibilities = [...new Set(enhancedJob.responsibilities)];
            }
            
            // Enhance achievements if needed
            if (!enhancedJob.achievements || enhancedJob.achievements.length === 0) {
                const suggested = this.getSuggestedAchievements(job.title, job.company);
                enhancedJob.achievements = suggested;
            }
            
            return enhancedJob;
        });
    }

    getSuggestedResponsibilities(jobTitle, templates) {
        const title = jobTitle?.toLowerCase() || '';
        const suggestions = [];
        
        if (title.includes('manager') || title.includes('director')) {
            suggestions.push('Led cross-functional teams to achieve strategic objectives');
            suggestions.push('Developed and implemented operational policies and procedures');
            suggestions.push('Managed budgets and resources effectively');
        }
        if (title.includes('developer') || title.includes('engineer')) {
            suggestions.push('Developed and maintained software solutions meeting client requirements');
            suggestions.push('Collaborated with team members to troubleshoot and resolve technical issues');
            suggestions.push('Wrote clean, maintainable code following best practices');
        }
        if (title.includes('teacher') || title.includes('lecturer')) {
            suggestions.push('Delivered engaging lessons to diverse student populations');
            suggestions.push('Assessed student progress and provided constructive feedback');
            suggestions.push('Collaborated with colleagues to improve curriculum');
        }
        
        // Add from templates if still need more
        while (suggestions.length < 3 && templates.length > 0) {
            suggestions.push(templates[suggestions.length % templates.length]);
        }
        
        return suggestions.slice(0, 5);
    }

    getSuggestedAchievements(jobTitle, company) {
        const title = jobTitle?.toLowerCase() || '';
        const achievements = [];
        
        if (title.includes('manager')) {
            achievements.push('Successfully delivered projects on time and within budget');
            achievements.push(`Improved team productivity by 25% through process optimization`);
        }
        if (title.includes('developer')) {
            achievements.push('Successfully launched 5+ major features with zero critical bugs');
            achievements.push('Reduced system response time by 30% through optimization');
        }
        if (title.includes('teacher')) {
            achievements.push('Improved student pass rate by 20% through targeted interventions');
            achievements.push('Received positive feedback from 95% of students');
        }
        
        if (achievements.length === 0) {
            achievements.push(`Recognized for outstanding performance at ${company || 'organization'}`);
            achievements.push('Successfully completed all assigned tasks ahead of schedule');
        }
        
        return achievements;
    }

    generateProfessionalSummaryAdvanced(cvData, vacancyData, industry) {
        const employment = cvData.employment || [];
        const education = cvData.education || [];
        const skills = cvData.skills || [];
        
        let totalYears = 0;
        for (const job of employment) {
            const match = (job.duration || '').match(/(\d+)/);
            if (match) totalYears += parseInt(match[1]);
        }
        
        const primaryJob = employment[0]?.title || 'Professional';
        const highestEdu = education[0] || {};
        const topSkills = skills.slice(0, 4).join(', ');
        
        let summary = '';
        
        // Industry-specific templates
        if (industry === 'technology') {
            summary = `Innovative ${primaryJob} with ${totalYears}+ years of experience in ${topSkills}. `;
            summary += `Skilled in developing scalable solutions, leading technical teams, and delivering impactful projects. `;
            if (highestEdu.level) summary += `Holds ${highestEdu.level} in ${highestEdu.field || 'Computer Science'}. `;
            summary += `Committed to leveraging technology for business growth and social impact.`;
        } 
        else if (industry === 'project_management') {
            summary = `Results-oriented ${primaryJob} with ${totalYears}+ years of experience in ${topSkills}. `;
            summary += `Proven track record of delivering projects on time and within budget. `;
            summary += `Skilled in stakeholder management, risk mitigation, and team leadership. `;
            if (highestEdu.level) summary += `Holds ${highestEdu.level} in ${highestEdu.field || 'Project Management'}.`;
        }
        else if (industry === 'healthcare') {
            summary = `Compassionate ${primaryJob} with ${totalYears}+ years of experience in ${topSkills}. `;
            summary += `Dedicated to providing quality patient care and improving health outcomes. `;
            summary += `Skilled in clinical procedures, patient assessment, and care coordination. `;
            if (highestEdu.level) summary += `Holds ${highestEdu.level} in ${highestEdu.field || 'Healthcare'}.`;
        }
        else {
            summary = `Experienced ${primaryJob} with ${totalYears}+ years of expertise in ${topSkills}. `;
            summary += `Demonstrated success in delivering results and driving organizational growth. `;
            if (highestEdu.level) summary += `Holds ${highestEdu.level} in ${highestEdu.field || 'relevant field'}. `;
        }
        
        // Add vacancy alignment if provided
        if (vacancyData?.position) {
            summary += ` Seeking ${vacancyData.position} position at ${vacancyData.company || 'your organization'} to leverage expertise and drive impact.`;
        }
        
        return summary;
    }

    extractAchievementsAdvanced(employment) {
        const achievements = [];
        const keywords = ['increased', 'reduced', 'improved', 'managed', 'led', 'created', 'developed', 'designed', 
                          'implemented', 'achieved', 'delivered', 'spearheaded', 'launched', 'built', 'established',
                          'optimized', 'streamlined', 'transformed', 'revolutionized'];
        
        for (const job of employment) {
            if (job.achievements) {
                for (const ach of job.achievements) {
                    if (ach && ach.length > 10) achievements.push(ach);
                }
            }
            if (job.responsibilities) {
                for (const resp of job.responsibilities) {
                    const lowerResp = resp.toLowerCase();
                    for (const keyword of keywords) {
                        if (lowerResp.includes(keyword) && resp.length > 15) {
                            achievements.push(resp);
                            break;
                        }
                    }
                }
            }
        }
        
        // Remove duplicates
        const unique = [...new Set(achievements)];
        
        if (unique.length === 0 && employment.length > 0) {
            unique.push(`Successfully performed duties as ${employment[0].title}`);
            unique.push(`Contributed to team success at ${employment[0].company || 'organization'}`);
        }
        
        return unique.slice(0, 8);
    }

    calculateAdvancedMatchScore(cvData, vacancyData) {
        if (!vacancyData || !vacancyData.has_vacancy) return null;
        
        const cvSkills = (cvData.skills || []).map(s => s.toLowerCase());
        const cvJobTitles = (cvData.employment || []).map(j => j.title?.toLowerCase() || '');
        const vacancyKeywords = [
            vacancyData.position?.toLowerCase() || '',
            ...(vacancyData.requirements || []).map(r => r.toLowerCase()),
            ...(vacancyData.responsibilities || []).map(r => r.toLowerCase())
        ];
        
        // Calculate skill matches with weighting
        let skillMatches = 0;
        let totalWeight = 0;
        for (const keyword of vacancyKeywords) {
            let bestMatch = 0;
            for (const skill of cvSkills) {
                if (skill === keyword) bestMatch = 1.0;
                else if (skill.includes(keyword) || keyword.includes(skill)) bestMatch = 0.7;
                else if (this.areSimilarWords(skill, keyword)) bestMatch = 0.4;
                if (bestMatch > 0) break;
            }
            skillMatches += bestMatch;
            totalWeight += 1;
        }
        
        // Calculate title matches
        let titleMatches = 0;
        const vacancyPosition = vacancyData.position?.toLowerCase() || '';
        for (const title of cvJobTitles) {
            if (title === vacancyPosition) titleMatches = 1;
            else if (title.includes(vacancyPosition) || vacancyPosition.includes(title)) titleMatches = 0.8;
            else if (this.areSimilarWords(title, vacancyPosition)) titleMatches = 0.5;
            if (titleMatches > 0) break;
        }
        
        const skillScore = (skillMatches / Math.max(totalWeight, 1)) * 70;
        const titleScore = titleMatches * 30;
        const totalScore = Math.round(skillScore + titleScore);
        
        let recommendation = '';
        if (totalScore >= 70) recommendation = 'Excellent match! Strongly recommend applying with this CV.';
        else if (totalScore >= 50) recommendation = 'Good match. Consider customizing your CV to highlight relevant experience.';
        else if (totalScore >= 30) recommendation = 'Moderate match. May need significant customization for this role.';
        else recommendation = 'Weak match. Consider creating a tailored CV for this position.';
        
        return {
            score: totalScore,
            skill_matches: Math.round(skillMatches),
            title_match: Math.round(titleMatches * 100),
            recommendation: recommendation,
            missing_keywords: vacancyKeywords.filter(k => !cvSkills.some(s => s.includes(k) || k.includes(s))).slice(0, 5)
        };
    }

    areSimilarWords(word1, word2) {
        if (!word1 || !word2) return false;
        const w1 = word1.toLowerCase();
        const w2 = word2.toLowerCase();
        if (w1.length < 3 || w2.length < 3) return false;
        return w1.includes(w2) || w2.includes(w1) || 
               w1.split(' ').some(w => w2.includes(w)) ||
               w2.split(' ').some(w => w1.includes(w));
    }
}

module.exports = new AIAnalyzer();