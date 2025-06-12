import * as readline from 'node:readline'
import { Manus } from './agent/manus'
import { config } from './config'
import { FlowFactory, FlowType } from './flow/flow-factory'
import { logger } from './logger'

function createReadlineInterface(): readline.Interface {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })
}

function getInput(prompt: string): Promise<string> {
  const rl = createReadlineInterface()
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close()
      resolve(answer)
    })
  })
}

async function runFlow(): Promise<void> {
  const agents: { [key: string]: any } = {
    manus: new Manus(),
  }

  // if (config..use_data_analysis_agent) {
  //   agents.data_analysis = new DataAnalysis()
  // }

  try {
    const prompt = await getInput('Enter your prompt: ')

    if (!prompt || prompt.trim() === '' || /^\s+$/.test(prompt)) {
      logger.warning('Empty prompt provided.')
      return
    }

    const flow = FlowFactory.createFlow(
      FlowType.PLANNING,
      agents,
    )

    logger.warning('Processing your request...')

    try {
      const startTime = Date.now()

      // Create a timeout promise
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error('Timeout'))
        }, 3600000) // 60 minute timeout (3600 * 1000 ms)
      })

      // Race between flow execution and timeout
      const result = await Promise.race([
        flow.execute(prompt),
        timeoutPromise,
      ])

      const elapsedTime = (Date.now() - startTime) / 1000
      logger.info(`Request processed in ${elapsedTime.toFixed(2)} seconds`)
      logger.info(result)
    } catch (error) {
      if (error instanceof Error && error.message === 'Timeout') {
        logger.error('Request processing timed out after 1 hour')
        logger.info(
          'Operation terminated due to timeout. Please try a simpler request.',
        )
      } else {
        throw error // Re-throw other errors
      }
    }
  } catch (error) {
    if (error instanceof Error && error.message === 'Operation cancelled by user.') {
      logger.info('Operation cancelled by user.')
    } else {
      const errorMessage = error instanceof Error ? error.message : String(error)
      logger.error(`Error: ${errorMessage}`)
    }
  }
}

// Handle process termination signals (equivalent to KeyboardInterrupt in Python)
process.on('SIGINT', () => {
  logger.info('Operation cancelled by user.')
  process.exit(0)
})

process.on('SIGTERM', () => {
  logger.info('Operation terminated.')
  process.exit(0)
})

// Main execution
if (require.main === module) {
  runFlow().catch((error) => {
    const errorMessage = error instanceof Error ? error.message : String(error)
    logger.error(`Unhandled error: ${errorMessage}`)
    process.exit(1)
  })
}
