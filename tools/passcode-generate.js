#!/usr/bin/env node
import { randomBytes } from 'node:crypto';
import { createPasscodeVerifier } from '../api/_lib/session.js';

const passcode = randomBytes(24).toString('base64url');
const verifier = await createPasscodeVerifier(passcode);

process.stdout.write([
  'Zapisz passcode w menedżerze haseł. Nie dodawaj go do Vercela ani repozytorium.',
  `PASSCODE=${passcode}`,
  '',
  'Do Vercela dodaj wyłącznie poniższy weryfikator:',
  `APP_PASSCODE_SCRYPT=${verifier}`,
  '',
].join('\n'));
