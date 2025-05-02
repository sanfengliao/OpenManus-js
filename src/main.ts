import { config } from "dotenv"
import { logger } from "./logger"

async function main() {
  config()
  logger.info('Debug message')
}

main()