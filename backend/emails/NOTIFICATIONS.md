# 📧 NebulaProxy - Notification System Overview

## 👤 USER Notifications vs 👨‍💼 ADMIN Notifications

### 👤 USER NOTIFICATIONS (Individual Users)

Ces notifications sont envoyées aux **utilisateurs individuels** et peuvent être **configurées** via leurs préférences.

#### 🔐 Security & Account
| Type | Description | Template | Configurable |
|------|-------------|----------|--------------|
| `new_ip_login` | Connexion depuis nouvelle IP | new-ip-login.html | ✅ Oui |
| `password_changes` | Confirmation changement MDP | password-changed.html | ✅ Oui |
| `security` | Autres alertes sécurité | - | ✅ Oui |

**Destinataire:** L'utilisateur concerné
**Déclenchement:** Automatique lors de l'action

---

#### 🌐 Domain Alerts
| Type | Description | Template | Configurable |
|------|-------------|----------|--------------|
| `domain_alerts` | Domain down/restored | domain-down.html, domain-restored.html | ✅ Oui |

**Destinataire:** Owner du domain
**Déclenchement:** Après 10 minutes de downtime (évite faux positifs)
**Note:** Un seul email par incident

---

#### 🔒 SSL Alerts
| Type | Description | Template | Configurable |
|------|-------------|----------|--------------|
| `ssl_alerts` | Certificat expire bientôt | ssl-expiring.html | ✅ Oui |

**Destinataire:** Owner du domain
**Déclenchement:** À 7 jours, 3 jours, 1 jour avant expiration

---

#### 👥 Team Alerts
| Type | Description | Template | Configurable |
|------|-------------|----------|--------------|
| `team_alerts` | Domain team down, invitations | team-domain-down.html, team-invitation.html | ✅ Oui |

**Destinataire:** Tous les membres du team
**Déclenchement:** Selon événement (down >10min, invitation, etc.)
**Note:** Chaque user peut désactiver les team notifications

---

#### 📊 Quota Warnings
| Type | Description | Template | Configurable |
|------|-------------|----------|--------------|
| `quota_warnings` | Approche limite de quotas | quota-warning.html | ✅ Oui |

**Destinataire:** L'utilisateur concerné
**Déclenchement:** À 80%, 90%, 100% du quota

---

### 👨‍💼 ADMIN-ONLY NOTIFICATIONS (Administrateurs Uniquement)

Ces notifications sont envoyées **uniquement aux administrateurs** et ne peuvent **PAS** être désactivées (critiques pour le système).

#### ⚠️ System Alerts
| Type | Description | Template | Configurable |
|------|-------------|----------|--------------|
| `system_alerts` | Erreurs système critiques | - | ❌ Non |
| `critical_errors` | Exceptions non gérées | - | ❌ Non |

**Destinataires:** TOUS les admins
**Déclenchement:** Erreurs critiques, crashes, failures
**Importance:** Critique

---

#### 💾 Backup Alerts
| Type | Description | Template | Configurable |
|------|-------------|----------|--------------|
| `backup_alerts` | Échec backup | backup-failed.html | ❌ Non |

**Destinataires:** TOUS les admins
**Déclenchement:** Quand backup scheduled échoue
**Importance:** Haute

---

#### ⚡ Resource Alerts
| Type | Description | Template | Configurable |
|------|-------------|----------|--------------|
| `high_resources` | CPU/RAM/Disk élevé | high-resources.html | ❌ Non |

**Destinataires:** TOUS les admins
**Déclenchement:** Quand seuils dépassés pendant >5min
**Seuils par défaut:**
- CPU > 80%
- RAM > 85%
- Disk > 90%

---

#### 🔄 Update Alerts
| Type | Description | Template | Configurable |
|------|-------------|----------|--------------|
| `update_available` | Mise à jour disponible | - | ❌ Non |

**Destinataires:** TOUS les admins
**Déclenchement:** Nouvelle version détectée

---

#### 🗄️ Database Alerts
| Type | Description | Template | Configurable |
|------|-------------|----------|--------------|
| `database_issues` | Problèmes DB | - | ❌ Non |

**Destinataires:** TOUS les admins
**Déclenchement:** Connexion failed, performance dégradée, etc.

---

## 🔧 Configuration Système

### Préférences Utilisateur (user_notification_preferences)

```json
{
  // USER notifications (configurables)
  "security": true,           // Alertes sécurité
  "new_ip_login": true,       // Nouvelle IP
  "password_changes": true,   // Changement MDP
  "domain_alerts": true,      // Domain up/down
  "ssl_alerts": true,         // SSL expiration
  "team_alerts": true,        // Notifications team
  "quota_warnings": true,     // Quotas

  // ADMIN notifications (NON configurables, pas dans préférences user)
  // Ces types ne peuvent PAS être désactivés
}
```

### Code d'Exemple

#### Envoyer notification USER

```javascript
import { emailService } from './emails/emailService.js';

// La fonction vérifie automatiquement les préférences user
await emailService.sendDomainDownAlert(userId, userEmail, {
  hostname: 'example.com',
  id: 123,
  firstFailedAt: new Date(),
  downDuration: '15 minutes',
  lastError: 'Connection timeout',
  backend_url: 'http://backend:3000'
});
```

#### Envoyer notification ADMIN

```javascript
import { emailService } from './emails/emailService.js';

// Envoie automatiquement à TOUS les admins
await emailService.sendBackupFailedAlert({
  backupType: 'Scheduled',
  scheduledTime: new Date(),
  failedAt: new Date(),
  errorMessage: 'Disk full',
  lastSuccessfulBackup: new Date('2026-02-03')
});

// Ou pour alertes personnalisées
await emailService.sendSystemAlert({
  title: 'Critical Error',
  message: 'Database connection lost',
  severity: 'critical',
  details: {
    component: 'PostgreSQL',
    duration: '2 minutes'
  }
});
```

## 📋 Résumé des Règles

### ✅ Quand envoyer à l'utilisateur:
- ✅ Concerne SON compte (sécurité, MDP)
- ✅ Concerne SES domains (down, SSL)
- ✅ Concerne SES teams (si activé)
- ✅ Concerne SES quotas
- ✅ L'user PEUT désactiver ces notifications

### ✅ Quand envoyer aux admins:
- ✅ Concerne le SYSTÈME (backups, resources)
- ✅ Erreurs CRITIQUES (crashes, DB issues)
- ✅ Mises à jour SYSTÈME
- ✅ Affecte TOUS les users
- ✅ Ne peut PAS être désactivé

## 🚀 Implémentation

### 1. Service Email (emailService.js)

```javascript
// Auto-détecte si c'est admin-only
isAdminOnlyNotification(type) // Vérifie notification-types.js

// Récupère tous les emails admin
getAdminEmails() // FROM users WHERE role='admin'
```

### 2. Configuration (notification-types.js)

Fichier central qui définit:
- Type de notification
- Recipients (user, domain_owner, team_members, admins_only)
- Si configurable par user
- Template associé

### 3. Base de Données

```sql
-- Préférences USER uniquement
SELECT preferences
FROM user_notification_preferences
WHERE user_id = 123;

-- Liste ADMINS
SELECT email
FROM users
WHERE role = 'admin';
```

## 🎯 Best Practices

1. **ADMIN notifications:**
   - ❌ JAMAIS vérifier les préférences user
   - ✅ TOUJOURS envoyer à tous les admins
   - ✅ Préfixer subject avec `[ADMIN]`
   - ✅ Utiliser pour problèmes système

2. **USER notifications:**
   - ✅ TOUJOURS vérifier préférences
   - ✅ Envoyer uniquement aux concernés
   - ✅ Permettre désactivation
   - ✅ Respecter la règle des 10min (domain down)

3. **TEAM notifications:**
   - ✅ Vérifier `team_notifications_enabled` global
   - ✅ Vérifier `team_alerts` dans préférences
   - ✅ Envoyer à tous les membres si activé

## 📊 Monitoring

```sql
-- Emails envoyés par type
SELECT
  notification_type,
  status,
  COUNT(*) as count
FROM email_logs
WHERE sent_at > NOW() - INTERVAL '24 hours'
GROUP BY notification_type, status
ORDER BY count DESC;

-- Préférences users les plus communes
SELECT
  jsonb_object_keys(preferences) as pref_key,
  COUNT(*) as users_enabled
FROM user_notification_preferences
WHERE preferences->>jsonb_object_keys(preferences) = 'true'
GROUP BY pref_key;
```
