// admin-dashboard.js - Enterprise Success Metrics Dashboard (UPDATED)
const db = require('./database');
const cron = require('node-cron');

// Mobile-friendly separator
const SEP = '\n┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅\n';

class AdminDashboard {
  constructor(bot) {
    this.bot = bot;
    this.stats = {};
    this.cache = new Map();
    this.cacheTimeout = 5 * 60 * 1000; // 5 minutes
    this.startAutoRefresh();
  }

  startAutoRefresh() {
    cron.schedule('*/15 * * * *', async () => {
      await this.refreshStats();
    });
    
    cron.schedule('0 21 * * *', async () => {
      await this.sendDailySummary();
    });
    
    cron.schedule('0 8 * * 1', async () => {
      await this.sendWeeklyReport();
    });
    
    cron.schedule('0 9 1 * *', async () => {
      await this.sendMonthlyReport();
    });
  }

  async refreshStats() {
    const startTime = Date.now();
    
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    const firstDayOfWeek = new Date(now.setDate(now.getDate() - now.getDay())).toISOString().split('T')[0];
    const thirtyDaysAgo = new Date(now.setDate(now.getDate() - 30)).toISOString().split('T')[0];
    
    const [
      allOrders, allClients, allFeedback, testimonials,
      pendingPayments, weeklyOrders, monthlyOrders, yearlyOrders,
      allCVOrders, allCoverOrders, allUpdateOrders,
      installmentPlans, payLaterPlans, errorReports
    ] = await Promise.all([
      db.getAllOrders(),
      db.getAllClients(),
      db.getAllFeedback(),
      db.getAllTestimonials(),
      db.getPendingPaymentOrders(),
      db.getOrdersByDateRange(firstDayOfWeek, today),
      db.getOrdersByDateRange(firstDayOfMonth, today),
      db.getOrdersByYear(now.getFullYear()),
      db.getOrdersByService('new cv', 'editable cv', 'legacy_cv'),
      db.getOrdersByService('cover letter', 'editable cover letter', 'legacy_cover_letter'),
      db.getOrdersByService('cv update'),
      db.getAllInstallmentPlans(),
      db.getAllPayLaterPlans(),
      db.getErrorReports ? db.getErrorReports(null, 1000) : []
    ]);
    
    const todayOrders = allOrders.filter(o => o.created_at.split('T')[0] === today);
    const todayRevenue = this.calculateRevenue(todayOrders);
    
    const weeklyRevenue = this.calculateRevenue(weeklyOrders);
    const weeklyCompleted = weeklyOrders.filter(o => o.status === 'delivered').length;
    
    const monthlyRevenue = this.calculateRevenue(monthlyOrders);
    const monthlyNewClients = allClients.filter(c => c.created_at >= firstDayOfMonth).length;
    const monthlyReturning = allClients.filter(c => c.total_orders > 1 && c.created_at < firstDayOfMonth).length;
    
    const yearlyRevenue = this.calculateRevenue(yearlyOrders);
    const yearlyOrdersCount = yearlyOrders.length;
    
    let totalSkills = 0;
    let totalProjects = 0;
    let totalAchievements = 0;
    let totalVolunteer = 0;
    let totalLeadership = 0;
    let totalCertifications = 0;
    let totalLanguages = 0;
    let totalReferees = 0;
    let totalAwards = 0;
    let totalPublications = 0;
    let totalConferences = 0;
    let totalInterests = 0;
    
    for (const order of allCVOrders) {
      const cvData = order.cv_data || {};
      totalSkills += (cvData.skills?.technical?.length || 0) + (cvData.skills?.soft?.length || 0) + (cvData.skills?.tools?.length || 0);
      totalProjects += cvData.projects?.length || 0;
      totalAchievements += cvData.achievements?.length || 0;
      totalVolunteer += cvData.volunteer?.length || 0;
      totalLeadership += cvData.leadership?.length || 0;
      totalCertifications += cvData.certifications?.length || 0;
      totalLanguages += cvData.languages?.length || 0;
      totalReferees += cvData.referees?.length || 0;
      totalAwards += cvData.awards?.length || 0;
      totalPublications += cvData.publications?.length || 0;
      totalConferences += cvData.conferences?.length || 0;
      totalInterests += cvData.interests?.length || 0;
    }
    
    const avgSkillsPerCV = allCVOrders.length > 0 ? Math.round(totalSkills / allCVOrders.length) : 0;
    const avgProjectsPerCV = allCVOrders.length > 0 ? Math.round(totalProjects / allCVOrders.length) : 0;
    
    const recentFeedback = allFeedback.filter(f => f.created_at >= thirtyDaysAgo);
    const avgRating = recentFeedback.length > 0 
      ? recentFeedback.reduce((sum, f) => sum + (f.rating || 0), 0) / recentFeedback.length 
      : 0;
    
    const ratingDistribution = {
      5: recentFeedback.filter(f => f.rating === 5).length,
      4: recentFeedback.filter(f => f.rating === 4).length,
      3: recentFeedback.filter(f => f.rating === 3).length,
      2: recentFeedback.filter(f => f.rating === 2).length,
      1: recentFeedback.filter(f => f.rating === 1).length
    };
    
    const serviceCount = {};
    const serviceRevenue = {};
    for (const order of allOrders) {
      serviceCount[order.service] = (serviceCount[order.service] || 0) + 1;
      const amount = parseInt(order.total_charge?.replace('MK', '').replace(',', '') || 0);
      serviceRevenue[order.service] = (serviceRevenue[order.service] || 0) + amount;
    }
    const mostRequested = Object.entries(serviceCount).sort((a, b) => b[1] - a[1])[0];
    const highestRevenue = Object.entries(serviceRevenue).sort((a, b) => b[1] - a[1])[0];
    
    const paymentMethodCount = {};
    for (const order of allOrders) {
      const method = order.payment_method || 'unknown';
      paymentMethodCount[method] = (paymentMethodCount[method] || 0) + 1;
    }
    
    const activeInstallments = installmentPlans.filter(p => p.status === 'active' || p.status === 'first_paid').length;
    const completedInstallments = installmentPlans.filter(p => p.status === 'completed').length;
    const totalInstallmentAmount = installmentPlans.reduce((sum, p) => sum + (p.total_amount || 0), 0);
    const collectedInstallmentAmount = installmentPlans.reduce((sum, p) => sum + (p.paid_amount || 0), 0);
    
    const activePayLater = payLaterPlans.filter(p => p.status === 'pending').length;
    const completedPayLater = payLaterPlans.filter(p => p.status === 'completed').length;
    const overduePayLater = payLaterPlans.filter(p => p.status === 'pending' && new Date(p.due_date) < new Date()).length;
    const totalPayLaterAmount = payLaterPlans.reduce((sum, p) => sum + (p.amount || 0), 0);
    
    const totalErrorReports = errorReports.length;
    const pendingErrorReports = errorReports.filter(r => r.status === 'pending').length;
    const resolvedErrorReports = errorReports.filter(r => r.status === 'resolved').length;
    const errorReportsToday = errorReports.filter(r => r.created_at?.split('T')[0] === today).length;
    const errorReportsThisWeek = errorReports.filter(r => r.created_at >= firstDayOfWeek).length;
    const errorReportsThisMonth = errorReports.filter(r => r.created_at >= firstDayOfMonth).length;
    
    let totalResolutionHours = 0;
    let resolvedWithTime = 0;
    for (const report of errorReports.filter(r => r.status === 'resolved' && r.resolved_at)) {
      const created = new Date(report.created_at);
      const resolved = new Date(report.resolved_at);
      totalResolutionHours += (resolved - created) / (1000 * 60 * 60);
      resolvedWithTime++;
    }
    const avgResolutionHours = resolvedWithTime > 0 ? Math.round(totalResolutionHours / resolvedWithTime) : 0;
    
    const recentPendingReports = errorReports
      .filter(r => r.status === 'pending')
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 5);
    
    const totalClients = allClients.length;
    const activeClients = allClients.filter(c => {
      const lastOrder = allOrders.find(o => o.client_id === c.id);
      return lastOrder && new Date(lastOrder.created_at) > new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    }).length;
    const retentionRate = totalClients > 0 ? (activeClients / totalClients) * 100 : 0;
    
    const ordersCompleted = allOrders.filter(o => o.payment_status === 'completed').length;
    const ordersPending = allOrders.filter(o => o.payment_status === 'pending').length;
    const conversionRate = allOrders.length > 0 ? (ordersCompleted / allOrders.length) * 100 : 0;
    
    const approvedTestimonials = testimonials.filter(t => t.approved).length;
    const pendingTestimonials = testimonials.filter(t => !t.approved).length;
    const avgTestimonialRating = testimonials.length > 0 
      ? testimonials.reduce((sum, t) => sum + (t.rating || 0), 0) / testimonials.length 
      : 0;
    
    const dailyRevenue = {};
    const last30Days = new Date();
    last30Days.setDate(last30Days.getDate() - 30);
    for (const order of allOrders) {
      const orderDate = new Date(order.created_at);
      if (orderDate >= last30Days && order.payment_status === 'completed') {
        const dateKey = orderDate.toISOString().split('T')[0];
        const amount = parseInt(order.total_charge?.replace('MK', '').replace(',', '') || 0);
        dailyRevenue[dateKey] = (dailyRevenue[dateKey] || 0) + amount;
      }
    }
    
    this.stats = {
      timestamp: new Date().toISOString(),
      generation_time: Date.now() - startTime,
      
      today: {
        orders: todayOrders.length,
        completed: todayOrders.filter(o => o.status === 'delivered').length,
        pending: todayOrders.filter(o => o.status === 'pending').length,
        revenue: todayRevenue,
        avg_order_value: todayOrders.length > 0 ? todayRevenue / todayOrders.length : 0
      },
      
      week: {
        orders: weeklyOrders.length,
        completed: weeklyCompleted,
        revenue: weeklyRevenue,
        growth: this.calculateGrowth(weeklyRevenue, monthlyRevenue / 4)
      },
      
      month: {
        orders: monthlyOrders.length,
        new_clients: monthlyNewClients,
        returning_clients: monthlyReturning,
        revenue: monthlyRevenue,
        avg_rating: avgRating.toFixed(1),
        rating_distribution: ratingDistribution,
        most_requested: mostRequested ? mostRequested[0] : 'None',
        most_requested_count: mostRequested ? mostRequested[1] : 0,
        highest_revenue_service: highestRevenue ? highestRevenue[0] : 'None'
      },
      
      year: {
        orders: yearlyOrdersCount,
        revenue: yearlyRevenue,
        projected_annual: yearlyRevenue * (12 / (new Date().getMonth() + 1))
      },
      
      cv_analytics: {
        total_cvs: allCVOrders.length,
        total_skills: totalSkills,
        avg_skills_per_cv: avgSkillsPerCV,
        total_projects: totalProjects,
        avg_projects_per_cv: avgProjectsPerCV,
        total_achievements: totalAchievements,
        total_volunteer: totalVolunteer,
        total_leadership: totalLeadership,
        total_certifications: totalCertifications,
        total_languages: totalLanguages,
        total_referees: totalReferees,
        total_awards: totalAwards,
        total_publications: totalPublications,
        total_conferences: totalConferences,
        total_interests: totalInterests
      },
      
      cover_letter_analytics: {
        total_cover_letters: allCoverOrders.length,
        with_vacancy: allCoverOrders.filter(o => o.cv_data?.vacancy || o.cv_data?.vacancy_data).length
      },
      
      payment_analytics: {
        method_distribution: paymentMethodCount,
        installments: {
          active: activeInstallments,
          completed: completedInstallments,
          total_amount: totalInstallmentAmount,
          collected_amount: collectedInstallmentAmount,
          completion_rate: installmentPlans.length > 0 ? (completedInstallments / installmentPlans.length) * 100 : 0
        },
        pay_later: {
          active: activePayLater,
          completed: completedPayLater,
          overdue: overduePayLater,
          total_amount: totalPayLaterAmount,
          overdue_rate: activePayLater > 0 ? (overduePayLater / activePayLater) * 100 : 0
        }
      },
      
      error_analytics: {
        total_reports: totalErrorReports,
        pending: pendingErrorReports,
        resolved: resolvedErrorReports,
        resolution_rate: totalErrorReports > 0 ? ((resolvedErrorReports / totalErrorReports) * 100).toFixed(1) : 0,
        avg_resolution_hours: avgResolutionHours,
        today: errorReportsToday,
        this_week: errorReportsThisWeek,
        this_month: errorReportsThisMonth,
        recent_pending: recentPendingReports.map(r => ({
          id: r.id,
          description: r.description?.slice(0, 50) + (r.description?.length > 50 ? '...' : ''),
          created_at: r.created_at,
          client_id: r.client_id
        }))
      },
      
      clients: {
        total: totalClients,
        active: activeClients,
        retention_rate: retentionRate.toFixed(1),
        conversion_rate: conversionRate.toFixed(1),
        pending_payments: pendingPayments.length,
        returning_rate: totalClients > 0 ? (monthlyReturning / totalClients) * 100 : 0
      },
      
      testimonials: {
        approved: approvedTestimonials,
        pending: pendingTestimonials,
        total: testimonials.length,
        average_rating: avgTestimonialRating.toFixed(1)
      },
      
      revenue_trend: {
        daily_30d: dailyRevenue,
        service_breakdown: serviceRevenue
      }
    };
    
    this.cache.set('stats', this.stats);
    return this.stats;
  }

  calculateRevenue(orders) {
    return orders.reduce((sum, o) => {
      const amount = parseInt(String(o.total_charge).replace(/[^0-9]/g, '') || 0);
      return sum + amount;
    }, 0);
  }

  calculateGrowth(current, previous) {
    if (previous === 0) return current > 0 ? 100 : 0;
    return ((current - previous) / previous) * 100;
  }

  formatStats() {
    const s = this.stats;
    if (!s.today) return 'Stats not available. Run refreshStats() first.';
    
    return `
╔══════════════════════════════════════════════════════════════════════════════════════════╗
║                              📊 EASYSUCCOR EXECUTIVE DASHBOARD                           ║
╠══════════════════════════════════════════════════════════════════════════════════════════╣
║                                                                                          ║
║  📅 TODAY'S PERFORMANCE                                                                 ║
║  ─────────────────────────────────────────────────────────────────────────────────────── ║
║  • Orders received:     ${s.today.orders.toString().padStart(10)}                                                    ║
║  • Completed:           ${s.today.completed.toString().padStart(10)}                                                    ║
║  • Pending:             ${s.today.pending.toString().padStart(10)}                                                    ║
║  • Revenue:             MK${s.today.revenue.toLocaleString().padStart(12)}                                             ║
║  • Avg order value:     MK${Math.round(s.today.avg_order_value).toLocaleString().padStart(12)}                                             ║
║                                                                                          ║
║  📈 WEEKLY METRICS                                                                       ║
║  ─────────────────────────────────────────────────────────────────────────────────────── ║
║  • Orders:              ${s.week.orders.toString().padStart(10)}                                                    ║
║  • Completed:           ${s.week.completed.toString().padStart(10)}                                                    ║
║  • Revenue:             MK${s.week.revenue.toLocaleString().padStart(12)}                                             ║
║  • Growth:              ${s.week.growth.toFixed(1).padStart(10)}%                                                   ║
║                                                                                          ║
║  📆 MONTHLY SNAPSHOT                                                                     ║
║  ─────────────────────────────────────────────────────────────────────────────────────── ║
║  • New clients:         ${s.month.new_clients.toString().padStart(10)}                                                    ║
║  • Returning:           ${s.month.returning_clients.toString().padStart(10)}                                                    ║
║  • Revenue:             MK${s.month.revenue.toLocaleString().padStart(12)}                                             ║
║  • Avg rating:          ${s.month.avg_rating.toString().padStart(10)} ★                                              ║
║  • Most requested:      ${(s.month.most_requested || 'None').padEnd(25)} (${s.month.most_requested_count || 0})                     ║
║  • Top revenue service: ${(s.month.highest_revenue_service || 'None').padEnd(25)}                                               ║
║                                                                                          ║
║  📊 CV ANALYTICS (18+ Categories)                                                        ║
║  ─────────────────────────────────────────────────────────────────────────────────────── ║
║  • Total CVs:           ${s.cv_analytics.total_cvs.toString().padStart(10)}                                                    ║
║  • Total Skills:        ${s.cv_analytics.total_skills.toString().padStart(10)}                                                    ║
║  • Avg Skills/CV:       ${s.cv_analytics.avg_skills_per_cv.toString().padStart(10)}                                                    ║
║  • Total Projects:      ${s.cv_analytics.total_projects.toString().padStart(10)}                                                    ║
║  • Total Achievements:  ${s.cv_analytics.total_achievements.toString().padStart(10)}                                                    ║
║  • Total Volunteer:     ${s.cv_analytics.total_volunteer.toString().padStart(10)}                                                    ║
║  • Total Leadership:    ${s.cv_analytics.total_leadership.toString().padStart(10)}                                                    ║
║  • Total Certifications:${s.cv_analytics.total_certifications.toString().padStart(10)}                                                    ║
║  • Total Languages:     ${s.cv_analytics.total_languages.toString().padStart(10)}                                                    ║
║  • Total Referees:      ${s.cv_analytics.total_referees.toString().padStart(10)}                                                    ║
║                                                                                          ║
║  💌 COVER LETTER ANALYTICS                                                              ║
║  ─────────────────────────────────────────────────────────────────────────────────────── ║
║  • Total Cover Letters: ${s.cover_letter_analytics.total_cover_letters.toString().padStart(10)}                                                    ║
║  • With Vacancy:        ${s.cover_letter_analytics.with_vacancy.toString().padStart(10)}                                                    ║
║                                                                                          ║
║  💳 PAYMENT ANALYTICS                                                                    ║
║  ─────────────────────────────────────────────────────────────────────────────────────── ║
║  • Installments Active: ${s.payment_analytics.installments.active.toString().padStart(10)}                                                    ║
║  • Installments Done:   ${s.payment_analytics.installments.completed.toString().padStart(10)}                                                    ║
║  • Pay Later Active:    ${s.payment_analytics.pay_later.active.toString().padStart(10)}                                                    ║
║  • Pay Later Overdue:   ${s.payment_analytics.pay_later.overdue.toString().padStart(10)}                                                    ║
║                                                                                          ║
║  🐛 ERROR REPORTING ANALYTICS                                                            ║
║  ─────────────────────────────────────────────────────────────────────────────────────── ║
║  • Total Reports:       ${s.error_analytics.total_reports.toString().padStart(10)}                                                    ║
║  • Pending:             ${s.error_analytics.pending.toString().padStart(10)}                                                    ║
║  • Resolved:            ${s.error_analytics.resolved.toString().padStart(10)}                                                    ║
║  • Resolution Rate:     ${s.error_analytics.resolution_rate.toString().padStart(10)}%                                                   ║
║  • Avg Resolution:      ${s.error_analytics.avg_resolution_hours.toString().padStart(10)} hours                                              ║
║  • Today:               ${s.error_analytics.today.toString().padStart(10)}                                                    ║
║  • This Week:           ${s.error_analytics.this_week.toString().padStart(10)}                                                    ║
║                                                                                          ║
║  👥 CLIENT INSIGHTS                                                                      ║
║  ─────────────────────────────────────────────────────────────────────────────────────── ║
║  • Total clients:       ${s.clients.total.toString().padStart(10)}                                                    ║
║  • Active (30d):        ${s.clients.active.toString().padStart(10)}                                                    ║
║  • Retention rate:      ${s.clients.retention_rate.toString().padStart(10)}%                                                   ║
║  • Conversion rate:     ${s.clients.conversion_rate.toString().padStart(10)}%                                                   ║
║  • Returning rate:      ${s.clients.returning_rate.toString().padStart(10)}%                                                   ║
║  • Pending payments:    ${s.clients.pending_payments.toString().padStart(10)}                                                    ║
║                                                                                          ║
║  📝 TESTIMONIALS                                                                         ║
║  ─────────────────────────────────────────────────────────────────────────────────────── ║
║  • Approved:            ${s.testimonials.approved.toString().padStart(10)}                                                    ║
║  • Pending review:      ${s.testimonials.pending.toString().padStart(10)}                                                    ║
║  • Avg rating:          ${s.testimonials.average_rating.toString().padStart(10)} ★                                              ║
║                                                                                          ║
║  📅 YEAR-TO-DATE                                                                         ║
║  ─────────────────────────────────────────────────────────────────────────────────────── ║
║  • Total orders:        ${s.year.orders.toString().padStart(10)}                                                    ║
║  • Revenue:             MK${s.year.revenue.toLocaleString().padStart(12)}                                             ║
║  • Projected annual:    MK${Math.round(s.year.projected_annual).toLocaleString().padStart(12)}                                             ║
║                                                                                          ║
╚══════════════════════════════════════════════════════════════════════════════════════════╝
    `;
  }

  async sendDailySummary() {
    await this.refreshStats();
    const summary = this.formatStats();
    console.log(summary);
    
    const adminChatId = process.env.ADMIN_CHAT_ID;
    if (adminChatId && this.bot) {
      await this.bot.telegram.sendMessage(adminChatId, `📊 *Daily Business Summary*\n\`\`\`\n${summary}\n\`\`\``, { parse_mode: 'Markdown' });
    }
  }

  async sendWeeklyReport() {
    await this.refreshStats();
    const s = this.stats;
    const report = `
📊 *WEEKLY REPORT - ${new Date().toLocaleDateString()}*

${SEP}
📈 PERFORMANCE
${SEP}
• Orders: ${s.week.orders}
• Revenue: MK${s.week.revenue.toLocaleString()}
• Growth: ${s.week.growth.toFixed(1)}%

${SEP}
👥 CLIENTS
${SEP}
• New: ${s.month.new_clients}
• Active: ${s.clients.active}
• Retention: ${s.clients.retention_rate}%

${SEP}
⭐ FEEDBACK
${SEP}
• Avg Rating: ${s.month.avg_rating} ★
• Testimonials: ${s.testimonials.approved} approved

${SEP}
🐛 ERROR REPORTS
${SEP}
• Pending: ${s.error_analytics.pending}
• Resolved: ${s.error_analytics.resolved}
• Resolution Rate: ${s.error_analytics.resolution_rate}%

${SEP}
🎯 TOP SERVICE
${SEP}
• ${s.month.most_requested || 'None'} (${s.month.most_requested_count || 0} orders)

Keep up the great work! 🚀`;
    
    const adminChatId = process.env.ADMIN_CHAT_ID;
    if (adminChatId && this.bot) {
      await this.bot.telegram.sendMessage(adminChatId, report, { parse_mode: 'Markdown' });
    }
  }

  async sendMonthlyReport() {
    await this.refreshStats();
    const s = this.stats;
    const report = `
📊 *MONTHLY REPORT - ${new Date().toLocaleDateString()}*

${SEP}
📈 SUMMARY
${SEP}
• Total Orders: ${s.month.orders}
• Revenue: MK${s.month.revenue.toLocaleString()}
• New Clients: ${s.month.new_clients}
• Returning Clients: ${s.month.returning_clients}

${SEP}
📊 CV ANALYTICS
${SEP}
• Total CVs: ${s.cv_analytics.total_cvs}
• Avg Skills/CV: ${s.cv_analytics.avg_skills_per_cv}
• Total Projects: ${s.cv_analytics.total_projects}

${SEP}
💳 PAYMENTS
${SEP}
• Installments Completed: ${s.payment_analytics.installments.completed}
• Pay Later Overdue: ${s.payment_analytics.pay_later.overdue}

${SEP}
🐛 ERROR REPORTS
${SEP}
• Total Reports: ${s.error_analytics.total_reports}
• Pending: ${s.error_analytics.pending}
• Resolved: ${s.error_analytics.resolved}
• Avg Resolution: ${s.error_analytics.avg_resolution_hours} hours

${SEP}
⭐ RATINGS
${SEP}
• Average Rating: ${s.month.avg_rating} ★
• Testimonials: ${s.testimonials.approved} approved

Great month! On to the next! 🎯`;
    
    const adminChatId = process.env.ADMIN_CHAT_ID;
    if (adminChatId && this.bot) {
      await this.bot.telegram.sendMessage(adminChatId, report, { parse_mode: 'Markdown' });
    }
  }

  async getFormattedReport() {
    await this.refreshStats();
    return this.formatStats();
  }

  async getRevenueByService() {
    const orders = await db.getAllOrders();
    const revenueByService = {};
    for (const order of orders) {
      const service = order.service;
      const amount = this.calculateRevenue([order]);
      revenueByService[service] = (revenueByService[service] || 0) + amount;
    }
    return revenueByService;
  }

  async getClientAcquisitionTrend(days = 30) {
    const clients = await db.getAllClients();
    const trend = [];
    const today = new Date();
    for (let i = days; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      const count = clients.filter(c => c.created_at.split('T')[0] === dateStr).length;
      trend.push({ date: dateStr, new_clients: count });
    }
    return trend;
  }

  async getTopClients(limit = 10) {
    const clients = await db.getAllClients();
    const clientsWithSpending = await Promise.all(clients.map(async (client) => {
      const orders = await db.getClientOrders(client.id);
      const totalSpent = this.calculateRevenue(orders.filter(o => o.payment_status === 'completed'));
      return { ...client, total_spent: totalSpent, order_count: orders.length };
    }));
    return clientsWithSpending.sort((a, b) => b.total_spent - a.total_spent).slice(0, limit);
  }

  async getDeepSeekUsageStats() {
    return {
      total_extractions: 0,
      estimated_cost: 0,
      average_tokens_per_extraction: 0
    };
  }

  async getErrorReportStats() {
    await this.refreshStats();
    return this.stats.error_analytics;
  }

  async getPendingErrorReports(limit = 20) {
    const reports = await db.getErrorReports('pending', limit);
    return reports;
  }

  async getErrorReportById(reportId) {
    return await db.getErrorReportById(reportId);
  }
}

const dashboard = new AdminDashboard();
dashboard.refreshStats().catch(console.error);

module.exports = dashboard;