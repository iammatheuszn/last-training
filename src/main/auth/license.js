'use strict';

const ACTIVE = 'active';

function assertActive(session) {
  if (session?.license?.status === ACTIVE) return;
  const status = String(session?.license?.status || 'inactive').toUpperCase();
  const error = new Error('Licença não autorizada.');
  error.code = `LICENSE_${status}`;
  throw error;
}

module.exports = { assertActive };
