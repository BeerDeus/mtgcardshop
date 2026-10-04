#!/usr/bin/env node
// Génère une paire de clés VAPID pour les notifications « recherche terminée ».
//   node gen-vapid.mjs [mailto:toi@exemple.fr]
// Copie les 3 lignes affichées dans les variables d'environnement de l'hébergeur (Hostinger › Node.js › Variables), puis redéploie.
// Garde la clé privée secrète : ne la mets ni dans GitHub ni dans l'appli. Si tu la changes, les abonnements existants cessent de marcher
// (on les réactive simplement dans Réglages › Notifications).
import { generateKeyPairSync } from 'node:crypto';
const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const j = privateKey.export({ format: 'jwk' });
const pub = Buffer.concat([Buffer.from([4]), Buffer.from(j.x, 'base64url'), Buffer.from(j.y, 'base64url')]).toString('base64url');
const subject = process.argv[2] || 'mailto:ton-adresse@exemple.fr';
console.log(`VAPID_PUBLIC_KEY=${pub}\nVAPID_PRIVATE_KEY=${j.d}\nVAPID_SUBJECT=${subject}`);
if (!process.argv[2]) console.log('\n→ remplace VAPID_SUBJECT par ton adresse (mailto:…) ou l\'adresse https de ton site.');
