import { createModuleLogger } from "../utils/logger.js";

const log = createModuleLogger("errorHandler");

export const notFound = (req, res, next) => {
  const error = new Error(`Not Found - ${req.originalUrl}`);
  res.status(404);
  next(error);
};

export const errorHandler = (err, req, res, next) => {
  const statusCode = res.statusCode !== 200 ? res.statusCode : 500;

  // سجّل التفاصيل الكاملة عبر الـlogger (الحقول الحساسة محجوبة تلقائياً)
  log.error(
    {
      err: err.message,
      stack: err.stack,
      path: req.originalUrl,
      method: req.method,
      statusCode,
      userId: req.user?.id,
      ip: req.ip,
    },
    "Request error",
  );

  const response = {
    error: getErrorType(statusCode),
    message: getSafeErrorMessage(statusCode, err),
  };

  res.status(statusCode).json(response);
};

const getErrorType = (statusCode) => {
  switch (statusCode) {
    case 400:
      return "Bad Request";
    case 401:
      return "Unauthorized";
    case 403:
      return "Forbidden";
    case 404:
      return "Not Found";
    case 409:
      return "Conflict";
    case 429:
      return "Too Many Requests";
    case 422:
      return "Validation Error";
    case 500:
    default:
      return "Internal Server Error";
  }
};

const getSafeErrorMessage = (statusCode, err) => {
  if (err.isOperational && err.safeMessage) {
    return err.safeMessage;
  }
  switch (statusCode) {
    case 400:
      return "The request is invalid or malformed";
    case 401:
      return "Authentication is required or token is invalid";
    case 403:
      return "You do not have permission to perform this action";
    case 404:
      return "The requested resource was not found";
    case 409:
      return "The request conflicts with existing data";
    case 429:
      return "Too many requests, please try again later";
    case 422:
      return "The provided data failed validation";
    case 500:
    default:
      return "An unexpected error occurred on the server";
  }
};
