// @ts-check
/**
 * Certificate Manager - Gestion des certificats SSL depuis la BDD
 * Charge automatiquement les certificats depuis PostgreSQL/SQLite
 */

import { database } from './database.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { logger } from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class CertificateManager {
  constructor() {
    this.certificateCache = new Map();
    this.cacheMaxAge = 5 * 60 * 1000; // 5 minutes
    // Called with (hostname) after a cert is stored — lets proxyManager flush its SNI cache.
    this.afterCertStored = null;
  }

  /**
   * Charger un certificat depuis la BDD (exact match uniquement)
   * @param {string} hostname - Nom de domaine
   * @returns {object|null} - {cert, key, ca} ou null
   */
  async loadCertificateFromDB(hostname) {
    try {
      // Check cache first
      const cached = this.certificateCache.get(hostname);
      if (cached && (Date.now() - cached.timestamp) < this.cacheMaxAge) {
        logger.info(`[CertManager] ✓ Certificat depuis le cache: ${hostname}`);
        return cached.data;
      }

      const cert = await database.getCertificateByHostname(hostname);
      if (cert && cert.fullchain && cert.privateKey) {
        // Guard against epoch-0: treat any date before year 2000 as invalid/missing
        const MIN_VALID_DATE = new Date('2000-01-01').getTime();
        const rawExpiry = cert.expiresAt ? new Date(cert.expiresAt).getTime() : 0;
        const expiresAt = (rawExpiry > MIN_VALID_DATE)
          ? new Date(rawExpiry)
          : new Date(this.parseCertificateMetadata(cert.fullchain).expiresAt);
        if (expiresAt >= new Date()) {
          const certData = { cert: cert.fullchain, key: cert.privateKey, ca: null };
          this.certificateCache.set(hostname, { data: certData, timestamp: Date.now() });
          logger.info(`[CertManager] ✓ Certificat exact depuis la BDD: ${hostname} (expire: ${expiresAt.toISOString()})`);
          return certData;
        }
        logger.info(`[CertManager] WARNING: Certificat expiré pour ${hostname}`);
      }

      logger.info(`[CertManager] ✗ Aucun certificat disponible pour: ${hostname}`);
      return null;
    } catch (error) {
      logger.error(`[CertManager] Erreur chargement certificat ${hostname}:`, error);
      return null;
    }
  }

  /**
   * Stocker un certificat généré par certbot/ACME en BDD
   * @param {number} domainId - ID du domaine
   * @param {string} certPath - Chemin vers fullchain.pem
   * @param {string} keyPath - Chemin vers privkey.pem
   */
  async storeCertbotCertificateInDB(domainId, certPath, keyPath) {
    try {
      logger.info(`[CertManager] Lecture du certificat certbot...`);

      // Lire les fichiers générés par certbot
      const fullchain = await fs.readFile(certPath, 'utf-8');
      const privateKey = await fs.readFile(keyPath, 'utf-8');

      // Extraire les métadonnées du certificat
      const { issuer, issuedAt, expiresAt } = this.parseCertificateMetadata(fullchain);

      // Stocker en BDD
      await database.storeCertificateInDB(
        domainId,
        fullchain,
        privateKey,
        issuer,
        issuedAt,
        expiresAt,
        'acme'
      );

      logger.info(`[CertManager] ✓ Certificat certbot stocké en BDD pour domaine ID ${domainId}`);

      // Invalider le cache pour ce domaine
      const domain = await database.getDomainById(domainId);
      if (domain) {
        this.certificateCache.delete(domain.hostname);
        if (this.afterCertStored) this.afterCertStored(domain.hostname);
      }

      return true;
    } catch (error) {
      logger.error(`[CertManager] Erreur stockage certificat certbot:`, error);
      return false;
    }
  }

  /**
   * Stocker un certificat uploadé manuellement en BDD
   * @param {number} domainId
   * @param {string} fullchain - Contenu PEM du fullchain
   * @param {string} privateKey - Contenu PEM de la clé privée
   */
  async storeManualCertificateInDB(domainId, fullchain, privateKey) {
    try {
      logger.info(`[CertManager] Stockage certificat manuel pour domaine ID ${domainId}...`);

      // Extraire les métadonnées
      const { issuer, issuedAt, expiresAt } = this.parseCertificateMetadata(fullchain);

      // Stocker en BDD
      await database.storeCertificateInDB(
        domainId,
        fullchain,
        privateKey,
        issuer,
        issuedAt,
        expiresAt,
        'manual'
      );

      logger.info(`[CertManager] ✓ Certificat manuel stocké en BDD pour domaine ID ${domainId}`);

      // Invalider le cache + SNI context
      const domain = await database.getDomainById(domainId);
      if (domain) {
        this.certificateCache.delete(domain.hostname);
        if (this.afterCertStored) this.afterCertStored(domain.hostname);
      }

      return true;
    } catch (error) {
      logger.error(`[CertManager] Erreur stockage certificat manuel:`, error);
      throw error;
    }
  }

  /**
   * Parser les métadonnées d'un certificat PEM
   * @param {string} certPEM - Certificat au format PEM
   * @returns {object} - {issuer, issuedAt, expiresAt}
   */
  parseCertificateMetadata(certPEM) {
    try {
      const x509 = new crypto.X509Certificate(certPEM);
      const issuer = x509.issuer || 'Unknown';

      // new Date(null) silently returns epoch 0 — guard explicitly so a cert
      // with a missing/unparseable validTo doesn't store "1970-01-01" in the DB.
      const validToDate = x509.validTo ? new Date(x509.validTo) : null;
      if (!validToDate || isNaN(validToDate.getTime()) || validToDate.getTime() === 0) {
        throw new Error(`Unparseable certificate validTo: ${x509.validTo}`);
      }

      const validFromDate = x509.validFrom ? new Date(x509.validFrom) : null;
      const issuedAt = (validFromDate && !isNaN(validFromDate.getTime()) && validFromDate.getTime() !== 0)
        ? validFromDate.toISOString()
        : new Date().toISOString();
      const expiresAt = validToDate.toISOString();

      return { issuer, issuedAt, expiresAt };
    } catch (error) {
      logger.error('[CertManager] Erreur parsing certificat:', error);
      return {
        issuer: 'Unknown',
        issuedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString()
      };
    }
  }

  /**
   * Invalider le cache pour un domaine spécifique
   * @param {string} hostname
   */
  invalidateCache(hostname) {
    this.certificateCache.delete(hostname);
    logger.info(`[CertManager] Cache invalidé pour: ${hostname}`);
  }

  /**
   * Vider tout le cache
   */
  clearCache() {
    this.certificateCache.clear();
    logger.info(`[CertManager] Cache complet vidé`);
  }

  /**
   * Obtenir les statistiques des certificats
   * @returns {object}
   */
  async getStats() {
    const expiringCerts = await database.getExpiringCertificates(30);

    return {
      cacheSize: this.certificateCache.size,
      expiringIn30Days: expiringCerts.length,
      certificates: expiringCerts
    };
  }

  /**
   * Charger un certificat depuis la BDD UNIQUEMENT
   * @param {string} hostname
   * @returns {object|null}
   */
  async loadCertificate(hostname) {
    // Charger UNIQUEMENT depuis la BDD (pas de fallback fichiers)
    const certFromDB = await this.loadCertificateFromDB(hostname);
    if (certFromDB) {
      return certFromDB;
    }

    logger.info(`[CertManager] ✗ Aucun certificat disponible en BDD pour: ${hostname}`);
    return null;
  }
}

export const certificateManager = new CertificateManager();
