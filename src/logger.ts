import { createConsola } from 'consola';

export const logger = createConsola({
  level: Number(process.env.LOG_LEVEL || 4),
  defaults: {
    tag: 'app',
    type: 'log',
  },
});

