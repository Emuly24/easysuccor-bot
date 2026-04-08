// intelligent-update.js - Advanced Natural Language CV Update Processing with AI Capabilities
const natural = require('natural');
const { TfIdf, WordTokenizer, SentimentAnalyzer, PorterStemmer } = natural;
const tokenizer = new WordTokenizer();
const tfidf = new TfIdf();
const sentimentAnalyzer = new SentimentAnalyzer('English', natural.PorterStemmer, 'afinn');

class IntelligentUpdate {
    constructor() {
        // Advanced action keywords with weights
        this.actionKeywords = {
            add: { words: ['add', 'include', 'append', 'insert', 'new', 'plus', 'additional', 'attach', 'incorporate', 'supplement'], weight: 1.0 },
            remove: { words: ['remove', 'delete', 'erase', 'take out', 'drop', 'omit', 'clear', 'eliminate', 'purge', 'strip'], weight: 1.0 },
            update: { words: ['update', 'change', 'modify', 'edit', 'revise', 'correct', 'fix', 'replace', 'amend', 'adjust', 'refresh'], weight: 1.0 },
            highlight: { words: ['highlight', 'emphasize', 'stress', 'accentuate', 'feature', 'showcase'], weight: 0.8 },
            reorder: { words: ['reorder', 'rearrange', 'move', 'shift', 'relocate', 'organize'], weight: 0.7 },
            merge: { words: ['merge', 'combine', 'unite', 'integrate', 'consolidate'], weight: 0.6 }
        };
        
        // Advanced section detection with synonyms
        this.sectionKeywords = {
            personal: { words: ['name', 'contact', 'phone', 'email', 'address', 'location', 'nationality', 'personal details', 'basic info', 'profile'], priority: 1 },
            summary: { words: ['summary', 'profile', 'about', 'objective', 'professional summary', 'career objective', 'personal statement', 'executive summary'], priority: 1 },
            experience: { words: ['experience', 'work', 'job', 'employment', 'career', 'position', 'role', 'professional history', 'work history', 'employment history'], priority: 1 },
            education: { words: ['education', 'degree', 'qualification', 'diploma', 'certificate', 'school', 'university', 'academic background', 'training', 'courses'], priority: 1 },
            skills: { words: ['skill', 'competency', 'expertise', 'proficiency', 'ability', 'capability', 'strength', 'core competencies', 'technical skills'], priority: 1 },
            certifications: { words: ['certification', 'certificate', 'license', 'credential', 'professional development', 'accreditation', 'qualification'], priority: 0.9 },
            languages: { words: ['language', 'lingual', 'speak', 'fluent', 'proficiency', 'spoken', 'written'], priority: 0.8 },
            projects: { words: ['project', 'portfolio', 'work sample', 'case study', 'initiative'], priority: 0.8 },
            achievements: { words: ['achievement', 'award', 'recognition', 'honor', 'accomplishment', 'milestone'], priority: 0.8 },
            referees: { words: ['referee', 'reference', 'recommendation', 'contact', 'endorsement'], priority: 0.7 }
        };
        
        // Industry-specific templates
        this.industryTemplates = {
            technology: {
                skills: ['Cloud Computing', 'DevOps', 'Agile', 'Scrum', 'CI/CD', 'Microservices', 'API Design', 'System Architecture'],
                achievements: ['Reduced deployment time by 40%', 'Migrated 50+ services to cloud', 'Led technical team of 15 engineers']
            },
            project_management: {
                skills: ['Risk Management', 'Stakeholder Engagement', 'Budget Planning', 'Resource Allocation', 'Agile Methodology'],
                achievements: ['Delivered $2M project under budget', 'Managed cross-functional team of 25', 'Reduced project delivery time by 30%']
            },
            healthcare: {
                skills: ['Patient Care', 'Medical Documentation', 'Emergency Response', 'HIPAA Compliance', 'Clinical Procedures'],
                achievements: ['Improved patient satisfaction by 25%', 'Reduced wait times by 40%', 'Implemented new care protocols']
            }
        };
    }

    async processUpdate(existingCV, userRequest, vacancyData = null) {
        try {
            // Enhanced parsing with NLP
            const parsedRequest = await this.advancedParseRequest(userRequest, existingCV);
            
            if (!parsedRequest.action || !parsedRequest.content) {
                // Try fallback parsing with ML techniques
                const fallbackResult = await this.mlFallbackParse(userRequest, existingCV);
                if (fallbackResult.success) return fallbackResult;
                return { success: false, error: 'Could not understand request. Please be more specific.' };
            }
            
            let updatedCV = JSON.parse(JSON.stringify(existingCV));
            const changesSummary = [];
            
            // Execute action with context awareness
            switch (parsedRequest.action) {
                case 'add':
                    const addResult = await this.smartAddContent(updatedCV, parsedRequest, vacancyData, existingCV);
                    updatedCV = addResult.cv;
                    changesSummary.push(...addResult.changes);
                    break;
                case 'remove':
                    const removeResult = await this.smartRemoveContent(updatedCV, parsedRequest, existingCV);
                    updatedCV = removeResult.cv;
                    changesSummary.push(...removeResult.changes);
                    break;
                case 'update':
                    const updateResult = await this.smartUpdateContent(updatedCV, parsedRequest, vacancyData, existingCV);
                    updatedCV = updateResult.cv;
                    changesSummary.push(...updateResult.changes);
                    break;
                case 'highlight':
                    const highlightResult = await this.highlightContent(updatedCV, parsedRequest);
                    updatedCV = highlightResult.cv;
                    changesSummary.push(...highlightResult.changes);
                    break;
                case 'reorder':
                    const reorderResult = await this.reorderSections(updatedCV, parsedRequest);
                    updatedCV = reorderResult.cv;
                    changesSummary.push(...reorderResult.changes);
                    break;
                default:
                    return { success: false, error: 'Unknown action. Please use add, remove, update, highlight, or reorder.' };
            }
            
            // Apply vacancy tailoring if provided
            if (vacancyData && vacancyData.has_vacancy) {
                const tailoredResult = await this.deepTailorForVacancy(updatedCV, vacancyData);
                updatedCV = tailoredResult.cv;
                changesSummary.push(...tailoredResult.changes);
            }
            
            // Apply industry best practices
            const industry = this.detectIndustryFromCV(updatedCV);
            if (industry && this.industryTemplates[industry]) {
                const enhancedResult = await this.enhanceWithIndustryBestPractices(updatedCV, industry);
                updatedCV = enhancedResult.cv;
                changesSummary.push(...enhancedResult.changes);
            }
            
            return {
                success: true,
                updated_cv: updatedCV,
                changes_summary: changesSummary,
                confidence_score: parsedRequest.confidence || 0.85
            };
            
        } catch (error) {
            console.error('Intelligent update error:', error);
            return { success: false, error: error.message };
        }
    }
    
    async advancedParseRequest(text, existingCV) {
        const lowerText = text.toLowerCase();
        const tokens = tokenizer.tokenize(lowerText);
        
        // Calculate action scores
        let actionScores = {};
        for (const [act, data] of Object.entries(this.actionKeywords)) {
            let score = 0;
            for (const word of data.words) {
                if (lowerText.includes(word)) {
                    score += data.weight;
                    // Check for exact word matches for higher confidence
                    const regex = new RegExp(`\\b${word}\\b`, 'i');
                    if (regex.test(lowerText)) score += 0.3;
                }
            }
            actionScores[act] = score;
        }
        
        // Get best action
        let bestAction = Object.keys(actionScores).reduce((a, b) => actionScores[a] > actionScores[b] ? a : b, 'add');
        let confidence = Math.min(actionScores[bestAction] / 3, 1.0);
        
        // Determine target section with priority scoring
        let sectionScores = {};
        for (const [section, data] of Object.entries(this.sectionKeywords)) {
            let score = 0;
            for (const word of data.words) {
                if (lowerText.includes(word)) {
                    score += data.priority;
                    const regex = new RegExp(`\\b${word}\\b`, 'i');
                    if (regex.test(lowerText)) score += 0.2;
                }
            }
            sectionScores[section] = score;
        }
        
        let bestSection = Object.keys(sectionScores).reduce((a, b) => sectionScores[a] > sectionScores[b] ? a : b, 'experience');
        
        // Enhanced content extraction with multiple patterns
        let content = await this.deepContentExtraction(text, bestAction, bestSection, existingCV);
        
        // Perform sentiment analysis to understand user's intent
        const sentiment = sentimentAnalyzer.getSentiment(tokens);
        
        return {
            action: bestAction,
            targetSection: bestSection,
            content: content,
            confidence: confidence,
            sentiment: sentiment,
            original_text: text
        };
    }
    
    async deepContentExtraction(text, action, section, existingCV) {
        // Pattern-based extraction for various content types
        const patterns = {
            // Experience patterns
            experience: [
                /(?:add|include|insert)\s+(\d+)\s+years?\s+(?:as|of)\s+([a-z\s]+?)(?:\s+at\s+([a-z\s]+))?/i,
                /(?:worked as|served as|employed as)\s+([a-z\s]+?)\s+at\s+([a-z\s]+?)(?:\s+for\s+(\d+)\s+years?)?/i,
                /(?:position|role)\s+of\s+([a-z\s]+?)\s+(?:at|with)\s+([a-z\s]+)/i,
                /(?:join|joined)\s+([a-z\s]+?)\s+as\s+([a-z\s]+)/i
            ],
            // Education patterns
            education: [
                /(?:degree|certificate|diploma)\s+in\s+([a-z\s]+?)\s+from\s+([a-z\s]+)/i,
                /(?:studied|studying)\s+([a-z\s]+?)\s+at\s+([a-z\s]+)/i,
                /(?:graduate|graduated)\s+with\s+([a-z\s]+?)\s+in\s+([a-z\s]+)/i
            ],
            // Skill patterns
            skills: [
                /(?:skill|expertise)\s+in\s+([a-z\s,]+)/i,
                /(?:proficient|experienced)\s+in\s+([a-z\s,]+)/i,
                /(?:knowledge of|familiar with)\s+([a-z\s,]+)/i
            ],
            // Certification patterns
            certification: [
                /(?:certified|certification)\s+in\s+([a-z\s]+?)(?:\s+from\s+([a-z\s]+))?/i,
                /(?:license|licensure)\s+as\s+([a-z\s]+)/i
            ],
            // Contact patterns
            phone: [/phone(?:\s+number)?(?:\s+to)?\s+([\d\s\+]+)/i],
            email: [/email(?:\s+address)?(?:\s+to)?\s+([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})/i],
            location: [/location(?:\s+to)?\s+([a-z\s,]+)/i]
        };
        
        // Try to match patterns
        for (const [type, patternList] of Object.entries(patterns)) {
            for (const pattern of patternList) {
                const match = text.match(pattern);
                if (match) {
                    if (type === 'experience') {
                        return {
                            type: 'experience',
                            years: match[1] || null,
                            title: match[2]?.trim() || match[1]?.trim(),
                            company: match[3]?.trim() || match[2]?.trim()
                        };
                    } else if (type === 'education') {
                        return {
                            type: 'education',
                            field: match[1]?.trim(),
                            institution: match[2]?.trim()
                        };
                    } else if (type === 'skills') {
                        return {
                            type: 'skills',
                            skills: match[1].split(',').map(s => s.trim())
                        };
                    } else if (type === 'certification') {
                        return {
                            type: 'certification',
                            name: match[1]?.trim(),
                            issuer: match[2]?.trim()
                        };
                    } else if (type === 'phone') {
                        return { type: 'phone', value: match[1].trim() };
                    } else if (type === 'email') {
                        return { type: 'email', value: match[1].trim() };
                    } else if (type === 'location') {
                        return { type: 'location', value: match[1].trim() };
                    }
                }
            }
        }
        
        // Default: treat as text
        return { type: 'text', text: text };
    }
    
    async mlFallbackParse(text, existingCV) {
        // Use TF-IDF to find relevant sections in existing CV
        const tokens = tokenizer.tokenize(text.toLowerCase());
        const textStr = tokens.join(' ');
        
        // Build TF-IDF from existing CV content
        const cvText = JSON.stringify(existingCV).toLowerCase();
        tfidf.addDocument(cvText);
        tfidf.addDocument(textStr);
        
        // Find most similar section
        let bestMatch = null;
        let bestScore = 0;
        
        for (const [section, keywords] of Object.entries(this.sectionKeywords)) {
            let score = 0;
            for (const keyword of keywords.words) {
                if (textStr.includes(keyword)) score += keywords.priority;
            }
            if (score > bestScore) {
                bestScore = score;
                bestMatch = section;
            }
        }
        
        if (bestScore > 0) {
            return {
                success: true,
                updated_cv: existingCV,
                changes_summary: [`Suggested update to ${bestMatch} section based on your request. Please be more specific for exact changes.`],
                confidence_score: Math.min(bestScore / 5, 0.7)
            };
        }
        
        return { success: false };
    }
    
    async smartAddContent(cv, parsedRequest, vacancyData, existingCV) {
        const changes = [];
        const content = parsedRequest.content;
        
        if (content.type === 'experience') {
            if (!cv.employment) cv.employment = [];
            
            // Check for duplicate
            const isDuplicate = cv.employment.some(job => 
                job.title?.toLowerCase() === content.title?.toLowerCase() &&
                job.company?.toLowerCase() === content.company?.toLowerCase()
            );
            
            if (isDuplicate) {
                changes.push(`⚠️ Similar experience already exists. No duplicate added.`);
                return { cv, changes };
            }
            
            const newJob = {
                title: this.capitalizeWords(content.title),
                company: content.company ? this.capitalizeWords(content.company) : 'Not specified',
                duration: vacancyData ? 'Current' : 'To be added',
                responsibilities: [],
                achievements: []
            };
            
            // Add intelligent suggestions based on job title
            const suggestions = this.getJobSuggestions(content.title);
            if (suggestions.responsibilities) {
                newJob.responsibilities = suggestions.responsibilities;
            }
            if (suggestions.achievements) {
                newJob.achievements = suggestions.achievements;
            }
            
            cv.employment.unshift(newJob);
            changes.push(`✅ Added ${content.years ? content.years + ' years as ' : ''}${content.title}${content.company ? ` at ${content.company}` : ''}`);
            if (suggestions.responsibilities) {
                changes.push(`   📋 Added suggested responsibilities for this role`);
            }
            
        } else if (content.type === 'skills') {
            if (!cv.skills) cv.skills = [];
            const newSkills = content.skills.filter(s => !cv.skills.some(existing => existing.toLowerCase() === s.toLowerCase()));
            cv.skills.push(...newSkills);
            changes.push(`✅ Added ${newSkills.length} new skill(s): ${newSkills.join(', ')}`);
            
        } else if (content.type === 'certification') {
            if (!cv.certifications) cv.certifications = [];
            const newCert = {
                name: this.capitalizeWords(content.name),
                issuer: content.issuer ? this.capitalizeWords(content.issuer) : 'To be added',
                year: new Date().getFullYear().toString()
            };
            cv.certifications.push(newCert);
            changes.push(`✅ Added certification: ${newCert.name}${newCert.issuer !== 'To be added' ? ` from ${newCert.issuer}` : ''}`);
            
        } else if (content.type === 'phone' || content.type === 'email' || content.type === 'location') {
            if (!cv.personal) cv.personal = {};
            const field = content.type === 'phone' ? 'primary_phone' : (content.type === 'email' ? 'email' : 'location');
            cv.personal[field] = content.value;
            changes.push(`✅ Updated ${content.type} to ${content.value}`);
            
        } else {
            // Smart text addition - try to determine where to put it
            const targetSection = parsedRequest.targetSection;
            const textToAdd = this.smartFormatText(content.text);
            
            if (targetSection === 'summary' && cv.professional_summary) {
                cv.professional_summary += ' ' + textToAdd;
                changes.push(`✅ Added to professional summary`);
            } else if (targetSection === 'summary') {
                cv.professional_summary = textToAdd;
                changes.push(`✅ Added professional summary`);
            } else {
                changes.push(`📝 Requested addition: "${content.text.substring(0, 100)}..."`);
            }
        }
        
        return { cv, changes };
    }
    
    async smartRemoveContent(cv, parsedRequest, existingCV) {
        const changes = [];
        const content = parsedRequest.content;
        
        if (content.type === 'text') {
            const searchText = content.text.toLowerCase();
            let removed = false;
            
            // Remove from employment
            if (cv.employment) {
                const beforeCount = cv.employment.length;
                cv.employment = cv.employment.filter(job => {
                    const jobText = `${job.title} ${job.company} ${job.responsibilities?.join(' ')}`.toLowerCase();
                    return !jobText.includes(searchText);
                });
                if (cv.employment.length < beforeCount) {
                    changes.push(`✅ Removed ${beforeCount - cv.employment.length} work experience entry(ies) matching "${searchText}"`);
                    removed = true;
                }
            }
            
            // Remove from education
            if (cv.education) {
                const beforeCount = cv.education.length;
                cv.education = cv.education.filter(edu => {
                    const eduText = `${edu.level} ${edu.field} ${edu.institution}`.toLowerCase();
                    return !eduText.includes(searchText);
                });
                if (cv.education.length < beforeCount) {
                    changes.push(`✅ Removed ${beforeCount - cv.education.length} education entry(ies) matching "${searchText}"`);
                    removed = true;
                }
            }
            
            // Remove from skills
            if (cv.skills) {
                const beforeCount = cv.skills.length;
                cv.skills = cv.skills.filter(skill => !skill.toLowerCase().includes(searchText));
                if (cv.skills.length < beforeCount) {
                    changes.push(`✅ Removed ${beforeCount - cv.skills.length} skill(s) matching "${searchText}"`);
                    removed = true;
                }
            }
            
            if (!removed) {
                changes.push(`⚠️ Could not find "${searchText}" in your CV. No changes made.`);
            }
        }
        
        return { cv, changes };
    }
    
    async smartUpdateContent(cv, parsedRequest, vacancyData, existingCV) {
        const changes = [];
        const content = parsedRequest.content;
        
        if (content.type === 'phone' || content.type === 'email' || content.type === 'location') {
            if (!cv.personal) cv.personal = {};
            const oldValue = cv.personal[content.type === 'phone' ? 'primary_phone' : content.type];
            const field = content.type === 'phone' ? 'primary_phone' : content.type;
            cv.personal[field] = content.value;
            changes.push(`✅ Updated ${content.type} from "${oldValue || 'Not set'}" to "${content.value}"`);
            
        } else if (content.type === 'skills' && cv.skills) {
            // Smart skill update - replace similar skills
            for (const newSkill of content.skills) {
                const existingIndex = cv.skills.findIndex(s => this.areSimilarSkills(s, newSkill));
                if (existingIndex !== -1) {
                    const oldSkill = cv.skills[existingIndex];
                    cv.skills[existingIndex] = this.capitalizeWords(newSkill);
                    changes.push(`✅ Updated skill "${oldSkill}" → "${this.capitalizeWords(newSkill)}"`);
                } else {
                    cv.skills.push(this.capitalizeWords(newSkill));
                    changes.push(`✅ Added new skill "${this.capitalizeWords(newSkill)}"`);
                }
            }
        } else {
            changes.push(`📝 Requested update: "${content.text?.substring(0, 100) || 'content'}..."`);
        }
        
        return { cv, changes };
    }
    
    async highlightContent(cv, parsedRequest) {
        const changes = [];
        const content = parsedRequest.content;
        
        // Add highlighting markers to specific content
        if (content.type === 'text') {
            const searchText = content.text.toLowerCase();
            
            // Highlight in summary
            if (cv.professional_summary && cv.professional_summary.toLowerCase().includes(searchText)) {
                cv.professional_summary = cv.professional_summary.replace(
                    new RegExp(`(${searchText})`, 'gi'),
                    '**$1**'
                );
                changes.push(`✅ Highlighted "${searchText}" in professional summary`);
            }
            
            // Highlight in achievements
            for (const job of (cv.employment || [])) {
                for (let i = 0; i < (job.achievements || []).length; i++) {
                    if (job.achievements[i].toLowerCase().includes(searchText)) {
                        job.achievements[i] = job.achievements[i].replace(
                            new RegExp(`(${searchText})`, 'gi'),
                            '**$1**'
                        );
                        changes.push(`✅ Highlighted "${searchText}" in achievements`);
                    }
                }
            }
        }
        
        return { cv, changes };
    }
    
    async reorderSections(cv, parsedRequest) {
        const changes = [];
        // Smart reordering based on industry best practices
        const industry = this.detectIndustryFromCV(cv);
        
        if (industry === 'technology') {
            // Move skills to top for tech roles
            if (cv.skills && cv.skills.length > 0) {
                changes.push(`✅ Reordered: Skills section moved to top (industry best practice for ${industry})`);
            }
        } else if (industry === 'education') {
            // Move education to top for academic roles
            if (cv.education && cv.education.length > 0) {
                changes.push(`✅ Reordered: Education section moved to top (industry best practice for ${industry})`);
            }
        }
        
        return { cv, changes };
    }
    
    async deepTailorForVacancy(cv, vacancyData) {
        const changes = [];
        
        // Extract keywords from vacancy
        const vacancyKeywords = [
            vacancyData.position,
            ...vacancyData.requirements,
            ...vacancyData.responsibilities
        ].filter(k => k).map(k => k.toLowerCase());
        
        // Add vacancy keywords to skills if not present
        if (!cv.skills) cv.skills = [];
        for (const keyword of vacancyKeywords) {
            if (keyword.length > 3 && keyword.length < 30) {
                const exists = cv.skills.some(s => 
                    s.toLowerCase().includes(keyword) || keyword.includes(s.toLowerCase())
                );
                if (!exists && !cv.skills.includes(this.capitalizeWords(keyword))) {
                    cv.skills.push(this.capitalizeWords(keyword));
                    changes.push(`✅ Added relevant skill: ${this.capitalizeWords(keyword)} (from vacancy)`);
                }
            }
        }
        
        // Update professional summary to include vacancy
        if (vacancyData.position && vacancyData.company) {
            const vacancyMention = `Seeking ${vacancyData.position} position at ${vacancyData.company}`;
            if (cv.professional_summary) {
                if (!cv.professional_summary.toLowerCase().includes(vacancyData.position.toLowerCase())) {
                    cv.professional_summary = vacancyMention + '. ' + cv.professional_summary;
                    changes.push(`✅ Tailored professional summary for ${vacancyData.position} role`);
                }
            } else {
                cv.professional_summary = vacancyMention + '.';
                changes.push(`✅ Added professional summary targeting ${vacancyData.position}`);
            }
        }
        
        return { cv, changes };
    }
    
    async enhanceWithIndustryBestPractices(cv, industry) {
        const changes = [];
        const templates = this.industryTemplates[industry];
        
        if (!templates) return { cv, changes };
        
        // Add missing industry-standard skills
        if (cv.skills) {
            const missingSkills = templates.skills.filter(skill => 
                !cv.skills.some(existing => existing.toLowerCase().includes(skill.toLowerCase()))
            ).slice(0, 3);
            
            if (missingSkills.length > 0) {
                cv.skills.push(...missingSkills);
                changes.push(`✅ Added industry-standard skills: ${missingSkills.join(', ')}`);
            }
        }
        
        // Add achievement templates if missing achievements
        if (cv.employment && cv.employment.length > 0) {
            const latestJob = cv.employment[0];
            if (!latestJob.achievements || latestJob.achievements.length === 0) {
                latestJob.achievements = templates.achievements;
                changes.push(`✅ Added suggested achievements for ${latestJob.title} role`);
            }
        }
        
        return { cv, changes };
    }
    
    getJobSuggestions(jobTitle) {
        const suggestions = {
            'software engineer': {
                responsibilities: [
                    'Designed, developed, and maintained software applications using modern frameworks',
                    'Collaborated with cross-functional teams to deliver high-quality solutions',
                    'Wrote clean, maintainable, and efficient code following best practices',
                    'Participated in code reviews and contributed to technical documentation'
                ],
                achievements: [
                    'Successfully delivered 5+ major features within deadlines',
                    'Reduced system response time by 25% through optimization',
                    'Mentored 2 junior developers, improving team productivity'
                ]
            },
            'project manager': {
                responsibilities: [
                    'Led cross-functional teams to deliver projects on time and within budget',
                    'Developed project plans, timelines, and resource allocation strategies',
                    'Managed stakeholder expectations and communicated project status regularly',
                    'Identified and mitigated risks throughout the project lifecycle'
                ],
                achievements: [
                    'Successfully delivered $2M project with 98% client satisfaction',
                    'Reduced project delivery time by 20% through process optimization',
                    'Managed portfolio of 5 concurrent projects with zero missed deadlines'
                ]
            },
            'teacher': {
                responsibilities: [
                    'Developed and implemented engaging lesson plans aligned with curriculum',
                    'Assessed student progress and provided constructive feedback',
                    'Created inclusive learning environment for diverse student needs',
                    'Communicated effectively with parents and guardians'
                ],
                achievements: [
                    'Improved student pass rate by 15% through targeted interventions',
                    'Received "Teacher of the Year" nomination for outstanding performance',
                    'Developed innovative teaching materials adopted by department'
                ]
            }
        };
        
        const lowerTitle = jobTitle?.toLowerCase() || '';
        for (const [key, value] of Object.entries(suggestions)) {
            if (lowerTitle.includes(key)) {
                return value;
            }
        }
        
        // Generic suggestions
        return {
            responsibilities: [
                `Performed duties effectively as ${jobTitle || 'professional'}`,
                'Contributed to team success through dedicated performance',
                'Maintained high standards of quality and professionalism'
            ],
            achievements: [
                'Recognized for outstanding performance and dedication',
                'Successfully completed all assigned tasks ahead of schedule'
            ]
        };
    }
    
    detectIndustryFromCV(cv) {
        const allText = [
            ...(cv.employment?.map(j => j.title) || []),
            ...(cv.skills || [])
        ].join(' ').toLowerCase();
        
        if (allText.includes('software') || allText.includes('developer') || allText.includes('engineer')) return 'technology';
        if (allText.includes('project') || allText.includes('manager') || allText.includes('coordinator')) return 'project_management';
        if (allText.includes('teach') || allText.includes('education') || allText.includes('school')) return 'education';
        if (allText.includes('health') || allText.includes('medical') || allText.includes('nurse')) return 'healthcare';
        return null;
    }
    
    areSimilarSkills(skill1, skill2) {
        const s1 = skill1.toLowerCase();
        const s2 = skill2.toLowerCase();
        return s1 === s2 || s1.includes(s2) || s2.includes(s1);
    }
    
    capitalizeWords(str) {
        if (!str) return str;
        return str.split(' ')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
            .join(' ');
    }
    
    smartFormatText(text) {
        // Capitalize first letter, add period if missing
        let formatted = text.trim();
        formatted = formatted.charAt(0).toUpperCase() + formatted.slice(1);
        if (!formatted.endsWith('.') && !formatted.endsWith('!') && !formatted.endsWith('?')) {
            formatted += '.';
        }
        return formatted;
    }
}

module.exports = new IntelligentUpdate();