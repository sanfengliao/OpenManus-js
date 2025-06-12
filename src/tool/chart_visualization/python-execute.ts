import { config } from '../../config'
import { ExecuteResult, PythonExecute } from '../python-execute'

/**
 * A tool for executing Python code with timeout and safety restrictions.
 */
export class NormalPythonExecute extends PythonExecute {
  name = 'python_execute'
  description: string = 'Execute Python code for in-depth data analysis / data report(task conclusion) / other normal task without direct visualization.'
  parameters = {
    type: 'object',
    properties: {
      code_type: {
        description: 'code type, data process / data report / others',
        type: 'string',
        default: 'process',
        enum: ['process', 'report', 'others'],
      },
      code: {
        type: 'string',
        description: `Python code to execute.
# Note
1. The code should generate a comprehensive text-based report containing dataset overview, column details, basic statistics, derived metrics, timeseries comparisons, outliers, and key insights.
2. Use print() for all outputs so the analysis (including sections like 'Dataset Overview' or 'Preprocessing Results') is clearly visible and save it also
3. Save any report / processed files / each analysis result in worksapce directory: ${config.workspaceRoot}
4. Data reports need to be content-rich, including your overall analysis process and corresponding data visualization.
5. You can invode this tool step-by-step to do data analysis from summary to in-depth with data report saved also`,
      },
    },
    required: ['code'],
  }

  execute(params: { code: string }): Promise<ExecuteResult> {
    return super.execute({
      code: params.code,
    })
  }
}
