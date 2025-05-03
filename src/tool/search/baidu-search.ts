import type { CheerioAPI } from 'cheerio'

import type { SearchItemProps } from './base'

import axios from 'axios'

import { load } from 'cheerio'

import { SearchItem, WebSearchEngine } from './base'

export class BaiduSearchEngine extends WebSearchEngine {
  /**
   * 执行百度搜索并返回格式化的搜索结果
   * @param query 搜索查询
   * @param numResults 返回结果数量
   * @param args 额外参数
   * @returns SearchItem数组
   */
  async performSearch(
    query: string,
    numResults: number = 10,
    ...args: any[]
  ): Promise<SearchItem[]> {
    const rawResults = await search(query, { numResults })
    if (!rawResults) {
      return []
    }
    const results: SearchItem[] = []

    rawResults.forEach((item, index) => {
      const baseTitle = `Baidu Result ${index + 1}`

      if (typeof item === 'string') {
        // 处理字符串URL
        results.push(new SearchItem({
          title: baseTitle,
          url: item,
        }))
      }
      else if (typeof item === 'object' && item !== null) {
        try {
          // 处理对象类型的结果
          const searchItemProps: SearchItemProps = {
            title: item.title || baseTitle,
            url: item.url || '',
            description: item.abstract,
          }
          results.push(new SearchItem(searchItemProps))
        }
        catch (error) {
          // 降级处理
          results.push(new SearchItem({
            title: baseTitle,
            url: String(item),
          }))
        }
      }
    })

    return results
  }
}

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/68.0.3440.106 Safari/537.36',
  // ... 其他 user agents
]

const HEADERS = {
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
  'Content-Type': 'application/x-www-form-urlencoded',
  'User-Agent': USER_AGENTS[0],
  'Referer': 'https://www.baidu.com/',
  'Accept-Encoding': 'gzip, deflate',
  'Accept-Language': 'zh-CN,zh;q=0.9',
}

export interface SearchResult {
  title: string
  abstract: string
  url: string
  rank: number
}

export interface SearchOptions {
  numResults?: number
  debug?: boolean
}

export type ParseResult = [SearchResult[] | null, string | null]

const BAIDU_SEARCH_URL = 'https://www.baidu.com/s?ie=utf-8&tn=baidu&wd='

/**
 * 通过关键字进行搜索
 * @param keyword 搜索关键字
 * @param options 搜索选项
 * @returns 搜索结果列表
 */
export async function search(
  keyword: string,
  options: SearchOptions = {},
): Promise<SearchResult[] | null> {
  const {
    numResults = 10,
    debug = false,
  } = options

  if (!keyword) {
    return null
  }

  const listResult: SearchResult[] = []
  let page = 1

  // 起始搜索的url
  let nextUrl = BAIDU_SEARCH_URL + encodeURIComponent(keyword)

  // 循环遍历每一页的搜索结果，并返回下一页的url
  while (listResult.length < numResults) {
    const [data, newNextUrl]: ParseResult = await parseHtml(nextUrl, listResult.length, debug)

    if (data) {
      listResult.push(...data)
      if (debug) {
        console.log(
          `---searching[${keyword}], finish parsing page ${page}, results number=${data.length}:`,
        )
        data.forEach(d => console.log(d))
      }
    }

    if (!newNextUrl) {
      if (debug) {
        console.log('已到达最后一页')
      }
      break
    }

    nextUrl = newNextUrl
    page++
  }

  if (debug) {
    console.log(
      `\n---search [${keyword}] finished. total results number=${listResult.length}！`,
    )
  }

  return listResult.length > numResults
    ? listResult.slice(0, numResults)
    : listResult
}

const ABSTRACT_MAX_LENGTH = 300
const BAIDU_HOST_URL = 'https://www.baidu.com'

export async function parseHtml(
  url: string,
  rankStart: number = 0,
  debug: boolean = false,
): Promise<ParseResult> {
  try {
    const { data: html } = await axios.get(url, {
      headers: HEADERS,
    })
    const $: CheerioAPI = load(html)
    const listData: SearchResult[] = []

    const divContents = $('#content_left')
    divContents.children('.c-container').each((_, element) => {
      const $div = $(element)
      const classList = $div.attr('class')?.split(' ') || []

      try {
        let title = ''
        let url = ''
        let abstract = ''

        // 处理 xpath-log 类型的结果
        if (classList.includes('xpath-log')) {
          const $h3 = $div.find('h3')
          if ($h3.length) {
            title = $h3.text().trim()
            url = $h3.find('a').attr('href')?.trim() || ''
          }
          else {
            const text = $div.text().trim()
            title = text.split('\n')[0].trim()
            url = $div.find('a').attr('href')?.trim() || ''
          }

          const $abstract = $div.find('.c-abstract')
          if ($abstract.length) {
            abstract = $abstract.text().trim()
          }
          else if ($div.find('div').length) {
            abstract = $div.find('div').first().text().trim()
          }
          else {
            const parts = $div.text().trim().split('\n')
            if (parts.length > 1) {
              abstract = parts[1].trim()
            }
          }
        }
        // 处理 result-op 类型的结果
        else if (classList.includes('result-op')) {
          const $h3 = $div.find('h3')
          if ($h3.length) {
            title = $h3.text().trim()
            url = $h3.find('a').attr('href')?.trim() || ''
          }
          else {
            const text = $div.text().trim()
            title = text.split('\n')[0].trim()
            url = $div.find('a').attr('href')?.trim() || ''
          }

          const $abstract = $div.find('.c-abstract')
          if ($abstract.length) {
            abstract = $abstract.text().trim()
          }
          else if ($div.find('div').length) {
            abstract = $div.find('div').first().text().trim()
          }
          else {
            const parts = $div.text().trim().split('\n')
            if (parts.length > 1) {
              abstract = parts[1].trim()
            }
          }
        }
        // 处理其他类型的结果
        else {
          const tpl = $div.attr('tpl')
          if (tpl && tpl !== 'se_com_default') {
            if (tpl === 'se_st_com_abstract') {
              const $h3 = $div.find('h3')
              title = $h3.text().trim()

              const $abstract = $div.find('.c-abstract')
              if ($abstract.length) {
                abstract = $abstract.text().trim()
              }
              else if ($div.find('div').length) {
                abstract = $div.find('div').first().text().trim()
              }
              else {
                abstract = $div.text().trim()
              }
            }
          }
        }

        if (title && url) {
          if (abstract.length > ABSTRACT_MAX_LENGTH) {
            abstract = abstract.substring(0, ABSTRACT_MAX_LENGTH)
          }

          listData.push({
            title,
            abstract,
            url,
            rank: ++rankStart,
          })
        }
      }
      catch (error) {
        if (debug) {
          console.error('解析页面元素时出错:', error)
        }
      }
    })

    // 查找下一页链接
    const nextButtons = $('.n')
    const lastButton = nextButtons.last()

    // 检查是否有下一页
    if (nextButtons.length === 0 || lastButton.text().includes('上一页')) {
      return [listData, null]
    }

    const nextUrl = BAIDU_HOST_URL + (lastButton.attr('href') || '')
    return [listData, nextUrl]
  }
  catch (error) {
    if (debug) {
      console.error('解析页面时出错:', error)
    }
    return [null, null]
  }
}

if (require.main === module) {
  const keyword = '百度'
  search(keyword, { numResults: 5, debug: true })
    .then((results) => {
      console.log('搜索结果:', results)
    })
    .catch((error) => {
      console.error('搜索失败:', error)
    })
}
