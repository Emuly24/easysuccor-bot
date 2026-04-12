// ====================================================================
// BOT.JS - EASYSUCCOR TELEGRAM BOT
// COMPLETE PRODUCTION VERSION - UPDATED
// ====================================================================

const { Telegraf, Markup } = require('telegraf');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const axios = require('axios');
const express = require('express');  // ← ONLY ONCE!
const multer = require('multer');
const db = require('./database');
const payment = require('./payment');
const notificationService = require('./notification-service');
const documentGenerator = require('./document-generator');
const aiAnalyzer = require('./ai-analyzer');
const InstallmentTracker = require('./installment-tracker');
const ReferralTracker = require('./referral-tracker');
const intelligentUpdate = require('./intelligent-update');

dotenv.config();

// ============ APPRECIATION MESSAGES ============
const appreciationMessages = [
    "🙏 Thank you for your patience. You're a joy to work with!",
    "🤝 Your cooperation makes our work a pleasure. Thank you!",
    "🌟 We appreciate your trust in us. You're in excellent hands.",
    "💫 Your positive spirit inspires us. Thank you for choosing EasySuccor!",
    "🕊️ Thank you for your humbleness. It's an honor to serve you.",
    "🙌 Your obedience and trust make all the difference. We're grateful!",
    "💝 Clients like you make our work meaningful. Thank you!"
];

function getRandomAppreciation() {
    return appreciationMessages[Math.floor(Math.random() * appreciationMessages.length)];
}

async function sendAppreciation(ctx) {
    const msg = getRandomAppreciation();
    await ctx.reply(msg);
}

// ============ EXPRESS SERVER SETUP ============
const app = express();
const PORT = process.env.PORT || 3000;
const upload = multer({ dest: 'uploads/admin/' });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// ============ Home Page ROUTES ============
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});
app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// ============ API STATUS ROUTE ============
app.get('/api/status', (req, res) => {
    res.json({ 
        status: 'EasySuccor Bot is running!', 
        timestamp: new Date().toISOString() 
    });
});

// ============ HEALTH CHECK ENDPOINT FOR RAILWAY ============
app.get('/health', (req, res) => {
    const dbType = process.env.DATABASE_URL ? 
        (process.env.DATABASE_URL.startsWith('postgres') ? 'postgresql' : 'sqlite') : 
        'sqlite';
    
    res.status(200).json({ 
        status: 'healthy',  // Railway expects 'healthy'
        timestamp: new Date().toISOString(), 
        uptime: process.uptime(),
        version: '5.0.0',
        bot: 'EasySuccor Bot',
        deepseek_configured: !!process.env.DEEPSEEK_API_KEY,
        database: dbType
    });
});

// ============ ADMIN AUTHENTICATION ============
const adminAuth = (req, res, next) => {
    const apiKey = req.headers['x-admin-key'] || req.query.key;
    if (apiKey !== process.env.ADMIN_API_KEY) {
        return res.status(401).json({ error: 'Unauthorized. Valid admin API key required.' });
    }
    next();
};
// ============ PRICE CONFIGURATION (Admin Adjustable) ============
let PRICE_CONFIG = {
    student: { cv: 6000, editable_cv: 8000, editable_cover: 8000, update: 3000, cover: 5000 },
    recent: { cv: 8000, editable_cv: 10000, editable_cover: 8000, update: 4000, cover: 5000 },
    professional: { cv: 10000, editable_cv: 12000, editable_cover: 8000, update: 6000, cover: 6000 },
    nonworking: { cv: 8000, editable_cv: 10000, editable_cover: 8000, update: 5000, cover: 5000 },
    returning: { editable_cv: 10000, editable_cover: 8000, update: 5000, cover: 5000 }
};

// Load saved prices
try {
    if (fs.existsSync('./price_config.json')) {
        PRICE_CONFIG = JSON.parse(fs.readFileSync('./price_config.json', 'utf8'));
        console.log('✅ Price config loaded from file');
    }
} catch(e) { console.log('Using default price config'); }

// ============ PRICE MANAGEMENT ENDPOINTS ============

// Get current prices
app.get('/admin/prices', adminAuth, (req, res) => {
    res.json(PRICE_CONFIG);
});

// Update prices
app.post('/admin/update-prices', adminAuth, async (req, res) => {
    try {
        const { category, service, price } = req.body;
        if (PRICE_CONFIG[category] && PRICE_CONFIG[category][service] !== undefined) {
            PRICE_CONFIG[category][service] = parseInt(price);
            fs.writeFileSync('./price_config.json', JSON.stringify(PRICE_CONFIG, null, 2));
            
            // Log admin action
            await db.logAdminAction({
                admin_id: req.body.admin_id || 'web',
                action: 'update_prices',
                details: `${category}.${service} = ${price}`,
                timestamp: new Date().toISOString()
            });
            
            res.json({ success: true, message: 'Prices updated successfully' });
        } else {
            res.status(400).json({ error: 'Invalid category or service' });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});


// ============ ADMIN UPLOAD ENDPOINTS (UPDATED - 18+ CATEGORIES) ============

// Helper function to extract all 18+ categories from CV data
function extractAllCVData(cvData) {
    return {
        // Personal Information
        personal: {
            full_name: cvData.personal?.full_name || null,
            email: cvData.personal?.email || null,
            primary_phone: cvData.personal?.primary_phone || null,
            alternative_phone: cvData.personal?.alternative_phone || null,
            whatsapp_phone: cvData.personal?.whatsapp_phone || null,
            location: cvData.personal?.location || null,
            physical_address: cvData.personal?.physical_address || null,
            nationality: cvData.personal?.nationality || null,
            linkedin: cvData.personal?.linkedin || null,
            github: cvData.personal?.github || null,
            portfolio: cvData.personal?.portfolio || null,
            professional_title: cvData.personal?.professional_title || null,
            date_of_birth: cvData.personal?.date_of_birth || null,
            special_documents: cvData.personal?.special_documents || []
        },
        // Professional Summary (AI generated, but store if exists)
        professional_summary: cvData.professional_summary || null,
        // Work Experience
        employment: (cvData.employment || []).map(job => ({
            title: job.title || null,
            company: job.company || null,
            location: job.location || null,
            start_date: job.start_date || null,
            end_date: job.end_date || null,
            duration: job.duration || null,
            responsibilities: job.responsibilities || [],
            achievements: job.achievements || [],
            technologies_used: job.technologies_used || [],
            team_size: job.team_size || null,
            reporting_to: job.reporting_to || null
        })),
        // Education
        education: (cvData.education || []).map(edu => ({
            level: edu.level || null,
            field: edu.field || null,
            institution: edu.institution || null,
            location: edu.location || null,
            start_date: edu.start_date || null,
            graduation_date: edu.graduation_date || null,
            gpa: edu.gpa || null,
            achievements: edu.achievements || [],
            courses: edu.courses || []
        })),
        // Skills (categorized)
        skills: {
            technical: cvData.skills?.technical || [],
            soft: cvData.skills?.soft || [],
            tools: cvData.skills?.tools || [],
            certifications: cvData.skills?.certifications || []
        },
        // Certifications
        certifications: (cvData.certifications || []).map(cert => ({
            name: cert.name || null,
            issuer: cert.issuer || null,
            date: cert.date || null,
            expiry_date: cert.expiry_date || null,
            credential_id: cert.credential_id || null,
            url: cert.url || null
        })),
        // Languages
        languages: (cvData.languages || []).map(lang => ({
            name: lang.name || null,
            proficiency: lang.proficiency || null,
            certification: lang.certification || null
        })),
        // Projects
        projects: (cvData.projects || []).map(proj => ({
            name: proj.name || null,
            description: proj.description || null,
            technologies: proj.technologies || null,
            role: proj.role || null,
            team_size: proj.team_size || null,
            duration: proj.duration || null,
            link: proj.link || null,
            outcome: proj.outcome || null
        })),
        // Achievements
        achievements: (cvData.achievements || []).map(ach => ({
            title: typeof ach === 'string' ? ach : ach.title,
            description: ach.description || null,
            date: ach.date || null,
            issuer: ach.issuer || null
        })),
        // Volunteer Experience
        volunteer: (cvData.volunteer || []).map(vol => ({
            role: vol.role || null,
            organization: vol.organization || null,
            duration: vol.duration || null,
            responsibilities: vol.responsibilities || []
        })),
        // Leadership
        leadership: (cvData.leadership || []).map(lead => ({
            role: lead.role || null,
            organization: lead.organization || null,
            duration: lead.duration || null,
            impact: lead.impact || null
        })),
        // Awards
        awards: (cvData.awards || []).map(award => ({
            name: award.name || null,
            issuer: award.issuer || null,
            date: award.date || null,
            description: award.description || null
        })),
        // Publications
        publications: (cvData.publications || []).map(pub => ({
            title: pub.title || null,
            publisher: pub.publisher || null,
            date: pub.date || null,
            url: pub.url || null,
            authors: pub.authors || null
        })),
        // Conferences
        conferences: (cvData.conferences || []).map(conf => ({
            name: conf.name || null,
            role: conf.role || null,
            date: conf.date || null,
            location: conf.location || null
        })),
        // Referees
        referees: (cvData.referees || []).map(ref => ({
            name: ref.name || null,
            position: ref.position || null,
            company: ref.company || null,
            email: ref.email || null,
            phone: ref.phone || null,
            relationship: ref.relationship || null
        })),
        // Interests
        interests: cvData.interests || [],
        // Social Media
        social_media: {
            linkedin: cvData.social_media?.linkedin || null,
            github: cvData.social_media?.github || null,
            twitter: cvData.social_media?.twitter || null,
            facebook: cvData.social_media?.facebook || null,
            instagram: cvData.social_media?.instagram || null,
            portfolio: cvData.social_media?.portfolio || null
        },
        // Portfolio Links
        portfolio: cvData.portfolio || []
    };
}

// Batch upload (multiple files) - UPDATED for 18+ categories
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
                const cvData = extractedData.data;
                
                // Extract ALL 18+ categories
                const allData = extractAllCVData(cvData);
                
                let client = null;
                if (allData.personal.email) {
                    client = await db.getClientByEmail(allData.personal.email);
                }
                
                if (!client) {
                    const firstName = allData.personal.full_name?.split(' ')[0] || 'Unknown';
                    const lastName = allData.personal.full_name?.split(' ').slice(1).join(' ') || '';
                    client = await db.createClient(null, null, firstName, lastName);
                    await db.updateClient(client.id, {
                        email: allData.personal.email,
                        phone: allData.personal.primary_phone,
                        location: allData.personal.location,
                        physical_address: allData.personal.physical_address,
                        nationality: allData.personal.nationality,
                        linkedin: allData.personal.linkedin,
                        github: allData.personal.github,
                        portfolio: allData.personal.portfolio,
                        professional_title: allData.personal.professional_title,
                        special_documents: JSON.stringify(allData.personal.special_documents),
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
                    cv_data: allData,
                    certificates_appendix: null,
                    portfolio_links: JSON.stringify(allData.portfolio),
                    status: 'delivered'
                });
                
                // Save all extracted data to a separate JSON file for admin reference
                const exportPath = path.join(__dirname, 'exports', 'legacy_imports', `${client.id}_${Date.now()}.json`);
                const exportDir = path.dirname(exportPath);
                if (!fs.existsSync(exportDir)) fs.mkdirSync(exportDir, { recursive: true });
                fs.writeFileSync(exportPath, JSON.stringify(allData, null, 2));
                
                results.push({
                    file: file.originalname,
                    success: true,
                    client_id: client.id,
                    client_name: allData.personal.full_name,
                    extracted_email: allData.personal.email,
                    extracted_phone: allData.personal.primary_phone,
                    stats: {
                        employment: allData.employment.length,
                        education: allData.education.length,
                        skills: allData.skills.technical.length + allData.skills.soft.length + allData.skills.tools.length,
                        certifications: allData.certifications.length,
                        languages: allData.languages.length,
                        projects: allData.projects.length,
                        achievements: allData.achievements.length,
                        volunteer: allData.volunteer.length,
                        leadership: allData.leadership.length,
                        awards: allData.awards.length,
                        publications: allData.publications.length,
                        conferences: allData.conferences.length,
                        referees: allData.referees.length,
                        interests: allData.interests.length
                    }
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

// Single CV upload - UPDATED for 18+ categories
app.post('/admin/upload-cv', adminAuth, upload.single('cv_file'), async (req, res) => {
    try {
        const file = req.file;
        if (!file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }
        
        const extractedData = await documentGenerator.extractFullCVData(file.path, 'cv');
        const cvData = extractedData.data;
        
        // Extract ALL 18+ categories
        const allData = extractAllCVData(cvData);
        
        let client = null;
        if (allData.personal.email) {
            client = await db.getClientByEmail(allData.personal.email);
        }
        
        if (!client) {
            const firstName = allData.personal.full_name?.split(' ')[0] || 'Unknown';
            const lastName = allData.personal.full_name?.split(' ').slice(1).join(' ') || '';
            client = await db.createClient(null, null, firstName, lastName);
            await db.updateClient(client.id, {
                email: allData.personal.email,
                phone: allData.personal.primary_phone,
                location: allData.personal.location,
                physical_address: allData.personal.physical_address,
                nationality: allData.personal.nationality,
                linkedin: allData.personal.linkedin,
                github: allData.personal.github,
                portfolio: allData.personal.portfolio,
                professional_title: allData.personal.professional_title,
                special_documents: JSON.stringify(allData.personal.special_documents),
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
            cv_data: allData,
            certificates_appendix: null,
            portfolio_links: JSON.stringify(allData.portfolio),
            status: 'delivered'
        });
        
        // Save full extracted data to file
        const exportPath = path.join(__dirname, 'exports', 'legacy_imports', `${client.id}_${Date.now()}.json`);
        const exportDir = path.dirname(exportPath);
        if (!fs.existsSync(exportDir)) fs.mkdirSync(exportDir, { recursive: true });
        fs.writeFileSync(exportPath, JSON.stringify(allData, null, 2));
        
        res.json({
            success: true,
            message: `CV processed for ${allData.personal.full_name || 'client'}`,
            client_id: client.id,
            extracted_data: {
                // Basic info
                name: allData.personal.full_name,
                email: allData.personal.email,
                phone: allData.personal.primary_phone,
                location: allData.personal.location,
                physical_address: allData.personal.physical_address,
                nationality: allData.personal.nationality,
                linkedin: allData.personal.linkedin,
                github: allData.personal.github,
                professional_title: allData.personal.professional_title,
                special_documents: allData.personal.special_documents,
                // 18+ categories summary
                stats: {
                    employment: allData.employment.length,
                    education: allData.education.length,
                    skills: allData.skills.technical.length + allData.skills.soft.length + allData.skills.tools.length,
                    certifications: allData.certifications.length,
                    languages: allData.languages.length,
                    projects: allData.projects.length,
                    achievements: allData.achievements.length,
                    volunteer: allData.volunteer.length,
                    leadership: allData.leadership.length,
                    awards: allData.awards.length,
                    publications: allData.publications.length,
                    conferences: allData.conferences.length,
                    referees: allData.referees.length,
                    interests: allData.interests.length
                }
            }
        });
        
    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Cover letter upload - UPDATED
app.post('/admin/upload-cover', adminAuth, upload.single('cover_file'), async (req, res) => {
    try {
        const { client_name, client_email, client_phone, client_location, position: formPosition, company: formCompany } = req.body;
        const file = req.file;
        
        if (!file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }
        
        const fileUrl = `/uploads/${file.filename}`;
        const extractedData = await aiAnalyzer.extractFromDocument(fileUrl, file.originalname);
        
        const clientName = extractedData.client_name || client_name || 'Unknown Client';
        const clientEmail = extractedData.client_email || client_email || null;
        const clientPhone = extractedData.client_phone || client_phone || null;
        const clientLocation = extractedData.client_location || client_location || null;
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
        
        // Store cover letter with extracted vacancy details
        const coverData = {
            cover_letter: convertedCover,
            vacancy: {
                position: position,
                company: company,
                extracted_at: new Date().toISOString()
            },
            client_info: {
                name: clientName,
                email: clientEmail,
                phone: clientPhone,
                location: clientLocation
            }
        };
        
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
            cv_data: coverData,
            status: 'delivered'
        });
        
        res.json({ 
            success: true, 
            message: `Cover letter for ${clientName} uploaded and converted successfully`,
            client_id: client.id,
            extracted_details: {
                position: position,
                company: company,
                client_name: clientName,
                client_email: clientEmail
            }
        });
        
    } catch (error) {
        console.error('Cover letter upload error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get full extracted data for a client (admin view all 18+ categories)
app.get('/admin/client-full/:clientId', adminAuth, async (req, res) => {
    try {
        const clientId = req.params.clientId;
        const orders = await db.getClientOrders(clientId);
        const latestOrder = orders[0];
        
        if (!latestOrder || !latestOrder.cv_data) {
            return res.status(404).json({ error: 'No CV data found for this client' });
        }
        
        const cvData = latestOrder.cv_data;
        
        res.json({
            client_id: clientId,
            client_name: cvData.personal?.full_name || 'Unknown',
            extracted_at: latestOrder.created_at,
            data: cvData
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get summary of all imported clients with 18+ categories stats
app.get('/admin/imports-summary', adminAuth, async (req, res) => {
    try {
        const orders = await db.getAllOrders();
        const legacyOrders = orders.filter(o => o.service === 'legacy_cv');
        
        const summary = legacyOrders.map(order => {
            const cvData = order.cv_data;
            return {
                order_id: order.id,
                client_id: order.client_id,
                client_name: cvData?.personal?.full_name || 'Unknown',
                imported_at: order.created_at,
                stats: {
                    employment: cvData?.employment?.length || 0,
                    education: cvData?.education?.length || 0,
                    skills: (cvData?.skills?.technical?.length || 0) + (cvData?.skills?.soft?.length || 0) + (cvData?.skills?.tools?.length || 0),
                    certifications: cvData?.certifications?.length || 0,
                    languages: cvData?.languages?.length || 0,
                    projects: cvData?.projects?.length || 0,
                    achievements: cvData?.achievements?.length || 0,
                    volunteer: cvData?.volunteer?.length || 0,
                    leadership: cvData?.leadership?.length || 0,
                    awards: cvData?.awards?.length || 0,
                    publications: cvData?.publications?.length || 0,
                    conferences: cvData?.conferences?.length || 0,
                    referees: cvData?.referees?.length || 0,
                    interests: cvData?.interests?.length || 0
                }
            };
        });
        
        res.json({
            total_imports: legacyOrders.length,
            imports: summary
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============ CLIENT MANAGEMENT ENDPOINTS ============

// Delete client and all associated data
app.delete('/admin/client/:clientId', adminAuth, async (req, res) => {
    try {
        const clientId = req.params.clientId;
        const client = await db.getClientById(clientId);
        if (!client) return res.status(404).json({ error: 'Client not found' });
        
        await db.deleteClientData(clientId);
        
        await db.logAdminAction({
            admin_id: req.body.admin_id || 'web',
            action: 'delete_client',
            details: `Deleted client: ${client.first_name} ${client.last_name || ''} (ID: ${clientId})`,
            timestamp: new Date().toISOString()
        });
        
        res.json({ success: true, message: `Client deleted successfully` });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Clear ALL data (emergency only)
app.delete('/admin/clear-all', adminAuth, async (req, res) => {
    try {
        await db.clearAllData();
        
        await db.logAdminAction({
            admin_id: req.body.admin_id || 'web',
            action: 'clear_all_data',
            details: 'All client and order data cleared',
            timestamp: new Date().toISOString()
        });
        
        res.json({ success: true, message: 'All data cleared successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============ ADMIN DASHBOARD API ENDPOINTS (UPDATED) ============

// Helper function to calculate revenue
function calculateRevenue(orders) {
    return orders.reduce((sum, o) => {
        const amount = parseInt(o.total_charge?.replace('MK', '').replace(',', '') || 0);
        return sum + amount;
    }, 0);
}

// Helper function to calculate completion time
function calculateCompletionTime(createdAt, deliveredAt) {
    if (!deliveredAt) return null;
    const created = new Date(createdAt);
    const delivered = new Date(deliveredAt);
    const minutes = Math.round((delivered - created) / (1000 * 60));
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return { minutes, hours, mins, formatted: `${hours}h ${mins}m` };
}

// Get comprehensive statistics (UPDATED)
app.get('/admin/stats', adminAuth, async (req, res) => {
    try {
        const orders = await db.getAllOrders();
        const clients = await db.getAllClients();
        const testimonials = await db.getAllTestimonials();
         const adminLogs = await db.getAdminLogs(100);
        
        // Order categorization
        const cvOrders = orders.filter(o => o.service === 'new cv' || o.service === 'editable cv' || o.service === 'legacy_cv');
        const coverOrders = orders.filter(o => o.service === 'cover letter' || o.service === 'editable cover letter' || o.service === 'legacy_cover_letter');
        const updateOrders = orders.filter(o => o.service === 'cv update');
        
        const pendingOrders = orders.filter(o => o.payment_status === 'pending');
        const completedOrders = orders.filter(o => o.payment_status === 'completed');
        const deliveredOrders = orders.filter(o => o.status === 'delivered');
        
        const totalRevenue = calculateRevenue(completedOrders);
        const cvRevenue = calculateRevenue(cvOrders.filter(o => o.payment_status === 'completed'));
        const coverRevenue = calculateRevenue(coverOrders.filter(o => o.payment_status === 'completed'));
        const updateRevenue = calculateRevenue(updateOrders.filter(o => o.payment_status === 'completed'));
        
        // Calculate average completion time
        let totalCompletionMinutes = 0;
        let completedWithTime = 0;
        for (const order of deliveredOrders) {
            if (order.delivered_at) {
                const created = new Date(order.created_at);
                const delivered = new Date(order.delivered_at);
                totalCompletionMinutes += Math.round((delivered - created) / (1000 * 60));
                completedWithTime++;
            }
        }
        const avgCompletionMinutes = completedWithTime > 0 ? Math.round(totalCompletionMinutes / completedWithTime) : null;
        const avgHours = avgCompletionMinutes ? Math.floor(avgCompletionMinutes / 60) : null;
        const avgMins = avgCompletionMinutes ? avgCompletionMinutes % 60 : null;
        
        // Payment method distribution
        const paymentMethods = {};
        for (const order of completedOrders) {
            const method = order.payment_method || 'unknown';
            paymentMethods[method] = (paymentMethods[method] || 0) + 1;
        }
        
        // Service popularity
        const serviceCount = {};
        for (const order of orders) {
            serviceCount[order.service] = (serviceCount[order.service] || 0) + 1;
        }
        const mostRequested = Object.entries(serviceCount).sort((a, b) => b[1] - a[1])[0];
        
        // Monthly revenue trend (last 6 months)
        const monthlyRevenue = {};
        const sixMonthsAgo = new Date();
        sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
        
        for (const order of completedOrders) {
            const date = new Date(order.created_at);
            if (date >= sixMonthsAgo) {
                const monthYear = date.toLocaleString('default', { month: 'short', year: 'numeric' });
                const amount = parseInt(order.total_charge?.replace('MK', '').replace(',', '') || 0);
                monthlyRevenue[monthYear] = (monthlyRevenue[monthYear] || 0) + amount;
            }
        }
        
        // Active clients (last 30 days)
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const activeClients = clients.filter(c => {
            const clientOrders = orders.filter(o => o.client_id === c.id);
            return clientOrders.some(o => new Date(o.created_at) >= thirtyDaysAgo);
        });
        // Revenue by service
        const revenueByService = {};
        for (const order of completedOrders) {
            const amount = parseInt(order.total_charge?.replace('MK', '').replace(',', '') || 0);
            revenueByService[order.service] = (revenueByService[order.service] || 0) + amount;
        }
        
        // Category distribution
        const categoryDistribution = {};
        for (const order of orders) {
            categoryDistribution[order.category] = (categoryDistribution[order.category] || 0) + 1;
        }
        res.json({
            total_clients: clients.length,
            total_orders: orders.length,
            pending_payment: pendingOrders.length,
            completed_orders: completedOrders.length,
            total_revenue: completedOrders.reduce((sum, o) => sum + (parseInt(o.total_charge?.replace('MK', '').replace(',', '') || 0), 0)),
        });
        // Testimonial stats
        const approvedTestimonials = testimonials.filter(t => t.approved).length;
        const pendingTestimonials = testimonials.filter(t => !t.approved).length;
        const avgRating = testimonials.reduce((sum, t) => sum + (t.rating || 0), 0) / (testimonials.length || 1);
        
        res.json({
            timestamp: new Date().toISOString(),
            overview: {
                total_clients: clients.length,
                active_clients_30d: activeClients.length,
                total_orders: orders.length,
                pending_payment: pendingOrders.length,
                completed_orders: completedOrders.length,
                delivered_orders: deliveredOrders.length,
                conversion_rate: orders.length > 0 ? ((completedOrders.length / orders.length) * 100).toFixed(1) : 0
            },
            revenue: {
                total: totalRevenue,
                cv: cvRevenue,
                cover_letter: coverRevenue,
                cv_update: updateRevenue,
                average_order_value: completedOrders.length > 0 ? Math.round(totalRevenue / completedOrders.length) : 0,
                monthly_trend: monthlyRevenue
            },
            delivery: {
                average_completion_minutes: avgCompletionMinutes,
                average_completion_formatted: avgHours ? `${avgHours}h ${avgMins}m` : null,
                fastest_order: null,
                slowest_order: null
            },
            services: {
                most_requested: mostRequested ? mostRequested[0] : 'None',
                most_requested_count: mostRequested ? mostRequested[1] : 0,
                service_breakdown: serviceCount
            },
            payments: {
                method_distribution: paymentMethods,
                pending_count: pendingOrders.length,
                pending_total: calculateRevenue(pendingOrders)
            },
            testimonials: {
                approved: approvedTestimonials,
                pending: pendingTestimonials,
                total: testimonials.length,
                average_rating: avgRating.toFixed(1)
            }
        });
    } catch (error) {
        console.error('Stats error:', error);
        res.status(500).json({ error: error.message });
    }
});
// Get order completion time
app.get('/api/order-time/:orderId', async (req, res) => {
    try {
        const order = await db.getOrder(req.params.orderId);
        if (!order) return res.status(404).json({ error: 'Order not found' });
        
        const created = new Date(order.created_at);
        const delivered = order.delivered_at ? new Date(order.delivered_at) : null;
        const expectedHours = parseInt(order.delivery_time) || 6;
        const expectedBy = new Date(created);
        expectedBy.setHours(created.getHours() + expectedHours);
        
        res.json({
            order_id: order.id,
            created_at: order.created_at,
            expected_by: expectedBy.toISOString(),
            delivered_at: order.delivered_at,
            is_delivered: !!delivered,
            status: order.status,
            payment_status: order.payment_status
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});


// Get all orders with detailed information (UPDATED - includes cover letter data)
app.get('/admin/orders', adminAuth, async (req, res) => {
    try {
        const orders = await db.getAllOrders();
        const ordersWithDetails = await Promise.all(orders.map(async (order) => {
            const client = await db.getClientById(order.client_id);
            const cvData = order.cv_data || {};
            
            // Extract cover letter specific data if applicable
            let coverDetails = null;
            if (order.service === 'cover letter' || order.service === 'editable cover letter' || order.service === 'legacy_cover_letter') {
                coverDetails = {
                    position: cvData.position || cvData.cover_letter?.position || 'Not specified',
                    company: cvData.company || cvData.cover_letter?.company || 'Not specified',
                    has_vacancy: !!(cvData.vacancy || cvData.vacancy_data)
                };
            }
            
            // Extract CV specific stats
            let cvStats = null;
            if (order.service === 'new cv' || order.service === 'editable cv' || order.service === 'legacy_cv') {
                cvStats = {
                    employment_count: cvData.employment?.length || 0,
                    education_count: cvData.education?.length || 0,
                    skills_count: (cvData.skills?.technical?.length || 0) + (cvData.skills?.soft?.length || 0) + (cvData.skills?.tools?.length || 0),
                    projects_count: cvData.projects?.length || 0,
                    achievements_count: cvData.achievements?.length || 0,
                    referees_count: cvData.referees?.length || 0
                };
            }
            
            return {
                id: order.id,
                service: order.service,
                category: order.category,
                status: order.status,
                payment_status: order.payment_status,
                total_charge: order.total_charge,
                created_at: order.created_at,
                delivered_at: order.delivered_at,
                delivery_time: order.delivery_time,
                completion_time: calculateCompletionTime(order.created_at, order.delivered_at),
                client: {
                    id: client?.id,
                    name: client ? `${client.first_name} ${client.last_name || ''}` : 'Unknown',
                    email: client?.email,
                    phone: client?.phone
                },
                cover_details: coverDetails,
                cv_stats: cvStats,
                version: order.version,
                review_count: await db.getDocumentReviews(order.id).then(r => r.length)
            };
        }));
        
        // Sort by newest first
        ordersWithDetails.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        
        res.json({
            total: ordersWithDetails.length,
            orders: ordersWithDetails
        });
    } catch (error) {
        console.error('Orders fetch error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get all clients with detailed stats (UPDATED)
app.get('/admin/clients', adminAuth, async (req, res) => {
    try {
        const clients = await db.getAllClients();
        const orders = await db.getAllOrders();
        
        const clientsWithDetails = await Promise.all(clients.map(async (client) => {
            const clientOrders = orders.filter(o => o.client_id === client.id);
            const completedOrders = clientOrders.filter(o => o.payment_status === 'completed');
            const totalSpent = calculateRevenue(completedOrders);
            
            const cvOrders = clientOrders.filter(o => o.service === 'new cv' || o.service === 'editable cv');
            const coverOrders = clientOrders.filter(o => o.service === 'cover letter' || o.service === 'editable cover letter');
            const updateOrders = clientOrders.filter(o => o.service === 'cv update');
            
            const lastOrder = clientOrders.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
            const referralInfo = await db.getReferralInfo(client.id);
            
            return {
                id: client.id,
                telegram_id: client.telegram_id,
                name: `${client.first_name} ${client.last_name || ''}`,
                email: client.email,
                phone: client.phone,
                location: client.location,
                nationality: client.nationality,
                registered_at: client.created_at,
                last_active: client.last_active,
                total_orders: clientOrders.length,
                completed_orders: completedOrders.length,
                total_spent: totalSpent,
                orders_by_type: {
                    cv: cvOrders.length,
                    cover_letter: coverOrders.length,
                    update: updateOrders.length
                },
                last_order: lastOrder ? {
                    id: lastOrder.id,
                    service: lastOrder.service,
                    date: lastOrder.created_at,
                    amount: lastOrder.total_charge
                } : null,
                referral: {
                    code: referralInfo.referral_code,
                    total_referrals: referralInfo.total_referrals,
                    pending_reward: referralInfo.pending_reward
                },
                has_active_session: !!(await db.getActiveSession(client.id))
            };
        }));
        
        clientsWithDetails.sort((a, b) => new Date(b.registered_at) - new Date(a.registered_at));
        
        res.json({
            total: clientsWithDetails.length,
            clients: clientsWithDetails
        });
    } catch (error) {
        console.error('Clients fetch error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get single order with full CV data (UPDATED - includes all 18+ categories)
app.get('/admin/order/:orderId', adminAuth, async (req, res) => {
    try {
        const order = await db.getOrder(req.params.orderId);
        if (!order) return res.status(404).json({ error: 'Order not found' });
        
        const client = await db.getClientById(order.client_id);
        const reviews = await db.getDocumentReviews(order.id);
        const cvData = order.cv_data || {};
        
        // Format CV data with all 18+ categories
        const formattedCV = {
            personal: cvData.personal || {},
            professional_summary: cvData.professional_summary || null,
            employment: cvData.employment || [],
            education: cvData.education || [],
            skills: cvData.skills || { technical: [], soft: [], tools: [] },
            certifications: cvData.certifications || [],
            languages: cvData.languages || [],
            projects: cvData.projects || [],
            achievements: cvData.achievements || [],
            volunteer: cvData.volunteer || [],
            leadership: cvData.leadership || [],
            awards: cvData.awards || [],
            publications: cvData.publications || [],
            conferences: cvData.conferences || [],
            referees: cvData.referees || [],
            interests: cvData.interests || [],
            social_media: cvData.social_media || {},
            portfolio: cvData.portfolio || []
        };
        
        // Calculate stats from all categories
        const stats = {
            employment: formattedCV.employment.length,
            education: formattedCV.education.length,
            skills: (formattedCV.skills.technical?.length || 0) + (formattedCV.skills.soft?.length || 0) + (formattedCV.skills.tools?.length || 0),
            certifications: formattedCV.certifications.length,
            languages: formattedCV.languages.length,
            projects: formattedCV.projects.length,
            achievements: formattedCV.achievements.length,
            volunteer: formattedCV.volunteer.length,
            leadership: formattedCV.leadership.length,
            awards: formattedCV.awards.length,
            publications: formattedCV.publications.length,
            conferences: formattedCV.conferences.length,
            referees: formattedCV.referees.length,
            interests: formattedCV.interests.length
        };
        
        res.json({
            order: {
                id: order.id,
                service: order.service,
                category: order.category,
                status: order.status,
                payment_status: order.payment_status,
                total_charge: order.total_charge,
                delivery_option: order.delivery_option,
                delivery_time: order.delivery_time,
                created_at: order.created_at,
                delivered_at: order.delivered_at,
                version: order.version,
                completion_time: calculateCompletionTime(order.created_at, order.delivered_at)
            },
            client: {
                id: client?.id,
                name: client ? `${client.first_name} ${client.last_name || ''}` : 'Unknown',
                email: client?.email,
                phone: client?.phone,
                telegram_id: client?.telegram_id
            },
            cv_data: formattedCV,
            stats: stats,
            review_history: reviews,
            portfolio_links: order.portfolio_links ? JSON.parse(order.portfolio_links) : []
        });
    } catch (error) {
        console.error('Order fetch error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get single cover letter order (NEW)
app.get('/admin/cover-order/:orderId', adminAuth, async (req, res) => {
    try {
        const order = await db.getOrder(req.params.orderId);
        if (!order) return res.status(404).json({ error: 'Order not found' });
        
        if (order.service !== 'cover letter' && order.service !== 'editable cover letter' && order.service !== 'legacy_cover_letter') {
            return res.status(400).json({ error: 'This order is not a cover letter order' });
        }
        
        const client = await db.getClientById(order.client_id);
        const reviews = await db.getDocumentReviews(order.id);
        const coverData = order.cv_data || {};
        
        res.json({
            order: {
                id: order.id,
                service: order.service,
                status: order.status,
                payment_status: order.payment_status,
                total_charge: order.total_charge,
                delivery_option: order.delivery_option,
                delivery_time: order.delivery_time,
                created_at: order.created_at,
                delivered_at: order.delivered_at,
                completion_time: calculateCompletionTime(order.created_at, order.delivered_at)
            },
            client: {
                id: client?.id,
                name: client ? `${client.first_name} ${client.last_name || ''}` : 'Unknown',
                email: client?.email,
                phone: client?.phone
            },
            cover_letter: {
                position: coverData.position || coverData.cover_letter?.position || 'Not specified',
                company: coverData.company || coverData.cover_letter?.company || 'Not specified',
                experience: coverData.experience_highlight || coverData.experience || null,
                skills: coverData.skills || coverData.cover_letter?.skills || [],
                achievement: coverData.achievement || coverData.cover_letter?.achievement || null,
                motivation: coverData.motivation || coverData.why || coverData.cover_letter?.motivation || null,
                availability: coverData.availability || coverData.cover_letter?.availability || null
            },
            vacancy_data: coverData.vacancy || coverData.vacancy_data || null,
            review_history: reviews
        });
    } catch (error) {
        console.error('Cover order fetch error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get all cover letter orders (NEW)
app.get('/admin/cover-orders', adminAuth, async (req, res) => {
    try {
        const orders = await db.getAllOrders();
        const coverOrders = orders.filter(o => 
            o.service === 'cover letter' || 
            o.service === 'editable cover letter' || 
            o.service === 'legacy_cover_letter'
        );
        
        const coverOrdersWithDetails = await Promise.all(coverOrders.map(async (order) => {
            const client = await db.getClientById(order.client_id);
            const coverData = order.cv_data || {};
            
            return {
                id: order.id,
                service: order.service,
                status: order.status,
                payment_status: order.payment_status,
                total_charge: order.total_charge,
                created_at: order.created_at,
                delivered_at: order.delivered_at,
                completion_time: calculateCompletionTime(order.created_at, order.delivered_at),
                client: {
                    id: client?.id,
                    name: client ? `${client.first_name} ${client.last_name || ''}` : 'Unknown',
                    email: client?.email
                },
                position: coverData.position || coverData.cover_letter?.position || 'Not specified',
                company: coverData.company || coverData.cover_letter?.company || 'Not specified',
                has_vacancy: !!(coverData.vacancy || coverData.vacancy_data),
                version: order.version
            };
        }));
        
        coverOrdersWithDetails.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        
        res.json({
            total: coverOrders.length,
            orders: coverOrdersWithDetails
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get orders by date range (NEW - for reporting)
app.get('/admin/orders-by-date', adminAuth, async (req, res) => {
    try {
        const { start, end } = req.query;
        if (!start || !end) {
            return res.status(400).json({ error: 'Please provide start and end dates (YYYY-MM-DD)' });
        }
        
        const orders = await db.getAllOrders();
        const startDate = new Date(start);
        const endDate = new Date(end);
        endDate.setHours(23, 59, 59);
        
        const filteredOrders = orders.filter(o => {
            const orderDate = new Date(o.created_at);
            return orderDate >= startDate && orderDate <= endDate;
        });
        
        const completedOrders = filteredOrders.filter(o => o.payment_status === 'completed');
        const totalRevenue = calculateRevenue(completedOrders);
        
        // Group by day
        const byDay = {};
        filteredOrders.forEach(order => {
            const day = new Date(order.created_at).toISOString().split('T')[0];
            if (!byDay[day]) {
                byDay[day] = { orders: 0, revenue: 0, completed: 0 };
            }
            byDay[day].orders++;
            if (order.payment_status === 'completed') {
                byDay[day].completed++;
                byDay[day].revenue += parseInt(order.total_charge?.replace('MK', '').replace(',', '') || 0);
            }
        });
        
        res.json({
            period: { start, end },
            summary: {
                total_orders: filteredOrders.length,
                completed_orders: completedOrders.length,
                total_revenue: totalRevenue,
                average_order_value: completedOrders.length > 0 ? Math.round(totalRevenue / completedOrders.length) : 0
            },
            daily_breakdown: byDay,
            orders: filteredOrders.map(o => ({
                id: o.id,
                service: o.service,
                total_charge: o.total_charge,
                payment_status: o.payment_status,
                created_at: o.created_at
            }))
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get admin dashboard summary (quick view for admin.html)
app.get('/admin/dashboard-summary', adminAuth, async (req, res) => {
    try {
        const orders = await db.getAllOrders();
        const clients = await db.getAllClients();
        const testimonials = await db.getAllTestimonials();
        
        const today = new Date().toISOString().split('T')[0];
        const todayOrders = orders.filter(o => o.created_at.split('T')[0] === today);
        const weekAgo = new Date();
        weekAgo.setDate(weekAgo.getDate() - 7);
        const weekOrders = orders.filter(o => new Date(o.created_at) >= weekAgo);
        
        const pendingPayments = orders.filter(o => o.payment_status === 'pending');
        const recentClients = clients.filter(c => new Date(c.created_at) >= weekAgo);
        
        res.json({
            quick_stats: {
                total_clients: clients.length,
                total_orders: orders.length,
                pending_payments: pendingPayments.length,
                pending_amount: calculateRevenue(pendingPayments),
                total_revenue: calculateRevenue(orders.filter(o => o.payment_status === 'completed'))
            },
            today: {
                orders: todayOrders.length,
                revenue: calculateRevenue(todayOrders.filter(o => o.payment_status === 'completed'))
            },
            this_week: {
                orders: weekOrders.length,
                new_clients: recentClients.length,
                revenue: calculateRevenue(weekOrders.filter(o => o.payment_status === 'completed'))
            },
            testimonials: {
                pending: testimonials.filter(t => !t.approved).length,
                total: testimonials.length
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============ DEEPSEEK STATUS ENDPOINT ============
app.get('/api/deepseek-status', async (req, res) => {
    try {
        const { OpenAI } = require('openai');
        const deepseek = new OpenAI({
            apiKey: process.env.DEEPSEEK_API_KEY,
            baseURL: 'https://api.deepseek.com/v1'
        });
        
        const startTime = Date.now();
        const response = await deepseek.chat.completions.create({
            model: 'deepseek-chat',
            messages: [{ role: 'user', content: 'OK' }],
            max_tokens: 5
        });
        const responseTime = Date.now() - startTime;
        
        res.json({
            status: 'online',
            response_time_ms: responseTime,
            message: response.choices[0].message.content,
            api_key_configured: true
        });
    } catch (error) {
        res.json({
            status: 'offline',
            error: error.message,
            api_key_configured: !!process.env.DEEPSEEK_API_KEY
        });
    }
});
// ============ DASHBOARD API ENDPOINTS ============

// Get full statistics for dashboard
app.get('/admin/full-stats', adminAuth, async (req, res) => {
    try {
        const orders = await db.getAllOrders();
        const clients = await db.getAllClients();
        const testimonials = await db.getAllTestimonials();
        const errorReports = await db.getErrorReports ? await db.getErrorReports(null, 1000) : [];
        
        const now = new Date();
        const thirtyDaysAgo = new Date(now.setDate(now.getDate() - 30));
        const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        
        // Calculate stats
        const completedOrders = orders.filter(o => o.payment_status === 'completed');
        const pendingOrders = orders.filter(o => o.payment_status === 'pending');
        const activeClients = clients.filter(c => c.last_active && new Date(c.last_active) >= thirtyDaysAgo);
        
        const totalRevenue = completedOrders.reduce((sum, o) => {
            return sum + parseInt(String(o.total_charge).replace(/[^0-9]/g, '') || 0);
        }, 0);
        
        const monthlyOrders = orders.filter(o => new Date(o.created_at) >= firstDayOfMonth);
        const monthlyRevenue = monthlyOrders.filter(o => o.payment_status === 'completed')
            .reduce((sum, o) => sum + parseInt(String(o.total_charge).replace(/[^0-9]/g, '') || 0), 0);
        
        // CV Analytics
        const cvOrders = orders.filter(o => o.service?.includes('cv') || o.service === 'legacy_cv');
        let totalSkills = 0, totalProjects = 0, totalAchievements = 0, totalVolunteer = 0;
        let totalLeadership = 0, totalCertifications = 0, totalLanguages = 0, totalReferees = 0;
        
        for (const order of cvOrders) {
            const cv = order.cv_data || {};
            totalSkills += (cv.skills?.technical?.length || 0) + (cv.skills?.soft?.length || 0) + (cv.skills?.tools?.length || 0);
            totalProjects += cv.projects?.length || 0;
            totalAchievements += cv.achievements?.length || 0;
            totalVolunteer += cv.volunteer?.length || 0;
            totalLeadership += cv.leadership?.length || 0;
            totalCertifications += cv.certifications?.length || 0;
            totalLanguages += cv.languages?.length || 0;
            totalReferees += cv.referees?.length || 0;
        }
        
        // Payment Analytics
        const installments = await db.getAllInstallmentPlans ? await db.getAllInstallmentPlans() : [];
        const payLater = await db.getAllPayLaterPlans ? await db.getAllPayLaterPlans() : [];
        
        res.json({
            timestamp: new Date().toISOString(),
            clients: {
                total: clients.length,
                active: activeClients.length
            },
            month: {
                orders: monthlyOrders.length,
                revenue: monthlyRevenue,
                new_clients: clients.filter(c => new Date(c.created_at) >= firstDayOfMonth).length,
                returning_clients: clients.filter(c => c.total_orders > 1).length,
                avg_rating: testimonials.length > 0 ? 
                    (testimonials.reduce((sum, t) => sum + (t.rating || 0), 0) / testimonials.length).toFixed(1) : 0,
                most_requested: 'N/A',
                most_requested_count: 0,
                highest_revenue_service: 'N/A'
            },
            cv_analytics: {
                total_cvs: cvOrders.length,
                total_skills: totalSkills,
                avg_skills_per_cv: cvOrders.length > 0 ? Math.round(totalSkills / cvOrders.length) : 0,
                total_projects: totalProjects,
                total_achievements: totalAchievements,
                total_volunteer: totalVolunteer,
                total_leadership: totalLeadership,
                total_certifications: totalCertifications,
                total_languages: totalLanguages,
                total_referees: totalReferees
            },
            payment_analytics: {
                installments: {
                    active: installments.filter(i => i.status === 'active').length,
                    completed: installments.filter(i => i.status === 'completed').length
                },
                pay_later: {
                    active: payLater.filter(p => p.status === 'pending').length,
                    overdue: payLater.filter(p => p.status === 'pending' && new Date(p.due_date) < new Date()).length
                }
            },
            error_analytics: {
                total_reports: errorReports.length,
                pending: errorReports.filter(r => r.status === 'pending').length,
                resolved: errorReports.filter(r => r.status === 'resolved').length,
                resolution_rate: errorReports.length > 0 ? 
                    ((errorReports.filter(r => r.status === 'resolved').length / errorReports.length) * 100).toFixed(1) : 0
            },
            testimonials: {
                total: testimonials.length,
                approved: testimonials.filter(t => t.approved).length,
                pending: testimonials.filter(t => !t.approved).length,
                average_rating: testimonials.length > 0 ?
                    (testimonials.reduce((sum, t) => sum + (t.rating || 0), 0) / testimonials.length).toFixed(1) : 0
            }
        });
    } catch (error) {
        console.error('Full stats error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get payment stats
app.get('/admin/payment-stats', adminAuth, async (req, res) => {
    try {
        const orders = await db.getAllOrders();
        const installments = await db.getAllInstallmentPlans ? await db.getAllInstallmentPlans() : [];
        const payLater = await db.getAllPayLaterPlans ? await db.getAllPayLaterPlans() : [];
        
        const pendingOrders = orders.filter(o => o.payment_status === 'pending');
        const pendingAmount = pendingOrders.reduce((sum, o) => {
            return sum + parseInt(String(o.total_charge).replace(/[^0-9]/g, '') || 0);
        }, 0);
        
        res.json({
            total_pending: pendingOrders.length,
            total_pending_amount: pendingAmount,
            installments_active: installments.filter(i => i.status === 'active').length,
            pay_later_active: payLater.filter(p => p.status === 'pending').length,
            pay_later_overdue: payLater.filter(p => p.status === 'pending' && new Date(p.due_date) < new Date()).length
        });
    } catch (error) {
        console.error('Payment stats error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get installments list
app.get('/admin/installments', adminAuth, async (req, res) => {
    try {
        const installments = await db.getAllInstallmentPlans ? await db.getAllInstallmentPlans() : [];
        
        const formatted = installments.map(inst => ({
            order_id: inst.orderId,
            client_name: inst.clientName,
            current_installment: inst.current_installment,
            paid_amount: inst.paid_amount,
            remaining_amount: inst.remaining_amount,
            next_due_date: inst.installments?.[inst.current_installment - 1]?.due_date,
            status: inst.status,
            days_overdue: inst.next_due_date ? 
                Math.floor((new Date() - new Date(inst.next_due_date)) / (1000 * 60 * 60 * 24)) : 0
        }));
        
        res.json(formatted);
    } catch (error) {
        console.error('Installments error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get pay later list
app.get('/admin/pay-later', adminAuth, async (req, res) => {
    try {
        const payLater = await db.getAllPayLaterPlans ? await db.getAllPayLaterPlans() : [];
        
        const formatted = payLater.map(pl => ({
            order_id: pl.orderId,
            client_name: pl.clientName,
            amount: pl.amount,
            due_date: pl.due_date,
            days_until_due: pl.due_date ? 
                Math.ceil((new Date(pl.due_date) - new Date()) / (1000 * 60 * 60 * 24)) : 0,
            status: pl.status
        }));
        
        res.json(formatted);
    } catch (error) {
        console.error('Pay later error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get error reports list
app.get('/admin/error-reports', adminAuth, async (req, res) => {
    try {
        const reports = await db.getErrorReports ? await db.getErrorReports(null, 100) : [];
        
        const formatted = await Promise.all(reports.map(async (r) => {
            const client = await db.getClientById(r.client_id);
            return {
                id: r.id,
                client_name: client?.first_name || 'Unknown',
                description: r.description,
                status: r.status,
                created_at: r.created_at,
                resolved_at: r.resolved_at,
                file_id: r.file_id
            };
        }));
        
        res.json(formatted);
    } catch (error) {
        console.error('Error reports error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get single error report
app.get('/admin/error-report/:id', adminAuth, async (req, res) => {
    try {
        const report = await db.getErrorReportById ? await db.getErrorReportById(req.params.id) : null;
        if (!report) {
            return res.status(404).json({ error: 'Report not found' });
        }
        
        const client = await db.getClientById(report.client_id);
        res.json({
            ...report,
            client_name: client?.first_name || 'Unknown'
        });
        const template = ADDITIONAL_TEMPLATES.error_report.received(client.first_name || 'Friend', fileId.slice(0, 8));
await ctx.reply(template, { parse_mode: 'Markdown' });
    } catch (error) {
        console.error('Error report error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Resolve error report
app.post('/admin/resolve-report/:id', adminAuth, async (req, res) => {
    try {
        await db.updateErrorReportStatus(req.params.id, 'resolved', req.body.notes || 'Issue resolved');
        res.json({ success: true, message: 'Report resolved' });
        const template = ADDITIONAL_TEMPLATES.error_report.resolved(client.first_name || 'Friend', report.file_id.slice(0, 8));
await bot.telegram.sendMessage(client.telegram_id, template, { parse_mode: 'Markdown' });
    } catch (error) {
        console.error('Resolve report error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get single client
app.get('/admin/client/:id', adminAuth, async (req, res) => {
    try {
        const client = await db.getClientById(req.params.id);
        if (!client) {
            return res.status(404).json({ error: 'Client not found' });
        }
        
        const orders = await db.getClientOrders(client.id);
        const totalSpent = orders.filter(o => o.payment_status === 'completed')
            .reduce((sum, o) => sum + parseInt(String(o.total_charge).replace(/[^0-9]/g, '') || 0), 0);
        
        res.json({
            ...client,
            total_orders: orders.length,
            total_spent: totalSpent
        });
    } catch (error) {
        console.error('Client error:', error);
        res.status(500).json({ error: error.message });
    }
});
// ============ PAYMENT DASHBOARD ENDPOINTS ============

// Get payment statistics
app.get('/admin/payment-stats', adminAuth, async (req, res) => {
    try {
        const orders = await db.getAllOrders();
        const installments = await db.getAllInstallmentPlans ? await db.getAllInstallmentPlans() : [];
        const payLater = await db.getAllPayLaterPlans ? await db.getAllPayLaterPlans() : [];
        
        const pendingOrders = orders.filter(o => o.payment_status === 'pending');
        const pendingAmount = pendingOrders.reduce((sum, o) => {
            const amount = parseInt(String(o.total_charge).replace(/[^0-9]/g, '') || 0);
            return sum + amount;
        }, 0);
        
        const activeInstallments = installments.filter(i => i.status === 'active' || i.status === 'first_paid');
        const overduePayLater = payLater.filter(p => 
            p.status === 'pending' && new Date(p.due_date) < new Date()
        );
        
        res.json({
            total_pending: pendingOrders.length,
            total_pending_amount: pendingAmount,
            installments_active: activeInstallments.length,
            installments_completed: installments.filter(i => i.status === 'completed').length,
            pay_later_active: payLater.filter(p => p.status === 'pending').length,
            pay_later_completed: payLater.filter(p => p.status === 'completed').length,
            pay_later_overdue: overduePayLater.length
        });
    } catch (error) {
        console.error('Payment stats error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get installments list
app.get('/admin/installments', adminAuth, async (req, res) => {
    try {
        const installments = await db.getAllInstallmentPlans ? await db.getAllInstallmentPlans() : [];
        
        const formatted = installments.map(inst => {
            const currentInstallment = inst.installments?.[inst.current_installment - 1] || {};
            const dueDate = currentInstallment.due_date;
            const daysOverdue = dueDate ? 
                Math.floor((new Date() - new Date(dueDate)) / (1000 * 60 * 60 * 24)) : 0;
            
            return {
                order_id: inst.orderId,
                client_name: inst.clientName,
                current_installment: inst.current_installment,
                paid_amount: inst.paid_amount || 0,
                remaining_amount: inst.remaining_amount || 0,
                next_due_date: dueDate,
                days_overdue: daysOverdue > 0 ? daysOverdue : 0,
                status: inst.status
            };
        });
        
        res.json(formatted);
    } catch (error) {
        console.error('Installments error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get pay later list
app.get('/admin/pay-later', adminAuth, async (req, res) => {
    try {
        const payLater = await db.getAllPayLaterPlans ? await db.getAllPayLaterPlans() : [];
        
        const formatted = payLater.map(pl => {
            const daysUntilDue = pl.due_date ? 
                Math.ceil((new Date(pl.due_date) - new Date()) / (1000 * 60 * 60 * 24)) : 0;
            
            return {
                order_id: pl.orderId,
                client_name: pl.clientName,
                amount: pl.amount || 0,
                due_date: pl.due_date,
                days_until_due: daysUntilDue,
                status: pl.status
            };
        });
        
        res.json(formatted);
    } catch (error) {
        console.error('Pay later error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============ START EXPRESS SERVER (ONLY ONCE!) ============

app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`✅ EasySuccor Express Server Started`);
    console.log(`${'='.repeat(60)}`);
    console.log(`🌐 Home Page:    http://0.0.0.0:${PORT}/`);
    console.log(`🔐 Admin panel:     http://0.0.0.0:${PORT}/admin`);
    console.log(`❤️  Health check:    http://0.0.0.0:${PORT}/health`);
    console.log(`🤖 DeepSeek status: http://0.0.0.0:${PORT}/api/deepseek-status`);
    console.log(`${'='.repeat(60)}`);
    console.log(`📤 Admin upload endpoints:`);
    console.log(`   POST /admin/upload-cv`);
    console.log(`   POST /admin/upload-batch`);
    console.log(`   POST /admin/upload-cover`);
    console.log(`🔑 Admin API Key required in header: x-admin-key`);
    console.log(`${'='.repeat(60)}\n`);
});
// ============ TELEGRAM BOT ============
const bot = new Telegraf(process.env.BOT_TOKEN);

// ============ HELPER FOR MARKDOWN ============
async function sendMarkdown(ctx, message, extra = {}) {
    return await ctx.reply(message, { parse_mode: 'Markdown', ...extra });
}
// ============ TIME-BASED GREETINGS SYSTEM ============
const TIME_GREETINGS = {
    morning: {
        greetings: [
            (name) => `🌅 *Good Morning, ${name}!* 🌅`,
            (name) => `☀️ *Rise and Shine, ${name}!* ☀️`,
            (name) => `🌄 *Beautiful Morning, ${name}!* 🌄`,
            (name) => `🌞 *Top of the Morning, ${name}!* 🌞`,
            (name) => `🌸 *Good Morning, ${name}!* 🌸`,
            (name) => `🕊️ *Peaceful Morning, ${name}!* 🕊️`,
            (name) => `✨ *Morning Excellence, ${name}!* ✨`,
            (name) => `💫 *Fresh Start, ${name}!* 💫`
        ],
        subMessages: [
            "Starting your day with career investment? That's how winners begin!",
            "The early professional catches the opportunities!",
            "What a productive way to start your morning!",
            "Morning dedication leads to evening success!",
            "Investing in yourself before noon? Admirable!",
            "Your future self will thank you for this morning's work!",
            "There's something special about morning ambition!"
        ],
        emojis: ['🌅', '☀️', '🌄', '🌞', '🌸', '🕊️', '✨', '💫', '🌤️', '⛅']
    },
    afternoon: {
        greetings: [
            (name) => `☀️ *Good Afternoon, ${name}!* ☀️`,
            (name) => `🌤️ *Beautiful Afternoon, ${name}!* 🌤️`,
            (name) => `⛅ *Wonderful Afternoon, ${name}!* ⛅`,
            (name) => `🌟 *Good Afternoon, ${name}!* 🌟`,
            (name) => `💪 *Power Through, ${name}!* 💪`,
            (name) => `🎯 *Afternoon Excellence, ${name}!* 🎯`,
            (name) => `✨ *Productive Afternoon, ${name}!* ✨`,
            (name) => `🔥 *Afternoon Momentum, ${name}!* 🔥`
        ],
        subMessages: [
            "Powering through the day like a true professional!",
            "Midday career moves - that's the spirit!",
            "Making the most of every hour. Inspiring!",
            "Your afternoon dedication sets you apart!",
            "While others slow down, you're leveling up!",
            "Afternoon ambition leads to career success!",
            "This is when champions do the work!"
        ],
        emojis: ['☀️', '🌤️', '⛅', '🌟', '💪', '🎯', '✨', '🔥', '📊', '⚡']
    },
    evening: {
        greetings: [
            (name) => `🌆 *Good Evening, ${name}!* 🌆`,
            (name) => `🌙 *Lovely Evening, ${name}!* 🌙`,
            (name) => `✨ *Wonderful Evening, ${name}!* ✨`,
            (name) => `🌠 *Good Evening, ${name}!* 🌠`,
            (name) => `🕊️ *Peaceful Evening, ${name}!* 🕊️`,
            (name) => `💫 *Evening Excellence, ${name}!* 💫`,
            (name) => `🌟 *Golden Hour, ${name}!* 🌟`,
            (name) => `🌇 *Beautiful Sunset, ${name}!* 🌇`
        ],
        subMessages: [
            "Investing in yourself even after hours? That's true dedication!",
            "Ending your day with career growth - you're going places!",
            "Evening ambition shows real commitment to your future!",
            "Working on yourself when others are resting? Admirable!",
            "The evening is when visionaries plan their success!",
            "Tomorrow's success starts with tonight's preparation!"
        ],
        emojis: ['🌆', '🌙', '✨', '🌠', '🕊️', '💫', '🌟', '🌇', '🌃', '🎑']
    },
    night: {
        greetings: [
            (name) => `🌙 *Good Night, ${name}!* 🌙`,
            (name) => `⭐ *Late Night Excellence, ${name}!* ⭐`,
            (name) => `🌃 *Good Evening, ${name}!* 🌃`,
            (name) => `🌠 *Starry Night, ${name}!* 🌠`,
            (name) => `🦉 *Night Owl Mode, ${name}!* 🦉`,
            (name) => `✨ *Midnight Dedication, ${name}!* ✨`,
            (name) => `💫 *Nighttime Ambition, ${name}!* 💫`,
            (name) => `🌌 *Under the Stars, ${name}!* 🌌`
        ],
        subMessages: [
            "Working while others sleep? That's the mindset of achievers!",
            "Late night career moves - your dedication is remarkable!",
            "The quiet hours are when great things are built!",
            "Your commitment to excellence knows no clock!",
            "Burning the midnight oil for your future? Respect!",
            "Success doesn't sleep, and apparently neither do you!",
            "The night is when dreams are turned into plans!"
        ],
        emojis: ['🌙', '⭐', '🌃', '🌠', '🦉', '✨', '💫', '🌌', '🌟', '☪️']
    }
};

// ============ TIME-BASED WELCOME MESSAGES ============
const TIME_BASED_WELCOME = {
    morning: {
        firstTime: {
            honor: [
                (name) => `🌅 *${name}, a Blessed Morning to You!* 🌅\n\n🤝 We are truly honored you chose EasySuccor today.`,
                (name) => `☀️ *Good Morning, ${name}!* ☀️\n\n✨ What a privilege to start this day with you.`,
                (name) => `🌄 *${name}, Welcome to a New Beginning!* 🌄\n\n🙏 Thank you for trusting us this morning.`
            ],
            appreciation: [
                "Starting your morning with career investment? That's the mark of a true professional.",
                "The early hours are when successful people plant seeds for their future. You're doing exactly that.",
                "Morning dedication like yours is what separates achievers from dreamers.",
                "While others are still sleeping, you're building your professional legacy. Respect!"
            ]
        },
        returning: {
            greeting: [
                (name) => `🌅 *Welcome Back This Beautiful Morning, ${name}!* 🌅`,
                (name) => `☀️ *Good Morning, ${name}! So Good to See You Again!* ☀️`,
                (name) => `🌄 *${name}, You Brighten Our Morning!* 🌄`
            ],
            appreciation: [
                "Starting your day with us again? We're truly honored by your loyalty.",
                "Morning clients like you make our work a joy. Welcome back!",
                "There's no better way to start our morning than serving a returning champion like you."
            ]
        }
    },
    afternoon: {
        firstTime: {
            honor: [
                (name) => `☀️ *${name}, a Wonderful Afternoon to You!* ☀️\n\n🤝 We're truly honored you chose EasySuccor today.`,
                (name) => `🌤️ *Good Afternoon, ${name}!* 🌤️\n\n✨ Thank you for spending part of your day with us.`,
                (name) => `⛅ *${name}, Welcome to EasySuccor!* ⛅\n\n🙏 Your trust this afternoon means everything.`
            ],
            appreciation: [
                "Making career moves in the afternoon? That's how professionals level up!",
                "While others are counting down to evening, you're counting up your achievements!",
                "Afternoon dedication shows you're serious about your future. We love that energy!",
                "Midday motivation like yours is rare and valuable. Let's create something exceptional!"
            ]
        },
        returning: {
            greeting: [
                (name) => `☀️ *Welcome Back This Afternoon, ${name}!* ☀️`,
                (name) => `🌤️ *Good Afternoon, ${name}! Always a Pleasure!* 🌤️`,
                (name) => `⛅ *${name}, You Make Our Afternoon Brighter!* ⛅`
            ],
            appreciation: [
                "Returning in the afternoon? Your continued trust warms our hearts.",
                "Afternoon clients who come back are the ultimate compliment. Thank you!",
                "You could be anywhere this afternoon, but you chose us. We're grateful!"
            ]
        }
    },
    evening: {
        firstTime: {
            honor: [
                (name) => `🌆 *${name}, a Peaceful Evening to You!* 🌆\n\n🤝 We're truly honored you chose EasySuccor tonight.`,
                (name) => `🌙 *Good Evening, ${name}!* 🌙\n\n✨ Thank you for ending your day with us.`,
                (name) => `🌠 *${name}, Welcome This Beautiful Evening!* 🌠\n\n🙏 Your trust means the world to us.`
            ],
            appreciation: [
                "Investing in yourself after hours? That's the dedication of a true professional.",
                "Ending your day with career growth? Tomorrow you'll wake up ahead of the competition.",
                "Evening ambition like yours is what builds extraordinary careers.",
                "While others are winding down, you're gearing up. That's a winning mindset!"
            ]
        },
        returning: {
            greeting: [
                (name) => `🌆 *Welcome Back This Evening, ${name}!* 🌆`,
                (name) => `🌙 *Good Evening, ${name}! Wonderful to See You!* 🌙`,
                (name) => `🌠 *${name}, You Make Our Evening Special!* 🌠`
            ],
            appreciation: [
                "Ending your day with us again? We're truly honored by your loyalty.",
                "Evening returns like yours remind us why we love what we do.",
                "You chose to spend your evening with us. That means everything."
            ]
        }
    },
    night: {
        firstTime: {
            honor: [
                (name) => `🌙 *${name}, a Peaceful Night to You!* 🌙\n\n🤝 We're deeply honored you chose EasySuccor tonight.`,
                (name) => `⭐ *Good Evening, ${name}!* ⭐\n\n✨ Your dedication this late inspires us.`,
                (name) => `🌃 *${name}, Welcome to EasySuccor Tonight!* 🌃\n\n🙏 Thank you for trusting us at this hour.`
            ],
            appreciation: [
                "Working on your career while the world sleeps? That's extraordinary dedication.",
                "The quiet hours are when future leaders build their foundations. You're doing just that.",
                "Late night ambition like yours is rare and powerful. We're honored to serve you.",
                "Success doesn't have office hours, and clearly neither do you. Respect!"
            ]
        },
        returning: {
            greeting: [
                (name) => `🌙 *Welcome Back Tonight, ${name}!* 🌙`,
                (name) => `⭐ *Good Evening, ${name}! Always a Privilege!* ⭐`,
                (name) => `🌃 *${name}, You Light Up Our Night!* 🌃`
            ],
            appreciation: [
                "Returning at this hour? Your dedication and loyalty inspire us.",
                "Night owl clients like you are special. Thank you for coming back.",
                "You chose us again, even at this hour. We're truly grateful."
            ]
        }
    }
};

// ============ COMPREHENSIVE DYNAMIC ENCOURAGEMENTS ============
const ENCOURAGEMENTS = {
    start: [
        (name) => `🎯 Excellent choice, ${name}! This is where greatness begins.`,
        (name) => `💪 ${name}, you're already making smart decisions!`,
        (name) => `✨ ${name}, I can tell you're serious about your career!`,
        (name) => `🚀 Let's create something exceptional, ${name}!`,
        (name) => `🌟 ${name}, you're on the path to professional excellence!`,
        (name) => `💫 This is going to be fantastic, ${name}!`,
        (name) => `🏆 ${name}, winners make decisive choices. Well done!`,
        (name) => `🔥 ${name}, let's turn your experience into a powerful CV!`,
        (name) => `📄 ${name}, your professional story deserves to be told brilliantly.`,
        (name) => `⭐ ${name}, you've just taken the first step toward standing out!`
    ],
    progress: [
        (p, name) => `📊 ${name}, you're ${p}% there! Keep that momentum going! 💪`,
        (p, name) => `🎯 ${name}, ${p}% complete! You're making excellent progress! ⭐`,
        (p, name) => `💪 ${p}% done, ${name}! You're crushing it! 🎯`,
        (p, name) => `✨ ${name}, ${p}% finished! Your dedication shows! 🌟`,
        (p, name) => `🚀 ${p}% complete, ${name}! Almost at the finish line! 🏁`,
        (p, name) => `💫 ${name}, you're ${p}% there! Looking better with every step!`,
        (p, name) => `🔥 ${p}% done, ${name}! Your future self will thank you!`,
        (p, name) => `📈 ${name}, ${p}% complete! The hardest part is behind you!`,
        (p, name) => `🎨 ${p}% finished, ${name}! We're crafting something beautiful!`,
        (p, name) => `⚡ ${name}, you're ${p}% there! Keep that energy flowing!`
    ],
    sectionComplete: [
        (section, name) => `✅ ${name}, your ${section} is saved perfectly! You're on a roll! 🎯`,
        (section, name) => `🎉 ${section} complete, ${name}! This is coming together beautifully! ✨`,
        (section, name) => `👍 ${name}, ${section} looks excellent! Moving forward with confidence! 💪`,
        (section, name) => `📝 ${section} recorded, ${name}. You're doing an amazing job! 🌟`,
        (section, name) => `💫 ${section} done, ${name}! Every detail makes you shine brighter!`,
        (section, name) => `🏆 ${name}, your ${section} is impressive! Employers will notice!`,
        (section, name) => `✨ ${section} saved, ${name}! Your professionalism shows!`,
        (section, name) => `🔥 ${name}, ${section} looks fantastic! Keep that momentum!`,
        (section, name) => `🎯 ${section} complete, ${name}! You're building something powerful!`,
        (section, name) => `💎 ${name}, ${section} is polished and ready! On to the next!`
    ],
    final: [
        (name) => `🎉 *AMAZING JOB, ${name}!* 🎉\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\nYou've provided everything I need to create a CV that truly represents your professional excellence.\n\nYour thoroughness and dedication are exactly what employers look for. This CV is going to open doors!`,
        (name) => `✨ *PERFECT, ${name}!* ✨\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\nYou've done an exceptional job providing all the details. Your future CV already reflects the professional you are.\n\nNow let's get this masterpiece ready for you!`,
        (name) => `💪 *WAY TO GO, ${name}!* 💪\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\nYou've completed every step with excellence. The foundation you've laid will result in a powerful, compelling CV.\n\nLet's bring it to life!`,
        (name) => `🌟 *OUTSTANDING WORK, ${name}!* 🌟\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\nYour attention to detail and commitment to excellence shine through every section. This CV is going to make employers take notice.\n\nReady for the final step?`,
        (name) => `🏆 *YOU DID IT, ${name}!* 🏆\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\nFrom start to finish, you've shown the dedication of a true professional. Your CV will reflect exactly that.\n\nNow let's get it delivered!`,
        (name) => `💫 *INCREDIBLE JOB, ${name}!* 💫\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\nYou've shared your professional journey beautifully. I can already tell this CV is going to be exceptional.\n\nLet's complete the process!`,
        (name) => `🔥 *PHENOMENAL, ${name}!* 🔥\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\nThe thoroughness you've shown tells me you're serious about your career. Employers value that.\n\nYour CV will showcase the professional you truly are!`,
        (name) => `📄 *MASTERFUL, ${name}!* 📄\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\nEvery section you've completed adds to a compelling professional narrative. Your CV is going to stand out.\n\nReady to receive it?`,
        (name) => `⭐ *EXCELLENT WORK, ${name}!* ⭐\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\nYou've provided everything needed for a powerful, professional CV. Your future self will thank you for this investment.\n\nLet's finish strong!`,
        (name) => `🎯 *BRILLIANT, ${name}!* 🎯\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\nYou've completed your part with excellence. Now it's my turn to craft a CV that opens doors for you.\n\nLet's make it official!`
    ],
    halfway: [
        (name) => `🎯 ${name}, you're halfway there! This is where most people give up - but not you! 💪`,
        (name) => `✨ ${name}, 50% complete! Your dedication is inspiring! Keep going! 🌟`,
        (name) => `💫 Halfway done, ${name}! The finish line is in sight! 🏁`,
        (name) => `🔥 ${name}, you've made it halfway! This CV is already looking impressive!`,
        (name) => `🚀 ${name}, 50% there! Your future self is already proud of you!`
    ],
    almostThere: [
        (name) => `🎯 ${name}, you're almost at the finish line! Just a few more details! 💪`,
        (name) => `✨ So close, ${name}! 90% complete - the end is in sight! 🌟`,
        (name) => `💫 ${name}, you're nearly done! This CV is going to be worth every moment!`,
        (name) => `🔥 Almost there, ${name}! The hardest part is behind you!`,
        (name) => `🚀 ${name}, you're at the final stretch! Let's bring this home!`
    ],
    longSectionComplete: [
        (name, section) => `😮‍💨 ${name}, that was a detailed section! Thank you for your patience and thoroughness! 🙏`,
        (name, section) => `💪 ${name}, you powered through ${section} like a true professional! Excellent work!`,
        (name, section) => `🌟 ${name}, your attention to detail in ${section} is remarkable! Employers notice this!`,
        (name, section) => `🎯 ${name}, completing ${section} with such care shows real dedication. Impressive!`,
        (name, section) => `✨ ${name}, ${section} is perfectly done! Your professionalism shines through!`
    ],
    timeBased: {
        morning: [
            (name) => `🌅 Good morning, ${name}! Starting your day with career investment - that's how winners begin!`,
            (name) => `☀️ ${name}, what a productive way to start your morning! Let's create something great!`,
            (name) => `🌄 Rise and shine, ${name}! Your future CV awaits. Let's make today count!`
        ],
        afternoon: [
            (name) => `☀️ ${name}, powering through the afternoon like a true professional! Keep going!`,
            (name) => `🌤️ ${name}, your dedication this afternoon is inspiring! Almost there!`,
            (name) => `⛅ ${name}, making career moves in the afternoon - that's how it's done!`
        ],
        evening: [
            (name) => `🌙 ${name}, investing in yourself even in the evening? That's true dedication!`,
            (name) => `✨ ${name}, ending your day with career growth - you're going places!`,
            (name) => `🌠 ${name}, working on your future this evening? Admirable! Let's finish strong!`
        ],
        night: [
            (name) => `🌙 ${name}, burning the midnight oil for your career? That's commitment!`,
            (name) => `⭐ ${name}, late night career moves - you're dedicated to success!`,
            (name) => `🌃 ${name}, working while others sleep - that's the mindset of achievers!`
        ]
    }
};

// ============ TIME HELPER FUNCTIONS ============
function getTimePeriod() {
    const hour = new Date().getHours();
    if (hour >= 5 && hour < 12) return 'morning';
    else if (hour >= 12 && hour < 17) return 'afternoon';
    else if (hour >= 17 && hour < 21) return 'evening';
    else return 'night';
}

function getCurrentHour() {
    return new Date().getHours();
}

function getTimeEmoji() {
    const period = getTimePeriod();
    const emojis = TIME_GREETINGS[period].emojis;
    return emojis[Math.floor(Math.random() * emojis.length)];
}

// ============ HELPER FUNCTIONS ============
function randomMessage(messages) {
    if (typeof messages === 'function') return messages;
    if (Array.isArray(messages)) {
        return messages[Math.floor(Math.random() * messages.length)];
    }
    return messages;
}

function getRandomEncouragement(type, value1, value2 = null) {
    const messages = ENCOURAGEMENTS[type];
    if (!messages) return '';
    let selectedMessage;
    if (Array.isArray(messages)) {
        selectedMessage = messages[Math.floor(Math.random() * messages.length)];
    } else {
        const subType = value2 || 'morning';
        selectedMessage = messages[subType]?.[Math.floor(Math.random() * messages[subType]?.length)];
    }
    if (typeof selectedMessage === 'function') {
        return selectedMessage(value1, value2);
    }
    return selectedMessage || '';
}

function getProgressEncouragement(percent, name) {
    if (percent >= 90) {
        const almostMessages = ENCOURAGEMENTS.almostThere;
        return almostMessages[Math.floor(Math.random() * almostMessages.length)](name);
    } else if (percent >= 45 && percent <= 55) {
        const halfwayMessages = ENCOURAGEMENTS.halfway;
        return halfwayMessages[Math.floor(Math.random() * halfwayMessages.length)](name);
    } else {
        return getRandomEncouragement('progress', percent, name);
    }
}

function getSectionEncouragement(section, name, isLongSection = false) {
    if (isLongSection) {
        return getRandomEncouragement('longSectionComplete', name, section);
    }
    return getRandomEncouragement('sectionComplete', section, name);
}

function getTimeBasedEncouragement(name) {
    const period = getTimePeriod();
    const messages = ENCOURAGEMENTS.timeBased[period];
    const msg = messages[Math.floor(Math.random() * messages.length)];
    return msg(name);
}

// ============ WELCOME MESSAGE BUILDERS ============
function getTimeBasedFirstTimeWelcome(name) {
    const period = getTimePeriod();
    const welcomeData = TIME_BASED_WELCOME[period].firstTime;
    
    const honor = welcomeData.honor[Math.floor(Math.random() * welcomeData.honor.length)](name);
    const appreciation = welcomeData.appreciation[Math.floor(Math.random() * welcomeData.appreciation.length)];
    
    const trustMessages = [
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━\n🙏 *Thank You for Your Trust*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━",
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━\n✨ *We Don't Take This Lightly*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━",
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━\n🤝 *Your Trust Inspires Us*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━",
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━\n💫 *We're Committed to Excellence*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    ];
    const trust = trustMessages[Math.floor(Math.random() * trustMessages.length)];
    
    const promiseMessages = [
        "We promise to deliver excellence worthy of your trust.",
        "Your CV will reflect the professional you truly are.",
        "We'll craft a document that makes you proud.",
        "Expect nothing less than exceptional quality.",
        "Your success is our success. Let's make it happen."
    ];
    const promise = promiseMessages[Math.floor(Math.random() * promiseMessages.length)];
    
    const beginMessages = [
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━\n📋 *Let's Begin Your Journey*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━",
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━\n🚀 *Ready to Transform Your Career?*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━",
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━\n✨ *Your Professional Journey Starts Here*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━",
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━\n🎯 *Let's Create Something Exceptional*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    ];
    const begin = beginMessages[Math.floor(Math.random() * beginMessages.length)];
    
    return `${honor}

${trust}

${appreciation}

${promise}

${begin}

Please select your category:`;
}

function getTimeBasedReturningWelcome(name) {
    const period = getTimePeriod();
    const welcomeData = TIME_BASED_WELCOME[period].returning;
    
    const greeting = welcomeData.greeting[Math.floor(Math.random() * welcomeData.greeting.length)](name);
    const appreciation = welcomeData.appreciation[Math.floor(Math.random() * welcomeData.appreciation.length)].replace('${name}', name);
    
    const honorMessages = [
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━\n🙏 *We're Honored You Returned*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━",
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━\n✨ *Your Loyalty Inspires Us*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━",
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━\n💝 *Clients Like You Make Our Work Meaningful*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━",
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━\n🤝 *Thank You for Your Continued Trust*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    ];
    const honor = honorMessages[Math.floor(Math.random() * honorMessages.length)];
    
    return `${greeting}

${honor}

${appreciation}

What would you like to do today?`;
}

// ============ HUMAN-LIKE DYNAMIC RESPONSES ============
const RESPONSES = {
    encouragements: ENCOURAGEMENTS,
    questions: {
        name: ["What's your full name? 📛", "Tell me your name so I can personalize your CV. 📛"],
        email: ["What's your email address? 📧", "Your email please? 📧"],
        phone: ["Phone number? (Employers will call this) 📞", "What's the best number to reach you? 📞"],
        location: ["Where are you based? (City, Country) 📍", "What's your location? 📍"],
        education: ["What's your highest qualification? 🎓", "What is your highest level of education? 🎓"],
        jobTitle: ["Your most recent job title? 💼", "What position did you last hold? 💼"],
        skills: ["List your key skills (comma separated) ⚡", "What skills make you stand out? ⚡"]
    },
    reactions: { 
        positive: ["Love it! 💯", "Got it! 🎯", "Perfect! ✨", "Excellent! 🌟", "Great choice! 👍", "Fantastic! 💪"], 
        funny: ["Nice one! 😄", "Awesome! 🎉", "Sweet! 🔥", "You're doing great! 💪"] 
    },
    help: ["Need help? Just type what you're unsure about. Or type /pause to save progress. I'm here for you! 💙"],
    
    // ============ PAYMENT SECTION (INSIDE RESPONSES) ============
    payment: {
        order_created: (orderId, service, deliveryTime, total) => `✅ *ORDER CREATED!* 🎉

━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 ORDER DETAILS
━━━━━━━━━━━━━━━━━━━━━━━━━━━

Order Number: \`${orderId}\`
Service: ${service}
⏰ Delivery: ${deliveryTime}
💰 Amount: ${total}

━━━━━━━━━━━━━━━━━━━━━━━━━━━
💳 SELECT PAYMENT METHOD
━━━━━━━━━━━━━━━━━━━━━━━━━━━

Choose how you would like to pay:`,
        
        payment_options: (reference, total) => `💳 *COMPLETE YOUR PAYMENT*

━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 ORDER SUMMARY
━━━━━━━━━━━━━━━━━━━━━━━━━━━

Amount: *${total}*
Reference: \`${reference}\`

━━━━━━━━━━━━━━━━━━━━━━━━━━━
💳 PAYMENT METHODS
━━━━━━━━━━━━━━━━━━━━━━━━━━━

Select your preferred payment method:`,
        
        mobile_payment: (reference, total, airtelNumber, mpambaNumber) => `💳 *MOBILE MONEY PAYMENT*

━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 PAYMENT DETAILS
━━━━━━━━━━━━━━━━━━━━━━━━━━━

Amount: *${total}*
Reference: \`${reference}\`

━━━━━━━━━━━━━━━━━━━━━━━━━━━
📱 SEND TO:
━━━━━━━━━━━━━━━━━━━━━━━━━━━

*Airtel Money:*
📞 ${airtelNumber}

*Mpamba:*
📞 ${mpambaNumber}

━━━━━━━━━━━━━━━━━━━━━━━━━━━
📌 INSTRUCTIONS
━━━━━━━━━━━━━━━━━━━━━━━━━━━

1️⃣ Open Airtel Money or Mpamba
2️⃣ Select "Send Money"
3️⃣ Enter the number above
4️⃣ Enter amount: *${total}*
5️⃣ Add reference: \`${reference}\`
6️⃣ Complete the transaction

━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ AFTER PAYMENT
━━━━━━━━━━━━━━━━━━━━━━━━━━━

Click the button below to confirm your payment:`,
        
        bank_payment: (reference, total, bankAccount) => `💳 *BANK TRANSFER PAYMENT*

━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 PAYMENT DETAILS
━━━━━━━━━━━━━━━━━━━━━━━━━━━

Amount: *${total}*
Reference: \`${reference}\`

━━━━━━━━━━━━━━━━━━━━━━━━━━━
🏦 BANK DETAILS
━━━━━━━━━━━━━━━━━━━━━━━━━━━

*Bank:* MO626
*Account Number:* ${bankAccount}
*Account Name:* EasySuccor Enterprises
*Reference:* ${reference}

━━━━━━━━━━━━━━━━━━━━━━━━━━━
📌 INSTRUCTIONS
━━━━━━━━━━━━━━━━━━━━━━━━━━━

1️⃣ Log into your internet banking
2️⃣ Transfer the exact amount
3️⃣ Use the reference above
4️⃣ Save your transaction receipt

━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ AFTER PAYMENT
━━━━━━━━━━━━━━━━━━━━━━━━━━━

Click the button below to confirm your payment:`,
        
        pay_later_created: (orderId, total, reference, dueDate) => `⏳ *PAY LATER PLAN ACTIVATED*

━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 ORDER DETAILS
━━━━━━━━━━━━━━━━━━━━━━━━━━━

Order: \`${orderId}\`
Amount: *${total}*
Reference: \`${reference}\`

━━━━━━━━━━━━━━━━━━━━━━━━━━━
⏰ PAYMENT DEADLINE
━━━━━━━━━━━━━━━━━━━━━━━━━━━

*Due Date:* ${dueDate}
*Time Remaining:* 7 days

━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️ IMPORTANT NOTES
━━━━━━━━━━━━━━━━━━━━━━━━━━━

• Your document will be delivered AFTER payment
• 10% penalty if payment is late
• Reminders will be sent before due date
• You can request a 3-day extension (max 2 times)

━━━━━━━━━━━━━━━━━━━━━━━━━━━
💳 WHEN READY TO PAY
━━━━━━━━━━━━━━━━━━━━━━━━━━━

Click the button below when you make payment:`,
        
        installment_created: (orderId, total, firstAmount, secondAmount, reference, dueDate) => `📅 *INSTALLMENT PLAN ACTIVATED*

━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 ORDER DETAILS
━━━━━━━━━━━━━━━━━━━━━━━━━━━

Order: \`${orderId}\`
Total Amount: *${total}*
Reference: \`${reference}\`

━━━━━━━━━━━━━━━━━━━━━━━━━━━
💳 PAYMENT SCHEDULE
━━━━━━━━━━━━━━━━━━━━━━━━━━━

*1st Payment (50%):* MK${firstAmount.toLocaleString()}
   ➜ Pay now to start CV creation

*2nd Payment (50%):* MK${secondAmount.toLocaleString()}
   ➜ Due by: ${dueDate}
   ➜ Receive your final document

━━━━━━━━━━━━━━━━━━━━━━━━━━━
📌 HOW IT WORKS
━━━━━━━━━━━━━━━━━━━━━━━━━━━

1️⃣ Make the first payment now
2️⃣ We start working on your CV immediately
3️⃣ You receive a preview within 24 hours
4️⃣ Make the second payment within 7 days
5️⃣ Receive your final downloadable document

━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️ LATE PAYMENT POLICY
━━━━━━━━━━━━━━━━━━━━━━━━━━━

• 10% penalty if more than 7 days overdue
• Extensions available upon request

━━━━━━━━━━━━━━━━━━━━━━━━━━━
💳 MAKE FIRST PAYMENT
━━━━━━━━━━━━━━━━━━━━━━━━━━━

Click the button below when you make your first payment:`,
        
        first_installment_confirmed: (firstAmount, secondAmount, dueDate) => `✅ *FIRST INSTALLMENT CONFIRMED!*

━━━━━━━━━━━━━━━━━━━━━━━━━━━
💰 PAYMENT RECEIVED
━━━━━━━━━━━━━━━━━━━━━━━━━━━

Amount Paid: *MK${firstAmount.toLocaleString()}*
Remaining: *MK${secondAmount.toLocaleString()}*

━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 WHAT HAPPENS NEXT
━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ Your CV creation has started!
⏰ You will receive a preview within 24 hours

━━━━━━━━━━━━━━━━━━━━━━━━━━━
📅 SECOND PAYMENT
━━━━━━━━━━━━━━━━━━━━━━━━━━━

Amount: *MK${secondAmount.toLocaleString()}*
Due Date: *${dueDate}*

━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️ REMINDERS
━━━━━━━━━━━━━━━━━━━━━━━━━━━

• You will receive reminders before due date
• Late payments incur 10% penalty
• Extensions available on request

━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ AFTER FINAL PAYMENT
━━━━━━━━━━━━━━━━━━━━━━━━━━━

You will receive your downloadable document immediately.

Thank you for choosing EasySuccor! 🙏`,
        
        second_installment_confirmed: (totalAmount) => `✅ *FINAL INSTALLMENT CONFIRMED!*

━━━━━━━━━━━━━━━━━━━━━━━━━━━
💰 PAYMENT COMPLETE
━━━━━━━━━━━━━━━━━━━━━━━━━━━

Total Paid: *MK${totalAmount.toLocaleString()}*

━━━━━━━━━━━━━━━━━━━━━━━━━━━
📄 YOUR DOCUMENT IS READY!
━━━━━━━━━━━━━━━━━━━━━━━━━━━

Your document will be delivered in this chat immediately.

Thank you for completing your payment! 🎉

━━━━━━━━━━━━━━━━━━━━━━━━━━━
⭐ *NEXT STEPS*
━━━━━━━━━━━━━━━━━━━━━━━━━━━

• Your document is being delivered
• You have 2 free revision requests
• Share your experience with /feedback

Thank you for choosing EasySuccor! 🙏`,
        
        payment_confirmed: (amount, orderId, deliveryTime) => `✅ *PAYMENT CONFIRMED!* 🎉

━━━━━━━━━━━━━━━━━━━━━━━━━━━
💰 PAYMENT RECEIVED
━━━━━━━━━━━━━━━━━━━━━━━━━━━

Amount: *${amount}*
Order: \`${orderId}\`

━━━━━━━━━━━━━━━━━━━━━━━━━━━
📄 YOUR DOCUMENT
━━━━━━━━━━━━━━━━━━━━━━━━━━━

Your document will be delivered within *${deliveryTime}*.

Thank you for your trust in EasySuccor! 🙏`,
        
        payment_verified: (amount, orderId) => `✅ *PAYMENT VERIFIED!*

━━━━━━━━━━━━━━━━━━━━━━━━━━━
💰 PAYMENT DETAILS
━━━━━━━━━━━━━━━━━━━━━━━━━━━

Amount: *${amount}*
Order: \`${orderId}\`

━━━━━━━━━━━━━━━━━━━━━━━━━━━
📄 WHAT HAPPENS NEXT
━━━━━━━━━━━━━━━━━━━━━━━━━━━

Your document is now being prepared. You will receive it within the delivery timeframe.

Thank you for choosing EasySuccor! 🙏`
    }
};

// ============ DYNAMIC THANK YOU RESPONSES ============
const THANK_YOU_RESPONSES = [
    (name) => `🙏 *Our pleasure, ${name}.* Serving dedicated professionals like you is why we do what we do.`,
    (name) => `🤝 *The honor is ours, ${name}.* Thank you for trusting EasySuccor with your career journey.`,
    (name) => `✨ *You're most welcome, ${name}.* Your success is our greatest reward.`,
    (name) => `💫 *Thank YOU, ${name}.* Clients like you inspire excellence.`,
    (name) => `🌟 *Our privilege, ${name}.* Wishing you continued success.`
`━━━━━━━━━━━━━━━━━━━━━━━━━━━
🌟 *WHEN YOU LAND THE JOB*
━━━━━━━━━━━━━━━━━━━━━━━━━━━

We'd love to celebrate with you! 
Type /hired to share your success story.

Your achievement inspires others!`
];

// ============ THANK YOU COMMAND ============
bot.command('thankyou', async (ctx) => {
    const client = await db.getClient(ctx.from.id);
    const name = client?.first_name || 'Friend';
    const response = THANK_YOU_RESPONSES[Math.floor(Math.random() * THANK_YOU_RESPONSES.length)](name);
    await ctx.reply(response, { parse_mode: 'Markdown' });
});

// ============ HIRED COMMAND - Client Reports Job Success ============
bot.command('hired', async (ctx) => {
    const client = await db.getClient(ctx.from.id);
    const name = client?.first_name || 'Friend';
    
    await ctx.reply(`🎉 *CONGRATULATIONS, ${name}!* 🎉

━━━━━━━━━━━━━━━━━━━━━━━━━━━
🌟 *This Is What We Work For!*
━━━━━━━━━━━━━━━━━━━━━━━━━━━

Your success is our greatest reward. We're truly honored to have played a part in your journey.

*Would you like to share your story?*

Tell us:
• What position did you get?
• Which company?
• Any advice for other job seekers?

*Just type your story below (or click Skip):*`, {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                [{ text: "⏭️ Skip for now", callback_data: "hired_skip" }],
                [{ text: "📝 Share anonymously", callback_data: "hired_anonymous" }]
            ]
        }
    });
    
    // Set session state to await hire story
    const session = await db.getActiveSession(client.id);
    if (session) {
        session.data.awaiting_hire_story = true;
        await db.updateSession(session.id, session.stage, session.current_section, session.data);
    } else {
        await db.saveSession(client.id, 'awaiting_hire_story', null, { awaiting_hire_story: true }, 0);
    }
});

// Handle hire story skip
bot.action('hired_skip', async (ctx) => {
    await ctx.answerCbQuery();
    const client = await db.getClient(ctx.from.id);
    const session = await db.getActiveSession(client.id);
    
    if (session?.data?.awaiting_hire_story) {
        session.data.awaiting_hire_story = false;
        await db.updateSession(session.id, session.stage, session.current_section, session.data);
    }
    
    await ctx.editMessageText(`🎉 *Congratulations again!*

━━━━━━━━━━━━━━━━━━━━━━━━━━━
Your achievement inspires us all.
━━━━━━━━━━━━━━━━━━━━━━━━━━━

Thank you for choosing EasySuccor. We wish you continued success in your career!

🤝 The EasySuccor Team`, { parse_mode: 'Markdown' });
    
    // Log the hire (anonymous)
    await db.logAdminAction({
        admin_id: 'system',
        action: 'client_hired',
        details: `Client ${client?.first_name || 'Anonymous'} reported getting hired (skipped story)`
    });
    
    // Notify admin
    const adminChatId = process.env.ADMIN_CHAT_ID;
    if (adminChatId) {
        await bot.telegram.sendMessage(
            adminChatId,
            `🎉 *Client Got Hired!*\n\nClient: ${client?.first_name || 'Anonymous'}\nStatus: Skipped sharing details`,
            { parse_mode: 'Markdown' }
        );
    }
});

// Handle anonymous share
bot.action('hired_anonymous', async (ctx) => {
    await ctx.answerCbQuery();
    const client = await db.getClient(ctx.from.id);
    const session = await db.getActiveSession(client.id);
    
    if (session?.data?.awaiting_hire_story) {
        session.data.awaiting_hire_story = false;
        session.data.hire_anonymous = true;
        await db.updateSession(session.id, session.stage, session.current_section, session.data);
    }
    
    await ctx.editMessageText(`🕊️ *Thank you for sharing!*

Your story will inspire others while keeping your identity private.

*What position did you get?* (Optional)
Type your response or click Skip.`, {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [[{ text: "⏭️ Skip", callback_data: "hire_detail_skip" }]]
        }
    });
});

// Handle hire story text input
bot.on('text', async (ctx, next) => {
    const client = await db.getClient(ctx.from.id);
    if (!client) return next();
    
    const session = await db.getActiveSession(client.id);
    
    if (session?.data?.awaiting_hire_story && !ctx.message.text.startsWith('/')) {
        const story = ctx.message.text;
        const isAnonymous = session.data.hire_anonymous || false;
        
        // Save the hire story
        await db.saveTestimonial({
            client_id: client.id,
            name: isAnonymous ? 'Anonymous' : (client.first_name || 'Valued Client'),
            text: story,
            rating: 5,
            position: 'Hired Client',
            approved: false,
            is_hire_story: true,
            anonymous: isAnonymous
        });
        
        session.data.awaiting_hire_story = false;
        session.data.hire_anonymous = false;
        await db.updateSession(session.id, session.stage, session.current_section, session.data);
        
        await ctx.reply(`🌟 *Thank You for Sharing Your Success!*

━━━━━━━━━━━━━━━━━━━━━━━━━━━
Your story will inspire countless others on their career journey.
━━━━━━━━━━━━━━━━━━━━━━━━━━━

We're truly honored to have been part of your success. Wishing you continued growth and achievement!

🤝 With gratitude,
The EasySuccor Team`, { parse_mode: 'Markdown' });
        
        // Log the hire
        await db.logAdminAction({
            admin_id: 'system',
            action: 'client_hired',
            details: `Client ${client.first_name || 'Anonymous'} reported getting hired. Story: ${story.substring(0, 100)}`
        });
        
        // Notify admin
        const adminChatId = process.env.ADMIN_CHAT_ID;
        if (adminChatId) {
            await bot.telegram.sendMessage(
                adminChatId,
                `🎉 *Client Got Hired!*\n\nClient: ${isAnonymous ? 'Anonymous' : (client.first_name || 'Unknown')}\nStory: ${story}\n\nUse /approve_testimonial to review.`,
                { parse_mode: 'Markdown' }
            );
        }
        
        return;
    }
    
    return next();
});

// Handle hire detail skip
bot.action('hire_detail_skip', async (ctx) => {
    await ctx.answerCbQuery();
    const client = await db.getClient(ctx.from.id);
    const session = await db.getActiveSession(client.id);
    
    if (session?.data?.awaiting_hire_story) {
        session.data.awaiting_hire_story = false;
        session.data.hire_anonymous = false;
        await db.updateSession(session.id, session.stage, session.current_section, session.data);
    }
    
    await ctx.editMessageText(`🌟 *Thank You!*

━━━━━━━━━━━━━━━━━━━━━━━━━━━
Your success is what drives us. Congratulations again on your achievement!

🤝 The EasySuccor Team`, { parse_mode: 'Markdown' });
    
    // Log the hire
    await db.logAdminAction({
        admin_id: 'system',
        action: 'client_hired',
        details: `Client ${client?.first_name || 'Anonymous'} reported getting hired (minimal details)`
    });
    
    // Notify admin
    const adminChatId = process.env.ADMIN_CHAT_ID;
    if (adminChatId) {
        await bot.telegram.sendMessage(
            adminChatId,
            `🎉 *Client Got Hired!*\n\nClient: ${client?.first_name || 'Anonymous'}\nStatus: Shared minimal details`,
            { parse_mode: 'Markdown' }
        );
    }
});

// ============ APPRECIATE COMMAND (Admin) ============
bot.command('appreciate', async (ctx) => {
    if (ctx.from.id.toString() !== process.env.ADMIN_CHAT_ID) return;
    
    const [_, targetId, ...messageParts] = ctx.message.text.split(' ');
    if (!targetId) return ctx.reply('Usage: `/appreciate [telegram_id] [message]`', { parse_mode: 'Markdown' });
    
    const client = await db.getClientById(targetId);
    if (!client) return ctx.reply('❌ Client not found.');
    
    const customMessage = messageParts.join(' ') || 'Your professionalism and patience make all the difference.';
    
    const appreciations = [
        `🌟 *A Note of Appreciation*\n\nDear ${client.first_name || 'Friend'},\n\n${customMessage}\n\nThank you for being an exceptional client.\n\n— The EasySuccor Team 🤝`,
        `💫 *With Gratitude*\n\nDear ${client.first_name || 'Friend'},\n\n${customMessage}\n\nClients like you elevate our work.\n\n— The EasySuccor Team 🤝`,
        `🙏 *Thank You*\n\nDear ${client.first_name || 'Friend'},\n\n${customMessage}\n\nYour trust means everything.\n\n— The EasySuccor Team 🤝`
    ];
    
    await bot.telegram.sendMessage(targetId, appreciations[Math.floor(Math.random() * appreciations.length)], { parse_mode: 'Markdown' });
    await ctx.reply(`✅ Appreciation sent to ${client.first_name || 'the client'}.`);
});

// ============ LEGACY SUPPORT FUNCTIONS ============
function random(arr) { 
    return arr[Math.floor(Math.random() * arr.length)]; 
}

function getQuestion(type) { 
    return random(RESPONSES.questions[type]); 
}

function getReaction() { 
    return random([...RESPONSES.reactions.positive, ...RESPONSES.reactions.funny]); 
}

function getEncouragement(type, value, name = '') { 
    if (type === 'progress') return getProgressEncouragement(value, name);
    if (type === 'sectionComplete') return getSectionEncouragement(value, name);
    if (type === 'final') return getRandomEncouragement('final', value);
    if (type === 'start') return getRandomEncouragement('start', value);
    return getReaction();
}

function random(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function getQuestion(type) { return random(RESPONSES.questions[type]); }
function getReaction() { return random([...RESPONSES.reactions.positive, ...RESPONSES.reactions.funny]); }
function getEncouragement(type, value) { 
    if (type === 'progress') return random(RESPONSES.encouragements.progress)(value);
    if (type === 'sectionComplete') return random(RESPONSES.encouragements.sectionComplete)(value);
    return random(RESPONSES.encouragements[type]);
}

// ============ SAFE CV DATA ACCESS HELPER (UPDATED - 18+ CATEGORIES) ============
function ensureCVData(session) {
    if (!session.data) session.data = {};
    if (!session.data.cv_data) {
        session.data.cv_data = {
            // Personal Information (10+ fields)
            personal: { 
                full_name: '', 
                email: '', 
                primary_phone: '', 
                alternative_phone: '', 
                whatsapp_phone: '', 
                location: '', 
                physical_address: '', 
                nationality: '', 
                linkedin: '',
                github: '',
                portfolio: '',
                professional_title: '',
                date_of_birth: '',
                special_documents: [] 
            },
            // Professional Summary (AI generated)
            professional_summary: '',
            
            // Work Experience (with all details)
            employment: [],
            
            // Education (with all details)
            education: [],
            
            // Skills (categorized)
            skills: { technical: [], soft: [], tools: [], certifications: [] },
            
            // Certifications (with issuer, date, expiry)
            certifications: [],
            
            // Languages (with proficiency)
            languages: [],
            
            // Projects (with description, technologies, role, link)
            projects: [],
            
            // Achievements (with date, issuer)
            achievements: [],
            
            // Volunteer Experience
            volunteer: [],
            
            // Leadership Roles
            leadership: [],
            
            // Awards & Recognition
            awards: [],
            
            // Publications
            publications: [],
            
            // Conferences Attended
            conferences: [],
            
            // Referees (with position, company, contact)
            referees: [],
            
            // Interests & Hobbies
            interests: [],
            
            // Social Media Links
            social_media: {
                linkedin: '',
                github: '',
                twitter: '',
                facebook: '',
                instagram: '',
                portfolio: ''
            },
            
            // Portfolio Links (array)
            portfolio: []
        };
    }
    
    // Ensure personal object has all fields
    if (!session.data.cv_data.personal) {
        session.data.cv_data.personal = { 
            full_name: '', email: '', primary_phone: '', alternative_phone: '', 
            whatsapp_phone: '', location: '', physical_address: '', nationality: '',
            linkedin: '', github: '', portfolio: '', professional_title: '', 
            date_of_birth: '', special_documents: [] 
        };
    }
    
    // Ensure personal special_documents is array
    if (!session.data.cv_data.personal.special_documents) {
        session.data.cv_data.personal.special_documents = [];
    }
    if (!Array.isArray(session.data.cv_data.personal.special_documents)) {
        session.data.cv_data.personal.special_documents = [];
    }
    
    // Ensure all arrays exist
    if (!session.data.cv_data.education) session.data.cv_data.education = [];
    if (!session.data.cv_data.employment) session.data.cv_data.employment = [];
    if (!session.data.cv_data.certifications) session.data.cv_data.certifications = [];
    if (!session.data.cv_data.languages) session.data.cv_data.languages = [];
    if (!session.data.cv_data.referees) session.data.cv_data.referees = [];
    if (!session.data.cv_data.projects) session.data.cv_data.projects = [];
    if (!session.data.cv_data.achievements) session.data.cv_data.achievements = [];
    if (!session.data.cv_data.volunteer) session.data.cv_data.volunteer = [];
    if (!session.data.cv_data.leadership) session.data.cv_data.leadership = [];
    if (!session.data.cv_data.awards) session.data.cv_data.awards = [];
    if (!session.data.cv_data.publications) session.data.cv_data.publications = [];
    if (!session.data.cv_data.conferences) session.data.cv_data.conferences = [];
    if (!session.data.cv_data.interests) session.data.cv_data.interests = [];
    if (!session.data.cv_data.portfolio) session.data.cv_data.portfolio = [];
    
    // Ensure skills object has all categories
    if (!session.data.cv_data.skills || typeof session.data.cv_data.skills !== 'object') {
        session.data.cv_data.skills = { technical: [], soft: [], tools: [], certifications: [] };
    }
    if (!session.data.cv_data.skills.technical) session.data.cv_data.skills.technical = [];
    if (!session.data.cv_data.skills.soft) session.data.cv_data.skills.soft = [];
    if (!session.data.cv_data.skills.tools) session.data.cv_data.skills.tools = [];
    if (!session.data.cv_data.skills.certifications) session.data.cv_data.skills.certifications = [];
    
    // Ensure social_media object exists
    if (!session.data.cv_data.social_media) {
        session.data.cv_data.social_media = { linkedin: '', github: '', twitter: '', facebook: '', instagram: '', portfolio: '' };
    }
    
    return session.data.cv_data;
}

// ============ SAFE COVER LETTER DATA ACCESS HELPER (UPDATED) ============
function ensureCoverLetterData(session) {
    if (!session.data) session.data = {};
    if (!session.data.coverletter) session.data.coverletter = {};
    if (session.data.coverletter_position === undefined) session.data.coverletter_position = '';
    if (session.data.coverletter_company === undefined) session.data.coverletter_company = '';
    if (session.data.vacancy_data === undefined) session.data.vacancy_data = null;
    if (session.data.awaiting_vacancy === undefined) session.data.awaiting_vacancy = false;
    
    // Ensure cover_data exists
    if (!session.data.cover_data) session.data.cover_data = {};
    
    return session.data;
};

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

function calculateTotal(category, service, delivery) { 
    return getBasePrice(category, service) + (DELIVERY_PRICES[delivery] || 0);
}

function generatePaymentReference() {
    return `EASY${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 10000)}`;
}
// ============ DATABASE HELPERS ============
async function getOrCreateClient(ctx) {
    let client = await db.getClient(ctx.from.id);
    if (!client) client = await db.createClient(ctx.from.id, ctx.from.username, ctx.from.first_name, ctx.from.last_name);
    return client;
}

async function debugSession(ctx, session, message) {
    console.log(`[DEBUG] ${message}`);
    console.log(`[DEBUG] Stage: ${session.stage}`);
    console.log(`[DEBUG] Current section: ${session.current_section}`);
    console.log(`[DEBUG] Collection step: ${session.data?.collection_step}`);
    console.log(`[DEBUG] Text received: ${ctx.message?.text}`);
}

async function getOrCreateSession(clientId) {
    let session = await db.getActiveSession(clientId);
    if (!session) {
        // DIRECT TO CATEGORY - NO WELCOME MESSAGE
        await db.saveSession(clientId, 'selecting_category', null, {});
        session = await db.getActiveSession(clientId);
    }
    if (!session.data) session.data = {};
    if (typeof session.data === 'string') { try { session.data = JSON.parse(session.data); } catch(e) { session.data = {}; } }
    if (!session.data.services) session.data.services = [];
    return session;
}

// ============ PERSISTENT KEYBOARD ============
const mainMenuKeyboard = Markup.keyboard([
    ["📄 New CV", "📝 Editable CV"],
    ["💌 Cover Letter", "📎 Editable Cover Letter"],
    ["✏️ Update CV", "📎 Upload Draft"],
    ["ℹ️ About", "📞 Contact", "🏠 Portal"]
]).resize().persistent();

// ============ START - DIRECT TO CATEGORY (NO WELCOME) ============
async function startDirect(ctx, client, session) {
    await sendMarkdown(ctx, `📋 *Welcome! Select your category to get started:*`, {
        reply_markup: { inline_keyboard: [
            [{ text: "🎓 Student - still studying", callback_data: "cat_student" }],
            [{ text: "📜 Recent Graduate < a year", callback_data: "cat_recent" }],
            [{ text: "💼 Professional - Currently working", callback_data: "cat_professional" }],
            [{ text: "🌱 Non-Working - Career break", callback_data: "cat_nonworking" }],
            [{ text: "🔄 Returning Client - Used us before", callback_data: "cat_returning" }]
        ] }
    });
    
    await db.updateSession(session.id, 'selecting_category', null, session.data);
}

// ============ CATEGORY SELECTION ============
async function handleCategorySelection(ctx, client, session, data) {
    const categoryMap = {
        cat_student: 'student', cat_recent: 'recentgraduate',
        cat_professional: 'professional', cat_nonworking: 'nonworkingprofessional',
        cat_returning: 'returningclient'
    };
    
    session.data.category = categoryMap[data];
    
    const serviceButtons = session.data.category === 'returningclient' ? [
        [{ text: "📝 Editable CV", callback_data: "service_editable" }],
        [{ text: "✏️ Update CV", callback_data: "service_update" }],
        [{ text: "💌 Cover Letter", callback_data: "service_cover" }],
        [{ text: "📎 Editable Cover Letter", callback_data: "service_editable_cover" }]
    ] : [
        [{ text: "📄 New CV", callback_data: "service_new" }],
        [{ text: "📝 Editable CV", callback_data: "service_editable" }],
        [{ text: "💌 Cover Letter", callback_data: "service_cover" }],
        [{ text: "📎 Editable Cover Letter", callback_data: "service_editable_cover" }]
    ];
    
    await sendMarkdown(ctx, `✅ ${getReaction()} Category selected: *${session.data.category}*

Now, which service would you like?`, {
        reply_markup: { inline_keyboard: serviceButtons }
    });
    
    await db.updateSession(session.id, 'selecting_service', null, session.data);
}

// ============ SERVICE SELECTION (UPDATED) ============
async function handleServiceSelection(ctx, client, session, data) {
    const serviceMap = {
        service_new: 'new cv', 
        service_editable: 'editable cv',
        service_cover: 'cover letter', 
        service_editable_cover: 'editable cover letter',
        service_update: 'cv update'
    };
    
    const selectedService = serviceMap[data];
    session.data.service = selectedService;
    
    if (selectedService === 'cv update') {
        await handleIntelligentUpdate(ctx, client, session);
        return;
    }
    
    if (selectedService === 'cover letter' || selectedService === 'editable cover letter') {
        await handleCoverLetterStart(ctx, client, session);
        return;
    }
    
    // For CV services, ensure 18+ categories data structure is ready
    const cvData = ensureCVData(session);
    
    await sendMarkdown(ctx, `${getReaction()} *Service selected:* ${selectedService}

*Would you like to upload an existing draft to save time?*

I can extract ALL information from your existing CV including:
📋 Personal Info
💼 Work Experience (with responsibilities & achievements)
🎓 Education
⚡ Skills (categorized)
📜 Certifications
🌍 Languages
📁 Projects
🏆 Achievements
🤝 Volunteer Experience
👔 Leadership Roles
🏅 Awards
📖 Publications
🎤 Conferences
👥 Referees
💡 Interests
🌐 Social Media Links

*I'll only ask for what's missing!*`, {
        reply_markup: { inline_keyboard: [
            [{ text: "📎 Yes, upload draft", callback_data: "build_draft" }],
            [{ text: "✍️ No, enter manually", callback_data: "build_manual" }]
        ] }
    });
    
    await db.updateSession(session.id, 'selecting_build_method', null, session.data);
}

// ============ COVER LETTER HANDLERS (UPDATED with better prompts) ============
async function handleCoverLetterStart(ctx, client, session) {
    ensureCoverLetterData(session);
    
    await sendMarkdown(ctx, `📝 *Cover Letter Creation*

I'll help you create a professional cover letter tailored to your dream job.

*What I'll need from you:*
• Position you're applying for
• Company name
• Your relevant experience
• Top skills for this role
• Key achievement
• Why you're interested
• Availability to start

*Do you have a job vacancy in mind?*

Select an option:`, {
        reply_markup: { inline_keyboard: [
            [{ text: "📄 Yes, I have vacancy details", callback_data: "cover_has_vacancy" }],
            [{ text: "✍️ No, create general cover letter", callback_data: "cover_no_vacancy" }]
        ] }
    });
    
    await db.updateSession(session.id, 'cover_selecting_vacancy', 'cover', session.data);
}

// In handleCoverLetterStart or when client provides position
bot.on('text', async (ctx, next) => {
    // Check if this is a position being entered
    const session = await db.getActiveSession(client.id);
    
    if (session?.stage === 'cover_collecting_position') {
        const position = ctx.message.text;
        
        // Check vacancy library
        const matches = await vacancyLibrary.findSimilarVacancies(position);
        
        if (matches.length > 0) {
            await checkVacancyLibrary(ctx, position);
            return; // Wait for user to choose
        }
    }
    
    return next();
});

// Handle vacancy match selection
bot.action(/vacancy_match_(.+)/, async (ctx) => {
    const vacancyId = ctx.match[1];
    const vacancy = await db.getVacancyById(vacancyId);
    
    await ctx.answerCbQuery();
    await ctx.editMessageText(`✅ *Using Existing Vacancy Details*\n\nPosition: ${vacancy.position}\nCompany: ${vacancy.company}\n\nI'll tailor your documents perfectly for this role!`);
    
    // Store vacancy in session
    const client = await getOrCreateClient(ctx);
    const session = await db.getActiveSession(client.id);
    session.data.vacancy_data = vacancy;
    session.data.using_library_vacancy = true;
    await db.updateSession(session.id, session.stage, session.current_section, session.data);
    
    // Continue cover letter flow
    await askCoverLetterQuestions(ctx, client, session);
});

async function handleCoverVacancyChoice(ctx, client, session, data) {
    if (data === 'cover_has_vacancy') {
        session.data.cover_has_vacancy = true;
        await sendMarkdown(ctx, `📄 *Share the Job Vacancy*

You can send me:
• 📎 PDF or DOCX file
• 📸 Screenshot (image)
• 📝 Paste the job description text

I'll extract:
• Position title
• Company name
• Requirements
• Responsibilities
• Deadline

Send the vacancy details now:`);
        session.data.awaiting_vacancy = true;
        await db.updateSession(session.id, 'awaiting_vacancy_upload', 'cover', session.data);
    } else {
        session.data.cover_has_vacancy = false;
        await askCoverLetterQuestions(ctx, client, session);
    }
}

async function askCoverLetterQuestions(ctx, client, session) {
    session.data.cover_data = {};
    session.data.cover_step = 'position';
    
    await sendMarkdown(ctx, `📝 *Tell me about the job*

*What position are you applying for?*

*Example:* "Senior Software Engineer", "Project Manager", "Data Collector"

Type the job title:`);
    await db.updateSession(session.id, 'cover_collecting_position', 'cover', session.data);
}

async function handleCoverPosition(ctx, client, session, text) {
    session.data.cover_data.position = text;
    session.data.cover_step = 'company';
    await sendMarkdown(ctx, `✅ Got it! *${text}*

*Which company are you applying to?*

*Example:* "ABC Corporation", "UNDP Malawi", "Google", "National Statistics Office"

Type the company name:`);
    await db.updateSession(session.id, 'cover_collecting_company', 'cover', session.data);
}

async function handleCoverCompany(ctx, client, session, text) {
    session.data.cover_data.company = text;
    session.data.cover_step = 'experience_highlight';
    await sendMarkdown(ctx, `✅ Thanks!

*What's your most relevant experience for this role?* (2-3 sentences)

*Example:* "5 years of project management experience leading teams of 10+"

Type your key experience (2-3 sentences):`);
    await db.updateSession(session.id, 'cover_collecting_experience', 'cover', session.data);
}

async function handleCoverExperience(ctx, client, session, text) {
    session.data.cover_data.experience_highlight = text;
    session.data.cover_step = 'skills_highlight';
    await sendMarkdown(ctx, `✅ Great experience!

*What are your top 3 skills for this role?* (comma separated)

*Example:* "Project Management, Team Leadership, Budget Planning"

Type your skills (comma separated):`);
    await db.updateSession(session.id, 'cover_collecting_skills', 'cover', session.data);
}

async function handleCoverSkills(ctx, client, session, text) {
    session.data.cover_data.skills = text.split(',').map(s => s.trim());
    session.data.cover_step = 'achievement';
    await sendMarkdown(ctx, `✅ Skills saved!

*What's your biggest professional achievement?*

*Example:* "Increased sales by 40% in 6 months", "Successfully delivered MK2M project under budget"

Type your key achievement:`);
    await db.updateSession(session.id, 'cover_collecting_achievement', 'cover', session.data);
}

async function handleCoverAchievement(ctx, client, session, text) {
    session.data.cover_data.achievement = text;
    session.data.cover_step = 'why_you';
    await sendMarkdown(ctx, `✅ Impressive!

*Why are you interested in this role/company?* (2-3 sentences)

*Example:* "I'm passionate about your mission to improve education", "I admire your innovative approach to technology"

Type your motivation (2-3 sentences):`);
    await db.updateSession(session.id, 'cover_collecting_why', 'cover', session.data);
}

async function handleCoverWhy(ctx, client, session, text) {
    session.data.cover_data.motivation = text;
    session.data.cover_step = 'availability';
    await sendMarkdown(ctx, `✅ Great motivation!

*When are you available to start?*

Select an option:`, {
        reply_markup: { inline_keyboard: [
            [{ text: "📅 Immediately", callback_data: "cover_availability_immediate" }],
            [{ text: "📅 2 weeks notice", callback_data: "cover_availability_2weeks" }],
            [{ text: "📅 1 month notice", callback_data: "cover_availability_1month" }],
            [{ text: "📝 Specific date", callback_data: "cover_availability_specific" }]
        ] }
    });
    await db.updateSession(session.id, 'cover_collecting_availability', 'cover', session.data);
}

// Handle availability with clickable buttons
async function handleCoverAvailabilityChoice(ctx, client, session, data) {
    let availability = '';
    if (data === 'cover_availability_immediate') availability = 'Immediately';
    else if (data === 'cover_availability_2weeks') availability = '2 weeks notice';
    else if (data === 'cover_availability_1month') availability = '1 month notice';
    else if (data === 'cover_availability_specific') {
        await sendMarkdown(ctx, `📅 Please enter your specific start date (e.g., "1st June 2025"):`);
        session.data.cover_step = 'availability_specific';
        await db.updateSession(session.id, 'cover_collecting_availability_specific', 'cover', session.data);
        return;
    }
    
    session.data.cover_data.availability = availability;
    await finalizeCoverLetter(ctx, client, session);
}

// Handle specific date availability
async function handleCoverAvailabilitySpecific(ctx, client, session, text) {
    session.data.cover_data.availability = text;
    await finalizeCoverLetter(ctx, client, session);
}

// ============ UPDATED FINALIZE COVER LETTER ============
async function finalizeCoverLetter(ctx, client, session) {
    const cvData = ensureCVData(session);
    const personal = cvData.personal || {};
    const coverData = session.data.cover_data || {};
    const vacancyData = session.data.vacancy_data || {};
    
    if (session.data.cover_has_vacancy && vacancyData) {
        if (vacancyData.position && !coverData.position) coverData.position = vacancyData.position;
        if (vacancyData.company && !coverData.company) coverData.company = vacancyData.company;
    }
    
    const orderId = `CL_${Date.now()}_${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
    const basePrice = 5000;
    const deliveryOption = session.data.delivery_option || 'standard';
    const deliveryFee = DELIVERY_PRICES[deliveryOption] || 0;
    const totalCharge = formatPrice(basePrice + deliveryFee);
    const deliveryTime = DELIVERY_TIMES[deliveryOption];
    
    // Show summary before finalizing
    const summary = `📝 *COVER LETTER SUMMARY*

━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 DETAILS
━━━━━━━━━━━━━━━━━━━━━━━━━━━

Position: ${coverData.position || vacancyData.position || 'Not specified'}
Company: ${coverData.company || vacancyData.company || 'Not specified'}
Experience: ${coverData.experience_highlight || 'Provided'}
Skills: ${(coverData.skills || []).join(', ') || 'Provided'}
Achievement: ${coverData.achievement || 'Provided'}
Availability: ${coverData.availability || 'Not specified'}

━━━━━━━━━━━━━━━━━━━━━━━━━━━
💰 PRICE
━━━━━━━━━━━━━━━━━━━━━━━━━━━

Base Price: MK5,000
Delivery Fee: +${deliveryFee}
Total: ${totalCharge}
Delivery: ${deliveryTime}

━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ Type *CONFIRM* to proceed or *EDIT* to make changes.`;

    await sendMarkdown(ctx, summary);
    session.data.awaiting_cover_confirmation = true;
    session.data.pending_cover_order = {
        orderId, coverData, vacancyData, deliveryOption, deliveryFee, totalCharge, deliveryTime, basePrice
    };
    await db.updateSession(session.id, 'awaiting_cover_confirmation', 'cover', session.data);
}

// Handle cover letter confirmation
async function handleCoverConfirmation(ctx, client, session, text) {
    if (text.toUpperCase() === 'CONFIRM') {
        const pending = session.data.pending_cover_order;
        
        const coverResult = await documentGenerator.generateCoverLetter({
            position: pending.coverData.position || pending.vacancyData.position || 'Not specified',
            company: pending.coverData.company || pending.vacancyData.company || 'Not specified',
            experience: pending.coverData.experience_highlight,
            skills: pending.coverData.skills,
            achievement: pending.coverData.achievement,
            motivation: pending.coverData.motivation,
            availability: pending.coverData.availability
        }, cvData, personal, false);
        
        await db.createOrder({
            id: pending.orderId, client_id: client.id, service: 'cover letter', 
            category: session.data.category || 'professional',
            delivery_option: pending.deliveryOption, delivery_time: pending.deliveryTime, 
            base_price: pending.basePrice, delivery_fee: pending.deliveryFee,
            total_charge: pending.totalCharge, payment_status: 'pending',
            cv_data: { cover_letter: pending.coverData, vacancy: pending.vacancyData }
        });
        
        const paymentReference = generatePaymentReference();
        await db.updateOrderPaymentReference(pending.orderId, paymentReference);
        
        // Show payment options with clickable buttons
        await showPaymentOptions(ctx, pending.orderId, pending.totalCharge, paymentReference);
        
        session.data.awaiting_cover_confirmation = false;
        await db.updateSession(session.id, 'awaiting_payment', 'payment', session.data);
    } else if (text.toUpperCase().startsWith('EDIT')) {
        await sendMarkdown(ctx, `What would you like to change? Type the field name (position, company, experience, skills, achievement, motivation, availability):`);
        session.data.editing_cover = true;
        await db.updateSession(session.id, 'editing_cover', 'cover', session.data);
    }
}

// ============ VACANCY LIBRARY SYSTEM ============
class VacancyLibrary {
    constructor() {
        this.commonKeywords = {
            'software engineer': ['developer', 'programming', 'coding', 'software'],
            'project manager': ['pm', 'project lead', 'scrum master', 'agile'],
            'data analyst': ['data science', 'analytics', 'sql', 'excel'],
            'accountant': ['finance', 'bookkeeping', 'audit', 'tax'],
            'teacher': ['education', 'instructor', 'lecturer', 'tutor'],
            'nurse': ['healthcare', 'medical', 'clinical', 'patient care'],
            'driver': ['transport', 'logistics', 'delivery', 'vehicle'],
            'carpenter': ['woodwork', 'joinery', 'furniture', 'construction']
        };
    }
    
    // Generate unique hash for vacancy
    generateVacancyHash(vacancy) {
        const normalized = `${vacancy.position}|${vacancy.company}|${vacancy.location || ''}`
            .toLowerCase()
            .replace(/[^a-z0-9]/g, '');
        return require('crypto').createHash('md5').update(normalized).digest('hex');
    }
    
    // Store vacancy in library
    async storeVacancy(vacancyData, clientId = null) {
        const hash = this.generateVacancyHash(vacancyData);
        
        // Check if already exists
        const existing = await db.getVacancyByHash(hash);
        
        if (existing) {
            // Increment usage count
            await db.incrementVacancyUsage(existing.id);
            return { ...existing, is_new: false };
        }
        
        // Store new vacancy
        const vacancy = {
            ...vacancyData,
            hash,
            requirements: JSON.stringify(vacancyData.requirements || []),
            responsibilities: JSON.stringify(vacancyData.responsibilities || []),
            benefits: JSON.stringify(vacancyData.benefits || [])
        };
        
        const id = await db.createVacancy(vacancy);
        
        if (clientId) {
            await db.recordVacancyMatch(id, clientId);
        }
        
        return { ...vacancy, id, is_new: true };
    }
    
    // Find similar vacancies
    async findSimilarVacancies(position, company = null) {
        const allVacancies = await db.getAllVacancies();
        const matches = [];
        
        const searchTerms = position.toLowerCase().split(' ');
        const categoryKeywords = this.getCategoryKeywords(position);
        
        for (const vac of allVacancies) {
            let score = 0;
            const vacPosition = vac.position.toLowerCase();
            const vacCompany = vac.company.toLowerCase();
            
            // Exact position match
            if (vacPosition === position.toLowerCase()) {
                score += 50;
            }
            
            // Company match
            if (company && vacCompany === company.toLowerCase()) {
                score += 30;
            }
            
            // Keyword matches
            for (const term of searchTerms) {
                if (vacPosition.includes(term)) score += 10;
            }
            
            // Category keyword matches
            for (const keyword of categoryKeywords) {
                if (vacPosition.includes(keyword)) score += 5;
            }
            
            // Location bonus
            if (position.toLowerCase().includes(vac.location?.toLowerCase() || '')) {
                score += 15;
            }
            
            if (score >= 40) {
                matches.push({ ...vac, match_score: score });
            }
        }
        
        return matches.sort((a, b) => b.match_score - a.match_score).slice(0, 5);
    }
    
    // Get category keywords based on position
    getCategoryKeywords(position) {
        const lower = position.toLowerCase();
        for (const [category, keywords] of Object.entries(this.commonKeywords)) {
            if (keywords.some(k => lower.includes(k))) {
                return keywords;
            }
        }
        return [];
    }
    
    // Format vacancy match message
    formatVacancyMatches(matches, clientPosition) {
        if (matches.length === 0) return null;
        
        let message = `🔍 *I Found Similar Vacancies in Our Library!*\n\n`;
        message += `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
        message += `We already have details for ${matches.length} similar position(s).\n`;
        message += `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
        
        matches.slice(0, 3).forEach((match, i) => {
            const matchPercent = Math.min(100, match.match_score);
            message += `${i + 1}. *${match.position}* at *${match.company}*\n`;
            message += `   📍 ${match.location || 'Location not specified'}\n`;
            message += `   📊 ${matchPercent}% match\n`;
            if (match.deadline) message += `   ⏰ Deadline: ${match.deadline}\n`;
            message += `\n`;
        });
        
        message += `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
        message += `Is one of these the position you're applying for?\n\n`;
        message += `✅ *Yes, use existing details* - I'll tailor your documents perfectly\n`;
        message += `📝 *No, this is different* - I'll collect new details\n`;
        
        return message;
    }
}

const vacancyLibrary = new VacancyLibrary();

// ============ INTEGRATE WITH VACANCY COLLECTION ============
async function handleVacancyCollection(ctx, client, session, vacancyData) {
    // Store in library
    const stored = await vacancyLibrary.storeVacancy(vacancyData, client.id);
    
    if (!stored.is_new) {
        await ctx.reply(`📚 *This vacancy is already in our library!*\n\nWe've helped other clients apply to ${vacancyData.position} at ${vacancyData.company} before. This means we know exactly what they're looking for!`);
    }
    
    session.data.vacancy_data = vacancyData;
    // Continue with normal flow...
}

// ============ CHECK FOR SIMILAR VACANCIES WHEN CLIENT MENTIONS POSITION ============
async function checkVacancyLibrary(ctx, position, company = null) {
    const matches = await vacancyLibrary.findSimilarVacancies(position, company);
    
    if (matches.length === 0) return null;
    
    const message = vacancyLibrary.formatVacancyMatches(matches, position);
    
    await ctx.reply(message, {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                [{ text: "✅ Yes, use this", callback_data: `vacancy_match_${matches[0].id}` }],
                [{ text: "📋 Show more options", callback_data: `vacancy_more_${position}` }],
                [{ text: "📝 No, different position", callback_data: "vacancy_new" }]
            ]
        }
    });
    
    return matches;
}
// ============ PORTFOLIO COLLECTION (UPDATED - Supports all social media) ============
class PortfolioCollector {
    async askForPortfolio(ctx) {
        await sendMarkdown(ctx, `📎 *Portfolio & Social Media (Optional)*

Would you like to include links to your work and professional profiles?

*What you can add:*
• LinkedIn profile
• GitHub repositories
• Twitter/X profile
• Facebook profile
• Instagram (professional)
• Personal website/portfolio
• Behance/Dribbble (creatives)
• Case studies or project links

*Why this matters:* Employers love seeing real work examples and professional presence!

Type your links (one per line) or click SKIP.

*Examples:* 
https://linkedin.com/in/username
https://github.com/username
https://yourportfolio.com`, {
            reply_markup: { inline_keyboard: [[{ text: "⏭️ Skip Portfolio", callback_data: "portfolio_skip" }]] }
        });
    }
    
    parsePortfolioLinks(text) {
        if (!text || text.toLowerCase() === 'skip') return [];
        const links = [];
        const lines = text.split('\n');
        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed && (trimmed.startsWith('http://') || trimmed.startsWith('https://'))) {
                links.push(trimmed);
            }
        }
        return links;
    }
    
    categorizeSocialLinks(links) {
        const social = {
            linkedin: null,
            github: null,
            twitter: null,
            facebook: null,
            instagram: null,
            portfolio: null,
            other: []
        };
        
        for (const link of links) {
            if (link.includes('linkedin.com')) social.linkedin = link;
            else if (link.includes('github.com')) social.github = link;
            else if (link.includes('twitter.com') || link.includes('x.com')) social.twitter = link;
            else if (link.includes('facebook.com')) social.facebook = link;
            else if (link.includes('instagram.com')) social.instagram = link;
            else if (link.includes('behance.net') || link.includes('dribbble.com') || link.includes('medium.com')) social.portfolio = link;
            else social.other.push(link);
        }
        
        return social;
    }
}

const portfolioCollector = new PortfolioCollector();

async function handlePortfolioCollection(ctx, client, session, text) {
    try {
        let portfolioLinks = [];
        let socialMedia = { linkedin: null, github: null, twitter: null, facebook: null, instagram: null, portfolio: null };
        
        if (text !== 'skip' && text?.toLowerCase() !== 'skip') {
            const lines = text.split('\n');
            for (const line of lines) {
                const trimmed = line.trim();
                if (trimmed && (trimmed.startsWith('http://') || trimmed.startsWith('https://'))) {
                    portfolioLinks.push(trimmed);
                    
                    // Categorize social links
                    if (trimmed.includes('linkedin.com')) socialMedia.linkedin = trimmed;
                    else if (trimmed.includes('github.com')) socialMedia.github = trimmed;
                    else if (trimmed.includes('twitter.com') || trimmed.includes('x.com')) socialMedia.twitter = trimmed;
                    else if (trimmed.includes('facebook.com')) socialMedia.facebook = trimmed;
                    else if (trimmed.includes('instagram.com')) socialMedia.instagram = trimmed;
                    else if (trimmed.includes('behance.net') || trimmed.includes('dribbble.com') || trimmed.includes('medium.com')) socialMedia.portfolio = trimmed;
                }
            }
        }
        
        session.data.portfolio_links = portfolioLinks;
        
        // Store categorized social media in cv_data
        const cvData = ensureCVData(session);
        cvData.social_media = socialMedia;
        cvData.portfolio = portfolioLinks;
        
        await sendMarkdown(ctx, `${getReaction()} ${portfolioLinks.length > 0 ? `${portfolioLinks.length} link(s) saved!` : 'No portfolio added.'}

Now let's build your CV! 

${getQuestion('name')}`);
        
        await startDataCollection(ctx, client, session);
    } catch (error) {
        console.error('Portfolio error:', error);
        session.data.portfolio_links = [];
        await sendMarkdown(ctx, `Let's continue with your details.\n\n${getQuestion('name')}`);
        await startDataCollection(ctx, client, session);
    }
}

async function startDataCollection(ctx, client, session) {
    const cvData = ensureCVData(session);
    if (!session.data.portfolio_links || !Array.isArray(session.data.portfolio_links)) session.data.portfolio_links = [];
    cvData.portfolio = session.data.portfolio_links;
    
    session.current_section = 'personal';
    session.data.collection_step = 'name';
    session.data.special_docs_list = [];
    await db.updateSession(session.id, 'collecting_personal', 'personal', session.data);
}

// Add to your cron jobs or periodic checks
async function sendHireReminder(clientId) {
    const client = await db.getClientById(clientId);
    if (!client) return;
    
    const orders = await db.getClientOrders(clientId);
    const lastOrder = orders[0];
    
    if (!lastOrder) return;
    
    const daysSinceOrder = Math.floor((Date.now() - new Date(lastOrder.created_at)) / (1000 * 60 * 60 * 24));
    
    // Send reminder 30 days after order completion
    if (daysSinceOrder === 30 && lastOrder.status === 'delivered') {
        await bot.telegram.sendMessage(
            client.telegram_id,
            `👋 *Hello ${client.first_name || 'Friend'}!*

━━━━━━━━━━━━━━━━━━━━━━━━━━━
🌟 *How's Your Job Search Going?*
━━━━━━━━━━━━━━━━━━━━━━━━━━━

It's been a month since we created your CV. If you've landed a job, we'd love to celebrate with you!

Type /hired to share your success story.

Your achievement inspires others in their career journey!

🤝 The EasySuccor Team`,
            { parse_mode: 'Markdown' }
        );
    }
}

// ============ PERSONAL COLLECTION (UPDATED - includes LinkedIn, GitHub, etc.) ============
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
        await sendMarkdown(ctx, "📞 Alternative phone number?", {
            reply_markup: { inline_keyboard: [[{ text: "⏭️ Skip", callback_data: "skip_alt_phone" }]] }
        });
    }
    else if (step === 'alt_phone') {
        personal.alternative_phone = text === 'Skip' ? null : text;
        session.data.collection_step = 'whatsapp';
        await sendMarkdown(ctx, "📱 WhatsApp for delivery?", {
            reply_markup: { inline_keyboard: [[{ text: "📱 Same", callback_data: "whatsapp_same" }, { text: "✏️ Type New", callback_data: "whatsapp_type" }]] }
        });
    }
    else if (step === 'whatsapp') {
        if (text !== 'whatsapp_type' && text !== 'Same') {
            personal.whatsapp_phone = text === 'Same' ? personal.primary_phone : text;
        } else if (text === 'whatsapp_type') {
            await sendMarkdown(ctx, "Please type your WhatsApp number:");
            return;
        }
        session.data.collection_step = 'location';
        await sendMarkdown(ctx, getQuestion('location'));
    }
    else if (step === 'location') {
        personal.location = text;
        session.data.collection_step = 'professional_title';
        await sendMarkdown(ctx, "💼 *Professional title?* (Optional)\n\n*Example:* Senior Software Engineer, Project Manager\n\nType 'Skip' to continue.", {
            reply_markup: { inline_keyboard: [[{ text: "⏭️ Skip", callback_data: "skip_professional_title" }]] }
        });
    }
    else if (step === 'professional_title') {
        if (text.toLowerCase() !== 'skip') personal.professional_title = text;
        session.data.collection_step = 'linkedin';
        await sendMarkdown(ctx, "🔗 *LinkedIn URL?* (Optional)\n\n*Example:* https://linkedin.com/in/yourname\n\nType 'Skip' to continue.", {
            reply_markup: { inline_keyboard: [[{ text: "⏭️ Skip", callback_data: "skip_linkedin" }]] }
        });
    }
    else if (step === 'linkedin') {
        if (text.toLowerCase() !== 'skip') personal.linkedin = text;
        session.data.collection_step = 'github';
        await sendMarkdown(ctx, "💻 *GitHub URL?* (Optional)\n\n*Example:* https://github.com/yourusername\n\nType 'Skip' to continue.", {
            reply_markup: { inline_keyboard: [[{ text: "⏭️ Skip", callback_data: "skip_github" }]] }
        });
    }
    else if (step === 'github') {
        if (text.toLowerCase() !== 'skip') personal.github = text;
        session.data.collection_step = 'physical_address';
        await sendMarkdown(ctx, `🏠 *Physical address?* (Street, building, area)\n\nType 'Skip' to continue.`, {
            reply_markup: { inline_keyboard: [[{ text: "⏭️ Skip", callback_data: "skip_physical_address" }]] }
        });
    }
    else if (step === 'physical_address') {
        if (text.toLowerCase() !== 'skip') personal.physical_address = text;
        session.data.collection_step = 'nationality';
        await sendMarkdown(ctx, `🌍 *Nationality?*\n\nType 'Skip' to continue.`, {
            reply_markup: { inline_keyboard: [[{ text: "⏭️ Skip", callback_data: "skip_nationality" }]] }
        });
    }
    else if (step === 'nationality') {
        if (text.toLowerCase() !== 'skip') personal.nationality = text;
        session.data.collection_step = 'date_of_birth';
        await sendMarkdown(ctx, `🎂 *Date of Birth?* (Optional)\n\n*Example:* 15 May 1990\n\nType 'Skip' to continue.`, {
            reply_markup: { inline_keyboard: [[{ text: "⏭️ Skip", callback_data: "skip_dob" }]] }
        });
    }
    else if (step === 'date_of_birth') {
        if (text.toLowerCase() !== 'skip') personal.date_of_birth = text;
        session.data.collection_step = 'special_docs';
        await sendMarkdown(ctx, `📋 *Special Documents (Optional)*

Do you have any special documents? (e.g., Driver's License, Passport, Professional License, Work Permit)

Type each document name and number, one per line.

*Examples:*
• Driver's License: MW123456
• Passport: MW987654
• Professional License: TEVETA/2024/001

Click 'Skip' to continue or 'Done' when finished.`, {
            reply_markup: { inline_keyboard: [[{ text: "⏭️ Skip", callback_data: "skip_special_docs" }, { text: "✅ Done", callback_data: "done_special_docs" }]] }
        });
        session.data.special_docs_list = [];
    }
    else if (step === 'special_docs') {
        if (text === 'skip_special_docs') {
            personal.special_documents = [];
            session.current_section = 'education';
            session.data.collection_step = 'level';
            await sendMarkdown(ctx, `${getReaction()}\n\nNow let's add your education.\n\n${getQuestion('education')}`);
            await db.updateSession(session.id, 'collecting_education', 'education', session.data);
            return;
        } else if (text === 'done_special_docs') {
            personal.special_documents = session.data.special_docs_list || [];
            session.current_section = 'education';
            session.data.collection_step = 'level';
            await sendMarkdown(ctx, `${getReaction()}\n\nNow let's add your education.\n\n${getQuestion('education')}`);
            await db.updateSession(session.id, 'collecting_education', 'education', session.data);
            return;
        } else {
            if (!session.data.special_docs_list) session.data.special_docs_list = [];
            session.data.special_docs_list.push(text);
            await sendMarkdown(ctx, `✓ Added. Add another? (Click 'Done' to finish, 'Skip' to skip this section)`, {
                reply_markup: { inline_keyboard: [[{ text: "⏭️ Skip", callback_data: "skip_special_docs" }, { text: "✅ Done", callback_data: "done_special_docs" }]] }
            });
        }
        return;
    }
    
    await db.updateSession(session.id, 'collecting_personal', 'personal', session.data);
}

// ============ SKILLS COLLECTION (UPDATED - Categorized skills) ============
async function handleSkillsCollection(ctx, client, session, text) {
    const cvData = ensureCVData(session);
    const skillsArray = text.split(',').map(s => s.trim());
    
    // Categorize skills intelligently
    const categorized = {
        technical: [],
        soft: [],
        tools: []
    };
    
    const techKeywords = ['python', 'javascript', 'java', 'react', 'node', 'sql', 'mongodb', 'aws', 'docker', 'kubernetes', 'html', 'css', 'c++', 'c#', 'php', 'laravel', 'django', 'flask', 'api', 'git', 'linux', 'excel', 'power bi', 'tableau', 'spss', 'matlab', 'autocad', 'solidworks'];
    const softKeywords = ['leadership', 'communication', 'teamwork', 'problem solving', 'critical thinking', 'time management', 'organization', 'adaptability', 'creativity', 'collaboration', 'negotiation', 'conflict resolution', 'decision making', 'project management', 'agile', 'scrum'];
    
    for (const skill of skillsArray) {
        const lowerSkill = skill.toLowerCase();
        if (techKeywords.some(k => lowerSkill.includes(k))) {
            categorized.technical.push(skill);
        } else if (softKeywords.some(k => lowerSkill.includes(k))) {
            categorized.soft.push(skill);
        } else {
            categorized.tools.push(skill);
        }
    }
    
    // If no categorization was possible, put all in technical
    if (categorized.technical.length === 0 && categorized.soft.length === 0 && categorized.tools.length > 0) {
        categorized.technical = categorized.tools;
        categorized.tools = [];
    }
    
    cvData.skills = categorized;
    
    session.current_section = 'certifications';
    session.data.collection_step = 'name';
    cvData.certifications = [];
    
    await sendMarkdown(ctx, `${getReaction()} ${skillsArray.length} skills saved!\n\n📊 *Skills Categorized:*\n• Technical: ${categorized.technical.length}\n• Soft: ${categorized.soft.length}\n• Tools: ${categorized.tools.length}\n\nAny certifications? (Click SKIP if none)`, {
        reply_markup: { inline_keyboard: [[{ text: "⏭️ Skip Certifications", callback_data: "cert_skip" }]] }
    });
    await db.updateSession(session.id, 'collecting_certifications', 'certifications', session.data);
}

// ============ CERTIFICATIONS COLLECTION (UPDATED - Full details) ============
async function handleCertificationsCollection(ctx, client, session, text, callbackData = null) {
    const cvData = ensureCVData(session);
    const step = session.data.collection_step;
    const certifications = cvData.certifications;
    if (!session.data.current_cert) session.data.current_cert = {};
    const currentCert = session.data.current_cert;
    
    if (step === 'name') {
        if (callbackData === 'cert_skip') {
            session.current_section = 'projects';
            session.data.collection_step = 'name';
            cvData.projects = [];
            await sendMarkdown(ctx, `${getReaction()} Let's move to projects.\n\n*Any projects you want to showcase?* (Click SKIP if none)`, {
                reply_markup: { inline_keyboard: [[{ text: "⏭️ Skip Projects", callback_data: "proj_skip" }]] }
            });
            await db.updateSession(session.id, 'collecting_projects', 'projects', session.data);
            return;
        }
        currentCert.name = text;
        session.data.collection_step = 'issuer';
        await sendMarkdown(ctx, "🏛️ **Issuing organization?**\n*Example:* TEVETA, Google, Microsoft");
    }
    else if (step === 'issuer') {
        currentCert.issuer = text;
        session.data.collection_step = 'date';
        await sendMarkdown(ctx, "📅 **Date obtained?**\n*Example:* 2022, June 2023");
    }
    else if (step === 'date') {
        currentCert.date = text;
        session.data.collection_step = 'expiry';
        await sendMarkdown(ctx, "⏰ **Expiry date?** (if applicable)\n*Example:* 2025, Never expires\n\nType 'Skip' to continue.", {
            reply_markup: { inline_keyboard: [[{ text: "⏭️ Skip", callback_data: "skip_expiry" }]] }
        });
    }
    else if (step === 'expiry') {
        if (callbackData !== 'skip_expiry' && text.toLowerCase() !== 'skip') {
            currentCert.expiry = text;
        }
        session.data.collection_step = 'credential_id';
        await sendMarkdown(ctx, "🆔 **Credential ID?** (if any)\n*Example:* 123456789\n\nType 'Skip' to continue.", {
            reply_markup: { inline_keyboard: [[{ text: "⏭️ Skip", callback_data: "skip_credential_id" }]] }
        });
    }
    else if (step === 'credential_id') {
        if (callbackData !== 'skip_credential_id' && text.toLowerCase() !== 'skip') {
            currentCert.credential_id = text;
        }
        session.data.collection_step = 'url';
        await sendMarkdown(ctx, "🔗 **Certificate URL?** (if available)\n*Example:* https://certification.com/verify/123\n\nType 'Skip' to continue.", {
            reply_markup: { inline_keyboard: [[{ text: "⏭️ Skip", callback_data: "skip_cert_url" }]] }
        });
    }
    else if (step === 'url') {
        if (callbackData !== 'skip_cert_url' && text.toLowerCase() !== 'skip') {
            currentCert.url = text;
        }
        certifications.push({ ...currentCert });
        session.data.current_cert = null;
        session.data.collection_step = 'add_more';
        await sendMarkdown(ctx, `${getReaction()} Certification added!\n\nAnother certification?`, {
            reply_markup: { inline_keyboard: [
                [{ text: "✅ Yes", callback_data: "cert_yes" }],
                [{ text: "❌ No", callback_data: "cert_no" }]
            ] }
        });
    }
    else if (step === 'add_more') {
        if (callbackData === 'cert_yes') {
            session.data.collection_step = 'name';
            session.data.current_cert = {};
            await sendMarkdown(ctx, "Certification name? 📜");
        } else {
            session.current_section = 'projects';
            session.data.collection_step = 'name';
            cvData.projects = [];
            await sendMarkdown(ctx, `${getReaction()} Let's move to projects.\n\n*Any projects you want to showcase?* (Click SKIP if none)`, {
                reply_markup: { inline_keyboard: [[{ text: "⏭️ Skip Projects", callback_data: "proj_skip" }]] }
            });
            await db.updateSession(session.id, 'collecting_projects', 'projects', session.data);
        }
    }
    
    await db.updateSession(session.id, 'collecting_certifications', 'certifications', session.data);
}

// ============ PROJECTS COLLECTION (UPDATED - Full details) ============
async function handleProjectsCollection(ctx, client, session, text, callbackData = null) {
    const cvData = ensureCVData(session);
    let step = session.data.collection_step;
    const projects = cvData.projects;
    
    if (!session.data.proj) session.data.proj = {};
    const currentProj = session.data.proj;
    
    if (step === 'name') {
        if (callbackData === 'proj_skip') {
            session.current_section = 'achievements';
            session.data.collection_step = 'title';
            cvData.achievements = [];
            await sendMarkdown(ctx, `${getReaction()} Let's add achievements.\n\n*What are your key achievements?* (Type each, then DONE when finished)`);
            await db.updateSession(session.id, 'collecting_achievements', 'achievements', session.data);
            return;
        }
        currentProj.name = text;
        session.data.collection_step = 'description';
        await sendMarkdown(ctx, "📝 **Project description?** (2-3 sentences)\n*Example:* Developed a mobile app that helped 10,000+ users track their fitness goals");
    }
    else if (step === 'description') {
        currentProj.description = text;
        session.data.collection_step = 'technologies';
        await sendMarkdown(ctx, "🔧 **Technologies used?**\n*Example:* React, Node.js, MongoDB, AWS");
    }
    else if (step === 'technologies') {
        currentProj.technologies = text;
        session.data.collection_step = 'role';
        await sendMarkdown(ctx, "👤 **Your role?**\n*Example:* Lead Developer, Project Manager, UI/UX Designer");
    }
    else if (step === 'role') {
        currentProj.role = text;
        session.data.collection_step = 'team_size';
        await sendMarkdown(ctx, "👥 **Team size?** (if applicable)\n*Example:* 5 members\n\nType 'Skip' to continue.", {
            reply_markup: { inline_keyboard: [[{ text: "⏭️ Skip", callback_data: "skip_team_size" }]] }
        });
    }
    else if (step === 'team_size') {
        if (callbackData !== 'skip_team_size' && text.toLowerCase() !== 'skip') {
            currentProj.team_size = text;
        }
        session.data.collection_step = 'duration';
        await sendMarkdown(ctx, "📅 **Duration?**\n*Example:* 3 months, Jan 2024 - Mar 2024");
    }
    else if (step === 'duration') {
        currentProj.duration = text;
        session.data.collection_step = 'link';
        await sendMarkdown(ctx, "🔗 **Project link?** (GitHub, live demo, or type 'Skip')\n*Example:* https://github.com/username/project");
    }
    else if (step === 'link') {
        if (text.toLowerCase() !== 'skip') currentProj.link = text;
        session.data.collection_step = 'outcome';
        await sendMarkdown(ctx, "📊 **Project outcome/impact?**\n*Example:* Increased user engagement by 40%, Won hackathon");
    }
    else if (step === 'outcome') {
        currentProj.outcome = text;
        projects.push({ ...currentProj });
        session.data.proj = {};
        session.data.collection_step = 'add_more';
        await sendMarkdown(ctx, `${getReaction()} Project saved!\n\nAnother project?`, {
            reply_markup: { inline_keyboard: [
                [{ text: "✅ Yes", callback_data: "proj_yes" }],
                [{ text: "❌ No", callback_data: "proj_no" }]
            ] }
        });
    }
    else if (step === 'add_more') {
        if (callbackData === 'proj_yes') {
            session.data.collection_step = 'name';
            session.data.proj = {};
            await sendMarkdown(ctx, "Next project name? 📁");
        } else {
            session.current_section = 'achievements';
            session.data.collection_step = 'title';
            cvData.achievements = [];
            await sendMarkdown(ctx, `${getReaction()} Let's add achievements.\n\n*What are your key achievements?* (Type each, then DONE when finished)`);
            await db.updateSession(session.id, 'collecting_achievements', 'achievements', session.data);
        }
        return;
    }
    await db.updateSession(session.id, 'collecting_projects', 'projects', session.data);
}

// ============ ACHIEVEMENTS COLLECTION (UPDATED) ============
async function handleAchievementsCollection(ctx, client, session, text, callbackData = null) {
    const cvData = ensureCVData(session);
    let step = session.data.collection_step;
    const achievements = cvData.achievements;
    
    if (step === 'title') {
        if (text.toUpperCase() === 'DONE') {
            if (achievements.length === 0) {
                await sendMarkdown(ctx, `No achievements added. Click SKIP to continue or type your achievement.`);
                return;
            }
            session.current_section = 'volunteer';
            session.data.collection_step = 'role';
            cvData.volunteer = [];
            await sendMarkdown(ctx, `${getReaction()} ${achievements.length} achievement(s) saved!\n\n*Any volunteer experience?*`, {
                reply_markup: { inline_keyboard: [[{ text: "⏭️ Skip Volunteer", callback_data: "vol_skip" }]] }
            });
            await db.updateSession(session.id, 'collecting_volunteer', 'volunteer', session.data);
        } else {
            if (!session.data.current_achievement) session.data.current_achievement = {};
            session.data.current_achievement.title = text;
            session.data.collection_step = 'description';
            await sendMarkdown(ctx, "📝 **Achievement description?**\n*Example:* Led a team of 5 to deliver project 2 weeks ahead of schedule");
        }
        return;
    }
    else if (step === 'description') {
        session.data.current_achievement.description = text;
        session.data.collection_step = 'date';
        await sendMarkdown(ctx, "📅 **Date?** (or type 'Skip')\n*Example:* 2023");
    }
    else if (step === 'date') {
        if (text.toLowerCase() !== 'skip') session.data.current_achievement.date = text;
        session.data.collection_step = 'issuer';
        await sendMarkdown(ctx, "🏛️ **Issuer?** (or type 'Skip')\n*Example:* Company Name, Organization");
    }
    else if (step === 'issuer') {
        if (text.toLowerCase() !== 'skip') session.data.current_achievement.issuer = text;
        achievements.push({ ...session.data.current_achievement });
        session.data.current_achievement = {};
        session.data.collection_step = 'title';
        await sendMarkdown(ctx, `✓ Achievement added! Type another achievement or DONE to finish.`);
    }
    
    await db.updateSession(session.id, 'collecting_achievements', 'achievements', session.data);
}

// ============ VOLUNTEER COLLECTION (UPDATED) ============
async function handleVolunteerCollection(ctx, client, session, text, callbackData = null) {
    const cvData = ensureCVData(session);
    let step = session.data.collection_step;
    const volunteer = cvData.volunteer;
    
    if (!session.data.vol) session.data.vol = {};
    const currentVol = session.data.vol;
    
    if (step === 'role') {
        if (callbackData === 'vol_skip') {
            session.current_section = 'leadership';
            session.data.collection_step = 'role';
            cvData.leadership = [];
            await sendMarkdown(ctx, `${getReaction()} Let's add leadership roles.\n\n*Any leadership roles?* (Click SKIP if none)`, {
                reply_markup: { inline_keyboard: [[{ text: "⏭️ Skip Leadership", callback_data: "lead_skip" }]] }
            });
            await db.updateSession(session.id, 'collecting_leadership', 'leadership', session.data);
            return;
        }
        currentVol.role = text;
        session.data.collection_step = 'organization';
        await sendMarkdown(ctx, "🏢 **Organization name?**\n*Example:* Red Cross, Local School");
    }
    else if (step === 'organization') {
        currentVol.organization = text;
        session.data.collection_step = 'duration';
        await sendMarkdown(ctx, "📅 **Duration?**\n*Example:* Jan 2022 - Present (2 years)");
    }
    else if (step === 'duration') {
        currentVol.duration = text;
        volunteer.push({ ...currentVol });
        session.data.vol = {};
        session.data.collection_step = 'add_more';
        await sendMarkdown(ctx, `${getReaction()} Volunteer experience saved!\n\nAnother volunteer role?`, {
            reply_markup: { inline_keyboard: [
                [{ text: "✅ Yes", callback_data: "vol_yes" }],
                [{ text: "❌ No", callback_data: "vol_no" }]
            ] }
        });
    }
    else if (step === 'add_more') {
        if (callbackData === 'vol_yes') {
            session.data.collection_step = 'role';
            session.data.vol = {};
            await sendMarkdown(ctx, "Next volunteer role? 🤝");
        } else {
            session.current_section = 'leadership';
            session.data.collection_step = 'role';
            cvData.leadership = [];
            await sendMarkdown(ctx, `${getReaction()} Let's add leadership roles.\n\n*Any leadership roles?* (Click SKIP if none)`, {
                reply_markup: { inline_keyboard: [[{ text: "⏭️ Skip Leadership", callback_data: "lead_skip" }]] }
            });
            await db.updateSession(session.id, 'collecting_leadership', 'leadership', session.data);
        }
        return;
    }
    await db.updateSession(session.id, 'collecting_volunteer', 'volunteer', session.data);
}

// ============ LEADERSHIP COLLECTION (UPDATED) ============
async function handleLeadershipCollection(ctx, client, session, text, callbackData = null) {
    const cvData = ensureCVData(session);
    let step = session.data.collection_step;
    const leadership = cvData.leadership;
    
    if (!session.data.lead) session.data.lead = {};
    const currentLead = session.data.lead;
    
    if (step === 'role') {
        if (callbackData === 'lead_skip') {
            session.current_section = 'awards';
            session.data.collection_step = 'name';
            cvData.awards = [];
            await sendMarkdown(ctx, `${getReaction()} Let's add awards and recognition.\n\n*Any awards?* (Click SKIP if none)`, {
                reply_markup: { inline_keyboard: [[{ text: "⏭️ Skip Awards", callback_data: "award_skip" }]] }
            });
            await db.updateSession(session.id, 'collecting_awards', 'awards', session.data);
            return;
        }
        currentLead.role = text;
        session.data.collection_step = 'organization';
        await sendMarkdown(ctx, "🏢 **Organization/Team name?**");
    }
    else if (step === 'organization') {
        currentLead.organization = text;
        session.data.collection_step = 'duration';
        await sendMarkdown(ctx, "📅 **Duration?**");
    }
    else if (step === 'duration') {
        currentLead.duration = text;
        session.data.collection_step = 'impact';
        await sendMarkdown(ctx, "💪 **Key impact/achievement?**\n*Example:* Led team to win national competition");
    }
    else if (step === 'impact') {
        currentLead.impact = text;
        leadership.push({ ...currentLead });
        session.data.lead = {};
        session.data.collection_step = 'add_more';
        await sendMarkdown(ctx, `${getReaction()} Leadership role saved!\n\nAnother leadership role?`, {
            reply_markup: { inline_keyboard: [
                [{ text: "✅ Yes", callback_data: "lead_yes" }],
                [{ text: "❌ No", callback_data: "lead_no" }]
            ] }
        });
    }
    else if (step === 'add_more') {
        if (callbackData === 'lead_yes') {
            session.data.collection_step = 'role';
            session.data.lead = {};
            await sendMarkdown(ctx, "Next leadership role? 👔");
        } else {
            session.current_section = 'awards';
            session.data.collection_step = 'name';
            cvData.awards = [];
            await sendMarkdown(ctx, `${getReaction()} Let's add awards and recognition.\n\n*Any awards?* (Click SKIP if none)`, {
                reply_markup: { inline_keyboard: [[{ text: "⏭️ Skip Awards", callback_data: "award_skip" }]] }
            });
            await db.updateSession(session.id, 'collecting_awards', 'awards', session.data);
        }
        return;
    }
    await db.updateSession(session.id, 'collecting_leadership', 'leadership', session.data);
}

// ============ AWARDS COLLECTION (UPDATED) ============
async function handleAwardsCollection(ctx, client, session, text, callbackData = null) {
    const cvData = ensureCVData(session);
    let step = session.data.collection_step;
    const awards = cvData.awards;
    
    if (!session.data.award) session.data.award = {};
    const currentAward = session.data.award;
    
    if (step === 'name') {
        if (callbackData === 'award_skip') {
            session.current_section = 'publications';
            session.data.collection_step = 'title';
            cvData.publications = [];
            await sendMarkdown(ctx, `${getReaction()} Let's add publications.\n\n*Any publications?* (Click SKIP if none)`, {
                reply_markup: { inline_keyboard: [[{ text: "⏭️ Skip Publications", callback_data: "pub_skip" }]] }
            });
            await db.updateSession(session.id, 'collecting_publications', 'publications', session.data);
            return;
        }
        currentAward.name = text;
        session.data.collection_step = 'issuer';
        await sendMarkdown(ctx, "🏛️ **Issuing organization?**");
    }
    else if (step === 'issuer') {
        currentAward.issuer = text;
        session.data.collection_step = 'date';
        await sendMarkdown(ctx, "📅 **Year received?**");
    }
    else if (step === 'date') {
        currentAward.date = text;
        awards.push({ ...currentAward });
        session.data.award = {};
        session.data.collection_step = 'add_more';
        await sendMarkdown(ctx, `${getReaction()} Award saved!\n\nAnother award?`, {
            reply_markup: { inline_keyboard: [
                [{ text: "✅ Yes", callback_data: "award_yes" }],
                [{ text: "❌ No", callback_data: "award_no" }]
            ] }
        });
    }
    else if (step === 'add_more') {
        if (callbackData === 'award_yes') {
            session.data.collection_step = 'name';
            session.data.award = {};
            await sendMarkdown(ctx, "Next award name? 🏆");
        } else {
            session.current_section = 'publications';
            session.data.collection_step = 'title';
            cvData.publications = [];
            await sendMarkdown(ctx, `${getReaction()} Let's add publications.\n\n*Any publications?* (Click SKIP if none)`, {
                reply_markup: { inline_keyboard: [[{ text: "⏭️ Skip Publications", callback_data: "pub_skip" }]] }
            });
            await db.updateSession(session.id, 'collecting_publications', 'publications', session.data);
        }
        return;
    }
    await db.updateSession(session.id, 'collecting_awards', 'awards', session.data);
}

// ============ PUBLICATIONS COLLECTION (UPDATED) ============
async function handlePublicationsCollection(ctx, client, session, text, callbackData = null) {
    const cvData = ensureCVData(session);
    let step = session.data.collection_step;
    const publications = cvData.publications;
    
    if (!session.data.pub) session.data.pub = {};
    const currentPub = session.data.pub;
    
    if (step === 'title') {
        if (callbackData === 'pub_skip') {
            session.current_section = 'conferences';
            session.data.collection_step = 'name';
            cvData.conferences = [];
            await sendMarkdown(ctx, `${getReaction()} Let's add conferences.\n\n*Any conferences attended?* (Click SKIP if none)`, {
                reply_markup: { inline_keyboard: [[{ text: "⏭️ Skip Conferences", callback_data: "conf_skip" }]] }
            });
            await db.updateSession(session.id, 'collecting_conferences', 'conferences', session.data);
            return;
        }
        currentPub.title = text;
        session.data.collection_step = 'publisher';
        await sendMarkdown(ctx, "📰 **Publisher/Journal name?**");
    }
    else if (step === 'publisher') {
        currentPub.publisher = text;
        session.data.collection_step = 'date';
        await sendMarkdown(ctx, "📅 **Publication date?**");
    }
    else if (step === 'date') {
        currentPub.date = text;
        publications.push({ ...currentPub });
        session.data.pub = {};
        session.data.collection_step = 'add_more';
        await sendMarkdown(ctx, `${getReaction()} Publication saved!\n\nAnother publication?`, {
            reply_markup: { inline_keyboard: [
                [{ text: "✅ Yes", callback_data: "pub_yes" }],
                [{ text: "❌ No", callback_data: "pub_no" }]
            ] }
        });
    }
    else if (step === 'add_more') {
        if (callbackData === 'pub_yes') {
            session.data.collection_step = 'title';
            session.data.pub = {};
            await sendMarkdown(ctx, "Next publication title? 📖");
        } else {
            session.current_section = 'conferences';
            session.data.collection_step = 'name';
            cvData.conferences = [];
            await sendMarkdown(ctx, `${getReaction()} Let's add conferences.\n\n*Any conferences attended?* (Click SKIP if none)`, {
                reply_markup: { inline_keyboard: [[{ text: "⏭️ Skip Conferences", callback_data: "conf_skip" }]] }
            });
            await db.updateSession(session.id, 'collecting_conferences', 'conferences', session.data);
        }
        return;
    }
    await db.updateSession(session.id, 'collecting_publications', 'publications', session.data);
}

// ============ CONFERENCES COLLECTION (UPDATED) ============
async function handleConferencesCollection(ctx, client, session, text, callbackData = null) {
    const cvData = ensureCVData(session);
    let step = session.data.collection_step;
    const conferences = cvData.conferences;
    
    if (!session.data.conf) session.data.conf = {};
    const currentConf = session.data.conf;
    
    if (step === 'name') {
        if (callbackData === 'conf_skip') {
            session.current_section = 'interests';
            session.data.collection_step = 'list';
            cvData.interests = [];
            await sendMarkdown(ctx, `${getReaction()} Finally, let's add your interests/hobbies.\n\n*What are your interests?* (comma separated, or click SKIP)`, {
                reply_markup: { inline_keyboard: [[{ text: "⏭️ Skip Interests", callback_data: "int_skip" }]] }
            });
            await db.updateSession(session.id, 'collecting_interests', 'interests', session.data);
            return;
        }
        currentConf.name = text;
        session.data.collection_step = 'role';
        await sendMarkdown(ctx, "🎤 **Your role?**\n*Example:* Speaker, Attendee, Panelist, Organizer");
    }
    else if (step === 'role') {
        currentConf.role = text;
        session.data.collection_step = 'date';
        await sendMarkdown(ctx, "📅 **Date?**\n*Example:* June 2024");
    }
    else if (step === 'date') {
        currentConf.date = text;
        conferences.push({ ...currentConf });
        session.data.conf = {};
        session.data.collection_step = 'add_more';
        await sendMarkdown(ctx, `${getReaction()} Conference saved!\n\nAnother conference?`, {
            reply_markup: { inline_keyboard: [
                [{ text: "✅ Yes", callback_data: "conf_yes" }],
                [{ text: "❌ No", callback_data: "conf_no" }]
            ] }
        });
    }
    else if (step === 'add_more') {
        if (callbackData === 'conf_yes') {
            session.data.collection_step = 'name';
            session.data.conf = {};
            await sendMarkdown(ctx, "Next conference name? 🎙️");
        } else {
            session.current_section = 'interests';
            session.data.collection_step = 'list';
            cvData.interests = [];
            await sendMarkdown(ctx, `${getReaction()} Finally, let's add your interests/hobbies.\n\n*What are your interests?* (comma separated, or click SKIP)`, {
                reply_markup: { inline_keyboard: [[{ text: "⏭️ Skip Interests", callback_data: "int_skip" }]] }
            });
            await db.updateSession(session.id, 'collecting_interests', 'interests', session.data);
        }
        return;
    }
    await db.updateSession(session.id, 'collecting_conferences', 'conferences', session.data);
}

// ============ INTERESTS COLLECTION (UPDATED) ============
async function handleInterestsCollection(ctx, client, session, text, callbackData = null) {
    const cvData = ensureCVData(session);
    
    if (callbackData === 'int_skip' || text.toLowerCase() === 'skip') {
        cvData.interests = [];
    } else {
        const interests = text.split(',').map(i => i.trim());
        cvData.interests = interests;
        await sendMarkdown(ctx, `${getReaction()} ${interests.length} interest(s) saved!`);
    }
    
    // After interests, go to summary
    await showSummaryAndFinalize(ctx, client, session);
}
// ============ SMART DRAFT PROCESSOR (UPDATED - 18+ CATEGORIES) ============
class SmartDraftProcessor {
    async processDraftUpload(ctx, client, session, fileUrl, fileName) {
        await sendMarkdown(ctx, `📄 *Processing your document with AI...*\n\nDeepSeek AI is extracting all information from your file. This may take a moment. ⏳`);
        
        const extractedData = await documentGenerator.extractFullCVDataFromUrl(fileUrl, fileName);
        
        if (!extractedData.success) {
            await sendMarkdown(ctx, `❌ Could not extract data from your file. Please try again with a clearer document or choose manual entry.`);
            return false;
        }
        
        const cvData = extractedData.data;
        const missingSections = this.identifyAllMissingSections(cvData);
        
        session.data.cv_data = cvData;
        session.data.is_draft_upload = true;
        session.data.missing_sections = missingSections;
        session.data.current_missing_index = 0;
        
        // Build comprehensive found message with ALL categories
        let foundMessage = `📄 *Draft Processed Successfully!*\n\n`;
        foundMessage += `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
        foundMessage += `✅ *EXTRACTED INFORMATION*\n`;
        foundMessage += `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
        
        // Personal Information
        foundMessage += `👤 *Personal Information*\n`;
        foundMessage += `• Name: ${cvData.personal?.full_name || 'Not found'}\n`;
        foundMessage += `• Email: ${cvData.personal?.email || 'Not found'}\n`;
        foundMessage += `• Phone: ${cvData.personal?.primary_phone || 'Not found'}\n`;
        foundMessage += `• Location: ${cvData.personal?.location || 'Not found'}\n`;
        foundMessage += `• LinkedIn: ${cvData.personal?.linkedin || 'Not found'}\n`;
        foundMessage += `• GitHub: ${cvData.personal?.github || 'Not found'}\n`;
        foundMessage += `• Professional Title: ${cvData.personal?.professional_title || 'Not found'}\n\n`;
        
        // Work Experience
        foundMessage += `💼 *Work Experience*: ${cvData.employment?.length || 0} position(s)\n`;
        for (const job of (cvData.employment || []).slice(0, 2)) {
            foundMessage += `   • ${job.title} at ${job.company} (${job.duration || 'Duration not specified'})\n`;
        }
        if ((cvData.employment || []).length > 2) foundMessage += `   • +${cvData.employment.length - 2} more\n`;
        foundMessage += `\n`;
        
        // Education
        foundMessage += `🎓 *Education*: ${cvData.education?.length || 0} qualification(s)\n`;
        for (const edu of (cvData.education || []).slice(0, 2)) {
            foundMessage += `   • ${edu.level} in ${edu.field || 'Field not specified'} from ${edu.institution || 'Institution not specified'}\n`;
        }
        foundMessage += `\n`;
        
        // Skills (categorized)
        const skills = cvData.skills || {};
        const totalSkills = (skills.technical?.length || 0) + (skills.soft?.length || 0) + (skills.tools?.length || 0);
        foundMessage += `⚡ *Skills*: ${totalSkills} total\n`;
        if (skills.technical?.length > 0) foundMessage += `   • Technical: ${skills.technical.slice(0, 5).join(', ')}${skills.technical.length > 5 ? '...' : ''}\n`;
        if (skills.soft?.length > 0) foundMessage += `   • Soft: ${skills.soft.slice(0, 5).join(', ')}${skills.soft.length > 5 ? '...' : ''}\n`;
        if (skills.tools?.length > 0) foundMessage += `   • Tools: ${skills.tools.slice(0, 5).join(', ')}${skills.tools.length > 5 ? '...' : ''}\n`;
        foundMessage += `\n`;
        
        // Certifications
        foundMessage += `📜 *Certifications*: ${cvData.certifications?.length || 0}\n`;
        for (const cert of (cvData.certifications || []).slice(0, 2)) {
            foundMessage += `   • ${cert.name}${cert.issuer ? ` (${cert.issuer})` : ''}\n`;
        }
        foundMessage += `\n`;
        
        // Languages
        foundMessage += `🌍 *Languages*: ${cvData.languages?.length || 0}\n`;
        for (const lang of (cvData.languages || []).slice(0, 3)) {
            foundMessage += `   • ${lang.name} (${lang.proficiency || 'Not specified'})\n`;
        }
        foundMessage += `\n`;
        
        // Projects
        foundMessage += `📁 *Projects*: ${cvData.projects?.length || 0}\n`;
        for (const proj of (cvData.projects || []).slice(0, 2)) {
            foundMessage += `   • ${proj.name}${proj.role ? ` (${proj.role})` : ''}\n`;
        }
        foundMessage += `\n`;
        
        // Achievements
        foundMessage += `🏆 *Achievements*: ${cvData.achievements?.length || 0}\n`;
        foundMessage += `\n`;
        
        // Volunteer
        foundMessage += `🤝 *Volunteer*: ${cvData.volunteer?.length || 0}\n`;
        foundMessage += `\n`;
        
        // Leadership
        foundMessage += `👔 *Leadership*: ${cvData.leadership?.length || 0}\n`;
        foundMessage += `\n`;
        
        // Awards
        foundMessage += `🏅 *Awards*: ${cvData.awards?.length || 0}\n`;
        foundMessage += `\n`;
        
        // Publications
        foundMessage += `📖 *Publications*: ${cvData.publications?.length || 0}\n`;
        foundMessage += `\n`;
        
        // Conferences
        foundMessage += `🎤 *Conferences*: ${cvData.conferences?.length || 0}\n`;
        foundMessage += `\n`;
        
        // Referees
        foundMessage += `👥 *Referees*: ${cvData.referees?.length || 0} (need at least 2)\n`;
        foundMessage += `\n`;
        
        // Interests
        if (cvData.interests?.length > 0) {
            foundMessage += `💡 *Interests*: ${cvData.interests.slice(0, 5).join(', ')}${cvData.interests.length > 5 ? '...' : ''}\n\n`;
        }
        
        // Missing Sections
        if (missingSections.length > 0) {
            foundMessage += `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
            foundMessage += `⚠️ *MISSING INFORMATION*\n`;
            foundMessage += `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
            for (const missing of missingSections) {
                foundMessage += `• ${missing}\n`;
            }
            foundMessage += `\nLet's fill in the missing information.`;
            await sendMarkdown(ctx, foundMessage);
            await this.collectNextMissingSection(ctx, client, session);
        } else {
            foundMessage += `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
            foundMessage += `🎉 *COMPLETE!* Your draft has everything needed!\n`;
            foundMessage += `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
            foundMessage += `Proceed to payment? Click below to continue.`;
            await sendMarkdown(ctx, foundMessage, {
                reply_markup: { inline_keyboard: [[{ text: "💰 Proceed to Payment", callback_data: "proceed_payment" }]] }
            });
            session.data.cv_complete = true;
        }
        
        return true;
    }
    
    identifyAllMissingSections(cvData) {
        const missing = [];
        
        // Personal Information (Required)
        if (!cvData.personal?.full_name) missing.push('Full Name');
        if (!cvData.personal?.email) missing.push('Email');
        if (!cvData.personal?.primary_phone) missing.push('Phone');
        if (!cvData.personal?.location) missing.push('Location');
        
        // Optional but nice to have (not marked as missing, but we'll track)
        if (!cvData.personal?.physical_address) missing.push('Physical Address (Optional)');
        if (!cvData.personal?.nationality) missing.push('Nationality (Optional)');
        if (!cvData.personal?.linkedin) missing.push('LinkedIn (Optional)');
        if (!cvData.personal?.github) missing.push('GitHub (Optional)');
        
        // Professional Information
        if (!cvData.employment || cvData.employment.length === 0) missing.push('Work Experience');
        if (!cvData.education || cvData.education.length === 0) missing.push('Education');
        
        // Skills
        const totalSkills = (cvData.skills?.technical?.length || 0) + (cvData.skills?.soft?.length || 0) + (cvData.skills?.tools?.length || 0);
        if (totalSkills === 0 && (!cvData.skills || cvData.skills.length === 0)) missing.push('Skills');
        
        // Optional Sections (not required but we'll ask if missing)
        if (!cvData.certifications || cvData.certifications.length === 0) missing.push('Certifications (Optional)');
        if (!cvData.languages || cvData.languages.length === 0) missing.push('Languages (Optional)');
        if (!cvData.projects || cvData.projects.length === 0) missing.push('Projects (Optional)');
        if (!cvData.achievements || cvData.achievements.length === 0) missing.push('Achievements (Optional)');
        if (!cvData.volunteer || cvData.volunteer.length === 0) missing.push('Volunteer Experience (Optional)');
        if (!cvData.leadership || cvData.leadership.length === 0) missing.push('Leadership Roles (Optional)');
        if (!cvData.awards || cvData.awards.length === 0) missing.push('Awards (Optional)');
        if (!cvData.publications || cvData.publications.length === 0) missing.push('Publications (Optional)');
        if (!cvData.conferences || cvData.conferences.length === 0) missing.push('Conferences (Optional)');
        
        // Referees - Minimum 2 required
        if (!cvData.referees || cvData.referees.length < 2) {
            const needed = 2 - (cvData.referees?.length || 0);
            missing.push(`Referees (need ${needed} more, minimum 2 required)`);
        }
        
        // Interests (Optional)
        if (!cvData.interests || cvData.interests.length === 0) missing.push('Interests (Optional)');
        
        return missing;
    }
    
    async collectNextMissingSection(ctx, client, session) {
        const missing = session.data.missing_sections;
        const index = session.data.current_missing_index || 0;
        
        if (index >= missing.length) {
            await sendMarkdown(ctx, `✅ *All information collected!*\n\nProceed to payment? Click below to continue.`, {
                reply_markup: { inline_keyboard: [[{ text: "💰 Proceed to Payment", callback_data: "proceed_payment" }]] }
            });
            session.data.cv_complete = true;
            await db.updateSession(session.id, 'awaiting_payment_choice', 'payment', session.data);
            return;
        }
        
        const section = missing[index];
        session.data.current_section = section;
        
        const prompts = {
            // Required sections
            'Full Name': "What's your full name? 📛\n*Example:* John Mwale Doe",
            'Email': "What's your email address? 📧\n*Example:* john.doe@example.com",
            'Phone': "What's your phone number? 📞\n*Example:* +265 991 234 567 or 0991234567",
            'Location': "Where are you based? (City, Country) 📍\n*Example:* Lilongwe, Malawi",
            
            // Optional sections with clear instructions
            'Physical Address (Optional)': "🏠 *Physical address?* (Optional)\n*Example:* House No. 123, Area 47, Lilongwe\n\nClick SKIP to continue.",
            'Nationality (Optional)': "🌍 *Nationality?* (Optional)\n*Example:* Malawian\n\nClick SKIP to continue.",
            'LinkedIn (Optional)': "🔗 *LinkedIn URL?* (Optional)\n*Example:* https://linkedin.com/in/yourname\n\nClick SKIP to continue.",
            'GitHub (Optional)': "💻 *GitHub URL?* (Optional)\n*Example:* https://github.com/yourusername\n\nClick SKIP to continue.",
            
            // Professional sections
            'Work Experience': "Let's add your work experience. Most recent job title? 💼\n*Example:* Senior Software Engineer",
            'Education': "What's your highest qualification? 🎓\n*Example:* Bachelor of Science in Computer Science",
            'Skills': "List your key skills (comma separated) ⚡\n*Example:* Project Management, Python, Leadership, Data Analysis",
            
            // Optional sections
            'Certifications (Optional)': "📜 *Any certifications?* (Optional)\n*Example:* Google Project Management Professional\n\nClick SKIP to continue.",
            'Languages (Optional)': "🌍 *What languages do you speak?* (Optional)\n*Example:* English (Fluent), Chichewa (Native)\n\nClick SKIP to continue.",
            'Projects (Optional)': "📁 *Any projects you want to showcase?* (Optional)\n*Example:* E-commerce Website, Mobile App Development\n\nClick SKIP to continue.",
            'Achievements (Optional)': "🏆 *What are your key achievements?* (Optional)\n*Example:* Increased sales by 40%, Won Best Employee Award\n\nClick SKIP to continue.",
            'Volunteer Experience (Optional)': "🤝 *Any volunteer experience?* (Optional)\n*Example:* Community Tutor, Red Cross Volunteer\n\nClick SKIP to continue.",
            'Leadership Roles (Optional)': "👔 *Any leadership roles?* (Optional)\n*Example:* Team Lead, Club President\n\nClick SKIP to continue.",
            'Awards (Optional)': "🏅 *Any awards or recognition?* (Optional)\n*Example:* Employee of the Month, Best Innovation Award\n\nClick SKIP to continue.",
            'Publications (Optional)': "📖 *Any publications?* (Optional)\n*Example:* Research paper in Journal of Science\n\nClick SKIP to continue.",
            'Conferences (Optional)': "🎤 *Any conferences attended?* (Optional)\n*Example:* Tech Summit 2024 (Speaker)\n\nClick SKIP to continue.",
            'Interests (Optional)': "💡 *What are your interests/hobbies?* (Optional)\n*Example:* Reading, Chess, Photography\n\nClick SKIP to continue.",
            'Referees (need 2 more, minimum 2 required)': "Please provide professional referees (minimum 2 required).\n\n*Referee 1 - Full name?* 👥\n*Example:* Dr. Jane Mkandawire"
        };
        
        // Handle special case for Referees
        if (section.includes('Referees')) {
            const needed = section.match(/\d+/);
            if (needed) {
                await sendMarkdown(ctx, `👥 *Professional Referees*\n\nPlease provide at least 2 professional referees.\n\n*Referee 1 - Full name?*`);
            } else {
                await sendMarkdown(ctx, prompts[section] || `Please provide your ${section.toLowerCase()}:`);
            }
        } else if (section.includes('(Optional)')) {
            // For optional sections, provide skip button
            const basePrompt = prompts[section] || `Please provide your ${section.replace(' (Optional)', '')}:`;
            await sendMarkdown(ctx, basePrompt, {
                reply_markup: { inline_keyboard: [[{ text: "⏭️ Skip", callback_data: `skip_optional_${section.replace(/ /g, '_')}` }]] }
            });
        } else {
            await sendMarkdown(ctx, prompts[section] || `Please provide your ${section.toLowerCase()}:`);
        }
        
        await db.updateSession(session.id, 'collecting_missing', 'missing', session.data);
    }
    
    async handleMissingCollection(ctx, client, session, text, callbackData = null) {
        const section = session.data.current_section;
        const cvData = session.data.cv_data;
        
        // Handle skip for optional sections
        if (callbackData && callbackData.startsWith('skip_optional_')) {
            // Skip this optional section
            session.data.current_missing_index = (session.data.current_missing_index || 0) + 1;
            await this.collectNextMissingSection(ctx, client, session);
            await db.updateSession(session.id, 'collecting_missing', 'missing', session.data);
            return;
        }
        
        switch(section) {
            // Required fields
            case 'Full Name':
                cvData.personal.full_name = text;
                break;
            case 'Email':
                cvData.personal.email = text;
                break;
            case 'Phone':
                cvData.personal.primary_phone = text;
                break;
            case 'Location':
                cvData.personal.location = text;
                break;
            
            // Optional fields
            case 'Physical Address (Optional)':
                if (text.toLowerCase() !== 'skip') cvData.personal.physical_address = text;
                break;
            case 'Nationality (Optional)':
                if (text.toLowerCase() !== 'skip') cvData.personal.nationality = text;
                break;
            case 'LinkedIn (Optional)':
                if (text.toLowerCase() !== 'skip') cvData.personal.linkedin = text;
                break;
            case 'GitHub (Optional)':
                if (text.toLowerCase() !== 'skip') cvData.personal.github = text;
                break;
            
            // Professional sections
            case 'Work Experience':
                if (!cvData.employment) cvData.employment = [];
                if (!session.data.temp_job) session.data.temp_job = {};
                const step = session.data.work_step || 'title';
                if (step === 'title') {
                    session.data.temp_job.title = text;
                    session.data.work_step = 'company';
                    await sendMarkdown(ctx, "Company name? 🏢");
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
                    await sendMarkdown(ctx, "Responsibilities (one per line, click DONE when finished)", {
                        reply_markup: { inline_keyboard: [[{ text: "✅ DONE", callback_data: "missing_done" }]] }
                    });
                    return;
                } else if (step === 'responsibilities') {
                    if (callbackData !== 'missing_done' && text.toUpperCase() !== 'DONE') {
                        session.data.temp_job.responsibilities.push(text);
                        await sendMarkdown(ctx, `✓ Added. Another responsibility? (click DONE when finished)`);
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
                    await sendMarkdown(ctx, "Field of study? 📚");
                    return;
                } else if (eduStep === 'field') {
                    session.data.temp_edu.field = text;
                    session.data.edu_step = 'institution';
                    await sendMarkdown(ctx, "Institution? 🏛️");
                    return;
                } else if (eduStep === 'institution') {
                    session.data.temp_edu.institution = text;
                    session.data.edu_step = 'year';
                    await sendMarkdown(ctx, "Year of completion? 📅");
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
                const skillsArray = text.split(',').map(s => s.trim());
                // Categorize skills
                const categorized = { technical: [], soft: [], tools: [] };
                const techKeywords = ['python', 'javascript', 'java', 'react', 'node', 'sql', 'aws', 'docker'];
                const softKeywords = ['leadership', 'communication', 'teamwork', 'problem solving', 'management'];
                
                for (const skill of skillsArray) {
                    const lowerSkill = skill.toLowerCase();
                    if (techKeywords.some(k => lowerSkill.includes(k))) categorized.technical.push(skill);
                    else if (softKeywords.some(k => lowerSkill.includes(k))) categorized.soft.push(skill);
                    else categorized.tools.push(skill);
                }
                if (categorized.technical.length === 0 && categorized.tools.length > 0) {
                    categorized.technical = categorized.tools;
                    categorized.tools = [];
                }
                cvData.skills = categorized;
                break;
                
            // Optional sections with simple input
            case 'Certifications (Optional)':
                if (!cvData.certifications) cvData.certifications = [];
                cvData.certifications.push({ name: text, issuer: 'Not specified', date: new Date().getFullYear().toString() });
                await sendMarkdown(ctx, `✓ Certification added. Add another? (Type 'Done' to finish, 'Skip' to skip)`, {
                    reply_markup: { inline_keyboard: [[{ text: "✅ Done", callback_data: "cert_done" }, { text: "⏭️ Skip", callback_data: "cert_skip_section" }]] }
                });
                return;
                
            case 'Languages (Optional)':
                if (!cvData.languages) cvData.languages = [];
                const langParts = text.split('(');
                const langName = langParts[0].trim();
                let proficiency = 'Professional';
                if (langParts[1]) {
                    proficiency = langParts[1].replace(')', '').trim();
                }
                cvData.languages.push({ name: langName, proficiency: proficiency });
                await sendMarkdown(ctx, `✓ Language added. Add another? (Type 'Done' to finish, 'Skip' to skip)`, {
                    reply_markup: { inline_keyboard: [[{ text: "✅ Done", callback_data: "lang_done" }, { text: "⏭️ Skip", callback_data: "lang_skip_section" }]] }
                });
                return;
                
            case 'Projects (Optional)':
                if (!cvData.projects) cvData.projects = [];
                cvData.projects.push({ name: text, description: 'Added', technologies: 'Not specified' });
                await sendMarkdown(ctx, `✓ Project added. Add another? (Type 'Done' to finish, 'Skip' to skip)`, {
                    reply_markup: { inline_keyboard: [[{ text: "✅ Done", callback_data: "proj_done" }, { text: "⏭️ Skip", callback_data: "proj_skip_section" }]] }
                });
                return;
                
            case 'Achievements (Optional)':
                if (!cvData.achievements) cvData.achievements = [];
                cvData.achievements.push(text);
                await sendMarkdown(ctx, `✓ Achievement added. Add another? (Type 'Done' to finish, 'Skip' to skip)`, {
                    reply_markup: { inline_keyboard: [[{ text: "✅ Done", callback_data: "ach_done" }, { text: "⏭️ Skip", callback_data: "ach_skip_section" }]] }
                });
                return;
                
            case 'Volunteer Experience (Optional)':
                if (!cvData.volunteer) cvData.volunteer = [];
                cvData.volunteer.push({ role: text, organization: 'Not specified', duration: 'Not specified' });
                await sendMarkdown(ctx, `✓ Volunteer experience added. Add another? (Type 'Done' to finish, 'Skip' to skip)`, {
                    reply_markup: { inline_keyboard: [[{ text: "✅ Done", callback_data: "vol_done" }, { text: "⏭️ Skip", callback_data: "vol_skip_section" }]] }
                });
                return;
                
            case 'Leadership Roles (Optional)':
                if (!cvData.leadership) cvData.leadership = [];
                cvData.leadership.push({ role: text, organization: 'Not specified', duration: 'Not specified' });
                await sendMarkdown(ctx, `✓ Leadership role added. Add another? (Type 'Done' to finish, 'Skip' to skip)`, {
                    reply_markup: { inline_keyboard: [[{ text: "✅ Done", callback_data: "lead_done" }, { text: "⏭️ Skip", callback_data: "lead_skip_section" }]] }
                });
                return;
                
            case 'Awards (Optional)':
                if (!cvData.awards) cvData.awards = [];
                cvData.awards.push({ name: text, issuer: 'Not specified', date: 'Not specified' });
                await sendMarkdown(ctx, `✓ Award added. Add another? (Type 'Done' to finish, 'Skip' to skip)`, {
                    reply_markup: { inline_keyboard: [[{ text: "✅ Done", callback_data: "award_done" }, { text: "⏭️ Skip", callback_data: "award_skip_section" }]] }
                });
                return;
                
            case 'Publications (Optional)':
                if (!cvData.publications) cvData.publications = [];
                cvData.publications.push({ title: text, publisher: 'Not specified', date: 'Not specified' });
                await sendMarkdown(ctx, `✓ Publication added. Add another? (Type 'Done' to finish, 'Skip' to skip)`, {
                    reply_markup: { inline_keyboard: [[{ text: "✅ Done", callback_data: "pub_done" }, { text: "⏭️ Skip", callback_data: "pub_skip_section" }]] }
                });
                return;
                
            case 'Conferences (Optional)':
                if (!cvData.conferences) cvData.conferences = [];
                cvData.conferences.push({ name: text, role: 'Attendee', date: 'Not specified' });
                await sendMarkdown(ctx, `✓ Conference added. Add another? (Type 'Done' to finish, 'Skip' to skip)`, {
                    reply_markup: { inline_keyboard: [[{ text: "✅ Done", callback_data: "conf_done" }, { text: "⏭️ Skip", callback_data: "conf_skip_section" }]] }
                });
                return;
                
            case 'Interests (Optional)':
                if (text.toLowerCase() !== 'skip') {
                    const interests = text.split(',').map(i => i.trim());
                    cvData.interests = interests;
                }
                break;
                
            case 'Referees (need 2 more, minimum 2 required)':
                if (!cvData.referees) cvData.referees = [];
                if (!session.data.temp_ref) session.data.temp_ref = {};
                const refStep = session.data.ref_step || 'name';
                if (refStep === 'name') {
                    session.data.temp_ref.name = text;
                    session.data.ref_step = 'position';
                    await sendMarkdown(ctx, "Their position? 📌\n*Example:* Senior Manager, HR Director");
                    return;
                } else if (refStep === 'position') {
                    session.data.temp_ref.position = text;
                    session.data.ref_step = 'company';
                    await sendMarkdown(ctx, "Company name? 🏢");
                    return;
                } else if (refStep === 'company') {
                    session.data.temp_ref.company = text;
                    session.data.ref_step = 'contact';
                    await sendMarkdown(ctx, "Their contact? (phone or email) 📞\n*Example:* +265 991 234 567 or jane@example.com");
                    return;
                } else if (refStep === 'contact') {
                    session.data.temp_ref.contact = text;
                    cvData.referees.push(session.data.temp_ref);
                    session.data.temp_ref = null;
                    session.data.ref_step = null;
                    
                    const needed = 2 - cvData.referees.length;
                    if (needed > 0) {
                        await sendMarkdown(ctx, `✓ Referee added. Need ${needed} more.\n\nNext referee - Full name? 👥`);
                        return;
                    } else {
                        await sendMarkdown(ctx, `✓ ${cvData.referees.length} referees added. Another referee?`, {
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

// ============ CV VERSIONING SYSTEM (UPDATED - 18+ CATEGORIES) ============
class CVVersioning {
    
    // Save a new version with full 18+ category support
    async saveVersion(orderId, cvData, versionNumber, changes, metadata = {}) {
        // Ensure cvData has all 18+ categories structure
        const completeCVData = this.ensureCompleteCVData(cvData);
        
        // Add version metadata
        const versionData = {
            ...completeCVData,
            _metadata: {
                version: versionNumber,
                created_at: new Date().toISOString(),
                changes: changes,
                ...metadata
            }
        };
        
        await db.saveCVVersion(orderId, versionNumber, versionData, changes);
        
        // Log version creation
        console.log(`📁 Version ${versionNumber} saved for order ${orderId} - Changes: ${changes}`);
        return true;
    }
    
    // Ensure CV data has all 18+ categories
    ensureCompleteCVData(cvData) {
        return {
            // Personal Information (14 fields)
            personal: {
                full_name: cvData.personal?.full_name || '',
                email: cvData.personal?.email || '',
                primary_phone: cvData.personal?.primary_phone || '',
                alternative_phone: cvData.personal?.alternative_phone || '',
                whatsapp_phone: cvData.personal?.whatsapp_phone || '',
                location: cvData.personal?.location || '',
                physical_address: cvData.personal?.physical_address || '',
                nationality: cvData.personal?.nationality || '',
                linkedin: cvData.personal?.linkedin || '',
                github: cvData.personal?.github || '',
                portfolio: cvData.personal?.portfolio || '',
                professional_title: cvData.personal?.professional_title || '',
                date_of_birth: cvData.personal?.date_of_birth || '',
                special_documents: cvData.personal?.special_documents || []
            },
            
            // Professional Summary
            professional_summary: cvData.professional_summary || '',
            
            // Work Experience (with full details)
            employment: (cvData.employment || []).map(job => ({
                title: job.title || '',
                company: job.company || '',
                location: job.location || '',
                start_date: job.start_date || '',
                end_date: job.end_date || '',
                duration: job.duration || '',
                responsibilities: job.responsibilities || [],
                achievements: job.achievements || [],
                technologies_used: job.technologies_used || [],
                team_size: job.team_size || null,
                reporting_to: job.reporting_to || null
            })),
            
            // Education (with full details)
            education: (cvData.education || []).map(edu => ({
                level: edu.level || '',
                field: edu.field || '',
                institution: edu.institution || '',
                location: edu.location || '',
                start_date: edu.start_date || '',
                graduation_date: edu.graduation_date || '',
                gpa: edu.gpa || '',
                achievements: edu.achievements || [],
                courses: edu.courses || []
            })),
            
            // Skills (categorized)
            skills: {
                technical: cvData.skills?.technical || [],
                soft: cvData.skills?.soft || [],
                tools: cvData.skills?.tools || [],
                certifications: cvData.skills?.certifications || []
            },
            
            // Certifications (with full details)
            certifications: (cvData.certifications || []).map(cert => ({
                name: cert.name || '',
                issuer: cert.issuer || '',
                date: cert.date || '',
                expiry_date: cert.expiry_date || '',
                credential_id: cert.credential_id || '',
                url: cert.url || ''
            })),
            
            // Languages
            languages: (cvData.languages || []).map(lang => ({
                name: lang.name || '',
                proficiency: lang.proficiency || '',
                certification: lang.certification || ''
            })),
            
            // Projects (with full details)
            projects: (cvData.projects || []).map(proj => ({
                name: proj.name || '',
                description: proj.description || '',
                technologies: proj.technologies || '',
                role: proj.role || '',
                team_size: proj.team_size || '',
                duration: proj.duration || '',
                link: proj.link || '',
                outcome: proj.outcome || ''
            })),
            
            // Achievements
            achievements: (cvData.achievements || []).map(ach => ({
                title: typeof ach === 'string' ? ach : ach.title,
                description: ach.description || '',
                date: ach.date || '',
                issuer: ach.issuer || ''
            })),
            
            // Volunteer Experience
            volunteer: (cvData.volunteer || []).map(vol => ({
                role: vol.role || '',
                organization: vol.organization || '',
                duration: vol.duration || '',
                responsibilities: vol.responsibilities || []
            })),
            
            // Leadership Roles
            leadership: (cvData.leadership || []).map(lead => ({
                role: lead.role || '',
                organization: lead.organization || '',
                duration: lead.duration || '',
                impact: lead.impact || ''
            })),
            
            // Awards
            awards: (cvData.awards || []).map(award => ({
                name: award.name || '',
                issuer: award.issuer || '',
                date: award.date || '',
                description: award.description || ''
            })),
            
            // Publications
            publications: (cvData.publications || []).map(pub => ({
                title: pub.title || '',
                publisher: pub.publisher || '',
                date: pub.date || '',
                url: pub.url || '',
                authors: pub.authors || ''
            })),
            
            // Conferences
            conferences: (cvData.conferences || []).map(conf => ({
                name: conf.name || '',
                role: conf.role || '',
                date: conf.date || '',
                location: conf.location || ''
            })),
            
            // Referees
            referees: (cvData.referees || []).map(ref => ({
                name: ref.name || '',
                position: ref.position || '',
                company: ref.company || '',
                email: ref.email || '',
                phone: ref.phone || '',
                relationship: ref.relationship || ''
            })),
            
            // Interests
            interests: cvData.interests || [],
            
            // Social Media
            social_media: {
                linkedin: cvData.social_media?.linkedin || '',
                github: cvData.social_media?.github || '',
                twitter: cvData.social_media?.twitter || '',
                facebook: cvData.social_media?.facebook || '',
                instagram: cvData.social_media?.instagram || '',
                portfolio: cvData.social_media?.portfolio || ''
            },
            
            // Portfolio Links
            portfolio: cvData.portfolio || []
        };
    }
    
    // Get all versions with formatted data
    async getVersions(orderId) {
        const versions = await db.getCVVersions(orderId);
        
        // Format each version with metadata
        return versions.map(v => ({
            ...v,
            version_number: v.version_number,
            created_at: v.created_at,
            changes: v.changes,
            is_current: v.is_current === 1,
            summary: this.getVersionSummary(v.cv_data)
        }));
    }
    
    // Get version summary (stats of 18+ categories)
    getVersionSummary(cvData) {
        if (!cvData) return null;
        
        return {
            personal_complete: !!(cvData.personal?.full_name && cvData.personal?.email),
            employment_count: cvData.employment?.length || 0,
            education_count: cvData.education?.length || 0,
            skills_count: (cvData.skills?.technical?.length || 0) + 
                         (cvData.skills?.soft?.length || 0) + 
                         (cvData.skills?.tools?.length || 0),
            certifications_count: cvData.certifications?.length || 0,
            languages_count: cvData.languages?.length || 0,
            projects_count: cvData.projects?.length || 0,
            achievements_count: cvData.achievements?.length || 0,
            volunteer_count: cvData.volunteer?.length || 0,
            leadership_count: cvData.leadership?.length || 0,
            awards_count: cvData.awards?.length || 0,
            publications_count: cvData.publications?.length || 0,
            conferences_count: cvData.conferences?.length || 0,
            referees_count: cvData.referees?.length || 0,
            interests_count: cvData.interests?.length || 0
        };
    }
    
    // Get single version by number
    async getVersion(orderId, versionNumber) {
        const version = await db.getCVVersion(orderId, versionNumber);
        if (version) {
            version.cv_data = this.ensureCompleteCVData(version.cv_data);
        }
        return version;
    }
    
    // Revert to a specific version
    async revertToVersion(orderId, versionNumber) {
        const version = await this.getVersion(orderId, versionNumber);
        if (version && version.cv_data) {
            const completeData = this.ensureCompleteCVData(version.cv_data);
            await db.updateOrderCVData(orderId, completeData);
            
            // Save as new version
            const nextVersion = versionNumber + 1;
            await this.saveVersion(orderId, completeData, nextVersion, `Reverted to version ${versionNumber}`);
            
            return completeData;
        }
        return null;
    }
    
    // Compare two versions and show differences
    async compareVersions(orderId, version1, version2) {
        const v1 = await this.getVersion(orderId, version1);
        const v2 = await this.getVersion(orderId, version2);
        
        if (!v1 || !v2) return null;
        
        const differences = [];
        
        // Compare employment
        if (v1.cv_data.employment?.length !== v2.cv_data.employment?.length) {
            differences.push(`Employment entries: ${v1.cv_data.employment?.length} → ${v2.cv_data.employment?.length}`);
        }
        
        // Compare skills
        const v1Skills = (v1.cv_data.skills?.technical?.length || 0) + (v1.cv_data.skills?.soft?.length || 0);
        const v2Skills = (v2.cv_data.skills?.technical?.length || 0) + (v2.cv_data.skills?.soft?.length || 0);
        if (v1Skills !== v2Skills) {
            differences.push(`Skills count: ${v1Skills} → ${v2Skills}`);
        }
        
        // Compare projects
        if (v1.cv_data.projects?.length !== v2.cv_data.projects?.length) {
            differences.push(`Projects: ${v1.cv_data.projects?.length} → ${v2.cv_data.projects?.length}`);
        }
        
        return differences;
    }
    
    // Format version history with rich display
    formatVersionHistory(versions, currentVersion = null) {
        if (!versions || versions.length === 0) {
            return "📭 *No version history available.*\n\nYour CV versions will appear here as you make updates.";
        }
        
        let message = "📁 *YOUR CV VERSION HISTORY*\n\n";
        message += "━━━━━━━━━━━━━━━━━━━━━━━━━━━\n";
        
        for (const v of versions) {
            const currentMarker = v.is_current ? " ✅ CURRENT" : "";
            const date = new Date(v.created_at).toLocaleDateString();
            const time = new Date(v.created_at).toLocaleTimeString();
            
            message += `🔹 *Version ${v.version_number}*${currentMarker}\n`;
            message += `   📅 ${date} at ${time}\n`;
            message += `   📝 ${v.changes || 'Update'}\n`;
            
            // Show summary stats
            const summary = this.getVersionSummary(v.cv_data);
            if (summary) {
                message += `   📊 ${summary.employment_count} jobs · ${summary.education_count} edu · ${summary.skills_count} skills\n`;
            }
            message += `\n`;
        }
        
        message += "━━━━━━━━━━━━━━━━━━━━━━━━━━━\n";
        message += `💡 *Commands:*\n`;
        message += `• /version DETAILS - View full version details\n`;
        message += `• /compare V1 V2 - Compare two versions\n`;
        message += `• /revert VERSION_NUMBER - Restore a previous version\n`;
        
        return message;
    }
    
    // Format single version details
    formatVersionDetails(version) {
        if (!version) return "❌ Version not found.";
        
        const cv = version.cv_data;
        const summary = this.getVersionSummary(cv);
        
        let message = `📄 *VERSION ${version.version_number} DETAILS*\n\n`;
        message += `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
        message += `📅 Created: ${new Date(version.created_at).toLocaleString()}\n`;
        message += `📝 Changes: ${version.changes || 'Initial version'}\n`;
        message += `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
        
        // Personal Info
        const personal = cv.personal || {};
        message += `👤 *Personal Information*\n`;
        message += `• Name: ${personal.full_name || 'Not set'}\n`;
        message += `• Email: ${personal.email || 'Not set'}\n`;
        message += `• Phone: ${personal.primary_phone || 'Not set'}\n`;
        message += `• Location: ${personal.location || 'Not set'}\n`;
        if (personal.linkedin) message += `• LinkedIn: ${personal.linkedin}\n`;
        if (personal.github) message += `• GitHub: ${personal.github}\n`;
        message += `\n`;
        
        // Professional Summary
        if (cv.professional_summary) {
            message += `📝 *Professional Summary*\n${cv.professional_summary}\n\n`;
        }
        
        // Work Experience
        message += `💼 *Work Experience* (${summary.employment_count})\n`;
        for (const job of (cv.employment || []).slice(0, 3)) {
            message += `• ${job.title} at ${job.company}\n`;
            if (job.duration) message += `  📅 ${job.duration}\n`;
            if (job.achievements?.length) {
                message += `  ✓ ${job.achievements[0].substring(0, 60)}${job.achievements[0].length > 60 ? '...' : ''}\n`;
            }
        }
        if (summary.employment_count > 3) message += `  + ${summary.employment_count - 3} more\n`;
        message += `\n`;
        
        // Education
        message += `🎓 *Education* (${summary.education_count})\n`;
        for (const edu of (cv.education || []).slice(0, 2)) {
            message += `• ${edu.level} in ${edu.field}\n`;
            if (edu.institution) message += `  🏛️ ${edu.institution}\n`;
        }
        message += `\n`;
        
        // Skills
        message += `⚡ *Skills* (${summary.skills_count})\n`;
        if (cv.skills?.technical?.length) {
            message += `• Technical: ${cv.skills.technical.slice(0, 8).join(', ')}${cv.skills.technical.length > 8 ? '...' : ''}\n`;
        }
        if (cv.skills?.soft?.length) {
            message += `• Soft: ${cv.skills.soft.slice(0, 5).join(', ')}${cv.skills.soft.length > 5 ? '...' : ''}\n`;
        }
        message += `\n`;
        
        // Other sections summary
        const otherSections = [];
        if (summary.certifications_count) otherSections.push(`📜 ${summary.certifications_count} certifications`);
        if (summary.languages_count) otherSections.push(`🌍 ${summary.languages_count} languages`);
        if (summary.projects_count) otherSections.push(`📁 ${summary.projects_count} projects`);
        if (summary.achievements_count) otherSections.push(`🏆 ${summary.achievements_count} achievements`);
        if (summary.volunteer_count) otherSections.push(`🤝 ${summary.volunteer_count} volunteer`);
        if (summary.leadership_count) otherSections.push(`👔 ${summary.leadership_count} leadership`);
        if (summary.referees_count) otherSections.push(`👥 ${summary.referees_count} referees`);
        
        if (otherSections.length > 0) {
            message += `📊 *Additional Sections*\n`;
            message += `• ${otherSections.join(' · ')}\n\n`;
        }
        
        message += `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
        message += `To restore this version, type: /revert ${version.version_number}`;
        
        return message;
    }
}
const cvVersioning = new CVVersioning();

// ============ HANDLE BUILD METHOD ============
async function handleBuildMethod(ctx, client, session, data) {
    if (data === 'build_draft') {
        session.data.build_method = 'draft';
        await sendMarkdown(ctx, `📎 *Upload Your Draft*

Send me your existing CV or cover letter (PDF, DOCX, or image).

✨ *What I'll extract using AI:*
━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 Personal Information (name, email, phone, location, LinkedIn, GitHub)
💼 Work Experience (titles, companies, dates, responsibilities, achievements)
🎓 Education (degrees, fields, institutions, graduation years)
⚡ Skills (technical, soft, tools - automatically categorized)
📜 Certifications (names, issuers, dates)
🌍 Languages (names, proficiency levels)
📁 Projects (names, descriptions, technologies, roles)
🏆 Achievements
🤝 Volunteer Experience
👔 Leadership Roles
🏅 Awards
📖 Publications
🎤 Conferences
👥 Referees
💡 Interests
━━━━━━━━━━━━━━━━━━━━━━━━━━━

*Supported formats:* PDF, DOCX, JPG, PNG

I'll extract everything and only ask for what's missing!

Click below for manual entry if you prefer.`, {
            reply_markup: { inline_keyboard: [
                [{ text: "📎 Upload Draft", callback_data: "upload_draft_confirm" }],
                [{ text: "✍️ Enter Manually", callback_data: "build_manual" }]
            ] }
        });
        session.data.awaiting_draft_upload = true;
        await db.updateSession(session.id, 'awaiting_draft_upload', 'draft', session.data);
        
    } else if (data === 'build_manual') {
        session.data.build_method = 'manual';
        const basePrice = getBasePrice(session.data.category, session.data.service);
        session.data.base_price = basePrice;
        
        // Show what the user will need to provide
        await sendMarkdown(ctx, `✍️ *Manual Entry Selected*

Base price: ${formatPrice(basePrice)}

*What you'll provide:*
━━━━━━━━━━━━━━━━━━━━━━━━━━━
1️⃣ Personal Information (name, contact, location)
2️⃣ Work Experience (jobs, responsibilities, achievements)
3️⃣ Education (qualifications, institutions)
4️⃣ Skills (technical, soft, tools)
5️⃣ Certifications (optional)
6️⃣ Languages (optional)
7️⃣ Projects (optional)
8️⃣ Achievements (optional)
9️⃣ Referees (minimum 2)
━━━━━━━━━━━━━━━━━━━━━━━━━━━

*Select delivery speed:*`, {
            reply_markup: { inline_keyboard: [
                [{ text: "🚚 Standard (6 hours)", callback_data: "delivery_standard" }],
                [{ text: "⚡ Express (2 hours) +MK3,000", callback_data: "delivery_express" }],
                [{ text: "🏃 Rush (1 hour) +MK5,000", callback_data: "delivery_rush" }]
            ] }
        });
        await db.updateSession(session.id, 'selecting_delivery', null, session.data);
    }
}

// ============ DELIVERY SELECTION (UPDATED) ============
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
    
    // Show delivery confirmation
    await sendMarkdown(ctx, `✅ *Delivery Selected: ${DELIVERY_TIMES[delivery]}*

💰 Total Amount: *${session.data.total_charge}*
   (Base: ${formatPrice(getBasePrice(session.data.category, session.data.service))} + Delivery: ${DELIVERY_PRICES[delivery] > 0 ? `+MK${DELIVERY_PRICES[delivery]}` : 'Free'})

Now, let's collect your information to create your professional document.

━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 *What's Next*
━━━━━━━━━━━━━━━━━━━━━━━━━━━

I'll guide you through collecting:
• Personal Information
• Work Experience
• Education
• Skills
• And more...

Let's begin! 🚀`);
    
    if (session.data.build_method === 'manual') {
        await portfolioCollector.askForPortfolio(ctx);
        await db.updateSession(session.id, 'collecting_portfolio', 'portfolio', session.data);
        
    } else if (session.data.build_method === 'draft_completed') {
        if (session.data.cv_data && Object.keys(session.data.cv_data).length > 0) {
            // Check if we have extracted data from draft
            const cvData = session.data.cv_data;
            const hasExtractedData = cvData.personal?.full_name || 
                                     cvData.employment?.length || 
                                     cvData.education?.length;
            
            if (hasExtractedData) {
                await sendMarkdown(ctx, `📄 *Draft data loaded!*

I've already extracted information from your draft. Let me check what's missing and we'll fill in the gaps.`);
                await smartDraft.collectNextMissingSection(ctx, client, session);
            } else {
                await portfolioCollector.askForPortfolio(ctx);
                await db.updateSession(session.id, 'collecting_portfolio', 'portfolio', session.data);
            }
        } else {
            await portfolioCollector.askForPortfolio(ctx);
            await db.updateSession(session.id, 'collecting_portfolio', 'portfolio', session.data);
        }
        
    } else {
        await portfolioCollector.askForPortfolio(ctx);
        await db.updateSession(session.id, 'collecting_portfolio', 'portfolio', session.data);
    }
}

// ============ UPLOAD DRAFT CONFIRMATION ============
async function handleUploadDraftConfirm(ctx, client, session) {
    await sendMarkdown(ctx, `📎 *Ready to Upload*

Please send me your CV or cover letter file.

*Supported formats:*
📄 PDF, DOCX, DOC, TXT
🖼️ JPG, PNG, GIF, BMP, WEBP

*Maximum file size:* 20MB

*What happens next:*
1️⃣ I'll send your file to DeepSeek AI for extraction
2️⃣ All 18+ categories will be analyzed
3️⃣ You'll see a summary of what was found
4️⃣ I'll ask for any missing information

Send your file now... 📎`);
    
    session.data.awaiting_draft_upload = true;
    await db.updateSession(session.id, 'awaiting_draft_upload', 'draft', session.data);
}

// Add this when client enters position in cover letter flow
async function checkVacancyAndSuggest(ctx, position, client) {
    const matches = await vacancyLibrary.findSimilarVacancies(position);
    
    if (matches.length > 0) {
        const message = vacancyLibrary.formatVacancyMatches(matches);
        
        await ctx.reply(message, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: `✅ Yes - ${matches[0].company}`, callback_data: `vacancy_use_${matches[0].id}` }],
                    [{ text: "📋 Show more", callback_data: `vacancy_more_${position}` }],
                    [{ text: "📝 No, different position", callback_data: "vacancy_new" }]
                ]
            }
        });
        return true;
    }
    return false;
}

// Handle selection
bot.action(/vacancy_use_(.+)/, async (ctx) => {
    const vacancyId = ctx.match[1];
    const vacancy = await db.getVacancyById(vacancyId);
    const client = await getOrCreateClient(ctx);
    const session = await db.getActiveSession(client.id);
    
    session.data.vacancy_data = vacancy;
    session.data.using_library_vacancy = true;
    await db.updateSession(session.id, session.stage, session.current_section, session.data);
    
    await ctx.answerCbQuery();
    await ctx.editMessageText(`✅ Using existing details for *${vacancy.position}* at *${vacancy.company}*.\n\nI'll tailor your documents perfectly for this role!`, { parse_mode: 'Markdown' });
    
    await askCoverLetterQuestions(ctx, client, session);
});

bot.action('vacancy_new', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.editMessageText(`📝 Please enter the position you're applying for:`);
});

// ============ MAIN MENU HANDLER ============
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
                    [{ text: "🎓 Student - Still studying", callback_data: "cat_student" }],
                    [{ text: "📜 Recent Graduate < a year", callback_data: "cat_recent" }],
                    [{ text: "💼 Professional - currently working", callback_data: "cat_professional" }],
                    [{ text: "🌱 Non-Working - Career break", callback_data: "cat_nonworking" }],
                    [{ text: "🔄 Returning Client - Used us before", callback_data: "cat_returning" }]
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
TNM: +265 881 193 707
WhatsApp: +265 881 193 707`);
        return;
    } else if (text === '🏠 Portal') {
        await showClientPortal(ctx, client);
        return;
    } else {
        await sendMarkdown(ctx, `Please select a category to get started:`, {
            reply_markup: { inline_keyboard: [
                [{ text: "🎓 Student - Still studying", callback_data: "cat_student" }],
                [{ text: "📜 Recent Graduate < a year", callback_data: "cat_recent" }],
                [{ text: "💼 Professional - currently working", callback_data: "cat_professional" }],
                [{ text: "🌱 Non-Working - Career break", callback_data: "cat_nonworking" }],
                [{ text: "🔄 Returning Client - Used us before", callback_data: "cat_returning" }]
            ] }
        });
    }
}

// ============ HANDLE VACANCY TEXT (UPDATED) ============
async function handleVacancyText(ctx, client, session, text) {
    ensureCoverLetterData(session);
    try {
        const vacancyData = aiAnalyzer.extractVacancyDetails(text);
        session.data.vacancy_data = vacancyData;
        session.data.awaiting_vacancy = false;
        
        // Show extracted vacancy details
        let extractedMessage = `📊 *Vacancy Details Extracted*

━━━━━━━━━━━━━━━━━━━━━━━━━━━
📌 *Position:* ${vacancyData.position || 'Not detected'}
🏢 *Company:* ${vacancyData.company || 'Not detected'}
📍 *Location:* ${vacancyData.location || 'Not detected'}
⏰ *Deadline:* ${vacancyData.deadline || 'Not specified'}
📋 *Job Type:* ${vacancyData.job_type || 'Not specified'}
━━━━━━━━━━━━━━━━━━━━━━━━━━━

*Requirements:*
${(vacancyData.requirements || []).slice(0, 3).map(r => `• ${r}`).join('\n') || '• Not specified'}

*Position applying for?* (or type 'SAME')`;

        await sendMarkdown(ctx, extractedMessage);
        await db.updateSession(session.id, 'collecting_coverletter_position', 'coverletter', session.data);
    } catch (error) {
        console.error('Vacancy extraction error:', error);
        await sendMarkdown(ctx, `⚠️ Could not extract vacancy details. Please type the position you're applying for.`);
        session.data.awaiting_vacancy = false;
        await db.updateSession(session.id, 'collecting_coverletter_position', 'coverletter', session.data);
    }
}
// ============ ADDITIONAL MESSAGE TEMPLATES ============
const ADDITIONAL_TEMPLATES = {
    // Error Report Templates (NEW)
    error_report: {
        received: (name, reference) => `🐛 *Error Report Received*\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\nDear ${name},\n\nThank you for helping us improve EasySuccor! Your error report has been logged.\n\n*Reference:* \`${reference}\`\n\nWe'll investigate and notify you when resolved.\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n🤝 The EasySuccor Team`,
        
        resolved: (name, reference) => `✅ *Error Report Resolved*\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\nDear ${name},\n\nGreat news! The issue you reported has been fixed.\n\n*Reference:* \`${reference}\`\n\nThank you for your patience!\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n🤝 The EasySuccor Team`
    },
    
    // Follow-up Templates (NEW)
    followup: {
        after_7_days: (name) => `👋 *Checking In*\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\nDear ${name},\n\nIt's been a week since you received your CV. How's the job search going?\n\nIf you've landed an interview or got hired, we'd love to celebrate! Use /hired to share your success.\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n🤝 The EasySuccor Team`,
        
        after_30_days: (name) => `🌟 *Still Here for You*\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\nDear ${name},\n\nIt's been a month since we created your CV. We're always here if you need:\n• CV Updates\n• Cover Letters\n• Referral rewards (/referral)\n\nWishing you continued success!\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n🤝 The EasySuccor Team`
    },
    
    // WhatsApp Quick Templates (NEW)
    whatsapp: {
        document_ready: (name, orderId) => `Hello ${name}, your document (Order: ${orderId}) is ready! Please check your Telegram chat to download it. - EasySuccor`,
        payment_reminder: (name, amount, reference) => `Hello ${name}, friendly reminder about your pending payment of ${amount} for EasySuccor. Reference: ${reference}. Thank you!`,
        order_update: (name, status) => `Hello ${name}, your EasySuccor order status is now: ${status}. Check Telegram for details.`
    }
};

// Helper to send WhatsApp template
function getWhatsAppLink(phone, type, variables) {
    const template = ADDITIONAL_TEMPLATES.whatsapp?.[type];
    if (!template) return null;
    
    let message = template;
    for (const [key, value] of Object.entries(variables)) {
        message = message.replace(new RegExp(`\\$\\{${key}\\}`, 'g'), value);
    }
    
    return `https://wa.me/${phone.replace(/[^0-9]/g, '')}?text=${encodeURIComponent(message)}`;
}

// ============ PROCESS VACANCY FILE (UPDATED) ============
async function processVacancyFile(ctx, client, session, fileUrl, fileName) {
    await sendMarkdown(ctx, `📄 Processing your vacancy details with AI...`);
    
    const vacancyData = await aiAnalyzer.extractVacancyFromFile(fileUrl, fileName);
    session.data.vacancy_data = vacancyData;
    session.data.awaiting_vacancy = false;
    
    let message = `📊 *Vacancy Details Extracted*

━━━━━━━━━━━━━━━━━━━━━━━━━━━
📌 *Position:* ${vacancyData.position || 'Not detected'}
🏢 *Company:* ${vacancyData.company || 'Not detected'}
📍 *Location:* ${vacancyData.location || 'Not detected'}
⏰ *Deadline:* ${vacancyData.deadline || 'Not specified'}
💰 *Salary:* ${vacancyData.salary || 'Not specified'}
📋 *Job Type:* ${vacancyData.job_type || 'Not specified'}
🎓 *Experience Required:* ${vacancyData.experience_required || 'Not specified'}
🎓 *Education Required:* ${vacancyData.education_required || 'Not specified'}
━━━━━━━━━━━━━━━━━━━━━━━━━━━

*Key Requirements:*
${(vacancyData.requirements || []).slice(0, 5).map(r => `• ${r}`).join('\n') || '• No specific requirements listed'}

*Responsibilities:*
${(vacancyData.responsibilities || []).slice(0, 3).map(r => `• ${r}`).join('\n') || '• No specific responsibilities listed'}

*Benefits:*
${(vacancyData.benefits || []).slice(0, 3).map(b => `• ${b}`).join('\n') || '• Not specified'}

━━━━━━━━━━━━━━━━━━━━━━━━━━━
*Contact:* ${vacancyData.contact_email || vacancyData.contact_phone || 'Not specified'}

Do you want to add any additional information?`;

    await sendMarkdown(ctx, message, {
        reply_markup: { inline_keyboard: [
            [{ text: "✅ Yes, add more info", callback_data: "cover_add_info" }],
            [{ text: "📝 No, continue", callback_data: "cover_continue" }]
        ] }
    });
    
    session.data.cover_has_vacancy = true;
    await db.updateSession(session.id, 'cover_review_vacancy', 'cover', session.data);
}

// ============ HANDLE COVER CONTINUE (UPDATED) ============
async function handleCoverContinue(ctx, client, session, data) {
    if (data === 'cover_add_info') {
        await askCoverLetterQuestions(ctx, client, session);
    } else {
        // Show summary before finalizing
        const coverData = session.data.cover_data || {};
        const vacancyData = session.data.vacancy_data || {};
        
        const summary = `📝 *Cover Letter Summary*

━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 *Your Details*
━━━━━━━━━━━━━━━━━━━━━━━━━━━
Position: ${coverData.position || vacancyData.position || 'Not specified'}
Company: ${coverData.company || vacancyData.company || 'Not specified'}
Experience: ${coverData.experience_highlight || 'Provided'}
Skills: ${(coverData.skills || []).join(', ') || 'Provided'}
Achievement: ${coverData.achievement || 'Provided'}
Motivation: ${coverData.motivation || 'Provided'}
Availability: ${coverData.availability || 'Not specified'}

━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ Type *CONFIRM* to proceed or *EDIT* to make changes.`;

        await sendMarkdown(ctx, summary);
        session.data.awaiting_cover_confirmation = true;
        await db.updateSession(session.id, 'awaiting_cover_confirmation', 'cover', session.data);
    }
}

// ============ INTELLIGENT UPDATE HANDLERS (UPDATED) ============
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

*What you can update:*
━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 Personal Information (name, email, phone, location)
💼 Work Experience (add/remove jobs, update responsibilities)
🎓 Education (add/remove degrees, update dates)
⚡ Skills (add/remove skills)
📜 Certifications
🌍 Languages
📁 Projects
🏆 Achievements
🤝 Volunteer Experience
👔 Leadership Roles
🏅 Awards
📖 Publications
🎤 Conferences
👥 Referees
━━━━━━━━━━━━━━━━━━━━━━━━━━━

*Examples:*
• "Add 5 years of experience as Project Manager at ABC Corp"
• "Remove my high school education"
• "Update my phone number to 0999123456"
• "Add a certification in Digital Marketing"
• "Add a project: E-commerce Website using React"
• "Add volunteer experience: Community Tutor at Local School"
• "I'm applying for a Senior Developer role at Tech Company"

You can also upload vacancy details, and I'll tailor your CV accordingly.

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
                    await sendMarkdown(ctx, `📊 *Vacancy Detected:*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n📌 Position: ${vacancyData.position}\n🏢 Company: ${vacancyData.company}\n📋 Requirements: ${(vacancyData.requirements || []).slice(0, 3).join(', ')}

I'll tailor your CV for this role.`);
                }
            }
        }
        
        const result = await intelligentUpdate.processUpdate(session.data.existing_cv, userRequest, vacancyData);
        
        if (!result.success) {
            await sendMarkdown(ctx, `❌ I couldn't understand your request. Please be more specific.

*Examples of what you can say:*
• "Add 3 years as Marketing Manager at XYZ Ltd"
• "Remove my diploma in Business"
• "Update my email to new@email.com"
• "Add a project: Mobile App Development"
• "Add a certification: AWS Certified Developer"
• "Add volunteer: Red Cross Volunteer"

Click Cancel to go back.`, {
                reply_markup: { inline_keyboard: [[{ text: "❌ Cancel", callback_data: "cancel_update" }]] }
            });
            return;
        }
        
        let changeSummary = `📝 *Proposed Changes:*\n\n`;
        for (const change of result.changes_summary) changeSummary += `• ${change}\n`;
        if (vacancyData) changeSummary += `\n🎯 *Tailored for:* ${vacancyData.position} at ${vacancyData.company}\n`;
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
        await sendMarkdown(ctx, `⚠️ Something went wrong. Please try again.`);
    }
}

async function handleApproveUpdate(ctx, client, session) {
    const updatedCV = session.data.proposed_cv;
    const orderId = `UPD_${Date.now()}_${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
    
    // Ensure the updated CV has all 18+ categories structure
    const completeCV = cvVersioning.ensureCompleteCVData(updatedCV);
    
    await db.createOrder({
        id: orderId, client_id: client.id, service: 'cv update', category: session.data.category || 'professional',
        delivery_option: 'standard', delivery_time: '6 hours',
        base_price: getBasePrice('professional', 'cv update'), delivery_fee: 0,
        total_charge: formatPrice(getBasePrice('professional', 'cv update')),
        payment_status: 'pending', cv_data: completeCV
    });
    
    await cvVersioning.saveVersion(orderId, completeCV, 2, 'Intelligent update');
    
    await sendMarkdown(ctx, `✅ *Update Applied Successfully!*

Your CV has been updated as requested.

Order: \`${orderId}\`
Total: ${formatPrice(getBasePrice('professional', 'cv update'))}

Click below to complete payment and receive your updated CV.`, {
        reply_markup: { inline_keyboard: [[{ text: "💰 Pay Now", callback_data: "proceed_payment" }]] }
    });
    
    session.data.awaiting_update_request = false;
    session.data.pending_update = false;
    await db.updateSession(session.id, 'awaiting_payment_choice', 'payment', session.data);
}

async function handleUpdateFlow(ctx, client, session) {
    await handleIntelligentUpdate(ctx, client, session);
}

async function handleUpdateCollection(ctx, client, session, text) {
    await handleUpdateRequest(ctx, client, session, text);
}

// ============ SHOW CLIENT PORTAL (UPDATED) ============
async function showClientPortal(ctx, client) {
    const orders = await db.getClientOrders(client.id);
    const cvOrders = orders.filter(o => o.service === 'new cv' || o.service === 'editable cv');
    const coverOrders = orders.filter(o => o.service === 'cover letter' || o.service === 'editable cover letter');
    const updateOrders = orders.filter(o => o.service === 'cv update');
    
    // Get latest CV version info
    let latestCVInfo = '';
    if (cvOrders.length > 0) {
        const latestCV = cvOrders[0];
        const versions = await db.getCVVersions(latestCV.id);
        latestCVInfo = `\n📄 *Latest CV:* v${latestCV.version || 1} - ${new Date(latestCV.created_at).toLocaleDateString()}`;
    }
    
    let message = `🏠 *YOUR PORTAL*

━━━━━━━━━━━━━━━━━━━━━━━━━━━
👤 *ACCOUNT INFORMATION*
━━━━━━━━━━━━━━━━━━━━━━━━━━━

• Name: ${client.first_name} ${client.last_name || ''}
• Phone: ${client.phone || '❌ Not set'}
• Email: ${client.email || '❌ Not set'}
• Location: ${client.location || '❌ Not set'}
• Nationality: ${client.nationality || '❌ Not set'}
• Member since: ${new Date(client.created_at).toLocaleDateString()}

━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 *YOUR STATISTICS*
━━━━━━━━━━━━━━━━━━━━━━━━━━━

• Total Orders: ${orders.length}
• CVs: ${cvOrders.length}
• Cover Letters: ${coverOrders.length}
• Updates: ${updateOrders.length}
• Completed: ${orders.filter(o => o.payment_status === 'completed').length}
${latestCVInfo}

━━━━━━━━━━━━━━━━━━━━━━━━━━━
📄 *RECENT DOCUMENTS*
━━━━━━━━━━━━━━━━━━━━━━━━━━━`;

    if (orders.length > 0) {
        message += orders.slice(0, 5).map(o => `\n📌 *${o.service}* - ${o.status}
   📅 ${new Date(o.created_at).toLocaleDateString()}
   💰 ${o.total_charge}`).join('');
    } else {
        message += `\nNo documents yet. Start your first order with /start`;
    }
    
    message += `\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚙️ *QUICK ACTIONS*
━━━━━━━━━━━━━━━━━━━━━━━━━━━

• /mydocs - View all documents
• /versions - View CV version history
• /referral - Share & earn
• /feedback - Rate your experience
• /support - Contact support

Need help? Type /help anytime.`;

    await sendMarkdown(ctx, message);
}

// ============ START COMMAND ============
// ============ WARM WELCOME - DYNAMIC RESPONSES ============
// ============ ROBUST START PAYLOAD PARSING ============
bot.start(async (ctx) => {
    const client = await db.getClient(ctx.from.id);
    const startPayload = ctx.startPayload;
    
    console.log('📥 Start payload received:', startPayload);
    
    // Check for referral (format: ref_CODE or ref_CODE_Name)
    if (startPayload && startPayload.startsWith('ref_')) {
        const payload = startPayload.substring(4); // Remove 'ref_'
        
        // Check if there's an underscore (meaning name is included)
        const underscoreIndex = payload.indexOf('_');
        
        if (underscoreIndex > 0) {
            const referralCode = payload.substring(0, underscoreIndex);
            const encodedName = payload.substring(underscoreIndex + 1);
            const visitorName = decodeURIComponent(encodedName.replace(/%5F/g, '_'));
            
            console.log('📥 Referral with name:', { referralCode, visitorName });
            await handleReferralWithName(ctx, referralCode, visitorName);
            return;
        } else {
            const referralCode = payload;
            console.log('📥 Referral without name:', { referralCode });
            await handleReferralStart(ctx, referralCode);
            return;
        }
    }
    
    // Name only (no referral)
    if (startPayload) {
        const visitorName = decodeURIComponent(startPayload);
        console.log('📥 Name only payload:', visitorName);
        
        const telegramName = ctx.from.first_name || visitorName;
        await handleNewClient(ctx, telegramName);
        return;
    }
    
    // No payload - normal start
    const telegramName = ctx.from.first_name || 'Valued Professional';
    console.log('📥 Normal start:', telegramName);
    
    if (!client) {
        await handleNewClient(ctx, telegramName);
    } else {
        await handleReturningClient(ctx, client);
    }
});

async function handleNewClient(ctx, name) {
    const client = await db.getClient(ctx.from.id);
    if (client) {
        await handleReturningClient(ctx, client);
        return;
    }
    
    const newClient = await db.createClient(ctx.from.id, ctx.from.username, name, ctx.from.last_name || '');
    const welcomeMessage = getTimeBasedFirstTimeWelcome(name);
    
    await ctx.reply(welcomeMessage, {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                [{ text: "🎓 Student / Recent Graduate", callback_data: "category_student" }],
                [{ text: "💼 Professional (3+ years)", callback_data: "category_professional" }],
                [{ text: "🌱 Career Starter / Non-Working", callback_data: "category_nonworking" }],
                [{ text: "🔄 Returning Client", callback_data: "category_returning" }]
            ]
        }
    });
}

async function handleReturningClient(ctx, client) {
    const clientName = client.first_name || 'Friend';
    const welcomeBackMessage = getTimeBasedReturningWelcome(clientName);
    
    await ctx.reply(welcomeBackMessage, {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                [{ text: "📄 New CV", callback_data: "service_new_cv" }],
                [{ text: "📝 Editable CV", callback_data: "service_editable_cv" }],
                [{ text: "💌 Cover Letter", callback_data: "service_cover_letter" }],
                [{ text: "📎 Editable Cover Letter", callback_data: "service_editable_cover" }],
                [{ text: "✏️ Update Existing CV", callback_data: "prefill_update" }],
                [{ text: "🏢 Client Portal", callback_data: "portal_main" }]
            ]
        }
    });
}
    // ============ SEND PERSISTENT KEYBOARD FOR RETURNING CLIENTS ============
    await ctx.reply('💡 *Quick Tip:* Use the keyboard below for quick access!', {
        parse_mode: 'Markdown',
        reply_markup: mainMenuKeyboard
    });
// ============ HEALTH CHECK COMMAND (DeepSeek API status) ============
bot.command('health', async (ctx) => {
    // Admin only
    if (ctx.from.id.toString() !== process.env.ADMIN_CHAT_ID) {
        return await ctx.reply("⛔ Unauthorized.");
    }
    
    const healthStatus = {
        bot: 'online',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        database: 'checking',
        deepseek: 'checking'
    };
    
    // Check Database
    try {
        const dbCheck = await db.getClient(ctx.from.id);
        healthStatus.database = dbCheck ? 'connected' : 'connected';
    } catch (error) {
        healthStatus.database = `error: ${error.message}`;
    }
    
    // Check DeepSeek API
    try {
        const { OpenAI } = require('openai');
        const deepseek = new OpenAI({
            apiKey: process.env.DEEPSEEK_API_KEY,
            baseURL: 'https://api.deepseek.com/v1'
        });
        const testResponse = await deepseek.chat.completions.create({
            model: 'deepseek-chat',
            messages: [{ role: 'user', content: 'Say "API is working!"' }],
            max_tokens: 10
        });
        healthStatus.deepseek = 'working';
        healthStatus.deepseek_response = testResponse.choices[0].message.content;
    } catch (error) {
        healthStatus.deepseek = `error: ${error.message}`;
    }
    
    const message = `🩺 *HEALTH CHECK REPORT*

━━━━━━━━━━━━━━━━━━━━━━━━━━━
🤖 *Bot Status:* ${healthStatus.bot}
🕐 *Uptime:* ${Math.floor(healthStatus.uptime / 60)} minutes
📅 *Timestamp:* ${healthStatus.timestamp}
━━━━━━━━━━━━━━━━━━━━━━━━━━━

🗄️ *Database:* ${healthStatus.database}
🧠 *DeepSeek API:* ${healthStatus.deepseek}
${healthStatus.deepseek_response ? `📝 *Test:* ${healthStatus.deepseek_response}` : ''}

━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ All systems operational.`;

    await ctx.reply(message, { parse_mode: 'Markdown' });
});

// ============ SERVE INDEX.HTML (Home Page) ============
// This is already handled by express.static('public')
// But add a command to get the URL
bot.command('website', async (ctx) => {
    const webhookUrl = process.env.WEBHOOK_URL || 'https://easysuccor-bot-production.up.railway.app';
    await sendMarkdown(ctx, `🌐 *EasySuccor Home Page*

Visit our professional Home Page:
${webhookUrl}

*What you'll find there:*
• Service descriptions and pricing
• Sample CV templates
• Client testimonials
• FAQ section
• Easy access to our Telegram bot

Share this link with anyone who needs a professional CV!`);
});

// ============ ADMIN COMMANDS (UPDATED) ============

// Admin command to view all orders with 18+ categories stats
bot.command('admin_orders', async (ctx) => {
    if (ctx.from.id.toString() !== process.env.ADMIN_CHAT_ID) {
        return await ctx.reply("⛔ Unauthorized. Admin access only.");
    }
    
    const orders = await db.getAllOrders();
    if (orders.length === 0) {
        await ctx.reply("📭 No orders found.");
        return;
    }
    
    let message = "📋 *ALL ORDERS*\n\n";
    for (const order of orders.slice(0, 20)) {
        const cvData = order.cv_data || {};
        const stats = {
            jobs: cvData.employment?.length || 0,
            edu: cvData.education?.length || 0,
            skills: (cvData.skills?.technical?.length || 0) + (cvData.skills?.soft?.length || 0) + (cvData.skills?.tools?.length || 0),
            certs: cvData.certifications?.length || 0,
            projects: cvData.projects?.length || 0
        };
        
        message += `🔹 *${order.id}*\n`;
        message += `   Service: ${order.service}\n`;
        message += `   Status: ${order.status}\n`;
        message += `   Payment: ${order.payment_status}\n`;
        message += `   Total: ${order.total_charge}\n`;
        message += `   Date: ${new Date(order.created_at).toLocaleDateString()}\n`;
        message += `   📊 ${stats.jobs} jobs · ${stats.edu} edu · ${stats.skills} skills · ${stats.certs} certs\n\n`;
    }
    await ctx.reply(message, { parse_mode: 'Markdown' });
});

// Admin command to view full CV data with 18+ categories
bot.command('admin_view', async (ctx) => {
    if (ctx.from.id.toString() !== process.env.ADMIN_CHAT_ID) {
        return await ctx.reply("⛔ Unauthorized.");
    }
    
    const args = ctx.message.text.split(' ');
    if (args.length < 2) {
        return await ctx.reply("Usage: /admin_view ORDER_ID");
    }
    
    const orderId = args[1];
    const order = await db.getOrder(orderId);
    if (!order) {
        return await ctx.reply(`❌ Order ${orderId} not found.`);
    }
    
    const cvData = order.cv_data || {};
    const personal = cvData.personal || {};
    
    let message = `📄 *FULL CV DATA FOR ORDER ${orderId}*\n\n`;
    
    // Personal Information
    message += `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    message += `👤 *PERSONAL INFORMATION*\n`;
    message += `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    message += `• Name: ${personal.full_name || 'N/A'}\n`;
    message += `• Email: ${personal.email || 'N/A'}\n`;
    message += `• Phone: ${personal.primary_phone || 'N/A'}\n`;
    message += `• Location: ${personal.location || 'N/A'}\n`;
    message += `• LinkedIn: ${personal.linkedin || 'N/A'}\n`;
    message += `• GitHub: ${personal.github || 'N/A'}\n`;
    message += `• Professional Title: ${personal.professional_title || 'N/A'}\n\n`;
    
    // Work Experience
    message += `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    message += `💼 *WORK EXPERIENCE* (${cvData.employment?.length || 0})\n`;
    message += `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    for (const job of (cvData.employment || [])) {
        message += `• ${job.title} at ${job.company}\n`;
        message += `  📅 ${job.duration || 'Duration not specified'}\n`;
        if (job.achievements?.length) {
            message += `  🏆 ${job.achievements[0].substring(0, 60)}${job.achievements[0].length > 60 ? '...' : ''}\n`;
        }
    }
    message += `\n`;
    
    // Education
    message += `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    message += `🎓 *EDUCATION* (${cvData.education?.length || 0})\n`;
    message += `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    for (const edu of (cvData.education || [])) {
        message += `• ${edu.level} in ${edu.field}\n`;
        message += `  🏛️ ${edu.institution}\n`;
        message += `  📅 ${edu.graduation_date || edu.year || 'Year not specified'}\n`;
    }
    message += `\n`;
    
    // Skills
    const skills = cvData.skills || {};
    message += `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    message += `⚡ *SKILLS*\n`;
    message += `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    if (skills.technical?.length) message += `• Technical: ${skills.technical.join(', ')}\n`;
    if (skills.soft?.length) message += `• Soft: ${skills.soft.join(', ')}\n`;
    if (skills.tools?.length) message += `• Tools: ${skills.tools.join(', ')}\n`;
    message += `\n`;
    
    // Certifications
    if (cvData.certifications?.length) {
        message += `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
        message += `📜 *CERTIFICATIONS* (${cvData.certifications.length})\n`;
        message += `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
        for (const cert of cvData.certifications) {
            message += `• ${cert.name}${cert.issuer ? ` (${cert.issuer})` : ''}\n`;
        }
        message += `\n`;
    }
    
    // Languages
    if (cvData.languages?.length) {
        message += `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
        message += `🌍 *LANGUAGES* (${cvData.languages.length})\n`;
        message += `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
        for (const lang of cvData.languages) {
            message += `• ${lang.name} (${lang.proficiency || 'Not specified'})\n`;
        }
        message += `\n`;
    }
    
    // Projects
    if (cvData.projects?.length) {
        message += `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
        message += `📁 *PROJECTS* (${cvData.projects.length})\n`;
        message += `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
        for (const proj of cvData.projects.slice(0, 5)) {
            message += `• ${proj.name}${proj.role ? ` (${proj.role})` : ''}\n`;
        }
        message += `\n`;
    }
    
    // Referees
    if (cvData.referees?.length) {
        message += `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
        message += `👥 *REFEREES* (${cvData.referees.length})\n`;
        message += `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
        for (const ref of cvData.referees) {
            message += `• ${ref.name} - ${ref.position || 'Position not specified'} at ${ref.company || 'Company not specified'}\n`;
        }
        message += `\n`;
    }
    
    message += `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    message += `💾 *Raw JSON available in database*`;
    
    await ctx.reply(message, { parse_mode: 'Markdown' });
});

// Admin command to list all clients with stats
bot.command('admin_clients', async (ctx) => {
    if (ctx.from.id.toString() !== process.env.ADMIN_CHAT_ID) {
        return await ctx.reply("⛔ Unauthorized.");
    }
    
    const clients = await db.getAllClients();
    if (clients.length === 0) {
        await ctx.reply("📭 No clients found.");
        return;
    }
    
    let message = "👥 *ALL CLIENTS*\n\n";
    for (const client of clients.slice(0, 20)) {
        const orders = await db.getClientOrders(client.id);
        const completed = orders.filter(o => o.payment_status === 'completed').length;
        const totalSpent = orders.reduce((sum, o) => sum + (parseInt(o.total_charge?.replace('MK', '').replace(',', '') || 0), 0));
        
        message += `🔹 ID: ${client.id} - ${client.first_name} ${client.last_name || ''}\n`;
        message += `   📞 ${client.phone || 'No phone'} | 📧 ${client.email || 'No email'}\n`;
        message += `   📦 Orders: ${orders.length} (${completed} completed)\n`;
        message += `   💰 Spent: MK${totalSpent.toLocaleString()}\n`;
        message += `   📅 Joined: ${new Date(client.created_at).toLocaleDateString()}\n\n`;
    }
    await ctx.reply(message, { parse_mode: 'Markdown' });
});

// Admin command to delete a client
bot.command('admin_delete_client', async (ctx) => {
    if (ctx.from.id.toString() !== process.env.ADMIN_CHAT_ID) {
        return await ctx.reply("⛔ Unauthorized.");
    }
    
    const args = ctx.message.text.split(' ');
    if (args.length < 2) {
        return await ctx.reply("Usage: /admin_delete_client CLIENT_ID\n\nGet client IDs from /admin_clients");
    }
    
    const clientId = parseInt(args[1]);
    const client = await db.getClientById(clientId);
    
    if (!client) {
        return await ctx.reply(`❌ Client ${clientId} not found.`);
    }
    
    await db.deleteClientData(clientId);
    await ctx.reply(`✅ Client ${client.first_name} ${client.last_name || ''} (ID: ${clientId}) deleted successfully.`);
});

// Admin command to clear all data (emergency only)
bot.command('admin_clear_all', async (ctx) => {
    if (ctx.from.id.toString() !== process.env.ADMIN_CHAT_ID) {
        return await ctx.reply("⛔ Unauthorized.");
    }
    
    await ctx.reply(`⚠️ *DANGER: This will delete ALL data!*\n\nType /confirm_clear_all to confirm. This action cannot be undone.`);
});

bot.command('confirm_clear_all', async (ctx) => {
    if (ctx.from.id.toString() !== process.env.ADMIN_CHAT_ID) {
        return await ctx.reply("⛔ Unauthorized.");
    }
    
    await db.clearAllData();
    await ctx.reply(`✅ ALL DATA CLEARED successfully.`);
});

// Admin command to update prices
bot.command('admin_price', async (ctx) => {
    if (ctx.from.id.toString() !== process.env.ADMIN_CHAT_ID) {
        return await ctx.reply("⛔ Unauthorized.");
    }
    
    const args = ctx.message.text.split(' ');
    if (args.length < 4) {
        return await ctx.reply("Usage: /admin_price CATEGORY SERVICE PRICE\n\nCategories: student, recent, professional, nonworking, returning\nServices: cv, editable_cv, editable_cover, update, cover\n\nExample: /admin_price student cv 7000");
    }
    
    const category = args[1];
    const service = args[2];
    const price = parseInt(args[3]);
    
    if (PRICE_CONFIG[category] && PRICE_CONFIG[category][service] !== undefined) {
        PRICE_CONFIG[category][service] = price;
        fs.writeFileSync('./price_config.json', JSON.stringify(PRICE_CONFIG, null, 2));
        await ctx.reply(`✅ Price updated: ${category}.${service} = MK${price.toLocaleString()}`);
    } else {
        await ctx.reply(`❌ Invalid category or service. Use /admin_price for help.`);
    }
});

// Admin command to get DeepSeek API status
bot.command('admin_deepseek', async (ctx) => {
    if (ctx.from.id.toString() !== process.env.ADMIN_CHAT_ID) {
        return await ctx.reply("⛔ Unauthorized.");
    }
    
    await ctx.reply(`🔍 *Checking DeepSeek API Status...*`);
    
    try {
        const { OpenAI } = require('openai');
        const deepseek = new OpenAI({
            apiKey: process.env.DEEPSEEK_API_KEY,
            baseURL: 'https://api.deepseek.com/v1'
        });
        
        const startTime = Date.now();
        const response = await deepseek.chat.completions.create({
            model: 'deepseek-chat',
            messages: [{ role: 'user', content: 'Say "API OK"' }],
            max_tokens: 10
        });
        const responseTime = Date.now() - startTime;
        
        await ctx.reply(`✅ *DeepSeek API is WORKING*

━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 *Status:* Online
⏱️ *Response Time:* ${responseTime}ms
📝 *Test Response:* ${response.choices[0].message.content}
━━━━━━━━━━━━━━━━━━━━━━━━━━━

DeepSeek AI is ready to process CV extractions!`);
        
    } catch (error) {
        await ctx.reply(`❌ *DeepSeek API ERROR*

━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 *Status:* Offline
❌ *Error:* ${error.message}
━━━━━━━━━━━━━━━━━━━━━━━━━━━

Please check your DEEPSEEK_API_KEY environment variable.`);
    }
});
// ============ ADMIN: LIST PENDING REPORTS ============
bot.command('reports', async (ctx) => {
    if (ctx.from.id.toString() !== process.env.ADMIN_CHAT_ID) return;
    
    const reports = await db.getErrorReports('pending', 20);
    
    if (reports.length === 0) {
        return ctx.reply('✅ No pending error reports.');
    }
    
    let message = `🐛 *Pending Error Reports*\n\n`;
    for (const r of reports) {
        const client = await db.getClientById(r.client_id);
        message += `*ID:* ${r.id}\n`;
        message += `*Client:* ${client?.first_name || 'Unknown'}\n`;
        message += `*Desc:* ${r.description.slice(0, 50)}${r.description.length > 50 ? '...' : ''}\n`;
        message += `*Date:* ${new Date(r.created_at).toLocaleDateString()}\n`;
        message += `*File:* \`${r.file_id.slice(0, 8)}\`\n`;
        message += `/resolve ${r.id}\n\n`;
    }
    
    await ctx.reply(message, { parse_mode: 'Markdown' });
});

// ============ ADMIN: RESOLVE REPORT ============
bot.command('resolve', async (ctx) => {
    if (ctx.from.id.toString() !== process.env.ADMIN_CHAT_ID) return;
    
    const reportId = ctx.message.text.split(' ')[1];
    if (!reportId) return ctx.reply('Usage: /resolve [report_id]');
    
    const report = await db.getErrorReportById(parseInt(reportId));
    if (!report) return ctx.reply('❌ Report not found.');
    
    await db.updateErrorReportStatus(reportId, 'resolved', 'Issue fixed');
    
    const client = await db.getClientById(report.client_id);
    if (client) {
        await bot.telegram.sendMessage(
            client.telegram_id,
            `✅ *Issue Resolved!*\n\nThank you for your patience. The issue you reported has been fixed!\n\n*Reference:* \`${report.file_id.slice(0, 8)}\`\n\nWe appreciate you helping us improve EasySuccor! 🤝`,
            { parse_mode: 'Markdown' }
        );
    }
    
    await ctx.reply(`✅ Report #${reportId} resolved. Client ${client?.first_name || 'Unknown'} has been notified.`);
});

// ============ ADMIN: RESOLVE BY FILE ID ============
bot.command('resolve_report', async (ctx) => {
    if (ctx.from.id.toString() !== process.env.ADMIN_CHAT_ID) return;
    
    const fileId = ctx.message.text.split(' ')[1];
    if (!fileId) return ctx.reply('Usage: /resolve_report [file_id]');
    
    const reports = await db.getErrorReports('pending', 100);
    const report = reports.find(r => r.file_id === fileId || r.file_id.startsWith(fileId));
    
    if (!report) return ctx.reply('❌ Report not found.');
    
    await db.updateErrorReportStatus(report.id, 'resolved', 'Issue fixed');
    
    const client = await db.getClientById(report.client_id);
    if (client) {
        await bot.telegram.sendMessage(
            client.telegram_id,
            `✅ *Issue Resolved!*\n\nThank you for your patience. The issue you reported has been fixed!\n\n*Reference:* \`${report.file_id.slice(0, 8)}\`\n\nWe appreciate you helping us improve EasySuccor! 🤝`,
            { parse_mode: 'Markdown' }
        );
    }
    
    await ctx.reply(`✅ Report resolved. Client ${client?.first_name || 'Unknown'} has been notified.`);
});
// ============ ADMIN: QUICK STATISTICS ============
bot.command('admin_stats', async (ctx) => {
    if (ctx.from.id.toString() !== process.env.ADMIN_CHAT_ID) {
        return await ctx.reply("⛔ Unauthorized.");
    }
    
    const orders = await db.getAllOrders();
    const clients = await db.getAllClients();
    const completed = orders.filter(o => o.payment_status === 'completed');
    const pending = orders.filter(o => o.payment_status === 'pending');
    const revenue = completed.reduce((sum, o) => {
        return sum + (parseInt(String(o.total_charge).replace(/[^0-9]/g, '') || 0));
    }, 0);
    
    const today = new Date().toISOString().split('T')[0];
    const todayOrders = orders.filter(o => o.created_at?.startsWith(today));
    
    const message = `📊 *QUICK STATISTICS*

━━━━━━━━━━━━━━━━━━━━━━━━━━━
👥 *Clients:* ${clients.length}
📦 *Total Orders:* ${orders.length}
✅ *Completed:* ${completed.length}
⏳ *Pending:* ${pending.length}
💰 *Revenue:* MK${revenue.toLocaleString()}
📅 *Today's Orders:* ${todayOrders.length}
━━━━━━━━━━━━━━━━━━━━━━━━━━━

📊 *Full Dashboard:* ${process.env.WEBHOOK_URL}/admin`;
    
    await ctx.reply(message, { parse_mode: 'Markdown' });
});

// ============ USER COMMANDS (UPDATED) ============

bot.command('portal', async (ctx) => {
    const client = await getOrCreateClient(ctx);
    const orders = await db.getClientOrders(client.id);
    const cvOrders = orders.filter(o => o.service === 'new cv' || o.service === 'editable cv');
    const coverOrders = orders.filter(o => o.service === 'cover letter' || o.service === 'editable cover letter');
    
    let message = `🏠 *YOUR PORTAL*

━━━━━━━━━━━━━━━━━━━━━━━━━━━
👤 *PROFILE*
━━━━━━━━━━━━━━━━━━━━━━━━━━━

• Name: ${client.first_name} ${client.last_name || ''}
• Phone: ${client.phone || '❌ Not set'}
• Email: ${client.email || '❌ Not set'}
• Location: ${client.location || '❌ Not set'}

━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 *STATISTICS*
━━━━━━━━━━━━━━━━━━━━━━━━━━━

• Total Orders: ${orders.length}
• CVs: ${cvOrders.length}
• Cover Letters: ${coverOrders.length}
• Completed: ${orders.filter(o => o.payment_status === 'completed').length}

━━━━━━━━━━━━━━━━━━━━━━━━━━━
📄 *RECENT DOCUMENTS*
━━━━━━━━━━━━━━━━━━━━━━━━━━━`;

    if (orders.length > 0) {
        message += orders.slice(0, 5).map(o => `\n• ${o.service} - ${o.status}\n  📅 ${new Date(o.created_at).toLocaleDateString()}\n  💰 ${o.total_charge}`).join('');
    } else {
        message += `\nNo documents yet. Start with /start`;
    }
    
    message += `\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚙️ *QUICK ACTIONS*
━━━━━━━━━━━━━━━━━━━━━━━━━━━

• /mydocs - View all documents
• /versions - View CV history
• /referral - Share & earn
• /feedback - Rate your experience

Need help? Type /help`;

    await sendMarkdown(ctx, message);
});

bot.command('mydocs', async (ctx) => {
    const client = await getOrCreateClient(ctx);
    const orders = await db.getClientOrders(client.id);
    let msg = "📄 *YOUR DOCUMENTS*\n\n";
    if (orders.length === 0) {
        msg += "No documents yet. Type /start to create one!";
    } else {
        orders.forEach(o => {
            msg += `📌 *${o.service}* - ${o.status}\n`;
            msg += `   🆔 Order: \`${o.id}\`\n`;
            msg += `   📅 Date: ${new Date(o.created_at).toLocaleDateString()}\n`;
            msg += `   💰 Amount: ${o.total_charge}\n\n`;
        });
    }
    await sendMarkdown(ctx, msg);
});

bot.command('versions', async (ctx) => {
    const client = await getOrCreateClient(ctx);
    const orders = await db.getClientOrders(client.id);
    const cvOrders = orders.filter(o => o.service === 'new cv' || o.service === 'editable cv');
    
    if (cvOrders.length === 0) {
        await sendMarkdown(ctx, `📭 No CV versions found. Create your first CV with /start`);
        return;
    }
    
    let msg = "📁 *YOUR CV VERSIONS*\n\n";
    for (const order of cvOrders) {
        const versions = await db.getCVVersions(order.id);
        const versionCount = versions.length || 1;
        msg += `📌 *${order.service}* - ${order.status}\n`;
        msg += `   🆔 Order: \`${order.id}\`\n`;
        msg += `   🔄 Versions: ${versionCount}\n`;
        msg += `   📅 Created: ${new Date(order.created_at).toLocaleDateString()}\n\n`;
    }
    msg += `To view a specific version, type: /view_version ORDER_ID`;
    await sendMarkdown(ctx, msg);
});

bot.command('view_version', async (ctx) => {
    const args = ctx.message.text.split(' ');
    if (args.length < 2) {
        await sendMarkdown(ctx, `Usage: /view_version ORDER_ID\n\nExample: /view_version ORD_1234567890`);
        return;
    }
    
    const orderId = args[1];
    const order = await db.getOrder(orderId);
    
    if (!order) {
        await sendMarkdown(ctx, `❌ Order not found.`);
        return;
    }
    
    const cvData = order.cv_data || {};
    const personal = cvData.personal || {};
    
    let message = `📄 *CV DATA FOR ORDER ${orderId}*\n\n`;
    message += `👤 *Personal:* ${personal.full_name || 'N/A'} | ${personal.email || 'N/A'}\n`;
    message += `📍 *Location:* ${personal.location || 'N/A'}\n`;
    message += `💼 *Experience:* ${cvData.employment?.length || 0} job(s)\n`;
    message += `🎓 *Education:* ${cvData.education?.length || 0} qualification(s)\n`;
    message += `⚡ *Skills:* ${(cvData.skills?.technical?.length || 0) + (cvData.skills?.soft?.length || 0) + (cvData.skills?.tools?.length || 0)} skill(s)\n`;
    message += `📜 *Certifications:* ${cvData.certifications?.length || 0}\n`;
    message += `🌍 *Languages:* ${cvData.languages?.length || 0}\n`;
    message += `📁 *Projects:* ${cvData.projects?.length || 0}\n`;
    message += `👥 *Referees:* ${cvData.referees?.length || 0}\n\n`;
    message += `💾 *Full data available in your portal.`;
    
    await sendMarkdown(ctx, message);
});

// ============ UPDATED REFERRAL COMMAND - LINKS TO LANDING PAGE ============
bot.command('referral', async (ctx) => {
    const client = await getOrCreateClient(ctx);
    const refInfo = await db.getReferralInfo(client.id);
    
    const websiteUrl = process.env.WEBSITE_URL || 'https://easysuccor-bot-production.up.railway.app';
    const shareLink = `${websiteUrl}?ref=${refInfo.referral_code}`;
    
    const message = `🎁 <b>REFERRAL PROGRAM</b>

━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 <b>YOUR REFERRAL LINK</b>
━━━━━━━━━━━━━━━━━━━━━━━━━━━

<b>Your code:</b> <code>${refInfo.referral_code}</code>

🔗 <b>Share this link:</b>
<a href="${shareLink}">${shareLink}</a>

━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 <b>YOUR STATISTICS</b>
━━━━━━━━━━━━━━━━━━━━━━━━━━━

• Tier: ${getReferralTier(refInfo.completed_referrals)}
• Total referrals: ${refInfo.total_referrals}
• Completed: ${refInfo.completed_referrals}
• Pending reward: MK${(refInfo.pending_reward || 0).toLocaleString()}
• Available credit: MK${(refInfo.available_credit || 0).toLocaleString()}

━━━━━━━━━━━━━━━━━━━━━━━━━━━
📤 <b>SHARE NOW</b>
━━━━━━━━━━━━━━━━━━━━━━━━━━━

Tap the link above to copy and share!

Every referral brings you closer to a free CV! 🎉`;

    await ctx.replyWithHTML(message);
});

// Helper function for referral tier
function getReferralTier(count) {
    if (count >= 50) return '👑 Diamond';
    if (count >= 25) return '💎 Platinum';
    if (count >= 10) return '🥇 Gold';
    if (count >= 5) return '🥈 Silver';
    return '🥉 Bronze';
}
bot.command('pay', async (ctx) => {
    const client = await getOrCreateClient(ctx);
    const session = await db.getActiveSession(client.id);
    
    if (!session || !session.data || !session.data.total_charge) {
        await sendMarkdown(ctx, `❌ No active order found. Type /start to create a new order.`);
        return;
    }
    
    const paymentReference = generatePaymentReference();
    const totalCharge = session.data.total_charge;
    
    session.data.payment_reference = paymentReference;
    await db.updateSession(session.id, session.stage, session.current_section, session.data);
    
    const paymentMessage = `💳 *COMPLETE YOUR PAYMENT*

━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 ORDER SUMMARY
━━━━━━━━━━━━━━━━━━━━━━━━━━━

Order: \`${session.data.order_id || 'Pending'}\`
Amount: *${totalCharge}*
Reference: \`${paymentReference}\`

━━━━━━━━━━━━━━━━━━━━━━━━━━━
💳 PAYMENT OPTIONS
━━━━━━━━━━━━━━━━━━━━━━━━━━━

*1️⃣ Mobile Money*
   📱 Airtel: 0991295401
   📱 Mpamba: 0886928639

*2️⃣ Bank Account*
   🏦 MO626: 1005653618

*3️⃣ USSD*
   📞 Dial *211# (Airtel)
   📞 Dial *444# (Mpamba)

*4️⃣ Pay Later*
   ⏳ Pay within 7 days

*5️⃣ Installments*
   📅 2 parts over 7 days

━━━━━━━━━━━━━━━━━━━━━━━━━━━
📌 NEXT STEPS
━━━━━━━━━━━━━━━━━━━━━━━━━━━

1️⃣ Send exactly *${totalCharge}* to any account above
2️⃣ Use reference: \`${paymentReference}\`
3️⃣ After payment, click the button below:

Need help? Contact +265 991 295 401`;

    await sendMarkdown(ctx, paymentMessage, {
        reply_markup: {
            inline_keyboard: [[
                { text: "✅ I Have Made Payment", callback_data: `confirm_${paymentReference}` }
            ]]
        }
    });
});

bot.command('cancel', async (ctx) => {
    const client = await getOrCreateClient(ctx);
    const session = await db.getActiveSession(client.id);
    
    if (session && session.data) {
        session.data.payment_confirmed = false;
        session.data.payment_reference = null;
        await db.updateSession(session.id, session.stage, session.current_section, session.data);
        await sendMarkdown(ctx, `❌ Payment confirmation cancelled. You can start over with /start or /pay again.`);
    } else {
        await sendMarkdown(ctx, `No active payment to cancel.`);
    }
});

bot.command('pause', async (ctx) => {
    const client = await getOrCreateClient(ctx);
    const session = await db.getActiveSession(client.id);
    if (session && session.stage !== 'main_menu') {
        session.is_paused = true;
        await db.updateSession(session.id, session.stage, session.current_section, session.data, 1);
        await sendMarkdown(ctx, `⏸️ *Session Paused*\n\nType /resume when you're ready to continue. I'll be here! 👋`);
    } else {
        await sendMarkdown(ctx, `No active session to pause.`);
    }
});

bot.command('resume', async (ctx) => {
    const client = await getOrCreateClient(ctx);
    const pausedSession = await db.getPausedSession(client.id);
    if (pausedSession) {
        pausedSession.data = JSON.parse(pausedSession.data);
        await db.updateSession(pausedSession.id, pausedSession.stage, pausedSession.current_section, pausedSession.data, 0);
        
        let resumeMessage = "🔄 Welcome back! Let's continue where we left off.\n\n";
        if (pausedSession.stage === 'collecting_personal') {
            const step = pausedSession.data.collection_step;
            if (step === 'name') resumeMessage += getQuestion('name');
            else if (step === 'email') resumeMessage += getQuestion('email');
            else if (step === 'phone') resumeMessage += getQuestion('phone');
            else if (step === 'alt_phone') resumeMessage += "Alternative phone? (or click 'Skip') 📞";
            else if (step === 'whatsapp') resumeMessage += "WhatsApp for delivery? (or click 'Same') 📱";
            else if (step === 'location') resumeMessage += getQuestion('location');
            else if (step === 'physical_address') resumeMessage += "Physical address? 🏠 (or click 'Skip')";
            else if (step === 'nationality') resumeMessage += "Nationality? 🌍 (or click 'Skip')";
            else resumeMessage += getQuestion('name');
        } else if (pausedSession.stage === 'collecting_education') {
            const step = pausedSession.data.collection_step;
            if (step === 'level') resumeMessage += "Highest qualification? 🎓";
            else if (step === 'field') resumeMessage += "Field of study? 📚";
            else if (step === 'institution') resumeMessage += "Institution? 🏛️";
            else if (step === 'year') resumeMessage += "Year of completion? 📅";
            else resumeMessage += "Highest qualification? 🎓";
        } else if (pausedSession.stage === 'collecting_employment') {
            const step = pausedSession.data.collection_step;
            if (step === 'title') resumeMessage += getQuestion('jobTitle');
            else if (step === 'company') resumeMessage += "Company name? 🏢";
            else if (step === 'duration') resumeMessage += "Duration? 📅";
            else if (step === 'responsibilities') resumeMessage += "Key responsibilities? (click DONE when finished)";
            else resumeMessage += getQuestion('jobTitle');
        } else if (pausedSession.stage === 'collecting_skills') {
            resumeMessage += getQuestion('skills');
        } else if (pausedSession.stage === 'collecting_certifications') {
            resumeMessage += "Any certifications? (Click SKIP if none)";
        } else if (pausedSession.stage === 'collecting_languages') {
            resumeMessage += "Languages you speak? (Click SKIP if none)";
        } else if (pausedSession.stage === 'collecting_referees') {
            resumeMessage += "Professional referees? (Minimum 2 recommended)\n\nReferee 1 - Full name?";
        } else {
            resumeMessage += "Let's continue where we left off.";
        }
        
        await sendMarkdown(ctx, resumeMessage);
    } else {
        await sendMarkdown(ctx, `No paused session found. Type /start to begin fresh.`);
    }
});

bot.command('confirm', async (ctx) => {
    const args = ctx.message.text.split(' ');
    if (args.length < 2) {
        await sendMarkdown(ctx, "Usage: /confirm REFERENCE");
        return;
    }
    const reference = args[1];
    await handlePaymentConfirmation(ctx, reference);
});

bot.command('test_email', async (ctx) => {
    if (ctx.from.id.toString() !== process.env.ADMIN_CHAT_ID) {
        return await ctx.reply("Unauthorized");
    }
    
    const result = await notificationService.sendEmail(
        process.env.EMAIL_USER,
        'Test Email from EasySuccor',
        'This is a test email to verify your email notification system is working correctly.\n\nIf you received this, email notifications are configured properly!'
    );
    
    if (result.success) {
        await ctx.reply(`✅ Test email sent successfully to ${process.env.EMAIL_USER}`);
    } else {
        await ctx.reply(`❌ Test email failed: ${result.error}`);
    }
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
        for (const t of testimonials) message += `⭐️⭐️⭐️⭐️⭐️ "${t.text}"\n— ${t.name}\n\n`;
        await sendMarkdown(ctx, message);
    }
});


bot.command('reset', async (ctx) => {
    const client = await getOrCreateClient(ctx);
    await db.endSession(client.id);
    await sendMarkdown(ctx, `🔄 *Session reset.* Type /start to begin fresh.`);
});
// ============ HANDLE PERSISTENT KEYBOARD BUTTONS ============
bot.hears('📄 New CV', async (ctx) => {
    const client = await getOrCreateClient(ctx);
    const session = await getOrCreateSession(client.id);
    session.data.service = 'new cv';
    await handleServiceSelection(ctx, client, session, 'service_new');
});

bot.hears('📝 Editable CV', async (ctx) => {
    const client = await getOrCreateClient(ctx);
    const session = await getOrCreateSession(client.id);
    session.data.service = 'editable cv';
    await handleServiceSelection(ctx, client, session, 'service_editable');
});

bot.hears('💌 Cover Letter', async (ctx) => {
    const client = await getOrCreateClient(ctx);
    const session = await getOrCreateSession(client.id);
    session.data.service = 'cover letter';
    await handleServiceSelection(ctx, client, session, 'service_cover');
});

bot.hears('📎 Editable Cover Letter', async (ctx) => {
    const client = await getOrCreateClient(ctx);
    const session = await getOrCreateSession(client.id);
    session.data.service = 'editable cover letter';
    await handleServiceSelection(ctx, client, session, 'service_editable_cover');
});

bot.hears('✏️ Update CV', async (ctx) => {
    const client = await getOrCreateClient(ctx);
    const session = await getOrCreateSession(client.id);
    await handleIntelligentUpdate(ctx, client, session);
});

bot.hears('📎 Upload Draft', async (ctx) => {
    const client = await getOrCreateClient(ctx);
    const session = await getOrCreateSession(client.id);
    await handleBuildMethod(ctx, client, session, 'build_draft');
});

bot.hears('ℹ️ About', async (ctx) => {
    await ctx.reply(`📄 *EasySuccor - Professional CVs*\n\nContact: +265 991 295 401\nWhatsApp: +265 881 193 707\n\n*Services:*\n• New CV - MK6,000 - MK10,000\n• Editable CV - MK8,000 - MK12,000\n• Cover Letter - MK5,000 - MK6,000\n• Editable Cover Letter - MK8,000\n• CV Update - MK3,000 - MK6,000`, { parse_mode: 'Markdown' });
});

bot.hears('📞 Contact', async (ctx) => {
    await ctx.reply(`📞 *Contact*\n\nAirtel: 0991295401\nTNM: 0886928639\nWhatsApp: +265 881 193 707`, { parse_mode: 'Markdown' });
});

bot.hears('🏠 Portal', async (ctx) => {
    const client = await getOrCreateClient(ctx);
    await showClientPortal(ctx, client);
});

bot.help(async (ctx) => {
    await sendMarkdown(ctx, `🆘 *HELP CENTER*

━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 *COMMANDS*
━━━━━━━━━━━━━━━━━━━━━━━━━━━

/start - Begin or restart
/resume - Continue paused session
/pause - Save progress and pause
/pay - Make a payment
/confirm REF - Confirm payment
/portal - Your dashboard
/mydocs - Your documents
/versions - View CV versions
/referral - Share & earn
/feedback - Share your experience
/testimonials - See success stories
/reset - Reset current session
/help - Show this help

━━━━━━━━━━━━━━━━━━━━━━━━━━━
📞 *CONTACT*
━━━━━━━━━━━━━━━━━━━━━━━━━━━

Phone: +265 991 295 401
WhatsApp: +265 881 193 707
Email: ${process.env.EMAIL_USER}

━━━━━━━━━━━━━━━━━━━━━━━━━━━
🌐 *WEBSITE*
━━━━━━━━━━━━━━━━━━━━━━━━━━━

${process.env.WEBHOOK_URL || 'https://easysuccor-bot-production.up.railway.app'}

We're here to help! 💙`);
});

// ============ REQUEST EXTENSION COMMAND ============
bot.command('extend', async (ctx) => {
    const client = await db.getClient(ctx.from.id);
    const orders = await db.getClientOrders(client.id);
    
    // Find active installment order
    const activeInstallment = orders.find(o => 
        o.payment_type === 'installment' && 
        o.installment_status === 'active'
    );
    
    if (!activeInstallment) {
        return ctx.reply('❌ No active installment plan found.');
    }
    
    const result = await installmentTracker.requestExtension(activeInstallment.id, ctx);
    
    if (result.success) {
        await ctx.reply(result.message, { parse_mode: 'Markdown' });
    } else {
        await ctx.reply(`❌ ${result.error}`, { parse_mode: 'Markdown' });
    }
});

// ============ ERROR REPORTING COMMAND ============
bot.command('report', async (ctx) => {
    const client = await db.getClient(ctx.from.id);
    
    await ctx.reply(`🐛 *Report a Bug*

━━━━━━━━━━━━━━━━━━━━━━━━━━━
📸 *How to Report*
━━━━━━━━━━━━━━━━━━━━━━━━━━━

1️⃣ Take a screenshot of the issue
2️⃣ Send the screenshot here with a brief description
3️⃣ We'll investigate and notify you when fixed!

*Please describe what happened:*
(Type your description or click Cancel)`, {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [[
                { text: "❌ Cancel", callback_data: "report_cancel" }
            ]]
        }
    });
    
    const session = await db.getActiveSession(client.id);
    if (session) {
        session.data.awaiting_report = true;
        await db.updateSession(session.id, session.stage, session.current_section, session.data);
    } else {
        await db.saveSession(client.id, 'awaiting_report', null, { awaiting_report: true }, 0);
    }
});

// ============ HANDLE REPORT CANCELLATION ============
bot.action('report_cancel', async (ctx) => {
    await ctx.answerCbQuery();
    
    const client = await db.getClient(ctx.from.id);
    const session = await db.getActiveSession(client.id);
    
    if (session?.data?.awaiting_report) {
        session.data.awaiting_report = false;
        await db.updateSession(session.id, session.stage, session.current_section, session.data);
    }
    
    await ctx.editMessageText('❌ Report cancelled. Type /report if you need to report an issue later.');
});

// ============ HANDLE REPORT SUBMISSION (PHOTO + TEXT) ============
bot.on('photo', async (ctx, next) => {
    const client = await db.getClient(ctx.from.id);
    if (!client) return next();
    
    const session = await db.getActiveSession(client.id);
    
    if (session?.data?.awaiting_report) {
        const photo = ctx.message.photo;
        const caption = ctx.message.caption || 'No description provided';
        const fileId = photo[photo.length - 1].file_id;
        
        await db.saveErrorReport({
            client_id: client.id,
            file_id: fileId,
            description: caption,
            status: 'pending'
        });
        
        // Notify admin
        const adminChatId = process.env.ADMIN_CHAT_ID;
        if (adminChatId) {
            await bot.telegram.sendMessage(
                adminChatId,
                `🐛 *New Error Report*\n\n*Client:* ${client.first_name || 'Anonymous'}\n*Description:* ${caption}\n*File ID:* \`${fileId}\`\n\n/resolve_report ${fileId}`,
                { parse_mode: 'Markdown' }
            );
        }
        
        await ctx.reply(`✅ *Report Submitted!*

Thank you for helping us improve EasySuccor!

We'll investigate this issue and notify you when it's resolved.

*Reference:* \`${fileId.slice(0, 8)}\``, { parse_mode: 'Markdown' });
        
        session.data.awaiting_report = false;
        await db.updateSession(session.id, session.stage, session.current_section, session.data);
        return;
    }
    
    return next();
});

// ============ HANDLE TEXT FOR REPORT DESCRIPTION ============
bot.on('text', async (ctx, next) => {
    const client = await db.getClient(ctx.from.id);
    if (!client) return next();
    
    const session = await db.getActiveSession(client.id);
    
    if (session?.data?.awaiting_report && !ctx.message.text.startsWith('/')) {
        session.data.report_description = ctx.message.text;
        await db.updateSession(session.id, session.stage, session.current_section, session.data);
        
        await ctx.reply(`📝 *Description saved!*

Now please send the screenshot of the issue.`, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [[
                    { text: "❌ Cancel", callback_data: "report_cancel" }
                ]]
            }
        });
        return;
    }
    
    return next();
});

// ============ START BOT (UPDATED) ============
async function startBot() {
    console.log('🚀 Starting EasySuccor Bot...');
    
    // ============ INITIALIZE DATABASE ============
    try {
        await db.initDatabase();
        console.log('✅ Database initialized successfully');
    } catch (dbError) {
        console.error('❌ Database initialization failed:', dbError.message);
        process.exit(1);
    }
    
    // ============ LOAD TESTIMONIALS CACHE ============
    try {
        await loadTestimonialsCache();
        console.log('✅ Testimonials cache loaded');
    } catch (testError) {
        console.log('⚠️ Could not load testimonials:', testError.message);
    }
    
    // ============ VERIFY DEEPSEEK API CONNECTION ============
    console.log('🔍 Verifying DeepSeek API connection...');
    try {
        const { OpenAI } = require('openai');
        const deepseek = new OpenAI({
            apiKey: process.env.DEEPSEEK_API_KEY,
            baseURL: 'https://api.deepseek.com/v1'
        });
        const testResponse = await deepseek.chat.completions.create({
            model: 'deepseek-chat',
            messages: [{ role: 'user', content: 'Say "API OK"' }],
            max_tokens: 10
        });
        console.log('✅ DeepSeek API connected:', testResponse.choices[0].message.content);
    } catch (deepseekError) {
        console.error('❌ DeepSeek API connection failed:', deepseekError.message);
        console.log('⚠️ Bot will run but CV extraction will use fallback mode');
    }
    
    // ============ SET BOT COMMANDS (UPDATED) ============
try {
   await bot.telegram.setMyCommands([
    // User commands
    { command: 'start', description: '🚀 Begin your journey' },
    { command: 'resume', description: '▶️ Resume where you left off' },
    { command: 'pause', description: '⏸️ Save and pause session' },
    { command: 'pay', description: '💰 Make a payment' },
    { command: 'portal', description: '🏠 Your client dashboard' },
    { command: 'mydocs', description: '📄 View your documents' },
    { command: 'versions', description: '📁 CV version history' },
    { command: 'referral', description: '🎁 Refer friends, earn credit' },
    { command: 'feedback', description: '⭐ Leave feedback' },
    { command: 'testimonials', description: '🌟 Read success stories' },
    { command: 'website', description: '🌐 Visit our Home Page' },
    { command: 'report', description: '🐛 Report an issue' },
    { command: 'thankyou', description: '🙏 We appreciate you' },
    { command: 'hired', description: '🎉 Report you got hired!' },
    { command: 'help', description: '🆘 Get help' },
    { command: 'reset', description: '🔄 Start fresh' },
    
    // Admin commands
    { command: 'admin_orders', description: '📋 View all orders' },
    { command: 'admin_clients', description: '👥 View all clients' },
    { command: 'admin_price', description: '💲 Update pricing' },
    { command: 'admin_deepseek', description: '🧠 Check AI status' },
    { command: 'reports', description: '🐛 View error reports' },
    { command: 'appreciate', description: '💝 Send appreciation' },
    { command: 'health', description: '🩺 System health' }
]);
    console.log('✅ Bot commands registered');
} catch (cmdError) {
    console.log('⚠️ Could not set commands:', cmdError.message);
}
async function refreshBotCommands() {
    const commands = [
        { command: 'start', description: '🚀 Begin your journey' },
        { command: 'resume', description: '▶️ Resume where you left off' },
        { command: 'pause', description: '⏸️ Save and pause session' },
        { command: 'pay', description: '💰 Make a payment' },
        { command: 'portal', description: '🏠 Your client dashboard' },
        { command: 'mydocs', description: '📄 View your documents' },
        { command: 'versions', description: '📁 CV version history' },
        { command: 'referral', description: '🎁 Refer friends, earn credit' },
        { command: 'feedback', description: '⭐ Leave feedback' },
        { command: 'testimonials', description: '🌟 Read success stories' },
        { command: 'website', description: '🌐 Visit our Home Page' },
        { command: 'report', description: '🐛 Report an issue' },
        { command: 'thankyou', description: '🙏 We appreciate you' },
        { command: 'help', description: '🆘 Get help' },
        { command: 'reset', description: '🔄 Start fresh' }
    ];
    
    await bot.telegram.setMyCommands(commands);
    console.log('✅ Commands refreshed');
}
    // ============ SETUP WEBHOOK ============
    const WEBHOOK_URL = process.env.WEBHOOK_URL || 'https://easysuccor-bot-production.up.railway.app';
;
    const webhookPath = '/webhook';
    const fullWebhookUrl = `${WEBHOOK_URL}${webhookPath}`;
    
    // Get current webhook info
    try {
        const webhookInfo = await bot.telegram.getWebhookInfo();
        console.log(`📡 Current webhook: ${webhookInfo.url || 'Not set'}`);
    } catch (webhookInfoError) {
        console.log('⚠️ Could not get webhook info:', webhookInfoError.message);
    }
    
    // Delete existing webhook
    try {
        await bot.telegram.deleteWebhook();
        console.log('✅ Existing webhook deleted');
    } catch (deleteError) {
        console.log('⚠️ Could not delete webhook:', deleteError.message);
    }
    
    // Set new webhook
    try {
        await bot.telegram.setWebhook(fullWebhookUrl, {
            allowed_updates: ['message', 'callback_query', 'inline_query']
        });
        console.log(`✅ Webhook set to ${fullWebhookUrl}`);
    } catch (webhookError) {
        console.error('❌ Failed to set webhook:', webhookError.message);
        console.log('⚠️ Bot will use polling mode as fallback');
    }
    
    // ============ SETUP EXPRESS WEBHOOK ENDPOINT ============
    app.post(webhookPath, (req, res) => {
        try {
            bot.handleUpdate(req.body, res);
        } catch (handleError) {
            console.error('Webhook handle error:', handleError.message);
            res.status(500).send('Error processing update');
        }
    });
    

    // ============ PRINT BOT STATUS ============
    console.log('');
    console.log('╔════════════════════════════════════════════════════════════════╗');
    console.log('║                    🤖 EASYSUCCOR BOT RUNNING                    ║');
    console.log('╠════════════════════════════════════════════════════════════════╣');
    console.log('║  ✅ NO welcome message - Direct to category selection          ║');
    console.log('║  ✅ AI generates professional summary (DeepSeek)               ║');
    console.log('║  ✅ Clickable buttons for all user choices                     ║');
    console.log('║  ✅ MO626 payment method added                                 ║');
    console.log('║  ✅ Health check endpoint: /health                             ║');
    console.log('║  ✅ Home Page: / (index.html)                               ║');
    console.log('║  ✅ Admin panel: /admin.html                                   ║');
    console.log('║  ✅ 18+ CV categories fully supported                          ║');
    console.log('║  ✅ Admin full control (delete, clear, price update)           ║');
    console.log('║  ✅ Email notifications (priority) + Telegram backup           ║');
    console.log('║  ✅ Installment plans & Pay Later options                      ║');
    console.log('║  ✅ Referral program & Testimonials                            ║');
    console.log('║  ✅ CV Versioning & Intelligent Update                         ║');
    console.log('╠════════════════════════════════════════════════════════════════╣');
    console.log(`║  🕐 Started at: ${new Date().toLocaleString()}                    ║`);
    console.log(`║  🌐 Webhook URL: ${WEBHOOK_URL}                                  ║`);
    console.log('╚════════════════════════════════════════════════════════════════╝');
    console.log('');
    
// ============ HANDLE PROCESS EXIT ============
    process.on('SIGINT', async () => {
        console.log('\n🛑 Shutting down gracefully...');
        try {
            await bot.telegram.deleteWebhook();
            console.log('✅ Webhook deleted');
        } catch (e) {
            console.log('⚠️ Could not delete webhook');
        }
        console.log('👋 Goodbye!');
        process.exit(0);
    });
    
    process.on('SIGTERM', async () => {
        console.log('\n🛑 Received SIGTERM, shutting down...');
        try {
            await bot.telegram.deleteWebhook();
            console.log('✅ Webhook deleted');
        } catch (e) {}
        process.exit(0);
    });
    
    // ============ UNHANDLED ERROR HANDLERS ============
    process.on('uncaughtException', (error) => {
        console.error('❌ Uncaught Exception:', error);
        // Don't exit, let the bot try to recover
    });
    
    process.on('unhandledRejection', (reason, promise) => {
        console.error('❌ Unhandled Rejection:', reason);
    });
}

// ============ START THE BOT ============
startBot().catch(console.error);