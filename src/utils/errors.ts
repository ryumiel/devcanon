export class UserError extends Error {
  constructor(
    message: string,
    public readonly filePath?: string,
    public readonly hint?: string,
  ) {
    super(message);
    this.name = "UserError";
  }
}

export class EnvironmentError extends Error {
  constructor(
    message: string,
    public readonly hint?: string,
    public readonly cause?: Error,
  ) {
    super(message);
    this.name = "EnvironmentError";
  }
}
