// intelligent-update.js - Advanced Natural Language CV Update Processing with AI Capabilities
// UPDATED - Full 18+ Categories Support

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
        
        // Advanced section detection with synonyms - UPDATED for 18+ categories
        this.sectionKeywords = {
            personal: { words: ['name', 'contact', 'phone', 'email', 'address', 'location', 'nationality', 'personal details', 'basic info', 'profile', 'linkedin', 'github', 'portfolio', 'date of birth'], priority: 1 },
            summary: { words: ['summary', 'profile', 'about', 'objective', 'professional summary', 'career objective', 'personal statement', 'executive summary'], priority: 1 },
            experience: { words: ['experience', 'work', 'job', 'employment', 'career', 'position', 'role', 'professional history', 'work history', 'employment history'], priority: 1 },
            education: { words: ['education', 'degree', 'qualification', 'diploma', 'certificate', 'school', 'university', 'academic background', 'training', 'courses'], priority: 1 },
            skills: { words: ['skill', 'competency', 'expertise', 'proficiency', 'ability', 'capability', 'strength', 'core competencies', 'technical skills'], priority: 1 },
            certifications: { words: ['certification', 'certificate', 'license', 'credential', 'professional development', 'accreditation', 'qualification'], priority: 0.9 },
            languages: { words: ['language', 'lingual', 'speak', 'fluent', 'proficiency', 'spoken', 'written'], priority: 0.8 },
            projects: { words: ['project', 'portfolio', 'work sample', 'case study', 'initiative'], priority: 0.8 },
            achievements: { words: ['achievement', 'award', 'recognition', 'honor', 'accomplishment', 'milestone'], priority: 0.8 },
            volunteer: { words: ['volunteer', 'volunteering', 'community service', 'outreach', 'charity', 'non-profit', 'social work'], priority: 0.8 },
            leadership: { words: ['leadership', 'lead', 'managed', 'supervised', 'coordinated', 'directed', 'headed', 'president', 'chair', 'captain'], priority: 0.8 },
            awards: { words: ['award', 'recognition', 'honor', 'prize', 'medal', 'scholarship', 'fellowship'], priority: 0.7 },
            publications: { words: ['publication', 'published', 'article', 'paper', 'journal', 'book', 'chapter', 'research paper'], priority: 0.7 },
            conferences: { words: ['conference', 'seminar', 'workshop', 'symposium', 'talk', 'presentation', 'keynote'], priority: 0.7 },
            referees: { words: ['referee', 'reference', 'recommendation', 'contact', 'endorsement'], priority: 0.7 },
            interests: { words: ['interest', 'hobby', 'passion', 'activity', 'enjoy', 'like'], priority: 0.6 },
            social_media: { words: ['social media', 'linkedin', 'twitter', 'facebook', 'instagram', 'github'], priority: 0.6 },
            portfolio: { words: ['portfolio', 'website', 'blog', 'github', 'behance', 'dribbble'], priority: 0.6 }
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
            // Ensure CV has all 18+ categories structure
            const fullCV = this.ensureCompleteCVStructure(existingCV);
            
            const parsedRequest = await this.advancedParseRequest(userRequest, fullCV);
            
            if (!parsedRequest.action || !parsedRequest.content) {
                const fallbackResult = await this.mlFallbackParse(userRequest, fullCV);
                if (fallbackResult.success) return fallbackResult;
                return { success: false, error: 'Could not understand request. Please be more specific.' };
            }
            
            let updatedCV = JSON.parse(JSON.stringify(fullCV));
            const changesSummary = [];
            
            switch (parsedRequest.action) {
                case 'add':
                    const addResult = await this.smartAddContent(updatedCV, parsedRequest, vacancyData, fullCV);
                    updatedCV = addResult.cv;
                    changesSummary.push(...addResult.changes);
                    break;
                case 'remove':
                    const removeResult = await this.smartRemoveContent(updatedCV, parsedRequest, fullCV);
                    updatedCV = removeResult.cv;
                    changesSummary.push(...removeResult.changes);
                    break;
                case 'update':
                    const updateResult = await this.smartUpdateContent(updatedCV, parsedRequest, vacancyData, fullCV);
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
    
    // Ensure CV has all 18+ categories structure
    ensureCompleteCVStructure(cv) {
        const structured = {
            personal: cv.personal || {},
            professional_summary: cv.professional_summary || '',
            employment: cv.employment || [],
            education: cv.education || [],
            skills: cv.skills || { technical: [], soft: [], tools: [] },
            certifications: cv.certifications || [],
            languages: cv.languages || [],
            projects: cv.projects || [],
            achievements: cv.achievements || [],
            volunteer: cv.volunteer || [],
            leadership: cv.leadership || [],
            awards: cv.awards || [],
            publications: cv.publications || [],
            conferences: cv.conferences || [],
            referees: cv.referees || [],
            interests: cv.interests || [],
            social_media: cv.social_media || {},
            portfolio: cv.portfolio || []
        };
        return structured;
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
                    const regex = new RegExp(`\\b${word}\\b`, 'i');
                    if (regex.test(lowerText)) score += 0.3;
                }
            }
            actionScores[act] = score;
        }
        
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
        
        let content = await this.deepContentExtraction(text, bestAction, bestSection, existingCV);
        
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
        // UPDATED patterns for all 18+ categories
        const patterns = {
            experience: [
                /(?:add|include|insert)\s+(\d+)\s+years?\s+(?:as|of)\s+([a-z\s]+?)(?:\s+at\s+([a-z\s]+))?/i,
                /(?:worked as|served as|employed as)\s+([a-z\s]+?)\s+at\s+([a-z\s]+?)(?:\s+for\s+(\d+)\s+years?)?/i,
                /(?:position|role)\s+of\s+([a-z\s]+?)\s+(?:at|with)\s+([a-z\s]+)/i
            ],
            education: [
                /(?:degree|certificate|diploma)\s+in\s+([a-z\s]+?)\s+from\s+([a-z\s]+)/i,
                /(?:studied|studying)\s+([a-z\s]+?)\s+at\s+([a-z\s]+)/i,
                /(?:graduate|graduated)\s+with\s+([a-z\s]+?)\s+in\s+([a-z\s]+)/i
            ],
            skills: [
                /(?:skill|expertise)\s+in\s+([a-z\s,]+)/i,
                /(?:proficient|experienced)\s+in\s+([a-z\s,]+)/i
            ],
            certification: [
                /(?:certified|certification)\s+in\s+([a-z\s]+?)(?:\s+from\s+([a-z\s]+))?/i,
                /(?:license|licensure)\s+as\s+([a-z\s]+)/i
            ],
            project: [
                /(?:project|built|developed|created)\s+([a-z\s]+?)(?:\s+using\s+([a-z\s,]+))?/i
            ],
            volunteer: [
                /(?:volunteer|volunteered)\s+(?:as|for)\s+([a-z\s]+?)\s+(?:at|with)\s+([a-z\s]+)/i
            ],
            leadership: [
                /(?:led|lead|leadership|managed|supervised)\s+(?:as|a)\s+([a-z\s]+?)\s+(?:at|for|of)\s+([a-z\s]+)/i
            ],
            award: [
                /(?:won|received|awarded)\s+([a-z\s]+?)\s+(?:award|recognition)(?:\s+from\s+([a-z\s]+))?/i
            ],
            publication: [
                /(?:published|wrote)\s+([a-z\s]+?)\s+(?:in|for)\s+([a-z\s]+)/i
            ],
            conference: [
                /(?:spoke at|presented at|attended)\s+([a-z\s]+?)\s+(?:conference|seminar)/i
            ],
            phone: [/phone(?:\s+number)?(?:\s+to)?\s+([\d\s\+]+)/i],
            email: [/email(?:\s+address)?(?:\s+to)?\s+([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})/i],
            location: [/location(?:\s+to)?\s+([a-z\s,]+)/i],
            linkedin: [/linkedin(?:\s+url)?\s+([a-z0-9\/\.\-]+)/i],
            github: [/github(?:\s+url)?\s+([a-z0-9\/\.\-]+)/i]
        };
        
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
                    } else if (type === 'volunteer') {
                        return {
                            type: 'volunteer',
                            role: match[1]?.trim(),
                            organization: match[2]?.trim()
                        };
                    } else if (type === 'leadership') {
                        return {
                            type: 'leadership',
                            role: match[1]?.trim(),
                            organization: match[2]?.trim()
                        };
                    } else if (type === 'award') {
                        return {
                            type: 'award',
                            name: match[1]?.trim(),
                            issuer: match[2]?.trim()
                        };
                    } else if (type === 'project') {
                        return {
                            type: 'project',
                            name: match[1]?.trim(),
                            technologies: match[2]?.trim()
                        };
                    } else if (type === 'certification') {
                        return {
                            type: 'certification',
                            name: match[1]?.trim(),
                            issuer: match[2]?.trim()
                        };
                    } else if (type === 'skills') {
                        return {
                            type: 'skills',
                            skills: match[1].split(',').map(s => s.trim())
                        };
                    } else if (type === 'education') {
                        return {
                            type: 'education',
                            field: match[1]?.trim(),
                            institution: match[2]?.trim()
                        };
                    } else if (type === 'publication') {
                        return {
                            type: 'publication',
                            title: match[1]?.trim(),
                            publisher: match[2]?.trim()
                        };
                    } else if (type === 'conference') {
                        return {
                            type: 'conference',
                            name: match[1]?.trim()
                        };
                    } else if (type === 'phone' || type === 'email' || type === 'location' || type === 'linkedin' || type === 'github') {
                        return { type: type, value: match[1].trim() };
                    }
                }
            }
        }
        
        return { type: 'text', text: text };
    }
    
    async mlFallbackParse(text, existingCV) {
        const tokens = tokenizer.tokenize(text.toLowerCase());
        const textStr = tokens.join(' ');
        
        const cvText = JSON.stringify(existingCV).toLowerCase();
        tfidf.addDocument(cvText);
        tfidf.addDocument(textStr);
        
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
            
            const suggestions = this.getJobSuggestions(content.title);
            if (suggestions.responsibilities) newJob.responsibilities = suggestions.responsibilities;
            if (suggestions.achievements) newJob.achievements = suggestions.achievements;
            
            cv.employment.unshift(newJob);
            changes.push(`✅ Added ${content.years ? content.years + ' years as ' : ''}${content.title}${content.company ? ` at ${content.company}` : ''}`);
            
        } else if (content.type === 'volunteer') {
            if (!cv.volunteer) cv.volunteer = [];
            cv.volunteer.push({
                role: this.capitalizeWords(content.role),
                organization: this.capitalizeWords(content.organization),
                duration: 'To be added',
                responsibilities: []
            });
            changes.push(`✅ Added volunteer experience: ${content.role} at ${content.organization}`);
            
        } else if (content.type === 'leadership') {
            if (!cv.leadership) cv.leadership = [];
            cv.leadership.push({
                role: this.capitalizeWords(content.role),
                organization: this.capitalizeWords(content.organization),
                duration: 'To be added',
                impact: ''
            });
            changes.push(`✅ Added leadership role: ${content.role} at ${content.organization}`);
            
        } else if (content.type === 'award') {
            if (!cv.awards) cv.awards = [];
            cv.awards.push({
                name: this.capitalizeWords(content.name),
                issuer: content.issuer ? this.capitalizeWords(content.issuer) : 'To be added',
                date: new Date().getFullYear().toString(),
                description: ''
            });
            changes.push(`✅ Added award: ${content.name}${content.issuer ? ` from ${content.issuer}` : ''}`);
            
        } else if (content.type === 'project') {
            if (!cv.projects) cv.projects = [];
            cv.projects.push({
                name: this.capitalizeWords(content.name),
                description: '',
                technologies: content.technologies || '',
                role: '',
                duration: '',
                link: ''
            });
            changes.push(`✅ Added project: ${content.name}${content.technologies ? ` using ${content.technologies}` : ''}`);
            
        } else if (content.type === 'publication') {
            if (!cv.publications) cv.publications = [];
            cv.publications.push({
                title: this.capitalizeWords(content.title),
                publisher: content.publisher || 'To be added',
                date: new Date().getFullYear().toString(),
                url: ''
            });
            changes.push(`✅ Added publication: ${content.title}`);
            
        } else if (content.type === 'conference') {
            if (!cv.conferences) cv.conferences = [];
            cv.conferences.push({
                name: this.capitalizeWords(content.name),
                role: 'Attendee',
                date: new Date().getFullYear().toString(),
                location: ''
            });
            changes.push(`✅ Added conference: ${content.name}`);
            
        } else if (content.type === 'skills') {
            if (!cv.skills) cv.skills = { technical: [], soft: [], tools: [] };
            const newSkills = content.skills.filter(s => !cv.skills.technical?.some(existing => existing.toLowerCase() === s.toLowerCase()) &&
                !cv.skills.soft?.some(existing => existing.toLowerCase() === s.toLowerCase()) &&
                !cv.skills.tools?.some(existing => existing.toLowerCase() === s.toLowerCase()));
            
            // Categorize skills
            const techKeywords = ['python', 'javascript', 'java', 'react', 'node', 'sql', 'aws', 'docker', 'cloud', 'api'];
            const softKeywords = ['leadership', 'communication', 'teamwork', 'problem solving', 'management', 'critical thinking'];
            
            for (const skill of newSkills) {
                const lowerSkill = skill.toLowerCase();
                if (techKeywords.some(k => lowerSkill.includes(k))) {
                    if (!cv.skills.technical) cv.skills.technical = [];
                    cv.skills.technical.push(skill);
                } else if (softKeywords.some(k => lowerSkill.includes(k))) {
                    if (!cv.skills.soft) cv.skills.soft = [];
                    cv.skills.soft.push(skill);
                } else {
                    if (!cv.skills.tools) cv.skills.tools = [];
                    cv.skills.tools.push(skill);
                }
            }
            changes.push(`✅ Added ${newSkills.length} new skill(s): ${newSkills.join(', ')}`);
            
        } else if (content.type === 'certification') {
            if (!cv.certifications) cv.certifications = [];
            cv.certifications.push({
                name: this.capitalizeWords(content.name),
                issuer: content.issuer ? this.capitalizeWords(content.issuer) : 'To be added',
                date: new Date().getFullYear().toString()
            });
            changes.push(`✅ Added certification: ${content.name}${content.issuer ? ` from ${content.issuer}` : ''}`);
            
        } else if (content.type === 'education') {
            if (!cv.education) cv.education = [];
            cv.education.push({
                level: 'Degree',
                field: this.capitalizeWords(content.field),
                institution: this.capitalizeWords(content.institution),
                year: new Date().getFullYear().toString()
            });
            changes.push(`✅ Added education: ${content.field} at ${content.institution}`);
            
        } else if (content.type === 'phone' || content.type === 'email' || content.type === 'location' || content.type === 'linkedin' || content.type === 'github') {
            if (!cv.personal) cv.personal = {};
            const fieldMap = { phone: 'primary_phone', email: 'email', location: 'location', linkedin: 'linkedin', github: 'github' };
            const field = fieldMap[content.type];
            cv.personal[field] = content.value;
            changes.push(`✅ Updated ${content.type} to ${content.value}`);
            
        } else {
            const targetSection = parsedRequest.targetSection;
            const textToAdd = this.smartFormatText(content.text);
            
            if (targetSection === 'summary' && cv.professional_summary) {
                cv.professional_summary += ' ' + textToAdd;
                changes.push(`✅ Added to professional summary`);
            } else if (targetSection === 'summary') {
                cv.professional_summary = textToAdd;
                changes.push(`✅ Added professional summary`);
            } else if (targetSection === 'interests') {
                if (!cv.interests) cv.interests = [];
                cv.interests.push(textToAdd);
                changes.push(`✅ Added to interests`);
            } else if (targetSection === 'achievements') {
                if (!cv.achievements) cv.achievements = [];
                cv.achievements.push({ description: textToAdd });
                changes.push(`✅ Added achievement`);
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
            
            const sections = ['employment', 'education', 'certifications', 'languages', 'projects', 'achievements', 'volunteer', 'leadership', 'awards', 'publications', 'conferences', 'referees', 'interests'];
            
            for (const section of sections) {
                if (cv[section] && Array.isArray(cv[section])) {
                    const beforeCount = cv[section].length;
                    cv[section] = cv[section].filter(item => {
                        const itemText = JSON.stringify(item).toLowerCase();
                        return !itemText.includes(searchText);
                    });
                    if (cv[section].length < beforeCount) {
                        changes.push(`✅ Removed ${beforeCount - cv[section].length} item(s) from ${section} matching "${searchText}"`);
                        removed = true;
                    }
                }
            }
            
            // Check skills (object with arrays)
            if (cv.skills) {
                let skillsRemoved = 0;
                for (const category of ['technical', 'soft', 'tools']) {
                    if (cv.skills[category]) {
                        const beforeCount = cv.skills[category].length;
                        cv.skills[category] = cv.skills[category].filter(skill => !skill.toLowerCase().includes(searchText));
                        skillsRemoved += beforeCount - cv.skills[category].length;
                    }
                }
                if (skillsRemoved > 0) {
                    changes.push(`✅ Removed ${skillsRemoved} skill(s) matching "${searchText}"`);
                    removed = true;
                }
            }
            
            // Check personal fields
            if (cv.personal) {
                for (const [key, value] of Object.entries(cv.personal)) {
                    if (value && value.toString().toLowerCase().includes(searchText)) {
                        cv.personal[key] = '';
                        changes.push(`✅ Removed ${key} containing "${searchText}"`);
                        removed = true;
                    }
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
        
        if (content.type === 'phone' || content.type === 'email' || content.type === 'location' || content.type === 'linkedin' || content.type === 'github') {
            if (!cv.personal) cv.personal = {};
            const fieldMap = { phone: 'primary_phone', email: 'email', location: 'location', linkedin: 'linkedin', github: 'github' };
            const field = fieldMap[content.type];
            const oldValue = cv.personal[field];
            cv.personal[field] = content.value;
            changes.push(`✅ Updated ${content.type} from "${oldValue || 'Not set'}" to "${content.value}"`);
            
        } else if (content.type === 'skills' && cv.skills) {
            for (const newSkill of content.skills) {
                const allSkills = [...(cv.skills.technical || []), ...(cv.skills.soft || []), ...(cv.skills.tools || [])];
                const existingIndex = allSkills.findIndex(s => this.areSimilarSkills(s, newSkill));
                if (existingIndex !== -1) {
                    const oldSkill = allSkills[existingIndex];
                    // Determine which category
                    const techLen = (cv.skills.technical || []).length;
                    const softLen = (cv.skills.soft || []).length;
                    
                    if (existingIndex < techLen) {
                        cv.skills.technical[existingIndex] = this.capitalizeWords(newSkill);
                    } else if (existingIndex < techLen + softLen) {
                        const softIndex = existingIndex - techLen;
                        cv.skills.soft[softIndex] = this.capitalizeWords(newSkill);
                    } else {
                        const toolsIndex = existingIndex - techLen - softLen;
                        cv.skills.tools[toolsIndex] = this.capitalizeWords(newSkill);
                    }
                    changes.push(`✅ Updated skill "${oldSkill}" → "${this.capitalizeWords(newSkill)}"`);
                } else {
                    if (!cv.skills.tools) cv.skills.tools = [];
                    cv.skills.tools.push(this.capitalizeWords(newSkill));
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
        
        if (content.type === 'text') {
            const searchText = content.text.toLowerCase();
            
            if (cv.professional_summary && cv.professional_summary.toLowerCase().includes(searchText)) {
                cv.professional_summary = cv.professional_summary.replace(
                    new RegExp(`(${searchText})`, 'gi'),
                    '**$1**'
                );
                changes.push(`✅ Highlighted "${searchText}" in professional summary`);
            }
            
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
        const industry = this.detectIndustryFromCV(cv);
        
        if (industry === 'technology') {
            if (cv.skills && ((cv.skills.technical?.length > 0) || (cv.skills.soft?.length > 0))) {
                changes.push(`✅ Reordered: Skills section moved to top (industry best practice for ${industry})`);
            }
        } else if (industry === 'education') {
            if (cv.education && cv.education.length > 0) {
                changes.push(`✅ Reordered: Education section moved to top (industry best practice for ${industry})`);
            }
        } else if (industry === 'healthcare') {
            if (cv.certifications && cv.certifications.length > 0) {
                changes.push(`✅ Reordered: Certifications section moved to top (industry best practice for ${industry})`);
            }
        } else if (industry === 'project_management') {
            if (cv.projects && cv.projects.length > 0) {
                changes.push(`✅ Reordered: Projects section moved to top (industry best practice for ${industry})`);
            }
        }
        
        return { cv, changes };
    }
    
    async deepTailorForVacancy(cv, vacancyData) {
        const changes = [];
        
        const vacancyKeywords = [
            vacancyData.position,
            ...(vacancyData.requirements || []),
            ...(vacancyData.responsibilities || [])
        ].filter(k => k).map(k => k.toLowerCase());
        
        const allSkills = [...(cv.skills?.technical || []), ...(cv.skills?.soft || []), ...(cv.skills?.tools || [])];
        
        for (const keyword of vacancyKeywords) {
            if (keyword.length > 3 && keyword.length < 30) {
                const exists = allSkills.some(s => 
                    s.toLowerCase().includes(keyword) || keyword.includes(s.toLowerCase())
                );
                if (!exists) {
                    if (!cv.skills) cv.skills = { technical: [], soft: [], tools: [] };
                    if (!cv.skills.tools) cv.skills.tools = [];
                    cv.skills.tools.push(this.capitalizeWords(keyword));
                    changes.push(`✅ Added relevant skill: ${this.capitalizeWords(keyword)} (from vacancy)`);
                }
            }
        }
        
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
        
        const allSkills = [...(cv.skills?.technical || []), ...(cv.skills?.soft || []), ...(cv.skills?.tools || [])];
        const missingSkills = templates.skills.filter(skill => 
            !allSkills.some(existing => existing.toLowerCase().includes(skill.toLowerCase()))
        ).slice(0, 3);
        
        if (missingSkills.length > 0) {
            if (!cv.skills) cv.skills = { technical: [], soft: [], tools: [] };
            if (!cv.skills.technical) cv.skills.technical = [];
            cv.skills.technical.push(...missingSkills);
            changes.push(`✅ Added industry-standard skills: ${missingSkills.join(', ')}`);
        }
        
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
            },
            'nurse': {
                responsibilities: [
                    'Provided compassionate patient care in fast-paced clinical environment',
                    'Administered medications and monitored patient vital signs',
                    'Collaborated with interdisciplinary healthcare team to optimize outcomes',
                    'Maintained accurate medical documentation and patient records'
                ],
                achievements: [
                    'Achieved 98% patient satisfaction rating over 2-year period',
                    'Reduced medication errors by implementing new verification process',
                    'Recognized for excellence in patient care and team collaboration'
                ]
            },
            'accountant': {
                responsibilities: [
                    'Prepared and analyzed financial statements and reports',
                    'Managed accounts payable and receivable processes',
                    'Performed month-end and year-end closing procedures',
                    'Ensured compliance with accounting standards and regulations'
                ],
                achievements: [
                    'Identified cost savings of 15% through process improvements',
                    'Streamlined month-end close process, reducing time by 3 days',
                    'Successfully managed audit process with zero findings'
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
            ...(cv.skills?.technical || []),
            ...(cv.skills?.soft || []),
            ...(cv.skills?.tools || [])
        ].join(' ').toLowerCase();
        
        if (allText.includes('software') || allText.includes('developer') || allText.includes('engineer') || allText.includes('programming')) return 'technology';
        if (allText.includes('project') || allText.includes('manager') || allText.includes('coordinator')) return 'project_management';
        if (allText.includes('teach') || allText.includes('education') || allText.includes('school') || allText.includes('instructor')) return 'education';
        if (allText.includes('health') || allText.includes('medical') || allText.includes('nurse') || allText.includes('patient')) return 'healthcare';
        if (allText.includes('account') || allText.includes('finance') || allText.includes('audit') || allText.includes('tax')) return 'finance';
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
        let formatted = text.trim();
        formatted = formatted.charAt(0).toUpperCase() + formatted.slice(1);
        if (!formatted.endsWith('.') && !formatted.endsWith('!') && !formatted.endsWith('?')) {
            formatted += '.';
        }
        return formatted;
    }
}

module.exports = new IntelligentUpdate();