import { describe, expect, it } from 'vitest';
import { loginFailureMessage } from './dashboardUi.jsx';

describe('interfejs dostępu', () => {
  it('wyjaśnia blokadę logowania wraz z czasem następnej próby', () => {
    expect(loginFailureMessage({ status: 429, retryAfterSeconds: 900 })).toBe('Zbyt wiele prób. Spróbuj ponownie za około 15 min.');
    expect(loginFailureMessage({ status: 429 })).toBe('Zbyt wiele prób. Spróbuj ponownie później.');
  });

  it('nie ujawnia technicznej przyczyny niedostępności ochrony logowania', () => {
    expect(loginFailureMessage({ status: 503 })).toBe('Ochrona logowania jest chwilowo niedostępna. Spróbuj ponownie później.');
  });
});
