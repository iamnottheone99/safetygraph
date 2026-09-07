export class AppError extends Error {
  public statusCode: number;
  public errorCode: string;
  public retry: boolean;

  constructor(message: string, statusCode: number = 500, errorCode: string = 'E_INTERNAL', retry: boolean = false) {
    super(message);
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    this.retry = retry;
    Error.captureStackTrace(this, this.constructor);
  }
}
