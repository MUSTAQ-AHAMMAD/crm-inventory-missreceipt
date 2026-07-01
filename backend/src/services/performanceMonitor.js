/**
 * Performance Monitor Service
 * 
 * Tracks and logs performance metrics for:
 * - Database query execution time
 * - API response time
 * - Memory usage
 * - Database connection pool stats
 * 
 * Usage:
 *   const { performanceMonitor } = require('./services/performanceMonitor');
 *   
 *   // Track query execution
 *   const queryTimer = performanceMonitor.startQuery('findManyInvoices');
 *   const result = await prisma.fusionInvoiceHeader.findMany(...);
 *   queryTimer.end();
 *   
 *   // Track API response
 *   const apiTimer = performanceMonitor.startApiCall('GET /api/ar-pipeline/summary');
 *   // ... handle request ...
 *   apiTimer.end();
 */

const PERFORMANCE_LOGGING_ENABLED = process.env.PERFORMANCE_LOGGING === 'true';
const PERFORMANCE_WARNING_THRESHOLD_MS = parseInt(process.env.PERFORMANCE_WARNING_THRESHOLD_MS || '1000', 10);
const MEMORY_WARNING_THRESHOLD_MB = parseInt(process.env.MEMORY_WARNING_THRESHOLD_MB || '500', 10);

class PerformanceMonitor {
  constructor() {
    this.metrics = {
      queries: [],
      apiCalls: [],
      memorySnapshots: [],
    };
    
    // Start periodic memory monitoring
    if (PERFORMANCE_LOGGING_ENABLED) {
      this.startMemoryMonitoring();
    }
  }

  /**
   * Start tracking a database query
   * @param {string} queryName - Name of the query (e.g., 'findManyInvoices')
   * @param {object} context - Additional context (e.g., { where: {...}, take: 100 })
   * @returns {object} Timer object with end() method
   */
  startQuery(queryName, context = {}) {
    const startTime = Date.now();
    const startMemory = process.memoryUsage().heapUsed;
    
    return {
      end: () => {
        const duration = Date.now() - startTime;
        const memoryDelta = process.memoryUsage().heapUsed - startMemory;
        
        const metric = {
          type: 'query',
          name: queryName,
          duration,
          memoryDelta,
          timestamp: new Date().toISOString(),
          context,
        };
        
        this.metrics.queries.push(metric);
        
        // Log if performance logging is enabled or if query is slow
        if (PERFORMANCE_LOGGING_ENABLED || duration > PERFORMANCE_WARNING_THRESHOLD_MS) {
          const level = duration > PERFORMANCE_WARNING_THRESHOLD_MS ? '⚠️ ' : '✅';
          console.log(
            `${level} [PerformanceMonitor][Query] ${queryName} | ${duration}ms | ` +
            `memory: ${this.formatBytes(memoryDelta)} | context: ${JSON.stringify(context)}`
          );
        }
        
        return metric;
      },
    };
  }

  /**
   * Start tracking an API call
   * @param {string} endpoint - API endpoint (e.g., 'GET /api/ar-pipeline/summary')
   * @param {object} context - Additional context (e.g., { userId: 123 })
   * @returns {object} Timer object with end() method
   */
  startApiCall(endpoint, context = {}) {
    const startTime = Date.now();
    const startMemory = process.memoryUsage().heapUsed;
    
    return {
      end: (statusCode = 200) => {
        const duration = Date.now() - startTime;
        const memoryDelta = process.memoryUsage().heapUsed - startMemory;
        
        const metric = {
          type: 'api',
          endpoint,
          duration,
          memoryDelta,
          statusCode,
          timestamp: new Date().toISOString(),
          context,
        };
        
        this.metrics.apiCalls.push(metric);
        
        // Log if performance logging is enabled or if API call is slow
        if (PERFORMANCE_LOGGING_ENABLED || duration > PERFORMANCE_WARNING_THRESHOLD_MS) {
          const level = duration > PERFORMANCE_WARNING_THRESHOLD_MS ? '⚠️ ' : '✅';
          console.log(
            `${level} [PerformanceMonitor][API] ${endpoint} | ${statusCode} | ${duration}ms | ` +
            `memory: ${this.formatBytes(memoryDelta)}`
          );
        }
        
        return metric;
      },
    };
  }

  /**
   * Get current memory usage
   * @returns {object} Memory usage stats
   */
  getMemoryUsage() {
    const usage = process.memoryUsage();
    return {
      heapUsed: usage.heapUsed,
      heapUsedMB: (usage.heapUsed / 1024 / 1024).toFixed(2),
      heapTotal: usage.heapTotal,
      heapTotalMB: (usage.heapTotal / 1024 / 1024).toFixed(2),
      external: usage.external,
      externalMB: (usage.external / 1024 / 1024).toFixed(2),
      rss: usage.rss,
      rssMB: (usage.rss / 1024 / 1024).toFixed(2),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Start periodic memory monitoring
   */
  startMemoryMonitoring() {
    const interval = parseInt(process.env.MEMORY_CHECK_INTERVAL_MS || '60000', 10);
    
    setInterval(() => {
      const memoryUsage = this.getMemoryUsage();
      this.metrics.memorySnapshots.push(memoryUsage);
      
      // Warn if memory usage is high
      const heapUsedMB = parseFloat(memoryUsage.heapUsedMB);
      if (heapUsedMB > MEMORY_WARNING_THRESHOLD_MB) {
        console.warn(
          `⚠️  [PerformanceMonitor][Memory] High memory usage: ${heapUsedMB} MB ` +
          `(threshold: ${MEMORY_WARNING_THRESHOLD_MB} MB)`
        );
      }
      
      // Keep only last 100 snapshots
      if (this.metrics.memorySnapshots.length > 100) {
        this.metrics.memorySnapshots.shift();
      }
    }, interval);
  }

  /**
   * Get performance statistics
   * @param {object} options - Filter options
   * @returns {object} Performance stats
   */
  getStats(options = {}) {
    const { type, since } = options;
    const sinceDate = since ? new Date(since) : null;
    
    let queries = this.metrics.queries;
    let apiCalls = this.metrics.apiCalls;
    
    // Filter by date if specified
    if (sinceDate) {
      queries = queries.filter(q => new Date(q.timestamp) >= sinceDate);
      apiCalls = apiCalls.filter(a => new Date(a.timestamp) >= sinceDate);
    }
    
    // Calculate query stats
    const queryStats = {
      count: queries.length,
      avgDuration: queries.length > 0
        ? (queries.reduce((sum, q) => sum + q.duration, 0) / queries.length).toFixed(2)
        : 0,
      maxDuration: queries.length > 0
        ? Math.max(...queries.map(q => q.duration))
        : 0,
      minDuration: queries.length > 0
        ? Math.min(...queries.map(q => q.duration))
        : 0,
      slowQueries: queries.filter(q => q.duration > PERFORMANCE_WARNING_THRESHOLD_MS).length,
    };
    
    // Calculate API call stats
    const apiStats = {
      count: apiCalls.length,
      avgDuration: apiCalls.length > 0
        ? (apiCalls.reduce((sum, a) => sum + a.duration, 0) / apiCalls.length).toFixed(2)
        : 0,
      maxDuration: apiCalls.length > 0
        ? Math.max(...apiCalls.map(a => a.duration))
        : 0,
      minDuration: apiCalls.length > 0
        ? Math.min(...apiCalls.map(a => a.duration))
        : 0,
      slowCalls: apiCalls.filter(a => a.duration > PERFORMANCE_WARNING_THRESHOLD_MS).length,
    };
    
    // Get current memory usage
    const currentMemory = this.getMemoryUsage();
    
    return {
      queries: queryStats,
      apiCalls: apiStats,
      memory: {
        current: currentMemory,
        snapshots: this.metrics.memorySnapshots.slice(-10), // Last 10 snapshots
      },
    };
  }

  /**
   * Reset all metrics
   */
  reset() {
    this.metrics = {
      queries: [],
      apiCalls: [],
      memorySnapshots: [],
    };
  }

  /**
   * Format bytes to human-readable string
   * @param {number} bytes - Number of bytes
   * @returns {string} Formatted string
   */
  formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(Math.abs(bytes)) / Math.log(k));
    const value = (bytes / Math.pow(k, i)).toFixed(2);
    return `${value} ${sizes[i]}`;
  }

  /**
   * Express middleware for automatic API performance tracking
   * @returns {Function} Express middleware
   */
  middleware() {
    return (req, res, next) => {
      const endpoint = `${req.method} ${req.path}`;
      const timer = this.startApiCall(endpoint, {
        userId: req.user?.id,
        query: req.query,
      });
      
      let timerEnded = false;
      
      // Helper to ensure timer is only ended once
      const endTimer = () => {
        if (!timerEnded) {
          timerEnded = true;
          timer.end(res.statusCode);
        }
      };
      
      // Override res.json and res.send to capture response
      const originalJson = res.json.bind(res);
      const originalSend = res.send.bind(res);
      
      res.json = function (data) {
        endTimer();
        return originalJson(data);
      };
      
      res.send = function (data) {
        endTimer();
        return originalSend(data);
      };
      
      // Handle early exit (errors, redirects, etc.)
      // The 'finish' event fires after the response is fully sent
      res.on('finish', () => {
        endTimer();
      });
      
      next();
    };
  }
}

// Singleton instance
const performanceMonitor = new PerformanceMonitor();

module.exports = {
  performanceMonitor,
  PerformanceMonitor,
};
