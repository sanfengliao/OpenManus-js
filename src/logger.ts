import { createLogger, format, transports } from 'winston';
import { join } from 'path';
import { PROJECT_ROOT } from './config';

// 默认打印级别
let printLevel: string = 'info';

/**
 * 配置日志级别和输出
 * @param printLevel 控制台输出级别
 * @param logfileLevel 文件日志级别
 * @param name 日志文件名前缀
 */
export function defineLogLevel(
  printLevel: string = 'info',
  logfileLevel: string = 'debug',
  name?: string
) {
  // 更新全局打印级别
  printLevel = printLevel.toLowerCase();

  // 生成日志文件名
  const currentDate = new Date();
  const formattedDate = currentDate.toISOString()
    .replace(/[:.]/g, '')
    .slice(0, 14);
  const logName = name ? `${name}_${formattedDate}` : formattedDate;

  // 创建格式化器
  const logFormat = format.combine(
    format.timestamp(),
    format.errors({ stack: true }),
    format.printf(({ timestamp, level, message, stack }) => {
      const formattedMessage = stack || message;
      return `${timestamp} | ${level.toUpperCase()} | ${formattedMessage}`;
    })
  );

  // 创建日志记录器
  return createLogger({
    level: printLevel,
    format: logFormat,
    transports: [
      // 控制台输出
      new transports.Console({
        level: printLevel,
        format: format.combine(
          format.colorize(),
          format.printf(({ timestamp, level, message, stack }) => {
            const formattedMessage = stack || message;
            return `${timestamp} | ${level} | ${formattedMessage}`;
          })
        )
      }),
      // 文件输出
      new transports.File({
        filename: join(PROJECT_ROOT, 'logs', `${logName}.log`),
        level: logfileLevel
      })
    ]
  });
}

// 导出默认日志实例
export const logger = defineLogLevel();

// 使用示例
if (require.main === module) {
  const main = async () => {
    logger.info('Starting application');
    logger.debug('Debug message');
    logger.warn('Warning message');
    logger.error('Error message');

    try {
      throw new Error('Test error');
    } catch (error) {
      if (error instanceof Error) {
        logger.error('An error occurred:', { error });
      }
    }
  };

  main().catch(console.error);
}

