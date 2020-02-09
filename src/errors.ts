import { ErrorObject } from 'ajv';

export class ParamValidationError extends Error {
  key: string;
  error: ErrorObject;

  constructor(key: string, error: ErrorObject) {
    super('Failed to parse param');
    this.key = key;
    this.error = error;
  }
}

export class SchemaValidationError extends Error {
  errors: ErrorObject[];

  constructor(errors: ErrorObject[]) {
    super('Failed to parse schema');
    this.errors = errors;
  }
}
