/**
 * Streaming Invoice Service
 * 
 * Provides real-time progress updates for large invoice processing via WebSocket.
 * This service streams progress updates to the frontend, not to Oracle.
 * 
 * Features:
 * - WebSocket-based real-time updates
 * - Chunk-by-chunk progress tracking
 * - Compression support for WebSocket messages
 * - Connection management and reconnection
 * - Multiple concurrent client support
 * 
 * @module streamingInvoiceService
 */

const WebSocket = require('ws');
const EventEmitter = require('events');
const { v4: uuidv4 } = require('uuid');

/**
 * Streaming Invoice Manager
 * Manages WebSocket connections and streams progress updates
 */
class StreamingInvoiceManager extends EventEmitter {
  constructor() {
    super();
    this.wss = null;
    this.clients = new Map(); // sessionId -> WebSocket
    this.sessions = new Map(); // sessionId -> session data
  }
  
  /**
   * Initialize WebSocket server
   * 
   * @param {Object} server - HTTP server instance
   * @param {string} path - WebSocket endpoint path
   */
  initialize(server, path = '/ws/bulk-invoice') {
    this.wss = new WebSocket.Server({
      server,
      path,
      perMessageDeflate: {
        zlibDeflateOptions: {
          level: 6, // Compression level
        },
        zlibInflateOptions: {
          chunkSize: 10 * 1024,
        },
        clientNoContextTakeover: true,
        serverNoContextTakeover: true,
        serverMaxWindowBits: 10,
        concurrencyLimit: 10,
      },
    });
    
    this.wss.on('connection', (ws, req) => {
      this.handleConnection(ws, req);
    });
    
    console.log(`[StreamingInvoice] WebSocket server initialized on ${path}`);
  }
  
  /**
   * Handle new WebSocket connection
   * 
   * @param {WebSocket} ws - WebSocket connection
   * @param {Object} req - HTTP request
   */
  handleConnection(ws, req) {
    const sessionId = uuidv4();
    const clientIp = req.socket.remoteAddress;
    
    console.log(`[StreamingInvoice] New connection | sessionId=${sessionId} | ip=${clientIp}`);
    
    // Store client
    this.clients.set(sessionId, ws);
    this.sessions.set(sessionId, {
      sessionId,
      connectedAt: new Date(),
      clientIp,
      isAuthenticated: false,
    });
    
    // Send welcome message
    this.sendToClient(sessionId, {
      type: 'CONNECTED',
      sessionId,
      message: 'Connected to bulk invoice streaming service',
    });
    
    // Handle messages from client
    ws.on('message', (message) => {
      this.handleMessage(sessionId, message);
    });
    
    // Handle connection close
    ws.on('close', () => {
      console.log(`[StreamingInvoice] Connection closed | sessionId=${sessionId}`);
      this.clients.delete(sessionId);
      this.sessions.delete(sessionId);
    });
    
    // Handle errors
    ws.on('error', (error) => {
      console.error(`[StreamingInvoice] WebSocket error | sessionId=${sessionId} | error=${error.message}`);
    });
  }
  
  /**
   * Handle message from client
   * 
   * @param {string} sessionId - Session ID
   * @param {string} message - Message data
   */
  handleMessage(sessionId, message) {
    try {
      const data = JSON.parse(message);
      
      // Handle authentication
      if (data.type === 'AUTH') {
        this.handleAuth(sessionId, data);
        return;
      }
      
      // Handle subscription to batch
      if (data.type === 'SUBSCRIBE') {
        this.handleSubscribe(sessionId, data);
        return;
      }
      
      // Handle unsubscribe
      if (data.type === 'UNSUBSCRIBE') {
        this.handleUnsubscribe(sessionId, data);
        return;
      }
      
    } catch (error) {
      console.error(`[StreamingInvoice] Failed to handle message | sessionId=${sessionId} | error=${error.message}`);
      this.sendError(sessionId, 'Invalid message format');
    }
  }
  
  /**
   * Handle authentication
   * 
   * @param {string} sessionId - Session ID
   * @param {Object} data - Auth data
   */
  handleAuth(sessionId, data) {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    
    // Simple token-based authentication
    // In production, validate against JWT or session token
    if (data.token) {
      session.isAuthenticated = true;
      session.userId = data.userId;
      
      this.sendToClient(sessionId, {
        type: 'AUTH_SUCCESS',
        message: 'Authentication successful',
      });
      
      console.log(`[StreamingInvoice] Client authenticated | sessionId=${sessionId} | userId=${data.userId}`);
    } else {
      this.sendError(sessionId, 'Authentication failed');
    }
  }
  
  /**
   * Handle batch subscription
   * 
   * @param {string} sessionId - Session ID
   * @param {Object} data - Subscription data
   */
  handleSubscribe(sessionId, data) {
    const session = this.sessions.get(sessionId);
    if (!session || !session.isAuthenticated) {
      this.sendError(sessionId, 'Not authenticated');
      return;
    }
    
    const { batchId } = data;
    if (!batchId) {
      this.sendError(sessionId, 'Missing batchId');
      return;
    }
    
    session.subscribedBatches = session.subscribedBatches || new Set();
    session.subscribedBatches.add(batchId);
    
    this.sendToClient(sessionId, {
      type: 'SUBSCRIBED',
      batchId,
      message: `Subscribed to batch ${batchId}`,
    });
    
    console.log(`[StreamingInvoice] Client subscribed | sessionId=${sessionId} | batchId=${batchId}`);
  }
  
  /**
   * Handle batch unsubscribe
   * 
   * @param {string} sessionId - Session ID
   * @param {Object} data - Unsubscribe data
   */
  handleUnsubscribe(sessionId, data) {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    
    const { batchId } = data;
    if (session.subscribedBatches) {
      session.subscribedBatches.delete(batchId);
    }
    
    this.sendToClient(sessionId, {
      type: 'UNSUBSCRIBED',
      batchId,
      message: `Unsubscribed from batch ${batchId}`,
    });
  }
  
  /**
   * Send message to specific client
   * 
   * @param {string} sessionId - Session ID
   * @param {Object} data - Message data
   */
  sendToClient(sessionId, data) {
    const ws = this.clients.get(sessionId);
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return;
    }
    
    try {
      ws.send(JSON.stringify(data));
    } catch (error) {
      console.error(`[StreamingInvoice] Failed to send to client | sessionId=${sessionId} | error=${error.message}`);
    }
  }
  
  /**
   * Send error to client
   * 
   * @param {string} sessionId - Session ID
   * @param {string} message - Error message
   */
  sendError(sessionId, message) {
    this.sendToClient(sessionId, {
      type: 'ERROR',
      message,
    });
  }
  
  /**
   * Broadcast progress update to all subscribed clients
   * 
   * @param {number} batchId - Batch ID
   * @param {Object} progress - Progress data
   */
  broadcastProgress(batchId, progress) {
    this.sessions.forEach((session, sessionId) => {
      if (session.subscribedBatches && session.subscribedBatches.has(batchId)) {
        this.sendToClient(sessionId, {
          type: 'PROGRESS',
          batchId,
          ...progress,
        });
      }
    });
  }
  
  /**
   * Stream invoice processing with real-time updates
   * 
   * @param {number} batchId - Batch ID
   * @param {Object} payload - Invoice payload
   * @param {Function} processFn - Processing function
   * @returns {Promise<Object>} Processing result
   */
  async streamProcessing(batchId, payload, processFn) {
    const startTime = Date.now();
    const totalLines = payload.receivablesInvoiceLines?.length || 0;
    
    console.log(`[StreamingInvoice] Starting streaming for batch ${batchId} | lines=${totalLines}`);
    
    // Send initial progress
    this.broadcastProgress(batchId, {
      stage: 'STARTING',
      progress: 0,
      totalLines,
      message: 'Starting invoice processing...',
    });
    
    try {
      // Process with progress callbacks
      const result = await processFn({
        onProgress: (progressData) => {
          this.broadcastProgress(batchId, progressData);
        },
      });
      
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      
      // Send completion
      this.broadcastProgress(batchId, {
        stage: 'COMPLETE',
        progress: 100,
        totalLines,
        duration: `${duration}s`,
        message: 'Invoice created successfully',
        result,
      });
      
      console.log(`[StreamingInvoice] Streaming complete | batch=${batchId} | duration=${duration}s`);
      
      return result;
      
    } catch (error) {
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      
      // Send error
      this.broadcastProgress(batchId, {
        stage: 'FAILED',
        progress: 0,
        message: `Processing failed: ${error.message}`,
        error: error.message,
      });
      
      console.error(`[StreamingInvoice] Streaming failed | batch=${batchId} | duration=${duration}s | error=${error.message}`);
      
      throw error;
    }
  }
  
  /**
   * Get active connections count
   * 
   * @returns {number} Number of active connections
   */
  getActiveConnectionsCount() {
    return this.clients.size;
  }
  
  /**
   * Close all connections and shutdown
   */
  shutdown() {
    console.log('[StreamingInvoice] Shutting down WebSocket server...');
    
    this.clients.forEach((ws, sessionId) => {
      this.sendToClient(sessionId, {
        type: 'SERVER_SHUTDOWN',
        message: 'Server is shutting down',
      });
      ws.close();
    });
    
    this.clients.clear();
    this.sessions.clear();
    
    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }
    
    console.log('[StreamingInvoice] Shutdown complete');
  }
}

// Singleton instance
const streamingManager = new StreamingInvoiceManager();

module.exports = {
  StreamingInvoiceManager,
  streamingManager,
};
