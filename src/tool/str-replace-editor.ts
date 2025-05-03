import * as Path from 'node:path'
import { ToolError } from '../exceptions'
import { BaseTool, ToolResult } from './base'
import { LocalFileOperator } from './file-operator'

type PathLike = string

export type Command = 'view' | 'create' | 'str_replace' | 'insert' | 'undo_edit'

export interface ViewRange {
  start: number
  end: number
}

export interface FileOperator {
  readFile: (path: PathLike) => Promise<string>
  writeFile: (path: PathLike, content: string) => Promise<void>
  isDirectory: (path: PathLike) => Promise<boolean>
  exists: (path: PathLike) => Promise<boolean>
  runCommand: (cmd: string) => Promise<[number, string, string]>
}

export interface CLIResult extends ToolResult {
  command?: string
}

export const SNIPPET_LINES = 4
export const MAX_RESPONSE_LEN = 16000
export const TRUNCATED_MESSAGE
    = '<response clipped><NOTE>To save on context only part of this file has been shown to you. '
      + 'You should retry this tool after you have searched inside the file with `grep -n` '
      + 'in order to find the line numbers of what you are looking for.</NOTE>'

export const DESCRIPTION = `Custom editing tool for viewing, creating and editing files
* State is persistent across command calls and discussions with the user
* If 'path' is a file, 'view' displays the result of applying 'cat -n'. If 'path' is a directory, 'view' lists non-hidden files and directories up to 2 levels deep
* The 'create' command cannot be used if the specified 'path' already exists as a file
* If a 'command' generates a long output, it will be truncated and marked with '<response clipped>'
* The 'undo_edit' command will revert the last edit made to the file at 'path'

Notes for using the 'str_replace' command:
* The 'old_str' parameter should match EXACTLY one or more consecutive lines from the original file. Be mindful of whitespaces!
* If the 'old_str' parameter is not unique in the file, the replacement will not be performed. Make sure to include enough context in 'old_str' to make it unique
* The 'new_str' parameter should contain the edited lines that should replace the 'old_str'
`

/**
 * A tool for viewing, creating, and editing files with sandbox support
 */
export class StrReplaceEditor extends BaseTool {
  public readonly name = 'str_replace_editor'
  public readonly description = DESCRIPTION
  public readonly parameters = {
    type: 'object',
    properties: {
      command: {
        description: 'The commands to run. Allowed options are: \'view\', \'create\', \'str_replace\', \'insert\', \'undo_edit\'.',
        enum: ['view', 'create', 'str_replace', 'insert', 'undo_edit'],
        type: 'string',
      },
      path: {
        description: 'Absolute path to file or directory.',
        type: 'string',
      },
      file_text: {
        description: 'Required parameter of \'create\' command, with the content of the file to be created.',
        type: 'string',
      },
      old_str: {
        description: 'Required parameter of \'str_replace\' command containing the string in \'path\' to replace.',
        type: 'string',
      },
      new_str: {
        description: 'Optional parameter of \'str_replace\' command containing the new string (if not given, no string will be added). Required parameter of \'insert\' command containing the string to insert.',
        type: 'string',
      },
      insert_line: {
        description: 'Required parameter of \'insert\' command. The \'new_str\' will be inserted AFTER the line \'insert_line\' of \'path\'.',
        type: 'integer',
      },
      view_range: {
        description: 'Optional parameter of \'view\' command when \'path\' points to a file. If none is given, the full file is shown. If provided, the file will be shown in the indicated line number range.',
        items: { type: 'integer' },
        type: 'array',
      },
    },
    required: ['command', 'path'],
  }

  private fileHistory: Map<string, string[]> = new Map()
  private localOperator: LocalFileOperator = new LocalFileOperator()

  private getOperator() {
    return this.localOperator
  }

  /**
   * Execute a file operation command
   */
  public async execute({
    command,
    path,
    fileText,
    viewRange,
    oldStr,
    newStr,
    insertLine,
    ...kwargs
  }: {
    command: Command
    path: string
    fileText?: string
    viewRange?: number[]
    oldStr?: string
    newStr?: string
    insertLine?: number
  }): Promise<string> {
    // Get the appropriate file operator
    const operator = this.getOperator()

    // Validate path and command combination
    await this.validatePath(command, Path.resolve(path), operator)

    let result: ToolResult

    // Execute the appropriate command
    switch (command) {
      case 'view':
        result = await this.view(path, viewRange, operator)
        break
      case 'create':
        if (!fileText) {
          throw new ToolError('Parameter `file_text` is required for command: create')
        }
        await operator.writeFile(path, fileText)
        this.fileHistory.get(path)?.push(fileText)
        result = new ToolResult({ status: 'success', output: `File created successfully at: ${path}` })
        break
      case 'str_replace':
        if (!oldStr) {
          throw new ToolError('Parameter `old_str` is required for command: str_replace')
        }
        result = await this.strReplace(path, oldStr, newStr, operator)
        break
      case 'insert':
        if (insertLine === undefined) {
          throw new ToolError('Parameter `insert_line` is required for command: insert')
        }
        if (!newStr) {
          throw new ToolError('Parameter `new_str` is required for command: insert')
        }
        result = await this.insert(path, insertLine, newStr, operator)
        break
      case 'undo_edit':
        result = await this.undoEdit(path, operator)
        break
      default:
        throw new ToolError(
          `Unrecognized command ${command}. The allowed commands are: view, create, str_replace, insert, undo_edit`,
        )
    }

    return result.toString()
  }

  /**
   * Validate path and command combination based on execution environment
   */
  private async validatePath(
    command: string,
    path: PathLike,
    operator: FileOperator,
  ): Promise<void> {
    // Check if path is absolute
    if (!Path.isAbsolute(path)) {
      throw new ToolError(`The path ${path} is not an absolute path`)
    }

    // Only check if path exists for non-create commands
    if (command !== 'create') {
      if (!await operator.exists(path)) {
        throw new ToolError(
          `The path ${path} does not exist. Please provide a valid path.`,
        )
      }

      // Check if path is a directory
      const isDir = await operator.isDirectory(path)
      if (isDir && command !== 'view') {
        throw new ToolError(
          `The path ${path} is a directory and only the 'view' command can be used on directories`,
        )
      }
    }
    else if (await operator.exists(path)) {
      throw new ToolError(
        `File already exists at: ${path}. Cannot overwrite files using command 'create'.`,
      )
    }
  }

  /**
   * Display file or directory content
   */
  private async view(
    path: PathLike,
    viewRange?: number[],
    operator: FileOperator = this.getOperator(),
  ): Promise<CLIResult> {
    // Determine if path is a directory
    const isDir = await operator.isDirectory(path)

    if (isDir) {
      // Directory handling
      if (viewRange) {
        throw new ToolError(
          'The `view_range` parameter is not allowed when `path` points to a directory.',
        )
      }
      return this.viewDirectory(path, operator)
    }
    else {
      // File handling
      return this.viewFile(path, operator, viewRange)
    }
  }

  /**
   * Replace a unique string in a file with a new string
   */
  private async strReplace(
    path: PathLike,
    oldStr: string,
    newStr: string | undefined = '',
    operator: FileOperator,
  ): Promise<CLIResult> {
    // Read file content and expand tabs
    const fileContent = (await operator.readFile(path)).replace(/\t/g, '    ')
    oldStr = oldStr.replace(/\t/g, '    ')
    newStr = newStr?.replace(/\t/g, '    ') ?? ''

    // Check if old_str is unique in the file
    const occurrences = fileContent.split(oldStr).length - 1
    if (occurrences === 0) {
      throw new ToolError(
        `No replacement was performed, old_str '${oldStr}' did not appear verbatim in ${path}.`,
      )
    }
    else if (occurrences > 1) {
      // Find line numbers of occurrences
      const fileContentLines = fileContent.split('\n')
      const lines = fileContentLines
        .map((line, idx) => line.includes(oldStr) ? idx + 1 : null)
        .filter((idx): idx is number => idx !== null)

      throw new ToolError(
        `No replacement was performed. Multiple occurrences of old_str '${oldStr}' `
        + `in lines ${lines.join(', ')}. Please ensure it is unique`,
      )
    }

    // Replace old_str with new_str
    const newFileContent = fileContent.replace(oldStr, newStr)

    // Write the new content to the file
    await operator.writeFile(path, newFileContent)

    // Save the original content to history
    if (!this.fileHistory.has(path)) {
      this.fileHistory.set(path, [])
    }
    this.fileHistory.get(path)!.push(fileContent)

    // Create a snippet of the edited section
    const replacementLine = fileContent.split(oldStr)[0].split('\n').length - 1
    const startLine = Math.max(0, replacementLine - SNIPPET_LINES)
    const endLine = replacementLine + SNIPPET_LINES + newStr.split('\n').length
    const snippet = newFileContent.split('\n').slice(startLine, endLine + 1).join('\n')

    // Prepare the success message
    let successMsg = `The file ${path} has been edited. `
    successMsg += this.makeOutput(snippet, `a snippet of ${path}`, startLine + 1)
    successMsg += 'Review the changes and make sure they are as expected. Edit the file again if necessary.'

    return new ToolResult({ status: 'success', output: successMsg })
  }

  /**
   * Insert text at a specific line in a file
   */
  private async insert(
    path: PathLike,
    insertLine: number,
    newStr: string,
    operator: FileOperator,
  ): Promise<CLIResult> {
    // Read and prepare content
    const fileText = (await operator.readFile(path)).replace(/\t/g, '    ')
    newStr = newStr.replace(/\t/g, '    ')
    const fileTextLines = fileText.split('\n')
    const nLinesFile = fileTextLines.length

    // Validate insert_line
    if (insertLine < 0 || insertLine > nLinesFile) {
      throw new ToolError(
        `Invalid 'insert_line' parameter: ${insertLine}. It should be within `
        + `the range of lines of the file: [0, ${nLinesFile}]`,
      )
    }

    // Perform insertion
    const newStrLines = newStr.split('\n')
    const newFileTextLines = [
      ...fileTextLines.slice(0, insertLine),
      ...newStrLines,
      ...fileTextLines.slice(insertLine),
    ]

    // Create a snippet for preview
    const snippetLines = [
      ...fileTextLines.slice(Math.max(0, insertLine - SNIPPET_LINES), insertLine),
      ...newStrLines,
      ...fileTextLines.slice(insertLine, insertLine + SNIPPET_LINES),
    ]

    // Join lines and write to file
    const newFileText = newFileTextLines.join('\n')
    const snippet = snippetLines.join('\n')

    await operator.writeFile(path, newFileText)

    if (!this.fileHistory.has(path)) {
      this.fileHistory.set(path, [])
    }
    this.fileHistory.get(path)!.push(fileText)

    // Prepare success message
    let successMsg = `The file ${path} has been edited. `
    successMsg += this.makeOutput(
      snippet,
      'a snippet of the edited file',
      Math.max(1, insertLine - SNIPPET_LINES + 1),
    )
    successMsg += 'Review the changes and make sure they are as expected (correct indentation, no duplicate lines, etc). Edit the file again if necessary.'

    return new ToolResult({ status: 'success', output: successMsg })
  }

  /**
   * Revert the last edit made to a file
   */
  private async undoEdit(
    path: PathLike,
    operator: FileOperator,
  ): Promise<CLIResult> {
    const history = this.fileHistory.get(path)
    if (!history?.length) {
      throw new ToolError(`No edit history found for ${path}.`)
    }

    const oldText = history.pop()!
    await operator.writeFile(path, oldText)

    return new ToolResult({
      status: 'success',
      output: `Last edit to ${path} undone successfully. ${this.makeOutput(oldText, String(path))}`,
    })
  }

  /**
   * Format file content for display with line numbers
   */
  private makeOutput(
    fileContent: string,
    fileDescriptor: string,
    initLine: number = 1,
    expandTabs: boolean = true,
  ): string {
    fileContent = this.maybeTruncate(fileContent)
    if (expandTabs) {
      fileContent = fileContent.replace(/\t/g, '    ')
    }

    // Add line numbers to each line
    const contentWithLineNumbers = fileContent
      .split('\n')
      .map((line, i) => `${String(i + initLine).padStart(6)}\t${line}`)
      .join('\n')

    return [
      `Here's the result of running 'cat -n' on ${fileDescriptor}:`,
      contentWithLineNumbers,
      '',
    ].join('\n')
  }

  /**
   * Truncate content if it exceeds the maximum length
   */
  private maybeTruncate(
    content: string,
    truncateAfter: number = MAX_RESPONSE_LEN,
  ): string {
    if (!truncateAfter || content.length <= truncateAfter) {
      return content
    }
    return content.substring(0, truncateAfter) + TRUNCATED_MESSAGE
  }

  /**
   * Display directory contents
   */
  private async viewDirectory(
    path: PathLike,
    operator: FileOperator,
  ): Promise<CLIResult> {
    const findCmd = `find ${path} -maxdepth 2 -not -path '*/\\.*'`

    // Execute command using the operator
    const [returnCode, stdout, stderr] = await operator.runCommand(findCmd)

    if (!stderr) {
      const output = [
        `Here's the files and directories up to 2 levels deep in ${path}, `,
        'excluding hidden items:',
        stdout,
        '',
      ].join('\n')

      return new ToolResult({ status: 'success', output })
    }

    return new ToolResult({ status: 'error', error: stderr })
  }

  /**
   * Display file content, optionally within a specified line range
   */
  private async viewFile(
    path: PathLike,
    operator: FileOperator,
    viewRange?: number[],
  ): Promise<CLIResult> {
    // Read file content
    let fileContent = await operator.readFile(path)
    let initLine = 1

    // Apply view range if specified
    if (viewRange) {
      if (viewRange.length !== 2 || !viewRange.every(i => Number.isInteger(i))) {
        throw new ToolError(
          'Invalid `view_range`. It should be a list of two integers.',
        )
      }

      const fileLines = fileContent.split('\n')
      const nLinesFile = fileLines.length
      const [startLine, endLine] = viewRange

      // Validate view range
      if (startLine < 1 || startLine > nLinesFile) {
        throw new ToolError(
          `Invalid 'view_range': ${viewRange}. Its first element '${startLine}' should be `
          + `within the range of lines of the file: [1, ${nLinesFile}]`,
        )
      }
      if (endLine > nLinesFile) {
        throw new ToolError(
          `Invalid 'view_range': ${viewRange}. Its second element '${endLine}' should be `
          + `smaller than the number of lines in the file: '${nLinesFile}'`,
        )
      }
      if (endLine !== -1 && endLine < startLine) {
        throw new ToolError(
          `Invalid 'view_range': ${viewRange}. Its second element '${endLine}' should be `
          + `larger or equal than its first '${startLine}'`,
        )
      }

      // Apply range
      if (endLine === -1) {
        fileContent = fileLines.slice(startLine - 1).join('\n')
      }
      else {
        fileContent = fileLines.slice(startLine - 1, endLine).join('\n')
      }
      initLine = startLine
    }

    // Format and return result
    return new ToolResult({
      status: 'success',
      output: this.makeOutput(fileContent, String(path), initLine),
    })
  }
}
