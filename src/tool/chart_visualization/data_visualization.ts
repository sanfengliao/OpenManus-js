import * as fs from 'node:fs'
import * as path from 'node:path'
import csv from 'csv-parser'
import { config } from '../../config'
import { LLM } from '../../llm'
import { logger } from '../../logger'
import { BaseTool, ToolResult } from '../base'
import { executeVMind } from './chartVisualize'

interface DataItem {
  file_name: string
  dict_data: string
  chartTitle: string
}

interface VmindResult {
  error?: string
  chart_path?: string
  title?: string
}

interface VisualizationResult {
  observation: string
  success?: boolean
}

interface ChatData {
  title: string
  chart_path?: string
}

interface InsightDataItem {
  file_name: string
  insights_id: string
}

interface InsightVmindResult {
  error?: string
  chart_path?: string
  title?: string
}

interface InsightResult {
  observation: string
  success?: boolean
}

export interface ExecuteResult {
  observation: string
  success?: boolean
}

export class DataVisualization extends BaseTool {
  name = 'data_visualization'
  description = `Visualize statistical chart or Add insights in chart with JSON info from visualization_preparation tool. You can do steps as follows:
1. Visualize statistical chart
2. Choose insights into chart based on step 1 (Optional)
Outputs:
1. Charts (png/html)
2. Charts Insights (.md)(Optional)`
  parameters = {
    type: 'object',
    properties: {
      json_path: {
        type: 'string',
        description: `file path of json info with ".json" in the end`,
      },
      output_type: {
        description: 'Rendering format (html=interactive)',
        type: 'string',
        default: 'html',
        enum: ['png', 'html'],
      },
      tool_type: {
        description: 'visualize chart or add insights',
        type: 'string',
        default: 'visualization',
        enum: ['visualization', 'insight'],
      },
      language: {
        description: 'english(en) / chinese(zh)',
        type: 'string',
        default: 'en',
        enum: ['zh', 'en'],
      },
    },
    required: ['code'],
  }

  llm: LLM
  constructor({ llm }: { llm: LLM }) {
    super()
    this.llm = llm || new LLM(this.name.toLowerCase())
  }

  getFilePath(
    jsonInfo: Array<Record<string, string>>,
    pathKey: string,
    directory?: string,
  ): string[] {
    const res: string[] = []

    for (const item of jsonInfo) {
      const filePath = item[pathKey]

      if (fs.existsSync(filePath)) {
        res.push(filePath)
      } else {
        const fullPath = path.join(
          directory || config.workspaceRoot,
          filePath,
        )

        if (fs.existsSync(fullPath)) {
          res.push(fullPath)
        } else {
          throw new Error(`No such file or directory: ${filePath}`)
        }
      }
    }

    return res
  }

  successOutputTemplate(result: Array<ChatData>): string {
    let content = ''

    if (result.length === 0) {
      return 'Is EMPTY!'
    }

    for (const item of result) {
      content += `## ${item.title}\nChart saved in: ${item.chart_path}`

      if ('insight_path' in item && item.insight_path && 'insight_md' in item) {
        content += `\n${item.insight_md}`
      } else {
        content += '\n'
      }
    }

    return `Chart Generated Successful!\n${content}`
  }

  async dataVisualization(
    jsonInfo: Array<Record<string, string>>,
    outputType: string,
    language: string,
  ): Promise<VisualizationResult> {
    const dataList: DataItem[] = []
    const csvFilePath = this.getFilePath(jsonInfo, 'csvFilePath')

    for (let index = 0; index < jsonInfo.length; index++) {
      const item = jsonInfo[index]
      const csvPath = csvFilePath[index]

      // Read CSV file and convert to JSON
      const csvData = await this.readCsvFile(csvPath)
      const dataJson = JSON.stringify(csvData)

      dataList.push({
        file_name: path.basename(csvPath).replace('.csv', ''),
        dict_data: dataJson,
        chartTitle: item.chartTitle,
      })
    }

    // Create tasks for parallel execution
    const tasks = dataList.map(item =>
      this.invokeVmind({
        dict_data: item.dict_data,
        chart_description: item.chartTitle,
        file_name: item.file_name,
        output_type: outputType,
        task_type: 'visualization',
        language,
      }),
    )

    const results: VmindResult[] = await Promise.all(tasks)
    const errorList: string[] = []
    const successList: Array<ChatData> = []

    for (let index = 0; index < results.length; index++) {
      const result = results[index]
      const csvPath = csvFilePath[index]

      if ('error' in result && !('chart_path' in result)) {
        errorList.push(`Error in ${csvPath}: ${result.error}`)
      } else {
        successList.push({
          ...result,
          title: jsonInfo[index].chartTitle,
        })
      }
    }

    if (errorList.length > 0) {
      return {
        observation: `# Error chart generated\n${errorList.join('\n')}\n${this.successOutputTemplate(successList)}`,
        success: false,
      }
    } else {
      return {
        observation: `${this.successOutputTemplate(successList)}`,
      }
    }
  }

  async addInsights(
    jsonInfo: Array<Record<string, string>>,
    outputType: string,
  ): Promise<InsightResult> {
    const dataList: InsightDataItem[] = []
    const chartFilePath = this.getFilePath(
      jsonInfo,
      'chartPath',
      path.join(config.workspaceRoot, 'visualization'),
    )

    for (let index = 0; index < jsonInfo.length; index++) {
      const item = jsonInfo[index]

      if ('insights_id' in item) {
        dataList.push({
          file_name: path.basename(chartFilePath[index]).replace(
            `.${outputType}`,
            '',
          ),
          insights_id: item.insights_id,
        })
      }
    }

    // Create tasks for parallel execution
    const tasks = dataList.map(item =>
      this.invokeVmind({
        insights_id: item.insights_id,
        file_name: item.file_name,
        output_type: outputType,
        task_type: 'insight',
      }),
    )

    const results: InsightVmindResult[] = await Promise.all(tasks)
    const errorList: string[] = []
    const successList: string[] = []

    for (let index = 0; index < results.length; index++) {
      const result = results[index]
      const chartPath = chartFilePath[index]

      if ('error' in result && !('chart_path' in result)) {
        errorList.push(`Error in ${chartPath}: ${result.error}`)
      } else {
        successList.push(chartPath)
      }
    }

    const successTemplate = successList.length > 0
      ? `# Charts Update with Insights\n${successList.join(',')}`
      : ''

    if (errorList.length > 0) {
      return {
        observation: `# Error in chart insights:\n${errorList.join('\n')}\n${successTemplate}`,
        success: false,
      }
    } else {
      return {
        observation: `${successTemplate}`,
      }
    }
  }

  private async readCsvFile(filePath: string): Promise<any[]> {
    return new Promise((resolve, reject) => {
      const results: any[] = []

      fs.createReadStream(filePath)
        .pipe(csv())
        .on('data', (data) => {
          // Convert null/undefined values to null (similar to pandas where pd.notnull(df), None)
          const cleanData: any = {}
          for (const [key, value] of Object.entries(data)) {
            cleanData[key] = (value === '' || value === undefined) ? null : value
          }
          results.push(cleanData)
        })
        .on('end', () => {
          resolve(results)
        })
        .on('error', (error) => {
          reject(error)
        })
    })
  }

  execute(params: {
    json_path: string
    output_type?: 'png' | 'html'
    tool_type?: 'visualization' | 'insight'
    language?: 'zh' | 'en'
  }): Promise<ExecuteResult> {
    const { json_path, output_type = 'html', tool_type = 'visualization', language = 'en' } = params
    try {
      logger.info(`📈 data_visualization with ${json_path} in: ${tool_type} `)
      const jsonInfo = JSON.parse(fs.readFileSync(json_path, 'utf-8'))
      if (tool_type === 'visualization') {
        return this.dataVisualization(jsonInfo, output_type, language)
      }
      return this.addInsights(jsonInfo, output_type)
    } catch (error) {
      return Promise.resolve({
        observation: `Error in data visualization: ${error instanceof Error ? error.message : String(error)}`,
        success: false,
      })
    }
  }

  async invokeVmind(params: { dict_data?: string, chart_description?: string, file_name: string, output_type: string, task_type: string, language?: string, insights_id?: string }) {
    const { dict_data, chart_description, file_name, output_type, task_type, language = 'en', insights_id } = params
    const llm_config = {
      base_url: this.llm.baseUrl,
      model: this.llm.model,
      api_key: this.llm.apiKey,
    }
    const vmind_params = {
      llm_config,
      user_prompt: chart_description,
      dataset: dict_data,
      file_name,
      output_type,
      insights_id,
      task_type,
      directory: config.workspaceRoot,
      language,
    }
    const res = await executeVMind(vmind_params)
    if (res) {
      return res
    }
    return {
      error: 'Failed to execute VMind',
      chart_path: '',
      title: chart_description,
    }
  }
}
