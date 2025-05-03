export function retry(options: { maxAttempts: number, backoff: 'exponential' }) {
  return function (
    _target: any,
    _propertyKey: string,
    descriptor: PropertyDescriptor,
  ) {
    const originalMethod = descriptor.value

    descriptor.value = async function (...args: any[]) {
      let attempt = 0
      while (attempt < options.maxAttempts) {
        try {
          return await originalMethod.apply(this, args)
        }
        catch (error) {
          attempt++
          if (attempt === options.maxAttempts) {
            throw error
          }
          const delay = 2 ** attempt * 1000
          await new Promise(resolve => setTimeout(resolve, delay))
        }
      }
    }

    return descriptor
  }
}
