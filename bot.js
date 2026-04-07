// bot.js - Complete EasySuccor Telegram Bot with Smart Draft Upload & Real Testimonials
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
const intelligentUpdate = require('./intelligent-update');

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

// Admin upload endpoint for multiple files
app.post('/admin/upload-batch', adminAuth, upload.array('files', 20), async (req, res) => {
    try {
        const files = req.files;
        if (!files || files.length === 0) {
            return res.status(400).json({ error: 'No files uploaded' });
        }
        
        const results = [];
        for (const file of files) {
            try {
                const extractedData = await documentGenerator.extractFullCVData(file.path, 'cv');
                
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
                        physical_address: extractedData.data.personal?.physical_address || null,
                        nationality: extractedData.data.personal?.nationality || null,
                        special_documents: extractedData.data.personal?.special_documents || null,
                        is_legacy_client: true
                    });
                }
                
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

// Admin single file upload
app.post('/admin/upload-cv', adminAuth, upload.single('cv_file'), async (req, res) => {
    try {
        const file = req.file;
        if (!file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }
        
        const extractedData = await documentGenerator.extractFullCVData(file.path, 'cv');
        
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
                physical_address: extractedData.data.personal?.physical_address || null,
                nationality: extractedData.data.personal?.nationality || null,
                special_documents: extractedData.data.personal?.special_documents || null,
                is_legacy_client: true
            });
        }
        
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
                location: extractedData.data.personal?.location,
                physical_address: extractedData.data.personal?.physical_address,
                nationality: extractedData.data.personal?.nationality,
                special_documents: extractedData.data.personal?.special_documents
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
        
        const fileUrl = `/uploads/${file.filename}`;
        const extractedData = await aiAnalyzer.extractFromDocument(fileUrl, file.originalname);
        
        const clientName = extractedData.client_name || 'Unknown Client';
        const clientEmail = extractedData.client_email || null;
        const clientPhone = extractedData.client_phone || null;
        const clientLocation = extractedData.client_location || null;
        const position = extractedData.position || formPosition || 'Unknown Position';
        const company = extractedData.company || formCompany || 'Unknown Company';
        
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

// ============ HELPER FOR MARKDOWN ============
async function sendMarkdown(ctx, message, extra = {}) {
    return await ctx.reply(message, { parse_mode: 'Markdown', ...extra });
}

// ============ SAFE CV DATA ACCESS HELPER ============
function ensureCVData(session) {
    if (!session.data) {
        session.data = {};
    }
    if (!session.data.cv_data) {
        session.data.cv_data = {
            personal: {
                full_name: '',
                email: '',
                primary_phone: '',
                alternative_phone: '',
                whatsapp_phone: '',
                location: '',
                physical_address: '',
                nationality: '',
                special_documents: []
            },
            professional_summary: '',
            education: [],
            employment: [],
            skills: [],
            certifications: [],
            languages: [],
            projects: [],
            achievements: [],
            referees: [],
            portfolio: []
        };
    }
    if (!session.data.cv_data.personal) {
        session.data.cv_data.personal = {
            full_name: '',
            email: '',
            primary_phone: '',
            alternative_phone: '',
            whatsapp_phone: '',
            location: '',
            physical_address: '',
            nationality: '',
            special_documents: []
        };
    }
    if (!session.data.cv_data.education) session.data.cv_data.education = [];
    if (!session.data.cv_data.employment) session.data.cv_data.employment = [];
    if (!session.data.cv_data.skills) session.data.cv_data.skills = [];
    if (!session.data.cv_data.certifications) session.data.cv_data.certifications = [];
    if (!session.data.cv_data.languages) session.data.cv_data.languages = [];
    if (!session.data.cv_data.referees) session.data.cv_data.referees = [];
    if (!session.data.cv_data.projects) session.data.cv_data.projects = [];
    if (!session.data.cv_data.achievements) session.data.cv_data.achievements = [];
    
    return session.data.cv_data;
}

// ============ SAFE COVER LETTER DATA ACCESS HELPER ============
function ensureCoverLetterData(session) {
    if (!session.data) {
        session.data = {};
    }
    if (!session.data.coverletter) {
        session.data.coverletter = {};
    }
    if (session.data.coverletter_position === undefined) {
        session.data.coverletter_position = '';
    }
    if (session.data.coverletter_company === undefined) {
        session.data.coverletter_company = '';
    }
    if (session.data.vacancy_data === undefined) {
        session.data.vacancy_data = null;
    }
    if (session.data.awaiting_vacancy === undefined) {
        session.data.awaiting_vacancy = false;
    }
    return session.data;
}

// ============ TESTIMONIAL SYSTEM ============
let TESTIMONIALS_CACHE = [];

async function loadTestimonialsCache() {
    const testimonials = await db.getApprovedTestimonials(10);
    TESTIMONIALS_CACHE = testimonials;
    console.log(`✅ Loaded ${TESTIMONIALS_CACHE.length} testimonials into cache`);
}

function getRandomTestimonial() {
    if (TESTIMONIALS_CACHE.length === 0) return null;
    const random = TESTIMONIALS_CACHE[Math.floor(Math.random() * TESTIMONIALS_CACHE.length)];
    return `📢 *What our clients say:*\n\n⭐️⭐️⭐️⭐️⭐️ "${random.text}" - ${random.name}\n\n`;
}

async function collectFeedback(ctx, client, orderId) {
    await sendMarkdown(ctx, `📝 *Help Us Improve EasySuccor*

We'd love your honest feedback on your experience:

1. How would you rate your document? (1-5 ⭐)
2. What did you like most?
3. What could we improve?
4. Any suggestions for new features?

Type your feedback below (or type /skip if busy):`);
    
    const session = await getOrCreateSession(client.id);
    session.data.awaiting_feedback = true;
    session.data.order_id = orderId;
    await db.updateSession(session.id, 'collecting_feedback', 'feedback', session.data);
}

async function handleFeedback(ctx, client, session, text) {
    if (text.toLowerCase() === '/skip') {
        await sendMarkdown(ctx, `No problem! You can always share feedback later with /feedback.`);
        await db.updateSession(session.id, 'main_menu', null, session.data);
        return;
    }
    
    await db.saveFeedback({
        client_id: client.id,
        order_id: session.data.order_id,
        feedback: text,
        rating: session.data.rating || null,
        created_at: new Date().toISOString()
    });
    
    await sendMarkdown(ctx, `✅ *Feedback received!*

We take all feedback seriously and will use this to improve EasySuccor.

Type /start to continue.`);
    await db.updateSession(session.id, 'main_menu', null, session.data);
}

// ============ SMART DRAFT PROCESSOR ============
class SmartDraftProcessor {
    async processDraftUpload(ctx, client, session, fileUrl, fileName) {
        const extractedData = await documentGenerator.extractFullCVDataFromUrl(fileUrl, fileName);
        
        if (!extractedData.success) {
            await sendMarkdown(ctx, `❌ Could not extract data from your file. Please try again or choose manual entry.`);
            return false;
        }
        
        const cvData = extractedData.data;
        const missingSections = this.identifyMissingSections(cvData);
        
        session.data.cv_data = cvData;
        session.data.is_draft_upload = true;
        session.data.missing_sections = missingSections;
        session.data.current_missing_index = 0;
        
        let foundMessage = `📄 *Draft Processed Successfully!*\n\n`;
        foundMessage += `✅ *Found:*\n`;
        foundMessage += `• Name: ${cvData.personal?.full_name || 'Not found'}\n`;
        foundMessage += `• Email: ${cvData.personal?.email || 'Not found'}\n`;
        foundMessage += `• Phone: ${cvData.personal?.primary_phone || 'Not found'}\n`;
        foundMessage += `• Location: ${cvData.personal?.location || 'Not found'}\n`;
        foundMessage += `• Physical Address: ${cvData.personal?.physical_address || 'Not found'}\n`;
        foundMessage += `• Nationality: ${cvData.personal?.nationality || 'Not found'}\n`;
        foundMessage += `• Special Documents: ${cvData.personal?.special_documents?.length || 0} document(s)\n`;
        foundMessage += `• Work Experience: ${cvData.employment?.length || 0} entries\n`;
        foundMessage += `• Education: ${cvData.education?.length || 0} entries\n`;
        foundMessage += `• Skills: ${cvData.skills?.length || 0} skills\n`;
        
        if (missingSections.length > 0) {
            foundMessage += `\n⚠️ *Missing:* ${missingSections.join(', ')}\n\n`;
            foundMessage += `Let's fill in the missing information.`;
            await sendMarkdown(ctx, foundMessage);
            await this.collectNextMissingSection(ctx, client, session);
        } else {
            foundMessage += `\n🎉 *Complete!* Your draft has everything needed.\n\n`;
            foundMessage += `Proceed to payment? Type /pay to continue.`;
            await sendMarkdown(ctx, foundMessage);
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
        if (!cvData.personal?.physical_address) missing.push('Physical Address');
        if (!cvData.personal?.nationality) missing.push('Nationality');
        if (!cvData.professional_summary) missing.push('Professional Summary');
        if (!cvData.employment || cvData.employment.length === 0) missing.push('Work Experience');
        if (!cvData.education || cvData.education.length === 0) missing.push('Education');
        if (!cvData.skills || cvData.skills.length === 0) missing.push('Skills');
        if (!cvData.referees || cvData.referees.length < 2) missing.push('Referees (need 2)');
        return missing;
    }
    
    async collectNextMissingSection(ctx, client, session) {
        const missing = session.data.missing_sections;
        const index = session.data.current_missing_index || 0;
        
        if (index >= missing.length) {
            await sendMarkdown(ctx, `✅ *All information collected!*\n\nProceed to payment? Type /pay to continue.`);
            session.data.cv_complete = true;
            await db.updateSession(session.id, 'awaiting_payment_choice', 'payment', session.data);
            return;
        }
        
        const section = missing[index];
        session.data.current_section = section;
        
        const prompts = {
            'Full Name': "What's your full name? 📛\n*Example:* John Mwale Doe",
            'Email': "What's your email address? 📧\n*Example:* john.doe@example.com",
            'Phone': "What's your phone number? 📞\n*Example:* +265 991 234 567 or 0991234567",
            'Location': "Where are you based? (City, Country) 📍\n*Example:* Lilongwe, Malawi",
            'Physical Address': "What's your physical address? 🏠\n*Example:* House No. 123, Area 47, Lilongwe\n\nClick the button below to skip.",
            'Nationality': "What's your nationality? 🌍\n*Example:* Malawian\n\nClick the button below to skip.",
            'Professional Summary': "Please provide a brief professional summary (2-3 sentences) ✍️\n*Example:* Results-oriented Project Manager with 5+ years of experience in...",
            'Work Experience': "Let's add your work experience. Most recent job title? 💼\n*Example:* Senior Software Engineer",
            'Education': "What's your highest qualification? 🎓\n*Example:* Bachelor of Science in Computer Science",
            'Skills': "List your key skills (comma separated) ⚡\n*Example:* Project Management, Team Leadership, Risk Assessment",
            'Referees (need 2)': "Please provide at least 2 professional referees.\n\n*Referee 1 - Full name?* 👥\n*Example:* Dr. Jane Mkandawire"
        };
        
        await sendMarkdown(ctx, prompts[section] || `Please provide your ${section.toLowerCase()}:`);
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
            case 'Physical Address':
                if (text.toLowerCase() !== 'skip') {
                    cvData.personal = cvData.personal || {};
                    cvData.personal.physical_address = text;
                }
                break;
            case 'Nationality':
                if (text.toLowerCase() !== 'skip') {
                    cvData.personal = cvData.personal || {};
                    cvData.personal.nationality = text;
                }
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
                    await sendMarkdown(ctx, "Company name? 🏢\n*Example:* ABC Corporation");
                    return;
                } else if (step === 'company') {
                    session.data.temp_job.company = text;
                    session.data.work_step = 'duration';
                    await sendMarkdown(ctx, "Duration? 📅\n*Example:* Jan 2020 - Present (3 years)");
                    return;
                } else if (step === 'duration') {
                    session.data.temp_job.duration = text;
                    session.data.work_step = 'responsibilities';
                    session.data.temp_job.responsibilities = [];
                    await sendMarkdown(ctx, "Key responsibilities? One per line. Type DONE when finished.\n\n*Example:*\n• Led a team of 5 developers\n• Increased efficiency by 30%\n\nType DONE when done.");
                    return;
                } else if (step === 'responsibilities') {
                    if (text.toUpperCase() !== 'DONE') {
                        session.data.temp_job.responsibilities.push(text);
                        await sendMarkdown(ctx, `✓ Added. Another responsibility? (type DONE when done)`);
                        return;
                    } else {
                        cvData.employment.push(session.data.temp_job);
                        session.data.temp_job = null;
                        session.data.work_step = null;
                        await sendMarkdown(ctx, `✓ Work experience added. Another job?`, {
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
                    await sendMarkdown(ctx, "Field of study? 📚\n*Example:* Computer Science");
                    return;
                } else if (eduStep === 'field') {
                    session.data.temp_edu.field = text;
                    session.data.edu_step = 'institution';
                    await sendMarkdown(ctx, "Institution? 🏛️\n*Example:* University of Malawi");
                    return;
                } else if (eduStep === 'institution') {
                    session.data.temp_edu.institution = text;
                    session.data.edu_step = 'year';
                    await sendMarkdown(ctx, "Year of completion? 📅\n*Example:* 2020");
                    return;
                } else if (eduStep === 'year') {
                    session.data.temp_edu.year = text;
                    cvData.education.push(session.data.temp_edu);
                    session.data.temp_edu = null;
                    session.data.edu_step = null;
                    await sendMarkdown(ctx, `✓ Education added. Another qualification?`, {
                        reply_markup: { inline_keyboard: [[{ text: "✅ Yes", callback_data: "more_edu_yes" }, { text: "❌ No", callback_data: "more_edu_no" }]] }
                    });
                    return;
                }
                break;
            case 'Skills':
                cvData.skills = text.split(',').map(s => s.trim());
                break;
            case 'Referees (need 2)':
                if (!cvData.referees) cvData.referees = [];
                if (!session.data.temp_ref) session.data.temp_ref = {};
                const refStep = session.data.ref_step || 'name';
                if (refStep === 'name') {
                    session.data.temp_ref.name = text;
                    session.data.ref_step = 'position';
                    await sendMarkdown(ctx, "Their position? 📌\n*Example:* Senior Manager");
                    return;
                } else if (refStep === 'position') {
                    session.data.temp_ref.position = text;
                    session.data.ref_step = 'contact';
                    await sendMarkdown(ctx, "Their contact? (phone or email) 📞\n*Example:* +265 991 234 567 or jane@example.com");
                    return;
                } else if (refStep === 'contact') {
                    session.data.temp_ref.contact = text;
                    cvData.referees.push(session.data.temp_ref);
                    session.data.temp_ref = null;
                    session.data.ref_step = null;
                    if (cvData.referees.length < 2) {
                        await sendMarkdown(ctx, `✓ Referee added. Need ${2 - cvData.referees.length} more.\n\nNext referee - Full name? 👥`);
                        return;
                    } else {
                        await sendMarkdown(ctx, `✓ ${cvData.referees.length} referees added. Another?`, {
                            reply_markup: { inline_keyboard: [[{ text: "✅ Yes", callback_data: "more_ref_yes" }, { text: "❌ No", callback_data: "more_ref_no" }]] }
                        });
                        return;
                    }
                }
                break;
        }
        
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

// ============ PORTFOLIO COLLECTION WITH CLICKABLE SKIP BUTTON ============
class PortfolioCollector {
    async askForPortfolio(ctx) {
        await sendMarkdown(ctx, `📎 *Portfolio Items (Optional)*

Would you like to include links to your work?

• GitHub repositories
• Behance/Dribbble portfolio
• Personal website
• Case studies

*Why this matters:* Employers love seeing real work examples!

Type your portfolio links (one per line) or click the button below to skip.

*Example:* 
https://github.com/johndoe
https://johndoe.com/portfolio`, {
            reply_markup: { inline_keyboard: [
                [{ text: "⏭️ Skip Portfolio", callback_data: "portfolio_skip" }]
            ] }
        });
    }
    
    parsePortfolioLinks(text) {
        if (!text || text.toLowerCase() === 'skip') return [];
        return text.split('\n').filter(line => line && line.trim().startsWith('http'));
    }
}

const portfolioCollector = new PortfolioCollector();

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

// ============ PERSISTENT KEYBOARD WITH EDITABLE COVER LETTER ============
const mainMenuKeyboard = Markup.keyboard([
    [Markup.button.text("📄 New CV"), Markup.button.text("📝 Editable CV")],
    [Markup.button.text("💌 Cover Letter"), Markup.button.text("📎 Editable Cover Letter")],
    [Markup.button.text("✏️ Update CV"), Markup.button.text("📎 Upload Draft")],
    [Markup.button.text("ℹ️ About"), Markup.button.text("📞 Contact"), Markup.button.text("🏠 Portal")]
]).resize().persistent();

// ============ CORE HANDLERS ============

// ============ GREETING WITH CLICKABLE CATEGORY BUTTONS ============
async function handleGreeting(ctx, client, session) {
    const name = ctx.from.first_name;
    const testimonial = getRandomTestimonial();
    
    let message = `👋 *Welcome to EasySuccor, ${name}!*

We help you create professional CVs and cover letters that get noticed.

${testimonial ? testimonial : ''}

*What we offer:*
📄 Professional CV writing
📝 Editable CV (Word format)
💌 Cover letters tailored to your dream job
📎 Editable Cover Letter (Word format)
✏️ CV updates and revisions

*Ready to get started?*

Select your category below:`;

    await sendMarkdown(ctx, message, {
        reply_markup: { inline_keyboard: [
            [{ text: "🎓 Student", callback_data: "cat_student" }],
            [{ text: "📜 Recent Graduate", callback_data: "cat_recent" }],
            [{ text: "💼 Professional", callback_data: "cat_professional" }],
            [{ text: "🌱 Non-Working", callback_data: "cat_nonworking" }],
            [{ text: "🔄 Returning Client", callback_data: "cat_returning" }]
        ] }
    });
    
    await db.updateSession(session.id, 'selecting_category', null, session.data);
}

// ============ CATEGORY SELECTION - SHOWS SERVICE BUTTONS ============
async function handleCategorySelection(ctx, client, session, data) {
    const categoryMap = {
        cat_student: 'student',
        cat_recent: 'recentgraduate',
        cat_professional: 'professional',
        cat_nonworking: 'nonworkingprofessional',
        cat_returning: 'returningclient'
    };
    
    session.data.category = categoryMap[data];
    
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
    
    await sendMarkdown(ctx, `✅ Category selected: *${session.data.category}*

Now, please select your service:`, {
        reply_markup: { inline_keyboard: serviceButtons }
    });
    
    await db.updateSession(session.id, 'selecting_service', null, session.data);
}

// ============ SERVICE SELECTION WITH DRAFT HELPER ============
async function handleServiceSelection(ctx, client, session, data) {
    const serviceMap = {
        service_new: 'new cv',
        service_editable: 'editable cv',
        service_cover: 'cover letter',
        service_editable_cover: 'editable cover letter',
        service_update: 'cv update'
    };
    
    session.data.service = serviceMap[data];
    
    if (session.data.service === 'cv update') {
        await handleIntelligentUpdate(ctx, client, session);
        return;
    }
    
    await sendMarkdown(ctx, `✅ *Service selected:* ${session.data.service}

*Would you like to upload an existing draft to save time?*

I can extract information from your existing CV or cover letter and only ask for what's missing.`, {
        reply_markup: { inline_keyboard: [
            [{ text: "📎 Upload Draft", callback_data: "build_draft" }],
            [{ text: "✍️ Enter Manually", callback_data: "build_manual" }]
        ] }
    });
    
    await db.updateSession(session.id, 'selecting_build_method', null, session.data);
}

// ============ INTELLIGENT UPDATE HANDLER ============
async function handleIntelligentUpdate(ctx, client, session) {
    const orders = await db.getClientOrders(client.id);
    const latestCV = orders.find(o => o.service === 'new cv' || o.service === 'editable cv');
    
    if (!latestCV || !latestCV.cv_data) {
        await sendMarkdown(ctx, `❌ I couldn't find your existing CV. Please create a CV first using /start.`);
        return;
    }
    
    session.data.existing_cv = latestCV.cv_data;
    session.data.update_mode = 'intelligent';
    
    await sendMarkdown(ctx, `✏️ *Intelligent CV Update*

I see you have an existing CV. Tell me what changes you want in plain English.

*Examples:*
• "Add 5 years of experience as Project Manager at ABC Corp"
• "Remove my high school education"
• "Update my phone number to 0999123456"
• "Add a certification in Digital Marketing"
• "I'm applying for a Senior Developer role at Tech Company"

You can also upload vacancy details (screenshot, PDF, or text), and I'll tailor your CV accordingly.

*Type your request or upload a file:*`);
    
    session.data.awaiting_update_request = true;
    await db.updateSession(session.id, 'awaiting_update_request', 'update', session.data);
}

async function handleUpdateRequest(ctx, client, session, text, fileUrl = null, fileType = null) {
    try {
        let vacancyData = null;
        let userRequest = text;
        
        if (fileUrl) {
            await sendMarkdown(ctx, `📄 Processing your file...`);
            
            if (fileType === 'document' || fileType === 'photo') {
                const extractedVacancy = await aiAnalyzer.extractVacancyFromFile(fileUrl, 'uploaded_file');
                if (extractedVacancy && extractedVacancy.has_vacancy) {
                    vacancyData = extractedVacancy;
                    userRequest = `Update my CV for ${vacancyData.position} at ${vacancyData.company}`;
                    await sendMarkdown(ctx, `📊 *Vacancy Detected:*
• Position: ${vacancyData.position}
• Company: ${vacancyData.company}
• Requirements: ${vacancyData.requirements.slice(0, 3).join(', ')}

I'll tailor your CV for this role.`);
                }
            }
        }
        
        const result = await intelligentUpdate.processUpdate(
            session.data.existing_cv,
            userRequest,
            vacancyData
        );
        
        if (!result.success) {
            await sendMarkdown(ctx, `❌ I couldn't understand your request. Please be more specific.

*Examples of what you can say:*
• "Add 3 years as Marketing Manager at XYZ Ltd"
• "Remove my diploma in Business"
• "Update my email to new@email.com"
• "Add a section for Volunteer Experience"

Or type /cancel to go back.`);
            return;
        }
        
        let changeSummary = `📝 *Proposed Changes:*\n\n`;
        for (const change of result.changes_summary) {
            changeSummary += `• ${change}\n`;
        }
        
        if (vacancyData) {
            changeSummary += `\n🎯 *Tailored for:* ${vacancyData.position} at ${vacancyData.company}\n`;
        }
        
        changeSummary += `\nDo you approve these changes?`;
        
        session.data.proposed_cv = result.updated_cv;
        session.data.pending_update = true;
        
        await sendMarkdown(ctx, changeSummary, {
            reply_markup: { inline_keyboard: [
                [{ text: "✅ Approve Changes", callback_data: "approve_update" }],
                [{ text: "✏️ Modify Request", callback_data: "modify_update" }],
                [{ text: "❌ Cancel", callback_data: "cancel_update" }]
            ] }
        });
        
        await db.updateSession(session.id, 'reviewing_update', 'update', session.data);
        
    } catch (error) {
        console.error('Update request error:', error);
        await sendMarkdown(ctx, `⚠️ Something went wrong processing your request. Please try again or be more specific.`);
    }
}

async function handleApproveUpdate(ctx, client, session) {
    const updatedCV = session.data.proposed_cv;
    const orderId = `UPD_${Date.now()}_${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
    
    await db.createOrder({
        id: orderId,
        client_id: client.id,
        service: 'cv update',
        category: session.data.category || 'professional',
        delivery_option: 'standard',
        delivery_time: '6 hours',
        base_price: getBasePrice('professional', 'cv update'),
        delivery_fee: 0,
        total_charge: formatPrice(getBasePrice('professional', 'cv update')),
        payment_status: 'pending',
        cv_data: updatedCV
    });
    
    await cvVersioning.saveVersion(orderId, updatedCV, 2, 'Intelligent update');
    
    await sendMarkdown(ctx, `✅ *Update Applied Successfully!*

Your CV has been updated as requested.

Order: \`${orderId}\`
Total: ${formatPrice(getBasePrice('professional', 'cv update'))}

Type /pay to complete payment and receive your updated CV.`);
    
    session.data.awaiting_update_request = false;
    session.data.pending_update = false;
    await db.updateSession(session.id, 'awaiting_payment_choice', 'payment', session.data);
}

// ============ HANDLE BUILD METHOD ============
async function handleBuildMethod(ctx, client, session, data) {
    if (data === 'build_draft') {
        session.data.build_method = 'draft';
        
        await sendMarkdown(ctx, `📎 *Upload Your Draft*

Send me your existing CV or cover letter (PDF, DOCX, or image).

I'll extract all the information and only ask for what's missing!

*Supported formats:* PDF, DOCX, JPG, PNG

Type /skip to continue with manual entry.`);
        
        session.data.awaiting_draft_upload = true;
        await db.updateSession(session.id, 'awaiting_draft_upload', 'draft', session.data);
        
    } else if (data === 'build_manual') {
        session.data.build_method = 'manual';
        
        const basePrice = getBasePrice(session.data.category, session.data.service);
        session.data.base_price = basePrice;
        
        await sendMarkdown(ctx, `Base price: ${formatPrice(basePrice)}

*Delivery speed?*`, {
            reply_markup: { inline_keyboard: [
                [{ text: "🚚 Standard (6h)", callback_data: "delivery_standard" }],
                [{ text: "⚡ Express (2h) +3k", callback_data: "delivery_express" }],
                [{ text: "🏃 Rush (1h) +5k", callback_data: "delivery_rush" }]
            ] }
        });
        await db.updateSession(session.id, 'selecting_delivery', null, session.data);
    }
}

// ============ DELIVERY SELECTION ============
async function handleDeliverySelection(ctx, client, session, data) {
    const delivery = { 
        delivery_standard: 'standard', 
        delivery_express: 'express', 
        delivery_rush: 'rush' 
    }[data];
    
    session.data.delivery_option = delivery;
    session.data.delivery_time = DELIVERY_TIMES[delivery];
    
    const totalAmount = calculateTotal(session.data.category, session.data.service, delivery);
    session.data.total_charge = formatPrice(totalAmount);
    
    if (session.data.build_method === 'manual') {
        await portfolioCollector.askForPortfolio(ctx);
        await db.updateSession(session.id, 'collecting_portfolio', 'portfolio', session.data);
    } else if (session.data.build_method === 'draft_completed') {
        if (session.data.cv_data && Object.keys(session.data.cv_data).length > 0) {
            await smartDraft.collectNextMissingSection(ctx, client, session);
        } else {
            await portfolioCollector.askForPortfolio(ctx);
            await db.updateSession(session.id, 'collecting_portfolio', 'portfolio', session.data);
        }
    } else {
        await portfolioCollector.askForPortfolio(ctx);
        await db.updateSession(session.id, 'collecting_portfolio', 'portfolio', session.data);
    }
}

// ============ MAIN MENU HANDLER FOR KEYBOARD BUTTONS ============
async function handleMainMenu(ctx, client, session, text) {
    const serviceMap = {
        '📄 New CV': 'service_new',
        '📝 Editable CV': 'service_editable',
        '💌 Cover Letter': 'service_cover',
        '📎 Editable Cover Letter': 'service_editable_cover',
        '✏️ Update CV': 'service_update',
        '📎 Upload Draft': 'build_draft'
    };
    
    if (serviceMap[text]) {
        if (text === '📎 Upload Draft') {
            if (!session.data.category) {
                await sendMarkdown(ctx, `Please select your category first:`, {
                    reply_markup: { inline_keyboard: [
                        [{ text: "🎓 Student", callback_data: "cat_student" }],
                        [{ text: "📜 Recent Graduate", callback_data: "cat_recent" }],
                        [{ text: "💼 Professional", callback_data: "cat_professional" }],
                        [{ text: "🌱 Non-Working", callback_data: "cat_nonworking" }],
                        [{ text: "🔄 Returning Client", callback_data: "cat_returning" }]
                    ] }
                });
                return;
            }
            await handleBuildMethod(ctx, client, session, 'build_draft');
        } else {
            await handleServiceSelection(ctx, client, session, serviceMap[text]);
        }
        return;
    }
    
    if (text === 'ℹ️ About') {
        await sendMarkdown(ctx, `📄 *EasySuccor - Professional CVs*

Contact: +265 991 295 401
WhatsApp: +265 881 193 707

*Services:*
• New CV - MK6,000 - MK10,000
• Editable CV - MK8,000 - MK12,000
• Cover Letter - MK5,000 - MK6,000
• Editable Cover Letter - MK8,000
• CV Update - MK3,000 - MK6,000

*Delivery:* 6h (Standard), 2h (+3k), 1h (+5k)`);
        return;
    } else if (text === '📞 Contact') {
        await sendMarkdown(ctx, `📞 *Contact*

Airtel: 0991295401
Mpamba: 0886928639
Visa: 1005653618 (NBM)
WhatsApp: +265 881 193 707`);
        return;
    } else if (text === '🏠 Portal') {
        await showClientPortal(ctx, client);
        return;
    } else {
        await sendMarkdown(ctx, `Please select a category to get started:`, {
            reply_markup: { inline_keyboard: [
                [{ text: "🎓 Student", callback_data: "cat_student" }],
                [{ text: "📜 Recent Graduate", callback_data: "cat_recent" }],
                [{ text: "💼 Professional", callback_data: "cat_professional" }],
                [{ text: "🌱 Non-Working", callback_data: "cat_nonworking" }],
                [{ text: "🔄 Returning Client", callback_data: "cat_returning" }]
            ] }
        });
    }
}

// ============ FIXED HANDLE PORTFOLIO COLLECTION ============
async function handlePortfolioCollection(ctx, client, session, text) {
    try {
        if (!session) {
            console.error('Session is null/undefined');
            session = { data: {} };
        }
        if (!session.data) {
            session.data = {};
        }
        
        let portfolioLinks = [];
        
        if (text === 'skip' || (text && text.toLowerCase() === 'skip')) {
            portfolioLinks = [];
        } else if (text && typeof text === 'string') {
            const lines = text.split('\n');
            for (const line of lines) {
                const trimmed = line.trim();
                if (trimmed && (trimmed.startsWith('http://') || trimmed.startsWith('https://'))) {
                    portfolioLinks.push(trimmed);
                }
            }
        }
        
        session.data.portfolio_links = portfolioLinks;
        
        await sendMarkdown(ctx, `${getReaction()} ${session.data.portfolio_links.length > 0 ? 'Portfolio saved!' : 'No portfolio added.'}\n\nNow let's collect your details.\n\n${getQuestion('name')}`);
        
        await startDataCollection(ctx, client, session);
        
    } catch (error) {
        console.error('Portfolio collection error:', error);
        if (session && session.data) {
            session.data.portfolio_links = [];
        }
        await sendMarkdown(ctx, `Let's continue with your details.\n\n${getQuestion('name')}`);
        await startDataCollection(ctx, client, session);
    }
}

// ============ START DATA COLLECTION ============
async function startDataCollection(ctx, client, session) {
    // Ensure CV data exists using helper
    const cvData = ensureCVData(session);
    
    // Ensure portfolio_links exists
    if (!session.data.portfolio_links || !Array.isArray(session.data.portfolio_links)) {
        session.data.portfolio_links = [];
    }
    
    // Update portfolio in cv_data
    cvData.portfolio = session.data.portfolio_links;
    
    session.current_section = 'personal';
    session.data.collection_step = 'name';
    session.data.special_docs_list = [];
    await db.updateSession(session.id, 'collecting_personal', 'personal', session.data);
}

// ============ PERSONAL COLLECTION ============
async function handlePersonalCollection(ctx, client, session, text) {
    const cvData = ensureCVData(session);
    const personal = cvData.personal;
    const step = session.data.collection_step;
    
    if (step === 'name') {
        personal.full_name = text;
        session.data.collection_step = 'email';
        await sendMarkdown(ctx, getQuestion('email'));
    }
    else if (step === 'email') {
        personal.email = text;
        session.data.collection_step = 'phone';
        await sendMarkdown(ctx, getQuestion('phone'));
    }
    else if (step === 'phone') {
        personal.primary_phone = text;
        session.data.collection_step = 'alt_phone';
        await sendMarkdown(ctx, "Alternative phone? (or 'Skip') 📞");
    }
    else if (step === 'alt_phone') {
        personal.alternative_phone = text === 'Skip' ? null : text;
        session.data.collection_step = 'whatsapp';
        await sendMarkdown(ctx, "WhatsApp for delivery? (or 'Same') 📱");
    }
    else if (step === 'whatsapp') {
        personal.whatsapp_phone = text === 'Same' ? personal.primary_phone : text;
        session.data.collection_step = 'location';
        await sendMarkdown(ctx, "Where are you based? (City, Country) 📍\n*Example:* Lilongwe, Malawi");
    }
    else if (step === 'location') {
        personal.location = text;
        session.data.collection_step = 'physical_address';
        await sendMarkdown(ctx, "What's your physical address? 🏠\n*Example:* House No. 123, Area 47, Lilongwe\n\nClick the button below to skip.", {
            reply_markup: { inline_keyboard: [[{ text: "⏭️ Skip", callback_data: "skip_physical_address" }]] }
        });
    }
    else if (step === 'physical_address') {
        if (text.toLowerCase() !== 'skip') {
            personal.physical_address = text;
        }
        session.data.collection_step = 'nationality';
        await sendMarkdown(ctx, "What's your nationality? 🌍\n*Example:* Malawian\n\nClick the button below to skip.", {
            reply_markup: { inline_keyboard: [[{ text: "⏭️ Skip", callback_data: "skip_nationality" }]] }
        });
    }
    else if (step === 'nationality') {
        if (text.toLowerCase() !== 'skip') {
            personal.nationality = text;
        }
        session.data.collection_step = 'special_docs';
        await sendMarkdown(ctx, `📋 *Special Documents (Optional)*

Do you have any special documents? (e.g., Driver's License, Passport, Professional License, Work Permit)

Type each document name and number, one per line.

*Examples:*
• Driver's License: MW123456
• Passport: MW987654
• Professional License: TEVETA/2024/001

Type 'Skip' to continue or 'Done' when finished.`);
        session.data.special_docs_list = [];
    }
    else if (step === 'special_docs') {
        if (text.toLowerCase() === 'skip') {
            personal.special_documents = [];
            session.current_section = 'summary';
            session.data.collection_step = 'summary';
            await sendMarkdown(ctx, `${getReaction()}\n\n${getQuestion('summary')}`);
            await db.updateSession(session.id, 'collecting_summary', 'summary', session.data);
        } else if (text.toLowerCase() === 'done') {
            personal.special_documents = session.data.special_docs_list || [];
            session.current_section = 'summary';
            session.data.collection_step = 'summary';
            await sendMarkdown(ctx, `${getReaction()}\n\n${getQuestion('summary')}`);
            await db.updateSession(session.id, 'collecting_summary', 'summary', session.data);
        } else {
            session.data.special_docs_list.push(text);
            await sendMarkdown(ctx, `✓ Added. Any more special documents? (Type 'Done' when finished, or 'Skip' to skip this section)`);
        }
        return;
    }
    
    await db.updateSession(session.id, 'collecting_personal', 'personal', session.data);
}

async function handleSummaryCollection(ctx, client, session, text) {
    const cvData = ensureCVData(session);
    cvData.professional_summary = text;
    session.current_section = 'education';
    session.data.collection_step = 'level';
    await sendMarkdown(ctx, `✅ *Got it! Thanks for sharing.*

Now let's add your education details.

${getQuestion('education')}`);
    await db.updateSession(session.id, 'collecting_education', 'education', session.data);
}

// ============ EDUCATION COLLECTION ============
async function handleEducationCollection(ctx, client, session, text, callbackData = null) {
    const cvData = ensureCVData(session);
    const step = session.data.collection_step;
    const education = cvData.education;
    const currentEdu = session.data.current_edu || {};
    
    if (step === 'level') {
        currentEdu.level = text;
        session.data.current_edu = currentEdu;
        session.data.collection_step = 'field';
        await sendMarkdown(ctx, "Field of study? 📚\n*Example:* Computer Science");
    }
    else if (step === 'field') {
        currentEdu.field = text;
        session.data.collection_step = 'institution';
        await sendMarkdown(ctx, "Institution? 🏛️\n*Example:* University of Malawi");
    }
    else if (step === 'institution') {
        currentEdu.institution = text;
        session.data.collection_step = 'year';
        await sendMarkdown(ctx, "Year of completion? 📅\n*Example:* 2020");
    }
    else if (step === 'year') {
        currentEdu.year = text;
        education.push({ ...currentEdu });
        session.data.current_edu = null;
        session.data.collection_step = 'add_more';
        await sendMarkdown(ctx, `${getReaction()} Another qualification?`, {
            reply_markup: { inline_keyboard: [[{ text: "✅ Yes", callback_data: "edu_yes" }, { text: "❌ No", callback_data: "edu_no" }]] }
        });
    }
    else if (step === 'add_more') {
        if (callbackData === 'edu_yes') {
            session.data.collection_step = 'level';
            session.data.current_edu = {};
            await sendMarkdown(ctx, "Next qualification? 🎓");
        } else {
            session.current_section = 'employment';
            session.data.collection_step = 'title';
            session.data.current_job = {};
            cvData.employment = [];
            await sendMarkdown(ctx, `${random(RESPONSES.encouragements.sectionComplete)('Education')}\n\n${getQuestion('jobTitle')}`);
            await db.updateSession(session.id, 'collecting_employment', 'employment', session.data);
        }
    }
    
    await db.updateSession(session.id, 'collecting_education', 'education', session.data);
}

// ============ EMPLOYMENT COLLECTION ============
async function handleEmploymentCollection(ctx, client, session, text, callbackData = null) {
    // DEBUG LOGGING - Add this to track where it's failing
    console.log(`[DEBUG] EmploymentCollection - Step: ${session.data.collection_step}, Text: "${text?.substring(0, 50)}", Callback: ${callbackData}`);
    
    const cvData = ensureCVData(session);
    let step = session.data.collection_step;
    const employment = cvData.employment;
    let currentJob = session.data.current_job || {};
    
    // STATE VALIDATION - Fix stuck states
    if (!step) {
        console.error(`[ERROR] No collection_step found! Resetting employment collection`);
        session.data.collection_step = 'title';
        session.data.current_job = {};
        await sendMarkdown(ctx, "Let's start over with your work experience.\n\nMost recent job title? 💼");
        await db.updateSession(session.id, 'collecting_employment', 'employment', session.data);
        return;
    }
    
    // SMART PARSING - Handle "Intern at Google" format
    if (step === 'title' && text && text.toLowerCase().includes(' at ')) {
        const atIndex = text.toLowerCase().lastIndexOf(' at ');
        const title = text.substring(0, atIndex).trim();
        const company = text.substring(atIndex + 4).trim();
        
        console.log(`[DEBUG] Parsed combined input: title="${title}", company="${company}"`);
        
        if (title && company) {
            currentJob.title = title;
            currentJob.company = company;
            session.data.current_job = currentJob;
            session.data.collection_step = 'duration';
            await sendMarkdown(ctx, `✓ Title: ${title}\n✓ Company: ${company}\n\nDuration? 📅\n*Example:* Jan 2020 - Present (3 years)`);
            await db.updateSession(session.id, 'collecting_employment', 'employment', session.data);
            return;
        }
    }
    
    // EMPTY VALIDATION - Prevent empty submissions
    if (step === 'title' && (!text || text.trim() === '')) {
        await sendMarkdown(ctx, "❌ Job title cannot be empty. Please enter a valid job title.\n\n*Example:* Software Engineer, Intern, Project Manager");
        return;
    }
    
    if (step === 'company' && (!text || text.trim() === '')) {
        await sendMarkdown(ctx, "❌ Company name cannot be empty. Please enter the company name.\n\n*Example:* ABC Corporation, Google, UNDP");
        return;
    }
    
    if (step === 'duration' && (!text || text.trim() === '')) {
        await sendMarkdown(ctx, "❌ Duration cannot be empty. Please enter the duration.\n\n*Example:* Jan 2020 - Present (3 years)");
        return;
    }
    
    // MAIN COLLECTION LOGIC
    if (step === 'title') {
        currentJob.title = text;
        session.data.current_job = currentJob;
        session.data.collection_step = 'company';
        
        console.log(`[DEBUG] Title saved: "${text}", moving to company step`);
        
        await sendMarkdown(ctx, "Company name? 🏢\n*Example:* ABC Corporation");
    }
    else if (step === 'company') {
        currentJob.company = text;
        session.data.current_job = currentJob;
        session.data.collection_step = 'duration';
        
        console.log(`[DEBUG] Company saved: "${text}", moving to duration step`);
        
        await sendMarkdown(ctx, "Duration? 📅\n*Example:* Jan 2020 - Present (3 years)");
    }
    else if (step === 'duration') {
        currentJob.duration = text;
        session.data.current_job = currentJob;
        session.data.collection_step = 'responsibilities';
        currentJob.responsibilities = [];
        
        console.log(`[DEBUG] Duration saved: "${text}", moving to responsibilities step`);
        
        await sendMarkdown(ctx, `📋 *Key Responsibilities*

List your main responsibilities, one per line.

*Example:*
• Led a team of 5 developers
• Increased efficiency by 30%
• Managed client relationships

Type \`DONE\` when finished, or \`SKIP\` if no responsibilities to add.`);
    }
    else if (step === 'responsibilities') {
        const upperText = text.toUpperCase();
        
        // Handle SKIP command
        if (upperText === 'SKIP') {
            console.log(`[DEBUG] User skipped responsibilities`);
            employment.push({ ...currentJob });
            session.data.current_job = null;
            session.data.collection_step = 'add_more';
            await sendMarkdown(ctx, `${getReaction()} Job saved! Another job?`, {
                reply_markup: { inline_keyboard: [[{ text: "✅ Yes", callback_data: "emp_yes" }, { text: "❌ No", callback_data: "emp_no" }]] }
            });
        }
        // Handle DONE command
        else if (upperText === 'DONE') {
            if (currentJob.responsibilities.length === 0) {
                await sendMarkdown(ctx, `⚠️ You haven't added any responsibilities. Type \`SKIP\` to continue without responsibilities, or add at least one responsibility.`);
                return;
            }
            
            console.log(`[DEBUG] Responsibilities complete (${currentJob.responsibilities.length} items), saving job`);
            employment.push({ ...currentJob });
            session.data.current_job = null;
            session.data.collection_step = 'add_more';
            await sendMarkdown(ctx, `${getReaction()} ✓ Job saved successfully! Another job?`, {
                reply_markup: { inline_keyboard: [[{ text: "✅ Yes", callback_data: "emp_yes" }, { text: "❌ No", callback_data: "emp_no" }]] }
            });
        }
        // Add responsibility
        else {
            currentJob.responsibilities.push(text);
            session.data.current_job = currentJob;
            console.log(`[DEBUG] Added responsibility (${currentJob.responsibilities.length} total): "${text.substring(0, 50)}"`);
            await sendMarkdown(ctx, `✓ Added. Another responsibility? (type \`DONE\` when finished, \`SKIP\` to skip remaining)`);
        }
    }
    else if (step === 'add_more') {
        if (callbackData === 'emp_yes') {
            session.data.collection_step = 'title';
            session.data.current_job = {};
            console.log(`[DEBUG] User wants to add another job, resetting to title step`);
            await sendMarkdown(ctx, "Next job title? 💼\n*Example:* Senior Developer, Marketing Manager");
        } else {
            // Move to skills section
            session.current_section = 'skills';
            session.data.collection_step = 'skills';
            console.log(`[DEBUG] Employment collection complete, moving to skills section`);
            await sendMarkdown(ctx, `${random(RESPONSES.encouragements.sectionComplete)('Employment')}\n\n${getQuestion('skills')}`);
            await db.updateSession(session.id, 'collecting_skills', 'skills', session.data);
            return; // Early return to avoid double update
        }
    }
    
    // Save session after each step
    await db.updateSession(session.id, 'collecting_employment', 'employment', session.data);
}

async function handleSkillsCollection(ctx, client, session, text) {
    const cvData = ensureCVData(session);
    cvData.skills = text.split(',').map(s => s.trim());
    session.current_section = 'certifications';
    session.data.collection_step = 'name';
    cvData.certifications = [];
    await sendMarkdown(ctx, `${getReaction()} Any certifications? (or 'Skip') 📜`);
    await db.updateSession(session.id, 'collecting_certifications', 'certifications', session.data);
}

async function handleCertificationsCollection(ctx, client, session, text, callbackData = null) {
    const cvData = ensureCVData(session);
    const step = session.data.collection_step;
    const certifications = cvData.certifications;
    const currentCert = session.data.current_cert || {};
    
    if (step === 'name') {
        if (text === 'Skip' || callbackData === 'cert_skip') {
            session.current_section = 'languages';
            session.data.collection_step = 'name';
            cvData.languages = [];
            await sendMarkdown(ctx, `${getReaction()} Languages you speak? (or 'Skip') 🗣️`);
            await db.updateSession(session.id, 'collecting_languages', 'languages', session.data);
            return;
        }
        currentCert.name = text;
        session.data.current_cert = currentCert;
        session.data.collection_step = 'issuer';
        await sendMarkdown(ctx, "Issuing organization? 🏛️\n*Example:* TEVETA");
    }
    else if (step === 'issuer') {
        currentCert.issuer = text;
        session.data.collection_step = 'year';
        await sendMarkdown(ctx, "Year obtained? 📅\n*Example:* 2022");
    }
    else if (step === 'year') {
        currentCert.year = text;
        certifications.push({ ...currentCert });
        session.data.current_cert = null;
        session.data.collection_step = 'add_more';
        await sendMarkdown(ctx, `${getReaction()} Another certification?`, {
            reply_markup: { inline_keyboard: [[{ text: "✅ Yes", callback_data: "cert_yes" }, { text: "❌ No", callback_data: "cert_no" }, { text: "⏭️ Skip", callback_data: "cert_skip" }]] }
        });
    }
    else if (step === 'add_more') {
        if (callbackData === 'cert_yes') {
            session.data.collection_step = 'name';
            session.data.current_cert = {};
            await sendMarkdown(ctx, "Certification name? 📜");
        } else {
            session.current_section = 'languages';
            session.data.collection_step = 'name';
            cvData.languages = [];
            await sendMarkdown(ctx, `${getReaction()} Languages you speak? (or 'Skip') 🗣️`);
            await db.updateSession(session.id, 'collecting_languages', 'languages', session.data);
        }
    }
    
    await db.updateSession(session.id, 'collecting_certifications', 'certifications', session.data);
}

async function handleLanguagesCollection(ctx, client, session, text, callbackData = null) {
    const cvData = ensureCVData(session);
    const step = session.data.collection_step;
    const languages = cvData.languages;
    const currentLang = session.data.current_lang || {};
    
    if (step === 'name') {
        if (text === 'Skip' || callbackData === 'lang_skip') {
            session.current_section = 'referees';
            session.data.collection_step = 'name';
            cvData.referees = [];
            await sendMarkdown(ctx, `Got it! ${getReaction()}\n\nProfessional referees? (Minimum 2 required) 👥\n\nReferee 1 - Full name?`);
            await db.updateSession(session.id, 'collecting_referees', 'referees', session.data);
            return;
        }
        currentLang.name = text;
        session.data.current_lang = currentLang;
        session.data.collection_step = 'proficiency';
        await sendMarkdown(ctx, "Level?", {
            reply_markup: { inline_keyboard: [
                [{ text: "🔰 Basic", callback_data: "prof_basic" }],
                [{ text: "📖 Intermediate", callback_data: "prof_intermediate" }],
                [{ text: "⭐ Fluent", callback_data: "prof_fluent" }]
            ] }
        });
    }
    else if (step === 'proficiency') {
        let proficiency = { prof_basic: 'Basic', prof_intermediate: 'Intermediate', prof_fluent: 'Fluent' }[callbackData] || text;
        currentLang.proficiency = proficiency;
        languages.push({ ...currentLang });
        session.data.current_lang = null;
        session.data.collection_step = 'add_more';
        await sendMarkdown(ctx, `${getReaction()} Another language?`, {
            reply_markup: { inline_keyboard: [
                [{ text: "✅ Yes", callback_data: "lang_yes" }],
                [{ text: "❌ No", callback_data: "lang_no" }],
                [{ text: "⏭️ Skip", callback_data: "lang_skip" }]
            ] }
        });
    }
    else if (step === 'add_more') {
        if (callbackData === 'lang_yes') {
            session.data.collection_step = 'name';
            session.data.current_lang = {};
            await sendMarkdown(ctx, "Language name? 🗣️");
        } else {
            session.current_section = 'referees';
            session.data.collection_step = 'name';
            cvData.referees = [];
            await sendMarkdown(ctx, `${random(RESPONSES.encouragements.sectionComplete)('Languages')}\n\nProfessional referees? (Minimum 2 required) 👥\n\nReferee 1 - Full name?`);
            await db.updateSession(session.id, 'collecting_referees', 'referees', session.data);
        }
    }
    
    await db.updateSession(session.id, 'collecting_languages', 'languages', session.data);
}

async function handleRefereesCollection(ctx, client, session, text, callbackData = null) {
    const cvData = ensureCVData(session);
    const step = session.data.collection_step;
    const referees = cvData.referees;
    const currentRef = session.data.current_ref || {};
    const refereeCount = referees.length;
    const minReferees = 2;
    
    if (step === 'name') {
        if (text === 'Skip') {
            await sendMarkdown(ctx, `⚠️ Need at least ${minReferees} referees! Referee ${refereeCount + 1} - Full name?`);
            return;
        }
        currentRef.name = text;
        session.data.current_ref = currentRef;
        session.data.collection_step = 'position';
        await sendMarkdown(ctx, `Referee ${refereeCount + 1} - Their position? 📌\n*Example:* Senior Manager`);
    }
    else if (step === 'position') {
        currentRef.position = text;
        session.data.collection_step = 'contact';
        await sendMarkdown(ctx, `Referee ${refereeCount + 1} - Contact? (phone or email) 📞\n*Example:* +265 991 234 567 or jane@example.com`);
    }
    else if (step === 'contact') {
        currentRef.contact = text;
        referees.push({ ...currentRef });
        session.data.current_ref = null;
        if (referees.length < minReferees) {
            session.data.collection_step = 'name';
            await sendMarkdown(ctx, `✅ Referee ${referees.length} added. Need ${minReferees - referees.length} more.\n\nReferee ${referees.length + 1} - Full name?`);
        } else {
            await finalizeOrder(ctx, client, session);
        }
    }
    
    await db.updateSession(session.id, 'collecting_referees', 'referees', session.data);
}

async function handleUpdateFlow(ctx, client, session) {
    await handleIntelligentUpdate(ctx, client, session);
}

async function handleUpdateCollection(ctx, client, session, text) {
    await handleUpdateRequest(ctx, client, session, text);
}

async function finalizeOrder(ctx, client, session) {
    const cvData = ensureCVData(session);
    const personal = cvData.personal;
    const name = personal?.full_name || ctx.from.first_name;
    const orderId = `ORD_${Date.now()}_${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
    
    if (personal?.email) await db.updateClient(client.id, { email: personal.email });
    if (personal?.primary_phone) await db.updateClient(client.id, { phone: personal.primary_phone });
    if (personal?.location) await db.updateClient(client.id, { location: personal.location });
    if (personal?.physical_address) await db.updateClient(client.id, { physical_address: personal.physical_address });
    if (personal?.nationality) await db.updateClient(client.id, { nationality: personal.nationality });
    if (personal?.special_documents) await db.updateClient(client.id, { special_documents: JSON.stringify(personal.special_documents) });
    
    await cvVersioning.saveVersion(orderId, cvData, 1, 'Initial CV creation');
    
    const cvResult = await documentGenerator.generateCV(cvData, null, 'docx', session.data.vacancy_data || null, session.data.certificates_data || null);
    
    await db.createOrder({
        id: orderId, client_id: client.id, service: session.data.service, category: session.data.category || 'professional',
        delivery_option: session.data.delivery_option, delivery_time: session.data.delivery_time,
        base_price: session.data.base_price, delivery_fee: DELIVERY_PRICES[session.data.delivery_option] || 0,
        total_charge: session.data.total_charge, payment_status: session.data.payment_status || 'pending',
        cv_data: cvData, portfolio_links: JSON.stringify(session.data.portfolio_links || [])
    });
    session.data.order_id = orderId;
    
    const paymentOptions = await getPaymentOptions(session.data.total_charge, orderId, client.id);
    
    await sendMarkdown(ctx, `${random(RESPONSES.encouragements.final)(name)}\n\n📋 Order: \`${orderId}\`\n🚚 Delivery: ${session.data.delivery_time}\n💰 Total: ${session.data.total_charge}\n\n${paymentOptions.message}`);
    await db.updateSession(session.id, 'awaiting_payment_choice', 'payment', session.data);
    
    setTimeout(async () => {
        await collectFeedback(ctx, client, orderId);
    }, 7 * 24 * 60 * 60 * 1000);
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
    await sendMarkdown(ctx, `Payment processing...`);
}

async function showClientPortal(ctx, client) {
    const orders = await db.getClientOrders(client.id);
    let message = `🏠 *YOUR PORTAL*\n\n👤 ${client.first_name}\n📞 ${client.phone || 'Not set'}\n📧 ${client.email || 'Not set'}\n📍 ${client.location || 'Not set'}\n🌍 ${client.nationality || 'Not set'}\n📦 Orders: ${client.total_orders || 0}\n\n📄 *Documents:*\n`;
    
    if (orders.length > 0) {
        message += orders.slice(0, 5).map(o => `• ${o.service} - ${new Date(o.created_at).toLocaleDateString()}`).join('\n');
    } else {
        message += `No documents yet.`;
    }
    
    message += `\n\n/start - New order\n/mydocs - All documents\n/referral - Share & earn`;
    await sendMarkdown(ctx, message);
}

// ============ COVER LETTER HANDLERS WITH SAFE DATA ACCESS ============
async function handleCoverLetterStart(ctx, client, session) {
    ensureCoverLetterData(session);
    await sendMarkdown(ctx, `📢 *Cover Letter*

Share the job vacancy (screenshot, PDF, or text). I'll extract the details.`);
    session.data.awaiting_vacancy = true;
    await db.updateSession(session.id, 'awaiting_vacancy_upload', 'vacancy', session.data);
}

async function handleVacancyText(ctx, client, session, text) {
    ensureCoverLetterData(session);
    try {
        const vacancyData = aiAnalyzer.extractVacancyDetails(text);
        session.data.vacancy_data = vacancyData;
        session.data.awaiting_vacancy = false;
        await sendMarkdown(ctx, `Found: ${vacancyData.position} at ${vacancyData.company}\n\nPosition applying for? (or 'SAME')`);
        await db.updateSession(session.id, 'collecting_coverletter_position', 'coverletter', session.data);
    } catch (error) {
        console.error('Vacancy extraction error:', error);
        await sendMarkdown(ctx, `⚠️ Could not extract vacancy details. Please type the position you're applying for.`);
        session.data.awaiting_vacancy = false;
        await db.updateSession(session.id, 'collecting_coverletter_position', 'coverletter', session.data);
    }
}

async function handleCoverLetterPosition(ctx, client, session, text) {
    ensureCoverLetterData(session);
    session.data.coverletter_position = text.toLowerCase() === 'same' && session.data.vacancy_data?.position ? session.data.vacancy_data.position : text;
    await sendMarkdown(ctx, `Company name? 🏢`);
    await db.updateSession(session.id, 'collecting_coverletter_company', 'coverletter', session.data);
}

async function handleCoverLetterCompany(ctx, client, session, text) {
    ensureCoverLetterData(session);
    session.data.coverletter_company = text;
    
    // Validate required fields
    if (!session.data.coverletter_position || session.data.coverletter_position === 'Not specified') {
        await sendMarkdown(ctx, `⚠️ I need the position you're applying for. Please tell me the job title.`);
        return;
    }
    
    const orderId = `CL_${Date.now()}_${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
    
    // Get CV data if available (for personal info)
    const cvData = session.data.cv_data || {};
    
    // Create cover letter using document generator
    const coverResult = await documentGenerator.generateCoverLetter(
        { 
            position: session.data.coverletter_position, 
            company: session.data.coverletter_company 
        },
        cvData,
        null,
        false
    );
    
    await db.createOrder({
        id: orderId,
        client_id: client.id,
        service: 'cover letter',
        category: session.data.category || 'professional',
        delivery_option: 'standard',
        delivery_time: '6 hours',
        base_price: 5000,
        delivery_fee: 0,
        total_charge: 'MK5,000',
        payment_status: 'pending',
        cv_data: { 
            coverletter: {
                position: session.data.coverletter_position,
                company: session.data.coverletter_company,
                vacancy: session.data.vacancy_data
            }
        }
    });
    
    await sendMarkdown(ctx, `🎉 Cover letter ready!\n\nOrder: \`${orderId}\`\nPosition: ${session.data.coverletter_position}\nCompany: ${session.data.coverletter_company}\nTotal: MK5,000\n\nType /pay when ready.`);
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
    await sendMarkdown(ctx, msg || "No documents yet.");
});

bot.command('referral', async (ctx) => {
    const client = await getOrCreateClient(ctx);
    const refInfo = await db.getReferralInfo(client.id);
    await sendMarkdown(ctx, `🎁 *REFERRAL PROGRAM*\n\nYour code: \`${refInfo.referral_code}\`\n\nShare: https://t.me/${ctx.botInfo.username}?start=ref_${refInfo.referral_code}\n\nReferrals: ${refInfo.total_referrals}\nPending reward: MK${refInfo.pending_reward}\n\nFriend gets 10% off, you get MK2,000 credit!`);
});

bot.command('pay', async (ctx) => {
    const client = await getOrCreateClient(ctx);
    const session = await db.getActiveSession(client.id);
    if (session && session.data.total_charge) {
        await initiatePaymentFlow(ctx, client, session, '1');
    } else {
        await sendMarkdown(ctx, `No active order. Type /start to begin.`);
    }
});

bot.command('pause', async (ctx) => {
    const client = await getOrCreateClient(ctx);
    const session = await db.getActiveSession(client.id);
    if (session && session.stage !== 'main_menu') {
        session.is_paused = true;
        await db.updateSession(session.id, session.stage, session.current_section, session.data, 1);
        await sendMarkdown(ctx, `⏸️ *Session Paused*\n\nType /resume when ready.`);
    } else {
        await sendMarkdown(ctx, `No active session to pause.`);
    }
});

bot.command('resume', async (ctx) => {
    const client = await getOrCreateClient(ctx);
    const pausedSession = await db.getPausedSession(client.id);
    if (pausedSession) {
        pausedSession.data = JSON.parse(pausedSession.data);
        
        let resumeStage = pausedSession.stage;
        let resumeMessage = "";
        
        if (resumeStage === 'collecting_personal') {
            const step = pausedSession.data.collection_step;
            if (step === 'name') resumeMessage = getQuestion('name');
            else if (step === 'email') resumeMessage = getQuestion('email');
            else if (step === 'phone') resumeMessage = getQuestion('phone');
            else if (step === 'alt_phone') resumeMessage = "Alternative phone? (or 'Skip') 📞";
            else if (step === 'whatsapp') resumeMessage = "WhatsApp for delivery? (or 'Same') 📱";
            else if (step === 'location') resumeMessage = "Where are you based? (City, Country) 📍";
            else if (step === 'physical_address') resumeMessage = "What's your physical address? 🏠 (or 'Skip')";
            else if (step === 'nationality') resumeMessage = "What's your nationality? 🌍 (or 'Skip')";
            else if (step === 'special_docs') resumeMessage = "Special documents? (Type 'Skip' or 'Done')";
            else resumeMessage = getQuestion('name');
        } else if (resumeStage === 'collecting_summary') {
            resumeMessage = getQuestion('summary');
        } else if (resumeStage === 'collecting_education') {
            const step = pausedSession.data.collection_step;
            if (step === 'level') resumeMessage = "Highest qualification? 🎓";
            else if (step === 'field') resumeMessage = "Field of study? 📚";
            else if (step === 'institution') resumeMessage = "Institution? 🏛️";
            else if (step === 'year') resumeMessage = "Year of completion? 📅";
            else resumeMessage = "Highest qualification? 🎓";
        } else if (resumeStage === 'collecting_employment') {
            const step = pausedSession.data.collection_step;
            if (step === 'title') resumeMessage = getQuestion('jobTitle');
            else if (step === 'company') resumeMessage = "Company name? 🏢";
            else if (step === 'duration') resumeMessage = "Duration? (e.g., Jan 2020 - Present) 📅";
            else if (step === 'responsibilities') resumeMessage = "Key responsibilities? One per line. Type DONE when finished.";
            else resumeMessage = getQuestion('jobTitle');
        } else if (resumeStage === 'collecting_skills') {
            resumeMessage = getQuestion('skills');
        } else if (resumeStage === 'collecting_certifications') {
            resumeMessage = "Any certifications? (or 'Skip') 📜";
        } else if (resumeStage === 'collecting_languages') {
            resumeMessage = "Languages you speak? (or 'Skip') 🗣️";
        } else if (resumeStage === 'collecting_referees') {
            resumeMessage = "Professional referees? (Minimum 2 required) 👥\n\nReferee 1 - Full name?";
        } else if (resumeStage === 'collecting_missing') {
            resumeMessage = "Let's continue with your missing information.";
        } else if (resumeStage === 'awaiting_update_request') {
            resumeMessage = "You were updating your CV. Please tell me what changes you want.";
        } else if (resumeStage === 'awaiting_vacancy_upload') {
            resumeMessage = "You were creating a cover letter. Please share the job vacancy.";
        } else {
            resumeMessage = "Let's continue where we left off.";
        }
        
        await db.updateSession(pausedSession.id, pausedSession.stage, pausedSession.current_section, pausedSession.data, 0);
        await sendMarkdown(ctx, `🔄 Welcome back! Let's continue.\n\n${resumeMessage}`);
    } else {
        await sendMarkdown(ctx, `No paused session found. Type /start to begin fresh.`);
    }
});

bot.command('confirm', async (ctx) => {
    const args = ctx.message.text.split(' ');
    if (args.length < 2) { await sendMarkdown(ctx, "Usage: /confirm REFERENCE"); return; }
    await sendMarkdown(ctx, `✅ Payment confirmation received! Reference: ${args[1]}\n\nOur team will verify shortly.`);
});

bot.command('verify', async (ctx) => {
    if (ctx.from.id.toString() !== process.env.ADMIN_CHAT_ID) return await sendMarkdown(ctx, "Unauthorized.");
    const args = ctx.message.text.split(' ');
    if (args.length < 2) return await sendMarkdown(ctx, "Usage: /verify REFERENCE");
    await sendMarkdown(ctx, `✅ Payment verified for ${args[1]}`);
});

bot.command('feedback', async (ctx) => {
    const client = await getOrCreateClient(ctx);
    const orders = await db.getClientOrders(client.id);
    const lastOrder = orders[orders.length - 1];
    
    if (lastOrder) {
        await collectFeedback(ctx, client, lastOrder.id);
    } else {
        await sendMarkdown(ctx, `You haven't ordered any documents yet. Type /start to create one!`);
    }
});

bot.command('testimonials', async (ctx) => {
    const testimonials = await db.getApprovedTestimonials(10);
    if (testimonials.length === 0) {
        await sendMarkdown(ctx, `No testimonials yet. Be the first to share your success story with /feedback after you get a job! 🎯`);
    } else {
        let message = `🌟 *Success Stories*\n\n`;
        for (const t of testimonials) {
            message += `⭐️⭐️⭐️⭐️⭐️ "${t.text}"\n— ${t.name}\n\n`;
        }
        await sendMarkdown(ctx, message);
    }
});

bot.command('reset', async (ctx) => {
    const client = await getOrCreateClient(ctx);
    await db.endSession(client.id);
    await sendMarkdown(ctx, `🔄 *Session reset.* Type /start to begin fresh.`);
});

bot.help(async (ctx) => {
    await sendMarkdown(ctx, `🆘 *Help*

/start - Begin
/resume - Continue paused
/pause - Save progress
/pay - Make payment
/portal - Dashboard
/mydocs - Documents
/referral - Share & earn
/feedback - Share your experience
/testimonials - See success stories
/reset - Reset current session

Contact: +265 991 295 401`);
});

// ============ FILE UPLOAD HANDLERS ============
bot.on('document', async (ctx) => {
    try {
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
            await sendMarkdown(ctx, `📄 Processed! Found ${vacancyData.position || 'position'}.\n\nApplying for? (or 'SAME')`);
            await db.updateSession(session.id, 'collecting_coverletter_position', 'coverletter', session.data);
        } 
        else if (session.stage === 'awaiting_draft_upload' || session.data.awaiting_draft_upload) {
            await sendMarkdown(ctx, `📄 Processing your draft... This may take a moment.`);
            const fileInfo = await ctx.telegram.getFile(document.file_id);
            const fileUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${fileInfo.file_path}`;
            
            const success = await smartDraft.processDraftUpload(ctx, client, session, fileUrl, fileName);
            if (success) {
                session.data.awaiting_draft_upload = false;
                session.data.build_method = 'draft_completed';
                
                const basePrice = getBasePrice(session.data.category, session.data.service);
                session.data.base_price = basePrice;
                
                await sendMarkdown(ctx, `✅ *Draft processed successfully!*\n\nBase price: ${formatPrice(basePrice)}\n\n*Delivery speed?*`, {
                    reply_markup: { inline_keyboard: [
                        [{ text: "🚚 Standard (6h)", callback_data: "delivery_standard" }],
                        [{ text: "⚡ Express (2h) +3k", callback_data: "delivery_express" }],
                        [{ text: "🏃 Rush (1h) +5k", callback_data: "delivery_rush" }]
                    ] }
                });
                await db.updateSession(session.id, 'selecting_delivery', null, session.data);
            }
        }
        else if (session.stage === 'awaiting_update_request') {
            const fileInfo = await ctx.telegram.getFile(document.file_id);
            const fileUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${fileInfo.file_path}`;
            await handleUpdateRequest(ctx, client, session, null, fileUrl, 'document');
        }
        else {
            await sendMarkdown(ctx, `📎 *Draft Upload*\n\nYou can upload an existing CV or cover letter and I'll extract everything!\n\nJust send me the file (PDF, DOCX, or image).`);
            session.data.awaiting_draft_upload = true;
            await db.updateSession(session.id, 'awaiting_draft_upload', 'draft', session.data);
        }
    } catch (error) {
        console.error('Document handler error:', error);
        await sendMarkdown(ctx, `⚠️ Something went wrong processing your file. Please try again.`);
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
        await sendMarkdown(ctx, `📸 Image processed! Found ${vacancyData.position || 'position'}.\n\nApplying for? (or 'SAME')`);
        await db.updateSession(session.id, 'collecting_coverletter_position', 'coverletter', session.data);
    } 
    else if (session.stage === 'awaiting_draft_upload' || session.data.awaiting_draft_upload) {
        await sendMarkdown(ctx, `📸 Processing your image...`);
        const fileInfo = await ctx.telegram.getFile(photo.file_id);
        const fileUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${fileInfo.file_path}`;
        
        const success = await smartDraft.processDraftUpload(ctx, client, session, fileUrl, 'image.jpg');
        if (success) {
            session.data.awaiting_draft_upload = false;
            session.data.build_method = 'draft_completed';
            
            const basePrice = getBasePrice(session.data.category, session.data.service);
            session.data.base_price = basePrice;
            
            await sendMarkdown(ctx, `✅ *Draft processed successfully!*\n\nBase price: ${formatPrice(basePrice)}\n\n*Delivery speed?*`, {
                reply_markup: { inline_keyboard: [
                    [{ text: "🚚 Standard (6h)", callback_data: "delivery_standard" }],
                    [{ text: "⚡ Express (2h) +3k", callback_data: "delivery_express" }],
                    [{ text: "🏃 Rush (1h) +5k", callback_data: "delivery_rush" }]
                ] }
            });
            await db.updateSession(session.id, 'selecting_delivery', null, session.data);
        }
    }
    else if (session.stage === 'awaiting_update_request') {
        const fileInfo = await ctx.telegram.getFile(photo.file_id);
        const fileUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${fileInfo.file_path}`;
        await handleUpdateRequest(ctx, client, session, null, fileUrl, 'photo');
    }
    else {
        await sendMarkdown(ctx, `📎 *Upload Draft*\n\nYou can upload an image of your CV/cover letter and I'll extract the information!`);
        session.data.awaiting_draft_upload = true;
        await db.updateSession(session.id, 'awaiting_draft_upload', 'draft', session.data);
    }
});

// ============ TEXT MESSAGE HANDLER ============
bot.on('text', async (ctx) => {
    const text = ctx.message.text;
    const client = await getOrCreateClient(ctx);
    const session = await getOrCreateSession(client.id);
    
    const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Handler timeout')), 30000);
    });
    
    try {
        await Promise.race([
            (async () => {
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
                else if (session.stage === 'collecting_feedback') await handleFeedback(ctx, client, session, text);
                else if (session.stage === 'awaiting_vacancy_upload') await handleVacancyText(ctx, client, session, text);
                else if (session.stage === 'awaiting_update_request') await handleUpdateRequest(ctx, client, session, text);
                else if (session.stage === 'collecting_coverletter_position') await handleCoverLetterPosition(ctx, client, session, text);
                else if (session.stage === 'collecting_coverletter_company') await handleCoverLetterCompany(ctx, client, session, text);
                else if (session.stage === 'awaiting_payment_choice') {
                    if (text === '1' || text === '2' || text === '3' || text === '4') {
                        await initiatePaymentFlow(ctx, client, session, text);
                    } else if (text.toLowerCase() === 'pay later') {
                        session.data.payment_status = 'pending';
                        await db.updateSession(session.id, 'payment_completed', 'payment', session.data);
                        await sendMarkdown(ctx, `⏳ *Pay later selected.* Let's build your CV! ${getReaction()}`);
                        await startDataCollection(ctx, client, session);
                    } else { 
                        await sendMarkdown(ctx, `Please select 1, 2, 3, or 4.`);
                    }
                }
                else {
                    await sendMarkdown(ctx, random(RESPONSES.help));
                }
            })(),
            timeoutPromise
        ]);
    } catch (error) {
        console.error('Text handler error:', error);
        await sendMarkdown(ctx, `⚠️ *Something went wrong.* Please try again or type /start to restart.`);
    }
});

// ============ CALLBACK QUERY HANDLER ============
bot.on('callback_query', async (ctx) => {
    await ctx.answerCbQuery();
    const data = ctx.callbackQuery.data;
    const client = await getOrCreateClient(ctx);
    const session = await getOrCreateSession(client.id);
    
    if (data.startsWith('cat_')) {
        await handleCategorySelection(ctx, client, session, data);
    }
    else if (data === 'portfolio_skip') {
        await handlePortfolioCollection(ctx, client, session, 'skip');
    }
    else if (data === 'skip_physical_address') {
        await handlePersonalCollection(ctx, client, session, 'skip');
    }
    else if (data === 'skip_nationality') {
        await handlePersonalCollection(ctx, client, session, 'skip');
    }
    else if (data.startsWith('service_')) {
        await handleServiceSelection(ctx, client, session, data);
    }
    else if (data === 'build_draft' || data === 'build_manual') {
        await handleBuildMethod(ctx, client, session, data);
    }
    else if (data.startsWith('delivery_')) {
        await handleDeliverySelection(ctx, client, session, data);
    }
    else if (data === 'approve_update') {
        await handleApproveUpdate(ctx, client, session);
    }
    else if (data === 'modify_update') {
        await sendMarkdown(ctx, `✏️ Please tell me what changes you want to make to the proposed update.`);
        session.data.awaiting_update_request = true;
        await db.updateSession(session.id, 'awaiting_update_request', 'update', session.data);
    }
    else if (data === 'cancel_update') {
        session.data.awaiting_update_request = false;
        session.data.pending_update = false;
        await sendMarkdown(ctx, `❌ Update cancelled. Type /start to return to main menu.`);
        await db.updateSession(session.id, 'main_menu', null, session.data);
    }
    else if (data === 'edu_yes' || data === 'edu_no') {
        await handleEducationCollection(ctx, client, session, '', data);
    }
    else if (data === 'emp_yes' || data === 'emp_no') {
        await handleEmploymentCollection(ctx, client, session, '', data);
    }
    else if (data === 'cert_yes' || data === 'cert_no' || data === 'cert_skip') { 
        if (data === 'cert_skip') {
            await handleCertificationsCollection(ctx, client, session, 'Skip', data); 
        } else {
            await handleCertificationsCollection(ctx, client, session, '', data); 
        }
    }
    else if (data === 'lang_yes' || data === 'lang_no' || data === 'lang_skip') { 
        if (data === 'lang_skip') {
            await handleLanguagesCollection(ctx, client, session, 'Skip', data); 
        } else {
            await handleLanguagesCollection(ctx, client, session, '', data); 
        }
    }
    else if (data === 'more_work_yes' || data === 'more_work_no') {
        if (data === 'more_work_yes') {
            session.data.collection_step = 'title';
            session.data.current_job = {};
            await sendMarkdown(ctx, "Next job title? 💼");
            await db.updateSession(session.id, 'collecting_employment', 'employment', session.data);
        } else {
            session.current_section = 'skills';
            session.data.collection_step = 'skills';
            await sendMarkdown(ctx, `${random(RESPONSES.encouragements.sectionComplete)('Employment')}\n\n${getQuestion('skills')}`);
            await db.updateSession(session.id, 'collecting_skills', 'skills', session.data);
        }
    }
    else if (data === 'more_edu_yes' || data === 'more_edu_no') {
        if (data === 'more_edu_yes') {
            session.data.collection_step = 'level';
            session.data.current_edu = {};
            await sendMarkdown(ctx, "Next qualification? 🎓");
            await db.updateSession(session.id, 'collecting_education', 'education', session.data);
        } else {
            session.current_section = 'employment';
            session.data.collection_step = 'title';
            session.data.current_job = {};
            session.data.cv_data.employment = [];
            await sendMarkdown(ctx, `${random(RESPONSES.encouragements.sectionComplete)('Education')}\n\n${getQuestion('jobTitle')}`);
            await db.updateSession(session.id, 'collecting_employment', 'employment', session.data);
        }
    }
    else if (data === 'more_ref_yes' || data === 'more_ref_no') {
        if (data === 'more_ref_yes') {
            session.data.collection_step = 'name';
            session.data.current_ref = {};
            await sendMarkdown(ctx, `Next referee - Full name? 👥`);
            await db.updateSession(session.id, 'collecting_referees', 'referees', session.data);
        } else {
            await finalizeOrder(ctx, client, session);
        }
    }
    else if (data.startsWith('prof_')) {
        await handleLanguagesCollection(ctx, client, session, '', data);
    }
    else {
        console.log(`Unhandled callback data: ${data}`);
        await sendMarkdown(ctx, `⚠️ Something went wrong. Please type /start to restart.`);
    }
});

// ============ START BOT (RENDER PRODUCTION ONLY) ============
async function startBot() {
    await db.initDatabase();
    await loadTestimonialsCache();
    
    try {
        await bot.telegram.setMyCommands([
            { command: 'start', description: 'Start the bot' },
            { command: 'resume', description: 'Resume paused session' },
            { command: 'pause', description: 'Save progress and pause' },
            { command: 'pay', description: 'Make a payment' },
            { command: 'portal', description: 'Your dashboard' },
            { command: 'mydocs', description: 'Your documents' },
            { command: 'referral', description: 'Share & earn' },
            { command: 'feedback', description: 'Share your experience' },
            { command: 'testimonials', description: 'See success stories' },
            { command: 'reset', description: 'Reset current session' },
            { command: 'help', description: 'Get help' }
        ]);
        console.log('✅ Bot commands set');
    } catch (cmdError) {
        console.log('⚠️ Could not set commands:', cmdError.message);
    }
    
    const WEBHOOK_URL = process.env.WEBHOOK_URL || 'https://easysuccor-bot.onrender.com';
    const webhookPath = '/webhook';
    const fullWebhookUrl = `${WEBHOOK_URL}${webhookPath}`;
    
    try {
        await bot.telegram.setWebhook(fullWebhookUrl);
        console.log(`✅ Webhook set to ${fullWebhookUrl}`);
    } catch (webhookError) {
        console.error('❌ Failed to set webhook:', webhookError.message);
    }
    
    app.post(webhookPath, (req, res) => {
        bot.handleUpdate(req.body, res);
    });
    
    console.log('========================================');
    console.log('  🤖 EasySuccor Bot Running on Render');
    console.log('  ✅ Editable Cover Letter on keyboard');
    console.log('  ✅ Clickable skip buttons everywhere');
    console.log('  ✅ Smart Draft Upload - Auto-extracts data');
    console.log('  ✅ Physical address, nationality, special documents');
    console.log('  ✅ Intelligent CV Update - Natural language processing');
    console.log('  ✅ Safe CV and Cover Letter data handling');
    console.log('  ✅ Real testimonials (no fake data)');
    console.log('  ✅ Webhook mode (production)');
    console.log('========================================');
}

startBot().catch(console.error);
module.exports = bot;