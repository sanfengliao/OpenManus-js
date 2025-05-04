
import prompts from 'prompts'
import { Manus } from './agent/manus'
import { logger } from './logger'

/**
 * Main application function
 */
async function main(): Promise<void> {
  // Create and initialize Manus agent
  const agent = await Manus.create()
  console.log(agent.availableTools.toParams().length)

  try {
    // Get user input using prompts
    const response = await prompts({
      type: 'text',
      name: 'prompt',
      message: 'Enter your prompt',
      validate: value => value.trim().length > 0 ? true : 'Prompt cannot be empty',
    })

    // Check if user cancelled (Ctrl+C)
    if (!response.prompt) {
      logger.warn('Operation cancelled.')
      return
    }

    logger.warn('Processing your request...')
    await agent.run(response.prompt)
    logger.info('Request processing completed.')
  }
  catch (error) {
    if (error instanceof Error && error.name === 'SIGINT') {
      logger.warn('Operation interrupted.')
    }
    else {
      logger.error('An error occurred:', error)
    }
  }
  finally {
    // Ensure agent resources are cleaned up before exiting
    await agent.cleanup()
  }
}

/**
 * Handle process termination
 */
function setupProcessHandlers(): void {
  process.on('SIGINT', () => {
    logger.warn('\nReceived SIGINT. Cleaning up...')
    process.exit(0)
  })

  process.on('unhandledRejection', (error) => {
    logger.error('Unhandled promise rejection:', error)
    process.exit(1)
  })
}

// Set up process handlers and run main function
setupProcessHandlers()
main().catch((error) => {
  logger.error('Fatal error:', error)
  process.exit(1)
})
