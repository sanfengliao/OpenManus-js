import prompt from 'prompts'
import { BaseTool } from './base'

export class AskHuman extends BaseTool {
  name: string = 'ask_human'
  description: string = 'Use this tool to ask human for help.'
  parameters: Record<string, any> | undefined = {
    type: 'object',
    properties: {
      inquire: {
        type: 'string',
        description: 'The question you want to ask human.',
      },
    },
    required: ['inquire'],
  }

  async execute(params: any): Promise<any> {
    const res = await prompt({
      type: 'text',
      name: 'answer',
      message: `Bot: ${params.inquire}`,
    })
    return res.answer
  }
}

if (require.main === module) {
  const askHuman = new AskHuman()
  askHuman.execute({ inquire: 'What is your name?' }).then((res) => {
    console.log(res)
  })
}
