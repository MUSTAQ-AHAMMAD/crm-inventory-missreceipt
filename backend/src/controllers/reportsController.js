/**
 * Reports controller.
 * Provides dashboard metrics, failure reports, activity logs, and CSV exports.
 */

const prisma = require('../services/prisma');

/**
 * GET /api/reports/dashboard
 * Returns aggregated metrics for the dashboard.
 */
async function dashboard(req, res, next) {
  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // Aggregate queries in parallel for performance
    const [
      totalInventoryUploads,
      inventoryStats,
      totalMiscUploads,
      activeUsers,
      recentInventory,
      recentMisc,
      recentActivity,
    ] = await Promise.all([
      prisma.inventoryUpload.count(),
      prisma.inventoryUpload.aggregate({
        _sum: { successCount: true, failureCount: true, totalRecords: true },
      }),
      prisma.miscReceiptUpload.count(),
      prisma.user.count({ where: { isActive: true } }),
      // Daily trend for inventory uploads over last 30 days
      prisma.inventoryUpload.findMany({
        where: { createdAt: { gte: thirtyDaysAgo } },
        select: { createdAt: true, successCount: true, failureCount: true },
        orderBy: { createdAt: 'asc' },
      }),
      // Daily trend for misc receipt uploads
      prisma.miscReceiptUpload.findMany({
        where: { createdAt: { gte: thirtyDaysAgo } },
        select: { createdAt: true, responseStatus: true },
        orderBy: { createdAt: 'asc' },
      }),
      // Recent activity logs
      prisma.activityLog.findMany({
        take: 10,
        orderBy: { createdAt: 'desc' },
        include: { user: { select: { email: true } } },
      }),
    ]);

    // Build daily trend data (group by date string YYYY-MM-DD)
    const trendMap = {};
    recentInventory.forEach(({ createdAt, successCount, failureCount }) => {
      const day = createdAt.toISOString().split('T')[0];
      if (!trendMap[day]) trendMap[day] = { date: day, inventorySuccess: 0, inventoryFail: 0, miscSuccess: 0, miscFail: 0 };
      trendMap[day].inventorySuccess += successCount;
      trendMap[day].inventoryFail += failureCount;
    });
    recentMisc.forEach(({ createdAt, responseStatus }) => {
      const day = createdAt.toISOString().split('T')[0];
      if (!trendMap[day]) trendMap[day] = { date: day, inventorySuccess: 0, inventoryFail: 0, miscSuccess: 0, miscFail: 0 };
      if (responseStatus === 'SUCCESS') trendMap[day].miscSuccess++;
      else trendMap[day].miscFail++;
    });

    const dailyTrend = Object.values(trendMap).sort((a, b) => a.date.localeCompare(b.date));

    return res.json({
      totalInventoryUploads,
      totalMiscUploads,
      totalSuccessRecords: inventoryStats._sum.successCount || 0,
      totalFailureRecords: inventoryStats._sum.failureCount || 0,
      totalRecordsProcessed: inventoryStats._sum.totalRecords || 0,
      activeUsers,
      dailyTrend,
      recentActivity,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/reports/failures?type=inventory|misc&from=&to=
 * Returns failure records with optional type and date-range filters.
 */
async function failures(req, res, next) {
  try {
    const { type, from, to } = req.query;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 20);
    const skip = (page - 1) * limit;

    const dateFilter = {};
    if (from) dateFilter.gte = new Date(from);
    if (to) dateFilter.lte = new Date(to);

    let inventoryFailures = [];
    let miscFailures = [];

    if (!type || type === 'inventory') {
      inventoryFailures = await prisma.inventoryFailureRecord.findMany({
        where: dateFilter.gte || dateFilter.lte ? { createdAt: dateFilter } : {},
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: { upload: { select: { filename: true, userId: true } } },
      });
    }

    if (!type || type === 'misc') {
      miscFailures = await prisma.miscReceiptFailure.findMany({
        where: dateFilter.gte || dateFilter.lte ? { createdAt: dateFilter } : {},
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: { upload: { select: { filename: true, userId: true } } },
      });
    }

    return res.json({ inventoryFailures, miscFailures });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/reports/activity?userId=&from=&to=
 * Returns activity logs with optional filters.
 */
async function activity(req, res, next) {
  try {
    const { userId, from, to } = req.query;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 20);
    const skip = (page - 1) * limit;

    const where = {};
    if (userId) where.userId = parseInt(userId);
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to) where.createdAt.lte = new Date(to);
    }

    const [logs, total] = await Promise.all([
      prisma.activityLog.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: { user: { select: { email: true } } },
      }),
      prisma.activityLog.count({ where }),
    ]);

    return res.json({ logs, total, page, limit });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/reports/export?type=failures|activity&format=csv
 * Exports report data as a CSV file.
 */
async function exportReport(req, res, next) {
  try {
    const { type = 'failures', from, to } = req.query;

    const dateFilter = {};
    if (from) dateFilter.gte = new Date(from);
    if (to) dateFilter.lte = new Date(to);
    const hasDateFilter = !!(from || to);

    let csvRows = [];
    let filename = 'export.csv';

    if (type === 'activity') {
      const logs = await prisma.activityLog.findMany({
        where: hasDateFilter ? { createdAt: dateFilter } : {},
        orderBy: { createdAt: 'desc' },
        take: 5000,
        include: { user: { select: { email: true } } },
      });
      csvRows = logs.map((l) =>
        [l.id, l.user.email, l.actionType, `"${l.actionDetails}"`, l.ipAddress || '', l.createdAt.toISOString()].join(',')
      );
      csvRows.unshift('id,email,actionType,actionDetails,ipAddress,createdAt');
      filename = 'activity_export.csv';
    } else {
      // Default: inventory failures
      const invFails = await prisma.inventoryFailureRecord.findMany({
        where: hasDateFilter ? { createdAt: dateFilter } : {},
        orderBy: { createdAt: 'desc' },
        take: 5000,
        include: { upload: { select: { filename: true } } },
      });
      csvRows = invFails.map((f) =>
        [f.id, f.uploadId, `"${f.upload.filename}"`, f.rowNumber, `"${f.errorMessage}"`, f.createdAt.toISOString()].join(',')
      );
      csvRows.unshift('id,uploadId,filename,rowNumber,errorMessage,createdAt');
      filename = 'failures_export.csv';
    }

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(csvRows.join('\n'));
  } catch (err) {
    next(err);
  }
}

module.exports = { dashboard, failures, activity, exportReport };
