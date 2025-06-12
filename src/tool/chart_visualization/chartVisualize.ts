import fs from 'node:fs'
import path from 'node:path'
import VMind, { ChartType, DataTable } from '@visactor/vmind'
import { isString } from '@visactor/vutils'
import puppeteer from 'puppeteer'

enum AlgorithmType {
  OverallTrending = 'overallTrend',
  AbnormalTrend = 'abnormalTrend',
  PearsonCorrelation = 'pearsonCorrelation',
  SpearmanCorrelation = 'spearmanCorrelation',
  ExtremeValue = 'extremeValue',
  MajorityValue = 'majorityValue',
  StatisticsAbnormal = 'statisticsAbnormal',
  StatisticsBase = 'statisticsBase',
  DbscanOutlier = 'dbscanOutlier',
  LOFOutlier = 'lofOutlier',
  TurningPoint = 'turningPoint',
  PageHinkley = 'pageHinkley',
  DifferenceOutlier = 'differenceOutlier',
  Volatility = 'volatility',
}

async function getBase64(spec: any, width?: number, height?: number) {
  spec.animation = false
  width && (spec.width = width)
  height && (spec.height = height)
  const browser = await puppeteer.launch()
  const page = await browser.newPage()
  await page.setContent(getHtmlVChart(spec, width, height))

  const dataUrl = await page.evaluate(() => {
    const canvas: any = document
      .getElementById('chart-container')
      ?.querySelector('canvas')
    return canvas?.toDataURL('image/png')
  })

  const base64Data = dataUrl.replace(/^data:image\/png;base64,/, '')
  await browser.close()
  return Buffer.from(base64Data, 'base64')
}

function serializeSpec(spec: any) {
  return JSON.stringify(spec, (key, value) => {
    if (typeof value === 'function') {
      const funcStr = value
        .toString()
        .replace(/(\r\n|\n|\r)/g, '')
        .replace(/\s+/g, ' ')

      return `__FUNCTION__${funcStr}`
    }
    return value
  })
}

function getHtmlVChart(spec: any, width?: number, height?: number) {
  return `<!DOCTYPE html>
<html>
<head>
    <title>VChart Demo</title>
    <script src="https://unpkg.com/@visactor/vchart/build/index.min.js"></script>
</head>
<body>
    <div id="chart-container" style="width: ${
      width ? `${width}px` : '100%'
    }; height: ${height ? `${height}px` : '100%'};"></div>
    <script>
      // parse spec with function
      function parseSpec(stringSpec) {
        return JSON.parse(stringSpec, (k, v) => {
          if (typeof v === 'string' && v.startsWith('__FUNCTION__')) {
            const funcBody = v.slice(12); // 移除标记
            try {
              return new Function('return (' + funcBody + ')')();
            } catch(e) {
              console.error('函数解析失败:', e);
              return () => {};
            }
          }
          return v;
        });
      }
      const spec = parseSpec(\`${serializeSpec(spec)}\`);
      const chart = new VChart.VChart(spec, {
          dom: 'chart-container'
      });
      chart.renderSync();
    </script>
</body>
</html>
`
}

/**
 * get file path saved string
 * @param isUpdate {boolean} default: false, update existed file when is true
 */
function getSavedPathName(
  directory: string,
  fileName: string,
  outputType: 'html' | 'png' | 'json' | 'md',
  isUpdate: boolean = false,
) {
  let newFileName = fileName
  while (
    // eslint-disable-next-line no-unmodified-loop-condition
    !isUpdate
    && fs.existsSync(
      path.join(directory, 'visualization', `${newFileName}.${outputType}`),
    )
  ) {
    newFileName += '_new'
  }
  return path.join(directory, 'visualization', `${newFileName}.${outputType}`)
}

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let input = ''
    process.stdin.setEncoding('utf-8') // 确保编码与 Python 端一致
    process.stdin.on('data', chunk => (input += chunk))
    process.stdin.on('end', () => resolve(input))
  })
}

/** Save insights markdown in local, and return content && path */
function setInsightTemplate(path: string, title: string, insights: string[]) {
  let res = ''
  if (insights.length) {
    res += `## ${title} Insights`
    insights.forEach((insight, index) => {
      res += `\n${index + 1}. ${insight}`
    })
  }
  if (res) {
    fs.writeFileSync(path, res, 'utf-8')
    return { insight_path: path, insight_md: res }
  }
  return {}
}

/** Save vmind result into local file, Return chart file path */
async function saveChartRes(options: {
  spec: any
  directory: string
  outputType: 'png' | 'html'
  fileName: string
  width?: number
  height?: number
  isUpdate?: boolean
}) {
  const { directory, fileName, spec, outputType, width, height, isUpdate }
    = options
  const specPath = getSavedPathName(directory, fileName, 'json', isUpdate)
  fs.writeFileSync(specPath, JSON.stringify(spec, null, 2))
  const savedPath = getSavedPathName(directory, fileName, outputType, isUpdate)
  if (outputType === 'png') {
    const base64 = await getBase64(spec, width, height)
    fs.writeFileSync(savedPath, base64)
  } else {
    const html = getHtmlVChart(spec, width, height)
    fs.writeFileSync(savedPath, html, 'utf-8')
  }
  return savedPath
}

async function generateChart(
  vmind: VMind,
  options: {
    dataset: string | DataTable
    userPrompt: string
    directory: string
    outputType: 'png' | 'html'
    fileName: string
    width?: number
    height?: number
    language?: 'en' | 'zh'
  },
) {
  let res: {
    chart_path?: string
    error?: string
    insight_path?: string
    insight_md?: string
  } = {}
  const {
    dataset,
    userPrompt,
    directory,
    width,
    height,
    outputType,
    fileName,
    language,
  } = options
  try {
    // Get chart spec and save in local file
    const jsonDataset = isString(dataset) ? JSON.parse(dataset) : dataset
    const { spec, error, chartType } = await vmind.generateChart(
      userPrompt,
      undefined,
      jsonDataset,
      {
        enableDataQuery: false,
        theme: 'light',
      },
    )
    if (error || !spec) {
      return {
        error: error || 'Spec of Chart was Empty!',
      }
    }

    spec.title = {
      text: userPrompt,
    }
    if (!fs.existsSync(path.join(directory, 'visualization'))) {
      fs.mkdirSync(path.join(directory, 'visualization'))
    }
    const specPath = getSavedPathName(directory, fileName, 'json')
    res.chart_path = await saveChartRes({
      directory,
      spec,
      width,
      height,
      fileName,
      outputType,
    })

    // get chart insights and save in local
    const insights = []
    if (
      chartType
      && [
        ChartType.BarChart,
        ChartType.LineChart,
        ChartType.AreaChart,
        ChartType.ScatterPlot,
        ChartType.DualAxisChart,
      ].includes(chartType)
    ) {
      const { insights: vmindInsights } = await vmind.getInsights(spec, {
        maxNum: 6,
        algorithms: [
          AlgorithmType.OverallTrending,
          AlgorithmType.AbnormalTrend,
          AlgorithmType.PearsonCorrelation,
          AlgorithmType.SpearmanCorrelation,
          AlgorithmType.StatisticsAbnormal,
          AlgorithmType.LOFOutlier,
          AlgorithmType.DbscanOutlier,
          AlgorithmType.MajorityValue,
          AlgorithmType.PageHinkley,
          AlgorithmType.TurningPoint,
          AlgorithmType.StatisticsBase,
          AlgorithmType.Volatility,
        ],
        usePolish: false,
        language: language === 'en' ? 'english' : 'chinese',
      })
      insights.push(...vmindInsights)
    }
    const insightsText = insights
      .map(insight => insight.textContent?.plainText)
      .filter(insight => !!insight) as string[]
    spec.insights = insights
    fs.writeFileSync(specPath, JSON.stringify(spec, null, 2))
    res = {
      ...res,
      ...setInsightTemplate(
        getSavedPathName(directory, fileName, 'md'),
        userPrompt,
        insightsText,
      ),
    }
  } catch (error: any) {
    res.error = error.toString()
  }
  return res
}

async function updateChartWithInsight(
  vmind: VMind,
  options: {
    directory: string
    outputType: 'png' | 'html'
    fileName: string
    insightsId: number[]
  },
) {
  const { directory, outputType, fileName, insightsId } = options
  const res: { error?: string, chart_path?: string } = {}
  try {
    const specPath = getSavedPathName(directory, fileName, 'json', true)
    const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'))
    // llm select index from 1
    const insights = (spec.insights || []).filter(
      (_insight: any, index: number) => insightsId.includes(index + 1),
    )
    const { newSpec, error } = await vmind.updateSpecByInsights(spec, insights)
    if (error) {
      throw error
    }
    res.chart_path = await saveChartRes({
      spec: newSpec,
      directory,
      outputType,
      fileName,
      isUpdate: true,
    })
  } catch (error: any) {
    res.error = error.toString()
  }
  return res
}

export async function executeVMind(inputData: any) {
  let res
  const {
    llm_config,
    width,
    dataset = [],
    height,
    directory,
    user_prompt: userPrompt,
    output_type: outputType = 'png',
    file_name: fileName,
    task_type: taskType = 'visualization',
    insights_id: insightsId = [],
    language = 'en',
  } = inputData
  const { base_url: baseUrl, model, api_key: apiKey } = llm_config
  const vmind = new VMind({
    url: `${baseUrl}/chat/completions`,
    model,
    headers: {
      'api-key': apiKey,
      'Authorization': `Bearer ${apiKey}`,
    },
  })
  if (taskType === 'visualization') {
    res = await generateChart(vmind, {
      dataset,
      userPrompt,
      directory,
      outputType,
      fileName,
      width,
      height,
      language,
    })
  } else if (taskType === 'insight' && insightsId.length) {
    res = await updateChartWithInsight(vmind, {
      directory,
      fileName,
      outputType,
      insightsId,
    })
  }
  return res
}
