export class MissingDatabaseConnectionError extends Error {
  constructor(message = 'database stub') {
    super(message);
    this.name = 'MissingDatabaseConnectionError';
  }
}

export function getDatabase() {
  throw new MissingDatabaseConnectionError();
}
