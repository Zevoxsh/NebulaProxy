/**
 * MultiProxySyncService - Synchronizes proxy updates across multiple proxy instances
 *
 * PostgreSQL-only mode:
 * - Each instance reads domains from the shared database
 * - When a domain is created/modified/deleted on one instance,
 *   it emits a PostgreSQL NOTIFY event
 * - All instances receive the event and update their proxies in real-time
 */

import { v4 as uuidv4 } from 'uuid';
import { getPgPool } from '../config/database.js';

export class MultiProxySyncService {
  constructor() {
    this.processId = uuidv4(); // Unique ID for this proxy instance
    this.proxyManager = null;
    this.database = null;
    this.pgPool = null;
    this.pgClient = null;

    // Track subscriptions
    this.isSubscribed = false;
    this.subscriptionChannel = 'nebula_proxy_sync';
    this.notificationHandler = null;
  }

  /**
   * Initialize the service
   * @param {Object} proxyManagerInstance - ProxyManager instance
   * @param {Object} databaseInstance - Database instance
   */
  init(proxyManagerInstance, databaseInstance) {
    this.proxyManager = proxyManagerInstance;
    this.database = databaseInstance;
    this.pgPool = getPgPool();

    console.log(`[MultiProxySync] Initialized with process ID: ${this.processId}`);
    return this;
  }

  /**
   * Start subscribing to sync events from other proxy instances
   */
  async startListening() {
    if (!this.pgPool || !this.proxyManager) {
      throw new Error('[MultiProxySync] Service not initialized');
    }

    if (this.isSubscribed) {
      return; // Already listening
    }

    this.pgClient = await this.pgPool.connect();
    this.notificationHandler = async (message) => {
      if (message.channel !== this.subscriptionChannel || !message.payload) {
        return;
      }

      try {
        const event = JSON.parse(message.payload);
        await this._handleSyncEvent(event);
      } catch (err) {
        console.error(`[MultiProxySync] Failed to handle sync event:`, err.message);
      }
    };

    this.pgClient.on('notification', this.notificationHandler);
    this.pgClient.on('error', (err) => {
      console.error('[MultiProxySync] PostgreSQL listener error:', err.message);
    });

    await this.pgClient.query(`LISTEN ${this.subscriptionChannel}`);

    this.isSubscribed = true;
    console.log(`[MultiProxySync] Now listening for domain changes on PostgreSQL channel: ${this.subscriptionChannel}`);
  }

  /**
   * Stop listening to sync events
   */
  async stopListening() {
    if (this.pgClient) {
      try {
        await this.pgClient.query(`UNLISTEN ${this.subscriptionChannel}`);
      } catch (err) {
        console.warn(`[MultiProxySync] Failed to unlisten:`, err.message);
      }

      if (this.notificationHandler) {
        this.pgClient.off('notification', this.notificationHandler);
        this.notificationHandler = null;
      }

      this.pgClient.release();
      this.pgClient = null;
    }
    this.isSubscribed = false;
    console.log(`[MultiProxySync] Stopped listening`);
  }

  /**
   * Publish a domain change event to all other proxy instances
   * This is called whenever a domain is created, modified, or deleted
   */
  async publishDomainChange(action, domain, details = {}) {
    if (!this.pgPool) return;

    const event = {
      id: uuidv4(),
      timestamp: Date.now(),
      sourceProxyId: this.processId,
      action, // 'created', 'modified', 'deleted', 'reloaded'
      domain: {
        id: domain.id,
        hostname: domain.hostname,
        proxyType: domain.proxyType,
        externalPort: domain.externalPort,
        is_active: domain.is_active
      },
      details
    };

    try {
      await this.pgPool.query('SELECT pg_notify($1, $2)', [this.subscriptionChannel, JSON.stringify(event)]);
      console.log(`[MultiProxySync] Published '${action}' event for domain ${domain.hostname}`);
    } catch (err) {
      console.error(`[MultiProxySync] Failed to publish event:`, err.message);
    }
  }

  /**
   * Handle a sync event from another proxy instance
   */
  async _handleSyncEvent(event) {
    // Don't process your own events
    if (event.sourceProxyId === this.processId) {
      return;
    }

    const { action, domain } = event;
    console.log(`[MultiProxySync] Received event from proxy ${event.sourceProxyId}: ${action} for ${domain.hostname}`);

    try {
      switch (action) {
        case 'created':
          // A new domain was created on another proxy - start it here too
          await this._syncDomainCreated(domain);
          break;

        case 'modified':
          // A domain was modified - reload it
          await this._syncDomainModified(domain);
          break;

        case 'deleted':
          // A domain was deleted - stop it
          await this._syncDomainDeleted(domain);
          break;

        case 'reloaded':
          // Another proxy reloaded: fetch and start all domains
          await this._syncFullReload();
          break;

        default:
          console.warn(`[MultiProxySync] Unknown action: ${action}`);
      }
    } catch (err) {
      console.error(`[MultiProxySync] Error handling ${action} event:`, err.message);
    }
  }

  /**
   * Sync: domain was created on another proxy
   */
  async _syncDomainCreated(domainInfo) {
    try {
      // Fetch the full domain details from database
      const domain = await this.database.getDomainById(domainInfo.id);
      if (!domain) {
        console.warn(`[MultiProxySync] Domain not found in database: ${domainInfo.id}`);
        return;
      }

      // Check if already running locally
      const existing = this.proxyManager.proxies.get(domain.id);
      if (existing) {
        console.log(`[MultiProxySync] Domain ${domain.hostname} already running locally`);
        return;
      }

      // If domain is active, start it
      if (domain.is_active) {
        console.log(`[MultiProxySync] Starting domain ${domain.hostname} (created on another proxy)`);
        await this.proxyManager.startProxy(domain);
      }
    } catch (err) {
      console.error(`[MultiProxySync] Failed to sync domain creation:`, err.message);
    }
  }

  /**
   * Sync: domain was modified on another proxy
   */
  async _syncDomainModified(domainInfo) {
    try {
      const domain = await this.database.getDomainById(domainInfo.id);
      if (!domain) {
        console.warn(`[MultiProxySync] Domain not found in database: ${domainInfo.id}`);
        return;
      }

      const existing = this.proxyManager.proxies.get(domain.id);

      // If it was inactive and is now active, start it
      if (!existing && domain.is_active) {
        console.log(`[MultiProxySync] Starting previously inactive domain ${domain.hostname}`);
        await this.proxyManager.startProxy(domain);
      }
      // If it was active and is now inactive, stop it
      else if (existing && !domain.is_active) {
        console.log(`[MultiProxySync] Stopping domain ${domain.hostname} (now inactive)`);
        await this.proxyManager.stopProxy(domain.id);
      }
      // If it's still active, reload it (in case settings changed)
      else if (existing && domain.is_active) {
        console.log(`[MultiProxySync] Reloading domain ${domain.hostname}`);
        await this.proxyManager.stopProxy(domain.id);
        await this.proxyManager.startProxy(domain);
      }
    } catch (err) {
      console.error(`[MultiProxySync] Failed to sync domain modification:`, err.message);
    }
  }

  /**
   * Sync: domain was deleted on another proxy
   */
  async _syncDomainDeleted(domainInfo) {
    try {
      const existing = this.proxyManager.proxies.get(domainInfo.id);
      if (existing) {
        console.log(`[MultiProxySync] Stopping deleted domain ${domainInfo.hostname}`);
        await this.proxyManager.stopProxy(domainInfo.id);
      }
    } catch (err) {
      console.error(`[MultiProxySync] Failed to sync domain deletion:`, err.message);
    }
  }

  /**
   * Sync: full reload - fetch all active domains from DB and ensure they're all running
   */
  async _syncFullReload() {
    try {
      console.log(`[MultiProxySync] Starting full reload of all domains`);
      const allDomains = await this.database.getAllDomains();

      const activeDomainsInDb = new Set(
        allDomains
          .filter(d => d.is_active)
          .map(d => d.id)
      );

      // Stop proxies that are in memory but not in DB
      for (const [domainId, entry] of this.proxyManager.proxies) {
        if (!activeDomainsInDb.has(domainId)) {
          console.log(`[MultiProxySync] Stopping local proxy ${domainId} (not in active domains)`);
          try {
            await this.proxyManager.stopProxy(domainId);
          } catch (err) {
            console.warn(`[MultiProxySync] Failed to stop proxy ${domainId}:`, err.message);
          }
        }
      }

      // Start proxies in DB that aren't running locally
      for (const domain of allDomains) {
        if (domain.is_active) {
          const isRunning = this.proxyManager.proxies.has(domain.id);
          if (!isRunning) {
            console.log(`[MultiProxySync] Starting domain ${domain.hostname} (not running locally)`);
            try {
              await this.proxyManager.startProxy(domain);
            } catch (err) {
              console.warn(`[MultiProxySync] Failed to start proxy for ${domain.hostname}:`, err.message);
            }
          }
        }
      }

      console.log(`[MultiProxySync] Full reload completed`);
    } catch (err) {
      console.error(`[MultiProxySync] Failed to perform full reload:`, err.message);
    }
  }

  /**
   * Get list of healthy proxy instances
   * @returns {Promise<Array>} List of proxy instance IDs
   */
  async getHealthyProxies() {
    return [this.processId];
  }

  /**
   * Force a full reload on this proxy (useful for debugging)
   */
  async forceFullReload() {
    console.log(`[MultiProxySync] Force reload triggered`);
    await this._syncFullReload();
  }

  /**
   * Get sync service status
   */
  async getStatus() {
    const healthyProxies = await this.getHealthyProxies();

    return {
      processId: this.processId,
      isSubscribed: this.isSubscribed,
      healthyProxies,
      healthyProxiesCount: healthyProxies.length,
      localDomainsCount: this.proxyManager.proxies.size
    };
  }
}

// Export singleton
export const multiProxySyncService = new MultiProxySyncService();
