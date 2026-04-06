// bot.js - Complete EasySuccor Telegram Bot with Smart Draft Upload
const { Telegraf, Markup } = require('telegraf');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const db = require('./database');
const payment = require('./payment');
const notificationService = require('./notification-service');
const documentGenerator = require('./document-generator');
const aiAnalyzer = require('./ai-analyzer');
const InstallmentTracker = require('./installment-tracker');
const ReferralTracker = require('./referral-tracker');
const express = require('express');

dotenv.config();

// ============ EXPRESS SERVER FOR ADMIN UPLOADS ============
const app = express();
const upload = multer({ dest: 'uploads/admin/' });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));  

// Admin authentication middleware
const adminAuth = (req, res, next) => {
    const apiKey = req.headers['x-admin-key'];
    if (apiKey !== process.env.ADMIN_API_KEY) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
};

// Admin upload endpoint for multiple files (auto-extracts client info)
app.post('/admin/upload-batch', adminAuth, upload.array('files', 20), async (req, res) => {
    try {
        const files = req.files;
        if (!files || files.length === 0) {
            return res.status(400).json({ error: 'No files uploaded' });
        }
        
        const results = [];
        for (const file of files) {
            try {
                // Extract all data from the document (including email, phone, location)
                const extractedData = await documentGenerator.extractFullCVData(file.path, 'cv');
                
                // Find or create client using extracted email
                let client = null;
                if (extractedData.data.personal?.email) {
                    client = await db.getClientByEmail(extractedData.data.personal.email);
                }
                
                if (!client) {
                    client = await db.createClient(
                        null,
                        null,
                        extractedData.data.personal?.full_name?.split(' ')[0] || 'Unknown',
                        extractedData.data.personal?.full_name?.split(' ').slice(1).join(' ') || ''
                    );
                    await db.updateClient(client.id, {
                        email: extractedData.data.personal?.email || null,
                        phone: extractedData.data.personal?.primary_phone || null,
                        location: extractedData.data.personal?.location || null,
                        is_legacy_client: true
                    });
                }
                
                // Convert to Aptos format
                const convertedCV = await documentGenerator.convertLegacyDocument(file.path, client.id, 'cv');
                
                await db.createOrder({
                    id: `LEGACY_${Date.now()}_${client.id}_${file.originalname}`,
                    client_id: client.id,
                    service: 'legacy_cv',
                    category: 'returningclient',
                    delivery_option: 'standard',
                    delivery_time: 'already_delivered',
                    base_price: 0,
                    delivery_fee: 0,
                    total_charge: 'MK0',
                    payment_status: 'completed',
                    cv_data: convertedCV,
                    certificates_appendix: null,
                    portfolio_links: '[]',
                    status: 'delivered'
                });
                
                results.push({
                    file: file.originalname,
                    success: true,
                    client_id: client.id,
                    client_name: extractedData.data.personal?.full_name,
                    extracted_email: extractedData.data.personal?.email
                });
            } catch (fileError) {
                results.push({
                    file: file.originalname,
                    success: false,
                    error: fileError.message
                });
            }
        }
        
        res.json({
            success: true,
            total: files.length,
            successful: results.filter(r => r.success).length,
            failed: results.filter(r => !r.success).length,
            results
        });
        
    } catch (error) {
        console.error('Batch upload error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Admin single file upload (backward compatible)
app.post('/admin/upload-cv', adminAuth, upload.single('cv_file'), async (req, res) => {
    try {
        const file = req.file;
        if (!file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }
        
        // Extract all data from the document (including email, phone, location)
        const extractedData = await documentGenerator.extractFullCVData(file.path, 'cv');
        
        // Find or create client using extracted email
        let client = null;
        if (extractedData.data.personal?.email) {
            client = await db.getClientByEmail(extractedData.data.personal.email);
        }
        
        if (!client) {
            client = await db.createClient(
                null,
                null,
                extractedData.data.personal?.full_name?.split(' ')[0] || 'Unknown',
                extractedData.data.personal?.full_name?.split(' ').slice(1).join(' ') || ''
            );
            await db.updateClient(client.id, {
                email: extractedData.data.personal?.email || null,
                phone: extractedData.data.personal?.primary_phone || null,
                location: extractedData.data.personal?.location || null,
                is_legacy_client: true
            });
        }
        
        // Convert to Aptos format
        const convertedCV = await documentGenerator.convertLegacyDocument(file.path, client.id, 'cv');
        
        await db.createOrder({
            id: `LEGACY_${Date.now()}_${client.id}`,
            client_id: client.id,
            service: 'legacy_cv',
            category: 'returningclient',
            delivery_option: 'standard',
            delivery_time: 'already_delivered',
            base_price: 0,
            delivery_fee: 0,
            total_charge: 'MK0',
            payment_status: 'completed',
            cv_data: convertedCV,
            certificates_appendix: null,
            portfolio_links: '[]',
            status: 'delivered'
        });
        
        res.json({
            success: true,
            message: `CV processed for ${extractedData.data.personal?.full_name || 'client'}`,
            client_id: client.id,
            extracted_data: {
                name: extractedData.data.personal?.full_name,
                email: extractedData.data.personal?.email,
                phone: extractedData.data.personal?.primary_phone,
                location: extractedData.data.personal?.location
            }
        });
        
    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({ error: error.message });
    }
});


app.post('/admin/upload-cover', adminAuth, upload.single('cover_file'), async (req, res) => {
    try {
        const { client_name, client_email, client_phone, client_location, position: formPosition, company: formCompany } = req.body;
        const file = req.file;
        
        if (!file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }
                // Extract information from file using AI analyzer
        const fileUrl = `/uploads/${file.filename}`;
        const extractedData = await aiAnalyzer.extractFromDocument(fileUrl, file.originalname);
        
        // Use extracted data or manual override
        const clientName = manualName || extractedData.client_name || 'Unknown Client';
        const clientEmail = extractedData.client_email || null;
        const clientPhone = extractedData.client_phone || null;
        const clientLocation = extractedData.client_location || null;
        const position = extractedData.position || formPosition || 'Unknown Position';
        const company = extractedData.company || formCompany || 'Unknown Company';
        
        // Get or create client
        let client;
        if (clientEmail) {
            client = await db.getClientByEmail(clientEmail);
        }
        if (!client && clientPhone) {
            client = await db.getClientByPhone(clientPhone);
        }
        if (!client) {
            client = await db.createClient(
                null, null,
                clientName.split(' ')[0],
                clientName.split(' ').slice(1).join(' ')
            );
            await db.updateClient(client.id, {
                email: clientEmail,
                phone: clientPhone,
                location: clientLocation,
                is_legacy_client: true
            });
        }
        
        // Convert legacy cover letter to Aptos format
        const convertedCover = await documentGenerator.convertLegacyDocument(file.path, client.id, 'cover_letter');
        
        await db.createOrder({
            id: `LEGACY_CL_${Date.now()}_${client.id}`,
            client_id: client.id,
            service: 'legacy_cover_letter',
            category: 'returningclient',
            delivery_option: 'standard',
            delivery_time: 'already_delivered',
            base_price: 0,
            delivery_fee: 0,
            total_charge: 'MK0',
            payment_status: 'completed',
            cv_data: { cover_letter: convertedCover },
            status: 'delivered'
        });
        
        res.json({ 
            success: true, 
            message: `Cover letter for ${client_name} uploaded and converted successfully`,
            client_id: client.id 
        });
        
    } catch (error) {
        console.error('Cover letter upload error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

const HEALTH_PORT = process.env.PORT || 3000;
app.listen(HEALTH_PORT, () => {
    console.log(`🏥 Admin upload server: http://localhost:${HEALTH_PORT}`);
    console.log(`📤 Upload endpoints: POST /admin/upload-cv, POST /admin/upload-batch`);
    console.log(`🔑 Admin API Key required in header: x-admin-key`);
});

// ============ TELEGRAM BOT ============
const bot = new Telegraf(process.env.BOT_TOKEN);

// ============ SMART DRAFT PROCESSOR ============
class SmartDraftProcessor {
    async processDraftUpload(ctx, client, session, fileUrl, fileName) {
        // Extract all data from the uploaded draft
        const extractedData = await documentGenerator.extractFullCVDataFromUrl(fileUrl, fileName);
        
        if (!extractedData.success) {
            await ctx.reply(`❌ Could not extract data from your file. Please try again or choose manual entry.`);
            return false;
        }
        
        const cvData = extractedData.data;
        
        // Identify missing sections
        const missingSections = this.identifyMissingSections(cvData);
        
        // Store extracted data in session
        session.data.cv_data = cvData;
        session.data.is_draft_upload = true;
        session.data.missing_sections = missingSections;
        session.data.current_missing_index = 0;
        
        // Show what was found and what's missing
        let foundMessage = `📄 *Draft Processed Successfully!*\n\n`;
        foundMessage += `✅ *Found:*\n`;
        foundMessage += `• Name: ${cvData.personal?.full_name || 'Not found'}\n`;
        foundMessage += `• Email: ${cvData.personal?.email || 'Not found'}\n`;
        foundMessage += `• Phone: ${cvData.personal?.primary_phone || 'Not found'}\n`;
        foundMessage += `• Location: ${cvData.personal?.location || 'Not found'}\n`;
        foundMessage += `• Work Experience: ${cvData.employment?.length || 0} entries\n`;
        foundMessage += `• Education: ${cvData.education?.length || 0} entries\n`;
        foundMessage += `• Skills: ${cvData.skills?.length || 0} skills\n`;
        foundMessage += `• Certifications: ${cvData.certifications?.length || 0}\n`;
        foundMessage += `• Languages: ${cvData.languages?.length || 0}\n`;
        
        if (missingSections.length > 0) {
            foundMessage += `\n⚠️ *Missing:* ${missingSections.join(', ')}\n\n`;
            foundMessage += `Let's fill in the missing information.`;
            await ctx.reply(foundMessage);
            
            // Start collecting missing sections
            await this.collectNextMissingSection(ctx, client, session);
        } else {
            foundMessage += `\n🎉 *Complete!* Your draft has everything needed.\n\n`;
            foundMessage += `Proceed to payment? Type /pay to continue.`;
            await ctx.reply(foundMessage);
            session.data.cv_complete = true;
            await db.updateSession(session.id, 'awaiting_payment_choice', 'payment', session.data);
        }
        
        return true;
    }
    
    identifyMissingSections(cvData) {
        const missing = [];
        if (!cvData.personal?.full_name) missing.push('Full Name');
        if (!cvData.personal?.email) missing.push('Email');
        if (!cvData.personal?.primary_phone) missing.push('Phone');
        if (!cvData.personal?.location) missing.push('Location');
        if (!cvData.professional_summary) missing.push('Professional Summary');
        if (!cvData.employment || cvData.employment.length === 0) missing.push('Work Experience');
        if (!cvData.education || cvData.education.length === 0) missing.push('Education');
        if (!cvData.skills || cvData.skills.length === 0) missing.push('Skills');
        if (!cvData.referees || cvData.referees.length < 2) missing.push('Referees');
        return missing;
    }
    
    async collectNextMissingSection(ctx, client, session) {
        const missing = session.data.missing_sections;
        const index = session.data.current_missing_index || 0;
        
        if (index >= missing.length) {
            // All missing sections collected
            await ctx.reply(`✅ *All information collected!*\n\nProceed to payment? Type /pay to continue.`);
            session.data.cv_complete = true;
            await db.updateSession(session.id, 'awaiting_payment_choice', 'payment', session.data);
            return;
        }
        
        const section = missing[index];
        session.data.current_section = section;
        
        const prompts = {
            'Full Name': "What's your full name? 📛",
            'Email': "What's your email address? 📧",
            'Phone': "What's your phone number? 📞",
            'Location': "Where are you located? 📍",
            'Professional Summary': "Please provide a brief professional summary (2-3 sentences) ✍️",
            'Work Experience': "Let's add your work experience. Most recent job title? 💼",
            'Education': "What's your highest qualification? 🎓",
            'Skills': "List your key skills (comma separated) ⚡",
            'Referees': "Please provide at least 2 professional referees. First referee - Full name? 👥"
        };
        
        await ctx.reply(prompts[section] || `Please provide your ${section.toLowerCase()}:`);
        await db.updateSession(session.id, 'collecting_missing', 'missing', session.data);
    }
    
    async handleMissingCollection(ctx, client, session, text, callbackData = null) {
        const section = session.data.current_section;
        const cvData = session.data.cv_data;
        
        switch(section) {
            case 'Full Name':
                cvData.personal = cvData.personal || {};
                cvData.personal.full_name = text;
                break;
            case 'Email':
                cvData.personal = cvData.personal || {};
                cvData.personal.email = text;
                break;
            case 'Phone':
                cvData.personal = cvData.personal || {};
                cvData.personal.primary_phone = text;
                break;
            case 'Location':
                cvData.personal = cvData.personal || {};
                cvData.personal.location = text;
                break;
            case 'Professional Summary':
                cvData.professional_summary = text;
                break;
            case 'Work Experience':
                if (!cvData.employment) cvData.employment = [];
                if (!session.data.temp_job) session.data.temp_job = {};
                const step = session.data.work_step || 'title';
                if (step === 'title') {
                    session.data.temp_job.title = text;
                    session.data.work_step = 'company';
                    await ctx.reply("Company name? 🏢");
                    return;
                } else if (step === 'company') {
                    session.data.temp_job.company = text;
                    session.data.work_step = 'duration';
                    await ctx.reply("Duration? (e.g., Jan 2020 - Present) 📅");
                    return;
                } else if (step === 'duration') {
                    session.data.temp_job.duration = text;
                    session.data.work_step = 'responsibilities';
                    session.data.temp_job.responsibilities = [];
                    await ctx.reply("Key responsibilities? One per line. Type DONE when finished.");
                    return;
                } else if (step === 'responsibilities') {
                    if (text.toUpperCase() !== 'DONE') {
                        session.data.temp_job.responsibilities.push(text);
                        await ctx.reply(`✓ Added. Another? (type DONE when done)`);
                        return;
                    } else {
                        cvData.employment.push(session.data.temp_job);
                        session.data.temp_job = null;
                        session.data.work_step = null;
                        await ctx.reply(`✓ Work experience added. Another job?`, {
                            reply_markup: { inline_keyboard: [[{ text: "✅ Yes", callback_data: "more_work_yes" }, { text: "❌ No", callback_data: "more_work_no" }]] }
                        });
                        return;
                    }
                }
                break;
            case 'Education':
                if (!cvData.education) cvData.education = [];
                if (!session.data.temp_edu) session.data.temp_edu = {};
                const eduStep = session.data.edu_step || 'level';
                if (eduStep === 'level') {
                    session.data.temp_edu.level = text;
                    session.data.edu_step = 'field';
                    await ctx.reply("Field of study? 📚");
                    return;
                } else if (eduStep === 'field') {
                    session.data.temp_edu.field = text;
                    session.data.edu_step = 'institution';
                    await ctx.reply("Institution? 🏛️");
                    return;
                } else if (eduStep === 'institution') {
                    session.data.temp_edu.institution = text;
                    session.data.edu_step = 'year';
                    await ctx.reply("Year of completion? 📅");
                    return;
                } else if (eduStep === 'year') {
                    session.data.temp_edu.year = text;
                    cvData.education.push(session.data.temp_edu);
                    session.data.temp_edu = null;
                    session.data.edu_step = null;
                    await ctx.reply(`✓ Education added. Another qualification?`, {
                        reply_markup: { inline_keyboard: [[{ text: "✅ Yes", callback_data: "more_edu_yes" }, { text: "❌ No", callback_data: "more_edu_no" }]] }
                    });
                    return;
                }
                break;
            case 'Skills':
                cvData.skills = text.split(',').map(s => s.trim());
                break;
            case 'Referees':
                if (!cvData.referees) cvData.referees = [];
                if (!session.data.temp_ref) session.data.temp_ref = {};
                const refStep = session.data.ref_step || 'name';
                if (refStep === 'name') {
                    session.data.temp_ref.name = text;
                    session.data.ref_step = 'position';
                    await ctx.reply("Their position? 📌");
                    return;
                } else if (refStep === 'position') {
                    session.data.temp_ref.position = text;
                    session.data.ref_step = 'contact';
                    await ctx.reply("Their contact? (phone or email) 📞");
                    return;
                } else if (refStep === 'contact') {
                    session.data.temp_ref.contact = text;
                    cvData.referees.push(session.data.temp_ref);
                    session.data.temp_ref = null;
                    session.data.ref_step = null;
                    if (cvData.referees.length < 2) {
                        await ctx.reply(`✓ Referee added. Need ${2 - cvData.referees.length} more. Next referee - Full name?`);
                        return;
                    } else {
                        await ctx.reply(`✓ ${cvData.referees.length} referees added. Another?`, {
                            reply_markup: { inline_keyboard: [[{ text: "✅ Yes", callback_data: "more_ref_yes" }, { text: "❌ No", callback_data: "more_ref_no" }]] }
                        });
                        return;
                    }
                }
                break;
        }
        
        // Move to next missing section
        session.data.current_missing_index = (session.data.current_missing_index || 0) + 1;
        await this.collectNextMissingSection(ctx, client, session);
        await db.updateSession(session.id, 'collecting_missing', 'missing', session.data);
    }
}

const smartDraft = new SmartDraftProcessor();

// ============ CV VERSIONING SYSTEM ============
class CVVersioning {
    async saveVersion(orderId, cvData, versionNumber, changes) {
        await db.saveCVVersion(orderId, versionNumber, cvData, changes);
    }
    async getVersions(orderId) {
        return await db.getCVVersions(orderId);
    }
    async revertToVersion(orderId, versionNumber) {
        const version = await db.getCVVersion(orderId, versionNumber);
        if (version) {
            await db.updateOrderCVData(orderId, version.cv_data);
            return version.cv_data;
        }
        return null;
    }
    formatVersionHistory(versions) {
        if (!versions || versions.length === 0) return "No version history available.";
        let message = "📁 *YOUR CV HISTORY*\n\n";
        for (const v of versions) {
            const currentMarker = v.is_current ? " (Current)" : "";
            message += `v${v.version_number}${currentMarker} - ${new Date(v.created_at).toLocaleDateString()} - ${v.changes || 'Update'}\n`;
        }
        message += `\nWould you like to revert to a previous version? Type /revert VERSION_NUMBER`;
        return message;
    }
}

const cvVersioning = new CVVersioning();

// ============ PORTFOLIO COLLECTION ============
class PortfolioCollector {
    async askForPortfolio(ctx) {
        await ctx.reply(`📎 *Portfolio Items (Optional)*

Would you like to include links to your work?

• GitHub repositories
• Behance/Dribbble portfolio
• Personal website
• Case studies

*Why this matters:* Employers love seeing real work examples!

Type your portfolio links (one per line) or type 'SKIP' to continue.`);
    }
    parsePortfolioLinks(text) {
        if (text.toLowerCase() === 'skip') return [];
        return text.split('\n').filter(line => line.trim().startsWith('http'));
    }
}

const portfolioCollector = new PortfolioCollector();

// ============ SOCIAL PROOF ============
const SOCIAL_PROOF = [
    { rating: 5, text: "Got the job at my dream company! The CV was perfect.", name: "Sarah M." },
    { rating: 5, text: "CV landed me 3 interviews in one week.", name: "James K." },
    { rating: 5, text: "Professional and fast! Worth every kwacha.", name: "Peter C." }
];

function getRandomSocialProof() {
    const random = SOCIAL_PROOF[Math.floor(Math.random() * SOCIAL_PROOF.length)];
    return `📢 *What our clients say:*\n\n⭐️⭐️⭐️⭐️⭐️ "${random.text}" - ${random.name}`;
}

// ============ DYNAMIC RESPONSES ============
const RESPONSES = {
    greetings: [
        (name) => `👋 Welcome ${name}! I'm EasySuccor Bot.`,
        (name) => `Hey ${name}! Ready to create your professional CV?`,
        (name) => `✨ ${name}! Let's build your career story.`
    ],
    encouragements: {
        start: ["Great choice! 🎯", "Let's do this! 💪", "Excellent! ✨"],
        progress: [(p) => `${p}% done! You're making progress! 🔥`],
        sectionComplete: [(s) => `✓ ${s} complete! Moving on. 🎯`],
        final: [(n) => `🎉 All done, ${n}! Your document is ready!`]
    },
    questions: {
        name: ["What's your full name? 📛"],
        email: ["Email address? 📧"],
        phone: ["Phone number? (Employers call this) 📞"],
        location: ["Where are you based? 📍"],
        summary: ["Tell me about yourself (2-3 sentences) ✍️"],
        education: ["Highest qualification? 🎓"],
        jobTitle: ["Most recent job title? 💼"],
        skills: ["List your key skills (comma separated) ⚡"]
    },
    reactions: { positive: ["Love it! 💯", "Got it! 🎯", "Perfect! ✨"], funny: ["Nice! 😄", "Awesome! 🎉"] },
    help: ["Need help? Just type what I ask for. Type /pause to save progress."]
};

function random(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function getGreeting(name) { return random(RESPONSES.greetings)(name); }
function getQuestion(type) { return random(RESPONSES.questions[type]); }
function getReaction() { return random([...RESPONSES.reactions.positive, ...RESPONSES.reactions.funny]); }

const yesWords = ['yes', 'yeah', 'yep', 'sure', 'ok', 'y'];
function isAffirmative(text) { return yesWords.some(w => text.toLowerCase().includes(w)); }

// ============ PRICES ============
const PRICES = {
    student: { cv: 6000, editable_cv: 8000, editable_cover: 8000, update: 3000, cover: 5000 },
    recent: { cv: 8000, editable_cv: 10000, editable_cover: 8000, update: 4000, cover: 5000 },
    professional: { cv: 10000, editable_cv: 12000, editable_cover: 8000, update: 6000, cover: 6000 },
    nonworking: { cv: 8000, editable_cv: 10000, editable_cover: 8000, update: 5000, cover: 5000 },
    returning: { editable_cv: 10000, editable_cover: 8000, update: 5000, cover: 5000 }
};

const DELIVERY_PRICES = { standard: 0, express: 3000, rush: 5000 };
const DELIVERY_TIMES = { standard: '6 hours', express: '2 hours', rush: '1 hour' };

function formatPrice(amount) { return `MK${amount.toLocaleString()}`; }
function getBasePrice(category, service) {
    const catKey = { student: 'student', recentgraduate: 'recent', professional: 'professional', nonworkingprofessional: 'nonworking', returningclient: 'returning' }[category] || 'professional';
    const serviceKey = { 'new cv': 'cv', 'editable cv': 'editable_cv', 'editable cover letter': 'editable_cover', 'cv update': 'update', 'cover letter': 'cover' }[service] || 'cv';
    return PRICES[catKey][serviceKey] || 0;
}
function calculateTotal(category, service, delivery) { return getBasePrice(category, service) + DELIVERY_PRICES[delivery]; }

// ============ DATABASE HELPERS ============
async function getOrCreateClient(ctx) {
    let client = await db.getClient(ctx.from.id);
    if (!client) client = await db.createClient(ctx.from.id, ctx.from.username, ctx.from.first_name, ctx.from.last_name);
    return client;
}

async function getOrCreateSession(clientId) {
    let session = await db.getActiveSession(clientId);
    if (!session) {
        await db.saveSession(clientId, 'greeting', null, {});
        session = await db.getActiveSession(clientId);
    }
    if (!session.data) session.data = {};
    if (typeof session.data === 'string') { try { session.data = JSON.parse(session.data); } catch(e) { session.data = {}; } }
    if (!session.data.services) session.data.services = [];
    return session;
}

// ============ PERSISTENT KEYBOARD ============
const mainMenuKeyboard = Markup.keyboard([
    [Markup.button.text("📄 New CV"), Markup.button.text("📝 Editable CV")],
    [Markup.button.text("💌 Cover Letter"), Markup.button.text("✏️ Update CV")],
    [Markup.button.text("📎 Upload Draft"), Markup.button.text("ℹ️ About")],
    [Markup.button.text("📞 Contact"), Markup.button.text("🏠 Portal")]
]).resize().persistent();

// ============ CORE HANDLERS ============
async function handleGreeting(ctx, client, session) {
    const name = ctx.from.first_name;
    
    // Check if returning client with existing CV
    const existingOrders = await db.getClientOrders(client.id);
    const hasExistingCV = existingOrders.some(o => o.service === 'new cv' || o.service === 'legacy_cv');
    
    if (hasExistingCV) {
        await ctx.reply(`🎉 Welcome back, ${name}! 

*What would you like to do?*

📄 *New CV* - Fresh CV
📝 *Editable CV* - Get Word format
✏️ *Update CV* - Update specific sections
💌 *Cover Letter* - New cover letter
📎 *Upload Draft* - Upload existing CV/cover letter

Use the buttons below:`, mainMenuKeyboard);
        session.data.is_returning = true;
        await db.updateSession(session.id, 'main_menu', null, session.data);
        return;
    }
    
    // New client - show full menu with draft upload option
    await ctx.reply(`${getGreeting(name)}

${getRandomSocialProof()}

*Choose an option below:*

📄 *New CV* - Build from scratch
📎 *Upload Draft* - Upload existing CV/cover letter

Type /help for more info.`, mainMenuKeyboard);
    await db.updateSession(session.id, 'main_menu', null, session.data);
}

async function handleMainMenu(ctx, client, session, text) {
    if (text === '📄 New CV') {
        session.data.service = 'new cv';
        session.data.build_method = 'from_scratch';
        await showCategorySelection(ctx, session);
    } else if (text === '📝 Editable CV') {
        session.data.service = 'editable cv';
        session.data.build_method = 'from_scratch';
        await showCategorySelection(ctx, session);
    } else if (text === '💌 Cover Letter') {
        await handleCoverLetterStart(ctx, client, session);
    } else if (text === '✏️ Update CV') {
        session.data.service = 'cv update';
        await handleUpdateFlow(ctx, client, session);
    } else if (text === '📎 Upload Draft') {
        await ctx.reply(`📎 *Upload Your Draft*

Send me your existing CV or cover letter (PDF, DOCX, or image).

I'll extract all the information and only ask for what's missing!

*Supported formats:* PDF, DOCX, JPG, PNG`);
        session.data.awaiting_draft_upload = true;
        await db.updateSession(session.id, 'awaiting_draft_upload', 'draft', session.data);
    } else if (text === 'ℹ️ About') {
        await ctx.reply(`📄 *EasySuccor - Professional CVs*

Contact: +265 991 295 401
WhatsApp: +265 881 193 707

*Services:*
• New CV - MK6,000 - MK10,000
• Editable CV - MK8,000 - MK12,000
• Cover Letter - MK5,000 - MK6,000
• CV Update - MK3,000 - MK6,000

*Delivery:* 6h (Standard), 2h (+3k), 1h (+5k)`);
    } else if (text === '📞 Contact') {
        await ctx.reply(`📞 *Contact*

Airtel: 0991295401
Mpamba: 0886928639
Visa: 1005653618 (NBM)
WhatsApp: +265 881 193 707`);
    } else if (text === '🏠 Portal') {
        await showClientPortal(ctx, client);
    } else {
        await ctx.reply(random(RESPONSES.help), mainMenuKeyboard);
    }
}

async function showCategorySelection(ctx, session) {
    await ctx.reply(`Select your category:`, {
        reply_markup: { inline_keyboard: [
            [{ text: "🎓 Student - Currently in school", callback_data: "cat_student" }],
            [{ text: "📜 Recent Graduate - Graduated <2 years", callback_data: "cat_recent" }],
            [{ text: "💼 Professional - Currently employed", callback_data: "cat_professional" }],
            [{ text: "🌱 Non-Working - Career break", callback_data: "cat_nonworking" }],
            [{ text: "🔄 Returning Client - Used us before", callback_data: "cat_returning" }]
        ] }
    });
    await db.updateSession(session.id, 'selecting_category', null, session.data);
}

async function handleCategorySelection(ctx, client, session, data) {
    const categoryMap = {
        cat_student: 'student', cat_recent: 'recentgraduate',
        cat_professional: 'professional', cat_nonworking: 'nonworkingprofessional',
        cat_returning: 'returningclient'
    };
    session.data.category = categoryMap[data];
    
    // Show service selection
    let serviceButtons;
    if (session.data.category === 'returningclient') {
        serviceButtons = [
            [{ text: "📝 Editable CV", callback_data: "service_editable" }],
            [{ text: "✏️ Update CV", callback_data: "service_update" }],
            [{ text: "💌 Cover Letter", callback_data: "service_cover" }],
            [{ text: "📎 Editable Cover Letter", callback_data: "service_editable_cover" }]
        ];
    } else {
        serviceButtons = [
            [{ text: "📄 New CV", callback_data: "service_new" }],
            [{ text: "📝 Editable CV", callback_data: "service_editable" }],
            [{ text: "💌 Cover Letter", callback_data: "service_cover" }],
            [{ text: "📎 Editable Cover Letter", callback_data: "service_editable_cover" }]
        ];
    }
    
    await ctx.reply(`Choose your service:`, { reply_markup: { inline_keyboard: serviceButtons } });
    await db.updateSession(session.id, 'selecting_service', null, session.data);
}

async function handleServiceSelection(ctx, client, session, data) {
    const serviceMap = {
        service_new: 'new cv', service_editable: 'editable cv',
        service_cover: 'cover letter', service_editable_cover: 'editable cover letter',
        service_update: 'cv update'
    };
    session.data.service = serviceMap[data];
    
    if (session.data.service === 'cv update') {
        await handleUpdateFlow(ctx, client, session);
        return;
    }
    
    // Show delivery options
    const basePrice = getBasePrice(session.data.category || 'professional', session.data.service);
    session.data.base_price = basePrice;
    
    await ctx.reply(`Base price: ${formatPrice(basePrice)}\n\nDelivery speed?`, {
        reply_markup: { inline_keyboard: [
            [{ text: "🚚 Standard (6h)", callback_data: "delivery_standard" }],
            [{ text: "⚡ Express (2h) +3k", callback_data: "delivery_express" }],
            [{ text: "🏃 Rush (1h) +5k", callback_data: "delivery_rush" }]
        ] }
    });
    await db.updateSession(session.id, 'selecting_delivery', null, session.data);
}

async function handleDeliverySelection(ctx, client, session, data) {
    const delivery = { delivery_standard: 'standard', delivery_express: 'express', delivery_rush: 'rush' }[data];
    session.data.delivery_option = delivery;
    session.data.delivery_time = DELIVERY_TIMES[delivery];
    const totalAmount = calculateTotal(session.data.category || 'professional', session.data.service, delivery);
    session.data.total_charge = formatPrice(totalAmount);
    
    if (session.data.build_method === 'from_scratch') {
        await portfolioCollector.askForPortfolio(ctx);
        await db.updateSession(session.id, 'collecting_portfolio', 'portfolio', session.data);
    } else {
        await finalizeOrder(ctx, client, session);
    }
}

async function handlePortfolioCollection(ctx, client, session, text) {
    session.data.portfolio_links = portfolioCollector.parsePortfolioLinks(text);
    await ctx.reply(`${getReaction()} ${session.data.portfolio_links.length > 0 ? 'Portfolio saved!' : 'No portfolio added.'}\n\nNow let's collect your details.\n\n${getQuestion('name')}`);
    await startDataCollection(ctx, client, session);
}

async function startDataCollection(ctx, client, session) {
    session.data.cv_data = {
        personal: {}, professional_summary: '', education: [], employment: [], skills: [],
        certifications: [], languages: [], referees: [], portfolio: session.data.portfolio_links || []
    };
    session.current_section = 'personal';
    session.data.collection_step = 'name';
    await db.updateSession(session.id, 'collecting_personal', 'personal', session.data);
}

async function handlePersonalCollection(ctx, client, session, text) {
    const step = session.data.collection_step;
    const personal = session.data.cv_data.personal;
    
    if (step === 'name') { personal.full_name = text; session.data.collection_step = 'email'; await ctx.reply(getQuestion('email')); }
    else if (step === 'email') { personal.email = text; session.data.collection_step = 'phone'; await ctx.reply(getQuestion('phone')); }
    else if (step === 'phone') { personal.primary_phone = text; session.data.collection_step = 'alt_phone'; await ctx.reply("Alternative phone? (or 'Skip')"); }
    else if (step === 'alt_phone') { personal.alternative_phone = text === 'Skip' ? null : text; session.data.collection_step = 'whatsapp'; await ctx.reply("WhatsApp for delivery? (or 'Same')"); }
    else if (step === 'whatsapp') { personal.whatsapp_phone = text === 'Same' ? personal.primary_phone : text; session.data.collection_step = 'location'; await ctx.reply(getQuestion('location')); }
    else if (step === 'location') {
        personal.location = text;
        session.current_section = 'summary';
        session.data.collection_step = 'summary';
        await ctx.reply(`${getReaction()}\n\n${getQuestion('summary')}`);
        await db.updateSession(session.id, 'collecting_summary', 'summary', session.data);
    }
    await db.updateSession(session.id, 'collecting_personal', 'personal', session.data);
}

async function handleSummaryCollection(ctx, client, session, text) {
    session.data.cv_data.professional_summary = text;
    session.current_section = 'education';
    session.data.collection_step = 'level';
    await ctx.reply(`${getReaction()}\n\n${getQuestion('education')}`);
    await db.updateSession(session.id, 'collecting_education', 'education', session.data);
}

async function handleEducationCollection(ctx, client, session, text, callbackData = null) {
    const step = session.data.collection_step;
    const education = session.data.cv_data.education;
    const currentEdu = session.data.current_edu || {};
    
    if (step === 'level') { currentEdu.level = text; session.data.current_edu = currentEdu; session.data.collection_step = 'field'; await ctx.reply("Field of study? 📚"); }
    else if (step === 'field') { currentEdu.field = text; session.data.collection_step = 'institution'; await ctx.reply("Institution? 🏛️"); }
    else if (step === 'institution') { currentEdu.institution = text; session.data.collection_step = 'year'; await ctx.reply("Year of completion? 📅"); }
    else if (step === 'year') {
        currentEdu.year = text; education.push({ ...currentEdu }); session.data.current_edu = null; session.data.collection_step = 'add_more';
        await ctx.reply(`${getReaction()} Another qualification?`, { reply_markup: { inline_keyboard: [[{ text: "✅ Yes", callback_data: "edu_yes" }, { text: "❌ No", callback_data: "edu_no" }]] } });
    }
    else if (step === 'add_more' && (isAffirmative(text) || callbackData === 'edu_yes')) { session.data.collection_step = 'level'; session.data.current_edu = {}; await ctx.reply("Next qualification? 🎓"); }
    else {
        session.current_section = 'employment';
        session.data.collection_step = 'title';
        session.data.current_job = {};
        session.data.cv_data.employment = [];
        await ctx.reply(`${random(RESPONSES.encouragements.sectionComplete)('Education')}\n\n${getQuestion('jobTitle')}`);
        await db.updateSession(session.id, 'collecting_employment', 'employment', session.data);
    }
    await db.updateSession(session.id, 'collecting_education', 'education', session.data);
}

async function handleEmploymentCollection(ctx, client, session, text, callbackData = null) {
    const step = session.data.collection_step;
    const employment = session.data.cv_data.employment;
    const currentJob = session.data.current_job || {};
    
    if (step === 'title') { currentJob.title = text; session.data.current_job = currentJob; session.data.collection_step = 'company'; await ctx.reply("Company name? 🏢"); }
    else if (step === 'company') { currentJob.company = text; session.data.collection_step = 'duration'; await ctx.reply("How long? (e.g., 2022-2024) 📅"); }
    else if (step === 'duration') { currentJob.duration = text; session.data.collection_step = 'responsibilities'; currentJob.responsibilities = []; await ctx.reply(`Key responsibilities? One per line. Type DONE when finished.\n\nExample:\n• Managed team of 5\n• Completed 50+ projects`); }
    else if (step === 'responsibilities') {
        if (text.toUpperCase() !== 'DONE') { currentJob.responsibilities.push(text); await ctx.reply(`✓ Got it. Another? (type DONE when done)`); }
        else { employment.push({ ...currentJob }); session.data.current_job = null; session.data.collection_step = 'add_more'; await ctx.reply(`${getReaction()} Another job?`, { reply_markup: { inline_keyboard: [[{ text: "✅ Yes", callback_data: "emp_yes" }, { text: "❌ No", callback_data: "emp_no" }]] } }); }
    }
    else if (step === 'add_more' && (isAffirmative(text) || callbackData === 'emp_yes')) { session.data.collection_step = 'title'; session.data.current_job = {}; await ctx.reply("Next job title? 💼"); }
    else {
        session.current_section = 'skills';
        session.data.collection_step = 'skills';
        await ctx.reply(`${random(RESPONSES.encouragements.sectionComplete)('Employment')}\n\n${getQuestion('skills')}`);
        await db.updateSession(session.id, 'collecting_skills', 'skills', session.data);
    }
    await db.updateSession(session.id, 'collecting_employment', 'employment', session.data);
}

async function handleSkillsCollection(ctx, client, session, text) {
    session.data.cv_data.skills = text.split(',').map(s => s.trim());
    session.current_section = 'certifications';
    session.data.collection_step = 'name';
    session.data.cv_data.certifications = [];
    await ctx.reply(`${getReaction()} Any certifications? (or 'Skip') 📜`);
    await db.updateSession(session.id, 'collecting_certifications', 'certifications', session.data);
}

async function handleCertificationsCollection(ctx, client, session, text, callbackData = null) {
    const step = session.data.collection_step;
    const certifications = session.data.cv_data.certifications;
    const currentCert = session.data.current_cert || {};
    
    if (step === 'name') {
        if (text === 'Skip' || callbackData === 'cert_skip') {
            session.current_section = 'languages';
            session.data.collection_step = 'name';
            session.data.cv_data.languages = [];
            await ctx.reply(`${getReaction()} Languages you speak? (or 'Skip') 🗣️`);
            await db.updateSession(session.id, 'collecting_languages', 'languages', session.data);
            return;
        }
        currentCert.name = text; session.data.current_cert = currentCert; session.data.collection_step = 'issuer'; await ctx.reply("Issuing organization? 🏛️");
    }
    else if (step === 'issuer') { currentCert.issuer = text; session.data.collection_step = 'year'; await ctx.reply("Year obtained? 📅"); }
    else if (step === 'year') {
        currentCert.year = text; certifications.push({ ...currentCert }); session.data.current_cert = null; session.data.collection_step = 'add_more';
        await ctx.reply(`${getReaction()} Another certification?`, { reply_markup: { inline_keyboard: [[{ text: "✅ Yes", callback_data: "cert_yes" }, { text: "❌ No", callback_data: "cert_no" }, { text: "⏭️ Skip", callback_data: "cert_skip" }]] } });
    }
    else if ((step === 'add_more' && isAffirmative(text)) || callbackData === 'cert_yes') { session.data.collection_step = 'name'; session.data.current_cert = {}; await ctx.reply("Certification name? 📜"); }
    else {
        session.current_section = 'languages';
        session.data.collection_step = 'name';
        session.data.cv_data.languages = [];
        await ctx.reply(`${getReaction()} Languages you speak? (or 'Skip') 🗣️`);
        await db.updateSession(session.id, 'collecting_languages', 'languages', session.data);
    }
    await db.updateSession(session.id, 'collecting_certifications', 'certifications', session.data);
}

async function handleLanguagesCollection(ctx, client, session, text, callbackData = null) {
    const step = session.data.collection_step;
    const languages = session.data.cv_data.languages;
    const currentLang = session.data.current_lang || {};
    
    if (step === 'name') {
        if (text === 'Skip' || callbackData === 'lang_skip') {
            session.current_section = 'referees';
            session.data.collection_step = 'name';
            session.data.cv_data.referees = [];
            await ctx.reply(`Got it! ${getReaction()}\n\nProfessional referees? (Minimum 2 required) 👥\n\nReferee 1 - Full name?`);
            await db.updateSession(session.id, 'collecting_referees', 'referees', session.data);
            return;
        }
        currentLang.name = text; session.data.current_lang = currentLang; session.data.collection_step = 'proficiency';
        await ctx.reply("Level?", { reply_markup: { inline_keyboard: [[{ text: "🔰 Basic", callback_data: "prof_basic" }, { text: "📖 Intermediate", callback_data: "prof_intermediate" }, { text: "⭐ Fluent", callback_data: "prof_fluent" }]] } });
    }
    else if (step === 'proficiency') {
        let proficiency = { prof_basic: 'Basic', prof_intermediate: 'Intermediate', prof_fluent: 'Fluent' }[callbackData] || text;
        currentLang.proficiency = proficiency; languages.push({ ...currentLang }); session.data.current_lang = null; session.data.collection_step = 'add_more';
        await ctx.reply(`${getReaction()} Another language?`, { reply_markup: { inline_keyboard: [[{ text: "✅ Yes", callback_data: "lang_yes" }, { text: "❌ No", callback_data: "lang_no" }, { text: "⏭️ Skip", callback_data: "lang_skip" }]] } });
    }
    else if ((step === 'add_more' && isAffirmative(text)) || callbackData === 'lang_yes') { session.data.collection_step = 'name'; session.data.current_lang = {}; await ctx.reply("Language name? 🗣️"); }
    else {
        session.current_section = 'referees';
        session.data.collection_step = 'name';
        session.data.cv_data.referees = [];
        await ctx.reply(`${random(RESPONSES.encouragements.sectionComplete)('Languages')}\n\nProfessional referees? (Minimum 2 required) 👥\n\nReferee 1 - Full name?`);
        await db.updateSession(session.id, 'collecting_referees', 'referees', session.data);
    }
    await db.updateSession(session.id, 'collecting_languages', 'languages', session.data);
}

async function handleRefereesCollection(ctx, client, session, text, callbackData = null) {
    const step = session.data.collection_step;
    const referees = session.data.cv_data.referees;
    const currentRef = session.data.current_ref || {};
    const refereeCount = referees.length;
    const minReferees = 2;
    
    if (step === 'name') {
        if (text === 'Skip') { await ctx.reply(`⚠️ Need at least ${minReferees} referees! Referee ${refereeCount + 1} - Full name?`); return; }
        currentRef.name = text; session.data.current_ref = currentRef; session.data.collection_step = 'position'; await ctx.reply(`Referee ${refereeCount + 1} - Their position? 📌`);
    }
    else if (step === 'position') { currentRef.position = text; session.data.collection_step = 'contact'; await ctx.reply(`Referee ${refereeCount + 1} - Contact? (phone preferred) 📞`); }
    else if (step === 'contact') {
        currentRef.contact = text; referees.push({ ...currentRef }); session.data.current_ref = null;
        if (referees.length < minReferees) {
            session.data.collection_step = 'name';
            await ctx.reply(`✅ Referee ${referees.length} added. Need ${minReferees - referees.length} more.\n\nReferee ${referees.length + 1} - Full name?`);
        } else {
            await finalizeOrder(ctx, client, session);
        }
    }
    await db.updateSession(session.id, 'collecting_referees', 'referees', session.data);
}

async function handleUpdateFlow(ctx, client, session) {
    const updateSections = [
        'Personal Information', 'Contact Details', 'Professional Summary',
        'Work Experience', 'Education', 'Skills', 'Certifications',
        'Languages', 'Referees'
    ];
    
    session.data.update_sections = updateSections;
    session.data.current_update_section = 0;
    session.data.updates = {};
    
    await ctx.reply(`✏️ *CV Update Mode*

I'll help you update your CV section by section.

Let's start with: *${updateSections[0]}*

Please provide the updated information:`);
    
    session.data.collection_step = updateSections[0];
    await db.updateSession(session.id, 'collecting_update', 'update', session.data);
}

async function handleUpdateCollection(ctx, client, session, text) {
    const sections = session.data.update_sections;
    const currentIndex = session.data.current_update_section || 0;
    const currentSection = sections[currentIndex];
    
    session.data.updates[currentSection] = text;
    const nextIndex = currentIndex + 1;
    
    if (nextIndex < sections.length) {
        session.data.current_update_section = nextIndex;
        await ctx.reply(`✓ Updated ${currentSection}.\n\nNow for: *${sections[nextIndex]}*\n\nPlease provide the updated information:`);
        await db.updateSession(session.id, 'collecting_update', 'update', session.data);
    } else {
        const orderId = `UPD_${Date.now()}_${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
        await db.createOrder({
            id: orderId, client_id: client.id, service: 'cv update', category: session.data.category || 'professional',
            delivery_option: 'standard', delivery_time: '6 hours',
            base_price: getBasePrice('professional', 'cv update'), delivery_fee: 0,
            total_charge: formatPrice(getBasePrice('professional', 'cv update')),
            payment_status: 'pending',
            cv_data: { updates: session.data.updates, original_cv: session.data.cv_data }
        });
        
        await ctx.reply(`✅ *Update Request Submitted!*

Order: \`${orderId}\`
Sections updated: ${sections.length}

Type /pay to complete payment.`);
        await db.updateSession(session.id, 'awaiting_payment_choice', 'payment', session.data);
    }
}

async function finalizeOrder(ctx, client, session) {
    const orderId = `ORD_${Date.now()}_${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
    const personal = session.data.cv_data.personal;
    const name = personal?.full_name || ctx.from.first_name;
    
    if (personal?.email) await db.updateClient(client.id, { email: personal.email });
    if (personal?.primary_phone) await db.updateClient(client.id, { phone: personal.primary_phone });
    if (personal?.location) await db.updateClient(client.id, { location: personal.location });
    
    await cvVersioning.saveVersion(orderId, session.data.cv_data, 1, 'Initial CV creation');
    
    const cvResult = await documentGenerator.generateCV(session.data.cv_data, null, 'docx', session.data.vacancy_data || null, session.data.certificates_data || null);
    
    await db.createOrder({
        id: orderId, client_id: client.id, service: session.data.service, category: session.data.category || 'professional',
        delivery_option: session.data.delivery_option, delivery_time: session.data.delivery_time,
        base_price: session.data.base_price, delivery_fee: DELIVERY_PRICES[session.data.delivery_option] || 0,
        total_charge: session.data.total_charge, payment_status: session.data.payment_status || 'pending',
        cv_data: session.data.cv_data, portfolio_links: JSON.stringify(session.data.portfolio_links || [])
    });
    session.data.order_id = orderId;
    
    const paymentOptions = await getPaymentOptions(session.data.total_charge, orderId, client.id);
    
    await ctx.reply(`${random(RESPONSES.encouragements.final)(name)}\n\n📋 Order: \`${orderId}\`\n🚚 Delivery: ${session.data.delivery_time}\n💰 Total: ${session.data.total_charge}\n\n${paymentOptions.message}`);
    await db.updateSession(session.id, 'awaiting_payment_choice', 'payment', session.data);
}

async function getPaymentOptions(amount, orderId, clientId) {
    const reference = generatePaymentReference();
    return {
        reference,
        message: `💳 *Payment Options*

Amount: ${amount}
Reference: \`${reference}\`

1. 📱 *Mobile Money* - Airtel: 0991295401, Mpamba: 0886928639
2. 📞 *USSD* - Dial *211# (Airtel) or *444# (Mpamba)
3. ⏳ *Pay Later* - Pay within 7 days
4. 📅 *Installments* - 2 parts over 7 days

After payment, type /confirm ${reference}`
    };
}

function generatePaymentReference() {
    return `EASY${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 10000)}`;
}

async function initiatePaymentFlow(ctx, client, session, choice) {
    await ctx.reply(`Payment processing...`);
}

async function showClientPortal(ctx, client) {
    const orders = await db.getClientOrders(client.id);
    let message = `🏠 *YOUR PORTAL*\n\n👤 ${client.first_name}\n📞 ${client.phone || 'Not set'}\n📧 ${client.email || 'Not set'}\n📦 Orders: ${client.total_orders || 0}\n\n📄 *Documents:*\n`;
    
    if (orders.length > 0) {
        message += orders.slice(0, 5).map(o => `• ${o.service} - ${new Date(o.created_at).toLocaleDateString()}`).join('\n');
    } else {
        message += `No documents yet.`;
    }
    
    message += `\n\n/start - New order\n/mydocs - All documents\n/referral - Share & earn`;
    await ctx.reply(message, { parse_mode: 'Markdown' });
}

async function handleCoverLetterStart(ctx, client, session) {
    await ctx.reply(`📢 *Cover Letter*

Share the job vacancy (screenshot, PDF, or text). I'll extract the details.`);
    session.data.awaiting_vacancy = true;
    await db.updateSession(session.id, 'awaiting_vacancy_upload', 'vacancy', session.data);
}

async function handleVacancyText(ctx, client, session, text) {
    const vacancyData = aiAnalyzer.extractVacancyDetails(text);
    session.data.vacancy_data = vacancyData;
    session.data.awaiting_vacancy = false;
    await ctx.reply(`Found: ${vacancyData.position} at ${vacancyData.company}\n\nPosition applying for? (or 'SAME')`);
    await db.updateSession(session.id, 'collecting_coverletter_position', 'coverletter', session.data);
}

async function handleCoverLetterPosition(ctx, client, session, text) {
    session.data.coverletter_position = text.toLowerCase() === 'same' && session.data.vacancy_data?.position ? session.data.vacancy_data.position : text;
    await ctx.reply(`Company name? 🏢`);
    await db.updateSession(session.id, 'collecting_coverletter_company', 'coverletter', session.data);
}

async function handleCoverLetterCompany(ctx, client, session, text) {
    session.data.coverletter_company = text;
    const orderId = `CL_${Date.now()}_${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
    await db.createOrder({
        id: orderId, client_id: client.id, service: 'cover letter', category: session.data.category || 'professional',
        delivery_option: 'standard', delivery_time: '6 hours', base_price: 5000, delivery_fee: 0,
        total_charge: 'MK5,000', payment_status: 'pending', cv_data: { coverletter: session.data }
    });
    await ctx.reply(`🎉 Cover letter ready!\n\nOrder: \`${orderId}\`\nPosition: ${session.data.coverletter_position}\nCompany: ${session.data.coverletter_company}\nTotal: MK5,000\n\nType /pay when ready.`);
    await db.updateSession(session.id, 'awaiting_payment_choice', 'payment', session.data);
}

// ============ BOT COMMANDS ============
bot.command('start', async (ctx) => {
    const client = await getOrCreateClient(ctx);
    const session = await getOrCreateSession(client.id);
    await handleGreeting(ctx, client, session);
});

bot.command('portal', async (ctx) => {
    const client = await getOrCreateClient(ctx);
    await showClientPortal(ctx, client);
});

bot.command('mydocs', async (ctx) => {
    const client = await getOrCreateClient(ctx);
    const orders = await db.getClientOrders(client.id);
    let msg = "📄 *YOUR DOCUMENTS*\n\n";
    orders.forEach(o => { msg += `📌 ${o.service} - ${o.status}\n   Order: ${o.id}\n   Date: ${new Date(o.created_at).toLocaleDateString()}\n\n`; });
    await ctx.reply(msg || "No documents yet.", { parse_mode: 'Markdown' });
});

bot.command('referral', async (ctx) => {
    const client = await getOrCreateClient(ctx);
    const refInfo = await db.getReferralInfo(client.id);
    await ctx.reply(`🎁 *REFERRAL PROGRAM*\n\nYour code: \`${refInfo.referral_code}\`\n\nShare: https://t.me/${ctx.botInfo.username}?start=ref_${refInfo.referral_code}\n\nReferrals: ${refInfo.total_referrals}\nPending reward: MK${refInfo.pending_reward}\n\nFriend gets 10% off, you get MK2,000 credit!`);
});

bot.command('pay', async (ctx) => {
    const client = await getOrCreateClient(ctx);
    const session = await db.getActiveSession(client.id);
    if (session && session.data.total_charge) {
        await initiatePaymentFlow(ctx, client, session, '1');
    } else {
        await ctx.reply(`No active order. Type /start to begin.`);
    }
});

bot.command('pause', async (ctx) => {
    const client = await getOrCreateClient(ctx);
    const session = await db.getActiveSession(client.id);
    if (session && session.stage !== 'main_menu') {
        session.is_paused = true;
        await db.updateSession(session.id, session.stage, session.current_section, session.data, 1);
        await ctx.reply(`⏸️ *Session Paused*\n\nType /resume when ready.`);
    } else {
        await ctx.reply(`No active session to pause.`);
    }
});

bot.command('resume', async (ctx) => {
    const client = await getOrCreateClient(ctx);
    const pausedSession = await db.getPausedSession(client.id);
    if (pausedSession) {
        pausedSession.data = JSON.parse(pausedSession.data);
        await db.updateSession(pausedSession.id, pausedSession.stage, pausedSession.current_section, pausedSession.data, 0);
        await ctx.reply(`🔄 Welcome back! Let's continue.`);
        if (pausedSession.stage === 'collecting_personal') await ctx.reply(getQuestion('name'));
        else if (pausedSession.stage === 'collecting_education') await ctx.reply("Highest qualification? 🎓");
        else if (pausedSession.stage === 'collecting_employment') await ctx.reply(getQuestion('jobTitle'));
        else if (pausedSession.stage === 'collecting_update') await ctx.reply(`Let's continue with your updates.`);
        else if (pausedSession.stage === 'collecting_missing') await ctx.reply(`Let's continue with your missing information.`);
    } else {
        await ctx.reply(`No paused session found. Type /start to begin fresh.`);
    }
});

bot.command('confirm', async (ctx) => {
    const args = ctx.message.text.split(' ');
    if (args.length < 2) { await ctx.reply("Usage: /confirm REFERENCE"); return; }
    await ctx.reply(`✅ Payment confirmation received! Reference: ${args[1]}\n\nOur team will verify shortly.`);
});

bot.command('verify', async (ctx) => {
    if (ctx.from.id.toString() !== process.env.ADMIN_CHAT_ID) return await ctx.reply("Unauthorized.");
    const args = ctx.message.text.split(' ');
    if (args.length < 2) return await ctx.reply("Usage: /verify REFERENCE");
    await ctx.reply(`✅ Payment verified for ${args[1]}`);
});

bot.help(async (ctx) => {
    await ctx.reply(`🆘 *Help*

/start - Begin
/resume - Continue paused
/pause - Save progress
/pay - Make payment
/portal - Dashboard
/mydocs - Documents
/referral - Share & earn

Contact: +265 991 295 401`);
});

// ============ FILE UPLOAD HANDLERS ============
bot.on('document', async (ctx) => {
    const client = await getOrCreateClient(ctx);
    const session = await getOrCreateSession(client.id);
    const document = ctx.message.document;
    const fileName = document.file_name;
    
    if (session.stage === 'awaiting_vacancy_upload') {
        const fileInfo = await ctx.telegram.getFile(document.file_id);
        const fileUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${fileInfo.file_path}`;
        const vacancyData = await aiAnalyzer.extractVacancyFromFile(fileUrl, fileName);
        session.data.vacancy_data = vacancyData;
        session.data.awaiting_vacancy = false;
        await ctx.reply(`📄 Processed! Found ${vacancyData.position || 'position'}.\n\nApplying for? (or 'SAME')`);
        await db.updateSession(session.id, 'collecting_coverletter_position', 'coverletter', session.data);
    } else if (session.stage === 'awaiting_draft_upload' || session.data.awaiting_draft_upload) {
        await ctx.reply(`📄 Processing your draft... This may take a moment.`);
        const fileInfo = await ctx.telegram.getFile(document.file_id);
        const fileUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${fileInfo.file_path}`;
        
        const success = await smartDraft.processDraftUpload(ctx, client, session, fileUrl, fileName);
        if (success) {
            session.data.awaiting_draft_upload = false;
            await db.updateSession(session.id, session.stage, session.current_section, session.data);
        }
    } else {
        await ctx.reply(`📎 *Draft Upload*

You can upload an existing CV or cover letter and I'll extract everything!

Just send me the file (PDF, DOCX, or image).`);
        session.data.awaiting_draft_upload = true;
        await db.updateSession(session.id, 'awaiting_draft_upload', 'draft', session.data);
    }
});

bot.on('photo', async (ctx) => {
    const client = await getOrCreateClient(ctx);
    const session = await getOrCreateSession(client.id);
    const photo = ctx.message.photo[ctx.message.photo.length - 1];
    
    if (session.stage === 'awaiting_vacancy_upload') {
        const fileInfo = await ctx.telegram.getFile(photo.file_id);
        const fileUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${fileInfo.file_path}`;
        const vacancyData = await aiAnalyzer.extractVacancyFromFile(fileUrl, 'vacancy_image.jpg');
        session.data.vacancy_data = vacancyData;
        session.data.awaiting_vacancy = false;
        await ctx.reply(`📸 Image processed! Found ${vacancyData.position || 'position'}.\n\nApplying for? (or 'SAME')`);
        await db.updateSession(session.id, 'collecting_coverletter_position', 'coverletter', session.data);
    } else if (session.stage === 'awaiting_draft_upload' || session.data.awaiting_draft_upload) {
        await ctx.reply(`📸 Processing your image...`);
        const fileInfo = await ctx.telegram.getFile(photo.file_id);
        const fileUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${fileInfo.file_path}`;
        
        const success = await smartDraft.processDraftUpload(ctx, client, session, fileUrl, 'image.jpg');
        if (success) {
            session.data.awaiting_draft_upload = false;
            await db.updateSession(session.id, session.stage, session.current_section, session.data);
        }
    } else {
        await ctx.reply(`📎 *Upload Draft*

You can upload an image of your CV/cover letter and I'll extract the information!`);
        session.data.awaiting_draft_upload = true;
        await db.updateSession(session.id, 'awaiting_draft_upload', 'draft', session.data);
    }
});

// ============ TEXT MESSAGE HANDLER ============
bot.on('text', async (ctx) => {
    const text = ctx.message.text;
    const client = await getOrCreateClient(ctx);
    const session = await getOrCreateSession(client.id);
    
    if (text === '/start') await handleGreeting(ctx, client, session);
    else if (session.stage === 'main_menu') await handleMainMenu(ctx, client, session, text);
    else if (session.stage === 'collecting_portfolio') await handlePortfolioCollection(ctx, client, session, text);
    else if (session.stage === 'collecting_personal') await handlePersonalCollection(ctx, client, session, text);
    else if (session.stage === 'collecting_summary') await handleSummaryCollection(ctx, client, session, text);
    else if (session.stage === 'collecting_education') await handleEducationCollection(ctx, client, session, text);
    else if (session.stage === 'collecting_employment') await handleEmploymentCollection(ctx, client, session, text);
    else if (session.stage === 'collecting_skills') await handleSkillsCollection(ctx, client, session, text);
    else if (session.stage === 'collecting_certifications') await handleCertificationsCollection(ctx, client, session, text);
    else if (session.stage === 'collecting_languages') await handleLanguagesCollection(ctx, client, session, text);
    else if (session.stage === 'collecting_referees') await handleRefereesCollection(ctx, client, session, text);
    else if (session.stage === 'collecting_update') await handleUpdateCollection(ctx, client, session, text);
    else if (session.stage === 'collecting_missing') await smartDraft.handleMissingCollection(ctx, client, session, text);
    else if (session.stage === 'awaiting_vacancy_upload') await handleVacancyText(ctx, client, session, text);
    else if (session.stage === 'collecting_coverletter_position') await handleCoverLetterPosition(ctx, client, session, text);
    else if (session.stage === 'collecting_coverletter_company') await handleCoverLetterCompany(ctx, client, session, text);
    else if (session.stage === 'awaiting_payment_choice') {
        if (text === '1' || text === '2' || text === '3' || text === '4') {
            await initiatePaymentFlow(ctx, client, session, text);
        } else if (text.toLowerCase() === 'pay later') {
            session.data.payment_status = 'pending';
            await db.updateSession(session.id, 'payment_completed', 'payment', session.data);
            await ctx.reply(`⏳ Pay later selected. Let's build your CV! ${getReaction()}`);
            await startDataCollection(ctx, client, session);
        } else { await ctx.reply(`Please select 1, 2, 3, or 4.`); }
    }
    else await ctx.reply(random(RESPONSES.help));
});

// ============ CALLBACK QUERY HANDLER ============
bot.on('callback_query', async (ctx) => {
    await ctx.answerCbQuery();
    const data = ctx.callbackQuery.data;
    const client = await getOrCreateClient(ctx);
    const session = await getOrCreateSession(client.id);
    
    if (data.startsWith('cat_')) await handleCategorySelection(ctx, client, session, data);
    else if (data.startsWith('service_')) await handleServiceSelection(ctx, client, session, data);
    else if (data.startsWith('delivery_')) await handleDeliverySelection(ctx, client, session, data);
    else if (data === 'edu_yes' || data === 'edu_no') await handleEducationCollection(ctx, client, session, data === 'edu_yes' ? 'Yes' : 'No', data);
    else if (data === 'emp_yes' || data === 'emp_no') await handleEmploymentCollection(ctx, client, session, data === 'emp_yes' ? 'Yes' : 'No', data);
    else if (data === 'cert_yes' || data === 'cert_no' || data === 'cert_skip') { 
        if (data === 'cert_skip') await handleCertificationsCollection(ctx, client, session, 'Skip', data); 
        else await handleCertificationsCollection(ctx, client, session, data === 'cert_yes' ? 'Yes' : 'No', data); 
    }
    else if (data === 'lang_yes' || data === 'lang_no' || data === 'lang_skip') { 
        if (data === 'lang_skip') await handleLanguagesCollection(ctx, client, session, 'Skip', data); 
        else await handleLanguagesCollection(ctx, client, session, data === 'lang_yes' ? 'Yes' : 'No', data); 
    }
    else if (data === 'more_work_yes' || data === 'more_work_no') {
        if (data === 'more_work_yes') {
            session.data.collection_step = 'title';
            session.data.current_job = {};
            await ctx.reply("Next job title? 💼");
            await db.updateSession(session.id, 'collecting_employment', 'employment', session.data);
        } else {
            session.current_section = 'skills';
            session.data.collection_step = 'skills';
            await ctx.reply(`${random(RESPONSES.encouragements.sectionComplete)('Employment')}\n\n${getQuestion('skills')}`);
            await db.updateSession(session.id, 'collecting_skills', 'skills', session.data);
        }
    }
    else if (data === 'more_edu_yes' || data === 'more_edu_no') {
        if (data === 'more_edu_yes') {
            session.data.collection_step = 'level';
            session.data.current_edu = {};
            await ctx.reply("Next qualification? 🎓");
            await db.updateSession(session.id, 'collecting_education', 'education', session.data);
        } else {
            session.current_section = 'employment';
            session.data.collection_step = 'title';
            session.data.current_job = {};
            session.data.cv_data.employment = [];
            await ctx.reply(`${random(RESPONSES.encouragements.sectionComplete)('Education')}\n\n${getQuestion('jobTitle')}`);
            await db.updateSession(session.id, 'collecting_employment', 'employment', session.data);
        }
    }
    else if (data === 'more_ref_yes' || data === 'more_ref_no') {
        if (data === 'more_ref_yes') {
            session.data.collection_step = 'name';
            session.data.current_ref = {};
            await ctx.reply(`Next referee - Full name? 👥`);
            await db.updateSession(session.id, 'collecting_referees', 'referees', session.data);
        } else {
            await finalizeOrder(ctx, client, session);
        }
    }
    else if (data.startsWith('prof_')) await handleLanguagesCollection(ctx, client, session, '', data);
});

// ============ START BOT ============
async function startBot() {
    await db.initDatabase();
    
    await bot.telegram.setMyCommands([
        { command: 'start', description: 'Start the bot' },
        { command: 'resume', description: 'Resume paused session' },
        { command: 'pause', description: 'Save progress and pause' },
        { command: 'pay', description: 'Make a payment' },
        { command: 'portal', description: 'Your dashboard' },
        { command: 'mydocs', description: 'Your documents' },
        { command: 'referral', description: 'Share & earn' },
        { command: 'help', description: 'Get help' }
    ]);
    
    // Try to set commands, but don't fail if network blocks it
    try {
        await setCommands();
        console.log('✅ Commands set');
    } catch (error) {
        console.log('⚠️ Could not set commands (network issue):', error.message);
    }
    
    // Use polling with error handling
    bot.launch({
        polling: {
            timeout: 30,
            limit: 100,
            retryTimeout: 30000
        }
    }).catch(err => {
        console.log('Polling error:', err.message);
    });
    
    console.log('========================================');
    console.log('  🤖 EasySuccor Bot Running');
    console.log('  ✅ Smart Draft Upload - Auto-extracts data');
    console.log('  ✅ Only asks for missing sections');
    console.log('  ✅ Admin batch upload available');
    console.log('  ✅ Returning client detection');
    console.log('========================================');
}

startBot();
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

module.exports = bot;