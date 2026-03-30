/**
 * Certificate Manager - Gestion des certificats SSL depuis la BDD
 * Charge automatiquement les certificats depuis PostgreSQL/SQLite
 */

import { database } from './database.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import selfsigned from 'selfsigned';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class CertificateManager {
  constructor() {
    this.certificateCache = new Map();
    this.cacheMaxAge = 5 * 60 * 1000; // 5 minutes
  }

  /**
   * Charger un certificat depuis la BDD (exact match, puis wildcard fallback)
   * @param {string} hostname - Nom de domaine
   * @returns {object|null} - {cert, key, ca} ou null
   */
  async loadCertificateFromDB(hostname) {
    try {
      // Check cache first
      const cached = this.certificateCache.get(hostname);
      if (cached && (Date.now() - cached.timestamp) < this.cacheMaxAge) {
        console.log(`[CertManager] ✓ Certificat depuis le cache: ${hostname}`);
        return cached.data;
      }

      // 1. Try exact domain match in domains table
      const cert = await database.getCertificateByHostname(hostname);
      if (cert && cert.fullchain && cert.privateKey) {
        const expiresAt = new Date(cert.expiresAt || this.parseCertificateMetadata(cert.fullchain).expiresAt);
        if (expiresAt >= new Date()) {
          const certData = { cert: cert.fullchain, key: cert.privateKey, ca: null };
          this.certificateCache.set(hostname, { data: certData, timestamp: Date.now() });
          console.log(`[CertManager] ✓ Certificat exact depuis la BDD: ${hostname} (expire: ${expiresAt.toISOString()})`);
          return certData;
        }
        console.log(`[CertManager] WARNING: Certificat expiré pour ${hostname}`);
      }

      // 2. Try wildcard fallback (*.example.com covers sub.example.com)
      const wildcardCert = await database.getWildcardCertForHostname(hostname);
      if (wildcardCert && wildcardCert.fullchain && wildcardCert.privateKey) {
        const certData = { cert: wildcardCert.fullchain, key: wildcardCert.privateKey, ca: null };
        this.certificateCache.set(hostname, { data: certData, timestamp: Date.now() });
        console.log(`[CertManager] ✓ Wildcard cert (${wildcardCert.wildcardHostname}) couvre ${hostname}`);
        return certData;
      }

      console.log(`[CertManager] ✗ Aucun certificat disponible pour: ${hostname}`);
      return null;
    } catch (error) {
      console.error(`[CertManager] Erreur chargement certificat ${hostname}:`, error);
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
      console.log(`[CertManager] Lecture du certificat certbot...`);

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

      console.log(`[CertManager] ✓ Certificat certbot stocké en BDD pour domaine ID ${domainId}`);

      // Invalider le cache pour ce domaine
      const domain = await database.getDomainById(domainId);
      if (domain) {
        this.certificateCache.delete(domain.hostname);
      }

      return true;
    } catch (error) {
      console.error(`[CertManager] Erreur stockage certificat certbot:`, error);
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
      console.log(`[CertManager] Stockage certificat manuel pour domaine ID ${domainId}...`);

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

      console.log(`[CertManager] ✓ Certificat manuel stocké en BDD pour domaine ID ${domainId}`);

      // Invalider le cache
      const domain = await database.getDomainById(domainId);
      if (domain) {
        this.certificateCache.delete(domain.hostname);
      }

      return true;
    } catch (error) {
      console.error(`[CertManager] Erreur stockage certificat manuel:`, error);
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
      const issuedAt = new Date(x509.validFrom).toISOString();
      const expiresAt = new Date(x509.validTo).toISOString();

      return { issuer, issuedAt, expiresAt };
    } catch (error) {
      console.error('[CertManager] Erreur parsing certificat:', error);
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
    console.log(`[CertManager] Cache invalidé pour: ${hostname}`);
  }

  /**
   * Invalider toutes les entrées de cache pour les sous-domaines d'un wildcard
   * @param {string} wildcardHostname - e.g. *.example.com
   */
  invalidateWildcardCacheEntries(wildcardHostname) {
    const baseDomain = wildcardHostname.replace(/^\*\./, '');
    for (const [key] of this.certificateCache) {
      if (key === baseDomain || key.endsWith('.' + baseDomain)) {
        this.certificateCache.delete(key);
        console.log(`[CertManager] Cache wildcard invalidé pour: ${key}`);
      }
    }
  }

  /**
   * Générer un certificat wildcard auto-signé et le stocker en BDD
   * @param {string} wildcardHostname - e.g. *.example.com
   * @returns {object} - {fullchain, privateKey, issuer, issuedAt, expiresAt}
   */
  async generateWildcardCert(wildcardHostname) {
    const baseDomain = wildcardHostname.replace(/^\*\./, '');

    const attrs = [
      { name: 'commonName', value: wildcardHostname },
      { name: 'organizationName', value: 'NebulaProxy' }
    ];

    const pems = await selfsigned.generate(attrs, {
      days: 825,
      keySize: 2048,
      algorithm: 'sha256',
      extensions: [
        {
          name: 'subjectAltName',
          altNames: [
            { type: 2, value: wildcardHostname },
            { type: 2, value: baseDomain }
          ]
        },
        { name: 'basicConstraints', cA: false },
        { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
        { name: 'extKeyUsage', serverAuth: true }
      ]
    });

    const { issuer, issuedAt, expiresAt } = this.parseCertificateMetadata(pems.cert);
    const resolvedIssuer = 'NebulaProxy Self-Signed';

    await database.storeWildcardCert({
      hostname: wildcardHostname,
      fullchain: pems.cert,
      privateKey: pems.private,
      issuer: resolvedIssuer,
      issuedAt,
      expiresAt,
      certType: 'self-signed',
      autoApply: true
    });

    this.invalidateWildcardCacheEntries(wildcardHostname);
    console.log(`[CertManager] ✓ Wildcard cert auto-signé généré pour ${wildcardHostname}`);

    return { fullchain: pems.cert, privateKey: pems.private, issuer: resolvedIssuer, issuedAt, expiresAt };
  }

  /**
   * Stocker un certificat wildcard uploadé manuellement
   * @param {string} wildcardHostname - e.g. *.example.com
   * @param {string} fullchain - PEM
   * @param {string} privateKey - PEM
   */
  async storeWildcardCertManually(wildcardHostname, fullchain, privateKey) {
    const { issuer, issuedAt, expiresAt } = this.parseCertificateMetadata(fullchain);

    await database.storeWildcardCert({
      hostname: wildcardHostname,
      fullchain,
      privateKey,
      issuer,
      issuedAt,
      expiresAt,
      certType: 'manual',
      autoApply: true
    });

    this.invalidateWildcardCacheEntries(wildcardHostname);
    console.log(`[CertManager] ✓ Wildcard cert manuel stocké pour ${wildcardHostname}`);
  }

  /**
   * Vider tout le cache
   */
  clearCache() {
    this.certificateCache.clear();
    console.log(`[CertManager] Cache complet vidé`);
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

    console.log(`[CertManager] ✗ Aucun certificat disponible en BDD pour: ${hostname}`);
    return null;
  }
}

export const certificateManager = new CertificateManager();
