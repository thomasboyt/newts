import { ErrorObject } from 'ajv';

export class SchemaValidationError extends Error {
  errors: ErrorObject[];

  constructor(errors: ErrorObject[]) {
    super('Failed to parse schema');
    this.errors = errors;
  }
}
