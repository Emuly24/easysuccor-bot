// intelligent-update.js - Lightweight Natural Language CV Update Processing (No external dependencies)
class IntelligentUpdate {
    constructor() {
        this.actionKeywords = {
            add: ['add', 'include', 'append', 'insert', 'new', 'plus', 'additional'],
            remove: ['remove', 'delete', 'erase', 'take out', 'drop', 'omit', 'clear'],
            update: ['update', 'change', 'modify', 'edit', 'revise', 'correct', 'fix', 'replace']
        };
        
        this.sectionKeywords = {
            personal: ['name', 'contact', 'phone', 'email', 'address', 'location', 'nationality'],
            summary: ['summary', 'profile', 'about', 'objective', 'professional summary'],
            experience: ['experience', 'work', 'job', 'employment', 'career', 'position', 'role'],
            education: ['education', 'degree', 'qualification', 'diploma', 'certificate', 'school', 'university'],
            skills: ['skill', 'competency', 'expertise', 'proficiency', 'ability'],
            certifications: ['certification', 'certificate', 'license', 'credential', 'professional development'],
            languages: ['language', 'lingual', 'speak', 'fluent'],
            referees: ['referee', 'reference', 'recommendation', 'contact']
        };
    }

    async processUpdate(existingCV, userRequest, vacancyData = null) {
        try {
            const parsedRequest = this.parseRequest(userRequest);
            
            if (!parsedRequest.action || !parsedRequest.content) {
                return { success: false, error: 'Could not understand request' };
            }
            
            let updatedCV = JSON.parse(JSON.stringify(existingCV));
            const changesSummary = [];
            
            switch (parsedRequest.action) {
                case 'add':
                    const addResult = await this.addContent(updatedCV, parsedRequest, vacancyData);
                    updatedCV = addResult.cv;
                    changesSummary.push(...addResult.changes);
                    break;
                case 'remove':
                    const removeResult = await this.removeContent(updatedCV, parsedRequest);
                    updatedCV = removeResult.cv;
                    changesSummary.push(...removeResult.changes);
                    break;
                case 'update':
                    const updateResult = await this.updateContent(updatedCV, parsedRequest, vacancyData);
                    updatedCV = updateResult.cv;
                    changesSummary.push(...updateResult.changes);
                    break;
                default:
                    return { success: false, error: 'Unknown action' };
            }
            
            if (vacancyData && vacancyData.has_vacancy) {
                const tailoredResult = await this.tailorForVacancy(updatedCV, vacancyData);
                updatedCV = tailoredResult.cv;
                changesSummary.push(...tailoredResult.changes);
            }
            
            return {
                success: true,
                updated_cv: updatedCV,
                changes_summary: changesSummary
            };
            
        } catch (error) {
            console.error('Intelligent update error:', error);
            return { success: false, error: error.message };
        }
    }
    
    parseRequest(text) {
        const lowerText = text.toLowerCase();
        
        // Determine action
        let action = null;
        for (const [act, keywords] of Object.entries(this.actionKeywords)) {
            for (const keyword of keywords) {
                if (lowerText.includes(keyword)) {
                    action = act;
                    break;
                }
            }
            if (action) break;
        }
        
        // Determine target section
        let targetSection = null;
        for (const [section, keywords] of Object.entries(this.sectionKeywords)) {
            for (const keyword of keywords) {
                if (lowerText.includes(keyword)) {
                    targetSection = section;
                    break;
                }
            }
            if (targetSection) break;
        }
        
        // Extract content
        let content = null;
        
        // Pattern 1: "add X years as Y at Z"
        const expPattern = /add\s+(\d+)\s+years?\s+(?:as|of)\s+([a-z\s]+?)(?:\s+at\s+([a-z\s]+))?/i;
        const expMatch = text.match(expPattern);
        if (expMatch) {
            content = {
                type: 'experience',
                years: expMatch[1],
                title: expMatch[2].trim(),
                company: expMatch[3] ? expMatch[3].trim() : null
            };
        }
        
        // Pattern 2: "add certification in X"
        const certPattern = /add\s+(?:a|an)?\s*certification(?:\s+in|\s+as)?\s+([a-z\s]+)/i;
        const certMatch = text.match(certPattern);
        if (certMatch && !content) {
            content = {
                type: 'certification',
                name: certMatch[1].trim()
            };
        }
        
        // Pattern 3: "add skill X"
        const skillPattern = /add\s+(?:a|an)?\s*skill\s+([a-z\s]+)/i;
        const skillMatch = text.match(skillPattern);
        if (skillMatch && !content) {
            content = {
                type: 'skill',
                name: skillMatch[1].trim()
            };
        }
        
        // Pattern 4: "remove X"
        const removePattern = /remove\s+(?:my|the)?\s*([a-z\s]+)/i;
        const removeMatch = text.match(removePattern);
        if (removeMatch && !content) {
            content = {
                type: 'text',
                text: removeMatch[1].trim()
            };
        }
        
        // Pattern 5: "update my phone to X"
        const phonePattern = /update\s+(?:my|the)?\s*phone(?:\s+to)?\s*([\d\s\+]+)/i;
        const phoneMatch = text.match(phonePattern);
        if (phoneMatch && !content) {
            content = {
                type: 'phone',
                value: phoneMatch[1].trim()
            };
        }
        
        // Pattern 6: "update my email to X"
        const emailPattern = /update\s+(?:my|the)?\s*email(?:\s+to)?\s*([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})/i;
        const emailMatch = text.match(emailPattern);
        if (emailMatch && !content) {
            content = {
                type: 'email',
                value: emailMatch[1].trim()
            };
        }
        
        // Pattern 7: "update my location to X"
        const locationPattern = /update\s+(?:my|the)?\s*location(?:\s+to)?\s+([a-z\s,]+)/i;
        const locationMatch = text.match(locationPattern);
        if (locationMatch && !content) {
            content = {
                type: 'location',
                value: locationMatch[1].trim()
            };
        }
        
        // Default: treat as text
        if (!content) {
            content = {
                type: 'text',
                text: text
            };
        }
        
        return {
            action: action || 'add',
            targetSection: targetSection || 'experience',
            content: content,
            original_text: text
        };
    }
    
    async addContent(cv, parsedRequest, vacancyData) {
        const changes = [];
        const content = parsedRequest.content;
        
        if (content.type === 'experience') {
            if (!cv.employment) cv.employment = [];
            
            const newJob = {
                title: content.title,
                company: content.company || 'Not specified',
                duration: vacancyData ? 'Current' : 'To be added',
                responsibilities: [],
                achievements: []
            };
            
            if (vacancyData && vacancyData.requirements) {
                newJob.responsibilities = vacancyData.requirements.slice(0, 3);
                newJob.achievements = [`Successfully applied for ${vacancyData.position} position`];
            }
            
            cv.employment.unshift(newJob);
            changes.push(`Added ${content.years || ''} years as ${content.title}${content.company ? ` at ${content.company}` : ''}`);
            
        } else if (content.type === 'certification') {
            if (!cv.certifications) cv.certifications = [];
            
            cv.certifications.push({
                name: content.name,
                issuer: 'To be added',
                year: new Date().getFullYear().toString()
            });
            changes.push(`Added certification: ${content.name}`);
            
        } else if (content.type === 'skill') {
            if (!cv.skills) cv.skills = [];
            
            if (!cv.skills.includes(content.name)) {
                cv.skills.push(content.name);
                changes.push(`Added skill: ${content.name}`);
            }
            
        } else {
            const targetSection = parsedRequest.targetSection;
            
            if (targetSection === 'summary' && !cv.professional_summary) {
                cv.professional_summary = content.text;
                changes.push(`Added professional summary`);
            } else if (targetSection === 'summary' && cv.professional_summary) {
                cv.professional_summary += ' ' + content.text;
                changes.push(`Updated professional summary`);
            } else {
                changes.push(`Requested to add: ${content.text?.substring(0, 50) || 'content'}...`);
            }
        }
        
        return { cv, changes };
    }
    
    async removeContent(cv, parsedRequest) {
        const changes = [];
        const content = parsedRequest.content;
        
        if (content.type === 'text') {
            const searchText = content.text.toLowerCase();
            
            if (cv.employment) {
                const originalLength = cv.employment.length;
                cv.employment = cv.employment.filter(job => {
                    const jobText = `${job.title} ${job.company}`.toLowerCase();
                    return !jobText.includes(searchText);
                });
                if (cv.employment.length < originalLength) {
                    changes.push(`Removed work experience matching "${searchText}"`);
                }
            }
            
            if (cv.education) {
                const originalLength = cv.education.length;
                cv.education = cv.education.filter(edu => {
                    const eduText = `${edu.level} ${edu.field} ${edu.institution}`.toLowerCase();
                    return !eduText.includes(searchText);
                });
                if (cv.education.length < originalLength) {
                    changes.push(`Removed education matching "${searchText}"`);
                }
            }
            
            if (cv.skills) {
                const originalLength = cv.skills.length;
                cv.skills = cv.skills.filter(skill => !skill.toLowerCase().includes(searchText));
                if (cv.skills.length < originalLength) {
                    changes.push(`Removed skills matching "${searchText}"`);
                }
            }
        }
        
        if (changes.length === 0) {
            changes.push(`Requested to remove: ${content.text?.substring(0, 50) || 'content'}`);
        }
        
        return { cv, changes };
    }
    
    async updateContent(cv, parsedRequest, vacancyData) {
        const changes = [];
        const content = parsedRequest.content;
        
        if (content.type === 'phone') {
            if (!cv.personal) cv.personal = {};
            cv.personal.primary_phone = content.value;
            changes.push(`Updated phone number to ${cv.personal.primary_phone}`);
        }
        else if (content.type === 'email') {
            if (!cv.personal) cv.personal = {};
            cv.personal.email = content.value;
            changes.push(`Updated email to ${cv.personal.email}`);
        }
        else if (content.type === 'location') {
            if (!cv.personal) cv.personal = {};
            cv.personal.location = content.value;
            changes.push(`Updated location to ${cv.personal.location}`);
        }
        else if (content.text && (content.text.includes('phone') || content.text.includes('email') || content.text.includes('location'))) {
            if (!cv.personal) cv.personal = {};
            
            const phoneMatch = content.text.match(/phone\s+(?:to\s+)?([\d\s\+]+)/i);
            if (phoneMatch) {
                cv.personal.primary_phone = phoneMatch[1].trim();
                changes.push(`Updated phone number to ${cv.personal.primary_phone}`);
            }
            
            const emailMatch = content.text.match(/email\s+(?:to\s+)?([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})/i);
            if (emailMatch) {
                cv.personal.email = emailMatch[1].trim();
                changes.push(`Updated email to ${cv.personal.email}`);
            }
            
            const locationMatch = content.text.match(/location\s+(?:to\s+)?([a-z\s,]+)/i);
            if (locationMatch) {
                cv.personal.location = locationMatch[1].trim();
                changes.push(`Updated location to ${cv.personal.location}`);
            }
        } else {
            changes.push(`Requested to update: ${content.text?.substring(0, 50) || 'content'}...`);
        }
        
        return { cv, changes };
    }
    
    async tailorForVacancy(cv, vacancyData) {
        const changes = [];
        
        if (vacancyData.position && vacancyData.company) {
            const vacancyMention = `Seeking ${vacancyData.position} position at ${vacancyData.company}`;
            if (cv.professional_summary) {
                if (!cv.professional_summary.includes(vacancyData.position)) {
                    cv.professional_summary += ` ${vacancyMention}.`;
                    changes.push(`Tailored professional summary for ${vacancyData.position} role`);
                }
            } else {
                cv.professional_summary = vacancyMention;
                changes.push(`Added professional summary targeting ${vacancyData.position}`);
            }
        }
        
        if (vacancyData.requirements && cv.skills) {
            for (const req of vacancyData.requirements.slice(0, 5)) {
                const reqLower = req.toLowerCase();
                const exists = cv.skills.some(s => s.toLowerCase().includes(reqLower) || reqLower.includes(s.toLowerCase()));
                if (!exists && req.length < 30) {
                    cv.skills.push(req);
                    changes.push(`Added relevant skill: ${req}`);
                }
            }
        }
        
        return { cv, changes };
    }
}

module.exports = new IntelligentUpdate();