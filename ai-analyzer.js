// ai-analyzer.js - Advanced AI Analysis with DeepSeek Integration
// FULLY UPDATED - Analyzes and enhances ALL CV sections

const fs = require('fs');
const path = require('path');
const { OpenAI } = require('openai');

class AIAnalyzer {
    constructor() {
        this.tempPath = path.join(__dirname, 'temp');
        this.uploadsPath = path.join(__dirname, 'uploads');
        this.certificatesPath = path.join(this.uploadsPath, 'certificates');
        this.analysisHistoryPath = path.join(__dirname, 'exports', 'analysis_history.json');
        
        if (!fs.existsSync(this.tempPath)) fs.mkdirSync(this.tempPath, { recursive: true });
        if (!fs.existsSync(this.uploadsPath)) fs.mkdirSync(this.uploadsPath, { recursive: true });
        if (!fs.existsSync(this.certificatesPath)) fs.mkdirSync(this.certificatesPath, { recursive: true });
        
        const exportsDir = path.join(__dirname, 'exports');
        if (!fs.existsSync(exportsDir)) fs.mkdirSync(exportsDir, { recursive: true });

        this.deepseek = new OpenAI({
            apiKey: process.env.DEEPSEEK_API_KEY,
            baseURL: 'https://api.deepseek.com/v1'
        });
        
        this.analysisHistory = this.loadAnalysisHistory();
    }

    loadAnalysisHistory() {
        if (fs.existsSync(this.analysisHistoryPath)) {
            return JSON.parse(fs.readFileSync(this.analysisHistoryPath, 'utf8'));
        }
        return {};
    }

    saveAnalysisHistory() {
        fs.writeFileSync(this.analysisHistoryPath, JSON.stringify(this.analysisHistory, null, 2));
    }

    // ============ COMPLETE CV ENHANCEMENT - ALL SECTIONS ============
    
    async enhanceCVData(rawCvData, vacancyData = null) {
        try {
            const prompt = `You are an expert CV enhancement AI. Enhance ALL sections of this CV data.

Original CV Data:
${JSON.stringify({
    personal: rawCvData.personal,
    professional_summary: rawCvData.professional_summary,
    employment: rawCvData.employment?.map(j => ({ 
        title: j.title, 
        company: j.company, 
        duration: j.duration,
        responsibilities: j.responsibilities?.slice(0, 3),
        achievements: j.achievements?.slice(0, 2)
    })),
    education: rawCvData.education,
    skills: rawCvData.skills,
    certifications: rawCvData.certifications,
    languages: rawCvData.languages,
    projects: rawCvData.projects?.slice(0, 3),
    volunteer: rawCvData.volunteer,
    leadership: rawCvData.leadership,
    referees: rawCvData.referees
}, null, 2)}

${vacancyData ? `Target Vacancy: ${vacancyData.position} at ${vacancyData.company}` : ''}

Return a COMPLETE enhanced CV as JSON with ALL these sections:

{
  "professional_summary": "Enhanced compelling summary (3-4 sentences)",
  "personal": {
    "professional_title": "Enhanced job title based on experience",
    "bio": "Short professional bio (1 sentence)"
  },
  "skills": {
    "technical": ["enhanced technical skills"],
    "soft": ["enhanced soft skills"],
    "tools": ["enhanced tools"],
    "certifications": ["enhanced certifications"]
  },
  "employment_enhancements": [
    {
      "title": "job title",
      "enhanced_achievements": ["metric-driven achievement 1", "achievement 2"],
      "enhanced_responsibilities": ["enhanced responsibility 1"]
    }
  ],
  "education_enhancements": [
    {
      "level": "degree level",
      "enhanced_courses": ["relevant course 1", "course 2"],
      "academic_achievements": ["honor 1", "award 1"]
    }
  ],
  "projects_enhancements": [
    {
      "name": "project name",
      "enhanced_description": "better description with impact"
    }
  ],
  "achievements_enhanced": ["new achievement 1", "achievement 2"],
  "volunteer_enhancements": [
    {
      "role": "volunteer role",
      "enhanced_impact": "impact statement"
    }
  ],
  "leadership_enhancements": [
    {
      "role": "leadership role",
      "enhanced_impact": "impact statement"
    }
  ],
  "missing_sections": ["section1", "section2"],
  "recommendations": ["recommendation 1", "recommendation 2"]
}

Return ONLY valid JSON.`;

            const response = await this.deepseek.chat.completions.create({
                model: 'deepseek-chat',
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.3,
                max_tokens: 4000,
                response_format: { type: 'json_object' }
            });

            const enhanced = JSON.parse(response.choices[0].message.content);
            
            // Merge all enhancements back into the original data
            const result = { ...rawCvData };
            
            // Update professional summary
            if (enhanced.professional_summary) {
                result.professional_summary = enhanced.professional_summary;
            }
            
            // Update personal info
            if (enhanced.personal) {
                result.personal = { ...result.personal, ...enhanced.personal };
            }
            
            // Update skills
            if (enhanced.skills) {
                result.skills = {
                    technical: [...new Set([...(result.skills?.technical || []), ...(enhanced.skills.technical || [])])],
                    soft: [...new Set([...(result.skills?.soft || []), ...(enhanced.skills.soft || [])])],
                    tools: [...new Set([...(result.skills?.tools || []), ...(enhanced.skills.tools || [])])]
                };
            }
            
            // Update employment with enhancements
            if (enhanced.employment_enhancements && result.employment) {
                for (const job of result.employment) {
                    const enhancement = enhanced.employment_enhancements.find(e => e.title === job.title);
                    if (enhancement) {
                        job.achievements = [...new Set([...(job.achievements || []), ...(enhancement.enhanced_achievements || [])])];
                        job.responsibilities = [...new Set([...(job.responsibilities || []), ...(enhancement.enhanced_responsibilities || [])])];
                    }
                }
            }
            
            // Update education
            if (enhanced.education_enhancements && result.education) {
                for (const edu of result.education) {
                    const enhancement = enhanced.education_enhancements.find(e => e.level === edu.level);
                    if (enhancement) {
                        edu.courses = [...new Set([...(edu.courses || []), ...(enhancement.enhanced_courses || [])])];
                        edu.achievements = [...new Set([...(edu.achievements || []), ...(enhancement.academic_achievements || [])])];
                    }
                }
            }
            
            // Update projects
            if (enhanced.projects_enhancements && result.projects) {
                for (const proj of result.projects) {
                    const enhancement = enhanced.projects_enhancements.find(p => p.name === proj.name);
                    if (enhancement && enhancement.enhanced_description) {
                        proj.description = enhancement.enhanced_description;
                    }
                }
            }
            
            // Add new achievements
            if (enhanced.achievements_enhanced) {
                result.achievements = [...new Set([...(result.achievements || []), ...enhanced.achievements_enhanced])];
            }
            
            // Add recommendations
            result.ai_recommendations = enhanced.recommendations || [];
            result.missing_sections = enhanced.missing_sections || [];
            result.ai_enhanced = true;
            result.enhancement_date = new Date().toISOString();
            
            // Save to history
            const clientId = result.personal?.email || result.personal?.full_name || 'unknown';
            this.analysisHistory[clientId] = {
                enhanced_at: new Date().toISOString(),
                enhancements_applied: {
                    summary: !!enhanced.professional_summary,
                    skills: !!enhanced.skills,
                    employment: enhanced.employment_enhancements?.length || 0,
                    education: enhanced.education_enhancements?.length || 0,
                    projects: enhanced.projects_enhancements?.length || 0
                },
                recommendations: enhanced.recommendations
            };
            this.saveAnalysisHistory();
            
            return result;
            
        } catch (error) {
            console.error('DeepSeek CV enhancement error:', error);
            return this.fallbackEnhanceCVData(rawCvData, vacancyData);
        }
    }

    fallbackEnhanceCVData(cvData, vacancyData) {
        const result = { ...cvData };
        
        // Generate fallback summary
        const employment = cvData.employment || [];
        const allSkills = [
            ...(cvData.skills?.technical || []),
            ...(cvData.skills?.soft || []),
            ...(cvData.skills?.tools || [])
        ];
        const totalYears = this.calculateTotalYears(employment);
        const primaryRole = employment[0]?.title || 'Professional';
        const topSkills = allSkills.slice(0, 4).join(', ');
        
        result.professional_summary = `Experienced ${primaryRole} with ${totalYears}+ years of expertise in ${topSkills}. Proven track record of delivering results and driving organizational growth.${vacancyData?.position ? ` Seeking ${vacancyData.position} position to leverage skills and make meaningful impact.` : ''}`;
        
        // Ensure skills are categorized
        if (!result.skills) result.skills = { technical: [], soft: [], tools: [] };
        
        // Add common skills if missing
        if (result.skills.technical.length < 3) {
            result.skills.technical.push('Problem Solving', 'Critical Thinking', 'Communication');
        }
        
        // Add basic achievements if missing
        if (result.employment) {
            for (const job of result.employment) {
                if (!job.achievements || job.achievements.length === 0) {
                    job.achievements = [`Successfully performed duties as ${job.title} at ${job.company || 'organization'}`];
                }
                if (!job.responsibilities || job.responsibilities.length === 0) {
                    job.responsibilities = [`Managed daily operations and contributed to team success`];
                }
            }
        }
        
        result.ai_enhanced = false;
        result.enhancement_method = 'fallback';
        return result;
    }

    // ============ PROFESSIONAL SUMMARY GENERATION ============
    
    async generateProfessionalSummary(cvData, vacancyData = null) {
        try {
            const personal = cvData.personal || {};
            const employment = cvData.employment || [];
            const education = cvData.education || [];
            const allSkills = [
                ...(cvData.skills?.technical || []),
                ...(cvData.skills?.soft || []),
                ...(cvData.skills?.tools || [])
            ];
            
            const totalYears = this.calculateTotalYears(employment);
            const topSkills = allSkills.slice(0, 8).join(', ');
            const currentRole = employment[0]?.title || 'Professional';
            const highestEdu = education[0] || {};
            
            const prompt = `Generate a powerful, professional CV summary (3-4 sentences) for:

Candidate Profile:
- Name: ${personal.full_name || 'Candidate'}
- Current/Recent Role: ${currentRole}
- Total Experience: ${totalYears} years
- Key Skills: ${topSkills}
- Education: ${highestEdu.level || ''} ${highestEdu.field || ''}
- Industry: ${this.detectIndustry(cvData)}
${vacancyData?.position ? `- Target Position: ${vacancyData.position} at ${vacancyData.company || 'company'}` : ''}

Requirements:
- Use confident, active language
- Highlight key achievements and value proposition
- Include relevant keywords for the industry
- Max 120 words

Return ONLY the summary text, no explanations.`;

            const response = await this.deepseek.chat.completions.create({
                model: 'deepseek-chat',
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.7,
                max_tokens: 300
            });
            
            return response.choices[0].message.content.trim();
            
        } catch (error) {
            console.error('Summary generation error:', error);
            return this.fallbackSummary(cvData, vacancyData);
        }
    }

    fallbackSummary(cvData, vacancyData) {
        const employment = cvData.employment || [];
        const allSkills = [
            ...(cvData.skills?.technical || []),
            ...(cvData.skills?.soft || []),
            ...(cvData.skills?.tools || [])
        ];
        const totalYears = this.calculateTotalYears(employment);
        const primaryRole = employment[0]?.title || 'professional';
        const topSkills = allSkills.slice(0, 4).join(', ');
        
        let summary = `Experienced ${primaryRole} with ${totalYears}+ years of expertise in ${topSkills}. `;
        summary += `Proven track record of delivering results and driving organizational growth. `;
        if (vacancyData?.position) {
            summary += `Seeking ${vacancyData.position} position to leverage skills and make meaningful impact.`;
        } else {
            summary += `Committed to excellence and continuous professional development.`;
        }
        return summary;
    }

    // ============ COMPLETE CV ANALYSIS AGAINST VACANCY ============
    
    async analyzeCVAgainstVacancy(cvData, vacancyData) {
        if (!vacancyData || !vacancyData.has_vacancy) {
            return { match_score: null, message: "No vacancy data provided for analysis" };
        }
        
        try {
            const allSkills = [
                ...(cvData.skills?.technical || []),
                ...(cvData.skills?.soft || []),
                ...(cvData.skills?.tools || [])
            ];
            
            const prompt = `You are an expert recruitment analyst. Compare the candidate's CV against the job vacancy.

CANDIDATE CV:
- Skills: ${JSON.stringify(allSkills)}
- Experience: ${JSON.stringify(cvData.employment?.map(j => ({ title: j.title, company: j.company, years: j.duration })))}
- Education: ${JSON.stringify(cvData.education?.map(e => ({ level: e.level, field: e.field })))}
- Certifications: ${JSON.stringify(cvData.certifications?.map(c => c.name))}
- Languages: ${JSON.stringify(cvData.languages?.map(l => l.name))}
- Projects: ${cvData.projects?.length || 0} projects

JOB VACANCY:
- Position: ${vacancyData.position}
- Company: ${vacancyData.company}
- Requirements: ${JSON.stringify(vacancyData.requirements || [])}
- Responsibilities: ${JSON.stringify(vacancyData.responsibilities || [])}
- Experience Required: ${vacancyData.experience_required || 'Not specified'}
- Education Required: ${vacancyData.education_required || 'Not specified'}

Return a detailed analysis as JSON:
{
  "match_score": 0-100,
  "skill_match_percentage": 0-100,
  "experience_match": "assessment",
  "education_match": "assessment",
  "strengths": ["strength1", "strength2", ...],
  "gaps": ["gap1", "gap2", ...],
  "recommendation": "hiring recommendation",
  "suggested_interview_questions": ["question1", "question2", "question3"],
  "improvement_suggestions": ["suggestion1", "suggestion2"]
}

Return ONLY valid JSON.`;

            const response = await this.deepseek.chat.completions.create({
                model: 'deepseek-chat',
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.2,
                max_tokens: 1500,
                response_format: { type: 'json_object' }
            });

            const analysis = JSON.parse(response.choices[0].message.content);
            
            // Save analysis to history
            const clientId = cvData.personal?.email || cvData.personal?.full_name || 'unknown';
            this.analysisHistory[`${clientId}_vacancy_${Date.now()}`] = {
                vacancy: vacancyData.position,
                match_score: analysis.match_score,
                strengths: analysis.strengths,
                gaps: analysis.gaps,
                analyzed_at: new Date().toISOString()
            };
            this.saveAnalysisHistory();
            
            return {
                ...analysis,
                analyzed_at: new Date().toISOString(),
                vacancy_position: vacancyData.position,
                vacancy_company: vacancyData.company
            };
            
        } catch (error) {
            console.error('DeepSeek vacancy analysis error:', error);
            return this.fallbackAnalysis(cvData, vacancyData);
        }
    }

    fallbackAnalysis(cvData, vacancyData) {
        const allSkills = [
            ...(cvData.skills?.technical || []),
            ...(cvData.skills?.soft || []),
            ...(cvData.skills?.tools || [])
        ].map(s => s.toLowerCase());
        
        const requirements = (vacancyData.requirements || []).map(r => r.toLowerCase());
        
        let matches = 0;
        for (const req of requirements) {
            for (const skill of allSkills) {
                if (skill.includes(req) || req.includes(skill)) {
                    matches++;
                    break;
                }
            }
        }
        
        const matchScore = requirements.length > 0 ? Math.round((matches / requirements.length) * 100) : 50;
        
        return {
            match_score: matchScore,
            skill_match_percentage: matchScore,
            experience_match: matchScore >= 70 ? "Good match" : "Needs review",
            education_match: "Meets requirements",
            strengths: allSkills.slice(0, 5),
            gaps: requirements.filter(r => !allSkills.some(s => s.includes(r) || r.includes(s))).slice(0, 5),
            recommendation: matchScore >= 70 ? "Strong candidate, recommend interview" : "Consider with additional screening",
            suggested_interview_questions: [
                "Why are you interested in this role?",
                "Describe your most relevant achievement.",
                "How do you handle challenges at work?"
            ],
            improvement_suggestions: ["Add more quantifiable achievements", "Tailor CV to highlight relevant skills"],
            analyzed_at: new Date().toISOString(),
            method: "fallback"
        };
    }

    // ============ EXTRACT AND ANALYZE FROM DOCUMENT ============
    
    async extractAndAnalyze(fileUrl, fileName, documentGenerator, vacancyData = null) {
        try {
            // Step 1: Extract with DeepSeek
            const extraction = await documentGenerator.extractFullCVDataFromUrl(fileUrl, fileName);
            
            if (!extraction.success) {
                return { success: false, error: extraction.error };
            }
            
            // Step 2: Enhance the extracted data
            const enhancedCV = await this.enhanceCVData(extraction.data, vacancyData);
            
            // Step 3: Generate professional summary
            enhancedCV.professional_summary = await this.generateProfessionalSummary(enhancedCV, vacancyData);
            
            // Step 4: Analyze against vacancy if provided
            let analysis = null;
            if (vacancyData && vacancyData.has_vacancy) {
                analysis = await this.analyzeCVAgainstVacancy(enhancedCV, vacancyData);
            }
            
            // Step 5: Generate final CV
            const cvResult = await documentGenerator.generateCV(enhancedCV);
            
            return {
                success: true,
                extraction_summary: extraction.summary,
                enhanced_data: enhancedCV,
                analysis: analysis,
                cv_file: cvResult,
                extraction_method: extraction.method
            };
            
        } catch (error) {
            console.error('Extract and analyze error:', error);
            return { success: false, error: error.message };
        }
    }

    // ============ COMPLETE SKILLS ENHANCEMENT ============
    
    async enhanceSkills(skillsData, industry = null) {
        try {
            const prompt = `Enhance this skills list for a ${industry || 'professional'} role.

Current skills:
${JSON.stringify(skillsData, null, 2)}

Return enhanced skills as JSON:
{
  "technical": ["skill1", "skill2", ...],
  "soft": ["skill1", "skill2", ...],
  "tools": ["tool1", "tool2", ...],
  "certifications": ["cert1", "cert2", ...]
}

Add relevant industry-standard skills that are missing.
Return ONLY valid JSON.`;

            const response = await this.deepseek.chat.completions.create({
                model: 'deepseek-chat',
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.3,
                max_tokens: 1000,
                response_format: { type: 'json_object' }
            });

            return JSON.parse(response.choices[0].message.content);
            
        } catch (error) {
            console.error('Skills enhancement error:', error);
            return skillsData;
        }
    }

    // ============ ENHANCE EMPLOYMENT ACHIEVEMENTS ============
    
    async enhanceAchievements(jobTitle, jobCompany, currentAchievements = []) {
        try {
            const prompt = `Generate 3 powerful, metric-driven achievements for a ${jobTitle} at ${jobCompany || 'a company'}.

Current achievements (if any): ${JSON.stringify(currentAchievements)}

Return ONLY a JSON array of strings, each being an achievement statement.
Example: ["Increased efficiency by 25% through process optimization", "Led a team of 5 to deliver project ahead of schedule"]

Return ONLY valid JSON array.`;

            const response = await this.deepseek.chat.completions.create({
                model: 'deepseek-chat',
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.5,
                max_tokens: 500,
                response_format: { type: 'json_object' }
            });

            const achievements = JSON.parse(response.choices[0].message.content);
            return Array.isArray(achievements) ? achievements : [];
            
        } catch (error) {
            console.error('Achievement enhancement error:', error);
            return [
                `Successfully performed duties as ${jobTitle}`,
                `Contributed to team success and organizational goals`,
                `Maintained high standards of quality and efficiency`
            ];
        }
    }

    // ============ EXTRACT CLIENT INFO FROM DOCUMENT ============
    
    async extractFromDocument(fileUrl, fileName, documentGenerator) {
        try {
            const result = await documentGenerator.extractFullCVDataFromUrl(fileUrl, fileName);
            
            if (!result.success || !result.data) {
                return this.getDefaultExtraction();
            }
            
            const data = result.data;
            const allSkills = [
                ...(data.skills?.technical || []),
                ...(data.skills?.soft || []),
                ...(data.skills?.tools || [])
            ];
            
            return {
                success: true,
                client_name: data.personal?.full_name || null,
                client_email: data.personal?.email || null,
                client_phone: data.personal?.primary_phone || data.personal?.phone || null,
                client_alternative_phone: data.personal?.alternative_phone || null,
                client_whatsapp: data.personal?.whatsapp_phone || null,
                client_location: data.personal?.location || null,
                client_address: data.personal?.physical_address || null,
                client_nationality: data.personal?.nationality || null,
                position: data.personal?.professional_title || null,
                company: data.employment?.[0]?.company || null,
                skills: allSkills,
                skills_categorized: data.skills || {},
                experience_years: this.calculateTotalYears(data.employment || []),
                education_level: data.education?.[0]?.level || null,
                education_field: data.education?.[0]?.field || null,
                certifications: data.certifications || [],
                languages: data.languages || [],
                projects_count: data.projects?.length || 0,
                achievements_count: data.achievements?.length || 0,
                referees_count: data.referees?.length || 0,
                extraction_method: result.method || 'unknown',
                raw_data: data,
                summary: result.summary
            };
        } catch (error) {
            console.error('Extract from document error:', error);
            return this.getDefaultExtraction();
        }
    }

    getDefaultExtraction() {
        return {
            success: false,
            client_name: null,
            client_email: null,
            client_phone: null,
            client_location: null,
            skills: [],
            experience_years: 0,
            education_level: null,
            error: "Could not extract data"
        };
    }

    // ============ EXTRACT VACANCY FROM FILE ============
    
    async extractVacancyFromFile(fileUrl, fileName, documentGenerator) {
        try {
            return await documentGenerator.extractVacancyFromFile(fileUrl, fileName);
        } catch (error) {
            console.error('Vacancy extraction error:', error);
            return { has_vacancy: false, error: error.message };
        }
    }

    // ============ UTILITY METHODS ============
    
    calculateTotalYears(employment) {
        let total = 0;
        for (const job of employment) {
            const duration = job.duration || '';
            const match = duration.match(/(\d+)/);
            if (match) total += parseInt(match[1]);
        }
        return Math.max(total, 1);
    }

    detectIndustry(cvData) {
        const allText = [
            ...(cvData.employment?.map(j => `${j.title} ${j.company}`) || []),
            ...(cvData.skills?.technical || []),
            ...(cvData.skills?.soft || []),
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

    getAnalysisHistory(clientId = null) {
        if (clientId) {
            return this.analysisHistory[clientId] || null;
        }
        return this.analysisHistory;
    }

    clearAnalysisHistory() {
        this.analysisHistory = {};
        this.saveAnalysisHistory();
    }
}

module.exports = new AIAnalyzer();