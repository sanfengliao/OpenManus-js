/**
 * 表示单个搜索结果项
 */
export interface SearchItemProps {
  title: string // 搜索结果的标题
  url: string // 搜索结果的URL
  description?: string // 搜索结果的描述或片段
}

export class SearchItem {
  title: string
  url: string
  description?: string

  constructor(props: SearchItemProps) {
    this.title = props.title
    this.url = props.url
    this.description = props.description
  }

  toString(): string {
    return `${this.title} - ${this.url}`
  }
}

/**
 * Web搜索引擎的基类
 */
export abstract class WebSearchEngine {
  /**
   * 执行网络搜索并返回搜索结果列表
   * @param query 要提交给搜索引擎的搜索查询
   * @param numResults 要返回的搜索结果数量，默认为10
   * @param args 额外的参数
   * @returns 匹配搜索查询的SearchItem对象列表
   */
  async performSearch(
    query: string,
    numResults: number = 10,
    ...args: any[]
  ): Promise<SearchItem[]> {
    throw new Error('Method not implemented')
  }
}
