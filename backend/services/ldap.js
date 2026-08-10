// @ts-check
import ldap from 'ldapjs';
import { config } from '../config/config.js';
import { logger } from '../utils/logger.js';

class LDAPService {
  constructor() {
    this.config = config.ldap;
  }

  /**
   * SECURITY FIX: Escape LDAP special characters to prevent LDAP injection
   * Reference: https://tools.ietf.org/search/rfc4515#section-3
   * @param {string} str - String to escape
   * @returns {string} - Escaped string safe for LDAP queries
   */
  escapeLDAPFilter(str) {
    if (typeof str !== 'string') {
      return '';
    }

    // Escape special LDAP filter characters
    return str
      .replace(/\\/g, '\\5c')   // Backslash
      .replace(/\*/g, '\\2a')   // Asterisk
      .replace(/\(/g, '\\28')   // Left parenthesis
      .replace(/\)/g, '\\29')   // Right parenthesis
      .replace(/\0/g, '\\00')   // NUL character
      .replace(/\//g, '\\2f');  // Forward slash (optional but recommended)
  }

  /**
   * Escape DN (Distinguished Name) components
   * @param {string} str - String to escape
   * @returns {string} - Escaped DN component
   */
  escapeLDAPDN(str) {
    if (typeof str !== 'string') {
      return '';
    }

    // Escape DN special characters
    return str
      .replace(/\\/g, '\\\\')  // Backslash
      .replace(/,/g, '\\,')    // Comma
      .replace(/\+/g, '\\+')   // Plus
      .replace(/"/g, '\\"')    // Quote
      .replace(/</g, '\\<')    // Less than
      .replace(/>/g, '\\>')    // Greater than
      .replace(/;/g, '\\;')    // Semicolon
      .replace(/=/g, '\\=')    // Equals
      .replace(/\0/g, '\\00'); // NUL
  }

  createClient() {
    return ldap.createClient({
      url: this.config.url,
      timeout: this.config.timeout,
      connectTimeout: this.config.connectTimeout,
      reconnect: true
    });
  }

  async authenticate(username, password) {
    return new Promise((resolve, reject) => {
      const client = this.createClient();
      const userDN = this.constructUserDN(username);

      logger.info('[LDAP] Starting authentication...');
      logger.info('   Username provided:', username);
      logger.info('   Constructed UserDN:', userDN);
      logger.info('   LDAP URL:', this.config.url);
      logger.info('   Base DN:', this.config.baseDN);

      client.bind(userDN, password, async (err) => {
        if (err) {
          logger.error('[LDAP] Bind failed');
          logger.error('   Error code:', err.code);
          logger.error('   Error message:', err.message);
          client.unbind();
          return reject({
            code: 'AUTH_FAILED',
            message: 'Invalid credentials'
          });
        }

        logger.info('[LDAP] Bind successful');

        try {
          logger.info('[LDAP] Fetching user info...');
          const userInfo = await this.getUserInfo(client, username);
          logger.info('[LDAP] User info retrieved:', userInfo.displayName);
          logger.info('   User real DN:', userInfo.dn);

          logger.info('[LDAP] Checking user role and groups...');
          logger.info('   Admin group DN:', this.config.adminGroup);
          logger.info('   User group DN:', this.config.userGroup);
          logger.info('   Require group membership:', this.config.requireGroup);

          const realUserDN = userInfo.dn || userDN;
          const role = await this.getUserRole(client, realUserDN);
          logger.info('[LDAP] Role assigned:', role);

          client.unbind();

          resolve({
            username,
            displayName: userInfo.displayName || username,
            email: userInfo.mail || '',
            role,
            groups: userInfo.groups || []
          });
        } catch (error) {
          logger.error('[LDAP] Error during authentication');
          logger.error('   Error code:', error.code);
          logger.error('   Error message:', error.message);
          client.unbind();
          reject(error);
        }
      });
    });
  }

  constructUserDN(username) {
    if (username.includes('@')) {
      return username;
    }
    if (username.includes('\\\\')) {
      const [domain, user] = username.split('\\\\');
      return `${user}@${domain}`;
    }

    const domainParts = this.config.baseDN.match(/dc=([^,]+)/gi);
    if (domainParts) {
      const domain = domainParts.map(part => part.replace(/dc=/i, '')).join('.');
      return `${username}@${domain}`;
    }

    return `cn=${username},${this.config.baseDN}`;
  }

  async getUserInfo(client, username) {
    return new Promise((resolve, reject) => {
      // SECURITY FIX: Escape username to prevent LDAP injection
      const escapedUsername = this.escapeLDAPFilter(username);

      const searchFilter = `(|(cn=${escapedUsername})(sAMAccountName=${escapedUsername})(userPrincipalName=${escapedUsername}))`;
      const opts = {
        filter: searchFilter,
        scope: 'sub',
        attributes: ['cn', 'displayName', 'mail', 'memberOf', 'sAMAccountName', 'userPrincipalName', 'distinguishedName']
      };

      client.search(this.config.baseDN, opts, (err, res) => {
        if (err) {
          return reject({
            code: 'SEARCH_FAILED',
            message: 'Failed to search user information'
          });
        }

        let userInfo = {};

        res.on('searchEntry', (entry) => {
          const obj = entry.pojo.attributes.reduce((acc, attr) => {
            acc[attr.type] = attr.values.length === 1 ? attr.values[0] : attr.values;
            return acc;
          }, {});

          userInfo = {
            displayName: obj.displayName || obj.cn,
            mail: obj.mail,
            groups: Array.isArray(obj.memberOf) ? obj.memberOf : (obj.memberOf ? [obj.memberOf] : []),
            sAMAccountName: obj.sAMAccountName,
            dn: obj.distinguishedName
          };
        });

        res.on('error', (err) => {
          reject({
            code: 'SEARCH_ERROR',
            message: err.message
          });
        });

        res.on('end', (result) => {
          if (result.status !== 0) {
            reject({
              code: 'SEARCH_FAILED',
              message: 'User not found'
            });
          } else {
            resolve(userInfo);
          }
        });
      });
    });
  }

  async getUserRole(client, userDN) {
    return new Promise((resolve, reject) => {
      logger.info('[LDAP] Starting group membership check...');
      logger.info('   User DN:', userDN);

      const opts = {
        filter: `(member=${userDN})`,
        scope: 'sub',
        attributes: ['cn', 'distinguishedName']
      };

      logger.info('   Search filter:', opts.filter);
      logger.info('   Search base:', this.config.baseDN);

      client.search(this.config.baseDN, opts, (err, res) => {
        if (err) {
          logger.error('[LDAP] Group search failed:', err.message);
          if (this.config.requireGroup) {
            return reject({
              code: 'GROUP_CHECK_FAILED',
              message: 'Unable to verify group membership'
            });
          }
          return resolve('user');
        }

        const groups = [];

        res.on('searchEntry', (entry) => {
          const dn = entry.pojo.attributes.find(attr => attr.type === 'distinguishedName');
          if (dn) {
            const groupDN = dn.values[0];
            groups.push(groupDN);
            logger.info('   Found group:', groupDN);
          }
        });

        res.on('error', (err) => {
          logger.error('[LDAP] Group search error:', err.message);
          if (this.config.requireGroup) {
            reject({
              code: 'GROUP_CHECK_FAILED',
              message: 'Error checking group membership'
            });
          } else {
            resolve('user');
          }
        });

        res.on('end', async () => {
          logger.info(`[LDAP] Found ${groups.length} direct group(s)`);

          const isAdmin = groups.some(g => g === this.config.adminGroup);
          const isUser = groups.some(g => g === this.config.userGroup);

          logger.info('   Checking against admin group:', this.config.adminGroup);
          logger.info('   Direct admin membership?', isAdmin);
          logger.info('   Checking against user group:', this.config.userGroup);
          logger.info('   Direct user membership?', isUser);

          if (isAdmin) {
            logger.info('[LDAP] User has ADMIN role (direct)');
            return resolve('admin');
          } else if (isUser) {
            logger.info('[LDAP] User has USER role (direct)');
            return resolve('user');
          }

          logger.info('[LDAP] Checking nested group membership...');
          try {
            const nestedRole = await this.checkNestedGroups(client, groups);
            if (nestedRole) {
              logger.info('[LDAP] User has', nestedRole.toUpperCase(), 'role (nested)');
              return resolve(nestedRole);
            }
          } catch (err) {
            logger.error('[LDAP] Nested check failed:', err.message);
          }

          if (this.config.requireGroup) {
            logger.error('[LDAP] User not in any authorized group');
            logger.error('   Required groups: Proxy_Admins OR Proxy_Users');
            logger.error('   User groups found:', groups);
            reject({
              code: 'UNAUTHORIZED_GROUP',
              message: 'User is not member of authorized groups (Proxy_Admins or Proxy_Users)'
            });
          } else {
            logger.info('[LDAP] No group required, default USER role');
            resolve('user');
          }
        });
      });
    });
  }

  async checkNestedGroups(client, userGroups) {
    for (const groupDN of userGroups) {
      logger.info('   Checking nested membership for:', groupDN);

      try {
        const isInAdminGroup = await this.isGroupMemberOf(client, groupDN, this.config.adminGroup);
        if (isInAdminGroup) {
          logger.info('   Group is member of Proxy_Admins!');
          return 'admin';
        }

        const isInUserGroup = await this.isGroupMemberOf(client, groupDN, this.config.userGroup);
        if (isInUserGroup) {
          logger.info('   Group is member of Proxy_Users!');
          return 'user';
        }
      } catch (err) {
        logger.error('   Error checking nested group:', err.message);
      }
    }

    return null;
  }

  async isGroupMemberOf(client, groupDN, targetGroupDN) {
    return new Promise((resolve, reject) => {
      const opts = {
        filter: `(member=${groupDN})`,
        scope: 'sub',
        attributes: ['distinguishedName']
      };

      client.search(this.config.baseDN, opts, (err, res) => {
        if (err) {
          return reject(err);
        }

        let found = false;

        res.on('searchEntry', (entry) => {
          const dn = entry.pojo.attributes.find(attr => attr.type === 'distinguishedName');
          if (dn && dn.values[0] === targetGroupDN) {
            found = true;
          }
        });

        res.on('error', (err) => {
          reject(err);
        });

        res.on('end', () => {
          resolve(found);
        });
      });
    });
  }

  async syncAllUsers() {
    return new Promise((resolve, reject) => {
      const client = this.createClient();

      client.on('error', (err) => {
        reject(new Error(err.message || 'Connection error'));
      });

      client.bind(this.config.bindDN, this.config.bindPassword, (err) => {
        if (err) {
          client.destroy();
          return reject(new Error('Bind failed: ' + err.message));
        }

        // Compatible AD + OpenLDAP
        const filter = '(|(objectClass=user)(objectClass=inetOrgPerson))';
        const opts = {
          filter,
          scope: 'sub',
          attributes: ['sAMAccountName', 'uid', 'cn', 'displayName', 'mail', 'memberOf', 'distinguishedName'],
        };

        client.search(this.config.baseDN, opts, (err, res) => {
          if (err) {
            client.unbind();
            return reject(new Error('Search failed: ' + err.message));
          }

          const users = [];

          res.on('searchEntry', (entry) => {
            const obj = entry.pojo.attributes.reduce((acc, attr) => {
              acc[attr.type] = attr.values.length === 1 ? attr.values[0] : attr.values;
              return acc;
            }, {});

            const username = obj.sAMAccountName || obj.uid || obj.cn;
            if (!username || typeof username !== 'string') return;

            const groups = Array.isArray(obj.memberOf)
              ? obj.memberOf
              : obj.memberOf ? [obj.memberOf] : [];

            const isAdmin = this.config.adminGroup && groups.some(g => g === this.config.adminGroup);
            const isUser = this.config.userGroup && groups.some(g => g === this.config.userGroup);

            if (this.config.requireGroup && this.config.adminGroup && this.config.userGroup) {
              if (!isAdmin && !isUser) return;
            }

            users.push({
              username,
              displayName: obj.displayName || obj.cn || username,
              email: obj.mail || '',
              role: isAdmin ? 'admin' : 'user',
            });
          });

          res.on('error', (err) => {
            client.unbind();
            reject(new Error('Search error: ' + err.message));
          });

          res.on('end', () => {
            client.unbind();
            resolve(users);
          });
        });
      });
    });
  }

  async verifyConnection() {
    return new Promise((resolve, reject) => {
      const client = this.createClient();

      client.bind(this.config.bindDN, this.config.bindPassword, (err) => {
        if (err) {
          client.unbind();
          return reject({
            code: 'CONNECTION_FAILED',
            message: 'Failed to connect to LDAP server'
          });
        }

        client.unbind();
        resolve(true);
      });
    });
  }
}

export const ldapAuth = new LDAPService();
