/**
 * Custom error for tool-related failures
 */
export class ToolError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ToolError'
    // 修复 TypeScript 中继承 Error 的问题
  }
}

/**
 * Base exception for all OpenManus errors
 */
export class OpenManusError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OpenManusError'
  }
}

/**
 * Exception raised when the token limit is exceeded
 */
export class TokenLimitExceeded extends OpenManusError {
  constructor(message: string) {
    super(message)
    this.name = 'TokenLimitExceeded'
  }
}
