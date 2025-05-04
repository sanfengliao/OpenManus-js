interface RetryConfig {
  attempts?: number;          // Maximum retry attempts
  delay?: {                   // Delay configuration
    min: number;           // Minimum delay (milliseconds)
    max: number;           // Maximum delay (milliseconds)
  };
  errorTypes?: Array<new (...args: any[]) => Error>;  // Error types that need to be retried
}

/**
* Generate random delay time
*/
function getRandomDelay(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
* Determine if an error should be retried
*/
function shouldRetry(error: any, errorTypes: Array<new (...args: any[]) => Error>): boolean {
  return errorTypes.some(errorType => error instanceof errorType);
}

/**
* Delay execution
*/
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
* Retry wrapper function
*/
export function withRetry<T extends (...args: any[]) => Promise<any>>(
  func: T,
  config: RetryConfig = {}
): T {
  const {
    attempts = 6,
    delay: delayConfig = { min: 1000, max: 60000 },
    errorTypes = [Error]
  } = config;

  return async function (this: any, ...args: Parameters<T>): Promise<ReturnType<T>> {
    let lastError: any;

    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        return await func.apply(this, args);
      } catch (error) {
        if (!shouldRetry(error, errorTypes)) {
          throw error;
        }

        lastError = error;

        if (attempt < attempts) {
          const delayMs = getRandomDelay(delayConfig.min, delayConfig.max);
          console.log(
            `Attempt ${attempt}/${attempts} failed. ` +
            `Retrying in ${delayMs}ms...`
          );
          await delay(delayMs);
        }
      }
    }

    throw lastError;
  } as T;
}


export function retry<T extends (...args: any[]) => Promise<any>>(config: RetryConfig) {
  return function(
    target: T,
    context: ClassMethodDecoratorContext
  ) {
    return withRetry(target, config);
  };
}


