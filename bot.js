// bot.js - Complete EasySuccor Telegram Bot (All Features Integrated)
const { Telegraf, Markup } = require('telegraf');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const db = require('./database');
const payment = require('./payment');
const notificationService = require('./notification-service');
const documentGenerator = require('./document-generator');
const aiAnalyzer = require('./ai-analyzer');
const InstallmentTracker = require('./installment-tracker');
const ReferralTracker = require('./referral-tracker');

dotenv.config();

const bot = new Telegraf(process.env.BOT_TOKEN);

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

*Why this matters:* Employers love seeing real work examples! It can increase interview chances by up to 40%.

Type your portfolio links (one per line) or type 'SKIP' to continue.

Example:
https://github.com/yourusername
https://yourportfolio.com`, { parse_mode: 'Markdown' });
  }
  parsePortfolioLinks(text) {
    if (text.toLowerCase() === 'skip') return [];
    return text.split('\n').filter(line => line.trim().startsWith('http'));
  }
}

const portfolioCollector = new PortfolioCollector();

// ============ SOCIAL PROOF INTEGRATION ============
const SOCIAL_PROOF = [
  { rating: 5, text: "Got the job at my dream company! The CV was perfect.", name: "Sarah M." },
  { rating: 5, text: "CV landed me 3 interviews in one week. Worth every kwacha!", name: "James K." },
  { rating: 5, text: "Professional and fast! They understood exactly what I needed.", name: "Peter C." },
  { rating: 5, text: "Best investment I made for my career. Highly recommend!", name: "Chimwemwe B." },
  { rating: 5, text: "From no responses to multiple interviews. Life-changing!", name: "Tionge P." }
];

function getRandomSocialProof() {
  const random = SOCIAL_PROOF[Math.floor(Math.random() * SOCIAL_PROOF.length)];
  return `📢 *What our clients say:*\n\n⭐️⭐️⭐️⭐️⭐️ "${random.text}" - ${random.name}\n\nReady to join our satisfied clients? Type /start to begin!`;
}

// ============ HYBRID PAYMENT SYSTEM ============
const paymentReferences = new Map();

function generatePaymentReference() {
  const timestamp = Date.now().toString().slice(-6);
  const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `EASY${timestamp}${random}`;
}

// ============ DYNAMIC RESPONSE TEMPLATES ============
const RESPONSES = {
  greetings: [
    (name) => `👋 Yo ${name}! Ready to build that killer CV?`,
    (name) => `Hey ${name}! Let's get you that dream job. What brings you here?`,
    (name) => `✨ ${name}! Been expecting you. Let's make magic happen.`,
    (name) => `🚀 ${name}! Another CV, another opportunity. Let's go!`,
    (name) => `💼 ${name}! Your next career move starts here. Excited?`,
    (name) => `🎯 ${name}! Let's create something employers can't ignore.`,
    (name) => `🔥 ${name}! Time to turn your experience into opportunity.`,
    (name) => `👋 ${name}! Fancy seeing you here. CV or cover letter today?`
  ],
  encouragements: {
    start: ["Great choice! 🎯", "Love it! Let's do this. 💪", "Excellent! You won't regret this. ✨", "Perfect! I've got you. 🤝", "Awesome! Let's build something great. 🚀"],
    progress: [(p) => `${p}% done! You're crushing it! 🔥`, (p) => `${p}% already? You're on fire! 🎯`, (p) => `Almost there! ${p}% complete! ✨`, (p) => `${p}%! Keep going, you're doing great! 💪`, (p) => `Wow! ${p}% already? Time flies! ⚡`],
    sectionComplete: [(s) => `✓ Boom! ${s} done. Next? 🎯`, (s) => `✓ ${s}? Checked off. Moving on! 🔥`, (s) => `✓ One down, a few to go. ${s} looks solid! ✨`, (s) => `✓ Nailed it! ${s} is in the books. ⚡`, (s) => `✓ ${s} complete! You're a natural at this. 💪`],
    final: [(n) => `🏆 BOOM, ${n}! Your CV is ready for the world!`, (n) => `🎉 ${n}! You did it. Document coming right up!`, (n) => `✨ Incredible work, ${n}! Your future self thanks you.`, (n) => `🚀 ${n}! That was smooth. Document incoming!`, (n) => `💎 ${n}! Professional CV? Done. You're welcome.`]
  },
  questions: {
    name: ["First things first - what should I call you? 📛", "Let's start with the basics. Your name? ✨", "Who's the star of this CV? Tell me your name. 🎯", "Alright, introduce yourself! What's your name? 💫", "The document needs a name. Yours? 🔥"],
    email: ["Email address? Don't worry, I won't spam you. 📧", "How can employers reach you? Email? ✉️", "Drop your email here. It's safe with me. 🔒", "Email please! That's where the magic will land. 🎯"],
    phone: ["Phone number? Employers love calling. 📞", "Number where they can reach you? Don't be shy. 📱", "What's the best number to reach you? 🔥", "Drop your digits! (For employers, not me 😄) 📞"],
    location: ["Where in the world are you based? 📍", "Location? Helps employers know your timezone. 🌍", "City and country? Let's add some geography. 🗺️", "Where do you call home these days? 🏠"],
    summary: ["Tell me about yourself in 2-3 sentences. Go! ✍️", "Your professional story in a nutshell? Make it count. 🎯", "What makes you, YOU? Give me the highlights. ✨", "Sell yourself in a few sentences. I'm listening. 👂"],
    education: ["Highest qualification? Impress me. 🎓", "What's the biggest paper you've earned? 📜", "School, college, or university? Hit me. 🏛️", "Education time! What have you studied? 📚"],
    jobTitle: ["Most recent job title? Let's show off. 💼", "What do you do for money? (Besides this) 😄", "Job title that pays the bills? Spill it. 🎯", "Current or most recent role? Go on... 🔥"],
    skills: ["List your superpowers (skills). Comma separated. ⚡", "What are you ridiculously good at? 🔥", "Skills that make employers drool? Tell me. 💪", "Your toolkit. What can you do? Go! 🛠️"]
  },
  reactions: { positive: ["Love it! 💯", "That's awesome! 🔥", "Noted! 👌", "Perfect! ✨", "Got it! 🎯", "Nice one! 💪", "Sweet! ⚡"], funny: ["Interesting... (in a good way) 😄", "You're making this easy! 🎉", "My database is getting happier. 📊", "Another piece of the puzzle! 🧩", "You're a natural at this! 🌟", "This CV is going to be LIT! 🔥"] },
  help: ["Lost? Just type what I ask for. Or use the buttons below. 🆘", "Not sure? Tell me what you're trying to do. I'm flexible. 🤝", "Stuck? Type /pause to save and come back later. ⏸️", "Feeling overwhelmed? Type /resume to pick up where you left off. 🔄"]
};

function random(arr) { if (!arr || !Array.isArray(arr)) return "Let's continue!"; return arr[Math.floor(Math.random() * arr.length)]; }
function getGreeting(name) { return random(RESPONSES.greetings)(name); }
function getQuestion(type) { return random(RESPONSES.questions[type]); }
function getReaction() { return random([...RESPONSES.reactions.positive, ...RESPONSES.reactions.funny]); }
function getRandomSocialProofMessage() { const random = SOCIAL_PROOF[Math.floor(Math.random() * SOCIAL_PROOF.length)]; return `📢 *What our clients say:*\n\n⭐️⭐️⭐️⭐️⭐️ "${random.text}" - ${random.name}`; }

// ============ YES/NO DETECTION ============
const yesWords = ['yes', 'yeah', 'yep', 'sure', 'ok', 'okay', 'go ahead', 'y', 'definitely', 'absolutely', 'why not'];
const noWords = ['no', 'nope', 'nah', 'not', 'pass', 'n', 'negative', 'skip'];
function isAffirmative(text) { if (!text) return false; return yesWords.some(w => text.toLowerCase().includes(w)); }
function isNegative(text) { if (!text) return false; return noWords.some(w => text.toLowerCase().includes(w)); }

// ============ PRICES & CONFIGURATION ============
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
  if (!session) { await db.saveSession(clientId, 'greeting', null, {}); session = await db.getActiveSession(clientId); }
  if (!session.data) session.data = {};
  if (typeof session.data === 'string') { try { session.data = JSON.parse(session.data); } catch(e) { session.data = {}; } }
  if (!session.data.services) session.data.services = [];
  return session;
}

// ============ PERSISTENT KEYBOARD ============
const mainMenuKeyboard = Markup.keyboard([
  [Markup.button.text("📄 New CV"), Markup.button.text("📝 Editable CV")],
  [Markup.button.text("💌 Cover Letter"), Markup.button.text("✏️ Update CV")],
  [Markup.button.text("ℹ️ About"), Markup.button.text("📞 Contact"), Markup.button.text("🏠 Portal")]
]).resize().persistent();

// ============ CORE HANDLERS ============
async function handleGreeting(ctx, client, session) {
  const name = ctx.from.first_name;
  await ctx.reply(`${getGreeting(name)}\n\n💡 *Quick commands:*\n/start - Begin\n/resume - Continue\n/pause - Save\n/portal - Dashboard\n/pay - Payment\n/versions - CV history\n/referral - Share & earn\n\n${getRandomSocialProofMessage()}\n\nUse the buttons below:`, { parse_mode: 'Markdown', ...mainMenuKeyboard });
  await db.updateSession(session.id, 'main_menu', null, session.data);
}

async function handleMainMenu(ctx, client, session, text) {
  if (text === '📄 New CV') session.data.service = 'new cv';
  else if (text === '📝 Editable CV') session.data.service = 'editable cv';
  else if (text === '💌 Cover Letter') { await handleCoverLetterStart(ctx, client, session); return; }
  else if (text === '✏️ Update CV') session.data.service = 'cv update';
  else if (text === 'ℹ️ About') { await ctx.reply(`📄 *EasySuccor - Professional CVs*\n\nContact: +265 991 295 401\n\n${getRandomSocialProofMessage()}`, { parse_mode: 'Markdown' }); return; }
  else if (text === '📞 Contact') { await ctx.reply(`📞 *Contact*\nAirtel: 0991295401\nMpamba: 0886928639\nVisa: 1005653618 (NBM)\nWhatsApp: +265 881 193 707`, { parse_mode: 'Markdown' }); return; }
  else if (text === '🏠 Portal') { await showClientPortal(ctx, client); return; }
  else { await ctx.reply(random(RESPONSES.help), mainMenuKeyboard); return; }

  await ctx.reply(`Alright! ${random(RESPONSES.encouragements.start)}\n\nNow, which category fits you best?`, {
    reply_markup: { inline_keyboard: [[{ text: "🎓 Student", callback_data: "cat_student" }], [{ text: "📜 Recent Graduate", callback_data: "cat_recent" }], [{ text: "💼 Professional", callback_data: "cat_professional" }], [{ text: "🌱 Non-Working", callback_data: "cat_nonworking" }], [{ text: "🔄 Returning Client", callback_data: "cat_returning" }]] }
  });
  await db.updateSession(session.id, 'selecting_category', null, session.data);
}

async function handleCategorySelection(ctx, client, session, data) {
  if (!session.data) session.data = {};
  const categoryMap = { cat_student: 'student', cat_recent: 'recentgraduate', cat_professional: 'professional', cat_nonworking: 'nonworkingprofessional', cat_returning: 'returningclient' };
  session.data.category = categoryMap[data];
  if (!session.data.services) session.data.services = [];

  if (session.data.category === 'returningclient') {
    await ctx.reply(`🎉 Welcome back! ${getReaction()}\n\nSince you already have a CV with us, here's what you can do:`, {
      reply_markup: { inline_keyboard: [[{ text: "✏️ Update CV", callback_data: "service_update" }], [{ text: "📝 Editable CV (Word)", callback_data: "service_editable" }], [{ text: "💌 Cover Letter", callback_data: "service_cover" }], [{ text: "📎 Editable Cover Letter", callback_data: "service_editable_cover" }], [{ text: "✅ I'm done", callback_data: "services_done" }]] }
    });
  } else {
    await ctx.reply(`Got it! ${getReaction()}\n\nWhat service do you need?`, {
      reply_markup: { inline_keyboard: [[{ text: "📄 New CV", callback_data: "service_new" }], [{ text: "📝 Editable CV", callback_data: "service_editable" }], [{ text: "💌 Cover Letter", callback_data: "service_cover" }], [{ text: "📎 Editable Cover Letter", callback_data: "service_editable_cover" }], [{ text: "✅ I'm done selecting", callback_data: "services_done" }]] }
    });
  }
  await db.updateSession(session.id, 'selecting_services', null, session.data);
}

async function handleServiceSelection(ctx, client, session, data) {
  if (!session.data) session.data = {};
  if (!session.data.services) session.data.services = [];
  const serviceMap = { service_new: 'new cv', service_editable: 'editable cv', service_cover: 'cover letter', service_editable_cover: 'editable cover letter', service_update: 'cv update' };
  const selectedService = serviceMap[data];
  
  if (selectedService === 'cv update') {
    const updateSections = ['Personal Information', 'Contact Details', 'Professional Summary', 'Work Experience', 'Education', 'Skills', 'Certifications', 'Languages', 'Referees', 'Awards', 'Volunteer Experience', 'Leadership Roles'];
    const shuffled = [...updateSections];
    for (let i = shuffled.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]; }
    const selectedSections = shuffled.slice(0, Math.floor(Math.random() * 3) + 3);
    session.data.update_sections = selectedSections;
    session.data.current_update_section = 0;
    session.data.service = 'cv update';
    await ctx.reply(`✏️ *CV Update Mode*\n\n${getReaction()}\n\nI'll help you update:\n${selectedSections.map((s, i) => `${i + 1}. ${s}`).join('\n')}\n\nLet's start with: *${selectedSections[0]}*\n\nPlease provide the updated information:`);
    session.data.collection_step = selectedSections[0];
    await db.updateSession(session.id, 'collecting_update', 'update', session.data);
    return;
  }
  
  if (!session.data.services.includes(selectedService)) { session.data.services.push(selectedService); await ctx.reply(`✓ Added ${selectedService}. ${getReaction()}`); }
  else { await ctx.reply(`You already added ${selectedService}. Want something else?`); }
  
  if (session.data.services.length > 0) {
    await ctx.reply(`Current: ${session.data.services.join(', ')}\n\nAdd another or click "I'm done" when ready.`, {
      reply_markup: { inline_keyboard: [[{ text: "📄 New CV", callback_data: "service_new" }], [{ text: "📝 Editable CV", callback_data: "service_editable" }], [{ text: "💌 Cover Letter", callback_data: "service_cover" }], [{ text: "📎 Editable Cover Letter", callback_data: "service_editable_cover" }], [{ text: "✅ I'm done", callback_data: "services_done" }]] }
    });
  }
  await db.updateSession(session.id, 'selecting_services', null, session.data);
}

async function handleServicesDone(ctx, client, session) {
  if (!session.data) session.data = {};
  if (!session.data.services) session.data.services = [];
  if (session.data.services.length === 0) {
    if (session.data.service === 'cv update') return;
    await ctx.reply(`You didn't select any service! Let's try again. 😅`);
    if (session.data.category === 'returningclient') {
      await ctx.reply(`What would you like to do?`, { reply_markup: { inline_keyboard: [[{ text: "✏️ Update CV", callback_data: "service_update" }], [{ text: "📝 Editable CV", callback_data: "service_editable" }], [{ text: "💌 Cover Letter", callback_data: "service_cover" }], [{ text: "📎 Editable Cover Letter", callback_data: "service_editable_cover" }]] } });
    } else {
      await ctx.reply(`Which category fits you best?`, { reply_markup: { inline_keyboard: [[{ text: "🎓 Student", callback_data: "cat_student" }], [{ text: "📜 Recent Graduate", callback_data: "cat_recent" }], [{ text: "💼 Professional", callback_data: "cat_professional" }], [{ text: "🌱 Non-Working", callback_data: "cat_nonworking" }], [{ text: "🔄 Returning Client", callback_data: "cat_returning" }]] } });
    }
    await db.updateSession(session.id, 'selecting_category', null, session.data);
    return;
  }
  
  session.data.service = session.data.services[0];
  const basePrice = getBasePrice(session.data.category, session.data.service);
  session.data.base_price = basePrice;
  
  await portfolioCollector.askForPortfolio(ctx);
  await db.updateSession(session.id, 'collecting_portfolio', 'portfolio', session.data);
}

async function handlePortfolioCollection(ctx, client, session, text) {
  session.data.portfolio_links = portfolioCollector.parsePortfolioLinks(text);
  await ctx.reply(`${getReaction()} ${session.data.portfolio_links.length > 0 ? 'Portfolio links saved!' : 'No portfolio added.'}\n\nHow fast do you need this? ⚡`, {
    reply_markup: { inline_keyboard: [[{ text: "🚚 Standard (6h)", callback_data: "delivery_standard" }], [{ text: "⚡ Express (2h) +3k", callback_data: "delivery_express" }], [{ text: "🏃 Rush (1h) +5k", callback_data: "delivery_rush" }]] }
  });
  await db.updateSession(session.id, 'selecting_delivery', null, session.data);
}

async function handleDeliverySelection(ctx, client, session, data) {
  const delivery = { delivery_standard: 'standard', delivery_express: 'express', delivery_rush: 'rush' }[data];
  session.data.delivery_option = delivery;
  session.data.delivery_time = DELIVERY_TIMES[delivery];
  const totalAmount = calculateTotal(session.data.category, session.data.service, delivery);
  session.data.total_charge = formatPrice(totalAmount);
  
  const paymentOptions = await payment.HybridPayment.getPaymentOptions(
    session.data.total_charge, 
    session.data.order_id || `ORD_${Date.now()}`, 
    client.id,
    client.first_name,
    client.phone || 'Not provided'
  );
  session.data.payment_reference = paymentOptions.reference;
  
  await ctx.reply(paymentOptions.message, {
    reply_markup: { inline_keyboard: [
      [{ text: "1️⃣ Mobile Money with Reference", callback_data: "pay_option_1" }],
      [{ text: "2️⃣ USSD Quick Pay", callback_data: "pay_option_2" }],
      [{ text: "3️⃣ Pay Later", callback_data: "pay_option_3" }],
      [{ text: "4️⃣ Installments (2 parts)", callback_data: "pay_option_4" }]
    ] }
  });
  await db.updateSession(session.id, 'awaiting_payment_choice', 'payment', session.data);
}

async function initiatePaymentFlow(ctx, client, session, choice) {
  const result = await payment.HybridPayment.handlePaymentChoice(
    choice, 
    session.data.total_charge, 
    session.data.order_id || `ORD_${Date.now()}`, 
    client.id, 
    client.first_name, 
    client.phone || 'Not provided', 
    ctx
  );
  session.data.payment_reference = result.reference;
  await db.updateSession(session.id, 'awaiting_payment_confirmation', 'payment', session.data);
  await ctx.reply(result.message, { 
    reply_markup: { inline_keyboard: [
      [{ text: "✅ I've sent payment", callback_data: `confirm_pay_${result.reference}` }],
      [{ text: "❌ Cancel", callback_data: "pay_cancel" }]
    ] 
  } });
}

async function startDataCollection(ctx, client, session) {
  session.data.cv_data = { 
    personal: {}, professional_summary: '', education: [], employment: [], skills: [], 
    certifications: [], languages: [], referees: [], awards: [], volunteer: [], leadership: [], 
    publications: [], conferences: [], portfolio: session.data.portfolio_links || [] 
  };
  session.current_section = 'personal';
  session.data.collection_step = 'name';
  await ctx.reply(getQuestion('name'));
  await db.updateSession(session.id, 'collecting_personal', 'personal', session.data);
}

async function finalizeOrder(ctx, client, session) {
  const orderId = `ORD_${Date.now()}_${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
  const personal = session.data.cv_data.personal;
  const name = personal.full_name || ctx.from.first_name;
  await db.updateClient(client.id, { phone: personal.primary_phone, email: personal.email, location: personal.location });
  
  await cvVersioning.saveVersion(orderId, session.data.cv_data, 1, 'Initial CV creation');
  const cvResult = await documentGenerator.generateCV(session.data.cv_data, null, 'docx', session.data.vacancy_data || null, session.data.certificates_data || null);
  let appendixPath = null;
  if (session.data.certificates_data?.length > 0) { 
    const appendix = await documentGenerator.generateCertificatesAppendix(session.data.certificates_data, personal.full_name); 
    if (appendix.success) appendixPath = appendix.filePath; 
  }
  
  await db.createOrder({ 
    id: orderId, client_id: client.id, service: session.data.service, category: session.data.category,
    delivery_option: session.data.delivery_option, delivery_time: session.data.delivery_time,
    base_price: session.data.base_price, delivery_fee: DELIVERY_PRICES[session.data.delivery_option],
    total_charge: session.data.total_charge, payment_status: session.data.payment_status || 'pending',
    cv_data: session.data.cv_data, certificates_appendix: appendixPath, 
    portfolio_links: JSON.stringify(session.data.portfolio_links || []) 
  });
  session.data.order_id = orderId;

  await ctx.reply(`${random(RESPONSES.encouragements.final)(name)}\n\n📋 Order: \`${orderId}\`\n🚚 Delivery: ${session.data.delivery_time}\n💰 Total: ${session.data.total_charge}\n\nType /pay to complete payment.\n\n${getRandomSocialProofMessage()}`);
  await db.updateSession(session.id, 'awaiting_payment_choice', 'payment', session.data);
}

async function continueAfterPayment(ctx, client, session) {
  if (!session.data.cv_data?.personal?.full_name) await startDataCollection(ctx, client, session);
  else await finalizeOrder(ctx, client, session);
}

// ============ CLIENT PORTAL ============
async function showClientPortal(ctx, client) {
  const orders = await db.getClientOrders(client.id);
  const lastOrder = orders[0];
  const versions = lastOrder ? await cvVersioning.getVersions(lastOrder.id) : [];
  const refInfo = await db.getReferralInfo(client.id);
  
  let message = `🏠 *YOUR EASYSUCCOR PORTAL*\n\n👤 ${client.first_name} ${client.last_name || ''}\n📞 ${client.phone || 'Not set'}\n📧 ${client.email || 'Not set'}\n📦 Total orders: ${client.total_orders || 0}\n💰 Total spent: MK${(client.total_spent || 0).toLocaleString()}\n\n🎁 *Referral:* \`${refInfo.referral_code}\` | Friends: ${refInfo.total_referrals} | Credit: MK${refInfo.pending_reward}\n\n📄 *Recent Documents:*\n`;
  if (orders.length > 0) { message += orders.slice(0, 3).map((o, i) => `${i + 1}. ${o.service} - ${new Date(o.created_at).toLocaleDateString()} - ${o.status}`).join('\n'); }
  else { message += `No documents yet.`; }
  if (versions && versions.length > 0) { message += `\n\n${cvVersioning.formatVersionHistory(versions)}`; }
  message += `\n\n⚙️ *Commands:*\n/mydocs - View all documents\n/referral - Share & earn\n/versions - CV history\n/start - New CV`;
  await ctx.reply(message, { parse_mode: 'Markdown' });
}

// ============ UPDATE COLLECTION ============
async function handleUpdateCollection(ctx, client, session, text) {
  const sections = session.data.update_sections;
  const currentIndex = session.data.current_update_section || 0;
  const currentSection = sections[currentIndex];
  if (!session.data.updates) session.data.updates = {};
  session.data.updates[currentSection] = text;
  const nextIndex = currentIndex + 1;
  if (nextIndex < sections.length) {
    session.data.current_update_section = nextIndex;
    await ctx.reply(`✓ Updated ${currentSection.toLowerCase()}.\n\nNow for: *${sections[nextIndex]}*\n\nPlease provide the updated information:`);
    await db.updateSession(session.id, 'collecting_update', 'update', session.data);
  } else {
    await ctx.reply(`✅ *All updates collected!* ${getReaction()}\n\nHere's what you updated:\n${sections.map(s => `• ${s}: ${session.data.updates[s]}`).join('\n')}\n\nWould you like to review or submit?`, {
      reply_markup: { inline_keyboard: [[{ text: "✅ Submit Update", callback_data: "submit_update" }], [{ text: "✏️ Edit Something", callback_data: "edit_update" }]] }
    });
    await db.updateSession(session.id, 'update_review', 'update', session.data);
  }
}

async function handleUpdateSubmit(ctx, client, session) {
  const orderId = `UPD_${Date.now()}_${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
  await db.createOrder({ 
    id: orderId, client_id: client.id, service: 'cv update', category: session.data.category,
    delivery_option: session.data.delivery_option || 'standard', delivery_time: session.data.delivery_time || '6 hours',
    base_price: getBasePrice(session.data.category, 'cv update'), delivery_fee: 0,
    total_charge: formatPrice(getBasePrice(session.data.category, 'cv update')), 
    payment_status: session.data.payment_status || 'pending',
    cv_data: { updates: session.data.updates, original_cv: session.data.cv_data } 
  });
  await cvVersioning.saveVersion(orderId, { updates: session.data.updates }, 1, 'CV update request');
  await ctx.reply(`🎉 *Update Request Submitted!*\n\nOrder: \`${orderId}\`\nSections updated: ${session.data.update_sections.length}\n\nType /pay to complete payment.\n\n${getRandomSocialProofMessage()}`);
  await db.updateSession(session.id, 'awaiting_payment_choice', 'payment', session.data);
}

// ============ COLLECTION HANDLERS ============
async function handlePersonalCollection(ctx, client, session, text) {
  const step = session.data.collection_step;
  const personal = session.data.cv_data.personal;
  if (step === 'name') { personal.full_name = text; session.data.collection_step = 'email'; await ctx.reply(getQuestion('email')); }
  else if (step === 'email') { personal.email = text; session.data.collection_step = 'phone'; await ctx.reply(getQuestion('phone')); }
  else if (step === 'phone') { personal.primary_phone = text; session.data.collection_step = 'alt_phone'; await ctx.reply("Alternative phone? (or 'Skip') 📞"); }
  else if (step === 'alt_phone') { personal.alternative_phone = text === 'Skip' ? null : text; session.data.collection_step = 'whatsapp'; await ctx.reply("WhatsApp for delivery? (or 'Same') 💬"); }
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

async function handleEducationCollection(ctx, client, session, text) {
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
  else if (step === 'add_more' && isAffirmative(text)) { session.data.collection_step = 'level'; session.data.current_edu = {}; await ctx.reply("Next qualification? 🎓"); }
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

async function handleEmploymentCollection(ctx, client, session, text) {
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
  else if (step === 'add_more' && isAffirmative(text)) { session.data.collection_step = 'title'; session.data.current_job = {}; await ctx.reply("Next job title? 💼"); }
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
  else if (step === 'year') { currentCert.year = text; certifications.push({ ...currentCert }); session.data.current_cert = null; session.data.collection_step = 'add_more';
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
      await ctx.reply(`Got it! ${getReaction()}\n\nProfessional referees? (Minimum 3 required) 👥\n\nReferee 1 - Full name?`);
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
    await ctx.reply(`${random(RESPONSES.encouragements.sectionComplete)('Languages')}\n\nProfessional referees? (Minimum 3 required) 👥\n\nReferee 1 - Full name?`);
    await db.updateSession(session.id, 'collecting_referees', 'referees', session.data);
  }
  await db.updateSession(session.id, 'collecting_languages', 'languages', session.data);
}

async function handleRefereesCollection(ctx, client, session, text, callbackData = null) {
  const step = session.data.collection_step;
  const referees = session.data.cv_data.referees;
  const currentRef = session.data.current_ref || {};
  const refereeCount = referees.length;
  if (step === 'name') {
    if (text === 'Skip') { await ctx.reply(`⚠️ Need at least 3 referees! Referee ${refereeCount + 1} - Full name?`); return; }
    currentRef.name = text; session.data.current_ref = currentRef; session.data.collection_step = 'position'; await ctx.reply(`Referee ${refereeCount + 1} - Their position? 📌`);
  } 
  else if (step === 'position') { currentRef.position = text; session.data.collection_step = 'contact'; await ctx.reply(`Referee ${refereeCount + 1} - Contact? (phone preferred) 📞`); }
  else if (step === 'contact') {
    currentRef.contact = text; referees.push({ ...currentRef }); session.data.current_ref = null;
    if (referees.length < 3) {
      session.data.collection_step = 'name';
      await ctx.reply(`✅ Referee ${referees.length} added. Need ${3 - referees.length} more.\n\nReferee ${referees.length + 1} - Full name?`);
    } else {
      session.current_section = 'certificates';
      session.data.collection_step = 'certificates';
      session.data.certificates_data = [];
      await ctx.reply(`✅ Referees complete! ${getReaction()}\n\n📜 Upload certificates (PNG, JPG, PDF) or type 'SKIP' to finish.`);
      await db.updateSession(session.id, 'collecting_certificates', 'certificates', session.data);
    }
  }
  await db.updateSession(session.id, 'collecting_referees', 'referees', session.data);
}

async function handleCertificateUpload(ctx, client, session, fileUrl, fileName) {
  const result = await aiAnalyzer.processCertificate(fileUrl, fileName, client.id.toString());
  if (result.success) {
    session.data.certificates_data.push({ fileName, certificateInfo: result.certificateInfo, images: result.images, pageCount: result.originalPageCount });
    await ctx.reply(`✅ Got it! ${result.certificateInfo.name || 'Certificate'} saved. ${getReaction()}\n\nUpload another or type 'DONE' to finish.`);
  } else { await ctx.reply(`Hmm, couldn't process that one. Try again or type 'SKIP'.`); }
  await db.updateSession(session.id, 'collecting_certificates', 'certificates', session.data);
}

async function finalizeCertificateCollection(ctx, client, session) {
  if (session.data.certificates_data?.length > 0) { await ctx.reply(`📦 ${session.data.certificates_data.length} certificate(s) packed! Ready to roll.`); }
  await finalizeOrder(ctx, client, session);
}

async function handleCoverLetterStart(ctx, client, session) {
  await ctx.reply(`📢 Ooh, a cover letter! Smart move.\n\nShare the job vacancy:\n• Screenshot\n• PDF\n• Or paste the text\n\nI'll extract the details. 🕵️`);
  session.data.awaiting_vacancy = true;
  await db.updateSession(session.id, 'awaiting_vacancy_upload', 'vacancy', session.data);
}

async function handleVacancyText(ctx, client, session, text) {
  const vacancyData = aiAnalyzer.extractVacancyDetails(text);
  session.data.vacancy_data = vacancyData;
  session.data.awaiting_vacancy = false;
  await ctx.reply(`🔍 Interesting! Found:\n\n🏢 Company: ${vacancyData.company}\n🎯 Position: ${vacancyData.position}\n📋 ${vacancyData.requirements.length} requirements detected\n\nPosition applying for? (or 'SAME')`);
  await db.updateSession(session.id, 'collecting_coverletter_position', 'coverletter', session.data);
}

async function handleCoverLetterPosition(ctx, client, session, text) {
  session.data.coverletter_position = text.toLowerCase() === 'same' && session.data.vacancy_data?.position ? session.data.vacancy_data.position : text;
  await ctx.reply(`Company name? 🏢`);
  await db.updateSession(session.id, 'collecting_coverletter_company', 'coverletter', session.data);
}

async function handleCoverLetterCompany(ctx, client, session, text) {
  session.data.coverletter_company = text;
  const coverResult = await documentGenerator.generateCoverLetter(
    { position: session.data.coverletter_position, company: session.data.coverletter_company }, 
    session.data.cv_data || {}, 
    session.data.cv_data?.personal,
    session.data.certificates_data?.length > 0
  );
  const orderId = `CL_${Date.now()}_${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
  await db.createOrder({ 
    id: orderId, client_id: client.id, service: 'cover letter', category: session.data.category || 'professional',
    delivery_option: 'standard', delivery_time: '6 hours', base_price: 5000, delivery_fee: 0,
    total_charge: 'MK5,000', payment_status: 'pending', cv_data: { coverletter: session.data } 
  });
  await ctx.reply(`🎉 Cover letter ready!\n\nOrder: \`${orderId}\`\nPosition: ${session.data.coverletter_position}\nCompany: ${session.data.coverletter_company}\nTotal: MK5,000\n\nType /pay when ready. ${getReaction()}`);
  await db.updateSession(session.id, 'awaiting_payment_choice', 'payment', session.data);
}

// ============ BOT COMMANDS ============
bot.command('start', async (ctx) => {
  const client = await getOrCreateClient(ctx);
  const session = await getOrCreateSession(client.id);
  
  const startParam = ctx.startPayload;
  if (startParam && startParam.startsWith('ref_')) {
    const referralCode = startParam.replace('ref_', '');
    const referralTracker = new ReferralTracker(bot);
    const result = await referralTracker.processReferralStart(ctx, referralCode);
    if (result.success) {
      await ctx.reply(result.message);
    } else {
      console.log(`Invalid referral: ${result.error}`);
    }
  }
  
  await handleGreeting(ctx, client, session);
});

bot.command('referral', async (ctx) => {
  const client = await getOrCreateClient(ctx);
  const referralTracker = new ReferralTracker(bot);
  const stats = await referralTracker.getReferralStats(ctx.from.id);
  if (stats) {
    await ctx.reply(referralTracker.formatReferralStats(stats), { parse_mode: 'Markdown' });
  } else {
    await ctx.reply("Error fetching referral stats. Please try again.");
  }
});

bot.command('portal', async (ctx) => { const client = await getOrCreateClient(ctx); await showClientPortal(ctx, client); });
bot.command('mydocs', async (ctx) => { const client = await getOrCreateClient(ctx); const orders = await db.getClientOrders(client.id); let msg = "📄 *YOUR DOCUMENTS*\n\n"; orders.forEach(o => { msg += `📌 ${o.service} - ${o.status}\n   Order: ${o.id}\n   Date: ${new Date(o.created_at).toLocaleDateString()}\n   Total: ${o.total_charge}\n\n`; }); await ctx.reply(msg || "No documents yet.", { parse_mode: 'Markdown' }); });
bot.command('versions', async (ctx) => { const client = await getOrCreateClient(ctx); const orders = await db.getClientOrders(client.id); const lastOrder = orders[0]; if (!lastOrder) { await ctx.reply("No orders found."); return; } const versions = await cvVersioning.getVersions(lastOrder.id); await ctx.reply(cvVersioning.formatVersionHistory(versions), { parse_mode: 'Markdown' }); });
bot.command('revert', async (ctx) => { const args = ctx.message.text.split(' '); if (args.length < 2) { await ctx.reply("Usage: /revert VERSION_NUMBER"); return; } const client = await getOrCreateClient(ctx); const orders = await db.getClientOrders(client.id); const lastOrder = orders[0]; if (!lastOrder) { await ctx.reply("No orders found."); return; } const result = await cvVersioning.revertToVersion(lastOrder.id, parseInt(args[1])); if (result) { await ctx.reply(`✅ Reverted to version ${args[1]}. Your CV has been updated.`); } else { await ctx.reply(`❌ Version ${args[1]} not found.`); } });
bot.command('pay', async (ctx) => { const client = await getOrCreateClient(ctx); const session = await db.getActiveSession(client.id); if (session && session.data.total_charge) { await initiatePaymentFlow(ctx, client, session, '1'); } else { await ctx.reply(`No active order. Type /start to begin. ${getReaction()}`, mainMenuKeyboard); } });
bot.command('pause', async (ctx) => { const client = await getOrCreateClient(ctx); const session = await db.getActiveSession(client.id); if (session && session.stage !== 'main_menu') { session.is_paused = true; await db.updateSession(session.id, session.stage, session.current_section, session.data, 1); await ctx.reply(`⏸️ *Session Paused*\n\nType /resume when ready.`, { parse_mode: 'Markdown' }); } else { await ctx.reply(`No active session to pause.`, mainMenuKeyboard); } });
bot.command('resume', async (ctx) => { const client = await getOrCreateClient(ctx); const pausedSession = await db.getPausedSession(client.id); if (pausedSession) { pausedSession.data = JSON.parse(pausedSession.data); await db.updateSession(pausedSession.id, pausedSession.stage, pausedSession.current_section, pausedSession.data, 0); await ctx.reply(`🔄 Welcome back! Let's continue.`); if (pausedSession.stage === 'collecting_personal') await ctx.reply(getQuestion('name')); else if (pausedSession.stage === 'collecting_education') await ctx.reply("Highest qualification? 🎓"); else if (pausedSession.stage === 'collecting_employment') await ctx.reply(getQuestion('jobTitle')); else if (pausedSession.stage === 'collecting_update') await ctx.reply(`Let's continue with your updates.`); else await ctx.reply(`Ready when you are!`, mainMenuKeyboard); } else { await ctx.reply(`No paused session found. Type /start to begin fresh.`, mainMenuKeyboard); } });
bot.command('confirm', async (ctx) => { const args = ctx.message.text.split(' '); if (args.length < 2) { await ctx.reply("Usage: /confirm REFERENCE"); return; } const reference = args[1]; const result = await payment.confirmPayment(reference, ctx); await ctx.reply(result.message); });
bot.command('verify', async (ctx) => { if (ctx.from.id.toString() !== process.env.ADMIN_CHAT_ID) return await ctx.reply("Unauthorized. 🔒"); const args = ctx.message.text.split(' '); if (args.length < 2) return await ctx.reply("Usage: /verify REFERENCE"); const result = await payment.verifyPayment(args[1], ctx); await ctx.reply(result.success ? `✅ ${result.message}` : `❌ ${result.error}`); });
bot.command('dashboard', async (ctx) => { if (ctx.from.id.toString() !== process.env.ADMIN_CHAT_ID) return await ctx.reply("Unauthorized. 🔒"); const dashboard = require('./admin-dashboard'); const stats = await dashboard.showDashboard(); await ctx.reply(dashboard.formatStats(), { parse_mode: 'Markdown' }); });
bot.help(async (ctx) => { await ctx.reply(`🆘 *Help*\n\n/start - Begin\n/resume - Continue paused\n/pause - Save progress\n/pay - Make payment\n/portal - Your dashboard\n/mydocs - Your documents\n/referral - Share & earn\n/versions - CV history\n\nContact: +265 991 295 401`, { parse_mode: 'Markdown', ...mainMenuKeyboard }); });

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
    await ctx.reply(`📄 Processed! Found ${vacancyData.position || 'position'} at ${vacancyData.company || 'company'}.\n\nApplying for? (or 'SAME')`);
    await db.updateSession(session.id, 'collecting_coverletter_position', 'coverletter', session.data);
  } else if (session.stage === 'collecting_certificates') {
    const fileInfo = await ctx.telegram.getFile(document.file_id);
    const fileUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${fileInfo.file_path}`;
    await handleCertificateUpload(ctx, client, session, fileUrl, fileName);
  } else { await ctx.reply(`Not sure what to do with that. Try /start or /help.`); }
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
  } else if (session.stage === 'collecting_certificates') {
    const fileInfo = await ctx.telegram.getFile(photo.file_id);
    const fileUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${fileInfo.file_path}`;
    await handleCertificateUpload(ctx, client, session, fileUrl, `certificate_${Date.now()}.jpg`);
  } else { await ctx.reply(`Nice photo! But not sure what to do with it. Try /start?`); }
});

// ============ TEXT MESSAGE HANDLER ============
bot.on('text', async (ctx) => {
  const text = ctx.message.text;
  const client = await getOrCreateClient(ctx);
  const session = await getOrCreateSession(client.id);
  if (text === '/start') await handleGreeting(ctx, client, session);
  else if (text === 'DONE' && session.stage === 'collecting_certificates') await finalizeCertificateCollection(ctx, client, session);
  else if (text === 'SKIP' && session.stage === 'collecting_certificates') await finalizeCertificateCollection(ctx, client, session);
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
  else if (session.stage === 'awaiting_vacancy_upload') await handleVacancyText(ctx, client, session, text);
  else if (session.stage === 'collecting_coverletter_position') await handleCoverLetterPosition(ctx, client, session, text);
  else if (session.stage === 'collecting_coverletter_company') await handleCoverLetterCompany(ctx, client, session, text);
  else if (session.stage === 'update_review') {
    if (isAffirmative(text) || text.toLowerCase() === 'submit') await handleUpdateSubmit(ctx, client, session);
    else { session.data.current_update_section = 0; await ctx.reply(`Let's fix that. Starting with: *${session.data.update_sections[0]}*`); await db.updateSession(session.id, 'collecting_update', 'update', session.data); }
  }
  else if (session.stage === 'awaiting_payment_choice') {
    if (text === '1' || text === '2' || text === '3' || text === '4') {
      await initiatePaymentFlow(ctx, client, session, text);
    } else if (text.toLowerCase() === 'pay later') {
      session.data.payment_status = 'pending';
      await db.updateSession(session.id, 'payment_completed', 'payment', session.data);
      await ctx.reply(`⏳ Pay later it is! Let's build your CV. ${getReaction()}`);
      await startDataCollection(ctx, client, session);
    } else { await ctx.reply(`Please select 1, 2, 3, or 4 for payment option.`); }
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
  else if (data.startsWith('service_')) { if (data === 'services_done') await handleServicesDone(ctx, client, session); else await handleServiceSelection(ctx, client, session, data); }
  else if (data.startsWith('delivery_')) await handleDeliverySelection(ctx, client, session, data);
  else if (data === 'pay_option_1' || data === 'pay_option_2' || data === 'pay_option_3' || data === 'pay_option_4') {
    await initiatePaymentFlow(ctx, client, session, data === 'pay_option_1' ? '1' : (data === 'pay_option_2' ? '2' : (data === 'pay_option_3' ? '3' : '4')));
  }
  else if (data === 'pay_later') { session.data.payment_status = 'pending'; await db.updateSession(session.id, 'payment_completed', 'payment', session.data); await ctx.reply(`⏳ Pay later it is! Let's build your CV. ${getReaction()}`); await startDataCollection(ctx, client, session); }
  else if (data === 'pay_cancel') { await ctx.reply(`❌ Cancelled. /start when you're ready.`); await db.updateSession(session.id, 'main_menu', null, session.data); }
  else if (data.startsWith('confirm_pay_')) { const reference = data.replace('confirm_pay_', ''); const result = await payment.confirmPayment(reference, ctx); await ctx.reply(result.message); }
  else if (data === 'edu_yes' || data === 'edu_no') await handleEducationCollection(ctx, client, session, data === 'edu_yes' ? 'Yes' : 'No');
  else if (data === 'emp_yes' || data === 'emp_no') await handleEmploymentCollection(ctx, client, session, data === 'emp_yes' ? 'Yes' : 'No');
  else if (data === 'cert_yes' || data === 'cert_no' || data === 'cert_skip') { if (data === 'cert_skip') await handleCertificationsCollection(ctx, client, session, 'Skip', data); else await handleCertificationsCollection(ctx, client, session, data === 'cert_yes' ? 'Yes' : 'No', data); }
  else if (data === 'lang_yes' || data === 'lang_no' || data === 'lang_skip') { if (data === 'lang_skip') await handleLanguagesCollection(ctx, client, session, 'Skip', data); else await handleLanguagesCollection(ctx, client, session, data === 'lang_yes' ? 'Yes' : 'No', data); }
  else if (data.startsWith('prof_')) await handleLanguagesCollection(ctx, client, session, '', data);
  else if (data === 'submit_update') await handleUpdateSubmit(ctx, client, session);
  else if (data === 'edit_update') { session.data.current_update_section = 0; await ctx.reply(`Let's fix that. Starting with: *${session.data.update_sections[0]}*`); await db.updateSession(session.id, 'collecting_update', 'update', session.data); }
});

// ============ SET COMMANDS AND START ============
async function setCommands() {
  await bot.telegram.setMyCommands([
    { command: 'start', description: '🚀 Start the bot' },
    { command: 'resume', description: '🔄 Resume paused session' },
    { command: 'pause', description: '⏸️ Save progress and pause' },
    { command: 'pay', description: '💰 Make a payment' },
    { command: 'portal', description: '🏠 Your dashboard' },
    { command: 'mydocs', description: '📄 Your documents' },
    { command: 'referral', description: '🎁 Share & earn' },
    { command: 'versions', description: '📁 CV history' },
    { command: 'help', description: '🆘 Get help' }
  ]);
}

async function startBot() {
  await db.initDatabase();
  await setCommands();
  bot.launch();
  console.log('========================================');
  console.log('  🤖 EasySuccor Bot Running');
  console.log('  ✅ CV Versioning System');
  console.log('  ✅ Portfolio Collection');
  console.log('  ✅ Social Proof Integration');
  console.log('  ✅ Hybrid Payment Options (USSD, Reference, Pay Later, Installments)');
  console.log('  ✅ Client Portal');
  console.log('  ✅ Pre-filled Forms (via returning client detection)');
  console.log('  ✅ Payment Reminders (via cron in admin-dashboard.js)');
  console.log('  ✅ Admin Dashboard');
  console.log('  ✅ Dynamic Responses');
  console.log('  ✅ Referral Program');
  console.log('========================================');
}

startBot();
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

module.exports = bot;